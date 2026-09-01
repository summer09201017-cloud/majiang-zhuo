// 純邏輯驗收:不開瀏覽器、不畫任何東西,只驗規則與帳(144 張守恆)。
// 用法:node scripts/smoke.mjs
//
// ★ 頭號守門是「144 張守恆 + 零重複」:牌消失/複製是**靜默的**
//   (不當機、不報錯,牌就是少一張)—— 麻將版的「彈珠掉進虛空」。
// ★ bot 與 UI 走同一份 drawTile/discard(規則只有一份)。
// ★ 項數不寫進文件:以跑出來的為準(寫死的數字隔一輪就變成謊話)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = ['config', 'tiles', 'rules/hu', 'rules/shanten', 'rules/meld', 'rules/score', 'table', 'ai', 'sfx', 'confetti', 'game']
const code = SRC.map((f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8')).join('\n')

// 🗄 假 localStorage:node 沒有它,sfx 的偏好邏輯會全走 catch = 等於沒驗到。
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)) },
    removeItem: (k) => { mem.delete(String(k)) },
    clear: () => mem.clear(),
  }
}

const api = new Function(code + '\n; return { CONFIG, KINDS, get LAY() { return LAY }, makeTiles, buildWall, conserve,' +
  ' tilePos, handHit, tagRect, actBarLayout, layoutFor, setLayoutWidth, LAY_W_MIN, LAY_W_MAX, tileName, tileCmp, sortHand, isFlower, isHonor, meldTileCount,' +
  ' newGame, dealHand, nextHand, drawTile, discard, playDiscard, playerDiscard, nextSeat, seatWind, wallLeft,' +
  ' handCounts, needOf, reactOptions, beginReact, declare, selfOptions, applySelf,' +
  ' doPon, doChi, doMinkan, doAnkan, doAddkan, doSelfWin, stepAuto, POLICY_AI, POLICY_PASS,' +
  ' SCORE, HAND_LIMITS, loadOpts, saveOpts, aiPick, humanActions, applyHumanAction, canDiscardNow,' +
  ' shanten, usefulTiles, isTenpai, bestShantenAfterDiscard, clearShantenCache, waits,' +
  ' AI_LEVELS, leftCounts, dangerOf, tablePressure, evalDiscards, claimGain, shantenOfForm,' +
  ' handSlotOf, makePolicy, policyFor, POLICY_EASY, POLICY_NORMAL, POLICY_HARD, POLICY_AI, hintFor, deepWidth,' +
  ' readRuns, addRun, rankList, bestScore, serializeG, restoreG, saveState, loadState, clearState, Confetti, SFX, game,' +
  ' kidx, toCounts, decompose, isHu, canWinWith, waits, idxName, idxIsYaoJiu,' +
  ' canPon, canMinkan, ankanOptions, addkanOptions, chiOptions, meldToSet, isConcealed,' +
  ' TAI, scoreOne, scoreHand, taiText }')()

const results = []
const check = (name, ok, detail) =>
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })

const ids = (a) => a.map((t) => t.id).join(',')

// 一整局跑到流局(玩家一律打手牌第 0 張 ⇒ 確定性),沿途每步驗守恆
// 讓一局自己跑完(四家全電腦)。★ 走的是 stepAuto —— 跟 UI 完全同一條路。
//   policy 預設 POLICY_PASS:永遠不吃不碰不胡 ⇒ 才驗得到「純輪轉」那一組不變量。
function runToEnd(seed, policy, opts) {
  const G = api.newGame({ seed, opts: Object.assign({ multiRon: true, hands: 1 }, opts || {}) })
  const errs = []
  const order = []
  let steps = 0, prevD = 0
  while ((G.phase === 'play' || G.phase === 'react') && steps++ < 3000) {
    if (!api.stepAuto(G, policy || api.POLICY_PASS, -1)) break
    if (G.discards > prevD) { order.push(G.last.seat); prevD = G.discards }
    const c = api.conserve(G)
    if (!c.ok) { errs.push('step' + steps + ':' + c.err); break }
  }
  return { G, errs, steps, order }
}

// ══ A. 牌組 ══
check('牌種 42 種(9×3 + 7 字 + 8 花)', api.KINDS.length === 42, api.KINDS.length)
const T = api.makeTiles()
check('牌組 144 張', T.length === 144, T.length)
check('牌 id 為 0..143 且零重複', new Set(T.map((t) => t.id)).size === 144 && Math.max(...T.map((t) => t.id)) === 143)
const cnt = {}
for (const t of T) cnt[t.k] = (cnt[t.k] || 0) + 1
check('花牌各 1 張(共 8)', api.KINDS.filter((k) => k[0] === 'f').every((k) => cnt[k] === 1) &&
  T.filter(api.isFlower).length === 8, T.filter(api.isFlower).length)
check('萬/筒/條/字 各 4 張(共 136)', api.KINDS.filter((k) => k[0] !== 'f').every((k) => cnt[k] === 4),
  T.filter((t) => !api.isFlower(t)).length)
check('牌名讀得出來', api.tileName(T.find((t) => t.k === 'm5')) === '五萬' &&
  api.tileName(T.find((t) => t.k === 'z6')) === '發' && api.tileName(T.find((t) => t.k === 'f1')) === '春')

// ══ B. 砌牌牆與種子 ══
const w1 = api.buildWall('seed-a', 0)
check('牌牆 144 張、與牌組同一副(id 集合相同)',
  w1.wall.length === 144 && new Set(w1.wall.map((t) => t.id)).size === 144)
check('骰子兩顆在 2..12', w1.dice[0] >= 1 && w1.dice[0] <= 6 && w1.dice[1] >= 1 && w1.dice[1] <= 6,
  w1.dice.join('+'))
check('開門家是 0..3', w1.openSeat >= 0 && w1.openSeat <= 3, w1.openSeat)
check('★ 同種子完全重現', ids(w1.wall) === ids(api.buildWall('seed-a', 0).wall))
const walls = new Set()
for (let i = 0; i < 20; i++) walls.add(ids(api.buildWall('s' + i, 0).wall))
check('20 個不同種子 → 20 副不同的牌', walls.size === 20, walls.size)

// ══ C. 發牌與補花 ══
const G0 = api.newGame({ seed: 'deal-1', dealer: 0 })
check('★ 發牌後 144 張守恆', api.conserve(G0).ok, api.conserve(G0).err)
check('閒家各 16 張手牌', [1, 2, 3].every((s) => G0.hands[s].length === 16),
  [0, 1, 2, 3].map((s) => G0.hands[s].length).join('/'))
check('莊家 16 張 + 剛摸 1 張 = 17', G0.hands[0].length === 16 && G0.drawn[0] != null)
check('閒家沒有「剛摸的牌」', [1, 2, 3].every((s) => G0.drawn[s] == null))
check('★ 補花後四家手牌一張花都沒有', [0, 1, 2, 3].every((s) => !G0.hands[s].some(api.isFlower)))
const flowersOut = G0.flowers.reduce((n, f) => n + f.length, 0)
const flowersInWall = G0.wall.filter(api.isFlower).length
check('8 張花 = 已補出的 + 還在牌牆裡的', flowersOut + flowersInWall === 8, flowersOut + '+' + flowersInWall)
check('手牌已排序(萬→筒→條→字)', [0, 1, 2, 3].every((s) => {
  const h = G0.hands[s]
  for (let i = 1; i < h.length; i++) if (api.tileCmp(h[i - 1], h[i]) > 0) return false
  return true
}))
check('莊家先手', G0.turn === G0.dealer && G0.phase === 'play')
check('風位:莊=東,逆時針 南西北', [0, 1, 2, 3].map((s) => api.seatWind(G0, s)).join('') === '0123')
const G0b = api.newGame({ seed: 'deal-1', dealer: 0 })
check('★ 同種子發出同一副牌', ids(G0.hands[0]) === ids(G0b.hands[0]) && ids(G0.wall) === ids(G0b.wall))

// 摸到花會自動補(把一張花塞到牌牆最前面)
const Gf = api.newGame({ seed: 'flower-x' })
const fi = Gf.wall.findIndex(api.isFlower)
if (fi > 0) { const f = Gf.wall.splice(fi, 1)[0]; Gf.wall.unshift(f) }
const before = Gf.flowers[1].length
const got = api.drawTile(Gf, 1)   // ⚠ 別在這裡動 drawn[0]:那會憑空丟掉莊家的牌,守恆會紅(0901 自己踩過)
check('★ 摸到花會進花區、改摸尾牌(補花與摸牌同一條路)',
  fi < 0 || (got && !api.isFlower(got) && Gf.flowers[1].length === before + 1), fi)
check('補花後仍守恆', api.conserve(Gf).ok, api.conserve(Gf).err)

// ══ D. 打牌 ══
const Gd = api.newGame({ seed: 'discard-1' })
const drawnTile = Gd.drawn[0]
api.discard(Gd, 0, -1)
check('打「剛摸的那張」:牌河多它、手牌仍 16 張',
  Gd.river[0][0].id === drawnTile.id && Gd.hands[0].length === 16 && Gd.drawn[0] == null)
check('打完守恆', api.conserve(Gd).ok, api.conserve(Gd).err)
const Gd2 = api.newGame({ seed: 'discard-2' })
const keep = Gd2.drawn[0], out = Gd2.hands[0][3]
api.discard(Gd2, 0, 3)
check('打手牌某張:剛摸的那張併回手牌並重排',
  Gd2.river[0][0].id === out.id && Gd2.hands[0].length === 16 &&
  Gd2.hands[0].some((t) => t.id === keep.id) && Gd2.drawn[0] == null)
check('併回後仍是排序的', (() => {
  const h = Gd2.hands[0]
  for (let i = 1; i < h.length; i++) if (api.tileCmp(h[i - 1], h[i]) > 0) return false
  return true
})())

// ══ E. 整局 ══
const R = runToEnd('full-1')
check('★★ 整局每一步都守恆 144', R.errs.length === 0, R.errs.slice(0, 3).join(' | '))
check('打到牌牆摸完 = 流局', R.G.phase === 'washout' && R.G.wall.length === 0, R.G.phase + '/' + R.G.wall.length)
check('一局的步數在合理範圍(120~200:每一巡摸+打各算一步)', R.steps >= 120 && R.steps <= 200, R.steps)
const R2 = runToEnd('full-1')
check('★ 同種子整局完全重現(含電腦決策)',
  [0, 1, 2, 3].every((s) => ids(R.G.river[s]) === ids(R2.G.river[s])))
let bad = 0
for (let i = 0; i < 30; i++) { const r = runToEnd('batch-' + i); if (r.errs.length || r.G.phase !== 'washout') bad++ }
check('★★ 30 局亂走 bot:零守恆破口、全部走到流局', bad === 0, bad)
check('★ 沒人吃碰時,打牌順序逆時針 0→1→2→3 一家都不跳過', (() => {
  for (let i = 1; i < R.order.length; i++) if (R.order[i] !== (R.order[i - 1] + 1) % 4) return false
  return R.order.length > 60
})(), R.order.slice(0, 8).join('→'))
check('四家丟出的牌數相差不超過 1(沒有人被跳過)', (() => {
  const ns = [0, 1, 2, 3].map((s2) => R.G.river[s2].length)
  return Math.max(...ns) - Math.min(...ns) <= 1
})(), [0, 1, 2, 3].map((s2) => R.G.river[s2].length).join('/'))

