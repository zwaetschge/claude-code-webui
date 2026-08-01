self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

const STATIC_CACHE = 'plum-static-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('plum-static-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isHashedAsset = url.pathname.startsWith('/assets/');
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !isHashedAsset) {
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    })()
  );
});
