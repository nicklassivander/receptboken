
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
  const mine = list.find(r => me && r.id === "_cook_" + String(me).toLowerCase());
  if (mine) pendingRemoteCook = mine;
  return list.filter(r => r.id !== SETTINGS_ID && !String(r.id).startsWith("_cook_"));
}
let pendingRemoteCook = null;
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
  if (pendingRemoteCook) { const d = pendingRemoteCook; pendingRemoteCook = null; applyRemoteCook(d.cook ? d : null); }
  else if (me) { if (!cookSession) loadCook(); if (cookSession) saveCook(); }   // första gången: lägg upp pågående matlagning
}
let subscribed = false;
function subscribe(){
  if (subscribed) return; subscribed = true;
  sb.channel("recept")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, p => {
      if (p.eventType === "DELETE") { if (String(p.old.id || "").startsWith("_cook_")) return; recipes = recipes.filter(r => r.id !== p.old.id); }
      else if (p.new.id === SETTINGS_ID) { customTagGroups = (p.new.data || {}).groups || null; }
      else if (String(p.new.id).startsWith("_cook_")) { if (me && p.new.id === "_cook_" + String(me).toLowerCase()) applyRemoteCook(p.new.data); return; }
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
  // nya recept (inte drinkar) visas i sidhuvudet som standard
  if (!id && body.hdr === undefined && !isDrink(body)) body.hdr = true;
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
  const gone = recipes.find(r => r.id === id);
  const { error } = await sb.from("recipes").delete().eq("id", id);
  if (error) { toast("Kunde inte radera"); return false; }
  recipes = recipes.filter(r => r.id !== id);
  logEvent("delete", gone || { id });
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
      body: JSON.stringify({ messages: typeof messages === "string" ? [{ role: "user", content: messages }] : messages, images: opts.images || [], mode: opts.mode || "text", web: !!opts.web, fetchUrl: opts.fetchUrl || undefined, fast: !!opts.fast }) });
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
let navFromPop = false, inAppSteps = 0, histIdx = 0;
try { history.scrollRestoration = "manual"; } catch {}
const viewKey = v => v.name + ":" + (v.id || "");
function viewHash(v){
  if (v.name === "detail") return "#r=" + v.id;
  if (v.name === "edit") return v.id ? "#e=" + v.id : "#ny";
  if (v.name === "help") return "#hjalp";
  if (v.name === "bar") return "#baren";
  return " ";
}
function syncHistory(){
  if (navFromPop) { navFromPop = false; return; }
  const cur = history.state && history.state.v;
  const v = { name: view.name, id: view.id || null };
  if (!cur) { history.replaceState({ v, i: histIdx }, "", viewHash(v).trim() || location.pathname); return; }
  if (viewKey(cur) === viewKey(v)) return;
  // Efter att ha sparat ett recept: ersätt redigeringsläget i historiken
  if (cur.name === "edit" && v.name === "detail") { history.replaceState({ v, i: histIdx }, "", viewHash(v)); return; }
  // Kom ihåg var på sidan man var, så att Tillbaka hamnar på samma ställe
  history.replaceState({ ...history.state, y: window.scrollY }, "");
  history.pushState({ v, i: ++histIdx }, "", viewHash(v).trim() || location.pathname);
  inAppSteps++;
}
window.addEventListener("popstate", e => {
  const st = e.state || {};
  const v = st.v || { name: "list" };
  const goingBack = (st.i ?? 0) < histIdx;
  histIdx = st.i ?? 0;
  const sameView = viewKey(v) === viewKey({ name: view.name, id: view.id || null });
  // Tillbaka med en ruta öppen: stäng bara rutan
  if (sheetIsOpen()) { closeSheet(true); if (sameView) { inAppSteps = Math.max(0, inAppSteps - 1); return; } }
  // Överhoppad post (en ruta som stängts med ×): gå vidare i samma riktning
  if (st.dup) { inAppSteps = Math.max(0, inAppSteps - 1); goingBack ? history.back() : history.forward(); return; }
  if (st.sheet && sameView) return;
  if (v.name === "edit" && !draft) { view = v.id ? { name: "detail", id: v.id } : { name: "list" }; }
  else view = v.id ? { name: v.name, id: v.id } : { name: v.name };
  if (view.name !== "edit") draft = null;
  menuOpen = false;
  inAppSteps = Math.max(0, inAppSteps - 1);
  navFromPop = true;
  render();
  const y = st.y || 0;
  window.scrollTo(0, y);
  if (y) setTimeout(() => window.scrollTo(0, y), 60);   // bilder kan ladda in och flytta sidan
});
function goBack(){
  if (inAppSteps > 0) history.back();
  else { view = { name: "list" }; draft = null; render(); window.scrollTo(0, 0); }
}
function render(){
  setTimeout(renderCookBar, 0);
  $app.classList.toggle("wide", view.name === "list" || view.name === "bar");
  syncHistory();
  syncWakeLock();
  try { barTheme(); } catch {}
  if (view.name === "bar") return renderBar();
  if (view.name === "detail") { logView(view.id); if (barIsDrinkView()) return renderDrink(recipes.find(x => x.id === view.id)); return renderDetail(); }
  if (view.name === "edit") return renderEdit();
  if (view.name === "help") return renderHelp();
  if (view.name === "web") return renderWebPreview();
  renderList();
}

function filtered(){
  const q = filter.q.trim().toLowerCase();
  let list = recipes.filter(r => {
    if (!q && !filter.tags.includes("dryck") && isDrink(r)) return false;   // drinkarna bor i baren (men syns när man söker)
    if (filter.fav && !isFav(r)) return false;
    if (filter.mine && addedByOf(r) !== me) return false;
    if (filter.by && addedByOf(r) !== filter.by) return false;
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
  // Behåll fokus i sökfältet när listan ritas om (t.ex. när Claudes svar kommer)
  const qa = document.activeElement && document.activeElement.id === "q" ? document.activeElement.selectionStart : null;
  if (qa != null) setTimeout(() => { const n = document.getElementById("q"); if (n && document.activeElement !== n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(qa, qa); } catch {} } }, 0);

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
    body = (aiSearch && aiSearch.q === filter.q.trim()) || (sample && filter.q.trim().length >= 2) ? "" : `<div class="empty"><p>Inga recept matchar.</p><button class="btn ghost small" data-a="clear">Rensa filter</button></div>`;
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
    <header class="top"><a class="brand" href="#" data-a="home" aria-label="Till alla recept"><img src="logo.svg" alt="" class="logo"><h1><span class="t-sv">Sivander's</span> <i class="t-gl"></i><span class="t-rp">Recept</span>${recipes.length ? (() => { const nNew = recipes.filter(isNewForMe).length; return `<span class="rcount"><b>${recipes.filter(x => !isDrink(x)).length || recipes.length}</b><span>recept</span>${nNew ? `<i class="rc-dot"></i><em>+${nNew} ${nNew === 1 ? "ny" : "nya"}</em>` : ""}</span>`; })() : ""}</h1></a>
      <span class="row"><button class="iconbtn" data-a="help" aria-label="Hjälp och instruktioner">Hjälp</button><button class="iconbtn" data-a="settings" aria-label="Konto och inställningar">Konto${pendingReqs ? `<span class="dotcount">${pendingReqs}</span>` : ""}</button></span></header>
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
    ${barCardHtml()}
    ${aiBarHtml(list)}
    ${nfAskHtml()}
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
    ${filter.tags.length || filter.by ? `<div class="activetags">${filter.by ? `<button data-a="fby" data-e="">Lagt till av ${esc(nameOf(filter.by))} <b aria-hidden="true">×</b></button>` : ""}${filter.tags.map(t => `<button data-a="tag" data-t="${esc(t)}">${esc(t)} <b aria-hidden="true">×</b></button>`).join("")}<button class="linkbtn" data-a="tagclear">Rensa</button></div>` : ""}` : ""}
    ${aiSearchHtml(list)}
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
    q.addEventListener("input", e => {
      filter.q = e.target.value; const pos = e.target.selectionStart; renderList(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos);
      // Pappa (kostar) frågas bara med knapparna – inget automatiskt
    });
    // Enter/Sök på tangentbordet: stäng bara tangentbordet så träffarna syns
    q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
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
      ${r.photo && canEdit(r) ? `<button class="hdrpick ${r.hdr ? "on" : ""}" data-a="hdrpick" aria-pressed="${r.hdr ? "true" : "false"}" title="${r.hdr ? "Visas i sidhuvudet – tryck för att ta bort" : "Visa bilden i sidhuvudet på startsidan"}"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M3 9h18"/><path d="M7.5 15.5l3-3 2.5 2 2-1.5 2.5 2.5"/></svg><span>${r.hdr ? "I sidhuvudet" : "Till sidhuvudet"}</span></button>` : ""}
      <div class="hero-cap">
        <div class="row">${sourceBadge(r)}${isModified(r) ? `<span class="badge mod">Min version</span>` : ""}
          ${(r.tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join("")}</div>
        <h1 class="dtitle">${esc(r.title || "Namnlöst recept")}</h1>
      </div>
      ${r.photo && r.photoCredit && r.photoCredit.name ? `<a class="photo-credit" href="${esc(r.photoCredit.page || r.photoCredit.url || "https://www.pexels.com")}" target="_blank" rel="noopener">Foto: ${esc(r.photoCredit.name)} / ${esc(r.photoCredit.src || "Pixabay")}</a>` : ""}
    </div>
    ${!r.photo && canEdit(r) ? `<div id="imgsug" class="imgsug" data-id="${esc(r.id)}">${imgSugInner(r)}</div>` : ""}
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
    ${cs ? `<div class="cooking-head"><span class="pan" aria-hidden="true">${PAN_SVG}</span><span class="ct"><b>Du lagar det här</b><small>sedan ${new Date(cs.startedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}${detailState.servings ? ` · ${detailState.servings} portioner` : ""}</small></span><span class="cr"><button class="timeradd" data-a="timernew" aria-label="Sätt timer">⏱ Timer</button><button class="linkbtn" data-a="cookdone">Klar!</button><button class="linkbtn muted" data-a="cookstop">Avbryt</button></span>${(() => { const real = steps.map((x, i) => [x, i]).filter(([x]) => !x.startsWith("#")); const d = real.filter(([, i]) => detailState.done["s" + i]).length; return real.length ? `<div class="cookprog" title="${d} av ${real.length} steg klara"><i style="width:${Math.round(d / real.length * 100)}%"></i></div>` : ""; })()}
      <label class="cooknote"><span>Anteckningar medan du lagar</span><textarea id="cookNote" rows="2" placeholder="t.ex. tog 2 vitlöksklyftor extra, 10 min längre i ugnen – sparas när du trycker Klar!">${esc(cs.notes || "")}</textarea></label></div>`
      : `<div class="startcook">${me ? `<button class="cookbtn shopbtn" data-a="shop"><svg class="panico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5h17l-1.6 9a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5 11 4M16 9.5 13 4"/><path d="M9 13v4M12 13v4M15 13v4"/></svg><span>Handla</span></button>` : ""}<button class="cookbtn" data-a="cookstart">${PAN_SVG}<span>Börja laga</span></button></div>`}

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
          : `<li><span>${esc(scaleLine(l, f))}</span></li>`).join("")}</ul>`
        : `<p class="meta">Inga ingredienser ifyllda.</p>`}
    </div>

    <div class="panel cpane cp-steps">
      <h2>Gör så här</h2>
      ${steps.length ? `<ol class="steps">${(() => { let n = 0; return steps.map((s, i) => s.startsWith("#")
          ? (n = 0, `<li class="group">${esc(s.replace(/^#+\s*/, ""))}</li>`)
          : `<li class="${detailState.done["s" + i] ? "done" : ""}${cs && i === nextIdx ? " nextstep" : ""}" data-n="${++n}" data-a="tick" data-k="s${i}"><span class="sbox" role="checkbox" aria-checked="${!!detailState.done["s" + i]}" aria-label="Steg ${n} klart"></span>${esc(s)}${cs ? timerButtons(s, i, n) : ""}</li>`).join(""); })()}</ol>`
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

    ${isDrink(r) ? notesPanelHtml(r, Object.assign({}, NOTE_BAR_OPTS, { title: "Tips", cls: "" })) : notesPanelHtml(r)}

    ${historyHtml(r)}

    ${can("contributor") ? `<div class="panel ai">
      <h2>Fråga kocken och sommelieren</h2>
      <div class="aiq-btns">
        <button class="aiq" data-a="ai" data-q="wine"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-.5 5.5a3.5 3.5 0 0 1-7 0z"/><path d="M8.2 6.5h7.6"/><path d="M12 12v8M8.5 20.5h7"/></svg>Vilket vin passar?</button>
        <button class="aiq" data-a="ai" data-q="sides"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="3.8"/><path d="M3 4v6a1.6 1.6 0 0 0 1.6 1.6M4.6 4v16M21 4c-1.8.8-2 6-.4 7.2V20"/></svg>Vad serverar jag till?</button>
      </div>
      <form class="ai-ask" id="ai-form"><textarea id="ai-input" rows="1" enterkeyhint="send" placeholder="Fråga eller ändra något i receptet – byt ingredienser, ändra portioner eller fråga om vin …" autocomplete="off"></textarea><button class="ask-btn" type="submit"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><path d="M10 12.8a1.6 1.6 0 1 1 2.3 1.4c-.5.3-.8.7-.8 1.2v.4"/><path d="M11.5 17.6h.01"/></svg>Fråga Pappa</button></form>
      <div id="ai-out">${aiOutHtml(r.id)}</div>
    </div>` : ""}

    <div class="actions tiles">
      ${can("contributor") ? actTile("histadd", "note", "Ny tillagning") : ""}
      ${canEdit(r) ? `${actTile("pickdish", "photo", r.photo ? "Byt bild" : "Lägg till bild")}${actTile("edit", "pencil", "Redigera")}` : ""}
      ${can("contributor") ? actTile("variant", "variant", addedByOf(r) === me ? "Gör en variant" : "Gör min egen variant") : ""}
      ${me ? actTile("shop", "basket", "Inköpslista") : ""}
      ${actTile("copy", "copy", "Kopiera")}
    </div>
    ${canEdit(r) ? `<div class="actions-del"><button class="linkbtn del-link" data-a="del">Radera receptet</button></div>` : ""}
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

      ${Array.isArray(d.noteItems) ? "" : `<label>Anteckningar</label>
      <textarea name="notes" rows="3" placeholder="Tips, vin till, vad gästerna tyckte …">${esc(d.notes)}</textarea>`}

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
  if (f.elements.notes) draft.notes = v("notes").trim();
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

// Pappa tänker: huvud med kockmössa, kugghjul som snurrar och tankevågor som pulserar
const THINK_SVG = `<svg class="think-ico" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><g class="tk-gear"><circle cx="11.5" cy="14.5" r="2.3" fill="currentColor" fill-opacity=".18"/><circle cx="11.5" cy="14.5" r=".8"/><path d="M11.5 10.9v1.3M11.5 16.8v1.3M7.9 14.5h1.3M13.8 14.5h1.3M9 12l.9.9M13.1 16.1l.9.9M9 17l.9-.9M13.1 12.9l.9-.9"/></g><path class="tk-w1" d="M20 5.5c.6-.6.6-1.4 0-2"/><path class="tk-w2" d="M21.8 6.5c1-1 1-2.6 0-3.6"/></svg>`;

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
// "Pappa har tänkt klart": samma huvud, kugghjulet har blivit en glödlampa som tänds
function IDEA_SVG(fresh){
  return `<svg class="idea-ico${fresh ? " fresh" : ""}" viewBox="0 0 24 24" width="52" height="52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><g class="id-bulb"><path class="id-fill" d="M11.5 11a2.6 2.6 0 0 0-1.5 4.7v1h3v-1A2.6 2.6 0 0 0 11.5 11z" fill="currentColor" fill-opacity=".3"/><path d="M10.4 18h2.2"/></g><g class="id-rays"><path d="M20.5 4.5l1.4-1.4M20.8 7.5h1.8M19.5 2.2V1"/></g></svg>`;
}
// Medan pappa tänker byts statustexten var 3,5 s så en lång väntan känns levande
const AW_LINES = ["Pappa tänker …", "Pappa smakar av …", "Pappa rör i grytan …", "Pappa kollar med mamma …", "Pappa kliar sig i huvudet …", "Pappa låter det puttra …"];
function awLines(wine){ return wine ? [AW_LINES[0], "Sommeliern provsmakar …", ...AW_LINES.slice(1)] : AW_LINES; }
function awText(t0, wine){ const l = awLines(wine); return l[Math.floor((Date.now() - t0) / 3500) % l.length]; }
setInterval(() => {
  document.querySelectorAll(".aw-s[data-t0]").forEach(el => {
    const t = awText(+el.dataset.t0, el.dataset.wine === "1");
    if (t === el.textContent || el.classList.contains("swap")) return;
    el.classList.add("swap");
    setTimeout(() => { el.textContent = t; el.classList.remove("swap"); }, 350);
  });
}, 500);
function aiOutHtml(id){
  const items = aiState[id] || [];
  return items.map((it, i) => {
    const links = !it.busy && it.a ? recipes.filter(x => x.id !== id && x.title && it.a.toLowerCase().includes(x.title.toLowerCase())) : [];
    // Medan pappa tänker står frågan under ikonen; när svaret kommit står frågan överst som vanligt
    // Medan pappa tänker: frågan bredvid ikonen, "Pappa tänker" som liten status under
    if (!it._t0) it._t0 = Date.now();
    const wait = `<div class="ai-wait">${THINK_SVG}<div><div class="aw-q">${esc(it.q)}</div><div class="aw-s" data-t0="${it._t0}" data-wine="${/vin|dryck|öl\b|sommelier/i.test(it.q || "") ? 1 : 0}">${awText(it._t0, /vin|dryck|öl\b|sommelier/i.test(it.q || ""))}</div></div></div>`;
    if (it.busy && !it.a && !it.err) return wait;
    if (!it.err && !it.a) return wait;
    if (it.err) return `<div class="ai-q">${esc(it.q)}</div><div class="ai-a"><span class="err">${esc(it.err)}</span></div>`;
    // Klart: lampan till vänster, svaret bredvid, frågan under svaret. Lampan tänds bara första gången svaret visas.
    const fresh = !it._lit; it._lit = true;
    return `<div class="ai-row">${IDEA_SVG(fresh)}<div class="ai-body">
      ${it.deep ? `<div class="deep-head">Pappa har funderat lite till</div>` : ""}
      <div class="ai-a">${aiMd(it.a)}</div>
      <div class="ai-q under">${esc(it.q)}${it.deep ? " · pappa funderade lite till" : ""}</div>
      ${aiModelHtml(it, i)}
      ${aiDeepHtml(it, i)}
      ${links.length ? `<div class="chips" style="padding-top:4px">${links.map(x => `<button class="chip" data-a="open" data-id="${esc(x.id)}">${esc(x.title)}</button>`).join("")}</div>` : ""}
      ${!it.busy && it.check ? `<div class="aic-check ${it.check.level}"><b>${it.check.level === "warn" ? "⚠ Tänk på" : "💡 Tips"}</b> ${esc(it.check.text)}</div>` : ""}
      ${!it.busy && it.change && !it.dismissed ? (() => { const rr = recipes.find(x => x.id === id); return rr ? `<div class="aic">
        <div class="aic-h">Föreslagen ändring${it.change.summary ? `<span>${esc(it.change.summary)}</span>` : ""}</div>
        ${changeLines(rr, it.change)}
        <div class="aic-btns"><button class="btn accent small" data-a="aiapply" data-i="${i}">${canEdit(rr) ? "Använd ändringen" : "Gör min egen variant med ändringen"}</button><button class="linkbtn" data-a="aidismiss" data-i="${i}">Nej tack</button></div>
      </div>` : ""; })() : ""}
      ${!it.busy && it.a && !it.change && canEdit(recipes.find(x => x.id === id)) ? `<div class="ai-tools"><button class="btn ghost small" data-a="aisave" data-i="${i}">Spara i anteckningar</button></div>` : ""}
      </div></div>`;
  }).reverse().join("");
}
function aiRefresh(id){ const el = document.getElementById("ai-out"); if (el && view.id === id) el.innerHTML = aiOutHtml(id); }

// Snabbknapparna är rena frågor → Haiku. sonnet = true när någon trycker "Pappa, fundera lite till".
async function askAI(r, kind, freeText, sonnet){
  if (!sample) return;
  const items = aiState[r.id] || (aiState[r.id] = []);
  if (items.some(x => x.busy)) return;
  const q = kind ? AI_PRESETS[kind].label : freeText;
  const item = { q, a: "", busy: true, err: "", kind, model: sonnet ? "sonnet" : "haiku", deep: !!sonnet };
  items.push(item); aiRefresh(r.id);

  const others = kind === "similar"
    ? "\n\nMIN RECEPTBOK (övriga recept):\n" + recipes.filter(x => x.id !== r.id).map(x => `- ${x.title}${(x.tags || []).length ? " [" + x.tags.join(", ") + "]" : ""}`).join("\n")
    : "";
  const context = `Du är en erfaren kock och sommelier som hjälper en svensk hemmakock. Svara på svenska, konkret och utan inledning eller artighetsfraser. Använd korta punktlistor där det passar och håll dig under 180 ord. Hitta inte på fakta om specifika produkter.

RECEPTET:
${recipeText(r)}${r.notes ? "\n\nANTECKNINGAR: " + r.notes : ""}${others}`;
  const history = items.slice(0, -1).filter(x => x.a && !x.err && !(sonnet && x.q === q)).slice(-3);
  // Rebuild a short conversation so follow-up questions have context.
  const convo = [];
  history.forEach((h, i) => { convo.push({ role: "user", content: (i === 0 ? context + "\n\nFRÅGA: " : "") + h.q }); convo.push({ role: "assistant", content: h.a }); });
  const ask = (kind ? AI_PRESETS[kind].prompt : freeText) + (sonnet ? "\n\nFundera lite till: ge ett grundligare och mer genomtänkt svar än en snabb första tanke." : "");
  convo.push({ role: "user", content: (convo.length ? "" : context + "\n\nFRÅGA: ") + ask });

  try {
    item.a = await ai(convo, { fast: !sonnet });
  } catch (e) {
    item.err = aiErr(e);
  }
  item.busy = false; aiRefresh(r.id);
}

// Fråga eller ändra: Haiku svarar på rena frågor. Ser Haiku en ändring (eller "kan jag byta X mot Y?")
// lämnas den över till Sonnet, som avgör, gör ändringen och kontrollerar den. sonnet = true hoppar över Haiku.
async function askOrEdit(r, text, sonnet){
  if (!sample) return;
  const items = aiState[r.id] || (aiState[r.id] = []);
  if (items.some(x => x.busy)) return;
  const item = { q: text, a: "", busy: true, err: "", model: sonnet ? "sonnet" : "haiku", deep: !!sonnet };
  items.push(item); aiRefresh(r.id);
  const current = { title: r.title, servings: r.servings || null, time: r.time || "", ingredients: r.ingredients || [], steps: r.steps || [] };
  const earlier = items.slice(0, -1).filter(x => x.a && !x.err && !(sonnet && x.q === text)).slice(-3).map(x => `F: ${x.q}\nS: ${x.a}`).join("\n\n");
  const recipeCtx = `RECEPTET:
${JSON.stringify(current)}${r.notes ? "\nANTECKNINGAR: " + r.notes : ""}${earlier ? "\n\nTIDIGARE I SAMTALET:\n" + earlier : ""}

ANVÄNDAREN SKRIVER:
${text}`;
  if (!sonnet) {
    const triage = `Du är en erfaren kock och sommelier som hjälper en svensk hemmakock med ett recept. Svara på svenska, konkret och utan artighetsfraser.
Avgör vad användaren vill:
- En ren fråga om receptet (vin, tillbehör, frysa, hållbarhet, teknik, vad något betyder …): svara kort, max 150 ord, gärna punktlista.
- Användaren vill ändra receptet (byta, ta bort, lägga till, skala om, fler/färre portioner, dela upp steg …) eller frågar om en möjlig ändring ("kan jag byta X mot Y?", "går det utan Z?"): svara INTE, skriv bara {"typ": "ändring"}.
Är du osäker, välj "ändring".
Svara ENDAST med JSON: {"typ": "fråga", "svar": "svaret"} eller {"typ": "ändring"}

${recipeCtx}`;
    try {
      const out = parseJson(await ai(triage, { mode: "json", fast: true }));
      const svar = String(out.svar || "").trim();
      if (out.typ === "fråga" && svar) { item.a = svar; item.busy = false; aiRefresh(r.id); return; }
    } catch (e) {
      if (e && (e.code === "auth" || e.code === "network" || e.code === "rate")) { item.err = aiErr(e); item.busy = false; aiRefresh(r.id); return; }
    }
    item.model = "haiku>sonnet";   // ändring, oklart svar eller trasig JSON → Sonnet tar över
  }
  const prompt = `Du är en erfaren kock och sommelier som hjälper en svensk hemmakock med ett recept. Svara på svenska, konkret och utan artighetsfraser.
Avgör vad användaren vill:
- "fråga": en fråga om receptet (vin, tillbehör, frysa, teknik …). Svara kort, max 150 ord, gärna punktlista.
- "ändring": användaren vill ändra receptet (byta, ta bort, lägga till, skala om, dela upp steg …). Gör exakt den ändringen och behåll allt annat ordagrant. Justera mängder, steg och tid när ändringen kräver det.
- "båda": en fråga om en möjlig ändring ("kan jag byta X mot Y?"). Svara på frågan OCH föreslå ändringen.
Bedöm alltid en ändring: om den kan misslyckas, bli osäker (t.ex. för låg temperatur eller kort tid för kött/fågel, rå fisk) eller krockar med något i receptet → "kontroll" med nivå "varning". Om den fungerar men kan göras bättre → nivå "tips". Annars null. Var sparsam, inget tjat.
Svara ENDAST med JSON:
{"typ": "fråga"|"ändring"|"båda", "svar": "svaret på frågan, eller en mening om vad du ändrade", "ändring": null eller {"title": string, "servings": number|null, "time": string, "ingredients": [string], "steps": [string], "summary": "kort mening om vad som ändrats"}, "kontroll": null eller {"nivå": "varning"|"tips", "text": "max 2 meningar"}}
Regler för ändring: ingredienser en per rad, mängd först; steg utan numrering; rubriker börjar med "# "; tider i stegen med siffror och enhet (t.ex. "15 min").

${recipeCtx}${sonnet ? "\n\n(Användaren bad dig fundera lite till: ge ett grundligare och mer genomtänkt svar än en snabb första tanke.)" : ""}`;
  try {
    const out = parseJson(await ai(prompt, { mode: "json" }));
    item.a = String(out.svar || "").trim() || (out["ändring"] ? "Här är ändringen." : "");
    const ch = out["ändring"];
    if (ch && Array.isArray(ch.ingredients) && Array.isArray(ch.steps)) item.change = ch;
    const k = out.kontroll;
    if (k && k.text) item.check = { level: k["nivå"] === "varning" ? "warn" : "tip", text: String(k.text) };
    if (!item.a && !item.change) throw { code: "invalid_json" };
  } catch (e) { item.err = aiErr(e); }
  item.busy = false; aiRefresh(r.id);
}
// Vilka rader ändras: borttagna och tillagda ingredienser/steg
function changeLines(r, ch){
  const diff = (a, b) => ({ gone: a.filter(x => !b.includes(x)), added: b.filter(x => !a.includes(x)) });
  const i = diff(r.ingredients || [], ch.ingredients || []), s = diff(r.steps || [], ch.steps || []);
  const row = (cls, t) => `<li class="${cls}">${esc(String(t).replace(/^#\s*/, ""))}</li>`;
  const part = (lbl, d) => d.gone.length || d.added.length ? `<div class="aic-part"><small>${lbl}</small><ul>${d.gone.map(t => row("gone", t)).join("")}${d.added.map(t => row("add", t)).join("")}</ul></div>` : "";
  const meta = [];
  if (ch.servings && +ch.servings !== +(r.servings || 0)) meta.push(`Portioner: ${r.servings || "–"} → ${ch.servings}`);
  if (ch.time && ch.time !== (r.time || "")) meta.push(`Tid: ${r.time || "–"} → ${ch.time}`);
  if (ch.title && ch.title !== r.title) meta.push(`Namn: ${ch.title}`);
  return (meta.length ? `<p class="aic-meta">${esc(meta.join(" · "))}</p>` : "") + part("Ingredienser", i) + part("Steg", s);
}
function applyAiChange(r, it){
  const ch = it.change; if (!ch) return;
  let d;
  if (canEdit(r)) d = JSON.parse(JSON.stringify(r));
  else {   // någon annans recept: blir din egen variant
    d = JSON.parse(JSON.stringify(r));
    ["id", "createdAt", "updatedAt", "history", "cookLog", "favBy", "favorite", "rating", "timesCooked", "lastCooked", "addedBy", "myChanges", "variantName", "variantNameAuto"].forEach(k => delete d[k]);
    d.variantOf = r.variantOf || r.id;
    d.original = { servings: r.servings || null, ingredients: r.ingredients || [], steps: r.steps || [] };
  }
  if (ch.title) d.title = String(ch.title).trim();
  if (Number.isFinite(+ch.servings) && +ch.servings > 0) d.servings = Math.round(+ch.servings);
  if (typeof ch.time === "string") d.time = ch.time.trim();
  d.ingredients = ch.ingredients.map(x => String(x).trim()).filter(Boolean);
  d.steps = ch.steps.map(x => String(x).trim()).filter(Boolean);
  if (ch.summary) d.myChanges = [d.myChanges, String(ch.summary).trim()].filter(Boolean).join("\n");
  draft = d; view = d.id ? { name: "edit", id: d.id } : { name: "edit" }; render(); window.scrollTo(0, 0);
  toast(d.id ? "Granska ändringen och spara" : "Granska och spara din variant");
}

