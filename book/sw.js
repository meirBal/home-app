// ===== SERVICE WORKER — claims the book/ scope (keeps the home app's worker out) and keeps files fresh:
// network first with revalidation (a new release shows on the next open, never a mix of old and new files),
// the last good copy is kept for offline use (and for the future APK). =====
const CACHE = 'book-offline';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Google Fonts etc.: browser default
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
