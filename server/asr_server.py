"""Quran recitation ASR server: streams microphone audio from the web app to a Quran-tuned
Whisper model and sends back partial / final text, like a speech API but self-hosted.

Protocol (WebSocket, path /ws?token=...):
  client -> server   binary frames: 16 kHz mono int16 PCM
                     text  frames: {"type":"ctx","prompt":"<previous ayah text>","hot":"<upcoming words>"}
                                   {"type":"stop"}
  server -> client   {"type":"ready","model":"..."}
                     {"type":"partial","text":"<uncommitted tail>"}
                     {"type":"final","text":"<newly committed words>"}
                     {"type":"error","message":"..."}

Streaming policy: LocalAgreement-2 (Macháček et al., whisper_streaming). The rolling buffer is
re-transcribed every STEP seconds; words that two consecutive hypotheses agree on are committed.
A pause of SILENCE_FLUSH seconds commits whatever is pending, like an end of utterance.

Env: ASR_MODEL (CTranslate2 dir or HF id, default tarteel-ai/whisper-base-ar-quran),
     ASR_TOKEN (shared secret; empty = open), ASR_PORT (8765), ASR_THREADS (cpu threads),
     ASR_FAKE=1 (scripted transcriber for tests, no model needed).
"""
import asyncio
import json
import logging
import os
import re
import threading
import time
from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

import numpy as np
import websockets
from websockets.asyncio.server import serve

RATE = 16000
STEP = 0.5            # seconds of new audio between transcriptions
MAX_BUFFER = 9.0      # seconds kept in the rolling buffer
KEEP_AFTER_TRIM = 4.0 # seconds kept after a trim
SILENCE_FLUSH = 1.2   # seconds of silence that commits pending words
SILENCE_RMS = 300     # int16 RMS below which a chunk counts as silence (adaptive floor applied)
log = logging.getLogger("asr")

DIAC = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def norm(w: str) -> str:
    """Spelling-insensitive key for comparing hypotheses (same spirit as src/engine.js)."""
    w = DIAC.sub("", w)
    w = re.sub("[ٱأإآ]", "ا", w).replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    w = re.sub("[^ء-ي]", "", w)
    return w.replace("ا", "").replace("ء", "")


# ----------------------------------------------------------------------------- transcribers
class FasterWhisperTranscriber:
    def __init__(self, model: str, threads: int):
        from faster_whisper import WhisperModel  # imported lazily so tests run without it
        self.name = model
        self.model = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=threads)
        self.lock = threading.Lock()  # one model, one decode at a time

    def transcribe(self, pcm: np.ndarray, prompt: str, hotwords: str):
        audio = pcm.astype(np.float32) / 32768.0
        with self.lock:
            segments, _ = self.model.transcribe(
                audio, language="ar", task="transcribe", beam_size=1, best_of=1, temperature=0.0,
                word_timestamps=True, condition_on_previous_text=False,
                initial_prompt=prompt or None, hotwords=hotwords or None,
                vad_filter=True, vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
                no_speech_threshold=0.5, log_prob_threshold=-1.2, compression_ratio_threshold=2.0)
            words = []
            for seg in segments:
                for w in seg.words or []:
                    t = w.word.strip()
                    if t:
                        words.append((float(w.start), float(w.end), t))
        return words


class FakeTranscriber:
    """Scripted transcriber for tests: hears SCRIPT at 2 words per second of audio."""
    SCRIPT = "الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين إياك نعبد وإياك نستعين".split()

    def __init__(self):
        self.name = "fake"
        self.calls = 0

    def transcribe(self, pcm: np.ndarray, prompt: str, hotwords: str):
        self.calls += 1
        if np.abs(pcm).mean() < 50:   # silence → nothing (like VAD)
            return []
        n = min(len(self.SCRIPT), int(len(pcm) / RATE * 2))
        return [(i * 0.5, i * 0.5 + 0.45, self.SCRIPT[i]) for i in range(n)]


