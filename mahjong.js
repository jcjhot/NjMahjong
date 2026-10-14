'use strict';

const T = require('./tiles');

/* 中发白和春夏秋冬梅兰竹菊一样属于「硬花牌」：摸到即自动补花，从墙尾补一张，
   不可打出、不可碰、不可杠。所以 ALL_TILE_IDS 排除 z5-z7 ── 听口不会算它们。
   物理上还在牌墙里（4×3=12 张），只是被替换到玩家的花区而已。 */
const ALL_TILE_IDS = (function () {
  const ids = [];
  ['m', 's', 'p'].forEach(function (s) { for (let n = 1; n <= 9; n++) ids.push(s + n); });
  for (let i = 1; i <= 4; i++) ids.push('z' + i);
  return ids;
})();

/* ---------------- 基础工具 ---------------- */

function handToCounts(tiles) {
  const c = {};
  for (let i = 0; i < tiles.length; i++) c[tiles[i]] = (c[tiles[i]] || 0) + 1;
  return c;
}

function cloneCounts(c) {
  const o = {};
  for (const k in c) o[k] = c[k];
  return o;
}

function removeFromCounts(c, list) {
  for (let i = 0; i < list.length; i++) {
    c[list[i]] = (c[list[i]] || 0) - 1;
    if (c[list[i]] <= 0) delete c[list[i]];
  }
}

/* 递归拆解面子（顺子/刻子），返回拆解结果或 null */
function solveSets(counts, need) {
  if (need === 0) {
    for (const k in counts) if (counts[k] !== 0) return null;
    return [];
  }
  const keys = Object.keys(counts).filter(function (k) { return counts[k] > 0; }).sort();
  if (!keys.length) return null;
  const first = keys[0];

  if (counts[first] >= 3) {
    counts[first] -= 3;
    const r = solveSets(counts, need - 1);
    counts[first] += 3;
    if (r) return [{ type: 'pong', tiles: [first, first, first] }].concat(r);
  }

  const s = first[0];
  const n = T.numOf(first);
  if (T.isNumberTile(first) && n <= 7 && counts[s + (n + 1)] > 0 && counts[s + (n + 2)] > 0) {
    counts[first]--; counts[s + (n + 1)]--; counts[s + (n + 2)]--;
    const r = solveSets(counts, need - 1);
    counts[first]++; counts[s + (n + 1)]++; counts[s + (n + 2)]++;
    if (r) return [{ type: 'chow', tiles: [first, s + (n + 1), s + (n + 2)] }].concat(r);
  }
  return null;
}

/* 先定将牌，再拆面子 */
function solveFull(counts, needSets) {
  const keys = Object.keys(counts).filter(function (k) { return counts[k] >= 2; }).sort();
  for (let i = 0; i < keys.length; i++) {
    const p = keys[i];
    counts[p] -= 2;
    const r = solveSets(counts, needSets);
    counts[p] += 2;
    if (r) return { pair: p, sets: r };
  }
  return null;
}

/* 判断是否可拆成「若干刻子 + 一对将」（碰碰胡） */
function canAllPong(hand, melds) {
  for (let i = 0; i < melds.length; i++) if (melds[i].type === 'chow') return false;
  const need = 4 - melds.length;
  const counts = handToCounts(hand);
  const pairs = Object.keys(counts).filter(function (k) { return counts[k] === 2; });
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    counts[p] -= 2;
    let total = 0, ok = true;
    for (const k in counts) {
      total += counts[k];
      if (counts[k] !== 0 && counts[k] !== 3) { ok = false; break; }
    }
    counts[p] += 2;
    if (ok && total === need * 3) return true;
  }
  return false;
}

/* 判断牌型是否成胡，返回可用的牌型信息 */
function analyzeWin(hand, melds) {
  const need = 4 - melds.length;
  const counts = handToCounts(hand);
  const out = { ok: false, qidui: undefined, basic: null };

  if (melds.length === 0 && hand.length === 14) {
    const vals = Object.keys(counts).map(function (k) { return counts[k]; });
    let allEven = true, pairs = 0, quads = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] % 2 !== 0) { allEven = false; break; }
      pairs += vals[i] / 2;
      if (vals[i] >= 4) quads++;
    }
    if (allEven && pairs === 7) { out.qidui = quads; out.ok = true; }
  }

  const full = solveFull(counts, need);
  if (full) { out.basic = full; out.ok = true; }

  return out.ok ? out : null;
}

