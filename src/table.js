// 牌桌狀態與回合 —— M2:吃碰槓胡的「等待反應」仲裁狀態機。
//
// ★ 唯一 apply 入口:所有改動狀態的動作都走這裡。UI 手勢與 AI 走**同一份**。
// ★ phase 是明確的狀態,不可以用 if 串:
//     'play'    輪到 G.turn 摸牌 / 打牌
//     'react'   有人打了一張,正在收三家的反應(收齊才動)
//     'win'     有人胡了,顯示結算        'washout' 流局        'over' 整場打完
// ★ 優先權:胡 > 槓/碰 > 吃,而且**只有下家能吃**。多家同時胡 ⇒ 看 opts.multiRon:
//     true  一炮多響(預設):每一家都胡,放炮者各付一份
//     false 順位優先:只有從放炮者算起、逆時針最近的那一家胡
// ★ 結算:底 10 分 + 每台 5 分。自摸三家各付一份;放炮由放炮者一家付。

const nextSeat = (s) => (s + 1) % 4
const seatWind = (G, seat) => (seat - G.dealer + 4) % 4     // 0東 1南 2西 3北
const wallLeft = (G) => G.wall.length
const SCORE = { base: 10, perTai: 5 }
const HAND_LIMITS = [1, 4, 16]                              // 單局 / 一圈 / 全將

// ── 設定(localStorage,全包 try/catch;私密模式不炸)──
const DEFAULT_OPTS = { multiRon: true, hands: 4, level: 1 }   // level 0新手 1普通 2老手
function loadOpts() {
  try {
    const raw = JSON.parse(localStorage.getItem('mj-opts') || '{}')
    return {
      multiRon: raw.multiRon !== false,
      hands: HAND_LIMITS.includes(raw.hands) ? raw.hands : DEFAULT_OPTS.hands,
      level: [0, 1, 2].includes(raw.level) ? raw.level : DEFAULT_OPTS.level,
    }
  } catch { return Object.assign({}, DEFAULT_OPTS) }
}
function saveOpts(o) { try { localStorage.setItem('mj-opts', JSON.stringify(o)) } catch { } }

// ── 手牌與副露的查詢(規則層要的都從這兩支拿)──
function handCounts(G, seat) {
  const t = G.hands[seat].slice()
  if (G.drawn[seat]) t.push(G.drawn[seat])
  return toCounts(t)
}
const needOf = (G, seat) => 5 - G.melds[seat].length

// 摸牌。fromTail=true 是槓/補花那一摸 —— 台灣麻將一律摸**尾牌**。
// 摸到花就進花區、改摸尾牌再來一次:補花與摸牌是同一條路,不另寫一份。
function drawTile(G, seat, fromTail) {
  for (;;) {
    if (!G.wall.length) { G.phase = 'washout'; finishWashout(G); return null }
    const t = fromTail ? G.wall.pop() : G.wall.shift()
    if (isFlower(t)) { G.flowers[seat].push(t); fromTail = true; continue }
    G.drawn[seat] = t
    G.isLastDraw = G.wall.length === 0      // 海底:摸到最後一張
    return t
  }
}

// 開局補花:從莊家起、逆時針,把花翻出來補尾牌,補到全桌無花為止。
function dealFlowers(G) {
  let again = true, guard = 0
  while (again && guard++ < 80) {
    again = false
    for (let k = 0; k < 4; k++) {
      const seat = (G.dealer + k) % 4
      for (;;) {
        const i = G.hands[seat].findIndex(isFlower)
        if (i < 0) break
        G.flowers[seat].push(G.hands[seat].splice(i, 1)[0])
        if (!G.wall.length) break
        G.hands[seat].push(G.wall.pop())        // ★ 補花摸尾牌
        again = true
      }
    }
  }
}

