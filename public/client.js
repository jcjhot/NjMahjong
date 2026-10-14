'use strict';

const $ = (id) => document.getElementById(id);
const POS = ['bottom', 'right', 'top', 'left'];
const WINDS = ['东', '南', '西', '北'];

let state = null;
let token = null;
let es = null;
let lastResultKey = '';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function label(t) {
  return window.MJ_TILES ? window.MJ_TILES.tileLabel(t) : t;
}

/* deg: 0 自己 / 180 对家 / 90 右侧家 / 270 左侧家 —— 牌面朝打牌的人 */
/* 牌面用 FluffyStuff 的 riichi 麻将矢量图（CC0 公共领域），花牌是同底图合成的汉字牌 */
/* 外层 span 负责布局与动画，内层 img 负责画面；横放的牌靠旋转内层实现，外层的宽高则直接换成横向 */
/* 牌面图带一天的长缓存，改动 public/tiles/ 下的文件后把 TILE_VER 加一，否则浏览器会一直用旧图 */
const TILE_VER = '2';
const tileURL = (id) => '/tiles/' + id + '.svg?v=' + TILE_VER;

function tileHTML(id, cls, deg) {
  const d = +deg || 0;
  let kind = 'k-' + (id && id[0]);
  if (id && id[0] === 'f') kind = 'k-f';
  else if (id && id[0] === 'z') kind = 'k-z k-z' + id[1];
  const rot = d === 180 ? ' rot180' : d === 270 ? ' flat-cw' : d === 90 ? ' flat-ccw' : '';
  return '<span class="tile ' + kind + rot + ' ' + (cls || '') + '" data-tile="' + id + '">' +
    '<img src="' + tileURL(id) + '" alt="" draggable="false"></span>';
}

function backHTML(cls) {
  return '<span class="tile back ' + (cls || '') + '">' +
    '<img src="' + tileURL('back') + '" alt="" draggable="false"></span>';
}

/* ---------------- 摸牌 / 打牌 的动态效果 ---------------- */