/* 判断听口类型：单吊 / 卡张 / 边张 */
function classifyWait(hand, melds, winTile) {
  if (!winTile) return null;
  const need = 4 - melds.length;
  const counts = handToCounts(hand);
  counts[winTile] = (counts[winTile] || 0) - 1;
  if (counts[winTile] <= 0) delete counts[winTile];

  function setsOnly(removed) {
    const c = cloneCounts(counts);
    removeFromCounts(c, removed);
    return solveSets(c, need) !== null;
  }
  function setsAndPair(removed) {
    const c = cloneCounts(counts);
    removeFromCounts(c, removed);
    return solveFull(c, need - 1) !== null;
  }

  const keys = Object.keys(counts);
  for (let i = 0; i < keys.length; i++) {
    if (counts[keys[i]] >= 1 && setsOnly([keys[i]])) return 'dundiao';
  }
  if (T.isNumberTile(winTile)) {
    const s = winTile[0], n = T.numOf(winTile);
    if (n >= 2 && n <= 8 && counts[s + (n - 1)] > 0 && counts[s + (n + 1)] > 0 && setsAndPair([s + (n - 1), s + (n + 1)])) return 'kazhang';
    if (n === 3 && counts[s + '1'] > 0 && counts[s + '2'] > 0 && setsAndPair([s + '1', s + '2'])) return 'bianzhang';
    if (n === 7 && counts[s + '8'] > 0 && counts[s + '9'] > 0 && setsAndPair([s + '8', s + '9'])) return 'bianzhang';
  }
  return null;
}

/* ---------------- 算花与计分 ---------------- */

/*
  总分 = 跑花 20 + (硬花 + 软花) × 2 + 大胡加成 + 附加分
  硬花：中发白 + 春夏秋冬梅兰竹菊
  软花：缺一门 1、单吊 1、卡张 1、边张 1、风碰 1、明杠 2、暗杠 3
  大胡：混一色 40、清一色 60、碰碰胡 40、全球独钓 60、门清 20、七对 80（豪华 160 / 双豪华 240 / 三豪华 320）
  起胡门槛：小胡必须门清，或硬花 ≥ 4；大胡不受限
*/
function computeResult(player, winTile, ctx) {
  ctx = ctx || {};
  const hand = player.hand;
  const melds = player.melds;
  const a = analyzeWin(hand, melds);
  if (!a) return null;

  const meldTiles = [];
  for (let i = 0; i < melds.length; i++) meldTiles.push.apply(meldTiles, melds[i].tiles);
  const all = hand.concat(meldTiles);

  let hard = player.flowers.length;
  for (let i = 0; i < all.length; i++) if (T.isHardFlower(all[i])) hard++;

  let baseSoft = 0;
  const suits = {};
  for (let i = 0; i < all.length; i++) if (T.isNumberTile(all[i])) suits[all[i][0]] = 1;
  const queYiMen = Object.keys(suits).length <= 2;
  if (queYiMen) baseSoft += 1;
  for (let i = 0; i < melds.length; i++) {
    const m = melds[i];
    if (m.type === 'pong' && T.isWind(m.tiles[0])) baseSoft += 1;
    else if (m.type === 'kong') baseSoft += 2;
    else if (m.type === 'ankong') baseSoft += 3;
  }

  const menQing = melds.every(function (m) { return m.type === 'ankong'; });
  const anyHonor = all.some(function (t) { return T.isHonor(t); });
  const suitCount = Object.keys(suits).length;
  const isQing = suitCount === 1 && !anyHonor;
  const isHun = suitCount <= 1 && anyHonor;
  const quanQiu = melds.length === 4 && melds.every(function (m) { return m.type !== 'chow'; });

  const candidates = [];
  if (a.qidui !== undefined) {
    const q = a.qidui;
    candidates.push({
      qidui: true,
      ppp: false,
      bonus: q >= 3 ? 320 : q === 2 ? 240 : q === 1 ? 160 : 80,
      label: q >= 3 ? '三豪华七对' : q === 2 ? '双豪华七对' : q === 1 ? '豪华七对' : '七对'
    });
  }
  if (a.basic) {
    const ppp = canAllPong(hand, melds);
    candidates.push({ qidui: false, ppp: ppp, bonus: ppp ? 40 : 0, label: ppp ? '碰碰胡' : '平胡' });
  }

  let best = null;
  for (let ci = 0; ci < candidates.length; ci++) {
    const cand = candidates[ci];
    let bonus = cand.bonus;
    const labels = [cand.label];
    let soft = baseSoft;

    if (isQing) { bonus += 60; labels.push('清一色'); }
    else if (isHun) { bonus += 40; labels.push('混一色'); }
    if (quanQiu) { bonus += 60; labels.push('全球独钓'); }
    if (menQing && !cand.qidui) { bonus += 20; labels.push('门清'); }

    if (!cand.qidui) {
      const w = classifyWait(hand, melds, winTile);
      if (w === 'dundiao') { soft += 1; labels.push('单吊'); }
      else if (w === 'kazhang') { soft += 1; labels.push('卡张'); }
      else if (w === 'bianzhang') { soft += 1; labels.push('边张'); }
    }
    if (queYiMen) labels.push('缺一门');

    let extra = 0;
    if (ctx.afterKong) { extra += 10; labels.push('杠上开花'); }
    if (ctx.isLastTile) { extra += 10; labels.push('海底捞'); }

    const total = 20 + (hard + soft) * 2 + bonus + extra;
    const isBig = cand.bonus > 0 || isQing || isHun || quanQiu;

    const entry = {
      labels: labels,
      pattern: cand.label,
      hard: hard,
      soft: soft,
      bonus: bonus,
      extra: extra,
      total: total,
      isBig: isBig,
      menQing: menQing,
      pass: isBig || menQing || hard >= 4
    };
    if (!best || entry.total > best.total) best = entry;
  }
  return best;
}

