// Minimal service worker for the Fusionista Ops install (scope "/").
//
// It caches NOTHING — the ops app must always show live data — it exists only
// so Chromium treats the site as installable. The public menu keeps its own
// offline-capable worker at scope "/menu", which wins for those URLs.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});
