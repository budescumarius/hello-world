// Service worker: aplicația funcționează complet offline după prima încărcare.
const VERSION = 'santier-v6';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './gestiune.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
// Biblioteca PDF se păstrează în cache după prima folosire
const CDN_HOSTS = ['cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // pe același domeniu pot exista și alte aplicații: ștergem doar cache-urile vechi ale Șantierului
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('santier-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Stale-while-revalidate pentru fișierele aplicației
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        // navigare: fiecare pagină își are propriul index.html
        const key = req.mode === 'navigate'
          ? new URL(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, location.origin).href
          : req;
        const cached = await cache.match(key);
        const net = fetch(req).then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
