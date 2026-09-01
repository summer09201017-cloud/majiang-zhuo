// 電腦與 💡提示 —— ★ 只用「檯面上看得到的資訊」,不偷看別人的手牌。
//
// ★★ 提示絕不可以是純貪心(skill solitaire-solver-kit 第〇節;0831 新接龍、0901 蜘蛛接龍
//    已經犯過兩次)。這裡看的不是「這張現在有沒有用」,而是
//    「打掉它之後,這手牌還能怎麼進步」—— 向聽數 × 有效進張種類 × 場上還剩幾張;
//    前幾名再往前多看一步,避免被帶進死路。

const AI_LEVELS = ['新手', '普通', '老手']

// ★★ 誠實記帳(2026-09-01,node scripts/balance.mjs 80 實測,座位 0 對三家「普通」):
//      新手  胡 8%  放槍 23%  收場向聽 1.91  平均得分 -9.1
//      普通  胡 24% 放槍 18%  收場向聽 0.61  平均得分 +2.6
//      老手  胡 28% 放槍 23%  收場向聽 0.50  平均得分 +1.1
//    ⇒ 新手明顯最弱(這一級的差距很穩、樣本再大也在)。
//    ⇒ **老手比普通「快」(向聽低、胡牌率高),但點數上打平** —— 這是現況,不要假裝有差。
//    根因:台灣麻將這一版沒有振聽/過水 ⇒ 「安全牌」沒有硬保證,統計上的危險度訊號很弱,
//    避險權重調高只會拖慢速度、放槍率不降(risk 240 / 190 / 110 三組都量過,都一樣)。
//    真要讓老手在點數上贏,需要的是「從別人的牌河反推聽牌型」與「推/收的期望值計算」——
//    那是另一個量級的工程,不是調權重。roadmap 有記。

// 每一種牌檯面上還沒現身幾張(自己手上 + 四家副露 + 四家牌河 都算現身)。
// ★ 一次算好 34 格,不要在迴圈裡重複掃 —— 一次決策會問上百次。
function leftCounts(G, seat) {
  const left = new Array(34).fill(4)
  const c = handCounts(G, seat)
  for (let i = 0; i < 34; i++) left[i] -= c[i]
  for (let s = 0; s < 4; s++) {
    for (const m of G.melds[s]) for (const t of m.tiles) left[kidx(t)]--
    for (const t of G.river[s]) left[kidx(t)]--
  }
  for (let i = 0; i < 34; i++) if (left[i] < 0) left[i] = 0
  return left
}

// 危險度 0~1。中張最容易被順子等到、字牌最安全;已經現身越多張越安全。
// ★ 台灣麻將這一版沒有振聽/過水規則 ⇒ 「現物」不保證安全,只能用統計上的危險度。
const DANGER_BY_RANK = [0.55, 0.72, 0.88, 1, 1, 1, 0.88, 0.72, 0.55]
function dangerOf(i, left) {
  const base = idxIsHonor(i) ? 0.3 : DANGER_BY_RANK[i % 9]
  return base * (left[i] / 4)
}

// 場面壓力:別人副露越多、牌牆越少,越該打安全牌
function tablePressure(G, seat) {
  let melds = 0
  for (let s = 0; s < 4; s++) if (s !== seat) melds += G.melds[s].length
  const late = 1 - Math.min(1, G.wall.length / 60)
  return Math.min(1, melds * 0.16 + late * 0.6)
}

// 這一手的「台數潛力」—— 只給老手用。
// ★ 為什麼需要它:台灣麻將這一版沒有振聽/過水,「安全牌」的統計訊號很弱
//   (2026-09-01 量化實測:老手把權重全押在避險上,放槍率跟普通一樣 17%,速度卻掉了)。
//   真正拉得開差距的是**打點**:同花色集中(混/清一色)、手上握著有台的字牌。
function valueOf(c, G, seat) {
  let m = 0, p = 0, s = 0
  for (let i = 0; i < 9; i++) m += c[i]
  for (let i = 9; i < 18; i++) p += c[i]
  for (let i = 18; i < 27; i++) s += c[i]
  const num = m + p + s
  const conc = num ? Math.max(m, p, s) / num : 0        // 0.33=三門平均 1=清一色
  let honors = 0
  for (const i of [31, 32, 33, 27 + seatWind(G, seat), 27 + G.prevalent]) {
    if (c[i] >= 3) honors += 2
    else if (c[i] === 2) honors += 1
  }
  return conc * 26 + honors * 10
}