/*
  服务器的推送是整份状态快照，这里对比前后两份快照，找出「谁摸了牌 / 谁打了牌」，
  再把对应的那张牌从牌墙或从该家面前「飞」到它该在的位置。
*/
const FX = (function () {
  let prev = null;

  function snap(s) {
    if (!s || s.phase === 'lobby') return null;
    return {
      roundNo: s.roundNo,
      phase: s.phase,
      players: s.players.map(function (p) {
        return {
          h: p.hand ? p.hand.length : (p.handCount || 0),
          d: (p.discards || []).length,
          m: (p.melds || []).length
        };
      })
    };
  }

  function centerOf(el) {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  /* 牌墙：摸牌从这里飞出来 */
  function wallPos() {
    return centerOf(document.querySelector('.center-core')) ||
      { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  /* 某一家面前：打牌从这里飞出去 */
  function seatPos(pos) {
    const box = $('seat-' + pos);
    const inner = box && (box.querySelector('.my-hand') || box.querySelector('.backs') || box.querySelector('.melds'));
    return centerOf(inner || box) || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function lastTile(sel) {
    const list = document.querySelectorAll(sel);
    return list.length ? list[list.length - 1] : null;
  }

  /* 从 from 飞到牌当前所在的位置（FLIP：元素本身就在终点，只补一段位移） */
  function fly(el, from, rot, dur) {
    if (!el || !el.animate || !from) return;
    const to = centerOf(el);
    if (!to) return;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

    const old = el.style.zIndex;
    el.style.zIndex = '40';
    const anim = el.animate([
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg) scale(1.28)', opacity: 0, offset: 0 },
      { transform: 'translate(' + (dx * .3) + 'px,' + (dy * .3) + 'px) rotate(' + (rot * .3) + 'deg) scale(1.1)', opacity: 1, offset: .55 },
      { transform: 'translate(' + (dx * .05) + 'px,' + (dy * .05) + 'px) scale(.97)', opacity: 1, offset: .85 },
      { transform: 'none', opacity: 1, offset: 1 }
    ], { duration: dur, easing: 'cubic-bezier(.22,.72,.28,1)' });
    anim.onfinish = anim.oncancel = function () { el.style.zIndex = old; };
    return anim;
  }

  function pulse(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;      // 强制回流，动画能重放
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 800);
  }

  function play(next) {
    const cur = snap(next);
    const before = prev;
    prev = cur;
    if (!cur || !before || !next || next.phase !== 'playing') return;
    /* 换局 / 开局不做飞牌，避免一次冒出十几张 */
    if (cur.roundNo !== before.roundNo || cur.phase !== before.phase) return;

    const me = next.me.seat;
    const wall = wallPos();
    const queue = [];

    for (let seat = 0; seat < 4; seat++) {
      const pos = POS[(seat - me + 4) % 4];
      const a = before.players[seat];
      const b = cur.players[seat];

      /* 打牌：牌河多出一张，从这一家面前飞向中央 */
      if (b.d > a.d) {
        const el = lastTile('#river-' + pos + ' .tile');
        const deg = RIVER_DEG[pos] || 0;
        if (el) queue.push({ el: el, from: seatPos(pos), rot: deg === 180 ? 12 : deg === 0 ? -12 : 0, dur: 440 });
      }

      /* 摸牌：手牌多出一张，从牌墙飞回这一家面前 */
      if (b.h > a.h) {
        const el = seat === me
          ? lastTile('#seat-bottom .tile.hand')
          : lastTile('#seat-' + pos + ' .backs .tile');
        if (el) { queue.push({ el: el, from: wall, rot: 0, dur: 380 }); pulse(el, 'fx-glow', 820); }
        pulse(document.querySelector('.center-core .big'), 'fx-pulse', 640);
      }

      /* 碰 / 杠：副露成型，从牌墙弹出 */
      if (b.m > a.m) {
        const el = lastTile('#seat-' + pos + ' .meld');
        if (el) { queue.push({ el: el, from: wall, rot: 0, dur: 380 }); pulse(el, 'fx-glow', 820); }
      }
    }

    queue.forEach(function (item, i) {
      if (i === 0) return fly(item.el, item.from, item.rot, item.dur);
      setTimeout(function () { fly(item.el, item.from, item.rot, item.dur); }, i * 90);
    });
  }

  return { play: play, fly: fly };
})();

/* ---------------- 渲染 ---------------- */

function render() {
  if (!state) return;
  const me = state.me;
  const mySeat = me.seat;

  $('roomCode').textContent = state.code;
  $('roundTag').textContent = state.roundNo ? '第 ' + state.roundNo + ' 局' : '等待开始';
  $('wallTag').textContent = state.phase === 'lobby' ? '' : '剩余 ' + state.wallCount + ' 张';

  for (let s = 0; s < 4; s++) {
    renderSeat(s, mySeat);
    renderRiver(s, mySeat);
  }
  renderCenter();
  renderActions();
  renderOverlay();
  FX.play(state);
}

function renderSeat(s, mySeat) {
  const p = state.players[s];
  const pos = POS[(s - mySeat + 4) % 4];
  const box = $('seat-' + pos);
  if (!box) return;

  const isMe = s === mySeat;
  const isTurn = state.phase === 'playing' && state.turn === s;
  const isWinner = !!(state.result && state.result.winInfo && state.result.winInfo.seat === s);
  box.className = 'seat-box' + (isTurn ? ' active' : '') + (isWinner ? ' winner' : '');

  const wind = WINDS[(s - state.dealer + 4) % 4];
  const sc = p.score || 0;
  const scCls = sc > 0 ? 'up' : sc < 0 ? 'down' : '';
  const seated = state.phase === 'lobby' ? p.seated : true;

  let html = '<div class="seat-name">';
  html += '<span class="wind">' + wind + '</span>';
  html += '<span class="nm">' + esc(p.name) + '</span>';
  if (s === state.dealer && state.roundNo) html += '<span class="zz">庄</span>';
  if (p.isBot) html += '<span class="bot">电脑</span>';
  else if (state.phase !== 'lobby' && !p.connected) html += '<span class="off">掉线</span>';
  if (state.phase !== 'lobby') html += '<span class="sc ' + scCls + '">' + (sc > 0 ? '+' + sc : sc) + '</span>';
  html += '</div>';

  if (state.phase === 'lobby') {
    if (!seated) html += '<div class="action-tip">空位</div>';
    box.innerHTML = html;
    return;
  }

  if (p.flowers && p.flowers.length) {
    html += '<div class="flowers-row">' + p.flowers.map(function (t) {
      return '<span class="flower-chip">' + label(t) + '</span>';
    }).join('') + '</div>';
  }

  // 左右家在自己面前竖摆手牌，背面取横放的牌
  const vertical = pos === 'left' || pos === 'right';
  const tileCls = vertical ? ('mini ' + (pos === 'left' ? 'flat-cw' : 'flat-ccw'))
    : (pos === 'top' ? 'small' : 'mini');

  if (p.melds && p.melds.length) {
    html += '<div class="melds' + (vertical ? ' col' : '') + '">' + p.melds.map(function (m) {
      const hidden = m.type === 'ankong' && !isMe && state.phase !== 'finished';
      if (hidden) {
        return '<div class="meld anon">' + backHTML(tileCls) + backHTML(tileCls) +
          tileHTML(m.tiles[0], tileCls) + backHTML(tileCls) + '</div>';
      }
      return '<div class="meld' + (vertical ? ' col' : '') + '">' +
        m.tiles.map(function (t) { return tileHTML(t, tileCls); }).join('') + '</div>';
    }).join('') + '</div>';
  }

  let handBlock = '';
  if (isMe) {
    /* 服务端已经把手牌理好（万→条→筒→风→箭→花），这里只把刚摸的那张
       从序列里摘出来单列在最右侧，跟真实麻将一样一眼能看出摸到什么 */
    const hand = (p.hand || []).slice();
    let drawnTile = null;
    if (state.me.canDiscard && state.me.drawnTile) {
      const i = hand.lastIndexOf(state.me.drawnTile);
      if (i >= 0) { hand.splice(i, 1); drawnTile = state.me.drawnTile; }
    }
    const pickable = state.me.canDiscard ? ' pickable' : '';
    let tiles = hand.map(function (t) { return tileHTML(t, 'hand' + pickable); }).join('');
    if (drawnTile) tiles += tileHTML(drawnTile, 'hand' + pickable + ' drawn');
    handBlock = '<div class="my-hand">' + tiles + '</div>';
    if (p.waiting && p.waiting.length) {
      handBlock += '<div class="waiting-bar"><span class="lb">听</span>' +
        p.waiting.map(function (t) { return tileHTML(t, 'mini'); }).join('') + '</div>';
    }
  } else {
    const n = p.handCount || 0;
    let backs = '';
    for (let i = 0; i < n; i++) backs += backHTML(tileCls);
    handBlock = '<div class="backs' + (vertical ? ' col' : '') + '">' + backs + '</div>';
  }

  html += handBlock;

  box.innerHTML = html;
}

/* 牌河：四家打出的牌汇集到中央，按行堆砌成块，牌面朝向打牌的人 */
const RIVER_PER_ROW = { top: 6, bottom: 6, left: 6, right: 6 };
const RIVER_DEG = { bottom: 0, top: 180, left: 270, right: 90 };

function renderRiver(s, mySeat) {
  const pos = POS[(s - mySeat + 4) % 4];
  const box = $('river-' + pos);
  if (!box) return;
  const p = state.players[s];
  const list = (p && p.discards) || [];
  if (!list.length) { box.innerHTML = ''; return; }

  const per = RIVER_PER_ROW[pos] || 6;
  const deg = RIVER_DEG[pos] || 0;
  const ld = state.lastDiscard;

  const rows = [];
  for (let i = 0; i < list.length; i += per) rows.push(list.slice(i, i + per));

  box.innerHTML = rows.map(function (row, ri) {
    return '<div class="river-row">' + row.map(function (t, ci) {
      const idx = ri * per + ci;
      const isNew = ld && ld.from === s && idx === list.length - 1 && state.phase === 'playing';
      return tileHTML(t, 'river-tile' + (isNew ? ' newdiscard' : ''), deg);
    }).join('') + '</div>';
  }).join('');
}

function renderCenter() {
  const me = state.me;
  let status;
  if (state.phase === 'lobby') status = '等待开局';
  else if (state.phase === 'finished') status = '本局结束';
  else if (me.claimOptions) status = '等你决定';
  else status = '轮到 ' + esc(state.players[state.turn].name);

  const wall = state.phase === 'lobby' ? '--' : state.wallCount;
  const log = (state.log || []).slice(-3).map(esc).join('<br>');

  $('center').innerHTML =
    '<div class="center-core">' +
    '<div class="big">' + wall + '</div>' +
    '<div class="lb">牌墙剩余</div>' +
    '<div class="turn-name">' + (state.phase === 'playing' ? status : '<b>' + status + '</b>') + '</div>' +
    '</div>' +
    '<div id="log">' + log + '</div>';
}

function renderActions() {
  const bar = $('actionbar');
  const me = state.me;
  const out = [];

  if (state.phase === 'lobby') {
    const n = state.players.filter(function (p) { return p.seated; }).length;
    out.push('<span class="action-tip">已入座 <b>' + n + '/4</b>，其他人用房间号 <b>' + state.code + '</b> 加入</span>');
    out.push('<button class="gold" data-act="start">开始对局</button>');
    out.push('<span class="action-tip">不足 4 人将自动补电脑</span>');
    bar.innerHTML = out.join('');
    return;
  }

  if (state.phase === 'finished') {
    const r = state.result || {};
    out.push('<span class="action-tip">' + esc(r.text || '本局结束') + '</span>');
    out.push('<button class="gold" data-act="next">下一局</button>');
    bar.innerHTML = out.join('');
    return;
  }

  if (me.claimOptions) {
    const o = me.claimOptions;
    out.push('<span class="action-tip">别家打出 <b>' + label(me.claimTile) + '</b>，请操作</span>');
    if (o.indexOf('hu') >= 0) out.push('<button class="hot" data-act="claim" data-val="hu">胡牌</button>');
    if (o.indexOf('kong') >= 0) out.push('<button class="gold" data-act="claim" data-val="kong">杠</button>');
    if (o.indexOf('pong') >= 0) out.push('<button class="gold" data-act="claim" data-val="pong">碰</button>');
    out.push('<button class="ghost" data-act="claim" data-val="pass">过</button>');
    bar.innerHTML = out.join('');
    return;
  }

  if (me.canZimo) {
    out.push('<button class="hot" data-act="zimo">自摸胡 ' + me.zimoResult.total + ' 花</button>');
  }
  (me.selfKong || []).forEach(function (k) {
    out.push('<button class="gold" data-act="kong" data-tile="' + k.tile + '" data-kong="' + k.type + '">' +
      (k.type === 'ankong' ? '暗杠' : '补杠') + ' ' + label(k.tile) + '</button>');
  });
  if (me.canDiscard) out.push('<span class="action-tip">轮到你出牌，点手牌打出</span>');
  else if (!me.canZimo && !(me.selfKong || []).length) out.push('<span class="action-tip">等待其他玩家…</span>');

  bar.innerHTML = out.join('');
}

function renderOverlay() {
  const ov = $('overlay');
  const r = state.result;
  if (!r) {
    if (!ov.classList.contains('hidden')) { ov.classList.add('hidden'); ov.innerHTML = ''; }
    lastResultKey = '';
    return;
  }
  const key = state.roundNo + ':' + (r.kind === 'win' ? r.winInfo.seat + ':' + r.winInfo.tile + ':' + r.winInfo.selfDraw : 'draw');
  if (key === lastResultKey) return;
  lastResultKey = key;

  let body = '';
  if (r.kind === 'win') {
    const w = r.winInfo;
    const win = state.players[w.seat];
    const res = w.result;
    const tiles = (win.hand || []).map(function (t) { return tileHTML(t, 'small'); }).join('');
    const melds = (win.melds || []).map(function (m) {
      return '<span class="meld">' + m.tiles.map(function (t) { return tileHTML(t, 'mini'); }).join('') + '</span>';
    }).join('');
    body += '<h2>' + esc(win.name) + ' ' + (w.selfDraw ? '自摸' : '胡牌') + '</h2>';
    body += '<div class="sub">' + (w.selfDraw ? '三家各付' : '点炮：' + esc(state.players[w.from].name)) + '</div>';
    body += '<div class="result-tiles">' + tiles + melds + '</div>';
    body += '<div class="hu-line">' + res.total + ' 花</div>';
    body += '<div class="sub">硬花 ' + res.hard + ' + 软花 ' + res.soft + ' → ×2，另加基础 20 花' +
      (res.bonus ? '，大胡 +' + res.bonus : '') + (res.extra ? '，附加 +' + res.extra : '') + '</div>';
    body += '<div class="pattern-list">' + res.labels.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</div>';
  } else {
    body += '<h2>荒庄</h2><div class="sub">牌墙摸完，本局无人胡牌</div>';
  }

  body += '<table class="score-table">';
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const d = r.kind === 'win' ? r.winInfo.deltas[i] : 0;
    body += '<tr><td>' + esc(p.name) + (i === state.dealer ? ' <span style="color:#e8c46a">庄</span>' : '') + '</td>' +
      '<td class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '+' + d : d) + '</td>' +
      '<td>总计 ' + p.score + '</td></tr>';
  }
  body += '</table>';
  body += '<button class="gold" data-act="next">继续下一局</button>';
  body += '<div class="sub" style="margin-top:10px">' + (r.dealerKeeps ? '庄家连庄' : '庄家换人') + '· 20 秒后自动开始</div>';

  ov.innerHTML = '<div class="result-card">' + body + '</div>';
  ov.classList.remove('hidden');
  ov.onclick = function (e) {
    if (e.target.closest('[data-act="next"]')) doNext();
  };
}

/* ---------------- 交互 ---------------- */

async function post(path, payload) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    toast('网络异常');
    return { error: 'network' };
  }
}

