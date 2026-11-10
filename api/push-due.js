// Vercel serverless function: anropas av Supabase (pg_cron) när timers har gått ut.
// Hämtar vilka notiser som ska skickas (skyddat med en hemlighet som bara databasen känner till)
// och skickar dem som pushnotiser till användarnas telefoner och datorer.
const webpush = require("web-push");

async function rpc(name, args) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.message) || `rpc ${name} ${r.status}`);
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const secret = String(req.headers["x-cron-secret"] || "");
  if (!secret) return res.status(401).end();
  let due;
  try { due = await rpc("recipe_push_due", { p_secret: secret }); }
  catch (e) { return res.status(401).json({ error: "nekad" }); }
  const items = (due && due.items) || [];
  if (!items.length) return res.status(200).json({ sent: 0 });
  webpush.setVapidDetails("mailto:recept@sivander.com", due.vapid_public, due.vapid_private);
  let sent = 0;
  await Promise.all(items.map(async (it) => {
    const payload = JSON.stringify({ title: it.title || "Timern är klar", body: it.body || "", url: it.url || "/", tag: "timer-" + it.timer });
    try { await webpush.sendNotification(it.sub, payload, { TTL: 600, urgency: "high" }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { try { await rpc("recipe_push_gone", { p_secret: secret, p_endpoint: it.sub.endpoint }); } catch {} }
      else console.error("push", e.statusCode, e.body);
    }
  }));
  return res.status(200).json({ sent, total: items.length });
};
