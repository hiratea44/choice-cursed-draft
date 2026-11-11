// Global trainer count for Choice: Cursed Draft.
// GET  /api/stats            -> {"cursed":N,"calamity":N,"safari":N,"blind":N,"total":N}  (calamity = Double Cursed)
// POST /api/stats {"mode":"cursed"|"calamity"|"safari"|"blind"} -> adds 2 trainers (one draw = 2 players), returns new totals
// Storage: Upstash Redis (Vercel Marketplace). Env vars are added automatically when you connect the store.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEYS = { starter: "choice:trainers:starter", cursed: "choice:trainers:cursed", calamity: "choice:trainers:calamity", safari: "choice:trainers:safari", blind: "choice:trainers:blind", mirror: "choice:trainers:mirror", chaos: "choice:trainers:chaos" };

async function redis(...cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}
async function totals() {
  const [c, k, sa, bl, mi, ch, st] = await redis("MGET", KEYS.cursed, KEYS.calamity, KEYS.safari, KEYS.blind, KEYS.mirror, KEYS.chaos, KEYS.starter);
  const cursed = Number(c) || 0, calamity = Number(k) || 0, safari = Number(sa) || 0, blind = Number(bl) || 0, mirror = Number(mi) || 0, chaos = Number(ch) || 0, starter = Number(st) || 0;
  return { starter, cursed, calamity, safari, blind, mirror, chaos, total: starter + cursed + calamity + safari + blind + mirror + chaos };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    if (req.method === "GET") return res.status(200).json(await totals());
    if (req.method === "POST") {
      const mode = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}).mode;
      if (!KEYS[mode]) return res.status(400).json({ error: "mode must be starter, cursed, calamity, safari, blind, mirror or chaos" });
      // Light anti-spam: one count per visitor IP every 20 seconds.
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
      const ok = await redis("SET", "choice:rl:" + ip, "1", "NX", "EX", "20");
      if (ok) await redis("INCRBY", KEYS[mode], "2");
      return res.status(200).json({ ...(await totals()), counted: !!ok });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
}
