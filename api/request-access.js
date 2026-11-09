// Vercel serverless function: tar emot en förfrågan om tillgång, sparar den i Supabase
// och mejlar superanvändaren via Resend (om RESEND_API_KEY finns).
//
// Miljövariabler i Vercel:
//   RESEND_API_KEY  – från resend.com (API Keys)
//   NOTIFY_EMAIL    – vem som får mejlet (standard: nicklas.sivander@gmail.com)
//   NOTIFY_FROM     – avsändare (standard: Sivander's Recept <onboarding@resend.dev>)
//   VAPID_PRIVATE_KEY – för pushnotiser till superanvändarnas telefoner/datorer

const VAPID_PUBLIC = "BA2Icb0ajrelU-ZBp_9MzhDPe7rl5cgIC1iRZM1EJl_NafNWJ9a6Gs98FRr8zePfW3Svu-y1njqq_dibeKhl26A";

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST" });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, RESEND_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).json({ error: "Servern saknar Supabase-inställningar" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = String((body && body.email) || "").trim().toLowerCase().slice(0, 200);
  const name = String((body && body.name) || "").trim().slice(0, 80);
  const message = String((body && body.message) || "").trim().slice(0, 500);

  // Spara via samma databasfunktion som appen (validering och spamskydd sker där)
  const auth = String(req.headers.authorization || "");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_request_access`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth.startsWith("Bearer ") ? auth : `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_email: email, p_name: name, p_message: message }),
  });
  const result = await r.json().catch(() => null);
  if (!r.ok) return res.status(400).json({ error: (result && result.message) || "Kunde inte spara förfrågan" });

  let pushed = 0;
  if (result === "skickad" && process.env.VAPID_PRIVATE_KEY) {
    try {
      const webpush = require("web-push");
      webpush.setVapidDetails("mailto:" + (process.env.NOTIFY_EMAIL || "nicklas.sivander@gmail.com"), VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);
      const t = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_push_targets`, {
        method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" }, body: "{}",
      });
      const subs = t.ok ? await t.json() : [];
      const payload = JSON.stringify({
        title: "Ny förfrågan om tillgång",
        body: `${name || email} vill komma in i Sivander's Recept${message ? ": " + message.slice(0, 120) : ""}`,
        url: "/#anvandare", tag: "access-" + email,
      });
      await Promise.all((subs || []).map(async (sub) => {
        try { await webpush.sendNotification(sub, payload, { TTL: 86400, urgency: "high" }); pushed++; }
        catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_push_delete`, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_endpoint: sub.endpoint }) });
          } else console.error("Push:", e.statusCode, e.body);
        }
      }));
    } catch (e) { console.error("Push:", e); }
  }

  let mailed = false;
  if (result === "skickad" && RESEND_API_KEY) {
    const to = process.env.NOTIFY_EMAIL || "nicklas.sivander@gmail.com";
    const from = process.env.NOTIFY_FROM || "Sivander's Recept <onboarding@resend.dev>";
    const who = name || email;
    const html = `<div style="font-family:Georgia,serif;color:#1c1a1b;max-width:520px">
      <h2 style="font-weight:400;color:#5c1a24;margin:0 0 12px">Ny förfrågan om tillgång</h2>
      <p style="font-family:Arial,sans-serif;font-size:15px;margin:0 0 6px"><b>${esc(who)}</b> &lt;${esc(email)}&gt; vill komma in i Sivander's Recept.</p>
      ${message ? `<p style="font-family:Arial,sans-serif;font-size:15px;font-style:italic;border-left:3px solid #9c7a3c;padding-left:10px;margin:12px 0">${esc(message)}</p>` : ""}
      <p style="font-family:Arial,sans-serif;font-size:15px;margin:18px 0"><a href="https://recept.sivander.com/" style="background:#1c1a1b;color:#fff;padding:10px 16px;text-decoration:none">Öppna appen och godkänn</a></p>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#777">Du hittar förfrågan under Konto → Hantera användare.</p></div>`;
    try {
      const m = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], reply_to: email, subject: `${who} vill ha tillgång till Sivander's Recept`, html }),
      });
      mailed = m.ok;
      if (!m.ok) console.error("Resend:", m.status, await m.text());
    } catch (e) { console.error("Resend:", e); }
  }
  return res.status(200).json({ result, mailed, pushed });
};
