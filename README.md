# مصحف النظارة · Quran Glasses Reader

قارئ قرآن لنظارة الواقع المعزز VITURE Pro 2، يتتبع التلاوة بالصوت ويبرز الآية والكلمة الحالية ويقلب الصفحات تلقائيًا.

- التطبيق المنشور (PWA): https://salaam-8.github.io/quran-glasses/
- السياق الكامل والقرارات وحالة المشروع: [HANDOFF.md](HANDOFF.md)

## Build and test

```bash
py build.py                 # Windows (python3 build.py elsewhere)
node tests/test_engine.js
node tests/test_viture.js
npm install && npx playwright install chromium && node tests/test_browser.js
```

Voice tracking uses the browser's Web Speech API by default, or Azure Speech streaming with the reader's own key (see the in-app help panel).

`dist/app/` is published by `.github/workflows/pages.yml` on every push to `main`. Bump `CACHE` in `build.py` before each deploy.
