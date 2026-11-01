// Foto Șantier – pornire instant și poze din memoria telefonului.
const CACHE = 'foto-santier-v22';         // interfața (se schimbă la fiecare versiune)
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

// Miniaturile cerute aproape simultan (o pagină de galerie) pleacă într-o singură cerere: api/thumbs?ids=…
// Serverul face o singură verificare de drepturi și un singur proces, în loc de 60.
let batch = new Map(), timer = null;
function batchedThumb(req, id) {
  return new Promise((resolve) => {
    if (!batch.has(id)) batch.set(id, []);
    batch.get(id).push({ req, resolve });
    if (batch.size >= 12) flush(); // pachete mici: primele miniaturi apar imediat, restul vin în paralel
    else if (!timer) timer = setTimeout(flush, 12);
  });
}
async function flush() {
  clearTimeout(timer); timer = null;
  const cur = batch; batch = new Map();
  if (!cur.size) return;
  const parts = new Map();
  try {
    const url = new URL('api/thumbs', self.registration.scope);
    url.searchParams.set('ids', [...cur.keys()].join(','));
    const r = await fetch(url, { credentials: 'same-origin' });
    if (r.ok) {
      const buf = await r.arrayBuffer(), dv = new DataView(buf);
      for (let o = 0; o + 8 <= buf.byteLength;) {
        const id = String(dv.getUint32(o)), n = dv.getUint32(o + 4);
        parts.set(id, buf.slice(o + 8, o + 8 + n)); o += 8 + n;
      }
    }
  } catch {}
  const c = await caches.open(IMG);
  for (const [id, waiters] of cur) {
    const data = parts.get(id);
    for (const w of waiters) {
      if (data) {
        const resp = new Response(data, { headers: { 'Content-Type': 'image/jpeg' } });
        c.put(w.req, resp.clone());
        if (++puts % 50 === 0) trimImages();
        w.resolve(resp);
      } else w.resolve(fetch(w.req).catch(() => Response.error())); // rezervă: cererea obișnuită
    }
  }
}
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
  const m = rel.match(/^files\/(\d+)\/(thumb|full)$/);
  if (m && url.searchParams.get('v') && !url.searchParams.has('dl')) {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      if (m[2] === 'thumb') return batchedThumb(e.request, m[1]);
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
