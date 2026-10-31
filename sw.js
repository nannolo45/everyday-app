// Offline support: the app shell is cached; it updates itself in the background.
// After changing any app file, bump VERSION so installed copies pick up the update.
const VERSION = 'everyday-v30';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'guide-en.html', 'guide-it.html',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/plan.js', 'js/smart.js', 'js/kitchen.js', 'js/parse.js', 'js/recipes.js', 'js/recipe-tools.js', 'js/categories.js', 'js/depts.js', 'js/sortable.js', 'js/drag.js', 'js/tray.js', 'js/shops.js', 'js/shoplist.js', 'js/travel.js', 'js/i18n.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable.png', 'icons/sc-today.png', 'icons/sc-add.png', 'icons/sc-time.png', 'icons/sc-meal.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages lets it keep files for 10 minutes),
  // so a new version never mixes new and old files.
  event.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub API etc. go straight to network

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('Offline', { status: 503 });
  })());
});
