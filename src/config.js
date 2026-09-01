// 麻將桌(majiang-zhuo)— 全域設定。
// ★ 版號改了,sw.js 的 CACHE 要一起 bump(smoke 在守 —— 紙牌桌/彈珠檯的老規矩直接搬)。
const CONFIG = {
  VERSION: 'v0.6.0 · 麻將桌',

  // ★ 鎖橫向(跟紙牌桌相反、跟彈珠檯相同):16 張手牌 + 三家副露 + 牌河,直向 540 寬塞不下。
  LOGICAL_W: 960,
  LOGICAL_H: 540,

  // 牌面快取的基準尺寸(42 種牌面各畫一次進 offscreen canvas,之後每幀只 drawImage;
  // 不要每幀重畫 144 張的筒圈與竹節 —— roadmap §6 地雷)。
  BASE: { W: 100, H: 136 },

  // ★ 所有尺寸只有這一份;tilePos 與 renderer 都吃它(判定=畫面)。
  TILE: {
    // 自家手牌。★ 寬度被「17 張要排進 960 邏輯寬」鎖死,52 已經是上限(span=928,兩邊各留 16)。
    //   手機橫向實體寬因此只有 ~41px(<44 觸控門檻)—— 真正的解是 M5 的「邏輯畫布寬度自適應」,
    //   在這裡再加寬只會把牌擠到畫布外。verify-ui 有一條在盯這個數字。
    HAND:  { W: 52, H: 68, R: 6, GAP: 2, DRAW_GAP: 14 },
    MELD:  { W: 34, H: 46, R: 4, GAP: 2, SET_GAP: 9 },   // 副露(吃碰槓)
    RIVER: { W: 26, H: 34, R: 4, GAP: 2 },               // 牌河(欄數在 LAY.RIVER,各家不同)
    FLOW:  { W: 28, H: 38, R: 4, GAP: 2 },               // 花牌區
    BACK:  { W: 22, H: 30, R: 3, GAP: 2 },               // 他家手牌(蓋著)
  },
}
