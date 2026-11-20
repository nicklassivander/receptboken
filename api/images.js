// Vercel serverless function: bildförslag till ett recept från en gratis bildbank
// (Pixabay i första hand, Pexels om bara den nyckeln finns).
// Claude gör engelska sökord av receptets namn och ingredienser, sedan söker vi i bildbanken.
// Bara inloggade som får lägga till och ändra recept får använda den.

const MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";
// Pixabay vill att sökningar cachas i 24 h – vi sparar svaren i minnet så länge funktionen lever
const cache = new Map();
const DAY = 24 * 3600 * 1000;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST" });

  const { SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, PEXELS_API_KEY, PIXABAY_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(500).json({ error: "Servern saknar inställningar." });
  if (!PIXABAY_API_KEY && !PEXELS_API_KEY) return res.status(503).json({ error: "Bildförslag är inte påslagna än (nyckel till bildbanken saknas).", code: "nokey" });
  const source = PIXABAY_API_KEY ? "Pixabay" : "Pexels";

  // 1. Vem frågar?
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
    if (!["contributor", "editor", "admin"].includes(role)) return res.status(403).json({ error: "Du har inte behörighet" });
  } catch {
    return res.status(502).json({ error: "Kunde inte nå Supabase" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const title = String(body.title || "").slice(0, 200).trim();
  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : []).map((x) => String(x).slice(0, 80)).slice(0, 15);
  const own = String(body.q || "").slice(0, 120).trim();
  const page = Math.max(1, Math.min(5, parseInt(body.page, 10) || 1));
  const drink = !!body.drink;   // från baren: bara bilder på drinkar
  if (!title && !own) return res.status(400).json({ error: "Receptet saknar namn" });

  // 2. Sökord: egna ord översätts/förbättras, annars gör Claude dem av receptet
  let queries = [];
  if (ANTHROPIC_API_KEY) {
    try {
      const prompt = drink
        ? (own
          ? `Gör om den här bildsökningen till 2 korta engelska sökfraser (2–5 ord var) för foton av en färdig drink i ett glas på en bildbank: "${own}". Drinken heter "${title}". Varje fras ska innehålla "cocktail" eller "drink". Svara bara med en JSON-lista med strängar.`
          : `Drinken heter "${title}". Ingredienser: ${ingredients.join(", ") || "okända"}.\nGe 3 korta engelska sökfraser (2–5 ord) för att hitta ett snyggt foto av just den här drinken serverad i ett glas på en bildbank. Varje fras ska innehålla "cocktail" eller "drink" (eller "mocktail" om drinken är alkoholfri). Första frasen mest exakt (t.ex. drinkens namn + cocktail), sista mer allmän. Svara bara med en JSON-lista med strängar.`)
        : own
        ? `Gör om den här bildsökningen till 2 korta engelska sökfraser för matfoton på en bildbank (2–5 ord var): "${own}". Rätten heter "${title}". Svara bara med en JSON-lista med strängar.`
        : `Rätten heter "${title}". Huvudingredienser: ${ingredients.join(", ") || "okända"}.\nGe 3 korta engelska sökfraser (2–5 ord) för att hitta ett snyggt foto av den färdiga rätten på en bildbank. Första frasen ska vara mest exakt, sista mer allmän. Svara bara med en JSON-lista med strängar.`;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
      });
      const j = await r.json().catch(() => ({}));
      const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const m = text.match(/\[[\s\S]*\]/);
      if (m) queries = JSON.parse(m[0]).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 3);
    } catch {}
  }
  if (!queries.length) queries = [own || title];
  if (drink) {
    queries = queries.map((q) => /cocktail|drink|mocktail|spritz|martini/i.test(q) ? q : q + " cocktail");
    // reserv: en allmän drinkbild om de exakta sökningarna inte ger något
    if (!queries.some((q) => /^cocktail glass$/i.test(q))) queries.push("cocktail glass");
  }
  // drinkbilder: bilden måste vara taggad som dryck och får inte vara taggad som mat
  const DRINK_RE = /cocktail|drink|beverage|mocktail|martini|mojito|spritz|margarita|daiquiri|negroni|gin|vodka|rum|whisk|bourbon|tequila|liquor|liqueur|alcohol|aperitif|champagne|prosecco|wine|glass|lemonade|juice|smoothie|soda|tonic|bar\b/i;
  const FOOD_RE = /\b(food|dish|meal|curry|soup|noodle|rice|salad|pasta|pizza|meat|chicken|pork|beef|fish|seafood|shrimp|stir.?fry|wok|plate|bowl|vegetable|cooking|kitchen|restaurant food|lunch|dinner)\b/i;
  const drinkOk = (alt) => DRINK_RE.test(alt) && !FOOD_RE.test(alt);

  // 3. Sök i bildbanken: liggande bilder, minst 1200 px breda
  const seen = new Set(), photos = [];
  let limited = false;
  for (const q of queries) {
    if (photos.length >= 12 || (drink && q === "cocktail glass" && photos.length >= 4)) break;
    try {
      const key = source + "|" + (drink ? "d|" : "") + q + "|" + page;
      let list = null;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.t < DAY) list = hit.list;
      else {
        let r;
        if (source === "Pixabay") {
          r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(q)}&image_type=photo&${drink ? "orientation=all&min_width=900" : "orientation=horizontal&min_width=1200"}&safesearch=true&per_page=20&page=${page}`);
        } else {
          r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&${drink ? "" : "orientation=landscape&"}per_page=12&page=${page}`, { headers: { Authorization: PEXELS_API_KEY } });
        }
        if (r.status === 429) { limited = true; break; }
        if (!r.ok) continue;
        const j = await r.json();
        list = source === "Pixabay"
          ? (j.hits || []).map((p) => ({ id: "x" + p.id, w: p.imageWidth, h: p.imageHeight, thumb: p.webformatURL, full: p.largeImageURL || p.webformatURL, alt: p.tags || "",
              photographer: p.user || "", photographerUrl: p.user && p.user_id ? `https://pixabay.com/users/${p.user}-${p.user_id}/` : "", pageUrl: p.pageURL || "" }))
          : (j.photos || []).map((p) => ({ id: "p" + p.id, w: p.width, h: p.height, thumb: p.src && (p.src.medium || p.src.small), full: p.src && (p.src.large2x || p.src.large || p.src.original), alt: p.alt || "",
              photographer: p.photographer || "", photographerUrl: p.photographer_url || "", pageUrl: p.url || "" }));
        cache.set(key, { t: Date.now(), list });
        if (cache.size > 300) cache.delete(cache.keys().next().value);
      }
      for (const p of list) {
        if (seen.has(p.id) || !p.thumb || !p.full) continue;
        if (drink ? (p.w < 900 || !drinkOk(p.alt)) : (p.w < 1200 || p.h > p.w)) continue;
        seen.add(p.id);
        const { w, h, ...rest } = p;
        photos.push(rest);
      }
    } catch {}
  }
  if (!photos.length && limited) return res.status(429).json({ error: "Bildbanken har fått för många sökningar just nu. Prova igen om en stund." });
  return res.status(200).json({ source, queries, photos: photos.slice(0, 12) });
};
