// Offline subscription codes:  node tests/test_license.js
const nacl = require(__dirname + "/../assets/tweetnacl-1.0.3.min.js");
const L = require("../src/license.js");
const dev = require("../tools/dev-license-key.json");
const PUB = require("fs").readFileSync(__dirname + "/../license/public_key.txt", "utf8").trim();

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const DAY = 86400, NOW = 1_800_000_000, DEV = "ABCD-EFGH-JK";
const code = (over = {}, key = dev.secretKey) =>
  L.sign({ v: 1, d: DEV, p: "monthly", f: ["errors", "tafsir", "hifz"], i: NOW, e: NOW + 31 * DAY, n: "0a0b0c0d", ...over }, key);
const check = (c, over = {}) => L.check(c, { publicKeyHex: PUB, deviceId: DEV, now: NOW + DAY, ...over });

t("dev public key matches the dev secret key", PUB, dev.publicKey);
const ok = check(code());
t("valid code", [ok.ok, ok.plan, ok.addons, ok.daysLeft, ok.inGrace], [true, "monthly", ["errors", "tafsir", "hifz"], 30, false]);
t("has() for an included add-on", L.has(ok, "tafsir"), true);
t("has() for a missing add-on", L.has(check(code({ f: ["errors"] })), "tafsir"), false);
t("unknown add-ons are ignored", check(code({ f: ["errors", "future"] })).addons, ["errors"]);
t("has() without a subscription", L.has(null, "errors"), false);

t("device id ignores case and dashes", check(code(), { deviceId: "abcdefghjk" }).ok, true);
t("other device refused", check(code(), { deviceId: "ZZZZ-ZZZZ-ZZ" }).reason, "device");
t("edited payload refused", (() => { const [a, b, c] = code().split("."); const p = JSON.parse(Buffer.from(b, "base64url")); p.e += 365 * DAY;
  return check([a, Buffer.from(JSON.stringify(p)).toString("base64url"), c].join(".")).reason; })(), "signature");
t("code from another key refused", check(code({}, Buffer.from(nacl.sign.keyPair().secretKey).toString("hex"))).reason, "signature");
t("garbage refused", [check("hello").reason, check("QG1.!!.??").reason, check("").reason], ["format", "format", "format"]);
t("spaces and line breaks from copying are ignored", check(code().replace(/(.{40})/g, "$1\n ")).ok, true);

t("grace period after the end", (() => { const r = check(code(), { now: NOW + 32 * DAY }); return [r.ok, r.inGrace, r.daysLeft]; })(), [true, true, -1]);
t("expired after the grace period", check(code(), { now: NOW + 31 * DAY + (L.GRACE_DAYS + 1) * DAY }).reason, "expired");
t("clock turned back is refused", check(code(), { now: NOW + 2 * DAY, maxSeen: NOW + 20 * DAY }).reason, "clock");
t("small backwards jumps are tolerated", check(code(), { now: NOW + 19.5 * DAY, maxSeen: NOW + 20 * DAY }).ok, true);
t("max seen time moves forward", check(code(), { now: NOW + 5 * DAY, maxSeen: NOW + 2 * DAY }).maxSeen, NOW + 5 * DAY);

t("random device ids look like XXXX-XXXX-XX", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/.test(L.randomId()), true);
t("every refusal reason has an Arabic message", ["format", "signature", "device", "expired", "clock"].every(r => !!L.REASONS[r]), true);

// the owner's tool issues codes the app accepts
const { execFileSync } = require("child_process");
const issued = execFileSync("node", [__dirname + "/../tools/license.js", "issue", "--device", "wxyz-2345-ab", "--plan", "yearly", "--addons", "errors,hifz",
  "--key", __dirname + "/../tools/dev-license-key.json"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const r = L.check(issued, { publicKeyHex: PUB, deviceId: "WXYZ-2345-AB" });
t("tool-issued yearly code", [r.ok, r.plan, r.addons, r.daysLeft >= 365], [true, "yearly", ["errors", "hifz"], true]);

console.log(`${pass} pass ${fail} fail`);
process.exit(fail ? 1 : 0);
