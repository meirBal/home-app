// ===== SERVICE WORKER — claims the book/ scope only, so the home app's cache-first worker never serves stale book files.
// No fetch handler: everything goes to the network as usual.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
