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

// ── Web Push ───────────────────────────────────────────────────────────────
// The backend sends {title, body, sessionId, kind}; tapping focuses an already
// open tab for that session instead of opening a second one.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Plum Code', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Plum Code', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.sessionId || payload.kind || 'plum',
      renotify: true,
      data: { sessionId: payload.sessionId || null },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data?.sessionId;
  const target = sessionId ? `/session/${sessionId}` : '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (client.url.includes(target)) return client.focus();
      }
      const existing = clientList[0];
      if (existing) {
        await existing.focus();
        return existing.navigate(target);
      }
      return self.clients.openWindow(target);
    })()
  );
});
