// 控制器 —— 頂層只定義不執行(DOM 只在 boot 裡碰,smoke 在 node 載得動)。
// ★ 玩家與電腦走同一支 stepAuto / declare / applySelf / playDiscard:規則只有一份。
// ★ 每一步之後跑守恆保險絲 fuse() —— 牌憑空多/少是靜默的,現場抓到才不必事後考古。

const PACE = { draw: 170, discard: 520, react: 240 }   // 讓眼睛跟得上的節奏(ms)

const game = {
  G: null,
  hover: -2,       // -2 沒指到、-1 指到剛摸的那張、>=0 手牌索引
  panel: null,     // null | 'set'(設定)| 'rank'(成績榜)
  hint: null,      // 💡 算出來的建議 { i, slot, text }
  wait: 0,
  last: 0,
  acts: [],        // 這一幀玩家能按的鈕(renderer 畫它、onBtn 依它執行,只有一份)
  fly: null,       // 正在飛向牌河的那張牌(純觀感,不影響任何規則)
  lift: null,      // 剛摸進來的那張牌「抬一下」(純觀感;0905 roadmap 第 3 條)
  flash: null,     // 誰家副露剛成立「閃一下」{ seat, t0, dur }(純觀感;同上)
  reduced: false,  // 使用者要求減少動態 ⇒ 不做動畫

  boot() {
    const cv = document.getElementById('cv')
    renderer.init(cv, this)
    input.init(cv, this, renderer)
    warmFaces()                       // ★ 42 種牌面 + 背面一次烤好,之後每幀只 drawImage
    try { this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches } catch { }
    // ★ 上次沒打完就接著打(一將 16 局要一小時,手機一定會被切走)
    const saved = loadState()
    if (saved) { this.G = saved; this.hover = -2; this.hint = null; this.fly = null; this.wait = 320; this.fuse() }
    else this.newMatch()
    window.addEventListener('pointerdown', () => SFX.unlock(), { once: true })
    const loop = (ts) => {
      const dt = this.last ? Math.min(ts - this.last, 100) : 16
      this.last = ts
      this.tick(dt)
      Confetti.step(dt)
      this.acts = this.G ? humanActions(this.G, 0) : []
      renderer.draw(this)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  },

  newMatch(seed) {
    clearState()
    this.G = newGame({ seed: seed != null ? seed : Math.floor(Math.random() * 1e9) })
    this.hover = -2
    this.hint = null
    this.fly = null
    Confetti.stop()
    this.wait = 320
    this.fuse()
  },

  // ★★ 守恆保險絲:牌牆+手牌+剛摸+副露+牌河+花 ≡ 144。壞了就停下來講清楚,不帶著錯繼續打。
  fuse() {
    const c = conserve(this.G)
    if (!c.ok) {
      this.G.phase = 'bug'
      this.G.msg = '⚠ 守恆保險絲斷了:' + c.err
      if (typeof console !== 'undefined') console.error('conserve', c)
    }
    return c.ok
  },

  tick(dt) {
    const G = this.G
    if (!G) return
    if (this.fly && performance.now() - this.fly.t0 > this.fly.dur) this.fly = null
    if (this.lift && performance.now() - this.lift.t0 > this.lift.dur) this.lift = null
    if (this.flash && performance.now() - this.flash.t0 > this.flash.dur) this.flash = null
    if (this.panel) return                                   // 面板開著就暫停
    if (G.phase !== 'play' && G.phase !== 'react') return     // win / washout / over / bug 等按鈕
    this.wait -= dt
    if (this.wait > 0) return
    const d0 = G.discards, m0 = G.melds.map((m) => m.length)
    const hadDrawn = !!G.drawn[0]
    if (!stepAuto(G, policyFor(G.opts.level), 0)) {            // 輪到玩家了 ⇒ 等他動
      // 🎴 剛替玩家摸了一張:抬一下(純觀感;reduced-motion 不做)
      if (!hadDrawn && G.drawn[0] && !this.reduced) this.lift = { t0: performance.now(), dur: 260 }
      return
    }
    if (this.hint && !canDiscardNow(G, 0)) this.hint = null    // 換人了,提示過期
    if (!this.fuse()) return
    this.afterStep(G, d0, m0)
  },

  // 一步走完之後:配音效、起動畫、決定下一步等多久、把局面存起來。★ 玩家與電腦共用這一支。
  afterStep(G, d0, m0) {
    saveState(G)                       // 每一步都存:被切走的那一刻在哪就從哪回來
    const grew = G.melds.findIndex((m, s) => m.length > m0[s])
    if (G.phase === 'win') {
      SFX.play(G.result && G.result.selfDraw ? 'tsumo' : 'hu')
      if (G.result && G.result.winners.some((w) => w.seat === 0)) Confetti.start(this.reduced)
      this.wait = 0
      return
    }
    if (G.phase === 'washout') { SFX.play('lose'); this.wait = 0; return }
    if (grew >= 0) {
      const k = G.melds[grew][G.melds[grew].length - 1].kind
      if (!this.reduced) this.flash = { seat: grew, t0: performance.now(), dur: 700 }   // ✨ 副露成立閃一下(純觀感)
      SFX.play(k === 'chi' ? 'chi' : k === 'pon' ? 'pon' : 'kan')
      this.wait = PACE.react
      return
    }
    if (G.discards > d0) { SFX.play('place'); this.startFly(G); this.wait = PACE.discard; return }
    if (G.phase === 'react') { this.wait = PACE.react; return }
    SFX.play('draw')
    this.wait = PACE.draw
  },

  // 讓剛打出去的那張牌從手邊「飛」進牌河。★ 純觀感:規則早就跑完了,這只是補一段位移。
  startFly(G) {
    this.fly = null
    if (this.reduced || !G.last) return
    const seat = G.last.seat, idx = G.river[seat].length - 1
    if (idx < 0 || idx >= LAY.RIVER[seat].cap) return
    const to = tilePos(G, 'river', seat, idx)
    const src = seat === 0
      ? { x: to.x, y: LAY.HAND_Y }
      : tilePos(G, 'hand', seat, Math.max(0, (G.hands[seat].length / 2) | 0))
    this.fly = { k: G.last.tile.k, seat, idx, from: { x: src.x, y: src.y }, to,
      t0: performance.now(), dur: 190 }
  },

  // ── 輸入 ──
  onDown(x, y) {
    const b = renderer.btnAt(x, y)
    if (b) { SFX.play('click'); this.onBtn(b.id); return }
    if (this.panel) return
    const G = this.G
    if (!G || !canDiscardNow(G, 0)) return
    if (this.acts.some((a) => a.hot)) return          // 有「胡 / 自摸」時先讓他決定,不要手滑打掉
    const hit = handHit(G, x, y)
    if (!hit) return
    const d0 = G.discards, m0 = G.melds.map((m) => m.length)
    playerDiscard(G, hit.i)
    this.fuse()
    this.hover = -2
    this.hint = null
    this.afterStep(G, d0, m0)
  },

  onMove(x, y) {
    const G = this.G
    if (!G || this.panel || !canDiscardNow(G, 0)) { this.hover = -2; return }
    const hit = handHit(G, x, y)
    this.hover = hit ? hit.i : -2
  },

  onUp() { },
  onCancel() { this.hover = -2 },

  onBtn(id) {
    const G = this.G
    if (id === 'new') { this.panel = null; this.newMatch(); return }
    if (id === 'gear') { this.panel = this.panel ? null : 'set'; return }
    if (id === 'close') { this.panel = null; return }
    if (id === 'rank') { this.panel = 'rank'; return }
    if (id === 'full') {                       // ⛶ 全螢幕(要在手勢裡呼叫,所以放這)
      try { if (typeof goFullscreen === 'function') goFullscreen() } catch { }
      return
    }
    if (id === 'sfx') { SFX.toggleMuted(); return }
    if (id === 'multiron') { G.opts.multiRon = !G.opts.multiRon; saveOpts(G.opts); return }
    if (id === 'level') {
      G.opts.level = (G.opts.level + 1) % 3
      saveOpts(G.opts); saveState(G)
      return
    }
    if (id === 'hands') {
      const i = HAND_LIMITS.indexOf(G.opts.hands)
      G.opts.hands = HAND_LIMITS[(i + 1) % HAND_LIMITS.length]
      saveOpts(G.opts)
      return
    }
    if (id === 'next') {                       // 下一局(打完就重開一場)
      if (G.phase === 'over' || !nextHand(G)) this.newMatch()
      else { this.fuse(); saveState(G) }
      this.wait = 320
      return
    }
    if (id.startsWith('act:')) {
      const a = this.acts[+id.slice(4)]
      if (!a) return
      if (a.kind === 'hint') { this.hint = hintFor(G, 0); return }   // ★ 只算、不動牌
      this.hint = null
      const d0 = G.discards, m0 = G.melds.map((m) => m.length)
      applyHumanAction(G, 0, a)
      this.fuse()
      this.afterStep(G, d0, m0)
    }
  },
}
