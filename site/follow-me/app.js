// sdk/NetRtt.ts
var API_NAME = "net.rtt";
var API_VERSION = 1;
var SCHEMA = 13895670401115001803n;
var CALL_DEADLINE_MS = 8e3;
var HEADER = 17;
var MAX_PAYLOAD = 16 << 20;
var K_HELLO = 0;
var K_REQ = 1;
var K_RESP = 2;
var K_ERR = 3;
var K_SUB = 5;
var K_ITEM = 6;
var K_END = 7;
var WireError = class extends Error {
};
var Timeout = class extends WireError {
};
var Closed = class extends WireError {
};
var DecodeError = class extends WireError {
};
var Refused = class extends WireError {
  kind;
  detail;
  extra;
  constructor(kind, detail, extra = {}) {
    super(detail === void 0 ? kind : `${kind}: ${String(detail)}`);
    this.kind = kind;
    this.detail = detail;
    this.extra = extra;
  }
};
var W = class {
  buf = new Uint8Array(64);
  len = 0;
  room(n) {
    if (this.len + n <= this.buf.length)
      return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  varint(v) {
    if (typeof v === "number") {
      while (v >= 128) {
        this.byte(v % 128 | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    } else {
      while (v >= 0x80n) {
        this.byte(Number(v & 0x7fn) | 128);
        v >>= 7n;
      }
      this.byte(Number(v));
    }
  }
  out() {
    return this.buf.slice(0, this.len);
  }
};
var R = class {
  i = 0;
  b;
  constructor(b) {
    this.b = b;
  }
  take(n) {
    if (n < 0 || this.i + n > this.b.length)
      throw new DecodeError("unexpected end of data");
    const v = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return v;
  }
  byte() {
    return this.take(1)[0];
  }
  varint() {
    let x = 0, mul = 1;
    for (let n = 0; n < 8; n++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (!(c & 128))
        return x;
      mul *= 128;
    }
    throw new DecodeError("varint too long for a number");
  }
  varbig() {
    let x = 0n, sh = 0n;
    for (let n = 0; n < 20; n++) {
      const c = this.byte();
      x |= BigInt(c & 127) << sh;
      if (!(c & 128))
        return x;
      sh += 7n;
    }
    throw new DecodeError("varint too long");
  }
  dv(n) {
    const s = this.take(n);
    return new DataView(s.buffer, s.byteOffset, n);
  }
};
var te = new TextEncoder();
var td = new TextDecoder("utf-8", { fatal: true });
function uint(bits) {
  const mx = 2 ** bits - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < 0 || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varint();
      if (v > mx)
        throw new DecodeError(`u${bits} overflow`);
      return v;
    }
  };
}
function sint(bits) {
  const lo = -(2 ** (bits - 1)), hi = 2 ** (bits - 1) - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v >= 0 ? v * 2 : -v * 2 - 1);
    },
    dec(r) {
      const z = r.varint();
      const v = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      if (v < lo || v > hi)
        throw new DecodeError(`i${bits} overflow`);
      return v;
    }
  };
}
function ubig(bits) {
  const mx = (1n << BigInt(bits)) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < 0n || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varbig();
      if (v > mx)
        throw new DecodeError(`u${bits} overflow`);
      return v;
    }
  };
}
function sbig(bits) {
  const b = BigInt(bits);
  const lo = -(1n << b - 1n), hi = (1n << b - 1n) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v << 1n ^ v >> b - 1n);
    },
    dec(r) {
      const z = r.varbig();
      const v = z >> 1n ^ -(z & 1n);
      if (v < lo || v > hi)
        throw new DecodeError(`i${bits} overflow`);
      return v;
    }
  };
}
var u16 = uint(16);
var u32 = uint(32);
var i16 = sint(16);
var i32 = sint(32);
var u64 = ubig(64);
var u128 = ubig(128);
var i64 = sbig(64);
var i128 = sbig(128);
var f64 = {
  enc(w, v) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v, true);
    w.bytes(new Uint8Array(d.buffer));
  },
  dec: (r) => r.dv(8).getFloat64(0, true)
};
var bool = {
  enc: (w, v) => w.byte(v ? 1 : 0),
  dec(r) {
    const c = r.byte();
    if (c > 1)
      throw new DecodeError("bad bool");
    return c === 1;
  }
};
var str = {
  enc(w, v) {
    const d = te.encode(v);
    w.varint(d.length);
    w.bytes(d);
  },
  dec(r) {
    try {
      return td.decode(r.take(r.varint()));
    } catch (e) {
      if (e instanceof WireError)
        throw e;
      throw new DecodeError(String(e));
    }
  }
};
var unit = { enc() {
}, dec: () => null };
var bytes = {
  enc(w, v) {
    w.varint(v.length);
    w.bytes(v);
  },
  dec: (r) => r.take(r.varint()).slice()
};
function vec(c) {
  return {
    enc(w, v) {
      w.varint(v.length);
      for (const x of v)
        c.enc(w, x);
    },
    dec(r) {
      const n = r.varint();
      if (n > MAX_PAYLOAD)
        throw new DecodeError("vec too long");
      const o = [];
      for (let i = 0; i < n; i++)
        o.push(c.dec(r));
      return o;
    }
  };
}
function res(ok, err) {
  return {
    enc(w, v) {
      if ("ok" in v) {
        w.byte(0);
        ok.enc(w, v.ok);
      } else {
        w.byte(1);
        err.enc(w, v.err);
      }
    },
    dec(r) {
      const t = r.byte();
      if (t === 0)
        return { ok: ok.dec(r) };
      if (t === 1)
        return { err: err.dec(r) };
      throw new DecodeError("bad result tag");
    }
  };
}
var TABLE = {};
function ref(name) {
  return { enc: (w, v) => TABLE[name].enc(w, v), dec: (r) => TABLE[name].dec(r) };
}
function struct(fields) {
  return {
    enc(w, v) {
      for (const [k, c] of fields)
        c.enc(w, v[k]);
    },
    dec(r) {
      const o = {};
      for (const [k, c] of fields)
        o[k] = c.dec(r);
      return o;
    }
  };
}
function enumOf(variants) {
  return {
    enc(w, v) {
      const i = variants.findIndex(([n]) => n === v.tag);
      if (i < 0)
        throw new RangeError(`not a variant of this enum: ${JSON.stringify(v)}`);
      w.varint(i);
      for (const [k, c] of variants[i][1])
        c.enc(w, v[k]);
    },
    dec(r) {
      const i = r.varint();
      if (i >= variants.length)
        throw new DecodeError(`enum variant ${i} out of range`);
      const o = { tag: variants[i][0] };
      for (const [k, c] of variants[i][1])
        o[k] = c.dec(r);
      return o;
    }
  };
}
function encode(c, v) {
  const w = new W();
  c.enc(w, v);
  return w.out();
}
function decode(c, body) {
  const r = new R(body);
  const v = c.dec(r);
  if (r.i !== body.length)
    throw new DecodeError("trailing bytes");
  return v;
}
function frame(kind, id, op, payload = new Uint8Array()) {
  const b = new Uint8Array(HEADER + payload.length);
  const d = new DataView(b.buffer);
  d.setUint32(0, payload.length, true);
  b[4] = kind;
  d.setBigUint64(5, BigInt(id), true);
  d.setUint32(13, op, true);
  b.set(payload, HEADER);
  return b;
}
function adaptError(r) {
  const i = r.varint();
  switch (i) {
    case 0:
      return { kind: "Narrow", field: str.dec(r), value: str.dec(r) };
    case 1:
      return { kind: "NoVariant", field: str.dec(r), variant: str.dec(r) };
    case 2:
      return { kind: "Missing", field: str.dec(r) };
    case 3:
      return { kind: "NoPath" };
    case 4:
      return { kind: "Decode", why: str.dec(r) };
    default:
      throw new DecodeError(`unknown AdaptError variant ${i}`);
  }
}
function refusal(body) {
  const r = new R(body);
  const i = r.varint();
  switch (i) {
    case 0:
      return { ok: r.varbig() };
    case 1: {
      const ours = r.varbig(), theirs = r.varbig(), api = str.dec(r);
      return new Refused("Schema", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api})`, { ours, theirs, api });
    }
    case 4:
      return new Refused("UnknownOp", r.varint());
    case 8: {
      const ours = r.varbig(), theirs = r.varbig(), api = str.dec(r), update = str.dec(r);
      return new Refused("SchemaAt", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api}): ${update}`, { ours, theirs, api, update });
    }
    case 9: {
      const api = str.dec(r), op = r.varint(), op_name = str.dec(r), ours = r.varint(), theirs = r.varint();
      const why = adaptError(r);
      return new Refused("Adapt", `${api} op ${op_name} (#${op}) v${theirs} <-> v${ours}: ${JSON.stringify(why)}`, { api, op, op_name, ours, theirs, why });
    }
    case 10: {
      const api = str.dec(r), op = r.varint(), op_name = str.dec(r), ours = r.varbig(), theirs = r.varbig();
      return new Refused("SchemaMismatch", `${api} op ${op_name} (#${op}): server shape 0x${ours.toString(16)}, this client 0x${theirs.toString(16)}`, { api, op, op_name, ours, theirs });
    }
    default: {
      const names = { 2: "Gate", 3: "Right", 5: "NoCell", 6: "Decode", 7: "Remote" };
      if (!(i in names))
        throw new DecodeError(`unknown Refusal variant ${i}`);
      return new Refused(names[i], str.dec(r));
    }
  }
}
function refused(body) {
  try {
    const r = refusal(body);
    return r instanceof Refused ? r : new Refused("Ok");
  } catch {
    return new Refused("Remote", "bad error body");
  }
}
var HELLO_DOMAIN = "ce-wire-hello-v1";
var PKCS8_ED25519 = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
function b64u(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function grantFromLink(href = location.href) {
  const u = new URL(href);
  const f = new URLSearchParams(u.hash.slice(1));
  const g = f.get("g");
  if (!g)
    return null;
  const [k, c] = g.split(".");
  const url = f.get("w") ?? `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/wire`;
  return { url, seed: b64u(k), chain: b64u(c) };
}
var WebKey = class _WebKey {
  nodeId;
  key;
  constructor(nodeId, key) {
    this.nodeId = nodeId;
    this.key = key;
  }
  static async fromSeed(seed) {
    const der = new Uint8Array(48);
    der.set(PKCS8_ED25519);
    der.set(seed, 16);
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return new _WebKey(b64u(jwk.x), key);
  }
  async sign(data) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.key, data));
  }
};
async function webProof(g, api = API_NAME, schema = SCHEMA) {
  const k = await WebKey.fromSeed(g.seed);
  const unixMs = BigInt(Date.now());
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const s = new W();
  str.enc(s, HELLO_DOMAIN);
  str.enc(s, api);
  u64.enc(s, schema);
  u64.enc(s, unixMs);
  s.bytes(nonce);
  s.bytes(k.nodeId);
  bytes.enc(s, g.chain);
  const sig = await k.sign(s.out());
  const p = new W();
  p.bytes(k.nodeId);
  u64.enc(p, unixMs);
  p.bytes(nonce);
  bytes.enc(p, g.chain);
  bytes.enc(p, sig);
  return p.out();
}
var Subscription = class {
  q = [];
  waiter = null;
  done = false;
  c;
  id;
  op;
  codec;
  constructor(c, id, op, codec) {
    this.c = c;
    this.id = id;
    this.op = op;
    this.codec = codec;
  }
  /** @internal */
  push(m) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(m);
    } else
      this.q.push(m);
  }
  /** Next item, or `undefined` when the server ended the stream normally. */
  async next(timeoutMs) {
    if (this.done)
      return void 0;
    const m = await new Promise((res6, rej) => {
      if (this.q.length)
        return res6(this.q.shift());
      let t;
      this.waiter = (x) => {
        if (t)
          clearTimeout(t);
        res6(x);
      };
      if (timeoutMs !== void 0)
        t = setTimeout(() => {
          this.waiter = null;
          rej(new Timeout("no item"));
        }, timeoutMs);
    });
    if (m === null) {
      this.finish();
      throw new Closed("connection closed");
    }
    const [kind, body] = m;
    if (kind === K_ITEM)
      return decode(this.codec, body);
    this.finish();
    if (kind === K_END)
      return void 0;
    throw refused(body);
  }
  finish() {
    this.done = true;
    this.c.subs.delete(this.id);
  }
  close() {
    if (this.done)
      return;
    this.finish();
    this.c.send(frame(K_END, this.id, this.op));
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (; ; ) {
        const v = await this.next();
        if (v === void 0)
          return;
        yield v;
      }
    } finally {
      this.close();
    }
  }
};
var ConnBase = class _ConnBase {
  session = 0n;
  deadlineMs = CALL_DEADLINE_MS;
  nextId = 1;
  buf = new Uint8Array(0);
  pending = /* @__PURE__ */ new Map();
  /** @internal */
  subs = /* @__PURE__ */ new Map();
  closed = false;
  first = null;
  ws;
  constructor(ws) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => this.onClose();
  }
  onData(d) {
    if (this.buf.length) {
      const b = new Uint8Array(this.buf.length + d.length);
      b.set(this.buf);
      b.set(d, this.buf.length);
      this.buf = b;
    } else
      this.buf = d;
    for (; ; ) {
      if (this.buf.length < HEADER)
        return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const len = v.getUint32(0, true);
      if (len > MAX_PAYLOAD)
        return void this.ws.close();
      if (this.buf.length < HEADER + len)
        return;
      const kind = this.buf[4];
      const id = Number(v.getBigUint64(5, true));
      const body = this.buf.slice(HEADER, HEADER + len);
      this.buf = this.buf.subarray(HEADER + len);
      if (this.first) {
        const f = this.first;
        this.first = null;
        f([kind, id, body]);
        continue;
      }
      const sub = kind === K_ITEM || kind === K_END || kind === K_ERR ? this.subs.get(id) : void 0;
      if (sub) {
        sub.push([kind, body]);
        if (kind !== K_ITEM)
          this.subs.delete(id);
        continue;
      }
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w([kind, body]);
      }
    }
  }
  onClose() {
    this.closed = true;
    if (this.first) {
      const f = this.first;
      this.first = null;
      f(null);
    }
    for (const w of this.pending.values())
      w(null);
    this.pending.clear();
    for (const s of this.subs.values())
      s.push(null);
    this.subs.clear();
  }
  /** @internal */
  send(b) {
    if (this.closed)
      throw new Closed("connection closed");
    this.ws.send(b);
  }
  /** @internal Open `url`, say Hello as `api`, wait for the answer. */
  static async open(url, hello, waitMs) {
    const ws = new WebSocket(url);
    await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        ws.close();
        rej(new Timeout(`connect ${url}`));
      }, waitMs);
      ws.onopen = () => {
        clearTimeout(t);
        res6();
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new WireError(`connect ${url}: refused or unreachable`));
      };
    });
    const c = new _ConnBase(ws);
    const ans = new Promise((res6, rej) => {
      c.first = res6;
      setTimeout(() => {
        if (c.first === res6) {
          c.first = null;
          ws.close();
          rej(new Timeout("no Hello answer"));
        }
      }, waitMs);
    });
    ws.send(frame(K_HELLO, 0, 0, hello));
    const m = await ans;
    if (m === null)
      throw new Closed("connection closed");
    const r = refusal(m[2]);
    if (m[0] !== K_HELLO || r instanceof Refused) {
      ws.close();
      throw r instanceof Refused ? r : new Refused("Ok");
    }
    c.session = r.ok;
    return c;
  }
  /** @internal */
  async call(op, qc, pc, req, waitMs = 0) {
    const deadlineMs = Math.max(this.deadlineMs, waitMs);
    const payload = encode(qc, req);
    const id = this.nextId++;
    const got = await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Timeout(`op ${op} took over ${deadlineMs} ms`));
      }, deadlineMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res6(m);
      });
      try {
        this.send(frame(K_REQ, id, op, payload));
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        rej(e);
      }
    });
    if (got === null)
      throw new Closed("connection closed");
    if (got[0] === K_RESP)
      return decode(pc, got[1]);
    throw refused(got[1]);
  }
  /** @internal */
  subscribeOp(op, qc, ic, req) {
    const payload = encode(qc, req);
    const id = this.nextId++;
    const sub = new Subscription(this, id, op, ic);
    if (this.closed)
      throw new Closed("connection closed");
    this.subs.set(id, sub);
    this.send(frame(K_SUB, id, op, payload));
    return sub;
  }
  close() {
    this.ws.close();
  }
};
async function connectWeb(g, waitMs, instance = "") {
  const key = instance ? `${API_NAME}#${instance}` : API_NAME;
  const w = new W();
  str.enc(w, key);
  u32.enc(w, API_VERSION);
  u64.enc(w, SCHEMA);
  bytes.enc(w, g.everyone !== void 0 ? new TextEncoder().encode("ceeveryn" + g.everyone) : await webProof(g, key));
  bool.enc(w, false);
  return ConnBase.open(g.url, w.out(), waitMs);
}
TABLE["Health"] = struct([["ok", bool], ["version", str], ["uptime_s", u64]]);
TABLE["Ref"] = struct([["label", str], ["kind", str], ["to", str]]);
TABLE["Pong"] = struct([["nonce", u64], ["node", str], ["at_ms", u64]]);
TABLE["Device"] = struct([["node", str], ["label", str], ["ws_url", str], ["lat", f64], ["lon", f64], ["refs", vec(ref("Ref"))]]);
TABLE["Sample"] = struct([["node", str], ["rtt_ms", f64]]);
TABLE["Samples"] = struct([["samples", vec(ref("Sample"))]]);
TABLE["Latest"] = struct([["samples", vec(ref("Sample"))], ["age_ms", u64], ["refs", vec(ref("Ref"))]]);
TABLE["RttError"] = enumOf([["Invalid", [["f0", str]]], ["Limited", [["f0", str]]], ["Failed", [["f0", str]]]]);
TABLE["SpawnReq"] = struct([["node", str], ["n", u32]]);
TABLE["SpawnResp"] = struct([["ids", vec(str)]]);
TABLE["InstancesReq"] = struct([["node", str]]);
TABLE["InstancesResp"] = struct([["ids", vec(str)]]);
TABLE["StopIdReq"] = struct([["id", str]]);
TABLE["StopIdResp"] = struct([["stopped", bool]]);
TABLE["DeployReq"] = struct([["node", str], ["version", str]]);
TABLE["DeployResp"] = struct([["ok", bool], ["version", str]]);
TABLE["BenchReq"] = struct([["op", str], ["n", u32]]);
TABLE["BenchResp"] = struct([["p50_ms", f64], ["p95_ms", f64], ["errors", u32]]);
TABLE["CellOpsError"] = enumOf([["Invalid", [["f0", str]]], ["Failed", [["f0", str]]]]);
var NetRttClient = class _NetRttClient {
  conn;
  constructor(conn) {
    this.conn = conn;
  }
  /** Through the wire.ws-door in `g` (default: the grant in this page's link); `instance` names one instance of the api (Rust by_instance). */
  static async connect(g = grantFromLink(), waitMs = 1e4, instance = "") {
    if (!g)
      throw new Refused("Gate", "no grant in this link (#g=...)");
    return new _NetRttClient(await connectWeb(g, waitMs, instance));
  }
  close() {
    this.conn.close();
  }
  /** op HealthOp (needs net.rtt:health). */
  healthOp() {
    return this.conn.call(1, unit, ref("Health"), null);
  }
  /** op Ping (needs net.rtt:ping). */
  ping(req) {
    return this.conn.call(2, u64, ref("Pong"), req);
  }
  /** op Here (needs net.rtt:read). */
  here() {
    return this.conn.call(3, unit, ref("Device"), null);
  }
  /** op Devices (needs net.rtt:read). */
  devices() {
    return this.conn.call(4, unit, res(vec(ref("Device")), ref("RttError")), null, 8e3);
  }
  /** op Report (needs net.rtt:report). */
  report(req) {
    return this.conn.call(5, ref("Samples"), res(u32, ref("RttError")), req);
  }
  /** op LatestOf (needs net.rtt:read). */
  latestOf(req) {
    return this.conn.call(6, str, ref("Latest"), req);
  }
  /** op CellSpawn (needs net.rtt:spawn). */
  cellSpawn(req) {
    return this.conn.call(900, ref("SpawnReq"), res(ref("SpawnResp"), ref("CellOpsError")), req);
  }
  /** op CellInstances (needs net.rtt:instances). */
  cellInstances(req) {
    return this.conn.call(901, ref("InstancesReq"), res(ref("InstancesResp"), ref("CellOpsError")), req);
  }
  /** op CellStop (needs net.rtt:stop). */
  cellStop(req) {
    return this.conn.call(902, ref("StopIdReq"), res(ref("StopIdResp"), ref("CellOpsError")), req);
  }
  /** op CellDeploy (needs net.rtt:deploy). */
  cellDeploy(req) {
    return this.conn.call(903, ref("DeployReq"), res(ref("DeployResp"), ref("CellOpsError")), req);
  }
  /** op CellBench (needs net.rtt:bench). */
  cellBench(req) {
    return this.conn.call(904, ref("BenchReq"), res(ref("BenchResp"), ref("CellOpsError")), req);
  }
};

