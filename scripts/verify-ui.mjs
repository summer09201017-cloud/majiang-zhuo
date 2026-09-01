// 真瀏覽器驗收:用**真滑鼠**點牌,驗「玩家做得到的那些事」。
// 用法:node scripts/verify-ui.mjs      (LIVE_URL=https://... 可改驗線上;SHOTS=<資料夾> 另存截圖)
//
// ★ smoke 驗規則,但它看不見「點下去有沒有反應」「牌面畫不畫得出來」「版面有沒有疊」。
// ★ 驗收用 page.mouse(事件層),不用 evaluate 直呼函式 —— evaluate 抓不到輸入接線的錯。
// ★ 兩個一定要記得的坑(0901 都踩過):
//    ① src 裡的 const **不會**掛上 window ⇒ 等第一幀要用 window.__renderer(index.html 有曝)
//    ② state 在 boot 當下就成立、rAF 還沒畫 ⇒ 等 __renderer.btns.length 才算「畫過一幀」
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

// ⚠ 不可以用 URL.pathname 手剝:路徑帶中文會留百分比編碼 ⇒ 全 404(彈珠檯踩過)
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── 找 playwright(repo 零相依,不住這裡;找不到=跳過並回 3,不靜靜算通過)──
async function loadChromium() {
  const tried = []
  const attempt = async (spec) => {
    tried.push(spec)
    try { const m = await import(spec); return m.chromium || (m.default && m.default.chromium) || null }
    catch { return null }
  }
  if (process.env.PLAYWRIGHT_DIR) {
    const p = join(process.env.PLAYWRIGHT_DIR, 'index.js')
    const c = existsSync(p) ? await attempt(pathToFileURL(p).href) : null
    if (c) return { chromium: c }
  }
  const c2 = await attempt('playwright')
  if (c2) return { chromium: c2 }
  for (const r of [join(homedir(), 'Downloads', 'hfpc-git'), join(homedir(), 'Desktop')]) {
    let dirs = []
    try { dirs = readdirSync(r) } catch { continue }
    for (const d of dirs) {
      const p = join(r, d, 'node_modules', 'playwright', 'index.js')
      if (!existsSync(p)) continue
      const c = await attempt(pathToFileURL(p).href)
      if (c) return { chromium: c }
    }
  }
  return { chromium: null, tried }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

function serve() {
  return new Promise((res) => {
    const srv = createServer((req, r) => {
      let f = decodeURIComponent(req.url.split('?')[0])
      if (f === '/') f = '/index.html'
      const p = join(ROOT, f)
      if (!p.startsWith(ROOT) || !existsSync(p)) { r.writeHead(404); r.end('nope'); return }
      r.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
      r.end(readFileSync(p))
    })
    srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' }))
  })
}

const results = []
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })

const { chromium, tried } = await loadChromium()
if (!chromium) {
  console.log('⏭  找不到 playwright,跳過真瀏覽器驗收(smoke 仍然有效)。試過:' + (tried || []).join(', '))
  console.log('   裝法:任一個有 node_modules 的 repo 裡 npm i -D playwright,或設 PLAYWRIGHT_DIR')
  process.exit(3)
}

const live = process.env.LIVE_URL
const local = live ? null : await serve()
const base = live || local.url
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

await page.goto(base + '?bust=' + Date.now())
// ★ 等第一幀(不是等 boot):btns 有東西才代表 renderer 真的畫過
await page.waitForFunction(() => window.__renderer && window.__renderer.btns.length >= 2, null, { timeout: 15000 })

const boot = await page.evaluate(() => {
  const G = window.__game.G, c = conserve(G)
  let faces = 0
  for (const k of KINDS) if (face(k) && face(k).width > 0) faces++
  return { ok: c.ok, n: c.n, phase: G.phase, hand: G.hands[0].length, drawn: !!G.drawn[0],
    flowersClean: [0, 1, 2, 3].every((s) => !G.hands[s].some(isFlower)), faces,
    btns: window.__renderer.btns.map((b) => b.id) }
})
check('開局 144 張守恆', boot.ok, boot.n + '/144')
check('莊家 16 張 + 剛摸 1 張,四家手牌無花', boot.hand === 16 && boot.drawn && boot.flowersClean)
check('★ 42 種牌面都烤進 offscreen 快取(零美術檔)', boot.faces === 42, boot.faces)
check('左上角兩顆鈕畫得出來(新局 + ⚙)', boot.btns.includes('new') && boot.btns.includes('gear'), boot.btns.join(','))

