/* VITURE glasses IMU over WebHID (Chrome desktop only).
   No vendor SDK. Two wire protocols:
   - Gen2 (Pro 2, PID 0x1301): frame = 0x0010 preamble, msgid, len, byte-sum checksum, payload (LE).
     Documented in https://github.com/elasticjava/viture-v2/blob/main/PROTOCOL.md
   - Gen1 (One / One Lite / Pro / Luma / Luma Pro): 0xFF 0xFC euler frames, CRC-16 commands.
     Documented in https://github.com/bfvogel/viture-webxr-extension/blob/main/VITURE_PROTOCOL.md
   The pure functions (frame building / parsing / angles) also run in Node for tests. */
const VitureIMU = (() => {
  const VENDOR_ID = 0x35ca;
  const GEN1_PIDS = [0x1011, 0x1013, 0x1017, 0x1015, 0x101b, 0x1019, 0x101d, 0x1121, 0x1141, 0x1131];
  const NAMES = { 0x1011: "VITURE One", 0x1013: "VITURE One", 0x1017: "VITURE One", 0x1015: "VITURE One Lite", 0x101b: "VITURE One Lite",
    0x1019: "VITURE Pro", 0x101d: "VITURE Pro", 0x1121: "VITURE Luma Pro", 0x1141: "VITURE Luma Pro", 0x1131: "VITURE Luma", 0x1301: "VITURE Pro 2" };
  const DEG = 180 / Math.PI;

  /* ---------- Gen2 ---------- */
  const G2 = { PREAMBLE: 0x0010, IMU_CTRL: 0x0301, IMU_ACK: 0x2301, EVT_POSE: 0x7308, EVT_RAW: 0x7309 };
  // rate: 0=60Hz 1=90Hz 2=120Hz 3=240Hz. stream bitmask: 1=pose(quaternion) 2=raw(gyro+accel)
  function gen2Frame(msgId, payload) {
    const f = new Uint8Array(8 + payload.length);
    f[0] = 0x10; f[1] = 0x00; f[2] = msgId & 0xff; f[3] = msgId >> 8;
    f[4] = payload.length & 0xff; f[5] = payload.length >> 8;
    const sum = payload.reduce((a, b) => (a + b) & 0xffff, 0);
    f[6] = sum & 0xff; f[7] = sum >> 8;
    f.set(payload, 8);
    return f;
  }
  const gen2ImuCommand = (on, rate = 2) => gen2Frame(G2.IMU_CTRL, new Uint8Array([on ? 1 : 0, on ? rate : 0]));
  function gen2Parse(b) {
    if (b.length < 8 || b[0] !== 0x10 || b[1] !== 0x00) return null;
    const msgId = b[2] | (b[3] << 8), len = b[4] | (b[5] << 8);
    if (b.length < 8 + len) return null;
    const payload = b.subarray(8, 8 + len);
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (msgId === G2.EVT_POSE && len >= 24)
      return { type: "pose", tick: dv.getUint32(4, true), q: [dv.getFloat32(8, true), dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)] };
    if (msgId === G2.IMU_ACK) return { type: "ack", ok: payload[0] === 0 };
    return { type: "other", msgId };
  }

  /* ---------- Gen1 ---------- */
  const CRC = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 8; for (let j = 0; j < 8; j++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1; CRC[i] = c & 0xffff; }
  const crc16 = (d, s, n) => { let c = 0xffff; for (let i = s; i < s + n; i++) c = ((c << 8) ^ CRC[((c >> 8) ^ d[i]) & 0xff]) & 0xffff; return c; };
  let g1Counter = 0;
  function gen1Command(cmdId, data) {
    const p = new Uint8Array(19 + data.length);
    p[0] = 0xff; p[1] = 0xfe;
    const payloadLen = 13 + data.length; p[4] = payloadLen & 0xff; p[5] = payloadLen >> 8;
    p[14] = cmdId & 0xff; p[15] = cmdId >> 8;
    g1Counter = (g1Counter + 1) & 0xffff; p[16] = g1Counter & 0xff; p[17] = g1Counter >> 8;
    p.set(data, 18); p[p.length - 1] = 0x03;
    const c = crc16(p, 4, p.length - 4); p[2] = c >> 8; p[3] = c & 0xff;
    return p;
  }
  const gen1ImuCommand = on => gen1Command(0x15, new Uint8Array([on ? 1 : 0]));
  function zyxToQuat(roll, pitch, yaw) {
    const r = roll / DEG / 2, p = pitch / DEG / 2, y = yaw / DEG / 2;
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
  }
  function gen1Parse(b) {
    if (b.length < 30 || b[0] !== 0xff || b[1] !== 0xfc) return null;
    const f = o => new DataView(new Uint8Array([b[o + 3], b[o + 2], b[o + 1], b[o]]).buffer).getFloat32(0, true);
    const a = f(18), m = f(22), c = f(26);
    if (![a, m, c].every(v => isFinite(v) && Math.abs(v) <= 360)) return null;
    // Gen1 sends euler degrees; the community driver reports raw2 (c) as the head up/down angle.
    // The up/down angle cannot pass ±90° in Euler form: past vertical (prostration is ~100–120° below
    // looking ahead) it folds back while the other two jump by 180°. qd is the same orientation as a
    // quaternion (ZYX, roll = −raw1, pitch = raw2, yaw = −raw0, as in the community WebHID driver),
    // which is continuous through vertical; the teach-in works on it.
    return { type: "euler", euler: { x: c, y: m, z: a }, pitch: c, qd: zyxToQuat(-m, c, -a) };
  }

  /* ---------- angles ---------- */
  // ZYX euler of [w,x,y,z]; names follow the aerospace convention (X=roll, Y=pitch, Z=yaw).
  // On the Pro 2 the glasses frame has Y up, so the head nod is the X angle.
  function euler(q) {
    const [w, x, y, z] = q;
    return { x: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
             y: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * DEG,
             z: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG };
  }
  // Elevation of the gaze direction, independent of heading and gimbal issues.
  // forward = device -Z rotated into the world; pitch = asin(forward.up) with Y up.
  function gazePitch(q, forward = [0, 0, -1], up = 1) {
    const [w, x, y, z] = q, [vx, vy, vz] = forward;
    // v' = q v q*  (vector rotation)
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    const r = [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
    return Math.asin(Math.max(-1, Math.min(1, r[up]))) * DEG;
  }
  const quatConj = q => [q[0], -q[1], -q[2], -q[3]];
  const quatMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  // Learn the nod axis from two poses: qA = looking ahead, qB = head down. Frame-agnostic: the
  // axis is taken from the body-frame rotation between them, so no assumption about which device
  // axis is up or forward. Returns { ref, n, angle } or null when the move was too small.
  function learnNod(a, b) {
    const qA = a.q || a.qd || (Array.isArray(a) ? a : null), qB = b.q || b.qd || (Array.isArray(b) ? b : null);
    if (qA && qB) {
      const d = quatMul(quatConj(qA), qB), s = d[0] < 0 ? -1 : 1;
      const v = [d[1] * s, d[2] * s, d[3] * s], m = Math.hypot(v[0], v[1], v[2]);
      const angle = 2 * Math.atan2(m, d[0] * s) * DEG;
      if (m < 1e-6) return null;
      return { kind: "q", ref: qA, n: v.map(x => x / m), angle };
    }
    // Legacy (samples without a quaternion): pick the angle that moved most, signed so head-down is negative.
    // Only valid while the nod stays within ±90°; kept so teach-ins saved by older versions keep working.
    if (!a.euler || !b.euler) return null;
    let best = null;
    for (const k of ["x", "y", "z"]) {
      let d = b.euler[k] - a.euler[k]; d = ((d + 540) % 360) - 180;      // shortest way round
      if (!best || Math.abs(d) > best.angle) best = { kind: "e", axis: k, inv: d > 0, angle: Math.abs(d), ref: a.euler[k] };
    }
    return best && best.angle > 1e-6 ? best : null;
  }
  // Twist of the body-frame rotation since `ref` about the learned nod axis: 0 at the reference,
  // negative with the head down. Turning the head (about the body-up axis) barely changes it.
  function nodPitch(sample, nod) {
    if (nod.kind === "e") {
      if (!sample.euler) return NaN;
      let d = sample.euler[nod.axis] - nod.ref; d = ((d + 540) % 360) - 180;
      return nod.inv ? -d : d;
    }
    const q = sample.q || sample.qd || sample;
    const d = quatMul(quatConj(nod.ref), q), s = d[0] < 0 ? -1 : 1;
    const dot = (d[1] * nod.n[0] + d[2] * nod.n[1] + d[3] * nod.n[2]) * s;
    return -2 * Math.atan2(dot, d[0] * s) * DEG;
  }
  // axis: "learned" (needs nod), "gaze", "x", "y" or "z"; invert flips the sign.
  function headPitch(sample, axis = "gaze", invert = false, nod = null) {
    let p;
    if (axis === "learned" && nod) p = nodPitch(sample, nod);
    else if (sample.q) p = axis === "gaze" || axis === "learned" ? gazePitch(sample.q) : euler(sample.q)[axis];
    else p = axis === "gaze" || axis === "learned" ? sample.pitch : sample.euler[axis];
    if (!isFinite(p)) p = sample.q ? gazePitch(sample.q) : sample.pitch;
    return invert ? -p : p;
  }

  /* ---------- WebHID session ---------- */
  const supported = () => typeof navigator !== "undefined" && !!navigator.hid;
  class Session {
    constructor() { this.devices = []; this.gen = null; this.frames = 0; this.onPose = null; this.onStatus = null; this.lastAt = 0; }
    status(s) { this.onStatus?.(s); }
    get connected() { return this.devices.some(d => d.opened); }
    get name() { const d = this.devices[0]; return d ? `${NAMES[d.productId] || d.productName || "VITURE"} · ${d.productId.toString(16)} · Gen${this.gen}` : ""; }

    // Prompts the chooser (needs a user gesture). Afterwards reconnect() works silently on reload.
    async connect() {
      if (!supported()) throw new Error("WebHID غير مدعوم. استخدم Chrome على الكمبيوتر");
      const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID }] });
      if (!picked.length) throw new Error("لم تُختر نظارة");
      return this._open();
    }
    async reconnect() {
      if (!supported()) return false;
      const any = (await navigator.hid.getDevices()).some(d => d.vendorId === VENDOR_ID);
      return any ? this._open() : false;
    }
    async _open() {
      await this.close();
      const all = (await navigator.hid.getDevices()).filter(d => d.vendorId === VENDOR_ID);
      if (!all.length) throw new Error("النظارة غير موصولة");
      this.gen = GEN1_PIDS.includes(all[0].productId) ? 1 : 2;
      for (const d of all) {
        try { if (!d.opened) await d.open(); } catch (e) { continue; }
        d.addEventListener("inputreport", this._onReport);
        this.devices.push(d);
      }
      if (!this.connected) throw new Error("تعذّر فتح النظارة. أغلق تطبيقات VITURE الأخرى وجرّب مرة ثانية");
      navigator.hid.addEventListener("disconnect", this._onDisconnect);
      await this._send(true);
      this.status("connected");
      this.frames = 0;
      setTimeout(() => { if (this.connected && !this.frames) this.status("nodata"); }, 3000);
      return true;
    }
    async _send(on) {
      const cmd = this.gen === 2 ? gen2ImuCommand(on) : gen1ImuCommand(on);
      for (const d of this.devices) { try { await d.sendReport(0, cmd); } catch {} }
    }
    _onReport = e => {
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const s = this.gen === 2 ? gen2Parse(b) : gen1Parse(b);
      if (!s || (s.type !== "pose" && s.type !== "euler")) return;
      this.frames++; this.lastAt = Date.now(); this.last = s;
      this.onPose?.(s);
    };
    _onDisconnect = e => { if (this.devices.includes(e.device)) { this.devices = this.devices.filter(d => d !== e.device); if (!this.connected) this.status("disconnected"); } };
    async close() {
      if (this.devices.length) { try { await this._send(false); } catch {} }
      for (const d of this.devices) { d.removeEventListener("inputreport", this._onReport); try { await d.close(); } catch {} }
      this.devices = [];
      if (supported()) navigator.hid.removeEventListener("disconnect", this._onDisconnect);
    }
  }

  return { VENDOR_ID, NAMES, supported, Session, euler, gazePitch, headPitch, learnNod, nodPitch, quatMul, quatConj, zyxToQuat, gen2Frame, gen2ImuCommand, gen2Parse, gen1Command, gen1ImuCommand, gen1Parse, crc16 };
})();
if (typeof module !== "undefined") module.exports = VitureIMU;
