// Global trainer count for Choice: Cursed Draft.
// GET  /api/stats            -> {"cursed":N,"calamity":N,"total":N}
// POST /api/stats {"mode":"cursed"|"calamity"} -> adds 2 trainers (one draw = 2 players), returns new totals
// Storage: Upstash Redis (Vercel Marketplace). Env vars are added automatically when you connect the store.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEYS = { cursed: "choice:trainers:cursed", calamity: "choice:trainers:calamity" };

async function redis(...cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}
async function totals() {
  const [c, k] = await redis("MGET", KEYS.cursed, KEYS.calamity);
  const cursed = Number(c) || 0, calamity = Number(k) || 0;
  return { cursed, calamity, total: cursed + calamity };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    if (req.method === "GET") return res.status(200).json(await totals());
    if (req.method === "POST") {
      const mode = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}).mode;
      if (!KEYS[mode]) return res.status(400).json({ error: "mode must be cursed or calamity" });
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
