# مصحف النظارة: Quran Glasses Reader (handoff)

A full-Quran reader for AR glasses, used while praying. It shows Uthmani text on a pure-black stage. Black pixels render as transparent on the glasses' birdbath optics, so only the verses glow and the room stays visible. The reader can follow the reciter's voice, highlight the current ayah and word, and turn pages by itself. Surahs can be picked from inside the glasses.

Owner: Salo. Personal project, not work for his employer.
Hardware: the owner calls them **VITURE Pro 2**, but over USB they enumerate as `35CA:101D` = **VITURE Pro (Gen1)**, the exact device the viture-webxr-extension driver was confirmed on. Birdbath optics, 3DoF IMU, no camera, no onboard computer. It is a wired display over USB-C and needs a host: a laptop, or a phone with DisplayPort Alt Mode.

---

## Repository layout

```
src/template.html     UI, styles and app logic (placeholders get filled by build.py)
src/engine.js         recitation matcher: speech text → position in the Quran (pure JS, also runs in Node)
src/viture.js         VITURE glasses IMU over WebHID, no vendor SDK (Gen2 = Pro 2, Gen1 fallback; pure parts run in Node)
data/quran.json       Uthmani text, 114 surahs / 6236 ayahs (npm quran-json@3.1.2, CC-BY-4.0, text from QuranEnc)
assets/               Amiri Quran woff2 (SIL OFL), app icons, vendored Azure Speech SDK (MIT)
build.py              builds dist/ (standard library only)
tests/test_engine.js  34 matcher tests against the real text (node, no deps)
tests/test_viture.js  38 IMU driver tests: byte-exact frames, quaternion → head angle (node, no deps)
tests/test_server.py  21 checks of the self-hosted ASR server's streaming policy and protocol (python, numpy + websockets)
server/               self-hosted Quran ASR server (faster-whisper + websockets), Docker + Caddy, Oracle setup guide
tests/test_browser.js 33 end-to-end tests, desktop + emulated phone (needs playwright)
dist/                 build output (committed so GitHub Pages can serve dist/app)
```

Build: `py build.py` on Windows, or `python3 build.py`.
Test: `node tests/test_engine.js`, `node tests/test_viture.js`, `python3 tests/test_server.py` and `npm i && npx playwright install chromium && node tests/test_browser.js`.

Outputs:
- `dist/quran-glasses.html`: a single self-contained file of about 1.4 MB. It embeds the text, the font and the engine.
- `dist/app/`: an installable PWA (manifest with fullscreen + landscape, service worker, icons). It must be served over **HTTPS**, or the mic won't work.

---

## What works (verified)

