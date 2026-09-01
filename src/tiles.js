// 牌 —— 144 張台灣麻將牌組、種子洗牌、砌牌牆、牌面快取、★唯一佈局函數 tilePos。
// ★ 頂層只定義不執行(smoke 在 node 載得動):document 只在 face()/back() 被呼叫時才碰。

// ══ 一、牌種(42 種) ══
// m 萬 / p 筒 / s 條 / z 字(1東 2南 3西 4北 5中 6發 7白) / f 花(1春2夏3秋4冬 5梅6蘭7竹8菊)
// 張數:m/p/s/z 各 4 張、f 各 1 張 ⇒ 36+36+36+28+8 = 144
const SUIT_CH = { m: '萬', p: '筒', s: '條', z: '字', f: '花' }
const NUM_CH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const HONOR_CH = ['', '東', '南', '西', '北', '中', '發', '白']
const FLOWER_CH = ['', '春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊']
const SUIT_ORDER = { m: 0, p: 1, s: 2, z: 3, f: 4 }
const WIND_CH = ['東', '南', '西', '北']
const SEAT_NAME = ['你', '下家', '對家', '上家']   // 螢幕座位 0=下 1=右 2=上 3=左

const KINDS = (() => {
  const ks = []
  for (const s of ['m', 'p', 's']) for (let r = 1; r <= 9; r++) ks.push(s + r)
  for (let r = 1; r <= 7; r++) ks.push('z' + r)
  for (let r = 1; r <= 8; r++) ks.push('f' + r)
  return ks
})()

const isFlower = (t) => t.s === 'f'
const isHonor = (t) => t.s === 'z'
const isNumber = (t) => t.s === 'm' || t.s === 'p' || t.s === 's'
const isTerminal = (t) => isNumber(t) && (t.r === 1 || t.r === 9)   // 么九
const isYaoJiu = (t) => isHonor(t) || isTerminal(t)

function tileName(t) {
  if (t.s === 'z') return HONOR_CH[t.r]
  if (t.s === 'f') return FLOWER_CH[t.r]
  return NUM_CH[t.r] + SUIT_CH[t.s]
}

// 排序:萬 → 筒 → 條 → 字 → 花,同門依數字;同牌再依 id(穩定,方便重現)
function tileCmp(a, b) { return (SUIT_ORDER[a.s] - SUIT_ORDER[b.s]) || (a.r - b.r) || (a.id - b.id) }
function sortHand(h) { h.sort(tileCmp); return h }

// 144 張實體牌。★ 每張有唯一 id ⇒ 守恆保險絲才驗得出「複製」與「消失」
function makeTiles() {
  const out = []
  let id = 0
  for (const k of KINDS) {
    const n = k[0] === 'f' ? 1 : 4
    for (let c = 0; c < n; c++) out.push({ id: id++, k, s: k[0], r: +k.slice(1) })
  }
  return out
}

// ══ 二、種子亂數(沿紙牌桌;沒有種子,麻將 bug 完全無法重現)══
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  return arr
}

// ══ 三、砌牌牆 + 擲骰開門 ══
// 四面牆各 18 墩 × 2 張 = 144。擲兩顆骰子:從莊家起算第(點數)家為開門家,
// 在那面牆上跳過(點數)墩,之後開始摸 —— 攤平成一維 wall:
//   wall[0]  = 第一張摸的牌
//   wall[末] = 尾牌(槓、補花都摸這頭);摸到空 = 流局(台灣麻將不留王牌)
function buildWall(seed, dealer) {
  const rnd = mulberry32(fnv1a(String(seed)))
  const tiles = shuffle(makeTiles(), rnd)
  const d1 = 1 + ((rnd() * 6) | 0), d2 = 1 + ((rnd() * 6) | 0)
  const total = d1 + d2                                   // 2..12
  const openSeat = (dealer + (total - 1)) % 4             // 1 = 莊家自己
  const start = (openSeat * 36 + (total % 18) * 2) % 144  // 斷口
  const wall = []
  for (let i = 0; i < 144; i++) wall.push(tiles[(start + i) % 144])
  return { wall, dice: [d1, d2], openSeat }
}