/* 计算听牌张：结构上成牌 + 满足起胡门槛（与 canWinWith 同一口径）。
   只做结构判断会显示"听某牌"却胡不了（小胡没门清且硬花<4），玩家会困惑。
   先做轻量的结构判断过滤，少数候选再走 computeResult 校验门槛，避免 144 次重算 */
function waitingTiles(player) {
  const res = [];
  if (player.hand.length % 3 !== 1) return res;
  for (let i = 0; i < ALL_TILE_IDS.length; i++) {
    const t = ALL_TILE_IDS[i];
    player.hand.push(t);
    const a = analyzeWin(player.hand, player.melds);
    let ok = false;
    if (a) {
      const r = computeResult(player, t, {});
      ok = !!(r && r.pass);
    }
    player.hand.pop();
    if (ok) res.push(t);
  }
  return res;
}

/* ---------------- 对局流程 ---------------- */

function Game(seats) {
  this.players = seats.map(function (s, i) {
    return {
      seat: i,
      name: s.name,
      isBot: !!s.isBot,
      hand: [],
      melds: [],
      flowers: [],
      discards: [],
      score: 0
    };
  });
  this.dealer = 0;
  this.roundNo = 0;
  this.log = [];
  this.newRound(0);
}

Game.prototype.addLog = function (text) {
  this.log.push(text);
  if (this.log.length > 200) this.log.shift();
};

Game.prototype.newRound = function (dealer) {
  this.dealer = dealer;
  this.roundNo++;
  this.wall = T.shuffle(T.buildWall());
  this.phase = 'playing';
  this.turn = dealer;
  this.pending = null;
  this.lastDiscard = null;
  this.drawnTile = null;
  this.afterKong = false;
  this.result = null;
  this.log = [];

  const self = this;
  this.players.forEach(function (p) {
    p.hand = []; p.melds = []; p.flowers = []; p.discards = [];
    p.waiting = [];
    p.winTile = null;
  });

  this.addLog('第 ' + this.roundNo + ' 局开始，' + this.players[dealer].name + ' 坐庄');

  for (let r = 0; r < 13; r++) {
    for (let i = 0; i < 4; i++) {
      const seat = (dealer + i) % 4;
      this.players[seat].hand.push(this.wall.shift());
    }
  }
  this.players[dealer].hand.push(this.wall.shift());

  for (let i = 0; i < 4; i++) {
    this.flowerReplace((dealer + i) % 4);
  }

  this.turn = dealer;
  this.refreshWaiting();
};

