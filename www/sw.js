/* Fährtenfuchs Service Worker – App-Shell offline verfügbar machen.
   Strategie: Network-first mit Cache-Fallback (immer aktuell, offline nutzbar).
   Kartenkacheln und Routing-API werden bewusst NICHT gecacht. */
const CACHE = 'faehrtenfuchs-v4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
const NEVER_CACHE = ['tile.openstreetmap.org', 'routing.openstreetmap.de'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (NEVER_CACHE.some(h => url.hostname === h)) return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.origin === location.origin }))
  );
});