// sdk/PlaceNear.ts
var API_NAME2 = "place.near";
var API_VERSION2 = 1;
var SCHEMA2 = 10720766776545291851n;
var CALL_DEADLINE_MS2 = 8e3;
var HEADER2 = 17;
var MAX_PAYLOAD2 = 16 << 20;
var K_HELLO2 = 0;
var K_REQ2 = 1;
var K_RESP2 = 2;
var K_ERR2 = 3;
var K_SUB2 = 5;
var K_ITEM2 = 6;
var K_END2 = 7;
var WireError2 = class extends Error {
};
var Timeout2 = class extends WireError2 {
};
var Closed2 = class extends WireError2 {
};
var DecodeError2 = class extends WireError2 {
};
var Refused2 = class extends WireError2 {
  kind;
  detail;
  extra;
  constructor(kind, detail, extra = {}) {
    super(detail === void 0 ? kind : `${kind}: ${String(detail)}`);
    this.kind = kind;
    this.detail = detail;
    this.extra = extra;
  }
};
var W2 = class {
  buf = new Uint8Array(64);
  len = 0;
  room(n) {
    if (this.len + n <= this.buf.length)
      return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  varint(v) {
    if (typeof v === "number") {
      while (v >= 128) {
        this.byte(v % 128 | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    } else {
      while (v >= 0x80n) {
        this.byte(Number(v & 0x7fn) | 128);
        v >>= 7n;
      }
      this.byte(Number(v));
    }
  }
  out() {
    return this.buf.slice(0, this.len);
  }
};
var R2 = class {
  i = 0;
  b;
  constructor(b) {
    this.b = b;
  }
  take(n) {
    if (n < 0 || this.i + n > this.b.length)
      throw new DecodeError2("unexpected end of data");
    const v = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return v;
  }
  byte() {
    return this.take(1)[0];
  }
  varint() {
    let x = 0, mul = 1;
    for (let n = 0; n < 8; n++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (!(c & 128))
        return x;
      mul *= 128;
    }
    throw new DecodeError2("varint too long for a number");
  }
  varbig() {
    let x = 0n, sh = 0n;
    for (let n = 0; n < 20; n++) {
      const c = this.byte();
      x |= BigInt(c & 127) << sh;
      if (!(c & 128))
        return x;
      sh += 7n;
    }
    throw new DecodeError2("varint too long");
  }
  dv(n) {
    const s = this.take(n);
    return new DataView(s.buffer, s.byteOffset, n);
  }
};
var te2 = new TextEncoder();
var td2 = new TextDecoder("utf-8", { fatal: true });
function uint2(bits) {
  const mx = 2 ** bits - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < 0 || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varint();
      if (v > mx)
        throw new DecodeError2(`u${bits} overflow`);
      return v;
    }
  };
}
function sint2(bits) {
  const lo = -(2 ** (bits - 1)), hi = 2 ** (bits - 1) - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v >= 0 ? v * 2 : -v * 2 - 1);
    },
    dec(r) {
      const z = r.varint();
      const v = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      if (v < lo || v > hi)
        throw new DecodeError2(`i${bits} overflow`);
      return v;
    }
  };
}
function ubig2(bits) {
  const mx = (1n << BigInt(bits)) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < 0n || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varbig();
      if (v > mx)
        throw new DecodeError2(`u${bits} overflow`);
      return v;
    }
  };
}
function sbig2(bits) {
  const b = BigInt(bits);
  const lo = -(1n << b - 1n), hi = (1n << b - 1n) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v << 1n ^ v >> b - 1n);
    },
    dec(r) {
      const z = r.varbig();
      const v = z >> 1n ^ -(z & 1n);
      if (v < lo || v > hi)
        throw new DecodeError2(`i${bits} overflow`);
      return v;
    }
  };
}
var u162 = uint2(16);
var u322 = uint2(32);
var i162 = sint2(16);
var i322 = sint2(32);
var u642 = ubig2(64);
var u1282 = ubig2(128);
var i642 = sbig2(64);
var i1282 = sbig2(128);
var f32 = {
  enc(w, v) {
    const d = new DataView(new ArrayBuffer(4));
    d.setFloat32(0, v, true);
    w.bytes(new Uint8Array(d.buffer));
  },
  dec: (r) => r.dv(4).getFloat32(0, true)
};
var f642 = {
  enc(w, v) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v, true);
    w.bytes(new Uint8Array(d.buffer));
  },
  dec: (r) => r.dv(8).getFloat64(0, true)
};
var bool2 = {
  enc: (w, v) => w.byte(v ? 1 : 0),
  dec(r) {
    const c = r.byte();
    if (c > 1)
      throw new DecodeError2("bad bool");
    return c === 1;
  }
};
var str2 = {
  enc(w, v) {
    const d = te2.encode(v);
    w.varint(d.length);
    w.bytes(d);
  },
  dec(r) {
    try {
      return td2.decode(r.take(r.varint()));
    } catch (e) {
      if (e instanceof WireError2)
        throw e;
      throw new DecodeError2(String(e));
    }
  }
};
var unit2 = { enc() {
}, dec: () => null };
var bytes2 = {
  enc(w, v) {
    w.varint(v.length);
    w.bytes(v);
  },
  dec: (r) => r.take(r.varint()).slice()
};
function vec2(c) {
  return {
    enc(w, v) {
      w.varint(v.length);
      for (const x of v)
        c.enc(w, x);
    },
    dec(r) {
      const n = r.varint();
      if (n > MAX_PAYLOAD2)
        throw new DecodeError2("vec too long");
      const o = [];
      for (let i = 0; i < n; i++)
        o.push(c.dec(r));
      return o;
    }
  };
}
function res2(ok, err) {
  return {
    enc(w, v) {
      if ("ok" in v) {
        w.byte(0);
        ok.enc(w, v.ok);
      } else {
        w.byte(1);
        err.enc(w, v.err);
      }
    },
    dec(r) {
      const t = r.byte();
      if (t === 0)
        return { ok: ok.dec(r) };
      if (t === 1)
        return { err: err.dec(r) };
      throw new DecodeError2("bad result tag");
    }
  };
}
var TABLE2 = {};
function ref2(name) {
  return { enc: (w, v) => TABLE2[name].enc(w, v), dec: (r) => TABLE2[name].dec(r) };
}
function struct2(fields) {
  return {
    enc(w, v) {
      for (const [k, c] of fields)
        c.enc(w, v[k]);
    },
    dec(r) {
      const o = {};
      for (const [k, c] of fields)
        o[k] = c.dec(r);
      return o;
    }
  };
}
function enumOf2(variants) {
  return {
    enc(w, v) {
      const i = variants.findIndex(([n]) => n === v.tag);
      if (i < 0)
        throw new RangeError(`not a variant of this enum: ${JSON.stringify(v)}`);
      w.varint(i);
      for (const [k, c] of variants[i][1])
        c.enc(w, v[k]);
    },
    dec(r) {
      const i = r.varint();
      if (i >= variants.length)
        throw new DecodeError2(`enum variant ${i} out of range`);
      const o = { tag: variants[i][0] };
      for (const [k, c] of variants[i][1])
        o[k] = c.dec(r);
      return o;
    }
  };
}
function encode2(c, v) {
  const w = new W2();
  c.enc(w, v);
  return w.out();
}
function decode2(c, body) {
  const r = new R2(body);
  const v = c.dec(r);
  if (r.i !== body.length)
    throw new DecodeError2("trailing bytes");
  return v;
}
function frame2(kind, id, op, payload = new Uint8Array()) {
  const b = new Uint8Array(HEADER2 + payload.length);
  const d = new DataView(b.buffer);
  d.setUint32(0, payload.length, true);
  b[4] = kind;
  d.setBigUint64(5, BigInt(id), true);
  d.setUint32(13, op, true);
  b.set(payload, HEADER2);
  return b;
}
function adaptError2(r) {
  const i = r.varint();
  switch (i) {
    case 0:
      return { kind: "Narrow", field: str2.dec(r), value: str2.dec(r) };
    case 1:
      return { kind: "NoVariant", field: str2.dec(r), variant: str2.dec(r) };
    case 2:
      return { kind: "Missing", field: str2.dec(r) };
    case 3:
      return { kind: "NoPath" };
    case 4:
      return { kind: "Decode", why: str2.dec(r) };
    default:
      throw new DecodeError2(`unknown AdaptError variant ${i}`);
  }
}
function refusal2(body) {
  const r = new R2(body);
  const i = r.varint();
  switch (i) {
    case 0:
      return { ok: r.varbig() };
    case 1: {
      const ours = r.varbig(), theirs = r.varbig(), api = str2.dec(r);
      return new Refused2("Schema", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api})`, { ours, theirs, api });
    }
    case 4:
      return new Refused2("UnknownOp", r.varint());
    case 8: {
      const ours = r.varbig(), theirs = r.varbig(), api = str2.dec(r), update = str2.dec(r);
      return new Refused2("SchemaAt", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api}): ${update}`, { ours, theirs, api, update });
    }
    case 9: {
      const api = str2.dec(r), op = r.varint(), op_name = str2.dec(r), ours = r.varint(), theirs = r.varint();
      const why = adaptError2(r);
      return new Refused2("Adapt", `${api} op ${op_name} (#${op}) v${theirs} <-> v${ours}: ${JSON.stringify(why)}`, { api, op, op_name, ours, theirs, why });
    }
    case 10: {
      const api = str2.dec(r), op = r.varint(), op_name = str2.dec(r), ours = r.varbig(), theirs = r.varbig();
      return new Refused2("SchemaMismatch", `${api} op ${op_name} (#${op}): server shape 0x${ours.toString(16)}, this client 0x${theirs.toString(16)}`, { api, op, op_name, ours, theirs });
    }
    default: {
      const names = { 2: "Gate", 3: "Right", 5: "NoCell", 6: "Decode", 7: "Remote" };
      if (!(i in names))
        throw new DecodeError2(`unknown Refusal variant ${i}`);
      return new Refused2(names[i], str2.dec(r));
    }
  }
}
function refused2(body) {
  try {
    const r = refusal2(body);
    return r instanceof Refused2 ? r : new Refused2("Ok");
  } catch {
    return new Refused2("Remote", "bad error body");
  }
}
var HELLO_DOMAIN2 = "ce-wire-hello-v1";
var PKCS8_ED255192 = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
function b64u2(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function grantFromLink2(href = location.href) {
  const u = new URL(href);
  const f = new URLSearchParams(u.hash.slice(1));
  const g = f.get("g");
  if (!g)
    return null;
  const [k, c] = g.split(".");
  const url = f.get("w") ?? `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/wire`;
  return { url, seed: b64u2(k), chain: b64u2(c) };
}
var WebKey2 = class _WebKey {
  nodeId;
  key;
  constructor(nodeId, key) {
    this.nodeId = nodeId;
    this.key = key;
  }
  static async fromSeed(seed) {
    const der = new Uint8Array(48);
    der.set(PKCS8_ED255192);
    der.set(seed, 16);
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return new _WebKey(b64u2(jwk.x), key);
  }
  async sign(data) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.key, data));
  }
};
async function webProof2(g, api = API_NAME2, schema = SCHEMA2) {
  const k = await WebKey2.fromSeed(g.seed);
  const unixMs = BigInt(Date.now());
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const s = new W2();
  str2.enc(s, HELLO_DOMAIN2);
  str2.enc(s, api);
  u642.enc(s, schema);
  u642.enc(s, unixMs);
  s.bytes(nonce);
  s.bytes(k.nodeId);
  bytes2.enc(s, g.chain);
  const sig = await k.sign(s.out());
  const p = new W2();
  p.bytes(k.nodeId);
  u642.enc(p, unixMs);
  p.bytes(nonce);
  bytes2.enc(p, g.chain);
  bytes2.enc(p, sig);
  return p.out();
}
var Subscription2 = class {
  q = [];
  waiter = null;
  done = false;
  c;
  id;
  op;
  codec;
  constructor(c, id, op, codec) {
    this.c = c;
    this.id = id;
    this.op = op;
    this.codec = codec;
  }
  /** @internal */
  push(m) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(m);
    } else
      this.q.push(m);
  }
  /** Next item, or `undefined` when the server ended the stream normally. */
  async next(timeoutMs) {
    if (this.done)
      return void 0;
    const m = await new Promise((res6, rej) => {
      if (this.q.length)
        return res6(this.q.shift());
      let t;
      this.waiter = (x) => {
        if (t)
          clearTimeout(t);
        res6(x);
      };
      if (timeoutMs !== void 0)
        t = setTimeout(() => {
          this.waiter = null;
          rej(new Timeout2("no item"));
        }, timeoutMs);
    });
    if (m === null) {
      this.finish();
      throw new Closed2("connection closed");
    }
    const [kind, body] = m;
    if (kind === K_ITEM2)
      return decode2(this.codec, body);
    this.finish();
    if (kind === K_END2)
      return void 0;
    throw refused2(body);
  }
  finish() {
    this.done = true;
    this.c.subs.delete(this.id);
  }
  close() {
    if (this.done)
      return;
    this.finish();
    this.c.send(frame2(K_END2, this.id, this.op));
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (; ; ) {
        const v = await this.next();
        if (v === void 0)
          return;
        yield v;
      }
    } finally {
      this.close();
    }
  }
};
var ConnBase2 = class _ConnBase {
  session = 0n;
  deadlineMs = CALL_DEADLINE_MS2;
  nextId = 1;
  buf = new Uint8Array(0);
  pending = /* @__PURE__ */ new Map();
  /** @internal */
  subs = /* @__PURE__ */ new Map();
  closed = false;
  first = null;
  ws;
  constructor(ws) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => this.onClose();
  }
  onData(d) {
    if (this.buf.length) {
      const b = new Uint8Array(this.buf.length + d.length);
      b.set(this.buf);
      b.set(d, this.buf.length);
      this.buf = b;
    } else
      this.buf = d;
    for (; ; ) {
      if (this.buf.length < HEADER2)
        return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const len = v.getUint32(0, true);
      if (len > MAX_PAYLOAD2)
        return void this.ws.close();
      if (this.buf.length < HEADER2 + len)
        return;
      const kind = this.buf[4];
      const id = Number(v.getBigUint64(5, true));
      const body = this.buf.slice(HEADER2, HEADER2 + len);
      this.buf = this.buf.subarray(HEADER2 + len);
      if (this.first) {
        const f = this.first;
        this.first = null;
        f([kind, id, body]);
        continue;
      }
      const sub = kind === K_ITEM2 || kind === K_END2 || kind === K_ERR2 ? this.subs.get(id) : void 0;
      if (sub) {
        sub.push([kind, body]);
        if (kind !== K_ITEM2)
          this.subs.delete(id);
        continue;
      }
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w([kind, body]);
      }
    }
  }
  onClose() {
    this.closed = true;
    if (this.first) {
      const f = this.first;
      this.first = null;
      f(null);
    }
    for (const w of this.pending.values())
      w(null);
    this.pending.clear();
    for (const s of this.subs.values())
      s.push(null);
    this.subs.clear();
  }
  /** @internal */
  send(b) {
    if (this.closed)
      throw new Closed2("connection closed");
    this.ws.send(b);
  }
  /** @internal Open `url`, say Hello as `api`, wait for the answer. */
  static async open(url, hello, waitMs) {
    const ws = new WebSocket(url);
    await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        ws.close();
        rej(new Timeout2(`connect ${url}`));
      }, waitMs);
      ws.onopen = () => {
        clearTimeout(t);
        res6();
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new WireError2(`connect ${url}: refused or unreachable`));
      };
    });
    const c = new _ConnBase(ws);
    const ans = new Promise((res6, rej) => {
      c.first = res6;
      setTimeout(() => {
        if (c.first === res6) {
          c.first = null;
          ws.close();
          rej(new Timeout2("no Hello answer"));
        }
      }, waitMs);
    });
    ws.send(frame2(K_HELLO2, 0, 0, hello));
    const m = await ans;
    if (m === null)
      throw new Closed2("connection closed");
    const r = refusal2(m[2]);
    if (m[0] !== K_HELLO2 || r instanceof Refused2) {
      ws.close();
      throw r instanceof Refused2 ? r : new Refused2("Ok");
    }
    c.session = r.ok;
    return c;
  }
  /** @internal */
  async call(op, qc, pc, req, waitMs = 0) {
    const deadlineMs = Math.max(this.deadlineMs, waitMs);
    const payload = encode2(qc, req);
    const id = this.nextId++;
    const got = await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Timeout2(`op ${op} took over ${deadlineMs} ms`));
      }, deadlineMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res6(m);
      });
      try {
        this.send(frame2(K_REQ2, id, op, payload));
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        rej(e);
      }
    });
    if (got === null)
      throw new Closed2("connection closed");
    if (got[0] === K_RESP2)
      return decode2(pc, got[1]);
    throw refused2(got[1]);
  }
  /** @internal */
  subscribeOp(op, qc, ic, req) {
    const payload = encode2(qc, req);
    const id = this.nextId++;
    const sub = new Subscription2(this, id, op, ic);
    if (this.closed)
      throw new Closed2("connection closed");
    this.subs.set(id, sub);
    this.send(frame2(K_SUB2, id, op, payload));
    return sub;
  }
  close() {
    this.ws.close();
  }
};
async function connectWeb2(g, waitMs, instance = "") {
  const key = instance ? `${API_NAME2}#${instance}` : API_NAME2;
  const w = new W2();
  str2.enc(w, key);
  u322.enc(w, API_VERSION2);
  u642.enc(w, SCHEMA2);
  bytes2.enc(w, g.everyone !== void 0 ? new TextEncoder().encode("ceeveryn" + g.everyone) : await webProof2(g, key));
  bool2.enc(w, false);
  return ConnBase2.open(g.url, w.out(), waitMs);
}
TABLE2["Health"] = struct2([["ok", bool2], ["version", str2], ["uptime_s", u642]]);
TABLE2["Ref"] = struct2([["label", str2], ["kind", str2], ["to", str2]]);
TABLE2["Sample"] = struct2([["node", str2], ["rtt_ms", f642]]);
TABLE2["RankReq"] = struct2([["api", str2], ["major", u162], ["samples", vec2(ref2("Sample"))], ["pool", vec2(str2)]]);
TABLE2["Ranked"] = struct2([["node", str2], ["rtt_ms", f642], ["score", f642], ["holder", bool2], ["why", str2], ["refs", vec2(ref2("Ref"))]]);
TABLE2["WatchReq"] = struct2([["api", str2], ["major", u162], ["hysteresis_ms", u322], ["sustain", u322], ["every_ms", u322]]);
TABLE2["Advice"] = struct2([["api", str2], ["holder", str2], ["best", str2], ["holder_rtt_ms", f642], ["best_rtt_ms", f642], ["gain_ms", f642], ["streak", u322], ["suggest", bool2], ["why", str2], ["refs", vec2(ref2("Ref"))]]);
TABLE2["PlaceError"] = enumOf2([["Invalid", [["f0", str2]]], ["NoSamples", []], ["Failed", [["f0", str2]]]]);
TABLE2["Room"] = struct2([["node", str2], ["free_mem_mb", u642], ["load1", f32], ["cores", u322], ["busy", u322], ["slots", u322]]);
TABLE2["RankRoomReq"] = struct2([["api", str2], ["major", u162], ["samples", vec2(ref2("Sample"))], ["pool", vec2(str2)], ["room", vec2(ref2("Room"))]]);
TABLE2["SpawnReq"] = struct2([["node", str2], ["n", u322]]);
TABLE2["SpawnResp"] = struct2([["ids", vec2(str2)]]);
TABLE2["InstancesReq"] = struct2([["node", str2]]);
TABLE2["InstancesResp"] = struct2([["ids", vec2(str2)]]);
TABLE2["StopIdReq"] = struct2([["id", str2]]);
TABLE2["StopIdResp"] = struct2([["stopped", bool2]]);
TABLE2["DeployReq"] = struct2([["node", str2], ["version", str2]]);
TABLE2["DeployResp"] = struct2([["ok", bool2], ["version", str2]]);
TABLE2["BenchReq"] = struct2([["op", str2], ["n", u322]]);
TABLE2["BenchResp"] = struct2([["p50_ms", f642], ["p95_ms", f642], ["errors", u322]]);
TABLE2["CellOpsError"] = enumOf2([["Invalid", [["f0", str2]]], ["Failed", [["f0", str2]]]]);
var PlaceNearClient = class _PlaceNearClient {
  conn;
  constructor(conn) {
    this.conn = conn;
  }
  /** Through the wire.ws-door in `g` (default: the grant in this page's link); `instance` names one instance of the api (Rust by_instance). */
  static async connect(g = grantFromLink2(), waitMs = 1e4, instance = "") {
    if (!g)
      throw new Refused2("Gate", "no grant in this link (#g=...)");
    return new _PlaceNearClient(await connectWeb2(g, waitMs, instance));
  }
  close() {
    this.conn.close();
  }
  /** op HealthOp (needs place.near:health). */
  healthOp() {
    return this.conn.call(1, unit2, ref2("Health"), null);
  }
  /** op Rank (needs place.near:rank). */
  rank(req) {
    return this.conn.call(2, ref2("RankReq"), res2(vec2(ref2("Ranked")), ref2("PlaceError")), req, 8e3);
  }
  /** op RankRoom (needs place.near:rank). */
  rankRoom(req) {
    return this.conn.call(4, ref2("RankRoomReq"), res2(vec2(ref2("Ranked")), ref2("PlaceError")), req, 8e3);
  }
  /** op CellSpawn (needs place.near:spawn). */
  cellSpawn(req) {
    return this.conn.call(900, ref2("SpawnReq"), res2(ref2("SpawnResp"), ref2("CellOpsError")), req);
  }
  /** op CellInstances (needs place.near:instances). */
  cellInstances(req) {
    return this.conn.call(901, ref2("InstancesReq"), res2(ref2("InstancesResp"), ref2("CellOpsError")), req);
  }
  /** op CellStop (needs place.near:stop). */
  cellStop(req) {
    return this.conn.call(902, ref2("StopIdReq"), res2(ref2("StopIdResp"), ref2("CellOpsError")), req);
  }
  /** op CellDeploy (needs place.near:deploy). */
  cellDeploy(req) {
    return this.conn.call(903, ref2("DeployReq"), res2(ref2("DeployResp"), ref2("CellOpsError")), req);
  }
  /** op CellBench (needs place.near:bench). */
  cellBench(req) {
    return this.conn.call(904, ref2("BenchReq"), res2(ref2("BenchResp"), ref2("CellOpsError")), req);
  }
  /** stream Watch (needs place.near:watch). */
  watch(req) {
    return this.conn.subscribeOp(3, ref2("WatchReq"), ref2("Advice"), req);
  }
};