// ★ 規則三支(hu/meld/score)在瀏覽器裡真的載得到、算得對 —— 守的是 index.html 的 script 標籤漏掉
const rules = await page.evaluate(() => {
  const P2 = (str) => str.split(/\s+/).filter(Boolean).flatMap((tok) => {
    const suit = tok[tok.length - 1]
    return tok.slice(0, -1).split('').map((ch) => ({ s: suit, r: +ch }))
  })
  const hand = P2('123m 456m 789m 123p 456p 7p')
  const r = scoreHand({ hand, win: P2('7p')[0], melds: [], seatWind: 0, prevalent: 0, flowers: 0, selfDraw: true })
  return { ok: r.ok, tai: r.tai, text: taiText(r), waits: waits(toCounts(hand), 5).length }
})
check('★ 規則三支在瀏覽器裡載得到、算得對(門清自摸 = 3 台)', rules.ok && rules.tai === 3, rules.text)
check('★ 聽牌算得出來(三面聽)', rules.waits === 3, rules.waits + ' 張')

// ★ 真滑鼠點手牌 —— 走完整條 pointer → input → game.onDown → handHit → playerDiscard
const spot = await page.evaluate(() => {
  const r = tilePos(window.__game.G, 'hand', 0, 5), s = window.__renderer
  return { x: (r.x + r.w / 2) * s.scale + s.ox, y: (r.y + r.h / 2) * s.scale + s.oy }
})
// ⚠ 不可以用 river[0].length 當「有沒有打出去」的證據:牌打出去之後若被人碰/吃/槓,
//    takeFromRiver 會把它從牌河拿走,長度又變回去 —— 看起來像「點了沒反應」。
//    0902 實錄:這條偶爾紅一次,診斷印出 handHit=5、可打=true 才發現是斷言錯,不是遊戲錯。
//    G.discards 是只增不減的計數器,才是對的證據。
const n0 = await page.evaluate(() => window.__game.G.discards)
const at = await page.evaluate((sp) => {
  const G = window.__game.G, s = window.__renderer
  const lx = (sp.x - s.ox) / s.scale, ly = (sp.y - s.oy) / s.scale   // 反算回邏輯座標
  const hit = handHit(G, lx, ly)
  const btn = s.btnAt(lx, ly)
  return { phase: G.phase, turn: G.turn, can: canDiscardNow(G, 0),
    hot: (window.__game.acts || []).filter((a) => a.hot).map((a) => a.label).join(','),
    hit: hit ? hit.i : 'null', btn: btn ? btn.id : '-', scale: s.scale.toFixed(3),
    cv: s.cv.width + 'x' + s.cv.height }
}, spot)
await page.mouse.click(spot.x, spot.y)
await page.waitForTimeout(150)
const afterClick = await page.evaluate(() => {
  const G = window.__game.G
  return { n: G.discards, turn: G.turn, phase: G.phase, ok: conserve(G).ok,
    melds: G.melds.reduce((a, m) => a + m.length, 0) }
})
check('★★ 真滑鼠點手牌 → 牌真的打出去了', afterClick.n === n0 + 1,
  '打牌數 ' + n0 + ' → ' + afterClick.n + '(點的當下 ' + at.phase + ' turn=' + at.turn +
  ' 可打=' + at.can + ' handHit=' + at.hit + ' btnAt=' + at.btn +
  ' scale=' + at.scale + ' cv=' + at.cv + (at.hot ? ' 主鈕:' + at.hot : '') + ')')
// ⚠ M2 起打完不一定馬上換人:有人能吃碰槓胡就會停在 react 等宣告(0901 這條斷言忘了改)
check('打完進入 react 或換下一家(或已經被人碰走)、且仍守恆',
  afterClick.ok && (afterClick.phase === 'react' || afterClick.turn !== 0 || afterClick.melds > 0),
  afterClick.phase + ' turn=' + afterClick.turn + ' 副露' + afterClick.melds)
if (shots) writeFileSync(join(shots, 'after-click.png'), await page.screenshot())