// 評估「打哪一張」。回傳依好壞排序的候選:
//   { i, shanten, kinds, width, danger, score }
//   shanten = 打掉它之後還差幾步   kinds = 之後的有效進張種類   width = 那些牌檯面上還剩幾張
// ★ usefulTiles 很貴(每次約 2.4ms):第一輪只算向聽數挑出最好的一批,第二輪才算進張。
function evalDiscards(G, seat, opt) {
  opt = opt || {}
  const need = needOf(G, seat)
  const c = handCounts(G, seat)
  const left = opt.left || leftCounts(G, seat)
  const cands = []
  for (let i = 0; i < 34; i++) if (c[i] > 0) cands.push({ i })

  let bestSh = 99
  for (const cd of cands) {
    c[cd.i]--
    cd.shanten = shanten(c, need)
    c[cd.i]++
    if (cd.shanten < bestSh) bestSh = cd.shanten
  }
  const margin = opt.wide ? 1 : 0
  for (const cd of cands) {
    cd.danger = dangerOf(cd.i, left)
    if (cd.shanten > bestSh + margin) { cd.kinds = []; cd.width = 0; continue }
    c[cd.i]--
    cd.kinds = usefulTiles(c, need)
    c[cd.i]++
    cd.width = cd.kinds.reduce((n, x) => n + left[x], 0)
  }
  const risk = opt.risk || 0, valueW = opt.valueW || 0
  for (const cd of cands) {
    cd.value = 0
    if (valueW && cd.kinds.length) {
      c[cd.i]--
      cd.value = valueOf(c, G, seat)
      c[cd.i]++
    }
    cd.score = -cd.shanten * 1000 + cd.width * 4 - cd.danger * risk + cd.value * valueW
  }
  cands.sort((a, b) => b.score - a.score || a.danger - b.danger || a.i - b.i)
  return cands
}

// 碰/吃/槓之後會不會更好?回傳 { before, after, gain } —— gain > 0 = 值得。
// ★ 副露完**必須打一張**,所以要比的是「打完之後」的向聽數,不是副露當下的。
// ★ 手牌張數有兩種型態:3N+1(輪不到我,16 張)與 3N+2(剛摸完,17 張)。
//   算錯型態向聽數就整個歪掉 —— 這裡一律用實際張數判斷,不用「現在輪到誰」去猜。
function shantenOfForm(c, need) {
  const n = countTotal(c)
  if (n === need * 3 + 2) return bestShantenAfterDiscard(c, need)   // 剛摸完,要打一張
  if (n === need * 3 + 1) return shanten(c, need)                   // 輪不到我
  return 99      // ★ 張數不對就是有人算錯了,回一個明顯壞的值,別靜靜給出看起來合理的垃圾
}
function claimGain(G, seat, o) {
  const need = needOf(G, seat)
  const c = handCounts(G, seat)
  const before = shantenOfForm(c, need)
  // 加槓用掉手上 1 張,但那一組**本來就已經算是面子**(碰過了)⇒ need 不變
  const isAdd = o.type === 'addkan'
  const use = o.type === 'chi' ? o.use.slice()
    : o.type === 'ankan' ? [o.i, o.i, o.i, o.i]
    : isAdd ? [o.i]
    : (o.type === 'kan' || o.type === 'minkan') ? [o.i, o.i, o.i]
    : [o.i, o.i]
  const taken = []
  for (const x of use) {
    if (!c[x]) { for (const y of taken) c[y]++; return { before, after: 99, gain: -99 } }
    c[x]--; taken.push(x)
  }
  const after = shantenOfForm(c, isAdd ? need : need - 1)
  for (const y of taken) c[y]++
  return { before, after, gain: before - after }
}

