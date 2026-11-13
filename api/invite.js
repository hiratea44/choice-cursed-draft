// Link Battle invite links (/r/CODE): a page with a "you've been challenged" preview card for chat apps,
// which then sends the visitor straight into the room.
const BASE = "https://choice-cursed-draft.vercel.app";
export default function handler(req, res) {
  const c = String(req.query.c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const to = c ? "/?room=" + c : "/";
  const title = c ? "⚔ คุณถูกท้าแบทเทิล! ห้อง " + c + " · Choice: Cursed Draft" : "Choice: Cursed Draft";
  const desc = "กดลิงก์เพื่อเข้าห้อง Link Battle · เล่นคนละเครื่อง สั่งการพร้อมกัน คนอื่นเข้ามาดูได้";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).send(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Choice: Cursed Draft">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta property="og:url" content="${BASE}/r/${c}"><meta property="og:image" content="${BASE}/og-invite.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${to}">
<link rel="icon" type="image/png" href="/favicon-32.png">
</head><body style="background:#1a2034;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
<p>กำลังเข้าห้อง ${c}…</p><p><a style="color:#f6c61c" href="${to}">กดที่นี่ถ้ายังไม่ไป</a></p>
<script>location.replace(${JSON.stringify(to)})</script></body></html>`);
}
