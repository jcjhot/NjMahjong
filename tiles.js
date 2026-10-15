(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MJ_TILES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SUIT_SUB = { m: '万', s: '条', p: '筒' };
  const HONOR_CHAR = { z1: '东', z2: '南', z3: '西', z4: '北', z5: '中', z6: '发', z7: '白' };
  const FLOWER_CHAR = { f1: '春', f2: '夏', f3: '秋', f4: '冬', f5: '梅', f6: '兰', f7: '竹', f8: '菊' };
  const WIND_TILES = ['z1', 'z2', 'z3', 'z4'];
  const ARROW_TILES = ['z5', 'z6', 'z7'];
  const FLOWER_TILES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  const SEAT_WIND = ['东', '南', '西', '北'];

  function buildWall() {
    const wall = [];
    ['m', 's', 'p'].forEach(function (s) {
      for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) wall.push(s + n);
    });
    for (let i = 1; i <= 7; i++) for (let k = 0; k < 4; k++) wall.push('z' + i);
    for (let i = 1; i <= 8; i++) wall.push('f' + i);
    return wall;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* 理牌顺序：万 → 条 → 筒 → 风(东南西北) → 箭(中发白) → 花(春夏秋冬梅兰竹菊) */
  const SUIT_BASE = { m: 0, s: 10, p: 20 };
  function tileOrder(t) {
    const s = t[0];
    const n = numOf(t);
    if (SUIT_BASE[s] !== undefined) return SUIT_BASE[s] + n;
    if (s === 'z') return n <= 4 ? 30 + n : 40 + n;   // 风 31-34、箭 45-47
    return 50 + n;                                     // 花 51-58
  }

  /* 就地排序手牌 */
  function sortHand(arr) {
    arr.sort(function (a, b) { return tileOrder(a) - tileOrder(b); });
    return arr;
  }

  function suitOf(t) { return t[0]; }
  function numOf(t) { return parseInt(t.slice(1), 10); }
  function isFlower(t) { return t[0] === 'f'; }
  function isHonor(t) { return t[0] === 'z'; }
  function isWind(t) { return t[0] === 'z' && numOf(t) <= 4; }
  function isArrow(t) { return t[0] === 'z' && numOf(t) >= 5; }
  function isNumberTile(t) { return t[0] === 'm' || t[0] === 's' || t[0] === 'p'; }
  // 硬花：中、发、白 + 春夏秋冬梅兰竹菊
  function isHardFlower(t) { return isFlower(t) || isArrow(t); }

  function tileInfo(t) {
    const s = t[0];
    const n = numOf(t);
    if (SUIT_SUB[s]) return { main: s === 'm' ? NUM_CN[n - 1] : String(n), sub: SUIT_SUB[s], kind: s, idx: n };
    if (HONOR_CHAR[t]) return { main: HONOR_CHAR[t], sub: n <= 4 ? '风' : '', kind: 'z', idx: n };
    return { main: FLOWER_CHAR[t], sub: '', kind: 'f', idx: n };
  }

  function tileLabel(t) {
    const i = tileInfo(t);
    return i.main + i.sub;
  }

  return {
    NUM_CN: NUM_CN,
    SUIT_SUB: SUIT_SUB,
    HONOR_CHAR: HONOR_CHAR,
    FLOWER_CHAR: FLOWER_CHAR,
    WIND_TILES: WIND_TILES,
    ARROW_TILES: ARROW_TILES,
    FLOWER_TILES: FLOWER_TILES,
    SEAT_WIND: SEAT_WIND,
    buildWall: buildWall,
    shuffle: shuffle,
    tileOrder: tileOrder,
    sortHand: sortHand,
    suitOf: suitOf,
    numOf: numOf,
    isFlower: isFlower,
    isHonor: isHonor,
    isWind: isWind,
    isArrow: isArrow,
    isNumberTile: isNumberTile,
    isHardFlower: isHardFlower,
    tileInfo: tileInfo,
    tileLabel: tileLabel
  };
});
