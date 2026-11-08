/* 瓜瓜去哪儿 Service Worker：離線可開。
 * 策略：同源 GET 一律「網路優先、失敗才用快取」，所以網站更新後會立刻拿到新版，沒網路時才用上次的快取。
 * 改了預快取清單或策略時，請把 VERSION 加一。 */
const VERSION = 'v18';
const CACHE = 'guagua-' + VERSION;
const PRECACHE = ['m.html', 'm.css', 'm.js', 'engine.js', 'data.js', 'data.private.js', 'manifest.webmanifest',
  'assets/bg.webp', 'assets/elevator.svg', 'assets/escalator.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png', 'stations_en.js', 'timetable.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => { /* 缺檔不阻擋安裝 */ }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('guagua-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // 字體等跨來源請求交給瀏覽器
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('m.html')) || Response.error();
      return Response.error();
    }
  })());
});
