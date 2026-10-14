'use strict';
const T = require('./tiles');
const M = require('./mahjong');

/* 牌的有用度：对子/刻子 + 邻近搭子 */
function usefulness(hand, t) {
  const c = {};
  for (let i = 0; i < hand.length; i++) c[hand[i]] = (c[hand[i]] || 0) + 1;
  let v = (c[t] - 1) * 3;
  if (T.isNumberTile(t)) {
    const s = t[0], n = T.numOf(t);
    const ds = [-2, -1, 1, 2];
    for (let i = 0; i < ds.length; i++) {
      const m = n + ds[i];
      if (m >= 1 && m <= 9 && c[s + m]) v += Math.abs(ds[i]) === 1 ? 1.6 : 0.7;
    }
    v += (5 - Math.abs(n - 5)) * 0.1;
  }
  return v;
}

function hardCount(p) {
  let n = p.flowers.length;
  for (let i = 0; i < p.hand.length; i++) if (T.isHardFlower(p.hand[i])) n++;
  for (let i = 0; i < p.melds.length; i++) {
    for (let j = 0; j < p.melds[i].tiles.length; j++) if (T.isHardFlower(p.melds[i].tiles[j])) n++;
  }
  return n;
}

/* 选一张最没用的牌打出，避开听口 */
function chooseDiscard(g, seat) {
  const p = g.players[seat];
  const hand = p.hand;
  let pool = hand.slice();
  const keep = [];
  if (hand.length % 3 === 2) {
    for (let i = 0; i < pool.length; i++) {
      const t = pool[i];
      const rest = pool.slice(0, i).concat(pool.slice(i + 1));
      p.hand = rest;
      if (M.waitingTiles(p).length) keep.push(t);
      p.hand = hand;
    }
    if (keep.length) pool = keep;
  }
  let best = pool[0], bestScore = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    let v = usefulness(hand, t);
    if (T.isHonor(t)) v -= 0.6;
    if (T.isHardFlower(t) && !T.isHonor(t)) v -= 0.3;
    if (v < bestScore) { bestScore = v; best = t; }
  }
  return best;
}

/* 别人打牌后是否碰/杠/胡 */
function decideClaim(g, seat, options) {
  const p = g.players[seat];
  if (options.indexOf('hu') >= 0) return 'hu';
  const hard = hardCount(p);
  if (options.indexOf('kong') >= 0 && hard >= 3) return 'kong';
  if (options.indexOf('pong') >= 0 && hard >= 3) return 'pong';
  return 'pass';
}

/* 自己回合是否暗杠/补杠 */
function decideSelfKong(g, seat) {
  const opts = g.selfKongOptions(seat);
  if (!opts.length) return null;
  const p = g.players[seat];
  const hard = hardCount(p);
  for (let i = 0; i < opts.length; i++) {
    if (opts[i].type === 'ankong' && hard >= 2) return opts[i];
  }
  return null;
}

module.exports = { chooseDiscard: chooseDiscard, decideClaim: decideClaim, decideSelfKong: decideSelfKong, hardCount: hardCount, usefulness: usefulness };
