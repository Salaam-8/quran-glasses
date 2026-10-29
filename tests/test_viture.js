// Pure-function tests for the VITURE WebHID driver (no hardware):  node tests/test_viture.js
const V = require("../src/viture.js");

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const near = (name, got, want, tol = 0.5) => {
  const ok = Math.abs(got - want) <= tol; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} → ${got.toFixed(2)}${ok ? "" : ` (want ${want})`}`);
};
const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join(" ");
const qAxis = (deg, axis) => { const h = deg * Math.PI / 360, q = [Math.cos(h), 0, 0, 0]; q[axis + 1] = Math.sin(h); return q; };
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];

// ---- Gen2 (Pro 2) frames, byte-exact against PROTOCOL.md ----
t("gen2 pose on 120Hz", hex(V.gen2ImuCommand(true)), "10 00 01 03 02 00 03 00 01 02");
t("gen2 streams off", hex(V.gen2ImuCommand(false)), "10 00 01 03 02 00 00 00 00 00");
t("gen2 query frame", hex(V.gen2Frame(0x3122, new Uint8Array(0))), "10 00 22 31 00 00 00 00");
t("gen2 ack parse", V.gen2Parse(new Uint8Array([0x10, 0x00, 0x01, 0x23, 0x01, 0x00, 0x00, 0x00, 0x00])), { type: "ack", ok: true });
t("gen2 rejects gen1 header", V.gen2Parse(new Uint8Array(64).fill(0xff)), null);

function poseFrame(q, tick = 7) {
  const p = new Uint8Array(24), dv = new DataView(p.buffer);
  dv.setUint32(4, tick, true); q.forEach((v, i) => dv.setFloat32(8 + 4 * i, v, true));
  const f = new Uint8Array(64); f.set(V.gen2Frame(0x7308, p)); return f;   // device pads to 64 bytes
}
const q20x = qAxis(20, 0);
const s = V.gen2Parse(poseFrame(q20x));
t("gen2 pose type/tick", [s.type, s.tick], ["pose", 7]);
near("gen2 pose qw", s.q[0], q20x[0], 1e-6);
near("euler x of 20° about X", V.euler(s.q).x, 20);
near("gaze pitch of 20° about X", V.gazePitch(s.q), 20);
near("gaze pitch, head down 30°", V.gazePitch(qAxis(-30, 0)), -30);
// heading must not leak into the nod angle (same property the viture-v2 driver tests)
const headYawPitch = qMul(qAxis(30, 1), qAxis(20, 0));
near("gaze pitch ignores 30° heading", V.gazePitch(headYawPitch), 20);
near("euler x ignores 30° heading", V.euler(headYawPitch).x, 20);
near("euler y is the heading", V.euler(headYawPitch).y, 30);
near("headPitch default axis", V.headPitch({ q: headYawPitch }), 20);
near("headPitch axis y", V.headPitch({ q: headYawPitch }, "y"), 30);
near("headPitch inverted", V.headPitch({ q: headYawPitch }, "gaze", true), -20);

// ---- learned nod axis: frame-agnostic ----
// Pretend the device frame is permuted: body forward = X, world up = Z, the nod is about body Y.
{
  const A = qAxis(20, 2);                               // looking ahead, some heading
  const B = qMul(A, qAxis(40, 1));                      // head down 40° (body-frame nod)
  const nod = V.learnNod(A, B);
  near("learned nod angle", nod.angle, 40);
  near("learned axis is body Y", Math.abs(nod.n[1]), 1, 1e-6);
  near("nod pitch at reference", V.nodPitch(A, nod), 0, 1e-6);
  near("nod pitch head down", V.nodPitch(B, nod), -40);
  near("nod pitch after turning 50°", V.nodPitch(qMul(A, qAxis(50, 2)), nod), 0, 1e-3);
  near("nod pitch turned 80° then down 25°", V.nodPitch(qMul(qMul(A, qAxis(80, 2)), qAxis(25, 1)), nod), -25);
  near("headPitch learned", V.headPitch({ q: B }, "learned", false, nod), -40);
  t("learnNod rejects no motion", V.learnNod(A, A), null);
}

// ---- Gen1 frames ----
const c1 = V.gen1ImuCommand(true);
t("gen1 cmd length", c1.length, 20);
t("gen1 cmd header/cmd/data/end", [hex(c1.subarray(0, 2)), c1[4], c1[14], c1[18], c1[19]], ["ff fe", 14, 0x15, 1, 3]);
t("gen1 cmd crc", (c1[2] << 8) | c1[3], V.crc16(c1, 4, c1.length - 4));
function gen1Frame(a, b, c) {
  const f = new Uint8Array(64); f[0] = 0xff; f[1] = 0xfc;
  [a, b, c].forEach((v, i) => { const le = new Uint8Array(new Float32Array([v]).buffer); f.set(le.slice().reverse(), 18 + 4 * i); });
  return f;
}
const g1 = V.gen1Parse(gen1Frame(5, -40, 12));
t("gen1 parse", [g1.type, g1.euler.z, g1.euler.y, g1.euler.x, g1.pitch], ["euler", 5, -40, 12, 12]);
near("headPitch gen1 axis y", V.headPitch(g1, "y"), -40);
t("gen1 rejects garbage", V.gen1Parse(gen1Frame(9999, 0, 0)), null);

console.log(`${pass} pass ${fail} fail`);
process.exit(fail ? 1 : 0);
