/* Recitation tracker: matches recognised speech (plain Arabic) against the Uthmani text. */
const Engine = (function () {
  const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
  function norm(s) {
    return String(s).replace(DIAC, "")
      .replace(/[ٱأإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[^ء-ي\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  // Skeleton key: drop alef and hamza so dagger-alef / hamza spelling differences disappear.
  const key = w => w.replace(/[اء]/g, "");

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function sim(a, b) {
    if (a === b) return 1;
    const L = Math.max(a.length, b.length);
    if (Math.abs(a.length - b.length) > L * 0.5) return 0;
    return 1 - lev(a, b) / L;
  }

  let KEYS = [], SUR = null, AYA = null, SSTART = [], SEND = [], TOK = [], NAMES = [];
  function build(Q) {
    const keys = [], sur = [], aya = [];
    TOK = [];
    Q.forEach((s, si) => {
      SSTART[si + 1] = keys.length;
      TOK[si + 1] = s[1].map((v, ai) => v.split(" ").map(t => {
        const k = key(norm(t).replace(/ /g, ""));
        if (!k) return -1;
        keys.push(k); sur.push(si + 1); aya.push(ai + 1);
        return keys.length - 1;
      }));
      SEND[si + 1] = keys.length;
    });
    KEYS = keys; SUR = Int16Array.from(sur); AYA = Int16Array.from(aya);
    NAMES = Q.map(s => norm(s[0]).replace(/ /g, ""));
  }

  /* Local alignment (Smith-Waterman) of spoken keys against KEYS[lo..hi).
     Returns best end index plus the best score that ends far from it (to detect ambiguous repeats). */
  function align(sp, lo, hi) {
    const n = sp.length;
    let prev = new Float32Array(n + 1), cur = new Float32Array(n + 1);
    const ends = new Float32Array(Math.max(0, hi - lo));
    for (let j = lo; j < hi; j++) {
      cur[0] = 0;
      const kj = KEYS[j];
      for (let i = 1; i <= n; i++) {
        const s = sim(sp[i - 1], kj);
        const m = s >= 0.6 ? s * 3 - 1 : -1;
        cur[i] = Math.max(0, prev[i - 1] + m, cur[i - 1] - 1, prev[i] - 1);
      }
      // end on the last spoken word, or the one before it (the last interim word is often cut off)
      ends[j - lo] = Math.max(cur[n], n > 1 ? cur[n - 1] - 0.5 : 0);
      [prev, cur] = [cur, prev];
    }
    let bi = -1, bs = 0;
    for (let k = 0; k < ends.length; k++) if (ends[k] > bs) { bs = ends[k]; bi = k; }
    let ss = 0;
    for (let k = 0; k < ends.length; k++) if (Math.abs(k - bi) > 12 && ends[k] > ss) ss = ends[k];
    return { end: bi < 0 ? -1 : lo + bi, score: bs, second: ss };
  }

  const spoken = text => norm(text).split(" ").map(key).filter(Boolean);
  // basmala at 1:1 (and 27:30) is recited before most surahs; never jump there on it alone
  function isBasmalaOnly(end) {
    if (SUR[end] === 1 && AYA[end] === 1) return true;
    const t = TOK[27][29].filter(x => x >= 0);
    return end >= t[t.length - 4] && end <= t[t.length - 1];
  }

  /* Track: cursor = flat index of the next expected word, surah = current surah.
     mode 'local' searches near the cursor; 'surah' the whole current surah; 'global' the whole Quran. */
  function locate(text, cursor, surah, mode) {
    const sp = spoken(text).slice(-8);
    if (mode === "local") {
      // Fast path for short interim results: the last heard word is one of the next three expected
      // words (and the word before it fits too). Moves the highlight word by word with no wait.
      if (sp.length >= 1 && sp.length <= 2) {
        const last = sp[sp.length - 1];
        for (let k = 0; k < 3 && cursor + k < SEND[surah]; k++)
          if (sim(last, KEYS[cursor + k]) >= 0.85 && (sp.length === 1 || k === 0 || sim(sp[0], KEYS[cursor + k - 1]) >= 0.6)) return cursor + k;
      }
      if (sp.length < 2) return null;
      const lo = Math.max(SSTART[surah], cursor - 6), hi = Math.min(SEND[surah], cursor + 40);
      const r = align(sp, lo, hi);
      const need = sp.length >= 3 ? 3 : 2.2;
      // Prefer places near the cursor: a noisy phrase that happens to echo common words 30 words
      // ahead must score clearly higher than a nearby match to win.
      const adj = r.score - Math.max(0, r.end - cursor - 10) * 0.08;
      return adj >= need ? r.end : null;
    }
    if (sp.length < 2) return null;
    // 'lost': compare the best place in the current surah with the best place in the whole Quran
    if (sp.length < 4) return null;
    const rg = align(sp, 0, KEYS.length);
    const rs = align(sp, SSTART[surah], SEND[surah]);
    const gOk = rg.score >= 6 && rg.score - rg.second >= 1.5 && !isBasmalaOnly(rg.end);
    const sOk = rs.score >= 5 && rs.score - rs.second >= 1 && !isBasmalaOnly(rs.end);
    if (gOk && (!sOk || rg.score > rs.score + 0.5)) return rg.end;
    if (sOk && rs.score >= rg.score - 0.5) return rs.end;
    return null;
  }

  /* Among the recogniser's alternatives for one utterance, pick the one that fits the text near the
     cursor best. Google's first choice is a prior: ties keep it. Returns the index into texts. */
  function bestAlternative(texts, cursor, surah) {
    let bi = 0, bs = -Infinity;
    const lo = Math.max(SSTART[surah], cursor - 6), hi = Math.min(SEND[surah], cursor + 40);
    texts.forEach((t, i) => {
      const sp = spoken(t).slice(-8);
      if (!sp.length) return;
      const sc = align(sp, lo, hi).score;
      if (sc > bs + 0.01) { bs = sc; bi = i; }
    });
    return bi;
  }

  /* Voice command "سورة <name>" → surah number, or null. */
  function surahCommand(text) {
    const t = norm(text).split(" ");
    for (let i = t.length - 2; i >= 0; i--) {
      if (t[i] !== "سوره") continue;
      const cands = [t[i + 1], t[i + 1] + (t[i + 2] || "")];
      let best = 0, bn = null;
      NAMES.forEach((nm, k) => {
        const forms = [nm, nm.replace(/^ال/, "")];
        cands.forEach(c => forms.forEach(f => {
          const s = sim(c, f), s2 = sim(c.replace(/^ال/, ""), f);
          const v = Math.max(s, s2);
          if (v > best) { best = v; bn = k + 1; }
        }));
      });
      if (best >= 0.8) return bn;
    }
    return null;
  }

  return {
    build, locate, bestAlternative, surahCommand, norm,
    pos: i => ({ s: SUR[i], a: AYA[i] }),
    first: (s, a) => { const r = TOK[s][a - 1].find(x => x >= 0); return r === undefined ? SSTART[s] : r; },
    tokens: (s, a) => TOK[s][a - 1],
    start: s => SSTART[s],
    end: s => SEND[s]
  };
})();
if (typeof module !== "undefined") module.exports = Engine;