// 純粹「把一張牌放進牌河」。★ 不含任何仲裁 —— 那是 playDiscard 的事。
function discard(G, seat, i) {
  const d = G.drawn[seat]
  let t
  if (i < 0) { t = d; G.drawn[seat] = null }
  else {
    t = G.hands[seat].splice(i, 1)[0]
    if (d) { G.hands[seat].push(d); G.drawn[seat] = null; sortHand(G.hands[seat]) }
  }
  G.river[seat].push(t)
  G.last = { seat, tile: t }
  G.discards++
  return t
}

// 打牌 → 開反應。★ 玩家與 AI 都走這一支。
function playDiscard(G, seat, i) {
  const wasLastDraw = G.isLastDraw
  G.mustDiscard = false
  const t = discard(G, seat, i)
  G.kanBloom = false
  G.isLastDraw = false
  beginReact(G, t, seat, false, wasLastDraw)
  return t
}
function playerDiscard(G, i) {
  if (G.turn !== 0 || G.phase !== 'play') return false
  playDiscard(G, 0, i)
  return true
}

// ══ 等待反應的仲裁狀態機 ══
// ★ 這是麻將最容易寫錯的地方:一張牌打出去,可能有好幾家想要。
//   一定要「先收齊所有人的宣告,再一次仲裁」,不可以邊問邊執行。

// 某家對「別人打出的 tileIdx」有哪些選擇。robKan=true 是加槓被搶,只能胡。
function reactOptions(G, seat, tileIdx, from, robKan) {
  const out = []
  if (seat === from) return out
  const c = handCounts(G, seat), need = needOf(G, seat)
  if (canWinWith(c, need, tileIdx)) out.push({ type: 'hu' })
  if (robKan) return out                       // 搶槓只能胡,不能碰吃
  if (canMinkan(c, tileIdx)) out.push({ type: 'kan', i: tileIdx })
  if (canPon(c, tileIdx)) out.push({ type: 'pon', i: tileIdx })
  if (seat === nextSeat(from)) {               // ★ 只有下家能吃
    for (const pair of chiOptions(c, tileIdx)) out.push({ type: 'chi', i: tileIdx, use: pair })
  }
  return out
}

// 開一輪反應。沒有人有選擇 ⇒ 直接換下一家(或完成加槓)。
function beginReact(G, tile, from, robKan, wasLastDraw) {
  const idx = kidx(tile)
  const opts = [0, 1, 2, 3].map((s) => reactOptions(G, s, idx, from, robKan))
  G.react = {
    tile, tileIdx: idx, from, robKan: !!robKan, lastTile: !!wasLastDraw,
    opts, claim: [null, null, null, null],
  }
  for (let s = 0; s < 4; s++) if (!opts[s].length) G.react.claim[s] = { type: 'pass' }
  if (opts.every((o) => !o.length)) { G.react = null; afterNoClaim(G, from, robKan); return false }
  G.phase = 'react'
  return true
}

// 沒人要 ⇒ 加槓真的成立;否則換下一家摸牌。
function afterNoClaim(G, from, robKan) {
  if (robKan) { completeAddkan(G); return }
  G.phase = 'play'
  G.turn = nextSeat(from)
}

// 某家宣告。choice = { type:'pass'|'hu'|'pon'|'kan'|'chi', ... }
// ★ 只接受 opts 裡真的有的選項 —— UI 傳什麼進來都不能繞過規則。
function declare(G, seat, choice) {
  const R = G.react
  if (!R || R.claim[seat]) return false
  if (choice.type !== 'pass') {
    const ok = R.opts[seat].some((o) => o.type === choice.type &&
      (choice.type !== 'chi' || (o.use[0] === choice.use[0] && o.use[1] === choice.use[1])))
    if (!ok) return false
  }
  R.claim[seat] = choice
  if (R.claim.every(Boolean)) resolveReact(G)
  return true
}

