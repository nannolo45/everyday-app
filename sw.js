// Offline support: the app shell is cached; it updates itself in the background.
// After changing any app file, bump VERSION so installed copies pick up the update.
const VERSION = 'everyday-v69';
const SHELL = [
  './', 'index.html', 'css/shoplist.css', 'css/style.css', 'manifest.webmanifest', 'guide-en.html', 'guide-it.html',
  'js/app.js', 'js/categories.js', 'js/connections.js', 'js/core.js', 'js/depts.js', 'js/drag.js', 'js/geo.js', 'js/editors.js', 'js/foods.js', 'js/i18n.js', 'js/kinds.js', 'js/kitchen-host.js', 'js/kitchen.js', 'js/model.js', 'js/parse.js', 'js/plan.js', 'js/planning.js', 'js/recipe-tools.js', 'js/recipes.js', 'js/shell.js', 'js/shoplist-ui.js', 'js/shoplist.js', 'js/shops.js', 'js/smart.js', 'js/sortable.js', 'js/store.js', 'js/sync.js', 'js/timer.js', 'js/theme.js', 'js/weekpick.js', 'js/weekgrid.js', 'js/finder.js', 'js/placing.js', 'js/routines.js', 'js/palestra.js', 'js/times.js', 'js/travel-plan.js', 'js/travel.js', 'js/tray.js', 'js/views/events.js', 'js/views/planner.js', 'js/views/settings.js', 'js/views/shop.js', 'js/views/tasks.js', 'js/views/impegni.js', 'js/views/wide.js', 'js/views/today.js', 'js/widgets.js',
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
    // Navigations open the app shell, except the pages that are shells of their own (the guide):
    // keyed by name, so a guide page is never cached as the app, nor the app served for the guide.
    const page = req.mode === 'navigate' ? url.pathname.split('/').pop() : '';
    const key = req.mode === 'navigate' ? (page && page !== 'index.html' && SHELL.includes(page) ? page : 'index.html') : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('Offline', { status: 503 });
  })());
});