// sdk/SessionPad.ts
var API_NAME3 = "session.pad";
var API_VERSION3 = 1;
var SCHEMA3 = 13758204382481643093n;
var CALL_DEADLINE_MS3 = 8e3;
var HEADER3 = 17;
var MAX_PAYLOAD3 = 16 << 20;
var K_HELLO3 = 0;
var K_REQ3 = 1;
var K_RESP3 = 2;
var K_ERR3 = 3;
var K_SUB3 = 5;
var K_ITEM3 = 6;
var K_END3 = 7;
var WireError3 = class extends Error {
};
var Timeout3 = class extends WireError3 {
};
var Closed3 = class extends WireError3 {
};
var DecodeError3 = class extends WireError3 {
};
var Refused3 = class extends WireError3 {
  kind;
  detail;
  extra;
  constructor(kind, detail, extra = {}) {
    super(detail === void 0 ? kind : `${kind}: ${String(detail)}`);
    this.kind = kind;
    this.detail = detail;
    this.extra = extra;
  }
};
var W3 = class {
  buf = new Uint8Array(64);
  len = 0;
  room(n) {
    if (this.len + n <= this.buf.length)
      return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  varint(v) {
    if (typeof v === "number") {
      while (v >= 128) {
        this.byte(v % 128 | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    } else {
      while (v >= 0x80n) {
        this.byte(Number(v & 0x7fn) | 128);
        v >>= 7n;
      }
      this.byte(Number(v));
    }
  }
  out() {
    return this.buf.slice(0, this.len);
  }
};
var R3 = class {
  i = 0;
  b;
  constructor(b) {
    this.b = b;
  }
  take(n) {
    if (n < 0 || this.i + n > this.b.length)
      throw new DecodeError3("unexpected end of data");
    const v = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return v;
  }
  byte() {
    return this.take(1)[0];
  }
  varint() {
    let x = 0, mul = 1;
    for (let n = 0; n < 8; n++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (!(c & 128))
        return x;
      mul *= 128;
    }
    throw new DecodeError3("varint too long for a number");
  }
  varbig() {
    let x = 0n, sh = 0n;
    for (let n = 0; n < 20; n++) {
      const c = this.byte();
      x |= BigInt(c & 127) << sh;
      if (!(c & 128))
        return x;
      sh += 7n;
    }
    throw new DecodeError3("varint too long");
  }
  dv(n) {
    const s = this.take(n);
    return new DataView(s.buffer, s.byteOffset, n);
  }
};
var te3 = new TextEncoder();
var td3 = new TextDecoder("utf-8", { fatal: true });
function uint3(bits) {
  const mx = 2 ** bits - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < 0 || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varint();
      if (v > mx)
        throw new DecodeError3(`u${bits} overflow`);
      return v;
    }
  };
}
function sint3(bits) {
  const lo = -(2 ** (bits - 1)), hi = 2 ** (bits - 1) - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v >= 0 ? v * 2 : -v * 2 - 1);
    },
    dec(r) {
      const z = r.varint();
      const v = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      if (v < lo || v > hi)
        throw new DecodeError3(`i${bits} overflow`);
      return v;
    }
  };
}
function ubig3(bits) {
  const mx = (1n << BigInt(bits)) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < 0n || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varbig();
      if (v > mx)
        throw new DecodeError3(`u${bits} overflow`);
      return v;
    }
  };
}
function sbig3(bits) {
  const b = BigInt(bits);
  const lo = -(1n << b - 1n), hi = (1n << b - 1n) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v << 1n ^ v >> b - 1n);
    },
    dec(r) {
      const z = r.varbig();
      const v = z >> 1n ^ -(z & 1n);
      if (v < lo || v > hi)
        throw new DecodeError3(`i${bits} overflow`);
      return v;
    }
  };
}
var u163 = uint3(16);
var u323 = uint3(32);
var i163 = sint3(16);
var i323 = sint3(32);
var u643 = ubig3(64);
var u1283 = ubig3(128);
var i643 = sbig3(64);
var i1283 = sbig3(128);
var f643 = {
  enc(w, v) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v, true);
    w.bytes(new Uint8Array(d.buffer));
  },
  dec: (r) => r.dv(8).getFloat64(0, true)
};
var bool3 = {
  enc: (w, v) => w.byte(v ? 1 : 0),
  dec(r) {
    const c = r.byte();
    if (c > 1)
      throw new DecodeError3("bad bool");
    return c === 1;
  }
};
var str3 = {
  enc(w, v) {
    const d = te3.encode(v);
    w.varint(d.length);
    w.bytes(d);
  },
  dec(r) {
    try {
      return td3.decode(r.take(r.varint()));
    } catch (e) {
      if (e instanceof WireError3)
        throw e;
      throw new DecodeError3(String(e));
    }
  }
};
var unit3 = { enc() {
}, dec: () => null };
var bytes3 = {
  enc(w, v) {
    w.varint(v.length);
    w.bytes(v);
  },
  dec: (r) => r.take(r.varint()).slice()
};
function vec3(c) {
  return {
    enc(w, v) {
      w.varint(v.length);
      for (const x of v)
        c.enc(w, x);
    },
    dec(r) {
      const n = r.varint();
      if (n > MAX_PAYLOAD3)
        throw new DecodeError3("vec too long");
      const o = [];
      for (let i = 0; i < n; i++)
        o.push(c.dec(r));
      return o;
    }
  };
}
function res3(ok, err) {
  return {
    enc(w, v) {
      if ("ok" in v) {
        w.byte(0);
        ok.enc(w, v.ok);
      } else {
        w.byte(1);
        err.enc(w, v.err);
      }
    },
    dec(r) {
      const t = r.byte();
      if (t === 0)
        return { ok: ok.dec(r) };
      if (t === 1)
        return { err: err.dec(r) };
      throw new DecodeError3("bad result tag");
    }
  };
}
var TABLE3 = {};
function ref3(name) {
  return { enc: (w, v) => TABLE3[name].enc(w, v), dec: (r) => TABLE3[name].dec(r) };
}
function struct3(fields) {
  return {
    enc(w, v) {
      for (const [k, c] of fields)
        c.enc(w, v[k]);
    },
    dec(r) {
      const o = {};
      for (const [k, c] of fields)
        o[k] = c.dec(r);
      return o;
    }
  };
}
function enumOf3(variants) {
  return {
    enc(w, v) {
      const i = variants.findIndex(([n]) => n === v.tag);
      if (i < 0)
        throw new RangeError(`not a variant of this enum: ${JSON.stringify(v)}`);
      w.varint(i);
      for (const [k, c] of variants[i][1])
        c.enc(w, v[k]);
    },
    dec(r) {
      const i = r.varint();
      if (i >= variants.length)
        throw new DecodeError3(`enum variant ${i} out of range`);
      const o = { tag: variants[i][0] };
      for (const [k, c] of variants[i][1])
        o[k] = c.dec(r);
      return o;
    }
  };
}
function encode3(c, v) {
  const w = new W3();
  c.enc(w, v);
  return w.out();
}
function decode3(c, body) {
  const r = new R3(body);
  const v = c.dec(r);
  if (r.i !== body.length)
    throw new DecodeError3("trailing bytes");
  return v;
}
function frame3(kind, id, op, payload = new Uint8Array()) {
  const b = new Uint8Array(HEADER3 + payload.length);
  const d = new DataView(b.buffer);
  d.setUint32(0, payload.length, true);
  b[4] = kind;
  d.setBigUint64(5, BigInt(id), true);
  d.setUint32(13, op, true);
  b.set(payload, HEADER3);
  return b;
}
function adaptError3(r) {
  const i = r.varint();
  switch (i) {
    case 0:
      return { kind: "Narrow", field: str3.dec(r), value: str3.dec(r) };
    case 1:
      return { kind: "NoVariant", field: str3.dec(r), variant: str3.dec(r) };
    case 2:
      return { kind: "Missing", field: str3.dec(r) };
    case 3:
      return { kind: "NoPath" };
    case 4:
      return { kind: "Decode", why: str3.dec(r) };
    default:
      throw new DecodeError3(`unknown AdaptError variant ${i}`);
  }
}
function refusal3(body) {
  const r = new R3(body);
  const i = r.varint();
  switch (i) {
    case 0:
      return { ok: r.varbig() };
    case 1: {
      const ours = r.varbig(), theirs = r.varbig(), api = str3.dec(r);
      return new Refused3("Schema", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api})`, { ours, theirs, api });
    }
    case 4:
      return new Refused3("UnknownOp", r.varint());
    case 8: {
      const ours = r.varbig(), theirs = r.varbig(), api = str3.dec(r), update = str3.dec(r);
      return new Refused3("SchemaAt", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api}): ${update}`, { ours, theirs, api, update });
    }
    case 9: {
      const api = str3.dec(r), op = r.varint(), op_name = str3.dec(r), ours = r.varint(), theirs = r.varint();
      const why = adaptError3(r);
      return new Refused3("Adapt", `${api} op ${op_name} (#${op}) v${theirs} <-> v${ours}: ${JSON.stringify(why)}`, { api, op, op_name, ours, theirs, why });
    }
    case 10: {
      const api = str3.dec(r), op = r.varint(), op_name = str3.dec(r), ours = r.varbig(), theirs = r.varbig();
      return new Refused3("SchemaMismatch", `${api} op ${op_name} (#${op}): server shape 0x${ours.toString(16)}, this client 0x${theirs.toString(16)}`, { api, op, op_name, ours, theirs });
    }
    default: {
      const names = { 2: "Gate", 3: "Right", 5: "NoCell", 6: "Decode", 7: "Remote" };
      if (!(i in names))
        throw new DecodeError3(`unknown Refusal variant ${i}`);
      return new Refused3(names[i], str3.dec(r));
    }
  }
}
function refused3(body) {
  try {
    const r = refusal3(body);
    return r instanceof Refused3 ? r : new Refused3("Ok");
  } catch {
    return new Refused3("Remote", "bad error body");
  }
}
var HELLO_DOMAIN3 = "ce-wire-hello-v1";
var PKCS8_ED255193 = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
function b64u3(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function grantFromLink3(href = location.href) {
  const u = new URL(href);
  const f = new URLSearchParams(u.hash.slice(1));
  const g = f.get("g");
  if (!g)
    return null;
  const [k, c] = g.split(".");
  const url = f.get("w") ?? `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/wire`;
  return { url, seed: b64u3(k), chain: b64u3(c) };
}
var WebKey3 = class _WebKey {
  nodeId;
  key;
  constructor(nodeId, key) {
    this.nodeId = nodeId;
    this.key = key;
  }
  static async fromSeed(seed) {
    const der = new Uint8Array(48);
    der.set(PKCS8_ED255193);
    der.set(seed, 16);
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return new _WebKey(b64u3(jwk.x), key);
  }
  async sign(data) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.key, data));
  }
};
async function webProof3(g, api = API_NAME3, schema = SCHEMA3) {
  const k = await WebKey3.fromSeed(g.seed);
  const unixMs = BigInt(Date.now());
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const s = new W3();
  str3.enc(s, HELLO_DOMAIN3);
  str3.enc(s, api);
  u643.enc(s, schema);
  u643.enc(s, unixMs);
  s.bytes(nonce);
  s.bytes(k.nodeId);
  bytes3.enc(s, g.chain);
  const sig = await k.sign(s.out());
  const p = new W3();
  p.bytes(k.nodeId);
  u643.enc(p, unixMs);
  p.bytes(nonce);
  bytes3.enc(p, g.chain);
  bytes3.enc(p, sig);
  return p.out();
}
var Subscription3 = class {
  q = [];
  waiter = null;
  done = false;
  c;
  id;
  op;
  codec;
  constructor(c, id, op, codec) {
    this.c = c;
    this.id = id;
    this.op = op;
    this.codec = codec;
  }
  /** @internal */
  push(m) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(m);
    } else
      this.q.push(m);
  }
  /** Next item, or `undefined` when the server ended the stream normally. */
  async next(timeoutMs) {
    if (this.done)
      return void 0;
    const m = await new Promise((res6, rej) => {
      if (this.q.length)
        return res6(this.q.shift());
      let t;
      this.waiter = (x) => {
        if (t)
          clearTimeout(t);
        res6(x);
      };
      if (timeoutMs !== void 0)
        t = setTimeout(() => {
          this.waiter = null;
          rej(new Timeout3("no item"));
        }, timeoutMs);
    });
    if (m === null) {
      this.finish();
      throw new Closed3("connection closed");
    }
    const [kind, body] = m;
    if (kind === K_ITEM3)
      return decode3(this.codec, body);
    this.finish();
    if (kind === K_END3)
      return void 0;
    throw refused3(body);
  }
  finish() {
    this.done = true;
    this.c.subs.delete(this.id);
  }
  close() {
    if (this.done)
      return;
    this.finish();
    this.c.send(frame3(K_END3, this.id, this.op));
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (; ; ) {
        const v = await this.next();
        if (v === void 0)
          return;
        yield v;
      }
    } finally {
      this.close();
    }
  }
};
var ConnBase3 = class _ConnBase {
  session = 0n;
  deadlineMs = CALL_DEADLINE_MS3;
  nextId = 1;
  buf = new Uint8Array(0);
  pending = /* @__PURE__ */ new Map();
  /** @internal */
  subs = /* @__PURE__ */ new Map();
  closed = false;
  first = null;
  ws;
  constructor(ws) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => this.onClose();
  }
  onData(d) {
    if (this.buf.length) {
      const b = new Uint8Array(this.buf.length + d.length);
      b.set(this.buf);
      b.set(d, this.buf.length);
      this.buf = b;
    } else
      this.buf = d;
    for (; ; ) {
      if (this.buf.length < HEADER3)
        return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const len = v.getUint32(0, true);
      if (len > MAX_PAYLOAD3)
        return void this.ws.close();
      if (this.buf.length < HEADER3 + len)
        return;
      const kind = this.buf[4];
      const id = Number(v.getBigUint64(5, true));
      const body = this.buf.slice(HEADER3, HEADER3 + len);
      this.buf = this.buf.subarray(HEADER3 + len);
      if (this.first) {
        const f = this.first;
        this.first = null;
        f([kind, id, body]);
        continue;
      }
      const sub = kind === K_ITEM3 || kind === K_END3 || kind === K_ERR3 ? this.subs.get(id) : void 0;
      if (sub) {
        sub.push([kind, body]);
        if (kind !== K_ITEM3)
          this.subs.delete(id);
        continue;
      }
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w([kind, body]);
      }
    }
  }
  onClose() {
    this.closed = true;
    if (this.first) {
      const f = this.first;
      this.first = null;
      f(null);
    }
    for (const w of this.pending.values())
      w(null);
    this.pending.clear();
    for (const s of this.subs.values())
      s.push(null);
    this.subs.clear();
  }
  /** @internal */
  send(b) {
    if (this.closed)
      throw new Closed3("connection closed");
    this.ws.send(b);
  }
  /** @internal Open `url`, say Hello as `api`, wait for the answer. */
  static async open(url, hello, waitMs) {
    const ws = new WebSocket(url);
    await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        ws.close();
        rej(new Timeout3(`connect ${url}`));
      }, waitMs);
      ws.onopen = () => {
        clearTimeout(t);
        res6();
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new WireError3(`connect ${url}: refused or unreachable`));
      };
    });
    const c = new _ConnBase(ws);
    const ans = new Promise((res6, rej) => {
      c.first = res6;
      setTimeout(() => {
        if (c.first === res6) {
          c.first = null;
          ws.close();
          rej(new Timeout3("no Hello answer"));
        }
      }, waitMs);
    });
    ws.send(frame3(K_HELLO3, 0, 0, hello));
    const m = await ans;
    if (m === null)
      throw new Closed3("connection closed");
    const r = refusal3(m[2]);
    if (m[0] !== K_HELLO3 || r instanceof Refused3) {
      ws.close();
      throw r instanceof Refused3 ? r : new Refused3("Ok");
    }
    c.session = r.ok;
    return c;
  }
  /** @internal */
  async call(op, qc, pc, req, waitMs = 0) {
    const deadlineMs = Math.max(this.deadlineMs, waitMs);
    const payload = encode3(qc, req);
    const id = this.nextId++;
    const got = await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Timeout3(`op ${op} took over ${deadlineMs} ms`));
      }, deadlineMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res6(m);
      });
      try {
        this.send(frame3(K_REQ3, id, op, payload));
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        rej(e);
      }
    });
    if (got === null)
      throw new Closed3("connection closed");
    if (got[0] === K_RESP3)
      return decode3(pc, got[1]);
    throw refused3(got[1]);
  }
  /** @internal */
  subscribeOp(op, qc, ic, req) {
    const payload = encode3(qc, req);
    const id = this.nextId++;
    const sub = new Subscription3(this, id, op, ic);
    if (this.closed)
      throw new Closed3("connection closed");
    this.subs.set(id, sub);
    this.send(frame3(K_SUB3, id, op, payload));
    return sub;
  }
  close() {
    this.ws.close();
  }
};
async function connectWeb3(g, waitMs, instance = "") {
  const key = instance ? `${API_NAME3}#${instance}` : API_NAME3;
  const w = new W3();
  str3.enc(w, key);
  u323.enc(w, API_VERSION3);
  u643.enc(w, SCHEMA3);
  bytes3.enc(w, g.everyone !== void 0 ? new TextEncoder().encode("ceeveryn" + g.everyone) : await webProof3(g, key));
  bool3.enc(w, false);
  return ConnBase3.open(g.url, w.out(), waitMs);
}
TABLE3["Health"] = struct3([["ok", bool3], ["version", str3], ["uptime_s", u643]]);
TABLE3["Ref"] = struct3([["label", str3], ["kind", str3], ["to", str3]]);
TABLE3["AppendReq"] = struct3([["pad", str3], ["text", str3]]);
TABLE3["Pad"] = struct3([["pad", str3], ["text", str3], ["version", u643], ["node", str3], ["trimmed", bool3], ["refs", vec3(ref3("Ref"))]]);
TABLE3["PadError"] = enumOf3([["Invalid", [["f0", str3]]], ["Limited", [["f0", str3]]], ["Store", [["f0", str3]]]]);
TABLE3["SpawnReq"] = struct3([["node", str3], ["n", u323]]);
TABLE3["SpawnResp"] = struct3([["ids", vec3(str3)]]);
TABLE3["InstancesReq"] = struct3([["node", str3]]);
TABLE3["InstancesResp"] = struct3([["ids", vec3(str3)]]);
TABLE3["StopIdReq"] = struct3([["id", str3]]);
TABLE3["StopIdResp"] = struct3([["stopped", bool3]]);
TABLE3["DeployReq"] = struct3([["node", str3], ["version", str3]]);
TABLE3["DeployResp"] = struct3([["ok", bool3], ["version", str3]]);
TABLE3["BenchReq"] = struct3([["op", str3], ["n", u323]]);
TABLE3["BenchResp"] = struct3([["p50_ms", f643], ["p95_ms", f643], ["errors", u323]]);
TABLE3["CellOpsError"] = enumOf3([["Invalid", [["f0", str3]]], ["Failed", [["f0", str3]]]]);
var SessionPadClient = class _SessionPadClient {
  conn;
  constructor(conn) {
    this.conn = conn;
  }
  /** Through the wire.ws-door in `g` (default: the grant in this page's link); `instance` names one instance of the api (Rust by_instance). */
  static async connect(g = grantFromLink3(), waitMs = 1e4, instance = "") {
    if (!g)
      throw new Refused3("Gate", "no grant in this link (#g=...)");
    return new _SessionPadClient(await connectWeb3(g, waitMs, instance));
  }
  close() {
    this.conn.close();
  }
  /** op HealthOp (needs session.pad:health). */
  healthOp() {
    return this.conn.call(1, unit3, ref3("Health"), null);
  }
  /** op Append (needs session.pad:append). */
  append(req) {
    return this.conn.call(2, ref3("AppendReq"), res3(ref3("Pad"), ref3("PadError")), req, 8e3);
  }
  /** op Read (needs session.pad:read). */
  read(req) {
    return this.conn.call(3, str3, res3(ref3("Pad"), ref3("PadError")), req, 8e3);
  }
  /** op CellSpawn (needs session.pad:spawn). */
  cellSpawn(req) {
    return this.conn.call(900, ref3("SpawnReq"), res3(ref3("SpawnResp"), ref3("CellOpsError")), req);
  }
  /** op CellInstances (needs session.pad:instances). */
  cellInstances(req) {
    return this.conn.call(901, ref3("InstancesReq"), res3(ref3("InstancesResp"), ref3("CellOpsError")), req);
  }
  /** op CellStop (needs session.pad:stop). */
  cellStop(req) {
    return this.conn.call(902, ref3("StopIdReq"), res3(ref3("StopIdResp"), ref3("CellOpsError")), req);
  }
  /** op CellDeploy (needs session.pad:deploy). */
  cellDeploy(req) {
    return this.conn.call(903, ref3("DeployReq"), res3(ref3("DeployResp"), ref3("CellOpsError")), req);
  }
  /** op CellBench (needs session.pad:bench). */
  cellBench(req) {
    return this.conn.call(904, ref3("BenchReq"), res3(ref3("BenchResp"), ref3("CellOpsError")), req);
  }
  /** stream Subscribe (needs session.pad:read). */
  subscribe(req) {
    return this.conn.subscribeOp(4, str3, ref3("Pad"), req);
  }
};