// ══ M1-a. 胡牌型分解 hu.js ══
// 牌的簡寫:'123m 456p 77z' → 一二三萬、四五六筒、南南。★ 台數只看種類,不需要 id。
const TT = (str) => str.split(/\s+/).filter(Boolean).flatMap((tok) => {
  const suit = tok[tok.length - 1]
  return tok.slice(0, -1).split('').map((ch) => ({ s: suit, r: +ch }))
})
const CNT = (str) => api.toCounts(TT(str))

const H17 = '123m 456m 789m 123p 456p 77p'   // 5 副順子 + 77p 將(17 張)
check('17 張 = 5 面子 + 1 將,拆得出來', api.decompose(CNT(H17), 5).length >= 1)
check('少一張(16)拆不出來', api.decompose(CNT('123m 456m 789m 123p 456p 7p'), 5).length === 0)
// ⚠ 0901 自己踩的:'…123p 456p 7p' 不是單吊七筒,是**三面聽 1/4/7 筒**
//    (補 1 筒 ⇒ 11p 將 + 234p + 567p;補 4 筒 ⇒ 44p 將 + 123p + 567p)。測試寫錯、程式是對的。
check('★ 三面聽算得出來:1/4/7 筒', (() => {
  const w = api.waits(CNT('123m 456m 789m 123p 456p 7p'), 5).map(api.idxName)
  return w.join(',') === '一筒,四筒,七筒'
})(), api.waits(CNT('123m 456m 789m 123p 456p 7p'), 5).map(api.idxName).join(','))
check('單吊字牌:五副面子做齊,只聽那一張', (() => {
  const w = api.waits(CNT('123m 456m 789m 123p 456p 3z'), 5)
  return w.length === 1 && api.idxName(w[0]) === '西'
})(), api.waits(CNT('123m 456m 789m 123p 456p 3z'), 5).map(api.idxName).join(','))
check('canWinWith:摸到七筒能胡、摸到八筒不能',
  api.canWinWith(CNT('123m 456m 789m 123p 456p 7p'), 5, api.kidx({ s: 'p', r: 7 })) &&
  !api.canWinWith(CNT('123m 456m 789m 123p 456p 7p'), 5, api.kidx({ s: 'p', r: 8 })))
check('順子不跨門(9萬+1筒+2筒 不算一組)', api.decompose(CNT('789m 12p 456p 789p 123s 11s'), 5).length === 0)
check('★ 一手牌拆得出兩種讀法(111222333 = 三刻 或 三順)',
  api.decompose(CNT('111m 222m 333m 789p 789p 55s'), 5).length >= 2,
  api.decompose(CNT('111m 222m 333m 789p 789p 55s'), 5).length)
check('十七張全單張 = 不成胡', api.decompose(CNT('123456789m 123456p 9s 3z'), 5).length === 0)

// ══ M1-b. 吃碰槓合法性 meld.js ══
const MC = CNT('112233m 1111p 5s')
check('碰:手上兩張就能碰', api.canPon(MC, api.kidx({ s: 'm', r: 1 })))
check('碰:手上一張不能碰', !api.canPon(MC, api.kidx({ s: 's', r: 5 })))
check('明槓:手上三張才行(這裡一筒有四張)', api.canMinkan(MC, api.kidx({ s: 'p', r: 1 })))
check('暗槓:只列出手上滿四張的', api.ankanOptions(MC).map(api.idxName).join(',') === '一筒',
  api.ankanOptions(MC).map(api.idxName).join(','))
check('加槓:碰過一萬又摸到第四張才列得出來',
  api.addkanOptions(MC, [{ kind: 'pon', i: api.kidx({ s: 'm', r: 1 }) }]).length === 1 &&
  api.addkanOptions(MC, [{ kind: 'pon', i: api.kidx({ s: 's', r: 5 }) }]).length === 1)
check('吃:三萬只有「一二萬」一種吃法', (() => {
  const o = api.chiOptions(MC, api.kidx({ s: 'm', r: 3 }))
  return o.length === 1 && o[0].map(api.idxName).join('') === '一萬二萬'
})(), JSON.stringify(api.chiOptions(MC, api.kidx({ s: 'm', r: 3 })).map((x) => x.map(api.idxName))))
check('吃:字牌永遠不能吃', api.chiOptions(MC, api.kidx({ s: 'z', r: 1 })).length === 0)
check('★ 暗槓不破門清、明碰破門清',
  api.isConcealed([{ kind: 'ankan', i: 0 }]) && !api.isConcealed([{ kind: 'pon', i: 0 }]))
check('★ 暗槓算暗刻、明槓算明刻',
  api.meldToSet({ kind: 'ankan', i: 0 }).open === false &&
  api.meldToSet({ kind: 'minkan', i: 0 }).open === true &&
  api.meldToSet({ kind: 'ankan', i: 0 }).kan === true)

// ══ M1-c. 台數 golden cases ══
// ★ v1 台數表的每一條都要有一個案例釘著它(roadmap §7)。加一項台 = 加一行表 + 加一個 case。
const SC = (o) => api.scoreHand(Object.assign({ seatWind: 0, prevalent: 0, melds: [], flowers: 0 }, o))
const tai = (o) => { const r = SC(o); return r.ok ? r.tai : -1 }
const CHI_123M = { kind: 'chi', i: api.kidx({ s: 'm', r: 1 }), from: 3 }

// ① 什麼都沒有:有吃(不門清)、全順子、閒家榮和 ⇒ 0 台。★ 0 台也要 ok=true
const zero = SC({ melds: [CHI_123M], hand: TT('456m 789m 123p 456p 7p'), win: TT('7p')[0] })
check('① 有吃全順子閒家榮和 = 0 台(且 ok=true)', zero.ok && zero.tai === 0, zero.tai + ' / ' + api.taiText(zero))

// ② 門清自摸 = 門清 1 + 自摸 1 + 不求人 1
check('② 門清自摸 = 3 台', tai({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true }) === 3,
  api.taiText(SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true })))

// ③ 五暗刻 + 碰碰胡 + 混一色(門清榮和,胡的是將牌所以五個刻子都還是暗的)
const c3 = SC({ hand: TT('111m 222m 333m 444m 5m 222z'), win: TT('5m')[0] })
check('③ 門清 + 五暗刻 + 碰碰胡 + 混一色 = 17 台', c3.tai === 17, api.taiText(c3))

// ④ 清一色(全萬子,有順子)
const c4 = SC({ hand: TT('123m 123m 456m 789m 789m 9m'), win: TT('9m')[0] })
check('④ 門清 + 清一色 = 9 台', c4.tai === 9, api.taiText(c4))

// ⑤ 大三元(中發白各 1 台照算 + 大三元 8 + 三暗刻 2 + 門清 1)
const c5 = SC({ hand: TT('555z 666z 777z 123m 456m 9p'), win: TT('9p')[0] })
check('⑤ 大三元 = 14 台(三元刻各 1 台照算)', c5.tai === 14, api.taiText(c5))

// ⑥ 字一色 + 大三元(圈風設南,才看得到門風/圈風各算一次)
const c6 = SC({ hand: TT('111z 222z 555z 666z 777z 3z'), win: TT('3z')[0], prevalent: 1 })
check('⑥ 字一色 + 大三元 + 五暗刻 = 42 台', c6.tai === 42, api.taiText(c6))
check('⑥ 字一色時不會又算混一色或混老頭',
  !c6.items.some((i) => i.name === '混一色' || i.name === '混老頭'), c6.items.map((i) => i.name).join('+'))

// ⑦ 混老頭(同時有么九數牌與字牌)
const c7 = SC({ hand: TT('111m 999m 111p 111z 999s 9p'), win: TT('9p')[0] })
check('⑦ 混老頭 = 19 台', c7.tai === 19, api.taiText(c7))
check('⑦ 混老頭不會又算清老頭', !c7.items.some((i) => i.name === '清老頭'))

// ⑧ 清老頭(全么九數牌、沒有字)
const c8 = SC({ hand: TT('111m 999m 111p 999p 111s 9s'), win: TT('9s')[0] })
check('⑧ 清老頭 = 29 台', c8.tai === 29, api.taiText(c8))
check('⑧ 清老頭不會又算混老頭', !c8.items.some((i) => i.name === '混老頭'))

// ⑨ ★★ 食胡補成的刻子算明刻 —— 同一手牌,榮和 14 台 / 自摸 19 台
const ron = SC({ hand: TT('111m 222m 333m 44m 55m 222z'), win: TT('4m')[0] })
const tsu = SC({ hand: TT('111m 222m 333m 44m 55m 222z'), win: TT('4m')[0], selfDraw: true })
check('⑨ 榮和補成的四萬刻算明刻 ⇒ 四暗刻(14 台)', ron.tai === 14, api.taiText(ron))
check('⑨ 同一手自摸 ⇒ 五暗刻 + 不求人(19 台)', tsu.tai === 19, api.taiText(tsu))

// ⑩ ★ 兩種讀法取最高:111222333 讀成三個刻子(三暗刻 2)比讀成三個順子(0)高
const c10 = SC({ hand: TT('111m 222m 333m 789p 789p 5s'), win: TT('5s')[0] })
check('⑩ 一手兩種讀法,取台數高的那種 = 3 台', c10.tai === 3, api.taiText(c10))
check('⑩ 取到的確實是「三個刻子」那種讀法',
  c10.sets.filter((x) => x.t === 'ke').length === 3, c10.sets.map((x) => x.t).join(','))

// ⑪ 暗槓:不破門清、算暗刻
const c11 = SC({ melds: [{ kind: 'ankan', i: api.kidx({ s: 'm', r: 1 }) }],
                 hand: TT('222m 333m 444m 222z 5m'), win: TT('5m')[0] })
check('⑪ 暗槓不破門清、且算進暗刻 = 17 台', c11.tai === 17, api.taiText(c11))

// ⑫ 旗標類:莊家連莊、花牌、天胡
check('⑫ 莊家連 2 拉 2(5 台)+ 花 3 張 = 8 台',
  tai({ melds: [CHI_123M], hand: TT('456m 789m 123p 456p 7p'), win: TT('7p')[0],
        isDealer: true, streak: 2, flowers: 3 }) === 8)
check('⑫ 天胡 = 門清自摸 3 + 24 = 27 台',
  tai({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, heavenly: true }) === 27)
check('⑫ 槓上開花 / 海底撈月 / 搶槓 各 1 台', (() => {
  const base = { hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true }
  return tai(Object.assign({}, base, { kanBloom: true })) === 4 &&
         tai(Object.assign({}, base, { lastTile: true })) === 4 &&
         tai(Object.assign({}, base, { robKan: true })) === 4
})())

// ⑬ 不成胡
check('⑬ 十七張全單張 ⇒ ok=false', SC({ hand: TT('123456789m 123456p 9s'), win: TT('3z')[0] }).ok === false)
check('⑬ 未成胡的文案講清楚', api.taiText(SC({ hand: TT('123456789m 123456p 9s'), win: TT('3z')[0] })) === '未成胡')

