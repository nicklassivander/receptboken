
// ---------- state ----------
const sample = true, sampleImages = true;   // AI finns alltid i webbversionen
let recipes = [], loaded = false, loadNote = "", storageOk = true;
let view = { name: "list" };              // list | detail | edit
let filter = { q: "", tags: [], fav: false, mine: false, cookedMe: false, sort: "new" };
let filterOpen = false; let filterMore = false;
// Fasta nyckelord i grupper – håller listan kort och sökbar
const TAG_GROUPS = [
  ["Rätt", ["förrätt", "varmrätt", "efterrätt", "tilltugg", "tillbehör", "dryck"]],
  ["Mattyp", ["kött", "fläsk", "kyckling", "fisk", "skaldjur", "vegetariskt"]],
  ["Tillfälle", ["vardag", "fest", "jul"]],
  ["Metod", ["grill", "långkok"]],
];
// Hur ord utanför listan ska sorteras in
const TAG_HINTS = 'sås, dressing, bröd och sallad räknas som "tillbehör"; soppa som "förrätt" eller "varmrätt"; nöt, vilt, lamm och färs som "kött"; skinka, bacon och gris som "fläsk"; räkor, musslor och hummer som "skaldjur"; varje varmrätt eller förrätt ska ha exakt en mattyp (kött, fläsk, kyckling, fisk, skaldjur eller vegetariskt); helg och bjudmat som "fest"; påsk och midsommar som "fest"; gryta och ugn utan lång tid räknas inte som metod.';
let customTagGroups = null;   // sparas i databasen (rad "_settings_tags"), annars standardlistan
const SETTINGS_ID = "_settings_tags";
const tagGroups = () => (customTagGroups && customTagGroups.length ? customTagGroups : TAG_GROUPS);
const tagVocab = () => tagGroups().flatMap(g => g[1]);
function splitSettings(list){
  const st = list.find(r => r.id === SETTINGS_ID);
  if (st && Array.isArray(st.groups)) customTagGroups = st.groups;
  return list.filter(r => r.id !== SETTINGS_ID);
}
// Telefon/surfplatta med kamera: visa "Ta foto" (öppnar kameran direkt)
const HAS_CAMERA = matchMedia("(pointer: coarse)").matches && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent + (navigator.maxTouchPoints > 1 ? " ipad" : ""));
let pendingReqs = 0;  // förfrågningar om tillgång (bara superanvändare)
let layout = "grid";
try { layout = localStorage.getItem("layout") === "list" ? "list" : "grid"; } catch {}
let draft = null;                          // recipe being edited
let menuOpen = false;
let detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null };
let importState = null;
let SHARE_Q = new URLSearchParams(location.search);  // läses innan historiken skriver om adressen

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const linesOf = t => String(t || "").split("\n").map(s => s.trim()).filter(Boolean);
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

function toast(msg){ const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }

function sourceType(url){
  if (!url) return "own";
  if (/instagram\.com|instagr\.am/i.test(url)) return "ig";
  if (/tiktok\.com/i.test(url)) return "tt";
  if (/youtube\.com|youtu\.be/i.test(url)) return "yt";
  return "web";
}
function sourceBadge(r){
  const t = sourceType(r.sourceUrl);
  const host = (() => { try { return new URL(r.sourceUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (t === "ig") return `<span class="badge ig">Instagram</span>`;
  if (t === "tt") return `<span class="badge ig">TikTok</span>`;
  if (t === "yt") return `<span class="badge web">YouTube</span>`;
  if (t === "web") return `<span class="badge web">${esc(host || "Webb")}</span>`;
  return `<span class="badge own">Eget</span>`;
}
const isModified = r => !!(r.myChanges || (r.original && (!sameList(r.original.ingredients, r.ingredients) || !sameList(r.original.steps, r.steps))));

function fmtDate(d){ if (!d) return ""; try { return new Date(d).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }

// ---------- scaling ----------
const UNI = { "½": .5, "¼": .25, "¾": .75, "⅓": 1/3, "⅔": 2/3, "⅛": .125 };
function fmtNum(n){
  if (n >= 10) return String(Math.round(n));
  const r = Math.round(n * 4) / 4;
  const v = Math.abs(r - n) < 0.06 ? r : Math.round(n * 10) / 10;
  return String(v).replace(".", ",");
}
function scaleLine(line, f){
  if (f === 1) return line;
  const re = /^(\s*)(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])(\s*[-–]\s*(\d+(?:[.,]\d+)?))?/;
  const m = line.match(re);
  if (!m) return line;
  const parse = s => {
    s = s.trim();
    let tot = 0;
    const u = s.match(/[½¼¾⅓⅔⅛]/); if (u) { tot += UNI[u[0]]; s = s.replace(u[0], "").trim(); }
    if (!s) return tot;
    if (/^\d+\s+\d+\/\d+$/.test(s)) { const [w, fr] = s.split(/\s+/); const [a, b] = fr.split("/"); return tot + (+w) + a / b; }
    if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split("/"); return tot + a / b; }
    return tot + parseFloat(s.replace(",", "."));
  };
  let out = m[1] + fmtNum(parse(m[2]) * f);
  if (m[4]) out += "–" + fmtNum(parse(m[4]) * f);
  return out + line.slice(m[0].length);
}

// ---------- data (Supabase) ----------
let sb = null, me = null, role = null;
const ROLE_ORDER = ["viewer", "contributor", "editor", "admin"];
const ROLE_LABEL = { viewer: "Läsa", contributor: "Egna recept", editor: "Egna recept", admin: "Superanvändare" };  // editor = äldre nivå, samma rättigheter som contributor
const can = r => ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(r);
const newId = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return "r-" + [...a].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

// ---------- offline: recepten sparas på enheten ----------
const CACHE_KEY = "recept-cache-v1";
function writeCache(){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ me, role, at: Date.now(), recipes, tagGroups: customTagGroups })); } catch {}
}
function readCache(){
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return c && Array.isArray(c.recipes) ? c : null; } catch { return null; }
}

async function loadAll(){
  const { data: rows, error } = await sb.from("recipes").select("id,data");
  loaded = true;
  if (error) {
    const c = readCache();
    if (c && c.recipes.length) { recipes = c.recipes; loadNote = "Du är offline – visar senast sparade recept."; }
    else loadNote = navigator.onLine === false ? "Du är offline och inga recept är sparade på enheten än." : "Kunde inte hämta recepten. Kontrollera att du har behörighet.";
    render(); return;
  }
  loadNote = "";
  recipes = splitSettings((rows || []).map(r => ({ ...r.data, id: r.id })));
  writeCache();
  if (view.name !== "edit") render();
}
let subscribed = false;
function subscribe(){
  if (subscribed) return; subscribed = true;
  sb.channel("recept")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, p => {
      if (p.eventType === "DELETE") recipes = recipes.filter(r => r.id !== p.old.id);
      else if (p.new.id === SETTINGS_ID) { customTagGroups = (p.new.data || {}).groups || null; }
      else {
        const r = { ...p.new.data, id: p.new.id };
        const i = recipes.findIndex(x => x.id === r.id);
        if (i >= 0) recipes[i] = r; else recipes.push(r);
      }
      writeCache();
      if (view.name !== "edit") render();
    })
    .subscribe();
  // Telefoner tappar anslutningen i bakgrunden: hämta om när appen visas igen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && view.name !== "edit") loadAll(); });
}

// ---------- vem: lagt till, lagat, favoriter ----------
const OWNER = "nicklas.sivander@gmail.com";   // äldre recept utan uppgift räknas som hans
const KNOWN_NAMES = { "nicklas.sivander@gmail.com": "Nicklas", "annsofiesivander@gmail.com": "Ann-Sofie" };
let userNames = {};
function nameOf(email){
  const e = (email || "").toLowerCase();
  if (!e) return "";
  if (userNames[e]) return userNames[e];
  if (KNOWN_NAMES[e]) return KNOWN_NAMES[e];
  const p = e.split("@")[0].split(/[._]/)[0].replace(/\d+/g, "");
  return p ? p.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("-") : e;
}
const addedByOf = r => (r.addedBy || OWNER).toLowerCase();
const favsOf = r => Array.isArray(r.favBy) ? r.favBy.map(x => x.toLowerCase()) : (r.favorite ? [OWNER] : []);
const isFav = r => favsOf(r).includes(me);
// Ägaren (den som lade till receptet) och superanvändare får ändra och radera; andra gör en egen variant
const canEdit = r => !!r && can("contributor") && (addedByOf(r) === me || role === "admin");
const genitive = n => /[sxz]$/i.test(n) ? n : n + "s";
const variantsOf = r => recipes.filter(x => x.variantOf === r.id);
const cookLogOf = r => Array.isArray(r.cookLog) ? r.cookLog : [];
// Tillagningar från innan vi sparade vem som lagade räknas som receptägarens
function cooksOf(r){
  const log = cookLogOf(r);
  const extra = Math.max(0, (r.timesCooked || 0) - log.length);
  return log.concat(Array.from({ length: extra }, () => ({ by: addedByOf(r), date: null })));
}
function cooksSummary(r){
  const c = {}; cooksOf(r).forEach(x => { const n = nameOf(x.by); c[n] = (c[n] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n, k]) => k > 1 ? `${n} (${k})` : n).join(", ");
}

async function saveRecipe(r){
  const { id, ...body } = r;
  body.updatedAt = new Date().toISOString();
  if (!body.createdAt) body.createdAt = body.updatedAt;
  if (!id && !body.addedBy && me) body.addedBy = me;
  const data = JSON.parse(JSON.stringify(body));
  const rid = id || newId();
  const { error } = await sb.from("recipes").upsert({ id: rid, data, updated_at: body.updatedAt });
  if (error) { toast(can("contributor") ? "Kunde inte spara – försök igen" : "Du har bara läsbehörighet"); return false; }
  const i = recipes.findIndex(x => x.id === rid);
  if (i >= 0) recipes[i] = { ...data, id: rid }; else recipes.push({ ...data, id: rid });
  return rid;
}
const queues = {};
async function patch(id, data){
  const i = recipes.findIndex(x => x.id === id);
  if (i >= 0) { recipes[i] = { ...recipes[i], ...data }; if (view.name !== "edit") render(); }
  const run = async () => { const { error } = await sb.rpc("patch_recipe", { p_id: id, p_patch: data }); if (error) throw error; };
  const p = (queues[id] || Promise.resolve()).then(run, run);
  queues[id] = p.catch(() => {});
  try { await p; return true; } catch { toast("Kunde inte spara"); loadAll(); return false; }
}
async function deleteRecipe(id){
  const { error } = await sb.from("recipes").delete().eq("id", id);
  if (error) { toast("Kunde inte radera"); return false; }
  recipes = recipes.filter(r => r.id !== id);
  return true;
}

// Bilder sparas i Supabase Storage (bucket recipe-photos).
async function storePhoto(dataUrl){
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = newId() + ".jpg";
    const { error } = await sb.storage.from("recipe-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    return sb.storage.from("recipe-photos").getPublicUrl(path).data.publicUrl;
  } catch {
    toast("Kunde inte ladda upp bilden");
    return null;
  }
}

