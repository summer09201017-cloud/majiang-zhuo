// 畫牌桌 —— 只讀狀態、不改狀態。
// ★ 判定=畫面:牌的位置一律問 tiles.js 的 tilePos;按鈕的框一律 push 進 renderer.btns
//   (game.js 用 btnAt 對同一份座標判定)。
// ★ 鎖橫向:邏輯畫布固定 960×540,縮放置中,letterbox 的邊也鋪綠呢不留黑框。

const renderer = {
  cv: null, ctx: null, game: null,
  scale: 1, ox: 0, oy: 0, dpr: 1,
  view: { W: LAY.W, H: CONFIG.LOGICAL_H },
  btns: [],

  init(cv, game) {
    this.cv = cv
    this.ctx = cv.getContext('2d')
    this.game = game
    window.addEventListener('resize', () => this.resize())
    this.resize()
  },

  resize() {
    const ww = window.innerWidth, wh = window.innerHeight
    // ★★ 邏輯畫布的**寬度**隨視窗比例伸縮(高度永遠 540):
    //   這樣寬螢幕不會 letterbox,縮放就等於 wh/540,多出來的寬度全給手牌。
    //   (手機橫向的縮放本來就由高度決定 —— 想讓牌變大,只能把邏輯畫布變寬。)
    setLayoutWidth((540 * ww) / Math.max(1, wh))
    this.view = { W: LAY.W, H: CONFIG.LOGICAL_H }
    if (this.game) this.game.fly = null      // 飛牌記的是絕對座標,換版面就作廢
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.cv.width = Math.round(ww * this.dpr)
    this.cv.height = Math.round(wh * this.dpr)
    this.cv.style.width = ww + 'px'
    this.cv.style.height = wh + 'px'
    this.scale = Math.min(ww / this.view.W, wh / this.view.H)
    this.ox = (ww - this.view.W * this.scale) / 2
    this.oy = (wh - this.view.H * this.scale) / 2
  },

  toLogical(cx, cy) {
    const r = this.cv.getBoundingClientRect()
    return { x: (cx - r.left - this.ox) / this.scale, y: (cy - r.top - this.oy) / this.scale }
  },

  btnAt(x, y) {
    return this.btns.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null
  },

  // ── 元件 ──
  rr(x0, y0, w, h, r) { rrPath(this.ctx, x0, y0, w, h, r) },

  pill(id, x0, y0, w, h, label, opt) {
    const c = this.ctx
    this.rr(x0, y0, w, h, h / 2)
    c.fillStyle = (opt && opt.bg) || 'rgba(0,0,0,.28)'
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,.32)'; c.lineWidth = 1; c.stroke()
    c.fillStyle = '#fff'
    c.font = ((opt && opt.font) || 15) + 'px ' + FONT
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(label, x0 + w / 2, y0 + h / 2 + 0.5)
    this.btns.push({ id, x: x0, y: y0, w, h })
  },

  // 把 100×136 的牌面快取畫進一個矩形;rot 是左右家「橫放」用的
  img(im, r, rot, alpha) {
    const c = this.ctx
    c.save()
    if (alpha != null) c.globalAlpha = alpha
    c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 4; c.shadowOffsetY = 2
    if (rot) {
      c.translate(r.x + r.w / 2, r.y + r.h / 2)
      c.rotate((rot * Math.PI) / 180)
      // ★ ±90 才要把寬高互換;180 度的框本來就是直的,換了會畫成壓扁的牌
      const swap = rot === 90 || rot === -90
      const w = swap ? r.h : r.w, h = swap ? r.w : r.h
      c.drawImage(im, -w / 2, -h / 2, w, h)
    } else {
      c.drawImage(im, r.x, r.y, r.w, r.h)
    }
    c.restore()
  },

  // ── 主入口 ──
  draw(game) {
    const c = this.ctx
    const G = game.G
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const ww = this.cv.width / this.dpr, wh = this.cv.height / this.dpr
    const g = c.createRadialGradient(ww / 2, wh / 2, 80, ww / 2, wh / 2, Math.max(ww, wh) * 0.78)
    g.addColorStop(0, '#1a6b3c'); g.addColorStop(1, '#0a3520')
    c.fillStyle = g; c.fillRect(0, 0, ww, wh)
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy)
    this.btns = []
    if (!G) return
    this.drawSeats(game, G)
    this.drawCenter(game, G)
    this.drawTopBar(game, G)
    if (G.msg) this.msgBar(G.msg)
    this.drawFly(game)
    this.drawHint(game, G)
    this.drawActions(game, G)
    if (G.phase === 'win' || G.phase === 'washout' || G.phase === 'over') this.drawResult(game, G)
    if (game.panel === 'set') this.drawSettings(game, G)
    if (game.panel === 'rank') this.drawRank(game, G)
    Confetti.draw(c)          // ★ 最後畫:紙花從上方灑下、蓋在最上層,但它一直在動不會擋住讀字
  },

  // 剛打出去的那張牌飛進牌河(純觀感,不參與任何判定)
  drawFly(game) {
    const f = game.fly
    if (!f) return
    const p = Math.min(1, (performance.now() - f.t0) / f.dur)
    const e = 1 - (1 - p) * (1 - p)                          // ease-out
    this.img(face(f.k), {
      x: f.from.x + (f.to.x - f.from.x) * e,
      y: f.from.y + (f.to.y - f.from.y) * e,
      w: f.to.w, h: f.to.h,
    }, LAY.RIVER[f.seat].rot)
  },

  drawSeats(game, G) {
    const ROT = [0, -90, 0, 90]     // 下 / 右 / 上 / 左
    for (let s = 0; s < 4; s++) {
      const rot = ROT[s]
      // 牌河
      const f = game.fly
      for (let i = 0; i < G.river[s].length && i < LAY.RIVER[s].cap; i++) {
        if (f && f.seat === s && f.idx === i) continue      // 正在飛的那張由 drawFly 畫
        this.img(face(G.river[s][i].k), tilePos(G, 'river', s, i), LAY.RIVER[s].rot)
      }
      // 副露(對家畫正的,看得懂比擬真重要)
      let mi = 0
      for (const m of G.melds[s]) for (const t of m.tiles)
        this.img(face(t.k), tilePos(G, 'meld', s, mi++), rot)
      // ✨ 副露剛成立:最後那一組外圈亮一下(700ms 淡出)。純觀感;算的是同一份 tilePos ⇒ 框一定套在牌上。
      const fl = game.flash
      if (fl && fl.seat === s && G.melds[s].length) {
        const p = Math.min(1, (performance.now() - fl.t0) / fl.dur)
        const last = G.melds[s][G.melds[s].length - 1]
        const n = last.tiles.length
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let k = mi - n; k < mi; k++) {
          const r = tilePos(G, 'meld', s, k)
          x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
        }
        if (Number.isFinite(x0)) {
          const c = this.ctx
          c.save()
          c.globalAlpha = (1 - p) * 0.95
          this.rr(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10, 8)
          c.strokeStyle = '#ffd34d'; c.lineWidth = 4 + (1 - p) * 4; c.stroke()
          c.restore()
        }
      }
      // 花牌區
      for (let i = 0; i < G.flowers[s].length; i++)
        this.img(face(G.flowers[s][i].k), tilePos(G, 'flower', s, i), rot)
      // 手牌
      if (s === 0) this.drawMyHand(game, G)
      else {
        for (let i = 0; i < G.hands[s].length; i++)
          this.img(back(), tilePos(G, 'hand', s, i), rot)
        if (G.drawn[s]) this.img(back(), tilePos(G, 'drawn', s, 0), rot)
      }
      this.seatTag(G, s)
    }
    // 最後打出的那張:黃框標一下,眼睛跟得上
    if (G.last) {
      const s = G.last.seat, i = G.river[s].length - 1
      if (i >= 0 && i < LAY.RIVER[s].cap) {
        const r = tilePos(G, 'river', s, i)
        const c = this.ctx
        this.rr(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 6)
        c.strokeStyle = '#ffd34d'; c.lineWidth = 2.5; c.stroke()
      }
    }
  },

  drawMyHand(game, G) {
    const c = this.ctx
    const my = G.turn === 0 && G.phase === 'play' && G.drawn[0]
    for (let i = 0; i < G.hands[0].length; i++) {
      const r = tilePos(G, 'hand', 0, i)
      const lift = my && game.hover === i ? 8 : 0
      this.img(face(G.hands[0][i].k), { x: r.x, y: r.y - lift, w: r.w, h: r.h }, 0)
    }
    // 💡 提示標在建議的那一張上(黃框),文字在動作列上方
    const hs = game.hint ? game.hint.slot : -99
    if (hs >= 0 && hs < G.hands[0].length) {
      const r = tilePos(G, 'hand', 0, hs)
      const lift = my && game.hover === hs ? 8 : 0
      this.rr(r.x - 3, r.y - lift - 3, r.w + 6, r.h + 6, 8)
      c.strokeStyle = '#ffd34d'; c.lineWidth = 3; c.stroke()
    }
    if (G.drawn[0]) {
      const r = tilePos(G, 'drawn', 0, 0)
      // 🎴 剛摸進來抬一下:260ms 內從 +16px 落回原位(ease-out);hover 的 8px 照舊疊上去。純觀感,tilePos 不動 ⇒ 點得到的位置不變。
      const la = game.lift ? Math.max(0, 1 - (performance.now() - game.lift.t0) / game.lift.dur) : 0
      const lift = (my && game.hover === -1 ? 8 : 0) + Math.round(la * la * 16)
      this.img(face(G.drawn[0].k), { x: r.x, y: r.y - lift, w: r.w, h: r.h }, 0)
      if (hs === -1) {                       // 提示建議打的就是剛摸的那張
        this.rr(r.x - 3, r.y - lift - 3, r.w + 6, r.h + 6, 8)
        c.strokeStyle = '#ffd34d'; c.lineWidth = 3; c.stroke()
      }
      // 剛摸的那張標個點,一眼看出是新牌
      c.fillStyle = '#ffd34d'
      c.beginPath(); c.arc(r.x + r.w / 2, r.y - lift - 7, 4, 0, 7); c.fill()
    }
  },

  // 座位牌:風位 + 是誰 + 輪到誰。★ 框由 tiles.js 的 tagRect 給(smoke 驗它不壓到任何東西)
  seatTag(G, s) {
    const c = this.ctx
    const r = tagRect(s)
    const label = WIND_CH[seatWind(G, s)] + (s === G.dealer ? '莊' : '') + ' ' + SEAT_NAME[s]
    const on = G.turn === s && G.phase === 'play'
    this.rr(r.x, r.y, r.w, r.h, r.h / 2)
    c.fillStyle = on ? 'rgba(255,211,77,.94)' : 'rgba(0,0,0,.38)'
    c.fill()
    c.strokeStyle = on ? '#fff5cc' : 'rgba(255,255,255,.22)'
    c.lineWidth = on ? 2 : 1
    c.stroke()
    c.fillStyle = on ? '#3a2a00' : '#dbe9e0'
    c.font = 'bold ' + (r.w < 90 ? 13 : 14) + 'px ' + FONT
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5)
  },

  // 中央資訊框
  drawCenter(game, G) {
    const c = this.ctx, B = LAY.CENTER
    this.rr(B.x, B.y, B.w, B.h, 10)
    c.fillStyle = 'rgba(0,0,0,.32)'; c.fill()
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.stroke()
    c.textAlign = 'center'; c.textBaseline = 'middle'
    const cx = B.x + B.w / 2
    c.fillStyle = '#eafaf0'; c.font = 'bold 17px ' + FONT
    c.fillText(WIND_CH[G.prevalent] + '風圈 · 第 ' + G.hand + ' 局' + (G.streak ? ' · 連 ' + G.streak : ''), cx, B.y + 20)
    c.fillStyle = 'rgba(255,255,255,.82)'; c.font = '13px ' + FONT
    c.fillText('剩 ' + wallLeft(G) + ' 張 · 🎲 ' + G.dice[0] + '+' + G.dice[1] + ' · 開門 ' + WIND_CH[seatWind(G, G.openSeat)], cx, B.y + 43)
    // 第三行放總分(版號與種子移進 ⚙ 面板 —— 那裡才是查它們的地方)
    c.fillStyle = 'rgba(255,255,255,.62)'; c.font = '11px ' + FONT
    c.fillText(SEAT_NAME.map((n, s) => n + ' ' + (G.scores[s] > 0 ? '+' : '') + G.scores[s]).join(' · '), cx, B.y + 63)
  },

  // ★ 鈕的框只有一份:LAY.BTN(smoke 拿它驗「有沒有被牌壓住」)
  drawTopBar(game, G) {
    const N = LAY.BTN.new, S = LAY.BTN.gear
    this.pill('new', N.x, N.y, N.w, N.h, '🔄 新局', { font: 14 })
    this.pill('gear', S.x, S.y, S.w, S.h, '⚙', { font: 17 })
  },

  // ★ 訊息列一律畫**下方**(畫上面會壓住對家的手牌與副露 —— 紙牌桌 0831 兩次退件的老帳)
  msgBar(text) {
    const c = this.ctx
    const w = 560, h = 34, x0 = (LAY.W - w) / 2, y0 = LAY.HAND_Y - 44
    this.rr(x0, y0, w, h, 8)
    c.fillStyle = 'rgba(0,0,0,.62)'; c.fill()
    c.strokeStyle = 'rgba(255,211,77,.6)'; c.lineWidth = 1.5; c.stroke()
    c.fillStyle = '#ffe9a8'; c.font = 'bold 15px ' + FONT
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(text, LAY.W / 2, y0 + h / 2)
  },

  // ── 吃/碰/槓/胡/過 ──
  // ★ 按鈕從 game.acts(= table.js 的 humanActions)來:畫得出來的鈕就一定按得動,反之亦然。
  drawActions(game, G) {
    const acts = game.acts || []
    if (!acts.length || game.panel) return
    const c = this.ctx
    const L = actBarLayout(acts.map((a) => a.label))
    this.rr(L.bar.x, L.bar.y, L.bar.w, L.bar.h, 12)         // 底板,免得鈕浮在牌上看不清
    c.fillStyle = 'rgba(0,0,0,.58)'; c.fill()
    c.strokeStyle = 'rgba(255,211,77,.45)'; c.lineWidth = 1.5; c.stroke()
    acts.forEach((a, i) => {
      const r = L.btns[i]
      this.pill('act:' + i, r.x, r.y, r.w, r.h, a.label, {
        bg: a.hot ? 'rgba(200,50,42,.96)' : a.dim ? 'rgba(255,255,255,.16)' : 'rgba(28,112,70,.96)',
        font: 19,
      })
    })
  },

  // 面板後面壓一層暗幕:牌桌很花,不壓一層字會被牌的花紋吃掉
  scrim() {
    const c = this.ctx
    c.fillStyle = 'rgba(0,0,0,.5)'
    c.fillRect(-2000, -2000, 5000, 5000)   // 連 letterbox 的邊一起蓋
  },

  // ── 結算(★ M4 起會「倒牌」:把胡牌者的牌型攤開,看得到為什麼是胡)──
  drawResult(game, G) {
    const c = this.ctx
    this.scrim()
    const r = G.result
    const ws = r && !r.washout ? r.winners : []
    const ROW = 100                                   // 每位胡牌者:一排牌 + 台數 + 得分
    const W = 660
    const H = Math.max(200, 56 + ws.length * ROW + 34 + 56)
    const x0 = (LAY.W - W) / 2, y0 = (CONFIG.LOGICAL_H - H) / 2, cx = x0 + W / 2
    this.rr(x0, y0, W, H, 14)
    c.fillStyle = 'rgba(6,40,24,.99)'; c.fill()
    c.strokeStyle = 'rgba(255,211,77,.6)'; c.lineWidth = 2; c.stroke()
    c.textAlign = 'center'; c.textBaseline = 'middle'

    let y = y0 + 30
    c.fillStyle = '#ffe9a8'; c.font = 'bold 23px ' + FONT
    if (G.phase === 'over') c.fillText('🀄 這一場打完了(共 ' + G.opts.hands + ' 局)', cx, y)
    else if (!ws.length) c.fillText('🀄 流局 —— 牌牆摸完了', cx, y)
    else {
      const who = ws.map((w) => SEAT_NAME[w.seat]).join('、')
      c.fillText(who + (r.selfDraw ? ' 自摸!' : ' 胡了!') + (ws.length > 1 ? '(一炮多響)' : ''), cx, y)
    }
    y += 26

    for (const w of ws) {
      this.winnerTiles(w, cx, y)
      y += 46
      c.fillStyle = '#dff3e6'; c.font = '14px ' + FONT; c.textAlign = 'center'
      c.fillText(SEAT_NAME[w.seat] + ':' + taiText({ ok: true, items: w.items, tai: w.tai }), cx, y)
      y += 22
      c.fillStyle = 'rgba(255,255,255,.72)'; c.font = '13px ' + FONT
      c.fillText('得 ' + w.score + ' 分' + (r.selfDraw ? '(三家各付)' : '(由 ' + SEAT_NAME[r.from] + ' 付)'), cx, y)
      y += 32
    }

    c.fillStyle = 'rgba(255,255,255,.9)'; c.font = 'bold 16px ' + FONT
    c.fillText('總分　' + SEAT_NAME.map((n, i) => n + ' ' + (G.scores[i] > 0 ? '+' : '') + G.scores[i]).join('　'),
      cx, y0 + H - 74)
    if (G.phase === 'over') {
      this.pill('rank', cx - 194, y0 + H - 52, 176, 40, '🏆 成績榜', { font: 17 })
      this.pill('next', cx + 18, y0 + H - 52, 176, 40, '🔄 再來一場', { bg: 'rgba(28,112,70,.96)', font: 17 })
    } else {
      this.pill('next', cx - 92, y0 + H - 52, 184, 40, '下一局 ▶', { bg: 'rgba(28,112,70,.96)', font: 18 })
    }
  },

  // 倒牌:副露 → 手牌 → 胡的那張(黃框標出來)。★ 一排置中,17 張也放得下
  winnerTiles(w, cx, y) {
    const c = this.ctx
    const TW = 28, TH = 38, GAP = 2, SET = 9
    const row = []
    for (const m of w.melds || []) { for (const t of m) row.push(t); row.push(null) }
    for (const t of w.hand || []) row.push(t)
    row.push(null)
    row.push(w.win)
    let total = 0
    for (const it of row) total += it ? TW + GAP : SET
    let x = cx - (total - GAP) / 2
    for (let k = 0; k < row.length; k++) {
      const it = row[k]
      if (!it) { x += SET; continue }
      this.img(face(it.k), { x, y, w: TW, h: TH }, 0)
      if (k === row.length - 1) {                    // 胡的那一張
        this.rr(x - 2, y - 2, TW + 4, TH + 4, 6)
        c.strokeStyle = '#ffd34d'; c.lineWidth = 2.5; c.stroke()
      }
      x += TW + GAP
    }
  },

  // ── ⚙ 設定 ──
  drawSettings(game, G) {
    const c = this.ctx
    this.scrim()
    const W = 470, H = 434, x0 = (LAY.W - W) / 2, y0 = 53
    this.rr(x0, y0, W, H, 14)
    c.fillStyle = 'rgba(6,40,24,.99)'; c.fill()
    c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 2; c.stroke()
    c.textBaseline = 'middle'
    c.textAlign = 'left'; c.fillStyle = '#ffe9a8'; c.font = 'bold 20px ' + FONT
    c.fillText('⚙ 設定', x0 + 24, y0 + 30)
    const row = (i, label, id, btn) => {
      const y = y0 + 66 + i * 50
      c.textAlign = 'left'; c.fillStyle = '#dff3e6'; c.font = '16px ' + FONT
      c.fillText(label, x0 + 24, y + 18)
      this.pill(id, x0 + W - 24 - 178, y, 178, 36, btn, { font: 15 })
    }
    row(0, '🔊 音效', 'sfx', SFX.muted ? '關' : '開')
    row(1, '一炮多響', 'multiron', G.opts.multiRon ? '開:多家同時胡' : '關:順位優先')
    row(2, '🀄 電腦強度', 'level', AI_LEVELS[G.opts.level])
    row(3, '這一場打幾局', 'hands',
      G.opts.hands === 1 ? '單局' : G.opts.hands === 4 ? '一圈(4 局)' : '全將(16 局)')
    const best = bestScore()
    row(4, '🏆 成績榜', 'rank', best === null ? '還沒有紀錄' : '最佳 ' + (best > 0 ? '+' : '') + best + ' 分')
    row(5, '⛶ 全螢幕', 'full', '手機請橫著拿')
    c.textAlign = 'center'
    c.fillStyle = 'rgba(255,255,255,.42)'; c.font = '12px ' + FONT
    c.fillText(CONFIG.VERSION + ' · 種子 ' + G.seed, x0 + W / 2, y0 + H - 58)
    this.pill('close', x0 + W / 2 - 72, y0 + H - 44, 144, 34, '知道了', { bg: 'rgba(28,112,70,.96)', font: 16 })
  },

  // 💡 提示的文字:畫在動作列**上方**(動作列本身已經蓋在副露列上了,再往下疊會看不到)
  drawHint(game, G) {
    if (!game.hint || game.panel) return
    const c = this.ctx, A = LAY.ACT
    const text = game.hint.text
    c.font = '15px ' + FONT
    const w = Math.min(880, c.measureText(text).width + 36)
    const x0 = (LAY.W - w) / 2, y0 = A.y - 8 - 38, h = 32
    this.rr(x0, y0, w, h, 8)
    c.fillStyle = 'rgba(0,0,0,.72)'; c.fill()
    c.strokeStyle = 'rgba(255,211,77,.7)'; c.lineWidth = 1.5; c.stroke()
    c.fillStyle = '#ffe9a8'
    c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(text, LAY.W / 2, y0 + h / 2)
  },

  // ── 🏆 成績榜 ──
  // ★ 一「場」記一筆(不是一局)。沒有紀錄時要講清楚「還沒有」,不要留一片空白。
  drawRank(game, G) {
    const c = this.ctx
    this.scrim()
    const list = rankList().slice(0, 8)
    const W = 560, H = Math.max(200, 80 + list.length * 30 + 50)
    const x0 = (LAY.W - W) / 2, y0 = (CONFIG.LOGICAL_H - H) / 2, cx = x0 + W / 2
    this.rr(x0, y0, W, H, 14)
    c.fillStyle = 'rgba(6,40,24,.99)'; c.fill()
    c.strokeStyle = 'rgba(255,211,77,.5)'; c.lineWidth = 2; c.stroke()
    c.textBaseline = 'middle'
    c.textAlign = 'left'; c.fillStyle = '#ffe9a8'; c.font = 'bold 20px ' + FONT
    c.fillText('🏆 成績榜', x0 + 24, y0 + 30)
    c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '12px ' + FONT
    c.fillText('一「場」打完記一筆 · 只存在這台裝置', x0 + W - 24, y0 + 30)

    if (!list.length) {
      c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '15px ' + FONT
      c.fillText('還沒有紀錄 —— 把一場打完就會記上來', cx, y0 + H / 2 - 6)
    } else {
      c.font = '12px ' + FONT; c.fillStyle = 'rgba(255,255,255,.45)'
      c.textAlign = 'left'; c.fillText('名次　我的分數', x0 + 26, y0 + 58)
      c.textAlign = 'right'; c.fillText('局數 / 電腦 / 日期', x0 + W - 26, y0 + 58)
      list.forEach((r, i) => {
        const y = y0 + 80 + i * 30
        if (i % 2 === 0) { this.rr(x0 + 16, y - 13, W - 32, 26, 6); c.fillStyle = 'rgba(255,255,255,.05)'; c.fill() }
        c.textAlign = 'left'; c.font = 'bold 15px ' + FONT
        c.fillStyle = i === 0 ? '#ffd34d' : '#dff3e6'
        c.fillText((i + 1) + '.', x0 + 26, y)
        c.fillText((r.mine > 0 ? '+' : '') + r.mine + ' 分', x0 + 62, y)
        c.textAlign = 'right'; c.font = '12px ' + FONT; c.fillStyle = 'rgba(255,255,255,.6)'
        const lv = AI_LEVELS[r.level] || '?'
        const d = new Date(r.at)
        const dd = (d.getMonth() + 1) + '/' + d.getDate()
        c.fillText(r.hands + ' 局 · ' + lv + ' · ' + dd, x0 + W - 26, y)
      })
    }
    c.textAlign = 'center'
    this.pill('close', cx - 72, y0 + H - 44, 144, 34, '知道了', { bg: 'rgba(28,112,70,.96)', font: 16 })
  },
}
