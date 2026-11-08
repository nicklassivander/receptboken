// Vercel serverless function: hämtar en receptsida åt appen (webbläsaren får inte läsa andra sajter direkt).
// Plockar ut receptdata (schema.org/Recipe) om sidan har det, annars sidans text, plus huvudbilden.

const net = require("net");
const dns = require("dns").promises;

const MAX_HTML = 3_000_000;
const MAX_IMG = 3_000_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function checkUser(req) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recipe_my_role`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return ["contributor", "editor", "admin"].includes(await r.json());
}

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}
async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null;
  } catch { return null; }
  return u;
}

async function get(url, max, accept) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const u = await safeUrl(cur);
    if (!u) throw new Error("Ogiltig adress");
    const r = await fetch(u, { redirect: "manual", headers: { "user-agent": UA, accept, "accept-language": "sv-SE,sv;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(12000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location"), u).toString(); continue; }
    if (!r.ok) throw new Error(`Sidan svarade ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error("Sidan är för stor");
    return { buf, type: r.headers.get("content-type") || "", url: u.toString() };
  }
  throw new Error("För många omdirigeringar");
}

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (s) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function findRecipes(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => findRecipes(n, out)); return; }
  const t = node["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) out.push(node);
  if (node["@graph"]) findRecipes(node["@graph"], out);
}
function stepsOf(ins) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === "string") { strip(x).split(/\n+/).forEach((l) => l.trim() && out.push(l.trim())); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x["@type"] === "HowToSection") { if (x.name) out.push("# " + strip(x.name)); walk(x.itemListElement); return; }
    if (x.text) out.push(strip(x.text)); else if (x.name) out.push(strip(x.name));
  };
  walk(ins);
  return out;
}
function recipeText(r) {
  const lines = [];
  if (r.name) lines.push(strip(r.name));
  if (r.description) lines.push(strip(r.description));
  if (r.recipeYield) lines.push("Portioner: " + strip([].concat(r.recipeYield)[0]));
  if (r.totalTime) lines.push("Tid: " + r.totalTime);
  const ings = [].concat(r.recipeIngredient || r.ingredients || []).map(strip).filter(Boolean);
  if (ings.length) lines.push("", "INGREDIENSER", ...ings);
  const steps = stepsOf(r.recipeInstructions);
  if (steps.length) lines.push("", "GÖR SÅ HÄR", ...steps);
  return { text: lines.join("\n"), complete: ings.length > 0 && steps.length > 0 };
}
function imageOf(r, html, base) {
  let img = r && r.image;
  if (Array.isArray(img)) img = img[0];
  if (img && typeof img === "object") img = img.url || img.contentUrl;
  if (!img) { const m = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i); if (m) img = decode(m[1]); }
  try { return img ? new URL(img, base).toString() : null; } catch { return null; }
}
function pageText(html) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<(article|main)[\s\S]*?<\/\1>/i);
  if (main && main[0].length > 1500) h = main[0];
  h = h.replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "\n• ");
  return decode(h.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST" });
  try { if (!(await checkUser(req))) return res.status(401).json({ error: "Inte inloggad eller saknar behörighet" }); }
  catch { return res.status(502).json({ error: "Kunde inte nå Supabase" }); }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const url = String((body && body.url) || "").trim();
  if (!url) return res.status(400).json({ error: "Ingen länk" });

  let page;
  try { page = await get(url, Math.max(MAX_HTML, MAX_IMG), "text/html,application/xhtml+xml,image/*;q=0.9"); }
  catch (e) { return res.status(422).json({ error: "Kunde inte hämta sidan (" + e.message + ")" }); }
  // Länken går direkt till en bild
  const ptype = (page.type.split(";")[0] || "").trim().toLowerCase();
  if (ptype.startsWith("image/")) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(ptype) || page.buf.length > MAX_IMG) return res.status(422).json({ error: "Bildformatet stöds inte" });
    return res.status(200).json({ url: page.url, title: "", text: "", image: `data:${ptype};base64,${page.buf.toString("base64")}` });
  }
  const html = page.buf.toString("utf8");

  const recipes = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { findRecipes(JSON.parse(m[1].trim()), recipes); } catch {}
  }
  const rec = recipes[0] || null;
  if (body.imageOnly) {
    const iu = imageOf(rec, html, page.url);
    if (!iu) return res.status(422).json({ error: "Hittade ingen bild på sidan" });
    try {
      const im = await get(iu, MAX_IMG, "image/*");
      const type = (im.type.split(";")[0] || "").trim();
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error("format");
      return res.status(200).json({ url: page.url, title: "", text: "", image: `data:${type};base64,${im.buf.toString("base64")}` });
    } catch { return res.status(422).json({ error: "Kunde inte hämta bilden från sidan" }); }
  }
  const fromLd = rec ? recipeText(rec) : null;
  const title = rec && rec.name ? strip(rec.name) : strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  // Om receptdatan saknar delar: skicka med sidans text också
  let text = fromLd && fromLd.complete ? fromLd.text : [fromLd ? fromLd.text : "", pageText(html)].filter(Boolean).join("\n\n");
  text = text.slice(0, 25000);

  let image = null;
  const imgUrl = imageOf(rec, html, page.url);
  if (imgUrl && body.withImage !== false) {
    try {
      const im = await get(imgUrl, MAX_IMG, "image/*");
      const type = (im.type.split(";")[0] || "").trim();
      if (/^image\/(jpeg|png|webp|gif)$/.test(type)) image = `data:${type};base64,${im.buf.toString("base64")}`;
    } catch {}
  }

  return res.status(200).json({ url: page.url, title, text, structured: !!(fromLd && fromLd.complete), image });
};
