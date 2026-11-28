// Service worker: opens the game with a weak or no signal, and shows turn alerts.
// Pages and code: network first (so nobody plays on old code), the saved copy when the network is slow or gone.
// Card art and icons: saved copy first; art URLs carry a version, so new art is a new URL.
const CACHE = 'lcs-v1';
const SHELL = ['/', '/game.js', '/js/ui.js', '/js/net.js', '/js/fx.js', '/js/screens.js', '/js/app.js',
  '/vendor/anime.umd.min.js', '/vendor/qrcode.js', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // live data: never cached
  const key = e.request.mode === 'navigate' ? '/' : e.request; // every page is the same app; ?room= links included
  if (/\.(jpg|png)$/.test(url.pathname)) {
    e.respondWith(caches.match(key).then(hit => hit || fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(key, r.clone())); return r; })));
    return;
  }
  e.respondWith((async () => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(key, r.clone())); return r; });
    const slow = new Promise(res => setTimeout(res, 4000)); // a weak signal: fall back after 4 seconds if there's a copy
    const first = await Promise.race([net.catch(() => null), slow]);
    if (first) return first;
    return (await caches.match(key, { ignoreSearch: e.request.mode === 'navigate' })) || net;
  })());
});

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Your move!', body: 'Last Crawler Standing' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: `turn-${d.code || ''}`, renotify: true, icon: '/icon-192.png', badge: '/icon-192.png' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('/')));
});
