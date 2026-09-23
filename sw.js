/* .HOSPIRE PRO — Service Worker (app installable, PWA) */
const CACHE = 'hospire-pro-v2';
const ASSETS = [
  '/', '/index.html', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png',
  '/apple-touch-icon.png', '/favicon-64.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // IMPORTANT : ne jamais mettre en cache les données dynamiques.
  // - Cross-origin (Supabase, Resend, etc.) → réseau direct, sinon on servirait des réservations périmées.
  // - /api/ (nos fonctions serverless) → réseau direct.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  // Navigation : toujours la version la plus récente (réseau), repli sur le cache hors-ligne
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () { return caches.match('/index.html'); }));
    return;
  }
  // Statique same-origin uniquement : cache d'abord, sinon réseau (puis mise en cache)
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () { return cached; });
    })
  );
});