// sdk/OrchUp.ts
var API_NAME4 = "orch.up";
var API_VERSION4 = 1;
var SCHEMA4 = 15355708411574156806n;
var CALL_DEADLINE_MS4 = 8e3;
var HEADER4 = 17;
var MAX_PAYLOAD4 = 16 << 20;
var K_HELLO4 = 0;
var K_REQ4 = 1;
var K_RESP4 = 2;
var K_ERR4 = 3;
var K_SUB4 = 5;
var K_ITEM4 = 6;
var K_END4 = 7;
var WireError4 = class extends Error {
};
var Timeout4 = class extends WireError4 {
};
var Closed4 = class extends WireError4 {
};
var DecodeError4 = class extends WireError4 {
};
var Refused4 = class extends WireError4 {
  kind;
  detail;
  extra;
  constructor(kind, detail, extra = {}) {
    super(detail === void 0 ? kind : `${kind}: ${String(detail)}`);
    this.kind = kind;
    this.detail = detail;
    this.extra = extra;
  }
};
var W4 = class {
  buf = new Uint8Array(64);
  len = 0;
  room(n) {
    if (this.len + n <= this.buf.length)
      return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  varint(v) {
    if (typeof v === "number") {
      while (v >= 128) {
        this.byte(v % 128 | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    } else {
      while (v >= 0x80n) {
        this.byte(Number(v & 0x7fn) | 128);
        v >>= 7n;
      }
      this.byte(Number(v));
    }
  }
  out() {
    return this.buf.slice(0, this.len);
  }
};
var R4 = class {
  i = 0;
  b;
  constructor(b) {
    this.b = b;
  }
  take(n) {
    if (n < 0 || this.i + n > this.b.length)
      throw new DecodeError4("unexpected end of data");
    const v = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return v;
  }
  byte() {
    return this.take(1)[0];
  }
  varint() {
    let x = 0, mul = 1;
    for (let n = 0; n < 8; n++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (!(c & 128))
        return x;
      mul *= 128;
    }
    throw new DecodeError4("varint too long for a number");
  }
  varbig() {
    let x = 0n, sh = 0n;
    for (let n = 0; n < 20; n++) {
      const c = this.byte();
      x |= BigInt(c & 127) << sh;
      if (!(c & 128))
        return x;
      sh += 7n;
    }
    throw new DecodeError4("varint too long");
  }
  dv(n) {
    const s = this.take(n);
    return new DataView(s.buffer, s.byteOffset, n);
  }
};
var te4 = new TextEncoder();
var td4 = new TextDecoder("utf-8", { fatal: true });
function uint4(bits) {
  const mx = 2 ** bits - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < 0 || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varint();
      if (v > mx)
        throw new DecodeError4(`u${bits} overflow`);
      return v;
    }
  };
}
function sint4(bits) {
  const lo = -(2 ** (bits - 1)), hi = 2 ** (bits - 1) - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v >= 0 ? v * 2 : -v * 2 - 1);
    },
    dec(r) {
      const z = r.varint();
      const v = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      if (v < lo || v > hi)
        throw new DecodeError4(`i${bits} overflow`);
      return v;
    }
  };
}
function ubig4(bits) {
  const mx = (1n << BigInt(bits)) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < 0n || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varbig();
      if (v > mx)
        throw new DecodeError4(`u${bits} overflow`);
      return v;
    }
  };
}
function sbig4(bits) {
  const b = BigInt(bits);
  const lo = -(1n << b - 1n), hi = (1n << b - 1n) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v << 1n ^ v >> b - 1n);
    },
    dec(r) {
      const z = r.varbig();
      const v = z >> 1n ^ -(z & 1n);
      if (v < lo || v > hi)
        throw new DecodeError4(`i${bits} overflow`);
      return v;
    }
  };
}
var u164 = uint4(16);
var u324 = uint4(32);
var i164 = sint4(16);
var i324 = sint4(32);
var u644 = ubig4(64);
var u1284 = ubig4(128);
var i644 = sbig4(64);
var i1284 = sbig4(128);
var f644 = {
  enc(w, v) {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, v, true);
    w.bytes(new Uint8Array(d.buffer));
  },
  dec: (r) => r.dv(8).getFloat64(0, true)
};
var bool4 = {
  enc: (w, v) => w.byte(v ? 1 : 0),
  dec(r) {
    const c = r.byte();
    if (c > 1)
      throw new DecodeError4("bad bool");
    return c === 1;
  }
};
var str4 = {
  enc(w, v) {
    const d = te4.encode(v);
    w.varint(d.length);
    w.bytes(d);
  },
  dec(r) {
    try {
      return td4.decode(r.take(r.varint()));
    } catch (e) {
      if (e instanceof WireError4)
        throw e;
      throw new DecodeError4(String(e));
    }
  }
};
var unit4 = { enc() {
}, dec: () => null };
var bytes4 = {
  enc(w, v) {
    w.varint(v.length);
    w.bytes(v);
  },
  dec: (r) => r.take(r.varint()).slice()
};
function vec4(c) {
  return {
    enc(w, v) {
      w.varint(v.length);
      for (const x of v)
        c.enc(w, x);
    },
    dec(r) {
      const n = r.varint();
      if (n > MAX_PAYLOAD4)
        throw new DecodeError4("vec too long");
      const o = [];
      for (let i = 0; i < n; i++)
        o.push(c.dec(r));
      return o;
    }
  };
}
function res4(ok, err) {
  return {
    enc(w, v) {
      if ("ok" in v) {
        w.byte(0);
        ok.enc(w, v.ok);
      } else {
        w.byte(1);
        err.enc(w, v.err);
      }
    },
    dec(r) {
      const t = r.byte();
      if (t === 0)
        return { ok: ok.dec(r) };
      if (t === 1)
        return { err: err.dec(r) };
      throw new DecodeError4("bad result tag");
    }
  };
}
var TABLE4 = {};
function ref4(name) {
  return { enc: (w, v) => TABLE4[name].enc(w, v), dec: (r) => TABLE4[name].dec(r) };
}
function struct4(fields) {
  return {
    enc(w, v) {
      for (const [k, c] of fields)
        c.enc(w, v[k]);
    },
    dec(r) {
      const o = {};
      for (const [k, c] of fields)
        o[k] = c.dec(r);
      return o;
    }
  };
}
function enumOf4(variants) {
  return {
    enc(w, v) {
      const i = variants.findIndex(([n]) => n === v.tag);
      if (i < 0)
        throw new RangeError(`not a variant of this enum: ${JSON.stringify(v)}`);
      w.varint(i);
      for (const [k, c] of variants[i][1])
        c.enc(w, v[k]);
    },
    dec(r) {
      const i = r.varint();
      if (i >= variants.length)
        throw new DecodeError4(`enum variant ${i} out of range`);
      const o = { tag: variants[i][0] };
      for (const [k, c] of variants[i][1])
        o[k] = c.dec(r);
      return o;
    }
  };
}
function encode4(c, v) {
  const w = new W4();
  c.enc(w, v);
  return w.out();
}
function decode4(c, body) {
  const r = new R4(body);
  const v = c.dec(r);
  if (r.i !== body.length)
    throw new DecodeError4("trailing bytes");
  return v;
}
function frame4(kind, id, op, payload = new Uint8Array()) {
  const b = new Uint8Array(HEADER4 + payload.length);
  const d = new DataView(b.buffer);
  d.setUint32(0, payload.length, true);
  b[4] = kind;
  d.setBigUint64(5, BigInt(id), true);
  d.setUint32(13, op, true);
  b.set(payload, HEADER4);
  return b;
}
function adaptError4(r) {
  const i = r.varint();
  switch (i) {
    case 0:
      return { kind: "Narrow", field: str4.dec(r), value: str4.dec(r) };
    case 1:
      return { kind: "NoVariant", field: str4.dec(r), variant: str4.dec(r) };
    case 2:
      return { kind: "Missing", field: str4.dec(r) };
    case 3:
      return { kind: "NoPath" };
    case 4:
      return { kind: "Decode", why: str4.dec(r) };
    default:
      throw new DecodeError4(`unknown AdaptError variant ${i}`);
  }
}
function refusal4(body) {
  const r = new R4(body);
  const i = r.varint();
  switch (i) {
    case 0:
      return { ok: r.varbig() };
    case 1: {
      const ours = r.varbig(), theirs = r.varbig(), api = str4.dec(r);
      return new Refused4("Schema", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api})`, { ours, theirs, api });
    }
    case 4:
      return new Refused4("UnknownOp", r.varint());
    case 8: {
      const ours = r.varbig(), theirs = r.varbig(), api = str4.dec(r), update = str4.dec(r);
      return new Refused4("SchemaAt", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api}): ${update}`, { ours, theirs, api, update });
    }
    case 9: {
      const api = str4.dec(r), op = r.varint(), op_name = str4.dec(r), ours = r.varint(), theirs = r.varint();
      const why = adaptError4(r);
      return new Refused4("Adapt", `${api} op ${op_name} (#${op}) v${theirs} <-> v${ours}: ${JSON.stringify(why)}`, { api, op, op_name, ours, theirs, why });
    }
    case 10: {
      const api = str4.dec(r), op = r.varint(), op_name = str4.dec(r), ours = r.varbig(), theirs = r.varbig();
      return new Refused4("SchemaMismatch", `${api} op ${op_name} (#${op}): server shape 0x${ours.toString(16)}, this client 0x${theirs.toString(16)}`, { api, op, op_name, ours, theirs });
    }
    default: {
      const names = { 2: "Gate", 3: "Right", 5: "NoCell", 6: "Decode", 7: "Remote" };
      if (!(i in names))
        throw new DecodeError4(`unknown Refusal variant ${i}`);
      return new Refused4(names[i], str4.dec(r));
    }
  }
}
function refused4(body) {
  try {
    const r = refusal4(body);
    return r instanceof Refused4 ? r : new Refused4("Ok");
  } catch {
    return new Refused4("Remote", "bad error body");
  }
}
var HELLO_DOMAIN4 = "ce-wire-hello-v1";
var PKCS8_ED255194 = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
function b64u4(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function grantFromLink4(href = location.href) {
  const u = new URL(href);
  const f = new URLSearchParams(u.hash.slice(1));
  const g = f.get("g");
  if (!g)
    return null;
  const [k, c] = g.split(".");
  const url = f.get("w") ?? `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/wire`;
  return { url, seed: b64u4(k), chain: b64u4(c) };
}
var WebKey4 = class _WebKey {
  nodeId;
  key;
  constructor(nodeId, key) {
    this.nodeId = nodeId;
    this.key = key;
  }
  static async fromSeed(seed) {
    const der = new Uint8Array(48);
    der.set(PKCS8_ED255194);
    der.set(seed, 16);
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return new _WebKey(b64u4(jwk.x), key);
  }
  async sign(data) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.key, data));
  }
};
async function webProof4(g, api = API_NAME4, schema = SCHEMA4) {
  const k = await WebKey4.fromSeed(g.seed);
  const unixMs = BigInt(Date.now());
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const s = new W4();
  str4.enc(s, HELLO_DOMAIN4);
  str4.enc(s, api);
  u644.enc(s, schema);
  u644.enc(s, unixMs);
  s.bytes(nonce);
  s.bytes(k.nodeId);
  bytes4.enc(s, g.chain);
  const sig = await k.sign(s.out());
  const p = new W4();
  p.bytes(k.nodeId);
  u644.enc(p, unixMs);
  p.bytes(nonce);
  bytes4.enc(p, g.chain);
  bytes4.enc(p, sig);
  return p.out();
}
var Subscription4 = class {
  q = [];
  waiter = null;
  done = false;
  c;
  id;
  op;
  codec;
  constructor(c, id, op, codec) {
    this.c = c;
    this.id = id;
    this.op = op;
    this.codec = codec;
  }
  /** @internal */
  push(m) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(m);
    } else
      this.q.push(m);
  }
  /** Next item, or `undefined` when the server ended the stream normally. */
  async next(timeoutMs) {
    if (this.done)
      return void 0;
    const m = await new Promise((res6, rej) => {
      if (this.q.length)
        return res6(this.q.shift());
      let t;
      this.waiter = (x) => {
        if (t)
          clearTimeout(t);
        res6(x);
      };
      if (timeoutMs !== void 0)
        t = setTimeout(() => {
          this.waiter = null;
          rej(new Timeout4("no item"));
        }, timeoutMs);
    });
    if (m === null) {
      this.finish();
      throw new Closed4("connection closed");
    }
    const [kind, body] = m;
    if (kind === K_ITEM4)
      return decode4(this.codec, body);
    this.finish();
    if (kind === K_END4)
      return void 0;
    throw refused4(body);
  }
  finish() {
    this.done = true;
    this.c.subs.delete(this.id);
  }
  close() {
    if (this.done)
      return;
    this.finish();
    this.c.send(frame4(K_END4, this.id, this.op));
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (; ; ) {
        const v = await this.next();
        if (v === void 0)
          return;
        yield v;
      }
    } finally {
      this.close();
    }
  }
};
var ConnBase4 = class _ConnBase {
  session = 0n;
  deadlineMs = CALL_DEADLINE_MS4;
  nextId = 1;
  buf = new Uint8Array(0);
  pending = /* @__PURE__ */ new Map();
  /** @internal */
  subs = /* @__PURE__ */ new Map();
  closed = false;
  first = null;
  ws;
  constructor(ws) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => this.onClose();
  }
  onData(d) {
    if (this.buf.length) {
      const b = new Uint8Array(this.buf.length + d.length);
      b.set(this.buf);
      b.set(d, this.buf.length);
      this.buf = b;
    } else
      this.buf = d;
    for (; ; ) {
      if (this.buf.length < HEADER4)
        return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const len = v.getUint32(0, true);
      if (len > MAX_PAYLOAD4)
        return void this.ws.close();
      if (this.buf.length < HEADER4 + len)
        return;
      const kind = this.buf[4];
      const id = Number(v.getBigUint64(5, true));
      const body = this.buf.slice(HEADER4, HEADER4 + len);
      this.buf = this.buf.subarray(HEADER4 + len);
      if (this.first) {
        const f = this.first;
        this.first = null;
        f([kind, id, body]);
        continue;
      }
      const sub = kind === K_ITEM4 || kind === K_END4 || kind === K_ERR4 ? this.subs.get(id) : void 0;
      if (sub) {
        sub.push([kind, body]);
        if (kind !== K_ITEM4)
          this.subs.delete(id);
        continue;
      }
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w([kind, body]);
      }
    }
  }
  onClose() {
    this.closed = true;
    if (this.first) {
      const f = this.first;
      this.first = null;
      f(null);
    }
    for (const w of this.pending.values())
      w(null);
    this.pending.clear();
    for (const s of this.subs.values())
      s.push(null);
    this.subs.clear();
  }
  /** @internal */
  send(b) {
    if (this.closed)
      throw new Closed4("connection closed");
    this.ws.send(b);
  }
  /** @internal Open `url`, say Hello as `api`, wait for the answer. */
  static async open(url, hello, waitMs) {
    const ws = new WebSocket(url);
    await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        ws.close();
        rej(new Timeout4(`connect ${url}`));
      }, waitMs);
      ws.onopen = () => {
        clearTimeout(t);
        res6();
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new WireError4(`connect ${url}: refused or unreachable`));
      };
    });
    const c = new _ConnBase(ws);
    const ans = new Promise((res6, rej) => {
      c.first = res6;
      setTimeout(() => {
        if (c.first === res6) {
          c.first = null;
          ws.close();
          rej(new Timeout4("no Hello answer"));
        }
      }, waitMs);
    });
    ws.send(frame4(K_HELLO4, 0, 0, hello));
    const m = await ans;
    if (m === null)
      throw new Closed4("connection closed");
    const r = refusal4(m[2]);
    if (m[0] !== K_HELLO4 || r instanceof Refused4) {
      ws.close();
      throw r instanceof Refused4 ? r : new Refused4("Ok");
    }
    c.session = r.ok;
    return c;
  }
  /** @internal */
  async call(op, qc, pc, req, waitMs = 0) {
    const deadlineMs = Math.max(this.deadlineMs, waitMs);
    const payload = encode4(qc, req);
    const id = this.nextId++;
    const got = await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Timeout4(`op ${op} took over ${deadlineMs} ms`));
      }, deadlineMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res6(m);
      });
      try {
        this.send(frame4(K_REQ4, id, op, payload));
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        rej(e);
      }
    });
    if (got === null)
      throw new Closed4("connection closed");
    if (got[0] === K_RESP4)
      return decode4(pc, got[1]);
    throw refused4(got[1]);
  }
  /** @internal */
  subscribeOp(op, qc, ic, req) {
    const payload = encode4(qc, req);
    const id = this.nextId++;
    const sub = new Subscription4(this, id, op, ic);
    if (this.closed)
      throw new Closed4("connection closed");
    this.subs.set(id, sub);
    this.send(frame4(K_SUB4, id, op, payload));
    return sub;
  }
  close() {
    this.ws.close();
  }
};
async function connectWeb4(g, waitMs, instance = "") {
  const key = instance ? `${API_NAME4}#${instance}` : API_NAME4;
  const w = new W4();
  str4.enc(w, key);
  u324.enc(w, API_VERSION4);
  u644.enc(w, SCHEMA4);
  bytes4.enc(w, g.everyone !== void 0 ? new TextEncoder().encode("ceeveryn" + g.everyone) : await webProof4(g, key));
  bool4.enc(w, false);
  return ConnBase4.open(g.url, w.out(), waitMs);
}
TABLE4["Health"] = struct4([["ok", bool4], ["version", str4], ["uptime_s", u644]]);
TABLE4["Ref"] = struct4([["label", str4], ["kind", str4], ["to", str4]]);
TABLE4["UpReq"] = struct4([["cell", str4], ["on", str4]]);
TABLE4["MoveReq"] = struct4([["cell", str4], ["from", str4], ["to", str4]]);
TABLE4["State"] = enumOf4([["Up", []], ["AlreadyUp", []], ["Down", []], ["AlreadyDown", []]]);
TABLE4["Placement"] = struct4([["cell", str4], ["node", str4], ["state", ref4("State")], ["took_ms", u644], ["detail", str4], ["refs", vec4(ref4("Ref"))]]);
TABLE4["Moved"] = struct4([["up", ref4("Placement")], ["down", ref4("Placement")]]);
TABLE4["OrchError"] = enumOf4([["NotAllowed", [["f0", str4]]], ["NoNode", [["f0", str4]]], ["Install", [["f0", str4]]], ["Invalid", [["f0", str4]]]]);
TABLE4["SpawnReq"] = struct4([["node", str4], ["n", u324]]);
TABLE4["SpawnResp"] = struct4([["ids", vec4(str4)]]);
TABLE4["InstancesReq"] = struct4([["node", str4]]);
TABLE4["InstancesResp"] = struct4([["ids", vec4(str4)]]);
TABLE4["StopIdReq"] = struct4([["id", str4]]);
TABLE4["StopIdResp"] = struct4([["stopped", bool4]]);
TABLE4["DeployReq"] = struct4([["node", str4], ["version", str4]]);
TABLE4["DeployResp"] = struct4([["ok", bool4], ["version", str4]]);
TABLE4["BenchReq"] = struct4([["op", str4], ["n", u324]]);
TABLE4["BenchResp"] = struct4([["p50_ms", f644], ["p95_ms", f644], ["errors", u324]]);
TABLE4["CellOpsError"] = enumOf4([["Invalid", [["f0", str4]]], ["Failed", [["f0", str4]]]]);
var OrchUpClient = class _OrchUpClient {
  conn;
  constructor(conn) {
    this.conn = conn;
  }
  /** Through the wire.ws-door in `g` (default: the grant in this page's link); `instance` names one instance of the api (Rust by_instance). */
  static async connect(g = grantFromLink4(), waitMs = 1e4, instance = "") {
    if (!g)
      throw new Refused4("Gate", "no grant in this link (#g=...)");
    return new _OrchUpClient(await connectWeb4(g, waitMs, instance));
  }
  close() {
    this.conn.close();
  }
  /** op HealthOp (needs orch.up:health). */
  healthOp() {
    return this.conn.call(1, unit4, ref4("Health"), null);
  }
  /** op Up (needs orch.up:up). */
  up(req) {
    return this.conn.call(2, ref4("UpReq"), res4(ref4("Placement"), ref4("OrchError")), req, 18e5);
  }
  /** op Down (needs orch.up:down). */
  down(req) {
    return this.conn.call(3, ref4("UpReq"), res4(ref4("Placement"), ref4("OrchError")), req, 12e4);
  }
  /** op Move (needs orch.up:move). */
  move(req) {
    return this.conn.call(4, ref4("MoveReq"), res4(ref4("Moved"), ref4("OrchError")), req, 18e5);
  }
  /** op CellSpawn (needs orch.up:spawn). */
  cellSpawn(req) {
    return this.conn.call(900, ref4("SpawnReq"), res4(ref4("SpawnResp"), ref4("CellOpsError")), req);
  }
  /** op CellInstances (needs orch.up:instances). */
  cellInstances(req) {
    return this.conn.call(901, ref4("InstancesReq"), res4(ref4("InstancesResp"), ref4("CellOpsError")), req);
  }
  /** op CellStop (needs orch.up:stop). */
  cellStop(req) {
    return this.conn.call(902, ref4("StopIdReq"), res4(ref4("StopIdResp"), ref4("CellOpsError")), req);
  }
  /** op CellDeploy (needs orch.up:deploy). */
  cellDeploy(req) {
    return this.conn.call(903, ref4("DeployReq"), res4(ref4("DeployResp"), ref4("CellOpsError")), req);
  }
  /** op CellBench (needs orch.up:bench). */
  cellBench(req) {
    return this.conn.call(904, ref4("BenchReq"), res4(ref4("BenchResp"), ref4("CellOpsError")), req);
  }
};

