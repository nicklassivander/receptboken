// Sivander's Recept – service worker: offline, snabb start och "Dela till" (Android)
const VERSION = "v1";
const SHELL = "shell-" + VERSION, RUNTIME = "runtime-" + VERSION, INBOX = "share-inbox";
const SHELL_FILES = ["/", "/index.html", "/app.js", "/config.js", "/logo.svg", "/icon.svg", "/header.jpg", "/header-sm.jpg",
  "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME && k !== INBOX).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName, key){
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(key || req, { ignoreSearch: true }) || await caches.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req){
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    const c = await caches.open(RUNTIME); c.put(req, res.clone());
    trim(c, 300);
  }
  return res;
}
async function trim(c, max){
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// "Dela till Sivander's Recept": ta emot bilder/text, lägg i en inkorg och öppna appen
async function receiveShare(req){
  const form = await req.formData();
  const files = form.getAll("files").filter(f => f && f.size);
  const inbox = await caches.open(INBOX);
  for (const k of await inbox.keys()) await inbox.delete(k);
  await Promise.all(files.slice(0, 6).map((f, i) => inbox.put("/share-file-" + i, new Response(f, { headers: { "content-type": f.type || "image/jpeg", "x-name": encodeURIComponent(f.name || ("bild" + i)) } }))));
  const q = new URLSearchParams({ share: "1" });
  ["title", "text", "url"].forEach(k => { const v = form.get(k); if (v) q.set(k, String(v)); });
  if (files.length) q.set("files", String(Math.min(files.length, 6)));
  return Response.redirect("/?" + q.toString(), 303);
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "POST" && url.origin === location.origin && url.pathname === "/share") { e.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET") return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, SHELL, "/index.html")); return; }
    e.respondWith(networkFirst(req, SHELL));
    return;
  }
  // receptbilder och typsnitt sparas för offline
  if (url.pathname.includes("/storage/v1/object/public/") || url.host === "fonts.gstatic.com" || url.host === "fonts.googleapis.com") { e.respondWith(cacheFirst(req)); return; }
  if (url.host === "cdn.jsdelivr.net") { e.respondWith(networkFirst(req, SHELL)); return; }
  // allt annat (Supabase-data, inloggning) går direkt mot nätet
});
