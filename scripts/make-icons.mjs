// 產生 PWA 圖示的 PNG(icon-180 / 192 / 512)—— 從 icon.svg 用無頭瀏覽器截圖。
// 用法:node scripts/make-icons.mjs
//
// ★ 為什麼一定要 PNG:**iOS 的主畫面圖示不吃 SVG** —— 只給 SVG 的話,
//   加到主畫面會變成一張網頁縮圖(整個艦隊都踩過這一條)。
// ★ 這支不是每次都要跑:只有 icon.svg 改了才重跑。產物進 git。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SIZES = [180, 192, 512]

async function loadChromium() {
  const attempt = async (spec) => {
    try { const m = await import(spec); return m.chromium || (m.default && m.default.chromium) || null }
    catch { return null }
  }
  const c = await attempt('playwright')
  if (c) return c
  for (const r of [join(homedir(), 'Downloads', 'hfpc-git'), join(homedir(), 'Desktop')]) {
    let dirs = []
    try { dirs = readdirSync(r) } catch { continue }
    for (const d of dirs) {
      const p = join(r, d, 'node_modules', 'playwright', 'index.js')
      if (!existsSync(p)) continue
      const got = await attempt(pathToFileURL(p).href)
      if (got) return got
    }
  }
  return null
}

const chromium = await loadChromium()
if (!chromium) {
  console.log('⏭  找不到 playwright,沒辦法產圖示(現有的 PNG 不動)。')
  process.exit(3)
}
const svg = readFileSync(join(ROOT, 'icon.svg'), 'utf8')
const browser = await chromium.launch()
for (const n of SIZES) {
  const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 })
  await page.setContent('<style>html,body{margin:0;padding:0}svg{display:block;width:' + n +
    'px;height:' + n + 'px}</style>' + svg)
  const buf = await page.screenshot({ omitBackground: false })
  writeFileSync(join(ROOT, 'icon-' + n + '.png'), buf)
  await page.close()
  console.log('  ✅ icon-' + n + '.png (' + buf.length + ' bytes)')
}
await browser.close()
console.log('🟢 圖示產好了。★ 記得 index.html / manifest / sw.js 的 CORE 都要列到。')
