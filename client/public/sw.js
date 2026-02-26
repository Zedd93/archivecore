const CACHE_NAME = 'archivecore-v4';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
];

// Install — cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache for navigation
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and API requests
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;

  // For navigation requests — network first, fallback to cached index
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // For static assets — cache first, then network
  if (
    request.url.match(/\.(js|css|png|jpg|svg|woff2?|ttf|ico)$/) ||
    request.url.includes('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Default — network only
  event.respondWith(fetch(request));
});
