// Service worker: aplicația de ofertare funcționează offline după prima încărcare.
const VERSION = 'ofertare-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ofertare-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameScope = url.origin === location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);
  if (sameScope) {
    // Stale-while-revalidate pentru fișierele aplicației
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const key = req.mode === 'navigate' ? './index.html' : req;
        const cached = await cache.match(key);
        const net = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached);
        return cached || net;
      })
    );
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonturile se păstrează în cache după prima folosire
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
  }
});