// ★★ 仲裁:胡 > 槓/碰 > 吃。收齊之後才跑這一支。
function resolveReact(G) {
  const R = G.react
  const claimed = (type) => [0, 1, 2, 3].filter((s) => R.claim[s] && R.claim[s].type === type)
  // 從放炮者算起、逆時針的順位(用來決定「順位優先」與一炮多響的付款順序)
  const order = [1, 2, 3].map((k) => (R.from + k) % 4)

  const hus = order.filter((s) => R.claim[s].type === 'hu')
  if (hus.length) {
    const winners = G.opts.multiRon ? hus : [hus[0]]
    G.react = null
    // ★★ 搶槓:那張加槓的牌本來被 pendingKan 抱著,不在任何一個「牌的容器」裡。
    //   胡成了就要把它放進加槓者的牌河(它等同一張放出來的槍)—— 不然守恆會少一張。
    //   0901 實錄:第一版忘了這件事,搶槓成功後 143/144,靠守恆保險絲當場抓到。
    const p = R.robKan ? G.pendingKan : null
    if (p) { G.river[p.seat].push(p.tile); G.discards++ }
    if (doWin(G, winners, R.from, R.tile, { robKan: R.robKan, lastTile: R.lastTile })) {
      if (p) G.pendingKan = null
      return
    }
    if (p) { G.river[p.seat].pop(); G.discards--; completeAddkan(G); return }  // 沒胡成 ⇒ 槓照樣成立
  }
  if (R.robKan) { G.react = null; completeAddkan(G); return }   // 有人宣告但沒人胡 ⇒ 加槓成立

  const kans = claimed('kan'), pons = claimed('pon'), chis = claimed('chi')
  G.react = null
  if (kans.length) { doMinkan(G, kans[0], R.tile, R.from); return }
  if (pons.length) { doPon(G, pons[0], R.tile, R.from); return }
  if (chis.length) { doChi(G, chis[0], R.tile, R.from, R.claim[chis[0]].use); return }
  afterNoClaim(G, R.from, false)
}

// 把牌河最後一張(被吃碰槓走的那張)收回來
function takeFromRiver(G, from) { return G.river[from].pop() }

// ══ 執行吃碰槓 ══
// ★ 副露同時帶 tiles(給守恆與畫面)與 kind/i(給規則層):兩邊都只有這一份。
function takeFromHand(G, seat, idx, n) {
  const out = []
  for (let k = G.hands[seat].length - 1; k >= 0 && out.length < n; k--)
    if (kidx(G.hands[seat][k]) === idx) out.push(G.hands[seat].splice(k, 1)[0])
  if (out.length < n && G.drawn[seat] && kidx(G.drawn[seat]) === idx) {
    out.push(G.drawn[seat]); G.drawn[seat] = null
  }
  return out
}
// ★★ 槓之前一定要先把「剛摸的那張」併回手牌。
//   槓完會 drawTile 補一張,那一行直接覆蓋 G.drawn —— 沒先併回去,原本摸的那張就憑空消失。
//   0901 實錄:暗槓測試 143/144,守恆保險絲當場抓到。
function mergeDrawn(G, seat) {
  if (!G.drawn[seat]) return
  G.hands[seat].push(G.drawn[seat])
  G.drawn[seat] = null
  sortHand(G.hands[seat])
}

function afterClaim(G, seat) {
  G.anyMeld = true
  G.turn = seat
  G.phase = 'play'
  G.mustDiscard = true          // ★ 吃/碰之後直接打牌,不再摸一張
  sortHand(G.hands[seat])
}

function doPon(G, seat, tile, from) {
  const idx = kidx(tile)
  const tiles = takeFromHand(G, seat, idx, 2).concat([takeFromRiver(G, from)])
  G.melds[seat].push({ kind: 'pon', i: idx, from, tiles })
  afterClaim(G, seat)
}

function doChi(G, seat, tile, from, use) {
  const tiles = takeFromHand(G, seat, use[0], 1)
    .concat(takeFromHand(G, seat, use[1], 1), [takeFromRiver(G, from)])
  const base = Math.min(kidx(tile), use[0], use[1])
  G.melds[seat].push({ kind: 'chi', i: base, from, tiles })
  afterClaim(G, seat)
}

