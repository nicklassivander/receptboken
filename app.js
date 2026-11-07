
// ---------- state ----------
const sample = true, sampleImages = true;   // AI finns alltid i webbversionen
let recipes = [], loaded = false, loadNote = "", storageOk = true;
let view = { name: "list" };              // list | detail | edit
let filter = { q: "", tag: null, fav: false, sort: "new" };
let draft = null;                          // recipe being edited
let menuOpen = false;
let detailState = { mode: "mine", servings: null, done: {} };
let importState = null;

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
const ROLE_LABEL = { viewer: "Läsa", contributor: "Lägga till och ändra", editor: "Full behörighet", admin: "Superanvändare" };
const can = r => ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(r);
const newId = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return "r-" + [...a].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };

async function loadAll(){
  const { data: rows, error } = await sb.from("recipes").select("id,data");
  loaded = true;
  if (error) { loadNote = "Kunde inte hämta recepten. Kontrollera att du har behörighet."; render(); return; }
  loadNote = "";
  recipes = (rows || []).map(r => ({ ...r.data, id: r.id }));
  if (view.name !== "edit") render();
}
let subscribed = false;
function subscribe(){
  if (subscribed) return; subscribed = true;
  sb.channel("recept")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, p => {
      if (p.eventType === "DELETE") recipes = recipes.filter(r => r.id !== p.old.id);
      else {
        const r = { ...p.new.data, id: p.new.id };
        const i = recipes.findIndex(x => x.id === r.id);
        if (i >= 0) recipes[i] = r; else recipes.push(r);
      }
      if (view.name !== "edit") render();
    })
    .subscribe();
  // Telefoner tappar anslutningen i bakgrunden: hämta om när appen visas igen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && view.name !== "edit") loadAll(); });
}