document.addEventListener("submit", e => {
  if (e.target.id !== "ai-form") return;
  e.preventDefault();
  const inp = document.getElementById("ai-input");
  const q = inp.value.trim(); if (!q) return;
  const r = recipes.find(x => x.id === view.id); if (!r) return;
  inp.value = ""; inp.style.height = ""; if (inp.scrollHeight > inp.clientHeight + 1) inp.style.height = (inp.scrollHeight + 2) + "px";
  askOrEdit(r, q);
});
// Frågefältet: växer med texten, Enter skickar (Shift+Enter ger ny rad)
document.addEventListener("input", e => {
  if (e.target.id !== "ai-input") return;
  const t = e.target; t.style.height = ""; if (t.scrollHeight > t.clientHeight + 1) t.style.height = Math.min(t.scrollHeight + 2, 220) + "px";
});
document.addEventListener("keydown", e => {
  if (e.target.id !== "ai-input" || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault(); const f = document.getElementById("ai-form"); if (f) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
});

// ---------- import modal ----------
function openImport(files, targetId){
  const t = targetId ? recipes.find(x => x.id === targetId) : null;
  importState = { text: "", url: t ? (t.sourceUrl || "") : "", shots: [], translate: true, busy: false, error: "", targetId: targetId || null, drink: !targetId && view.name === "bar" };
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
      <h2>${s.targetId ? "Komplettera recept" : s.drink ? "Importera drink" : "Importera recept"}</h2>
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
  logEvent("import", null, { url: s.url ? (() => { try { return new URL(s.url).host; } catch { return s.url.slice(0, 60); } })() : null, bilder: s.shots.length || 0, text: !!s.text });

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

  const prompt = importPrompt(s);
  try {
    const images = [];
    for (const sh of s.shots) images.push(await blobToB64(sh.blob));
    const out = parseJson(await ai(prompt, { mode: "json", images, fast: !images.length }));
    if (!out || out.error) throw { message: out && out.error ? out.error : "Hittade inget recept i texten." };
    const parsed = parseImported(out);
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
    // Inläst från baren: alltid typen dryck (och ingen annan typ av rätt)
    if (s.drink) { draft.tags = ["dryck", ...(draft.tags || []).filter(t => !dishTypes().includes(t))].slice(0, 6); if (!draft.servings) draft.servings = 1; }
    closeImport();
    view = { name: "edit" }; render(); window.scrollTo(0, 0);
  } catch (e) {
    s.busy = false;
    s.error = aiErr(e);
    renderImport();
  }
}
function parseImported(out){
  return {
    title: String(out.title || "").trim(),
    servings: Number.isFinite(+out.servings) && +out.servings > 0 ? Math.round(+out.servings) : null,
    time: String(out.time || "").trim(),
    tags: (Array.isArray(out.tags) ? out.tags : []).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6),
    ingredients: (Array.isArray(out.ingredients) ? out.ingredients : []).map(x => String(x).trim()).filter(Boolean),
    steps: (Array.isArray(out.steps) ? out.steps : []).map(x => String(x).trim()).filter(Boolean),
    notes: String(out.notes || "").trim(),
  };
}
function importPrompt(s){
  return `Du får ett matrecept som användaren kopierat från en webbsida eller Instagram, i form av text och/eller bilder (skärmdumpar, foton av kokbokssidor eller handskrivna lappar). Flera bilder hör till samma recept – slå ihop dem. Texten kan innehålla skräp som reklam, kommentarer och hashtags – ignorera det.
Svara ENDAST med ett JSON-objekt, utan förklaring:
{"title": string, "servings": number eller null, "time": string (t.ex. "45 min", tom om okänt), "tags": [string], "ingredients": [string], "steps": [string], "notes": string}
Regler:
- ingredients: en ingrediens per element, mängd och enhet först ("2 dl grädde", "1 gul lök"). Om receptet har delar (t.ex. sås, topping), lägg en rubrik som eget element som börjar med "# ". Behåll ALLA tidsangivelser från källan (koktid, stektid, ugnstid, vila, marinering, jäsning) i det steg där de hör hemma och skriv dem med siffror och enhet, t.ex. "15 min", "1 h", "1,5 h", "10–12 min", "30 sek" – aldrig bara "en stund" om källan anger en tid. Står tiden bara i receptets inledning eller i en totaltid, för in den i rätt steg om det framgår vilket.
- steps: ett steg per element, utan numrering, korta och tydliga. Om stegen tydligt hör till olika moment (t.ex. dagen innan, förberedelser, tillagning, vid servering) eller olika delar av rätten, lägg en rubrik som eget element som börjar med "# ".
- tags: 2–4 taggar, ENBART från denna lista (gemener, exakt stavning): ${tagVocab().join(", ")}. Välj det som stämmer – typ av rätt, mattyp, tillfälle och metod. ${TAG_HINTS}${dishTypes().length ? ` Exakt en tagg MÅSTE vara typ av rätt: ${dishTypes().join(", ")}.` : ""}
- notes: eventuella tips från källan, kort. Annars tom sträng.${s.drink ? `
- Det här är en drink (typ av rätt: dryck). Ange mängder i cl där det går, servings = antal glas, och skriv vilket glas och vilken garnering som används i stegen.` : ""}
- ${s.translate ? "Skriv allt på svenska. Räkna om amerikanska mått (cups, tbsp, tsp, oz, lb, °F) till svenska metriska mått (dl, msk, tsk, g, °C)." : "Behåll originalspråket och måtten."}
- Hitta inte på något. Saknas receptinnehåll helt, svara {"error": "kort förklaring på svenska"}.
${s.url ? "\nKällänk: " + s.url : ""}
${s.text ? "\nRECEPTTEXT:\n" + s.text.slice(0, 20000) : ""}`;
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
    case "hdrpick": if (cur) toggleHdr(cur); break;
    case "pickdish": openPhotoSheet(async url => { if (await patch(cur.id, { photo: url, photoCredit: null })) toast("Bilden sparad"); }, cur); break;
    case "editphoto": readForm(); openPhotoSheet(url => { draft.photo = url; renderEdit(); }); break;
    case "new":
      menuOpen = false; draft = { title: "", sourceUrl: "", servings: 4, time: "", tags: [], ingredients: [], steps: [], myChanges: "", notes: "", photo: null };
      view = { name: "edit" }; render(); window.scrollTo(0, 0); break;
    case "aisearch": runAiSearch(); break;
    case "ainew": runAiNew(); break;
    case "aiweb": runAiWeb(); break;
    case "aiwebview": { const w = aiSearch && aiSearch.web && aiSearch.web.items && aiSearch.web.items[+el.dataset.i]; if (w && w.url) { webCur = w; detailState.tab = "ing"; view = { name: "web", id: "w" + el.dataset.i }; render(); window.scrollTo(0, 0); loadWebRecipe(w); } break; }
    case "webback": goBack(); break;
    case "websave": saveWebRecipe(); break;
    case "webretry": if (webCur) { delete webCache[webCur.url]; loadWebRecipe(webCur); } break;
    case "aiwebimport": { const w = aiSearch && aiSearch.web && aiSearch.web.items && aiSearch.web.items[+el.dataset.i]; if (w && w.url) { webCur = w; detailState.tab = "ing"; view = { name: "web", id: "w" + el.dataset.i }; render(); window.scrollTo(0, 0); await loadWebRecipe(w); const c = webCache[w.url]; if (c && c.r && webCur === w && view.name === "web") saveWebRecipe(); } break; }
    case "ainewopen": if (aiSearch && aiSearch.nw) { aiSearch.nw.open = !aiSearch.nw.open; renderList(); } break;
    case "ainewsave": saveAiNew(); break;
    case "aisearchclose": aiSearch = null; filter.q = ""; render(); break;
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
      toast(wakeLock ? (barIsDrinkView() ? "Skärmen hålls tänd medan du blandar" : "Skärmen hålls tänd medan du lagar") : wakeWanted ? (wakeWanted = false, "Telefonen tillät inte att skärmen hålls tänd") : "Skärmen släcks som vanligt igen");
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
      logEvent("cook_cancel", cur); endCooking(); toast("Tillagningen avbruten"); render(); break;
    case "cookdone": { const r0 = cur; const note = (cookSession && cookSession.notes || "").trim(); logEvent("cook_done", r0); endCooking(); render(); openHistory(r0, null, note); toast(note ? "Snyggt! Dina anteckningar är med – sätt betyg och spara" : "Snyggt! Sätt betyg och spara tillagningen"); break; }
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
      await patch(cur.id, { favBy: nf }); logEvent(nf.includes(me) ? "fav" : "unfav", cur); if (nf.includes(me)) notify("liked", cur); toast(nf.includes(me) ? "Sparad bland dina favoriter" : "Borttagen från dina favoriter"); break; }
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
      if (await patch(cur.id, { original: { servings: cur.servings || null, ingredients: cur.ingredients || [], steps: cur.steps || [] }, myChanges: "" , ...notesWith(cur, noteNew("log", note.replace(/^\n+/, ""))) })) {
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
        ${canEdit(cur) ? `<label class="check" style="display:flex;gap:8px;align-items:center;margin:14px 0"><input type="checkbox" id="mvDel" checked> Ta bort varianten efteråt</label>` : ""}
        <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="mvNo">Avbryt</button><button class="btn accent" id="mvYes">Uppdatera</button></div>`);
      $id("mvNo").onclick = closeSheet;
      $id("mvYes").onclick = async () => {
        $id("mvYes").disabled = true;
        const v = cur;
        const line = `${today()}: Uppdaterad med varianten ${variantLabel(v)} (${nameOf(addedByOf(v))}).` + (v.myChanges ? "\n" + v.myChanges : "");
        const ok = await patch(base.id, {
          ingredients: v.ingredients || [], steps: v.steps || [], servings: v.servings || base.servings || null,
          ...notesWith(base, noteNew("log", line)),
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
      notify("cooked", cur);
      toast("Noterat: lagad idag"); break;
    case "copy":
      try { await navigator.clipboard.writeText(recipeText(cur)); toast("Receptet kopierat"); } catch { toast("Kunde inte kopiera"); }
      break;
    case "del":
      if (!el.classList.contains("armed")) { el.classList.add("armed"); el.textContent = "Säker? Tryck igen"; setTimeout(() => { el.classList.remove("armed"); el.textContent = "Radera receptet"; }, 3500); }
      else { if (await deleteRecipe(cur.id)) toast("Receptet raderat"); view = { name: "list" }; render(); }
      break;
    case "edit": draft = JSON.parse(JSON.stringify(cur)); view = { name: "edit", id: cur.id }; render(); window.scrollTo(0, 0); break;
    case "rmphoto": readForm(); draft.photo = null; renderEdit(); break;
    case "cancel":
      draft = null; goBack(); break;
    case "save": {
      readForm();
      if (!draft.title) { toast("Ge receptet ett namn"); document.querySelector('[name=title]').focus(); return; }
      if (!draft._typeOk && dishTypes().length && !hasDishType(draft.tags)) { askDishType(); return; }
      // Ändrat innehåll i ett grundrecept: fråga om det ska bli en variant
      if (draft.id && !draft.variantOf && !draft._fillIn && !el.dataset.force) {
        const stored = recipes.find(x => x.id === draft.id);
        const had = stored && ((stored.ingredients || []).length || (stored.steps || []).length);
        const changed = stored && (!sameList(stored.ingredients || [], draft.ingredients || []) || !sameList(stored.steps || [], draft.steps || []) || (stored.servings || null) !== (draft.servings || null));
        if (had && changed) { askVariantOrOriginal(stored); return; }
      }
      const btn = document.getElementById("savebtn"); btn.disabled = true; btn.textContent = "Sparar …";
      if (!draft.variantOf) { delete draft.original; if (!draft.id) draft.myChanges = ""; }
      delete draft._fillIn; delete draft._typeOk;
      const needName = draft.variantOf && (!draft.variantName || draft.variantNameAuto);
      const isNew = !draft.id;
      const id = await saveRecipe(draft);
      if (id) logEvent(isNew ? (draft.variantOf ? "variant" : "add") : "edit", { id, title: draft.title });
      if (id && isNew) notify(draft.variantOf ? "variant" : "added", { id, title: draft.title, variantOf: draft.variantOf });
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
    case "shop": openShopFromRecipe(cur); break;
    case "shopfab": openShop(); break;
    case "aiapply": { const it = (aiState[cur.id] || [])[+el.dataset.i]; if (it) applyAiChange(cur, it); break; }
    case "aideep": {   // "Pappa, fundera lite till": samma fråga till Sonnet, en gång per svar
      const list = aiState[cur.id] || [], it = list[+el.dataset.i];
      if (!it || it.deeper || list.some(x => x.busy)) break;
      it.deeper = true;
      if (it.kind) askAI(cur, it.kind, null, true); else askOrEdit(cur, it.q, true);
      break;
    }
    case "aidismiss": { const it = (aiState[cur.id] || [])[+el.dataset.i]; if (it) { it.dismissed = true; aiRefresh(cur.id); } break; }
    case "aisave": {
      const it = (aiState[cur.id] || [])[+el.dataset.i]; if (!it) break;
      if (await addNote(cur, noteNew("pappa", it.a, it.q))) { el.textContent = "✓ Sparat"; el.disabled = true; toast("Sparat i anteckningar"); }
      break;
    }
    case "closeimport": closeImport(); break;
    case "closeimport-bg": if (e.target === el && !importState?.busy) closeImport(); break;
    case "rmshot": importState.shots.splice(+el.dataset.i, 1); renderImport(); break;
    case "runimport": runImport(); break;
  }
});


// ---------- ark (inställningar, användare, lösenord) ----------
const sheetIsOpen = () => !!document.getElementById("sheet-bg");
function openSheet(html){
  setTimeout(() => { lockScroll(); addSheetX(); }, 0);   // efter att rutan finns, och efter ev. historikpost
  // Ny ruta (inte byte av innehåll i en öppen): lägg en post i historiken så att Tillbaka stänger den
  if (!sheetIsOpen() && history.state && !history.state.sheet) {
    history.replaceState({ ...history.state, y: window.scrollY }, "");
    history.pushState({ ...history.state, sheet: true, dup: false, i: ++histIdx }, "");
    inAppSteps++;
  }
  document.getElementById("modal-root").innerHTML = `<div class="modal-bg" id="sheet-bg"><div class="modal form" role="dialog">${html}</div></div>`;
  document.getElementById("sheet-bg").addEventListener("click", e => { if (e.target.id === "sheet-bg") closeSheet(); });
}
// Alla rutor får ett × uppe i högra hörnet (om de inte redan har ett)
// Dra rutan nedåt för att stänga (telefon). Bara när rutan är scrollad högst upp, så att vanlig scrollning fungerar.
function attachSheetDrag(m){
  if (!m || m.dataset.drag || window.matchMedia("(min-width:700px)").matches) return;
  m.dataset.drag = "1";
  let y0 = null, dy = 0, t0 = 0, active = false;
  m.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); active = false;
  }, { passive: true });
  m.addEventListener("touchmove", e => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (!active) {
      if (d > 6 && m.scrollTop <= 0) { active = true; m.style.transition = "none"; }
      else if (d < -6 || m.scrollTop > 0) { y0 = null; return; }
      else return;
    }
    dy = Math.max(0, d);
    m.style.transform = `translateY(${dy}px)`;
    const bg = document.getElementById("sheet-bg"); if (bg) bg.style.opacity = String(Math.max(.35, 1 - dy / 600));
    e.preventDefault();
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    if (!active) return;
    active = false;
    const fast = dy > 60 && dy / Math.max(1, Date.now() - t0) > .6;
    m.style.transition = "transform .2s ease-out";
    const bg = document.getElementById("sheet-bg");
    if (dy > Math.min(140, m.offsetHeight * .25) || fast) {
      m.style.transform = "translateY(100%)";
      if (bg) { bg.style.transition = "opacity .2s"; bg.style.opacity = "0"; }
      setTimeout(() => closeSheet(), 190);
    } else {
      m.style.transform = "";
      if (bg) bg.style.opacity = "";
    }
  };
  m.addEventListener("touchend", end); m.addEventListener("touchcancel", end);
}
function addSheetX(){
  const m = document.querySelector("#modal-root .modal");
  attachSheetDrag(m);
  if (!m || m.querySelector(".fp-x, .sheet-x")) return;
  const b = document.createElement("button");
  b.className = "sheet-x"; b.type = "button"; b.setAttribute("aria-label", "Stäng"); b.textContent = "×";
  b.onclick = () => closeSheet();
  m.prepend(b);
}
// Lås sidan bakom en öppen ruta så att bara rutan scrollar (fungerar även i Safari på iPhone)
let lockedY = null;
function lockScroll(){
  if (lockedY !== null || !sheetIsOpen()) return;
  lockedY = window.scrollY;
  const b = document.body.style;
  b.position = "fixed"; b.top = -lockedY + "px"; b.left = "0"; b.right = "0"; b.width = "100%";
  document.body.classList.add("sheet-open");
}
function unlockScroll(){
  if (lockedY === null) return;
  const y = lockedY; lockedY = null;
  const b = document.body.style;
  b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = "";
  document.body.classList.remove("sheet-open");
  window.scrollTo(0, y);
}
function closeSheet(fromPop){
  const was = sheetIsOpen();
  document.getElementById("modal-root").innerHTML = "";
  unlockScroll();
  // Stängd med ×/knapp: markera rutans historikpost så att Tillbaka hoppar över den
  if (was && !fromPop && history.state && history.state.sheet) history.replaceState({ ...history.state, sheet: false, dup: true }, "");
}
const $id = id => document.getElementById(id);

function openSettings(){
  const I = d => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ic = {
    users: I('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.2c2.3.2 4 1.8 4.7 4.8"/>'),
    act: I('<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>'),
    tag: I('<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>'),
    merge: I('<path d="M6 4v5c0 3 6 3 6 6v5M18 4v5c0 3-6 3-6 6"/>'),
    clock: I('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>'),
    file: I('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M12 11v6M9.5 14.5 12 17l2.5-2.5"/>'),
    bell: I('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    help: I('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>'),
    key: I('<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
    out: I('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
  };
  const row = (id, icon, title, desc, extra = "") => `<button class="srow" id="${id}"><span class="si">${ic[icon]}</span><span class="st"><b>${title}${extra}</b>${desc ? `<small>${desc}</small>` : ""}</span><span class="sc" aria-hidden="true">›</span></button>`;
  const nm = nameOf(me) || (me || "").split("@")[0];
  openSheet(`<div class="sheet-head"><h2>Konto</h2><button class="iconbtn fp-x" id="closeSheetBtn" aria-label="Stäng">×</button></div>
    <div class="sprof"><span class="sav">${esc((nm || "?").slice(0, 1).toUpperCase())}</span><span><b>${esc(nm)} <span class="srole">${esc(ROLE_LABEL[role] || "Ingen behörighet")}</span></b><small>${esc(me || "")}</small></span></div>
    ${can("admin") ? `<div class="sgrp"><h3>Administration</h3>
      ${row("usersBtn", "users", "Användare", "Bjud in, ändra behörighet, förfrågningar", pendingReqs ? `<span class="dotcount">${pendingReqs}</span>` : "")}
      ${row("actBtn", "act", "Aktivitet", "Vem som gjort vad i appen")}</div>
    <div class="sgrp"><h3>Recepten</h3>
      ${row("tagEdBtn", "tag", "Nyckelord", "Grupper och ord i Filtrera")}
      ${row("tagsBtn", "merge", "Slå ihop nyckelord", "Claude rensar och slår ihop dubbletter")}
      ${row("timesBtn", "clock", "Tider i gamla recept", "Lägg in tider så att stegen får timers")}
      ${row("typeBtn", "tag", "Typ av rätt", "Ge recepten utan typ en förrätt, varmrätt …")}
      ${row("importBtn", "file", "Importera från fil", "Läs in recept från en JSON-fil")}
      <input type="file" id="importFile" accept=".json,application/json" hidden></div>` : ""}
    <div class="sgrp"><h3>Ditt konto</h3>
      ${row("notifyBtn", "bell", "Aviseringar", "Välj vad du vill bli meddelad om")}
      ${row("helpBtn", "help", "Hjälp och instruktioner", "")}
      ${row("pwBtn", "key", "Byt lösenord", "")}
      ${row("logoutBtn", "out", "Logga ut", "")}</div>`);
  $id("notifyBtn").onclick = () => { closeSheet(); openNotifySettings(); };
  $id("helpBtn").onclick = () => { closeSheet(); view = { name: "help" }; render(); window.scrollTo(0, 0); };
  $id("closeSheetBtn").onclick = closeSheet;
  $id("pwBtn").onclick = () => openPasswordSheet(false);
  if ($id("usersBtn")) $id("usersBtn").onclick = openUsers;
  if ($id("timesBtn")) $id("timesBtn").onclick = openTimesTool;
  if ($id("typeBtn")) $id("typeBtn").onclick = openTypeTool;
  if ($id("actBtn")) $id("actBtn").onclick = () => openActivity();
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
  if (location.hash === "#baren") view = { name: "bar" };
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
  try { loadShop(); subscribeShop(); } catch (e) { console.warn(e); }
  resumeCooking();
  logOpen();
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
function openHistory(r, entryId, prefillNote){
  const e = histOf(r).find(x => x.id === entryId) || { date: today(), rating: 0, note: prefillNote || "", photo: null };
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
    if (await patch(r.id, data)) { closeSheet(); if (!entryId && date >= today()) notify("cooked", r, entry.rating ? "★".repeat(entry.rating) : ""); toast(entryId ? "Tillagningen är ändrad" : "Tillagningen är sparad"); }
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
function openPhotoSheet(onDone, sugFor){
  openSheet(`
    <h2>Bild på rätten</h2>
    ${sugFor && imgSug[sugFor.id] && imgSug[sugFor.id].state === "nokey" ? "" : sugFor ? `<button type="button" class="ps-sug" id="ps-sug"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="M4 17l5-4.5 3.5 3 2.5-2 4.5 3.5"/></svg><span><b>Förslag från bildbanken</b><small>Snygga foton som passar receptet, gratis från en bildbank</small></span><em>→</em></button>` : ""}
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
  if ($id("ps-sug")) $id("ps-sug").onclick = () => { document.removeEventListener("paste", onPaste); closeSheet(); setTimeout(() => openImgSugSheet(sugFor), 0); };
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
        <li>Ändra antalet <b>portioner</b> med − och + – mängderna räknas om.</li>
        <li>Tryck <b>Börja laga</b> i receptet. Skärmen hålls tänd och varje steg i <b>Gör så här</b> får en <b>kryssruta</b> till höger. Bocka av stegen – de blir gröna och överstrukna, <b>Nästa</b> visar var du är och en grön linje visar hur långt du har kommit.</li>
        <li><b>Timer:</b> tider i stegen blir knappar (⏱ 15 min). Med <b>⏱ Timer</b> sätter du en egen tid – appen föreslår tiderna som står i receptet, eller så väljer du själv och skriver vad den gäller (t.ex. <i>Ugnen</i>).</li>
        <li>När timern är klar kommer en ruta med steget som är klart och <b>nästa steg</b>. Tryck <b>✓ Steget klart – visa nästa</b>, eller <b>starta nästa timer</b> direkt om nästa steg har en tid. Appen piper tills du kvitterar.</li>
        <li>${d.kind === "ios" ? (d.installed ? "Timern skickar en avisering även när appen är stängd." : "Lägg appen på hemskärmen så kan timern skicka avisering även när appen är stängd.") : "Timern skickar en avisering även när appen är stängd."} Siffran på appikonen försvinner när du öppnar appen.</li>
        <li>Medan du lagar syns en mörk bricka <b>Lagar nu</b> uppe till höger – tryck för att komma tillbaka till receptet. Den följer med till dina andra enheter: börjar du på datorn ser du det på telefonen, med bockar och timrar.</li>
        <li>Skriv i <b>Anteckningar medan du lagar</b> när något avviker – en extra klyfta vitlök, längre tid i ugnen. Anteckningarna följer med till dina andra enheter.</li>
        <li>Tryck <b>Klar!</b> när du är färdig, så sparar du tillagningen med betyg och bild – dina anteckningar ligger redan ifyllda. Eller tryck <b>Avbryt</b> (två gånger). Glömmer du att avsluta stängs det av sig självt efter 12 timmar.</li>
        <li>Håll skärmen tänd med <b>telefonikonen</b> – se nedan.</li>
        <li>Lagade du utan att trycka Börja laga: tryck <b>Ny tillagning</b> under receptet och fyll i datum, betyg, anteckning och bild.</li>
      </ul>`)}

    ${sec("Hitta recept och Sök AI-recept", `
      <ul>
        <li><b>Sökfältet</b> letar i titlar, nyckelord, ingredienser och anteckningar medan du skriver.</li>
        <li>Stämmer inte alla ord visas <b>Närmast i receptboken</b> direkt, med vad receptet har och vad som saknas (<i>Har torsk – saknar kapris</i>). Brickan visar hur bra det passar: <b>Bra träff</b> eller <b>Delvis</b>. Allt detta är gratis och sker av sig självt.</li>
        <li>Hittar du inte rätt: tryck <b>Sök AI-recept</b> i raden under sökfältet. Pappa letar då bra recept på nätet (ICA, Köket.se, Arla m.fl.). Det är det enda i sökningen som kostar, så det händer bara när du trycker.</li>
        <li>Tryck <b>Visa receptet</b> för att se receptet som om det fanns i appen – med bild, ingredienser och steg – innan du väljer <b>Spara i receptboken</b>. Du granskar och kan ändra innan det sparas.</li>
        <li>Inget som passar? <b>Låt pappa skriva ett eget recept</b> som passar er smak.</li>
        <li><b>Filtrera</b> (till höger i filterraden, på mobilen bredvid Bilder/Lista) visar nyckelorden i grupper: <b>Rätt</b>, <b>Mattyp</b> (kött, fläsk, kyckling, fisk, skaldjur, vegetariskt), <b>Tillfälle</b> och <b>Metod</b>. Övriga ord ligger hopfällda under <b>Övrigt</b>. Välj flera för att smalna av, t.ex. <i>fisk + vardag</i>; valda filter tar du bort med ×.</li>
        <li>Snabbfilter överst: <b>Mina favoriter</b>, <b>Tillagda av mig</b> och <b>Lagade av mig</b>.</li>
      </ul>`)}

    ${sec("Aviseringar", `
      <p>Appen kan meddela dig när något händer i köket – även när den är stängd.</p>
      <ul>
        <li><b>Alla</b> får besked när någon <b>lägger till</b> ett recept eller <b>lagar</b> något.</li>
        <li><b>Du</b> får besked när någon gör ett av dina recept till <b>favorit</b> eller gör en <b>variant</b> av det.</li>
        <li>Slå på och välj under <b>Konto → Aviseringar</b>. Varje rad visar tydligt <b>PÅ</b> (grön bock) eller <b>AV</b> (grått kryss). Tryck <b>Testa</b> för att se att det fungerar på enheten.</li>
        <li>Aviseringar måste slås på en gång per enhet. Timrar under matlagningen ringer alltid.</li>
      </ul>
      ${d.kind === "ios" && !d.installed ? `<p class="hnote">På iPhone fungerar aviseringar bara när appen ligger på hemskärmen – se Installera appen.</p>` : ""}`)}

    ${sec("Inköpslista", `
      <ul>
        <li>Tryck <b>Handla</b> (bredvid Börja laga) eller <b>Inköpslista</b> under ett recept. Tryck på det du redan har hemma – det kommer inte med. Mängderna följer antalet portioner du valt.</li>
        <li><b>Alltid hemma:</b> salt, peppar och olja prickas av automatiskt. Håll inne (eller dubbeltryck) på en rad för att lägga till eller ta bort en basvara.</li>
        <li>Listan öppnas med <b>korgen</b> uppe i sidhuvudet (och i receptbilden när du har en lista) – siffran visar hur många varor som är kvar. Varorna sorteras efter avdelning i butiken, och samma vara från flera recept slås ihop. Tryck för att bocka av.</li>
        <li>Har du något hemma ändå: tryck på huset på raden så flyttas varan till <b>Hemma</b>.</li>
        <li><b>Ändra eller ta bort en vara:</b> håll inne på varan (på datorn: högerklicka eller tryck på pennan som syns när musen är över raden). Välj <b>Ändra</b> för att rätta namn eller mängd, eller <b>Ta bort</b> – du kan ångra direkt efteråt.</li>
        <li><b>Lägg till vara</b> längst ner för sånt som inte står i något recept, t.ex. mjölk. Flera på en gång med komma.</li>
        <li>Listan är <b>din egen</b>. Med <b>Dela med …</b> väljer du vilka som ska se och kunna ändra den – de får en avisering. Du kan ha flera listor (<b>+ Ny lista</b>).</li>
        <li><b>Dela / kopiera</b> skickar listan som text till Meddelanden, Påminnelser, Anteckningar eller vart du vill.</li>
        <li>När allt är avbockat visas <b>Klart! Allt är handlat.</b> Tryck <b>Töm listan</b> så tas alla varor bort (även de som fanns hemma) och inköpslistan stängs – den är redo till nästa gång. Ångra i meddelandet som visas öppnar listan igen med alla varor. <b>Töm avbockat</b> tar bara bort det avbockade.</li>
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
      <p>Tryck <b>Byt bild</b> i receptet: ${d.touch ? "<b>Ta foto</b>, " : ""}välj från enheten, <b>klistra in</b> en kopierad bild${d.touch ? "" : ` (eller <span class="k">${d.mod}</span>+<span class="k">V</span>)`} eller <b>hämta från en länk</b>.</p>
      <p><b>Förslag från bildbanken</b> överst i samma ruta visar snygga foton som passar receptet, gratis från Pixabay – tryck på den du gillar. Recept utan bild får förslagen direkt i receptet. Fotografens namn visas litet på bilden.</p>`)}

    ${sec("Rubriker, anteckningar och AI", `
      <ul>
        <li>Rader som börjar med <b>#</b> blir rubriker – bland ingredienserna (<i># Till såsen</i>) och i stegen (<i># Dagen innan</i>, <i># Vid servering</i>).</li>
        <li><b>Anteckningar:</b> tryck <i>Redigera</i> och skriv direkt i receptet.</li>
        <li><b>Fråga kocken och sommelieren</b> längst ner i receptet: tryck <b>Vilket vin passar?</b> eller <b>Vad serverar jag till?</b>, eller skriv en egen fråga (<i>kan jag frysa den?</i>) eller vad du vill ändra (<i>byt grädde mot crème fraiche</i>, <i>gör den för 8 personer</i>) och tryck <b>Fråga Pappa</b>. Vill du ha ett mer genomtänkt svar trycker du <b>Pappa, fundera lite till</b> under svaret.</li>
        <li>Medan pappa tänker snurrar kugghjulet och texten skiftar (<i>Pappa smakar av …</i>). När lampan tänds är svaret klart – det står bredvid lampan, med din fråga under. Gäller det en ändring visas de rader som tas bort (−) och läggs till (+).</li>
        <li>Ändringar kontrolleras: kan något misslyckas eller bli osäkert står det <b>⚠ Tänk på</b>, går det att göra bättre står det <b>💡 Tips</b>. Tryck <b>Använd ändringen</b> för att granska och spara (som variant eller i originalet) – på någon annans recept blir det <b>din egen variant</b>.</li>
      </ul>`)}

    ${sec("Dina och andras recept", `
      <ul>
        <li>Du kan ändra och radera <b>dina egna</b> recept.</li>
        <li>Vill du ändra någon annans: tryck <b>Gör min egen variant</b> – du får en egen kopia. Du kan göra hur många varianter du vill, även av dina egna recept (<b>Gör en variant</b>).</li>
        <li>Varianter får automatiskt ett namn efter vad som skiljer dem från originalet, t.ex. <i>Extra stark</i> eller <i>Utan grädde</i>. Vill du döpa själv skriver du namnet under <b>Redigera</b>. Byt mellan originalet och varianterna med raden <b>Varianter</b> under rubriken.</li>
        <li>Är grundreceptet ditt kan du föra över en variant till det med <b>Uppdatera grundreceptet</b> längst ner i varianten. Varianten tas då bort, om du inte avmarkerar rutan.</li>
        <li>Ändrar du ingredienser, steg eller portioner i ett recept frågar appen om det ska bli en <b>ny variant</b> (originalet lämnas orört) eller om du vill <b>ändra originalet</b> – det senare är för rättelser.</li>
        <li>När du redigerar ett recept väljer du nyckelord genom att trycka på dem, eller skriver ett nytt. Superanvändare ändrar listan under <b>Konto → Nyckelord</b>.</li>
      </ul>`)}

    ${sec("Bra att veta", `
      <ul>
        <li>Recepten sparas på enheten och går att läsa <b>utan nät</b>.</li>
        <li><b>Senaste i köket</b> överst i receptlistan rullar de fem senaste händelserna. Ikonen visar vad som hänt: ${evIcon("added")} lade till, ${evIcon("variant")} gjorde en variant, ${evIcon("cooked")} lagade. Tryck på raden för att fälla ut den – fliken <b>Nya recept</b> visar tillagda recept och varianter, <b>Senast lagade</b> vem som har lagat vad. Röda prickar och <b>Nytt</b> visar vad som har hänt sedan du var här sist.</li>
        <li><b>Bilden överst</b> växlar mellan receptens bilder. Tryck på receptnamnet i hörnet för att öppna receptet. På en receptbild kan du trycka <b>Till sidhuvudet</b> – har någon bild valts så visas bara de valda, annars alla tillräckligt stora liggande bilder.</li>
        <li><b>Recept utan bild</b> får förslag på bilder från en gratis bildbank. Tryck på den du gillar så sparas den, eller sök med egna ord. Via <b>Byt bild</b> → <b>Förslag från bildbanken</b> kan du byta en befintlig bild.</li>
        <li>Det de andra sparar syns direkt hos dig. Siffran under <b>RECEPT</b> i sidhuvudet visar hur många recept som finns, och <b>+ nya</b> hur många som tillkommit sedan sist.</li>
        <li><b>Tillbaka</b> (knappen i appen, webbläsarens pil, musens bakåtknapp eller svep) tar dig tillbaka dit du var i listan. Är en ruta öppen stängs den först. Alla rutor kan också stängas med <b>×</b> uppe till höger.</li>
        <li>Under <b>Konto</b> hittar du Aviseringar, Hjälp, Byt lösenord och Logga ut. Superanvändare ser också <b>Användare</b>, <b>Aktivitet</b> (vem som gjort vad, och från vilken enhet) och verktygen för nyckelord och tider.</li>
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
  const verb = e => e.kind === "added" ? "lade till" : e.kind === "variant" ? "gjorde en variant av" : (e.r && isDrink(e.r) ? "blandade" : "lagade");
  const nm = e => e.by === me ? "Du" : esc(nameOf(e.by));
  const title = e => esc(e.kind === "variant" && e.base ? e.base.title : e.r.title || "Namnlöst recept");
  const latest = ev[0];
  const added = ev.filter(e => e.kind !== "cooked"), cooked = ev.filter(e => e.kind === "cooked");
  if (!activityTab) activityTab = !added.some(isNew) && cooked.some(isNew) ? "cooked" : "added";
  const pool = activityTab === "cooked" ? cooked : added;
  const items = pool.slice(0, activityOpen === "all" ? 25 : 6);
  const nAdded = added.filter(isNew).length, nCooked = cooked.filter(isNew).length;
  return `<div class="act ${activityOpen ? "open" : ""}">
    <button class="act-row" data-a="acttoggle" aria-expanded="${!!activityOpen}" title="Senaste i köket">
      <span class="kitchen-ico ${newCount ? "has-new" : ""}" aria-hidden="true"><svg viewBox="2.5 2.5 19 19" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2.5 12.5H4M20 12.5h1.5"/><path d="M8.5 9c-.8-1 .8-2 0-3M12 9c-.8-1 .8-2 0-3M15.5 9c-.8-1 .8-2 0-3"/></svg><i></i></span>
      <span class="lab">Senaste i köket</span>
      ${(() => { const ck = ev.filter(e => e.kind === "cooked").slice(0, 3);   // minst tre tillagningar om det finns
        const top = ck.concat(ev.filter(e => !ck.includes(e)).slice(0, 5 - ck.length)).sort((a, b) => b.ts - a.ts); // Flöde som glider från höger till vänster; gruppen ligger två gånger i rad så att det går runt utan skarv
        const line = e => `<span class="mq-it" data-a="open" data-id="${esc(e.r.id)}">${evIcon(e.kind, e.r)}<span class="mq-who"><b>${nm(e)}</b>${verb(e)}&nbsp;</span><span class="t">${title(e)}</span>&nbsp;· ${relDay(e.ts)}</span><span class="mq-sep"></span>`;
        const grp = top.map(line).join("");
        const chars = top.reduce((n, e) => n + (e.by === me ? 2 : nameOf(e.by).length) + verb(e).length + (e.r.title || "").length + 14, 0);
        const dur = Math.max(14, Math.round(chars * 7.5 / 40));   // ca 40 px per sekund
        return `<span class="latest mq" style="--d:${dur}s"><span class="mq-track"><span class="mq-grp">${grp}</span><span class="mq-grp" aria-hidden="true">${grp}</span></span></span>`; })()}
      ${newCount ? `<span class="new">${newCount} ${newCount === 1 ? "ny" : "nya"}</span>` : ""}
      <span class="chev" aria-hidden="true">▼</span>
    </button>
    ${activityOpen ? `<div class="act-tabs" role="tablist">
        <button role="tab" class="${activityTab === "added" ? "on" : ""}" data-a="acttab" data-t="added">Nya recept${nAdded ? `<span class="tn">${nAdded}</span>` : ""}</button>
        <button role="tab" class="${activityTab === "cooked" ? "on" : ""}" data-a="acttab" data-t="cooked">Senast lagade${nCooked ? `<span class="tn">${nCooked}</span>` : ""}</button>
      </div>
      <div class="act-list">${items.length ? "" : `<p class="hnote" style="padding:12px 0">${activityTab === "cooked" ? "Inga tillagningar än – tryck Börja laga eller Ny tillagning i ett recept." : "Inga recept än."}</p>`}${items.map(e => `
      <div class="fitem" data-a="open" data-id="${esc(e.r.id)}">
        <span class="nd ${isNew(e) ? "" : "old"}"></span>${avHtml(e.by)}
        <span class="tx">${evIcon(e.kind, e.r)}<i>${nm(e)} ${verb(e)}</i> <b>${title(e)}</b>${e.rating ? ` <span class="st">${"★".repeat(e.rating)}</span>` : ""}${e.note ? `<span class="note">”${esc(e.note)}”</span>` : ""}</span>
        <span class="when">${relDay(e.ts)}</span>
        ${e.r.photo ? `<img src="${esc(e.r.photo)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
      </div>`).join("")}
      ${pool.length > items.length ? `<button class="linkbtn act-more" data-a="actmore">Visa fler</button>` : ""}
    </div>` : ""}
  </div>`;
}

// Anteckningar under matlagningen sparas i sessionen (och synkas) tills man trycker Klar!
document.addEventListener("input", e => {
  if (e.target && e.target.id === "cookNote" && cookSession) { cookSession.notes = e.target.value; saveCook(); }
});

// Knapprutor under receptet: ikon över text
function actTile(a, ic, label){
  const ACT_ICON = {
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.5 2.5 4.9-5.2"/>',
  note: '<path d="M6 3.5h9.5l3 3V20.5H6z"/><path d="M9 9h6M9 12.5h6M9 16h3.5"/><path d="M3.5 7v13.5"/>',
  photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="M4 17l5-4.5 3.5 3 2.5-2 4.5 3.5"/>',
  pencil: '<path d="M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5z"/><path d="M14 6.8l3.2 3.2"/>',
  variant: '<path d="M5 3h8l4 4v6"/><path d="M13 3v4h4"/><path d="M5 3v18h6"/><path d="M14.5 20.5l6-6-2-2-6 6-.5 2.5z"/>',
  basket: '<path d="M3.5 9.5h17l-1.6 9a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5 11 4M16 9.5 13 4"/><path d="M9 13v4M12 13v4M15 13v4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  };
  return `<button class="atile" data-a="${a}"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ACT_ICON[ic]}</svg><span>${esc(label)}</span></button>`;
}

// Ikoner för händelsetyperna: blad med plus = lade till, blad med penna = variant, kastrull med ånga = lagade
const EV_ICON = {
  added: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 10.5v6M9 13.5h6"/>',
  variant: '<path d="M5 3h8l4 4v6"/><path d="M13 3v4h4"/><path d="M5 3v18h6"/><path d="M14.5 20.5l6-6-2-2-6 6-.5 2.5z"/>',
  cooked: '<path d="M4 12h16v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2.5 12.5H4M20 12.5h1.5"/><path d="M8.5 9c-.8-1 .8-2 0-3M12 9c-.8-1 .8-2 0-3M15.5 9c-.8-1 .8-2 0-3"/>',
};
const EV_KIND = { add: "added", added: "added", variant: "variant", cook_done: "cooked", cooked: "cooked", cook_start: "cooked" };
const EV_LABEL = { added: "Lade till", variant: "Variant", cooked: "Lagade" };
function evIcon(kind, r){
  const k = EV_KIND[kind] || kind; let d = EV_ICON[k];
  if (!d) return "";
  const dr = r && typeof isDrink === "function" && isDrink(r);
  if (dr) d = k === "cooked" ? EV_DRINK_MIX : EV_DRINK_ADD;
  return `<span class="evi evi-${k}${dr ? " evi-drink" : ""}" title="${dr ? (k === "cooked" ? "Blandade" : k === "variant" ? "Variant" : "Lade till") : EV_LABEL[k]}"><svg viewBox="2.5 2.5 19 19" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;
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
    const out = parseJson(await ai(prompt, { mode: "json", fast: true }));
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
    if (id) { logEvent("variant", { id, title: v.title }); notify("variant", { id, title: v.title, variantOf: v.variantOf }); }
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
// Samma kastrull med ånga som för "lagade" i Senaste i köket
const PAN_SVG = `<svg class="panico" viewBox="2.5 2.5 19 19" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2.5 12.5H4M20 12.5h1.5"/><path d="M8.5 9c-.8-1 .8-2 0-3M12 9c-.8-1 .8-2 0-3M15.5 9c-.8-1 .8-2 0-3"/></svg>`;
let cookSession = null;
const COOK_KEY = () => "cook:" + (me || "");
function loadCook(){ try { cookSession = JSON.parse(localStorage.getItem(COOK_KEY()) || "null"); } catch { cookSession = null; } if (cookSession && loaded && !recipes.find(r => r.id === cookSession.recipeId)) cookSession = null;
  // Glömd matlagning: efter 12 timmar utan aktiv timer avslutas den tyst (räknas inte som lagad)
  if (cookSession && Date.now() - (cookSession.startedAt || 0) > 12 * 36e5 && !(cookSession.timers || []).some(t => t.end > Date.now())) { cookSession = null; saveCook(); } }
function saveCook(){ writeCookLocal(Math.max(Date.now(), cookLocalAt() + 1)); pushCook(); }   // alltid nyare än det vi senast såg, även om klockorna skiljer
function writeCookLocal(at){ try { cookSession ? localStorage.setItem(COOK_KEY(), JSON.stringify(cookSession)) : localStorage.removeItem(COOK_KEY()); localStorage.setItem("cookAt:" + (me || ""), String(at)); } catch {} }
const cookLocalAt = () => { try { return +localStorage.getItem("cookAt:" + (me || "")) || 0; } catch { return 0; } };
// Synk mellan enheter: matlagningen sparas också i en egen rad i databasen (_cook_<e-post>)
const COOK_ROW = () => "_cook_" + String(me || "").toLowerCase();
let cookPushT = null, cookSyncWarned = false, cookHeadObs = null;
function pushCook(){
  if (!me || !sb) return;
  clearTimeout(cookPushT);
  cookPushT = setTimeout(() => {
    sb.from("recipes").upsert({ id: COOK_ROW(), data: { cook: true, addedBy: me, session: cookSession, updatedAt: cookLocalAt() } }).then(({ error }) => { if (error && !cookSyncWarned) { cookSyncWarned = true; toast("Kunde inte synka matlagningen till dina andra enheter: " + error.message); } }, () => {});
  }, 400);
}
function applyRemoteCook(d){
  if (!d || !me) return;
  const at = +d.updatedAt || 0;
  if (at === cookLocalAt()) return;          // redan i takt
  if (at < cookLocalAt()) { pushCook(); return; }   // vi har nyare (t.ex. ändrat offline)
  cookSession = d.session || null;
  if (cookSession && !recipes.find(r => r.id === cookSession.recipeId)) cookSession = null;
  writeCookLocal(at);
  if (view.name !== "edit") render(); else renderCookBar();
}
function startCooking(r){
  if (cookSession && cookSession.recipeId !== r.id) {
    const other = recipes.find(x => x.id === cookSession.recipeId);
    if (other && !confirm(`Du lagar redan ${other.title}. Vill du avsluta den och börja med ${r.title}?`)) return;
  }
  cookSession = { recipeId: r.id, startedAt: Date.now(), servings: detailState.servings ?? r.servings ?? null, done: detailState.done || {}, timers: [] };
  saveCook();
  wakeWanted = true;
  detailState.tab = "ing";
  render(); syncWakeLock(); logEvent("cook_start", r);
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
  try { renderShopFab(); } catch {}
  let bar = document.getElementById("cookbar");
  if (!cookSession && me) loadCook();
  const appEl = document.getElementById("app");
  const show = cookSession && me && view.name !== "edit" && appEl && !appEl.classList.contains("hidden");
  if (!show) { if (bar) bar.remove(); document.body.classList.remove("has-cookbar"); return; }
  const r = recipes.find(x => x.id === cookSession.recipeId); if (!r) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "cookbar"; bar.className = "cookbar"; document.body.appendChild(bar); }
  // I receptlistan ligger den direkt under sidhuvudet och följer med uppåt när man scrollar; annars uppe i högra hörnet
  const hdr = view.name === "list" ? $app.querySelector("header.top") : null;
  if (hdr) { if (bar.previousElementSibling !== hdr) hdr.after(bar); bar.classList.add("inflow"); }
  else { if (bar.parentNode !== document.body) document.body.appendChild(bar); bar.classList.remove("inflow"); }
  // Göm den svävande pastillen när rutan "Du lagar det här" syns – annars täcker den Klar!/Avbryt
  if (cookHeadObs) { cookHeadObs.disconnect(); cookHeadObs = null; }
  bar.classList.remove("behind");
  const head = document.querySelector(".cooking-head");
  if (head && !hdr && "IntersectionObserver" in window) {
    cookHeadObs = new IntersectionObserver(es => { const b = document.getElementById("cookbar"); if (b) b.classList.toggle("behind", es.some(e => e.isIntersecting)); });
    cookHeadObs.observe(head);
  }
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
  showAlarm();
  document.querySelectorAll("#cookbar [data-end]").forEach(el => { const left = +el.dataset.end - Date.now(); el.textContent = left <= 0 ? "Klar!" : "⏱ " + fmtLeft(left); el.parentElement.classList.toggle("ring", left <= 0); });
}, 1000);
document.addEventListener("click", () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch {} }, { once: true });

