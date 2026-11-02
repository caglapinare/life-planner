// Önbellek sürümü: büyük bir güncellemede numarayı artır.
const CACHE_NAME = 'yasam-planlayicim-v6';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

// Önce önbellekten hızlıca aç, arka planda yeni sürümü indir (stale-while-revalidate).
// Böylece GitHub'a yüklenen güncelleme, uygulamanın bir sonraki açılışında görünür.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Firebase gibi dış kaynaklara karışma
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const network = fetch(event.request).then(response => {
      if (response && response.status === 200) cache.put(event.request, response.clone());
      return response;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const fresh = await network;
    if (fresh) return fresh;
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
