// Off Book offline service worker: saves every file the app needs on the device on first visit,
// then serves them from the device, so the app opens and runs with no internet.
// When you publish an update, change VERSION so devices pick up the new files.
const VERSION = 'off-book-v6';
const FILES = [
  './',
  './app.js',
  './editor.js',
  './firebase-config.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './index.html',
  './local-db.js',
  './manifest.webmanifest',
  './parser.js',
  './scoring.js',
  './style.css',
  './sync.js',
  './vendor/fa/css/all.min.css',
  './vendor/fa/webfonts/fa-brands-400.woff2',
  './vendor/fa/webfonts/fa-regular-400.woff2',
  './vendor/fa/webfonts/fa-solid-900.woff2',
  './vendor/firebase/firebase.js',
  './vendor/fonts/fonts.css',
  './vendor/fonts/hanken-grotesk-latin-400-normal.woff2',
  './vendor/fonts/hanken-grotesk-latin-500-normal.woff2',
  './vendor/fonts/hanken-grotesk-latin-600-normal.woff2',
  './vendor/fonts/hanken-grotesk-latin-700-normal.woff2',
  './vendor/fonts/kameron-latin-600-normal.woff2',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  './vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract-lang/eng.traineddata.gz',
  './vendor/tesseract/tesseract.esm.min.js',
  './vendor/tesseract/worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Add files one by one so a single hiccup doesn't block the rest
    await Promise.all(FILES.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (e) { /* retried on next visit */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
    const cache = await caches.open(VERSION);
    const missing = (await Promise.all(FILES.map(async (u) => (await cache.match(u)) ? null : u))).filter(Boolean);
    if (!missing.length) for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: 'offline-ready', version: VERSION });
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Your Firebase settings: always try the newest copy first, so edits on GitHub take effect right away
  if (new URL(req.url).pathname.endsWith('/firebase-config.js')) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req, { cache: 'no-store' }); if (res.ok) cache.put(req, res.clone()); return res; }
      catch (e) { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      // Offline and not cached: page navigations fall back to the app itself
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
      throw e;
    }
  })());
});