// Larmruta när en timer är klar: kvittera, bocka av steget och se nästa
let alarmBeeps = 0, alarmLastBeep = 0;
function showAlarm(){
  const box = document.getElementById("alarm");
  const due = cookSession && document.visibilityState === "visible" ? (cookSession.timers || []).filter(t => t.end <= Date.now()).sort((a, b) => a.end - b.end)[0] : null;
  if (!due) { if (box) box.remove(); alarmBeeps = 0; return; }
  if (box && box.dataset.id === due.id) {   // redan uppe: påminn med ljud var 6:e sekund en stund
    if (Date.now() - alarmLastBeep > 6000 && alarmBeeps < 15) { alarmLastBeep = Date.now(); alarmBeeps++; beep(); }
    return;
  }
  if (box) box.remove();
  const r = recipes.find(x => x.id === cookSession.recipeId);
  const steps = (r && r.steps) || [];
  const idx = due.k && /^s\d+$/.test(due.k) ? +due.k.slice(1) : -1;
  const numOf = i => steps.slice(0, i + 1).filter(x => !x.startsWith("#")).length;
  let next = -1;
  for (let j = (idx >= 0 ? idx : -1) + 1; j < steps.length; j++) if (!steps[j].startsWith("#") && !(cookSession.done || {})["s" + j] && j !== idx) { next = j; break; }
  if (idx < 0) next = steps.findIndex((x, j) => !x.startsWith("#") && !(cookSession.done || {})["s" + j]);
  const nextDur = next >= 0 ? parseDurations(steps[next])[0] : null;
  const el = document.createElement("div");
  el.id = "alarm"; el.className = "alarm-bg"; el.dataset.id = due.id;
  el.innerHTML = `<div class="alarm" role="alertdialog" aria-labelledby="alarmT">
    <div class="alarm-ico" aria-hidden="true">⏰</div>
    <h2 id="alarmT">Timern är klar</h2>
    <p class="alarm-what">${idx >= 0 ? `<small>Steg ${numOf(idx)}</small>${esc(steps[idx])}` : esc(due.label || "Egen timer")}</p>
    ${next >= 0 ? `<div class="alarm-next"><small>Nästa · steg ${numOf(next)}</small>${esc(steps[next])}</div>` : (r ? `<div class="alarm-next"><small>Nästa</small>Alla steg är klara – smaklig måltid!</div>` : "")}
    <div class="alarm-btns">
      ${nextDur ? `<button class="btn accent" data-al="nexttimer">✓ Klart – starta nästa timer · ${(() => { const m = Math.round(nextDur.ms / 6e4); return nextDur.ms < 6e4 ? Math.round(nextDur.ms / 1e3) + " sek" : m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + m % 60 + " min" : "") : m + " min"; })()}</button>` : ""}
      ${idx >= 0 ? `<button class="btn ${nextDur ? "ghost" : "accent"}" data-al="next">✓ Steget klart – visa nästa</button>` : `<button class="btn accent" data-al="show">Visa receptet</button>`}
      <button class="btn ghost" data-al="ok">OK</button>
    </div></div>`;
  document.body.appendChild(el);
  alarmLastBeep = Date.now(); alarmBeeps = 0;
  el.querySelectorAll("[data-al]").forEach(b => b.onclick = () => {
    const a = b.dataset.al;
    el.remove();
    if ((a === "next" || a === "nexttimer") && idx >= 0 && cookSession) { cookSession.done = { ...(cookSession.done || {}), ["s" + idx]: true }; if (view.name === "detail" && view.id === cookSession.recipeId) detailState.done = cookSession.done; }
    stopTimer(due.id);
    if (a === "nexttimer" && nextDur) startTimer(nextDur.ms, `Steg ${numOf(next)}: ${nextDur.label}`, "s" + next);
    if (a !== "ok") openCookRecipe(); else if (view.name === "detail") render();
    try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch {}
  });
}

