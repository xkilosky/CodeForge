/* CodeForge's small app-shell cache. User projects remain in IndexedDB; the
   service worker only caches same-origin UI files, never project/runtime data. */
const CACHE_NAME = 'codeforge-shell-v1';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/brand/mark.png',
];
const MAX_CACHED_ASSETS = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL.filter((path) => path !== '/'));
        const response = await fetch('/', { cache: 'reload' });
        if (!response.ok) throw new Error('Could not cache the CodeForge app shell.');
        const html = await response.clone().text();
        await cache.put('/', response);
        const entryAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
          .map((match) => new URL(match[1], self.location.origin))
          .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
          .map((url) => url.href);
        if (entryAssets.length) await cache.addAll(entryAssets);
      })
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('codeforge-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isAppAsset(url) {
  return url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf');
}

async function trimAssetCache(cache) {
  const requests = await cache.keys();
  const appAssets = requests.filter((request) => {
    const url = new URL(request.url);
    return url.origin === self.location.origin && url.pathname.startsWith('/assets/');
  });
  await Promise.all(appAssets.slice(0, Math.max(0, appAssets.length - MAX_CACHED_ASSETS))
    .map((request) => cache.delete(request)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/'))),
    );
    return;
  }

  if (!isAppAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
        await trimAssetCache(cache);
      }
      return response;
    } catch {
      const cached = await cache.match(request);
      return cached || Response.error();
    }
  })());
});
