// 🔊 音效 —— 整檔收割自紙牌桌 zhipai-zhuo(skill sfx-kit 範式):WebAudio 即時合成,零音檔、可離線、無版權。
// ★ 頂層只定義不執行(smoke 在 node 載得動);沒 Web Audio ⇒ play() 靜默回 false,不報錯不卡遊戲。 （碰/槓/胡的專屬音在 M4 補;M0 先用 place/flip/deal。）
// ★ 一定要 unlock():瀏覽器規定使用者手勢後才能出聲(boot 裡接第一個 pointerdown/keydown)。
// ★ 靜音存 localStorage('mj-sfx-muted'),全包 try/catch(私密模式不炸);教室外放預設主音量 0.3。

const SFX = {
  ctx: null,
  muted: (() => { try { return localStorage.getItem('mj-sfx-muted') === '1' } catch { return false } })(),
  volume: 0.3,

  _ensure() {
    if (this.ctx) return this.ctx
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext)
      if (!AC) return null
      this.ctx = new AC()
    } catch { return null }
    return this.ctx
  },

  unlock() {
    const ctx = this._ensure()
    try { if (ctx && ctx.state === 'suspended') ctx.resume() } catch { }
  },

  setMuted(m) {
    this.muted = !!m
    try { localStorage.setItem('mj-sfx-muted', m ? '1' : '0') } catch { }
  },
  toggleMuted() { this.setMuted(!this.muted); return this.muted },

  // 音效表:每項=一串音符 [頻率, 起始秒, 長度秒, 波形, 個別音量]
  // 響度地板(sfx-kit 0819 教訓):要被聽見的 gain ≥0.25、時長 ≥0.1s;lose 溫柔下行不嚇小孩。
  _DEFS: {
    click: [[880, 0, 0.04, 'square', 0.18]],
    flip:  [[660, 0, 0.05, 'triangle', 0.3], [990, 0.04, 0.06, 'triangle', 0.26]],       // 翻牌/抽牌:清脆上跳
    deal:  [[523, 0, 0.05, 'triangle', 0.3], [440, 0.06, 0.05, 'triangle', 0.28], [392, 0.12, 0.07, 'triangle', 0.26]], // 發牌:三連下行
    place: [[220, 0, 0.09, 'sine', 0.34], [180, 0.01, 0.07, 'triangle', 0.2]],            // 落子:厚一點的短篤
    found: [[523, 0, 0.08, 'triangle', 0.32], [784, 0.07, 0.12, 'triangle', 0.32]],       // 收上基礎堆:兩音上行
    win:   [[523, 0, 0.14, 'triangle', 0.34], [659, 0.12, 0.14, 'triangle', 0.34], [784, 0.24, 0.14, 'triangle', 0.34], [1047, 0.36, 0.3, 'triangle', 0.36]], // 通關:C-E-G-C 上行
    lose:  [[392, 0, 0.16, 'sine', 0.28], [330, 0.16, 0.2, 'sine', 0.26]],                // 沒贏:溫柔下行,不嚇人
    // 🀄 麻將專屬(M4):吃最輕、碰紮實、槓最重、胡最亮 —— 光聽聲音就知道剛剛發生什麼
    draw:  [[740, 0, 0.035, 'sine', 0.16]],                                               // 摸牌:很輕的一聲
    chi:   [[523, 0, 0.06, 'triangle', 0.3], [659, 0.05, 0.08, 'triangle', 0.3]],
    pon:   [[392, 0, 0.07, 'square', 0.28], [523, 0.06, 0.1, 'triangle', 0.34]],
    kan:   [[262, 0, 0.09, 'square', 0.3], [392, 0.08, 0.09, 'square', 0.3], [523, 0.16, 0.14, 'triangle', 0.34]],
    hu:    [[523, 0, 0.12, 'triangle', 0.34], [659, 0.1, 0.12, 'triangle', 0.34],
            [784, 0.2, 0.12, 'triangle', 0.34], [1047, 0.3, 0.26, 'triangle', 0.36]],
    tsumo: [[659, 0, 0.1, 'triangle', 0.34], [784, 0.09, 0.1, 'triangle', 0.34],
            [988, 0.18, 0.1, 'triangle', 0.34], [1319, 0.27, 0.3, 'triangle', 0.36]],
  },

  // 回傳 true=真的出聲了;false=靜音/無 Web Audio/未知音效(靜默 fallback,永不 throw)
  play(name) {
    const def = this._DEFS[name]
    if (!def || this.muted) return false
    const ctx = this._ensure()
    if (!ctx) return false
    try {
      const t0 = ctx.currentTime
      for (const [f, at, dur, wave, g0] of def) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = wave
        o.frequency.value = f
        g.gain.setValueAtTime((g0 || 0.3) * this.volume / 0.3, t0 + at)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
        o.connect(g); g.connect(ctx.destination)
        o.start(t0 + at); o.stop(t0 + at + dur + 0.02)
      }
      return true
    } catch { return false }
  },

  destroy() { try { if (this.ctx) this.ctx.close() } catch { } this.ctx = null },
}
