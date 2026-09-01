// 量化驗收:三級電腦真的有差嗎?
// 用法:node scripts/balance.mjs [每級局數]      (預設 40;跑一局約 0.8 秒)
//
// ★ 難度旋鈕最容易出的錯是「接上去了但沒有效果」—— 三級都一樣強,測試還全綠。
//   這支就是防這件事:把待測的那一級放在**座位 0**,另外三家固定「普通」,
//   跑同一批種子,比胡牌率與平均得分。老手贏不過新手 = 旋鈕沒接上。
// ★ 同一批種子給三級跑,牌是一樣的 —— 差別只會來自決策。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = ['config', 'tiles', 'rules/hu', 'rules/shanten', 'rules/meld', 'rules/score', 'table', 'ai']
const code = SRC.map((f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8')).join(NL)
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)) },
    removeItem: (k) => { mem.delete(String(k)) }, clear: () => mem.clear(),
  }
}
const api = new Function(code + NL + '; return { newGame, stepAuto, conserve, handCounts, needOf, shanten,' +
  ' POLICY_EASY, POLICY_NORMAL, POLICY_HARD, AI_LEVELS, clearShantenCache }')()

const N = Math.max(4, +(process.argv[2] || 40))
const LEVELS = [api.POLICY_EASY, api.POLICY_NORMAL, api.POLICY_HARD]

function playOne(seed, seat0) {
  const pol = [seat0, api.POLICY_NORMAL, api.POLICY_NORMAL, api.POLICY_NORMAL]
  const G = api.newGame({ seed, opts: { multiRon: true, hands: 1, level: 1 } })
  let steps = 0
  while ((G.phase === 'play' || G.phase === 'react') && steps++ < 4000) {
    if (!api.stepAuto(G, pol, -1)) break
    if (!api.conserve(G).ok) return { bad: true }
  }
  const won = G.phase === 'win' && G.result.winners.some((w) => w.seat === 0)
  const dealt = G.phase === 'win' && !G.result.selfDraw && G.result.from === 0
  const tai = won ? G.result.winners.find((w) => w.seat === 0).tai : 0
  // 收場時座位 0 還差幾步(沒胡的話,越小代表打得越靠近)
  const sh = api.shanten(api.handCounts(G, 0), api.needOf(G, 0))
  return { won, dealt, tai, score: G.scores[0], sh, wash: G.phase === 'washout' }
}

const rows = []
for (let L = 0; L < 3; L++) {
  const t0 = Date.now()
  api.clearShantenCache()   // ★ 各級從冷快取起跑,耗時才比得出來
  let won = 0, dealt = 0, tai = 0, score = 0, sh = 0, wash = 0, bad = 0
  for (let i = 0; i < N; i++) {
    const r = playOne('bal-' + i, LEVELS[L])
    if (r.bad) { bad++; continue }
    if (r.won) { won++; tai += r.tai }
    if (r.dealt) dealt++
    if (r.wash) wash++
    score += r.score
    sh += r.sh
  }
  rows.push({
    name: api.AI_LEVELS[L], won, dealt, wash, bad,
    winRate: won / N, avgTai: won ? tai / won : 0, avgScore: score / N, avgSh: sh / N,
    ms: Date.now() - t0,
  })
}

const pct = (x) => (x * 100).toFixed(0) + '%'
console.log('每級 ' + N + ' 局,座位 0 是待測的那一級,另外三家固定「普通」,三級跑同一批種子')
console.log('')
console.log('  等級    胡牌率   放槍率   平均台數   平均得分   收場向聽   耗時')
for (const r of rows) {
  console.log('  ' + r.name.padEnd(6, '　') +
    pct(r.winRate).padStart(6) + pct(r.dealt / N).padStart(9) +
    r.avgTai.toFixed(1).padStart(10) + r.avgScore.toFixed(1).padStart(11) +
    r.avgSh.toFixed(2).padStart(11) + (r.ms / 1000).toFixed(1).padStart(8) + 's')
}
const [e, n, h] = rows
const bad = rows.reduce((a, r) => a + r.bad, 0)
console.log('')
// ★ 只釘「真的存在、樣本再大也在」的差距。
//   老手 vs 普通 在**點數**上目前是打平(N=80 量過),硬要斷言只會做出一條會亂閃的測試 ——
//   那比沒有測試更糟。這裡只報數字,不假裝有差。
const checks = [
  ['零守恆破口', bad === 0, bad + ' 局壞掉'],
  ['新手明顯最弱:收場向聽比另外兩級都高', e.avgSh > n.avgSh + 0.4 && e.avgSh > h.avgSh + 0.4,
    e.avgSh.toFixed(2) + ' vs ' + n.avgSh.toFixed(2) + ' / ' + h.avgSh.toFixed(2)],
  ['新手明顯最弱:平均得分是負的、另外兩級不是', e.avgScore < 0 && n.avgScore > e.avgScore && h.avgScore > e.avgScore,
    e.avgScore.toFixed(1) + ' vs ' + n.avgScore.toFixed(1) + ' / ' + h.avgScore.toFixed(1)],
  ['會看進張的兩級都真的會胡牌(不是空轉)', n.winRate > 0.1 && h.winRate > 0.1,
    pct(n.winRate) + ' / ' + pct(h.winRate)],
]
let ok = true
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✅ ' : '  ❌ ') + name + (pass ? '' : '  → ' + detail))
  if (!pass) ok = false
}
console.log('')
console.log('  ℹ 老手 vs 普通:老手向聽低、胡牌率高,但**點數上目前打平** —— 這是現況,不是 bug。')
console.log('    根因:這一版沒有振聽/過水,「安全牌」訊號很弱(risk 240/190/110 三組都量過,放槍率不降)。')
console.log('')
console.log((ok ? '🟢 難度旋鈕真的接上了(新手 vs 會看進張的兩級,差距穩定)'
                : '🔴 難度旋鈕看起來沒接上(或樣本太小,試 node scripts/balance.mjs 120)'))
process.exit(ok ? 0 : 1)
