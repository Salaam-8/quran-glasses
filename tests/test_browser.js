// End-to-end checks in headless Chromium (needs: npm i -D playwright && npx playwright install chromium)
// Run after `py build.py`:  node tests/test_browser.js
const { chromium, devices } = require("playwright");
const { WebSocketServer } = require("ws");
const License = require("../src/license.js");
const DEV_KEY = require("../tools/dev-license-key.json");
const issue = (device, plan, addons, days) => {
  const now = Math.floor(Date.now() / 1000);
  return License.sign({ v: 1, d: License.formatId(device), p: plan, f: addons, i: now, e: now + days * 86400, n: "t" }, DEV_KEY.secretKey);
};
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "dist", "app");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const f = path.join(APP, req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1)));
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(buf);
  });
});

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} → ${got}${ok ? "" : ` (want ${want})`}`);
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

  // ---- desktop: voice tracking (simulated text), commands, picker, keys ----
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
    await p.evaluate(() => { S.top = 90; applyLook(); render(); });     // tall limit: whole-ayah pages for the tests below
    const head = () => p.textContent(".head");
    t("starts at Fatiha", await head(), "سورة الفاتحة · الآيات ١–٣ من ٧");
    await p.evaluate(() => QuranGlasses.hear("الحمد لله رب العالمين"));
    t("highlights 1:2", await p.evaluate(() => document.querySelector(".ay.cur")?.dataset.a), "2");
    // while waiting for the recogniser, the highlight nudges forward at the measured pace but never leaves the ayah
    await p.evaluate(() => { QuranGlasses.hear("الحمد لله"); listening = true; lastReal.t = performance.now() - 1200; }); await p.waitForTimeout(300);
    t("predictive nudge stays in ayah", await p.evaluate(() => { const w = document.querySelector(".w.now"); return [w?.closest(".ay").dataset.a, +w?.dataset.i - lastReal.idx]; }), ["2", 1]);
    await p.evaluate(() => { listening = false; });
    await p.evaluate(() => QuranGlasses.hear("الرحمن الرحيم مالك يوم الدين"));
    t("auto page turn", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    await p.evaluate(() => QuranGlasses.hear("سورة الكهف"));
    t("voice command surah", await head(), "سورة الكهف · الآيات ١–٣ من ١١٠");
    await p.evaluate(() => { QuranGlasses.hear("تبارك الذي بيده الملك وهو على كل شيء قدير"); QuranGlasses.hear("تبارك الذي بيده الملك وهو على كل شيء قدير"); });
    t("default scope never leaves the surah", await head(), "سورة الكهف · الآيات ١–٣ من ١١٠");
    await p.evaluate(() => { S.scope = "all"; applyLook(); QuranGlasses.hear("تبارك الذي بيده الملك وهو على كل شيء قدير"); });
    t("far jump held until a second final", await head(), "سورة الكهف · الآيات ١–٣ من ١١٠");
    await p.evaluate(() => QuranGlasses.hear("تبارك الذي بيده الملك وهو على كل شيء قدير"));
    t("finds another surah by recitation", await head(), "سورة الملك · الآيات ١–٣ من ٣٠");
    t("big jump offers undo", await p.textContent("#toastBtn"), "رجوع");
    await p.click("#toastBtn"); t("undo returns to the previous place", await head(), "سورة الكهف · الآيات ١–٣ من ١١٠");
    await p.evaluate(() => { S.scope = "surah"; applyLook(); });
    await p.keyboard.press("KeyS"); await p.keyboard.press("Digit3"); await p.keyboard.press("Digit6");
    t("picker by number", (await p.textContent(".picker .sel")).includes("يس"), true);
    await p.keyboard.press("Enter");
    t("picker opens surah", await head(), "سورة يس · الآيات ١–٣ من ٨٣");
    t("picker closed", await p.isVisible("#picker"), false);
    await p.keyboard.press("KeyS"); await p.fill(".picker .q", "كهف");
    t("picker search by name", await p.evaluate(() => [...document.querySelectorAll(".picker button[data-n]")].map(b => +b.dataset.n)), [18]);
    await p.fill(".picker .q", "11"); 
    t("picker search by number prefix", await p.evaluate(() => [...document.querySelectorAll(".picker button[data-n]")].map(b => +b.dataset.n)), [11, 110, 111, 112, 113, 114]);
    await p.press(".picker .q", "Enter"); t("picker search opens first match", await head(), "سورة هود · الآيات ١–٣ من ١٢٣");
    await p.keyboard.press("PageDown");
    t("PageDown next page", await head(), "سورة هود · الآيات ٤–٦ من ١٢٣");
    // glasses IMU: feed a synthetic Gen2 pose frame (head down 40°) straight into the WebHID handler
    const imuPitch = await p.evaluate(() => {
      const imu = QuranGlasses.imu; imu.gen = 2;
      const h = -40 * Math.PI / 360, q = [Math.cos(h), Math.sin(h), 0, 0];
      const pl = new Uint8Array(24), dv = new DataView(pl.buffer); q.forEach((v, i) => dv.setFloat32(8 + 4 * i, v, true));
      const f = new Uint8Array(64); f.set(VitureIMU.gen2Frame(0x7308, pl));
      imu._onReport({ data: new DataView(f.buffer) });
      return document.getElementById("pitchv").textContent + " " + document.getElementById("src").textContent;
    });
    t("IMU frame drives posture", imuPitch, "-40° المصدر: حساس النظارة");
    // posture: outside glasses mode the sensor must not hide the page (you are configuring, looking down)
    for (let k = 0; k < 6; k++) { await p.evaluate(() => QuranGlasses.pushPose({ pitch: -80 })); await p.waitForTimeout(100); }
    t("sensor head-down keeps text while configuring", await p.evaluate(() => [document.getElementById("text").classList.contains("off"), document.getElementById("state").textContent]),
      [false, "ركوع/سجود · يُخفى في وضع النظارة فقط"]);
    t("sensor head-down hides text in glasses mode", await p.evaluate(() => { document.body.classList.add("focus-mode"); applyHide(); const r = document.getElementById("text").classList.contains("off"); document.body.classList.remove("focus-mode"); applyHide(); return r; }), true);
    for (let k = 0; k < 6; k++) { await p.evaluate(() => QuranGlasses.pushPose({ pitch: 0 })); await p.waitForTimeout(100); }
    t("sensor head-up shows text again", await p.textContent("#state"), "قيام · النص ظاهر");
    // cloud engine: wire-up check with a mocked Azure SDK (partials, n-best finals, phrase bias)
    const azr = await p.evaluate(async () => {
      const calls = { phrases: 0, started: false };
      window.SpeechSDK = {
        OutputFormat: { Detailed: 1 }, ResultReason: { RecognizedSpeech: 3 }, CancellationReason: { Error: 1 },
        PropertyId: { Speech_SegmentationSilenceTimeoutMs: "a", SpeechServiceConnection_EndSilenceTimeoutMs: "b" },
        SpeechConfig: { fromSubscription: (k, r) => ({ k, r, setProperty() {} }) },
        AudioConfig: { fromDefaultMicrophoneInput: () => ({}) },
        PhraseListGrammar: { fromRecognizer: () => ({ clear() {}, addPhrase() { calls.phrases++; } }) },
        SpeechRecognizer: class { constructor(c) { this.c = c; window.__az = this; } startContinuousRecognitionAsync(ok) { calls.started = true; this.sessionStarted?.(); ok(); } stopContinuousRecognitionAsync(ok) { ok(); } close() {} }
      };
      S.engine = "azure"; S.azKey = "test-key"; S.azRegion = "uaenorth"; applyLook();
      QuranGlasses.goto(1, 1); startMic(); await new Promise(r => setTimeout(r, 50));
      const r = window.__az;
      r.recognizing(null, { result: { text: "الحمد لله" } });
      const partial = document.querySelector(".ay.cur")?.dataset.a;
      r.recognized(null, { result: { reason: 3, text: "الرحمن الرجيم", json: JSON.stringify({ NBest: [{ Lexical: "الرحمن الرجيم" }, { Lexical: "الرحمن الرحيم مالك يوم الدين" }] }) } });
      const final = document.querySelector(".ay.cur")?.dataset.a;
      const state = document.getElementById("micState").textContent;
      stopMic(); S.engine = "browser"; applyLook(); delete window.SpeechSDK;
      return { region: r.c.r, lang: r.c.speechRecognitionLanguage, started: calls.started, phrases: calls.phrases > 10, partial, final, state };
    });
    t("azure engine wiring", azr, { region: "uaenorth", lang: "ar-SA", started: true, phrases: true, partial: "2", final: "4", state: "يستمع… (Azure)" });
    // self-hosted engine: real mic capture (fake device) streamed to a fake ASR WebSocket server
    const wss = new WebSocketServer({ port: 0 }); const wsPort = wss.address().port;
    const seen = { ctx: null, audio: 0, stop: false, sent: false, url: "" };
    wss.on("connection", (sock, req) => {
      seen.url = req.url; sock.send(JSON.stringify({ type: "ready", model: "fake" }));
      sock.on("message", (data, isBinary) => {
        if (isBinary) { seen.audio += data.length; if (seen.audio > 3200 && !seen.sent) { seen.sent = true; sock.send(JSON.stringify({ type: "partial", text: "الحمد لله" })); sock.send(JSON.stringify({ type: "final", text: "الحمد لله رب العالمين" })); } }
        else { const m = JSON.parse(data.toString()); if (m.type === "ctx") seen.ctx = m; if (m.type === "stop") seen.stop = true; }
      });
    });
    await p.evaluate(port => { S.engine = "server"; S.srvUrl = "http://localhost:" + port; S.srvToken = "tok"; applyLook(); QuranGlasses.goto(1, 1); startMic(); }, wsPort);
    await p.waitForTimeout(1500);
    const srvState = await p.evaluate(() => [document.getElementById("micState").textContent, document.querySelector(".ay.cur")?.dataset.a]);
    t("server engine streams 16 kHz audio", seen.audio > 3200, true);
    t("server engine sends ayah context", !!seen.ctx && seen.ctx.hot.includes("الحمد"), true);
    t("server engine url carries token", seen.url, "/ws?token=tok");
    t("server engine results drive highlight", srvState, ["يستمع… (السيرفر)", "2"]);
    await p.evaluate(() => { stopMic(); S.engine = "browser"; applyLook(); }); await p.waitForTimeout(500);
    t("server engine sends stop", seen.stop, true);
    wss.close();
    // top limit: the page never crosses the limit line; long content continues on the next page by rendered lines
    const split = await p.evaluate(() => {
      S.size = 60; S.top = 55; S.per = 3; applyLook(); QuranGlasses.goto(2, 255);   // Ayat al-Kursi: long ayah
      const st = document.getElementById("stage").getBoundingClientRect(), tx = document.getElementById("text").getBoundingClientRect();
      const limitY = st.bottom - st.height * S.top / 100;
      const first = { a: S.a, w: S.w, pe: { ...PE }, head: document.querySelector(".head").textContent, under: tx.top >= limitY - 1, cont: !!document.querySelector(".cont") };
      page(1); const second = { a: S.a, w: S.w, cont: !!document.querySelector(".cont"), head: document.querySelector(".head").textContent };
      const tx2 = document.getElementById("text").getBoundingClientRect();
      page(-1); const back = { a: S.a, w: S.w };
      return { first, second, under2: tx2.top >= limitY - 1, back };
    });
    t("top limit: first page stays under the line", split.first.under, true);
    t("top limit: first page is cut mid-ayah", split.first.pe.w > 0 && split.first.head.includes("…"), true);
    t("top limit: next page continues at the cut", [split.second.a, split.second.w, split.second.cont], [split.first.pe.a, split.first.pe.w, true]);
    t("top limit: second page under the line", split.under2, true);
    t("top limit: previous page returns to the start", split.back, { a: 255, w: 0 });
    t("top limit: guide line shows in simulation", await p.evaluate(() => { onPitch(-15, "محاكاة"); return getComputedStyle(document.getElementById("toplimit")).display; }), "block");
    t("top limit: guide hidden with the sensor", await p.evaluate(() => { QuranGlasses.pushPose({ pitch: -15 }); return getComputedStyle(document.getElementById("toplimit")).display; }), "none");
    await p.evaluate(() => { Object.assign(S, LOOK_DEFAULTS); S.top = 90; applyLook(); QuranGlasses.goto(1, 1); });
    // voice control: توقف freezes and saves, استمر returns and continues, ارجع undoes a jump; P / Backspace do the same
    await p.evaluate(() => { S.scope = "surah"; applyLook(); QuranGlasses.goto(1, 1); QuranGlasses.hear("الحمد لله رب العالمين"); });
    await p.evaluate(() => QuranGlasses.hear("توقف"));
    t("توقف freezes tracking", await p.evaluate(() => [paused, document.getElementById("micState").textContent.includes("متوقف"), JSON.parse(localStorage.getItem("qg")).saved.a]), [true, true, 1]);
    await p.evaluate(() => QuranGlasses.hear("الرحمن الرحيم مالك يوم الدين"));
    t("recitation ignored while paused", await head(), "سورة الفاتحة · الآيات ١–٣ من ٧");
    await p.evaluate(() => { QuranGlasses.goto(36, 1); QuranGlasses.hear("استمر"); });
    t("استمر returns to the saved place", await p.evaluate(() => [paused, S.s, document.querySelector(".w.now")?.dataset.i === String(S.saved.i)]), [false, 1, true]);
    await p.evaluate(() => QuranGlasses.hear("الرحمن الرحيم مالك يوم الدين"));
    t("tracking continues after resume", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    await p.keyboard.press("KeyP"); t("P pauses", await p.evaluate(() => paused), true);
    await p.keyboard.press("KeyP"); t("P resumes", await p.evaluate(() => paused), false);
    await p.evaluate(() => { QuranGlasses.hear("سورة الكهف"); QuranGlasses.hear("ارجع"); });
    t("ارجع undoes the surah jump", await p.evaluate(() => S.s), 1);
    await p.evaluate(() => QuranGlasses.hear("سورة الكهف")); await p.keyboard.press("Backspace");
    t("Backspace undoes the surah jump", await p.evaluate(() => S.s), 1);
    t("ارجع as recitation is not a command", await p.evaluate(() => { QuranGlasses.goto(12, 50); const c = cursor; QuranGlasses.hear("ارجع إلى ربك"); return S.s === 12 && cursor > c; }), true);
    await p.evaluate(() => { QuranGlasses.goto(1, 1); });
    // sliding window: reciting the last visible ayah must bring the next ayah into view before that ayah ends,
    // and inside a long ayah the following lines stay visible; always under the top limit
    const slide = await p.evaluate(() => {
      const plain = (s, a) => Engine.norm(Q[s - 1][1][a - 1]).split(" ").filter(Boolean);
      const under = () => { const st = document.getElementById("stage").getBoundingClientRect(), tx = document.getElementById("text").getBoundingClientRect(); return tx.top >= st.bottom - st.height * S.top / 100 - 1; };
      const out = {};
      Object.assign(S, LOOK_DEFAULTS); S.top = 55; S.follow = true; applyLook(); QuranGlasses.goto(2, 6); resync();
      const L = pageEnd();                                   // last ayah visible on the page
      out.nextHiddenBefore = !document.querySelector(`.w[data-a="${L + 1}"]`);
      const words = plain(2, L);
      QuranGlasses.hear(words.slice(0, 3).join(" "));        // only the first words of that ayah
      out.cur = document.querySelector(".ay.cur")?.dataset.a == L;
      out.nextShownEarly = !!document.querySelector(`.w[data-a="${L + 1}"]`);
      out.curInUpperHalf = (() => { const w = document.querySelector(".w.now"); return !!w && w.offsetTop <= LIMIT_H / 2; })();
      out.under1 = under();
      // long ayah (Ayat al-Kursi, large font): walk through it 4 words at a time
      document.body.classList.add("focus-mode");           // glasses mode: the real reading layout
      S.size = 60; applyLook(); QuranGlasses.goto(2, 255); resync();
      const k = plain(2, 255); let ok = true, moves = 0, lastStart = `${S.a}:${S.w}`;
      for (let j = 0; j + 4 <= k.length; j += 4) {
        QuranGlasses.hear(k.slice(j, j + 4).join(" "));
        const w = document.querySelector(".w.now"); if (!w) { ok = false; break; }
        const below = [...document.querySelectorAll("#text .w, #text .t")].some(t => t.offsetTop > w.offsetTop + 2) || !!document.querySelector('.w[data-a="256"]');
        if (!below || !under() || w.offsetTop > LIMIT_H / 2) { ok = false; out.failAt = j; break; }
        if (`${S.a}:${S.w}` !== lastStart) { moves++; lastStart = `${S.a}:${S.w}`; }
      }
      out.longOk = ok; out.longMoves = moves; out.longSteps = Math.floor(k.length / 4);
      QuranGlasses.hear(k.slice(-4).join(" "));
      out.after255NextVisible = !!document.querySelector('.w[data-a="256"]');
      document.body.classList.remove("focus-mode");
      Object.assign(S, LOOK_DEFAULTS); S.top = 90; applyLook(); QuranGlasses.goto(1, 1);
      return out;
    });
    t("sliding: next ayah hidden at first", slide.nextHiddenBefore, true);
    t("sliding: reciting the last visible ayah shows the next one early", [slide.cur, slide.nextShownEarly], [true, true]);
    t("sliding: current word in the upper half, under the top limit", [slide.curInUpperHalf, slide.under1], [true, true]);
    t("sliding: long ayah always shows the following lines", [slide.longOk, slide.failAt], [true, undefined]);
    t("sliding: long ayah moves by lines, not on every update", slide.longMoves > 0 && slide.longMoves < slide.longSteps, true);
    t("sliding: end of a long ayah shows the next ayah", slide.after255NextVisible, true);
    // manual paging still works and tracking continues from the new page
    const manual = await p.evaluate(() => {
      QuranGlasses.goto(2, 1); resync(); page(1); const start = S.a;
      const words = Engine.norm(Q[1][1][start - 1]).split(" ").filter(Boolean);
      QuranGlasses.hear(words.slice(0, 3).join(" "));
      return [start > 1, document.querySelector(".ay.cur")?.dataset.a == start];
    });
    t("sliding: manual page then tracking continues there", manual, [true, true]);
    // Gen1 glasses (Euler frames): teach-in done in a real prostration (past vertical) must still hide at ruku
    const g1 = await p.evaluate(async () => {
      const D = Math.PI / 180;
      const q2zyx = ([w, x, y, z]) => ({ roll: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) / D, pitch: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) / D, yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) / D });
      const feed = deg => { const e = q2zyx([Math.cos(deg * D / 2), 0, Math.sin(deg * D / 2), 0]);
        const f = new Uint8Array(64); f[0] = 0xff; f[1] = 0xfc;
        [-e.yaw, -e.roll, e.pitch].forEach((v, i) => { const le = new Uint8Array(new Float32Array([v]).buffer); f.set(le.slice().reverse(), 18 + 4 * i); });
        const imu = QuranGlasses.imu; imu.gen = 1; imu.devices = [{ opened: true, productId: 0x101d }]; imu._onReport({ data: new DataView(f.buffer) }); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.body.classList.add("focus-mode"); applyHide();
      feed(0); document.getElementById("learn").click(); await wait(1200);
      feed(-115); await wait(3400);                                  // countdown ends in prostration
      const learned = [S.axis, S.nod && S.nod.kind, Math.round(S.nod && S.nod.angle)];
      for (let k = 0; k < 6; k++) { feed(0); await wait(120); }
      const qiyam = document.getElementById("text").classList.contains("off");
      for (let k = 0; k < 6; k++) { feed(-80); await wait(120); }
      const ruku = document.getElementById("text").classList.contains("off");
      for (let k = 0; k < 6; k++) { feed(-120); await wait(120); }
      const sujood = [document.getElementById("text").classList.contains("off"), document.getElementById("pitchv").textContent];
      document.getElementById("calib").click();                     // calibrate while still down: reference moves
      for (let k = 0; k < 6; k++) { feed(0); await wait(120); }
      document.getElementById("calib").click();                     // recalibrate at qiyam
      for (let k = 0; k < 6; k++) { feed(0); await wait(120); }
      const back = document.getElementById("text").classList.contains("off");
      document.body.classList.remove("focus-mode"); S.nod = null; S.axis = "gaze"; applyLook(); onPitch(-15, "محاكاة");
      return { learned, qiyam, ruku, sujood, back };
    });
    t("gen1 teach-in past vertical learns a quaternion axis", g1.learned, ["learned", "q", 115]);
    t("gen1: qiyam shows, ruku and sujood hide", [g1.qiyam, g1.ruku, g1.sujood[0]], [false, true, true]);
    t("gen1: sujood reads past -90°", g1.sujood[1], "-120°");
    t("gen1: qiyam calibration works with Euler glasses", g1.back, false);
    // subscription: offline code bound to this device unlocks the paid add-ons
    const devId = await p.textContent("#devId");
    t("subscription: device id shown", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(devId), true);
    t("subscription: none at first, add-ons locked", [await p.textContent("#subState"), (await p.textContent("#subAddons")).includes("مفعّلة")], ["بلا اشتراك", false]);
    t("subscription: locked add-on refuses", await p.evaluate(() => QuranGlasses.requireAddon("tafsir")), false);
    await p.fill("#subCode", issue("ZZZZ-ZZZZ-ZZ", "yearly", ["errors"], 365)); await p.click("#subApply");
    t("subscription: code for another device refused", [await p.textContent("#toast"), await p.textContent("#subState")], ["هذا الرمز لجهاز آخر. أرسل معرّف هذا الجهاز للحصول على رمز له", "بلا اشتراك"]);
    await p.fill("#subCode", issue(devId, "yearly", ["errors", "hifz"], 365)); await p.click("#subApply");
    t("subscription: valid code activates", (await p.textContent("#subState")).startsWith("اشتراك سنوي · حتى"), true);
    t("subscription: only the bought add-ons open", await p.evaluate(() => ["errors", "tafsir", "hifz"].map(a => QuranGlasses.entitled(a))), [true, false, true]);
    await p.reload(); await p.waitForTimeout(400);
    t("subscription: kept after reload", [(await p.textContent("#subState")).startsWith("اشتراك سنوي"), await p.textContent("#devId")], [true, devId]);
    t("subscription: clock turned back is caught", await p.evaluate(() => { S.licSeen = Math.floor(Date.now() / 1000) + 30 * 86400; checkSub(); return [document.getElementById("subState").textContent, QuranGlasses.entitled("errors")]; }), ["الاشتراك غير صالح", false]);
    await p.evaluate(() => { S.licSeen = 0; S.lic = null; save(); checkSub(); S.top = 90; applyLook(); });
    t("no page errors", errs.length, 0);
    await p.close();
  }

  // ---- phone (landscape, touch) ----
  {
    const ctx = await b.newContext({ ...devices["Pixel 7 landscape"] });
    const p = await ctx.newPage();
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
    await p.evaluate(() => { S.top = 90; applyLook(); render(); });     // tall limit: whole-ayah pages for the tests below
    const head = () => p.textContent(".head");
    const ptr = (type, x, y) => p.evaluate(([type, x, y]) =>
      document.getElementById("stage").dispatchEvent(new PointerEvent(type, { pointerType: "touch", clientX: x, clientY: y, bubbles: true })), [type, x, y]);
    const tap = async (x, y) => { await ptr("pointerdown", x, y); await ptr("pointerup", x, y); };
    const swipe = async (x1, y1, x2, y2) => { await ptr("pointerdown", x1, y1); await ptr("pointermove", (x1 + x2) / 2, (y1 + y2) / 2); await ptr("pointerup", x2, y2); };
    await p.click("#focus"); await p.waitForTimeout(200);
    const W = await p.evaluate(() => document.getElementById("stage").clientWidth);
    await tap(W * 0.1, 250); t("tap left = next", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    await tap(W * 0.9, 250); t("tap right = prev", await head(), "سورة الفاتحة · الآيات ١–٣ من ٧");
    await swipe(200, 250, 500, 250); t("swipe right = next", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    await swipe(500, 250, 200, 250); t("swipe left = prev", await head(), "سورة الفاتحة · الآيات ١–٣ من ٧");
    await tap(W * 0.5, 250); t("center tap shows buttons", await p.isVisible("#corner"), true);
    await ptr("pointerdown", W * 0.5, 250); await p.waitForTimeout(700); await ptr("pointerup", W * 0.5, 250);
    t("long press opens picker", await p.isVisible("#picker"), true);
    t("picker lists all surahs", await p.evaluate(() => document.querySelectorAll('.picker button[data-n]').length), 114);
    t("picker list scrolls by touch", await p.evaluate(() => getComputedStyle(document.querySelector(".picker .list")).touchAction), "pan-y");
    await p.click('.picker button[data-n="3"]'); t("tap in list picks surah", await head(), "سورة آل عمران · الآيات ١–٣ من ٢٠٠");
    await ctx.close();
  }

  // ---- Android app bridge: window.QGNative injected before the page loads (what the app does) ----
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.addInitScript(() => {
      window.__calls = [];
      let st = "loading"; setTimeout(() => st = "ready", 700);
      window.QGNative = {
        available: () => true, status: () => st,
        start: () => { __calls.push("start"); setTimeout(() => QGN.onState("listening"), 10); },
        stop: () => __calls.push("stop"),
        setContext: c => __calls.push("ctx:" + c),
      };
    });
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
    const head = () => p.textContent(".head");
    t("app: on-device engine selected", await p.evaluate(() => [S.engine, !document.getElementById("engNative").hidden]), ["native", true]);
    t("app: starts in glasses mode", await p.evaluate(() => document.body.classList.contains("focus-mode")), true);
    t("app: waits for the model to load", await p.evaluate(() => [listening, document.getElementById("micState").textContent.includes("تحميل")]), [true, true]);
    await p.waitForTimeout(1000);
    t("app: listens automatically once the model is ready", await p.evaluate(() => [__calls.includes("start"), document.getElementById("micState").textContent]), [true, "يستمع… (على الجهاز، بدون إنترنت)"]);
    t("app: context sent on start", await p.evaluate(() => __calls.some(c => c.startsWith("ctx:"))), true);
    await p.evaluate(() => { QGN.onPartial("الحمد لله"); });
    t("app: partial results highlight", await p.evaluate(() => document.querySelector(".ay.cur")?.dataset.a), "2");
    await p.evaluate(() => { QGN.onFinal("الحمد لله رب العالمين"); QGN.onFinal("الرحمن الرحيم مالك يوم الدين"); });
    t("app: final results move the window", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    t("app: context follows the reader", await p.evaluate(() => __calls.filter(c => c.startsWith("ctx:")).length >= 2), true);
    // device sensor as quaternions: teach-in, then posture hides the text in glasses mode
    const pose = await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const feed = deg => { const h = deg * Math.PI / 360; QuranGlasses.pushQuat(Math.cos(h), Math.sin(h), 0, 0); };
      feed(0); await wait(60);
      const status = document.getElementById("hidst").textContent;
      document.getElementById("learn").click(); await wait(1200); feed(-110); await wait(3400);
      for (let k = 0; k < 6; k++) { feed(-110); await wait(120); }
      const down = document.getElementById("text").classList.contains("off");
      for (let k = 0; k < 6; k++) { feed(0); await wait(120); }
      return { status, learned: S.axis, down, up: !document.getElementById("text").classList.contains("off") };
    });
    t("app: device sensor connects by itself", pose.status, "موصولة: حساس الجهاز");
    t("app: teach-in and posture with the device sensor", [pose.learned, pose.down, pose.up], ["learned", true, true]);
    // hardware buttons
    await p.evaluate(() => QuranGlasses.key("next"));
    t("app: volume key = next page", await head(), "سورة الفاتحة · الآية ٧ من ٧".replace("الآية ٧", "الآيات ٧–٧"));
    await p.evaluate(() => QuranGlasses.key("pause")); t("app: media key = pause", await p.evaluate(() => paused), true);
    await p.evaluate(() => QuranGlasses.key("pause")); t("app: media key again = resume", await p.evaluate(() => paused), false);
    await p.evaluate(() => QuranGlasses.key("mic")); t("app: stopping sends stop", await p.evaluate(() => __calls.includes("stop") && !listening), true);
    await p.evaluate(() => QGN.onError("المايك مرفوض")); t("app: errors are shown", await p.textContent("#micState"), "المايك مرفوض");
    t("app: no page errors", errs.length, 0);
    await p.close();
  }
  await b.close(); server.close();
  console.log(`${pass} pass, ${fail} fail`);
  if (fail) process.exit(1);
})();
