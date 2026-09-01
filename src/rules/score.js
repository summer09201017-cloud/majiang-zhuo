// 台數計算 —— 純函式 + golden cases(smoke 裡)。
//
// ★★ v1 精簡台數表的設計原則(2026-09-01 使用者拍板「最簡單好算」):
//    **凡是需要知道「你聽的是什麼形狀」的台,一律不採。**
//    被切掉的:平胡、獨聽、單吊、邊張、嵌張 —— 它們是整張表裡唯一逼你另寫一套
//    「回推聽牌型」邏輯的項目,而且各地定義最不一致(平胡要不要門清?將能不能是字牌?)。
//    剩下每一項都只看兩種東西:①拆好的牌型　②怎麼胡的旗標。
// ★ 花牌只算張數,每張 1 台 —— 八張自然就是 8 台,「八仙過海」不必另立規則。
// ★ 三元刻/門風/圈風各 1 台**照算**,大小三元四喜另外加(台灣多數牌桌的打法,
//   而且少一條排除規則就少一個 bug)。
// ★ 整張表**唯一一條排除規則**:三/四/五暗刻取最高。其餘全部由定義互斥。
const TAI = {
  自摸: 1, 門清: 1, 不求人: 1,
  門風: 1, 圈風: 1, 三元刻: 1,
  槓上開花: 1, 海底撈月: 1, 河底撈魚: 1, 搶槓: 1,
  三暗刻: 2, 四暗刻: 5, 五暗刻: 8,
  碰碰胡: 4, 混一色: 4, 小三元: 4, 混老頭: 4,
  清一色: 8, 大三元: 8, 小四喜: 8,
  字一色: 16, 大四喜: 16, 清老頭: 16, 地胡: 16,
  天胡: 24,
}

// 對「一種分解」算台。sets = 5 副面子 [{ t, i, open, kan }],pair = 將牌索引。
function scoreOne(sets, pair, ctx) {
  const items = []
  const add = (name, tai) => { if (tai > 0) items.push({ name, tai }) }

  // ── ① 怎麼胡的(旗標)──
  if (ctx.selfDraw) add('自摸', TAI.自摸)
  if (ctx.concealed) add('門清', TAI.門清)
  if (ctx.concealed && ctx.selfDraw) add('不求人', TAI.不求人)
  if (ctx.kanBloom) add('槓上開花', TAI.槓上開花)
  if (ctx.lastTile) add(ctx.selfDraw ? '海底撈月' : '河底撈魚', 1)
  if (ctx.robKan) add('搶槓', TAI.搶槓)
  if (ctx.flowers > 0) add('花牌 ' + ctx.flowers + ' 張', ctx.flowers)
  if (ctx.heavenly) add('天胡', TAI.天胡)
  if (ctx.earthly) add('地胡', TAI.地胡)
  if (ctx.isDealer) add('莊家連 ' + ctx.streak + ' 拉 ' + ctx.streak, 2 * ctx.streak + 1)

  // ── ② 牌型 ──
  const kes = sets.filter((s) => s.t === 'ke')
  const hasKe = (i) => kes.some((k) => k.i === i)

  if (hasKe(27 + ctx.seatWind)) add('門風 ' + WIND_CH[ctx.seatWind], TAI.門風)
  if (hasKe(27 + ctx.prevalent)) add('圈風 ' + WIND_CH[ctx.prevalent], TAI.圈風)
  if (hasKe(31)) add('中', TAI.三元刻)
  if (hasKe(32)) add('發', TAI.三元刻)
  if (hasKe(33)) add('白', TAI.三元刻)

  // ★ 唯一的排除規則:暗刻取最高一項
  const an = kes.filter((k) => !k.open).length
  if (an >= 5) add('五暗刻', TAI.五暗刻)
  else if (an === 4) add('四暗刻', TAI.四暗刻)
  else if (an === 3) add('三暗刻', TAI.三暗刻)

  if (kes.length === 5) add('碰碰胡', TAI.碰碰胡)

  // 花色:順子不跨門,標起始牌那一門就夠
  const used = new Set()
  for (const s of sets) used.add(idxIsHonor(s.i) ? 'z' : idxSuit(s.i))
  used.add(idxIsHonor(pair) ? 'z' : idxSuit(pair))
  const suits = [...used].filter((x) => x !== 'z')
  if (suits.length === 0) add('字一色', TAI.字一色)
  else if (suits.length === 1) {
    if (used.has('z')) add('混一色', TAI.混一色)
    else add('清一色', TAI.清一色)
  }

  // 三元 / 四喜:由定義互斥,不必寫排除規則
  const dragons = [31, 32, 33].filter(hasKe).length
  if (dragons === 3) add('大三元', TAI.大三元)
  else if (dragons === 2 && pair >= 31) add('小三元', TAI.小三元)
  const winds = [27, 28, 29, 30].filter(hasKe).length
  if (winds === 4) add('大四喜', TAI.大四喜)
  else if (winds === 3 && pair >= 27 && pair <= 30) add('小四喜', TAI.小四喜)

  // 老頭:混老頭刻意定義成「同時有么九數牌與字牌」⇒ 自動跟清老頭、字一色互斥
  if (kes.length === 5) {
    const all = sets.map((s) => s.i).concat([pair])
    if (all.every(idxIsYaoJiu)) {
      const term = all.some(idxIsTerminal), hon = all.some(idxIsHonor)
      if (term && !hon) add('清老頭', TAI.清老頭)
      else if (term && hon) add('混老頭', TAI.混老頭)
    }
  }

  let tai = 0
  for (const it of items) tai += it.tai
  return { tai, items }
}