function doMinkan(G, seat, tile, from) {
  mergeDrawn(G, seat)
  const idx = kidx(tile)
  const tiles = takeFromHand(G, seat, idx, 3).concat([takeFromRiver(G, from)])
  G.melds[seat].push({ kind: 'minkan', i: idx, from, tiles })
  G.anyMeld = true; G.turn = seat; G.phase = 'play'; G.mustDiscard = false
  sortHand(G.hands[seat])
  G.kanBloom = true                       // 槓完摸尾牌,摸到就自摸 = 槓上開花
  drawTile(G, seat, true)
}

function doAnkan(G, seat, idx) {
  mergeDrawn(G, seat)
  const tiles = takeFromHand(G, seat, idx, 4)
  G.melds[seat].push({ kind: 'ankan', i: idx, from: seat, tiles })
  G.phase = 'play'; G.mustDiscard = false
  sortHand(G.hands[seat])
  G.kanBloom = true
  drawTile(G, seat, true)                 // ★ 暗槓不必問人(沒有搶槓)
}

// 加槓要先問別家要不要搶槓 —— 這是唯一「動作先掛起、等仲裁」的情況。
function doAddkan(G, seat, idx) {
  mergeDrawn(G, seat)
  const t = takeFromHand(G, seat, idx, 1)[0]
  if (!t) return false
  G.pendingKan = { seat, idx, tile: t }
  if (!beginReact(G, t, seat, true, false)) return true   // 沒人能搶 ⇒ beginReact 已經幫我們完成
  return true
}
function completeAddkan(G) {
  const p = G.pendingKan
  G.pendingKan = null
  if (!p) return
  const m = G.melds[p.seat].find((x) => x.kind === 'pon' && x.i === p.idx)
  if (m) { m.kind = 'addkan'; m.tiles.push(p.tile) }
  else G.melds[p.seat].push({ kind: 'minkan', i: p.idx, from: p.seat, tiles: [p.tile] })
  G.turn = p.seat; G.phase = 'play'; G.mustDiscard = false
  G.kanBloom = true
  drawTile(G, p.seat, true)
}

// 這一家現在(剛摸完牌)能做什麼:自摸 / 暗槓 / 加槓
function selfOptions(G, seat) {
  const out = []
  if (G.phase !== 'play' || G.turn !== seat || !G.drawn[seat]) return out
  const c = handCounts(G, seat), need = needOf(G, seat)
  if (isHu(c, need)) out.push({ type: 'tsumo' })
  for (const i of ankanOptions(c)) out.push({ type: 'ankan', i })
  for (const i of addkanOptions(c, G.melds[seat])) out.push({ type: 'addkan', i })
  return out
}
function applySelf(G, seat, choice) {
  if (!choice) return false
  if (choice.type === 'tsumo') return doSelfWin(G, seat)
  if (choice.type === 'ankan') { doAnkan(G, seat, choice.i); return true }
  if (choice.type === 'addkan') return doAddkan(G, seat, choice.i)
  return false
}

// ══ 胡牌與結算 ══
// 底 10 分 + 每台 5 分。自摸三家各付一份;放炮由放炮者一家付。
// 一炮多響時放炮者付給每一家各一份(所以放炮給兩家 = 付兩份)。
const payFor = (tai) => SCORE.base + tai * SCORE.perTai
// 📡 完賽 beacon:一局結束(胡 / 自摸 / 流局)= 一次 -done。打點函式住在 index.html;smoke 與 balance 在 node 跑、沒有 window ⇒ 直接跳過。
const psDoneSafe = () => { try { if (typeof window !== 'undefined' && window.psDone) window.psDone() } catch (e) { /* 統計是配菜 */ } }

function winCtx(G, seat, win, selfDraw, flags) {
  return {
    hand: G.hands[seat].slice(), win, melds: G.melds[seat],
    flowers: G.flowers[seat].length, selfDraw,
    seatWind: seatWind(G, seat), prevalent: G.prevalent,
    isDealer: seat === G.dealer, streak: G.streak,
    kanBloom: !!flags.kanBloom, lastTile: !!flags.lastTile, robKan: !!flags.robKan,
    heavenly: !!flags.heavenly, earthly: !!flags.earthly,
  }
}