async function saveRecipe(r){
  const { id, ...body } = r;
  body.updatedAt = new Date().toISOString();
  if (!body.createdAt) body.createdAt = body.updatedAt;
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
function render(){
  if (view.name === "detail") return renderDetail();
  if (view.name === "edit") return renderEdit();
  renderList();
}

function filtered(){
  const q = filter.q.trim().toLowerCase();
  let list = recipes.filter(r => {
    if (filter.fav && !r.favorite) return false;
    if (filter.tag && !(r.tags || []).includes(filter.tag)) return false;
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
  const tags = {};
  recipes.forEach(r => (r.tags || []).forEach(t => tags[t] = (tags[t] || 0) + 1));
  const tagList = Object.keys(tags).sort((a, b) => tags[b] - tags[a]);
  const list = filtered();

  let body;
  if (!storageOk) {
    body = `<div class="empty"><h2>Ingen behörighet än</h2><p>Ditt konto har inte tillgång till Receptboken. Be Nicklas lägga till dig.</p></div>`;
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
    body = `<div class="grid">${list.map(r => `
      <div class="card" data-a="open" data-id="${esc(r.id)}">
        <div class="thumb">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : '<svg class="plate" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width=".6"/><path d="M6 14v14M3 14v8a3 3 0 006 0v-8M6 28v24M58 14c-4 2-4 14 0 16v22" fill="none" stroke="currentColor" stroke-width="1"/></svg>'}${r.favorite ? `<span class="fav" aria-label="Favorit">♥</span>` : ""}</div>
        <div class="body">
          <h3>${esc(r.title || "Namnlöst recept")}</h3>
          <div class="meta">${sourceBadge(r)}${isModified(r) ? `<span class="badge mod">Min version</span>` : ""}</div>
          <div class="meta" style="margin-top:6px">
            ${r.rating ? `<span>${"★".repeat(r.rating)}</span>` : ""}
            ${r.time ? `<span>${esc(r.time)}</span>` : ""}
            ${r.timesCooked ? `<span>Lagad ${r.timesCooked}×</span>` : ""}
          </div>
        </div>
      </div>`).join("")}</div>`;
  }

  $app.innerHTML = `
    <header class="top"><h1>Sivander's Recept</h1>
      <span class="row"><span class="meta">${recipes.length ? recipes.length + " recept" : ""}</span><button class="iconbtn" data-a="settings" aria-label="Konto och inställningar">Konto</button></span></header>
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
    <div class="chips">
      <button class="chip ${filter.fav ? "on" : ""}" data-a="fav">Favoriter</button>
      ${tagList.map(t => `<button class="chip ${filter.tag === t ? "on" : ""}" data-a="tag" data-t="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>` : ""}
    ${body}
    ${storageOk && loaded && can("contributor") ? `<button class="fab" data-a="menu" aria-label="Lägg till">${menuOpen ? "×" : "+"}</button>` : ""}
    ${menuOpen ? `<div class="menu">
      ${sample && sampleImages ? `<button data-a="pickimport">Foto eller skärmdump<small>Fota en kokbok eller välj skärmdumpar</small></button>` : ""}
      ${sample ? `<button data-a="import">Klistra in text<small>Från en receptsida eller Instagram</small></button>` : ""}
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
  if (!r) { view = { name: "list" }; return renderList(); }
  const hasOrig = !!r.original && isModified(r) && (r.original.ingredients || r.original.steps);
  const mode = hasOrig ? detailState.mode : "mine";
  const src = mode === "orig" ? r.original : r;
  const baseServ = (mode === "orig" ? r.original.servings : r.servings) || null;
  const serv = detailState.servings ?? baseServ;
  const f = baseServ && serv ? serv / baseServ : 1;
  const ings = src.ingredients || [];
  const steps = src.steps || [];

  $app.innerHTML = `
    <button class="back" data-a="home">Alla recept</button>
    ${r.photo ? `<div class="hero"><img src="${esc(r.photo)}" alt=""></div>` : ""}
    <div class="row" style="justify-content:center">${sourceBadge(r)}${isModified(r) ? `<span class="badge mod">Min version</span>` : ""}
      ${(r.tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join("")}</div>
    <h1 class="dtitle">${esc(r.title || "Namnlöst recept")}</h1>
    <div class="row" style="justify-content:center;gap:18px">
      <div class="stars" ${can("contributor") ? "" : 'style="pointer-events:none"'}>${[1,2,3,4,5].map(n => `<button class="${(r.rating || 0) >= n ? "on" : ""}" data-a="rate" data-n="${n}" aria-label="${n} stjärnor">★</button>`).join("")}</div>
      <button class="iconbtn" data-a="togglefav" aria-label="Favorit" style="font-size:20px;color:var(--accent)" ${can("contributor") ? "" : "disabled"}>${r.favorite ? "♥" : "♡"}</button>
    </div>
    <div class="meta" style="margin-top:6px">
      ${r.time ? `<span>${esc(r.time)}</span>` : ""}
      ${r.timesCooked ? `<span>Lagad ${r.timesCooked} gånger, senast ${fmtDate(r.lastCooked)}</span>` : `<span>Inte lagad än</span>`}
      ${r.sourceUrl ? `<span><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Öppna källan</a></span>` : ""}
    </div>

    ${(!ings.length || !steps.length || (r.tags || []).includes("att komplettera")) && can("contributor") ? `<div class="panel changes"><h2>Receptet är inte komplett</h2>
      <p style="margin:0 0 12px">Ta skärmdumpar av receptet i videon eller på sidan och lägg till dem här, så fyller Claude i det som saknas.</p>
      <button class="btn accent" data-a="pickcomplete">Komplettera med skärmdumpar</button></div>` : ""}

    ${r.myChanges ? `<div class="panel changes"><h2>Mina ändringar</h2><div class="prewrap">${esc(r.myChanges)}</div></div>` : ""}

    <div class="panel">
      <h2><span>Ingredienser</span>
        <span class="row">
          ${hasOrig ? `<span class="seg"><button class="${mode === "mine" ? "on" : ""}" data-a="mode" data-m="mine">Min</button><button class="${mode === "orig" ? "on" : ""}" data-a="mode" data-m="orig">Original</button></span>` : ""}
        </span></h2>
      ${baseServ ? `<div class="stepper" style="margin-bottom:8px"><button data-a="serv" data-d="-1">−</button><span>${serv} portioner</span><button data-a="serv" data-d="1">+</button></div>` : ""}
      ${ings.length ? `<ul class="ings">${ings.map((l, i) => l.startsWith("#")
          ? `<li class="group">${esc(l.replace(/^#+\s*/, ""))}</li>`
          : `<li class="${detailState.done["i" + i] ? "done" : ""}" data-a="tick" data-k="i${i}"><span class="box"></span><span>${esc(scaleLine(l, f))}</span></li>`).join("")}</ul>`
        : `<p class="meta">Inga ingredienser ifyllda.</p>`}
    </div>

    <div class="panel">
      <h2>Gör så här</h2>
      ${steps.length ? `<ol class="steps">${steps.map((s, i) => `<li class="${detailState.done["s" + i] ? "done" : ""}" data-a="tick" data-k="s${i}">${esc(s)}</li>`).join("")}</ol>`
        : `<p class="meta">Inga steg ifyllda.</p>`}
    </div>

    ${r.notes ? `<div class="panel"><h2>Anteckningar</h2><div class="prewrap">${esc(r.notes)}</div></div>` : ""}

    ${can("contributor") ? `<div class="panel ai">
      <h2>Fråga sommelieren och kocken</h2>
      <div class="chips">
        <button class="chip" data-a="ai" data-q="wine">Vilket vin passar?</button>
        <button class="chip" data-a="ai" data-q="subs">Alternativ till ingredienser</button>
        <button class="chip" data-a="ai" data-q="similar">Liknande recept</button>
        <button class="chip" data-a="ai" data-q="vary">Andra varianter</button>
        <button class="chip" data-a="ai" data-q="sides">Vad serverar jag till?</button>
      </div>
      <form class="ai-ask" id="ai-form"><input id="ai-input" placeholder="t.ex. Jag har ingen crème fraiche – vad tar jag?" autocomplete="off"><button class="btn small" type="submit">Fråga</button></form>
      <div id="ai-out">${aiOutHtml(r.id)}</div>
    </div>` : ""}

    <div class="actions">
      ${can("contributor") ? `<button class="btn accent" data-a="cooked">Lagad idag</button>
      <button class="btn ghost" data-a="pickdish">${r.photo ? "Byt bild" : "Lägg till bild"}</button>
      <button class="btn ghost" data-a="edit">Redigera</button>` : ""}
      <button class="btn ghost" data-a="copy">Kopiera</button>
      ${can("editor") ? `<button class="btn danger" data-a="del">Radera</button>` : ""}
    </div>
  `;
}

function renderEdit(){
  const d = draft;
  $app.innerHTML = `
    <button class="back" data-a="cancel">← Avbryt</button>
    <h1 class="dtitle">${d.id ? "Redigera recept" : "Nytt recept"}</h1>
    ${d.original && !d.id ? `<div class="notice">Receptet är importerat. Ändra det till din version – originalet sparas så att du kan jämföra senare.</div>` : ""}
    <form class="form" id="f" autocomplete="off">
      <label>Namn</label>
      <input type="text" name="title" value="${esc(d.title)}" placeholder="t.ex. Krämig svamppasta" required>

      <label>Länk till källan</label>
      <input type="url" name="sourceUrl" value="${esc(d.sourceUrl)}" placeholder="https://www.instagram.com/p/… eller receptsidan">

      <div class="two">
        <div><label>Portioner</label><input type="number" name="servings" min="1" value="${esc(d.servings ?? "")}"></div>
        <div><label>Tid</label><input type="text" name="time" value="${esc(d.time)}" placeholder="45 min"></div>
      </div>

      <label>Taggar</label>
      <input type="text" name="tags" value="${esc((d.tags || []).join(", "))}" placeholder="pasta, vardag, vegetariskt">
      <div class="hint">Separera med kommatecken.</div>

      <label>Ingredienser</label>
      <textarea name="ingredients" rows="8" placeholder="2 dl grädde&#10;250 g champinjoner&#10;# Till servering&#10;Parmesan">${esc((d.ingredients || []).join("\n"))}</textarea>
      <div class="hint">En per rad, mängden först. Rader som börjar med # blir rubriker.</div>

      <label>Gör så här</label>
      <textarea name="steps" rows="8" placeholder="Ett steg per rad">${esc((d.steps || []).join("\n"))}</textarea>

      <label>Mina ändringar</label>
      <textarea name="myChanges" rows="3" placeholder="t.ex. Bytte grädde mot crème fraiche, dubbel vitlök, 5 min kortare i ugnen">${esc(d.myChanges)}</textarea>
      <div class="hint">Vad du gjort annorlunda än originalet – visas överst i receptet.</div>

      <label>Anteckningar</label>
      <textarea name="notes" rows="3" placeholder="Tips, vin till, vad gästerna tyckte …">${esc(d.notes)}</textarea>

      <label>Bild på rätten</label>
      <div class="photo-pick">
        ${d.photo ? `<img src="${esc(d.photo)}" alt="">` : ""}
        <input type="file" accept="image/*" id="photo">
        ${d.photo ? `<button type="button" class="btn ghost small" data-a="rmphoto">Ta bort</button>` : ""}
      </div>
    </form>
    <div class="sticky-bar"><div class="in">
      <button class="btn ghost" data-a="cancel">Avbryt</button>
      <button class="btn accent" data-a="save" id="savebtn">Spara recept</button>
    </div></div>
  `;
  document.getElementById("photo").addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    readForm();
    try { const p = await storePhoto(await compress(file, 1200, 400000)); if (p) draft.photo = p; renderEdit(); } catch { toast("Kunde inte läsa bilden"); }
  });
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
  lines.push("", "GÖR SÅ HÄR", ...(r.steps || []).map((s, i) => (i + 1) + ". " + s));
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
      ${!it.busy && it.a ? `<div class="ai-tools"><button class="btn ghost small" data-a="aisave" data-i="${i}">Spara i anteckningar</button></div>` : ""}`;
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
      <p class="sub">Klistra in text, fota en kokbok eller lägg till skärmdumpar. Claude plockar ut ingredienser och steg.</p>
      <label>Länk (sparas som källa)</label>
      <input type="url" id="imp-url" value="${esc(s.url)}" placeholder="https://…">
      <label>Recepttext</label>
      <textarea id="imp-text" rows="9" placeholder="Klistra in hela receptet – eller Instagram-bildtexten">${esc(s.text)}</textarea>
      ${sampleImages ? `
      <label>Foton och skärmdumpar (upp till 6)</label>
      <input type="file" id="imp-shots" accept="image/*" multiple>
      <div class="hint">Fota en kokbokssida eller en lapp, eller välj skärmdumpar från Instagram-videor.</div>
      <div class="shots">${s.shots.map((sh, i) => `<div><img src="${sh.url}" alt=""><button type="button" data-a="rmshot" data-i="${i}">×</button></div>`).join("")}</div>` : ""}
      <label class="check" style="color:var(--ink);font-weight:500"><input type="checkbox" id="imp-tr" ${s.translate ? "checked" : ""}> Översätt till svenska och metriska mått</label>
      ${s.error ? `<div class="err">${esc(s.error)}</div>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:18px">
        <button class="btn ghost" data-a="closeimport">Avbryt</button>
        <button class="btn accent" data-a="runimport" ${s.busy ? "disabled" : ""}>${s.busy ? `<span class="spinner"></span> Läser receptet …` : "Läs in receptet"}</button>
      </div>
    </div>
  </div>`;
  const sync = () => { s.url = document.getElementById("imp-url").value; s.text = document.getElementById("imp-text").value; s.translate = document.getElementById("imp-tr").checked; };
  ["imp-url", "imp-text", "imp-tr"].forEach(id => document.getElementById(id).addEventListener("input", sync));
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
  if (!s.text && !s.shots.length) { s.error = "Klistra in recepttexten" + (sampleImages ? " eller lägg till en skärmdump." : "."); return renderImport(); }
  s.busy = true; s.error = ""; renderImport();

  const prompt = `Du får ett matrecept som användaren kopierat från en webbsida eller Instagram, i form av text och/eller bilder (skärmdumpar, foton av kokbokssidor eller handskrivna lappar). Flera bilder hör till samma recept – slå ihop dem. Texten kan innehålla skräp som reklam, kommentarer och hashtags – ignorera det.
Svara ENDAST med ett JSON-objekt, utan förklaring:
{"title": string, "servings": number eller null, "time": string (t.ex. "45 min", tom om okänt), "tags": [string], "ingredients": [string], "steps": [string], "notes": string}
Regler:
- ingredients: en ingrediens per element, mängd och enhet först ("2 dl grädde", "1 gul lök"). Om receptet har delar (t.ex. sås, topping), lägg en rubrik som eget element som börjar med "# ".
- steps: ett steg per element, utan numrering, korta och tydliga.
- tags: 2–5 korta taggar på svenska i gemener (t.ex. "pasta", "kyckling", "vegetariskt", "grill", "vardag").
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
      draft.original = { servings: draft.servings, ingredients: draft.ingredients, steps: draft.steps };
      closeImport();
      view = { name: "edit", id: target.id }; render(); window.scrollTo(0, 0);
      return;
    }
    draft = {
      ...parsed, sourceUrl: s.url, myChanges: "", photo: null,
      original: { servings: parsed.servings, ingredients: parsed.ingredients, steps: parsed.steps },
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

  switch (a) {
    case "menu": menuOpen = !menuOpen; render(); break;
    case "settings": openSettings(); break;
    case "import": openImport(); break;
    case "pickimport": menuOpen = false; render(); openPicker("import"); break;
    case "pickcomplete": openPicker("complete"); break;
    case "pickdish": openPicker("dish"); break;
    case "new":
      menuOpen = false; draft = { title: "", sourceUrl: "", servings: 4, time: "", tags: [], ingredients: [], steps: [], myChanges: "", notes: "", photo: null };
      view = { name: "edit" }; render(); window.scrollTo(0, 0); break;
    case "open":
      detailState = { mode: "mine", servings: null, done: {} };
      view = { name: "detail", id: el.dataset.id }; render(); window.scrollTo(0, 0); break;
    case "home": view = { name: "list" }; render(); break;
    case "fav": filter.fav = !filter.fav; render(); break;
    case "tag": filter.tag = filter.tag === el.dataset.t ? null : el.dataset.t; render(); break;
    case "clear": filter = { ...filter, q: "", tag: null, fav: false }; render(); break;
    case "mode": detailState.mode = el.dataset.m; detailState.servings = null; detailState.done = {}; render(); break;
    case "serv": {
      const base = (detailState.mode === "orig" ? cur.original.servings : cur.servings) || 1;
      detailState.servings = Math.max(1, (detailState.servings ?? base) + (+el.dataset.d)); render(); break;
    }
    case "tick": detailState.done[el.dataset.k] = !detailState.done[el.dataset.k]; render(); break;
    case "rate": {
      const n = +el.dataset.n; await patch(cur.id, { rating: cur.rating === n ? 0 : n }); break;
    }
    case "togglefav": await patch(cur.id, { favorite: !cur.favorite }); break;
    case "cooked":
      await patch(cur.id, { timesCooked: (cur.timesCooked || 0) + 1, lastCooked: today() });
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
      view = draft && draft.id ? { name: "detail", id: draft.id } : { name: "list" }; draft = null; render(); break;
    case "save": {
      readForm();
      if (!draft.title) { toast("Ge receptet ett namn"); document.querySelector('[name=title]').focus(); return; }
      const btn = document.getElementById("savebtn"); btn.disabled = true; btn.textContent = "Sparar …";
      const id = await saveRecipe(draft);
      if (id) { toast("Receptet sparat"); detailState = { mode: "mine", servings: null, done: {} }; draft = null; view = { name: "detail", id }; render(); window.scrollTo(0, 0); }
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
      ${can("admin") ? `<button class="btn ghost" id="usersBtn">Hantera användare</button>
      <button class="btn ghost" id="importBtn">Importera recept från fil</button>
      <input type="file" id="importFile" accept=".json,application/json" hidden>` : ""}
      <button class="btn ghost" id="pwBtn">Byt lösenord</button>
      <button class="btn ghost" id="logoutBtn">Logga ut</button>
      <button class="btn" id="closeSheetBtn">Stäng</button>
    </div>`);
  $id("closeSheetBtn").onclick = closeSheet;
  $id("pwBtn").onclick = () => openPasswordSheet(false);
  if ($id("usersBtn")) $id("usersBtn").onclick = openUsers;
  if ($id("importBtn")) {
    $id("importBtn").onclick = () => $id("importFile").click();
    $id("importFile").onchange = e => { const f = e.target.files[0]; if (f) importFile(f, $id("importBtn")); };
  }
  $id("logoutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

async function openUsers(){
  openSheet(`<h2>Användare</h2>
    <p class="sub">Inloggningen delas med Munkholmsvägen, men behörigheten här gäller bara Receptboken.</p>
    <div id="uList" class="panel" style="padding:8px 14px"><p class="meta">Laddar …</p></div>
    <form id="uf">
      <h3 style="margin-top:18px;font-size:18px">Lägg till</h3>
      <div class="two"><div><label>Namn</label><input type="text" id="uName" placeholder="t.ex. Mamma"></div>
      <div><label>E-post</label><input type="text" id="uEmail" inputmode="email" required></div></div>
      <label>Behörighet</label>
      <select id="uRole"><option value="viewer">Läsa</option><option value="contributor" selected>Lägga till och ändra</option><option value="editor">Full behörighet</option></select>
      <label class="check" style="color:var(--ink);font-weight:500"><input type="checkbox" id="uInvite" checked> Skicka inloggningslänk till personen</label>
      <div class="err" id="uErr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="uClose">Stäng</button><button class="btn accent">Lägg till</button></div>
    </form>
    <p class="meta" style="margin-top:14px">Läsa: ser alla recept. Lägga till och ändra: kan spara, ändra och använda AI. Full: kan även radera recept.</p>`);
  $id("uClose").onclick = closeSheet;
  const load = async () => {
    const { data, error } = await sb.rpc("recipe_admin_list_users");
    if (error) { $id("uList").innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
    $id("uList").innerHTML = (data || []).map(u => {
      const self = u.email === me;
      const opts = ROLE_ORDER.map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
      return `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0e8da">
        <div><strong>${esc(u.name || u.email.split("@")[0])}</strong>${self ? ' <span class="meta">(du)</span>' : ""}<div class="meta">${esc(u.email)}</div></div>
        ${self ? `<span class="badge">${ROLE_LABEL[u.role]}</span>` : `<span class="row"><select data-urole="${esc(u.email)}" data-uname="${esc(u.name || "")}" style="width:auto;padding:6px 8px;font-size:13px">${opts}</select>
        <button class="btn danger small" data-udel="${esc(u.email)}" type="button">Ta bort</button></span>`}</div>`;
    }).join("");
    $id("uList").querySelectorAll("[data-urole]").forEach(sel => sel.onchange = async () => {
      const { error } = await sb.rpc("recipe_admin_upsert_user", { p_email: sel.dataset.urole, p_name: sel.dataset.uname, p_role: sel.value });
      toast(error ? error.message : "Behörigheten är ändrad"); load();
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
    if ($id("uInvite").checked) await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    $id("uEmail").value = ""; $id("uName").value = "";
    toast(`${name || email} är tillagd${$id("uInvite").checked ? " och har fått en inloggningslänk" : ""}`);
    load();
  };
  load();
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
  render();
  try { const { data: r } = await sb.rpc("recipe_my_role"); role = r || null; } catch { role = null; }
  if (!role) { storageOk = false; loaded = true; render(); return; }
  await loadAll(); subscribe();
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
  if (session) showApp(session); else showLogin();
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