Game.prototype.flowerReplace = function (seat) {
  const p = this.players[seat];
  for (;;) {
    let idx = -1;
    for (let i = 0; i < p.hand.length; i++) if (T.isHardFlower(p.hand[i])) { idx = i; break; }
    if (idx < 0) break;
    const t = p.hand.splice(idx, 1)[0];
    p.flowers.push(t);
    this.addLog(p.name + ' 补花 ' + T.tileLabel(t));
    const nt = this.wall.pop();
    if (nt === undefined) break;
    p.hand.push(nt);
  }
};

Game.prototype.drawTile = function (fromEnd) {
  if (!this.wall.length) return undefined;
  return fromEnd ? this.wall.pop() : this.wall.shift();
};

Game.prototype.drawWithFlowers = function (seat, fromEnd) {
  let t = this.drawTile(fromEnd);
  while (t !== undefined && T.isHardFlower(t)) {
    const p = this.players[seat];
    p.flowers.push(t);
    this.addLog(p.name + ' 补花 ' + T.tileLabel(t));
    t = this.drawTile(true);
  }
  return t;
};

/* 理牌：万 → 条 → 筒 → 风 → 箭 → 花。
   发牌、摸牌、碰杠等所有会改动手牌的路径最后都会走到 refreshWaiting，
   所以把理牌放在这里，一处即可覆盖全部，手牌始终是整齐的。 */
Game.prototype.tidyHands = function () {
  for (let i = 0; i < 4; i++) {
    T.sortHand(this.players[i].hand);
    T.sortHand(this.players[i].flowers);
  }
};

Game.prototype.refreshWaiting = function () {
  this.tidyHands();
  for (let i = 0; i < 4; i++) {
    this.players[i].waiting = waitingTiles(this.players[i]);
  }
};

Game.prototype.beginTurn = function (seat) {
  this.pending = null;
  this.lastDiscard = null;
  this.turn = seat;
  this.drawnTile = null;
  this.afterKong = false;
  const p = this.players[seat];
  const t = this.drawWithFlowers(seat, false);
  if (t === undefined) return this.drawGame();
  p.hand.push(t);
  this.drawnTile = t;
  this.refreshWaiting();
};

Game.prototype.nextTurn = function (from) {
  this.beginTurn((from + 1) % 4);
};

Game.prototype.discard = function (seat, tile) {
  if (this.phase !== 'playing' || this.pending) return false;
  if (this.turn !== seat) return false;
  const p = this.players[seat];
  if (p.hand.length % 3 !== 2) return false;
  const idx = p.hand.indexOf(tile);
  if (idx < 0) return false;
  p.hand.splice(idx, 1);
  p.discards.push(tile);
  this.lastDiscard = { tile: tile, from: seat };
  this.drawnTile = null;
  this.afterKong = false;
  this.addLog(p.name + ' 打出 ' + T.tileLabel(tile));
  this.refreshWaiting();
  this.openClaims(tile, seat);
  return true;
};

Game.prototype.openClaims = function (tile, from) {
  const options = {};
  let any = false;
  for (let i = 0; i < 4; i++) {
    if (i === from) continue;
    const p = this.players[i];
    const c = handToCounts(p.hand);
    const opts = [];
    if (this.canWinWith(i, tile, { selfDraw: false })) opts.push('hu');
    if ((c[tile] || 0) >= 3 && this.wall.length > 0) opts.push('kong');
    if ((c[tile] || 0) >= 2) opts.push('pong');
    if (opts.length) { options[i] = opts; any = true; }
  }
  if (!any) return this.nextTurn(from);
  this.pending = {
    tile: tile,
    from: from,
    options: options,
    responses: {},
    deadline: Date.now() + 12000
  };
};

Game.prototype.canWinWith = function (seat, tile, ctx) {
  const p = this.players[seat];
  p.hand.push(tile);
  const r = computeResult(p, tile, {
    afterKong: false,
    isLastTile: this.wall.length <= 4
  });
  p.hand.pop();
  if (!r || !r.pass) return null;
  return r;
};