async function doDiscard(tile) {
  if (!state || !state.me.canDiscard) return;
  await post('/api/action', { token: token, action: { type: 'discard', tile: tile } });
}

async function doAction(action) {
  await post('/api/action', { token: token, action: action });
}

async function doNext() {
  $('overlay').classList.add('hidden');
  await post('/api/start', { token: token, next: true, fillBots: true });
}

document.addEventListener('click', function (e) {
  const t = e.target.closest('.tile.hand.pickable');
  if (t) {
    /* 点出去立刻上手感：牌往牌河方向抽走，等服务端回包 */
    if (t.animate) {
      t.animate([
        { transform: 'none', opacity: 1 },
        { transform: 'translateY(-34px) scale(1.06)', opacity: .2 }
      ], { duration: 170, easing: 'ease-out', fill: 'forwards' });
    }
    doDiscard(t.getAttribute('data-tile'));
    return;
  }

  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act');
  if (act === 'claim') doAction({ type: 'claim', value: b.getAttribute('data-val') });
  else if (act === 'kong') doAction({ type: 'kong', tile: b.getAttribute('data-tile'), kongType: b.getAttribute('data-kong') });
  else if (act === 'zimo') doAction({ type: 'zimo' });
  else if (act === 'next') doNext();
  else if (act === 'start') startGame();
});