// ⑮ 補齊台數表剩下的條目(靠 ⑯ 的涵蓋檢查抓出來的:這五條原本沒有案例)
// ⚠ 順子刻意跨兩門:全用萬子會連「混一色」一起中(11 台),小三元就被蓋掉看不出來了
const c15a = SC({ hand: TT('555z 666z 123m 456p 789p 7z'), win: TT('7z')[0] })
check('⑮ 小三元 = 7 台', c15a.tai === 7, api.taiText(c15a))
const c15b = SC({ hand: TT('111z 222z 333z 123m 456m 4z'), win: TT('4z')[0], prevalent: 1 })
check('⑮ 小四喜 = 17 台', c15b.tai === 17, api.taiText(c15b))
const c15c = SC({ hand: TT('111z 222z 333z 444z 111m 9m'), win: TT('9m')[0], prevalent: 1 })
check('⑮ 大四喜 = 39 台', c15c.tai === 39, api.taiText(c15c))
const c15d = SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, earthly: true })
check('⑮ 地胡 = 門清自摸 3 + 16 = 19 台', c15d.tai === 19, api.taiText(c15d))
const c15e = SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], lastTile: true })
check('⑮ 河底撈魚(榮和最後一張)= 門清 1 + 1 = 2 台', c15e.tai === 2, api.taiText(c15e))

// ⑯ ★★ 台數表涵蓋檢查:TAI 表裡每一條都要被某個案例算出來過。
//    沒有這條,加了一項台卻沒案例、或條件寫錯永遠不成立,都是靜默的死碼。
const GOLDEN = [zero, c3, c4, c5, c6, c7, c8, ron, tsu, c10, c11, c15a, c15b, c15c, c15d, c15e,
  SC({ melds: [CHI_123M], hand: TT('456m 789m 123p 456p 7p'), win: TT('7p')[0], isDealer: true, streak: 2, flowers: 3 }),
  SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, heavenly: true }),
  SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, kanBloom: true }),
  SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, lastTile: true }),
  SC({ hand: TT('123m 456m 789m 123p 456p 7p'), win: TT('7p')[0], selfDraw: true, robKan: true })]
const norm = (n) => n.startsWith('花牌') ? '花牌' : n.startsWith('門風') ? '門風'
  : n.startsWith('圈風') ? '圈風' : n.startsWith('莊家連') ? '莊家'
  : (n === '中' || n === '發' || n === '白') ? '三元刻' : n
const seenTai = new Set()
for (const r of GOLDEN) for (const it of r.items) seenTai.add(norm(it.name))
const wantTai = Object.keys(api.TAI).concat(['花牌', '莊家'])
const missTai = wantTai.filter((k) => !seenTai.has(k))
check('★★ 台數表 ' + wantTai.length + ' 條全部都有案例涵蓋', missTai.length === 0, '沒案例:' + missTai.join('、'))

// ⑰ 被 v1 刻意拿掉的台,不可以偷偷出現(平胡/獨聽/單吊/邊張/嵌張/七對子)
check('★ v1 拿掉的台不會出現在任何案例裡', (() => {
  const banned = ['平胡', '獨聽', '單吊', '邊張', '嵌張', '七對子', '八對子']
  for (const r of GOLDEN)
    for (const it of r.items) if (banned.some((b) => it.name.includes(b))) return false
  return true
})())

// ══ M1-d. 亂數 property test(不靠我手算,靠不變量)══
// ⚠ 0901 教訓:第一版用「隨機抓 17 張」跑 4000 手 —— **0 手成胡**,四條 property 全是空跑假綠。
//    隨機牌成胡的機率低到可以當 0 ⇒ 一定要**用構造法生出保證成胡的手牌**,再驗不變量。
//    (最後那條「樣本裡真的有胡牌型可驗」就是防這件事的守門,別拿掉。)
function expandDecomp(d) {
  const c = new Array(34).fill(0)
  c[d.pair] += 2
  for (const s2 of d.sets) {
    if (s2.t === 'ke') c[s2.i] += 3
    else { c[s2.i]++; c[s2.i + 1]++; c[s2.i + 2]++ }
  }
  return c
}
;(() => {
  let seed = 20260901
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  // 構造:1 對將 + 5 副面子(刻子或順子),任何一種牌超過 4 張就重抽
  const build = () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const c = new Array(34).fill(0)
      let ok = true
      const put = (i, n) => { c[i] += n; if (c[i] > 4) ok = false }
      put((rand() * 34) | 0, 2)
      for (let k = 0; k < 5 && ok; k++) {
        if (rand() < 0.45) put((rand() * 34) | 0, 3)
        else { const t = (rand() * 21) | 0, b = ((t / 7) | 0) * 9 + (t % 7); put(b, 1); put(b + 1, 1); put(b + 2, 1) }
      }
      if (ok) return c
    }
    return null
  }
  const toTiles = (c) => {
    const out = []
    for (let i = 0; i < 34; i++) for (let k = 0; k < c[i]; k++)
      out.push({ s: i < 9 ? 'm' : i < 18 ? 'p' : i < 27 ? 's' : 'z', r: i < 27 ? (i % 9) + 1 : i - 26 })
    return out
  }

  let made = 0, notHu = 0, badExpand = 0, badSets = 0, badWait = 0, badScore = 0, maxTai = 0
  for (let n = 0; n < 3000; n++) {
    const c = build()
    if (!c) continue
    made++
    const ds = api.decompose(c, 5)
    if (!ds.length) { notHu++; continue }              // ★ 構造出來的一定要拆得出來
    for (const d of ds) {
      if (d.sets.length !== 5) badSets++
      const back = expandDecomp(d)
      for (let i = 0; i < 34; i++) if (back[i] !== c[i]) { badExpand++; break }
    }
    // 抽掉任一張 ⇒ waits 必須包含它,而且報的每一張都真的胡得了
    let pick = -1
    for (let i = 0; i < 34; i++) if (c[i]) { pick = i; break }
    c[pick]--
    const w = api.waits(c, 5)
    if (!w.includes(pick)) badWait++
    for (const x of w) if (!api.canWinWith(c, 5, x)) badWait++
    c[pick]++
    // 台數:任何成立的胡牌型都要 ok、台數 >= 0、每一項都 > 0
    const tiles = toTiles(c)
    const win = tiles.find((t) => api.kidx(t) === pick)
    const r = api.scoreHand({ hand: tiles.filter((t) => t !== win), win, melds: [],
      seatWind: 0, prevalent: 0, flowers: 0 })
    if (!r.ok || r.tai < 0 || !r.items.every((it) => it.tai > 0)) badScore++
    if (r.tai > maxTai) maxTai = r.tai
  }
  check('★ 樣本裡真的有胡牌型可驗(不是空跑)', made >= 1000, made + ' 手構造成功')
  check('★★ 構造出來的胡牌手,decompose 一定拆得出來', notHu === 0, notHu + ' 手拆不出來')
  check('★★ 每一種拆法攤回去都等於原本的牌(牌型守恆)', badExpand === 0, badExpand)
  check('每一種拆法都剛好 5 副面子', badSets === 0, badSets)
  check('★ 抽掉一張後 waits 必含它,且報的每張都真的胡得了', badWait === 0, badWait)
  check('任何成立的胡牌型都算得出台(每一項都 > 0)', badScore === 0, badScore)
  check('亂數樣本掃得到有台的牌型(最高 ' + maxTai + ' 台)', maxTai >= 8, maxTai)
})()

// ══ M2-a. 測試夾具:精確擺牌(★ 一律從牌牆搬,144 守恆不能破)══
// 把四家的手牌換成指定的牌:先把所有人的手牌與剛摸的牌倒回牌牆,再一張一張撿回來。
function setupTable(G, spec) {
  for (let s2 = 0; s2 < 4; s2++) {
    if (G.drawn[s2]) { G.wall.push(G.drawn[s2]); G.drawn[s2] = null }
    while (G.hands[s2].length) G.wall.push(G.hands[s2].pop())
    // ⚠ 花牌也要清:開局補花會隨機發到花,每一張都是 1 台 —— 不清掉,台數的期望值就對不準
    //    (0901 踩過:自摸案例算出 5 台,少的那 1 台是莊家的一張花)
    while (G.flowers[s2].length) G.wall.push(G.flowers[s2].pop())
  }
  for (let s2 = 0; s2 < 4; s2++) {          // 先滿足指定的,再補其餘(順序反了會被補牌偷走)
    if (!spec[s2]) continue
    const got = []
    for (const w of TT(spec[s2])) {
      const j = G.wall.findIndex((t) => t.s === w.s && t.r === w.r)
      if (j < 0) return false
      got.push(G.wall.splice(j, 1)[0])
    }
    G.hands[s2] = got
  }
  for (let s2 = 0; s2 < 4; s2++) {
    const want = 16 - 3 * G.melds[s2].length
    while (G.hands[s2].length < want) {          // 不足就補
      const j = G.wall.findIndex((t) => t.s !== 'f')
      if (j < 0) return false
      G.hands[s2].push(G.wall.splice(j, 1)[0])
    }
    // ⚠ 也要**修剪**:0901 兩條 M3 測試就是夾具給了 15 張與 17 張,
    //    只補不刪 ⇒ 算出來的向聽數是垃圾,測試紅了卻不是產品的錯。
    while (G.hands[s2].length > want) G.wall.push(G.hands[s2].pop())
    api.sortHand(G.hands[s2])
  }
  return true
}
// 只換一家的手牌(張數維持 16 - 3×副露數)
function setSeatHand(G, seat, str) {
  if (G.drawn[seat]) { G.wall.push(G.drawn[seat]); G.drawn[seat] = null }
  while (G.hands[seat].length) G.wall.push(G.hands[seat].pop())
  for (const w of TT(str)) {
    const j = G.wall.findIndex((t) => t.s === w.s && t.r === w.r)
    if (j < 0) return false
    G.hands[seat].push(G.wall.splice(j, 1)[0])
  }
  api.sortHand(G.hands[seat])
  return true
}
// 從牌牆塞一張指定的牌當「剛摸的那張」
function giveDrawn(G, seat, str) {
  const w = TT(str)[0]
  const j = G.wall.findIndex((t) => t.s === w.s && t.r === w.r)
  if (j < 0) return false
  if (G.drawn[seat]) G.wall.push(G.drawn[seat])
  G.drawn[seat] = G.wall.splice(j, 1)[0]
  return true
}
const handIdx = (G, seat, str) => {
  const w = TT(str)[0]
  return G.hands[seat].findIndex((t) => t.s === w.s && t.r === w.r)
}
const fresh = (o) => api.newGame(Object.assign({ seed: 'm2', dealer: 0, opts: { multiRon: true, hands: 1 } }, o || {}))

check('夾具本身不破守恆', (() => {
  const G = fresh()
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7z', 1: '77z 111m 222m 333m 111p 22p' })
  return api.conserve(G).ok && G.hands[0].length === 16 && G.hands[1].length === 16
})())