// Kommer man tillbaka till appen efter att timern ringt: sluta påminna via notiser
// Siffran på appikonen kommer bara från timer-notiser – nollställ den varje gång appen öppnas
const clearBadge = () => { try { navigator.clearAppBadge && navigator.clearAppBadge().catch(() => {}); } catch {} };
clearBadge();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { clearBadge(); if (me) logOpen(); }   // appen återupptas ur bakgrunden räknas också som öppnad
  if (document.visibilityState !== "visible" || !cookSession) return;
  (cookSession.timers || []).filter(t => t.end <= Date.now()).forEach(t => sb.rpc("recipe_timer_cancel", { p_id: t.id }).then(() => {}, () => {}));
  try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch {}
  showAlarm();
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
  const out = parseJson(await ai(prompt, { mode: "json", fast: true }));
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
  return `<button class="fbtn ${cls} ${filterOpen ? "open" : ""}" data-a="ftoggle" aria-expanded="${filterOpen}">Filtrera${filter.tags.length + (filter.by ? 1 : 0) ? `<span class="n">${filter.tags.length + (filter.by ? 1 : 0)}</span>` : ""}<span class="chev" aria-hidden="true">▾</span></button>`;
}
function filterPanelHtml(list){
  const count = t => filter.tags.includes(t) ? list.length : list.filter(r => (r.tags || []).includes(t)).length;
  const used = new Set(recipes.flatMap(r => r.tags || []));
  const other = [...used].filter(t => !tagVocab().includes(t)).sort((a, b) => a.localeCompare(b, "sv"));
  const groups = tagGroups();   // ord utanför listan ligger hopfällt under Övrigt
  const btn = t => { const n = count(t), on = filter.tags.includes(t); return `<button class="ftag ${on ? "on" : ""} ${!n && !on ? "dim" : ""}" data-a="tag" data-t="${esc(t)}" ${!n && !on ? "disabled" : ""}>${esc(t)}<small>${n}</small></button>`; };
  return `<div class="fpanel" role="dialog" aria-label="Filtrera">
    <div class="fp-head"><h3>Filtrera</h3><button class="iconbtn fp-x" data-a="fclose" aria-label="Stäng">×</button></div>
    ${byFilterHtml(list)}
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
  const dish = dishTypes();
  return tagGroups().concat(extra.length ? [["Övrigt", extra]] : []).map(([g, ts]) => `<div class="tp-grp${ts === dish ? " tp-req" : ""}"><span class="tp-g">${ts === dish ? "Typ av rätt" : esc(g)}</span>${ts.map(t => `<button type="button" class="ftag ${sel.includes(t) ? "on" : ""}" data-tp="${esc(t)}">${esc(t)}</button>`).join("")}</div>`).join("");
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

// ---------- aktivitetslogg (läses av superanvändare under Konto → Aktivitet) ----------
let logOffUntil = 0;   // saknas loggen i databasen: försök igen om en stund i stället för att ge upp
function logEvent(kind, r, detail){
  if (!me || !sb || Date.now() < logOffUntil) return;
  let dev = ""; try { const d = deviceInfo(); dev = d.kind + (d.installed ? "-app" : ""); } catch {}
  sb.rpc("recipe_log_event", { p_kind: kind, p_recipe: r && r.id || null, p_title: r && r.title || null, p_detail: detail || null, p_device: dev })
    .then(({ error }) => { if (error && /function|schema cache|does not exist/i.test(error.message || "")) logOffUntil = Date.now() + 5 * 6e4; }, () => {});
}
function logOpen(){
  try { const k = "logOpen:" + me, last = +localStorage.getItem(k) || 0; if (Date.now() - last < 30 * 6e4) return; localStorage.setItem(k, String(Date.now())); } catch {}
  logEvent("open");
}
const loggedViews = {};
function logView(id){
  if (!id || Date.now() - (loggedViews[id] || 0) < 15 * 6e4) return;
  const r = recipes.find(x => x.id === id); if (!r) return;   // recepten inte laddade än – försök vid nästa visning
  loggedViews[id] = Date.now();
  logEvent("view", r);
}

const LOG_TEXT = { open: "öppnade appen", view: "tittade på", cook_start: "började laga", cook_done: "lagade klart", cook_cancel: "avbröt tillagningen av",
  add: "lade till", edit: "ändrade", ai_search: "frågade Claude:", ai_web: "lät Claude leta på nätet:", ai_new: "fick ett nytt recept av Claude:", shop_add: "lade till inköpslistan:", variant: "gjorde en variant:", delete: "tog bort", import: "importerade ett recept", fav: "favoritmarkerade", unfav: "tog bort favorit:",
  added: "lade till", cooked: "lagade" };
const DEV_TEXT = { ios: "iPhone/iPad", android: "Android", mac: "Mac", pc: "Dator" };
async function openActivity(days){
  days = days || 30;
  openSheet(`<h2>Aktivitet</h2><div class="act-admin"><p class="meta">Laddar …</p></div>`);
  const box = () => document.querySelector(".act-admin");
  const { data, error } = await sb.rpc("recipe_admin_activity", { p_days: days });
  if (!box()) return;
  let events = [], users = [], note = "";
  if (error) {
    note = /function|schema cache|does not exist/i.test(error.message || "")
      ? "Loggen är inte påslagen än. Kör filen <b>supabase/activity.sql</b> i Supabase (SQL Editor → Run). Tills dess visas bara tillagda och lagade recept."
      : "Kunde inte hämta loggen: " + esc(error.message);
    events = activityEvents().filter(e => e.ts > Date.now() - days * 864e5).map(e => ({ at: new Date(e.ts).toISOString(), email: e.by, kind: e.kind === "variant" ? "variant" : e.kind, recipe_id: e.r.id, title: e.r.title }));
  } else { events = data.events || []; users = data.users || []; }
  let who = "";
  const draw = () => {
    const list = who ? events.filter(e => e.email === who) : events;
    const fmtT = t => t ? new Date(t).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "–";
    const byDay = []; for (const e of list.slice(0, 400)) { const d = relDay(Date.parse(e.at)); const g = byDay[byDay.length - 1]; if (g && g.d === d) g.e.push(e); else byDay.push({ d, e: [e] }); }
    box().innerHTML = `
      ${note ? `<p class="hnote">${note}</p>` : ""}
      <div class="aa-period">${[7, 30, 90].map(d => `<button class="ftag ${d === days ? "on" : ""}" data-days="${d}">${d} dagar</button>`).join("")}</div>
      ${users.length ? `<div class="aa-chips" role="group" aria-label="Visa person">
          <button class="aa-chip ${who ? "" : "on"}" data-who="">Alla</button>
          ${users.map(u => { const recent = u.last_seen && Date.now() - Date.parse(u.last_seen) < 864e5; return `<button class="aa-chip ${who === u.email ? "on" : ""}" data-who="${esc(u.email)}">
            <span class="aa-av">${esc((u.name || nameOf(u.email) || "?").slice(0, 1).toUpperCase())}${recent ? `<i class="aa-live" title="Aktiv senaste dygnet"></i>` : ""}</span>${esc((u.name || nameOf(u.email)).split(" ")[0])}</button>`; }).join("")}
        </div>` : ""}
      ${(() => { const u = who && users.find(x => x.email === who); return u ? `<p class="aa-who">${esc(ROLE_LABEL[u.role] || u.role)} · Inloggad ${esc(fmtT(u.last_sign_in_at))} · Senast aktiv ${esc(fmtT(u.last_seen))} · ${u.events_30d} händelser/30 d</p>` : ""; })()}
      ${byDay.length ? byDay.map(g => `<div class="aa-day"><h4>${esc(g.d)}</h4>${g.e.map(e => `<div class="aa-ev">
          <time>${new Date(e.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</time>
          <span>${evIcon(e.kind, recipes.find(r => r.id === e.recipe_id))}<b>${esc(nameOf(e.email))}</b> ${esc(LOG_TEXT[e.kind] || e.kind)}
          ${e.title ? (recipes.find(r => r.id === e.recipe_id) ? `<button class="linkbtn aa-r" data-rid="${esc(e.recipe_id)}">${esc(e.title)}</button>` : `<i>${esc(e.title)}</i>`) : ""}
          ${e.kind === "import" && e.detail ? `<small>${esc([e.detail.url, e.detail.bilder ? e.detail.bilder + " bilder" : "", e.detail.text ? "text" : ""].filter(Boolean).join(" · "))}</small>` : ""}
          ${e.device ? `<small class="aa-dev">${esc((DEV_TEXT[String(e.device).replace("-app", "")] || e.device) + (String(e.device).endsWith("-app") ? " · app" : ""))}</small>` : ""}</span></div>`).join("")}</div>`).join("")
        : `<p class="meta" style="padding:14px 0">Ingen aktivitet ${who ? "för " + esc(nameOf(who)) + " " : ""}de senaste ${days} dagarna.</p>`}
      ${users.length ? `<details class="aa-ulist"><summary>Användare och inloggningar <small>${users.length}</small></summary>
        <table><thead><tr><th>Namn</th><th>Inloggad</th><th>Senast aktiv</th><th>30 d</th></tr></thead><tbody>
        ${users.map(u => `<tr data-who="${esc(u.email)}"><td><b>${esc(u.name || nameOf(u.email))}</b><small>${esc(ROLE_LABEL[u.role] || u.role)}</small></td><td>${esc(fmtT(u.last_sign_in_at))}</td><td>${esc(fmtT(u.last_seen))}</td><td>${u.events_30d}</td></tr>`).join("")}
        </tbody></table></details>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="aaClose">Stäng</button></div>`;
    box().querySelectorAll("[data-days]").forEach(b => b.onclick = () => openActivity(+b.dataset.days));
    box().querySelectorAll("[data-who]").forEach(b => b.onclick = () => { who = who === b.dataset.who ? "" : b.dataset.who; draw(); const m = document.querySelector(".modal"); if (m) m.scrollTop = 0; });
    box().querySelectorAll("[data-rid]").forEach(b => b.onclick = () => { closeSheet(); detailState = { mode: "mine", servings: null, done: {}, tab: "ing", notesEdit: false, notesDraft: null }; view = { name: "detail", id: b.dataset.rid }; render(); window.scrollTo(0, 0); });
    $id("aaClose").onclick = closeSheet;
  };
  draw();
}


// ---------- Fråga Claude: smartare sökning när vanliga sökningen inte räcker ----------
let aiSearch = null;   // { q, busy, items: [{id, why}], answer, err }
// Lokal, ungefärlig sökning: poäng per ord som finns (eller nästan finns) i titel, taggar och ingredienser
const NEAR_STOP = new Set("och med i på en ett är men bra till som av för utan gärna optional eller om den det de jag vill ha lite mycket typ samt plus eller".split(" "));
function nearRecipes(q, exclude){
  const words = q.toLowerCase().replace(/[^a-zåäöéü0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 2 && !NEAR_STOP.has(w));
  if (!words.length) return [];
  const skip = new Set((exclude || []).map(r => r.id));
  const stem = w => w.length > 5 ? w.slice(0, Math.max(4, Math.ceil(w.length * .7))) : w;
  const has = (hay, w) => hay.includes(w) || (w.length > 4 && hay.includes(stem(w)));
  const out = [];
  for (const r of recipes) {
    if (skip.has(r.id)) continue;
    const title = (r.title || "").toLowerCase(), tags = (r.tags || []).join(" ").toLowerCase();
    const ings = (r.ingredients || []).filter(x => !x.startsWith("#")).join(" ").toLowerCase();
    let score = 0; const hit = [];
    for (const w of words) {
      let p = 0;
      if (has(title, w)) p = 3; else if (has(tags, w)) p = 2; else if (has(ings, w)) p = 2;
      if (p) { score += p; hit.push(w); }
    }
    if (score) out.push({ r, score, hit });
  }
  out.sort((a, b) => b.score - a.score || (b.r.rating || 0) - (a.r.rating || 0));
  const best = out[0] ? out[0].score : 0;
  return out.filter(x => x.score >= Math.max(2, best / 2)).slice(0, 6)
    .map(x => ({ r: x.r, cov: x.hit.length / words.length, why: `Har ${x.hit.slice(0, 4).join(", ")}${x.hit.length < words.length ? ` – saknar ${words.filter(w => !x.hit.includes(w)).slice(0, 3).join(", ")}` : ""}` }));
}
var qIdleTimer = null;
// Gratis bedömning av hur väl receptboken matchar sökningen: ok (bra träff) / mid (delvis) / none
function searchLevel(list){
  const q = filter.q.trim();
  const near = list.length < 4 ? nearRecipes(q, list) : [];
  const best = list.length ? 1 : (near[0] ? near[0].cov : 0);
  return { near, level: best >= 0.85 ? "ok" : best >= 0.4 ? "mid" : "none" };
}
// Raden direkt under sökfältet: "Sök AI-recept" (pappa letar på nätet – kostar, kräver ett tryck)
function aiBarHtml(list){
  const q = filter.q.trim();
  if (q.length < 2 || !sample) return "";
  if (aiSearch && aiSearch.q === q && aiSearch.web) return "";
  const { near, level } = searchLevel(list);
  const globe = s => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;
  if (level === "ok") return `<div class="aibar ok"><span>Vill du se fler?</span><button class="ais-link" data-a="aiweb">${globe(15)}Sök AI-recept</button></div>`;
  if (level === "none") return `<div class="aibar none"><span class="ab-t">${near.length ? "Inget i receptboken passar riktigt." : "Inga recept i receptboken matchar."}<small class="ab-long">Pappa kan leta nya recept på nätet.</small></span>
    <button class="ais-big" data-a="aiweb">${globe(24)}<span><b>Sök AI-recept</b><small>Pappa letar på nätet</small></span><em>→</em></button></div>`;
  return `<div class="aibar"><span>Hittar du inte rätt?<span class="ab-long"> Pappa kan leta nya recept på nätet.</span></span><button class="aiq aiq-gold" data-a="aiweb">${globe(17)}Sök AI-recept</button></div>`;
}
function aiSearchHtml(list){
  const q = filter.q.trim();
  if (q.length < 2 || !sample) return "";
  const s = aiSearch && aiSearch.q === q ? aiSearch : null;
  const bulb = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><path d="M11.5 11a2.6 2.6 0 0 0-1.5 4.7v1h3v-1A2.6 2.6 0 0 0 11.5 11z" fill="currentColor" fill-opacity=".3"/><path d="M10.4 18h2.2"/></svg>`;
  const card = (r, why) => `<button class="ais-item" data-a="open" data-id="${esc(r.id)}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : `<span class="ais-ph"></span>`}
      <span><b>${esc(r.title)}${r.variantOf ? ` <small class="badge mod">${esc(variantBadge(r))}</small>` : ""}</b><small>${esc(why || "")}</small></span></button>`;
  const askBtn = `<button class="aiq" data-a="aisearch"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><path d="M10 12.8a1.6 1.6 0 1 1 2.3 1.4c-.5.3-.8.7-.8 1.2v.4"/><path d="M11.5 17.6h.01"/></svg>Fråga pappa</button>`;
  // "Fråga pappa" är borttagen – bara "Hitta nya recept" (nätet, kostar) under en avdelare
  const btns = () => webBtn.replace('<div class="ais-webbtn">', '<div class="ais-dv"><span>Hittar du inte rätt?</span></div><div class="ais-webbtn">');
  const webBtn =`<div class="ais-webbtn"><button class="aiq aiq-gold" data-a="aiweb"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>Sök AI-recept</button></div>`;
  // Direkt medan man skriver: närmaste recept i receptboken, även när inte alla ord stämmer
  const near = list.length < 4 ? nearRecipes(q, list) : [];
  const nearList = near.length ? `<div class="ais-sub">Närmast i receptboken</div><div class="ais-list">${near.map(x => card(x.r, x.why)).join("")}</div>` : "";
  if (!s || s.busy || s.err) {
    // Knappen "Sök AI-recept" ligger i raden under sökfältet (aiBarHtml); här visas bara förslagen
    const { level } = searchLevel(list);
    const badge = level === "ok" ? `<span class="qbadge ok">Bra träff</span>` : level === "mid" ? `<span class="qbadge mid">Delvis</span>` : "";
    if (!nearList) return "";
    return `<div class="aisearch near">${nearList.replace("Närmast i receptboken</div>", `Närmast i receptboken ${badge}</div>`)}
      ${s && s.busy ? `<p class="ais-status"><span class="aw-s">Pappa letar i receptboken …</span></p>` : ""}
      ${s && s.err ? `<p class="ais-ans">Pappa kunde inte svara just nu. <button class="linkbtn" data-a="aisearch">Försök igen</button></p>` : ""}
    </div>`;
  }
  const items = s.items.map(it => ({ ...it, r: recipes.find(r => r.id === it.id) })).filter(x => x.r);
  return `<div class="aisearch">
    <div class="ais-head"><span class="ais-ico">${bulb}</span><b>Pappa föreslår</b><button class="iconbtn ais-x" data-a="aisearchclose" aria-label="Stäng">×</button></div>
    ${s.answer && !s.webOnly ? `<p class="ais-ans">${esc(s.answer)}</p>` : ""}
    ${!s.good && s.web ? aiWebHtml(s) : ""}
    ${items.length ? `${s.good ? "" : `<div class="ais-sub">Närmast i receptboken</div>`}<div class="ais-list">${items.map(x => card(x.r, x.why)).join("")}</div>`
      : s.webOnly ? nearList : ""}
    ${!s.web ? btns(s.webOnly) : ""}
    ${s.good && s.web ? aiWebHtml(s) : ""}
    ${aiNewHtml(s)}
  </div>`;
}
async function runAiSearch(){
  const q = filter.q.trim(); if (!q) return;
  aiSearch = { q, busy: true, items: [] }; renderList();
  const cat = recipes.map(r => ({ id: r.id, titel: r.title, variant: r.variantOf ? variantLabel(r) : undefined, taggar: r.tags || [], tid: r.time || undefined,
    portioner: r.servings || undefined, betyg: r.rating || undefined, lagad: r.timesCooked || undefined,
    ingredienser: (r.ingredients || []).filter(x => !x.startsWith("#")).slice(0, 18).map(x => x.slice(0, 60)),
    anteckning: (r.notes || r.myChanges || "").slice(0, 120) || undefined }));
  const prompt = `Du hjälper en familj att hitta rätt recept i deras egen receptbok. De sökte på: "${q}"
Tolka frågan fritt: det kan vara ingredienser de har hemma, ett tillfälle, en känsla, en tid, en kategori eller en halvt ihågkommen rätt.
Sökningen är en ÖNSKAN, inte ett krav. Ett recept behöver inte innehålla allt – det räcker att det träffar kärnan (t.ex. samma huvudråvara, samma typ av rätt eller samma smakriktning). Det som sägs vara valfritt ("optional", "gärna", "om det finns") ska inte styra urvalet alls. Tillbehör kan ofta läggas till eller bytas, så ett recept med rätt huvudråvara men andra tillbehör är en bra träff.
Välj upp till 6 recept ur listan, bäst först: först de som träffar mest, sedan de som ligger närmast. Lämna listan tom ENDAST om inget recept har någon rimlig koppling till önskan. Använd bara id:n från listan.
Skriv i "varför" kort vad som stämmer och, om något saknas, vad man kan lägga till eller byta (t.ex. "torsk och brynt smör – lägg till kapris").
Varje recept du nämner i "svar" MÅSTE också finnas med i "recept", med exakt id från listan.
Sätt "bra" STRÄNGT: true bara om minst ett recept i stort sett ÄR rätten de beskriver – huvudråvaran OCH det som ger rätten dess karaktär (de smaker, såser och tillbehör de nämner, utom det som sägs vara valfritt) finns redan i receptet. Om receptet behöver kompletteras med något av det de nämner (t.ex. "lägg till kapris och brynt smör") eller har en annan sås/smakriktning, är "bra" false – även om huvudråvaran stämmer. Vid tvekan: false. Då letar appen efter bättre recept på nätet, och dina förslag visas ändå som "närmast i receptboken".
Svara bara med JSON: {"svar": "en kort mening på svenska", "bra": true, "recept": [{"id": "...", "titel": "receptets titel", "varför": "kort motivering, max 14 ord"}]}

Receptboken:
${JSON.stringify(cat)}`;
  try {
    const out = parseJson(await ai(prompt, { mode: "json" }));
    if (!aiSearch || aiSearch.q !== q) return;
    // Hitta receptet även om Claude skrivit id:t lite fel – matcha då på titel
    const norm = t => String(t || "").toLowerCase().replace(/[^a-zåäö0-9]+/g, " ").trim();
    const findR = x => recipes.find(r => r.id === x.id) || recipes.find(r => norm(r.title) === norm(x.titel || x.title || x.id))
      || recipes.find(r => norm(x.titel || x.id).length > 3 && (norm(r.title).includes(norm(x.titel || x.id)) || norm(x.titel || x.id).includes(norm(r.title))));
    const seen = new Set();
    const items = (out.recept || []).map(x => { const r = findR(x || {}); return r && !seen.has(r.id) && seen.add(r.id) ? { id: r.id, why: x["varför"] || x.varfor || "" } : null; }).filter(Boolean);
    // Nämner svaret ett recept som inte kom med i listan? Lägg till det.
    const ans = norm(out.svar);
    recipes.forEach(r => { const t = norm(r.title); if (t.length > 4 && ans.includes(t) && !seen.has(r.id)) { seen.add(r.id); items.push({ id: r.id, why: "" }); } });
    const good = out.bra !== false && items.length > 0;
    aiSearch = { ...aiSearch, q, busy: false, answer: out.svar || "", items, good };
    logEvent("ai_search", null, { q, träffar: aiSearch.items.length });
    // Inget riktigt bra i receptboken: leta på nätet
    // Ingen automatisk nätsökning (kostar) – knappen "Sök recept på nätet" visas i stället
  } catch (e) {
    if (!aiSearch || aiSearch.q !== q) return;
    aiSearch = { ...aiSearch, q, busy: false, items: [], err: e && e.code === "auth" ? "Logga in igen och försök på nytt." : "Försök igen om en stund." };
  }
  if (view.name === "list") renderList();
}

// Recept från nätet när receptboken inte har något riktigt bra (Claudes webbsökning)
function aiWebHtml(s){
  const w = s && s.web; if (!w) return "";
  const globe = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;
  if (w.busy) return `<div class="ais-web"><div class="ais-sub">${globe} Från nätet</div><p class="ais-status"><span class="aw-s">Pappa kollar på nätet …</span></p></div>`;
  if (w.err) return `<div class="ais-web"><div class="ais-sub">${globe} Från nätet</div><p class="ais-ans">${esc(w.err)} <button class="linkbtn" data-a="aiweb">Försök igen</button></p></div>`;
  return `<div class="ais-web"><div class="ais-sub">${globe} Från nätet</div>
    ${w.answer ? `<p class="ais-ans">${esc(w.answer)}</p>` : ""}
    ${(w.items || []).length ? `<div class="aiw-list">${w.items.map((x, i) => `<div class="aiw-item">
      <div class="aiw-t"><b>${esc(x.titel || "")}</b><small>${esc(x.sajt || "")}</small></div>
      ${x.beskrivning ? `<p>${esc(x.beskrivning)}</p>` : ""}
      ${x.varför ? `<p class="aiw-why">${esc(x.varför)}</p>` : ""}
      <div class="aiw-btns"><button class="btn accent small" data-a="aiwebview" data-i="${i}">Visa receptet</button><button class="btn ghost small" data-a="aiwebimport" data-i="${i}">Spara i receptboken</button></div>
    </div>`).join("")}</div>` : `<p class="ais-ans">Hittade inga bra recept på nätet heller.</p>`}
    ${!s.nw ? `<p class="ais-more"><button class="linkbtn" data-a="ainew">Låt pappa skriva ett eget recept i stället</button></p>` : ""}
  </div>`;
}
// Sparade AI-svar (Supabase-tabellen recipe_ai_cache) – samma sökning/sida kostar inte igen
var aiCacheOff = false;
async function aiCacheGet(key, maxDays){
  if (aiCacheOff) return null;
  try {
    const { data, error } = await sb.from("recipe_ai_cache").select("data, created_at").eq("key", key).maybeSingle();
    if (error) { if (/does not exist|relation|schema cache|42P01|PGRST20/i.test(error.message || "")) aiCacheOff = true; return null; }
    if (!data || Date.now() - new Date(data.created_at).getTime() > maxDays * 864e5) return null;
    return data.data;
  } catch { return null; }
}
async function aiCacheSet(key, data){
  if (aiCacheOff) return;
  try { const { error } = await sb.from("recipe_ai_cache").upsert({ key, data, created_at: new Date().toISOString() }); if (error && /does not exist|relation|schema cache|42P01|PGRST20/i.test(error.message || "")) aiCacheOff = true; } catch {}
}
const aiKey = q => q.toLowerCase().replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
async function runAiWeb(q){
  q = q || filter.q.trim(); if (!q) return;
  clearTimeout(qIdleTimer);
  if (!aiSearch || aiSearch.q !== q) aiSearch = { q, busy: false, items: [], good: true, webOnly: true, answer: "" };
  aiSearch.web = { busy: true }; if (view.name === "list") renderList();
  const prompt = `En svensk familj letar efter ett recept. Deras önskan: "${q}"
Sök på nätet och hitta 3 riktigt bra recept som matchar önskan. Tolka den som en önskan, inte ett krav: kärnan (huvudråvara och typ av rätt) ska stämma, det som sägs vara valfritt behöver inte finnas med.
Föredra seriösa svenska receptsajter (t.ex. ICA, Köket.se, Arla, Coop, Mathem, Tasteline, Zeta, Allt om Mat) och kända kockar, men bra utländska sajter går också. Välj recept med tydliga ingredienser och steg.
Använd BARA sidor du faktiskt hittat i sökningen, med exakt adress till själva receptsidan (inte en söksida eller startsida).
Svara bara med JSON, utan annan text: {"svar": "en kort mening på svenska", "recept": [{"titel": "receptets namn", "sajt": "t.ex. ICA", "url": "https://...", "beskrivning": "en mening om rätten", "varför": "vad som matchar önskan, max 14 ord"}]}`;
  try {
    // Samma sökning de senaste två veckorna? Använd det sparade svaret (gratis)
    const ck = "web:" + aiKey(q);
    const hit = await aiCacheGet(ck, 14);
    if (hit && (hit.items || []).length) {
      if (!aiSearch || aiSearch.q !== q) return;
      aiSearch.web = { answer: hit.answer || "", items: hit.items };
      logEvent("ai_web", null, { q, träffar: hit.items.length, sparat: true });
      if (view.name === "list") renderList();
      return;
    }
    const out = parseJson(await ai(prompt, { mode: "json", web: true }));
    if (!aiSearch || aiSearch.q !== q) return;
    const items = (out.recept || []).filter(x => x && /^https?:\/\//.test(x.url || "") && x.titel).slice(0, 4);
    aiSearch.web = { answer: out.svar || "", items };
    if (items.length) aiCacheSet(ck, { answer: out.svar || "", items });
    logEvent("ai_web", null, { q, träffar: items.length });
  } catch (e) {
    if (!aiSearch || aiSearch.q !== q) return;
    aiSearch.web = { err: aiErr(e) };
  }
  if (view.name === "list") renderList();
}
// ---------- Visa ett recept från nätet som om det fanns i appen (inte sparat) ----------
var webCur = null, webCache = {};
async function loadWebRecipe(w){
  if (webCache[w.url] && !webCache[w.url].err) return;
  webCache[w.url] = { busy: true };
  const done = () => { if (view.name === "web" && webCur && webCur.url === w.url) render(); };
  try {
    // Har någon i familjen redan öppnat receptet? Använd det sparade (gratis)
    const ck = "page:" + w.url;
    const hit = await aiCacheGet(ck, 60);
    if (hit && hit.r) { webCache[w.url] = { r: hit.r, image: hit.image || null }; done(); return; }
    const { data: { session } } = await sb.auth.getSession();
    const hdr = { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) };
    let j = {};
    try { const r = await fetch("/api/fetch", { method: "POST", headers: hdr, body: JSON.stringify({ url: w.url, withImage: true }) }); j = await r.json().catch(() => ({})); if (!r.ok) j = {}; } catch {}
    let out, image = j.image || null;
    if (j.text && j.text.length > 200) {
      out = parseJson(await ai(importPrompt({ url: w.url, text: j.text, translate: true }), { mode: "json", fast: true }));
    }
    if (!out || out.error || !(out.ingredients || []).length) {
      // Sajten blockerar vår server (t.ex. ICA): låt Claude hämta sidan själv
      const p = `Hämta receptsidan ${w.url} med verktyget web_fetch och läs ut receptet därifrån. Lägg också till fältet "image" med adressen till receptets huvudbild om den syns på sidan (annars tom sträng).\n` + importPrompt({ url: w.url, text: "", translate: true });
      out = parseJson(await ai(p, { mode: "json", fetchUrl: w.url }));
      if (!image && out && /^https?:\/\//.test(out.image || "")) {
        try { const r = await fetch("/api/fetch", { method: "POST", headers: hdr, body: JSON.stringify({ url: out.image, imageOnly: true }) }); const k = await r.json().catch(() => ({})); if (r.ok && k.image) image = k.image; } catch {}
      }
    }
    if (!out || out.error) throw new Error(out && out.error ? out.error : "Hittade inget recept på sidan");
    webCache[w.url] = { r: parseImported(out), image };
    // Spara för nästa gång, med bilden förminskad
    (async () => { let small = null; if (image) { try { small = await compress(await (await fetch(image)).blob(), 1000, 220000); } catch {} } aiCacheSet(ck, { r: webCache[w.url].r, image: small }); })();
  } catch (e) {
    webCache[w.url] = { err: e && e.message ? e.message : aiErr(e) };
  }
  done();
}
function renderWebPreview(){
  const w = webCur;
  if (!w) { view = { name: "list" }; return renderList(); }
  const c = webCache[w.url] || { busy: true };
  const r = c.r || {};
  const title = r.title || w.titel || "Recept";
  const site = w.sajt || (() => { try { return new URL(w.url).host.replace(/^www\./, ""); } catch { return "nätet"; } })();
  const ings = r.ingredients || [], steps = r.steps || [];
  const tab = detailState.tab || "ing";
  const globe = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;
  $app.innerHTML = `
    <div class="hero ${c.image ? "" : "noimg"}">
      ${c.image ? `<img src="${esc(c.image)}" alt="">` : ""}
      <button class="fback" data-a="webback" aria-label="Tillbaka till sökningen"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <div class="hero-cap"><div class="row"><span class="badge">${esc(site)}</span></div><h1 class="dtitle">${esc(title)}</h1></div>
    </div>
    <div class="webban">${globe}<span>Från <b>${esc(site)}</b> – inte sparat i receptboken</span>${c.r ? `<button class="btn accent small" data-a="websave">Spara i receptboken</button>` : ""}</div>
    ${c.busy ? `<p class="meta web-wait"><span class="spinner"></span> Hämtar receptet från ${esc(site)} …</p>` : ""}
    ${c.err ? `<div class="web-wait"><p class="meta">${esc(c.err)}.</p><p class="row" style="gap:16px;justify-content:center"><button class="linkbtn" data-a="webretry">Försök igen</button><a class="linkbtn" href="${esc(w.url)}" target="_blank" rel="noopener">Öppna sidan i stället</a></p></div>` : ""}
    ${c.r ? `
    <div class="meta" style="margin-top:10px">
      ${r.time ? `<span>${esc(r.time)}</span>` : ""}${r.servings ? `<span>${r.servings} portioner</span>` : ""}<span><a href="${esc(w.url)}" target="_blank" rel="noopener">Källa: ${esc(site)}</a></span>
    </div>
    <div class="cook" id="cook" data-tab="${tab}">
      <div class="ctabs" role="tablist">
        <button role="tab" class="${tab === "ing" ? "on" : ""}" data-a="ctab" data-t="ing">Ingredienser<small>${ings.filter(l => !l.startsWith("#")).length}</small></button>
        <button role="tab" class="${tab === "steps" ? "on" : ""}" data-a="ctab" data-t="steps">Gör så här<small>${steps.filter(x => !x.startsWith("#")).length}</small></button>
      </div>
      <div class="panel cpane cp-ing"><h2>Ingredienser</h2>
        ${ings.length ? `<ul class="ings">${ings.map(l => l.startsWith("#") ? `<li class="group">${esc(l.replace(/^#+\s*/, ""))}</li>` : `<li><span>${esc(l)}</span></li>`).join("")}</ul>` : `<p class="meta">Inga ingredienser hittades.</p>`}
      </div>
      <div class="panel cpane cp-steps"><h2>Gör så här</h2>
        ${steps.length ? `<ol class="steps">${(() => { let n = 0; return steps.map(s => s.startsWith("#") ? (n = 0, `<li class="group">${esc(s.replace(/^#+\s*/, ""))}</li>`) : `<li data-n="${++n}">${esc(s)}</li>`).join(""); })()}</ol>` : `<p class="meta">Inga steg hittades.</p>`}
      </div>
      <button class="cnext" data-a="ctab" data-t="${tab === "ing" ? "steps" : "ing"}">${tab === "ing" ? "Till Gör så här →" : "← Till ingredienserna"}</button>
    </div>
    ${r.notes ? `<div class="panel"><h2>Tips</h2><p class="prewrap">${esc(r.notes)}</p></div>` : ""}
    <div class="web-foot"><button class="btn accent" data-a="websave">Spara i receptboken</button><button class="btn ghost" data-a="webback">Tillbaka till sökningen</button></div>` : ""}`;
}
async function saveWebRecipe(){
  const w = webCur, c = w && webCache[w.url]; if (!c || !c.r) return;
  document.querySelectorAll('[data-a="websave"]').forEach(b => { b.disabled = true; b.innerHTML = `<span class="spinner"></span> Sparar …`; });
  let photo = null;
  if (c.image) { try { photo = await storePhoto(await compress(await (await fetch(c.image)).blob(), 1200, 400000)); } catch {} }
  draft = { ...c.r, sourceUrl: w.url, myChanges: "", photo };
  view = { name: "edit" }; render(); window.scrollTo(0, 0);
}
// Nytt receptförslag från Claude, utöver det som redan finns i boken
function aiNewHtml(s){
  const n = s && s.nw; if (!n) return "";
  if (n.busy) return `<div class="ais-new"><div class="ain-h"><small>Nytt förslag</small></div><p class="ais-ans"><span class="aw-s">Pappa skriver ett riktigt bra recept åt dig …</span></p></div>`;
  if (n.err || !n.r) return `<div class="ais-new"><p class="ais-ans">Kunde inte ta fram ett nytt förslag. <button class="linkbtn" data-a="ainew">Försök igen</button></p></div>`;
  const r = n.r;
  const ings = (r.ingredienser || []).map(l => String(l).startsWith("#") ? `<li class="group">${esc(String(l).replace(/^#\s*/, ""))}</li>` : `<li>${esc(l)}</li>`).join("");
  let k = 0; const steps = (r.steg || []).map(x => String(x).startsWith("#") ? `<li class="group">${esc(String(x).replace(/^#\s*/, ""))}</li>` : `<li data-n="${++k}">${esc(x)}</li>`).join("");
  return `<div class="ais-new">
    <div class="ain-h"><small>Nytt förslag från pappa</small></div>
    <h3>${esc(r.titel || "")}</h3>
    ${r.beskrivning ? `<p class="ain-d">${esc(r.beskrivning)}</p>` : ""}
    ${r.receptboken ? `<p class="ain-rel"><span aria-hidden="true">↳</span> ${esc(r.receptboken)}</p>` : ""}
    <p class="ain-m">${[r.tid, r.portioner ? r.portioner + " portioner" : "", (r.ingredienser || []).filter(x => !String(x).startsWith("#")).length + " ingredienser"].filter(Boolean).map(esc).join(" · ")}</p>
    ${n.open ? `<div class="ain-body"><div><h4>Ingredienser</h4><ul class="ings">${ings}</ul></div><div><h4>Gör så här</h4><ol class="steps">${steps}</ol></div></div>` : ""}
    <div class="ain-btns">
      <button class="btn accent small" data-a="ainewsave">Spara i receptboken</button>
      <button class="btn ghost small" data-a="ainewopen">${n.open ? "Dölj receptet" : "Visa hela receptet"}</button>
      <button class="linkbtn" data-a="ainew">Ge mig ett annat</button>
    </div>
  </div>`;
}
async function runAiNew(q){
  q = q || (aiSearch && aiSearch.q); if (!q || !aiSearch) return;
  const avoid = (aiSearch.nw && aiSearch.nw.tried) || [];
  aiSearch.nw = { busy: true, tried: avoid }; if (view.name === "list") renderList();
  const liked = recipes.filter(r => (r.rating || 0) >= 4 || (r.timesCooked || 0) >= 2).slice(0, 12).map(r => r.title);
  const prompt = `Du är en skicklig kock och skriver för en svensk familj som gillar att laga god mat. De sökte i sin receptbok på: "${q}"
Skriv ETT riktigt bra recept som svarar mot sökningen – något du själv skulle rekommendera, med tydlig smak och en detalj som gör det lite extra.
Sökningen är en önskan: ta fasta på kärnan. Det som sägs vara valfritt ("optional", "gärna", "om det finns") tar du med som ett tips eller en variant i stegen, inte som ett krav. Det ska fungera i ett vanligt svenskt hemmakök med råvaror från en välsorterad butik.
${liked.length ? `Rätter familjen gillar (för att förstå smaken, kopiera dem inte): ${liked.join(", ")}.` : ""}
Det här är deras receptbok (titel – nyckelord): ${recipes.filter(r => !r.variantOf).map(r => `${r.title}${(r.tags || []).length ? " – " + r.tags.join("/") : ""}`).join("; ")}.
Utgå från receptboken: förstå vad de gillar och hur de lagar mat, och föreslå något som passar in men tillför något nytt. Föreslå inte något de redan har.${avoid.length ? ` Föreslå inte heller: ${avoid.join(", ")}.` : ""}
Om ett av deras recept redan ligger nära sökningen: säg kort vad ditt förslag gör annorlunda, eller vad i boken det passar bra ihop med (t.ex. tillbehör eller förrätt).
Regler: svenska, svenska mått (g, dl, msk, tsk, st), 4 portioner om inget annat framgår. Skriv tider med siffror i stegen (t.ex. "15 min"), så att appen kan visa timers. Rubriker i ingredienser eller steg skrivs som "# Rubrik". Nyckelord ENBART från listan: ${tagVocab().join(", ")}.${dishTypes().length ? ` Exakt ett av dem ska vara typ av rätt: ${dishTypes().join(", ")}.` : ""}
Svara bara med JSON: {"titel": "...", "beskrivning": "en lockande mening", "receptboken": "en kort mening om hur det förhåller sig till eller passar ihop med något av deras recept – nämn receptet vid namn", "portioner": 4, "tid": "t.ex. 45 min", "taggar": ["..."], "ingredienser": ["..."], "steg": ["..."]}`;
  try {
    const r = parseJson(await ai(prompt, { mode: "json" }));
    if (!aiSearch || aiSearch.q !== q) return;
    if (!r || !r.titel || !(r.steg || []).length) throw new Error("tomt");
    aiSearch.nw = { r, tried: avoid.concat(r.titel) };
  } catch {
    if (!aiSearch || aiSearch.q !== q) return;
    aiSearch.nw = { err: true, tried: avoid };
  }
  if (view.name === "list") renderList();
}
function saveAiNew(){
  const r = aiSearch && aiSearch.nw && aiSearch.nw.r; if (!r) return;
  draft = { title: r.titel || "", sourceUrl: "", servings: +r.portioner || 4, time: r.tid || "", tags: (r.taggar || []).filter(t => tagVocab().includes(t)),
    ingredients: (r.ingredienser || []).map(String), steps: (r.steg || []).map(String), myChanges: "", notes: r.beskrivning ? r.beskrivning + " (Förslag från Claude)" : "Förslag från Claude", photo: null };
  logEvent("ai_new", { id: null, title: draft.title }, { q: aiSearch.q });
  view = { name: "edit" }; render(); window.scrollTo(0, 0);
  toast("Kolla igenom och tryck Spara");
}

// ---------- aviseringar till familjen (push, även när appen är stängd) ----------
// added/cooked → alla andra; liked/variant → receptets skapare. Mottagare och deras val räknas ut i databasen.
const NOTIFY_KINDS = [
  ["added", "Nya recept", "När någon lägger till ett recept"],
  ["cooked", "Någon lagar", "När någon lagar ett recept"],
  ["liked", "Någon gillar ditt recept", "När någon gör ett av dina recept till favorit"],
  ["variant", "Variant av ditt recept", "När någon gör en egen variant av ett av dina recept"],
];
function notify(kind, r, extra){
  if (!me || !sb || !r || !r.id) return;
  sb.rpc("recipe_notify", { p_kind: kind, p_recipe: r.id, p_extra: extra || null }).then(() => {}, () => {});
}
// Har enheten redan sagt ja till notiser: se till att den är registrerad (t.ex. ny telefon eller ny inloggning)
setTimeout(() => { try { if (me && "Notification" in window && Notification.permission === "granted") ensurePush(); } catch {} }, 4000);

async function openNotifySettings(){
  openSheet(`<div class="sheet-head"><h2>Aviseringar</h2><button class="iconbtn fp-x" id="closeSheetBtn" aria-label="Stäng">×</button></div><div class="nf-body"><p class="meta">Laddar …</p></div>`);
  $id("closeSheetBtn").onclick = closeSheet;
  const box = () => document.querySelector(".nf-body");
  let prefs = {}, missing = false;
  const { data, error } = await sb.rpc("recipe_notify_prefs_get");
  if (error) missing = true; else { prefs = data || {}; nfPrefs = prefs; }
  if (!box()) return;
  const d = deviceInfo();
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const devState = !supported ? (d.kind === "ios" && !d.installed ? "ios" : "unsupported") : Notification.permission;
  const DEV = {
    granted: ["Aviseringar är på", "Du får aviseringar här även när appen är stängd."],
    denied: ["Aviseringar är blockerade", "Tillåt aviseringar för appen i telefonens eller webbläsarens inställningar."],
    ios: ["Lägg appen på hemskärmen först", "På iPhone fungerar aviseringar bara i appen på hemskärmen. Se Hjälp."],
    unsupported: ["Stöds inte i den här webbläsaren", "Prova Chrome, Edge eller Safari."],
    default: ["Aviseringar är av", "Slå på för att få aviseringar på den här enheten."],
  }[devState] || ["Aviseringar är av", ""];
  // Slå på allt: enheten + alla händelser med ett tryck (visas tills allt är på)
  const allOn = devState === "granted" && NOTIFY_KINDS.every(([k]) => prefs[k] !== false);
  const showAll = !missing && !allOn && ["default", "granted", "ios"].includes(devState);
  box().innerHTML = `
    ${missing ? `<p class="hnote">Aviseringarna är inte påslagna i databasen än. Kör <b>supabase/notify.sql</b> i Supabase (SQL Editor → Run).</p>` : ""}
    ${showAll ? `<div class="nfa-big">${NF_ASK_BELL}<span class="t"><b>Slå på allt</b><small>${devState === "granted" ? "Alla händelser nedan, med ett tryck." : "Den här enheten och alla händelser, med ett tryck."}</small></span><button class="btn accent small" id="nfAll">Slå på allt</button></div>` : ""}
    <div class="sgrp"><h3>Den här enheten</h3>
      <div class="srow nf-dev"><span class="st"><b>${DEV[0]}</b><small>${DEV[1]}</small></span>
        ${devState === "default" && !showAll ? `<button class="btn accent small" id="nfOn">Slå på</button>` : devState === "granted" && !missing ? `<button class="btn ghost small" id="nfTest">Testa</button>` : ""}</div></div>
    <div class="sgrp"><h3>Meddela mig när</h3>
      ${NOTIFY_KINDS.map(([k, t, s]) => { const on = prefs[k] !== false; return `<label class="srow nf-row ${on ? "on" : ""}"><span class="st"><b>${t}</b><small>${s}</small></span><span class="nf-state">${on ? "På" : "Av"}</span><span class="sw"><input type="checkbox" data-k="${k}" ${on ? "checked" : ""} ${missing ? "disabled" : ""} aria-label="${t}"><i></i></span></label>`; }).join("")}
    </div>
    <p class="meta">Timrar under matlagningen ringer alltid. Valen gäller alla dina enheter.</p>`;
  box().querySelectorAll("input[data-k]").forEach(i => i.onchange = async () => {
    prefs[i.dataset.k] = i.checked;
    const row = i.closest(".nf-row"); row.classList.toggle("on", i.checked); row.querySelector(".nf-state").textContent = i.checked ? "På" : "Av";
    const { error } = await sb.rpc("recipe_notify_prefs_set", { p_prefs: prefs });
    toast(error ? "Kunde inte spara" : i.checked ? "Påslaget" : "Avstängt");
  });
  if ($id("nfAll")) $id("nfAll").onclick = async () => {
    if (devState === "ios") { nfAskIosSheet(); return; }
    const btn = $id("nfAll"); btn.disabled = true;
    const st = await ensurePush();
    if (st !== "ok") { toast(st === "denied" ? "Aviseringar blockerades. Ändra i telefonens inställningar." : "Det gick inte att slå på aviseringar"); openNotifySettings(); return; }
    NOTIFY_KINDS.forEach(([k]) => { prefs[k] = true; });
    const { error } = await sb.rpc("recipe_notify_prefs_set", { p_prefs: prefs });
    toast(error ? "Enheten är på, men valen kunde inte sparas" : "Allt är påslaget");
    openNotifySettings();
  };
  if ($id("nfOn")) $id("nfOn").onclick = async () => { const st = await ensurePush(); toast(st === "ok" ? "Aviseringar påslagna" : "Det gick inte att slå på aviseringar"); openNotifySettings(); };
  if ($id("nfTest")) $id("nfTest").onclick = async () => {
    const st = await ensurePush();
    const { error } = st === "ok" ? await sb.rpc("recipe_notify_test") : { error: true };
    toast(error ? "Kunde inte skicka testet" : "Testavisering på väg – kommer inom ca 15 sekunder");
  };
}

// ---------- inköpslistor ----------
// Varje person har egna listor; ägaren kan dela en lista med valda personer. Tabeller: supabase/shopping.sql
var shopErr = "", shopLists = [], shopLoaded = false, shopOff = false, shopListId = null, shopMode = "list", shopTimer = null;
var SHOP_SECTIONS = ["Frukt och grönt", "Kött och chark", "Fisk och skaldjur", "Mejeri och ägg", "Bröd", "Skafferi", "Kryddor och såser", "Frys", "Dryck", "Hushåll och hygien", "Övrigt"];
var BASKET_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5h17l-1.6 9a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5 11 4M16 9.5 13 4"/><path d="M9 13v4M12 13v4M15 13v4"/></svg>';
function myEmail(){ return String(me || "").toLowerCase(); }

async function loadShop(){
  if (!me || !sb) return;
  // Tre enkla frågor i stället för en med inbäddade relationer – tål att databasens schema-cache inte hunnit uppdateras
  let lists = null, mem = [], items = [], error = null;
  try {
    const a = await sb.from("recipe_lists").select("id, owner, name, created_at");
    if (a.error) throw a.error;
    lists = a.data || [];
    if (lists.length) {
      const ids = lists.map(l => l.id);
      const [b, c] = await Promise.all([sb.from("recipe_list_members").select("list_id, email").in("list_id", ids), sb.from("recipe_list_items").select("*").in("list_id", ids)]);
      if (b.error) throw b.error; if (c.error) throw c.error;
      mem = b.data || []; items = c.data || [];
    }
  } catch (e) { error = e; }
  shopLoaded = true;
  if (error) {
    shopErr = String(error.message || error); console.warn("inköpslista", shopErr);
    // bara "tabellen finns inte" stänger av funktionen; tillfälliga fel behåller det vi har
    if (/does not exist|relation|schema cache|42P01|PGRST20/i.test(shopErr + " " + (error.code || ""))) shopOff = true;
    renderShopFab(); return;
  }
  shopErr = "";
  shopOff = false;
  shopLists = lists.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(l => ({ id: l.id, owner: String(l.owner || "").toLowerCase(), name: l.name,
    members: mem.filter(m => m.list_id === l.id).map(m => String(m.email).toLowerCase()),
    items: items.filter(i => i.list_id === l.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) }));
  if (shopListId && !shopLists.some(l => l.id === shopListId)) shopListId = null;
  renderShopFab();
  if (document.querySelector(".shop-body") && shopMode === "list") drawShop();
  if (location.hash === "#lista" && !document.querySelector(".shop-body")) { history.replaceState(history.state, "", location.pathname); openShop(); }
}
function subscribeShop(){
  if (!sb || subscribeShop.done) return; subscribeShop.done = true;
  const again = () => { clearTimeout(shopTimer); shopTimer = setTimeout(loadShop, 250); };
  sb.channel("shop")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipe_list_items" }, again)
    .on("postgres_changes", { event: "*", schema: "public", table: "recipe_lists" }, again)
    .on("postgres_changes", { event: "*", schema: "public", table: "recipe_list_members" }, again)
    .subscribe();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadShop(); });
}
window.addEventListener("resize", () => { try { renderShopFab(); } catch {} });
try { document.fonts && document.fonts.ready.then(() => { try { renderShopFab(); } catch {} }); } catch {}
function shopLeft(){ return shopLists.reduce((n, l) => n + shopGroups(l.items.filter(i => !i.done && !isHomeItem(i))).length, 0); }

// Flytande korgknapp nere till höger (ovanför + i receptlistan)
// Mobil: RECEPT fyller bredden till höger om loggan
function fitTitle(){
  const h1 = document.querySelector("#app header.top h1"), rp = h1 && h1.querySelector(".t-rp");
  if (!rp) return;
  if (window.innerWidth > 620) { rp.style.fontSize = ""; const sv0 = h1.querySelector(".t-sv"); if (sv0) sv0.style.fontSize = ""; return; }
  const w = h1.clientWidth - (parseFloat(getComputedStyle(h1).paddingLeft) || 0) - (parseFloat(getComputedStyle(h1).paddingRight) || 0);
  if (!w) return;
  let s = 40; rp.style.fontSize = s + "px";
  for (let i = 0; i < 6; i++) { const cw = rp.scrollWidth; if (!cw) break; const r = w / cw; if (Math.abs(r - 1) < 0.01) break; s = Math.max(18, Math.min(72, s * r)); rp.style.fontSize = s.toFixed(1) + "px"; }
  const sv = h1.querySelector(".t-sv"); if (sv) sv.style.fontSize = (s * 0.78).toFixed(1) + "px";
}
function renderShopFab(){
  try { fitTitle(); } catch {}
  try { hdrSlides(); } catch {}
  try { imgSugKick(); } catch {}
  try { notesScrollRestore(); } catch {}
  try { const t = document.getElementById("ai-input"); if (t && !t.value) { t.style.height = ""; if (t.scrollHeight > t.clientHeight + 1) t.style.height = (t.scrollHeight + 2) + "px"; } } catch {}
  let b = document.getElementById("shopfab");
  // Startsidan: alltid (ingång till listan). Inne i ett recept m.m.: bara när det finns en aktiv lista med varor kvar
  const onStart = !!document.querySelector("#app header.top");
  const show = me && !shopOff && view.name !== "edit" && view.name !== "help" && (onStart || shopLeft() > 0);
  if (!show) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("button"); b.id = "shopfab"; b.className = "shopfab"; b.dataset.a = "shopfab"; document.body.appendChild(b); }
  const n = shopLeft();
  b.innerHTML = BASKET_SVG + (n ? `<span class="cnt">${n}</span>` : "");
  b.setAttribute("aria-label", n ? `Inköpslista, ${n} varor kvar` : "Inköpslista");
  b.classList.toggle("empty", !n);
  // I receptlistan sitter korgen nere till höger i rubrikfältet; på andra sidor flyter den nere till höger
  // I ett recept: på motsvarande ställe, nere till höger i receptbilden
  const hdr = document.querySelector("#app header.top") || (view.name === "detail" ? document.querySelector("#app .hero") : null);
  if (hdr) { if (b.parentNode !== hdr) hdr.appendChild(b); }
  else if (b.parentNode !== document.body) document.body.appendChild(b);
  b.classList.toggle("inhead", !!hdr);
  // Högerkanten i linje med Hjälp/Konto
  // stora skärmar: under sista bokstaven (T) i rubriken
  const nav = hdr && hdr.querySelector(":scope > .row");
  let edge = null;
  if (false && hdr && hdr.matches("header.top") && window.innerWidth > 900) {
    const h1 = hdr.querySelector("h1"), tn = h1 && (h1.querySelector(".t-rp") || [...h1.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()));
    if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn); const rr = rg.getBoundingClientRect(); const ls = parseFloat(getComputedStyle(h1).letterSpacing) || 0; if (rr.width) edge = rr.right - ls; }
  }
  if (edge == null && nav) edge = nav.getBoundingClientRect().right;
  b.style.right = hdr && edge != null ? Math.max(10, Math.round(hdr.getBoundingClientRect().right - edge)) + "px" : "";
  b.classList.toggle("above", !hdr && !!document.querySelector(".fab"));
  b.classList.toggle("cooking", !!document.getElementById("cookbar") && false);
}

// Butiksavdelning per vara – Claude sorterar, annars Övrigt
async function shopClassify(rows){
  if (!rows.length) return;
  try {
    const out = parseJson(await ai(`Dela in varorna i butiksavdelningar i en svensk mataffär. Använd ENBART: ${SHOP_SECTIONS.join(", ")}.
Svara bara med JSON där nyckeln är radens nummer: {"0": "Mejeri och ägg", ...}
${rows.map((r, i) => `${i}: ${r.text}`).join("\n")}`, { mode: "json", fast: true }));
    await Promise.all(rows.map((r, i) => { const s = out[i] || out[String(i)]; return SHOP_SECTIONS.includes(s) && s !== r.section ? sb.from("recipe_list_items").update({ section: s }).eq("id", r.id) : null; }));
    loadShop();
  } catch {}
}
async function ensureShopList(id){
  if (id) return shopLists.find(l => l.id === id);
  if (shopLists.length) return shopLists.find(l => l.owner === myEmail()) || shopLists[0];
  return await createShopList("Inköpslista");
}
async function createShopList(name){
  const { data, error } = await sb.from("recipe_lists").insert({ owner: myEmail(), name }).select("id, owner, name").single();
  if (error) { toast("Kunde inte skapa listan: " + (error.message || "okänt fel")); return null; }
  const l = { id: data.id, owner: myEmail(), name: data.name, members: [], items: [] };
  shopLists.push(l); shopOff = false; shopLoaded = true; renderShopFab(); return l;
}
const normItem = t => String(t).toLowerCase().replace(/\s+/g, " ").trim();
async function shopAdd(list, entries){
  const have = new Set(list.items.filter(i => !i.done).map(i => normItem(i.text)));
  const rows = entries.filter(e => e.text && !have.has(normItem(e.text))).map(e => ({ list_id: list.id, text: e.text.slice(0, 200), section: "Övrigt", recipe_id: e.recipe_id || null, recipe_title: e.recipe_title || null, added_by: myEmail() }));
  if (!rows.length) { toast("Det finns redan på listan"); return 0; }
  const { data, error } = await sb.from("recipe_list_items").insert(rows).select("*");
  if (error) { toast("Kunde inte lägga till: " + (error.message || "okänt fel")); return 0; }
  list.items.push(...data);
  renderShopFab();
  shopClassify(data);
  return data.length;
}
// Det man ofta lägger till själv föreslås när man skriver
function shopHistory(){ try { return JSON.parse(localStorage.getItem("shopHist:" + myEmail()) || "{}"); } catch { return {}; } }
function shopRemember(texts){ const h = shopHistory(); texts.forEach(t => { const k = t.trim(); if (k) h[k] = (h[k] || 0) + 1; }); try { localStorage.setItem("shopHist:" + myEmail(), JSON.stringify(h)); } catch {} }

// Basvaror som alltid finns hemma
const STAPLE_DEFAULT = ["salt", "peppar", "svartpeppar", "vitpeppar", "vatten", "olja", "olivolja", "rapsolja", "neutral olja"];
function staples(){ try { const s = JSON.parse(localStorage.getItem("staples:" + myEmail()) || "null"); return Array.isArray(s) ? s : STAPLE_DEFAULT.slice(); } catch { return STAPLE_DEFAULT.slice(); } }
function setStaples(s){ try { localStorage.setItem("staples:" + myEmail(), JSON.stringify(s)); } catch {} }
const shopIngKey = t => String(t).toLowerCase().replace(/\(.*?\)/g, "").replace(/^[\s\d.,½¼¾⅓⅔\/–-]+/, "").replace(/^(ca\s+)?(g|kg|hg|dl|cl|ml|l|msk|tsk|krm|st|stora?|små|förp\.?|paket|burk|burkar|klyftor?|nypa|kruka|knippe|skivor?|flaska)\s+/, "").split(",")[0].trim();
const isStaple = t => { const k = shopIngKey(t), s = staples(); return s.some(w => k === w || k.split(/\s+och\s+|\s+/).every(p => s.includes(p))); };

function openShopFromRecipe(r){
  if (!r) return;
  if (shopOff || !shopLoaded) {   // tabellerna saknas eller listan har inte gått att hämta
    openSheet(`<div class="sheet-head"><h2>Inköpslista</h2><button class="iconbtn fp-x" id="closeSheetBtn" aria-label="Stäng">×</button></div>
      <p class="hnote">${shopLoaded ? `Inköpslistan är inte påslagen i databasen än. Kör filen <b>supabase/shopping.sql</b> i Supabase (SQL Editor → New query → Run) och ladda om appen.${shopErr ? `<br><small>Fel: ${esc(shopErr)}</small>` : ""}` : "Inköpslistan laddas – försök igen om en sekund."}</p>`);
    $id("closeSheetBtn").onclick = closeSheet;
    if (!shopLoaded) loadShop();
    return;
  }
  const f = (detailState.servings && r.servings) ? detailState.servings / r.servings : 1;
  const lines = (r.ingredients || []).filter(l => !String(l).startsWith("#")).map(l => scaleLine(l, f));
  const home = new Set(lines.filter(isStaple));
  const mine = shopLists;
  let target = (() => { try { return localStorage.getItem("shopLast:" + myEmail()); } catch { return null; } })();
  if (!mine.some(l => l.id === target)) target = (mine[0] || {}).id || "";
  openSheet(`<div class="sheet-head"><h2>Inköpslista</h2><button class="iconbtn fp-x" id="closeSheetBtn" aria-label="Stäng">×</button></div>
    <p class="sub">${esc(r.title || "")}${detailState.servings ? ` · ${detailState.servings} portioner` : r.servings ? ` · ${r.servings} portioner` : ""}</p>
    <p class="meta" style="justify-content:flex-start;margin:4px 0 8px">Tryck på det du redan har hemma – det kommer inte med på listan.</p>
    <div class="shp-pick">${lines.map((l, i) => `<button class="shp-row ${home.has(l) ? "home" : ""}" data-i="${i}"><span class="bx"></span><span class="tx">${esc(l)}</span><span class="tag">${isStaple(l) ? "alltid hemma" : "hemma"}</span></button>`).join("")}</div>
    <p class="shp-staple-hint">Håll inne på en rad (eller dubbeltryck) för att markera den som <b>alltid hemma</b>.</p>
    ${mine.length > 1 ? `<label class="shp-to">Lägg i <select id="shpTo">${mine.map(l => `<option value="${esc(l.id)}" ${l.id === target ? "selected" : ""}>${esc(l.name)}${l.owner !== myEmail() ? " (delad)" : ""}</option>`).join("")}</select></label>` : ""}
    <button class="btn accent shp-go" id="shpGo"></button>`);
  $id("closeSheetBtn").onclick = closeSheet;
  const upd = () => { const n = lines.length - home.size; $id("shpGo").textContent = n ? `Lägg till i inköpslistan · ${n} ${n === 1 ? "vara" : "varor"}` : "Allt finns hemma"; $id("shpGo").disabled = !n; };
  document.querySelectorAll(".shp-row").forEach(b => {
    const l = lines[+b.dataset.i];
    const toggleStaple = () => { const k = shopIngKey(l); let s = staples(); if (s.includes(k)) { s = s.filter(x => x !== k); home.delete(l); toast(`${k} är inte längre en basvara`); } else { s.push(k); home.add(l); toast(`${k} räknas nu alltid som hemma`); } setStaples(s); b.classList.toggle("home", home.has(l)); b.querySelector(".tag").textContent = isStaple(l) ? "alltid hemma" : "hemma"; upd(); };
    let t = null;
    b.onpointerdown = () => { t = setTimeout(() => { t = "long"; toggleStaple(); }, 650); };
    b.onpointerup = b.onpointerleave = () => { if (t && t !== "long") clearTimeout(t); };
    b.onclick = () => { if (t === "long") { t = null; return; } home.has(l) ? home.delete(l) : home.add(l); b.classList.toggle("home", home.has(l)); upd(); };
    b.ondblclick = e => { e.preventDefault(); toggleStaple(); };
  });
  upd();
  $id("shpGo").onclick = async () => {
    $id("shpGo").disabled = true; $id("shpGo").innerHTML = '<span class="spinner"></span> Lägger till …';
    const list = await ensureShopList($id("shpTo") ? $id("shpTo").value : target || null);
    if (!list) { upd(); return; }
    try { localStorage.setItem("shopLast:" + myEmail(), list.id); } catch {}
    const n = await shopAdd(list, lines.filter(l => !home.has(l)).map(text => ({ text, recipe_id: r.id, recipe_title: r.title })));
    logEvent("shop_add", r, { varor: n });
    if (n) toast(`${n} ${n === 1 ? "vara" : "varor"} lagda i ${list.name}`);
    shopListId = list.id; openShop(list.id);
  };
}

function openShop(listId){
  if (listId) shopListId = listId;
  shopMode = "list";
  openSheet(`<div class="shop-body"></div>`);
  const m = document.querySelector("#modal-root .modal"); if (m) m.classList.add("shopm");
  drawShop();
}
function shopText(l){
  const rows = l.items.filter(i => !i.done);
  const titles = [...new Set(rows.map(i => i.recipe_title).filter(Boolean))];
  const out = [`${l.name}${titles.length ? " – " + titles.join(", ") : ""}`];
  SHOP_SECTIONS.forEach(s => { const g = rows.filter(i => (i.section || "Övrigt") === s); if (g.length) out.push("", s, ...g.map(i => "☐ " + i.text)); });
  return out.join("\n");
}
function drawShopOld(){
  const box = document.querySelector(".shop-body"); if (!box) return;
  if (shopOff) { box.innerHTML = `<p class="hnote">Inköpslistan är inte påslagen i databasen än. Kör <b>supabase/shopping.sql</b> i Supabase (SQL Editor → Run).</p>`; return; }
  const l = shopLists.find(x => x.id === shopListId) || shopLists.find(x => x.owner === myEmail()) || shopLists[0] || null;
  if (l) shopListId = l.id;
  const mineOwn = l && l.owner === myEmail();
  const left = l ? l.items.filter(i => !i.done) : [], done = l ? l.items.filter(i => i.done) : [];
  const hist = Object.entries(shopHistory()).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
  const row = i => `<button class="shp-item ${i.done ? "done" : ""}" data-id="${esc(i.id)}"><span class="bx"></span><span class="tx">${esc(i.text)}<small>${esc(i.recipe_title || "Egen vara")}${String(i.added_by).toLowerCase() !== myEmail() ? " · " + esc(nameOf(i.added_by)) : ""}</small></span></button>`;
  box.innerHTML = `
    ${shopLists.length > 1 ? `<div class="shp-tabs">${shopLists.map(x => { const n = x.items.filter(i => !i.done).length; return `<button class="${l && x.id === l.id ? "on" : ""}" data-list="${esc(x.id)}">${esc(x.name)}${n ? ` <small>${n}</small>` : ""}</button>`; }).join("")}<button data-act="newlist">+ Ny lista</button></div>` : ""}
    ${l ? `<div class="shp-meta">${mineOwn ? (l.members.length ? `Delad med ${l.members.map(m => esc(nameOf(m))).join(", ")}` : "Bara du ser den här listan") : `Delad av ${esc(nameOf(l.owner))}`}</div>` : ""}
    ${left.length ? SHOP_SECTIONS.map(s => { const g = left.filter(i => (i.section || "Övrigt") === s); return g.length ? `<p class="shp-sec">${esc(s)}</p>${g.map(row).join("")}` : ""; }).join("")
      : `<p class="shp-empty">${l && done.length ? "Allt är avbockat – bra jobbat!" : "Listan är tom. Lägg till varor nedan, eller tryck <b>Inköpslista</b> i ett recept."}</p>`}
    <form class="shp-add" id="shpAdd"><input id="shpNew" list="shpHist" placeholder="Lägg till vara … (flera med komma)" autocomplete="off"><button class="btn small" type="submit">Lägg till</button><datalist id="shpHist">${hist.map(h => `<option value="${esc(h)}">`).join("")}</datalist></form>
    ${done.length ? `<details class="shp-done"><summary>Avbockat <small>${done.length}</small></summary>${done.map(row).join("")}</details>` : ""}
    ${l ? `<div class="shp-actions">
      <button class="btn ghost small" data-act="share">Dela / kopiera</button>
      ${mineOwn ? `<button class="btn ghost small" data-act="members">Dela med …</button>` : ""}
      ${done.length ? `<button class="btn ghost small" data-act="clear">Töm avbockat</button>` : ""}
      ${mineOwn ? `<button class="linkbtn" data-act="rename">Byt namn</button><button class="linkbtn del-link" data-act="delete">Ta bort listan</button>` : `<button class="linkbtn del-link" data-act="leave">Lämna listan</button>`}
      ${shopLists.length <= 1 ? `<button class="linkbtn" data-act="newlist">+ Ny lista</button>` : ""}
    </div>` : ""}`;
  box.querySelectorAll("[data-list]").forEach(b => b.onclick = () => { shopListId = b.dataset.list; drawShop(); });
  box.querySelectorAll(".shp-item").forEach(b => b.onclick = async () => {
    const it = l.items.find(i => i.id === b.dataset.id); if (!it) return;
    it.done = !it.done; drawShop(); renderShopFab();
    const { error } = await sb.from("recipe_list_items").update({ done: it.done }).eq("id", it.id);
    if (error) { it.done = !it.done; drawShop(); toast("Kunde inte spara"); }
  });
  $id("shpAdd").onsubmit = async e => {
    e.preventDefault();
    const v = $id("shpNew").value; const texts = v.split(",").map(s => s.trim()).filter(Boolean); if (!texts.length) return;
    $id("shpNew").value = "";
    const list = await ensureShopList(l && l.id);
    if (!list) return;
    shopListId = list.id; shopRemember(texts);
    await shopAdd(list, texts.map(text => ({ text })));
    drawShop(); setTimeout(() => { const i = $id("shpNew"); if (i) i.focus(); }, 30);
  };
  box.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === "share") {
      const text = shopText(l);
      try { if (navigator.share && deviceInfo().touch) { await navigator.share({ title: l.name, text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(text); toast("Listan är kopierad – klistra in var du vill"); } catch { toast("Kunde inte kopiera"); }
    } else if (a === "clear") {
      const ids = done.map(i => i.id);
      const { error } = await sb.from("recipe_list_items").delete().in("id", ids);
      if (!error) { l.items = l.items.filter(i => !ids.includes(i.id)); drawShop(); renderShopFab(); }
    } else if (a === "newlist") {
      const name = (prompt("Namn på listan", "Ny lista") || "").trim(); if (!name) return;
      const nl = await createShopList(name.slice(0, 60)); if (nl) { shopListId = nl.id; drawShop(); renderShopFab(); }
    } else if (a === "rename") {
      const name = (prompt("Nytt namn", l.name) || "").trim(); if (!name || name === l.name) return;
      const { error } = await sb.from("recipe_lists").update({ name: name.slice(0, 60) }).eq("id", l.id);
      if (!error) { l.name = name.slice(0, 60); drawShop(); }
    } else if (a === "delete") {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Säker? Tryck igen"; return; }
      const { error } = await sb.from("recipe_lists").delete().eq("id", l.id);
      if (!error) { shopLists = shopLists.filter(x => x.id !== l.id); shopListId = null; drawShop(); renderShopFab(); toast("Listan är borttagen"); }
    } else if (a === "leave") {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Säker? Tryck igen"; return; }
      const { error } = await sb.from("recipe_list_members").delete().eq("list_id", l.id).eq("email", myEmail());
      if (!error) { shopLists = shopLists.filter(x => x.id !== l.id); shopListId = null; drawShop(); renderShopFab(); }
    } else if (a === "members") drawShopMembers(l);
  });
}
async function drawShopMembers(l){
  const box = document.querySelector(".shop-body"); if (!box) return;
  shopMode = "members";
  box.innerHTML = `<p class="meta">Laddar …</p>`;
  const { data, error } = await sb.rpc("recipe_list_people");
  const people = (data || []).filter(p => p.email !== myEmail());
  const sel = new Set(l.members);
  box.innerHTML = `<p class="shp-meta">Välj vilka som ska se och kunna ändra <b>${esc(l.name)}</b>.</p>
    ${error ? `<p class="err">Kunde inte hämta personerna.</p>` : people.map(p => `<label class="srow nf-row ${sel.has(p.email) ? "on" : ""}"><span class="st"><b>${esc(p.name || nameOf(p.email))}</b></span><span class="nf-state">${sel.has(p.email) ? "Ja" : "Nej"}</span><span class="sw"><input type="checkbox" value="${esc(p.email)}" ${sel.has(p.email) ? "checked" : ""}><i></i></span></label>`).join("")}
    <div class="row" style="justify-content:flex-end;gap:10px;margin-top:14px"><button class="btn ghost" id="shmBack">Tillbaka</button><button class="btn accent" id="shmSave">Spara</button></div>`;
  box.querySelectorAll("input[type=checkbox]").forEach(i => i.onchange = () => { const r = i.closest(".nf-row"); r.classList.toggle("on", i.checked); r.querySelector(".nf-state").textContent = i.checked ? "Ja" : "Nej"; });
  $id("shmBack").onclick = () => { shopMode = "list"; drawShop(); };
  $id("shmSave").onclick = async () => {
    const emails = [...box.querySelectorAll("input[type=checkbox]:checked")].map(i => i.value);
    const { error } = await sb.rpc("recipe_list_share", { p_list: l.id, p_emails: emails });
    if (error) { toast("Kunde inte spara"); return; }
    l.members = emails; shopMode = "list"; drawShop();
    toast(emails.length ? `Delad med ${emails.map(nameOf).join(", ")}` : "Listan är bara din igen");
  };
}

// ---- Inköpslistan, utseende C: mörk rubrik med framstegsring, kompakta rader, Hemma, samma vara ihopslagen ----
var HOME_PREFIX = "HEMMA:";
function isHomeItem(i){ return String(i.section || "").startsWith(HOME_PREFIX); }
function realSection(i){ const s = String(i.section || "Övrigt"); return s.startsWith(HOME_PREFIX) ? s.slice(HOME_PREFIX.length) || "Övrigt" : s; }
// "2 gula lökar" och "1 gul lök" ska bli samma vara: enkel svensk grundform per ord
function shopNameKey(t){
  return shopIngKey(t).replace(/[^a-zåäöé\s-]/g, " ").split(/\s+/).filter(Boolean)
    .map(w => w.length > 4 && /(ar|or|er)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /a$/.test(w) ? w.slice(0, -1) : w).join(" ");
}
function parseQty(t){
  const m = String(t).trim().match(/^(\d+(?:[.,]\d+)?|½|¼|¾)\s*(g|kg|hg|dl|cl|ml|l|msk|tsk|krm|st)?\b\.?\s*(.*)$/i);
  if (!m) return null;
  const n = m[1] === "½" ? .5 : m[1] === "¼" ? .25 : m[1] === "¾" ? .75 : parseFloat(m[1].replace(",", "."));
  return { n, unit: (m[2] || "").toLowerCase(), rest: m[3] };
}
// Grupper av samma vara (samma grundnamn) inom en lista
function shopGroups(items){
  const map = new Map();
  items.forEach(i => { const k = (isHomeItem(i) ? "h:" : "") + (shopNameKey(i.text) || normItem(i.text)); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
  return [...map.values()];
}
function groupLabel(g){
  if (g.length === 1) return { text: g[0].text, qty: "" };
  const ps = g.map(i => parseQty(i.text));
  if (ps.every(p => p) && ps.every(p => p.unit === ps[0].unit)) {
    const sum = ps.reduce((s, p) => s + p.n, 0);
    const best = ps.find(p => p.n > 1) || ps[0];
    return { text: `${fmtNum(sum)}${ps[0].unit ? " " + ps[0].unit : ""} ${sum > 1 ? best.rest : ps[0].rest}`.trim(), qty: "" };
  }
  const base = shopIngKey(g[0].text); const name = base ? base[0].toUpperCase() + base.slice(1) : g[0].text;
  const q = g.map((i, k) => { const p = ps[k]; return p ? `${fmtNum(p.n)}${p.unit ? " " + p.unit : ""}` : null; }).filter(Boolean);
  return { text: name, qty: q.length ? q.join(" + ") : "" };
}
var SHOP_COLORS = ["#9c7a3c", "#5c1a24", "#3f6e8c", "#8a5a9e", "#b5523b", "#2f7a6b"];
function shopDots(l){
  const src = [...new Set(l.items.map(i => i.recipe_title || ""))];
  const map = {}; let c = 0;
  src.forEach(s => { map[s] = s ? SHOP_COLORS[c++ % SHOP_COLORS.length] : "#4f7a4a"; });
  return { map, many: src.length > 1, src };
}
var shopOpenGroup = null;
function drawShop(){
  const box = document.querySelector(".shop-body"); if (!box) return;
  const closeBtn = `<button class="fp-x shop-x" id="shopClose" aria-label="Stäng">×</button>`;
  if (shopOff) { box.innerHTML = `<div class="shop-hero">${closeBtn}<div><h2>Inköpslista</h2></div></div><div class="shop-in"><p class="hnote">Inköpslistan är inte påslagen i databasen än. Kör <b>supabase/shopping.sql</b> i Supabase (SQL Editor → Run).</p></div>`; $id("shopClose").onclick = closeSheet; return; }
  const l = shopLists.find(x => x.id === shopListId) || shopLists.find(x => x.owner === myEmail()) || shopLists[0] || null;
  if (l) shopListId = l.id;
  const own = l && l.owner === myEmail();
  const items = l ? l.items : [];
  const active = items.filter(i => !isHomeItem(i));
  const groups = shopGroups(active), homeGroups = shopGroups(items.filter(isHomeItem));
  const total = groups.length, doneN = groups.filter(g => g.every(i => i.done)).length;
  const dots = l ? shopDots(l) : { map: {}, many: false, src: [] };
  const titles = dots.src.filter(Boolean);
  const pct = total ? doneN / total : 0, C = 2 * Math.PI * 23;
  const ring = `<svg class="shop-ring" viewBox="0 0 56 56" aria-label="${doneN} av ${total} klara"><circle cx="28" cy="28" r="23" fill="none" stroke="#4a3a2e" stroke-width="5"/><circle cx="28" cy="28" r="23" fill="none" stroke="#c9a55c" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="${total ? 28 : 32}" text-anchor="middle" font-size="15" fill="#f0dcaa" font-family="Georgia,serif">${total ? doneN : "–"}</text>${total ? `<text x="28" y="39" text-anchor="middle" font-size="8" fill="#bfae8c" font-family="sans-serif">av ${total}</text>` : ""}</svg>`;
  const HOUSE = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/></svg>';
  const gid = g => g.map(i => i.id).join(",");
  const row = g => {
    const lb = groupLabel(g), done = g.every(i => i.done), key = gid(g);
    const who = [...new Set(g.map(i => String(i.added_by).toLowerCase()).filter(e => e !== myEmail()))].map(nameOf).join(", ");
    const ds = [...new Set(g.map(i => i.recipe_title || ""))];
    const open = shopOpenGroup === key && g.length > 1;
    return `<div class="sh-row ${done ? "done" : ""}" data-g="${esc(key)}" ${who ? `title="Tillagd av ${esc(who)}"` : ""}>
      <button class="sh-bx" data-act="tick" aria-label="${done ? "Ångra" : "Bocka av"} ${esc(lb.text)}"></button>
      ${dots.many ? `<span class="sh-dots">${ds.map(s => `<i style="background:${dots.map[s]}"></i>`).join("")}</span>` : ""}
      <button class="sh-tx" data-act="expand">${esc(lb.text)}${lb.qty ? `<em>${esc(lb.qty)}</em>` : ""}</button>
      <button class="sh-ed" data-act="edit" aria-label="Ändra ${esc(lb.text)}" title="Ändra eller ta bort">${SHOP_PEN}</button>
      <button class="sh-hm" data-act="home" aria-label="Finns hemma" title="Finns hemma">${HOUSE}</button>
    </div>${open ? g.map(i => `<div class="sh-sub" data-g="${esc(i.id)}"><i style="background:${dots.map[i.recipe_title || ""]}"></i>${esc(i.text)} · ${esc(i.recipe_title || "Egen vara")}</div>`).join("") : ""}`;
  };
  const sections = SHOP_SECTIONS.map(s => { const gs = groups.filter(g => realSection(g[0]) === s); return gs.length ? `<div class="sh-blk"><p class="sh-sec">${esc(s)}</p>${gs.map(row).join("")}</div>` : ""; }).join("");
  const hist = Object.entries(shopHistory()).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
  box.innerHTML = `
    <div class="shop-hero">${ring}
      <div class="sh-ttl"><h2>${esc(l ? l.name : "Inköpslista")}</h2>
        <small>${titles.length ? esc(titles.join(" · ")) + (dots.src.includes("") ? " · egna varor" : "") : (items.length ? "Egna varor" : "Tom lista")}</small>
        ${l ? `<span>${own ? (l.members.length ? `Delad med ${l.members.map(m => esc(nameOf(m))).join(", ")}` : "Bara du ser den här listan") : `Delad av ${esc(nameOf(l.owner))}`}</span>` : ""}</div>
      ${shopLists.length > 1 ? `<div class="sh-tabs">${shopLists.map(x => `<button class="${l && x.id === l.id ? "on" : ""}" data-list="${esc(x.id)}">${esc(x.name)}</button>`).join("")}<button data-act="newlist">+ Ny</button></div>` : ""}
      ${closeBtn}</div>
    <div class="shop-in">
      ${dots.many ? `<div class="sh-key">${dots.src.map(s => `<span><i style="background:${dots.map[s]}"></i>${esc(s || "Egen vara")}</span>`).join("")}</div>` : ""}
      ${l && total && doneN === total && shopDoneHide !== l.id ? shopDoneCard() : ""}
      ${items.length ? shopEdTip() : ""}
      ${groups.length ? `<div class="sh-cols">${sections}</div>` : `<p class="shp-empty">${homeGroups.length ? "Allt annat finns hemma." : "Listan är tom. Lägg till varor nedan, eller tryck <b>Handla</b> i ett recept."}</p>`}
      ${homeGroups.length ? `<details class="sh-home"><summary>Fanns hemma · ${homeGroups.length}</summary>${homeGroups.map(g => `<div class="sh-hrow" data-g="${esc(gid(g))}">${HOUSE}<span>${esc(groupLabel(g).text)}</span><button class="linkbtn" data-act="unhome">Tillbaka</button></div>`).join("")}</details>` : ""}
      <div class="sh-foot">
        <form class="shp-add" id="shpAdd"><input id="shpNew" list="shpHist" placeholder="Lägg till vara … (flera med komma)" autocomplete="off"><button class="btn small" type="submit">Lägg till</button><datalist id="shpHist">${hist.map(h => `<option value="${esc(h)}">`).join("")}</datalist></form>
        ${l ? `<div class="sh-acts">
          <button class="btn ghost small" data-act="share">Dela / kopiera</button>
          ${own ? `<button class="btn ghost small" data-act="members">Dela med …</button>` : ""}
          ${doneN ? `<button class="btn ghost small" data-act="clear">Töm avbockat</button>` : ""}
          ${shopLists.length <= 1 ? `<button class="btn ghost small" data-act="newlist">+ Ny lista</button>` : ""}
          ${own ? `<button class="linkbtn" data-act="rename">Byt namn</button><button class="linkbtn del-link" data-act="delete">Ta bort listan</button>` : `<button class="linkbtn del-link" data-act="leave">Lämna listan</button>`}
        </div>` : ""}
      </div>
    </div>`;
  $id("shopClose").onclick = closeSheet;
  setTimeout(setupShopScroll, 0); setTimeout(updateShopScroll, 280);
  const findG = el => { const ids = (el.closest("[data-g]").dataset.g || "").split(","); return l.items.filter(i => ids.includes(i.id)); };
  const save = async (rows, patch) => {
    rows.forEach(i => Object.assign(i, patch(i))); drawShop(); renderShopFab();
    const res = await Promise.all(rows.map(i => sb.from("recipe_list_items").update(patch(i)).eq("id", i.id)));
    if (res.some(r => r.error)) { toast("Kunde inte spara"); loadShop(); }
  };
  box.querySelectorAll("[data-list]").forEach(b => b.onclick = () => { shopListId = b.dataset.list; shopOpenGroup = null; drawShop(); });
  box.querySelectorAll('[data-act="tick"]').forEach(b => b.onclick = () => { const g = findG(b); const v = !g.every(i => i.done); save(g, () => ({ done: v })); });
  box.querySelectorAll('[data-act="expand"]').forEach(b => b.onclick = () => { const k = b.closest("[data-g]").dataset.g; if (k.includes(",")) { shopOpenGroup = shopOpenGroup === k ? null : k; drawShop(); } else { const g = findG(b); const v = !g.every(i => i.done); save(g, () => ({ done: v })); } });
  box.querySelectorAll('[data-act="home"]').forEach(b => b.onclick = () => {
    const g = findG(b); const name = groupLabel(g).text;
    save(g, i => ({ section: HOME_PREFIX + realSection(i), done: false }));
    toastActions(`${name} finns hemma`, [["Ångra", () => save(g, i => ({ section: realSection(i) }))], ["Alltid hemma", () => { const k = shopIngKey(g[0].text); const s = staples(); if (!s.includes(k)) { s.push(k); setStaples(s); } toast(`${k} räknas nu alltid som hemma`); }]]);
  });
  box.querySelectorAll('[data-act="unhome"]').forEach(b => b.onclick = () => { const g = findG(b); save(g, i => ({ section: realSection(i) })); });
  shopEdBind(box, l, findG, save);
  if (l && !(total && doneN === total) && shopDoneHide === l.id) shopDoneHide = null;
  shopDoneBind(box, l);
  $id("shpAdd").onsubmit = async e => {
    e.preventDefault();
    const texts = $id("shpNew").value.split(",").map(s => s.trim()).filter(Boolean); if (!texts.length) return;
    $id("shpNew").value = "";
    const list = await ensureShopList(l && l.id); if (!list) return;
    shopListId = list.id; shopRemember(texts);
    await shopAdd(list, texts.map(text => ({ text })));
    drawShop(); setTimeout(() => { const i = $id("shpNew"); if (i) i.focus(); }, 30);
  };
  box.querySelectorAll(".sh-foot [data-act], .sh-tabs [data-act]").forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === "share") {
      const text = shopText2(l);
      try { if (navigator.share && deviceInfo().touch) { await navigator.share({ title: l.name, text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(text); toast("Listan är kopierad – klistra in var du vill"); } catch { toast("Kunde inte kopiera"); }
    } else if (a === "clear") {
      const ids = l.items.filter(i => i.done && !isHomeItem(i)).map(i => i.id);
      const { error } = await sb.from("recipe_list_items").delete().in("id", ids);
      if (!error) { l.items = l.items.filter(i => !ids.includes(i.id)); drawShop(); renderShopFab(); }
    } else if (a === "newlist") {
      const name = (prompt("Namn på listan", "Ny lista") || "").trim(); if (!name) return;
      const nl = await createShopList(name.slice(0, 60)); if (nl) { shopListId = nl.id; drawShop(); renderShopFab(); }
    } else if (a === "rename") {
      const name = (prompt("Nytt namn", l.name) || "").trim(); if (!name || name === l.name) return;
      const { error } = await sb.from("recipe_lists").update({ name: name.slice(0, 60) }).eq("id", l.id);
      if (!error) { l.name = name.slice(0, 60); drawShop(); }
    } else if (a === "delete" || a === "leave") {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Säker? Tryck igen"; return; }
      const { error } = a === "delete" ? await sb.from("recipe_lists").delete().eq("id", l.id) : await sb.from("recipe_list_members").delete().eq("list_id", l.id).eq("email", myEmail());
      if (!error) { shopLists = shopLists.filter(x => x.id !== l.id); shopListId = null; drawShop(); renderShopFab(); }
    } else if (a === "members") drawShopMembers(l);
  });
}
// Tydlig scroll i långa listor: guldskena till höger (dra för att scrolla) + tonad kant med "↓ N varor till"
function setupShopScroll(){
  const m = document.querySelector("#modal-root .modal.shopm"), bg = document.getElementById("sheet-bg");
  if (!m || !bg) return;
  let rail = document.getElementById("shopRail");
  if (!rail) {
    rail = document.createElement("div"); rail.id = "shopRail"; rail.className = "shop-rail"; rail.innerHTML = '<i id="shopThumb"></i>';
    const more = document.createElement("button"); more.id = "shopMore"; more.className = "shop-more"; more.type = "button";
    const fade = document.createElement("div"); fade.id = "shopFade"; fade.className = "shop-fade";
    bg.append(rail, fade, more);
    m.addEventListener("scroll", () => requestAnimationFrame(updateShopScroll), { passive: true });
    window.addEventListener("resize", updateShopScroll);
    more.onclick = () => m.scrollBy({ top: m.clientHeight * .7, behavior: "smooth" });
    const thumb = rail.firstElementChild;
    let drag = null;
    const move = y => { const r = rail.getBoundingClientRect(), th = thumb.offsetHeight; const p = Math.min(1, Math.max(0, (y - r.top - drag) / Math.max(1, r.height - th))); m.scrollTop = p * (m.scrollHeight - m.clientHeight); };
    thumb.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); drag = e.clientY - thumb.getBoundingClientRect().top; thumb.setPointerCapture(e.pointerId); thumb.classList.add("on"); });
    thumb.addEventListener("pointermove", e => { if (drag != null) move(e.clientY); });
    const up = () => { drag = null; thumb.classList.remove("on"); };
    thumb.addEventListener("pointerup", up); thumb.addEventListener("pointercancel", up);
    rail.addEventListener("pointerdown", e => { if (e.target !== rail) return; drag = thumb.offsetHeight / 2; move(e.clientY); drag = null; });
    rail.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });   // inte dra-för-att-stänga
  }
  updateShopScroll();
}
function updateShopScroll(){
  const m = document.querySelector("#modal-root .modal.shopm"), rail = document.getElementById("shopRail");
  if (!m || !rail) return;
  const thumb = document.getElementById("shopThumb"), more = document.getElementById("shopMore"), fade = document.getElementById("shopFade");
  const over = m.scrollHeight - m.clientHeight > 6;
  const mr = m.getBoundingClientRect(), hero = m.querySelector(".shop-hero"), hb = hero ? hero.getBoundingClientRect().bottom : mr.top;
  rail.style.display = over ? "" : "none";
  if (over) {
    const top = Math.max(mr.top, hb) + 8, bottom = Math.min(innerHeight, mr.bottom) - 12;
    Object.assign(rail.style, { top: top + "px", height: Math.max(40, bottom - top) + "px", left: (mr.right - 12) + "px" });
    const h = rail.offsetHeight, th = Math.max(36, h * m.clientHeight / m.scrollHeight);
    thumb.style.height = th + "px";
    thumb.style.transform = `translateY(${(h - th) * (m.scrollTop / Math.max(1, m.scrollHeight - m.clientHeight))}px)`;
  }
  // varor som ligger nedanför det synliga
  const visBottom = Math.min(innerHeight, mr.bottom) - 8;
  const below = [...m.querySelectorAll(".sh-row")].filter(r => r.getBoundingClientRect().top > visBottom).length;
  const atEnd = m.scrollTop + m.clientHeight >= m.scrollHeight - 6;
  const showMore = over && !atEnd && below > 0;
  more.style.display = fade.style.display = showMore ? "" : "none";
  if (showMore) {
    more.textContent = `↓ ${below} ${below === 1 ? "vara" : "varor"} till`;
    const b = Math.min(innerHeight, mr.bottom);
    Object.assign(fade.style, { left: mr.left + 2 + "px", width: (mr.width - 4) + "px", top: (b - 70) + "px" });
    Object.assign(more.style, { left: (mr.left + mr.width / 2) + "px", top: (b - 46) + "px" });
  }
}
function shopText2(l){
  const groups = shopGroups(l.items.filter(i => !i.done && !isHomeItem(i)));
  const titles = [...new Set(l.items.map(i => i.recipe_title).filter(Boolean))];
  const out = [`${l.name}${titles.length ? " – " + titles.join(", ") : ""}`];
  SHOP_SECTIONS.forEach(s => { const gs = groups.filter(g => realSection(g[0]) === s); if (gs.length) out.push("", s, ...gs.map(g => { const lb = groupLabel(g); return "☐ " + lb.text + (lb.qty ? " " + lb.qty : ""); })); });
  return out.join("\n");
}
// Kort meddelande med knappar (Ångra / Alltid hemma)
function toastActions(msg, actions){
  let t = document.getElementById("toastAct");
  if (t) t.remove();
  t = document.createElement("div"); t.id = "toastAct"; t.className = "toast-act";
  t.innerHTML = `<span>${esc(msg)}</span>${actions.map((a, i) => `<button data-i="${i}">${esc(a[0])}</button>`).join("")}`;
  document.body.appendChild(t);
  t.querySelectorAll("button").forEach(b => b.onclick = () => { t.remove(); actions[+b.dataset.i][1](); });
  setTimeout(() => { if (t.parentNode) t.remove(); }, 6000);
}
// ---------- Växlande receptbilder i sidhuvudet ----------
// Startar med standardbilden. Har någon bild markerats "I sidhuvudet" visas bara de, annars alla
// receptbilder som är tillräckligt stora och liggande. Av för en enhet med ?bild=av (på igen med ?bild=pa).
var hdrOff = (function(){ try { if (/[?&]bild=av\b/.test(location.search)) localStorage.setItem("hdrOff", "1"); if (/[?&]bild=(pa|på|demo)\b/.test(location.search)) localStorage.removeItem("hdrOff"); return localStorage.getItem("hdrOff") === "1"; } catch { return false; } })();
var hdrEl = null, hdrCap = null, hdrList = [], hdrIdx = -1, hdrTimer = null, hdrFlip = false, hdrSig = "", hdrTries = 0;
// bilder som inte dög (för små/stående) – sparas per bildadress så de inte laddas ner igen
var hdrBadUrls = (function(){ try { return new Set(JSON.parse(localStorage.getItem("hdrBad") || "[]")); } catch { return new Set(); } })();
var hdrErrUrls = new Set();
var hdrBad = { has: id => { const r = recipes.find(x => x.id === id); return !!(r && (hdrBadUrls.has(r.photo) || hdrErrUrls.has(r.photo))); }, get size(){ return hdrBadUrls.size; } };
function hdrMarkBad(r){ hdrBadUrls.add(r.photo); try { localStorage.setItem("hdrBad", JSON.stringify([...hdrBadUrls].slice(-300))); } catch {} }
function hdrPool(){
  const ph = recipes.filter(r => r.photo && !hdrBad.has(r.id));
  const picked = recipes.filter(r => r.photo && r.hdr && !hdrBad.has(r.id));
  return picked.length ? picked : ph;
}
function hdrSlides(){
  if (hdrOff) return;
  const hdr = document.querySelector("#app header.top");
  if (!hdr) return;
  if (!hdrEl) {
    if (!recipes.some(r => r.photo)) return;
    hdrEl = document.createElement("div"); hdrEl.className = "hdr-slides"; hdrEl.setAttribute("aria-hidden", "true");
    hdrEl.innerHTML = '<img alt=""><img alt=""><i class="hs-veil"></i>';
    hdrCap = document.createElement("button"); hdrCap.type = "button"; hdrCap.className = "hdr-cap"; hdrCap.dataset.a = "open";
    hdr.classList.add("has-slides"); hdr.prepend(hdrEl); hdr.appendChild(hdrCap);
    // standardbilden syns först, sedan börjar bildspelet
    setTimeout(() => { hdrNext(); hdrTimer = setInterval(() => { if (!document.hidden && document.querySelector("#app header.top .hdr-slides")) hdrNext(); }, 9000); }, 5000);
    return;
  }
  if (!hdr.contains(hdrEl)) { hdr.classList.add("has-slides"); hdr.prepend(hdrEl); hdr.appendChild(hdrCap); }
  hdrPlaceCap(hdr);
}
// Dator: receptnamnet nere till vänster, i linje med sökfältet (och slutar före loggan)
function hdrPlaceCap(hdr){
  if (!hdrCap) return;
  if (window.innerWidth <= 620) { hdrCap.style.left = hdrCap.style.maxWidth = ""; return; }
  const s = document.querySelector("#app .search"), lg = hdr.querySelector(".logo");
  if (!s) return;
  const hl = hdr.getBoundingClientRect().left, left = s.getBoundingClientRect().left - hl;
  hdrCap.style.left = Math.round(left) + "px";
  if (lg) { const room = lg.getBoundingClientRect().left - hl - left - 18; if (room > 120) hdrCap.style.maxWidth = Math.round(room) + "px"; }
}
function hdrNext(){
  const pool = hdrPool(), sig = pool.map(r => r.id).sort().join(",");
  if (pool.length === 1 && hdrEl.classList.contains("live") && hdrList[hdrIdx] && hdrList[hdrIdx].id === pool[0].id) return;
  if (sig !== hdrSig || hdrIdx + 1 >= hdrList.length) {
    // ny blandning när urvalet ändras eller när alla visats; undvik att samma bild kommer två gånger i rad
    const last = hdrList[hdrIdx];
    hdrList = pool.slice().sort(() => Math.random() - 0.5);
    if (last && hdrList.length > 1 && hdrList[0].id === last.id) hdrList.push(hdrList.shift());
    hdrSig = sig; hdrIdx = -1;
  }
  if (!hdrList.length) return;
  hdrIdx++;
  const r = hdrList[hdrIdx], imgs = hdrEl.querySelectorAll("img"), inc = imgs[hdrFlip ? 1 : 0], out = imgs[hdrFlip ? 0 : 1];
  let shown = false;
  const go = () => {
    if (shown) return; shown = true;
    inc.style.zIndex = 2; out.style.zIndex = 1; hdrEl.classList.add("live");
    inc.classList.remove("kb"); void inc.offsetWidth; inc.classList.add("kb");
    // Den nya tonas in ovanpå den gamla, som ligger kvar tills bytet är klart (ingen mörk dipp)
    setTimeout(() => { inc.classList.add("on"); setTimeout(() => { if (inc.classList.contains("on")) out.classList.remove("on"); }, 3100); }, 40);
    hdrFlip = !hdrFlip;
    const first = !hdrCap.dataset.id;
    hdrCap.classList.add("fade");
    setTimeout(() => { hdrCap.dataset.id = r.id; hdrCap.innerHTML = `<span>${esc(r.title || "")}</span><b>→</b>`; hdrCap.classList.remove("fade"); }, first ? 0 : 1300);
    const nx = hdrList[(hdrIdx + 1) % hdrList.length]; if (nx) { const p = new Image(); p.src = nx.photo; if (p.decode) p.decode().catch(() => {}); }
  };
  const skip = (keep) => { if (keep) hdrMarkBad(r); else hdrErrUrls.add(r.photo); if (++hdrTries < 12) hdrNext(); else hdrTries = 0; };
  const show = () => {
    inc.onload = null;
    // för små eller stående bilder blir suddiga/hårt beskurna i det breda sidhuvudet (gäller alla, nu när alla recept är valda som standard)
    if ((inc.naturalWidth < 900 || inc.naturalHeight > inc.naturalWidth * 1.05)) { skip(true); return; }
    hdrTries = 0;
    if (inc.decode) inc.decode().then(go, go); else go();
  };
  inc.onload = show; inc.onerror = () => { inc.onerror = null; skip(); };
  if (inc.getAttribute("src") === r.photo && inc.complete && inc.naturalWidth) { show(); return; }
  inc.src = r.photo;
  if (inc.complete && inc.naturalWidth) show();
}
// ---------- Bildförslag från Pexels för recept utan bild (och via Byt bild) ----------
var imgSug = {};
function imgSugInner(r){
  const s = imgSug[r.id] || { state: "idle" };
  const src = s.source || "Pixabay";
  const head = `<div class="is-h"><span class="is-t">Förslag på bild</span><a class="is-src" href="${src === "Pexels" ? "https://www.pexels.com" : "https://pixabay.com"}" target="_blank" rel="noopener">Bilder från ${src}</a></div>`;
  const tools = `<div class="is-tools">
      <form class="is-own" data-id="${esc(r.id)}"><input name="q" placeholder="Sök med egna ord, t.ex. kokoscurry" autocomplete="off" value="${esc(s.own || "")}"><button class="btn small ghost" type="submit">Sök</button></form>
      <div class="is-more">${s.state === "done" && s.photos.length ? `<button class="linkbtn" data-a="sugmore" data-id="${esc(r.id)}">Fler förslag</button>` : ""}<button class="linkbtn" data-a="sugown" data-id="${esc(r.id)}">Ta egen bild</button></div>
    </div>`;
  if (s.state === "nokey") return "";
  let body;
  if (s.state === "idle" || s.state === "loading") body = `<div class="is-grid">${Array.from({ length: 6 }, () => `<span class="is-ph"></span>`).join("")}</div><p class="is-note"><span class="spinner"></span> Letar efter bilder som passar …</p>`;
  else if (s.state === "error") body = `<p class="is-note">${esc(s.err || "Kunde inte hämta förslag.")} <button class="linkbtn" data-a="sugretry" data-id="${esc(r.id)}">Försök igen</button></p>`;
  else if (!s.photos.length) body = `<p class="is-note">Hittade inga bilder som passar. Prova att söka med egna ord.</p>`;
  else body = `<div class="is-grid">${s.photos.map((p, i) => `<button class="is-pic${s.saving === i ? " saving" : ""}" data-a="sugpick" data-id="${esc(r.id)}" data-i="${i}" title="${esc(p.alt || "")}"><img src="${esc(p.thumb)}" alt="${esc(p.alt || "")}" loading="lazy"><span>${esc(p.photographer)}</span>${s.saving === i ? `<i class="spinner"></i>` : ""}</button>`).join("")}</div>`;
  return head + body + (typeof webImgHtml === "function" && isDrink(r) && s.state !== "idle" && s.state !== "loading" ? webImgHtml(r) : "") + tools;
}
function imgSugDraw(id){
  document.querySelectorAll(`.imgsug[data-id="${CSS.escape(id)}"]`).forEach(el => {
    const r = recipes.find(x => x.id === id); if (!r) return;
    const s = imgSug[id];
    if (s && s.state === "nokey") { el.remove(); return; }
    const f = el.querySelector(".is-own input"), had = f && document.activeElement === f;
    el.innerHTML = imgSugInner(r);
    if (had) { const g = el.querySelector(".is-own input"); g && g.focus(); }
  });
}
function imgSugKick(){
  document.querySelectorAll(".imgsug[data-id]").forEach(el => {
    const id = el.dataset.id;
    if (!imgSug[id]) { const r = recipes.find(x => x.id === id); if (r) loadImgSug(r); }
  });
}
async function loadImgSug(r, opts = {}){
  const prev = imgSug[r.id] || {};
  const page = opts.more ? (prev.page || 1) + 1 : 1;
  const own = opts.own != null ? opts.own : (opts.more ? prev.own : "");
  imgSug[r.id] = { state: "loading", photos: [], own, page };
  imgSugDraw(r.id);
  try {
    const { data: { session } } = await sb.auth.getSession();
    const resp = await fetch("/api/images", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) },
      body: JSON.stringify({ title: r.title || "", ingredients: (r.ingredients || []).filter(x => x && !String(x).startsWith("#")).slice(0, 12), q: own || "", page, drink: isDrink(r) }) });
    const j = await resp.json().catch(() => ({}));
    if (resp.status === 503 && j.code === "nokey") { imgSug[r.id] = { state: "nokey" }; imgSugDraw(r.id); return; }
    if (!resp.ok) throw new Error(j.error || "Kunde inte hämta förslag");
    imgSug[r.id] = { state: "done", photos: j.photos || [], own, page, source: j.source || "Pixabay" };
  } catch (e) {
    imgSug[r.id] = { state: "error", photos: [], own, page, err: e.message };
  }
  imgSugDraw(r.id);
}
async function pickImgSug(r, i){
  const s = imgSug[r.id]; const p = s && s.photos[i];
  if (!p || s.saving != null) return;
  s.saving = i; imgSugDraw(r.id);
  try {
    const { data: { session } } = await sb.auth.getSession();
    const resp = await fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) }, body: JSON.stringify({ url: p.full, imageOnly: true }) });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.image) throw new Error(j.error || "Kunde inte hämta bilden");
    const url = await storePhoto(await compress(await (await fetch(j.image)).blob(), 1600, 600000));
    if (!url) throw new Error("Kunde inte spara bilden");
    s.saving = null;
    if (document.querySelector("#sheet-bg .imgsug")) closeSheet();
    if (await patch(r.id, { photo: url, photoCredit: { name: p.photographer, url: p.photographerUrl, page: p.pageUrl, src: s.source || "Pixabay" } })) toast("Bilden sparad");
  } catch (e) {
    s.saving = null; imgSugDraw(r.id); toast(e.message || "Kunde inte spara bilden");
  }
}
function openImgSugSheet(r){
  openSheet(`<h2>Förslag på bild</h2><div class="imgsug insheet" data-id="${esc(r.id)}">${imgSugInner(r)}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="is-close">Stäng</button></div>`);
  $id("is-close").onclick = closeSheet;
  const s = imgSug[r.id];
  if (!s || s.state === "error" || s.state === "nokey") loadImgSug(r);
}
document.addEventListener("submit", e => {
  const f = e.target.closest && e.target.closest(".is-own"); if (!f) return;
  e.preventDefault();
  const r = recipes.find(x => x.id === f.dataset.id); const q = f.q.value.trim();
  if (r && q) loadImgSug(r, { own: q });
});
document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("[data-a^='sug']"); if (!b) return;
  const r = recipes.find(x => x.id === b.dataset.id); if (!r) return;
  e.preventDefault(); e.stopPropagation();
  const a = b.dataset.a;
  if (a === "sugpick") pickImgSug(r, +b.dataset.i);
  else if (a === "sugmore") loadImgSug(r, { more: true });
  else if (a === "sugretry") loadImgSug(r);
  else if (a === "sugown") { if (document.querySelector("#sheet-bg .imgsug")) closeSheet(); openPhotoSheet(async url => { if (await patch(r.id, { photo: url, photoCredit: null })) toast("Bilden sparad"); }, null); }
}, true);
// Välj vilka receptbilder som får visas i sidhuvudet
async function toggleHdr(r){
  const on = !r.hdr;
  if (await patch(r.id, { hdr: on })) toast(on ? "Bilden visas i sidhuvudet" : "Bilden visas inte längre i sidhuvudet");
}