// 榮和(有人放炮)。winners 已經照「從放炮者算起逆時針」排好。
function doWin(G, winners, from, tile, flags) {
  const list = []
  for (const s of winners) {
    const r = scoreHand(winCtx(G, s, tile, false, flags))
    if (!r.ok) continue
    // ★ 倒牌用:把胡牌那一刻的牌型留下來(結算畫面要攤開給人看「為什麼是胡」)
    list.push({ seat: s, tai: r.tai, items: r.items, score: payFor(r.tai),
      hand: G.hands[s].slice(), melds: G.melds[s].map((m) => m.tiles.slice()), win: tile })
  }
  if (!list.length) return false      // ★ 沒有副作用:要怎麼收尾由 resolveReact 決定
  for (const w of list) { G.scores[from] -= w.score; G.scores[w.seat] += w.score }
  finishHand(G, { winners: list, from, selfDraw: false, washout: false, tile })
  return true
}

function doSelfWin(G, seat) {
  const win = G.drawn[seat]
  if (!win) return false
  const r = scoreHand(winCtx(G, seat, win, true, {
    kanBloom: !!G.kanBloom, lastTile: !!G.isLastDraw,
    heavenly: seat === G.dealer && G.discards === 0,
    earthly: seat !== G.dealer && !G.anyMeld && G.river[seat].length === 0 && G.discards < 4,
  }))
  if (!r.ok) return false
  const w = { seat, tai: r.tai, items: r.items, score: payFor(r.tai),
    hand: G.hands[seat].slice(), melds: G.melds[seat].map((m) => m.tiles.slice()), win }
  for (let s = 0; s < 4; s++) if (s !== seat) { G.scores[s] -= w.score; G.scores[seat] += w.score }
  finishHand(G, { winners: [w], from: -1, selfDraw: true, washout: false, tile: win })
  return true
}

function finishHand(G, result) { G.result = result; G.phase = 'win'; G.react = null; psDoneSafe() }
function finishWashout(G) {
  psDoneSafe()
  G.result = { winners: [], from: -1, selfDraw: false, washout: true, tile: null }
  G.react = null
}

// 下一局:莊家胡或流局 ⇒ 連莊(莊不換、streak+1);閒家胡 ⇒ 換莊。
// ★ opts.hands 是「總共打幾局」,**連莊也算一局** —— 對不常打麻將的人最好懂,
//   也保證一定會結束(用「換莊次數」當上限的話,莊家一直連莊就永遠打不完)。
function nextHand(G) {
  const r = G.result || { winners: [], washout: true }
  const dealerKeeps = r.washout || r.winners.some((w) => w.seat === G.dealer)
  const dealer = dealerKeeps ? G.dealer : nextSeat(G.dealer)
  const streak = dealerKeeps ? G.streak + 1 : 0
  const hand = G.hand + 1
  if (hand > G.opts.hands) { G.phase = 'over'; addRun(G); return false }   // 🏆 一場打完記一筆
  dealHand(G, { dealer, streak, hand })
  return true
}

// ══ 開局 ══
function dealHand(G, o) {
  G.dealer = o.dealer; G.streak = o.streak; G.hand = o.hand
  G.prevalent = Math.floor((o.hand - 1) / 4) % 4      // 每 4 局換一個圈風
  G.hands = [[], [], [], []]; G.drawn = [null, null, null, null]
  G.melds = [[], [], [], []]; G.river = [[], [], [], []]; G.flowers = [[], [], [], []]
  G.result = null; G.react = null; G.last = null; G.msg = ''
  G.discards = 0; G.anyMeld = false; G.kanBloom = false; G.isLastDraw = false
  G.mustDiscard = false; G.pendingKan = null
  const hseed = G.seed + ':' + o.hand + ':' + o.streak
  const w = buildWall(hseed, o.dealer)
  G.wall = w.wall; G.dice = w.dice; G.openSeat = w.openSeat
  G._rnd = mulberry32(fnv1a(hseed + ':ai'))           // ★ 電腦的決策也吃種子 ⇒ 整局可重現
  for (let round = 0; round < 16; round++)
    for (let k = 0; k < 4; k++) G.hands[(o.dealer + k) % 4].push(G.wall.shift())
  dealFlowers(G)
  for (let s = 0; s < 4; s++) sortHand(G.hands[s])
  G.phase = 'play'
  G.turn = o.dealer
  drawTile(G, o.dealer)                                // 莊家第 17 張,開打
  return G
}

