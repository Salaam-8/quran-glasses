"""Build the Quran Glasses reader.

Outputs (in dist/):
  quran-glasses.html  single offline file (desktop Chrome + glasses as external display)
  app/                installable PWA for hosting on HTTPS (GitHub Pages): index.html, manifest, sw.js, icons

Run:  py build.py        (Windows)
      python3 build.py   (macOS / Linux)
No third-party packages needed.
"""
import base64
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, DATA, ASSETS, DIST = ROOT / "src", ROOT / "data", ROOT / "assets", ROOT / "dist"


def build_single_file() -> str:
    q = json.loads((DATA / "quran.json").read_text(encoding="utf-8"))
    data = [[s["name"], [v["text"] for v in s["verses"]]] for s in q]
    assert len(data) == 114, "expected 114 surahs"
    assert sum(len(s[1]) for s in data) == 6236, "expected 6236 ayahs"

    font = base64.b64encode((ASSETS / "amiri-quran-arabic-400-normal.woff2").read_bytes()).decode()
    engine = (SRC / "engine.js").read_text(encoding="utf-8").replace(
        'if (typeof module !== "undefined") module.exports = Engine;', "")
    viture = (SRC / "viture.js").read_text(encoding="utf-8").replace(
        'if (typeof module !== "undefined") module.exports = VitureIMU;', "")
    t = (SRC / "template.html").read_text(encoding="utf-8")
    for ph in ("/*ENGINE*/", "/*VITURE*/", "/*QURAN_DATA*/[]", "/*FONT_B64*/"):
        assert ph in t, f"placeholder {ph} missing from template.html"
    return (t.replace("/*FONT_B64*/", font)
             .replace("/*ENGINE*/", engine)
             .replace("/*VITURE*/", viture)
             .replace("/*QURAN_DATA*/[]", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))


PWA_HEAD = """<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#000000">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="مصحف النظارة">
<link rel="icon" type="image/png" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
"""

MANIFEST = {
    "name": "مصحف النظارة", "short_name": "مصحف النظارة", "lang": "ar", "dir": "rtl",
    "start_url": "./", "scope": "./", "display": "fullscreen", "orientation": "landscape",
    "background_color": "#000000", "theme_color": "#000000",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    ],
}

# Bump CACHE whenever you deploy so phones pick up the new version.
SERVICE_WORKER = """const CACHE = "quran-glasses-v18";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// network first so updates arrive; fall back to the cached copy when offline
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
"""


def main():
    page = build_single_file()
    DIST.mkdir(exist_ok=True)
    (DIST / "quran-glasses.html").write_text(page, encoding="utf-8")

    app = DIST / "app"
    shutil.rmtree(app, ignore_errors=True)
    app.mkdir()
    (app / "index.html").write_text(PWA_HEAD + page + "\n</body>\n</html>\n", encoding="utf-8")
    (app / "manifest.webmanifest").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=1), encoding="utf-8")
    (app / "sw.js").write_text(SERVICE_WORKER, encoding="utf-8")
    (app / ".nojekyll").write_text("", encoding="utf-8")
    for icon in ("icon-192.png", "icon-512.png"):
        shutil.copy(ASSETS / icon, app / icon)
    # Azure Speech SDK (MIT), loaded lazily only when the cloud engine is selected
    shutil.copy(ASSETS / "azure-speech.js", app / "azure-speech.js")
    shutil.copy(ASSETS / "azure-speech.js", DIST / "azure-speech.js")

    print(f"dist/quran-glasses.html  {len(page.encode()) // 1024} KB")
    print("dist/app/                ", ", ".join(sorted(p.name for p in app.iterdir())))


if __name__ == "__main__":
    main()