// ---------- Inköpslistan: ändra eller ta bort en vara ----------
// Telefon: håll inne på en vara. Dator: högerklicka, eller pennan som syns när musen är över raden.
var SHOP_PEN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
var SHOP_TRASH = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
var SHOP_HOUSE_S = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/></svg>';
var shopEdCtx = null, shopEdSkip = false, shopEdSkipT = null, shopEdVV = null;
// ett långt tryck pågår: släpp igenom inga klick förrän fingret har lyfts (säkerhetsgräns 5 s)
function shopEdHoldOn(){ shopEdSkip = true; clearTimeout(shopEdSkipT); shopEdSkipT = setTimeout(() => { shopEdSkip = false; }, 5000); }
function shopEdTouch(){ return window.matchMedia("(hover: none)").matches; }
function shopEdTip(){
  try { if (localStorage.getItem("shopEdTip")) return ""; } catch { return ""; }
  return `<p class="sh-tip"><span><b>Tips:</b> ${shopEdTouch() ? "håll inne på en vara" : "högerklicka på en vara eller tryck på pennan"} för att ändra eller ta bort den.</span><button type="button" data-act="tipok" aria-label="Stäng tipset">×</button></p>`;
}
function shopEdTipDone(){ try { localStorage.setItem("shopEdTip", "1"); } catch {} const t = document.querySelector(".sh-tip"); if (t) t.remove(); }
// "2 burkar krossade tomater" → mängd "2 burkar", vara "krossade tomater"
function shopEdSplit(t){
  const s = String(t || "").trim();
  const m = s.match(/^((?:ca\s+)?[\d½¼¾⅓⅔][\d.,½¼¾⅓⅔\/–-]*(?:\s*(?:g|kg|hg|dl|cl|ml|l|liter|msk|tsk|krm|st|stora?|små|förp\.?|paket|burk|burkar|klyftor?|nypa|kruka|knippe|skivor?|flaskor?|flaska|påsar?|askar?)\.?(?=\s))?)\s+(.+)$/i);
  return m ? { q: m[1].trim(), n: m[2].trim() } : { q: "", n: s };
}
function shopEdBind(box, l, findG, save){
  shopEdCtx = { l, findG, save };
  if (!l) return;
  const tip = box.querySelector('[data-act="tipok"]'); if (tip) tip.onclick = shopEdTipDone;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.onclick = e => { e.stopPropagation(); const r = b.getBoundingClientRect(); shopEdMenu(b.closest("[data-g]"), r.left + r.width / 2); });
  if (box.dataset.edBound) return;   // lyssnarna nedan sitter kvar när listan ritas om
  box.dataset.edBound = "1";
  const rowOf = el => el && el.closest && el.closest(".sh-row[data-g], .sh-sub[data-g], .sh-hrow[data-g]");
  let timer = null, sx = 0, sy = 0;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  box.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    const row = rowOf(e.target); if (!row) return;
    sx = e.clientX; sy = e.clientY; stop();
    timer = setTimeout(() => {
      timer = null; shopEdHoldOn();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch {}
      shopEdMenu(row, sx);
    }, 480);
  });
  box.addEventListener("pointermove", e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) stop(); });
  box.addEventListener("pointerup", stop);
  box.addEventListener("pointercancel", stop);
  box.addEventListener("scroll", stop, true);
  // Medan fingret fortfarande håller kvar (och strax efter) ska varken klick eller Androids
  // egen "långt tryck"-händelse (contextmenu) nå menyn – annars stängs den direkt (Samsung/Android)
  // eller bockas varan av när fingret släpper.
  const swallow = e => { if (shopEdSkip && !(e.type === "click" && e.target.closest && e.target.closest(".sh-menu"))) { e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener("click", swallow, true);
  document.addEventListener("contextmenu", swallow, true);
  const release = () => { if (shopEdSkip) { clearTimeout(shopEdSkipT); shopEdSkipT = setTimeout(() => { shopEdSkip = false; }, 450); } };
  ["pointerup", "pointercancel", "touchend", "touchcancel"].forEach(t => document.addEventListener(t, release, true));
  box.addEventListener("contextmenu", e => {
    const row = rowOf(e.target); if (!row) return;
    e.preventDefault(); stop();
    if ($id("shEdBg")) return;          // redan öppnad av ett långt tryck
    if (e.pointerType === "touch" || e.pointerType === "pen" || (!e.pointerType && shopEdTouch())) shopEdHoldOn();
    shopEdMenu(row, e.clientX);
  });
}
function shopEdClose(){
  const bg = $id("shEdBg"); if (bg) bg.remove();
  document.querySelectorAll(".sh-hold").forEach(r => r.classList.remove("sh-hold"));
  if (shopEdVV && window.visualViewport) { visualViewport.removeEventListener("resize", shopEdVV); visualViewport.removeEventListener("scroll", shopEdVV); }
  shopEdVV = null;
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && $id("shEdBg")) { e.stopPropagation(); e.preventDefault(); shopEdClose(); } }, true);
function shopEdMenu(row, x){
  shopEdClose();
  if (!row || !shopEdCtx || !shopEdCtx.l) return;
  const g = shopEdCtx.findG(row); if (!g.length) return;
  const home = g.every(isHomeItem), sub = row.classList.contains("sh-sub");
  const name = groupLabel(g).text;
  row.classList.add("sh-hold");
  const bg = document.createElement("div"); bg.id = "shEdBg"; bg.className = "sh-ed-bg";
  bg.innerHTML = `<div class="sh-menu" role="menu"><p>${esc(name)}</p>
    <button type="button" role="menuitem" data-m="edit">${SHOP_PEN}Ändra</button>
    ${sub ? "" : `<button type="button" role="menuitem" data-m="home">${SHOP_HOUSE_S}${home ? "Tillbaka till listan" : "Finns hemma"}</button>`}
    <button type="button" role="menuitem" data-m="del" class="r">${SHOP_TRASH}Ta bort${g.length > 1 ? ` (${g.length})` : ""}</button></div>`;
  document.body.appendChild(bg);
  const m = bg.firstElementChild, rr = row.getBoundingClientRect(), W = m.offsetWidth, H = m.offsetHeight;
  let top = rr.bottom + 4; if (top + H > innerHeight - 8) top = rr.top - H - 4;
  m.style.top = Math.max(8, top) + "px";
  m.style.left = Math.min(Math.max(8, (x == null ? rr.left + rr.width / 2 : x) - W / 2), innerWidth - W - 8) + "px";
  bg.addEventListener("click", e => { if (e.target === bg) shopEdClose(); });
  bg.addEventListener("contextmenu", e => { e.preventDefault(); shopEdClose(); });
  m.querySelector("button").focus({ preventScroll: true });
  m.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
    const a = b.dataset.m; shopEdTipDone();
    if (a === "edit") shopEdForm(g);
    else if (a === "del") { shopEdClose(); shopEdDelete(g); }
    else if (a === "home") {
      shopEdClose();
      if (home) shopEdCtx.save(g, i => ({ section: realSection(i) }));
      else { const hb = row.querySelector(".sh-hm"); if (hb) hb.click(); }
    }
  });
}
function shopEdForm(g){
  shopEdClose();
  const multi = g.length > 1;
  const bg = document.createElement("div"); bg.id = "shEdBg"; bg.className = "sh-ed-bg sh-ed-form";
  bg.innerHTML = `<form class="sh-edit" autocomplete="off"><h3>Ändra vara</h3>
    ${multi ? `<p class="sh-edn">Samma vara från ${g.length} ställen – ändra eller ta bort var för sig.</p>` : ""}
    ${g.map((i, k) => { const s = shopEdSplit(i.text); return `<div class="sh-edrow" data-k="${k}">${multi ? `<small>${esc(i.recipe_title || "Egen vara")}</small>` : ""}<div class="sh-edin"><input class="sh-edt" value="${esc(s.n)}" placeholder="Vara" aria-label="Vara" enterkeyhint="done"><input class="sh-edq" value="${esc(s.q)}" placeholder="Mängd" aria-label="Mängd" enterkeyhint="done">${multi ? `<button type="button" class="sh-edx" aria-label="Ta bort den här">${SHOP_TRASH}</button>` : ""}</div></div>`; }).join("")}
    <div class="sh-edbtns"><button class="btn accent" type="submit">Spara</button><button type="button" class="btn ghost sh-eddel">${SHOP_TRASH}Ta bort${multi ? " alla" : ""}</button><button type="button" class="linkbtn sh-edno">Avbryt</button></div></form>`;
  document.body.appendChild(bg);
  const f = bg.firstElementChild;
  // tangentbordet på telefonen ska inte täcka rutan
  if (window.visualViewport) {
    shopEdVV = () => { bg.style.top = visualViewport.offsetTop + "px"; bg.style.height = visualViewport.height + "px"; };
    visualViewport.addEventListener("resize", shopEdVV); visualViewport.addEventListener("scroll", shopEdVV); shopEdVV();
  }
  bg.addEventListener("click", e => { if (e.target === bg) shopEdClose(); });
  f.querySelector(".sh-edno").onclick = shopEdClose;
  f.querySelectorAll(".sh-edx").forEach(b => b.onclick = () => { const r = b.closest(".sh-edrow"); r.classList.toggle("gone"); b.setAttribute("aria-label", r.classList.contains("gone") ? "Ångra" : "Ta bort den här"); });
  f.querySelector(".sh-eddel").onclick = () => { shopEdClose(); shopEdDelete(g); };
  f.onsubmit = e => {
    e.preventDefault();
    const upd = [], del = [];
    f.querySelectorAll(".sh-edrow").forEach(r => {
      const i = g[+r.dataset.k];
      const t = (r.querySelector(".sh-edq").value.trim() + " " + r.querySelector(".sh-edt").value.trim()).replace(/\s+/g, " ").trim().slice(0, 200);
      if (r.classList.contains("gone") || !t) del.push(i);
      else if (t !== i.text) upd.push([i, t]);
    });
    shopEdClose();
    if (upd.length) shopEdCtx.save(upd.map(x => x[0]), i => ({ text: (upd.find(x => x[0] === i) || [0, i.text])[1] }));
    if (del.length) shopEdDelete(del);
  };
  const inp = f.querySelector(".sh-edt");
  inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch {}
}
async function shopEdDelete(g, msg, reopen){
  const ctx = shopEdCtx; if (!ctx || !ctx.l || !g.length) return;
  const listId = ctx.l.id, ids = g.map(i => i.id), name = msg || `Tog bort ${groupLabel(g).text}`;
  const keep = g.map(i => { const o = { id: i.id, list_id: i.list_id || listId, text: i.text, section: i.section || "Övrigt", recipe_id: i.recipe_id || null, recipe_title: i.recipe_title || null, added_by: i.added_by, done: !!i.done }; if (i.created_at) o.created_at = i.created_at; return o; });
  const cur = () => shopLists.find(x => x.id === listId);
  const l = cur(); if (l) l.items = l.items.filter(i => !ids.includes(i.id));
  shopOpenGroup = null; drawShop(); renderShopFab();
  const { error } = await sb.from("recipe_list_items").delete().in("id", ids);
  if (error) { toast("Kunde inte ta bort"); loadShop(); return; }
  toastActions(name, [["Ångra", async () => {
    const { data, error } = await sb.from("recipe_list_items").insert(keep).select("*");
    if (error) { toast("Kunde inte ångra"); loadShop(); return; }
    const l2 = cur(); if (l2) { (data || []).forEach(d => { if (!l2.items.some(i => i.id === d.id)) l2.items.push(d); }); l2.items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))); }
    if (reopen && !document.querySelector(".shop-body")) openShop(listId); else drawShop();
    renderShopFab();
  }]]);
}