// sdk/NetFind.ts
var API_NAME5 = "net.find";
var API_VERSION5 = 1;
var SCHEMA5 = 16424429642170228184n;
var CALL_DEADLINE_MS5 = 8e3;
var HEADER5 = 17;
var MAX_PAYLOAD5 = 16 << 20;
var K_HELLO5 = 0;
var K_REQ5 = 1;
var K_RESP5 = 2;
var K_ERR5 = 3;
var K_SUB5 = 5;
var K_ITEM5 = 6;
var K_END5 = 7;
var WireError5 = class extends Error {
};
var Timeout5 = class extends WireError5 {
};
var Closed5 = class extends WireError5 {
};
var DecodeError5 = class extends WireError5 {
};
var Refused5 = class extends WireError5 {
  kind;
  detail;
  extra;
  constructor(kind, detail, extra = {}) {
    super(detail === void 0 ? kind : `${kind}: ${String(detail)}`);
    this.kind = kind;
    this.detail = detail;
    this.extra = extra;
  }
};
var W5 = class {
  buf = new Uint8Array(64);
  len = 0;
  room(n) {
    if (this.len + n <= this.buf.length)
      return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  varint(v) {
    if (typeof v === "number") {
      while (v >= 128) {
        this.byte(v % 128 | 128);
        v = Math.floor(v / 128);
      }
      this.byte(v);
    } else {
      while (v >= 0x80n) {
        this.byte(Number(v & 0x7fn) | 128);
        v >>= 7n;
      }
      this.byte(Number(v));
    }
  }
  out() {
    return this.buf.slice(0, this.len);
  }
};
var R5 = class {
  i = 0;
  b;
  constructor(b) {
    this.b = b;
  }
  take(n) {
    if (n < 0 || this.i + n > this.b.length)
      throw new DecodeError5("unexpected end of data");
    const v = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return v;
  }
  byte() {
    return this.take(1)[0];
  }
  varint() {
    let x = 0, mul = 1;
    for (let n = 0; n < 8; n++) {
      const c = this.byte();
      x += (c & 127) * mul;
      if (!(c & 128))
        return x;
      mul *= 128;
    }
    throw new DecodeError5("varint too long for a number");
  }
  varbig() {
    let x = 0n, sh = 0n;
    for (let n = 0; n < 20; n++) {
      const c = this.byte();
      x |= BigInt(c & 127) << sh;
      if (!(c & 128))
        return x;
      sh += 7n;
    }
    throw new DecodeError5("varint too long");
  }
  dv(n) {
    const s = this.take(n);
    return new DataView(s.buffer, s.byteOffset, n);
  }
};
var te5 = new TextEncoder();
var td5 = new TextDecoder("utf-8", { fatal: true });
function uint5(bits) {
  const mx = 2 ** bits - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < 0 || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varint();
      if (v > mx)
        throw new DecodeError5(`u${bits} overflow`);
      return v;
    }
  };
}
function sint5(bits) {
  const lo = -(2 ** (bits - 1)), hi = 2 ** (bits - 1) - 1;
  return {
    enc(w, v) {
      if (!Number.isInteger(v) || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v >= 0 ? v * 2 : -v * 2 - 1);
    },
    dec(r) {
      const z = r.varint();
      const v = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      if (v < lo || v > hi)
        throw new DecodeError5(`i${bits} overflow`);
      return v;
    }
  };
}
function ubig5(bits) {
  const mx = (1n << BigInt(bits)) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < 0n || v > mx)
        throw new RangeError(`u${bits} out of range: ${v}`);
      w.varint(v);
    },
    dec(r) {
      const v = r.varbig();
      if (v > mx)
        throw new DecodeError5(`u${bits} overflow`);
      return v;
    }
  };
}
function sbig5(bits) {
  const b = BigInt(bits);
  const lo = -(1n << b - 1n), hi = (1n << b - 1n) - 1n;
  return {
    enc(w, v) {
      if (typeof v !== "bigint" || v < lo || v > hi)
        throw new RangeError(`i${bits} out of range: ${v}`);
      w.varint(v << 1n ^ v >> b - 1n);
    },
    dec(r) {
      const z = r.varbig();
      const v = z >> 1n ^ -(z & 1n);
      if (v < lo || v > hi)
        throw new DecodeError5(`i${bits} overflow`);
      return v;
    }
  };
}
var u165 = uint5(16);
var u325 = uint5(32);
var i165 = sint5(16);
var i325 = sint5(32);
var u645 = ubig5(64);
var u1285 = ubig5(128);
var i645 = sbig5(64);
var i1285 = sbig5(128);
var bool5 = {
  enc: (w, v) => w.byte(v ? 1 : 0),
  dec(r) {
    const c = r.byte();
    if (c > 1)
      throw new DecodeError5("bad bool");
    return c === 1;
  }
};
var str5 = {
  enc(w, v) {
    const d = te5.encode(v);
    w.varint(d.length);
    w.bytes(d);
  },
  dec(r) {
    try {
      return td5.decode(r.take(r.varint()));
    } catch (e) {
      if (e instanceof WireError5)
        throw e;
      throw new DecodeError5(String(e));
    }
  }
};
var bytes5 = {
  enc(w, v) {
    w.varint(v.length);
    w.bytes(v);
  },
  dec: (r) => r.take(r.varint()).slice()
};
function vec5(c) {
  return {
    enc(w, v) {
      w.varint(v.length);
      for (const x of v)
        c.enc(w, x);
    },
    dec(r) {
      const n = r.varint();
      if (n > MAX_PAYLOAD5)
        throw new DecodeError5("vec too long");
      const o = [];
      for (let i = 0; i < n; i++)
        o.push(c.dec(r));
      return o;
    }
  };
}
function res5(ok, err) {
  return {
    enc(w, v) {
      if ("ok" in v) {
        w.byte(0);
        ok.enc(w, v.ok);
      } else {
        w.byte(1);
        err.enc(w, v.err);
      }
    },
    dec(r) {
      const t = r.byte();
      if (t === 0)
        return { ok: ok.dec(r) };
      if (t === 1)
        return { err: err.dec(r) };
      throw new DecodeError5("bad result tag");
    }
  };
}
var TABLE5 = {};
function ref5(name) {
  return { enc: (w, v) => TABLE5[name].enc(w, v), dec: (r) => TABLE5[name].dec(r) };
}
function struct5(fields) {
  return {
    enc(w, v) {
      for (const [k, c] of fields)
        c.enc(w, v[k]);
    },
    dec(r) {
      const o = {};
      for (const [k, c] of fields)
        o[k] = c.dec(r);
      return o;
    }
  };
}
function enumOf5(variants) {
  return {
    enc(w, v) {
      const i = variants.findIndex(([n]) => n === v.tag);
      if (i < 0)
        throw new RangeError(`not a variant of this enum: ${JSON.stringify(v)}`);
      w.varint(i);
      for (const [k, c] of variants[i][1])
        c.enc(w, v[k]);
    },
    dec(r) {
      const i = r.varint();
      if (i >= variants.length)
        throw new DecodeError5(`enum variant ${i} out of range`);
      const o = { tag: variants[i][0] };
      for (const [k, c] of variants[i][1])
        o[k] = c.dec(r);
      return o;
    }
  };
}
function encode5(c, v) {
  const w = new W5();
  c.enc(w, v);
  return w.out();
}
function decode5(c, body) {
  const r = new R5(body);
  const v = c.dec(r);
  if (r.i !== body.length)
    throw new DecodeError5("trailing bytes");
  return v;
}
function frame5(kind, id, op, payload = new Uint8Array()) {
  const b = new Uint8Array(HEADER5 + payload.length);
  const d = new DataView(b.buffer);
  d.setUint32(0, payload.length, true);
  b[4] = kind;
  d.setBigUint64(5, BigInt(id), true);
  d.setUint32(13, op, true);
  b.set(payload, HEADER5);
  return b;
}
function adaptError5(r) {
  const i = r.varint();
  switch (i) {
    case 0:
      return { kind: "Narrow", field: str5.dec(r), value: str5.dec(r) };
    case 1:
      return { kind: "NoVariant", field: str5.dec(r), variant: str5.dec(r) };
    case 2:
      return { kind: "Missing", field: str5.dec(r) };
    case 3:
      return { kind: "NoPath" };
    case 4:
      return { kind: "Decode", why: str5.dec(r) };
    default:
      throw new DecodeError5(`unknown AdaptError variant ${i}`);
  }
}
function refusal5(body) {
  const r = new R5(body);
  const i = r.varint();
  switch (i) {
    case 0:
      return { ok: r.varbig() };
    case 1: {
      const ours = r.varbig(), theirs = r.varbig(), api = str5.dec(r);
      return new Refused5("Schema", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api})`, { ours, theirs, api });
    }
    case 4:
      return new Refused5("UnknownOp", r.varint());
    case 8: {
      const ours = r.varbig(), theirs = r.varbig(), api = str5.dec(r), update = str5.dec(r);
      return new Refused5("SchemaAt", `server has schema 0x${ours.toString(16)}, this client 0x${theirs.toString(16)} (api ${api}): ${update}`, { ours, theirs, api, update });
    }
    case 9: {
      const api = str5.dec(r), op = r.varint(), op_name = str5.dec(r), ours = r.varint(), theirs = r.varint();
      const why = adaptError5(r);
      return new Refused5("Adapt", `${api} op ${op_name} (#${op}) v${theirs} <-> v${ours}: ${JSON.stringify(why)}`, { api, op, op_name, ours, theirs, why });
    }
    case 10: {
      const api = str5.dec(r), op = r.varint(), op_name = str5.dec(r), ours = r.varbig(), theirs = r.varbig();
      return new Refused5("SchemaMismatch", `${api} op ${op_name} (#${op}): server shape 0x${ours.toString(16)}, this client 0x${theirs.toString(16)}`, { api, op, op_name, ours, theirs });
    }
    default: {
      const names = { 2: "Gate", 3: "Right", 5: "NoCell", 6: "Decode", 7: "Remote" };
      if (!(i in names))
        throw new DecodeError5(`unknown Refusal variant ${i}`);
      return new Refused5(names[i], str5.dec(r));
    }
  }
}
function refused5(body) {
  try {
    const r = refusal5(body);
    return r instanceof Refused5 ? r : new Refused5("Ok");
  } catch {
    return new Refused5("Remote", "bad error body");
  }
}
var HELLO_DOMAIN5 = "ce-wire-hello-v1";
var PKCS8_ED255195 = Uint8Array.from([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
function b64u5(s) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function grantFromLink5(href = location.href) {
  const u = new URL(href);
  const f = new URLSearchParams(u.hash.slice(1));
  const g = f.get("g");
  if (!g)
    return null;
  const [k, c] = g.split(".");
  const url = f.get("w") ?? `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/wire`;
  return { url, seed: b64u5(k), chain: b64u5(c) };
}
var WebKey5 = class _WebKey {
  nodeId;
  key;
  constructor(nodeId, key) {
    this.nodeId = nodeId;
    this.key = key;
  }
  static async fromSeed(seed) {
    const der = new Uint8Array(48);
    der.set(PKCS8_ED255195);
    der.set(seed, 16);
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return new _WebKey(b64u5(jwk.x), key);
  }
  async sign(data) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.key, data));
  }
};
async function webProof5(g, api = API_NAME5, schema = SCHEMA5) {
  const k = await WebKey5.fromSeed(g.seed);
  const unixMs = BigInt(Date.now());
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const s = new W5();
  str5.enc(s, HELLO_DOMAIN5);
  str5.enc(s, api);
  u645.enc(s, schema);
  u645.enc(s, unixMs);
  s.bytes(nonce);
  s.bytes(k.nodeId);
  bytes5.enc(s, g.chain);
  const sig = await k.sign(s.out());
  const p = new W5();
  p.bytes(k.nodeId);
  u645.enc(p, unixMs);
  p.bytes(nonce);
  bytes5.enc(p, g.chain);
  bytes5.enc(p, sig);
  return p.out();
}
var Subscription5 = class {
  q = [];
  waiter = null;
  done = false;
  c;
  id;
  op;
  codec;
  constructor(c, id, op, codec) {
    this.c = c;
    this.id = id;
    this.op = op;
    this.codec = codec;
  }
  /** @internal */
  push(m) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(m);
    } else
      this.q.push(m);
  }
  /** Next item, or `undefined` when the server ended the stream normally. */
  async next(timeoutMs) {
    if (this.done)
      return void 0;
    const m = await new Promise((res6, rej) => {
      if (this.q.length)
        return res6(this.q.shift());
      let t;
      this.waiter = (x) => {
        if (t)
          clearTimeout(t);
        res6(x);
      };
      if (timeoutMs !== void 0)
        t = setTimeout(() => {
          this.waiter = null;
          rej(new Timeout5("no item"));
        }, timeoutMs);
    });
    if (m === null) {
      this.finish();
      throw new Closed5("connection closed");
    }
    const [kind, body] = m;
    if (kind === K_ITEM5)
      return decode5(this.codec, body);
    this.finish();
    if (kind === K_END5)
      return void 0;
    throw refused5(body);
  }
  finish() {
    this.done = true;
    this.c.subs.delete(this.id);
  }
  close() {
    if (this.done)
      return;
    this.finish();
    this.c.send(frame5(K_END5, this.id, this.op));
  }
  async *[Symbol.asyncIterator]() {
    try {
      for (; ; ) {
        const v = await this.next();
        if (v === void 0)
          return;
        yield v;
      }
    } finally {
      this.close();
    }
  }
};
var ConnBase5 = class _ConnBase {
  session = 0n;
  deadlineMs = CALL_DEADLINE_MS5;
  nextId = 1;
  buf = new Uint8Array(0);
  pending = /* @__PURE__ */ new Map();
  /** @internal */
  subs = /* @__PURE__ */ new Map();
  closed = false;
  first = null;
  ws;
  constructor(ws) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => this.onClose();
  }
  onData(d) {
    if (this.buf.length) {
      const b = new Uint8Array(this.buf.length + d.length);
      b.set(this.buf);
      b.set(d, this.buf.length);
      this.buf = b;
    } else
      this.buf = d;
    for (; ; ) {
      if (this.buf.length < HEADER5)
        return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const len = v.getUint32(0, true);
      if (len > MAX_PAYLOAD5)
        return void this.ws.close();
      if (this.buf.length < HEADER5 + len)
        return;
      const kind = this.buf[4];
      const id = Number(v.getBigUint64(5, true));
      const body = this.buf.slice(HEADER5, HEADER5 + len);
      this.buf = this.buf.subarray(HEADER5 + len);
      if (this.first) {
        const f = this.first;
        this.first = null;
        f([kind, id, body]);
        continue;
      }
      const sub = kind === K_ITEM5 || kind === K_END5 || kind === K_ERR5 ? this.subs.get(id) : void 0;
      if (sub) {
        sub.push([kind, body]);
        if (kind !== K_ITEM5)
          this.subs.delete(id);
        continue;
      }
      const w = this.pending.get(id);
      if (w) {
        this.pending.delete(id);
        w([kind, body]);
      }
    }
  }
  onClose() {
    this.closed = true;
    if (this.first) {
      const f = this.first;
      this.first = null;
      f(null);
    }
    for (const w of this.pending.values())
      w(null);
    this.pending.clear();
    for (const s of this.subs.values())
      s.push(null);
    this.subs.clear();
  }
  /** @internal */
  send(b) {
    if (this.closed)
      throw new Closed5("connection closed");
    this.ws.send(b);
  }
  /** @internal Open `url`, say Hello as `api`, wait for the answer. */
  static async open(url, hello, waitMs) {
    const ws = new WebSocket(url);
    await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        ws.close();
        rej(new Timeout5(`connect ${url}`));
      }, waitMs);
      ws.onopen = () => {
        clearTimeout(t);
        res6();
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new WireError5(`connect ${url}: refused or unreachable`));
      };
    });
    const c = new _ConnBase(ws);
    const ans = new Promise((res6, rej) => {
      c.first = res6;
      setTimeout(() => {
        if (c.first === res6) {
          c.first = null;
          ws.close();
          rej(new Timeout5("no Hello answer"));
        }
      }, waitMs);
    });
    ws.send(frame5(K_HELLO5, 0, 0, hello));
    const m = await ans;
    if (m === null)
      throw new Closed5("connection closed");
    const r = refusal5(m[2]);
    if (m[0] !== K_HELLO5 || r instanceof Refused5) {
      ws.close();
      throw r instanceof Refused5 ? r : new Refused5("Ok");
    }
    c.session = r.ok;
    return c;
  }
  /** @internal */
  async call(op, qc, pc, req, waitMs = 0) {
    const deadlineMs = Math.max(this.deadlineMs, waitMs);
    const payload = encode5(qc, req);
    const id = this.nextId++;
    const got = await new Promise((res6, rej) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        rej(new Timeout5(`op ${op} took over ${deadlineMs} ms`));
      }, deadlineMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res6(m);
      });
      try {
        this.send(frame5(K_REQ5, id, op, payload));
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        rej(e);
      }
    });
    if (got === null)
      throw new Closed5("connection closed");
    if (got[0] === K_RESP5)
      return decode5(pc, got[1]);
    throw refused5(got[1]);
  }
  /** @internal */
  subscribeOp(op, qc, ic, req) {
    const payload = encode5(qc, req);
    const id = this.nextId++;
    const sub = new Subscription5(this, id, op, ic);
    if (this.closed)
      throw new Closed5("connection closed");
    this.subs.set(id, sub);
    this.send(frame5(K_SUB5, id, op, payload));
    return sub;
  }
  close() {
    this.ws.close();
  }
};
async function connectWeb5(g, waitMs, instance = "") {
  const key = instance ? `${API_NAME5}#${instance}` : API_NAME5;
  const w = new W5();
  str5.enc(w, key);
  u325.enc(w, API_VERSION5);
  u645.enc(w, SCHEMA5);
  bytes5.enc(w, g.everyone !== void 0 ? new TextEncoder().encode("ceeveryn" + g.everyone) : await webProof5(g, key));
  bool5.enc(w, false);
  return ConnBase5.open(g.url, w.out(), waitMs);
}
TABLE5["Replica"] = struct5([["addr", str5], ["node", str5], ["version", str5], ["schema_hash", u645], ["healthy_ms", u325]]);
TABLE5["FindReq"] = struct5([["name", str5], ["major", u165]]);
TABLE5["FindReply"] = struct5([["replicas", vec5(ref5("Replica"))], ["spawned", bool5]]);
TABLE5["FindError"] = enumOf5([["Unauthorized", []], ["NotFound", []], ["NoStartSpec", []], ["StartFailed", [["cell", str5], ["dep_chain", vec5(str5)], ["cause", str5]]], ["Timeout", [["after_ms", u325]]]]);
var NetFindClient = class _NetFindClient {
  conn;
  constructor(conn) {
    this.conn = conn;
  }
  /** Through the wire.ws-door in `g` (default: the grant in this page's link); `instance` names one instance of the api (Rust by_instance). */
  static async connect(g = grantFromLink5(), waitMs = 1e4, instance = "") {
    if (!g)
      throw new Refused5("Gate", "no grant in this link (#g=...)");
    return new _NetFindClient(await connectWeb5(g, waitMs, instance));
  }
  close() {
    this.conn.close();
  }
  /** op Find (needs net.find:find). */
  find(req) {
    return this.conn.call(1, ref5("FindReq"), res5(ref5("FindReply"), ref5("FindError")), req);
  }
};

