// ★★★ 2026-09-14/15 全艦隊修「index.html 進快取名單」地雷(3D-Chess 幻影版實錘;補丁 static-pwa-ship/patches/patch-sw-index.mjs --cf):
//    Cloudflare Pages 把 /index.html 308 轉到 / ⇒ 名單裡有 'index.html' 的話 install 存到的是 redirected:true 的回應,
//    導覽拿到它瀏覽器直接拒收 ⇒ 裝成 App 開就 ERR_FAILED;每次 bump 重踩。⇒ 名單只認根('.' / './'),永遠不要再把 index.html 加回來;
//    addAll(全部或全無)改成逐一 add + catch。本次 v0.7.2 只改殼層快取策略,遊戲邏輯零改動。
// ★ CACHE 版號要和 src/config.js 的 VERSION 同步 bump(smoke 在守)。
// ★ CORE 少列一個 src 檔 = 離線時整個遊戲白畫面(smoke 也在守)。
const CACHE = 'majiang-v0.7.2'
const CORE = [
  './',
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
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()))
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
      if (res.ok && !res.redirected && new URL(e.request.url).origin === location.origin) {   // 轉址過的回應(/index.html → /)不進快取
        const cp = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, cp))
      }
      return res
    }).catch(() => (e.request.mode === 'navigate' ? caches.match('./') : Response.error())) /* 離線退路只給導覽請求,退回殼層 './' */)
  )
})
// 🏷️ 版號回報:頁尾徽章問「實際執行中的版本」,答案=本 SW 的快取名。
self.addEventListener('message', function (e) {
  if (e && e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', v: CACHE })
})