// ---------- Inköpslistan: "Klart! Allt är handlat." när allt är avbockat ----------
var shopDoneHide = null;   // listan där man tryckt "Inte än" (visas igen när något blir oavbockat)
function shopDoneCard(){
  return `<div class="sh-done"><span class="sh-done-ic"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="sh-done-t"><b>Klart! Allt är handlat.</b><small>Töm listan så är den redo till nästa gång.</small></div>
    <div class="sh-done-b"><button type="button" class="btn small" data-done="empty">Töm listan</button><button type="button" class="linkbtn" data-done="later">Inte än</button></div></div>`;
}
function shopDoneBind(box, l){
  if (!l) return;
  const e = box.querySelector('[data-done="empty"]'), later = box.querySelector('[data-done="later"]');
  if (later) later.onclick = () => { shopDoneHide = l.id; drawShop(); };
  if (e) e.onclick = () => {
    const all = l.items.slice(); if (!all.length) return;
    shopDoneHide = null;
    closeSheet();   // tillbaka dit man var; Ångra öppnar listan igen
    shopEdDelete(all, "Inköpslistan är tömd", true);
  };
}

// ---------- Testläge: vilken modell svarade i Fråga Pappa (syns bara för admin) ----------
// Sätt till false (eller ta bort) när testet är klart.
var PAPPA_TEST = true;
function aiModelHtml(it, i){
  if (!PAPPA_TEST || !can("admin") || it.busy || it.err || !it.model) return "";
  const tag = (m) => `<span class="aim-tag${m === "sonnet" ? " s" : ""}"><i></i>${m === "sonnet" ? "Sonnet" : "Haiku"}</span>`;
  if (it.model === "haiku>sonnet") return `<div class="ai-model">${tag("haiku")}→${tag("sonnet")}ändring</div>`;
  return `<div class="ai-model">${tag(it.model)}</div>`;
}

