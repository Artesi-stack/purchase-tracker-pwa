const CACHE_NAME = 'purchase-tracker-v1';
const CORE_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/dexie@3/dist/dexie.min.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Same-origin app files (HTML/CSS/JS/manifest/icons): try the network first
    // so updates show up as soon as you're online, but fall back to the last
    // cached version whenever there's no connection.
    event.respondWith(
      fetch(req).then(function (response) {
        if (req.method === 'GET' && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match(req);
      })
    );
  } else {
    // Cross-origin (Dexie CDN): cache-first, since this rarely changes and
    // we don't want an external host's slowness/downtime to block loading.
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (response) {
          if (req.method === 'GET' && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return response;
        });
      })
    );
  }
});