// 跑完一整局(走 UI 同一份函式),驗到流局都不破
// ★★ 無頭 Chromium 會把 rAF 節流掉(實測:跑一陣子之後 __game.last 就不動了)。
//    ⇒ 點完之後要自己推一幀,不然讀到的 renderer.btns 是**上一幀**的,會誤判成「鈕不見了」。
//    0901 實錄:設定面板明明開著,btns 卻只有 new/gear,查了幾輪才發現是驗法的問題不是遊戲的。
const frame = () => page.evaluate(() => { __game.acts = humanActions(__game.G, 0); __renderer.draw(__game) })
const clickBtn = async (id) => {
  const p = await page.evaluate((btnId) => {
    const b = __renderer.btns.find((x) => x.id === btnId), s = __renderer
    return b ? { x: (b.x + b.w / 2) * s.scale + s.ox, y: (b.y + b.h / 2) * s.scale + s.oy } : null
  }, id)
  if (!p) return false
  await page.mouse.click(p.x, p.y)
  await frame()
  return true
}

// ── ⚙ 設定面板 ──
await frame()
const gearOK = await clickBtn('gear')
const panel = await page.evaluate(() => ({ panel: __game.panel, btns: __renderer.btns.map((b) => b.id).join(',') }))
check('★ ⚙ 打得開,裡面有音效/一炮多響/電腦強度/局數四顆鈕',
  gearOK && panel.panel === 'set' && ['sfx', 'multiron', 'level', 'hands'].every((k) => panel.btns.includes(k)),
  panel.btns)
const lv0 = await page.evaluate(() => __game.G.opts.level)
await clickBtn('level')
const lv1 = await page.evaluate(() => ({ now: __game.G.opts.level, stored: localStorage.getItem('mj-opts') }))
check('★ 電腦強度切得動(新手/普通/老手)、而且存得起來',
  lv1.now !== lv0 && [0, 1, 2].includes(lv1.now) && String(lv1.stored).includes('level'),
  lv0 + ' → ' + lv1.now)
while ((await page.evaluate(() => __game.G.opts.level)) !== 1) await clickBtn('level')   // 轉回普通
const m0v = await page.evaluate(() => __game.G.opts.multiRon)
await clickBtn('multiron')
const m1v = await page.evaluate(() => ({ now: __game.G.opts.multiRon, stored: localStorage.getItem('mj-opts') }))
check('★★ 一炮多響切得動,而且存進 localStorage',
  m1v.now === !m0v && String(m1v.stored).includes('multiRon'), JSON.stringify(m1v))
await clickBtn('multiron')                     // 切回來
await clickBtn('hands')
const hv = await page.evaluate(() => __game.G.opts.hands)
check('局數切得動(單局/一圈/全將)', [1, 4, 16].includes(hv), hv)
// 🏆 成績榜:從 ⚙ 進得去、框在畫布內、關得掉
const rankOK = await clickBtn('rank')
const rankPanel = await page.evaluate(() => {
  const s = __renderer, W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H
  const bad = s.btns.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H)
  return { panel: __game.panel, btns: s.btns.map((b) => b.id).join(','), out: bad.map((b) => b.id).join(',') }
})
check('★ 🏆 成績榜打得開,而且面板的鈕都在畫布內',
  rankOK && rankPanel.panel === 'rank' && rankPanel.out === '', rankPanel.panel + ' 出界:' + rankPanel.out)
await clickBtn('close')
check('面板關得掉', (await page.evaluate(() => __game.panel)) === null)

// ── 💡 提示:算得出來、標得到那一張、而且不會順手把牌打出去 ──
// ⚠ 兩件事都會讓這個迴圈永遠等不到「輪我打牌」,而且是**偶爾**才發生(= 會閃的測試):
//    ① 牌局中途就結束(有人胡了/流局)⇒ 要按「下一局」繼續找
//    ② onBtn('next') 打完整場會 newMatch(),**整個 G 物件被換掉** ⇒ 每圈都要重讀 __game.G
await page.evaluate(() => {
  for (let k = 0; k < 3000; k++) {
    const G = __game.G
    if (canDiscardNow(G, 0)) break
    if (G.phase === 'win' || G.phase === 'washout' || G.phase === 'over') { __game.onBtn('next'); continue }
    if (G.phase === 'react' && !G.react.claim[0]) { declare(G, 0, { type: 'pass' }); continue }
    if (!stepAuto(G, policyFor(G.opts.level), 0)) break
  }
})
await frame()
const hintIdx = await page.evaluate(() => (__game.acts || []).findIndex((a) => a.kind === 'hint'))
check('★ 輪到我打牌時,按鈕列有「💡 提示」', hintIdx >= 0, hintIdx)
if (hintIdx >= 0) {
  const river0 = await page.evaluate(() => __game.G.river[0].length)
  const tHint = Date.now()
  await clickBtn('act:' + hintIdx)
  const hintMs = Date.now() - tHint
  const hint = await page.evaluate(() => {
    const g = __game, G = g.G
    if (!g.hint) return null
    const t = g.hint.slot < 0 ? G.drawn[0] : G.hands[0][g.hint.slot]
    return { text: g.hint.text, sameTile: !!t && kidx(t) === g.hint.i, river: G.river[0].length,
      sh: g.hint.shanten, best: evalDiscards(G, 0, {})[0].shanten }
  })
  check('★★ 💡 算得出建議,而且標的位置真的是那一張牌',
    !!hint && hint.sameTile, hint && hint.text)
  check('★★ 💡 建議的那張不會讓向聽變差', !!hint && hint.sh === hint.best,
    hint && (hint.sh + ' vs 最好 ' + hint.best))
  check('★ 按提示不會順手把牌打出去', !!hint && hint.river === river0, hint && (river0 + ' → ' + hint.river))
  check('★ 提示算得夠快(按下去不會卡住;第二層有 220ms 預算)', hintMs < 900, hintMs + 'ms')
  if (shots) writeFileSync(join(shots, 'hint.png'), await page.screenshot())
}