// "Pappa, fundera lite till": under svar från Haiku (inte ändringar), för alla. Ställer samma fråga till Sonnet.
function aiDeepHtml(it, i){
  if (it.busy || it.err || it.model !== "haiku" || it.deeper || it.change || !it.a) return "";
  const ico = THINK_SVG.replace('class="think-ico"', 'class="deep-ico"').replace('width="30" height="30"', 'width="22" height="22"');
  return `<div class="deep-row"><button type="button" class="aiq deep" data-a="aideep" data-i="${i}">${ico}Pappa, fundera lite till</button></div>`;
}

// ---------- Anteckningar som tidslinje (förslag E1) ----------
// r.noteItems = [{ id, kind: "pappa" | "own" | "log" | "old", q, text, date, by }], äldst först.
// r.notes hålls i synk som ren text, så sökningen, Pappa och äldre appversioner fungerar som förut.
var noteUi = { open: null, edit: null, scroll: {}, armed: null };
var NOTE_HAT = `<svg class="nt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5V7a2 2 0 0 1 .6-3.9 2.8 2.8 0 0 1 5.2-.6 2.6 2.6 0 0 1 4.6 1.4A2 2 0 0 1 17 7.5v2"/><path d="M6 9.5h11"/><path d="M6 9.5a7 7 0 0 0-1 3.7V21"/><path d="M17 9.5c.6.9 1 2 1 3.2l1.5 2.8H18v2.5a1.8 1.8 0 0 1-1.8 1.8H14V21"/><path d="M11.5 11a2.6 2.6 0 0 0-1.5 4.7v1h3v-1A2.6 2.6 0 0 0 11.5 11z" fill="currentColor" fill-opacity=".3"/><path d="M10.4 18h2.2"/></svg>`;
var NOTE_PEN = `<svg class="nt-ico pen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>`;
function notesText(items){
  return items.map(n => ((n.kind === "pappa" && n.q ? n.q + "\n" : "") + String(n.text || "").replace(/\*\*/g, "")).trim()).filter(Boolean).join("\n\n");
}
function noteItemsOf(r){
  if (!r) return [];
  if (!Array.isArray(r.noteItems)) return r.notes && r.notes.trim() ? [{ id: "old", kind: "old", text: r.notes.trim() }] : [];
  const items = r.noteItems.slice();
  // Text som en äldre appversion har lagt till direkt i r.notes visas som en egen post
  const txt = notesText(items), n = (r.notes || "").trim();
  if (n && n !== txt && n.startsWith(txt)) { const tail = n.slice(txt.length).trim(); if (tail) items.push({ id: "x" + txt.length, kind: "own", text: tail }); }
  return items;
}
function noteNew(kind, text, q){
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, q: q || "", text: String(text || "").trim(), date: today(), by: me || "" };
}
function notesWith(r, add){ const items = noteItemsOf(r).concat(add ? [add] : []); return { noteItems: items, notes: notesText(items) }; }
function saveNoteItems(r, items){ return patch(r.id, { noteItems: items, notes: notesText(items) }); }
function addNote(r, n){ return patch(r.id, notesWith(r, n)); }
// i baren (drinkar) heter anteckningar "tips"
function noteBar(){ if (view.name !== "detail") return false; const r = recipes.find(x => x.id === view.id); return typeof isDrink === "function" && isDrink(r); }
var NOTE_BAR_OPTS = { title: "Tips från bartendern", add: "+ Nytt tips", first: "+ Lägg till ett tips", ph: "Vilken vermouth, hur mycket is, vad gästerna tyckte …", cls: "dk-notes" };
function noteTitle(n){ return n.kind === "pappa" ? (n.q || "Pappa") : n.kind === "old" ? (noteBar() ? "Äldre tips" : "Äldre anteckningar") : n.kind === "log" ? (noteBar() ? "Ändring i drinken" : "Ändring i receptet") : (noteBar() ? "Tips" : "Egen anteckning"); }
function noteShortDate(d){
  if (!d) return "";
  try { const x = new Date(d); const o = { day: "numeric", month: "short" }; if (x.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return x.toLocaleDateString("sv-SE", o).replace(".", ""); } catch { return d; }
}
function notePreview(t){ return String(t || "").replace(/\*\*/g, "").split("\n").map(l => l.trim().replace(/^([-*•]|\d+[.)]|#+)\s+/, "")).filter(Boolean).join(" · "); }
function notesPanelHtml(r, o = {}){
  const ed = canEdit(r);
  const T = { title: o.title || "Anteckningar", add: o.add || "+ Ny anteckning", first: o.first || "+ Lägg till anteckning", ph: o.ph || "Tips, vin till, vad gästerna tyckte …", cls: o.cls || "" };
  const items = noteItemsOf(r).slice().reverse();
  if (noteUi.rid !== r.id) { noteUi.rid = r.id; noteUi.open = null; noteUi.edit = null; noteUi.armed = null; }
  if (!items.length && noteUi.edit !== "new") return ed ? `<div class="panel notes-empty ${T.cls}"><button class="linkbtn" data-a="ntnew">${T.first}</button></div>` : "";
  const editor = (id, val) => `<div class="nt-ed"><textarea id="nt-input" data-n="${esc(id)}" rows="4" placeholder="${esc(T.ph)}">${esc(noteUi.draftFor === id ? noteUi.draft : val)}</textarea>
    <div class="row"><button class="btn accent small" data-a="ntsave" data-n="${esc(id)}">Spara</button><button class="btn ghost small" data-a="ntcancel">Avbryt</button></div></div>`;
  const card = n => {
    const open = noteUi.open === n.id || noteUi.edit === n.id, editing = noteUi.edit === n.id;
    const who = n.kind === "pappa" ? "Pappa" : n.by ? nameOf(n.by) : "";
    const date = noteShortDate(n.date);
    return `<div class="nt-it k-${n.kind}">
      <div class="nt-date">${esc(date)}</div>
      <div class="nt-card${open ? " open" : ""}">
        <div class="nt-hd" data-a="ntopen" data-n="${esc(n.id)}" role="button" aria-expanded="${open}">
          ${n.kind === "pappa" ? NOTE_HAT : NOTE_PEN}
          <span class="nt-q">${esc(noteTitle(n))}</span>
          <span class="nt-m">${esc([date, open && who && n.kind !== "pappa" ? who : ""].filter(Boolean).join(" · "))}</span>
          <span class="nt-chev" aria-hidden="true"></span>
        </div>
        ${editing ? editor(n.id, n.text || "")
          : open ? `<div class="nt-body">${aiMd(n.text || "")}</div>${ed ? `<div class="nt-tools"><button class="linkbtn" data-a="ntedit" data-n="${esc(n.id)}">Redigera</button><button class="linkbtn${noteUi.armed === n.id ? " armed" : ""}" data-a="ntdel" data-n="${esc(n.id)}">${noteUi.armed === n.id ? "Säker? Tryck igen" : "Ta bort"}</button></div>` : ""}`
          : `<div class="nt-pv">${esc(notePreview(n.text))}</div>`}
      </div></div>`;
  };
  const many = items.length > 3;
  return `<div class="panel notes-tl ${T.cls}"><h2><span>${T.title}${items.length > 1 ? `<span class="nt-cnt">${items.length}</span>` : ""}</span>${ed && noteUi.edit !== "new" ? `<button class="linkbtn nt-add" data-a="ntnew">${T.add}</button>` : ""}</h2>
    ${noteUi.edit === "new" ? `<div class="nt-new">${editor("new", "")}</div>` : ""}
    ${items.length ? `<div class="nt-scroll${many ? " many" : ""}" id="nt-scroll" data-rid="${esc(r.id)}"><div class="nt-tl">${items.map(card).join("")}</div></div>
    ${many ? `<div class="nt-hint">Scrolla för äldre ${noteBar() ? "tips" : "anteckningar"}</div>` : ""}` : ""}
  </div>`;
}
function notesScrollRestore(){
  const s = document.getElementById("nt-scroll"); if (!s) return;
  const top = noteUi.scroll[s.dataset.rid]; if (top) s.scrollTop = top;
  if (!s._nt) { s._nt = 1; s.addEventListener("scroll", () => { noteUi.scroll[s.dataset.rid] = s.scrollTop; s.classList.toggle("end", s.scrollTop + s.clientHeight >= s.scrollHeight - 4); }, { passive: true }); }
  s.classList.toggle("end", s.scrollTop + s.clientHeight >= s.scrollHeight - 4);
}
// behåll texten om sidan ritas om medan man skriver
document.addEventListener("input", e => { if (e.target.id === "nt-input") { noteUi.draftFor = e.target.dataset.n; noteUi.draft = e.target.value; } });
function noteFocus(){ const t = document.getElementById("nt-input"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-a^='nt']"); if (!el) return;
  const a = el.dataset.a; if (!["ntopen", "ntnew", "ntedit", "ntdel", "ntsave", "ntcancel"].includes(a)) return;
  const r = view.id ? recipes.find(x => x.id === view.id) : null; if (!r) return;
  const id = el.dataset.n;
  if (a !== "ntopen" && a !== "ntcancel" && !canEdit(r)) { toast("Det här är " + genitive(nameOf(addedByOf(r))) + " recept – gör din egen variant för att ändra"); return; }
  if (a !== "ntdel") noteUi.armed = null;
  if (a === "ntnew" || a === "ntedit" || a === "ntcancel" || a === "ntsave") { if (a !== "ntsave") { noteUi.draftFor = null; noteUi.draft = ""; } }
  if (a === "ntopen") { if (noteUi.edit === id) return; noteUi.open = noteUi.open === id ? null : id; render(); return; }
  if (a === "ntcancel") { noteUi.edit = null; render(); return; }
  if (a === "ntnew") { noteUi.edit = "new"; noteUi.open = null; render(); noteFocus(); return; }
  if (a === "ntedit") { noteUi.edit = id; noteUi.open = id; render(); noteFocus(); return; }
  if (a === "ntdel") {
    if (noteUi.armed !== id) { noteUi.armed = id; render(); setTimeout(() => { if (noteUi.armed === id) { noteUi.armed = null; render(); } }, 3500); return; }
    noteUi.armed = null; noteUi.open = null;
    if (await saveNoteItems(r, noteItemsOf(r).filter(n => n.id !== id))) toast(noteBar() ? "Tipset är borttaget" : "Anteckningen är borttagen");
    return;
  }
  if (a === "ntsave") {
    const val = ($id("nt-input") ? $id("nt-input").value : "").trim();
    let items = noteItemsOf(r);
    if (id === "new") { if (!val) { noteUi.edit = null; render(); return; } items = items.concat(noteNew("own", val)); }
    else items = val ? items.map(n => n.id === id ? { ...n, text: val } : n) : items.filter(n => n.id !== id);
    noteUi.edit = null; noteUi.draftFor = null; if (id === "new") { noteUi.open = null; noteUi.scroll[r.id] = 0; }
    if (await saveNoteItems(r, items)) toast(noteBar() ? "Tipset är sparat" : "Anteckningen är sparad");
  }
});

// ---------- typ av rätt (nov 2026): gruppen "Rätt" i nyckelorden ----------
function dishTypes(){ const gs = tagGroups(); const g = gs.find(x => /rätt/i.test(x[0])) || gs[0]; return g ? g[1] : []; }
function hasDishType(tags){ const d = dishTypes(); return (tags || []).some(t => d.includes(t)); }
function dishChips(sel, attr){ return dishTypes().map(t => `<button type="button" class="ftag ${sel === t ? "on" : ""}" ${attr}="${esc(t)}">${esc(t)}</button>`).join(""); }
async function dishTypeAi(items){   // items: [{id, title, time, tags, ingredients}] → {id: typ}
  const d = dishTypes();
  const prompt = `Bestäm typ av rätt för varje recept. Välj EXAKT ett ord ur listan: ${d.join(", ")}. ${TAG_HINTS}
Svara bara med JSON: {"<id>": "<typ>", ...}

Recept:
${JSON.stringify(items.map(r => ({ id: r.id, titel: r.title, tid: r.time || "", nyckelord: r.tags || [], ingredienser: (r.ingredients || []).filter(x => !x.startsWith("#")).slice(0, 10) })))}`;
  const out = parseJson(await ai(prompt, { mode: "json", fast: true })) || {};
  const res = {};
  for (const r of items) { const t = String(out[r.id] || "").toLowerCase().trim(); if (d.includes(t)) res[r.id] = t; }
  return res;
}
// Spara utan typ: fråga först (inget AI-anrop utan tryck)
function askDishType(){
  openSheet(`<h2>Vilken typ av rätt?</h2>
    <p>Då hittas receptet när någon filtrerar på typ.</p>
    <div class="ftags dt-chips" id="dtChips">${dishChips(null, "data-dt")}</div>
    <p class="err" id="dtErr" hidden></p>
    <div class="row dt-foot"><button class="linkbtn" id="dtSkip">Spara utan typ</button><button class="btn ghost" id="dtAi">Låt Pappa välja</button></div>`);
  const done = t => {
    if (!draft) return;
    if (t && $id("tagsField")) {
      const cur = $id("tagsField").value.split(",").map(x => x.trim()).filter(Boolean).filter(x => !dishTypes().includes(x)).concat(t);
      $id("tagsField").value = cur.join(", ");
      if ($id("tagPick")) $id("tagPick").innerHTML = tagPickHtml(cur);
    }
    draft._typeOk = true; closeSheet();
    const b = $id("savebtn"); if (b) b.click();
  };
  $id("dtChips").onclick = e => { const b = e.target.closest("[data-dt]"); if (b) done(b.dataset.dt); };
  $id("dtSkip").onclick = () => done(null);
  $id("dtAi").onclick = async () => {
    const b = $id("dtAi"); b.disabled = true; b.textContent = "Pappa tänker …";
    try {
      readForm();
      const res = await dishTypeAi([{ id: "r", title: draft.title, time: draft.time, tags: draft.tags, ingredients: draft.ingredients }]);
      if (!$id("dtAi")) return;
      if (res.r) done(res.r);
      else { b.disabled = false; b.textContent = "Låt Pappa välja"; $id("dtErr").hidden = false; $id("dtErr").textContent = "Pappa kunde inte bestämma sig – välj själv."; }
    } catch (e) { if ($id("dtAi")) { b.disabled = false; b.textContent = "Låt Pappa välja"; $id("dtErr").hidden = false; $id("dtErr").textContent = aiErr(e); } }
  };
}
// Konto → Typ av rätt: recept utan typ, Pappa (Haiku) föreslår vid tryck, man rättar och sparar
function openTypeTool(){
  const list = recipes.filter(r => canEdit(r) && !hasDishType(r.tags)).sort((a, b) => (a.title || "").localeCompare(b.title || "", "sv"));
  const sel = {}, saved = [];
  if (!list.length) { openSheet(`<h2>Typ av rätt</h2><p>Alla recept har en typ av rätt.</p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="tyClose">Stäng</button></div>`); $id("tyClose").onclick = closeSheet; return; }
  openSheet(`<h2>Typ av rätt</h2>
    <p>${list.length} recept saknar typ. Låt Pappa föreslå, eller välj själv – tryck på en annan om han gissat fel.</p>
    <div class="row ty-top"><button class="btn small" id="tyAi">Låt Pappa föreslå</button><span class="hnote" id="tyMsg"></span></div>
    <div id="tyList" class="ttlist tylist">${list.map(r => `<div class="tyrow" data-row="${esc(r.id)}"><b>${esc(r.title || "")}${r.variantOf ? ` <span class="hnote">variant</span>` : ""}</b><div class="ftags">${dishChips(null, "data-ty")}</div></div>`).join("")}</div>
    <div class="row ty-foot"><span class="hnote">Allt kan ångras</span><span class="row" style="gap:8px"><button class="btn ghost" id="tyClose">Stäng</button><button class="btn accent" id="tyGo" disabled>Spara 0 recept</button></span></div>`);
  const paint = id => { const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`); if (row) row.querySelectorAll("[data-ty]").forEach(b => b.classList.toggle("on", sel[id] === b.dataset.ty)); };
  const count = () => { const n = Object.keys(sel).length, g = $id("tyGo"); if (g && !saved.length) { g.disabled = !n; g.textContent = `Spara ${n} recept`; } };
  $id("tyClose").onclick = closeSheet;
  $id("tyList").onclick = e => {
    const b = e.target.closest("[data-ty]"); if (!b || saved.length) return;
    const id = b.closest("[data-row]").dataset.row;
    if (sel[id] === b.dataset.ty) delete sel[id]; else sel[id] = b.dataset.ty;
    paint(id); count();
  };
  $id("tyAi").onclick = async () => {
    const b = $id("tyAi"); b.disabled = true; b.textContent = "Pappa tänker …";
    const todo = list.filter(r => !sel[r.id]); let got = 0, err = "";
    for (let i = 0; i < todo.length; i += 15) {
      if (!$id("tyList")) return;
      $id("tyMsg").textContent = `${Math.min(i + 15, todo.length)} av ${todo.length}`;
      try { const res = await dishTypeAi(todo.slice(i, i + 15)); for (const id in res) if (!sel[id]) { sel[id] = res[id]; got++; paint(id); } }
      catch (e) { err = aiErr(e); }
    }
    if (!$id("tyList")) return;
    count(); b.textContent = "Låt Pappa föreslå"; b.disabled = false;
    $id("tyMsg").textContent = err ? `! ${err}` : `Pappa föreslog ${got} – kolla och spara`;
  };
  $id("tyGo").onclick = async () => {
    const g = $id("tyGo"); g.disabled = true; g.textContent = "Sparar …";
    const d = dishTypes();
    for (const r of list) {
      const t = sel[r.id]; if (!t) continue;
      const before = r.tags || [];
      if (await patch(r.id, { tags: before.filter(x => !d.includes(x)).concat(t), tagsBefore: before })) saved.push(r.id);
    }
    if (!$id("tyGo")) return;
    g.textContent = `Klart – ${saved.length} recept sparade`;
    $id("tyAi").disabled = true;
    if (saved.length) {
      $id("tyMsg").innerHTML = `<button class="linkbtn" id="tyUndo">Ångra alla</button>`;
      $id("tyUndo").onclick = async () => {
        const u = $id("tyUndo"); u.disabled = true; u.textContent = "Ångrar …";
        for (const id of saved) { const r = recipes.find(x => x.id === id); if (r && Array.isArray(r.tagsBefore)) await patch(id, { tags: r.tagsBefore, tagsBefore: null }); }
        if ($id("tyMsg")) $id("tyMsg").textContent = "Ångrat";
      };
    }
  };
}

// ---------- påminnelse om aviseringar (kort under sökfältet, förslag B) ----------
// Visas på enheter som inte svarat ja/nej, och när någon händelse är avstängd i Konto. "Inte nu" döljer i en vecka.
var NF_ASK_BELL = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M12 3v2"/></svg>';
function nfAskGet(){ try { return JSON.parse(localStorage.getItem("nfAsk") || "{}") || {}; } catch { return {}; } }
function nfAskSet(o){ try { localStorage.setItem("nfAsk", JSON.stringify(o)); } catch {} }
// Testläge: admin får påminnelsen direkt igen vid nästa start (Inte nu döljer bara tills appen öppnas igen).
// Alla andra: Inte nu döljer i en vecka. Sätt till false när Nicklas är klar med testet.
var NF_ASK_TEST = false;
var nfAskHidden = false, nfPrefs = null, nfPrefsBusy = false;
function nfOffKinds(){ return nfPrefs ? NOTIFY_KINDS.filter(([k]) => nfPrefs[k] === false).length : 0; }
function nfLoadPrefs(){
  if (nfPrefs || nfPrefsBusy || !sb || !me) return;
  nfPrefsBusy = true;
  sb.rpc("recipe_notify_prefs_get").then(({ data, error }) => {
    nfPrefsBusy = false; nfPrefs = error ? {} : (data || {});
    if (nfOffKinds() && view.name === "list") render();
  }, () => { nfPrefsBusy = false; nfPrefs = {}; });
}
function nfAskMode(){
  try {
    if (!me || !storageOk || !loaded || !recipes.length || nfAskHidden) return "";
    const a = nfAskGet();
    if (!(NF_ASK_TEST && role === "admin") && a.until && Date.now() < a.until) return "";
    const d = deviceInfo();
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return d.kind === "ios" && !d.installed ? "ios" : "";
    if (Notification.permission === "default") return "ask";
    if (Notification.permission === "granted") { nfLoadPrefs(); return nfOffKinds() ? "some" : ""; }
    return "";
  } catch { return ""; }
}
function nfAskHtml(){
  if (filter.q && filter.q.trim()) return "";
  const m = nfAskMode(); if (!m) return "";
  const off = nfOffKinds();
  const title = m === "some" ? "Vill du få alla aviseringar?" : "Vill du få aviseringar?";
  const sub = m === "some" ? `${off} av ${NOTIFY_KINDS.length} händelser är avstängda. Slå på allt med ett tryck.` : "Nya recept, när någon lagar och timern, även när appen är stängd.";
  return `<div class="nfp-card"><span class="nfp-ico">${NF_ASK_BELL}</span><span class="nfp-txt"><b>${title}</b><small>${sub}</small></span><span class="nfp-acts"><button type="button" class="nfp-x" data-nfp="later">Inte nu</button><button type="button" class="btn accent small" data-nfp="on">${m === "some" ? "Slå på allt" : "Slå på"}</button></span></div>`;
}
function nfAskIosSheet(){
  openSheet(`<div class="sheet-head"><h2>Vill du få aviseringar?</h2><button class="iconbtn fp-x" id="closeSheetBtn" aria-label="Stäng">×</button></div>
    <div class="nfp-lead"><span class="nfp-ico">${NF_ASK_BELL}</span><p>På iPhone fungerar aviseringar bara när appen ligger på hemskärmen. Det tar tio sekunder:</p></div>
    <ol class="nfp-steps"><li><span>Tryck på <b>Dela</b> ⬆︎ längst ner i Safari</span></li><li><span>Välj <b>Lägg till på hemskärmen</b></span></li><li><span>Öppna appen från ikonen och tryck <b>Slå på</b></span></li></ol>
    <div class="nfp-btns"><button type="button" class="btn ghost" id="nfpIosOk">Okej</button></div>`);
  $id("closeSheetBtn").onclick = closeSheet;
  $id("nfpIosOk").onclick = closeSheet;
}
document.addEventListener("click", async e => {
  const b = e.target.closest && e.target.closest("[data-nfp]"); if (!b) return;
  if (b.dataset.nfp === "later") {
    nfAskHidden = true; nfAskSet({ until: Date.now() + 7 * 864e5 });
    toast("Okej, jag påminner igen om en vecka. Du hittar allt under Konto → Aviseringar");
    render(); return;
  }
  if (nfAskMode() === "ios") { nfAskIosSheet(); return; }
  b.disabled = true;
  const st = await ensurePush();
  if (st === "ok") {
    // Ett tryck = allt på: enheten och alla händelser
    const p = Object.assign({}, nfPrefs || {}); NOTIFY_KINDS.forEach(([k]) => { p[k] = true; });
    const { error } = await sb.rpc("recipe_notify_prefs_set", { p_prefs: p });
    if (!error) nfPrefs = p;
    toast(error ? "Aviseringar påslagna, men valen kunde inte sparas" : "Allt är påslaget");
  } else toast(st === "denied" ? "Aviseringar blockerades. Ändra i telefonens inställningar." : "Det gick inte att slå på aviseringar");
  render();
});

// ---------- Baren (A2, nov 2026) ----------
// Recept med typen "dryck" visas i en egen avdelning: kort på startsidan → barens startsida (view "bar") → drinksida.
// Drinksidan ritas av renderDrink() när ett dryck-recept öppnas; "Alla funktioner" visar vanliga receptsidan.
// Glas, metod, garnering, sprit och färg läses ut ur receptet (r.bar kan skriva över). Matilda = AI-bartendern.
var BAR_ROWS_FROM = 12;            // från så många drinkar blir rutnätet en radlista
var barState = { base: "", by: "" };
var drinkFull = {};               // id -> true: visa vanliga receptsidan
var matState = {};                // id -> [{q, a, busy, err}]
var barUid = 0;
function isDrink(r){ return !!r && Array.isArray(r.tags) && r.tags.includes("dryck"); }
function barDrinks(){ return recipes.filter(isDrink); }
function barIsDrinkView(){ if (view.name !== "detail") return false; const r = recipes.find(x => x.id === view.id); return isDrink(r) && !drinkFull[view.id]; }
function barTheme(){
  const on = view.name === "bar" || barIsDrinkView();
  document.body.classList.toggle("barmode", on);
  $app.classList.toggle("barview", on);
}
function barShade(hex, f){
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i); if (!m) return hex;
  const n = parseInt(m[1], 16); let rr = n >> 16, gg = (n >> 8) & 255, bb = n & 255;
  const t = f < 0 ? 0 : 255, k = Math.abs(f);
  rr = Math.round(rr + (t - rr) * k); gg = Math.round(gg + (t - gg) * k); bb = Math.round(bb + (t - bb) * k);
  return "#" + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
}
// Läser ut glas, metod, garnering, sprit och färg ur receptets text
function barInfo(r){
  const b = r.bar || {};
  const title = String(r.title || "").toLowerCase();
  const ing = (r.ingredients || []).join("\n").toLowerCase();
  const steps = (r.steps || []).join("\n").toLowerCase();
  const all = title + "\n" + ing + "\n" + steps;
  let base = b.base;
  if (!base) {
    const B = [[/whisk(e)?y|bourbon|\brye\b|scotch|maltwhisky/, "Whisky"], [/\b(ljus |mörk |vit |brun )?rom\b|rum\b|cachaça|cachaca/, "Rom"], [/tequila|mezcal/, "Tequila"], [/konjak|cognac|brandy|calvados|armagnac/, "Konjak"], [/\bgin\b/, "Gin"], [/vodka/, "Vodka"],
      [/champagne|cava\b|prosecco|mousserande|crémant|cremant|bubbel(?!vatten)/, "Bubbel"], [/glögg|\bvin\b|rödvin|vitt vin|rosévin|portvin|sherry/, "Vin"],
      [/likör|vermouth|campari|aperol|snaps|akvavit|brännvin|\böl\b|cider|amaretto|baileys|kahl[uú]a|limoncello|pastis|absint/, "Övrigt"]];
    const hit = B.find(([re]) => re.test(ing) || re.test(title));
    base = hit ? hit[1] : "Alkoholfritt";
  }
  let glass = b.glass;
  if (!glass) {
    const G = [[/coupe/, "Coupe"], [/martiniglas|cocktailglas/, "Martiniglas"], [/champagneglas|flöjt/, "Champagneglas"], [/tumlare|whiskyglas|rocksglas|old fashioned-glas/, "Tumlare"], [/highball|longdrinkglas|högt glas|collins/, "Highball"], [/vinglas|ballongglas/, "Vinglas"], [/kopp|mugg/, "Kopp"]];
    const hit = G.find(([re]) => re.test(all)); glass = hit ? hit[1] : "";
  }
  let method = b.method;
  if (!method) method = /skaka|shaker|skakas/.test(steps) ? "Skakad" : /\brör\b|rör om|rör ihop|rörs\b|rör runt|rör .{0,30}med is/.test(steps) ? "Rörd" : /mixa|mixer|blender/.test(steps) ? "Mixad" : /värm|koka upp|sjud/.test(steps) ? "Varm" : /toppa|fyll (på|upp)|bygg|häll .{0,30}över is/.test(steps) ? "Byggd" : "";
  let garnish = b.garnish, gk = "";
  const GN = [[/körsbär|cocktailbär|maraschino/, "Körsbär", "cherry"], [/oliv/, "Oliv", "olive"], [/kaffebön/, "Kaffebönor", "beans"], [/mynta/, "Mynta", "mint"], [/apelsin/, "Apelsin", "orange"], [/citronskal|citronzest|citrontwist|twist/, "Citronskal", "twist"], [/\blime/, "Lime", "lime"], [/citron/, "Citron", "lemon"], [/gurk/, "Gurka", "lime"]];
  const gseg = (steps.match(/garner\w*\s+(med\s+)?([^.\n]+)/) || [])[2] || "";
  const gHit = (gseg && GN.find(([re]) => re.test(gseg))) || GN.find(([re]) => re.test(ing));
  if (gHit) { gk = gHit[2]; if (!garnish) garnish = gHit[1]; }
  if (garnish && !gk) { const h = GN.find(([re]) => re.test(String(garnish).toLowerCase())); gk = h ? h[2] : ""; }
  let kind = { Coupe: "coupe", Martiniglas: "martini", Champagneglas: "flute", Tumlare: "rocks", Highball: "highball", Vinglas: "wine", Kopp: "rocks" }[glass] || "";
  const bub = /tonic|soda|bubbelvatten|kolsyrat|champagne|cava\b|prosecco|mousserande|crémant|ginger ale|ginger beer|sprite|läsk|sockerdricka/.test(ing);
  if (!kind) kind = base === "Bubbel" ? "flute" : bub ? "highball" : method === "Skakad" || method === "Rörd" ? (/\bis\b.*\b(servera|i glaset)/.test(steps) ? "rocks" : "coupe") : "rocks";
  let color = b.color;
  if (!color) {
    const C = [[/campari|aperol|blodapelsin/, "#c0281c"], [/espresso|kaffe|kahl[uú]a/, "#3a2016"], [/blå curaçao|blue cura/, "#2a7fd0"], [/glögg|rödvin/, "#6d1020"], [/tranbär|granatäpple|hallon|jordgubb|grenadin/, "#b8233a"], [/mörk rom/, "#7a3510"], [/mynta|lime/, "#d7e8c0"]];
    const hit = C.find(([re]) => re.test(ing));
    color = hit ? hit[1] : ({ Whisky: "#a4531a", Konjak: "#9a4a16", Rom: "#c27a2c", Tequila: "#e9dca0", Gin: "#e6ecdc", Vodka: "#e9eee6", Bubbel: "#ecd58f", Vin: "#8a1a2a", Övrigt: "#d9a54a", Alkoholfritt: "#efe2a0" })[base] || "#d9a54a";
  }
  return { base, glass, method, garnish, gk, kind, color, bub, foam: /äggvita|aquafaba/.test(ing), crema: /espresso/.test(ing) };
}
// Tecknat glas när drinken saknar foto (guldlinje, vätska i drinkens färg, garnering, bubblor)
function barGlassSvg(info, opt){
  opt = opt || {};
  const id = "bg" + (barUid++), k = info.kind, c = info.color, c2 = barShade(info.color, -0.38);
  const S = {
    coupe: ["M14 34 Q14 74 50 76 Q86 74 86 34 Z", "M17 42 Q20 72 50 73 Q80 72 83 42 Z", 42, 34, 84],
    martini: ["M10 26 L90 26 L50 74 Z", "M17 34 L83 34 L50 70 Z", 34, 26, 84],
    flute: ["M36 14 Q34 70 50 86 Q66 70 64 14 Z", "M37.5 28 Q36 70 50 83 Q64 70 62.5 28 Z", 28, 14, 64],
    wine: ["M28 14 Q22 62 50 72 Q78 62 72 14 Z", "M28.5 36 Q26 62 50 69 Q74 62 71.5 36 Z", 36, 14, 72],
    rocks: ["M20 56 L80 56 L77 128 Q50 132 23 128 Z", "M21.5 70 L78.5 70 L76 126 Q50 130 24 126 Z", 70, 56, 80],
    highball: ["M30 18 L70 18 L68 130 Q50 133 32 130 Z", "M31 32 L69 32 L67 128 Q50 131 33 128 Z", 32, 18, 70],
  }[k] || null;
  const [bowl, liq, ly, rim, rx] = S || ["M20 56 L80 56 L77 128 Q50 132 23 128 Z", "M21.5 70 L78.5 70 L76 126 Q50 130 24 126 Z", 70, 56, 80];
  const stem = ["coupe", "martini", "flute", "wine"].includes(k) ? `<path d="M50 ${k === "flute" ? 86 : k === "wine" ? 72 : k === "coupe" ? 76 : 74} L50 126 M30 130 Q50 122 70 130"/>` : "";
  const cube = (x, y, s, a) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" transform="rotate(${a} ${x + s / 2} ${y + s / 2})" fill="rgba(255,255,255,.25)" stroke="#fff" stroke-width=".8"/>`;
  const ice = k === "rocks" ? `<g clip-path="url(#c${id})" opacity=".55">${cube(30, 76, 22, -8)}${cube(50, 88, 20, 10)}</g>` : k === "highball" ? `<g clip-path="url(#c${id})" opacity=".5">${cube(36, 40, 18, -10)}${cube(46, 62, 17, 12)}${cube(37, 86, 17, 6)}</g>` : "";
  const top = k === "rocks" ? 56 : rim;
  let gar = "";
  const sl = (x, y, r1, a, b2) => `<g transform="translate(${x} ${y})"><circle r="${r1}" fill="${a}"/><circle r="${r1 - 2.3}" fill="${b2}"/><g stroke="${a}" stroke-width=".9">${[0, 45, 90, 135].map(d => `<line x1="${-(r1 - 2.3)}" y1="0" x2="${r1 - 2.3}" y2="0" transform="rotate(${d})"/>`).join("")}</g></g>`;
  if (info.gk === "cherry") gar = `<path d="M70 ${top - 24} Q76 ${top - 14} 72 ${top - 2}" stroke="#4d6b2a" stroke-width="1.4" fill="none"/><circle cx="71" cy="${top + 1}" r="6.5" fill="#9d0f1e"/><circle cx="69" cy="${top - 1}" r="2" fill="#ff7a86" opacity=".7"/>`;
  if (info.gk === "olive") gar = `<path d="M28 ${top - 18} L66 ${top + 26}" stroke="#c9a55c" stroke-width="1.6"/><ellipse cx="50" cy="${top + 8}" rx="7" ry="5.5" transform="rotate(48 50 ${top + 8})" fill="#7b8f3a"/><circle cx="52" cy="${top + 10}" r="1.8" fill="#b8262c"/>`;
  if (info.gk === "orange") gar = sl(rx - 6, top, 15, "#f08a1c", "#ffbb55");
  if (info.gk === "lime") gar = sl(rx - 4, top, 12, "#4f9a2a", "#b9e07a");
  if (info.gk === "lemon") gar = sl(rx - 4, top, 12, "#e2b419", "#fbe58a");
  if (info.gk === "twist") gar = `<path d="M${rx - 4} ${top - 12} q8 6 0 12 q-8 6 0 12 q8 6 0 12" stroke="#f2c330" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (info.gk === "mint") gar = `<g transform="translate(${rx - 12} ${top - 4})"><path d="M0 0 q-10 -14 2 -22 q8 10 -2 22z" fill="#3f8f3a"/><path d="M2 0 q14 -8 18 -20 q-14 0 -18 20z" fill="#5fae4a"/></g>`;
  if (info.gk === "beans") gar = `<g fill="#2a140b" stroke="#6b3a20" stroke-width=".6"><ellipse cx="42" cy="${ly + 1}" rx="3.6" ry="2.4"/><ellipse cx="50" cy="${ly}" rx="3.6" ry="2.4"/><ellipse cx="58" cy="${ly + 1}" rx="3.6" ry="2.4"/></g>`;
  const layer = info.crema ? `<rect x="0" y="${ly}" width="100" height="5" fill="#c99a6a" clip-path="url(#c${id})"/>` : info.foam ? `<rect x="0" y="${ly}" width="100" height="8" fill="#fff5dc" clip-path="url(#c${id})"/>` : "";
  let bubs = "";
  if (info.bub && opt.bubbles !== false) for (let i = 0; i < 6; i++) bubs += `<i class="bub" style="left:${40 + (i * 13) % 22}%;bottom:${18 + (i % 3) * 6}%;animation-delay:${(i * .55).toFixed(2)}s;width:${2 + i % 3}px;height:${2 + i % 3}px"></i>`;
  return `<div class="bglass"><svg viewBox="0 0 100 140" aria-hidden="true"><defs><linearGradient id="l${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c2}"/></linearGradient><clipPath id="c${id}"><path d="${liq}"/></clipPath><radialGradient id="h${id}" cx=".3" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="50" cy="133" rx="32" ry="4" fill="#000" opacity=".35"/><path d="${liq}" fill="url(#l${id})" opacity=".95"/>${layer}${ice}<path d="${liq}" fill="url(#h${id})"/>
    <g fill="rgba(255,255,255,.06)" stroke="#d8b874" stroke-width="${opt.sw || 1.6}" stroke-linejoin="round" stroke-linecap="round"><path d="${bowl}"/>${stem}</g>${gar}</svg>${bubs}</div>`;
}
var BAR_ZIG = `<svg class="bzig" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M1 129 V22 H13 V12 H27 V2 H73 V12 H87 V22 H99 V129 Z"/><path vector-effect="non-scaling-stroke" opacity=".45" d="M5 125 V26 H17 V16 H31 V6 H69 V16 H83 V26 H95 V125 Z"/></svg>`;
// symbol under "drinkar · Skål!": två coupeglas som skålar (förslag 1, nov 2026)
var BAR_FAN = `<svg class="bfan" viewBox="0 0 70 40" fill="none" stroke="#c9a55c" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-14 26 22)"><path d="M14 8h20c0 6-4.5 9-10 9s-10-3-10-9z" fill="rgba(201,165,92,.18)"/><path d="M24 17v14M18 32h12"/></g><g transform="rotate(14 44 22)"><path d="M36 8h20c0 6-4.5 9-10 9s-10-3-10-9z" fill="rgba(201,165,92,.18)"/><path d="M46 17v14M40 32h12"/></g><path d="M35 2v3M30 3.5l1.5 2.5M40 3.5l-1.5 2.5"/><circle cx="35" cy="6.5" r=".9" fill="#c9a55c"/></svg>`;
function barBg(info){ return `background:radial-gradient(90% 75% at 50% 78%,${barShade(info.color, -.38)}aa 0%,#123129 60%,#0c1f1a 100%)`; }
// Bild i trappramen: foto om det finns, annars tecknat glas
function barPic(r, info, opt){
  return r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : barGlassSvg(info, opt);
}
function barIngNames(r){ return (r.ingredients || []).filter(x => !x.startsWith("#")).map(x => barIngSplit(x)[1].replace(/\s*\(.*?\)\s*/g, " ").trim()).filter(Boolean).slice(0, 3).join(", "); }
function barIngSplit(line){
  const m = String(line).match(/^\s*((?:ca\s+)?[\d½¼¾⅓⅔⅛][\d½¼¾⅓⅔⅛,.\/\s–-]*?)\s*(?:(cl|ml|dl|l|msk|tsk|krm|st|g|stänk|skvätt|klyftor|klyfta|skivor|skiva|kvistar|kvist|blad|droppar|droppe)(?![a-zåäöé]))?\.?\s*([^\d\s,.\/–½¼¾⅓⅔⅛-].*)$/i);
  if (!m) return ["", String(line)];
  return [m[1].trim() + (m[2] ? " " + m[2] : ""), m[3]];
}
function barBases(list){
  const order = ["Whisky", "Gin", "Rom", "Vodka", "Tequila", "Konjak", "Bubbel", "Vin", "Övrigt", "Alkoholfritt"];
  const have = new Set(list.map(r => barInfo(r).base));
  return order.filter(b => have.has(b));
}
// Kortet på startsidan, under sökfältet
function barCardHtml(){
  if (filter.q.trim() || filter.tags.length || filter.fav || filter.mine || filter.cookedMe) return "";
  const ds = barDrinks(); if (!ds.length) return "";
  const pick = ds.slice().sort((a, b) => (b.photo ? 1 : 0) - (a.photo ? 1 : 0) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);
  return `<button class="barcard" data-a="baropen" aria-label="Gå in i baren"><span class="bc-rays" aria-hidden="true"></span>
    <span class="bc-t"><span class="bc-k">Sivander</span><b class="bshim">BAREN</b><span class="bc-n">${ds.length} ${ds.length === 1 ? "drink" : "drinkar"} · Skål!</span></span>
    <span class="bc-m">${pick.map(r => { const i = barInfo(r); return `<span class="bc-g" style="${barBg(i)}">${BAR_ZIG}${barPic(r, i, { bubbles: false })}</span>`; }).join("")}</span>
    <span class="bc-go">Välkommen in ›</span></button>`;
}
// Barens startsida
function renderBar(){
  const all = barDrinks();
  const bases = barBases(all);
  if (barState.base && !bases.includes(barState.base)) barState.base = "";
  const people = [...new Set(all.map(addedByOf))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "sv"));
  if (barState.by && !people.includes(barState.by)) barState.by = "";
  const list = all.filter(r => (!barState.base || barInfo(r).base === barState.base) && (!barState.by || addedByOf(r) === barState.by)).sort((a, b) => (a.title || "").localeCompare(b.title || "", "sv"));
  // Överst: några tips att svepa mellan
  const slides = [];
  if (all.length) {
    const day = Math.floor(Date.now() / 864e5);
    const add = (r, lbl) => { if (r && !slides.some(s => s.r.id === r.id)) slides.push({ r, lbl }); };
    const byName = all.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "", "sv"));
    add(byName[day % byName.length], "Kvällens drink");
    add(all.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0], "Senast i baren");
    add(all.slice().sort((a, b) => (b.timesCooked || 0) - (a.timesCooked || 0) || (b.rating || 0) - (a.rating || 0))[0], "Mest blandad");
  }
  const slideHtml = slides.map(({ r, lbl }) => { const i = barInfo(r); return `<div class="bslide" data-a="open" data-id="${esc(r.id)}" style="${barBg(i)}"><span class="b-rays sm" aria-hidden="true"></span><div class="bs-pic">${r.photo ? `<span class="bs-ph">${BAR_ZIG}<img src="${esc(r.photo)}" alt="" loading="lazy"></span>` : barGlassSvg(i)}</div><div class="bs-t"><span class="bsc">${lbl}</span><h3>${esc(r.title)}</h3><p>${esc(barIngNames(r))}</p><span class="bbtn">Blanda ›</span></div></div>`; }).join("");
  const rows = list.length >= BAR_ROWS_FROM;
  const card = (r, n) => { const i = barInfo(r); return rows
    ? `<div class="brow" data-a="open" data-id="${esc(r.id)}" style="animation-delay:${Math.min(n, 12) * .05}s"><div class="br-th" style="${barBg(i)}">${barPic(r, i, { bubbles: false })}</div><div class="br-t"><h4>${esc(r.title)}</h4><p>${esc(barIngNames(r))}</p></div><span class="bsc">${esc(i.base)}</span></div>`
    : `<div class="bcard" data-a="open" data-id="${esc(r.id)}" style="animation-delay:${Math.min(n, 12) * .06}s"><div class="bc-fr" style="${barBg(i)}">${BAR_ZIG}<div class="bc-in">${barPic(r, i)}</div></div><h4>${esc(r.title)}</h4><span class="bsc">${esc(i.base)}</span></div>`; };
  $app.innerHTML = `<div class="bar">
    <div class="bhero"><span class="b-rays" aria-hidden="true"></span>
      <div class="btop"><a href="#" class="bback" data-a="home">‹ Recept</a></div>
      <div class="bkick">Sivander</div><h1 class="bbig bshim">BAREN</h1>
      <div class="brule"><span class="bsc">${all.length} ${all.length === 1 ? "drink" : "drinkar"} · Skål!</span></div>${BAR_FAN}</div>
    <div class="bin">
    ${bases.length > 1 ? `<div class="bchips">${["", ...bases].map(b => `<button class="bchip ${barState.base === b ? "on" : ""}" data-a="barbase" data-b="${esc(b)}">${b || "Alla"}</button>`).join("")}</div>` : ""}
    ${people.length > 1 ? `<div class="bchips bpeople"><span class="bp-l">Lagt till av</span>${["", ...people].map(p => `<button class="bchip ${barState.by === p ? "on" : ""}" data-a="barby" data-e="${esc(p)}">${p ? esc(nameOf(p)) : "Alla"}</button>`).join("")}</div>` : ""}
    ${slides.length && !barState.base && !barState.by ? `<div class="bcar" id="bcar">${slideHtml}</div>${slides.length > 1 ? `<div class="bdots">${slides.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}` : ""}
    ${all.length ? `<div class="bsec"><span>${esc([barState.base || (barState.by ? "Drinkar" : "Alla drinkar"), barState.by ? "från " + nameOf(barState.by) : ""].filter(Boolean).join(" "))}</span></div>
      ${!list.length ? `<div class="bempty"><p>Inga drinkar matchar.</p></div>` : ""}
      <div class="${rows ? "brows" : "bgrid"}">${list.map(card).join("")}</div>`
    : `<div class="bempty"><p>Baren är tom än så länge.</p><p>Ge ett recept typen <b>dryck</b> så hamnar det här.</p></div>`}
    </div></div>
    ${can("contributor") ? `<button class="fab barfab" data-a="menu" aria-label="Lägg till drink">${menuOpen ? "×" : "+"}</button>` : ""}
    ${menuOpen ? `<div class="menu barmenu">
      ${sample && sampleImages && HAS_CAMERA ? `<button data-a="camimport">Ta foto<small>Fota en drinkbok eller ett menykort</small></button>` : ""}
      ${sample && sampleImages ? `<button data-a="pickimport">${HAS_CAMERA ? "Välj bilder" : "Foto eller skärmdump"}<small>Skärmdumpar eller foton av drinken</small></button>` : ""}
      ${sample ? `<button data-a="import">Länk eller text<small>Från en drinksida, Instagram-bildtext eller liknande</small></button>` : ""}
      <button data-a="barnew">Skriv egen drink<small>Fyll i själv från början</small></button>
    </div>` : ""}`;
  const car = document.getElementById("bcar");
  if (car) car.addEventListener("scroll", () => { const w = car.firstElementChild ? car.firstElementChild.offsetWidth + 12 : 1; const i = Math.round(car.scrollLeft / w); document.querySelectorAll(".bdots i").forEach((d, j) => d.classList.toggle("on", j === i)); }, { passive: true });
}
// Drinksidan
function renderDrink(r){
  const i = barInfo(r);
  const base = r.servings || 1;
  const serv = detailState.servings ?? 1;   // drinksidan börjar alltid på 1 glas
  const f = serv / base;
  const longest = Math.max(4, ...String(r.title || "").split(/\s+/).map(w => w.length));
  const kick = [i.base, ...(r.tags || []).filter(t => t !== "dryck" && ["fest", "jul", "vardag"].includes(t)).map(t => t[0].toUpperCase() + t.slice(1))].join(" · ");
  const spec = [[i.glass, "Glas"], [i.method, "Metod"], [i.garnish, "Garnering"]].filter(x => x[0]);
  let n = 0;
  const ings = (r.ingredients || []).map(l => {
    if (l.startsWith("#")) return `<li class="bh">${esc(l.replace(/^#\s*/, ""))}</li>`;
    const [amt, name] = barIngSplit(scaleLine(l, f));
    return `<li><b>${esc(amt)}</b><span>${esc(name)}</span></li>`;
  }).join("");
  const steps = (r.steps || []).map(s => s.startsWith("#") ? `<li class="bh">${esc(s.replace(/^#\s*/, ""))}</li>` : `<li data-n="${++n}">${esc(s)}</li>`).join("");
  $app.innerHTML = `<div class="dk">
    <div class="dkh" style="${barBg(i)}"><span class="b-rays" aria-hidden="true"></span>
      <button class="fback" data-a="home" aria-label="Tillbaka"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <button class="dk-fav ${isFav(r) ? "on" : ""}" data-a="togglefav" aria-label="Favorit">${isFav(r) ? "♥" : "♡"}</button>
      ${"wakeLock" in navigator ? `<button class="dk-wake wakeicon" id="wakebtn" data-a="wake" aria-pressed="false" aria-label="Håll skärmen tänd" title="Håll skärmen tänd"><svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect class="ph" x="10.5" y="5" width="11" height="22" rx="2.4"/><path d="M14.5 23.6h3"/><g class="rays"><path d="M5.5 10.5l-2.4-1.4M5 16H2.3M5.5 21.5l-2.4 1.4M26.5 10.5l2.4-1.4M27 16h2.7M26.5 21.5l2.4 1.4"/></g><path class="zz" d="M24.2 6.2h3.4l-3.4 3.6h3.4"/></svg></button>` : ""}
      <div class="dk-fr" ${can("contributor") ? `data-a="pickdish" role="button" aria-label="Byt bild"` : ""}>${BAR_ZIG}<div class="dk-in ${r.photo ? "ph" : ""}">${barPic(r, i)}</div>${canEdit(r) ? `<span class="dk-cam" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>` : ""}</div>
    </div>
    <div class="dkb">
      <div class="dk-t"><div class="dk-k">${esc(kick)}</div><h1 class="bshim" style="--n:${longest}">${esc(String(r.title || "").toUpperCase())}</h1></div>
      ${spec.length ? `<div class="dk-spec" style="grid-template-columns:repeat(${spec.length},1fr)">${spec.map(([v, l]) => `<div><b>${esc(v)}</b><span class="bsc">${l}</span></div>`).join("")}</div>` : ""}
      <div class="dk-hd"><span>Ingredienser</span><div class="dk-step" role="group" aria-label="Antal glas"><button data-a="barserv" data-n="${Math.max(1, serv - 1)}" aria-label="Färre glas" ${serv <= 1 ? "disabled" : ""}>−</button><span>${serv} glas</span><button data-a="barserv" data-n="${Math.min(50, serv + 1)}" aria-label="Fler glas">+</button></div></div>
      <ul class="dk-ing">${ings || `<li><span>Inga ingredienser än.</span></li>`}</ul>
      ${steps ? `<div class="dk-hd"><span>Så gör du</span></div><ol class="dk-steps">${steps}</ol>` : ""}
      ${notesPanelHtml(r, NOTE_BAR_OPTS)}
      ${matHtml(r)}
      <div class="dk-more">${canEdit(r) ? `<button class="linkbtn" data-a="edit">Redigera</button>` : ""}<button class="linkbtn" data-a="barfull">Alla funktioner<small>tips, matlagning, inköpslista</small></button></div>
    </div></div>`;
}
// Filtrera på vem som lagt till receptet (överst i Filtrera-panelen)
function byFilterHtml(list){
  const was = filter.by; filter.by = "";
  const baseList = filtered(); filter.by = was;
  const people = [...new Set(baseList.map(addedByOf).concat(was ? [was] : []))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "sv"));
  if (people.length < 2 && !was) return "";
  return `<div class="fgrp"><div class="fgt">Lagt till av</div><div class="ftags">${people.map(p => { const on = was === p, n = on ? list.length : baseList.filter(r => addedByOf(r) === p).length; return `<button class="ftag ${on ? "on" : ""}" data-a="fby" data-e="${esc(p)}">${esc(nameOf(p))}<small>${n}</small></button>`; }).join("")}</div></div>`;
}
// ---------- Matilda – bartendern ----------
var MAT_SVG = `<svg class="mat-ico" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="4.6" r="1.7"/><path d="M5.3 11.2c0-2.8 1.9-4.6 4.2-4.6s4.2 1.8 4.2 4.6"/><circle cx="9.5" cy="11.4" r="4"/><path d="M5.3 11.2c-.6 1.8-.4 3.6.6 4.6M13.7 11.2c.6 1.8.4 3.6-.6 4.6"/><path d="M8.3 12.9q1.2.9 2.4 0"/><path d="M3 22c.8-3 3.3-4.6 6.5-4.6"/><g class="mat-shk"><path d="M17 11.5h4l-.5 8.5h-3z"/><path d="M17.4 11.5l.5-2.2h2.2l.5 2.2"/><path d="M19 9.3V8"/></g></svg>`;
var MAT_PRESETS = {
  nolo: { label: "Alkoholfri variant?", prompt: "Föreslå en alkoholfri variant av drinken med exakta mängder i cl och kort hur man gör." },
  snack: { label: "Vad passar som tilltugg?", prompt: "Föreslå 3 tilltugg som passar till drinken, en mening om varje." },
  swap: { label: "Har inte allt – vad kan jag byta?", prompt: "Vilka ingredienser i drinken kan bytas mot sådant man ofta har hemma? Skriv en lista: ingrediens → ersättning, och kort hur smaken påverkas." },
  pitcher: { label: "Göra en kanna till fest?", prompt: "Hur gör jag drinken i en kanna till 8 personer? Ge mängder, vad som blandas i förväg och vad som tillsätts precis innan servering." },
};
var MAT_LINES = ["Matilda tänker …", "Matilda skakar …", "Matilda letar i barskåpet …", "Matilda krossar is …", "Matilda provsmakar …", "Matilda pressar en lime …"];
function matLine(t0){ return MAT_LINES[Math.floor((Date.now() - t0) / 3500) % MAT_LINES.length]; }
setInterval(() => {
  document.querySelectorAll(".mw-s[data-t0]").forEach(el => {
    const t = matLine(+el.dataset.t0);
    if (t === el.textContent || el.classList.contains("swap")) return;
    el.classList.add("swap"); setTimeout(() => { el.textContent = t; el.classList.remove("swap"); }, 350);
  });
}, 500);
function matOutHtml(id){
  return (matState[id] || []).map(it => {
    if (!it._t0) it._t0 = Date.now();
    if (it.busy) return `<div class="mat-wait">${MAT_SVG}<div><div class="mat-q">${esc(it.q)}</div><div class="mw-s" data-t0="${it._t0}">${matLine(it._t0)}</div></div></div>`;
    if (it.err) return `<div class="mat-ans"><div class="mat-q">${esc(it.q)}</div><p class="err">${esc(it.err)}</p></div>`;
    return `<div class="mat-ans"><div class="mat-q">${esc(it.q)}</div><div class="ai-a">${aiMd(it.a)}</div></div>`;
  }).reverse().join("");
}
function matHtml(r){
  return `<section class="mat"><div class="mat-h">${MAT_SVG}<span>Fråga Matilda bakom baren</span></div>
    <div class="mat-btns">${Object.entries(MAT_PRESETS).map(([k, p]) => `<button data-a="matq" data-k="${k}">${esc(p.label)}</button>`).join("")}</div>
    <form id="mat-form" class="mat-form"><input id="mat-input" type="text" placeholder="Fråga Matilda om drinken …" autocomplete="off"><button type="submit">Fråga Matilda</button></form>
    <div id="mat-out">${matOutHtml(r.id)}</div></section>`;
}
function matRefresh(id){ const el = document.getElementById("mat-out"); if (el && view.id === id) el.innerHTML = matOutHtml(id); }
async function matAsk(r, kind, text){
  const items = matState[r.id] || (matState[r.id] = []);
  if (items.some(x => x.busy)) return;
  const q = kind ? MAT_PRESETS[kind].label : text;
  const item = { q, a: "", busy: true, err: "" };
  items.push(item); matRefresh(r.id);
  const ctx = `Du är Matilda, bartendern i familjen Sivanders hemmabar. Du är varm, lite kaxig och kan dina klassiker. Svara på svenska, konkret och utan inledning eller artighetsfraser. Max 150 ord, gärna korta punktlistor. Mått i cl. Hitta inte på fakta om specifika produkter. Håll dig till drinkar, dryck, servering och tilltugg.

DRINKEN:
${recipeText(r)}${r.notes ? "\n\nANTECKNINGAR: " + r.notes : ""}`;
  const convo = [];
  items.slice(0, -1).filter(x => x.a && !x.err).slice(-3).forEach((h, i) => { convo.push({ role: "user", content: (i === 0 ? ctx + "\n\nFRÅGA: " : "") + h.q }); convo.push({ role: "assistant", content: h.a }); });
  convo.push({ role: "user", content: (convo.length ? "" : ctx + "\n\nFRÅGA: ") + (kind ? MAT_PRESETS[kind].prompt : text) });
  try { item.a = await ai(convo, { fast: true }); } catch (e) { item.err = aiErr(e); }
  item.busy = false; matRefresh(r.id);
}
document.addEventListener("submit", e => {
  if (e.target.id !== "mat-form") return;
  e.preventDefault();
  const inp = document.getElementById("mat-input"); const q = inp.value.trim(); if (!q) return;
  const r = recipes.find(x => x.id === view.id); if (!r) return;
  inp.value = ""; inp.blur(); matAsk(r, null, q);
});
// Barens knappar (fångas före den vanliga klickhanteraren)
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("[data-a]"); if (!el) return;
  const a = el.dataset.a;
  if (a === "open") { delete drinkFull[el.dataset.id]; return; }
  if (a === "baropen") { e.stopPropagation(); view = { name: "bar" }; render(); window.scrollTo(0, 0); return; }
  if (a === "barbase") { e.stopPropagation(); barState.base = el.dataset.b || ""; render(); return; }
  if (a === "pickdish" && barIsDrinkView()) {   // tryck på drinkbilden: rutan frågar om man vill byta bild
    const r0 = recipes.find(x => x.id === view.id);
    setTimeout(() => { const h = document.querySelector(".sheet h2, #sheet h2, .modal h2"); if (h && /Bild på rätten/.test(h.textContent)) h.textContent = r0 && r0.photo ? "Vill du byta bild?" : "Vill du lägga till en bild?"; }, 0);
    return;
  }
  if (a === "barby") { e.stopPropagation(); barState.by = el.dataset.e || ""; render(); return; }
  if (a === "fby") { e.stopPropagation(); const v = el.dataset.e || ""; filter.by = filter.by === v ? "" : v; render(); return; }
  if (a === "tagclear" || a === "allrecipes" || a === "clear") { filter.by = ""; return; }
  if (a === "barserv") { e.stopPropagation(); detailState.servings = +el.dataset.n; render(); return; }
  if (a === "barfull") { e.stopPropagation(); drinkFull[view.id] = true; render(); window.scrollTo(0, 0); return; }
  if (a === "matq") { e.stopPropagation(); const r = recipes.find(x => x.id === view.id); if (r) matAsk(r, el.dataset.k); return; }
  if (a === "barnew") {
    e.stopPropagation(); menuOpen = false;
    draft = { title: "", sourceUrl: "", servings: 1, time: "", tags: ["dryck"], ingredients: [], steps: [], myChanges: "", notes: "", photo: null };
    view = { name: "edit" }; render(); window.scrollTo(0, 0); return;
  }
}, true);