function newGame(opt) {
  opt = opt || {}
  const G = {
    seed: opt.seed != null ? String(opt.seed) : String(Date.now()),
    opts: opt.opts || loadOpts(),
    scores: [0, 0, 0, 0],
    dealer: opt.dealer || 0, streak: 0, hand: 1, prevalent: 0,
  }
  return dealHand(G, { dealer: G.dealer, streak: 0, hand: 1 })
}

// ══ 電腦 ══
// ★ M2 的電腦還不是真 AI(M3 才是 shanten + 有效進張 + 安全牌)。
//   它只負責「讓仲裁通道被真的走過」,而且**跟玩家走同一支 declare / applySelf / playDiscard**。
// ★ M3 起這支只給 POLICY_PASS(測試用)用。真的電腦在 src/ai.js 的 makePolicy()。
function aiPick(G, seat) {
  const hand = G.hands[seat].concat(G.drawn[seat] ? [G.drawn[seat]] : [])
  const cnt = {}
  for (const t of hand) cnt[t.k] = (cnt[t.k] || 0) + 1
  const d = G.drawn[seat]
  if (d && isHonor(d) && cnt[d.k] === 1 && G._rnd() < 0.7) return -1   // 現摸現打的孤張字牌
  let bestI = 0, bestScore = 1e9
  for (let i = 0; i < G.hands[seat].length; i++) {
    const t = G.hands[seat][i]
    let sc = cnt[t.k] * 10                       // 分數越低越先打
    if (isHonor(t)) sc -= 6
    else if (isTerminal(t)) sc -= 3
    sc += G._rnd() * 4
    if (sc < bestScore) { bestScore = sc; bestI = i }
  }
  return bestI
}

// 永遠不吃不碰不胡 —— 測試用它驗「純輪轉」那一組不變量(逆時針不跳過、四家丟牌數相等)
const POLICY_PASS = {
  react() { return { type: 'pass' } },
  self() { return null },
  discard: aiPick,
}

// 推進一步。回傳 true = 做了事;false = 在等人類,或這一局已經結束。
// ★ humanSeat 傳 -1 就是四家全電腦(smoke / balance 用這個跑批次)。
// ★ policy 可以是一支(四家共用)或**四支的陣列**(每家不同強度 —— balance.mjs 靠這個對打)。
const policyOf = (policy, seat) => (Array.isArray(policy) ? policy[seat] : policy)

function stepAuto(G, policy, humanSeat) {
  policy = policy || POLICY_PASS   // ★ 不預設真 AI:呼叫端要自己講清楚用哪一級
  if (humanSeat == null) humanSeat = 0
  if (G.phase === 'react') {
    for (let s = 0; s < 4; s++) {
      if (G.react.claim[s]) continue
      if (s === humanSeat) return false                  // 等玩家按吃/碰/槓/胡/過
      const p = policyOf(policy, s)
      declare(G, s, p.react(G, s, G.react.opts[s]) || { type: 'pass' })
      return true
    }
    return false
  }
  if (G.phase !== 'play') return false
  const s = G.turn
  if (!G.drawn[s] && !G.mustDiscard) { drawTile(G, s); return true }
  if (s === humanSeat) return false                      // 等玩家打牌 / 自摸 / 槓
  const p = policyOf(policy, s)
  if (applySelf(G, s, p.self(G, s, selfOptions(G, s)))) return true
  playDiscard(G, s, p.discard(G, s))
  return true
}

