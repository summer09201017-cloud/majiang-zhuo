// 吃 / 碰 / 槓的**合法性** —— 純函式。
// ★ 這裡只回答「能不能」。誰先誰後(胡 > 槓/碰 > 吃、只有下家能吃)是 M2 的仲裁狀態機,
//   不要在這裡偷做,否則規則會散成兩份。
//
// 副露一律長這樣:{ kind, i, from }
//   kind: 'chi'(順子,i = 起始牌) | 'pon' | 'minkan'(別人打的明槓) | 'ankan'(暗槓) | 'addkan'(碰後加槓)
//   i   : 刻子/順子起始的 34 格索引     from: 這張牌是誰打的(暗槓沒有)
// ★ 暗槓**不破門清**、且算暗刻;明槓/加槓算明刻。scoreHand 靠 meldToSet 讀這件事。

const canPon = (counts, i) => counts[i] >= 2
const canMinkan = (counts, i) => counts[i] >= 3            // 別人打出、手上已有 3 張

// 暗槓:手上自己就有 4 張
function ankanOptions(counts) {
  const out = []
  for (let i = 0; i < 34; i++) if (counts[i] === 4) out.push(i)
  return out
}

// 加槓:已經碰過的那一種,手上又摸到第 4 張
function addkanOptions(counts, melds) {
  const out = []
  for (const m of melds) if (m.kind === 'pon' && counts[m.i] >= 1) out.push(m.i)
  return out
}

// 吃:只有數牌、只有下家能吃(誰能吃由 M2 把關)。回傳「要從手上出哪兩張」的所有組合。
function chiOptions(counts, i) {
  if (i >= 27) return []
  const r = i % 9, out = []
  if (r >= 2 && counts[i - 2] > 0 && counts[i - 1] > 0) out.push([i - 2, i - 1])   // 吃在上家:_ _ i
  if (r >= 1 && r <= 7 && counts[i - 1] > 0 && counts[i + 1] > 0) out.push([i - 1, i + 1]) // 嵌在中間
  if (r <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) out.push([i + 1, i + 2])   // i _ _
  return out
}

// 副露 → 算台用的面子。★ 門清與暗刻都靠這裡的 open 判斷,只有這一份。
function meldToSet(m) {
  if (m.kind === 'chi') return { t: 'shun', i: m.i, open: true, kan: false }
  const kan = m.kind === 'minkan' || m.kind === 'ankan' || m.kind === 'addkan'
  return { t: 'ke', i: m.i, open: m.kind !== 'ankan', kan }
}

// 門清 = 完全沒有「明」的副露。★ 暗槓不破門清。
const isConcealed = (melds) => melds.every((m) => m.kind === 'ankan')