// ── 吃碰槓胡:真滑鼠按下去 ──
const react = await page.evaluate(() => {
  let G = __game.G
  let guard = 0
  for (;;) {
    if (guard++ > 8000) break
    G = __game.G                        // ★ 每圈重讀:newMatch() 會換掉整個 G
    if (G.phase === 'win' || G.phase === 'washout' || G.phase === 'over') { __game.onBtn('next'); continue }
    __game.acts = humanActions(G, 0)
    // ⚠ M3 起「💡 提示」在自己回合也會出現在按鈕列 ⇒ 不能再用「acts 非空」當停止條件,
    //    否則永遠停在自己的打牌回合,測不到吃碰槓胡(0901 這條就這樣紅了)
    if (G.phase === 'react' && __game.acts.length) break
    if (G.phase !== 'play' && G.phase !== 'react') break
    if (canDiscardNow(G, 0)) { playerDiscard(G, 0); continue }
    if (!stepAuto(G, policyFor(G.opts.level), 0)) break
  }
  return { phase: G.phase, labels: __game.acts.map((a) => a.label), melds: G.melds[0].length }
})
await frame()
if (react.labels.length && react.phase === 'react') {
  const meldBefore = react.melds
  const clicked = await clickBtn('act:0')
  const afterAct = await page.evaluate(() => {
    const G = __game.G
    return { phase: G.phase, melds: G.melds[0].length, claim: !!(G.react && G.react.claim[0]), ok: conserve(G).ok }
  })
  check('★★ 真滑鼠按吃/碰/槓/胡:狀態真的變了、而且仍守恆',
    clicked && afterAct.ok && (afterAct.melds > meldBefore || afterAct.phase !== 'react' || afterAct.claim),
    react.labels.join('/') + ' → ' + afterAct.phase)
} else {
  check('★ 推得到「玩家要做決定」的狀態', false, react.phase + ' ' + react.labels.join('/'))
}

// ── 打到有人胡,結算面板要出得來、下一局按得動 ──
const won = await page.evaluate(() => {
  const G = __game.G
  let guard = 0
  while (guard++ < 40000 && G.phase !== 'win' && G.phase !== 'over') {
    if (G.phase === 'washout') { __game.onBtn('next'); continue }
    if (G.phase === 'react' && !G.react.claim[0]) {
      const hot = humanActions(G, 0).find((a) => a.hot)
      declare(G, 0, hot ? hot.choice : { type: 'pass' }); continue
    }
    if (canDiscardNow(G, 0)) {
      const hot = humanActions(G, 0).find((a) => a.hot)
      if (hot) { applyHumanAction(G, 0, hot); continue }
      playerDiscard(G, 0); continue
    }
    if (!stepAuto(G, POLICY_AI, 0)) break
  }
  return { phase: G.phase, ok: conserve(G).ok, scores: G.scores.join('/'),
    tai: G.result && G.result.winners.length ? G.result.winners[0].tai : -1 }
})
await frame()
const resultBtns = await page.evaluate(() => __renderer.btns.map((b) => b.id).join(','))
check('★★ 有人胡了:結算面板出得來、台數算得出來',
  won.phase === 'win' && won.ok && won.tai >= 0 && resultBtns.includes('next'),
  won.phase + ' ' + won.tai + '台 ' + resultBtns)