// ══ 玩家能按哪些鈕 ══
// ★ 只有這一份:renderer 拿它畫按鈕、game 拿它執行 —— 畫面上有的鈕就一定按得動,反之亦然。
function humanActions(G, seat) {
  if (seat == null) seat = 0
  const out = []
  if (G.phase === 'react' && G.react && !G.react.claim[seat]) {
    for (const o of G.react.opts[seat]) {
      if (o.type === 'hu') out.push({ label: '胡', kind: 'react', choice: o, hot: true })
      else if (o.type === 'kan') out.push({ label: '槓', kind: 'react', choice: o })
      else if (o.type === 'pon') out.push({ label: '碰', kind: 'react', choice: o })
      else out.push({ label: '吃 ' + idxName(o.use[0]) + idxName(o.use[1]), kind: 'react', choice: o })
    }
    if (out.length) out.push({ label: '過', kind: 'react', choice: { type: 'pass' }, dim: true })
    return out
  }
  if (G.phase === 'play' && G.turn === seat) {
    if (canDiscardNow(G, seat)) out.push({ label: '💡 提示', kind: 'hint', dim: true })
    for (const o of selfOptions(G, seat)) {
      if (o.type === 'tsumo') out.push({ label: '自摸', kind: 'self', choice: o, hot: true })
      else if (o.type === 'ankan') out.push({ label: '暗槓 ' + idxName(o.i), kind: 'self', choice: o })
      else out.push({ label: '加槓 ' + idxName(o.i), kind: 'self', choice: o })
    }
  }
  return out
}
function applyHumanAction(G, seat, a) {
  if (!a) return false
  if (a.kind === 'react') return declare(G, seat, a.choice)
  return applySelf(G, seat, a.choice)
}
// 玩家現在該不該打牌?(剛摸完 或 碰吃完要打)
const canDiscardNow = (G, seat) =>
  G.phase === 'play' && G.turn === seat && (!!G.drawn[seat] || G.mustDiscard)

// ══ 🏆 成績榜 ══
// ★ 一「場」打完才記一筆(不是一局)。localStorage 全包 try/catch —— 私密模式不能炸。
// ★ 讀回來一定要驗型別:使用者的瀏覽器裡什麼都可能有(手動改過、舊版寫的、被別的站覆蓋)。
const RUNS_KEY = 'mj-runs', RUNS_MAX = 50
function readRuns() {
  try {
    const a = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]')
    if (!Array.isArray(a)) return []
    return a.filter((r) => r && typeof r.mine === 'number' && typeof r.at === 'number')
  } catch { return [] }
}
function addRun(G) {
  const rec = {
    at: Date.now(), mine: G.scores[0], scores: G.scores.slice(),
    hands: G.opts.hands, level: G.opts.level, multiRon: !!G.opts.multiRon,
  }
  const all = readRuns()
  all.push(rec)
  all.sort((a, b) => b.at - a.at)
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(all.slice(0, RUNS_MAX))) } catch { }
  return rec
}
// 依「我的分數」高到低;同分時先打完的排前面
const rankList = () => readRuns().sort((a, b) => b.mine - a.mine || a.at - b.at)
const bestScore = () => { const l = rankList(); return l.length ? l[0].mine : null }

// ══ 存檔續玩 ══
// 一將 16 局要打一小時,手機一定會被切走。★ 全包 try/catch —— 私密模式不能炸。
// ★ 牌一律存 **id**,讀回來用 makeTiles() 重建(id 是決定性的,0..143 固定對應同一張牌)。
// ★ 讀回來一定要跑守恆保險絲:存檔可能是舊版寫的、被手改過、或根本不是我們寫的。
const SAVE_KEY = 'mj-save', SAVE_V = 1
const idsOf = (a) => a.map((t) => t.id)

