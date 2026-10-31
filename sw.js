// Forge service worker: precaches every file the app needs, then serves them cache-first so the
// app works fully offline. To publish an update: change files, bump VERSION, deploy. Open clients
// see an "update ready" banner and reload when the user chooses (never mid-workout by surprise).

const VERSION = 'forge-v1.3.0';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/DMSans-Regular.woff',
  './fonts/DMSans-Italic.woff',
  './fonts/DMSans-Medium.woff',
  './fonts/DMSans-Bold.woff',
  './fonts/JetBrainsMono-Medium.woff',
  './fonts/JetBrainsMono-Bold.woff',
  './fonts/JetBrainsMono-ExtraBold.woff',
  './js/app.js',
  './js/util.js',
  './js/fx.js',
  './js/md.js',
  './js/store.js',
  './js/content.js',
  './js/engine.js',
  './js/calc.js',
  './js/player.js',
  './js/video.js',
  './js/views.js',
  './js/tools.js',
  './content/meta.json',
  './content/programme.json',
  './content/exercises.json',
  './content/drills.json',
  './content/rules.json',
  './content/plan.json',
  './content/science.json',
  './content/decisions.json',
  './content/references.json',
  './content/glossary.json',
  './content/videos.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files.
    await cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('forge-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // external links (DOI, PubMed) go to the network untouched

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Navigations always get the app shell (the app uses hash routing).
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
