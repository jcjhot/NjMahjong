'use strict';
const T = require('./tiles');
const M = require('./mahjong');

const s = (str) => str.split(' ');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name + (extra ? '  | ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  | ' + extra : '')); }
}
function score(handStr, winTile, melds, flowers) {
  const p = { hand: s(handStr), melds: melds || [], flowers: flowers || [] };
  p.hand.push(winTile);
  return M.computeResult(p, winTile, {});
}

console.log('== 牌张 ==');
const wall = T.buildWall();
ok('144 张', wall.length === 144, '实际 ' + wall.length);

console.log('== 胡牌判定 ==');
ok('平胡', !!M.analyzeWin(s('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 p2 p2'), []));
ok('七对', (M.analyzeWin(s('m1 m1 m2 m2 m3 m3 m4 m4 m5 m5 m6 m6 m7 m7'), []) || {}).qidui === 0);
ok('豪华七对', (M.analyzeWin(s('m1 m1 m1 m1 m2 m2 m3 m3 m4 m4 m5 m5 m6 m6'), []) || {}).qidui === 1);
ok('双豪华七对', (M.analyzeWin(s('m1 m1 m1 m1 m2 m2 m2 m2 m3 m3 m4 m4 m5 m5'), []) || {}).qidui === 2);
ok('碰碰胡(带副露)', !!M.analyzeWin(s('m1 m1 m1 s2 s2 s2 p3 p3 p3 p4 p4'), [{ type: 'pong', tiles: ['z5', 'z5', 'z5'] }]));
ok('乱牌不成胡', !M.analyzeWin(s('m1 m9 s1 s9 p1 p9 z1 z2 z3 z4 z5 z6 z7 m2'), []));

console.log('== 计分 ==');
const r1 = score('m1 m1 m1 m2 m3 m4 m5 m6 m7 m7 m8 m9 m5', 'm5');
ok('清一色 + 门清', r1 && r1.labels.indexOf('清一色') >= 0 && r1.menQing, r1 && (r1.labels.join('/') + ' = ' + r1.total + '花'));

const r2 = score('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 p2', 'p2');
ok('门清小胡可胡', r2 && r2.pass, r2 && (r2.labels.join('/') + ' = ' + r2.total + '花'));

const r3 = score('m1 m2 m3 m4 m5 m6 s7 s8 s9 p1', 'p1', [{ type: 'pong', tiles: ['p5', 'p5', 'p5'] }]);
ok('不门清且硬花<4 → 拦胡', r3 && r3.pass === false, r3 && (r3.labels.join('/') + ' 硬花' + r3.hard));

const r4 = score('m1 m2 m3 m4 m5 m6 s7 s8 s9 p1', 'p1', [{ type: 'pong', tiles: ['p5', 'p5', 'p5'] }], ['z5', 'z6', 'z7', 'f1']);
ok('不门清但硬花=4 → 可胡', r4 && r4.pass === true, r4 && ('硬花' + r4.hard + ' = ' + r4.total + '花'));

const r5 = score('z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 z5', 'z5');
ok('风一色(混一色+碰碰胡)', r5 && r5.labels.indexOf('混一色') >= 0, r5 && r5.labels.join('/'));

const r6 = (function () {
  const p = {
    hand: ['m4'],
    melds: [
      { type: 'pong', tiles: ['m1', 'm1', 'm1'] },
      { type: 'pong', tiles: ['s2', 's2', 's2'] },
      { type: 'pong', tiles: ['p3', 'p3', 'p3'] },
      { type: 'pong', tiles: ['z1', 'z1', 'z1'] }
    ],
    flowers: []
  };
  p.hand.push('m4');
  return M.computeResult(p, 'm4', {});
})();
ok('全球独钓', r6 && r6.labels.indexOf('全球独钓') >= 0, r6 && r6.labels.join('/'));

const r7 = score('m1 m1 m1 m2 m2 m2 m3 m3 m3 m4 m4 m4 m5', 'm5');
ok('碰碰胡+清一色', r7 && r7.labels.indexOf('碰碰胡') >= 0 && r7.labels.indexOf('清一色') >= 0, r7 && r7.labels.join('/'));

console.log('== 听牌计算 ==');
const p7 = { hand: s('m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 p2'), melds: [], flowers: [] };
const w7 = M.waitingTiles(p7);
ok('听 p2', w7.indexOf('p2') >= 0, '听 ' + w7.join(','));

console.log('\n== 全局模拟 ==');
const BOT = require('./bot');
function botAct(g) {
  if (g.pending) {
    const keys = Object.keys(g.pending.options);
    for (let i = 0; i < keys.length; i++) {
      const st = +keys[i];
      if (g.pending.responses[st]) continue;
      g.claim(st, BOT.decideClaim(g, st, g.pending.options[st]));
      return;
    }
    return;
  }
  const seat = g.turn;
  if (g.selfWinCheck(seat)) return g.doWin(seat, null, { selfDraw: true });
  const k = BOT.decideSelfKong(g, seat);
  if (k) return g.doKong(seat, k.tile, k.type);
  return g.discard(seat, BOT.chooseDiscard(g, seat));
}
function checkTiles(g) {
  const seen = [];
  g.players.forEach(p => { seen.push.apply(seen, p.hand); seen.push.apply(seen, p.flowers); seen.push.apply(seen, p.discards); p.melds.forEach(m => seen.push.apply(seen, m.tiles)); });
  seen.push.apply(seen, g.wall);
  const a = {}, b = {};
  seen.forEach(t => a[t] = (a[t] || 0) + 1);
  T.buildWall().forEach(t => b[t] = (b[t] || 0) + 1);
  if (seen.length !== 144) return '总数 ' + seen.length;
  for (const k in b) if ((a[k] || 0) !== b[k]) return k + ' ' + (a[k] || 0) + '/' + b[k];
  return null;
}

const seats = [0, 1, 2, 3].map(i => ({ name: 'P' + i, isBot: true }));
const g = new M.Game(seats);
let rounds = 0, wins = 0, draws = 0, tileErr = 0, handsErr = 0, pat = {};
const t0 = Date.now();
while (rounds < 300) {
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 5000) {
    if (g.pending && g.pending.deadline < Date.now()) { g.autoPassExpired(); continue; }
    botAct(g);
  }
  if (guard >= 5000) { console.log('  FAIL 死循环于第 ' + rounds + ' 局'); fail++; break; }
  const te = checkTiles(g);
  if (te) { tileErr++; if (tileErr < 4) console.log('  牌数异常: ' + te); }
  g.players.forEach(p => { if (p.hand.length % 3 !== 1 && g.phase === 'finished' && !p.winTile) handsErr++; });
  if (g.result.kind === 'win') {
    wins++;
    const lb = g.result.winInfo.result.pattern + (g.result.winInfo.selfDraw ? '(自摸)' : '(点炮)');
    pat[lb] = (pat[lb] || 0) + 1;
  } else draws++;
  rounds++;
  g.newRound(g.result.nextDealer);
}
ok('300 局无死循环', rounds === 300);
ok('牌张守恒 300 局', tileErr === 0, tileErr ? tileErr + ' 局异常' : '');
ok('手牌张数合法', handsErr === 0, handsErr ? handsErr + ' 处异常' : '');
console.log('  胡牌 ' + wins + ' 局 / 荒庄 ' + draws + ' 局，耗时 ' + (Date.now() - t0) + 'ms');
console.log('  牌型分布: ' + JSON.stringify(pat));
console.log('  终局分数: ' + g.players.map(p => p.name + ' ' + p.score).join('  '));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