// src/follow.ts
var API = "session.pad";
var grant = grantFromLink();
async function devices() {
  const r = await (await NetRttClient.connect(grant)).devices();
  if ("err" in r)
    throw new Error(JSON.stringify(r.err));
  return r.ok;
}
async function probe(ds) {
  const out = [];
  for (const d of ds) {
    const c = await NetRttClient.connect({ ...grant, url: d.ws_url || grant.url });
    const ms = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await c.ping(BigInt(i));
      ms.push(performance.now() - t);
    }
    c.close();
    ms.sort((a, b) => a - b);
    out.push({ node: d.node, rtt_ms: ms[2] });
  }
  await (await NetRttClient.connect(grant)).report({ samples: out });
  return out;
}
async function holder() {
  const r = await (await NetFindClient.connect(grant)).find({ name: API, major: 1 });
  return "ok" in r && r.ok.replicas.length ? r.ok.replicas[0].node.slice(0, 16) : "";
}
async function pad(ds) {
  const h = await holder();
  const d = ds.find((x) => x.node === h);
  return SessionPadClient.connect({ ...grant, url: d?.ws_url || grant.url });
}
async function watch() {
  return (await PlaceNearClient.connect(grant)).watch({ api: API, major: 1, hysteresis_ms: 20, sustain: 3, every_ms: 1e3 });
}
async function follow(from, to) {
  const orch = await OrchUpClient.connect(grant);
  return from === to ? { down: await orch.down({ cell: API, on: from }), up: await orch.up({ cell: API, on: to }) } : await orch.move({ cell: API, from, to });
}

