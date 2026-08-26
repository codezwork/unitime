const CACHE_NAME = 'unitime-v3'; // Bump this version (v3, v4) to force a full re-cache
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  // We don't hardcode CDN links here; the dynamic cacher below will catch them automatically.
];

// 1. INSTALL: Cache the critical "skeleton" of the app
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline page');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting(); // Activate worker immediately
});

// 2. ACTIVATE: Clean up old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// 3. FETCH: The "Stale-While-Revalidate" Strategy
self.addEventListener('fetch', (event) => {
  // Only handle http and https requests (ignore chrome-extension, etc.)
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) return;

  // Ignore non-GET requests (like Firestore writes and API posts)
  if (event.request.method !== 'GET') return;

  // Ignore API endpoints and Firestore calls
  if (event.request.url.includes('/api/') || event.request.url.includes('firestore.googleapis.com')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        
        // Network Fetch: Get latest version from server
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // If valid response, clone it and update the cache
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              cache.put(event.request, networkResponse.clone());
          }
          // Also cache external CDN scripts (opaque responses)
          if (networkResponse && networkResponse.type === 'cors' || networkResponse.type === 'opaque') {
              cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
           // Network failed? No problem, we handled it below.
        });

        // RETURN STRATEGY: 
        // If we have it in cache, return that INSTANTLY (fast),
        // but the code above ^ runs in background to update cache for *next* time.
        // If not in cache, wait for the network fetch.
        return cachedResponse || fetchPromise;
      });
    })
  );
});