// ══ 四、★★ 守恆保險絲 ══
// 牌牆 + 四家手牌 + 剛摸的牌 + 副露 + 牌河 + 花牌區 ≡ 144,且 id 零重複。
// 麻將 bug 九成是「牌憑空多/少」,而且是**靜默的**(不當機、不報錯,牌就是少一張)。
// ★ 每次 apply 之後都要驗這一條 —— 現場抓到,不必事後考古。
function conserve(G) {
  const seen = new Set()
  const dup = []
  const eat = (t, where) => {
    if (!t) return
    if (seen.has(t.id)) dup.push(t.id + '@' + where)
    seen.add(t.id)
  }
  for (const t of G.wall) eat(t, 'wall')
  for (let s = 0; s < 4; s++) {
    for (const t of G.hands[s]) eat(t, 'hand' + s)
    eat(G.drawn[s], 'drawn' + s)
    for (const m of G.melds[s]) for (const t of m.tiles) eat(t, 'meld' + s)
    for (const t of G.river[s]) eat(t, 'river' + s)
    for (const t of G.flowers[s]) eat(t, 'flower' + s)
  }
  const ok = seen.size === 144 && dup.length === 0
  const err = ok ? '' : ('張數 ' + seen.size + '/144' + (dup.length ? ' 重複 ' + dup.join(',') : ''))
  return { ok, n: seen.size, dup, err }
}

// ══ 五、★★ 唯一佈局函數 tilePos ══
// 判定=畫面:每一張牌「畫在哪」與「點到哪一張」都走這同一個函數,
// renderer 與 input 不可以各自算一套(彈珠檯 / 紙牌桌的老教訓)。
//   螢幕座位 seat:0=下(自己) 1=右(下家) 2=上(對家) 3=左(上家) —— 0→1→2→3 就是逆時針打牌順序
//   area:'hand' 手牌 | 'drawn' 剛摸的那張 | 'meld' 副露 | 'river' 牌河 | 'flower' 花牌區
// ══ 五、★★ 版面 ══
// M5 起版面寬度是**算出來的**,不是寫死的:
//   邏輯高度固定 540、寬度隨視窗比例伸縮(960~1280)⇒ 寬螢幕不留黑邊,
//   多出來的寬度**全部給手牌**。這是「手機橫向手牌只有 41 實體 px」的唯一解法
//   (縮放由高度決定,想把牌變大就只能把邏輯畫布變寬)。
// ★ 所有左右方向的座標一律從 W 推出來。要動任何一個數字,先跑 smoke 的
//   「最擠的牌桌:N 塊區域兩兩不重疊」—— 那條會在好幾個寬度下各驗一次。
const LAY_W_MIN = 960, LAY_W_MAX = 1280

