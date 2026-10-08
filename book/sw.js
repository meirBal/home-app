// ===== Retired: the book app moved to https://meirbal.github.io/sefer/. Old installs pick this up, unregister, and redirect.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()
  .then(() => self.clients.matchAll({ type: 'window' }))
  .then((cs) => Promise.all(cs.map((c) => c.navigate('https://meirbal.github.io/sefer/'))))));
