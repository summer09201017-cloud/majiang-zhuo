// ★ CACHE 版號要和 src/config.js 的 VERSION 同步 bump(smoke 在守)。
// ★ CORE 少列一個 src 檔 = 離線時整個遊戲白畫面(smoke 也在守)。
const CACHE = 'majiang-v0.6.0'
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',   // 📱 iOS 主畫面圖示(不吃 SVG)
  'icon-192.png',
  'icon-512.png',
  'src/config.js',
  'src/tiles.js',
  'src/rules/hu.js',
  'src/rules/shanten.js',
  'src/rules/meld.js',
  'src/rules/score.js',
  'src/table.js',
  'src/ai.js',
  'src/confetti.js',
  'src/sfx.js',
  'src/game.js',
  'src/renderer.js',
  'src/input.js',
]
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const cp = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, cp))
      }
      return res
    }).catch(() => caches.match('index.html')))
  )
})
// 🏷️ 版號回報:頁尾徽章問「實際執行中的版本」,答案=本 SW 的快取名。
self.addEventListener('message', function (e) {
  if (e && e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', v: CACHE })
})