# ----------------------------------------------------------------------------- streaming session
class Session:
    def __init__(self, transcriber):
        self.t = transcriber
        self.buf = np.zeros(0, dtype=np.int16)
        self.buf_start = 0.0           # absolute time (s) of buf[0]
        self.received = 0.0            # absolute seconds of audio received
        self.last_run = 0.0            # absolute seconds at the last transcription
        self.committed_end = 0.0       # absolute end time of the last committed word
        self.committed_text = []       # committed words (text only, bounded)
        self.prev = []                 # uncommitted hypothesis from the previous run [(abs_s, abs_e, w)]
        self.prompt = ""
        self.hot = ""
        self.silent_since = None       # absolute time silence began, or None
        self.noise_floor = SILENCE_RMS

    # -- audio in --------------------------------------------------------------------------
    def feed(self, pcm: np.ndarray):
        self.buf = np.concatenate([self.buf, pcm])
        start = self.received
        self.received += len(pcm) / RATE
        rms = float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2))) if len(pcm) else 0.0
        # slow adaptive floor (learned from quiet chunks) so a noisy room does not count as speech forever
        if rms < self.noise_floor * 2:
            self.noise_floor = min(SILENCE_RMS * 4, max(SILENCE_RMS, self.noise_floor * 0.95 + rms * 0.05))
        if rms < self.noise_floor * 1.2:
            if self.silent_since is None:
                self.silent_since = start
        else:
            self.silent_since = None
        if len(self.buf) > MAX_BUFFER * RATE:
            self._trim()

    def _trim(self):
        end = self.buf_start + len(self.buf) / RATE
        cut = max(self.committed_end, end - KEEP_AFTER_TRIM)
        if self.prev:                      # never cut into words still being decided
            cut = min(cut, self.prev[0][0] - 0.2)
        cut = max(cut, end - MAX_BUFFER)   # but do keep the buffer bounded
        n = int(max(0.0, cut - self.buf_start) * RATE)
        if n > 0:
            self.buf = self.buf[n:]
            self.buf_start += n / RATE

    # -- decode ----------------------------------------------------------------------------
    def due(self) -> bool:
        return self.received - self.last_run >= STEP and len(self.buf) >= int(0.6 * RATE)

    def silent_tail(self) -> float:
        return (self.received - self.silent_since) if self.silent_since is not None else 0.0

    def step(self):
        """One transcription pass. Returns a list of (type, text) messages to send."""
        self.last_run = self.received
        out = []
        if self.silent_tail() >= SILENCE_FLUSH:
            if self.prev:
                out.append(("final", self._commit(self.prev)))
                self.prev = []
            return out
        words = self.t.transcribe(self.buf, self.context_prompt(), self.hot)
        words = [(s + self.buf_start, e + self.buf_start, w) for s, e, w in words]
        words = [x for x in words if x[1] > self.committed_end + 0.05]
        # LocalAgreement-2: commit the prefix both hypotheses agree on
        k = 0
        while k < len(words) and k < len(self.prev) and norm(words[k][2]) == norm(self.prev[k][2]):
            k += 1
        if k:
            out.append(("final", self._commit(words[:k])))
        self.prev = words[k:]
        if self.prev:
            out.append(("partial", " ".join(w for _, _, w in self.prev)))
        return out

    def flush(self):
        if not self.prev:
            return []
        txt = self._commit(self.prev)
        self.prev = []
        return [("final", txt)]

    def _commit(self, words):
        self.committed_end = max(self.committed_end, words[-1][1])
        self.committed_text = (self.committed_text + [w for _, _, w in words])[-40:]
        return " ".join(w for _, _, w in words)

    def context_prompt(self) -> str:
        # the client's prompt (previous ayah) plus what we already committed, Whisper-style
        tail = " ".join(self.committed_text[-12:])
        return (self.prompt + " " + tail).strip()[-200:]


# ----------------------------------------------------------------------------- server
async def handle(ws, transcriber, token: str):
    q = parse_qs(urlparse(ws.request.path).query)
    if token and q.get("token", [""])[0] != token:
        await ws.send(json.dumps({"type": "error", "message": "bad token"}))
        await ws.close(code=4401, reason="bad token")
        return
    s = Session(transcriber)
    await ws.send(json.dumps({"type": "ready", "model": transcriber.name}))
    loop = asyncio.get_running_loop()
    busy = False

    async def run_step():
        nonlocal busy
        busy = True
        try:
            msgs = await loop.run_in_executor(None, s.step)
            for typ, text in msgs:
                await ws.send(json.dumps({"type": typ, "text": text}, ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            log.exception("step failed")
            await ws.send(json.dumps({"type": "error", "message": str(e)[:200]}))
        finally:
            busy = False

    task = None
    try:
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                pcm = np.frombuffer(bytes(msg), dtype="<i2")
                if len(pcm):
                    s.feed(pcm)
                if not busy and (s.due() or (s.prev and s.silent_tail() >= SILENCE_FLUSH)):
                    task = asyncio.create_task(run_step())
            else:
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                if m.get("type") == "ctx":
                    s.prompt = str(m.get("prompt", ""))[:300]
                    s.hot = str(m.get("hot", ""))[:600]
                elif m.get("type") == "stop":
                    if task:
                        await task
                    for typ, text in s.flush():
                        await ws.send(json.dumps({"type": typ, "text": text}, ensure_ascii=False))
                    await ws.close()
                    return
    except websockets.ConnectionClosed:
        pass
    finally:
        if task and not task.done():
            task.cancel()


def process_request(connection, request):
    """Plain HTTP on the same port: health check for Caddy / humans."""
    if request.path.split("?")[0] in ("/", "/health"):
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return connection.respond(HTTPStatus.OK, "ok\n")
    return None


def build_transcriber():
    if os.environ.get("ASR_FAKE") == "1":
        return FakeTranscriber()
    model = os.environ.get("ASR_MODEL", "tarteel-ai/whisper-base-ar-quran")
    threads = int(os.environ.get("ASR_THREADS", "0")) or max(1, (os.cpu_count() or 2) - 0)
    log.info("loading %s with %d threads", model, threads)
    return FasterWhisperTranscriber(model, threads)


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    transcriber = build_transcriber()
    token = os.environ.get("ASR_TOKEN", "")
    port = int(os.environ.get("ASR_PORT", "8765"))
    log.info("listening on :%d (token %s)", port, "set" if token else "NOT set")
    async with serve(lambda ws: handle(ws, transcriber, token), "0.0.0.0", port,
                     process_request=process_request, max_size=2**20, ping_interval=20):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
