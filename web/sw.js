// Service worker : l'application s'installe sur l'écran d'accueil et s'ouvre même sans réseau.
// Toujours le réseau d'abord (jamais de version périmée) ; la copie locale ne sert qu'hors connexion.
// Les données (api.php) ne sont jamais mises en cache.
const CACHE = 'batipro-shell';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('api.php') || u.pathname.includes('/uploads/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('./') || caches.match('index.html'))));
});
