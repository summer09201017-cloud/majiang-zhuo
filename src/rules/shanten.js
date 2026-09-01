// 向聽數(shanten)與有效進張 —— 純函式,不碰 DOM。AI 的大腦,也是 💡提示的來源。
//
// ★ 向聽數 = 還差幾張才聽牌。-1 = 已經胡了、0 = 聽牌、3 = 還差三步。
// ★ 台灣 16 張要湊「need 副面子 + 1 對將」(need = 5 - 副露數)。公式(日麻通用式的推廣):
//       shanten = 2*need - 2*m - p        m=已成面子數  p=搭子數(含對子)
//     受限於 m + p ≤ need + 1(面子 need 個 + 將 1 個,總共這麼多「格子」);
//     若 m + p 剛好填滿而**一個對子都沒有** ⇒ 還缺將,+1。
//   驗算:17 張整組(m=5,p=1 那個對子) ⇒ 10-10-1 = -1 ✓
//         16 張五副面子單吊(m=5,p=0) ⇒ 10-10-0 = 0 ✓(聽牌)
//         16 張四副面子+將+搭子(m=4,p=2) ⇒ 10-8-2 = 0 ✓

// 在 34 格計數裡,窮舉「面子 / 對子 / 搭子」的所有拆法,最大化 2m+p。
// ★ 每個索引只走兩條路:「這裡剩下的牌都不用了,前進」或「用它組一塊,原地再來」——
//   這樣同一種拆法只會被走到一次,搜尋樹才不會爆。
// ★ 記憶化:shanten 是 (counts, need) 的純函式,同一個牌型在一次 AI 決策裡會被問上百次
//   (有效進張要試 34 張、提示還要往前多看一步)。加了這層,提示從 ~590ms 降到可以按。
//   純函式 ⇒ 不需要失效機制,只要別讓它無限長大。
const _shCache = new Map()
const SH_CACHE_MAX = 300000

function shanten(counts, need) {
  const key = counts.join(',') + '|' + need
  const hit = _shCache.get(key)
  if (hit !== undefined) return hit
  const r = shantenCalc(counts, need)
  if (_shCache.size >= SH_CACHE_MAX) _shCache.clear()
  _shCache.set(key, r)
  return r
}

const clearShantenCache = () => _shCache.clear()

function shantenCalc(counts, need) {
  const c = counts.slice()
  const cap = need + 1
  let best = 99

  const dfs = (i0, m, p, hasPair) => {
    let i = i0
    while (i < 34 && c[i] === 0) i++
    if (i >= 34) {
      let sh = 2 * need - 2 * m - p
      if (m + p === cap && !hasPair) sh += 1        // 格子填滿了卻沒有將
      if (sh < best) best = sh
      return
    }
    // ① 這一格剩下的牌都不用
    const keep = c[i]
    c[i] = 0
    dfs(i + 1, m, p, hasPair)
    c[i] = keep
    // ② 用它組一塊(格子還沒滿才行)
    if (m + p >= cap) return
    if (c[i] >= 3) { c[i] -= 3; dfs(i, m + 1, p, hasPair); c[i] += 3 }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, m + 1, p, hasPair); c[i]++; c[i + 1]++; c[i + 2]++
    }
    if (c[i] >= 2) { c[i] -= 2; dfs(i, m, p + 1, true); c[i] += 2 }          // 對子
    if (i < 27 && i % 9 <= 7 && c[i + 1]) {                                   // 兩面 / 邊張
      c[i]--; c[i + 1]--; dfs(i, m, p + 1, hasPair); c[i]++; c[i + 1]++
    }
    if (i < 27 && i % 9 <= 6 && c[i + 2]) {                                   // 嵌張
      c[i]--; c[i + 2]--; dfs(i, m, p + 1, hasPair); c[i]++; c[i + 2]++
    }
  }
  dfs(0, 0, 0, false)
  return best
}

// 有效進張:摸到哪些牌會讓向聽數下降。★ 只看牌型;「場上還剩幾張」由 remainingOf 另外算。
function usefulTiles(counts, need) {
  const s = shanten(counts, need)
  const out = []
  const c = counts.slice()
  for (let i = 0; i < 34; i++) {
    if (c[i] >= 4) continue
    c[i]++
    if (shanten(c, need) < s) out.push(i)
    c[i]--
  }
  return out
}

// 聽牌了嗎?(向聽數 0 = 再摸一張對的就胡)
const isTenpai = (counts, need) => shanten(counts, need) === 0

// 3N+2 張的手牌(剛摸完、剛碰吃完)打掉一張之後,最好能到幾向聽?
// ★ 「該不該碰」與「該打哪一張」都靠這一支:碰完必須打一張,不比較打完的結果就是自欺。
function bestShantenAfterDiscard(counts, need) {
  const c = counts.slice()
  let best = 99
  for (let i = 0; i < 34; i++) {
    if (!c[i]) continue
    c[i]--
    const s = shanten(c, need)
    c[i]++
    if (s < best) best = s
  }
  return best
}
