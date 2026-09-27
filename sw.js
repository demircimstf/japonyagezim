/* Japonya Seyahat Asistanı – service worker
 * Sürüm build.py tarafından her derlemede değiştirilir; tarayıcı yeni sw.js'i görünce
 * yeni önbelleği hazırlar, sayfa "Güncelleme var" der. localStorage / IndexedDB'ye DOKUNULMAZ.
 */
const VERSION = '7470eba43e';
const APP_CACHE = 'japonya-app-' + VERSION;
const TILE_CACHE = 'japonya-tiles';           // sürümden bağımsız: gezdiğin bölgeler kalır
const MAX_TILES = 1500;                        // eski karolar bu sayının üstünde silinir
const APP_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    await c.addAll(APP_FILES.map(u => new Request(u, {cache: 'reload'})));
    await Promise.all(CDN_FILES.map(u => fetch(u, {mode: 'cors'}).then(r => r.ok && c.put(u, r)).catch(() => {})));
  })());
  // skipWaiting YOK: kullanıcı "Yenile"ye basınca geçilir
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('japonya-app-') && k !== APP_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => c.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Harita karoları: yalnızca uygulamanın gerçekten istediği (görüntülenen) karolar önbelleğe alınır.
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;               // tekrar istek yok (OSM kullanım kuralı)
      try {
        const r = await fetch(req);
        if (r.ok && r.type !== 'opaque') { event.waitUntil(c.put(req, r.clone()).then(trimTiles)); }  // 403 'Access blocked' karosu önbelleğe girmez
        return r;
      } catch (e) {
        return new Response('', {status: 504, statusText: 'offline'});
      }
    })());
    return;
  }

  // Leaflet (cdnjs): önce önbellek
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(caches.match(req.url).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const cl = r.clone(); caches.open(APP_CACHE).then(c => c.put(req.url, cl)); }
      return r;
    })));
    return;
  }

  // Hava durumu vb. diğer dış istekler: dokunma (ağ)
  if (url.origin !== self.location.origin) return;

  // Sayfa açılışı: önce önbellek (anında açılır, çevrimdışı çalışır), sorgu parametreleri (?simdi=) yok sayılır
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      return (await c.match('./index.html')) || (await c.match('./')) || fetch(req);
    })());
    return;
  }

  event.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
});
