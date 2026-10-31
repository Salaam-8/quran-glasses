#!/usr/bin/env node
/* Owner's tool for offline subscription codes. Keep the secret key file private: anyone holding it can
   issue codes. The matching public key goes in license/public_key.txt and is built into the app.

   node tools/license.js keygen  [--out ~/.quran-glasses-license.json]
   node tools/license.js issue   --device ABCD-EFGH-JK --plan monthly|yearly|trial [--addons errors,tafsir,hifz]
                                 [--days N] [--from 2026-11-01] [--key ~/.quran-glasses-license.json]
   node tools/license.js inspect <code>                     (shows the payload, checks it against public_key.txt) */
const fs = require("fs");
const os = require("os");
const path = require("path");
const nacl = require(__dirname + "/../assets/tweetnacl-1.0.3.min.js");
const License = require("../src/license.js");

const PUB = path.join(__dirname, "..", "license", "public_key.txt");
const DEFAULT_KEY = path.join(os.homedir(), ".quran-glasses-license.json");
const PLAN_DAYS = { monthly: 31, yearly: 366, trial: 14 };

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else o._.push(argv[i]);
  }
  return o;
}
const toHex = u8 => Buffer.from(u8).toString("hex");
const die = m => { console.error(m); process.exit(1); };

const a = args(process.argv.slice(2));
const cmd = a._[0];

if (cmd === "keygen") {
  const out = a.out || DEFAULT_KEY;
  if (fs.existsSync(out) && !a.force) die(`${out} exists; use --force to replace it (old codes stop working)`);
  const kp = nacl.sign.keyPair();
  fs.writeFileSync(out, JSON.stringify({ publicKey: toHex(kp.publicKey), secretKey: toHex(kp.secretKey), created: new Date().toISOString() }, null, 1), { mode: 0o600 });
  console.log(`secret key saved to ${out} (keep it private, back it up)`);
  console.log(`public key: ${toHex(kp.publicKey)}`);
  console.log(`put the public key in license/public_key.txt, then rebuild the app`);
} else if (cmd === "issue") {
  const key = JSON.parse(fs.readFileSync(a.key || DEFAULT_KEY, "utf8"));
  if (!a.device) die("--device is required (the ID shown in the app's subscription row)");
  const plan = a.plan || "monthly";
  if (!(plan in PLAN_DAYS)) die("--plan must be monthly, yearly or trial");
  const addons = String(a.addons || Object.keys(License.ADDONS).join(",")).split(",").filter(Boolean);
  const bad = addons.filter(x => !(x in License.ADDONS));
  if (bad.length) die(`unknown add-on: ${bad.join(", ")} (known: ${Object.keys(License.ADDONS).join(", ")})`);
  const from = a.from ? Math.floor(new Date(a.from).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const days = Number(a.days || PLAN_DAYS[plan]);
  const payload = { v: 1, d: License.formatId(a.device), p: plan, f: addons, i: from, e: from + days * 86400, n: toHex(nacl.randomBytes(4)) };
  console.log(License.sign(payload, key.secretKey));
  console.error(`device ${payload.d} · ${plan} · ${addons.join(", ")} · until ${new Date(payload.e * 1000).toISOString().slice(0, 10)}`);
} else if (cmd === "inspect") {
  const code = a._[1] || die("usage: inspect <code>");
  const t = License.parse(code);
  console.log(JSON.stringify(t.payload, null, 1));
  const pub = fs.readFileSync(PUB, "utf8").trim();
  const r = License.check(code, { publicKeyHex: pub, deviceId: t.payload.d });
  console.log(r.ok ? `valid for ${r.daysLeft} more day(s)` : `not valid: ${r.reason}`);
} else {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 9).join("\n"));
}
