// 胡牌型分解 —— 純函式,不碰 DOM。node 直跑。
//
// ★★ 台灣 16 張的胡牌型**只有一種**:5 副面子 + 1 對將。
//    沒有七對子(那是 13 張玩法,16 張湊不出來)、沒有十三么 ⇒ 判定沒有任何特例分支。
//    這是 v1 台數表刻意換來的最大簡化,見 roadmap §7。
//
// 牌一律換成 34 格計數再算:0..8 一~九萬、9..17 筒、18..26 條、27..33 東南西北中發白。
// 花牌不進來(它們在花區,只算張數)。

const KIDX = { m: 0, p: 9, s: 18, z: 27 }
const kidx = (t) => KIDX[t.s] + t.r - 1
const idxSuit = (i) => (i < 9 ? 'm' : i < 18 ? 'p' : i < 27 ? 's' : 'z')
const idxIsHonor = (i) => i >= 27
const idxIsTerminal = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8)   // 么九數牌
const idxIsYaoJiu = (i) => idxIsHonor(i) || idxIsTerminal(i)
const idxName = (i) => (idxIsHonor(i) ? HONOR_CH[i - 26] : NUM_CH[(i % 9) + 1] + SUIT_CH[idxSuit(i)])

function toCounts(tiles) {
  const c = new Array(34).fill(0)
  for (const t of tiles) if (t.s !== 'f') c[kidx(t)]++
  return c
}
function countTotal(c) { let n = 0; for (let i = 0; i < 34; i++) n += c[i]; return n }

// 從 34 格計數拆出「need 副面子 + 1 對將」的**所有**不同分解(通常只有 1~3 種)。
// ★ 為什麼要全部:同一手牌常常既拆得出順子也拆得出刻子,台數不一樣 ——
//   score.js 會每一種都算一次、取最高的那一種(對玩家有利,也是牌桌慣例)。
// ★ 唯一性:每一層都從「還剩牌的最小索引」開始處理,所以同一組面子只會被產生一次。
function decompose(counts, need) {
  const c = counts.slice()
  if (countTotal(c) !== need * 3 + 2) return []
  const out = []
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue
    c[p] -= 2
    huWalk(c, need, [], (sets) => out.push({ pair: p, sets: sets.map((s) => ({ t: s.t, i: s.i })) }))
    c[p] += 2
  }
  return out
}

function huWalk(c, need, sets, emit) {
  if (need === 0) {
    for (let k = 0; k < 34; k++) if (c[k]) return    // 有剩牌 = 這條路不通
    emit(sets)
    return
  }
  let i = 0
  while (i < 34 && c[i] === 0) i++
  if (i >= 34) return
  if (c[i] >= 3) {                                   // 刻子
    c[i] -= 3; sets.push({ t: 'ke', i })
    huWalk(c, need - 1, sets, emit)
    sets.pop(); c[i] += 3
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {   // 順子:只有數牌,且不跨門
    c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ t: 'shun', i })
    huWalk(c, need - 1, sets, emit)
    sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++
  }
}

const isHu = (counts, need) => decompose(counts, need).length > 0

// 加上第 i 張牌能不能胡?(M2 判「這張放槍了沒」、M3 算有效進張都走這支)
function canWinWith(counts, need, i) {
  if (counts[i] >= 4) return false
  const c = counts.slice()
  c[i]++
  return isHu(c, need)
}

// 聽哪些牌?回傳索引陣列。★ 只管牌型;「場上還剩幾張」是 M3 的事。
function waits(counts, need) {
  const out = []
  for (let i = 0; i < 34; i++) if (canWinWith(counts, need, i)) out.push(i)
  return out
}