function serializeG(G) {
  const live = (G.phase === 'play' || G.phase === 'react') ? {
    turn: G.turn, phase: G.phase, discards: G.discards, anyMeld: G.anyMeld,
    kanBloom: G.kanBloom, isLastDraw: G.isLastDraw, mustDiscard: G.mustDiscard,
    dice: G.dice.slice(), openSeat: G.openSeat,
    wall: idsOf(G.wall), hands: G.hands.map(idsOf),
    drawn: G.drawn.map((t) => (t ? t.id : null)),
    melds: G.melds.map((ms) => ms.map((m) => ({ kind: m.kind, i: m.i, from: m.from, tiles: idsOf(m.tiles) }))),
    river: G.river.map(idsOf), flowers: G.flowers.map(idsOf),
    last: G.last ? { seat: G.last.seat, tile: G.last.tile.id } : null,
    pendingKan: G.pendingKan ? { seat: G.pendingKan.seat, idx: G.pendingKan.idx, tile: G.pendingKan.tile.id } : null,
    react: G.react ? {
      tile: G.react.tile.id, tileIdx: G.react.tileIdx, from: G.react.from,
      robKan: G.react.robKan, lastTile: G.react.lastTile,
      opts: G.react.opts, claim: G.react.claim,
    } : null,
  } : null
  return {
    v: SAVE_V, at: Date.now(),
    // ★ 結算畫面離開的話 live 是 null:比分留著,下次回來從下一局開始
    match: { seed: G.seed, opts: G.opts, scores: G.scores.slice(),
      dealer: G.dealer, streak: G.streak, hand: G.hand, prevalent: G.prevalent },
    live,
  }
}

function restoreG(snap) {
  try {
    if (!snap || snap.v !== SAVE_V || !snap.match) return null
    const m = snap.match
    if (!Array.isArray(m.scores) || m.scores.length !== 4) return null
    const opts = {
      multiRon: m.opts && m.opts.multiRon !== false,
      hands: m.opts && HAND_LIMITS.includes(m.opts.hands) ? m.opts.hands : DEFAULT_OPTS.hands,
      level: m.opts && [0, 1, 2].includes(m.opts.level) ? m.opts.level : DEFAULT_OPTS.level,
    }
    const G = { seed: String(m.seed), opts, scores: m.scores.slice(),
      dealer: m.dealer | 0, streak: m.streak | 0, hand: m.hand | 0, prevalent: m.prevalent | 0 }
    if (!snap.live) return dealHand(G, { dealer: G.dealer, streak: G.streak, hand: G.hand })

    const all = makeTiles()
    const one = (id) => all[id]
    const arr = (ids) => ids.map(one)
    const L = snap.live
    G.turn = L.turn; G.phase = L.phase; G.discards = L.discards | 0
    G.anyMeld = !!L.anyMeld; G.kanBloom = !!L.kanBloom; G.isLastDraw = !!L.isLastDraw
    G.mustDiscard = !!L.mustDiscard; G.dice = L.dice; G.openSeat = L.openSeat
    G.msg = ''; G.result = null
    G.wall = arr(L.wall); G.hands = L.hands.map(arr)
    G.drawn = L.drawn.map((id) => (id == null ? null : one(id)))
    G.melds = L.melds.map((ms) => ms.map((x) => ({ kind: x.kind, i: x.i, from: x.from, tiles: arr(x.tiles) })))
    G.river = L.river.map(arr); G.flowers = L.flowers.map(arr)
    G.last = L.last ? { seat: L.last.seat, tile: one(L.last.tile) } : null
    G.pendingKan = L.pendingKan ? { seat: L.pendingKan.seat, idx: L.pendingKan.idx, tile: one(L.pendingKan.tile) } : null
    G.react = L.react ? {
      tile: one(L.react.tile), tileIdx: L.react.tileIdx, from: L.react.from,
      robKan: !!L.react.robKan, lastTile: !!L.react.lastTile,
      opts: L.react.opts, claim: L.react.claim,
    } : null
    // ★★ 守恆保險絲:讀回來的存檔要是湊不出 144 張,寧可整份丟掉重開,也不要帶著壞局繼續打
    if (!conserve(G).ok) return null
    G._rnd = mulberry32(fnv1a(G.seed + ':' + G.hand + ':' + G.streak + ':ai'))
    return G
  } catch { return null }
}

function saveState(G) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(serializeG(G))) } catch { } }
function clearState() { try { localStorage.removeItem(SAVE_KEY) } catch { } }
function loadState() {
  try { return restoreG(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')) } catch { return null }
}
