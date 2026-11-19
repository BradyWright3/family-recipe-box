const prefix = 'recipe-box-' + self.registration.scope + '-';
const cacheName = prefix + '46fda6fff6fb2697';
const shell = [
  './', './index.html', './styles.css', './app.js', './model.js', './crypto.js', './icons.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png',
  './apple-touch-icon.png', './catalog.enc.json'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys())
      .filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  const relative = './' + url.pathname.slice(scope.pathname.length);
  if (request.mode === 'navigate' && (relative === './' || relative === './index.html')) {
    event.respondWith(fetch(request).catch(() => caches.match(scope.href, { cacheName })));
    return;
  }
  if (!shell.includes(relative)) return;
  if (relative === './catalog.enc.json') {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const canonical = new URL(relative, scope).href;
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) {
          await cache.put(canonical, response.clone()).catch(() => {});
          return response;
        }
        return await cache.match(canonical) || response;
      } catch (error) {
        const cached = await cache.match(canonical);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
  event.respondWith(caches.match(new URL(relative, scope).href, { cacheName }).then(
    cached => cached || fetch(request)
  ));
});