// 算一手胡牌值幾台。
//   ctx = {
//     hand: [tile],      暗牌,★ 不含胡的那張、不含副露、不含花
//     win:  tile,        胡的那張
//     melds:[{kind,i,from}]   副露(見 meld.js)
//     flowers: n,        花牌張數
//     selfDraw, kanBloom, lastTile, robKan, heavenly, earthly   旗標
//     seatWind, prevalent, isDealer, streak
//   }
// 回傳 { ok, tai, items, sets, pair }。ok=false 表示這手根本不成胡牌型。
//
// ★ 同一手牌常常有好幾種拆法(順子拆法 vs 刻子拆法),台數不一樣 ——
//   這裡每一種都算、**取最高的那一種**(對玩家有利,也是牌桌慣例)。
function scoreHand(ctx) {
  const melds = ctx.melds || []
  const need = 5 - melds.length
  const cs = toCounts(ctx.hand.concat([ctx.win]))
  const decomps = decompose(cs, need)
  if (!decomps.length) return { ok: false, tai: 0, items: [] }

  const flags = {
    selfDraw: !!ctx.selfDraw, kanBloom: !!ctx.kanBloom, lastTile: !!ctx.lastTile,
    robKan: !!ctx.robKan, heavenly: !!ctx.heavenly, earthly: !!ctx.earthly,
    isDealer: !!ctx.isDealer, streak: ctx.streak || 0, flowers: ctx.flowers || 0,
    seatWind: ctx.seatWind || 0, prevalent: ctx.prevalent || 0,
    concealed: isConcealed(melds),        // ★ 暗槓不破門清(見 meld.js)
  }
  const winIdx = kidx(ctx.win)

  let best = null
  for (const d of decomps) {
    // ★ 每一輪都重建副露的 set 物件:下面會就地改 open,共用同一份會汙染下一輪
    const sets = melds.map(meldToSet)
      .concat(d.sets.map((s) => ({ t: s.t, i: s.i, open: false, kan: false })))
    // ★ 食胡補成的刻子算明刻(影響暗刻數):榮和時,胡的那張所在的暗刻標為明。
    //   暗槓不受影響 —— 它不可能是被人放槍補成的,所以濾掉 kan。
    if (!flags.selfDraw) {
      const k = sets.find((s) => s.t === 'ke' && s.i === winIdx && !s.open && !s.kan)
      if (k) k.open = true
    }
    const r = scoreOne(sets, d.pair, flags)
    if (!best || r.tai > best.tai) best = { tai: r.tai, items: r.items, sets, pair: d.pair }
  }
  return { ok: true, tai: best.tai, items: best.items, sets: best.sets, pair: best.pair }
}

// 給畫面用的一行字:「門清(1) + 自摸(1) + 不求人(1) + 碰碰胡(4) = 7 台」
// ★ 台數一律用括號:項目名稱裡本來就有數字(「花牌 3 張」「莊家連 2 拉 2」),
//   用空白分隔會變成「花牌 3 張 3」,讀的人分不出哪個是台數。
function taiText(r) {
  if (!r || !r.ok) return '未成胡'
  if (!r.items.length) return '0 台'
  return r.items.map((it) => it.name + '(' + it.tai + ')').join(' + ') + ' = ' + r.tai + ' 台'
}
