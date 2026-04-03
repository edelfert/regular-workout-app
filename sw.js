const CACHE_NAME = 'workout-v6';

// Pre-cache core app shell on install — use individual try/catch so
// one missing file doesn't break the entire install.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const urls = [
        './',
        './index.html',
        './style.css',
        './db.js',
        './app.js',
        './manifest.json',
        './favicon.png',
        './favicon-48.png',
        './icon-180.png',
        './icon-192.png',
        './icon-512.png',
      ];
      for (const url of urls) {
        try { await cache.add(url); } catch (err) { console.warn('SW: failed to cache', url, err); }
      }
    })
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate for same-origin GET requests
self.addEventListener('fetch', (e) => {
  // Skip non-GET and cross-origin (CDN fonts, Chart.js)
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(e.request);
      const fetched = fetch(e.request).then(response => {
        if (response.ok) cache.put(e.request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
