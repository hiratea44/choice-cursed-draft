// Link Battle rooms for Choice: Cursed Draft (Union Room).
// The host's device runs the game and pushes the shared state; the guest sends actions into a queue the host drains.
// Spectators only read the state. Storage: the same Upstash Redis as /api/stats. Rooms expire after 2 hours idle.
//   POST {op:"create"}                      -> {code, tok}          (host)
//   POST {op:"join", c}                     -> {role:"guest", tok} | {role:"spec"}
//   POST {op:"push", c, tok, d}             -> {v}                  (host writes the state)
//   POST {op:"act", c, tok, a}              -> {ok:true}            (guest queues an action)
//   GET  ?c=CODE&v=N                        -> {v, d?}              (state, only when newer than v)
//   GET  ?c=CODE&q=1&tok=HOST               -> {v, q:[actions]}     (host drains the queue)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 7200;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function pipe(cmds) {
  const r = await fetch(URL_ + "/pipeline", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map(x => x.result);
}
const rnd = n => Array.from({ length: n }, () => ABC[Math.floor(Math.random() * ABC.length)]).join("");
const K = c => ({ m: `rm:${c}:m`, s: `rm:${c}:s`, q: `rm:${c}:q` });
const clean = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    if (req.method === "GET") {
      const c = clean(req.query.c), k = K(c);
      if (req.query.q) {
        const [m, s, q] = await pipe([["GET", k.m], ["GET", k.s], ["LPOP", k.q, "50"]]);
        if (!m) return res.status(404).json({ error: "no room" });
        if (JSON.parse(m).host !== req.query.tok) return res.status(403).json({ error: "not host" });
        return res.status(200).json({ v: s ? JSON.parse(s).v : 0, q: (q || []).map(x => JSON.parse(x)) });
      }
      const [s] = await pipe([["GET", k.s]]);
      if (!s) return res.status(404).json({ error: "no room" });
      const st = JSON.parse(s), v = +req.query.v;
      return res.status(200).json(st.v === v ? { v: st.v } : st);
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).end(); }
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.op === "create") {
      for (let i = 0; i < 5; i++) {
        const c = rnd(4), k = K(c), tok = rnd(16);
        const [ok] = await pipe([["SET", k.m, JSON.stringify({ host: tok, guest: null }), "NX", "EX", TTL], ["SET", k.s, JSON.stringify({ v: 0, d: null }), "EX", TTL]]);
        if (ok) return res.status(200).json({ code: c, tok });
      }
      return res.status(503).json({ error: "try again" });
    }
    const c = clean(b.c), k = K(c);
    const [m0] = await pipe([["GET", k.m]]);
    if (!m0) return res.status(404).json({ error: "no room" });
    const m = JSON.parse(m0);
    if (b.op === "join") {
      if (m.guest) return res.status(200).json({ role: "spec" });
      m.guest = rnd(16);
      await pipe([["SET", k.m, JSON.stringify(m), "EX", TTL], ["RPUSH", k.q, JSON.stringify({ t: "hello" })], ["EXPIRE", k.q, TTL]]);
      return res.status(200).json({ role: "guest", tok: m.guest });
    }
    if (b.op === "push") {
      if (b.tok !== m.host) return res.status(403).json({ error: "not host" });
      const [s0] = await pipe([["GET", k.s]]);
      const v = (s0 ? JSON.parse(s0).v : 0) + 1, body = JSON.stringify({ v, d: b.d });
      if (body.length > 900000) return res.status(413).json({ error: "too big" });
      await pipe([["SET", k.s, body, "EX", TTL], ["EXPIRE", k.m, TTL], ["EXPIRE", k.q, TTL]]);
      return res.status(200).json({ v });
    }
    if (b.op === "act") {
      if (b.tok !== m.guest) return res.status(403).json({ error: "not guest" });
      await pipe([["RPUSH", k.q, JSON.stringify(b.a || {})], ["EXPIRE", k.q, TTL]]);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "bad op" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
}
