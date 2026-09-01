// 🎉 彩帶 —— 零相依、零美術檔,直接畫在遊戲那張 canvas 上(不另開圖層,生命週期最單純)。
// ★ 從**上方灑落**,不要從中央爆開:結算面板就在畫面正中央,爆開會把台數與分數蓋掉
//   (skill win-confetti 的老規矩)。
// ★ 尊重 prefers-reduced-motion:使用者要求減少動態就整個不放。
// ★ 頂層只定義不執行,node 載得動。
const Confetti = {
  ps: [],
  COLORS: ['#ffd34d', '#ff6f61', '#4dd07f', '#5aa9ff', '#ffffff', '#ff9ad5'],

  start(reduced) {
    this.ps = []
    if (reduced) return false
    const W = LAY.W
    for (let i = 0; i < 90; i++) {
      this.ps.push({
        x: Math.random() * W, y: -20 - Math.random() * 300,
        vx: (Math.random() - 0.5) * 40, vy: 90 + Math.random() * 130,
        w: 6 + Math.random() * 7, h: 9 + Math.random() * 8,
        a: Math.random() * 6.28, va: (Math.random() - 0.5) * 7,
        c: this.COLORS[(Math.random() * this.COLORS.length) | 0],
      })
    }
    return true
  },

  stop() { this.ps = [] },
  get alive() { return this.ps.length > 0 },

  step(dt) {
    if (!this.ps.length) return
    const s = Math.min(dt, 60) / 1000, H = CONFIG.LOGICAL_H
    for (const p of this.ps) {
      p.x += p.vx * s
      p.y += p.vy * s
      p.a += p.va * s
      p.vy += 130 * s
    }
    this.ps = this.ps.filter((p) => p.y < H + 40)
  },

  draw(ctx) {
    for (const p of this.ps) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.a)
      ctx.fillStyle = p.c
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
  },
}