Game.prototype.claim = function (seat, type) {
  if (!this.pending) return false;
  const opts = this.pending.options[seat];
  if (!opts) return false;
  if (type !== 'pass' && opts.indexOf(type) < 0) return false;
  if (this.pending.responses[seat]) return false;
  this.pending.responses[seat] = type;
  const self = this;
  const allIn = Object.keys(this.pending.options).every(function (s) { return self.pending.responses[s]; });
  if (allIn) this.resolveClaims();
  return true;
};

Game.prototype.autoPassExpired = function () {
  if (!this.pending) return false;
  if (Date.now() < this.pending.deadline) return false;
  const self = this;
  Object.keys(this.pending.options).forEach(function (s) {
    if (!self.pending.responses[s]) self.pending.responses[s] = 'pass';
  });
  this.resolveClaims();
  return true;
};

Game.prototype.resolveClaims = function () {
  const pend = this.pending;
  if (!pend) return;
  this.pending = null;
  const res = pend.responses;
  const seats = Object.keys(res).map(Number);

  const huSeats = seats.filter(function (s) { return res[s] === 'hu'; })
    .sort(function (a, b) { return ((a - pend.from + 4) % 4) - ((b - pend.from + 4) % 4); });
  if (huSeats.length) return this.doWin(huSeats[0], pend.tile, { selfDraw: false, from: pend.from });

  const kongSeat = seats.filter(function (s) { return res[s] === 'kong'; })[0];
  if (kongSeat !== undefined) return this.doClaimKong(kongSeat, pend.tile, pend.from);

  const pongSeat = seats.filter(function (s) { return res[s] === 'pong'; })[0];
  if (pongSeat !== undefined) return this.doPong(pongSeat, pend.tile, pend.from);

  this.nextTurn(pend.from);
};

Game.prototype.removeDiscard = function (from, tile) {
  const d = this.players[from].discards;
  const i = d.lastIndexOf(tile);
  if (i >= 0) d.splice(i, 1);
  this.lastDiscard = null;
};

Game.prototype.doPong = function (seat, tile, from) {
  const p = this.players[seat];
  for (let k = 0; k < 2; k++) p.hand.splice(p.hand.indexOf(tile), 1);
  p.melds.push({ type: 'pong', tiles: [tile, tile, tile], from: from });
  this.removeDiscard(from, tile);
  this.turn = seat;
  this.pending = null;
  this.drawnTile = null;
  this.afterKong = false;
  this.addLog(p.name + ' 碰 ' + T.tileLabel(tile));
  this.refreshWaiting();
};

Game.prototype.doClaimKong = function (seat, tile, from) {
  const p = this.players[seat];
  for (let k = 0; k < 3; k++) p.hand.splice(p.hand.indexOf(tile), 1);
  p.melds.push({ type: 'kong', tiles: [tile, tile, tile, tile], from: from });
  this.removeDiscard(from, tile);
  this.turn = seat;
  this.pending = null;
  this.afterKong = true;
  this.addLog(p.name + ' 杠 ' + T.tileLabel(tile));
  const t = this.drawWithFlowers(seat, true);
  if (t === undefined) return this.drawGame();
  p.hand.push(t);
  this.drawnTile = t;
  this.refreshWaiting();
};

Game.prototype.selfKongOptions = function (seat) {
  if (this.phase !== 'playing' || this.pending || this.turn !== seat) return [];
  const p = this.players[seat];
  if (p.hand.length % 3 !== 2) return [];
  const out = [];
  const c = handToCounts(p.hand);
  Object.keys(c).forEach(function (t) {
    if (c[t] === 4) out.push({ tile: t, type: 'ankong' });
  });
  p.melds.forEach(function (m) {
    if (m.type === 'pong' && p.hand.indexOf(m.tiles[0]) >= 0) out.push({ tile: m.tiles[0], type: 'addkong' });
  });
  return out;
};