// ══ M2-b. 優先權仲裁:胡 > 槓/碰 > 吃,而且只有下家能吃 ══
// ★ 這是麻將最容易寫錯的地方 —— 一定要「先收齊所有人的宣告,再一次仲裁」。
const S_HU_VS_PON = {
  0: '123m 456m 789m 123p 456p 7z',        // 打白板的人
  1: '77z 111m 222m 333m 111p 24p',        // 兩張白 ⇒ 能碰(24p 不成對,刻意讓它胡不了)
  2: '456m 789m 456p 789p 123s 7z',        // 單吊白 ⇒ 能胡
  3: '234s 567s 99s 1122z 3344z',          // 什麼都做不了
}
;(() => {
  const G = fresh()
  if (!setupTable(G, S_HU_VS_PON)) { check('★ 胡 > 碰:夾具擺得起來', false, '牌不夠'); return }
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  check('打出去之後進入 react 狀態(不是直接換下一家)', G.phase === 'react', G.phase)
  check('打牌的人自己沒有選項', G.react.opts[0].length === 0 && G.react.claim[0].type === 'pass')
  check('能碰的人看得到「碰」、而且胡不了',
    G.react.opts[1].some((o) => o.type === 'pon') && !G.react.opts[1].some((o) => o.type === 'hu'))
  check('能胡的人看得到「胡」', G.react.opts[2].some((o) => o.type === 'hu'))
  check('沒選項的人被自動 pass 掉', G.react.claim[3] && G.react.claim[3].type === 'pass')
  api.declare(G, 1, { type: 'pon' })
  check('收齊之前不會先執行(碰了但還沒仲裁)', G.phase === 'react' && G.melds[1].length === 0)
  api.declare(G, 2, { type: 'hu' })
  check('★★ 胡 > 碰:胡的人贏,碰不成立',
    G.phase === 'win' && G.result.winners.length === 1 && G.result.winners[0].seat === 2 && G.melds[1].length === 0,
    G.phase + ' winners=' + G.result.winners.map((w) => w.seat).join())
  check('胡完仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // 碰 > 吃,而且只有下家能吃
  const G = fresh()
  const ok = setupTable(G, {
    0: '123m 456m 789m 123p 456p 3m',      // 打三萬
    1: '12m 456p 789p 123s 456s 78s',      // 下家:有一二萬 ⇒ 能吃
    2: '33m 111p 222p 333p 111s 24s',      // 兩張三萬 ⇒ 能碰(刻意讓它胡不了)
    3: '456m 789m 456p 789p 567s 9s',
  })
  if (!ok) { check('★ 碰 > 吃:夾具擺得起來', false, '牌不夠'); return }
  api.playDiscard(G, 0, handIdx(G, 0, '3m'))
  check('下家看得到「吃」', G.react.opts[1].some((o) => o.type === 'chi'))
  check('★ 不是下家的人看不到「吃」', !G.react.opts[2].some((o) => o.type === 'chi') &&
    !G.react.opts[3].some((o) => o.type === 'chi'))
  check('能碰的人看得到「碰」、且不能胡',
    G.react.opts[2].some((o) => o.type === 'pon') && !G.react.opts[2].some((o) => o.type === 'hu'))
  api.declare(G, 1, G.react.opts[1].find((o) => o.type === 'chi'))
  api.declare(G, 2, { type: 'pon' })
  check('★★ 碰 > 吃:碰的人拿到,吃不成立',
    G.melds[2].length === 1 && G.melds[2][0].kind === 'pon' && G.melds[1].length === 0,
    JSON.stringify(G.melds.map((m) => m.length)))
  check('★ 碰完換他打牌,而且**不再摸一張**',
    G.turn === 2 && G.phase === 'play' && G.mustDiscard === true && G.drawn[2] === null)
  check('碰完仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
  check('副露同時帶 tiles(守恆用)與 kind/i(規則用)',
    G.melds[2][0].tiles.length === 3 && typeof G.melds[2][0].i === 'number')
})()

;(() => {   // declare 不接受不在 opts 裡的宣告
  const G = fresh()
  setupTable(G, S_HU_VS_PON)
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  check('★ 亂宣告會被擋掉(UI 傳什麼都不能繞過規則)',
    api.declare(G, 3, { type: 'pon' }) === false &&   // 沒選項的人已經被自動 pass
    api.declare(G, 1, { type: 'kan' }) === false &&    // 只有兩張,槓不了
    api.declare(G, 1, { type: 'hu' }) === false)       // 這手胡不了
})()

// ══ M2-c. 一炮多響(使用者 2026-09-01 拍板:預設開,設定可切)══
const S_MULTI = {
  0: '123m 456m 789m 123p 456p 7z',        // 打白板
  1: '456m 789m 456p 789p 123s 7z',        // 單吊白
  2: '111m 222m 333m 111p 222p 7z',        // 也單吊白
  3: '234s 567s 99s 1122z 3344z',
}
const runMulti = (multiRon) => {
  const G = fresh({ opts: { multiRon, hands: 1 } })
  if (!setupTable(G, S_MULTI)) return null
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  api.declare(G, 1, { type: 'hu' })
  api.declare(G, 2, { type: 'hu' })
  return G
}
;(() => {
  const on = runMulti(true), off = runMulti(false)
  if (!on || !off) { check('★ 一炮多響:夾具擺得起來', false, '牌不夠'); return }
  check('★★ 一炮多響(開):兩家同時胡,兩家都算',
    on.result.winners.map((w) => w.seat).join() === '1,2', on.result.winners.map((w) => w.seat).join())
  check('★★ 順位優先(關):只有從放炮者算起最近的那一家胡',
    off.result.winners.map((w) => w.seat).join() === '1', off.result.winners.map((w) => w.seat).join())
  const paid = on.result.winners.reduce((n, w) => n + w.score, 0)
  check('多響時放炮者付給每一家各一份', on.scores[0] === -paid && on.scores[1] > 0 && on.scores[2] > 0,
    on.scores.join('/'))
  check('分數零和(多響)', on.scores.reduce((a, b) => a + b, 0) === 0, on.scores.join('/'))
  check('分數零和(順位優先)', off.scores.reduce((a, b) => a + b, 0) === 0, off.scores.join('/'))
  check('多響之後仍然 144 張守恆', api.conserve(on).ok, api.conserve(on).err)
})()

// ══ M2-d. 槓 ══
;(() => {   // 明槓:別人打的第四張
  const G = fresh()
  const ok = setupTable(G, {
    0: '123m 456m 789m 123p 456p 7z',
    1: '777z 111m 222m 333m 111p 2p',      // 三張白 ⇒ 能槓
    2: '456m 789m 456p 789p 123s 9s',
    3: '234s 567s 99s 1122z 3344z',
  })
  if (!ok) { check('★ 明槓:夾具擺得起來', false, '牌不夠'); return }
  const before = G.wall.length
  const flowBefore = G.flowers[1].length
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  check('能槓的人同時看得到槓與碰',
    G.react.opts[1].some((o) => o.type === 'kan') && G.react.opts[1].some((o) => o.type === 'pon'))
  api.declare(G, 1, { type: 'kan' })
  // ⚠ 牌牆不一定只少 1 張:補摸的那張若是花,要進花區再摸一張(0901 踩過,以為是 bug)
  const took = before - G.wall.length, gotFlowers = G.flowers[1].length - flowBefore
  check('★ 明槓:副露是 4 張、而且從**牌尾**補摸一張(摸到花會再補)',
    G.melds[1][0].kind === 'minkan' && G.melds[1][0].tiles.length === 4 &&
    G.drawn[1] !== null && took === 1 + gotFlowers,
    G.melds[1][0].kind + ' 牌牆 -' + took + ' 花 +' + gotFlowers)
  check('槓完掛上「槓上開花」旗標', G.kanBloom === true)
  check('槓完換他打牌(已經摸過,不是 mustDiscard)', G.turn === 1 && G.mustDiscard === false)
  check('明槓之後仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // 暗槓:自己手上四張
  const G = fresh()
  // ⚠ 要用 setupTable(它會先把四家的手牌全倒回牌牆);setSeatHand 只倒一家,
  //    四張一萬散在別人手上就撿不齊(0901 踩過:「牌不夠」)
  if (!setupTable(G, { 0: '1111m 234p 567p 234s 999s' }) || !giveDrawn(G, 0, '5p')) {
    check('★ 暗槓:夾具擺得起來', false, '牌不夠'); return
  }
  const opts = api.selfOptions(G, 0)
  check('★ 手上四張 ⇒ 看得到暗槓', opts.some((o) => o.type === 'ankan'), JSON.stringify(opts))
  api.applySelf(G, 0, opts.find((o) => o.type === 'ankan'))
  check('★ 暗槓成立、補摸尾牌、不必問別人(沒有搶槓)',
    G.melds[0][0].kind === 'ankan' && G.melds[0][0].tiles.length === 4 &&
    G.drawn[0] !== null && G.phase === 'play')
  check('暗槓之後仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // ★★ 加槓要先問搶槓 —— 唯一「動作先掛起、等仲裁」的情況
  const G = fresh()
  const ok = setupTable(G, {
    0: '123m 456m 789m 123p 456p 9s',      // 打五萬(在 456m 裡)
    1: '55m 123p 789p 234s 678s 9s 1z',    // 兩張五萬 ⇒ 能碰(刻意讓它胡不了)
    2: '234m 678m 234p 678p 345s 9s',
    3: '111z 222z 333z 444z 55z 66z',
  })
  if (!ok) { check('★ 搶槓:夾具擺得起來', false, '牌不夠'); return }
  api.playDiscard(G, 0, handIdx(G, 0, '5m'))
  api.declare(G, 1, { type: 'pon' })
  if (G.melds[1].length !== 1) { check('★ 搶槓:前置的碰要成立', false, JSON.stringify(G.melds.map((m) => m.length))); return }
  // 碰完之後才把二家換成「嵌張聽五萬」—— 碰的當下他還沒聽牌,搶槓才有機會發生
  setSeatHand(G, 2, '46m 789m 456p 789p 123s 11s')
  giveDrawn(G, 1, '5m')                    // 摸到第四張五萬
  const opts = api.selfOptions(G, 1)
  check('碰過之後摸到第四張 ⇒ 看得到加槓', opts.some((o) => o.type === 'addkan'), JSON.stringify(opts))
  api.applySelf(G, 1, opts.find((o) => o.type === 'addkan'))
  check('★★ 加槓要先問別人搶不搶,而且**只能胡、不能碰吃**',
    G.phase === 'react' && G.react.robKan === true &&
    G.react.opts[2].length === 1 && G.react.opts[2][0].type === 'hu',
    G.phase + ' ' + JSON.stringify(G.react ? G.react.opts.map((o) => o.map((x) => x.type)) : null))
  api.declare(G, 2, { type: 'hu' })
  check('★★ 搶槓成立:胡的人拿到,而且台數裡有「搶槓」',
    G.phase === 'win' && G.result.winners[0].seat === 2 &&
    G.result.winners[0].items.some((it) => it.name === '搶槓'),
    api.taiText({ ok: true, items: G.result.winners[0].items, tai: G.result.winners[0].tai }))
  check('搶槓之後仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // 沒人搶 ⇒ 加槓真的成立
  const G = fresh()
  setupTable(G, {
    0: '123m 456m 789m 123p 456p 9s', 1: '55m 123p 789p 234s 678s 9s 1z',
    2: '234m 678m 234p 678p 345s 9s', 3: '111z 222z 333z 444z 55z 66z',
  })
  api.playDiscard(G, 0, handIdx(G, 0, '5m'))
  api.declare(G, 1, { type: 'pon' })
  giveDrawn(G, 1, '5m')
  api.applySelf(G, 1, api.selfOptions(G, 1).find((o) => o.type === 'addkan'))
  check('★ 沒人搶得了 ⇒ 加槓直接成立、補摸尾牌',
    G.phase === 'play' && G.melds[1][0].kind === 'addkan' && G.melds[1][0].tiles.length === 4 &&
    G.drawn[1] !== null && G.kanBloom === true,
    G.phase + ' ' + G.melds[1][0].kind)
  check('加槓之後仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

// ══ M2-e. 結算與局數 ══
// 底 10 分 + 每台 5 分。自摸三家各付一份;放炮由放炮者一家付。
;(() => {
  const G = fresh({ opts: { multiRon: true, hands: 4 } })
  if (!setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' }) || !giveDrawn(G, 0, '7p')) {
    check('★ 自摸結算:夾具擺得起來', false, '牌不夠'); return
  }
  G.discards = 8; G.anyMeld = true            // 避開天胡/地胡,單純驗付錢
  api.doSelfWin(G, 0)
  const w = G.result.winners[0]
  check('★ 自摸:門清 1 + 自摸 1 + 不求人 1 + 莊家 1 = 4 台', w.tai === 4,
    api.taiText({ ok: true, items: w.items, tai: w.tai }))
  check('★ 分數 = 底 10 + 每台 5', w.score === api.SCORE.base + w.tai * api.SCORE.perTai, w.score)
  check('★★ 自摸:三家各付一份,贏家拿三份',
    G.scores[0] === w.score * 3 && G.scores[1] === -w.score &&
    G.scores[2] === -w.score && G.scores[3] === -w.score, G.scores.join('/'))
  check('分數零和(自摸)', G.scores.reduce((a, b) => a + b, 0) === 0, G.scores.join('/'))
  check('自摸之後仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
  // 莊家胡 ⇒ 連莊:莊不換、streak+1、局數照樣 +1
  const ok = api.nextHand(G)
  check('★ 莊家胡 ⇒ 連莊(莊不換,streak+1)',
    ok && G.dealer === 0 && G.streak === 1 && G.hand === 2, 'dealer' + G.dealer + ' streak' + G.streak + ' hand' + G.hand)
  check('開下一局之後還是 144 張', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // 放炮:只有放炮的那一家付
  const G = fresh({ opts: { multiRon: true, hands: 4 } })
  if (!setupTable(G, S_HU_VS_PON)) { check('★ 放炮結算:夾具擺得起來', false, '牌不夠'); return }
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  api.declare(G, 1, { type: 'pass' })
  api.declare(G, 2, { type: 'hu' })
  const w = G.result.winners[0]
  check('★★ 放炮:只有放炮的那一家付,其他兩家不動',
    G.scores[0] === -w.score && G.scores[2] === w.score && G.scores[1] === 0 && G.scores[3] === 0,
    G.scores.join('/'))
  check('分數零和(放炮)', G.scores.reduce((a, b) => a + b, 0) === 0)
  // 閒家胡 ⇒ 換莊
  api.nextHand(G)
  check('★ 閒家胡 ⇒ 換莊(莊往下家移、streak 歸零)',
    G.dealer === 1 && G.streak === 0 && G.hand === 2, 'dealer' + G.dealer + ' streak' + G.streak)
})()

;(() => {   // 局數上限:opts.hands 是「總共打幾局」,連莊也算一局 ⇒ 一定會結束
  const G = fresh({ opts: { multiRon: true, hands: 1 } })
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' })
  giveDrawn(G, 0, '7p')
  G.discards = 8
  api.doSelfWin(G, 0)
  check('★ 打滿設定的局數就結束(連莊也算一局,不會永遠打不完)',
    api.nextHand(G) === false && G.phase === 'over', G.phase)
})()

;(() => {   // 流局也連莊
  const R = runToEnd('wash-1', api.POLICY_PASS, { hands: 4 })
  const before = R.G.dealer
  check('★ 流局 ⇒ 連莊', R.G.phase === 'washout' && (api.nextHand(R.G), R.G.dealer === before && R.G.streak === 1),
    'dealer' + R.G.dealer + ' streak' + R.G.streak)
})()

// ══ M2-f. 讓電腦真的走一遍仲裁通道 ══
;(() => {
  // ★ 只跑 10 局:M3 起這是真 AI,一局約 0.8 秒。
  //   真正的量化比較(三級對打、胡牌率、放槍率)在 scripts/balance.mjs,不塞進 smoke。
  let bad = 0, wins = 0, washes = 0, melded = 0, kans = 0, maxSteps = 0
  const NB = 10
  for (let i = 0; i < NB; i++) {
    const r = runToEnd('ai-' + i, api.POLICY_AI, { hands: 1 })
    if (r.errs.length) { bad++; continue }
    if (r.G.phase === 'win') wins++
    else if (r.G.phase === 'washout') washes++
    else bad++                                   // 卡住了(既沒胡也沒流局)
    if (r.G.melds.some((m) => m.length)) melded++
    if (r.G.melds.some((m) => m.some((x) => x.kind !== 'chi' && x.kind !== 'pon'))) kans++
    if (r.steps > maxSteps) maxSteps = r.steps
    if (!api.conserve(r.G).ok) bad++
  }
  check('★★ 電腦 ' + NB + ' 局:零守恆破口、每一局都收得了尾(胡或流局)', bad === 0,
    bad + ' 局有問題;胡 ' + wins + ' / 流局 ' + washes)
  check('★ 仲裁通道真的被走過(有局出現吃碰槓)', melded >= NB - 2, melded + '/' + NB + ' 局有副露')
  check('★ 真 AI 真的會胡牌(M2 的隨機電腦幾乎都流局)', wins >= NB * 0.5, wins + '/' + NB + ' 局有人胡')
  check('步數有界(沒有無窮迴圈)', maxSteps < 400, '最多 ' + maxSteps + ' 步')
})()

;(() => {   // 同種子完全重現(含電腦的吃碰槓決策)
  const a = runToEnd('repro-1', api.POLICY_AI, { hands: 1 })
  const b = runToEnd('repro-1', api.POLICY_AI, { hands: 1 })
  const sig = (r) => r.G.phase + '|' + r.order.join() + '|' +
    r.G.melds.map((m) => m.map((x) => x.kind + x.i).join('.')).join('/') + '|' + r.G.scores.join()
  check('★ 同種子整局完全重現(含電腦的吃碰槓決策)', sig(a) === sig(b))
})()

// ══ M2-g. 玩家看得到什麼、按得動什麼 ══
// ★ humanActions 是唯一真相:renderer 照它畫鈕、game 照它執行 —— 畫得出來的就一定按得動。
;(() => {
  const G = fresh()
  setupTable(G, S_HU_VS_PON)
  check('不是我的回合、也沒人打牌 ⇒ 沒有任何鈕', api.humanActions(G, 1).length === 0)
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  const a1 = api.humanActions(G, 1).map((a) => a.label)
  const a2 = api.humanActions(G, 2).map((a) => a.label)
  check('能碰的人看到「碰 / 過」', a1.join('/') === '碰/過', a1.join('/'))
  check('能胡的人看到「胡 / 過」,而且胡是紅色的主鈕',
    a2.join('/') === '胡/過' && api.humanActions(G, 2)[0].hot === true, a2.join('/'))
  check('打牌的人自己沒有鈕', api.humanActions(G, 0).length === 0)
  api.declare(G, 1, { type: 'pass' })
  check('宣告過之後鈕就收起來', api.humanActions(G, 1).length === 0)
})()

;(() => {   // 自己回合的鈕:自摸 / 暗槓
  const G = fresh()
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' })
  giveDrawn(G, 0, '7p')
  const acts = api.humanActions(G, 0)
  check('摸到就能胡 ⇒ 看得到「自摸」', acts.some((a) => a.label === '自摸' && a.hot), acts.map((a) => a.label).join('/'))
  check('該我打牌了', api.canDiscardNow(G, 0) === true)
})()

;(() => {   // 碰完要打牌(沒摸牌也算「該我打牌」)
  const G = fresh()
  setupTable(G, S_HU_VS_PON)
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  api.declare(G, 1, { type: 'pon' }); api.declare(G, 2, { type: 'pass' })
  check('★ 碰完:沒摸牌但該他打牌', G.drawn[1] === null && api.canDiscardNow(G, 1) === true)
  check('react 進行中不可以打牌', (() => {
    const H = fresh(); setupTable(H, S_HU_VS_PON)
    api.playDiscard(H, 0, handIdx(H, 0, '7z'))
    return api.canDiscardNow(H, 1) === false && api.canDiscardNow(H, 0) === false
  })())
})()

;(() => {   // 動作列的框:最寬的情況也不出畫布、不壓到手牌
  const worst = ['胡', '槓', '碰', '吃 四萬五萬', '吃 三萬四萬', '吃 六萬七萬', '過']
  const L = api.actBarLayout(worst)
  const handTop = api.LAY.HAND_Y
  check('★ 動作列最寬的情況仍在畫布內',
    L.bar.x >= 0 && L.bar.x + L.bar.w <= api.CONFIG.LOGICAL_W,
    L.bar.x.toFixed(0) + '..' + (L.bar.x + L.bar.w).toFixed(0))
  check('★ 動作列不會壓到自家手牌', L.bar.y + L.bar.h <= handTop,
    (L.bar.y + L.bar.h) + ' vs 手牌 ' + handTop)
  check('動作列的鈕夠大(≥88×48 邏輯)', L.btns.every((b) => b.w >= 88 && b.h >= 48),
    L.btns.map((b) => b.w).join(','))
  check('動作列的鈕彼此不重疊', (() => {
    for (let i = 1; i < L.btns.length; i++) if (L.btns[i - 1].x + L.btns[i - 1].w > L.btns[i].x) return false
    return true
  })())
})()

;(() => {   // 設定會存進 localStorage,而且壞值會被擋掉
  api.saveOpts({ multiRon: false, hands: 16 })
  const a = api.loadOpts()
  check('★ 設定存得起來、讀得回來', a.multiRon === false && a.hands === 16, JSON.stringify(a))
  api.saveOpts({ multiRon: false, hands: 99 })
  check('★ 壞掉的局數會退回預設(不是 1/4/16 就不收)', api.loadOpts().hands === 4, api.loadOpts().hands)
  api.saveOpts({ multiRon: true, hands: 4 })
})()

// ══ M3-a. 向聽數 shanten ══
check('胡了(17 張整組)= -1 向聽', api.shanten(CNT('123m 456m 789m 123p 456p 77p'), 5) === -1)
check('聽牌(16 張)= 0 向聽', api.shanten(CNT('123m 456m 789m 123p 456p 7p'), 5) === 0)
check('四面子+將+搭子也是聽牌', api.shanten(CNT('123m 456m 789m 123p 45p 99s'), 5) === 0)
check('差一步 = 1 向聽', api.shanten(CNT('123m 456m 789m 123p 45p 9s 1z'), 5) === 1)
check('★ shanten 與 isHu 完全一致(同一副牌兩支不可以講不同話)', (() => {
  for (const h of [H17, '111m 222m 333m 444m 55m 222z', '111z 222z 555z 666z 777z 33z',
                   '123456789m 123456p 9s 3z', '111m 222m 333m 789p 789p 55s']) {
    const c = CNT(h)
    if ((api.shanten(c, 5) === -1) !== api.isHu(c, 5)) return false
  }
  return true
})())
check('★ 聽牌時,有效進張就等於「聽哪些牌」', (() => {
  const c = CNT('123m 456m 789m 123p 456p 7p')
  return api.usefulTiles(c, 5).join() === api.waits(c, 5).join()
})(), api.usefulTiles(CNT('123m 456m 789m 123p 456p 7p'), 5).map(api.idxName).join())
check('★ 有效進張列出來的,摸到都真的會降向聽', (() => {
  const c = CNT('123m 456m 789m 123p 45p 9s 1z')
  const s0 = api.shanten(c, 5)
  for (const u of api.usefulTiles(c, 5)) { c[u]++; const s1 = api.shanten(c, 5); c[u]--; if (s1 >= s0) return false }
  return true
})())
check('★ 沒列出來的,摸到都不會降向聽(沒有漏報)', (() => {
  const c = CNT('123m 456m 789m 123p 45p 9s 1z')
  const s0 = api.shanten(c, 5), good = new Set(api.usefulTiles(c, 5))
  for (let i = 0; i < 34; i++) {
    if (good.has(i) || c[i] >= 4) continue
    c[i]++; const s1 = api.shanten(c, 5); c[i]--
    if (s1 < s0) return false
  }
  return true
})())
check('bestShantenAfterDiscard:17 張打掉一張之後的最好結果',
  api.bestShantenAfterDiscard(CNT('123m 456m 789m 123p 456p 7p 1z'), 5) === 0)
check('★ 記憶化不改變結果(清掉快取重算一樣)', (() => {
  const c = CNT('123m 456m 789m 123p 45p 9s 1z')
  const a = api.shanten(c, 5); api.clearShantenCache(); const b = api.shanten(c, 5)
  return a === b
})())

// ══ M3-b. 檯面資訊(★ 只用看得到的,不偷看別人的手牌)══
;(() => {
  const G = fresh()
  setupTable(G, { 0: '111m 456m 789m 123p 456p 7z' })
  const left = api.leftCounts(G, 0)
  check('★ 自己手上三張一萬 ⇒ 檯面上只剩 1 張', left[api.kidx({ s: 'm', r: 1 })] === 1,
    left[api.kidx({ s: 'm', r: 1 })])
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  check('★ 打進牌河的牌也算現身', api.leftCounts(G, 1)[api.kidx({ s: 'z', r: 7 })] <= 3)
  const L4 = new Array(34).fill(4)
  check('危險度:中張 > 么九 > 字牌',
    api.dangerOf(api.kidx({ s: 'm', r: 5 }), L4) > api.dangerOf(api.kidx({ s: 'm', r: 1 }), L4) &&
    api.dangerOf(api.kidx({ s: 'm', r: 1 }), L4) > api.dangerOf(api.kidx({ s: 'z', r: 1 }), L4))
  check('已經現身越多張,越安全', (() => {
    const B = new Array(34).fill(4); B[4] = 1
    return api.dangerOf(4, B) < api.dangerOf(4, L4)
  })())
})()

// ══ M3-c. 該不該碰(★ 副露完必須打一張,要比的是打完之後)══
;(() => {
  const G = fresh()
  // 白白(將以外還有一對)+ 三組面子 + 搭子 ⇒ 碰白板明顯有益
  setupTable(G, { 0: '77z 99s 123m 456m 789m 12p 3s' })
  const gp = api.claimGain(G, 0, { type: 'pon', i: api.kidx({ s: 'z', r: 7 }) })
  check('★ 碰得到面子 ⇒ claimGain 為正', gp.gain > 0, JSON.stringify(gp))
  const H = fresh()
  // 已經聽牌的一手,碰九索反而把將拆了 ⇒ 不該碰
  setupTable(H, { 0: '123m 456m 789m 123p 45p 99s' })
  const gb = api.claimGain(H, 0, { type: 'pon', i: api.kidx({ s: 's', r: 9 }) })
  check('★ 碰了會拆掉好牌 ⇒ claimGain 不為正', gb.gain <= 0, JSON.stringify(gb))
  check('手上張數不夠的碰會被擋掉',
    api.claimGain(H, 0, { type: 'pon', i: api.kidx({ s: 'z', r: 5 }) }).gain === -99)
})()

// ══ M3-d. 打哪一張 / 💡 提示 ══
;(() => {
  const G = fresh()
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' })
  giveDrawn(G, 0, '1z')
  const cands = api.evalDiscards(G, 0, {})
  check('★ 評估的第一名向聽數是最小的',
    cands[0].shanten === Math.min.apply(null, cands.map((x) => x.shanten)), cands[0].shanten)
  check('★ 這一手該打孤張東風(打完就聽牌)',
    api.idxName(cands[0].i) === '東' && cands[0].shanten === 0,
    api.idxName(cands[0].i) + ' → ' + cands[0].shanten)
  const h = api.hintFor(G, 0)
  check('★★ 提示建議的那張不會讓向聽變差', h && h.shanten === cands[0].shanten,
    h && (api.idxName(h.i) + ' ' + h.shanten))
  check('★ 提示說得出「打哪張」與「等什麼」', h && h.text.includes('東') && h.text.includes('聽牌'), h && h.text)
  check('提示指得出手牌位置(slot 對得上)', (() => {
    if (!h) return false
    const t = h.slot < 0 ? G.drawn[0] : G.hands[0][h.slot]
    return t && api.kidx(t) === h.i
  })())
  check('不是我打牌的時候不給提示', api.hintFor(G, 1) === null)
})()

;(() => {
  const G = fresh()
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' })
  giveDrawn(G, 0, '1z')
  const labels = api.humanActions(G, 0).map((a) => a.label)
  check('★ 輪到我打牌時,按鈕列有「💡 提示」', labels.some((l) => l.indexOf('提示') >= 0), labels.join('/'))
})()

// ══ M3-e. 三級 ══
check('policyFor 回得出三級、壞值夾回範圍內',
  api.policyFor(0).name === '新手' && api.policyFor(1).name === '普通' &&
  api.policyFor(2).name === '老手' && api.policyFor(9).name === '老手')
check('設定層擋得掉壞掉的強度值', (() => {
  api.saveOpts({ multiRon: true, hands: 4, level: 7 })
  const ok = api.loadOpts().level === 1
  api.saveOpts({ multiRon: true, hands: 4, level: 1 })
  return ok
})())
;(() => {
  let bad = 0
  for (const p of [api.POLICY_EASY, api.POLICY_HARD]) {
    const r = runToEnd('lvl-' + p.name, p, { hands: 1 })
    if (r.errs.length || (r.G.phase !== 'win' && r.G.phase !== 'washout')) bad++
  }
  check('★ 新手與老手都跑得完一局、零守恆破口', bad === 0, bad)
})()
check('ℹ 三級的量化比較不在 smoke:跑 node scripts/balance.mjs(這裡只驗跑不跑得動)', true)

// ══ M4-a. 音效 ══
check('★ 麻將專屬音效都在(吃/碰/槓/胡/自摸/摸牌)',
  ['chi', 'pon', 'kan', 'hu', 'tsumo', 'draw'].every((k) => api.SFX._DEFS[k] && api.SFX._DEFS[k].length),
  Object.keys(api.SFX._DEFS).join(','))
check('每個音都聽得見(gain ≥ 0.15、長度 ≥ 0.03 秒)', (() => {
  for (const k of Object.keys(api.SFX._DEFS))
    for (const n of api.SFX._DEFS[k]) { if ((n[4] || 0.3) < 0.15 || n[2] < 0.03) return false }
  return true
})())
check('沒有 Web Audio 時靜默回 false(不報錯、不卡遊戲)', api.SFX.play('pon') === false)
check('不認得的音效名也是靜默回 false', api.SFX.play('沒有這個音') === false)

// ══ M4-b. 牌河依座位旋轉 ══
check('★ 四家牌河的朝向:下 0°、右 -90°、上 180°、左 90°',
  api.LAY.RIVER.map((o) => o.rot).join() === '0,-90,180,90', api.LAY.RIVER.map((o) => o.rot).join())
check('★ 橫放的那兩家,格子的寬高要互換', (() => {
  const G = fresh()
  const down = api.tilePos(G, 'river', 0, 0), right = api.tilePos(G, 'river', 1, 0)
  return down.w < down.h && right.w > right.h && down.w === right.h && down.h === right.w
})(), JSON.stringify([api.tilePos(fresh(), 'river', 0, 0), api.tilePos(fresh(), 'river', 1, 0)]))
check('牌河同一列相鄰不重疊、換行有往下', (() => {
  const G = fresh()
  for (let s2 = 0; s2 < 4; s2++) {
    const a = api.tilePos(G, 'river', s2, 0), b = api.tilePos(G, 'river', s2, 1)
    const cols = api.LAY.RIVER[s2].cols
    const nl = api.tilePos(G, 'river', s2, cols)
    if (b.x < a.x + a.w) return false
    if (nl.y < a.y + a.h) return false
  }
  return true
})())

// ══ M4-c. 倒牌:結算要留得住「為什麼是胡」 ══
;(() => {
  const G = fresh({ opts: { multiRon: true, hands: 4 } })
  if (!setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' }) || !giveDrawn(G, 0, '7p')) {
    check('★ 倒牌:夾具擺得起來', false, '牌不夠'); return
  }
  G.discards = 8; G.anyMeld = true
  api.doSelfWin(G, 0)
  const w = G.result.winners[0]
  check('★ 結算留下了胡牌者的手牌、副露與胡的那張',
    Array.isArray(w.hand) && Array.isArray(w.melds) && !!w.win, JSON.stringify(Object.keys(w)))
  check('★★ 倒牌攤開來剛好 17 張(16 手牌 + 胡的那張)', (() => {
    const n = w.hand.length + w.melds.reduce((a, m) => a + m.length, 0) + 1
    return n === 17
  })(), w.hand.length + ' + 副露 + 1')
  check('倒牌留的是快照,之後開下一局也不會被清掉', (() => {
    const before = w.hand.length
    api.nextHand(G)
    return w.hand.length === before && G.result === null
  })())
})()

;(() => {   // ★ 有槓的胡牌:一副槓是 4 張牌卻只算一副面子 ⇒ 倒牌是 17 + 槓數
  const G = fresh()
  const ok = setupTable(G, {
    0: '123m 456m 789m 123p 456p 7z',
    1: '777z 111m 222m 333m 111p 2p',      // 三張白 ⇒ 能槓
    2: '456m 789m 456p 789p 123s 9s',
    3: '234s 567s 99s 1122z 3344z',
  })
  if (!ok) { check('★ 槓的倒牌:夾具擺得起來', false, '牌不夠'); return }
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  api.declare(G, 1, { type: 'kan' })
  // 槓完換他打牌;直接把他換成一手可以自摸的牌(need 已經因為槓少一副)
  // ⚠ 槓完 need 少一副(5→4)⇒ 手牌是 13 張不是 16 張,摸一張才 14(= 3×4+2)。
  //    張數給錯就湊不出自摸(0902 踩過)。
  setSeatHand(G, 1, '123m 456m 789m 123p 1s')
  giveDrawn(G, 1, '1s')
  if (!api.selfOptions(G, 1).some((o) => o.type === 'tsumo')) {
    check('★ 槓的倒牌:湊得出自摸', false, '手牌沒成型'); return
  }
  api.applySelf(G, 1, api.selfOptions(G, 1).find((o) => o.type === 'tsumo'))
  const w = G.result.winners[0]
  const n = w.hand.length + w.melds.reduce((a, m) => a + m.length, 0) + 1
  const kongs = w.melds.filter((m) => m.length === 4).length
  check('★★ 有槓時倒牌是 17 + 槓數(槓佔 4 張卻只算一副面子)',
    kongs === 1 && n === 17 + kongs, n + ' 張 / ' + kongs + ' 槓')
  check('有槓的胡牌仍然 144 張守恆', api.conserve(G).ok, api.conserve(G).err)
})()

;(() => {   // 有副露的胡牌,倒牌一樣要湊滿 17 張
  const G = fresh()
  setupTable(G, S_HU_VS_PON)
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  api.declare(G, 1, { type: 'pass' })
  api.declare(G, 2, { type: 'hu' })
  const w = G.result.winners[0]
  const n = w.hand.length + w.melds.reduce((a, m) => a + m.length, 0) + 1
  check('★ 榮和的倒牌也是 17 張', n === 17, n)
})()

// ══ M4-d. 彩帶 ══
check('★ 使用者要求減少動態 ⇒ 一片紙花都不放',
  api.Confetti.start(true) === false && api.Confetti.ps.length === 0)
check('平常會放紙花', api.Confetti.start(false) === true && api.Confetti.ps.length > 40, api.Confetti.ps.length)
check('★ 紙花從**上方**進場(不是從中間爆開,那會蓋住結算成績)',
  api.Confetti.ps.every((p) => p.y < 0), api.Confetti.ps.filter((p) => p.y >= 0).length + ' 片在畫面內起跑')
check('★ 紙花會往下掉、掉出畫面就清掉(不會無限累積)', (() => {
  api.Confetti.start(false)
  const n0 = api.Confetti.ps.length
  for (let k = 0; k < 400; k++) api.Confetti.step(16)
  return n0 > 0 && api.Confetti.ps.length === 0
})(), api.Confetti.ps.length)
check('stop() 立刻清空', (() => { api.Confetti.start(false); api.Confetti.stop(); return api.Confetti.ps.length === 0 })())

// ══ M4-e. 🏆 成績榜 ══
;(() => {
  try { localStorage.removeItem('mj-runs') } catch { }
  check('沒有紀錄時 rankList 是空的、bestScore 回 null',
    api.rankList().length === 0 && api.bestScore() === null)
  const G = fresh({ opts: { multiRon: true, hands: 1, level: 2 } })
  G.scores = [120, -40, -40, -40]
  api.addRun(G)
  G.scores = [-30, 10, 10, 10]
  api.addRun(G)
  G.scores = [55, -20, -15, -20]
  api.addRun(G)
  const l = api.rankList()
  check('★ 一「場」記一筆,依我的分數由高到低排',
    l.length === 3 && l.map((r) => r.mine).join() === '120,55,-30', l.map((r) => r.mine).join())
  check('bestScore 是最高分', api.bestScore() === 120, api.bestScore())
  check('每一筆有記下當時的設定(局數/電腦強度)',
    l[0].hands === 1 && l[0].level === 2 && typeof l[0].at === 'number', JSON.stringify(l[0]))
  check('★ localStorage 裡的壞資料會被擋掉(不是自己寫的東西也可能在那)', (() => {
    try { localStorage.setItem('mj-runs', '{"not":"an array"}') } catch { }
    const a = api.readRuns().length === 0
    try { localStorage.setItem('mj-runs', '[{"mine":"很多"},{"at":1,"mine":7},null]') } catch { }
    const b = api.readRuns().length === 1
    try { localStorage.setItem('mj-runs', '這根本不是 JSON') } catch { }
    const c2 = api.readRuns().length === 0
    return a && b && c2
  })())
  check('★ 只留最近 50 筆(不會無限長大)', (() => {
    try { localStorage.removeItem('mj-runs') } catch { }
    const H = fresh({ opts: { multiRon: true, hands: 1, level: 1 } })
    for (let k = 0; k < 60; k++) { H.scores = [k, 0, 0, -k]; api.addRun(H) }
    return api.readRuns().length === 50
  })(), api.readRuns().length)
  check('★ 打滿局數 ⇒ 自動記一筆', (() => {
    try { localStorage.removeItem('mj-runs') } catch { }
    const H = fresh({ opts: { multiRon: true, hands: 1 } })
    setupTable(H, { 0: '123m 456m 789m 123p 456p 7p' })
    giveDrawn(H, 0, '7p')
    H.discards = 8
    api.doSelfWin(H, 0)
    api.nextHand(H)                       // hands=1 ⇒ 打完了
    return H.phase === 'over' && api.readRuns().length === 1
  })())
  try { localStorage.removeItem('mj-runs') } catch { }
})()

// ══ M5-a. 存檔續玩 ══
// ★ 一將 16 局要一小時,手機一定會被切走。存檔壞掉寧可重開,也不要帶著壞局繼續打。
const snapSig = (G) => [
  G.phase, G.turn, G.discards, G.hand, G.streak, G.dealer, G.scores.join(),
  G.wall.map((t) => t.id).join(),
  G.hands.map((h) => h.map((t) => t.id).join()).join('|'),
  G.drawn.map((t) => (t ? t.id : 'x')).join(),
  G.melds.map((ms) => ms.map((m) => m.kind + ':' + m.tiles.map((t) => t.id).join()).join('/')).join('|'),
  G.river.map((r) => r.map((t) => t.id).join()).join('|'),
  G.flowers.map((f) => f.map((t) => t.id).join()).join('|'),
].join('#')

// 找一個「進行中、而且有副露有牌河」的局面。
// ⚠ 不可以「跑固定步數就存檔」:真 AI 常常四十步內就有人胡了,存檔會變成「下一局」,
//    測試比的是兩個不同的東西(0902 踩過)。這裡跑到有料就停,而且會回報找不找得到。
function midGame() {
  for (const sd of ['sv1', 'sv2', 'sv3', 'sv4', 'sv5', 'sv6', 'sv7', 'sv8']) {
    const G = fresh({ seed: sd, opts: { multiRon: false, hands: 16 } })
    let k = 0
    while (k++ < 400 && (G.phase === 'play' || G.phase === 'react')) {
      if (G.discards >= 12 && G.melds.some((m) => m.length)) return G
      api.stepAuto(G, api.POLICY_NORMAL, -1)
    }
  }
  return null
}

;(() => {
  const G = midGame()
  check('★ 存檔:造得出「進行中且有副露」的局面(不是空跑)', !!G, G ? G.phase : '八個種子都沒撈到')
  if (!G) return
  const before = snapSig(G)
  const back = api.restoreG(api.serializeG(G))
  check('★★ 存檔讀回來是一模一樣的局面', !!back && snapSig(back) === before,
    back ? '有差' : 'restore 回 null')
  check('★ 讀回來仍然 144 張守恆', !!back && api.conserve(back).ok, back && api.conserve(back).err)
  check('讀回來的牌是**同一批** id(不是複製出來的新牌)',
    !!back && back.wall.every((t, i) => t.id === G.wall[i].id))
  check('設定跟著存檔一起回來', !!back && back.opts.hands === 16 && back.opts.multiRon === false,
    back && JSON.stringify(back.opts))
})()

;(() => {   // react 進行中被切走,回來還在等宣告
  const G = fresh()
  setupTable(G, S_HU_VS_PON)
  api.playDiscard(G, 0, handIdx(G, 0, '7z'))
  const back = api.restoreG(api.serializeG(G))
  check('★★ 在「等宣告」的當下被切走,回來還是在等宣告',
    !!back && back.phase === 'react' && !!back.react &&
    back.react.opts[2].some((o) => o.type === 'hu') && back.react.claim[3].type === 'pass',
    back && back.phase)
  check('react 存檔的那張牌也對得上', !!back && back.react.tile.id === G.react.tile.id)
  check('接著宣告下去照樣胡得成', (() => {
    if (!back) return false
    api.declare(back, 1, { type: 'pass' })
    api.declare(back, 2, { type: 'hu' })
    return back.phase === 'win' && api.conserve(back).ok
  })())
})()

;(() => {   // 結算畫面離開:比分留著,下次從下一局開始
  const G = fresh({ opts: { multiRon: true, hands: 4 } })
  setupTable(G, { 0: '123m 456m 789m 123p 456p 7p' })
  giveDrawn(G, 0, '7p')
  G.discards = 8
  api.doSelfWin(G, 0)
  const snap = api.serializeG(G)
  check('結算當下存檔不含進行中的牌局', snap.live === null)
  const back = api.restoreG(snap)
  check('★ 比分與局數留著,回來直接開新的一局',
    !!back && back.scores.join() === G.scores.join() && back.hand === G.hand &&
    (back.phase === 'play' || back.phase === 'react') && api.conserve(back).ok,
    back && (back.phase + ' 分數 ' + back.scores.join()))
})()

;(() => {   // 壞掉的存檔一律拒絕
  check('★ 存檔壞了寧可整份丟掉(空的/版本不對/分數不對/根本不是物件)',
    api.restoreG(null) === null && api.restoreG({}) === null &&
    api.restoreG({ v: 99, match: {} }) === null &&
    api.restoreG({ v: 1, match: { scores: [1, 2] } }) === null &&
    api.restoreG('這不是存檔') === null)
  check('★★ 湊不出 144 張的存檔一律拒絕(不要帶著壞局繼續打)', (() => {
    const G = fresh()
    const snap = api.serializeG(G)
    snap.live.wall = snap.live.wall.slice(0, 10)      // 少了一堆牌
    return api.restoreG(snap) === null
  })())
  check('存檔裡的壞設定會被夾回預設', (() => {
    const G = fresh()
    const snap = api.serializeG(G)
    snap.match.opts = { hands: 99, level: 7, multiRon: false }
    const back = api.restoreG(snap)
    return back && back.opts.hands === 4 && back.opts.level === 1 && back.opts.multiRon === false
  })())
})()

;(() => {   // saveState / loadState / clearState 走 localStorage 那一圈
  api.clearState()
  check('沒有存檔時 loadState 回 null', api.loadState() === null)
  const G = midGame()
  if (!G) { check('★ localStorage 存檔:造得出進行中的局面', false, '撈不到'); return }
  api.saveState(G)
  const back = api.loadState()
  check('★ 存進 localStorage 再讀回來,局面一致',
    !!back && snapSig(back) === snapSig(G), back ? '有差' : 'null')
  api.clearState()
  check('clearState 之後就讀不到了', api.loadState() === null)
  try { localStorage.setItem('mj-save', '這根本不是 JSON') } catch { }
  check('localStorage 裡是垃圾也不會炸', api.loadState() === null)
  api.clearState()
})()

// ══ F. 版面幾何(★ 判定=畫面:renderer 與 input 都吃 tilePos,這裡驗它自己不打架)══
// 0901 實錄:第一版左家花牌壓在自家手牌底下、右家花牌壓住版號文字 —— 靠肉眼看截圖才發現。
// 這一段就是把「肉眼」變成測試:滿載時每一塊區域兩兩不重疊、全部在畫布內。
// ★★ M5 起版面寬度會隨視窗比例伸縮 ⇒ **每個寬度都要各驗一次**。
//    只驗 960 等於沒驗到自適應 —— 手機是 1170、桌機常見 1280。
const H = api.CONFIG.LOGICAL_H
const hit = (a2, b2) => a2.x < b2.x + b2.w - 0.01 && b2.x < a2.x + a2.w - 0.01 &&
                        a2.y < b2.y + b2.h - 0.01 && b2.y < a2.y + a2.h - 0.01
const bboxOf = (rs) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// 造一個「最擠」的牌桌:四家都 16 張手牌 + 剛摸 1 張 + 5 副露(全是槓,20 張)+ 8 張花 + 牌河滿。
// 現實不會四家同時這樣,但版面必須撐得住最擠的單一家。
function crowdedTable() {
  const G = api.newGame({ seed: 'layout-1' })
  for (let s2 = 0; s2 < 4; s2++) {
    if (!G.drawn[s2]) G.drawn[s2] = G.hands[s2][0]
    G.melds[s2] = []
    for (let m = 0; m < 5; m++) G.melds[s2].push({ kind: 'minkan', i: 0, from: 1, tiles: [0, 0, 0, 0].map(() => ({ k: 'm1' })) })
    G.flowers[s2] = api.KINDS.filter((k) => k[0] === 'f').map((k) => ({ k }))
    G.river[s2] = new Array(api.LAY.RIVER[s2].cap).fill({ k: 'm1' })
  }
  return G
}

// 在某個畫布寬度下,把所有區塊撈出來檢查
function geomAt(W) {
  api.setLayoutWidth(W)
  const LW = api.LAY.W
  const G = crowdedTable()
  const inCanvas = (r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= LW + 0.01 && r.y + r.h <= H + 0.01
  const groups = []
  for (let s2 = 0; s2 < 4; s2++) {
    const g = (area, n) => {
      const rs = []
      for (let i = 0; i < n; i++) rs.push(api.tilePos(G, area, s2, i))
      if (area === 'hand') rs.push(api.tilePos(G, 'drawn', s2, 0))
      groups.push({ name: 'seat' + s2 + '.' + area, rects: rs, box: bboxOf(rs) })
    }
    g('hand', G.hands[s2].length)
    g('meld', api.meldTileCount(G, s2))
    g('flower', 8)
    g('river', api.LAY.RIVER[s2].cap)
    groups.push({ name: 'seat' + s2 + '.tag', rects: [api.tagRect(s2)], box: api.tagRect(s2) })
  }
  groups.push({ name: 'center', rects: [api.LAY.CENTER], box: api.LAY.CENTER })
  // ★ 左上角兩顆鈕也要驗:0901 第一版音效鈕被左家花牌蓋掉一半,只有截圖看得出來
  for (const id of Object.keys(api.LAY.BTN))
    groups.push({ name: 'btn.' + id, rects: [api.LAY.BTN[id]], box: api.LAY.BTN[id] })
  // 動作列最寬的情況(胡/槓/碰/三種吃/過)
  const actBar = api.actBarLayout(['胡', '槓', '碰', '吃 四萬五萬', '吃 三萬四萬', '吃 六萬七萬', '過']).bar

  const oob = []
  for (const g of groups) for (const r of g.rects) if (!inCanvas(r)) { oob.push(g.name); break }
  if (!inCanvas(actBar)) oob.push('actBar')
  const clash = []
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++)
    if (hit(groups[i].box, groups[j].box)) clash.push(groups[i].name + ' × ' + groups[j].name)
  const n = api.meldTileCount(G, 0)
  const lastMeld = api.tilePos(G, 'meld', 0, n - 1)
  return {
    LW, oob: [...new Set(oob)], clash, groups: groups.length, actBar,
    meldOver: lastMeld.x + lastMeld.w > api.LAY.MELD_RIGHT + 0.01,
    handW: api.LAY.HAND_W,
    actOverHand: actBar.y + actBar.h > api.LAY.HAND_Y,
  }
}

// 960 = 最窄(16:9)、1024 = 一般筆電、1170 = iPhone 橫向、1280 = 上限
const WIDTHS = [960, 1024, 1170, 1280]
const geo = WIDTHS.map(geomAt)
api.setLayoutWidth(960)

check('★★ 四種畫布寬度下,所有牌與框都在畫布內',
  geo.every((g) => g.oob.length === 0),
  geo.filter((g) => g.oob.length).map((g) => g.LW + ':' + g.oob.join(',')).join(' | '))
check('★★ 四種畫布寬度下,' + geo[0].groups + ' 塊區域都兩兩不重疊',
  geo.every((g) => g.clash.length === 0),
  geo.filter((g) => g.clash.length).map((g) => g.LW + ':' + g.clash.slice(0, 2).join('/')).join(' | '))
check('★ 動作列(最寬的情況)在每個寬度下都不壓到自家手牌',
  geo.every((g) => !g.actOverHand))
check('副露壓縮後不凸出右端(MELD_RIGHT)', geo.every((g) => !g.meldOver),
  geo.filter((g) => g.meldOver).map((g) => g.LW).join(','))

// ★ 自適應真的有把多出來的寬度給手牌 —— 沒有這條,版面改成相對式也是白改
check('★★ 畫布越寬,手牌越大(自適應真的有效)',
  geo[0].handW === 52 && geo[3].handW > geo[0].handW && geo[3].handW >= 68,
  geo.map((g) => g.LW + '→' + g.handW).join(' '))
check('★ iPhone 橫向(邏輯 1170)的手牌 ≥ 44 實體 px', (() => {
  const g = geo[2]                          // 852×393 ⇒ 邏輯寬 1170、scale = 393/540
  return g.handW * (393 / 540) >= 44
})(), (geo[2].handW * (393 / 540)).toFixed(1) + 'px')
check('★ 寬度會被夾在 ' + api.LAY_W_MIN + '~' + api.LAY_W_MAX + ' 之間', (() => {
  const a = api.setLayoutWidth(400).W, b = api.setLayoutWidth(4000).W
  api.setLayoutWidth(960)
  return a === api.LAY_W_MIN && b === api.LAY_W_MAX
})())
check('★ 同一個寬度算兩次結果一樣(純函式)', (() => {
  const a = JSON.stringify(api.layoutFor(1170)), b = JSON.stringify(api.layoutFor(1170))
  return a === b
})())

// 正常一副牌(沒副露沒花)下的相鄰與命中
const Gn = api.newGame({ seed: 'layout-2' })
const ov = []
for (let i = 1; i < Gn.hands[0].length; i++)
  if (hit(api.tilePos(Gn, 'hand', 0, i - 1), api.tilePos(Gn, 'hand', 0, i))) ov.push(i)
if (hit(api.tilePos(Gn, 'hand', 0, 15), api.tilePos(Gn, 'drawn', 0, 0))) ov.push('drawn')
check('自家 16 張手牌 + 剛摸那張:相鄰不重疊', ov.length === 0, ov.join(','))

let miss = []
for (let i = 0; i < Gn.hands[0].length; i++) {
  const r = api.tilePos(Gn, 'hand', 0, i)
  const h = api.handHit(Gn, r.x + r.w / 2, r.y + r.h / 2)
  if (!h || h.i !== i) miss.push(i)
}
const dr = api.tilePos(Gn, 'drawn', 0, 0)
const dh = api.handHit(Gn, dr.x + dr.w / 2, dr.y + dr.h / 2)
check('★★ handHit 反查每一張手牌都對得上(判定=畫面)', miss.length === 0 && dh && dh.i === -1, miss.join(','))
check('點空白處不會誤判成打牌', api.handHit(Gn, 480, 250) === null)
check('960 寬時手牌 52(那是 17 張排得進去的最大值)', api.LAY.HAND_W === 52, api.LAY.HAND_W)
check('17 張手牌排完兩邊還有邊距', (() => {
  const r0 = api.tilePos(Gn, 'hand', 0, 0), rd = api.tilePos(Gn, 'drawn', 0, 0)
  return r0.x >= 8 && rd.x + rd.w <= api.LAY.W - 8
})(), (() => { const r0 = api.tilePos(Gn, 'hand', 0, 0); return '左邊距 ' + r0.x.toFixed(1) })())
check('★ 座位牌在自己那一側(上家的牌在上、下家的在下)', (() => {
  const C = api.LAY.CENTER
  const t = [0, 1, 2, 3].map((s2) => api.tagRect(s2))
  return t[0].y > C.y + C.h && t[2].y + t[2].h < C.y &&   // 下=自己在框下方、上=對家在框上方
         t[3].x + t[3].w < C.x && t[1].x > C.x + C.w      // 左=上家在框左邊、右=下家在框右邊
})())

// ══ G. 檔案對賬 ══
const swTxt = readFileSync(join(ROOT, 'sw.js'), 'utf8')
const htmlTxt = readFileSync(join(ROOT, 'index.html'), 'utf8')
const verNum = (api.CONFIG.VERSION.match(/v[\d.]+/) || [''])[0]
const cacheNum = (swTxt.match(/CACHE = 'majiang-(v[\d.]+)'/) || ['', ''])[1]
check('★ config.js 的 VERSION 與 sw.js 的 CACHE 版號同步', verNum === cacheNum, verNum + ' vs ' + cacheNum)
const srcFiles = ['config', 'tiles', 'rules/hu', 'rules/shanten', 'rules/meld', 'rules/score',
  'table', 'ai', 'sfx', 'confetti', 'game', 'renderer', 'input'].map((f) => 'src/' + f + '.js')
const missSw = srcFiles.filter((f) => !swTxt.includes(f))
check('★ sw.js 的 CORE 涵蓋所有 src 檔(少一個 = 離線白畫面)', missSw.length === 0, missSw.join(','))
const assets = ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']
check('★ sw.js 的 CORE 也涵蓋圖示與 manifest', assets.every((f) => swTxt.includes(f)),
  assets.filter((f) => !swTxt.includes(f)).join(','))
check('★ PNG 圖示真的存在(iOS 主畫面不吃 SVG)', (() => {
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
    try { if (readFileSync(join(ROOT, f)).length < 500) return false } catch { return false }
  }
  return true
})())
check('★ index.html 有 apple-touch-icon(iOS 靠它)', htmlTxt.includes('apple-touch-icon'))
check('★ manifest 有 PNG 圖示與 landscape', (() => {
  const mf = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'))
  return mf.orientation === 'landscape' && mf.icons.some((i) => i.type === 'image/png')
})())
check('★ 強制橫式三件組都在(manifest + 直向蓋版 + 手勢中進全螢幕)',
  htmlTxt.includes('goFullscreen') && htmlTxt.includes('id="rotate"') && htmlTxt.includes('orientation'))
const missHtml = srcFiles.filter((f) => !htmlTxt.includes(f))
check('★ index.html 載入所有 src 檔', missHtml.length === 0, missHtml.join(','))
check('index.html 有直向轉橫提示(16 張手牌直向塞不下)', htmlTxt.includes('id="rotate"'))

// ══ 輸出 ══
const pass = results.filter((r) => r.ok).length
for (const r of results) console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.detail && !r.ok ? '  → ' + r.detail : ''))
console.log('\n' + (pass === results.length ? '🟢' : '🔴') + ' ' + pass + '/' + results.length + ' 通過')
process.exit(pass === results.length ? 0 : 1)