// Drinkikoner i flödet (B1 blandade, B2 lade till), grön bricka
var EV_DRINK_MIX = '<path d="M5 8h14c0 3.6-3 5.6-7 5.6S5 11.6 5 8z"/><path d="M12 13.6v6.4M8.5 20.5h7"/><circle cx="16" cy="7" r="1.5" fill="currentColor" fill-opacity=".35"/><path d="M16 5.5c.2-1 .9-1.7 2-2"/>';
var EV_DRINK_ADD = '<path d="M4 7.5h12c0 3.2-2.6 5-6 5s-6-1.8-6-5z"/><path d="M10 12.5v7M7 20h6"/><circle cx="13.4" cy="6.6" r="1.3" fill="currentColor" fill-opacity=".35"/><path d="M13.4 5.3c.2-.9.8-1.5 1.7-1.8"/><path d="M18 14v6M15 17h6"/>';

// ---------- Bilder från recept på nätet (baren, förslag A) ----------
var imgWeb = {};
function webImgHtml(r){
  const w = imgWeb[r.id];
  const nm = esc(r.title || "drinken");
  if (!w) return `<div class="wb-card"><span class="wb-ic">${MAT_SVG}</span><div><b>Hittar du inte ${nm}?</b><small>Matilda letar i recept på nätet och plockar bilderna därifrån.</small></div><button type="button" class="wb-btn" data-a="webimg" data-id="${esc(r.id)}">Leta på nätet</button></div>`;
  const h = `<div class="wb-h"><b>Från recept på nätet</b><small>${w.state === "done" && w.items.length ? "Tryck för att välja" : ""}</small></div>`;
  if (w.state === "loading") return h + `<div class="wb-grid">${Array.from({ length: 6 }, () => `<span class="is-ph wb-ph"></span>`).join("")}</div><p class="is-note"><span class="spinner"></span> Matilda letar efter recept på ${nm} …</p>`;
  if (w.state === "error") return h + `<p class="is-note">${esc(w.err || "Hittade inga bilder.")} <button class="linkbtn" data-a="webimg" data-id="${esc(r.id)}">Försök igen</button></p>`;
  if (!w.items.length) return h + `<p class="is-note">Matilda hittade inga recept med bild. Prova att söka med egna ord.</p>`;
  return h + `<div class="wb-grid">${w.items.map((p, i) => `<button type="button" class="wb-pic${w.saving === i ? " saving" : ""}" data-a="webpick" data-id="${esc(r.id)}" data-i="${i}" title="${esc(p.title || p.site)}"><img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.wb-pic').remove()"><span>${esc(p.site)}</span>${w.saving === i ? `<i class="spinner"></i>` : ""}</button>`).join("")}</div><p class="wb-note">Bilderna tillhör sajterna. Källan sparas med bilden.</p>`;
}
function webSite(u){ try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
async function webImgPost(body){
  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (session && session.access_token) }, body: JSON.stringify(body) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j.error || "Kunde inte hämta");
  return j;
}
async function loadWebImgs(r){
  imgWeb[r.id] = { state: "loading", items: [] }; imgSugDraw(r.id);
  try {
    const ck = "drinkimg:" + aiKey(r.title || "");
    let pages = null;
    const hit = await aiCacheGet(ck, 30);
    if (hit && (hit.pages || []).length) pages = hit.pages;
    else {
      const ings = (r.ingredients || []).filter(x => x && !String(x).startsWith("#")).slice(0, 10).join(", ");
      const prompt = `Du hjälper till att hitta foton av drinken "${r.title}"${ings ? ` (ingredienser: ${ings})` : ""}.
Sök på nätet efter receptsidor för just den här drinken som har ett foto av den färdiga drinken. Bra källor: Difford's Guide, Liquor.com, Punch, Imbibe, The Spruce Eats, Serious Eats, bloggar och svenska sajter.
Använd BARA sidor du faktiskt hittat i sökningen, med exakt adress till själva receptsidan (inte söksidor eller startsidor). Ge upp till 6 olika sidor, gärna från olika sajter.
Svara bara med JSON, utan annan text: {"sidor": [{"url": "https://...", "sajt": "sajtens namn"}]}`;
      const out = parseJson(await ai(prompt, { mode: "json", web: true }));
      pages = (out.sidor || []).filter(x => x && /^https?:\/\//.test(x.url || "")).slice(0, 6);
      logEvent("ai_web", r.id, { q: "bilder: " + (r.title || ""), träffar: pages.length });
    }
    const got = await Promise.all(pages.map(pg => webImgPost({ url: pg.url, imageUrl: true })
      .then(j => j.image && /^https?:\/\//.test(j.image) ? { img: j.image, page: j.url || pg.url, site: pg.sajt || webSite(pg.url), title: j.title || "" } : null)
      .catch(() => null)));
    const seen = new Set(), items = [];
    for (const g of got) if (g && !seen.has(g.img)) { seen.add(g.img); items.push(g); }
    if (!hit && pages.length) aiCacheSet(ck, { pages });
    imgWeb[r.id] = { state: "done", items };
  } catch (e) {
    imgWeb[r.id] = { state: "error", items: [], err: aiErr(e) || "Kunde inte leta på nätet." };
  }
  imgSugDraw(r.id);
}
async function pickWebImg(r, i){
  const w = imgWeb[r.id]; const p = w && w.items[i];
  if (!p || w.saving != null) return;
  w.saving = i; imgSugDraw(r.id);
  try {
    const j = await webImgPost({ url: p.img, imageOnly: true });
    if (!j.image) throw new Error("Kunde inte hämta bilden");
    const url = await storePhoto(await compress(await (await fetch(j.image)).blob(), 1600, 600000));
    if (!url) throw new Error("Kunde inte spara bilden");
    w.saving = null;
    if (document.querySelector("#sheet-bg .imgsug")) closeSheet();
    if (await patch(r.id, { photo: url, photoCredit: { name: p.site, url: p.page, page: p.page, src: "receptsida" } })) toast("Bilden sparad");
  } catch (e) {
    w.saving = null; imgSugDraw(r.id); toast(e.message || "Kunde inte spara bilden");
  }
}
document.addEventListener("click", ev => {
  const b = ev.target.closest && ev.target.closest('[data-a="webimg"],[data-a="webpick"]'); if (!b) return;
  const r = recipes.find(x => x.id === b.dataset.id); if (!r) return;
  ev.preventDefault(); ev.stopPropagation();
  if (b.dataset.a === "webimg") loadWebImgs(r); else pickWebImg(r, +b.dataset.i);
}, true);
