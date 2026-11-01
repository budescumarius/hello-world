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

// Notifications : le serveur envoie un push vide ; on lit ici les dernières notifications (sur votre serveur) et on les affiche
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let list = [];
    try { const r = await fetch('api.php?r=notifs/latest', { credentials: 'include' }); if (r.ok) list = (await r.json()).list || []; } catch (err) { /* hors connexion */ }
    const n = list[0];
    const more = list.length > 1 ? `\n+ ${list.length - 1} autre${list.length > 2 ? 's' : ''} notification${list.length > 2 ? 's' : ''}` : '';
    await self.registration.showNotification(n ? n.title : 'BâtiPro', {
      body: (n ? n.body || '' : 'Vous avez une nouvelle notification') + more,
      icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: 'batipro', renotify: true,
      data: { href: n ? n.href || '#/' : '#/', id: n ? n.id : 0 },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { href = '#/', id = 0 } = e.notification.data || {};
  e.waitUntil((async () => {
    if (id) fetch(`api.php?r=notifs/read/${id}`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'batipro' } }).catch(() => {});
    const url = new URL('./' + href, self.registration.scope).href;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.focus(); w.postMessage({ go: href }); return; } }
    await self.clients.openWindow(url);
  })());
});
