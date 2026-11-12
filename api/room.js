// Link Battle rooms for Choice: Cursed Draft (Union Room).
// The host's device runs the game and pushes the shared state; the guest sends actions into a queue the host drains.
// Spectators only read the state. Storage: the same Upstash Redis as /api/stats. Rooms expire after 2 hours idle.
// Built to spend as few Redis commands as possible (the free plan counts them):
//   a poll that finds nothing new costs 1 command, a state push 2, a guest action 3.
//   POST {op:"create"}                      -> {code, tok}          (host)
//   POST {op:"join", c}                     -> {role:"guest", tok} | {role:"spec"}
//   POST {op:"push", c, tok, d, touch?}     -> {v}                  (host writes the state)
//   POST {op:"act", c, tok, a}              -> {ok:true}            (guest queues an action)
//   GET  ?c=CODE&v=N                        -> {v, d?}              (state, only when its version isn't N)
//   GET  ?c=CODE&q=1&tok=HOST               -> {q:[actions]}        (host drains the queue)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 7200;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VW = 13; // the state is stored as a 13-digit version followed by the JSON, so a poll can read just the version

async function pipe(cmds) {
  const r = await fetch(URL_ + "/pipeline", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map(x => x.result);
}
const rnd = n => Array.from({ length: n }, () => ABC[Math.floor(Math.random() * ABC.length)]).join("");
// The queue's key carries the host's secret token, so draining it needs no separate check.
const K = (c, host) => ({ m: `rm:${c}:m`, s: `rm:${c}:s`, q: `rm:${c}:q:${host}` });
const clean = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const cleanTok = t => String(t || "").replace(/[^A-Z0-9]/g, "").slice(0, 32);
const ver = () => String(Date.now()).padStart(VW, "0").slice(-VW);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    if (req.method === "GET") {
      const c = clean(req.query.c);
      if (req.query.q) {
        const tok = cleanTok(req.query.tok); if (!tok) return res.status(403).json({ error: "not host" });
        const [q] = await pipe([["LPOP", K(c, tok).q, "50"]]);
        return res.status(200).json({ q: (q || []).map(x => JSON.parse(x)) });
      }
      const k = K(c, "");
      const [head] = await pipe([["GETRANGE", k.s, "0", String(VW - 1)]]);
      if (!head) return res.status(404).json({ error: "no room" });
      if (head === String(req.query.v)) return res.status(200).json({ v: head });
      const [s] = await pipe([["GET", k.s]]);
      if (!s) return res.status(404).json({ error: "no room" });
      return res.status(200).json({ v: s.slice(0, VW), d: JSON.parse(s.slice(VW)) });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).end(); }
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.op === "create") {
      for (let i = 0; i < 5; i++) {
        const c = rnd(4), tok = rnd(16), k = K(c, tok);
        const [ok] = await pipe([["SET", k.m, JSON.stringify({ host: tok, guest: null }), "NX", "EX", TTL], ["SET", k.s, ver() + "null", "EX", TTL]]);
        if (ok) return res.status(200).json({ code: c, tok });
      }
      return res.status(503).json({ error: "try again" });
    }
    const c = clean(b.c);
    const [m0] = await pipe([["GET", `rm:${c}:m`]]);
    if (!m0) return res.status(404).json({ error: "no room" });
    const m = JSON.parse(m0), k = K(c, m.host);
    if (b.op === "join") {
      if (m.guest) return res.status(200).json({ role: "spec" });
      m.guest = rnd(16);
      await pipe([["SET", k.m, JSON.stringify(m), "EX", TTL], ["RPUSH", k.q, JSON.stringify({ t: "hello" })], ["EXPIRE", k.q, TTL]]);
      return res.status(200).json({ role: "guest", tok: m.guest });
    }
    if (b.op === "push") {
      if (b.tok !== m.host) return res.status(403).json({ error: "not host" });
      const v = ver(), body = v + JSON.stringify(b.d);
      if (body.length > 900000) return res.status(413).json({ error: "too big" });
      const cmds = [["SET", k.s, body, "EX", TTL]];
      if (b.touch) cmds.push(["EXPIRE", k.m, TTL]);
      await pipe(cmds);
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