// ---------- AI (via /api/ai, betalas av Nicklas API-nyckel) ----------
async function ai(messages, opts = {}){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw { code: "auth" };
  let r;
  try {
    r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ messages: typeof messages === "string" ? [{ role: "user", content: messages }] : messages, images: opts.images || [], mode: opts.mode || "text" }) });
  } catch { throw { code: "network" }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw { code: r.status === 401 || r.status === 403 ? "auth" : r.status === 429 ? "rate" : "upstream", message: j.error };
  return j.text;
}
function parseJson(text){
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) { try { return JSON.parse(m[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw { code: "invalid_json" };
}
function aiErr(e){
  const c = e && e.code;
  if (c === "auth") return (e.message && /behörighet/i.test(e.message)) ? e.message : "Du behöver logga in igen.";
  if (c === "rate") return "För många frågor på kort tid. Vänta en stund och försök igen.";
  if (c === "invalid_json") return "Svaret gick inte att läsa. Försök igen.";
  if (c === "network") return "Ingen anslutning. Kontrollera nätet och försök igen.";
  return (e && e.message) || "Något gick fel. Försök igen.";
}
async function blobToB64(blob){
  // Skala ner stora bilder innan de skickas till Claude
  const url = await compress(blob, 1400, 1000000);
  const [head, data] = url.split(",");
  return { media_type: "image/jpeg", data };
}

// ---------- render ----------
// Webbläsarens historik följer appens vyer, så bakåt-knappen och svepet
// går tillbaka i appen i stället för att lämna sidan.
let navFromPop = false, inAppSteps = 0;
const viewKey = v => v.name + ":" + (v.id || "");
function viewHash(v){
  if (v.name === "detail") return "#r=" + v.id;
  if (v.name === "edit") return v.id ? "#e=" + v.id : "#ny";
  if (v.name === "help") return "#hjalp";
  return " ";
}
function syncHistory(){
  if (navFromPop) { navFromPop = false; return; }
  const cur = history.state && history.state.v;
  const v = { name: view.name, id: view.id || null };
  if (!cur) { history.replaceState({ v }, "", viewHash(v).trim() || location.pathname); return; }
  if (viewKey(cur) === viewKey(v)) return;
  // Efter att ha sparat ett recept: ersätt redigeringsläget i historiken
  if (cur.name === "edit" && v.name === "detail") { history.replaceState({ v }, "", viewHash(v)); return; }
  history.pushState({ v }, "", viewHash(v).trim() || location.pathname);
  inAppSteps++;
}
window.addEventListener("popstate", e => {
  const v = (e.state && e.state.v) || { name: "list" };
  closeSheet && closeSheet();
  if (v.name === "edit" && !draft) { view = v.id ? { name: "detail", id: v.id } : { name: "list" }; }
  else view = v.id ? { name: v.name, id: v.id } : { name: v.name };
  if (view.name !== "edit") draft = null;
  menuOpen = false;
  inAppSteps = Math.max(0, inAppSteps - 1);
  navFromPop = true;
  render(); window.scrollTo(0, 0);
});
function goBack(){
  if (inAppSteps > 0) history.back();
  else { view = { name: "list" }; draft = null; render(); window.scrollTo(0, 0); }
}
function render(){
  setTimeout(renderCookBar, 0);
  $app.classList.toggle("wide", view.name === "list");
  syncHistory();
  syncWakeLock();
  if (view.name === "detail") return renderDetail();
  if (view.name === "edit") return renderEdit();
  if (view.name === "help") return renderHelp();
  renderList();
}

function filtered(){
  const q = filter.q.trim().toLowerCase();
  let list = recipes.filter(r => {
    if (filter.fav && !isFav(r)) return false;
    if (filter.mine && addedByOf(r) !== me) return false;
    if (filter.cookedMe && !cooksOf(r).some(x => (x.by || "").toLowerCase() === me)) return false;
    if (filter.tags.length && !filter.tags.every(t => (r.tags || []).includes(t))) return false;
    if (!q) return true;
    const hay = [r.title, (r.tags || []).join(" "), (r.ingredients || []).join(" "), r.myChanges, r.notes].join(" ").toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
  });
  const by = {
    new: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    cooked: (a, b) => (b.lastCooked || "").localeCompare(a.lastCooked || ""),
    most: (a, b) => (b.timesCooked || 0) - (a.timesCooked || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    name: (a, b) => (a.title || "").localeCompare(b.title || "", "sv"),
  }[filter.sort];
  return list.sort(by);
}

function renderList(){
  const list = filtered();

  let body;
  if (!storageOk) {
    body = `<div class="empty"><h2>Ingen behörighet än</h2><p>Ditt konto (${esc(me || "")}) har inte tillgång till receptboken än.</p><button class="btn accent" data-a="reqaccess" style="margin-top:14px">Begär tillgång</button></div>`;
  } else if (!loaded) {
    body = `<div class="empty"><p>Hämtar dina recept …</p></div>`;
  } else if (!recipes.length) {
    body = `<div class="empty">
      <h2>Din receptbok är tom</h2>
      <p>${can("contributor") ? "Klistra in ett recept du hittat på nätet eller Instagram, eller skriv ditt eget." : "Här kommer recepten att synas."}</p>
      <div class="row" style="justify-content:center;${can("contributor") ? "" : "display:none"}">
        ${sample && sampleImages ? `<button class="btn accent" data-a="pickimport">Foto eller skärmdump</button>` : ""}
        ${sample ? `<button class="btn ${sampleImages ? "ghost" : "accent"}" data-a="import">Klistra in text</button>` : ""}
        <button class="btn ${sample ? "ghost" : "accent"}" data-a="new">Skriv eget</button>
      </div></div>`;
  } else if (!list.length) {
    body = `<div class="empty"><p>Inga recept matchar.</p><button class="btn ghost small" data-a="clear">Rensa filter</button></div>`;
  } else {
    body = layout === "list" ? listRows(list) : `<div class="grid">${list.map(r => `
      <div class="card" data-a="open" data-id="${esc(r.id)}">
        ${isNewForMe(r) ? `<span class="newdot">Nytt</span>` : ""}
        <div class="thumb">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : '<svg class="plate" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width=".6"/><path d="M6 14v14M3 14v8a3 3 0 006 0v-8M6 28v24M58 14c-4 2-4 14 0 16v22" fill="none" stroke="currentColor" stroke-width="1"/></svg>'}${isFav(r) ? `<span class="fav" aria-label="Favorit">♥</span>` : ""}</div>
        <div class="body">
          <h3>${esc(r.title || "Namnlöst recept")}</h3>
          <div class="meta">${sourceBadge(r)}${r.variantOf ? `<span class="badge mod">${esc(variantBadge(r))}</span>` : isModified(r) ? `<span class="badge mod">Min version</span>` : ""}</div>
          <div class="meta" style="margin-top:6px">
            ${r.rating ? `<span>${"★".repeat(r.rating)}</span>` : ""}
            ${r.time ? `<span>${esc(r.time)}</span>` : ""}
            ${r.timesCooked ? `<span>Lagad ${r.timesCooked}×</span>` : ""}
          </div>
        </div>
      </div>`).join("")}</div>`;
  }

  $app.innerHTML = `
    <header class="top"><a class="brand" href="#" data-a="home" aria-label="Till alla recept"><img src="logo.svg" alt="" class="logo"><h1>Sivander's Recept</h1></a>
      <span class="row"><span class="meta">${recipes.length ? recipes.length + " recept" : ""}</span><button class="iconbtn" data-a="help" aria-label="Hjälp och instruktioner">Hjälp</button><button class="iconbtn" data-a="settings" aria-label="Konto och inställningar">Konto${pendingReqs ? `<span class="dotcount">${pendingReqs}</span>` : ""}</button></span></header>
    ${loadNote ? `<div class="notice">${esc(loadNote)}</div>` : ""}
    ${recipes.length ? `
    <div class="search">
      <input id="q" type="search" placeholder="Sök rätt, ingrediens, tagg …" value="${esc(filter.q)}">
      <select id="sort" aria-label="Sortera">
        <option value="new">Senast sparad</option>
        <option value="cooked">Senast lagad</option>
        <option value="most">Mest lagad</option>
        <option value="rating">Betyg</option>
        <option value="name">A–Ö</option>
      </select>
    </div>
    <div class="filterbar">
      ${filterBtn("fbtn-mob")}
      <div class="seg layout-seg" role="group" aria-label="Visa som">
        <button class="${layout === "grid" ? "on" : ""}" data-a="layout" data-l="grid" aria-pressed="${layout === "grid"}">Bilder</button>
        <button class="${layout === "list" ? "on" : ""}" data-a="layout" data-l="list" aria-pressed="${layout === "list"}">Lista</button>
      </div>
    </div>
    ${activityHtml()}
    <div class="filters">
      <div class="chips mine-chips">
        <button class="chip ${!filter.fav && !filter.mine && !filter.cookedMe && !filter.tags.length ? "on" : ""}" data-a="allrecipes">Alla</button>
        <button class="chip ${filter.fav ? "on" : ""}" data-a="fav">Mina favoriter</button>
        <button class="chip ${filter.mine ? "on" : ""}" data-a="mine">Tillagda av mig</button>
        <button class="chip ${filter.cookedMe ? "on" : ""}" data-a="cookedme">Lagade av mig</button>
        ${filterBtn("fbtn-desk")}
      </div>
    </div>
    ${filterOpen ? filterPanelHtml(list) : ""}
    ${filter.tags.length ? `<div class="activetags">${filter.tags.map(t => `<button data-a="tag" data-t="${esc(t)}">${esc(t)} <b aria-hidden="true">×</b></button>`).join("")}<button class="linkbtn" data-a="tagclear">Rensa</button></div>` : ""}` : ""}
    ${body}
    ${storageOk && loaded && can("contributor") ? `<button class="fab" data-a="menu" aria-label="Lägg till">${menuOpen ? "×" : "+"}</button>` : ""}
    ${menuOpen ? `<div class="menu">
      ${sample && sampleImages && HAS_CAMERA ? `<button data-a="camimport">Ta foto<small>Fota en kokbokssida eller lapp – flera bilder går bra</small></button>` : ""}
      ${sample && sampleImages ? `<button data-a="pickimport">${HAS_CAMERA ? "Välj bilder" : "Foto eller skärmdump"}<small>${HAS_CAMERA ? "Skärmdumpar eller foton du redan har" : "Fota en kokbok eller välj skärmdumpar"}</small></button>` : ""}
      ${sample ? `<button data-a="import">Länk eller text<small>Från en receptsida, Instagram-bildtext eller liknande</small></button>` : ""}
      <button data-a="new">Skriv eget recept<small>Fyll i själv från början</small></button>
    </div>` : ""}
  `;
  const q = document.getElementById("q");
  if (q) {
    q.addEventListener("input", e => { filter.q = e.target.value; const pos = e.target.selectionStart; renderList(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos); });
    document.getElementById("sort").value = filter.sort;
    document.getElementById("sort").addEventListener("change", e => { filter.sort = e.target.value; renderList(); });
  }
}

function renderDetail(){
  const r = recipes.find(x => x.id === view.id);
  if (!r && !loaded) { $app.innerHTML = `<p class="meta" style="text-align:center;padding:80px 0">Hämtar receptet …</p>`; return; }
  if (!r) { view = { name: "list" }; return renderList(); }
  const hasOrig = !!r.original && isModified(r) && (r.original.ingredients || r.original.steps);
  const mode = hasOrig ? detailState.mode : "mine";
  const src = mode === "orig" ? r.original : r;
  const baseServ = (mode === "orig" ? r.original.servings : r.servings) || null;
  const serv = detailState.servings ?? baseServ;
  const f = baseServ && serv ? serv / baseServ : 1;
  const ings = src.ingredients || [];
  const steps = src.steps || [];
  const cs = cookSession && cookSession.recipeId === r.id ? cookSession : null;
  if (cs) { detailState.done = cs.done || {}; if (cs.servings && detailState.servings == null) detailState.servings = cs.servings; }
  const nextIdx = cs ? steps.findIndex((x, i) => !x.startsWith("#") && !detailState.done["s" + i]) : -1;

  $app.innerHTML = `
    <div class="hero ${r.photo ? "" : "noimg"}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="">` : ""}
      <button class="fback" data-a="home" aria-label="Tillbaka till alla recept"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <div class="hero-cap">
        <div class="row">${sourceBadge(r)}${isModified(r) ? `<span class="badge mod">Min version</span>` : ""}
          ${(r.tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join("")}</div>
        <h1 class="dtitle">${esc(r.title || "Namnlöst recept")}</h1>
      </div>
    </div>
    <div class="row ratebar" style="justify-content:center;gap:18px">
      <button class="tolist" data-a="home" aria-label="Tillbaka till alla recept"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span>Alla recept</span></button>
      <div class="stars" ${can("contributor") ? "" : 'style="pointer-events:none"'}>${[1,2,3,4,5].map(n => `<button class="${(r.rating || 0) >= n ? "on" : ""}" data-a="rate" data-n="${n}" aria-label="${n} stjärnor">★</button>`).join("")}</div>
      <button class="iconbtn" data-a="togglefav" aria-label="Favorit" style="font-size:20px;color:var(--accent)" ${can("contributor") ? "" : "disabled"}>${isFav(r) ? "♥" : "♡"}</button>
      ${"wakeLock" in navigator ? `<button class="iconbtn wakeicon" id="wakebtn" data-a="wake" aria-pressed="false" aria-label="Håll skärmen tänd" title="Håll skärmen tänd">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <rect class="ph" x="10.5" y="5" width="11" height="22" rx="2.4"/><path d="M14.5 23.6h3"/>
          <g class="rays"><path d="M5.5 10.5l-2.4-1.4M5 16H2.3M5.5 21.5l-2.4 1.4M26.5 10.5l2.4-1.4M27 16h2.7M26.5 21.5l2.4 1.4"/></g>
          <path class="zz" d="M24.2 6.2h3.4l-3.4 3.6h3.4"/>
        </svg></button>` : ""}
    </div>
    <div class="meta" style="margin-top:6px">
      ${r.time ? `<span>${esc(r.time)}</span>` : ""}
      ${r.timesCooked ? `<span>Lagad ${r.timesCooked} gånger, senast ${fmtDate(r.lastCooked)}${(() => { const l = cookLogOf(r); const last = l.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0]; return last && last.date === r.lastCooked ? " av " + esc(nameOf(last.by)) : ""; })()}</span>` : `<span>Inte lagad än</span>`}
      ${cooksOf(r).length ? `<span>Lagad av ${esc(cooksSummary(r))}</span>` : ""}
      <span>Tillagd av ${esc(nameOf(addedByOf(r)))}</span>
      ${r.sourceUrl ? `<span><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Öppna källan</a></span>` : ""}
    </div>
    ${variantSwitcher(r)}
    ${cs ? `<div class="cooking-head"><span class="pan" aria-hidden="true">${PAN_SVG}</span><span class="ct"><b>Du lagar det här</b><small>sedan ${new Date(cs.startedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}${detailState.servings ? ` · ${detailState.servings} portioner` : ""}</small></span><span class="cr"><button class="timeradd" data-a="timernew" aria-label="Sätt timer">⏱ Timer</button><button class="linkbtn" data-a="cookdone">Klar!</button><button class="linkbtn muted" data-a="cookstop">Avbryt</button></span></div>`
      : `<div class="startcook"><button class="cookbtn" data-a="cookstart">${PAN_SVG}<span>Börja laga</span></button></div>`}

    ${(!ings.length || !steps.length || (r.tags || []).includes("att komplettera")) && canEdit(r) ? `<div class="panel changes"><h2>Receptet är inte komplett</h2>
      <p style="margin:0 0 12px">Ta skärmdumpar av receptet i videon eller på sidan och lägg till dem här, så fyller Claude i det som saknas.</p>
      <button class="btn accent" data-a="pickcomplete">Komplettera med skärmdumpar</button></div>` : ""}

    <div class="cook" id="cook" data-tab="${detailState.tab || "ing"}">
    <div class="ctabs" role="tablist">
      <button role="tab" class="${(detailState.tab || "ing") === "ing" ? "on" : ""}" data-a="ctab" data-t="ing">Ingredienser<small>${ings.filter(l => !l.startsWith("#")).length}</small></button>
      <button role="tab" class="${detailState.tab === "steps" ? "on" : ""}" data-a="ctab" data-t="steps">Gör så här<small>${steps.filter(x => !x.startsWith("#")).length}</small></button>
    </div>
    <div class="panel cpane cp-ing">
      <h2><span>Ingredienser</span>
        <span class="row">
          ${hasOrig ? `<span class="seg"><button class="${mode === "mine" ? "on" : ""}" data-a="mode" data-m="mine">${r.variantOf ? "Variant" : "Min"}</button><button class="${mode === "orig" ? "on" : ""}" data-a="mode" data-m="orig">Original</button></span>` : ""}
        </span></h2>
      ${baseServ ? `<div class="stepper" style="margin-bottom:8px"><button data-a="serv" data-d="-1">−</button><span>${serv} portioner</span><button data-a="serv" data-d="1">+</button></div>` : ""}
      ${ings.length ? `<ul class="ings">${ings.map((l, i) => l.startsWith("#")
          ? `<li class="group">${esc(l.replace(/^#+\s*/, ""))}</li>`
          : `<li class="${detailState.done["i" + i] ? "done" : ""}" data-a="tick" data-k="i${i}"><span class="box"></span><span>${esc(scaleLine(l, f))}</span></li>`).join("")}</ul>`
        : `<p class="meta">Inga ingredienser ifyllda.</p>`}
    </div>

    <div class="panel cpane cp-steps">
      <h2>Gör så här</h2>
      ${steps.length ? `<ol class="steps">${(() => { let n = 0; return steps.map((s, i) => s.startsWith("#")
          ? (n = 0, `<li class="group">${esc(s.replace(/^#+\s*/, ""))}</li>`)
          : `<li class="${detailState.done["s" + i] ? "done" : ""}${cs && i === nextIdx ? " nextstep" : ""}" data-n="${++n}" data-a="tick" data-k="s${i}">${esc(s)}${cs ? timerButtons(s, i, n) : ""}</li>`).join(""); })()}</ol>`
        : `<p class="meta">Inga steg ifyllda.</p>`}
    </div>
    <button class="cnext" data-a="ctab" data-t="${(detailState.tab || "ing") === "ing" ? "steps" : "ing"}">${(detailState.tab || "ing") === "ing" ? "Till Gör så här →" : "← Till ingredienserna"}</button>
    </div>

    ${r.variantOf ? variantChangesHtml(r)
      : r.myChanges ? `<div class="panel mychanges"><h2>Mina ändringar</h2><div class="prewrap">${esc(r.myChanges)}</div></div>` : ""}
    ${(() => { const base = r.variantOf ? recipes.find(x => x.id === r.variantOf) : null;
      return base && canEdit(base) ? `<div class="panel mychanges"><h2>Uppdatera grundreceptet</h2>
        <p style="margin:0 0 12px">Ersätt ingredienser och steg i <b>${esc(base.title || "grundreceptet")}</b> med den här varianten.</p>
        <button class="btn accent small" data-a="mergevariant">Uppdatera grundreceptet</button></div>` : ""; })()}

    ${detailState.notesEdit ? `<div class="panel notes-edit"><h2>Anteckningar</h2>
        <textarea id="notes-input" rows="6" placeholder="Tips, vin till, vad gästerna tyckte …">${esc(detailState.notesDraft ?? (r.notes || ""))}</textarea>
        <div class="row" style="margin-top:12px"><button class="btn accent" data-a="notessave">Spara</button><button class="btn ghost" data-a="notescancel">Avbryt</button></div></div>`
      : r.notes ? `<div class="panel"><h2><span>Anteckningar</span>${canEdit(r) ? `<button class="linkbtn" data-a="notesedit">Redigera</button>` : ""}</h2><div class="prewrap">${esc(r.notes)}</div></div>`
      : canEdit(r) ? `<div class="panel notes-empty"><button class="linkbtn" data-a="notesedit">+ Lägg till anteckning</button></div>` : ""}

    ${historyHtml(r)}

    ${canEdit(r) ? `<div class="panel">
      <h2>Ändra receptet</h2>
      <p class="meta" style="justify-content:flex-start;margin:-6px 0 12px">Skriv vad du vill ändra, lägga till eller ta bort. Du granskar ändringen innan den sparas.</p>
      <form class="ai-ask" id="edit-form"><input id="edit-input" placeholder="Skriv här, t.ex. byt grädde mot crème fraiche" autocomplete="off"><button class="btn small" type="submit" id="edit-btn">Ändra</button></form>
      <div class="err" id="edit-err"></div>
    </div>` : ""}

    ${can("contributor") ? `<div class="panel ai">
      <h2>Fråga sommelieren och kocken</h2>
      <div class="chips">
        <button class="chip" data-a="ai" data-q="wine">Vilket vin passar?</button>
        <button class="chip" data-a="ai" data-q="subs">Alternativ till ingredienser</button>
        <button class="chip" data-a="ai" data-q="similar">Liknande recept</button>
        <button class="chip" data-a="ai" data-q="vary">Andra varianter</button>
        <button class="chip" data-a="ai" data-q="sides">Vad serverar jag till?</button>
      </div>
      <form class="ai-ask" id="ai-form"><input id="ai-input" placeholder="Skriv din fråga här …" autocomplete="off"><button class="btn small" type="submit">Fråga</button></form>
      <div id="ai-out">${aiOutHtml(r.id)}</div>
    </div>` : ""}

    <div class="actions">
      ${can("contributor") ? `<button class="btn accent" data-a="cooked">Lagad idag</button>
      <button class="btn ghost" data-a="histadd">Ny tillagning</button>` : ""}
      ${canEdit(r) ? `<button class="btn ghost" data-a="pickdish">${r.photo ? "Byt bild" : "Lägg till bild"}</button>
      <button class="btn ghost" data-a="edit">Redigera</button>` : ""}
      ${can("contributor") ? `<button class="btn ghost" data-a="variant">${addedByOf(r) === me ? "Gör en variant" : "Gör min egen variant"}</button>` : ""}
      <button class="btn ghost" data-a="copy">Kopiera</button>
      ${canEdit(r) ? `<button class="btn danger" data-a="del">Radera</button>` : ""}
    </div>
  `;
}

function renderEdit(){
  const d = draft;
  $app.innerHTML = `
    <button class="back" data-a="cancel">← Avbryt</button>
    <h1 class="dtitle">${d.id ? "Redigera recept" : "Nytt recept"}</h1>
    ${!d.id && !d.variantOf && d.sourceUrl ? `<div class="notice">Receptet är importerat. Granska och rätta om något blev fel – vill du göra om det på ditt sätt gör du en variant efteråt.</div>` : ""}
    <form class="form" id="f" autocomplete="off">
      <label>Namn</label>
      <input type="text" name="title" value="${esc(d.title)}" placeholder="t.ex. Krämig svamppasta" required>
      ${d.variantOf ? `<label>Variantens namn</label>
      <input type="text" name="variantName" maxlength="30" value="${esc(d.variantNameAuto ? "" : d.variantName || "")}" placeholder="${d.variantName ? esc(d.variantName) + " (föreslaget av AI)" : "Lämna tomt så döper AI varianten efter skillnaderna"}">` : ""}

      <label>Länk till källan</label>
      <input type="url" name="sourceUrl" value="${esc(d.sourceUrl)}" placeholder="https://www.instagram.com/p/… eller receptsidan">

      <div class="two">
        <div><label>Portioner</label><input type="number" name="servings" min="1" value="${esc(d.servings ?? "")}"></div>
        <div><label>Tid</label><input type="text" name="time" value="${esc(d.time)}" placeholder="45 min"></div>
      </div>

      <label>Nyckelord</label>
      <input type="hidden" name="tags" id="tagsField" value="${esc((d.tags || []).join(", "))}">
      <div class="tagpick" id="tagPick">${tagPickHtml(d.tags || [])}</div>
      <div class="row" style="gap:8px;margin-top:8px"><input type="text" id="newTag" placeholder="Nytt nyckelord …" style="flex:1"><button type="button" class="btn ghost small" id="newTagBtn">Lägg till</button></div>
      <div class="hint">Tryck för att välja. Ett nytt nyckelord hamnar under Övrigt${can("admin") ? " – du kan flytta det till en grupp under Konto → Nyckelord" : ""}.</div>

      <label>Ingredienser</label>
      <textarea name="ingredients" rows="8" placeholder="2 dl grädde&#10;250 g champinjoner&#10;# Till servering&#10;Parmesan">${esc((d.ingredients || []).join("\n"))}</textarea>
      <div class="hint">En per rad, mängden först. Rader som börjar med # blir rubriker.</div>

      <label>Gör så här</label>
      <textarea name="steps" rows="8" placeholder="# Dagen innan&#10;Marinera köttet över natten.&#10;# Vid servering&#10;Grilla och skiva.">${esc((d.steps || []).join("\n"))}</textarea>
      <div class="hint">Ett steg per rad. Rader som börjar med # blir rubriker, t.ex. "# Dagen innan" eller "# Vid servering".</div>

      ${d.variantOf ? `<label>Ändringar i varianten</label>
      <textarea name="myChanges" rows="3" placeholder="t.ex. Bytte grädde mot crème fraiche, dubbel vitlök, 5 min kortare i ugnen">${esc(d.myChanges)}</textarea>
      <div class="hint">Vad varianten gör annorlunda än originalet.</div>` : `<input type="hidden" name="myChanges" value="${esc(d.myChanges || "")}">`}

      <label>Anteckningar</label>
      <textarea name="notes" rows="3" placeholder="Tips, vin till, vad gästerna tyckte …">${esc(d.notes)}</textarea>

      <label>Bild på rätten</label>
      <div class="photo-pick">
        ${d.photo ? `<img src="${esc(d.photo)}" alt="">` : ""}
        <button type="button" class="btn ghost small" data-a="editphoto">${d.photo ? "Byt bild" : "Lägg till bild"}</button>
        ${d.photo ? `<button type="button" class="btn ghost small" data-a="rmphoto">Ta bort</button>` : ""}
      </div>
    </form>
    <div class="sticky-bar"><div class="in">
      <button class="btn ghost" data-a="cancel">Avbryt</button>
      <button class="btn accent" data-a="save" id="savebtn">Spara recept</button>
    </div></div>
  `;
}

function readForm(){
  const f = document.getElementById("f"); if (!f) return;
  const v = n => f.elements[n].value;
  draft.title = v("title").trim();
  draft.sourceUrl = v("sourceUrl").trim();
  draft.servings = v("servings") ? Math.max(1, parseInt(v("servings"), 10)) : null;
  draft.time = v("time").trim();
  draft.tags = v("tags").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  draft.ingredients = linesOf(v("ingredients"));
  draft.steps = linesOf(v("steps")).map(s => s.replace(/^\d+[.)]\s*/, ""));
  draft.myChanges = v("myChanges").trim();
  draft.notes = v("notes").trim();
  if (f.elements.variantName) {
    const vn = v("variantName").trim();
    if (vn) { draft.variantName = vn; draft.variantNameAuto = false; }
    else if (!draft.variantNameAuto) { draft.variantName = ""; }
  }
}

function compress(file, max = 900, maxLen = 170000){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let q = .78, url = c.toDataURL("image/jpeg", q);
      while (url.length > maxLen && q > .35) { q -= .1; url = c.toDataURL("image/jpeg", q); }
      URL.revokeObjectURL(img.src);
      res(url);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function recipeText(r){
  const lines = [r.title, ""];
  if (r.servings) lines.push(r.servings + " portioner" + (r.time ? " · " + r.time : ""));
  lines.push("", "INGREDIENSER", ...(r.ingredients || []).map(l => l.startsWith("#") ? "\n" + l.replace(/^#+\s*/, "") : "• " + l));
  { let n = 0; lines.push("", "GÖR SÅ HÄR", ...(r.steps || []).map(s => s.startsWith("#") ? (n = 0, "\n" + s.replace(/^#+\s*/, "")) : (++n) + ". " + s)); }
  if (r.myChanges) lines.push("", "MINA ÄNDRINGAR", r.myChanges);
  if (r.sourceUrl) lines.push("", "Källa: " + r.sourceUrl);
  return lines.join("\n");
}

// ---------- AI: fråga Claude om ett recept ----------
const aiState = {};   // recipeId -> [{q, a, busy, err}]
const AI_PRESETS = {
  wine: { label: "Vilket vin passar?", prompt: "Föreslå vin till rätten. Ge 2–3 förslag: stil, druva och region, och en mening om varför det passar. Ta med ett alkoholfritt alternativ på slutet." },
  subs: { label: "Alternativ till ingredienser", prompt: "Ge alternativ till de ingredienser som är svåra att få tag på, dyra eller ofta byts ut. Skriv som en lista: ingrediens → ersättning, och kort hur det påverkar resultatet." },
  similar: { label: "Liknande recept", prompt: "Föreslå liknande recept. Börja med de som redan finns i min receptbok (lista nedan) och skriv deras titlar exakt som de står. Ge sedan 2 nya idéer jag inte har, med en mening om varje." },
  vary: { label: "Andra varianter", prompt: "Föreslå 3 varianter av rätten, till exempel vegetarisk, snabbare vardagsversion och en festligare version. Ange de konkreta ändringarna för varje." },
  sides: { label: "Vad serverar jag till?", prompt: "Föreslå 3 tillbehör eller komplement som passar till rätten, med en mening om varje." },
};
function aiMd(t){
  const lines = esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^([-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[2]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (!l) continue;
    html += `<p>${l.replace(/^#+\s*/, "")}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}
function aiOutHtml(id){
  const items = aiState[id] || [];
  return items.map((it, i) => {
    const links = !it.busy && it.a ? recipes.filter(x => x.id !== id && x.title && it.a.toLowerCase().includes(x.title.toLowerCase())) : [];
    return `<div class="ai-q">${esc(it.q)}</div>
      <div class="ai-a">${it.err ? `<span class="err">${esc(it.err)}</span>` : it.a ? aiMd(it.a) : `<span class="meta">Claude tänker …</span>`}</div>
      ${links.length ? `<div class="chips" style="padding-top:4px">${links.map(x => `<button class="chip" data-a="open" data-id="${esc(x.id)}">${esc(x.title)}</button>`).join("")}</div>` : ""}
      ${!it.busy && it.a && canEdit(recipes.find(x => x.id === id)) ? `<div class="ai-tools"><button class="btn ghost small" data-a="aisave" data-i="${i}">Spara i anteckningar</button></div>` : ""}`;
  }).reverse().join("");
}
function aiRefresh(id){ const el = document.getElementById("ai-out"); if (el && view.id === id) el.innerHTML = aiOutHtml(id); }

async function askAI(r, kind, freeText){
  if (!sample) return;
  const items = aiState[r.id] || (aiState[r.id] = []);
  if (items.some(x => x.busy)) return;
  const q = kind ? AI_PRESETS[kind].label : freeText;
  const item = { q, a: "", busy: true, err: "" };
  items.push(item); aiRefresh(r.id);

  const others = kind === "similar"
    ? "\n\nMIN RECEPTBOK (övriga recept):\n" + recipes.filter(x => x.id !== r.id).map(x => `- ${x.title}${(x.tags || []).length ? " [" + x.tags.join(", ") + "]" : ""}`).join("\n")
    : "";
  const context = `Du är en erfaren kock och sommelier som hjälper en svensk hemmakock. Svara på svenska, konkret och utan inledning eller artighetsfraser. Använd korta punktlistor där det passar och håll dig under 180 ord. Hitta inte på fakta om specifika produkter.

RECEPTET:
${recipeText(r)}${r.notes ? "\n\nANTECKNINGAR: " + r.notes : ""}${others}`;
  const history = items.slice(0, -1).filter(x => x.a && !x.err).slice(-3);
  // Rebuild a short conversation so follow-up questions have context.
  const convo = [];
  history.forEach((h, i) => { convo.push({ role: "user", content: (i === 0 ? context + "\n\nFRÅGA: " : "") + h.q }); convo.push({ role: "assistant", content: h.a }); });
  const ask = kind ? AI_PRESETS[kind].prompt : freeText;
  convo.push({ role: "user", content: (convo.length ? "" : context + "\n\nFRÅGA: ") + ask });

  try {
    item.a = await ai(convo);
  } catch (e) {
    item.err = aiErr(e);
  }
  item.busy = false; aiRefresh(r.id);
}

document.addEventListener("submit", e => {
  if (e.target.id !== "ai-form") return;
  e.preventDefault();
  const inp = document.getElementById("ai-input");
  const q = inp.value.trim(); if (!q) return;
  const r = recipes.find(x => x.id === view.id); if (!r) return;
  inp.value = "";
  askAI(r, null, q);
});

// ---------- import modal ----------
function openImport(files, targetId){
  const t = targetId ? recipes.find(x => x.id === targetId) : null;
  importState = { text: "", url: t ? (t.sourceUrl || "") : "", shots: [], translate: true, busy: false, error: "", targetId: targetId || null };
  (files || []).slice(0, 6).forEach(f => importState.shots.push({ blob: f, url: URL.createObjectURL(f) }));
  menuOpen = false; render(); renderImport();
  if (importState.shots.length) runImport();
}

// photo picker: mode = import | complete | dish
let pickMode = null;
function openPicker(mode){
  pickMode = mode;
  const p = document.getElementById("pick");
  p.multiple = mode !== "dish";
  p.value = "";
  p.click();
}
document.getElementById("pick").addEventListener("change", async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const cur = view.id ? recipes.find(x => x.id === view.id) : null;
  if (pickMode === "dish" && cur) {
    try { const photo = await storePhoto(await compress(files[0], 1200, 400000)); if (photo) { await patch(cur.id, { photo }); toast("Bilden sparad"); } }
    catch { toast("Kunde inte spara bilden"); }
  } else if (pickMode === "complete" && cur) {
    openImport(files, cur.id);
  } else {
    openImport(files);
  }
});
function closeImport(){ importState = null; document.getElementById("modal-root").innerHTML = ""; }
function renderImport(){
  const s = importState; if (!s) return;
  document.getElementById("modal-root").innerHTML = `
  <div class="modal-bg" data-a="closeimport-bg">
    <div class="modal form" role="dialog" aria-label="Importera recept">
      <h2>${s.targetId ? "Komplettera recept" : "Importera recept"}</h2>
      <p class="sub">Klistra in en länk eller text, fota en kokbok eller lägg till skärmdumpar. Claude plockar ut ingredienser och steg.</p>
      <label>Länk till receptet</label>
      <input type="url" id="imp-url" value="${esc(s.url)}" placeholder="https://…">
      <label>Recepttext</label>
      <textarea id="imp-text" rows="9" placeholder="Klistra in hela receptet – eller Instagram-bildtexten">${esc(s.text)}</textarea>
      ${sampleImages ? `
      <label>Foton och skärmdumpar (upp till 6)</label>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
        <input type="file" id="imp-shots" accept="image/*" multiple style="flex:1;min-width:200px">
        ${HAS_CAMERA ? `<button type="button" class="btn accent small" data-a="impcam" ${s.shots.length >= 6 ? "disabled" : ""}>Ta foto</button>` : ""}
        <button type="button" class="btn ghost small" data-a="imppaste" ${s.shots.length >= 6 ? "disabled" : ""}>Klistra in skärmdump</button>
      </div>
      <div class="hint">Fota en kokbokssida, välj skärmdumpar – eller ta en skärmdump i ett annat fönster och tryck Ctrl+V (Cmd+V på Mac) här. Upprepa så många gånger du vill, rutan väntar. ${s.shots.length ? `<b>${s.shots.length} av 6</b> bilder.` : ""}</div>
      <div class="shots">${s.shots.map((sh, i) => `<div><img src="${sh.url}" alt=""><button type="button" data-a="rmshot" data-i="${i}">×</button></div>`).join("")}</div>` : ""}
      <label class="check" style="color:var(--ink);font-weight:500"><input type="checkbox" id="imp-tr" ${s.translate ? "checked" : ""}> Översätt till svenska och metriska mått</label>
      ${s.error ? `<div class="err" id="imp-err">${esc(s.error)}</div>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:18px">
        <button class="btn ghost" data-a="closeimport">Avbryt</button>
        <button class="btn accent" data-a="runimport" ${s.busy ? "disabled" : ""}>${s.busy ? `<span class="spinner"></span> Läser receptet …` : "Läs in receptet"}</button>
      </div>
    </div>
  </div>`;
  const sync = () => { s.url = document.getElementById("imp-url").value; s.text = document.getElementById("imp-text").value; s.translate = document.getElementById("imp-tr").checked; };
  ["imp-url", "imp-text", "imp-tr"].forEach(id => document.getElementById(id).addEventListener("input", sync));
  { const er = document.getElementById("imp-err"); if (er) er.scrollIntoView({ block: "center", behavior: "smooth" }); }
  document.getElementById("imp-tr").addEventListener("change", sync);
  const shots = document.getElementById("imp-shots");
  if (shots) shots.addEventListener("change", e => {
    sync();
    [...e.target.files].slice(0, 6 - s.shots.length).forEach(f => s.shots.push({ blob: f, url: URL.createObjectURL(f) }));
    renderImport();
  });
}

async function runImport(){
  const s = importState;
  s.url = document.getElementById("imp-url").value.trim();
  s.text = document.getElementById("imp-text").value.trim();
  s.translate = document.getElementById("imp-tr").checked;
  if (!s.text && !s.shots.length && !s.url) { s.error = "Klistra in en länk, recepttexten" + (sampleImages ? " eller en skärmdump." : "."); return renderImport(); }
  s.busy = true; s.error = ""; renderImport();

  // Bara en länk: hämta sidan via servern
  let pageImage = null;
  if (!s.text && !s.shots.length && s.url) {
    if (!/^https?:\/\//i.test(s.url)) s.url = "https://" + s.url;
    if (/instagram\.com|facebook\.com|fb\.watch|tiktok\.com/i.test(s.url)) {
      s.busy = false; s.error = "Instagram och Facebook släpper inte in appen. Kopiera bildtexten och klistra in den, eller ta skärmdumpar av receptet."; return renderImport();
    }
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) }, body: JSON.stringify({ url: s.url, withImage: !s.targetId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.text) throw new Error(j.error || "Sidan gick inte att läsa");
      s.text = j.text; pageImage = j.image || null;
    } catch (e) {
      s.busy = false;
      s.error = (e.message || "Sidan gick inte att läsa") + ". Kopiera texten från sidan och klistra in den i stället.";
      return renderImport();
    }
  }

  const prompt = `Du får ett matrecept som användaren kopierat från en webbsida eller Instagram, i form av text och/eller bilder (skärmdumpar, foton av kokbokssidor eller handskrivna lappar). Flera bilder hör till samma recept – slå ihop dem. Texten kan innehålla skräp som reklam, kommentarer och hashtags – ignorera det.
Svara ENDAST med ett JSON-objekt, utan förklaring:
{"title": string, "servings": number eller null, "time": string (t.ex. "45 min", tom om okänt), "tags": [string], "ingredients": [string], "steps": [string], "notes": string}
Regler:
- ingredients: en ingrediens per element, mängd och enhet först ("2 dl grädde", "1 gul lök"). Om receptet har delar (t.ex. sås, topping), lägg en rubrik som eget element som börjar med "# ". Behåll ALLA tidsangivelser från källan (koktid, stektid, ugnstid, vila, marinering, jäsning) i det steg där de hör hemma och skriv dem med siffror och enhet, t.ex. "15 min", "1 h", "1,5 h", "10–12 min", "30 sek" – aldrig bara "en stund" om källan anger en tid. Står tiden bara i receptets inledning eller i en totaltid, för in den i rätt steg om det framgår vilket.
- steps: ett steg per element, utan numrering, korta och tydliga. Om stegen tydligt hör till olika moment (t.ex. dagen innan, förberedelser, tillagning, vid servering) eller olika delar av rätten, lägg en rubrik som eget element som börjar med "# ".
- tags: 2–4 taggar, ENBART från denna lista (gemener, exakt stavning): ${tagVocab().join(", ")}. Välj det som stämmer – typ av rätt, mattyp, tillfälle och metod. ${TAG_HINTS}
- notes: eventuella tips från källan, kort. Annars tom sträng.
- ${s.translate ? "Skriv allt på svenska. Räkna om amerikanska mått (cups, tbsp, tsp, oz, lb, °F) till svenska metriska mått (dl, msk, tsk, g, °C)." : "Behåll originalspråket och måtten."}
- Hitta inte på något. Saknas receptinnehåll helt, svara {"error": "kort förklaring på svenska"}.
${s.url ? "\nKällänk: " + s.url : ""}
${s.text ? "\nRECEPTTEXT:\n" + s.text.slice(0, 20000) : ""}`;

  try {
    const images = [];
    for (const sh of s.shots) images.push(await blobToB64(sh.blob));
    const out = parseJson(await ai(prompt, { mode: "json", images }));
    if (!out || out.error) throw { message: out && out.error ? out.error : "Hittade inget recept i texten." };
    const parsed = {
      title: String(out.title || "").trim(),
      servings: Number.isFinite(+out.servings) && +out.servings > 0 ? Math.round(+out.servings) : null,
      time: String(out.time || "").trim(),
      tags: (Array.isArray(out.tags) ? out.tags : []).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6),
      ingredients: (Array.isArray(out.ingredients) ? out.ingredients : []).map(x => String(x).trim()).filter(Boolean),
      steps: (Array.isArray(out.steps) ? out.steps : []).map(x => String(x).trim()).filter(Boolean),
      notes: String(out.notes || "").trim(),
    };
    const target = s.targetId ? recipes.find(x => x.id === s.targetId) : null;
    if (target) {
      draft = JSON.parse(JSON.stringify(target));
      if (!draft.title && parsed.title) draft.title = parsed.title;
      if (parsed.ingredients.length) draft.ingredients = parsed.ingredients;
      if (parsed.steps.length) draft.steps = parsed.steps;
      if (parsed.servings) draft.servings = parsed.servings;
      if (parsed.time) draft.time = parsed.time;
      if (parsed.notes) draft.notes = [draft.notes, parsed.notes].filter(Boolean).join("\n\n");
      draft.tags = [...new Set([...(draft.tags || []).filter(t => t !== "att komplettera"), ...parsed.tags])].slice(0, 8);
      if (s.url) draft.sourceUrl = s.url;
      draft._fillIn = true;
      closeImport();
      view = { name: "edit", id: target.id }; render(); window.scrollTo(0, 0);
      return;
    }
    let photo = null;
    if (pageImage) { try { photo = await storePhoto(await compress(await (await fetch(pageImage)).blob(), 1200, 400000)); } catch {} }
    draft = {
      ...parsed, sourceUrl: s.url, myChanges: "", photo,
    };
    closeImport();
    view = { name: "edit" }; render(); window.scrollTo(0, 0);
  } catch (e) {
    s.busy = false;
    s.error = aiErr(e);
    renderImport();
  }
}

// ---------- events ----------
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-a]"); if (!el) { if (menuOpen) { menuOpen = false; render(); } return; }
  const a = el.dataset.a;
  const cur = view.id ? recipes.find(x => x.id === view.id) : null;

  if (cur && ["edit", "del", "pickdish", "pickcomplete", "notesedit", "notessave", "aisave", "histuse", "promote"].includes(a) && !canEdit(cur)) {
    toast("Det här är " + genitive(nameOf(addedByOf(cur))) + " recept – gör din egen variant för att ändra"); return;
  }
  switch (a) {
    case "menu": menuOpen = !menuOpen; render(); break;
    case "settings": openSettings(); break;
    case "import": openImport(); break;
    case "pickimport": menuOpen = false; render(); openPicker("import"); break;
    case "pickcomplete": openPicker("complete"); break;
    case "pickdish": openPhotoSheet(async url => { if (await patch(cur.id, { photo: url })) toast("Bilden sparad"); }); break;
    case "editphoto": readForm(); openPhotoSheet(url => { draft.photo = url; renderEdit(); }); break;
    case "new":
      menuOpen = false; draft = { title: "", sourceUrl: "", servings: 4, time: "", tags: [], ingredients: [], steps: [], myChanges: "", notes: "", photo: null };
      view = { name: "edit" }; render(); window.scrollTo(0, 0); break;
    case "open":
      markOpened(el.dataset.id);
      detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null };
      view = { name: "detail", id: el.dataset.id }; render(); window.scrollTo(0, 0); break;
    case "home": e.preventDefault(); if (view.name === "list") break; goBack(); break;
    case "help": view = { name: "help" }; render(); window.scrollTo(0, 0); break;
    case "allrecipes": filter = { ...filter, tags: [], fav: false, mine: false, cookedMe: false }; render(); break;
    case "ftoggle": filterOpen = !filterOpen; render(); break;
    case "fclose": filterOpen = false; render(); break;
    case "fmore": filterMore = !filterMore; render(); break;
    case "tagclear": filter.tags = []; render(); break;
    case "fav": filter = { ...filter, fav: !filter.fav, mine: false, cookedMe: false }; render(); break;
    case "mine": filter = { ...filter, mine: !filter.mine, fav: false, cookedMe: false }; render(); break;
    case "cookedme": filter = { ...filter, cookedMe: !filter.cookedMe, fav: false, mine: false }; render(); break;
    case "layout": layout = el.dataset.l; try { localStorage.setItem("layout", layout); } catch {} render(); break;
    case "tag": { const t = el.dataset.t; filter.tags = filter.tags.includes(t) ? filter.tags.filter(x => x !== t) : filter.tags.concat(t); if (view.name !== "list") { view = { name: "list" }; } render(); break; }
    case "clear": filter = { ...filter, q: "", tags: [], fav: false, mine: false, cookedMe: false }; render(); break;
    case "mode": detailState.mode = el.dataset.m; detailState.servings = null; detailState.done = {}; render(); break;
    case "serv": {
      const base = (detailState.mode === "orig" ? cur.original.servings : cur.servings) || 1;
      detailState.servings = Math.max(1, (detailState.servings ?? base) + (+el.dataset.d));
      if (cookSession && cookSession.recipeId === cur.id) { cookSession.servings = detailState.servings; saveCook(); }
      render(); break;
    }
    case "notesedit":
      detailState.notesEdit = true; detailState.notesDraft = cur.notes || ""; render();
      { const t = $id("notes-input"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
      break;
    case "notescancel": detailState.notesEdit = false; detailState.notesDraft = null; render(); break;
    case "notessave": {
      const val = ($id("notes-input") ? $id("notes-input").value : detailState.notesDraft || "").trim();
      el.disabled = true;
      if (await patch(cur.id, { notes: val })) { detailState.notesEdit = false; detailState.notesDraft = null; render(); toast("Anteckningarna är sparade"); }
      else el.disabled = false;
      break; }
    case "wake":
      wakeWanted = !wakeLock;
      await syncWakeLock();
      toast(wakeLock ? "Skärmen hålls tänd medan du lagar" : wakeWanted ? (wakeWanted = false, "Telefonen tillät inte att skärmen hålls tänd") : "Skärmen släcks som vanligt igen");
      break;
    case "reqaccess": {
      el.disabled = true;
      const { data, error } = await sb.rpc("recipe_request_access", { p_email: me, p_name: nameOf(me), p_message: "" });
      if (error) { el.disabled = false; toast("Kunde inte skicka: " + error.message); break; }
      el.outerHTML = `<p class="meta" style="margin-top:14px">${data === "har_tillgang" ? "Du har redan tillgång – ladda om sidan." : "Förfrågan är skickad. Ladda om sidan när du fått klartecken."}</p>`;
      break; }
    case "imppaste": await pasteShotsFromClipboard(); break;
    case "camimport": menuOpen = false; render(); openImport([]); takePhoto(b => addImportShots([b])); break;
    case "impcam": takePhoto(b => addImportShots([b])); break;
    case "actmore": activityOpen = "all"; render(); break;
    case "acttab": activityTab = el.dataset.t; if (activityOpen === "all") activityOpen = true; render(); break;
    case "acttoggle":
      activityOpen = !activityOpen;
      if (!activityOpen) activityTab = null;
      if (activityOpen) { activitySeenBefore = seenAt(); setSeen(Date.now()); }
      render(); break;
    case "cookstart": startCooking(cur); break;
    case "cookstop":
      if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = "Säker?"; break; }
      endCooking(); toast("Tillagningen avbruten"); render(); break;
    case "cookdone": { const r0 = cur; endCooking(); render(); openHistory(r0); toast("Snyggt! Sätt betyg och spara tillagningen"); break; }
    case "timer": startTimer(+el.dataset.ms, el.dataset.label, el.dataset.k); break;
    case "timerstop": stopTimer(el.dataset.id); break;
    case "timernew": openTimerSheet(); break;
    case "cookbar": openCookRecipe(); break;
    case "ctab": {
      detailState.tab = el.dataset.t; render();
      const c = document.getElementById("cook");
      if (c) { const top = c.getBoundingClientRect().top; if (top < 0 || el.classList.contains("cnext")) window.scrollTo({ top: window.scrollY + top - 4 }); }
      break; }
    case "tick":
      if (e.target.closest(".timerbtn")) break;
      detailState.done[el.dataset.k] = !detailState.done[el.dataset.k];
      if (cookSession && cookSession.recipeId === cur.id) { cookSession.done = detailState.done; saveCook(); }
      render(); break;
    case "rate": {
      const n = +el.dataset.n; await patch(cur.id, { rating: cur.rating === n ? 0 : n }); break;
    }
    case "togglefav": {
      const f = favsOf(cur); const nf = f.includes(me) ? f.filter(x => x !== me) : f.concat(me);
      await patch(cur.id, { favBy: nf }); toast(nf.includes(me) ? "Sparad bland dina favoriter" : "Borttagen från dina favoriter"); break; }
    case "histadd": openHistory(cur); break;
    case "histedit": openHistory(cur, el.dataset.h); break;
    case "histdel":
      if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = "Säker? Tryck igen"; break; }
      await patch(cur.id, { history: histOf(cur).filter(x => x.id !== el.dataset.h) }); toast("Tillagningen är borttagen"); break;
    case "variant": {
      const v = JSON.parse(JSON.stringify(cur));
      ["id", "createdAt", "updatedAt", "history", "cookLog", "favBy", "favorite", "rating", "timesCooked", "lastCooked", "addedBy", "myChanges"].forEach(k => delete v[k]);
      v.variantOf = cur.variantOf || cur.id;
      delete v.variantName; delete v.variantNameAuto;
      v.original = { servings: cur.servings || null, ingredients: cur.ingredients || [], steps: cur.steps || [] };
      v.myChanges = "";
      draft = v; view = { name: "edit" }; render(); window.scrollTo(0, 0);
      toast("Ändra det du vill och spara din variant"); break;
    }
    case "promote": {
      if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = "Säker? Originalet skrivs över"; break; }
      const note = (cur.myChanges ? cur.myChanges + "\n\n" : "") + `${today()}: Min version blev nytt original.`;
      if (await patch(cur.id, { original: { servings: cur.servings || null, ingredients: cur.ingredients || [], steps: cur.steps || [] }, myChanges: "" , notes: [cur.notes, note.replace(/^\n+/, "")].filter(Boolean).join("\n\n") })) {
        detailState.mode = "mine"; toast("Klart – Min version är nu originalet"); render();
      }
      break;
    }
    case "mergevariant": {
      const base = recipes.find(x => x.id === cur.variantOf);
      if (!base || !canEdit(base)) { toast("Du kan inte ändra grundreceptet"); break; }
      openSheet(`<h2>Uppdatera grundreceptet</h2>
        <p>Ingredienser, steg och portioner i <b>${esc(base.title || "")}</b> ersätts med ${esc(genitive(nameOf(addedByOf(cur))))} variant.</p>
        <p class="hnote">Det noteras med datum under grundreceptets anteckningar. Andra varianter påverkas inte.</p>
        ${canEdit(cur) ? `<label class="check" style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" id="mvDel"> Ta bort varianten efteråt</label>` : ""}
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="mvNo">Avbryt</button><button class="btn accent" id="mvYes">Uppdatera</button></div>`);
      $id("mvNo").onclick = closeSheet;
      $id("mvYes").onclick = async () => {
        $id("mvYes").disabled = true;
        const v = cur;
        const line = `${today()}: Uppdaterad med varianten ${variantLabel(v)} (${nameOf(addedByOf(v))}).` + (v.myChanges ? "\n" + v.myChanges : "");
        const ok = await patch(base.id, {
          ingredients: v.ingredients || [], steps: v.steps || [], servings: v.servings || base.servings || null,
          notes: [base.notes, line].filter(Boolean).join("\n\n"),
        });
        if (!ok) { $id("mvYes").disabled = false; return; }
        const del = $id("mvDel") && $id("mvDel").checked;
        closeSheet();
        if (del) await deleteRecipe(v.id);
        markOpened(base.id);
        detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null };
        view = { name: "detail", id: base.id }; render(); window.scrollTo(0, 0);
        toast("Grundreceptet är uppdaterat" + (del ? " och varianten borttagen" : ""));
      };
      break;
    }
    case "histuse": {
      const e = histOf(cur).find(x => x.id === el.dataset.h); if (!e || !e.snapshot) break;
      draft = JSON.parse(JSON.stringify(cur));
      draft.ingredients = e.snapshot.ingredients || []; draft.steps = e.snapshot.steps || [];
      if (e.snapshot.servings) draft.servings = e.snapshot.servings;
      view = { name: "edit", id: cur.id }; render(); window.scrollTo(0, 0); toast("Granska och spara"); break;
    }
    case "cooked":
      await patch(cur.id, { timesCooked: (cur.timesCooked || 0) + 1, lastCooked: today(), cookLog: cookLogOf(cur).concat({ by: me, date: today(), at: new Date().toISOString() }) });
      toast("Noterat: lagad idag"); break;
    case "copy":
      try { await navigator.clipboard.writeText(recipeText(cur)); toast("Receptet kopierat"); } catch { toast("Kunde inte kopiera"); }
      break;
    case "del":
      if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = "Säker? Tryck igen"; setTimeout(() => { el.classList.remove("armed"); el.textContent = "Radera"; }, 3500); }
      else { if (await deleteRecipe(cur.id)) toast("Receptet raderat"); view = { name: "list" }; render(); }
      break;
    case "edit": draft = JSON.parse(JSON.stringify(cur)); view = { name: "edit", id: cur.id }; render(); window.scrollTo(0, 0); break;
    case "rmphoto": readForm(); draft.photo = null; renderEdit(); break;
    case "cancel":
      draft = null; goBack(); break;
    case "save": {
      readForm();
      if (!draft.title) { toast("Ge receptet ett namn"); document.querySelector('[name=title]').focus(); return; }
      // Ändrat innehåll i ett grundrecept: fråga om det ska bli en variant
      if (draft.id && !draft.variantOf && !draft._fillIn && !el.dataset.force) {
        const stored = recipes.find(x => x.id === draft.id);
        const had = stored && ((stored.ingredients || []).length || (stored.steps || []).length);
        const changed = stored && (!sameList(stored.ingredients || [], draft.ingredients || []) || !sameList(stored.steps || [], draft.steps || []) || (stored.servings || null) !== (draft.servings || null));
        if (had && changed) { askVariantOrOriginal(stored); return; }
      }
      const btn = document.getElementById("savebtn"); btn.disabled = true; btn.textContent = "Sparar …";
      if (!draft.variantOf) { delete draft.original; if (!draft.id) draft.myChanges = ""; }
      delete draft._fillIn;
      const needName = draft.variantOf && (!draft.variantName || draft.variantNameAuto);
      const id = await saveRecipe(draft);
      if (id && draft.variantOf) namingTried.delete(id);
      if (id && needName) nameVariant(id, true);
      if (id) {
        toast("Receptet sparat"); detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null };
        const wasExisting = !!draft.id; draft = null;
        if (wasExisting && inAppSteps > 0) { goBack(); }
        else { view = { name: "detail", id }; render(); window.scrollTo(0, 0); }
      }
      else { btn.disabled = false; btn.textContent = "Spara recept"; }
      break;
    }
    case "ai": askAI(cur, el.dataset.q); break;
    case "aisave": {
      const it = (aiState[cur.id] || [])[+el.dataset.i]; if (!it) break;
      const add = `${it.q}\n${it.a.replace(/\*\*/g, "")}`;
      if (await patch(cur.id, { notes: [cur.notes, add].filter(Boolean).join("\n\n") })) { el.textContent = "✓ Sparat"; el.disabled = true; toast("Sparat i anteckningar"); }
      break;
    }
    case "closeimport": closeImport(); break;
    case "closeimport-bg": if (e.target === el && !importState?.busy) closeImport(); break;
    case "rmshot": importState.shots.splice(+el.dataset.i, 1); renderImport(); break;
    case "runimport": runImport(); break;
  }
});


// ---------- ark (inställningar, användare, lösenord) ----------
function openSheet(html){
  document.getElementById("modal-root").innerHTML = `<div class="modal-bg" id="sheet-bg"><div class="modal form" role="dialog">${html}</div></div>`;
  document.getElementById("sheet-bg").addEventListener("click", e => { if (e.target.id === "sheet-bg") closeSheet(); });
}
function closeSheet(){ document.getElementById("modal-root").innerHTML = ""; }
const $id = id => document.getElementById(id);

function openSettings(){
  openSheet(`<h2>Inställningar</h2>
    <p class="sub">Inloggad som ${esc(me || "")} · ${esc(ROLE_LABEL[role] || "Ingen behörighet")}</p>
    <div class="actions" style="flex-direction:column">
      ${can("admin") ? `<button class="btn ghost" id="usersBtn">Hantera användare${pendingReqs ? `<span class="dotcount">${pendingReqs}</span>` : ""}</button>
      <button class="btn ghost" id="timesBtn">Lägg in tider i gamla recept</button>
      <button class="btn ghost" id="tagEdBtn">Nyckelord</button>
      <button class="btn ghost" id="tagsBtn">Slå ihop nyckelord</button>
      <button class="btn ghost" id="importBtn">Importera recept från fil</button>
      <input type="file" id="importFile" accept=".json,application/json" hidden>` : ""}
      <button class="btn ghost" id="pwBtn">Byt lösenord</button>
      <button class="btn ghost" id="logoutBtn">Logga ut</button>
      <button class="btn" id="closeSheetBtn">Stäng</button>
    </div>`);
  $id("closeSheetBtn").onclick = closeSheet;
  $id("pwBtn").onclick = () => openPasswordSheet(false);
  if ($id("usersBtn")) $id("usersBtn").onclick = openUsers;
  if ($id("timesBtn")) $id("timesBtn").onclick = openTimesTool;
  if ($id("tagsBtn")) $id("tagsBtn").onclick = openMergeTool;
  if ($id("tagEdBtn")) $id("tagEdBtn").onclick = openTagEditor;
  if ($id("importBtn")) {
    $id("importBtn").onclick = () => $id("importFile").click();
    $id("importFile").onchange = e => { const f = e.target.files[0]; if (f) importFile(f, $id("importBtn")); };
  }
  $id("logoutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

async function openUsers(){
  openSheet(`<h2>Användare</h2>
    <p class="sub">Inloggningen delas med Munkholmsvägen, men behörigheten här gäller bara Receptboken.</p>
    <div id="uReqs"></div>
    <div id="uList" class="panel" style="padding:8px 14px"><p class="meta">Laddar …</p></div>
    <form id="uf">
      <h3 style="margin-top:18px;font-size:18px">Lägg till</h3>
      <div class="two"><div><label>Namn</label><input type="text" id="uName" placeholder="t.ex. Mamma"></div>
      <div><label>E-post</label><input type="text" id="uEmail" inputmode="email" required></div></div>
      <label>Behörighet</label>
      <select id="uRole"><option value="viewer">Läsa</option><option value="contributor" selected>Egna recept</option><option value="admin">Superanvändare</option></select>
      <label class="check" style="color:var(--ink);font-weight:500"><input type="checkbox" id="uInvite" checked> Skicka inloggningslänk till personen</label>
      <div class="err" id="uErr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="uClose">Stäng</button><button class="btn accent">Lägg till</button></div>
    </form>
    <div class="roles-help">
      <p><b>Läsa</b> – ser alla recept, men kan inte ändra något.</p>
      <p><b>Egna recept</b> – lägger till recept och ändrar och raderar sina egna. Gör egna varianter av andras recept, sätter favoriter och betyg, loggar tillagningar och använder AI-hjälpen. <i>Rätt nivå för de flesta.</i></p>
      <p><b>Superanvändare</b> – kan ändra och radera alla recept och bjuda in eller ta bort användare.</p>
    </div>`);
  $id("uClose").onclick = closeSheet;
  const load = async () => {
    const { data, error } = await sb.rpc("recipe_admin_list_users");
    if (error) { $id("uList").innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
    (data || []).forEach(u => { if (u.name) userNames[(u.email || "").toLowerCase()] = u.name; });
    $id("uList").innerHTML = (data || []).map(u => {
      const self = u.email === me;
      const opts = ROLE_ORDER.filter(r => r !== "editor" || u.role === "editor").map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
      return `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0e8da">
        <div><strong>${esc(u.name || u.email.split("@")[0])}</strong>${self ? ' <span class="meta">(du)</span>' : ""}<div class="meta">${esc(u.email)}</div></div>
        ${self ? `<span class="badge">${ROLE_LABEL[u.role]}</span>` : `<span class="row"><select data-urole="${esc(u.email)}" data-uname="${esc(u.name || "")}" style="width:auto;padding:6px 8px;font-size:13px">${opts}</select>
        <button class="btn ghost small" data-ulink="${esc(u.email)}" type="button" title="Skicka en ny inloggningslänk">Skicka länk</button>
        <button class="btn danger small" data-udel="${esc(u.email)}" type="button">Ta bort</button></span>`}</div>`;
    }).join("");
    $id("uList").querySelectorAll("[data-urole]").forEach(sel => sel.onchange = async () => {
      const { error } = await sb.rpc("recipe_admin_upsert_user", { p_email: sel.dataset.urole, p_name: sel.dataset.uname, p_role: sel.value });
      toast(error ? error.message : "Behörigheten är ändrad"); load();
    });
    $id("uList").querySelectorAll("[data-ulink]").forEach(b => b.onclick = async () => {
      b.disabled = true; const err = await sendLoginLink(b.dataset.ulink); b.disabled = false;
      toast(err ? "Länken gick inte iväg: " + err : "Inloggningslänk skickad till " + b.dataset.ulink);
    });
    $id("uList").querySelectorAll("[data-udel]").forEach(b => { let armed = false; b.onclick = async () => {
      if (!armed) { armed = true; b.textContent = "Säker?"; b.classList.add("armed"); return; }
      const { error } = await sb.rpc("recipe_admin_delete_user", { p_email: b.dataset.udel });
      if (error) toast(error.message); load();
    }; });
  };
  $id("uf").onsubmit = async e => {
    e.preventDefault(); $id("uErr").textContent = "";
    const email = $id("uEmail").value.trim().toLowerCase(), name = $id("uName").value.trim(), r = $id("uRole").value;
    const { error } = await sb.rpc("recipe_admin_upsert_user", { p_email: email, p_name: name, p_role: r });
    if (error) { $id("uErr").textContent = error.message; return; }
    let linkErr = null;
    if ($id("uInvite").checked) linkErr = await sendLoginLink(email);
    $id("uEmail").value = ""; $id("uName").value = "";
    if (linkErr) { $id("uErr").textContent = `${name || email} är tillagd, men inloggningslänken gick inte iväg: ${linkErr}`; }
    else toast(`${name || email} är tillagd${$id("uInvite").checked ? " och har fått en inloggningslänk" : ""}`);
    load();
  };
  window.__reloadUsers = load;
  load(); renderRequests();
}

function pwProblem(pw, pw2){
  if (pw.length < 10) return "Minst 10 tecken.";
  if (!/[a-zåäö]/.test(pw) || !/[A-ZÅÄÖ]/.test(pw) || !/\d/.test(pw)) return "Använd både små och stora bokstäver och minst en siffra.";
  if (pw !== pw2) return "Lösenorden matchar inte.";
  return "";
}
function openPasswordSheet(first){
  openSheet(`<h2>${first ? "Välj ett lösenord" : "Byt lösenord"}</h2>
    <p class="sub">${first ? "Nästa gång loggar du in med e-post och lösenord. Har du redan ett lösenord för Munkholmsvägen gäller samma här." : "Lösenordet gäller både Receptboken och Munkholmsvägen."}</p>
    <form id="pwf">
      <input type="email" autocomplete="username" value="${esc(me || "")}" style="display:none" readonly>
      <label>Nytt lösenord</label><input type="password" id="pw1" autocomplete="new-password" required style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px">
      <label>Upprepa lösenordet</label><input type="password" id="pw2" autocomplete="new-password" required style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px">
      <div class="hint">Minst 10 tecken, med stora och små bokstäver och minst en siffra.</div>
      <div class="err" id="pwErr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn ghost" id="pwLater">${first ? "Senare" : "Avbryt"}</button><button class="btn accent">Spara lösenord</button></div>
    </form>`);
  $id("pwLater").onclick = closeSheet;
  $id("pwf").onsubmit = async e => {
    e.preventDefault();
    const pw = $id("pw1").value, pw2 = $id("pw2").value, prob = pwProblem(pw, pw2);
    if (prob) { $id("pwErr").textContent = prob; return; }
    const { error } = await sb.auth.updateUser({ password: pw, data: { has_password: true } });
    if (error) { $id("pwErr").textContent = /different from the old/i.test(error.message) ? "Välj ett annat lösenord än det gamla." : "Kunde inte spara: " + error.message; return; }
    closeSheet(); toast("Lösenordet är sparat");
  };
}

// ---------- inloggning och start ----------
function showLogin(){ $id("app").classList.add("hidden"); $id("loginView").classList.remove("hidden"); }
let started = false;
async function showApp(session){
  if (started) return; started = true;
  me = (session.user.email || "").toLowerCase();
  $id("loginView").classList.add("hidden"); $id("app").classList.remove("hidden");
  // Vid omladdning: stanna kvar på receptet som var öppet
  if (location.hash === "#hjalp") view = { name: "help" };
  const hm = location.hash.match(/^#[re]=([^&]+)$/);
  if (hm) view = { name: "detail", id: decodeURIComponent(hm[1]) };
  // Visa sparade recept direkt, hämta färska i bakgrunden
  const cache = readCache();
  if (cache && cache.me === me && cache.recipes.length) { recipes = cache.recipes; role = cache.role; loaded = true; if (cache.tagGroups) customTagGroups = cache.tagGroups; }
  render();
  let roleErr = null;
  try { const { data: r, error } = await sb.rpc("recipe_my_role"); roleErr = error; if (!error) role = r || null; } catch (e) { roleErr = e; }
  if (roleErr && cache && cache.me === me && (navigator.onLine === false || /fetch|network|load failed/i.test(String(roleErr.message || roleErr)))) { role = cache.role; loadNote = "Du är offline – visar senast sparade recept."; loaded = true; render(); subscribe(); handleShare(); return; }
  if (!role) { storageOk = false; loaded = true; render(); return; }
  await loadAll(); subscribe(); handleShare(); refreshRequests();
  resumeCooking();
  const md = (session.user && session.user.user_metadata) || {};
  if (!md.has_password) openPasswordSheet(true);
}
const errText = err => {
  const m = (err && err.message) || "";
  if (/rate|too many/i.test(m)) return "För många försök. Vänta en stund och försök igen.";
  if (/invalid login credentials/i.test(m)) return "Fel e-post eller lösenord. Har du inte valt lösenord än? Använd inloggningslänken nedan.";
  if (/email not confirmed/i.test(m)) return "E-postadressen är inte bekräftad. Använd inloggningslänken nedan.";
  return "Det gick inte: " + (m || "okänt fel");
};
$id("loginForm").onsubmit = async e => {
  e.preventDefault(); $id("loginErr").textContent = "";
  const email = $id("loginEmail").value.trim().toLowerCase(), password = $id("loginPw").value;
  if (!password) { $id("loginErr").textContent = "Skriv ditt lösenord, eller använd inloggningslänken nedan."; return; }
  const btn = $id("loginBtn"); btn.disabled = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await showApp(data.session);
  } catch (err) { $id("loginErr").textContent = errText(err); }
  finally { btn.disabled = false; }
};
$id("magicLink").onclick = async e => {
  e.preventDefault(); $id("loginErr").textContent = "";
  const email = $id("loginEmail").value.trim().toLowerCase();
  if (!email || !email.includes("@")) { $id("loginErr").textContent = "Skriv din e-postadress först."; $id("loginEmail").focus(); return; }
  try {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) throw error;
    $id("loginSub").innerHTML = "Kolla mejlen och klicka på länken.";
  } catch (err) { $id("loginErr").textContent = errText(err); }
};

(async () => {
  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl) { document.body.innerHTML = '<div class="wrap"><div class="notice">Appen är inte konfigurerad än (config.js).</div></div>'; return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(session);
  else {
    // Offline och sessionen kunde inte förnyas: öppna ändå med sparade recept
    const c = readCache();
    if (navigator.onLine === false && c && c.me) showApp({ user: { email: c.me, user_metadata: { has_password: true } } });
    else showLogin();
  }
  sb.auth.onAuthStateChange((ev, s) => { if (ev === "SIGNED_IN" && s) showApp(s); if (ev === "SIGNED_OUT") { started = false; me = null; showLogin(); } });
})();

// Flytt från den gamla Claude-versionen: en JSON-fil med alla recept och bilder.
async function importFile(file, btn){
  let json;
  try { json = JSON.parse(await file.text()); } catch { toast("Filen gick inte att läsa"); return; }
  const list = Array.isArray(json) ? json : json && Array.isArray(json.recipes) ? json.recipes : null;
  if (!list) { toast("Hittade inga recept i filen"); return; }
  btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    btn.textContent = `Importerar ${i + 1} av ${list.length} …`;
    const r = { ...list[i] };
    if (!r.title) continue;
    if (typeof r.photo === "string" && r.photo.startsWith("data:image/")) r.photo = await storePhoto(r.photo);
    else if (typeof r.photo !== "string" || !/^https:\/\//.test(r.photo)) r.photo = null;
    if (!r.id || !/^[\w.:-]{1,80}$/.test(r.id)) delete r.id;
    if (await saveRecipe(r)) ok++;
  }
  btn.disabled = false; btn.textContent = "Importera recept från fil";
  toast(`${ok} recept importerade`);
  render();
}

// Kompakt lista: liten bild, namn, källa och tid på en rad.
function listRows(list){
  return `<ul class="rlist">${list.map(r => `
    <li class="rrow" data-a="open" data-id="${esc(r.id)}">
      <div class="rthumb">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : ""}</div>
      <div class="rmain">
        <h3>${isNewForMe(r) ? `<span class="newtag">Nytt</span> ` : ""}${esc(r.title || "Namnlöst recept")}${isFav(r) ? ` <span class="rfav" aria-label="Favorit">♥</span>` : ""}</h3>
        <div class="rmeta">${sourceBadge(r)}${r.variantOf ? `<span class="badge mod">${esc(variantBadge(r))}</span>` : isModified(r) ? `<span class="badge mod">Min version</span>` : ""}${(r.tags || []).slice(0, 3).map(t => `<span>${esc(t)}</span>`).join("")}</div>
      </div>
      <div class="rside">
        ${r.rating ? `<span class="rstars">${"★".repeat(r.rating)}</span>` : ""}
        ${r.time ? `<span>${esc(r.time)}</span>` : ""}
      </div>
    </li>`).join("")}</ul>`;
}

// ---------- Ändra receptet med AI ----------
async function aiEditRecipe(r, instruction){
  const btn = $id("edit-btn"), err = $id("edit-err");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Ändrar …'; err.textContent = "";
  const current = { title: r.title, servings: r.servings || null, time: r.time || "", ingredients: r.ingredients || [], steps: r.steps || [] };
  const prompt = `Du redigerar ett matrecept åt en svensk hemmakock. Gör exakt de ändringar som efterfrågas och behåll allt annat oförändrat, ordagrant.
Justera mängder, steg och tid när ändringen kräver det (t.ex. om en ingrediens byts ut eller tas bort ska stegen följa med).
Svara ENDAST med JSON:
{"title": string, "servings": number eller null, "time": string, "ingredients": [string], "steps": [string], "summary": string}
- ingredients: en per rad, mängd först. Rubriker som börjar med "# " får finnas.
- steps: ett steg per element, utan numrering. Rubriker som börjar med "# " får finnas (t.ex. "# Dagen innan", "# Vid servering") – behåll befintliga och lägg till om användaren ber om det. Behåll alla tidsangivelser i stegen och skriv dem med siffror och enhet, t.ex. "15 min", "1 h".
- summary: en kort mening på svenska om vad du ändrade, t.ex. "Bytte grädde mot crème fraiche och tog bort koriander."

NUVARANDE RECEPT:
${JSON.stringify(current)}

ÖNSKAD ÄNDRING:
${instruction}`;
  try {
    const out = parseJson(await ai(prompt, { mode: "json" }));
    if (!Array.isArray(out.ingredients) || !Array.isArray(out.steps)) throw { code: "invalid_json" };
    draft = JSON.parse(JSON.stringify(r));
    if (out.title) draft.title = String(out.title).trim();
    draft.servings = Number.isFinite(+out.servings) && +out.servings > 0 ? Math.round(+out.servings) : draft.servings;
    if (typeof out.time === "string") draft.time = out.time.trim();
    draft.ingredients = out.ingredients.map(x => String(x).trim()).filter(Boolean);
    draft.steps = out.steps.map(x => String(x).trim()).filter(Boolean);
    if (out.summary) draft.myChanges = [r.myChanges, String(out.summary).trim()].filter(Boolean).join("\n");
    view = { name: "edit", id: r.id }; render(); window.scrollTo(0, 0);
    toast("Granska ändringen och spara");
  } catch (e) {
    err.textContent = aiErr(e);
    btn.disabled = false; btn.textContent = "Ändra";
  }
}
document.addEventListener("submit", e => {
  if (e.target.id !== "edit-form") return;
  e.preventDefault();
  const q = $id("edit-input").value.trim(); if (!q) return;
  const r = recipes.find(x => x.id === view.id); if (r && canEdit(r)) aiEditRecipe(r, q);
});

// ---------- Tillagningar (frivillig historik) ----------
const histOf = r => Array.isArray(r.history) ? r.history : [];
function historyHtml(r){
  const h = histOf(r).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!h.length) return "";
  return `<div class="panel">
    <h2><span>Tillagningar</span><span class="meta">${h.length} st</span></h2>
    <ul class="hist">${h.map(e => `
      <li class="hitem">
        ${e.photo ? `<img class="hphoto" src="${esc(e.photo)}" alt="" loading="lazy">` : ""}
        <div class="hbody">
          <div class="hhead"><span class="hdate">${esc(fmtDate(e.date))}</span>${e.by ? `<span class="hby">${esc(nameOf(e.by))}</span>` : ""}${e.rating ? `<span class="rstars">${"★".repeat(e.rating)}</span>` : ""}</div>
          ${e.note ? `<div class="prewrap">${esc(e.note)}</div>` : ""}
          ${e.snapshot ? `<details class="hvar"><summary>Receptet den gången</summary>
            <ul>${(e.snapshot.ingredients || []).map(l => l.startsWith("#") ? `<li class="g">${esc(l.replace(/^#+\s*/, ""))}</li>` : `<li>${esc(l)}</li>`).join("")}</ul>
            <ol>${(e.snapshot.steps || []).map(st => st.startsWith("#") ? `<li class="group">${esc(st.replace(/^#+\s*/, ""))}</li>` : `<li>${esc(st)}</li>`).join("")}</ol>
            ${canEdit(r) ? `<button class="btn ghost small" data-a="histuse" data-h="${esc(e.id)}">Använd som min version</button>` : ""}
          </details>` : ""}
          ${can("contributor") && (canEdit(r) || (e.by || OWNER) === me) ? `<div class="hacts"><button class="linkbtn" data-a="histedit" data-h="${esc(e.id)}">Ändra</button><button class="linkbtn" data-a="histdel" data-h="${esc(e.id)}">Ta bort</button></div>` : ""}
        </div>
      </li>`).join("")}</ul>
  </div>`;
}
function openHistory(r, entryId){
  const e = histOf(r).find(x => x.id === entryId) || { date: today(), rating: 0, note: "", photo: null };
  let photo = e.photo || null;
  openSheet(`<h2>${entryId ? "Ändra tillagning" : "Ny tillagning"}</h2>
    <p class="sub">${esc(r.title || "")}</p>
    <form id="hf" class="form">
      <div class="two">
        <div><label>Datum</label><input type="text" id="hdate" value="${esc(e.date)}" placeholder="ÅÅÅÅ-MM-DD"></div>
        <div><label>Betyg</label><select id="hrate"><option value="0">Inget</option>${[1,2,3,4,5].map(n => `<option value="${n}" ${e.rating === n ? "selected" : ""}>${"★".repeat(n)}</option>`).join("")}</select></div>
      </div>
      <label>Vad gjorde du, och hur blev det?</label>
      <textarea id="hnote" rows="4" placeholder="t.ex. Grillade på hög värme, la till lime. Lite för salt – nästa gång mindre fisksås.">${esc(e.note || "")}</textarea>
      ${entryId ? "" : `<label class="check" style="color:var(--ink)"><input type="checkbox" id="hsnap"> Spara ingredienser och steg som de ser ut nu, som en variant</label>`}
      <label>Bild (valfritt)</label>
      <div class="photo-pick"><span id="hprev">${photo ? `<img src="${esc(photo)}" alt="">` : ""}</span><input type="file" accept="image/*" id="hphoto"></div>
      <div class="err" id="herr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" class="btn ghost" id="hcancel">Avbryt</button><button class="btn accent" id="hsave">Spara</button></div>
    </form>`);
  $id("hcancel").onclick = closeSheet;
  $id("hphoto").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    $id("hsave").disabled = true;
    const url = await storePhoto(await compress(f, 1200, 400000));
    if (url) { photo = url; $id("hprev").innerHTML = `<img src="${esc(url)}" alt="">`; }
    $id("hsave").disabled = false;
  };
  $id("hf").onsubmit = async ev => {
    ev.preventDefault();
    const date = $id("hdate").value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $id("herr").textContent = "Skriv datum som ÅÅÅÅ-MM-DD."; return; }
    const entry = { id: entryId || ("h" + Date.now().toString(36)), date, rating: +$id("hrate").value || 0, note: $id("hnote").value.trim(), photo, by: (e && e.by) || me };
    if (!entryId && $id("hsnap") && $id("hsnap").checked) entry.snapshot = { servings: r.servings || null, ingredients: r.ingredients || [], steps: r.steps || [] };
    if (entryId && e.snapshot) entry.snapshot = e.snapshot;
    const list = histOf(r).filter(x => x.id !== entry.id).concat(entry);
    const data = { history: list };
    if (!entryId) {
      data.timesCooked = (r.timesCooked || 0) + 1;
      if (!r.lastCooked || date > r.lastCooked) data.lastCooked = date;
      data.cookLog = cookLogOf(r).concat({ by: me, date, at: new Date().toISOString() });
    }
    $id("hsave").disabled = true;
    if (await patch(r.id, data)) { closeSheet(); toast(entryId ? "Tillagningen är ändrad" : "Tillagningen är sparad"); }
    else $id("hsave").disabled = false;
  };
}

// svep åt sidan mellan Ingredienser och Gör så här (mobil)
(() => {
  let sx = 0, sy = 0, on = false;
  document.addEventListener("touchstart", e => {
    on = !!e.target.closest(".cook"); if (!on) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!on) return; on = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const t = dx < 0 ? "steps" : "ing";
    if (detailState.tab === t) return;
    const b = document.querySelector(`.ctabs [data-t="${t}"]`); if (b) b.click();
  }, { passive: true });
})();

// behåll texten i anteckningsrutan om sidan ritas om medan man skriver
document.addEventListener("input", e => { if (e.target.id === "notes-input") detailState.notesDraft = e.target.value; });

// ---------- webbapp: service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
window.addEventListener("online", () => { if (started && role) { loadNote = ""; loadAll(); } });
window.addEventListener("offline", () => { if (started) { loadNote = "Du är offline – visar senast sparade recept."; if (view.name !== "edit") render(); } });

// ---------- skärmen tänd medan ett recept är öppet ----------
let wakeLock = null;
let wakeWanted = false;  // användaren slår på själv; gäller tills appen stängs
function showWake(){
  const b = document.getElementById("wakebtn"); if (!b) return;
  const on = !!wakeLock;
  b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
  const t = on ? "Skärmen hålls tänd – tryck för att stänga av" : "Håll skärmen tänd medan du lagar";
  b.title = t; b.setAttribute("aria-label", t);
}
async function syncWakeLock(){
  const want = wakeWanted && view.name === "detail" && document.visibilityState === "visible";
  try {
    if (want && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; showWake(); });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
  setTimeout(showWake, 0);
}
document.addEventListener("visibilitychange", syncWakeLock);

// ---------- "Dela till Sivander's Recept" (Android) ----------
async function handleShare(){
  const q = SHARE_Q; SHARE_Q = new URLSearchParams();
  if (!q.has("share")) return;
  if (!can("contributor")) { toast("Du har bara läsbehörighet"); return; }
  const files = [];
  try {
    const inbox = await caches.open("share-inbox");
    for (const req of await inbox.keys()) {
      const res = await inbox.match(req); const blob = await res.blob();
      files.push(new File([blob], decodeURIComponent(res.headers.get("x-name") || "bild.jpg"), { type: blob.type || "image/jpeg" }));
      await inbox.delete(req);
    }
  } catch {}
  const raw = [q.get("title"), q.get("text")].filter(Boolean).join("\n");
  let url = q.get("url") || "";
  if (!url) { const m = raw.match(/https?:\/\/\S+/); if (m) url = m[0]; }
  // Webbläsare skickar ofta bara sidans titel och adressen som "text" – det är ingen recepttext.
  // Behåll texten bara om det finns riktigt innehåll utöver länken och titeln.
  let text = raw.replace(/https?:\/\/\S+/g, "").replace(q.get("title") || "\u0000", "").trim();
  text = text.length > 120 ? raw.replace(/https?:\/\/\S+/g, "").trim() : "";
  view = { name: "list" }; render();
  openImport(files);
  if (!importState) return;
  importState.url = url;
  if (!files.length) {
    importState.text = text; renderImport();
    // Bara en länk: hämta receptet direkt
    if (url && !text && !/instagram\.com|facebook\.com|fb\.watch|tiktok\.com/i.test(url)) runImport();
  }
}

// ---------- bild: från enheten, urklipp eller länk ----------
function openPhotoSheet(onDone){
  openSheet(`
    <h2>Bild på rätten</h2>
    <div class="photo-opts">
      ${HAS_CAMERA ? `<label class="btn accent photo-file">Ta foto<input type="file" accept="image/*" capture="environment" id="ps-cam" hidden></label>` : ""}
      <label class="btn ${HAS_CAMERA ? "ghost" : "accent"} photo-file">Välj från enheten<input type="file" accept="image/*" id="ps-file" hidden></label>
      <button type="button" class="btn ghost" id="ps-paste">Klistra in kopierad bild</button>
    </div>
    <div class="hint" id="ps-pastehint">Har du kopierat en bild kan du också trycka Ctrl+V (Cmd+V på Mac) när den här rutan är öppen.</div>
    <label>Eller hämta från en länk</label>
    <form class="ai-ask" id="ps-urlform"><input id="ps-url" type="url" placeholder="Länk till bilden eller receptsidan" autocomplete="off"><button class="btn small" type="submit">Hämta</button></form>
    <div class="err" id="ps-err"></div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn ghost" id="ps-close">Avbryt</button></div>`);
  let busy = false;
  const err = m => { $id("ps-err").textContent = m || ""; };
  const finish = async blob => {
    if (busy) return; busy = true; err("");
    $id("ps-err").innerHTML = `<span class="meta"><span class="spinner"></span> Sparar bilden …</span>`;
    try {
      const url = await storePhoto(await compress(blob, 1200, 400000));
      if (!url) throw 0;
      document.removeEventListener("paste", onPaste);
      closeSheet(); await onDone(url);
    } catch { busy = false; err("Kunde inte läsa bilden. Prova en annan."); }
  };
  const onPaste = e => {
    if (!$id("ps-err")) { document.removeEventListener("paste", onPaste); return; }
    const item = [...(e.clipboardData && e.clipboardData.items || [])].find(i => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); finish(item.getAsFile()); return; }
    const txt = e.clipboardData && e.clipboardData.getData("text");
    if (txt && /^https?:\/\//.test(txt.trim()) && document.activeElement !== $id("ps-url")) { e.preventDefault(); $id("ps-url").value = txt.trim(); fromUrl(); }
  };
  document.addEventListener("paste", onPaste);
  $id("ps-close").onclick = () => { document.removeEventListener("paste", onPaste); closeSheet(); };
  $id("ps-file").onchange = e => { const f = e.target.files[0]; if (f) finish(f); };
  if ($id("ps-cam")) $id("ps-cam").onchange = e => { const f = e.target.files[0]; if (f) finish(f); };
  $id("ps-paste").onclick = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw { hint: true };
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(x => x.startsWith("image/"));
        if (t) return finish(await it.getType(t));
        if (it.types.includes("text/plain")) {
          const txt = (await (await it.getType("text/plain")).text()).trim();
          if (/^https?:\/\//.test(txt)) { $id("ps-url").value = txt; return fromUrl(); }
        }
      }
      err("Hittade ingen bild bland det du kopierat.");
    } catch (e) {
      err(e && e.hint ? "Webbläsaren tillåter inte knappen här – tryck Ctrl+V (Cmd+V) i stället." : "Fick inte läsa urklippet. Tryck Ctrl+V (Cmd+V) i stället, eller tillåt urklipp när webbläsaren frågar.");
    }
  };
  const fromUrl = async () => {
    let u = $id("ps-url").value.trim(); if (!u || busy) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    err(""); $id("ps-err").innerHTML = `<span class="meta"><span class="spinner"></span> Hämtar bilden …</span>`;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) }, body: JSON.stringify({ url: u, imageOnly: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.image) throw new Error(j.error || "Hittade ingen bild på den länken");
      await finish(await (await fetch(j.image)).blob());
    } catch (e) { err((e.message || "Kunde inte hämta bilden") + "."); }
  };
  $id("ps-urlform").onsubmit = e => { e.preventDefault(); fromUrl(); };
}

// ---------- förfrågningar om tillgång ----------
async function refreshRequests(){
  if (!can("admin")) return [];
  try {
    const { data, error } = await sb.rpc("recipe_admin_list_requests");
    if (error) return [];
    const before = pendingReqs; pendingReqs = (data || []).length;
    if (pendingReqs && !before && view.name === "list") toast(pendingReqs === 1 ? "1 ny förfrågan om tillgång – se Konto" : pendingReqs + " nya förfrågningar om tillgång – se Konto");
    if (before !== pendingReqs && view.name !== "edit") render();
    return data || [];
  } catch { return []; }
}
async function renderRequests(){
  const box = $id("uReqs"); if (!box) return;
  const list = await refreshRequests();
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h3 style="margin:4px 0 6px;font-size:18px">Vill ha tillgång</h3><div class="panel reqs" style="padding:4px 14px">${list.map(r => `
    <div class="req">
      <div><strong>${esc(r.name || r.email.split("@")[0])}</strong> <span class="meta">${esc(r.email)} · ${esc(fmtDate((r.created_at || "").slice(0, 10)))}</span></div>
      ${r.message ? `<div class="msg">${esc(r.message)}</div>` : ""}
      <div class="row" style="margin-top:6px">
        <select data-rrole="${r.id}" style="width:auto;padding:6px 8px;font-size:13px"><option value="viewer">Läsa</option><option value="contributor" selected>Egna recept</option><option value="admin">Superanvändare</option></select>
        <button class="btn accent small" type="button" data-rok="${r.id}">Godkänn</button>
        <button class="btn ghost small" type="button" data-rno="${r.id}">Avvisa</button>
      </div>
    </div>`).join("")}</div>`;
  const resolve = async (id, roleVal, label) => {
    const req = list.find(x => String(x.id) === String(id));
    const { error } = await sb.rpc("recipe_admin_resolve_request", { p_id: +id, p_role: roleVal });
    let linkErr = null;
    if (!error && roleVal && req) linkErr = await sendLoginLink(req.email);
    toast(error ? error.message : linkErr ? "Godkänd, men inloggningslänken gick inte iväg: " + linkErr : label);
    renderRequests(); if (window.__reloadUsers) window.__reloadUsers();
  };
  box.querySelectorAll("[data-rok]").forEach(b => b.onclick = () => resolve(b.dataset.rok, box.querySelector(`[data-rrole="${b.dataset.rok}"]`).value, "Godkänd – personen har fått en inloggningslänk i mejlen"));
  box.querySelectorAll("[data-rno]").forEach(b => { let armed = false; b.onclick = () => {
    if (!armed) { armed = true; b.textContent = "Säker?"; b.classList.add("armed"); return; }
    resolve(b.dataset.rno, null, "Förfrågan avvisad");
  }; });
}

// inloggningssidan: begär tillgång
$id("reqToggle").onclick = e => {
  e.preventDefault();
  $id("reqForm").classList.toggle("hidden");
  if (!$id("reqForm").classList.contains("hidden")) {
    if (!$id("reqEmail").value) $id("reqEmail").value = $id("loginEmail").value.trim();
    $id("reqName").focus();
  }
};
$id("reqForm").onsubmit = async e => {
  e.preventDefault(); $id("reqErr").textContent = "";
  const btn = $id("reqBtn"); btn.disabled = true;
  try {
    const { data, error } = await sb.rpc("recipe_request_access", { p_email: $id("reqEmail").value.trim(), p_name: $id("reqName").value.trim(), p_message: $id("reqMsg").value.trim() });
    if (error) throw error;
    $id("reqForm").classList.add("hidden");
    $id("reqToggle").parentElement.classList.add("hidden");
    $id("reqDone").classList.remove("hidden");
    $id("reqDone").innerHTML = data === "har_tillgang"
      ? "Du har redan tillgång! Skriv din e-post ovan och tryck <b>Skicka en inloggningslänk</b>."
      : "Tack! Din förfrågan är skickad till Nicklas.<br>När du har godkänts får du en inloggningslänk i mejlen.";
  } catch (err) {
    $id("reqErr").textContent = /function|schema cache|does not exist/i.test(err.message || "") ? "Det går inte att begära tillgång just nu." : (err.message || "Något gick fel");
  } finally { btn.disabled = false; }
};

// ---------- klistra in skärmdumpar i importrutan ----------
function addImportShots(blobs){
  const s = importState; if (!s || s.busy) return 0;
  let n = 0;
  for (const b of blobs) { if (s.shots.length >= 6) break; s.shots.push({ blob: b, url: URL.createObjectURL(b) }); n++; }
  if (n) { s.error = ""; renderImport(); toast(s.shots.length >= 6 ? "6 bilder – det är max" : `Bild inlagd (${s.shots.length} av 6) – lägg till fler eller läs in`); }
  else if (s.shots.length >= 6) toast("Max 6 bilder per recept");
  return n;
}
document.addEventListener("paste", e => {
  if (!importState || importState.busy || !document.getElementById("imp-text")) return;
  const imgs = [...(e.clipboardData && e.clipboardData.items || [])].filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean);
  if (!imgs.length) return;  // vanlig text klistras in som vanligt
  e.preventDefault();
  addImportShots(imgs);
});
async function pasteShotsFromClipboard(){
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw { hint: true };
    const blobs = [];
    for (const it of await navigator.clipboard.read()) {
      const t = it.types.find(x => x.startsWith("image/"));
      if (t) blobs.push(await it.getType(t));
    }
    if (!blobs.length) { toast("Hittade ingen bild bland det du kopierat"); return; }
    addImportShots(blobs);
  } catch (e) {
    toast(e && e.hint ? "Tryck Ctrl+V (Cmd+V) i rutan i stället" : "Fick inte läsa urklippet – tryck Ctrl+V (Cmd+V) i stället");
  }
}

// Öppna kameran direkt (på telefon/surfplatta)
function takePhoto(cb){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
  inp.style.display = "none"; document.body.appendChild(inp);
  inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) cb(f); };
  inp.click();
}

// ---------- hjälp, anpassad efter enheten ----------
const WAKE_SVG = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect class="ph" x="10.5" y="5" width="11" height="22" rx="2.4"/><path d="M14.5 23.6h3"/><g class="rays"><path d="M5.5 10.5l-2.4-1.4M5 16H2.3M5.5 21.5l-2.4 1.4M26.5 10.5l2.4-1.4M27 16h2.7M26.5 21.5l2.4 1.4"/></g><path class="zz" d="M24.2 6.2h3.4l-3.4 3.6h3.4"/></svg>`;
function deviceInfo(){
  const ua = navigator.userAgent;
  const ios = /iphone|ipod/i.test(ua) || (/ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1));
  const android = /android/i.test(ua);
  const mac = !ios && /macintosh|mac os x/i.test(ua);
  const kind = ios ? "ios" : android ? "android" : mac ? "mac" : "pc";
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return { kind, touch: ios || android, installed, mod: mac || ios ? "Cmd" : "Ctrl" };
}
function renderHelp(){
  const d = deviceInfo();
  const name = { ios: "iPhone/iPad", android: "Android", mac: "Mac", pc: "datorn" }[d.kind];
  const install = {
    ios: `Öppna <b>recept.sivander.com</b> i Safari (eller Chrome) → tryck <b>Dela</b> <span class="k">⬆︎</span> → <b>Lägg till på hemskärmen</b> → <b>Lägg till</b>.`,
    android: `Öppna <b>recept.sivander.com</b> i Chrome → menyn <span class="k">⋮</span> → <b>Installera app</b>.`,
    mac: `Öppna sidan i Chrome eller Edge → klicka på installera-ikonen i adressfältet (eller menyn → <b>Installera Sivander's Recept</b>). I Safari: Arkiv → <b>Lägg till i Dock</b>.`,
    pc: `Öppna sidan i Chrome eller Edge → klicka på installera-ikonen i adressfältet (eller menyn → <b>Installera Sivander's Recept</b>).`,
  };
  const installSteps = {
    ios: `<ol><li>Öppna <b>recept.sivander.com</b> i <b>Safari</b> (Chrome går också).</li><li>Tryck på <b>Dela</b>-knappen <span class="k">⬆︎</span> – i Safari längst ner, i Chrome uppe i adressfältet.</li><li>Scrolla och välj <b>Lägg till på hemskärmen</b>.</li><li>Kontrollera namnet och tryck <b>Lägg till</b>.</li></ol>`,
    android: `<ol><li>Öppna <b>recept.sivander.com</b> i <b>Chrome</b>.</li><li>Tryck på menyn <span class="k">⋮</span> uppe till höger.</li><li>Välj <b>Installera app</b> (ibland <i>Lägg till på startskärmen</i>) och bekräfta.</li></ol><p class="hnote">Installerad dyker appen också upp i <b>Dela</b>-menyn, så du kan dela recept från andra appar direkt hit.</p>`,
    mac: `<ol><li>Öppna sidan i <b>Chrome</b> eller <b>Edge</b>.</li><li>Klicka på installera-ikonen till höger i adressfältet, eller menyn → <b>Casta, spara och dela → Installera sidan som app</b>.</li><li>Klicka <b>Installera</b>.</li></ol><p class="hnote">I Safari: menyn Arkiv → <b>Lägg till i Dock</b>.</p>`,
    pc: `<ol><li>Öppna sidan i <b>Chrome</b> eller <b>Edge</b>.</li><li>Klicka på installera-ikonen till höger i adressfältet, eller menyn <span class="k">⋮</span> → <b>Casta, spara och dela → Installera sidan som app</b> (Edge: <b>Appar → Installera den här webbplatsen som en app</b>).</li><li>Klicka <b>Installera</b>. Appen hamnar i Start-menyn och kan fästas i aktivitetsfältet.</li></ol>`,
  };
  const shot = {
    ios: "sidoknappen + volym upp",
    android: "strömknappen + volym ned",
    mac: `<span class="k">Cmd</span>+<span class="k">Ctrl</span>+<span class="k">Shift</span>+<span class="k">4</span> (hamnar direkt i urklippet)`,
    pc: `<span class="k">Win</span>+<span class="k">Shift</span>+<span class="k">S</span>`,
  }[d.kind];
  const others = Object.keys(install).filter(k => k !== d.kind);
  const lbl = { ios: "iPhone/iPad", android: "Android", mac: "Mac", pc: "Windows" };
  const sec = (title, body, open) => `<details class="hsec" ${open ? "open" : ""}><summary>${title}</summary><div class="hbody">${body}</div></details>`;

  $app.innerHTML = `
  <div class="help">
    <button class="fback" data-a="home" aria-label="Tillbaka"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
    <div class="help-head">
      <img src="logo.svg" alt="" class="help-logo">
      <div><h1>Hjälp</h1><p class="hnote">Instruktionen är anpassad för ${esc(name)}.</p></div>
    </div>

    ${sec("Kom igång", `
      <p>Appen finns på <b>recept.sivander.com</b> och fungerar på telefon, surfplatta och dator.</p>
      <p><b>Ny användare?</b> Tryck <b>Begär tillgång</b> på inloggningssidan. När du är godkänd får du en inloggningslänk i mejlen.</p>
      <p><b>Glömt lösenordet?</b> Skriv din e-post och tryck <b>Skicka en inloggningslänk</b>.</p>`, true)}

    ${sec("Installera appen", `
      ${d.installed ? `<p class="ok">✓ Appen är redan installerad på den här enheten.</p>` : ""}
      <p>Installerad startar appen från en egen ikon, i helskärm utan webbläsarens adressfält – och den fungerar även utan nät. Det kostar inget och tar nästan ingen plats.</p>
      <div class="hdev on"><div class="hdev-t">${lbl[d.kind] === "Windows" ? "Windows-dator" : lbl[d.kind]} <span class="hnote">– din enhet</span></div>${installSteps[d.kind]}</div>
      ${others.map(k => `<details class="hmini"><summary>${k === "pc" ? "Windows-dator" : lbl[k]}</summary>${installSteps[k]}</details>`).join("")}
      <p class="hnote" style="margin-top:10px">Appen uppdateras av sig själv – ladda om om du vill ha det senaste direkt. Vill du ta bort den: håll fingret på ikonen och välj ta bort/avinstallera (på datorn: appens meny → Avinstallera). Recepten ligger kvar.</p>`)}

    ${sec("Lägg till ett recept", `
      <p>Tryck på <b>+</b> nere till höger:</p>
      <ul>
        ${d.touch ? `<li><b>Ta foto</b> – kameran öppnas direkt. Fota en kokbokssida eller lapp; tryck <b>Ta foto</b> igen för fler sidor (upp till 6).</li>` : ""}
        <li><b>Välj bilder</b> – skärmdumpar eller foton du redan har. Flera bilder blir ett recept.</li>
        <li><b>Länk eller text</b> – klistra in länken till en receptsida, så hämtar appen receptet och bilden själv. Eller klistra in texten.</li>
        <li><b>Skriv eget recept</b> – fyll i själv.</li>
      </ul>
      <p><b>Skärmdumpar från ett annat fönster:</b> öppna importrutan, ta en skärmdump med ${shot}, ${d.touch ? `gå tillbaka till appen och tryck <b>Klistra in skärmdump</b>` : `byt tillbaka och tryck <span class="k">${d.mod}</span>+<span class="k">V</span>`}. Upprepa – rutan väntar.</p>
      <p><b>Instagram och Facebook</b> släpper inte in appen via länk. Kopiera bildtexten eller ta skärmdumpar i stället.${d.kind === "android" ? ` Från Instagram kan du också trycka <b>Dela</b> → <b>Sivander's Recept</b> (när appen är installerad).` : ""}</p>
      <p>AI:n plockar ut ingredienser och steg – granska och tryck <b>Spara</b>.</p>`)}

    ${sec("När du lagar mat", `
      <ul>
        ${d.touch ? `<li>Växla mellan <b>Ingredienser</b> och <b>Gör så här</b> med flikarna eller genom att <b>svepa</b> åt sidan.</li>` : `<li>Ingredienser och steg står bredvid varandra (i ett smalt fönster blir det flikar).</li>`}
        <li>Tryck på en rad för att <b>bocka av</b> den.</li>
        <li>Ändra antalet <b>portioner</b> med − och + – mängderna räknas om.</li>
        <li>Tryck <b>🍳 Börja laga</b> i receptet. Skärmen hålls tänd, bockarna sparas och <b>nästa steg</b> markeras. Tider i stegen blir knappar (⏱ 15 min) som startar en timer.</li>
        <li>Lämnar du receptet eller appen syns en mörk bar längst ner: <b>Lagar nu</b> – tryck för att komma tillbaka dit du var. Öppnar du appen igen hamnar du direkt i receptet.</li>
        <li>Tryck <b>Klar!</b> när du är färdig, så sparar du tillagningen med betyg, anteckning och bild. ${d.kind === "ios" ? "På iPhone piper timern bara när appen är öppen – titta i baren när du kommer tillbaka." : "Timern piper och vibrerar när tiden är ute."}</li>
        <li>Håll skärmen tänd med <b>telefonikonen</b> – se nedan.</li>
        <li>Tryck <b>Lagad idag</b> när du är klar, eller <b>Ny tillagning</b> för att spara datum, betyg, anteckning och bild.</li>
      </ul>`)}

    ${sec("Favoriter", `
      <ul>
        <li>Tryck på <b>hjärtat</b> <span style="color:var(--accent)">♡</span> i ett recept för att spara det bland dina favoriter – det fylls i <span style="color:var(--accent)">♥</span>. Tryck igen för att ta bort.</li>
        <li>Favoriterna är <b>personliga</b>: dina hjärtan syns bara för dig, och alla andra har sina egna.</li>
        <li>Visa bara dina favoriter med filtret <b>Mina favoriter</b> överst i receptlistan. Favoriter har ett litet hjärta på bilden i listan.</li>
        <li><b>Betyget</b> (stjärnorna bredvid hjärtat) är däremot gemensamt för receptet.</li>
      </ul>`)}

    ${sec("Hålla skärmen tänd", `
      <p>Bra när du lagar mat och inte vill att ${d.touch ? "telefonen" : "skärmen"} släcks eller låser sig.</p>
      <ul>
        <li>Tryck på <b>telefonikonen</b> på samma rad som stjärnorna och hjärtat.</li>
        <li><span class="wk off">${WAKE_SVG}</span> <b>Grå med z</b> = av, skärmen släcks som vanligt.</li>
        <li><span class="wk on">${WAKE_SVG}</span> <b>Guld med strålar</b> = på, skärmen hålls tänd medan receptet är öppet.</li>
        <li>Den är <b>av</b> varje gång du öppnar appen – du slår på den när du behöver. Valet gäller alla recept tills du stänger appen.</li>
        <li>Byter du app eller släcker skärmen själv släpps låset; det kommer tillbaka när du öppnar receptet igen.</li>
      </ul>
      ${d.kind === "ios" ? `<p class="hnote">På iPhone kräver det iOS 16.4 eller senare, och strömsparläge kan stoppa det.</p>` : `<p class="hnote">Strömsparläge kan stoppa det. Syns ingen ikon stöder webbläsaren inte funktionen.</p>`}`)}

    ${sec("Bild på rätten", `
      <p>Tryck <b>Byt bild</b> i receptet: ${d.touch ? "<b>Ta foto</b>, " : ""}välj från enheten, <b>klistra in</b> en kopierad bild${d.touch ? "" : ` (eller <span class="k">${d.mod}</span>+<span class="k">V</span>)`} eller <b>hämta från en länk</b>.</p>`)}

    ${sec("Rubriker, anteckningar och AI", `
      <ul>
        <li>Rader som börjar med <b>#</b> blir rubriker – bland ingredienserna (<i># Till såsen</i>) och i stegen (<i># Dagen innan</i>, <i># Vid servering</i>).</li>
        <li><b>Anteckningar:</b> tryck <i>Redigera</i> och skriv direkt i receptet.</li>
        <li><b>Ändra receptet:</b> skriv vad du vill ändra, t.ex. <i>"byt grädde mot crème fraiche"</i> eller <i>"dela upp stegen i dagen innan och vid servering"</i>.</li>
        <li><b>Fråga sommelieren och kocken:</b> vin, alternativ, tillbehör, liknande recept.</li>
      </ul>`)}

    ${sec("Dina och andras recept", `
      <ul>
        <li>Du kan ändra och radera <b>dina egna</b> recept.</li>
        <li>Vill du ändra någon annans: tryck <b>Gör min egen variant</b> – du får en egen kopia. Du kan göra hur många varianter du vill, även av dina egna recept (<b>Gör en variant</b>).</li>
        <li>Varianter får automatiskt ett namn efter vad som skiljer dem från originalet, t.ex. <i>Extra stark</i> eller <i>Utan grädde</i>. Vill du döpa själv skriver du namnet under <b>Redigera</b>. Byt mellan originalet och varianterna med raden <b>Varianter</b> under rubriken.</li>
        <li>Är grundreceptet ditt kan du föra över en variant till det med <b>Uppdatera grundreceptet</b> längst ner i varianten.</li>
        <li>Ändrar du ingredienser, steg eller portioner i ett recept frågar appen om det ska bli en <b>ny variant</b> (originalet lämnas orört) eller om du vill <b>ändra originalet</b> – det senare är för rättelser.</li>
        <li>Filtren <b>Tillagda av mig</b> och <b>Lagade av mig</b> överst i listan visar dina egna recept och det du har lagat.</li>
        <li><b>Filtrera</b> (till höger i filterraden, på mobilen bredvid Bilder/Lista) öppnar nyckelorden i grupper. Välj flera för att smalna av, t.ex. <i>fisk + vardag</i>. Valda filter syns som brickor som du tar bort med ×.</li>
        <li>När du redigerar ett recept väljer du nyckelord genom att trycka på dem, eller skriver ett nytt. Superanvändare ändrar listan under <b>Konto → Nyckelord</b>.</li>
      </ul>`)}

    ${sec("Bra att veta", `
      <ul>
        <li>Recepten sparas på enheten och går att läsa <b>utan nät</b>.</li>
        <li><b>Senaste i köket</b> överst i receptlistan: tryck på raden för att fälla ut den. Fliken <b>Nya recept</b> visar vem som har lagt till recept eller gjort varianter, <b>Senast lagade</b> vem som har lagat vad. Röda prickar och <b>Nytt</b> visar vad som har hänt sedan du var här sist.</li>
        <li>Det andra sparar syns direkt hos dig.</li>
        <li>Länken till ett öppet recept kan delas – mottagaren hamnar på just det receptet.</li>
        <li><b>Behörigheter:</b> Läsa – ser allt. Egna recept – lägger till och ändrar sina egna. Superanvändare – ändrar allt och godkänner nya.</li>
      </ul>`)}

    <p class="help-pdf"><a href="/hjalp.pdf" target="_blank" rel="noopener">Ladda ner instruktionen som PDF</a> – för utskrift eller att skicka vidare.</p>
    <p class="hnote" style="text-align:center;margin:8px 0 60px">Något som krånglar? Säg till Nicklas.</p>
  </div>`;
}

// Skicka inloggningslänk och berätta tydligt om det inte gick (Supabase begränsar antalet mejl)
async function sendLoginLink(email){
  try {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (!error) return null;
    const m = String(error.message || "");
    if (error.status === 429 || /rate limit|too many|seconds/i.test(m)) return "för många mejl har skickats den senaste timmen. Vänta en stund och tryck Skicka länk igen.";
    if (/signups not allowed|not allowed/i.test(m)) return "nya konton är avstängda i Supabase – bjud in via Authentication → Users → Invite user.";
    return m;
  } catch (e) { return e.message || "okänt fel"; }
}

// ---------- Senaste i köket (aktivitet) och "Nytt" ----------
let activityOpen = false, activitySeenBefore = null, activityTab = null;
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
function seenAt(){ const v = +LS("seen:" + me); if (v) return v; const now = Date.now(); LS("seen:" + me, String(now)); return now; }
function setSeen(t){ LS("seen:" + me, String(t)); }
function firstUse(){ const v = +LS("first:" + me); if (v) return v; const now = Date.now(); LS("first:" + me, String(now)); return now; }
function openedSet(){ try { return new Set(JSON.parse(LS("opened:" + me) || "[]")); } catch { return new Set(); } }
function markOpened(id){ const s = openedSet(); if (s.has(id)) return; s.add(id); LS("opened:" + me, JSON.stringify([...s].slice(-500))); }
function isNewForMe(r){
  if (!me || addedByOf(r) === me) return false;
  const t = Date.parse(r.createdAt || "") || 0;
  return t > firstUse() && !openedSet().has(r.id);
}
const AV_COLORS = ["#5c1a24", "#9c7a3c", "#2f4a3c", "#3d4f6b", "#6b3d5c", "#7a5a2f", "#365e63"];
function avColor(email){ let h = 0; for (const c of String(email)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
const avHtml = (email, cls = "av") => `<span class="${cls}" style="background:${avColor(email)}" title="${esc(nameOf(email))}">${esc((nameOf(email) || "?")[0].toUpperCase())}</span>`;
function relDay(ts){
  const d = new Date(ts), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff <= 0) return "idag";
  if (diff === 1) return "igår";
  const wd = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"][d.getDay()];
  if (diff < 7) return wd;
  const dm = d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "");
  return `${wd} ${dm}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
}
function activityEvents(){
  const ev = [];
  for (const r of recipes) {
    const by = addedByOf(r), t = Date.parse(r.createdAt || "");
    if (t) {
      const base = r.variantOf ? recipes.find(x => x.id === r.variantOf) : null;
      ev.push({ ts: t, by, r, kind: r.variantOf ? "variant" : "added", base });
    }
    const hist = histOf(r);
    for (const c of cookLogOf(r)) {
      const ts = Date.parse(c.at || "") || Date.parse((c.date || "") + "T18:00:00") || 0;
      if (!ts) continue;
      const h = hist.find(x => x.date === c.date && (x.by || OWNER).toLowerCase() === (c.by || "").toLowerCase());
      ev.push({ ts, by: (c.by || "").toLowerCase(), r, kind: "cooked", rating: h && h.rating, note: h && h.note });
    }
  }
  return ev.sort((a, b) => b.ts - a.ts);
}
function activityHtml(){
  if (!me || filter.q || filter.tags.length || filter.fav || filter.mine || filter.cookedMe || filterOpen) return "";
  const ev = activityEvents();
  if (!ev.length) return "";
  const seen = activityOpen && activitySeenBefore != null ? activitySeenBefore : seenAt();
  const isNew = e => e.by !== me && e.ts > seen;
  const newCount = activityOpen ? 0 : ev.filter(isNew).length;
  const who = []; for (const e of ev) { if (!who.includes(e.by)) who.push(e.by); if (who.length === 3) break; }
  const verb = e => e.kind === "added" ? "lade till" : e.kind === "variant" ? "gjorde en variant av" : "lagade";
  const nm = e => e.by === me ? "Du" : esc(nameOf(e.by));
  const title = e => esc(e.kind === "variant" && e.base ? e.base.title : e.r.title || "Namnlöst recept");
  const latest = ev[0];
  const added = ev.filter(e => e.kind !== "cooked"), cooked = ev.filter(e => e.kind === "cooked");
  if (!activityTab) activityTab = !added.some(isNew) && cooked.some(isNew) ? "cooked" : "added";
  const pool = activityTab === "cooked" ? cooked : added;
  const items = pool.slice(0, activityOpen === "all" ? 25 : 6);
  const nAdded = added.filter(isNew).length, nCooked = cooked.filter(isNew).length;
  return `<div class="act ${activityOpen ? "open" : ""}">
    <button class="act-row" data-a="acttoggle" aria-expanded="${!!activityOpen}">
      <span class="avs">${who.map(e => avHtml(e)).join("")}</span>
      <span class="lab">Senaste i köket</span>
      <span class="latest">– <b>${nm(latest)}</b> ${verb(latest)} ${title(latest)} · ${relDay(latest.ts)}</span>
      ${newCount ? `<span class="new">${newCount} ${newCount === 1 ? "ny" : "nya"}</span>` : ""}
      <span class="chev" aria-hidden="true">▼</span>
    </button>
    ${activityOpen ? `<div class="act-tabs" role="tablist">
        <button role="tab" class="${activityTab === "added" ? "on" : ""}" data-a="acttab" data-t="added">Nya recept${nAdded ? `<span class="tn">${nAdded}</span>` : ""}</button>
        <button role="tab" class="${activityTab === "cooked" ? "on" : ""}" data-a="acttab" data-t="cooked">Senast lagade${nCooked ? `<span class="tn">${nCooked}</span>` : ""}</button>
      </div>
      <div class="act-list">${items.length ? "" : `<p class="hnote" style="padding:12px 0">${activityTab === "cooked" ? "Inga tillagningar loggade än – tryck Lagad idag i ett recept." : "Inga recept än."}</p>`}${items.map(e => `
      <div class="fitem" data-a="open" data-id="${esc(e.r.id)}">
        <span class="nd ${isNew(e) ? "" : "old"}"></span>${avHtml(e.by)}
        <span class="tx"><i>${nm(e)} ${verb(e)}</i> <b>${title(e)}</b>${e.rating ? ` <span class="st">${"★".repeat(e.rating)}</span>` : ""}${e.note ? `<span class="note">”${esc(e.note)}”</span>` : ""}</span>
        <span class="when">${relDay(e.ts)}</span>
        ${e.r.photo ? `<img src="${esc(e.r.photo)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
      </div>`).join("")}
      ${pool.length > items.length ? `<button class="linkbtn act-more" data-a="actmore">Visa fler</button>` : ""}
    </div>` : ""}
  </div>`;
}

// ---------- varianter: namn efter skillnaderna och variantrad ----------
const familyRoot = r => { let x = r, n = 0; while (x && x.variantOf && n++ < 5) { const b = recipes.find(y => y.id === x.variantOf); if (!b) break; x = b; } return x; };
function familyOf(r){
  const root = familyRoot(r);
  const kids = recipes.filter(x => x.id !== root.id && familyRoot(x) && familyRoot(x).id === root.id)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return { root, kids };
}
function variantLabel(v){
  if (v.variantName) return v.variantName;
  const { kids } = familyOf(v);
  const same = kids.filter(k => !k.variantName && addedByOf(k) === addedByOf(v));
  const n = same.length > 1 ? " " + (same.indexOf(v) + 1) : "";
  return genitive(nameOf(addedByOf(v))) + " variant" + n;
}
const variantBadge = v => v.variantName ? `Variant: ${v.variantName}` : variantLabel(v);
function variantSwitcher(r){
  const { root, kids } = familyOf(r);
  if (!kids.length) return r.variantOf ? `<div class="vswitch"><span class="hnote">Variant av ett borttaget recept</span></div>` : "";
  // namnge äldre varianter utan namn (bara den som får ändra dem)
  kids.forEach(k => { if (canEdit(k) && (!k.variantName || !Array.isArray(k.variantSummary) || k.variantSummaryFor !== variantSig(k))) nameVariant(k.id); });
  const chip = (x, label, who) => `<button class="vchip ${x.id === r.id ? "on" : ""}" ${x.id === r.id ? 'aria-current="true"' : `data-a="open" data-id="${esc(x.id)}"`}>${esc(label)}${who ? `<small>${esc(who)}</small>` : ""}</button>`;
  return `<div class="vswitch" role="tablist" aria-label="Varianter">
    <span class="vlab">Varianter</span>
    ${chip(root, "Original", nameOf(addedByOf(root)))}
    ${kids.map(k => chip(k, variantLabel(k), nameOf(addedByOf(k)))).join("")}
  </div>`;
}
const namingNow = new Set(), namingTried = new Set();
async function nameVariant(id, force){
  const v = recipes.find(x => x.id === id);
  const needsSummary = v && v.variantOf && (!Array.isArray(v.variantSummary) || v.variantSummaryFor !== variantSig(v));
  if (!v || !v.variantOf || namingNow.has(id) || (!force && ((v.variantName && !needsSummary) || namingTried.has(id))) || !canEdit(v)) return;
  namingTried.add(id);
  namingNow.add(id);
  const { root, kids } = familyOf(v);
  if (!root || root.id === v.id) return;
  const base = v.original && ((v.original.ingredients || []).length || (v.original.steps || []).length) ? v.original : root;
  try {
    const others = kids.filter(k => k.id !== id && k.variantName).map(k => k.variantName);
    const fmt = x => `Portioner: ${x.servings || "-"}\nIngredienser:\n${(x.ingredients || []).join("\n")}\nSteg:\n${(x.steps || []).join("\n")}`;
    const prompt = `Två versioner av samma recept, "${root.title}". Jämför VARIANTEN med GRUNDRECEPTET.
1) "name": ett kort svenskt namn på varianten (1–3 ord, högst 24 tecken) som beskriver den viktigaste skillnaden, t.ex. "Extra stark", "Utan grädde", "Med lax", "Dubbel sats", "Vegetarisk".${others.length ? ` Andra varianter heter redan: ${others.join(", ")} – välj ett namn som skiljer sig.` : ""} Om det inte finns någon tydlig skillnad: "Egen version".
2) "summary": 1–4 korta punkter på svenska med de VIKTIGASTE skillnaderna som påverkar smak, resultat eller arbetsgång, t.ex. "Crème fraiche i stället för grädde", "Dubbelt så mycket vitlök", "Ugnen 200° i stället för 175°", "Marinera över natten". Hoppa över småsaker som stavning och ordval.
Svara bara med JSON: {"name": "...", "summary": ["...", "..."]}

GRUNDRECEPTET:
${fmt(base)}

VARIANTEN:
${fmt(v)}`;
    const out = parseJson(await ai(prompt, { mode: "json" }));
    let name = String(out.name || "").replace(/["”“'.*]/g, "").trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);
    const summary = (Array.isArray(out.summary) ? out.summary : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
    const upd = { variantSummary: summary, variantSummaryFor: variantSig(v) };
    if (name && name.length <= 30 && (force || !v.variantName || v.variantNameAuto)) { upd.variantName = name; upd.variantNameAuto = true; }
    if (await patch(id, upd)) { if (view.name === "detail" || view.name === "list") render(); }
  } catch {} finally { namingNow.delete(id); }
}

// Spara ändringar i ett grundrecept: som ny variant (standard) eller i originalet
function askVariantOrOriginal(base){
  openSheet(`<h2>Spara ändringarna</h2>
    <p>Du har ändrat ingredienser, steg eller portioner i <b>${esc(base.title || "receptet")}</b>.</p>
    <div class="savechoice">
      <button class="btn accent" id="scVar">Spara som ny variant</button>
      <p class="hnote">Originalet lämnas orört. Varianten får ett namn efter skillnaderna och syns i raden Varianter.</p>
      <button class="btn ghost" id="scOrig">Ändra originalet</button>
      <p class="hnote">För rättelser, t.ex. ett felstavat ord eller en mängd som blev fel vid importen.</p>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost small" id="scNo">Avbryt</button></div>`);
  $id("scNo").onclick = closeSheet;
  $id("scOrig").onclick = () => { closeSheet(); draft.myChanges = ""; const b = document.getElementById("savebtn"); b.dataset.force = "1"; b.click(); delete b.dataset.force; };
  $id("scVar").onclick = async () => {
    $id("scVar").disabled = true;
    const v = JSON.parse(JSON.stringify(draft));
    ["id", "createdAt", "updatedAt", "history", "cookLog", "favBy", "favorite", "rating", "timesCooked", "lastCooked", "addedBy", "variantName", "variantNameAuto", "_fillIn"].forEach(k => delete v[k]);
    v.variantOf = base.id;
    v.original = { servings: base.servings || null, ingredients: base.ingredients || [], steps: base.steps || [] };
    v.photo = draft.photo || base.photo || null;
    const id = await saveRecipe(v);
    closeSheet();
    if (!id) { toast("Kunde inte spara varianten"); return; }
    nameVariant(id, true);
    draft = null; markOpened(id);
    detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null };
    view = { name: "detail", id }; render(); window.scrollTo(0, 0);
    toast("Sparad som ny variant – originalet är orört");
  };
}

// ---------- tillagning: börja laga, fortsätt, timers ----------
const PAN_SVG = `<svg class="panico" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="13" cy="17" r="9"/><circle cx="13" cy="17" r="5.5" opacity=".45"/><path d="M21.5 13.5 29 7"/><path d="M10 5.5c.6-1 .6-2 0-3M14 5.5c.6-1 .6-2 0-3" opacity=".7"/></svg>`;
let cookSession = null;
const COOK_KEY = () => "cook:" + (me || "");
function loadCook(){ try { cookSession = JSON.parse(localStorage.getItem(COOK_KEY()) || "null"); } catch { cookSession = null; } if (cookSession && loaded && !recipes.find(r => r.id === cookSession.recipeId)) cookSession = null; }
function saveCook(){ try { cookSession ? localStorage.setItem(COOK_KEY(), JSON.stringify(cookSession)) : localStorage.removeItem(COOK_KEY()); } catch {} }
function startCooking(r){
  if (cookSession && cookSession.recipeId !== r.id) {
    const other = recipes.find(x => x.id === cookSession.recipeId);
    if (other && !confirm(`Du lagar redan ${other.title}. Vill du avsluta den och börja med ${r.title}?`)) return;
  }
  cookSession = { recipeId: r.id, startedAt: Date.now(), servings: detailState.servings ?? r.servings ?? null, done: detailState.done || {}, timers: [] };
  saveCook();
  wakeWanted = true;
  detailState.tab = "ing";
  render(); syncWakeLock();
  toast("Smaklig tillagning! Skärmen hålls tänd.");
}
function endCooking(){
  (cookSession && cookSession.timers || []).forEach(t => sb.rpc("recipe_timer_cancel", { p_id: t.id }).then(() => {}, () => {}));
  cookSession = null; saveCook(); wakeWanted = false; syncWakeLock();
}
function openCookRecipe(){
  if (!cookSession) return;
  const r = recipes.find(x => x.id === cookSession.recipeId); if (!r) { endCooking(); render(); return; }
  if (!(view.name === "detail" && view.id === r.id)) {
    detailState = { mode: "mine", servings: cookSession.servings ?? null, done: cookSession.done || {}, tab: "steps", notesEdit: false, notesDraft: null };
    view = { name: "detail", id: r.id }; render();
  } else { detailState.tab = "steps"; render(); }
  setTimeout(() => { const n = document.querySelector(".nextstep") || document.getElementById("cook"); if (n) n.scrollIntoView({ block: "center", behavior: "smooth" }); }, 60);
}
function resumeCooking(){
  loadCook();
  if (!cookSession) return;
  const r = recipes.find(x => x.id === cookSession.recipeId); if (!r) { endCooking(); return; }
  wakeWanted = true;
  if (view.name === "list") {
    openCookRecipe();
    const steps = r.steps || []; const real = steps.filter(x => !x.startsWith("#"));
    const done = steps.filter((x, i) => !x.startsWith("#") && (cookSession.done || {})["s" + i]).length;
    toast(`Välkommen tillbaka – du lagar ${r.title}${real.length ? `, steg ${Math.min(done + 1, real.length)} av ${real.length}` : ""}`);
  } else { render(); syncWakeLock(); }
}

// Tider i stegen: "15 min", "1 h", "1,5 timme", "10–12 minuter", "30 sek", "en halvtimme", "två timmar", "1½ h"
const NUMWORDS = { en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12, femton: 15, tjugo: 20, trettio: 30, fyrtio: 40, femtio: 50, sextio: 60, nittio: 90 };
function parseDurations(text){
  const out = [];
  let t = String(text).replace(/(\d)\s*½/g, "$1,5").replace(/½/g, "0,5")
    .replace(/\b(en|ett)\s+halv(?:\s+)?timme\b/gi, "30 min").replace(/\bhalvtimme\b/gi, "30 min")
    .replace(/\b(en|ett)\s+kvart\b/gi, "15 min").replace(/\bkvart\b/gi, "15 min")
    .replace(/\b(en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv|femton|tjugo|trettio|fyrtio|femtio|sextio|nittio)\s+(minuter|minut|min|timmar|timme|tim|sekunder|sek)\b/gi, (m, w, u) => NUMWORDS[w.toLowerCase()] + " " + u);
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:[-–]|till)\s*(\d+(?:[.,]\d+)?))?\s*(minuter|minut|min|timmar|timme|tim|h|sekunder|sek)(?![a-zåäö])/gi;
  let m;
  while ((m = re.exec(t)) && out.length < 3) {
    const v = parseFloat((m[2] || m[1]).replace(",", ".")), u = m[3].toLowerCase();
    const ms = u.startsWith("s") ? v * 1e3 : /^(h|tim)/.test(u) ? v * 36e5 : v * 6e4;
    if (ms >= 1e4 && ms <= 48 * 36e5 && !out.some(o => o.ms === ms)) out.push({ ms, label: m[0].trim() });
  }
  return out;
}
function timerButtons(text, i, n){
  return parseDurations(text).map(d => `<button class="timerbtn" data-a="timer" data-ms="${d.ms}" data-k="s${i}" data-label="Steg ${n}: ${esc(d.label)}">⏱ ${esc(d.label)}</button>`).join("");
}
function startTimer(ms, label, k){
  if (!cookSession) return;
  cookSession.timers = (cookSession.timers || []).filter(t => !t.rung);
  const t = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label, k, end: Date.now() + ms, total: ms };
  cookSession.timers.push(t);
  saveCook(); renderCookBar(); toast(`Timer startad: ${label}`);
  const r = recipes.find(x => x.id === cookSession.recipeId);
  pushTimer(t, r);
}
// Sätt timer: förslag från receptets tider, snabbval eller egen tid
function openTimerSheet(){
  if (!cookSession) return;
  const r = recipes.find(x => x.id === cookSession.recipeId); if (!r) return;
  const steps = r.steps || []; let n = 0; const sugg = [];
  steps.forEach((x, i) => { if (x.startsWith("#")) return; n++; parseDurations(x).forEach(d => sugg.push({ ms: d.ms, k: "s" + i, label: `Steg ${n}: ${d.label}`, step: n, text: x.replace(/\s+/g, " ").trim() })); });
  const fmt = ms => { const m = Math.round(ms / 6e4); return ms < 6e4 ? Math.round(ms / 1e3) + " sek" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : m + " min"; };
  const short = x => x.length > 90 ? x.slice(0, 88) + "…" : x;
  openSheet(`<h2>Sätt timer</h2>
    ${sugg.length ? `<h3 class="ts-h">Från receptet</h3><div class="ts-list">${sugg.map((t, j) => `<button class="ts-sugg" data-j="${j}"><b>${esc(fmt(t.ms))}</b><span><small>Steg ${t.step}</small>${esc(short(t.text))}</span></button>`).join("")}</div>` : `<p class="hnote">Receptet anger inga tider – välj eller skriv in en egen.</p>`}
    <h3 class="ts-h">Egen tid</h3>
    <div class="ts-quick">${[1, 3, 5, 10, 15, 20, 30, 45, 60].map(m => `<button class="ftag" data-m="${m}">${m < 60 ? m + " min" : "1 h"}</button>`).join("")}</div>
    <div class="ts-own"><label><input id="tsH" type="number" inputmode="numeric" min="0" max="48" placeholder="0"> tim</label><label><input id="tsM" type="number" inputmode="numeric" min="0" max="59" placeholder="0"> min</label></div>
    <label class="ts-name">Vad gäller det? <input id="tsName" type="text" placeholder="t.ex. Ugnen, Potatisen"></label>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="tsClose">Avbryt</button><button class="btn accent" id="tsGo">Starta timer</button></div>`);
  const start = (ms, label, k) => { closeSheet(); startTimer(ms, label, k); };
  document.querySelectorAll(".ts-sugg").forEach(b => b.onclick = () => { const t = sugg[+b.dataset.j]; start(t.ms, t.label, t.k); });
  document.querySelectorAll(".ts-quick [data-m]").forEach(b => b.onclick = () => { const m = +b.dataset.m; $id("tsH").value = m >= 60 ? Math.floor(m / 60) : ""; $id("tsM").value = m % 60 || ""; document.querySelectorAll(".ts-quick .ftag").forEach(x => x.classList.toggle("on", x === b)); });
  $id("tsClose").onclick = closeSheet;
  $id("tsGo").onclick = () => {
    const ms = ((+$id("tsH").value || 0) * 60 + (+$id("tsM").value || 0)) * 6e4;
    if (ms < 6e4) { toast("Ange en tid först"); $id("tsM").focus(); return; }
    const name = $id("tsName").value.trim();
    start(ms, `${name || "Egen timer"}: ${fmt(ms)}`, "");
  };
}
function stopTimer(id){
  if (!cookSession) return;
  cookSession.timers = (cookSession.timers || []).filter(t => t.id !== id); saveCook(); renderCookBar();
  sb.rpc("recipe_timer_cancel", { p_id: id }).then(() => {}, () => {});
}

// Pushnotis när timern går ut, även om appen är stängd (servern skickar den)
async function ensurePush(){
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission === "default" && await Notification.requestPermission() !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = (window.APP_CONFIG || {}).vapidPublicKey;
    if (!key) return "unsupported";
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    const { error } = await sb.rpc("recipe_push_save", { p_sub: sub.toJSON() });
    return error ? "error" : "ok";
  } catch { return "error"; }
}
const b64ToU8 = b => { const p = "=".repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };
let pushHinted = false;
async function pushTimer(t, r){
  const st = await ensurePush();
  if (st !== "ok") {
    if (!pushHinted) {
      pushHinted = true;
      const d = deviceInfo();
      if (st === "unsupported" && d.kind === "ios" && !d.installed) toast("Lägg appen på hemskärmen så kan timern ringa även när appen är stängd");
      else if (st === "denied") toast("Tillåt notiser för appen så ringer timern även när appen är stängd");
    }
    return;
  }
  // Tydlig text: vad som är klart och vad som kommer sedan
  const steps = (r && r.steps) || [];
  const idx = t.k ? +String(t.k).slice(1) : -1;
  const short = x => { x = String(x || "").replace(/\s+/g, " ").trim(); return x.length > 70 ? x.slice(0, 68) + "…" : x; };
  const stepText = idx >= 0 && steps[idx] ? short(steps[idx]) : t.label;
  let next = ""; for (let j = idx + 1; j < steps.length; j++) if (!steps[j].startsWith("#")) { next = short(steps[j]); break; }
  const title = `⏰ KLART: ${stepText}`;
  const body = `${r ? r.title : ""}${next ? `\nNästa: ${next}` : ""}`;
  const { error } = await sb.rpc("recipe_timer_set", { p_id: t.id, p_fire_at: new Date(t.end).toISOString(), p_title: title, p_body: body, p_url: "/" + (r ? "#r=" + r.id : "") });
  if (error && !pushHinted) { pushHinted = true; console.warn("timer push", error.message); }
}
const fmtLeft = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
function renderCookBar(){
  let bar = document.getElementById("cookbar");
  if (!cookSession && me) loadCook();
  const appEl = document.getElementById("app");
  const show = cookSession && me && view.name !== "edit" && appEl && !appEl.classList.contains("hidden");
  if (!show) { if (bar) bar.remove(); document.body.classList.remove("has-cookbar"); return; }
  const r = recipes.find(x => x.id === cookSession.recipeId); if (!r) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "cookbar"; bar.className = "cookbar"; document.body.appendChild(bar); }
  document.body.classList.add("has-cookbar");
  const steps = r.steps || [], real = steps.filter(x => !x.startsWith("#"));
  const done = steps.filter((x, i) => !x.startsWith("#") && (cookSession.done || {})["s" + i]).length;
  const timers = (cookSession.timers || []).slice().sort((a, b) => a.end - b.end);
  bar.innerHTML = `<button class="cb-main" data-a="cookbar"><span class="pan" aria-hidden="true">${PAN_SVG}</span><span class="t"><span>Lagar nu${real.length ? ` · steg ${Math.min(done + 1, real.length)}/${real.length}` : ""}</span><b>${esc(r.title || "")}</b></span></button>
    <button class="tm tm-add" data-a="timernew" aria-label="Sätt timer">+ ⏱</button>
    ${timers.map(t => `<button class="tm ${t.end <= Date.now() ? "ring" : ""}" data-a="timerstop" data-id="${t.id}" title="${esc(t.label)} – tryck för att stänga av"><span data-end="${t.end}">${t.end <= Date.now() ? "Klar!" : "⏱ " + fmtLeft(t.end - Date.now())}</span></button>`).join("")}`;
}
let audioCtx = null;
function beep(){
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(.25, audioCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + d + .3); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + .3); });
  } catch {}
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch {}
}
setInterval(() => {
  if (!cookSession || !(cookSession.timers || []).length) return;
  let rang = false;
  for (const t of cookSession.timers) {
    if (t.end <= Date.now() && !t.rung) {
      t.rung = true; rang = true; beep(); toast(`⏰ Klart: ${t.label}`);
      if (document.visibilityState === "visible") sb.rpc("recipe_timer_cancel", { p_id: t.id }).then(() => {}, () => {});
      try { if (document.hidden && Notification.permission === "granted") new Notification("Timern är klar", { body: t.label, icon: "/icon-192.png" }); } catch {}
    }
  }
  if (rang) { saveCook(); renderCookBar(); }
  document.querySelectorAll("#cookbar [data-end]").forEach(el => { const left = +el.dataset.end - Date.now(); el.textContent = left <= 0 ? "Klar!" : "⏱ " + fmtLeft(left); el.parentElement.classList.toggle("ring", left <= 0); });
}, 1000);
document.addEventListener("click", () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch {} }, { once: true });

// Kommer man tillbaka till appen efter att timern ringt: sluta påminna via notiser
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !cookSession) return;
  (cookSession.timers || []).filter(t => t.end <= Date.now()).forEach(t => sb.rpc("recipe_timer_cancel", { p_id: t.id }).then(() => {}, () => {}));
  try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch {}
});