// 想打某一種牌時,那張在手上的哪個位置(-1 = 剛摸的那張)
function handSlotOf(G, seat, i) {
  if (G.drawn[seat] && kidx(G.drawn[seat]) === i) return -1
  const k = G.hands[seat].findIndex((t) => kidx(t) === i)
  return k >= 0 ? k : 0
}

// ══ 三級電腦 ══
// 差別只在三件事:看不看有效進張、避不避危險牌、碰吃挑不挑。
//   0 新手:只看向聽數,不看進張、不避險,還會有四分之一機率挑錯 —— 陪小孩玩的那一級
//   1 普通:看進張、輕微避險,碰吃只要不變差就碰
//   2 老手:看進張 + 認真避險(隨場面壓力調整),碰吃要真的更好才動
function makePolicy(level) {
  const L = Math.max(0, Math.min(2, level | 0))
  return {
    level: L,
    name: AI_LEVELS[L],

    react(G, seat, opts) {
      const pick = (t) => opts.find((o) => o.type === t)
      if (pick('hu')) return pick('hu')                        // 能胡一定胡
      const kan = pick('kan')
      if (kan && (L < 2 || claimGain(G, seat, kan).gain >= 0)) return kan
      const pon = pick('pon')
      if (pon) {
        const big = pon.i === 31 || pon.i === 32 || pon.i === 33 ||
          pon.i === 27 + seatWind(G, seat) || pon.i === 27 + G.prevalent   // 三元/自風/圈風 有台
        if (L === 0) { if (big || G._rnd() < 0.35) return pon }
        else {
          const g = claimGain(G, seat, pon).gain
          if (g > 0 || (g === 0 && big) || (g === 0 && L === 1 && G._rnd() < 0.5)) return pon
        }
      }
      const chis = opts.filter((o) => o.type === 'chi')
      if (chis.length) {
        if (L === 0) { if (G._rnd() < 0.3) return chis[(G._rnd() * chis.length) | 0] }
        else {
          let best = null, bg = 0
          for (const ch of chis) { const g = claimGain(G, seat, ch).gain; if (g > bg) { bg = g; best = ch } }
          if (best) return best
        }
      }
      return { type: 'pass' }
    },

    self(G, seat, opts) {
      const t = opts.find((o) => o.type === 'tsumo')
      if (t) return t                                          // 能自摸一定自摸
      const k = opts.find((o) => o.type === 'ankan' || o.type === 'addkan')
      if (k && (L < 2 || claimGain(G, seat, k).gain >= 0)) return k
      return null
    },

    discard(G, seat) {
      // 老手:避險權重刻意壓低(訊號弱),差距靠打點拉開 —— 這組數字是 balance.mjs 量出來的
      // 老手的權重是 balance.mjs 量出來的(2026-09-01,N=80):
      //   胡牌率 28%(最高)、收場向聽 0.50(最低)。避險權重刻意壓低 —— 見下面那段誠實記帳。
      const risk = L === 0 ? 0 : L === 1 ? 40 : 110 * tablePressure(G, seat)
      const valueW = L === 2 ? 1.2 : 0
      const cands = evalDiscards(G, seat, { risk, valueW })
      if (L > 0) return handSlotOf(G, seat, cands[0].i)
      // 新手:只看向聽數,同分亂挑;還有四分之一機率整個挑錯
      const bestSh = Math.min.apply(null, cands.map((x) => x.shanten))
      const tie = cands.filter((x) => x.shanten === bestSh)
      let want = tie[(G._rnd() * tie.length) | 0].i
      if (G._rnd() < 0.25) want = cands[(G._rnd() * cands.length) | 0].i
      return handSlotOf(G, seat, want)
    },
  }
}
const POLICY_EASY = makePolicy(0), POLICY_NORMAL = makePolicy(1), POLICY_HARD = makePolicy(2)
const POLICY_AI = POLICY_NORMAL
const policyFor = (level) => [POLICY_EASY, POLICY_NORMAL, POLICY_HARD][Math.max(0, Math.min(2, level | 0))]