function layoutFor(W) {
  const T = CONFIG.TILE
  const B = T.BACK, M = T.MELD, F = T.FLOW, R = T.RIVER, H = CONFIG.LOGICAL_H
  // 手牌:17 個位置(16 張 + 剛摸的)要排進 W,兩邊各留一點邊
  const handW = Math.max(44, Math.min(68, Math.floor((W - 76) / 17)))
  // 左右家:貼著邊的三直條(手牌 → 副露 → 花牌),不隨寬度變
  const lHand = 8, lMeld = lHand + B.H + 4, lFlow = lMeld + M.H + 4
  const rHand = W - 8 - B.H, rMeld = rHand - 4 - M.H, rFlow = rMeld - 4 - F.H
  const flowX = lFlow + F.H + 6                       // 下/上家花牌的左端
  const meldRight = rFlow - 12                        // 下/上家副露的右端(避開右家那三直條)
  const flowEnd = flowX + 8 * (F.W + F.GAP) - F.GAP   // 八張花全出的右緣
  const meldAvail = meldRight - flowEnd - 8           // 下/上家:橫向可用長度,太長就壓縮間距
  // ★ 左右家的副露是**縱向**排的,吃的是畫布高度,不可以跟著橫向的可用寬度一起長 ——
  //   0902 實錄:忘了分開,畫布一變寬左右家的副露就排到畫布外(而且會壓到自家手牌)。
  const sideMeldAvail = Math.min(meldAvail, 430)      // y 8..438,自家手牌在 466
  // 牌河:上下扁(12 欄 × 2 列)、左右瘦(3 欄 × 8 列)
  const udW = 12 * (R.W + R.GAP) - R.GAP
  const lrW = 3 * (R.H + R.GAP) - R.GAP
  const lrH = 8 * (R.W + R.GAP) - R.GAP
  const udX = (W - udW) / 2, lrX = 176, lrY = (H - lrH) / 2
  // 中央資訊框 + 四個座位牌(貼著框的四邊,各在自己那一側)
  const cW = 228, cX = (W - cW) / 2
  const gapL = (lrX + lrW + cX) / 2                   // 左牌河右緣 與 中央框左緣 的中點
  const gapR = (cX + cW + (W - lrX - lrW)) / 2
  return {
    W, HAND_W: handW,
    HAND_Y: 466, MELD_Y: 416, TOP_Y: 8, TOP_MELD_Y: 46,
    MELD_RIGHT: meldRight, FLOW_X: flowX, MELD_AVAIL: meldAvail, SIDE_MELD_AVAIL: sideMeldAvail,
    SIDE_X: lHand, SIDE_TOP: 8, SIDE_MID: 230,
    L_MELD: lMeld, L_FLOW: lFlow, R_HAND: rHand, R_MELD: rMeld, R_FLOW: rFlow,
    // 四家牌河。★ 依座位旋轉:每家打出去的牌都朝著自己。
    //   rot ±90 的那兩家,格子的寬高要互換(26×34 → 34×26)—— tilePos 一處算好。
    RIVER: [
      { x: udX, y: 338, cols: 12, cap: 24, rot: 0 },          // 下(自己)
      { x: W - lrX - lrW, y: lrY, cols: 3, cap: 24, rot: -90 }, // 右
      { x: udX, y: 96, cols: 12, cap: 24, rot: 180 },          // 上
      { x: lrX, y: lrY, cols: 3, cap: 24, rot: 90 },           // 左
    ],
    CENTER: { x: cX, y: 214, w: cW, h: 76 },     // 中央資訊框(圈局/剩餘/骰子/總分)
    // 座位牌:貼著中央框的四邊 —— 「西 對家」就一定在上面,不會讀錯
    TAG: { h: 24, at: [[W / 2, 314, 100], [gapR, 252, 72], [W / 2, 190, 100], [gapL, 252, 72]] },
    // 左上角兩顆鈕(音效/一炮多響/強度/局數都收進 ⚙ 面板 —— 上家手牌從 x≈290 開始,擠不下)
    BTN: { new: { x: 136, y: 8, w: 76, h: 28 }, gear: { x: 216, y: 8, w: 52, h: 28 } },
    // 吃/碰/槓/胡/過 的按鈕列:蓋在副露列上方
    ACT: { y: 406, h: 48, gap: 8, minW: 88 },
  }
}

// ★ let 不是 const:renderer.resize() 會依視窗比例重算,所有讀 LAY 的地方自動吃到新值。
let LAY = layoutFor(CONFIG.LOGICAL_W)
function setLayoutWidth(W) {
  const w = Math.max(LAY_W_MIN, Math.min(LAY_W_MAX, Math.round(W)))
  if (w !== LAY.W) LAY = layoutFor(w)
  return LAY
}

