// ===== SERVICE WORKER — offline app shell; cache name tied to VERSION so every release refreshes =====
const VERSION = '1.0.3';
const CACHE = `home-${VERSION}`;
const CDN = 'cdn-supabase-2.45.4';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.json', 'icons/icon-192.png',
  'js/app.js', 'js/config.js', 'js/core/api.js', 'js/core/ui.js', 'js/core/modules.js', 'js/core/state.js',
  'js/views/module.js', 'js/views/auth.js', 'js/views/admin.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))));

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

// Old app caches are dropped; the pinned-CDN cache survives releases (library only changes when the pin does).
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== CDN).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

// Same-origin + pinned CDN: cache-first. Supabase API/storage: always network (never cache user data).
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co')) return;
  if (u.origin !== location.origin && u.hostname !== 'cdn.jsdelivr.net') return;
  const store = u.origin === location.origin ? CACHE : CDN;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(store).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