check('胡完分數零和', won.scores.split('/').reduce((a, b) => a + (+b), 0) === 0, won.scores)
// M4:倒牌 + 彩帶
const finale = await page.evaluate(() => {
  const G = __game.G, w = G.result && G.result.winners[0]
  const mine = !!(G.result && G.result.winners.some((x) => x.seat === 0))
  return {
    tiles: w ? w.hand.length + w.melds.reduce((a, m) => a + m.length, 0) + 1 : 0,
    kongs: w ? w.melds.filter((m) => m.length === 4).length : 0,
    mine, confetti: Confetti.ps.length,
    panelBtns: __renderer.btns.map((b) => b.id).join(','),
  }
})
// ⚠ 不是固定 17 張:一副**槓**是 4 張牌卻只算一副面子 ⇒ 每槓一次就多一張。
//    0902 實錄:這條十次紅一次(18 張),是斷言算錯不是產品錯。
check('★ 結算會倒牌:張數 = 17 + 槓數', finale.tiles === 17 + finale.kongs,
  finale.tiles + ' 張 / ' + finale.kongs + ' 槓')
check('★ 只有「我」胡才放彩帶', finale.mine ? finale.confetti > 0 : finale.confetti === 0,
  (finale.mine ? '我胡' : '別人胡') + ' 紙花 ' + finale.confetti)
if (shots) writeFileSync(join(shots, 'result.png'), await page.screenshot())
await clickBtn('next')
const nextHandState = await page.evaluate(() => {
  const G = __game.G
  return { phase: G.phase, hand: G.hand, ok: conserve(G).ok, wall: G.wall.length }
})
check('★ 「下一局」按得動:重新發牌、仍然 144 張',
  (nextHandState.phase === 'play' || nextHandState.phase === 'react') && nextHandState.ok,
  nextHandState.phase + ' 第' + nextHandState.hand + '局 牌牆' + nextHandState.wall)

// 讓四家全電腦把一局打完(走的是 UI 同一支 stepAuto),沿途每一步驗守恆
const full = await page.evaluate(() => {
  const G = window.__game.G
  let bad = 0, steps = 0
  while ((G.phase === 'play' || G.phase === 'react') && steps++ < 3000) {
    if (!stepAuto(G, POLICY_AI, -1)) break
    if (!conserve(G).ok) { bad++; break }
  }
  return {
    phase: G.phase, bad, steps,
    melds: G.melds.map((m) => m.length).join('/'),
    tai: G.result && G.result.winners.length ? taiText({ ok: true, items: G.result.winners[0].items, tai: G.result.winners[0].tai }) : '',
    scores: G.scores.join('/'),
  }
})
check('★★ 在真瀏覽器裡打完一局:零守恆破口、收得了尾',
  full.bad === 0 && (full.phase === 'win' || full.phase === 'washout'), full.phase + '/破口' + full.bad)
check('★ 吃碰槓胡的仲裁在瀏覽器裡也走得通', full.phase === 'washout' || full.tai !== '',
  full.phase + ' 副露' + full.melds + ' ' + full.tai)
check('分數零和', full.scores.split('/').reduce((a, b) => a + (+b), 0) === 0, full.scores)
if (shots) writeFileSync(join(shots, 'washout.png'), await page.screenshot())

// ── M5:存檔續玩 + ⛶ 全螢幕鈕 ──
const saveNow = await page.evaluate(() => {
  const G = __game.G
  for (let k = 0; k < 600; k++) {
    const g = __game.G
    if (g.discards >= 10 && (g.phase === 'play' || g.phase === 'react')) break
    if (g.phase === 'win' || g.phase === 'washout' || g.phase === 'over') { __game.onBtn('next'); continue }
    if (g.phase === 'react' && !g.react.claim[0]) { declare(g, 0, { type: 'pass' }); continue }
    if (canDiscardNow(g, 0)) { playerDiscard(g, 0); continue }
    if (!stepAuto(g, policyFor(g.opts.level), 0)) break
  }
  saveState(__game.G)
  const raw = localStorage.getItem('mj-save')
  return { phase: __game.G.phase, discards: __game.G.discards, bytes: raw ? raw.length : 0 }
})
check('★ 打到一半會自動存檔(而且存檔不大)',
  saveNow.bytes > 200 && saveNow.bytes < 20000, saveNow.bytes + ' bytes @ ' + saveNow.phase)
