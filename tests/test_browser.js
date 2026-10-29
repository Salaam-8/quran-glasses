// End-to-end checks in headless Chromium (needs: npm i -D playwright && npx playwright install chromium)
// Run after `py build.py`:  node tests/test_browser.js
const { chromium, devices } = require("playwright");
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
  const b = await chromium.launch();

  // ---- desktop: voice tracking (simulated text), commands, picker, keys ----
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
    const head = () => p.textContent(".head");
    t("starts at Fatiha", await head(), "سورة الفاتحة · الآيات ١–٣ من ٧");
    await p.evaluate(() => QuranGlasses.hear("الحمد لله رب العالمين"));
    t("highlights 1:2", await p.evaluate(() => document.querySelector(".ay.cur")?.dataset.a), "2");
    await p.evaluate(() => QuranGlasses.hear("الرحمن الرحيم مالك يوم الدين"));
    t("auto page turn", await head(), "سورة الفاتحة · الآيات ٤–٦ من ٧");
    await p.evaluate(() => QuranGlasses.hear("سورة الكهف"));
    t("voice command surah", await head(), "سورة الكهف · الآيات ١–٣ من ١١٠");
    await p.evaluate(() => { QuranGlasses.hear("تبارك الذي بيده الملك"); QuranGlasses.hear("تبارك الذي بيده الملك وهو على كل شيء قدير"); });
    t("finds another surah by recitation", await head(), "سورة الملك · الآيات ١–٣ من ٣٠");
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
    t("no page errors", errs.length, 0);
    await p.close();
  }

  // ---- phone (landscape, touch) ----
  {
    const ctx = await b.newContext({ ...devices["Pixel 7 landscape"] });
    const p = await ctx.newPage();
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
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

  await b.close(); server.close();
  console.log(`${pass} pass, ${fail} fail`);
  if (fail) process.exit(1);
})();
