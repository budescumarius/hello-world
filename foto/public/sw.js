// Foto Șantier – pornire instant și poze din memoria telefonului.
const CACHE = 'foto-santier-v16';         // interfața (se schimbă la fiecare versiune)
const IMG = 'foto-img';                    // pozele (rămân între versiuni)
const IMG_MAX = 1500;                      // câte fișiere de poze păstrăm cel mult
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== IMG).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

let puts = 0;
async function trimImages() {
  const c = await caches.open(IMG);
  const keys = await c.keys();
  if (keys.length > IMG_MAX) await Promise.all(keys.slice(0, keys.length - IMG_MAX + 200).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  // Poze: adresa are codul unic al încărcării (?v=…), deci conținutul nu se schimbă niciodată:
  // din memorie dacă există, altfel de pe server (și o păstrăm).
  if (/^files\/\d+\/(thumb|full)$/.test(rel) && url.searchParams.get('v') && !url.searchParams.has('dl')) {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) {
        c.put(e.request, r.clone());
        if (++puts % 50 === 0) trimImages();
      }
      return r;
    }));
    return;
  }
  if (/^(api|files)\//.test(rel)) return; // date: mereu de pe server

  // Interfața: instant din memorie; versiunea nouă se descarcă în fundal.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match('index.html'));
  }));
});
