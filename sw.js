const CACHE_NAME = 'workout-v10';

// Pre-cache core app shell on install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const urls = [
        './',
        './index.html',
        './style.css',
        './db.js',
        './timer.js',
        './app.js',
        './manifest.json',
        './favicon.png',
        './favicon-48.png',
        './icon-180.png',
        './icon-192.png',
        './icon-512.png',
      ];
      for (const url of urls) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('SW cache skip:', url);
        }
      }
    })
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Respond to ALL fetch events — Firefox Android requires respondWith
// on navigation requests for PWA install to work.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    (async () => {
      // For cross-origin requests (CDN fonts, Chart.js), go network-only
      if (new URL(e.request.url).origin !== self.location.origin) {
        return fetch(e.request);
      }

      // Same-origin: stale-while-revalidate
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request)
        .then((response) => {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        })
        .catch(() => {
          // Offline — return cached version or a basic fallback
          if (cached) return cached;
          // For navigation requests, try returning cached index.html
          if (e.request.mode === 'navigate') return cache.match('./index.html');
          return new Response('Offline', { status: 503 });
        });

      return cached || fetchPromise;
    })()
  );
});