// 重新整理 = 模擬被切走再回來
await page.reload()
await page.waitForFunction(() => window.__renderer && window.__renderer.btns.length >= 2, null, { timeout: 15000 })
const resumed = await page.evaluate(() => {
  const G = __game.G
  return { phase: G.phase, discards: G.discards, ok: conserve(G).ok, wall: G.wall.length }
})
check('★★ 關掉再打開,接著上次那一局繼續打(而且仍然 144 張)',
  resumed.ok && resumed.discards === saveNow.discards,
  '打牌數 ' + saveNow.discards + ' → ' + resumed.discards + ' / ' + resumed.phase)
await page.evaluate(() => { __game.onBtn('new') })
check('★ 按「新局」會把存檔清掉(不會又跳回舊局)',
  (await page.evaluate(() => localStorage.getItem('mj-save') === null || __game.G.discards === 0)))
await frame()
await clickBtn('gear')
const fsBtn = await page.evaluate(() => __renderer.btns.map((b) => b.id).join(','))
check('★ ⚙ 裡有 ⛶ 全螢幕鈕(手機要橫著全螢幕才好按)', fsBtn.includes('full'), fsBtn)
await clickBtn('full')      // 桌機會被拒絕 —— 重點是不能因此炸掉
check('★ 全螢幕被瀏覽器拒絕時不會炸', (await page.evaluate(() => !!__game.G)) === true)
await clickBtn('close')

// ★ 尊重 prefers-reduced-motion:整個不放動畫也不放彩帶
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.goto(base + '?bust=' + Date.now())
await page.waitForFunction(() => window.__renderer && window.__renderer.btns.length >= 2, null, { timeout: 15000 })
const rm = await page.evaluate(() => {
  const G = __game.G
  __game.startFly(G)                       // 就算硬叫它起飛也不該有動畫
  return { reduced: __game.reduced, fly: !!__game.fly, confetti: Confetti.start(__game.reduced) }
})
check('★ 使用者要求減少動態:不飛牌、不放彩帶',
  rm.reduced === true && rm.fly === false && rm.confetti === false, JSON.stringify(rm))
await page.emulateMedia({ reducedMotion: 'no-preference' })

// 直向:要蓋版請人轉橫,不能讓人看到擠爛的牌桌
await page.setViewportSize({ width: 430, height: 932 })
await page.waitForTimeout(150)
const portrait = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display)
check('★ 手機直向會蓋版提示轉橫向', portrait === 'flex', portrait)
await page.setViewportSize({ width: 932, height: 430 })
await page.waitForTimeout(150)
const landscape = await page.evaluate(() => ({
  hint: getComputedStyle(document.getElementById('rotate')).display,
  tileW: LAY.HAND_W * window.__renderer.scale,
  logicalW: LAY.W, scale: window.__renderer.scale,
}))
check('橫向時提示消失', landscape.hint === 'none', landscape.hint)
// ★★ M5 的自適應把這一筆欠帳還掉了:邏輯畫布寬度隨視窗比例伸縮,多出來的寬度全給手牌。
//    (M0~M4 期間這裡只有 38~41px,低於 44 的觸控門檻。)
check('★★ 手機橫向:手牌實體寬 ≥ 44px(觸控門檻)', landscape.tileW >= 44,
  landscape.tileW.toFixed(1) + 'px(邏輯寬 ' + landscape.logicalW + ' × scale ' + landscape.scale.toFixed(3) + ')')
check('★ 寬螢幕不留黑邊(邏輯寬跟著視窗比例走)', landscape.logicalW > 960,
  landscape.logicalW + ' (視窗 932×430)')

check('全程沒有 console 錯誤', errs.length === 0, errs.slice(0, 2).join(' | '))

// ★ 每一輪的牌是隨機種子發的 ⇒ 印出來,將來紅了才重現得出當時那副牌
const seedNow = await page.evaluate(() => String(window.__game.G.seed))
await browser.close()
if (local) local.srv.close()
const pass = results.filter((r) => r.ok).length
for (const r of results) console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.detail && !r.ok ? '  → ' + r.detail : ''))
console.log('\n' + (pass === results.length ? '🟢' : '🔴') + ' ' + pass + '/' + results.length + ' 通過' +
  (live ? '(線上 ' + live + ')' : '') + '　種子 ' + seedNow)
process.exit(pass === results.length ? 0 : 1)
