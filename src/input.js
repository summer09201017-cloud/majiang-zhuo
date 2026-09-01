// 原始輸入 —— 不懂麻將規則:把指標事件換算成邏輯座標丟給 game,僅此而已。
const input = {
  init(cv, game, renderer) {
    cv.style.touchAction = 'none'   // 打牌時不讓瀏覽器搶去捲頁/縮放
    const pos = (e) => renderer.toLogical(e.clientX, e.clientY)
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId)
      const p = pos(e)
      game.onDown(p.x, p.y)
      e.preventDefault()
    })
    cv.addEventListener('pointermove', (e) => { const p = pos(e); game.onMove(p.x, p.y) })
    cv.addEventListener('pointerup', (e) => { const p = pos(e); game.onUp(p.x, p.y) })
    cv.addEventListener('pointercancel', () => game.onCancel())
    window.addEventListener('keydown', (e) => {
      if (e.key === 'n') game.onBtn('new')
      else if (e.key === 'm') game.onBtn('sfx')
    })
  },
}
