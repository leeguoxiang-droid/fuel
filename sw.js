// 网络优先：有网络就拿最新版并更新缓存，没网络才用缓存。改版时把 CACHE 加一号。
const CACHE = 'fuel-v7';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'lib/leaflet-1.9.4.css', 'lib/leaflet-1.9.4.js', 'lib/protomaps-leaflet-5.0.1.js', 'map/bp-stations.json'];
// 离线地图（约 5 MB）另放一个缓存，改版不用重下；换地图档时改档名
const MAPCACHE = 'fuel-map';
const MAPFILE = 'map/bp-20261021.pmtiles';
const mapURL = new URL(MAPFILE, self.location).href;
const saveMap = () => caches.open(MAPCACHE).then(async (c) => {
  if (await c.match(mapURL)) return;
  const res = await fetch(mapURL);
  if (res.ok && res.status === 200) await c.put(mapURL, res);
  for (const k of await c.keys()) if (k.url !== mapURL) await c.delete(k);
}).catch(() => {});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MAPCACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
  saveMap();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.url.split('?')[0] === mapURL) { e.respondWith(mapRange(req)); e.waitUntil(saveMap()); return; }
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

// 地图库按需读档案的一小段（Range）；手机里有整份就从里面切给它
async function mapRange(req) {
  const hit = await caches.match(mapURL, { cacheName: MAPCACHE });
  if (!hit) return fetch(req);
  const blob = await hit.blob(), size = blob.size;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('Range') || '');
  if (!m) return new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } });
  const a = +m[1], b = Math.min(m[2] ? +m[2] : size - 1, size - 1);
  return new Response(blob.slice(a, b + 1), { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
}