| Feature | How | Verified |
|---|---|---|
| Full text, Uthmani, offline | data + font embedded | 114/6236 asserted in build; render checked visually |
| Display options | font size, vertical position, brightness, color, ayahs per page; «استعادة الافتراضي» resets them. The font auto-shrinks (`--fit`) so the page never overflows the top of the stage, whatever the sliders say | manual + headless worst-case check |
| Glasses mode | `G` key / button: hides UI, fullscreen, wake lock; phones lock landscape | browser test |
| Voice tracking | Web Speech API (`ar-SA`, continuous, interim) or Azure Speech streaming (user's own key) → `Engine.locate()` | engine tests use typed text; Azure path mocked in browser test |
| Ayah/word highlight | current ayah full brightness, others dimmed; current word green + underlined | browser test |
| Auto page turn | when the recited ayah is the last one on the page, the page rebases to it | browser test |
| Find position anywhere | recite from anywhere and the engine locates you, even across surahs | engine + browser tests |
| Voice command | «سورة الكهف» opens a surah (fuzzy name match; An-Nur 24:1 is not misread as a command) | tests |
| Surah picker in glasses | `S` / `.` / `B` opens it; full list of 114 scrolls by touch or wheel-free keyboard; search box filters by name or number; arrows / PageUp / PageDown move; digits jump; Enter opens | browser test |
| Manual paging any time | ← / Space / PageDown = next, → / PageUp = prev; voice resumes from the new page | browser test |
| Phone touch | tap left 30% = next, right 30% = prev, swipe right = next, swipe left = prev, long-press = surah list, center tap = on-screen buttons (exit / surahs / mic) | emulated Pixel 7 |
| Posture auto-hide | text hides when the head drops (ruku/sujood) and returns at qiyam; calibration button. The sensor only hides the page in glasses mode (G): with the bar visible you are configuring on the laptop and looking down, so the page stays readable and the chip says «يُخفى في وضع النظارة فقط». The simulation slider hides in any mode | simulation slider + synthetic IMU frame in browser test |
| Glasses IMU | «ربط حساس النظارة» button → WebHID chooser → pose stream 120 Hz → head angle → posture engine. Auto-reconnects on reload. | real Pro 2: connect + stream verified; posture via teach-in |

### Matcher design (src/engine.js)
- Normalize: strip tashkeel and Quranic marks; unify ٱأإآ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي. The "key" also drops ا and ء, so dagger-alef and hamza spelling differences between Uthmani and plain dictation disappear.
- Word similarity: Levenshtein ratio, matched at ≥0.6.
- Smith-Waterman local alignment of the last 8 spoken words:
  - `local`: near the cursor (−6 / +40 words).
  - `lost`: on a final-result miss. Compares the best place in the current surah with the best in the whole Quran. It needs a score threshold, and a margin over the second-best place more than 12 words away, so repeated phrases like «فبأي آلاء ربكما تكذبان» or 2:255 vs 3:2 don't cause jumps.
- A basmala alone never triggers a jump (1:1 and the end of 27:30 are excluded).
- A whole-Quran search takes about 65 ms.

---

## Not done / open items (priority order)

1. ~~Host the PWA on GitHub Pages.~~ **Done (2026-10-29).** Private repo `Salaam-8/quran-glasses`, published by `.github/workflows/pages.yml` (Pages source = GitHub Actions) on every push to `main`. Live: https://salaam-8.github.io/quran-glasses/ ; manifest and sw.js verified 200 in Chrome. Bump `CACHE` in `build.py` on every deploy (now v18).
2. **Glasses IMU: implemented, needs a real-device check.** `src/viture.js` talks to the glasses over WebHID
   without the vendor SDK (its browser build has no public download). Protocol sources:
   - Gen2 / Pro 2 (`35CA:1301`): https://github.com/elasticjava/viture-v2/blob/main/PROTOCOL.md — one HID interface,
     frame `0x0010 | msgid | len | byte-sum | payload` (LE). We send `10 00 01 03 02 00 03 00 01 02` (pose stream, 120 Hz)
     and parse `0x7308` pose events (u32, u32 tick, f32 qw qx qy qz). Nothing else is needed.
   - Gen1 (One / Pro / Luma): https://github.com/bfvogel/viture-webxr-extension (0xFF 0xFC euler frames, CRC-16 commands). Untested.
   **Verified on the real Pro 2 (2026-10-29):** WebHID chooser, connect, 120 Hz pose stream all work.
   The documented frame (−Z forward, Y up) turned out wrong for this device: the "gaze" angle reacted to turning
   left/right instead of nodding. Fix: «تعليم حركة السجود» (teach-in). Press while looking ahead, drop the head within
   4 s; `VitureIMU.learnNod(qA, qB)` takes the nod axis from the body-frame rotation between the two poses, and
   `nodPitch(q, nod)` is the twist about that axis since the reference (0 = qiyam, negative = head down). This is
   frame-agnostic and immune to turning and to yaw drift (unit tests: turn 80° then nod 25° → −25°). Stored in
   `localStorage` as `S.nod`; «معايرة وضع القيام» afterwards only re-captures the reference pose.
   **The user's glasses enumerate as a Gen1 device** (name shows «VITURE Pro», not «Pro 2»): Gen1 PID, `0xFF 0xFC`
   Euler frames, no quaternion. So the teach-in also has a Euler mode (`kind: "e"`): it picks the Euler angle that moved
   most between the two poses, signed so head-down is negative, with the reference value as zero. The status line now
   shows `name · pid(hex) · GenN` for diagnosis.
   Fallbacks remain in the «محور الميلان» select (gaze / X / Y / Z) with «عكس الإشارة»; the row shows live angles.
   If the status says «ما وصلت قراءات», the glasses may be held by another app (VITURE SpaceWalker / Immersive 3D) — close it.
   WebHID is desktop Chrome only; on phones the IMU still needs a native app.
   Still open: does the learned mapping hold through a full rak'ah (ruku ≈ −60°+, sujood ≈ −90°) and is the 20°/35° band right?
3. **Glasses buttons.** Unknown whether the Pro 2 volume rocker sends key events to the host. Test it with `addEventListener('keydown', e => console.log(e.code, e.key))` while pressing the buttons. Don't use the 2D/3D button: it switches the display to side-by-side mode. In a native Android app, the volume keys or the SDK state stream could work as page turns.
4. **Real-world speech: works on a Galaxy S24 Ultra in Chrome (2026-10-29)**, but the owner reported lag and
   fragility in noise. Changes made in response (all unit-tested in `tests/test_engine.js`):
   - Interim fast path: 1–2 heard words that equal one of the next three expected words move the highlight at once
     (before, two aligned words were required, so the highlight waited for the recogniser's second word).
   - N-best: `maxAlternatives = 3`; for final results `Engine.bestAlternative()` keeps the alternative that aligns
     best near the cursor. Google's first guess for Quranic wording is often the wrong homophone.
   - Distance prior in local mode: matches more than 10 words past the cursor lose 0.08/word, so a noisy phrase that
     echoes common words ahead no longer jumps the cursor.
   - Lost (whole-Quran) search now needs two consecutive misses, or one miss with ≥5 heard words.
   - Recognition restart gap after `onend` cut from 250 ms to 50 ms (Android ends recognition after every pause).
   - Predictive nudge: the pace (words/s) is measured between real recogniser updates; while waiting for the next
     update the `.now` word advances at `S.lead`% (slider «استباق التحديد», default 80, up to 150) of that pace, at most
     2 words (3 above 100%) and never past the current ayah, then snaps to the real position. Word highlight CSS transitions removed. The owner still felt a slight lag before this change.
   **Cloud engine (2026-10-29):** «محرك الصوت» select → *Azure سحابي*. `assets/azure-speech.js` is the vendored
   Microsoft Speech SDK 1.52.0 browser bundle (MIT, `assets/LICENSE-azure-speech-sdk.txt`), copied to `dist/` and
   `dist/app/` by `build.py` and loaded lazily. The browser streams the mic straight to Azure (`ar-SA`, Detailed
   output → NBest → `Engine.bestAlternative`, segmentation silence 400 ms, end silence 600 ms) in one continuous
   session: no Android restart beep, partials every few hundred ms, works in Samsung Internet and iOS Safari too.
   A `PhraseListGrammar` is refreshed with the words and full text of the current + next 3 ayahs whenever the position
   changes. The key + region live only in that browser's `localStorage` (`S.azKey`, `S.azRegion`, default
   `uaenorth`); setup steps (Free F0 tier, 5 h/month) are in the in-app help panel. **Not yet verified with a real
   key** (this session had no Azure access); the wiring is covered by a browser test with a mocked SDK.
   **Self-hosted engine (2026-10-29):** `server/` = `asr_server.py` (Python, `websockets`), Dockerfile, docker-compose
   with Caddy (auto-HTTPS), `.env.example`, and `README.md` with the Oracle Cloud Always-Free + DuckDNS walkthrough in
   Arabic. Model: `tarteel-ai/whisper-base-ar-quran` converted to CTranslate2 int8 on first start (entrypoint.sh) and run
   with faster-whisper on CPU (word timestamps, VAD, `initial_prompt` = previous ayah + committed text, `hotwords` =
   next ayahs). Streaming policy = LocalAgreement-2 over a 9 s rolling buffer re-decoded every 0.5 s; a 1.2 s pause
   flushes pending words. Protocol in the file header. The app's «سيرفر قرآني» engine captures the mic with an
   AudioWorklet (resampled to 16 kHz int16, 100 ms frames) and streams it over `wss://host/ws?token=…`, sending `ctx`
   messages as the position moves. Tests: `tests/test_server.py` (policy + real WebSocket round trip with a scripted
   model, 21 checks) and a browser test that streams real (fake-device) audio to a fake server. **The real model has not
   run in this session** (model hosts unreachable here): first real run is on the owner's Oracle box. Expected: accuracy
   well above Google on recitation, latency ~0.7–1.2 s on 4 ARM cores (decode of ≤9 s window ≈ 0.3–0.6 s); try
   `whisper-tiny-ar-quran` if too slow. Ideas if latency must drop further: smaller `MAX_BUFFER`, decode only since the
   last committed word, or a CTC acoustic model with online forced alignment to the known text.
   Alternatives considered: Google Cloud STT streaming needs a relay server (no browser SDK); Deepgram has no streaming
   Arabic; in-browser Whisper/Vosk is too slow or has no small Arabic model. The real low-latency design would be
   forced alignment against the known text with a local CTC acoustic model — a research-sized task.
   Still inherent for the browser engine: Chrome sends audio to Google, so ~0.5–1 s latency and a start beep on Android remain. Next step
   if still not good enough: on-device `tarteel-ai/whisper-base-ar-quran` (Apache-2.0, WER ≈ 5.75%) in a native app,
   or lowering `sim` thresholds after collecting real transcripts (log `#heard` text during a real session).
5. Android Chrome may play a sound each time recognition restarts. iOS Safari speech support is limited. Check both on real devices.
6. Threshold tuning: posture bands (show within −20°, hide below −35° of the calibrated qiyam angle) and the matcher scores need real-world data.

## Product direction (discussed, not started)
- Phase 1: native Android app (Kotlin; matcher in C++ via NDK; R8 obfuscation) for existing glasses.
- Phase 2: glasses + activation code bundle.
- Phase 3: own-brand glasses via a white-label manufacturer, preferably with waveguide optics.
- Closed source: a signed license (e.g. Ed25519) bound to the glasses' serial number, if the SDK exposes one; verified offline.
- Before selling:
  - Confirm the Quran-text licensing.
  - Check whether King Fahd Complex or the Ministry of Islamic Affairs must review the product.
  - Get a formal fatwa on reading from a screen in prayer.
  - Register the trademark with SAIP.
  - Check his employment contract's IP clause.

## Developer environment (Salo)
- Windows, Python 3.14 run as `py` (not `python`); install packages with `py -m pip install`.
- Behind a corporate SSL-inspection proxy: Python HTTPS needs `truststore.inject_into_ssl()`, and npm/git may need the proxy CA.
- Local mic testing: `cd dist && py -m http.server 8000`, then open `http://localhost:8000/quran-glasses.html` in Chrome. Mic and speech don't work from `file://`.

## Conventions
- UI language Arabic (RTL). The stage background must stay `#000` (transparency on the glasses).
- Keep `dist/quran-glasses.html` a single offline file. No external runtime dependencies except Google Fonts, which is optional because the font is embedded.
- Settings persist in `localStorage` key `qg` (per device).