// ══ 💡 提示 ══
// ★★ 絕不是純貪心。兩層:
//    第一層 挑「打完之後向聽數最好、有效進張最寬」的幾張;
//    第二層 對前幾名再往前看一步 —— 摸到那些有效張之後,平均還能留下多寬的進張。
//    只看第一層會被「現在最寬、下一步卻卡死」的牌騙走(接龍那兩次踩的就是這個)。
// 深看前 2 名、每名試最多 6 種進張;再加一道**時間預算** ——
// 早巡候選多的時候第二層會膨脹(實測有一次跑到 1.3 秒,按下去會頓)。
// ★ 預算用完只是「少看一層」,第一層的排序照樣有效 ⇒ 文案不會因此說謊。
const HINT = { top: 2, probe: 6, budgetMs: 220 }

// 摸到一張之後,最好的打法還能留下多寬的進張
function deepWidth(c, need, left) {
  let bestSh = 99
  for (let i = 0; i < 34; i++) {
    if (!c[i]) continue
    c[i]--; const s = shanten(c, need); c[i]++
    if (s < bestSh) bestSh = s
  }
  let bestW = 0
  for (let i = 0; i < 34; i++) {
    if (!c[i]) continue
    c[i]--
    if (shanten(c, need) === bestSh) {
      let w = 0
      for (const x of usefulTiles(c, need)) w += left[x]
      if (w > bestW) bestW = w
    }
    c[i]++
  }
  return bestW
}

function hintFor(G, seat) {
  if (seat == null) seat = 0
  if (!canDiscardNow(G, seat)) return null
  const need = needOf(G, seat)
  const left = leftCounts(G, seat)
  const pressure = tablePressure(G, seat)
  const cands = evalDiscards(G, seat, { left, risk: 60 * pressure, wide: true })
  const c = handCounts(G, seat)

  const top = cands.slice(0, HINT.top)
  const t0 = Date.now()
  for (const cd of top) {
    cd.deep = 0
    if (cd.shanten <= 0 || !cd.kinds.length) continue      // 已經聽牌就沒有下一步好看的了
    const probe = cd.kinds.filter((k) => left[k] > 0)
      .sort((a, b) => left[b] - left[a]).slice(0, HINT.probe)
    let sum = 0, w = 0
    c[cd.i]--
    for (const u of probe) {
      if (Date.now() - t0 > HINT.budgetMs) break           // 預算用完:只用第一層,不硬撐
      c[u]++
      sum += deepWidth(c, need, left) * left[u]
      w += left[u]
      c[u]--
    }
    c[cd.i]++
    cd.deep = w ? sum / w : 0
  }
  top.sort((a, b) => (a.shanten - b.shanten) || (b.width + b.deep * 0.5) - (a.width + a.deep * 0.5) ||
    (a.danger - b.danger))
  const p = top[0]
  if (!p) return null

  const names = p.kinds.filter((k) => left[k] > 0).sort((a, b) => left[b] - left[a])
  const show = names.slice(0, 5).map(idxName).join('、') + (names.length > 5 ? '…' : '')
  let text
  if (p.shanten <= 0) {
    text = '打「' + idxName(p.i) + '」就聽牌了! 等 ' + show + '(還有 ' + p.width + ' 張)'
  } else if (!p.width) {
    text = '打「' + idxName(p.i) + '」—— 這一手還差 ' + p.shanten + ' 步,想要的牌檯面上都出完了'
  } else {
    text = '打「' + idxName(p.i) + '」最好:還差 ' + p.shanten + ' 步,進 ' + show + ' 共 ' + p.width + ' 張'
  }
  if (pressure > 0.45 && p.danger > 0.6) {
    const safe = cands.filter((x) => x.shanten <= p.shanten + 1).sort((a, b) => a.danger - b.danger)[0]
    if (safe && safe.i !== p.i) text += '　⚠ 場上像有人聽牌了,想保守就打「' + idxName(safe.i) + '」'
  }
  return { i: p.i, slot: handSlotOf(G, seat, p.i), text, shanten: p.shanten, width: p.width }
}