Game.prototype.doKong = function (seat, tile, type) {
  if (this.phase !== 'playing' || this.pending || this.turn !== seat) return false;
  const p = this.players[seat];
  if (p.hand.length % 3 !== 2) return false;
  if (type === 'addkong') {
    const meld = p.melds.filter(function (m) { return m.type === 'pong' && m.tiles[0] === tile; })[0];
    if (!meld) return false;
    const i = p.hand.indexOf(tile);
    if (i < 0) return false;
    p.hand.splice(i, 1);
    meld.type = 'kong';
    meld.tiles = [tile, tile, tile, tile];
    meld.added = true;
    this.addLog(p.name + ' 补杠 ' + T.tileLabel(tile));
  } else {
    const c = handToCounts(p.hand);
    if ((c[tile] || 0) < 4) return false;
    for (let k = 0; k < 4; k++) p.hand.splice(p.hand.indexOf(tile), 1);
    p.melds.push({ type: 'ankong', tiles: [tile, tile, tile, tile], from: seat });
    this.addLog(p.name + ' 暗杠 ' + T.tileLabel(tile));
  }
  this.afterKong = true;
  this.drawnTile = null;
  const t = this.drawWithFlowers(seat, true);
  if (t === undefined) return this.drawGame() || true;
  p.hand.push(t);
  this.drawnTile = t;
  this.refreshWaiting();
  return true;
};

Game.prototype.selfWinCheck = function (seat) {
  if (this.phase !== 'playing' || this.pending || this.turn !== seat) return null;
  const p = this.players[seat];
  if (p.hand.length % 3 !== 2) return null;
  const tile = this.drawnTile || p.hand[p.hand.length - 1];
  const r = computeResult(p, tile, {
    afterKong: this.afterKong,
    isLastTile: this.wall.length <= 4
  });
  return r && r.pass ? r : null;
};

Game.prototype.doWin = function (seat, tile, ctx) {
  const p = this.players[seat];
  ctx = ctx || {};
  if (ctx.selfDraw) {
    tile = this.drawnTile || p.hand[p.hand.length - 1];
  } else {
    p.hand.push(tile);
    this.removeDiscard(ctx.from, tile);
  }
  const result = computeResult(p, tile, {
    afterKong: !!this.afterKong,
    isLastTile: this.wall.length <= 4
  });
  if (!result || !result.pass) {
    if (!ctx.selfDraw) { p.hand.pop(); }
    return false;
  }

  const deltas = [0, 0, 0, 0];
  if (ctx.selfDraw) {
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue;
      deltas[i] -= result.total;
      deltas[seat] += result.total;
    }
  } else {
    deltas[ctx.from] -= result.total;
    deltas[seat] += result.total;
  }
  for (let i = 0; i < 4; i++) this.players[i].score += deltas[i];

  this.phase = 'finished';
  this.pending = null;
  this.lastDiscard = null;
  this.players.forEach(function (pl) { pl.waiting = []; });

  const dealerKeeps = seat === this.dealer;
  const nextDealer = dealerKeeps ? this.dealer : (this.dealer + 1) % 4;

  this.winInfo = {
    seat: seat,
    tile: tile,
    selfDraw: !!ctx.selfDraw,
    from: ctx.selfDraw ? null : ctx.from,
    result: result,
    deltas: deltas,
    nextDealer: nextDealer,
    dealerKeeps: dealerKeeps
  };
  this.result = {
    kind: 'win',
    text: p.name + (ctx.selfDraw ? ' 自摸' : ' 胡牌（点炮：' + this.players[ctx.from].name + '）'),
    winInfo: this.winInfo,
    nextDealer: nextDealer,
    dealerKeeps: dealerKeeps
  };
  this.players[seat].winTile = tile;
  this.addLog(p.name + (ctx.selfDraw ? ' 自摸！' : ' 胡牌！') + ' 花数 ' + result.total);
  return true;
};

Game.prototype.drawGame = function () {
  this.phase = 'finished';
  this.pending = null;
  this.result = {
    kind: 'draw',
    text: '牌墙摸完，荒庄',
    winInfo: null,
    nextDealer: (this.dealer + 1) % 4
  };
  this.players.forEach(function (pl) { pl.waiting = []; });
  this.addLog('牌墙摸完，荒庄');
};

module.exports = {
  Game: Game,
  analyzeWin: analyzeWin,
  canAllPong: canAllPong,
  computeResult: computeResult,
  waitingTiles: waitingTiles,
  classifyWait: classifyWait,
  handToCounts: handToCounts,
  ALL_TILE_IDS: ALL_TILE_IDS
};
