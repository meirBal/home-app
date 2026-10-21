// ===== SERVICE WORKER — offline app shell; cache name tied to VERSION so every release refreshes =====
const VERSION = '1.6.0';
const CACHE = `home-${VERSION}`;
const CDN = 'cdn-v1';                            // pinned libraries + recipe data; survives app releases
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.json', 'icons/icon-192.png', 'fonts/rubik-hebrew.woff2', 'fonts/rubik-latin.woff2',
  'js/app.js', 'js/config.js', 'js/core/api.js', 'js/core/ui.js', 'js/core/modules.js', 'js/core/state.js',
  'js/core/smart.js', 'js/data/seeds.js', 'recipes/lib.js',
  'js/views/module.js', 'js/views/home.js', 'js/views/dice.js', 'js/views/library.js', 'js/views/receipt.js', 'js/views/catalog.js',
  'js/views/auth.js', 'js/views/admin.js'];
const CDN_HOSTS = ['cdn.jsdelivr.net'];
const SHARE = 'share';                           // one shared receipt waiting for the app (survives releases)

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))));

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

// Old app caches are dropped; the pinned-CDN cache survives releases (library only changes when the pin does).
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => ![CACHE, CDN, SHARE].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

// App shell + pinned CDN: cache-first. Recipe data: network-first with a 2.5s budget (grows daily), cache as fallback.
// Supabase API/storage: always network (never cache user data).
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.href.split(/[?#]/)[0] === new URL('share', registration.scope).href) return e.respondWith(share(e.request));
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co') || u.pathname.includes('/book/')) return; // book/ = separate app
  if (u.origin !== location.origin && !CDN_HOSTS.includes(u.hostname)) return;
  if (u.pathname.includes('/recipes/data/')) {
    const net = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CDN).then((c) => c.put(e.request, copy)); }
      return res;
    });
    const slow = new Promise((r) => setTimeout(r, 2500)).then(() => caches.match(e.request));
    e.respondWith(Promise.race([net.catch(() => caches.match(e.request)), slow.then((hit) => hit || net)]));
    return;
  }
  const store = u.origin === location.origin ? CACHE : CDN;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(store).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});

// Share target (manifest): a receipt shared from WhatsApp/SMS/Files is parked in a cache, then the app opens #/share to scan it.
async function share(req) {
  const f = await req.formData().catch(() => null), file = f?.get('file'), c = await caches.open(SHARE);
  await Promise.all([c.delete('file'), c.delete('text')]);
  if (file?.size > 15e6) { /* too big: nothing parked → app explains */ } else if (file?.size) await c.put('file', new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name || '') } }));
  else if (f) await c.put('text', new Response(['title', 'text', 'url'].map((k) => f.get(k)).filter(Boolean).join('\n')));
  return Response.redirect('./#/share', 303);
}
