'use strict';
/* 端到端联机自测：真实走 HTTP + SSE，1 个真人座 + 3 个电脑座 */
const BOT = require('./bot');
const M = require('./mahjong');
const T = require('./tiles');

const PORT = process.env.PORT || 8420;
const BASE = 'http://127.0.0.1:' + PORT;
const TARGET_ROUNDS = Number(process.env.ROUNDS || 12);
const CODE = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();

let token = null;
let lastSeq = -1;
let rounds = 0;
let nonce = 0;
let errors = [];
let stats = { discards: 0, claims: 0, kongs: 0, zimos: 0, huByType: {} };
let done = false;

function post(path, body) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(r => r.json());
}

function pseudo(v) {
  return {
    turn: v.turn,
    players: v.players.map(p => ({ hand: p.hand || [], melds: p.melds || [], flowers: p.flowers || [] }))
  };
}

function act(a) { return post('/api/action', { token, action: a }); }

async function handle(v) {
  if (done) return;
  if (v.seq === lastSeq) return;
  lastSeq = v.seq;

  // 状态合法性断言
  if (v.phase === 'playing') {
    v.players.forEach((p, i) => {
      if (i !== v.me.seat && p.hand !== null) errors.push('第' + v.roundNo + '局 泄露了别家手牌 seat' + i);
      const n = p.handCount;
      if (n < 0 || n > 14) errors.push('手牌数异常 ' + n);
    });
    const total = v.players.reduce((a, p) => a + p.handCount + p.melds.reduce((b, m) => b + m.tiles.length, 0) + p.flowers.length + p.discards.length, 0) + v.wallCount;
    if (total !== 144) errors.push('第' + v.roundNo + '局 牌张合计 ' + total);

    // 理牌断言：自己的手牌必须按 万→条→筒→风→箭→花 有序
    const myHand = v.players[v.me.seat].hand;
    if (myHand) {
      for (let i = 1; i < myHand.length; i++) {
        if (T.tileOrder(myHand[i - 1]) > T.tileOrder(myHand[i])) {
          errors.push('第' + v.roundNo + '局 手牌未理好: ' + myHand.join(' '));
          break;
        }
      }
      if (v.me.canDiscard && v.me.drawnTile && myHand.indexOf(v.me.drawnTile) < 0) {
        errors.push('第' + v.roundNo + '局 刚摸的牌不在手牌中: ' + v.me.drawnTile);
      }
    }
  }

  if (v.phase === 'lobby') { await post('/api/start', { token, fillBots: true }); return; }

  if (v.phase === 'finished') {
    rounds++;
    if (v.result && v.result.kind === 'win') {
      const t = v.result.winInfo.result.pattern;
      stats.huByType[t] = (stats.huByType[t] || 0) + 1;
    }
    if (rounds >= TARGET_ROUNDS) return finish(v);
    await post('/api/start', { token, next: true, fillBots: true });
    return;
  }

  const me = v.me;
  if (me.claimOptions) {
    const val = BOT.decideClaim(pseudo(v), me.seat, me.claimOptions);
    stats.claims++;
    await act({ type: 'claim', value: val });
    return;
  }
  if (me.canZimo) { stats.zimos++; await act({ type: 'zimo' }); return; }
  if (me.selfKong && me.selfKong.length) {
    const k = me.selfKong.filter(x => x.type === 'ankong')[0];
    if (k) { stats.kongs++; await act({ type: 'kong', tile: k.tile, kongType: k.type }); return; }
  }
  if (me.canDiscard) {
    const tile = BOT.chooseDiscard(pseudo(v), me.seat);
    stats.discards++;
    await act({ type: 'discard', tile: tile });
    return;
  }
}

function finish(v) {
  done = true;
  console.log('');
  console.log('端到端联机测试 · 房间 ' + CODE);
  console.log('  完成局数: ' + rounds + ' / ' + TARGET_ROUNDS);
  console.log('  我的出牌: ' + stats.discards + ' 次 | 碰杠响应 ' + stats.claims + ' 次 | 暗杠 ' + stats.kongs + ' 次 | 自摸 ' + stats.zimos + ' 次');
  console.log('  胡牌牌型: ' + JSON.stringify(stats.huByType));
  console.log('  终局分数: ' + v.players.map(p => p.name + ' ' + p.score).join('  '));
  if (errors.length) {
    console.log('  ✗ 发现 ' + errors.length + ' 个问题:');
    errors.slice(0, 8).forEach(e => console.log('      ' + e));
  } else {
    console.log('  ✓ 全程无异常：无手牌泄露、牌张守恒、手牌数合法');
  }
  process.exit(errors.length ? 1 : 0);
}

(async function () {
  const j = await post('/api/join', { name: '真人测试', code: CODE });
  if (j.error) { console.log('join 失败', j); process.exit(1); }
  token = j.token;
  console.log('已加入房间 ' + j.code + '，座位 ' + j.seat);

  const res = await fetch(BASE + '/api/stream?token=' + token);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      try { await handle(JSON.parse(line.slice(6))); } catch (e) { errors.push('handler: ' + e.message); }
    }
  }
})();

setTimeout(function () {
  if (!done) { console.log('超时：完成 ' + rounds + ' 局'); finish({ players: M.name ? [] : [] }); }
}, 120000);
