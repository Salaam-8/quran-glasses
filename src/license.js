/* Offline subscriptions.
   A subscription code is signed (Ed25519) by the owner's private key, which never ships. The app holds
   only the public key, so it can check a code with no network: the device it belongs to, the plan,
   the add-ons it unlocks and when it ends. The highest time ever seen is remembered, so turning the
   clock back does not extend a subscription.

   Code format:  QG1.<base64url(JSON payload)>.<base64url(signature over "QG1.<payload>")>
   Payload:      { v: 1, d: deviceId, p: "monthly" | "yearly" | "trial", f: [add-ons], i: issuedAt, e: expiresAt, n: id }
                 (times in Unix seconds)
   Works in the page (global nacl from tweetnacl) and in Node (require("tweetnacl")). */
const License = (() => {
  const PREFIX = "QG1.";
  const DAY = 86400;
  const GRACE_DAYS = 3;            // keeps working a few days after the end, with a warning
  const CLOCK_SLACK = DAY;         // tolerated backwards clock jump (time zones, manual fixes)

  /* Paid add-ons. Each feature checks License.has(state, key) before it runs. */
  const ADDONS = {
    errors: "تنبيه أخطاء التلاوة",
    tafsir: "التفسير والقراءات",
    hifz: "متابعة الحفظ والمراجعة",
  };
  const PLANS = { monthly: "شهري", yearly: "سنوي", trial: "تجريبي" };

  const naclLib = () => (typeof nacl !== "undefined" ? nacl : require(__dirname + "/../assets/tweetnacl-1.0.3.min.js"));
  const hex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
  const utf8 = s => new TextEncoder().encode(s);
  const b64u = {
    enc(bytes) {
      let s = ""; bytes.forEach(b => s += String.fromCharCode(b));
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    dec(str) {
      if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("format");
      const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
      return Uint8Array.from(s, c => c.charCodeAt(0));
    },
  };

  /* Device IDs are shown to the user and typed into the owner's tool: 10 base32 characters, XXXX-XXXX-XX. */
  const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function formatId(raw) {
    const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 10 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}` : s;
  }
  function randomId() {
    const r = new Uint8Array(10); (typeof crypto !== "undefined" ? crypto : require("crypto").webcrypto).getRandomValues(r);
    return formatId(Array.from(r, b => B32[b % 32]).join(""));
  }
  const sameId = (a, b) => formatId(a) === formatId(b);

  /* Signs a payload (owner's tool only; the app never has the secret key). */
  function sign(payload, secretKeyHex) {
    const body = PREFIX + b64u.enc(utf8(JSON.stringify(payload)));
    const sig = naclLib().sign.detached(utf8(body), hex(secretKeyHex));
    return body + "." + b64u.enc(sig);
  }

  function parse(code) {
    const c = String(code || "").replace(/\s+/g, "");
    if (!c.startsWith(PREFIX)) throw new Error("format");
    const parts = c.split(".");
    if (parts.length !== 3) throw new Error("format");
    const body = parts[0] + "." + parts[1];
    const payload = JSON.parse(new TextDecoder().decode(b64u.dec(parts[1])));
    return { code: c, body, payload, sig: b64u.dec(parts[2]) };
  }

  /* Checks a code. opts: { publicKeyHex, deviceId, now (s), maxSeen (s) }.
     Returns { ok, reason, plan, addons, expires, inGrace, daysLeft, maxSeen } (reason set when !ok). */
  function check(code, opts) {
    const now = Math.floor(opts.now ?? Date.now() / 1000);
    const maxSeen = Math.max(now, opts.maxSeen || 0);
    const fail = reason => ({ ok: false, reason, addons: [], maxSeen });
    let t;
    try { t = parse(code); } catch { return fail("format"); }
    const p = t.payload;
    if (!p || p.v !== 1 || typeof p.e !== "number" || !Array.isArray(p.f)) return fail("format");
    let good = false;
    try { good = naclLib().sign.detached.verify(utf8(t.body), t.sig, hex(opts.publicKeyHex)); } catch {}
    if (!good) return fail("signature");
    if (!sameId(p.d, opts.deviceId)) return fail("device");
    if (opts.maxSeen && now < opts.maxSeen - CLOCK_SLACK) return fail("clock");
    const left = p.e - now;
    if (left < -GRACE_DAYS * DAY) return { ...fail("expired"), plan: p.p, expires: p.e };
    return {
      ok: true, plan: p.p, addons: p.f.filter(f => f in ADDONS), expires: p.e, issued: p.i, id: p.n,
      inGrace: left < 0, daysLeft: Math.ceil(left / DAY), maxSeen,
    };
  }

  const has = (state, addon) => !!(state && state.ok && state.addons.includes(addon));

  const REASONS = {
    format: "الرمز غير صحيح. انسخه كاملًا كما وصلك",
    signature: "الرمز غير صادر منا أو تغيّر أثناء النسخ",
    device: "هذا الرمز لجهاز آخر. أرسل معرّف هذا الجهاز للحصول على رمز له",
    expired: "انتهى الاشتراك. جدّده للحصول على رمز جديد",
    clock: "ساعة الجهاز رجعت للخلف. صحّح التاريخ والوقت ثم أعد المحاولة",
  };

  return { PREFIX, ADDONS, PLANS, GRACE_DAYS, sign, parse, check, has, formatId, randomId, sameId, REASONS };
})();
if (typeof module !== "undefined") module.exports = License;