// 吃/碰/槓/胡/過 那一列的框。★ 一份算式:renderer 照它畫、smoke 照它驗
//   (不出畫布、不壓到自家手牌)。按鈕寬度隨字數長,「吃 四萬五萬」比「胡」寬。
function actBarLayout(labels) {
  const A = LAY.ACT
  const ws = labels.map((l) => Math.max(A.minW, 26 + l.length * 17))
  const total = ws.reduce((n, w) => n + w, 0) + Math.max(0, labels.length - 1) * A.gap
  let x = (LAY.W - total) / 2
  const btns = []
  for (const w of ws) { btns.push({ x, y: A.y, w, h: A.h }); x += w + A.gap }
  return { bar: { x: (LAY.W - total) / 2 - 12, y: A.y - 8, w: total + 24, h: A.h + 16 }, btns }
}

// 座位牌的框(renderer 畫、smoke 驗不重疊,同一份)
function tagRect(seat) {
  const p = LAY.TAG.at[seat], w = p[2], h = LAY.TAG.h
  return { x: p[0] - w / 2, y: p[1] - h / 2, w, h }
}

// 某家副露一共幾張牌(含槓的第 4 張)
function meldTileCount(G, seat) {
  let n = 0
  for (const m of G.melds[seat]) n += m.tiles.length
  return n
}

// 副露的第 i 張落在第幾組之後(用來加組與組之間的間距)
function meldSets(G, seat, i) {
  let n = 0, sets = 0
  for (const m of G.melds[seat]) {
    if (i < n + m.tiles.length) return sets
    n += m.tiles.length; sets++
  }
  return sets
}

function tilePos(G, area, seat, i) {
  const T = CONFIG.TILE
  const W = LAY.W, H = CONFIG.LOGICAL_H

  // ── 副露:四家共用一套算式,只有擺放的軸與起點不同 ──
  if (area === 'meld') {
    const M = T.MELD, B = T.BACK, pitch = M.W + M.GAP
    const total = meldTileCount(G, seat)
    const nSets = G.melds[seat].length
    const need = total * pitch - M.GAP + Math.max(0, nSets - 1) * M.SET_GAP
    // ★ 壓縮只發生在這一處(renderer 與 input 都吃它)。
    //   縮的是「間距」不是牌 ⇒ 分母要扣掉最後一張牌本身的寬,否則末端會凸出 MELD_RIGHT。
    // ★ 下/上家橫著排(吃寬度)、左右家豎著排(吃高度)—— 兩個預算不一樣,不可以共用。
    const avail = seat === 0 || seat === 2 ? LAY.MELD_AVAIL : LAY.SIDE_MELD_AVAIL
    const k = need > avail ? (avail - M.W) / (need - M.W) : 1
    const off = (i * pitch + meldSets(G, seat, i) * M.SET_GAP) * k
    const span = Math.min(need, avail)
    if (seat === 0) return { x: LAY.MELD_RIGHT - span + off, y: LAY.MELD_Y, w: M.W, h: M.H }
    if (seat === 2) return { x: LAY.MELD_RIGHT - span + off, y: LAY.TOP_MELD_Y, w: M.W, h: M.H }
    const x = seat === 1 ? LAY.R_MELD : LAY.L_MELD
    return { x, y: LAY.SIDE_TOP + off, w: M.H, h: M.W }   // 左右家:牌橫放,w/h 互換
  }

  // ── 牌河 ──
  if (area === 'river') {
    const R = T.RIVER, o = LAY.RIVER[seat]
    const vert = o.rot === 90 || o.rot === -90        // 橫放:寬高互換
    const w = vert ? R.H : R.W, h = vert ? R.W : R.H
    return { x: o.x + (i % o.cols) * (w + R.GAP), y: o.y + ((i / o.cols) | 0) * (h + R.GAP), w, h }
  }

  // ── 花牌區:排在各家「手牌 → 副露 → 花牌」的第三條 ──
  if (area === 'flower') {
    const F = T.FLOW, M = T.MELD, B = T.BACK, pitch = F.W + F.GAP
    if (seat === 0) return { x: LAY.FLOW_X + i * pitch, y: LAY.MELD_Y + 4, w: F.W, h: F.H }
    if (seat === 2) return { x: LAY.FLOW_X + i * pitch, y: LAY.TOP_MELD_Y, w: F.W, h: F.H }
    const x = seat === 1 ? LAY.R_FLOW : LAY.L_FLOW
    return { x, y: LAY.SIDE_TOP + i * pitch, w: F.H, h: F.W }
  }

  // ── 手牌 / 剛摸的那張 ──
  const n = G.hands[seat].length
  const has = G.drawn[seat] != null
  if (seat === 0) {
    const A = T.HAND, aw = LAY.HAND_W, pitch = aw + A.GAP    // ★ 寬度隨畫布伸縮,不是寫死的
    const span = n * pitch - A.GAP + (has ? A.DRAW_GAP + aw : 0)
    const x0 = (W - span) / 2
    const x = area === 'drawn' ? x0 + n * pitch - A.GAP + A.DRAW_GAP : x0 + i * pitch
    return { x, y: LAY.HAND_Y, w: aw, h: A.H }
  }
  const B = T.BACK, pitch = B.W + B.GAP
  const span = n * pitch - B.GAP + (has ? 10 + B.W : 0)
  if (seat === 2) {
    const x0 = (W - span) / 2
    const x = area === 'drawn' ? x0 + n * pitch - B.GAP + 10 : x0 + i * pitch
    return { x, y: LAY.TOP_Y, w: B.W, h: B.H }
  }
  const y0 = LAY.SIDE_MID - span / 2
  const y = area === 'drawn' ? y0 + n * pitch - B.GAP + 10 : y0 + i * pitch
  const x = seat === 1 ? LAY.R_HAND : LAY.SIDE_X
  return { x, y, w: B.H, h: B.W }
}