// ---------- verktyg: lägg in tidsangivelser i befintliga recept ----------
function openTimesTool(){
  const list = recipes.filter(r => canEdit(r) && (r.steps || []).some(x => !x.startsWith("#")));
  const withTimer = list.filter(r => (r.steps || []).some(x => parseDurations(x).length));
  openSheet(`<h2>Tider i stegen</h2>
    <p>Claude går igenom dina recept och skriver in tider med siffror i stegen (t.ex. "15 min", "1 h"), så att de får timerknappar. Bara tider som redan står i receptet – i stegen, under Tid eller i anteckningarna – förs in. Inget annat ändras.</p>
    <p class="hnote">${list.length} recept att gå igenom, varav ${withTimer.length} redan har minst en timer. Det tar ungefär ${Math.max(1, Math.round(list.length * 6 / 60))} min. Varje ändrat recept kan ångras.</p>
    <div id="ttList" class="ttlist"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="ttClose">Stäng</button><button class="btn accent" id="ttGo">Starta</button></div>`);
  let stop = false;
  $id("ttClose").onclick = () => { stop = true; closeSheet(); };
  $id("ttGo").onclick = async () => {
    $id("ttGo").disabled = true; $id("ttGo").textContent = "Arbetar …";
    const box = $id("ttList"); let changed = 0;
    for (const r of list) {
      if (stop || !$id("ttList")) return;
      const row = document.createElement("div"); row.className = "ttrow";
      row.innerHTML = `<span class="spinner"></span> ${esc(r.title || "")}`; box.prepend(row);
      try {
        const res = await addTimesToRecipe(r);
        if (res.changed) {
          changed++;
          row.innerHTML = `<b>✓ ${esc(r.title || "")}</b> <span class="hnote">${res.added} tider inlagda</span> <button class="linkbtn" data-undo="${esc(r.id)}">Ångra</button>`;
        } else row.innerHTML = `<span class="hnote">– ${esc(r.title || "")}: inga tider att lägga till</span>`;
      } catch (e) { row.innerHTML = `<span class="err">! ${esc(r.title || "")}: ${esc(aiErr(e))}</span>`; }
    }
    if ($id("ttGo")) { $id("ttGo").textContent = `Klart – ${changed} recept fick tider`; }
  };
  $id("ttList").addEventListener("click", async e => {
    const b = e.target.closest("[data-undo]"); if (!b) return;
    const r = recipes.find(x => x.id === b.dataset.undo); if (!r || !r.stepsBeforeTimes) return;
    if (await patch(r.id, { steps: r.stepsBeforeTimes, stepsBeforeTimes: null })) { b.replaceWith(Object.assign(document.createElement("span"), { className: "hnote", textContent: "ångrat" })); }
  });
}
async function addTimesToRecipe(r){
  const before = (r.steps || []).slice();
  const prompt = `Här är ett recept. Uppgift: skriv in tidsangivelser i stegen så att varje tid står med siffror och enhet (t.ex. "15 min", "1 h", "1,5 h", "10–12 min", "30 sek").

Regler:
- Ändra ENDAST tidsangivelser. Behåll varje steg ordagrant i övrigt, samma antal steg i samma ordning, rubriker som börjar med "# " oförändrade.
- Skriv om tider i ord till siffror ("en halvtimme" → "30 min", "ett par timmar" → "2 h").
- För in en tid i ett steg bara om receptet själv anger den (i stegen, i fältet Tid eller i anteckningarna) och det tydligt framgår vilket steg den hör till. Hitta aldrig på tider.
- Svara bara med JSON: {"steps": [...], "changed": true/false}

Titel: ${r.title || ""}
Tid: ${r.time || "-"}
Anteckningar: ${(r.notes || "-").slice(0, 1500)}
Steg:
${JSON.stringify(before)}`;
  const out = parseJson(await ai(prompt, { mode: "json" }));
  const steps = Array.isArray(out.steps) ? out.steps.map(x => String(x).trim()) : null;
  if (!steps || steps.length !== before.length) return { changed: false, added: 0 };
  // säkerhetskontroll: rubriker orörda och inga stora omskrivningar
  for (let i = 0; i < steps.length; i++) {
    if (before[i].startsWith("#") && steps[i] !== before[i]) return { changed: false, added: 0 };
    if (steps[i].length > before[i].length + 40 || steps[i].length < before[i].length * 0.6) return { changed: false, added: 0 };
  }
  const count = arr => arr.reduce((n, x) => n + parseDurations(x).length, 0);
  const added = count(steps) - count(before);
  if (sameList(steps, before) || added <= 0) return { changed: false, added: 0 };
  const ok = await patch(r.id, { steps, stepsBeforeTimes: before });
  return { changed: !!ok, added };
}