async function startGame() {
  const d = await post('/api/start', { token: token, fillBots: true });
  if (d.error) toast(d.error);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

/* ---------------- 连接 ---------------- */

function connect() {
  if (es) es.close();
  es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
  es.onmessage = function (ev) {
    try { state = JSON.parse(ev.data); } catch (e) { return; }
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    render();
  };
  es.onerror = function () {
    if (state) toast('连接中断，正在重连…');
  };
}

async function join() {
  const name = ($('nameInput').value || '').trim() || '玩家';
  const code = ($('codeInput').value || '').trim().toUpperCase();
  $('joinBtn').disabled = true;
  const d = await post('/api/join', { name: name, code: code });
  $('joinBtn').disabled = false;
  if (d.error) { $('lobbyHint').textContent = d.error; return; }
  token = d.token;
  try {
    localStorage.setItem('mj_token', token);
    localStorage.setItem('mj_name', name);
  } catch (e) { /* ignore */ }
  connect();
}

async function boot() {
  let saved = null;
  try { saved = localStorage.getItem('mj_token'); } catch (e) { /* ignore */ }
  if (saved) {
    try {
      const r = await fetch('/api/session?token=' + encodeURIComponent(saved));
      const d = await r.json();
      if (d.ok) { token = saved; connect(); return; }
    } catch (e) { /* ignore */ }
    try { localStorage.removeItem('mj_token'); } catch (e) { /* ignore */ }
  }
  try {
    const n = localStorage.getItem('mj_name');
    if (n) $('nameInput').value = n;
  } catch (e) { /* ignore */ }
}

$('joinBtn').addEventListener('click', join);
$('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
$('nameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('codeInput').focus(); });
$('copyBtn').addEventListener('click', function () {
  const txt = state ? state.code : '';
  if (!txt) return;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('房间号已复制：' + txt); });
  else toast('房间号：' + txt);
});

boot();
