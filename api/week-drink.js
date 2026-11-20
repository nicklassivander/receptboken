// Vercel serverless function: Veckans drink. Anropas av Supabase (pg_cron) varje måndag morgon.
// Matilda (Haiku med webbsökning) kollar drinktrender på nätet och väger ihop dem med familjens aktivitet
// senaste veckan (blandat, gillat, frågat Matilda). Samma drink väljs inte flera veckor i rad.
const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";

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

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const secret = String(req.headers["x-cron-secret"] || "");
  if (!secret) return res.status(401).end();
  let input;
  try { input = await rpc("recipe_week_drink_input", { p_secret: secret }); }
  catch { return res.status(401).json({ error: "nekad" }); }

  const drinks = (input && input.drinks) || [];
  if (!drinks.length) return res.status(200).json({ pick: null });
  const hist = ((input && input.history) || []).map((h) => h.id);
  // Hoppa över de senaste valen (högst 4, men alltid minst en drink kvar)
  const skip = new Set(hist.slice(-Math.min(4, drinks.length - 1)));
  const pool = drinks.filter((d) => !skip.has(d.id));
  const score = (d) => d.mixedWeek * 3 + d.likedWeek * 2 + d.matildaWeek + Math.min(d.likes, 5) * 0.3;
  const fallback = pool.slice().sort((a, b) => score(b) - score(a) || Math.random() - 0.5)[0];

  let pick = { id: fallback.id, title: fallback.title, why: "", trend: "" };
  const { ANTHROPIC_API_KEY } = process.env;
  if (ANTHROPIC_API_KEY) {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "long", year: "numeric" });
    const list = pool.map((d) => `- id ${d.id}: ${d.title} (${(d.ingredients || []).join(", ")}) – senaste veckan: blandad ${d.mixedWeek} gånger, gillad ${d.likedWeek} gånger, frågor till Matilda ${d.matildaWeek}; gillad av ${d.likes} totalt`).join("\n");
    const prompt = `Du är Matilda, bartendern i familjen Sivanders hemmabar. Det är ${today}. Välj Veckans drink ur familjens bar.

1. Sök kort på nätet efter vilka cocktails och drinkar som är populära eller trendar just nu (säsong, högtider, trender i Sverige och internationellt). Högst två sökningar.
2. Väg ihop trenderna med familjens aktivitet senaste veckan (blandat och gillat väger mest, sedan frågor till dig).
3. Välj EN drink ur listan nedan. Du får bara välja en drink som står i listan.

DRINKAR ATT VÄLJA MELLAN:
${list}

Svara bara med JSON: {"id": "<id ur listan>", "why": "<en mening på svenska i din röst, max 18 ord, varför just den här veckan>", "trend": "<vad som trendar, max 8 ord>"}`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: FAST_MODEL, max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "SE" } }],
        }),
      });
      const j = await r.json().catch(() => ({}));
      const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
      const o = text && parseJson(text);
      const hit = o && pool.find((d) => d.id === String(o.id));
      if (hit) pick = { id: hit.id, title: hit.title, why: String(o.why || "").slice(0, 160), trend: String(o.trend || "").slice(0, 80) };
      else console.error("week-drink: inget giltigt val", r.status, text && text.slice(0, 200));
    } catch (e) { console.error("week-drink", e && e.message); }
  }
  pick.at = new Date().toISOString();
  try { await rpc("recipe_week_drink_save", { p_secret: secret, p_pick: pick }); }
  catch (e) { return res.status(500).json({ error: "kunde inte spara" }); }
  return res.status(200).json({ pick });
};
