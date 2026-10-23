// Offline cache. The app shell is precached; packs are served cache-first and refreshed in the
// background, so new content appears on the next visit without blocking this one.
// `node tools/validate.mjs` checks that SHELL lists every shipped file. Bump VERSION on each release.

const VERSION = 'v1';
const SHELL_CACHE = `verbatim-shell-${VERSION}`;
const DATA_CACHE = 'verbatim-packs';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/store.js',
  'js/game.js',
  'js/packs.js',
  'js/engine.js',
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'fonts/jetbrains-400.woff2',
  'fonts/jetbrains-700.woff2',
  'fonts/caveat-700.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    // Precache every pack too, so the whole app works offline after the first visit.
    const data = await caches.open(DATA_CACHE);
    try {
      const res = await fetch('packs/index.json', { cache: 'reload' });
      const index = await res.clone().json();
      await data.put('packs/index.json', res);
      await Promise.all(index.packs.map(p => data.add(new Request(`packs/${p.file}`, { cache: 'reload' }))));
    } catch (err) {
      console.warn('Pack precache failed; packs will be cached on first use.', err);
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('verbatim-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/packs/')) {
    event.respondWith(staleWhileRevalidate(req, event));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html', { cacheName: SHELL_CACHE }).then(r => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(DATA_CACHE);
  const key = new URL(req.url).pathname.replace(/^.*\/packs\//, 'packs/');
  const cached = await cache.match(key);
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}
