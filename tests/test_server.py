"""Streaming-policy and protocol tests for server/asr_server.py. No model needed:
   python3 tests/test_server.py   (needs: pip install numpy websockets)"""
import asyncio, json, os, subprocess, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import asr_server as A

passed = failed = 0
def t(name, got, want):
    global passed, failed
    ok = got == want; passed += ok; failed += (not ok)
    print(f"{'PASS' if ok else 'FAIL'} {name} → {got!r}" + ("" if ok else f" (want {want!r})"))

def tone(sec, amp=3000):
    n = int(sec * A.RATE); x = np.arange(n)
    return (amp * np.sin(2 * np.pi * 220 * x / A.RATE)).astype(np.int16)
def silence(sec): return np.zeros(int(sec * A.RATE), dtype=np.int16)

# ---- LocalAgreement commits what two passes agree on ----
s = A.Session(A.FakeTranscriber())
s.feed(tone(1.0)); t("due after 1s", s.due(), True)
m1 = s.step()                                   # hears 2 words, nothing to agree with yet
t("first pass: partial only", [k for k, _ in m1], ["partial"])
t("first pass partial text", m1[0][1], "الحمد لله")
s.feed(tone(0.5)); m2 = s.step()                # hears 3 words: first 2 agree → final
t("second pass commits agreed prefix", m2[0], ("final", "الحمد لله"))
t("second pass partial is the tail", m2[1], ("partial", "رب"))
s.feed(tone(0.5)); m3 = s.step()
t("third pass commits next word", m3[0], ("final", "رب"))
t("committed_end advances", round(s.committed_end, 2), 1.45)
t("prompt carries committed text", s.context_prompt().endswith("الحمد لله رب"), True)

# ---- a pause commits the pending tail ----
s.feed(silence(1.3)); t("silence detected", s.silent_tail() >= A.SILENCE_FLUSH, True)
m4 = s.step()
t("pause flushes pending words", m4, [("final", "العالمين")])
t("nothing pending after flush", s.prev, [])

# ---- the buffer stays bounded and never cuts pending words ----
s2 = A.Session(A.FakeTranscriber())
for _ in range(30): s2.feed(tone(0.5))
t("buffer bounded", len(s2.buf) <= A.MAX_BUFFER * A.RATE, True)
t("buffer start moved", s2.buf_start > 0, True)
s2.step(); s2.feed(tone(0.5)); s2.step()
t("still produces words after trim", len(s2.prev) > 0 or s2.committed_text != [], True)

# ---- norm ----
t("norm unifies spelling", A.norm("ٱلْحَمْدُ") == A.norm("الحمد"), True)
t("norm drops hamza/alef", A.norm("إِيَّاكَ"), "يك")

# ---- end to end over a real WebSocket with the fake model ----
async def e2e():
    import websockets
    port = 8799
    env = dict(os.environ, ASR_FAKE="1", ASR_PORT=str(port), ASR_TOKEN="secret")
    proc = subprocess.Popen([sys.executable, os.path.join("server", "asr_server.py")], env=env,
                            cwd=os.path.join(os.path.dirname(__file__), ".."), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                async with websockets.connect(f"ws://127.0.0.1:{port}/ws?token=secret") as ws:
                    break
            except OSError:
                await asyncio.sleep(0.1)
        got = []
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws?token=bad") as ws:
            got.append(json.loads(await ws.recv())["type"])
        t("bad token rejected", got, ["error"])
        got = []
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws?token=secret") as ws:
            t("ready message", json.loads(await ws.recv()), {"type": "ready", "model": "fake"})
            await ws.send(json.dumps({"type": "ctx", "prompt": "بسم الله الرحمن الرحيم", "hot": "الحمد لله"}))
            for _ in range(4):
                await ws.send(tone(0.5).tobytes()); await asyncio.sleep(0.15)
            await ws.send(json.dumps({"type": "stop"}))
            async for m in ws:
                got.append(json.loads(m))
        types = [m["type"] for m in got]
        t("e2e got partials and finals", ("partial" in types, "final" in types), (True, True))
        finals = " ".join(m["text"] for m in got if m["type"] == "final")
        t("e2e finals are the script prefix", finals.startswith("الحمد لله"), True)
        import urllib.request
        t("health endpoint", urllib.request.urlopen(f"http://127.0.0.1:{port}/health").read(), b"ok\n")
    finally:
        proc.terminate()
asyncio.run(e2e())

print(f"{passed} pass {failed} fail"); sys.exit(1 if failed else 0)