// src/app.ts
var $ = (id) => document.getElementById(id);
var series = /* @__PURE__ */ new Map();
var events = [];
var state = { devices: [], holder: "", best: "", advice: null, follow: false, moving: false, padText: "", moves: [] };
window.__fm = { state, series, events };
var short = (n) => n ? n.slice(0, 8) : "-";
var label = (n) => {
  const d = state.devices.find((x) => x.node === n);
  return d ? `${d.label} ${short(n)}` : short(n);
};
function log(kind, text) {
  events.unshift({ t: Date.now(), text, kind });
  events.length = Math.min(events.length, 40);
  $("log").innerHTML = events.map((e) => `<li class="${e.kind}"><time>${new Date(e.t).toLocaleTimeString([], { hour12: false })}</time>${e.text}</li>`).join("");
}
function chart() {
  const W6 = 560, H = 180, P = 28, now = Date.now(), span = 9e4;
  const all = [...series.values()].flat().filter((p) => now - p.t < span);
  const max = Math.max(5, ...all.map((p) => p.ms)) * 1.15;
  const x = (t) => P + (t - (now - span)) / span * (W6 - P - 6);
  const y = (ms) => H - 18 - ms / max * (H - 30);
  let g = `<line class="ax" x1="${P}" y1="${H - 18}" x2="${W6 - 6}" y2="${H - 18}"/>`;
  for (const f of [0.25, 0.5, 0.75, 1])
    g += `<text class="tk" x="2" y="${y(max * f) + 3}">${(max * f).toFixed(max < 10 ? 1 : 0)}</text><line class="gr" x1="${P}" x2="${W6 - 6}" y1="${y(max * f)}" y2="${y(max * f)}"/>`;
  for (const m of state.moves.filter((m2) => now - m2.t < span))
    g += `<line class="mv" x1="${x(m.t)}" x2="${x(m.t)}" y1="8" y2="${H - 18}"/><text class="tk mvt" x="${x(m.t) + 3}" y="16">move</text>`;
  for (const [node, pts] of series) {
    const p = pts.filter((q) => now - q.t < span);
    if (!p.length)
      continue;
    const cls = node === "pad" ? "ln pad" : node === state.holder ? "ln hold" : "ln";
    g += `<polyline class="${cls}" points="${p.map((q) => `${x(q.t).toFixed(1)},${y(q.ms).toFixed(1)}`).join(" ")}"/>`;
  }
  $("chart").innerHTML = `<svg viewBox="0 0 ${W6} ${H}" role="img" aria-label="Round trip from this browser, ms">${g}</svg>`;
}
var land = null;
var rot = [-20, -35];
async function globeInit() {
  try {
    const w = await (await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json")).json();
    land = topojson.feature(w, w.objects.land);
  } catch {
    land = null;
  }
}
function globe() {
  const c = $("globe");
  const r = c.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const s = Math.min(r.width, r.height) / 2 - 8;
  const proj = d3.geoOrthographic().scale(s).translate([r.width / 2, r.height / 2]).rotate(rot).clipAngle(90);
  const path = d3.geoPath(proj, ctx);
  const css = getComputedStyle(document.documentElement);
  const v = (k) => css.getPropertyValue(k).trim();
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.fillStyle = v("--surface");
  ctx.fill();
  ctx.strokeStyle = v("--line-2");
  ctx.stroke();
  ctx.beginPath();
  path(d3.geoGraticule10());
  ctx.strokeStyle = v("--line");
  ctx.lineWidth = 0.5;
  ctx.stroke();
  if (land) {
    ctx.beginPath();
    path(land);
    ctx.fillStyle = v("--raise");
    ctx.fill();
  }
  const at = (n) => {
    const d = state.devices.find((x) => x.node === n);
    return d && (d.lat || d.lon) ? [d.lon, d.lat] : null;
  };
  for (const m of state.moves.slice(-3)) {
    const a = at(m.from), b = at(m.to);
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) {
      ctx.beginPath();
      path({ type: "LineString", coordinates: [a, b] });
      ctx.strokeStyle = v("--acc");
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  for (const d of state.devices) {
    const p = d.lat || d.lon ? proj([d.lon, d.lat]) : null;
    if (!p)
      continue;
    const held = d.node === state.holder;
    ctx.beginPath();
    ctx.arc(p[0], p[1], held ? 5 : 3.5, 0, 7);
    ctx.fillStyle = held ? v("--live") : v("--acc");
    ctx.fill();
    if (held) {
      const k = Date.now() / 900 % 1;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 6 + k * 14, 0, 7);
      ctx.strokeStyle = `rgba(155,209,107,${1 - k})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = v("--ink");
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(`${d.label}${held ? " \xB7 holds the pad" : ""}`, p[0] + 9, p[1] + 3);
  }
}
function spin() {
  const h = state.devices.find((d) => d.node === state.holder);
  if (h && (h.lat || h.lon))
    rot = [rot[0] + (-h.lon - rot[0]) * 0.03, rot[1] + (-h.lat * 0.6 - rot[1]) * 0.03];
  globe();
  requestAnimationFrame(spin);
}
var padc = null;
async function padConnect() {
  padc?.close();
  padc = await pad(state.devices);
}
async function padRead() {
  if (!padc)
    await padConnect();
  const t = performance.now();
  let r;
  try {
    r = await padc.read("follow-me");
  } catch {
    await padConnect();
    r = await padc.read("follow-me");
  }
  push("pad", performance.now() - t);
  if ("ok" in r) {
    state.padText = r.ok.text;
    $("pad").textContent = r.ok.text || "(empty: type below)";
    $("padmeta").textContent = `version ${r.ok.version} \xB7 answered by ${label(r.ok.node)} \xB7 state.store key sessionpad/pads/follow-me`;
  }
}
async function padAppend(text) {
  if (!padc)
    await padConnect();
  let r;
  try {
    r = await padc.append({ pad: "follow-me", text });
  } catch {
    await padConnect();
    r = await padc.append({ pad: "follow-me", text });
  }
  if ("err" in r)
    return log("err", `append: ${JSON.stringify(r.err)}`);
  state.padText = r.ok.text;
  $("pad").textContent = r.ok.text;
  log("pad", `typed ${JSON.stringify(text.trim())} on ${label(r.ok.node)} (version ${r.ok.version})`);
}
function push(node, ms) {
  const s = series.get(node) ?? [];
  s.push({ t: Date.now(), ms });
  if (s.length > 200)
    s.shift();
  series.set(node, s);
}
async function resolve(why) {
  const h = await holder();
  if (h !== state.holder)
    log("find", `net.find Resolve session.pad@1 -> ${h ? label(h) : "no holder"}${why ? ` (${why})` : ""}`);
  state.holder = h;
  $("holder").textContent = h ? label(h) : "none";
}
async function move() {
  if (state.moving)
    return;
  state.moving = true;
  $("follow").disabled = true;
  const from = state.holder, to = state.best || state.holder;
  const before = state.padText;
  log("move", from === to ? `restart session.pad on ${label(to)} (it is already the nearest device)` : `follow me: ${label(from)} -> ${label(to)}`);
  try {
    const t = performance.now();
    const r = await follow(from, to);
    log("move", `orch.up answered in ${((performance.now() - t) / 1e3).toFixed(1)} s: ${JSON.stringify(r, (_, v) => typeof v === "bigint" ? Number(v) : v).slice(0, 160)}`);
    state.moves.push({ t: Date.now(), from, to });
    for (let i = 0; i < 30; i++) {
      await resolve("after the move");
      if (state.holder)
        break;
      await new Promise((r2) => setTimeout(r2, 1e3));
    }
    await padConnect();
    await padRead();
    log("pad", state.padText.startsWith(before) ? `text typed before the move is still there (${before.length} characters)` : "text changed during the move");
  } catch (e) {
    log("err", `move: ${e}`);
  }
  state.moving = false;
  $("follow").disabled = false;
}
async function probeLoop() {
  for (; ; ) {
    try {
      const s = await probe(state.devices);
      for (const x of s)
        push(x.node, x.rtt_ms);
      const h = s.find((x) => x.node === state.holder);
      $("rtt").textContent = h ? h.rtt_ms.toFixed(1) : "-";
      $("devs").innerHTML = s.map((x) => `<li><span>${label(x.node)}${x.node === state.holder ? " <b>holder</b>" : ""}</span><span class="v">${x.rtt_ms.toFixed(1)} <small>ms</small></span></li>`).join("");
      if (!state.moving)
        await padRead();
      chart();
    } catch (e) {
      log("err", `probe: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
async function watchLoop() {
  for (; ; ) {
    try {
      for await (const a of await watch()) {
        state.advice = a;
        state.best = a.best.slice(0, 16);
        $("advice").textContent = a.why;
        $("gain").textContent = a.gain_ms.toFixed(1);
        $("streak").textContent = `${a.streak}`;
        if (a.suggest && state.follow && !state.moving && a.best && a.holder)
          move();
      }
    } catch (e) {
      log("err", `watch: ${e}`);
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
}
async function main() {
  if (!grant) {
    $("nogrant").hidden = false;
    return;
  }
  fetch("follow.ts").then((r) => r.text()).then((t) => $("code").textContent = t).catch(() => {
  });
  await globeInit();
  requestAnimationFrame(spin);
  state.devices = await devices();
  $("ndev").textContent = `${state.devices.length}`;
  log("find", `${state.devices.length} opted-in device(s): ${state.devices.map((d) => d.label).join(", ")}`);
  await resolve("page open");
  probeLoop();
  watchLoop();
  $("follow").onclick = () => {
    state.follow = true;
    $("follow").setAttribute("aria-pressed", "true");
    if (state.advice && (state.advice.suggest || state.best === state.holder))
      move();
  };
  $("type").onsubmit = (ev) => {
    ev.preventDefault();
    const i = $("typein");
    if (i.value.trim())
      padAppend(i.value.trim() + " ");
    i.value = "";
  };
  setInterval(chart, 1e3);
}
main().catch((e) => log("err", `${e}`));