// 點到自家的哪一張手牌?★ 與畫牌走同一個 tilePos(判定=畫面)
// 回傳 { i, tile };i = -1 表示點到剛摸的那張;都沒點到回 null
function handHit(G, px, py) {
  const inside = (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
  if (G.drawn[0] && inside(tilePos(G, 'drawn', 0, 0))) return { i: -1, tile: G.drawn[0] }
  for (let i = G.hands[0].length - 1; i >= 0; i--) {
    if (inside(tilePos(G, 'hand', 0, i))) return { i, tile: G.hands[0][i] }
  }
  return null
}

// ══ 六、牌面(零美術檔:42 種牌面全程式畫)══
// ★ 效能鐵則:開機時 42 種各畫一次進 offscreen canvas,之後每幀只 drawImage。
//   不要每幀重畫 144 張的筒圈與竹節(roadmap §6 地雷)。
// ★ document 只在這裡碰 —— 頂層不執行,node 載得動。
const FONT = '"Microsoft JhengHei","PingFang TC","Heiti TC","Noto Sans CJK TC",sans-serif'
const INK = '#1b2430', RED = '#b3261e', GREEN = '#12703a', BLUE = '#1f4e9c'

function rrPath(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

// 筒子的圈:外環 → 白心 → 中點
function pinDot(c, cx, cy, r, i) {
  const cols = [BLUE, RED, GREEN]
  const col = cols[i % 3]
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = col; c.fill()
  c.beginPath(); c.arc(cx, cy, r * 0.6, 0, 7); c.fillStyle = '#f8f4e6'; c.fill()
  c.beginPath(); c.arc(cx, cy, r * 0.26, 0, 7); c.fillStyle = col; c.fill()
}
const PIN = {
  1: [[50, 68, 30]],
  2: [[50, 42, 17], [50, 94, 17]],
  3: [[27, 38, 16], [50, 68, 16], [73, 98, 16]],
  4: [[32, 44, 17], [68, 44, 17], [32, 92, 17], [68, 92, 17]],
  5: [[30, 42, 15], [70, 42, 15], [50, 68, 15], [30, 94, 15], [70, 94, 15]],
  6: [[32, 36, 14], [68, 36, 14], [32, 68, 14], [68, 68, 14], [32, 100, 14], [68, 100, 14]],
  7: [[27, 32, 13], [50, 32, 13], [73, 32, 13], [32, 74, 13], [68, 74, 13], [32, 106, 13], [68, 106, 13]],
  8: [[33, 30, 12], [67, 30, 12], [33, 56, 12], [67, 56, 12], [33, 82, 12], [67, 82, 12], [33, 108, 12], [67, 108, 12]],
  9: [[27, 36, 13], [50, 36, 13], [73, 36, 13], [27, 68, 13], [50, 68, 13], [73, 68, 13], [27, 100, 13], [50, 100, 13], [73, 100, 13]],
}

// 條子的竹節棍
function souStick(c, cx, cy, w, h, col) {
  const x0 = cx - w / 2, y0 = cy - h / 2
  rrPath(c, x0, y0, w, h, w * 0.45); c.fillStyle = col; c.fill()
  c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = Math.max(1.2, w * 0.17)
  c.beginPath()
  c.moveTo(x0 + 1, y0 + h * 0.33); c.lineTo(x0 + w - 1, y0 + h * 0.33)
  c.moveTo(x0 + 1, y0 + h * 0.67); c.lineTo(x0 + w - 1, y0 + h * 0.67)
  c.stroke()
}
const SOU = {
  2: [[50, 42], [50, 94]],
  3: [[50, 34], [34, 92], [66, 92]],
  4: [[33, 42], [67, 42], [33, 94], [67, 94]],
  5: [[31, 40], [69, 40], [50, 68], [31, 96], [69, 96]],
  6: [[27, 42], [50, 42], [73, 42], [27, 94], [50, 94], [73, 94]],
  7: [[50, 28], [27, 68], [50, 68], [73, 68], [27, 104], [50, 104], [73, 104]],
  8: [[24, 44], [41, 44], [59, 44], [76, 44], [24, 92], [41, 92], [59, 92], [76, 92]],
  9: [[27, 34], [50, 34], [73, 34], [27, 68], [50, 68], [73, 68], [27, 102], [50, 102], [73, 102]],
}
// 紅棍的位置(傳統:5 條中央紅、7 條頂上紅)
const SOU_RED = { 5: [2], 7: [0] }

// 1 條是一隻鳥(孔雀),不是竹節
function souBird(c) {
  c.fillStyle = GREEN
  c.beginPath(); c.ellipse(50, 82, 17, 23, 0, 0, 7); c.fill()          // 身
  c.beginPath(); c.arc(50, 47, 12, 0, 7); c.fill()                      // 頭
  c.fillStyle = RED                                                     // 冠
  c.beginPath(); c.moveTo(50, 33); c.lineTo(45, 24); c.lineTo(55, 27); c.closePath(); c.fill()
  c.fillStyle = '#e0921a'                                               // 喙
  c.beginPath(); c.moveTo(61, 48); c.lineTo(76, 53); c.lineTo(61, 56); c.closePath(); c.fill()
  c.fillStyle = '#fff'; c.beginPath(); c.arc(54, 44, 3.4, 0, 7); c.fill()
  c.fillStyle = INK; c.beginPath(); c.arc(55, 44, 1.7, 0, 7); c.fill()  // 眼
  c.strokeStyle = RED; c.lineWidth = 3.4; c.lineCap = 'round'           // 尾羽
  for (const dx of [-13, 0, 13]) {
    c.beginPath(); c.moveTo(50, 102); c.lineTo(50 + dx, 122); c.stroke()
  }
}

function drawFace(c, kind) {
  const B = CONFIG.BASE, W = B.W, H = B.H
  const s = kind[0], r = +kind.slice(1)
  // 牌身:象牙白 + 立體邊 + 內凹刻字區
  const g = c.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#fffdf3'); g.addColorStop(0.55, '#f6f1de'); g.addColorStop(1, '#e5dcc0')
  rrPath(c, 1.5, 1.5, W - 3, H - 3, 9); c.fillStyle = g; c.fill()
  c.strokeStyle = '#b6a97f'; c.lineWidth = 2; c.stroke()
  rrPath(c, 7, 7, W - 14, H - 14, 6); c.strokeStyle = 'rgba(90,70,30,.13)'; c.lineWidth = 1; c.stroke()
  c.textAlign = 'center'; c.textBaseline = 'middle'

  if (s === 'm') {                                   // 萬:上漢數字、下紅「萬」
    c.fillStyle = INK; c.font = 'bold 46px ' + FONT
    c.fillText(NUM_CH[r], 50, 46)
    c.fillStyle = RED; c.font = 'bold 42px ' + FONT
    c.fillText('萬', 50, 98)
  } else if (s === 'p') {                            // 筒
    PIN[r].forEach(([cx, cy, rr], i) => pinDot(c, cx, cy, rr, r === 1 ? 0 : i))
    if (r === 1) { c.beginPath(); c.arc(50, 68, 21, 0, 7); c.strokeStyle = RED; c.lineWidth = 3; c.stroke() }
  } else if (s === 's') {                            // 條
    if (r === 1) souBird(c)
    else {
      const dense = r >= 8
      const w = dense ? 10 : 12, h = dense ? 30 : 34
      const reds = SOU_RED[r] || []
      SOU[r].forEach(([cx, cy], i) => souStick(c, cx, cy, w, h, reds.includes(i) ? RED : GREEN))
    }
  } else if (s === 'z') {                            // 字
    if (r === 7) {                                   // 白板:傳統的空框
      rrPath(c, 22, 26, 56, 84, 5); c.strokeStyle = BLUE; c.lineWidth = 5; c.stroke()
    } else {
      c.fillStyle = r === 5 ? RED : r === 6 ? GREEN : '#1b2a4a'
      c.font = 'bold 60px ' + FONT
      c.fillText(HONOR_CH[r], 50, 66)
    }
  } else {                                           // 花:春夏秋冬(藍)/ 梅蘭竹菊(綠)
    const col = r <= 4 ? BLUE : GREEN
    c.fillStyle = col; c.font = 'bold 52px ' + FONT
    c.fillText(FLOWER_CH[r], 50, 60)
    c.fillStyle = RED; c.font = 'bold 22px ' + FONT
    c.fillText(String(((r - 1) % 4) + 1), 50, 104)
    c.strokeStyle = col; c.lineWidth = 2
    c.beginPath(); c.moveTo(30, 82); c.lineTo(70, 82); c.stroke()
  }
}

function drawBack(c) {
  const B = CONFIG.BASE, W = B.W, H = B.H
  const g = c.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#2f9e63'); g.addColorStop(1, '#14713f')
  rrPath(c, 1.5, 1.5, W - 3, H - 3, 9); c.fillStyle = g; c.fill()
  c.strokeStyle = '#0c5730'; c.lineWidth = 2; c.stroke()
  rrPath(c, 10, 10, W - 20, H - 20, 6)
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 2; c.stroke()
  c.save(); c.translate(W / 2, H / 2); c.rotate(Math.PI / 4)
  c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(-17, -17, 34, 34)
  c.restore()
}

const _faceCache = new Map()
function face(kind) {
  let cv = _faceCache.get(kind)
  if (cv) return cv
  const B = CONFIG.BASE
  cv = document.createElement('canvas')
  cv.width = B.W; cv.height = B.H
  drawFace(cv.getContext('2d'), kind)
  _faceCache.set(kind, cv)
  return cv
}
function back() {
  let cv = _faceCache.get('#back')
  if (cv) return cv
  const B = CONFIG.BASE
  cv = document.createElement('canvas')
  cv.width = B.W; cv.height = B.H
  drawBack(cv.getContext('2d'))
  _faceCache.set('#back', cv)
  return cv
}
// 開機呼叫一次:42 種牌面 + 背面全部烤好
function warmFaces() { for (const k of KINDS) face(k); back(); return _faceCache.size }
