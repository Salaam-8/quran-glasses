# مصحف النظارة: Quran Glasses Reader (handoff)

A full-Quran reader for AR glasses, used while praying. It shows Uthmani text on a pure-black stage. Black pixels render as transparent on the glasses' birdbath optics, so only the verses glow and the room stays visible. The reader can follow the reciter's voice, highlight the current ayah and word, and turn pages by itself. Surahs can be picked from inside the glasses.

Owner: Salo. Personal project, not work for his employer.
Hardware: **VITURE Pro 2** (birdbath optics, 3DoF IMU, no camera, no onboard computer). It is a wired display over USB-C and needs a host: a laptop, or a phone with DisplayPort Alt Mode.

---

## Repository layout

```
src/template.html     UI, styles and app logic (placeholders get filled by build.py)
src/engine.js         recitation matcher: speech text → position in the Quran (pure JS, also runs in Node)
data/quran.json       Uthmani text, 114 surahs / 6236 ayahs (npm quran-json@3.1.2, CC-BY-4.0, text from QuranEnc)
assets/               Amiri Quran woff2 (SIL OFL), app icons
build.py              builds dist/ (standard library only)
tests/test_engine.js  26 matcher tests against the real text (node, no deps)
tests/test_browser.js 17 end-to-end tests, desktop + emulated phone (needs playwright)
dist/                 build output (committed so GitHub Pages can serve dist/app)
```

Build: `py build.py` on Windows, or `python3 build.py`.
Test: `node tests/test_engine.js` and `npm i && npx playwright install chromium && node tests/test_browser.js`.

Outputs:
- `dist/quran-glasses.html`: a single self-contained file of about 1.4 MB. It embeds the text, the font and the engine.
- `dist/app/`: an installable PWA (manifest with fullscreen + landscape, service worker, icons). It must be served over **HTTPS**, or the mic won't work.

---

## What works (verified)

| Feature | How | Verified |
|---|---|---|
| Full text, Uthmani, offline | data + font embedded | 114/6236 asserted in build; render checked visually |
| Display options | font size, vertical position, brightness, color, ayahs per page | manual |
| Glasses mode | `G` key / button: hides UI, fullscreen, wake lock; phones lock landscape | browser test |
| Voice tracking | Web Speech API (`ar-SA`, continuous, interim) → `Engine.locate()` | 26 engine tests use typed text, not real audio |
| Ayah/word highlight | current ayah full brightness, others dimmed; current word green + underlined | browser test |
| Auto page turn | when the recited ayah is the last one on the page, the page rebases to it | browser test |
| Find position anywhere | recite from anywhere and the engine locates you, even across surahs | engine + browser tests |
| Voice command | «سورة الكهف» opens a surah (fuzzy name match; An-Nur 24:1 is not misread as a command) | tests |
| Surah picker in glasses | `S` / `.` / `B` opens it; arrows / PageUp / PageDown move; digits jump; Enter opens | browser test |
| Manual paging any time | ← / Space / PageDown = next, → / PageUp = prev; voice resumes from the new page | browser test |
| Phone touch | tap left 30% = next, right 30% = prev, swipe right = next, swipe left = prev, long-press = surah list, center tap = on-screen buttons (exit / surahs / mic) | emulated Pixel 7 |
| Posture auto-hide | text hides when the head drops (ruku/sujood) and returns at qiyam; calibration button | **simulation slider only** |

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

1. **Host the PWA on GitHub Pages.** Create the repo `quran-glasses`, push, then Settings → Pages → deploy from branch `main`, folder `/dist/app`. If the Pages UI only offers `/` or `/docs`, use a GitHub Actions workflow that publishes `dist/app`. Bump `CACHE` in the service worker on every deploy.
2. **Glasses IMU is not connected.** The hook is ready: `window.QuranGlasses.pushPose({ pitch })`, with pitch in degrees (0 = looking ahead, negative = head down). The VITURE browser SDK (TypeScript over WASM, via WebHID, Chrome only) is not on npm, and its docs aren't public. Get it from VITURE's developer portal: https://www.viture.com/developer/glasses-sdk/glasses. VITURE USB vendor ID is `0x35CA`, and the Pro 2 is a "Gen2" device. WebHID is desktop Chrome only, so on phones the IMU needs a native app.
3. **Glasses buttons.** Unknown whether the Pro 2 volume rocker sends key events to the host. Test it with `addEventListener('keydown', e => console.log(e.code, e.key))` while pressing the buttons. Don't use the 2D/3D button: it switches the display to side-by-side mode. In a native Android app, the volume keys or the SDK state stream could work as page turns.
4. **Real-world speech accuracy is untested.** Chrome's Web Speech sends audio to Google, so it needs internet. A corporate proxy may block it, and tajweed and madd may lower accuracy. If accuracy is poor, consider on-device `tarteel-ai/whisper-base-ar-quran` (Apache-2.0, reported WER about 5.75%).
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
