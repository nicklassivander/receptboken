// Vercel serverless function: anropar Claude med Nicklas egen API-nyckel.
// Bara inloggade som finns i recipe_users (lägst "Lägga till och ändra") får använda den.

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const MAX_IMAGES = 6;
const MAX_IMAGE_B64 = 1_500_000; // ca 1,1 MB per bild efter base64

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST" });

  const { SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Servern saknar inställningar (miljövariabler i Vercel)." });
  }

  // 1. Vem frågar? Kontrollera inloggningen mot Supabase.
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Inte inloggad" });
  try {
    const check = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_my_role`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!check.ok) return res.status(401).json({ error: "Inloggningen gick inte att verifiera" });
    const role = await check.json();
    if (!["contributor", "editor", "admin"].includes(role)) {
      return res.status(403).json({ error: role === "viewer" ? "Läsbehörighet kan inte använda AI" : "Du har inte behörighet" });
    }
  } catch {
    return res.status(502).json({ error: "Kunde inte nå Supabase" });
  }

  // 2. Bygg frågan: en konversation, eventuellt med bilder i första meddelandet.
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  let messages = Array.isArray(body.messages) ? body.messages : [];
  messages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 30000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Tom fråga" });
  }

  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((i) => i && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type) && typeof i.data === "string" && i.data.length <= MAX_IMAGE_B64)
    .slice(0, MAX_IMAGES);
  if (images.length) {
    const first = messages.findIndex((m) => m.role === "user");
    messages[first] = {
      role: "user",
      content: [
        ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
        { type: "text", text: messages[first].content },
      ],
    };
  }
  const maxTokens = body.mode === "json" ? 8000 : 2000;

  // 3. Fråga Claude.
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `Claude svarade ${r.status}`;
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Tomt svar från Claude" });
    return res.status(200).json({ text, truncated: j.stop_reason === "max_tokens" });
  } catch {
    return res.status(502).json({ error: "Kunde inte nå Claude" });
  }
};