// ---------- ändringar i en variant: AI-sammanfattning + exakt jämförelse ----------
const variantSig = v => { const t = JSON.stringify([v.servings || null, v.ingredients || [], v.steps || []]); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); };
const ingKey = l => String(l).toLowerCase().replace(/^[\d\s.,½¼¾\/–-]+/, "").replace(/^(ca|cirka|ungefär)\s+/, "").replace(/^(st|g|kg|hg|ml|cl|dl|l|msk|tsk|krm|nypa|knippe|klyftor|klyfta|burk|paket|förp|skivor|skiva|port)\.?\s+/, "").replace(/[(),].*$/, "").trim();
function variantDiff(v){
  const root = familyRoot(v);
  const base = v.original && ((v.original.ingredients || []).length || (v.original.steps || []).length) ? v.original : root;
  const bi = (base.ingredients || []).filter(x => !x.startsWith("#")), vi = (v.ingredients || []).filter(x => !x.startsWith("#"));
  let removed = bi.filter(x => !vi.includes(x)), added = vi.filter(x => !bi.includes(x));
  const changed = [];
  for (const a of added.slice()) {
    const k = ingKey(a); const m = removed.find(r => ingKey(r) === k && k);
    if (m) { changed.push([m, a]); removed = removed.filter(r => r !== m); added = added.filter(x => x !== a); }
  }
  const bs = (base.steps || []).filter(x => !x.startsWith("#")), vs = (v.steps || []).filter(x => !x.startsWith("#"));
  const stepsAdded = vs.filter(x => !bs.includes(x)), stepsRemoved = bs.filter(x => !vs.includes(x));
  const serv = (base.servings || null) !== (v.servings || null) && base.servings && v.servings ? [base.servings, v.servings] : null;
  return { added, removed, changed, stepsAdded, stepsRemoved, serv };
}
function variantChangesHtml(r){
  const d = variantDiff(r);
  const sum = Array.isArray(r.variantSummary) && r.variantSummaryFor === variantSig(r) ? r.variantSummary : null;
  const nothing = !d.added.length && !d.removed.length && !d.changed.length && !d.stepsAdded.length && !d.stepsRemoved.length && !d.serv;
  if (nothing && !r.myChanges) return "";
  const li = (cls, sign, txt) => `<li class="${cls}"><span class="sg">${sign}</span>${txt}</li>`;
  const details = `
    ${d.serv ? `<p class="vd-h">Portioner</p><ul class="vdiff">${li("chg", "↺", `${d.serv[0]} → ${d.serv[1]}`)}</ul>` : ""}
    ${d.changed.length || d.added.length || d.removed.length ? `<p class="vd-h">Ingredienser</p><ul class="vdiff">
      ${d.changed.map(([a, b]) => li("chg", "↺", `<s>${esc(a)}</s> → ${esc(b)}`)).join("")}
      ${d.added.map(x => li("add", "+", esc(x))).join("")}
      ${d.removed.map(x => li("rem", "−", `<s>${esc(x)}</s>`)).join("")}</ul>` : ""}
    ${d.stepsAdded.length || d.stepsRemoved.length ? `<p class="vd-h">Gör så här</p><ul class="vdiff">
      ${d.stepsAdded.map(x => li("add", "+", esc(x))).join("")}
      ${d.stepsRemoved.map(x => li("rem", "−", `<s>${esc(x)}</s>`)).join("")}</ul>` : ""}`;
  return `<div class="panel mychanges vchanges"><h2>Ändringar i varianten</h2>
    ${sum && sum.length ? `<ul class="vsum">${sum.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : !nothing ? `<p class="hnote">${canEdit(r) ? "Sammanfattar ändringarna …" : "Jämfört med originalet:"}</p>` : ""}
    ${!nothing ? (sum && sum.length ? `<details class="vd-more"><summary>Visa alla ändringar</summary>${details}</details>` : details) : ""}
    ${r.myChanges ? `<p class="vd-h">Anteckning</p><div class="prewrap">${esc(r.myChanges)}</div>` : ""}
  </div>`;
}

// ---------- filtrering på nyckelord ----------
function filterBtn(cls){
  return `<button class="fbtn ${cls} ${filterOpen ? "open" : ""}" data-a="ftoggle" aria-expanded="${filterOpen}">Filtrera${filter.tags.length ? `<span class="n">${filter.tags.length}</span>` : ""}<span class="chev" aria-hidden="true">▾</span></button>`;
}
function filterPanelHtml(list){
  const count = t => filter.tags.includes(t) ? list.length : list.filter(r => (r.tags || []).includes(t)).length;
  const used = new Set(recipes.flatMap(r => r.tags || []));
  const other = [...used].filter(t => !tagVocab().includes(t)).sort((a, b) => a.localeCompare(b, "sv"));
  const groups = tagGroups();   // ord utanför listan ligger hopfällt under Övrigt
  const btn = t => { const n = count(t), on = filter.tags.includes(t); return `<button class="ftag ${on ? "on" : ""} ${!n && !on ? "dim" : ""}" data-a="tag" data-t="${esc(t)}" ${!n && !on ? "disabled" : ""}>${esc(t)}<small>${n}</small></button>`; };
  return `<div class="fpanel" role="dialog" aria-label="Filtrera">
    <div class="fp-head"><h3>Filtrera</h3><button class="iconbtn fp-x" data-a="fclose" aria-label="Stäng">×</button></div>
    ${groups.map(([g, ts]) => [g, ts.filter(t => used.has(t) || filter.tags.includes(t))]).filter(([, ts]) => ts.length).map(([g, ts]) => `<div class="fgrp"><div class="fgt">${esc(g)}</div><div class="ftags">${ts.map(btn).join("")}</div></div>`).join("") || `<p class="hnote" style="padding:12px 0">Inga nyckelord än. Kör Konto → Städa nyckelord, så sorteras recepten in.</p>`}
    ${other.length ? (() => { const open = filterMore || other.some(t => filter.tags.includes(t)); return `<div class="fmore"><button class="fmore-btn" data-a="fmore" aria-expanded="${open}">Övrigt <small>${other.length}</small><svg class="chev${open ? " up" : ""}" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${open ? `<div class="ftags">${other.map(btn).join("")}</div>` : ""}</div>`; })() : ""}
    <div class="fp-foot"><button class="linkbtn" data-a="tagclear">Rensa allt</button><button class="btn accent small" data-a="fclose">Visa ${list.length} recept</button></div>
  </div>`;
}

// ---------- verktyg: sortera in recepten i de fasta nyckelorden ----------
function openTagsTool(){
  const list = recipes.filter(r => canEdit(r));
  const used = new Set(recipes.flatMap(r => r.tags || []));
  const odd = [...used].filter(t => !tagVocab().includes(t));
  openSheet(`<h2>Städa nyckelord</h2>
    <p>Claude går igenom ${list.length} recept och ger vart och ett 2–4 nyckelord från de fasta orden (Rätt, Mattyp, Tillfälle, Metod). Dubbletter och udda ord försvinner.</p>
    <p class="hnote">I dag finns ${used.size} olika nyckelord, varav ${odd.length} utanför listan${odd.length ? `: ${esc(odd.slice(0, 14).join(", "))}${odd.length > 14 ? " …" : ""}` : ""}. Taggen "att komplettera" behålls. Allt kan ångras.</p>
    <div id="tgList" class="ttlist"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="tgClose">Stäng</button><button class="btn accent" id="tgGo">Starta</button></div>`);
  let stop = false; const done = [];
  $id("tgClose").onclick = () => { stop = true; closeSheet(); };
  $id("tgGo").onclick = async () => {
    const go = $id("tgGo"); go.disabled = true; go.textContent = "Arbetar …";
    const box = $id("tgList");
    for (let i = 0; i < list.length; i += 8) {
      if (stop || !$id("tgList")) return;
      const batch = list.slice(i, i + 8);
      const row = document.createElement("div"); row.className = "ttrow"; row.innerHTML = `<span class="spinner"></span> Recept ${i + 1}–${i + batch.length} av ${list.length}`; box.prepend(row);
      try {
        const prompt = `Ge varje recept 2–4 nyckelord, ENBART från listan nedan (exakt stavning, gemener). Välj typ av rätt, mattyp, tillfälle och metod när det passar. ${TAG_HINTS} "vardag" för enkla vardagsrätter, "långkok" för sådant som tar flera timmar. Hitta inte på nya ord.
Lista: ${tagVocab().join(", ")}
Svara bara med JSON: {"<id>": ["...", "..."], ...}

Recept:
${JSON.stringify(batch.map(r => ({ id: r.id, titel: r.title, tid: r.time || "", nuvarande: r.tags || [], ingredienser: (r.ingredients || []).filter(x => !x.startsWith("#")).slice(0, 10) })))}`;
        const out = parseJson(await ai(prompt, { mode: "json" }));
        const lines = [];
        for (const r of batch) {
          let tags = Array.isArray(out[r.id]) ? out[r.id].map(x => String(x).toLowerCase().trim()).filter(x => tagVocab().includes(x)) : null;
          if (!tags || !tags.length) { lines.push(`– ${esc(r.title || "")}: oförändrad`); continue; }
          tags = [...new Set(tags)].slice(0, 4);
          if ((r.tags || []).includes("att komplettera")) tags.push("att komplettera");
          if (sameList(tags, r.tags || [])) { lines.push(`– ${esc(r.title || "")}: redan rätt`); continue; }
          if (await patch(r.id, { tags, tagsBefore: r.tags || [] })) { done.push(r.id); lines.push(`✓ <b>${esc(r.title || "")}</b> <span class="hnote">${esc(tags.join(", "))}</span>`); }
        }
        row.innerHTML = lines.join("<br>");
      } catch (e) { row.innerHTML = `<span class="err">! ${esc(aiErr(e))}</span>`; }
    }
    if ($id("tgGo")) {
      go.textContent = `Klart – ${done.length} recept uppdaterade`;
      if (done.length) box.insertAdjacentHTML("afterbegin", `<div class="ttrow"><button class="linkbtn" id="tgUndo">Ångra alla ändringar</button></div>`);
      const u = $id("tgUndo"); if (u) u.onclick = async () => {
        u.disabled = true; u.textContent = "Ångrar …";
        for (const id of done) { const r = recipes.find(x => x.id === id); if (r && Array.isArray(r.tagsBefore)) await patch(id, { tags: r.tagsBefore, tagsBefore: null }); }
        u.textContent = "Ångrat";
      };
    }
  };
}

// ---------- nyckelord: välj i formuläret ----------
function tagPickHtml(sel){
  const vocab = tagVocab();
  const extra = sel.filter(t => !vocab.includes(t));
  return tagGroups().concat(extra.length ? [["Övrigt", extra]] : []).map(([g, ts]) => `<div class="tp-grp"><span class="tp-g">${esc(g)}</span>${ts.map(t => `<button type="button" class="ftag ${sel.includes(t) ? "on" : ""}" data-tp="${esc(t)}">${esc(t)}</button>`).join("")}</div>`).join("");
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-tp]"); if (b && $id("tagsField")) {
    const f = $id("tagsField"); let cur = f.value.split(",").map(x => x.trim()).filter(Boolean);
    const t = b.dataset.tp; cur = cur.includes(t) ? cur.filter(x => x !== t) : cur.concat(t);
    f.value = cur.join(", "); b.classList.toggle("on", cur.includes(t)); return;
  }
  if (e.target.id === "newTagBtn" && $id("tagsField")) {
    const t = ($id("newTag").value || "").trim().toLowerCase(); if (!t) return;
    const f = $id("tagsField"); const cur = f.value.split(",").map(x => x.trim()).filter(Boolean);
    if (!cur.includes(t)) cur.push(t);
    f.value = cur.join(", "); $id("tagPick").innerHTML = tagPickHtml(cur); $id("newTag").value = "";
  }
});

// ---------- nyckelord: spara listan ----------
async function saveTagGroups(groups){
  const clean = groups.map(([g, ts]) => [String(g).trim(), [...new Set(ts.map(t => String(t).trim().toLowerCase()).filter(Boolean))]]).filter(([g, ts]) => g && ts.length);
  const { error } = await sb.from("recipes").upsert({ id: SETTINGS_ID, data: { settings: true, groups: clean, addedBy: me, updatedAt: new Date().toISOString() } });
  if (error) { toast("Kunde inte spara nyckelorden: " + error.message); return false; }
  customTagGroups = clean; return true;
}

// ---------- Konto → Nyckelord: redigera listan ----------
function openTagEditor(){
  let groups = JSON.parse(JSON.stringify(tagGroups()));
  const used = {}; recipes.forEach(r => (r.tags || []).forEach(t => used[t] = (used[t] || 0) + 1));
  const draw = () => {
    const vocab = groups.flatMap(g => g[1]);
    const other = Object.keys(used).filter(t => !vocab.includes(t) && t !== "att komplettera").sort((a, b) => used[b] - used[a]);
    $id("teBody").innerHTML = groups.map(([g, ts], gi) => `<div class="te-grp"><div class="te-gh"><input value="${esc(g)}" data-gname="${gi}"><button class="linkbtn" data-gdel="${gi}" title="Ta bort gruppen">Ta bort</button></div>
      <div class="ftags">${ts.map((t, ti) => `<span class="ftag te-t">${esc(t)}<small>${used[t] || 0}</small><button data-tdel="${gi}:${ti}" aria-label="Ta bort ${esc(t)}">×</button></span>`).join("")}
      <span class="te-add"><input placeholder="+ nytt" data-tadd="${gi}"></span></div></div>`).join("")
      + `<button class="linkbtn" id="teAddGroup" style="margin-top:10px">+ Ny grupp</button>`
      + (other.length ? `<p class="vd-h" style="margin-top:18px">Används men finns inte i listan (Övrigt)</p><div class="ftags">${other.map(t => `<span class="ftag">${esc(t)}<small>${used[t]}</small></span>`).join("")}</div><p class="hnote">Kör "Slå ihop nyckelord" för att sortera in dem.</p>` : "");
  };
  openSheet(`<h2>Nyckelord</h2><p class="hnote">Grupper och nyckelord som visas under Filtrera och när du redigerar ett recept. Skriv ett nytt ord i "+ nytt" och tryck Enter.</p>
    <div id="teBody"></div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="teNo">Avbryt</button><button class="btn accent" id="teSave">Spara</button></div>`);
  draw();
  const body = $id("teBody");
  body.addEventListener("click", e => {
    const d = e.target.closest("[data-tdel]"); if (d) { const [gi, ti] = d.dataset.tdel.split(":").map(Number); groups[gi][1].splice(ti, 1); draw(); return; }
    const g = e.target.closest("[data-gdel]"); if (g) { groups.splice(+g.dataset.gdel, 1); draw(); return; }
    if (e.target.id === "teAddGroup") { groups.push(["Ny grupp", []]); draw(); const ins = body.querySelectorAll("[data-gname]"); ins[ins.length - 1].select(); }
  });
  body.addEventListener("keydown", e => {
    const a = e.target.closest("[data-tadd]"); if (!a || e.key !== "Enter") return;
    e.preventDefault(); const t = a.value.trim().toLowerCase(); if (!t) return;
    const gi = +a.dataset.tadd; groups.forEach(gr => gr[1] = gr[1].filter(x => x !== t)); groups[gi][1].push(t); draw();
    const n = body.querySelector(`[data-tadd="${gi}"]`); if (n) n.focus();
  });
  body.addEventListener("input", e => { const n = e.target.closest("[data-gname]"); if (n) groups[+n.dataset.gname][0] = n.value; });
  $id("teNo").onclick = closeSheet;
  $id("teSave").onclick = async () => {
    body.querySelectorAll("[data-tadd]").forEach(a => { const t = a.value.trim().toLowerCase(); if (t) groups[+a.dataset.tadd][1].push(t); });
    if (await saveTagGroups(groups)) { closeSheet(); toast("Nyckelorden är sparade"); render(); }
  };
}

// ---------- Slå ihop nyckelord: ~30 % av dagens antal, i grupper ----------
function openMergeTool(){
  const used = {}; recipes.forEach(r => (r.tags || []).forEach(t => { if (t !== "att komplettera") used[t] = (used[t] || 0) + 1; }));
  const all = Object.keys(used).sort((a, b) => used[b] - used[a]);
  const target = Math.max(6, Math.round(all.length * 0.3));
  openSheet(`<h2>Slå ihop nyckelord</h2>
    <p>I dag används <b>${all.length}</b> olika nyckelord. Claude slår ihop dem till ungefär <b>${target}</b> (30 %), sorterade i grupper, och föreslår vilket nytt ord varje gammalt blir. Du ser förslaget innan något ändras.</p>
    <div id="mgBody"><div class="ftags">${all.map(t => `<span class="ftag">${esc(t)}<small>${used[t]}</small></span>`).join("")}</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="mgNo">Stäng</button><button class="btn accent" id="mgGo">Föreslå</button></div>`);
  $id("mgNo").onclick = closeSheet;
  let plan = null;
  $id("mgGo").onclick = async () => {
    const go = $id("mgGo");
    if (plan) return applyMerge(plan, go);
    go.disabled = true; go.textContent = "Tänker …";
    try {
      const prompt = `Här är nyckelorden i en familjs receptbok, med antal recept per ord. Slå ihop dem till ungefär ${target} nyckelord (högst ${target + 2}) som är lätta att filtrera på, och sortera dem i 3–5 grupper med korta svenska gruppnamn (t.ex. "Rätt", "Mattyp", "Tillfälle", "Metod"). Slå ihop synonymer och närliggande ord (t.ex. nötkött → kött, snacks → tilltugg). Välj vanliga, tydliga ord i gemener. Varje gammalt ord ska mappas till ETT nytt ord, eller till null om det inte passar alls.
Svara bara med JSON: {"groups": [{"name": "...", "tags": ["..."]}], "map": {"<gammalt ord>": "<nytt ord eller null>"}}

Nyckelord: ${JSON.stringify(used)}`;
      const out = parseJson(await ai(prompt, { mode: "json" }));
      const groups = (out.groups || []).map(g => [String(g.name || "").trim(), (g.tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean)]).filter(g => g[0] && g[1].length);
      const vocab = groups.flatMap(g => g[1]);
      const map = {}; for (const t of all) { const m = out.map && out.map[t]; map[t] = m && vocab.includes(String(m).toLowerCase()) ? String(m).toLowerCase() : (vocab.includes(t) ? t : null); }
      plan = { groups, map };
      const cnt = {}; recipes.forEach(r => new Set((r.tags || []).map(t => map[t]).filter(Boolean)).forEach(t => cnt[t] = (cnt[t] || 0) + 1));
      $id("mgBody").innerHTML = `<p class="hnote">Förslag: ${vocab.length} nyckelord i ${groups.length} grupper. Siffran är antal recept efter sammanslagningen.</p>`
        + groups.map(([g, ts]) => `<div class="fgrp"><div class="fgt">${esc(g)}</div><div class="ftags">${ts.map(t => `<span class="ftag">${esc(t)}<small>${cnt[t] || 0}</small></span>`).join("")}</div></div>`).join("")
        + `<details class="vd-more" style="margin-top:10px"><summary>Visa vad varje gammalt ord blir</summary><ul class="vdiff">${all.map(t => `<li><span class="sg">→</span>${esc(t)} → <b>${esc(map[t] || "tas bort")}</b></li>`).join("")}</ul></details>`;
      go.disabled = false; go.textContent = "Använd förslaget";
    } catch (e) { go.disabled = false; go.textContent = "Försök igen"; toast(aiErr(e)); }
  };
}
async function applyMerge(plan, go){
  go.disabled = true; go.textContent = "Uppdaterar …";
  if (!(await saveTagGroups(plan.groups))) { go.disabled = false; go.textContent = "Använd förslaget"; return; }
  let n = 0;
  for (const r of recipes) {
    const old = r.tags || [];
    const next = [...new Set(old.map(t => t === "att komplettera" ? t : plan.map[t]).filter(Boolean))].slice(0, 6);
    if (!sameList(next, old) && canEdit(r)) { if (await patch(r.id, { tags: next, tagsBefore: old })) n++; }
  }
  closeSheet(); render(); toast(`Klart – ${n} recept uppdaterade med de nya nyckelorden`);
}
