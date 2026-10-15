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

/* ---------------- 音频（Web Audio 合成，零外部资源）----------------
   背景音乐用五声音阶随机漫步（中国风宫商角徵羽），出牌/碰/杠/胡/补花各一种合成音效。
   AudioContext 必须在用户手势内创建（浏览器自动播放策略），所以首次 click 才 init。
   muted 状态持久化 localStorage，刷新后保留。 */
const AUDIO = (function () {
  let ctx = null, master = null, bgmGain = null, sfxGain = null;
  let bgmTimer = null;
  let muted = false;
  let inited = false;
  /* C 调五声音阶（宫商角徵羽）跨两个八度 */
  const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00,
                 523.25, 587.33, 659.25, 783.99, 880.00];

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.10;
      bgmGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.5;
      sfxGain.connect(master);
      /* iOS Safari unlock：播一个静音 buffer 激活 AudioContext，
         否则后续不在用户手势内的 playSfx 全是哑的 */
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
    return ctx;
  }

  /* 合成一个带 envelope 的音 */
  function blip(freq, dur, type, dest, opts) {
    if (!ctx) return;
    opts = opts || {};
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(opts.glide, t0 + dur);
    const g = ctx.createGain();
    const peak = opts.peak || 1;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(dest || sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* 白噪音 burst：做出"啪"的木质敲击感 */
  function noiseBurst(dur, filterFreq, peak) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / len * 4);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.value = peak || 0.6;
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    src.start(t0);
  }

  function playSfx(type) {
    if (muted) return;
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    switch (type) {
      case 'discard':                      // 出牌：短促木质"啪"
        noiseBurst(0.08, 1500, 0.45);
        blip(180, 0.06, 'triangle', null, { peak: 0.3 });
        break;
      case 'draw':                         // 摸牌：轻敲
        noiseBurst(0.05, 2000, 0.22);
        break;
      case 'pong':                         // 碰：两声叠加
        noiseBurst(0.1, 1200, 0.5);
        setTimeout(function () { blip(440, 0.12, 'triangle', null, { peak: 0.4 }); }, 30);
        break;
      case 'kong':                         // 杠：重击 + 低音
        noiseBurst(0.14, 900, 0.65);
        blip(110, 0.18, 'sawtooth', null, { peak: 0.4 });
        break;
      case 'hu':                           // 胡：上升清脆
        blip(523, 0.1, 'triangle', null, { peak: 0.5 });
        setTimeout(function () { blip(659, 0.1, 'triangle', null, { peak: 0.5 }); }, 90);
        setTimeout(function () { blip(784, 0.2, 'triangle', null, { peak: 0.5 }); }, 180);
        setTimeout(function () { blip(1047, 0.3, 'sine', null, { peak: 0.4 }); }, 280);
        break;
      case 'flower':                       // 补花：柔和"叮"
        blip(880, 0.15, 'sine', null, { peak: 0.35, glide: 1320 });
        break;
    }
  }

  /* BGM：五声音阶随机漫步，每 0.45s 一个音 */
  function bgmTick() {
    if (!ctx || muted) return;
    if (Math.random() < 0.8) {
      const freq = PENTA[Math.floor(Math.random() * PENTA.length)];
      blip(freq, 0.4, 'sine', bgmGain, { peak: 0.6 });
      if (Math.random() < 0.3) blip(freq / 2, 0.6, 'sine', bgmGain, { peak: 0.3 });
    }
  }

  function startBgm() {
    if (!ensureCtx()) return;
    if (muted || bgmTimer) return;
    if (ctx.state === 'suspended') ctx.resume();
    bgmTimer = setInterval(bgmTick, 450);
  }

  function stopBgm() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('mj_muted', m ? '1' : '0'); } catch (e) {}
    if (!ensureCtx()) return;
    if (m) {
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      stopBgm();
    } else {
      if (ctx.state === 'suspended') ctx.resume();
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.1);
      startBgm();
    }
  }

  function isMuted() { return muted; }

  /* 语音播报：用浏览器自带 SpeechSynthesis 读中文，受 muted 开关统一控制 */
  function speak(text) {
    if (muted || !text) return;
    if (!window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.1;
      u.volume = 0.8;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  /* 从 localStorage 恢复静音偏好 */
  try { muted = localStorage.getItem('mj_muted') === '1'; } catch (e) {}

  return {
    playSfx: playSfx,
    speak: speak,
    startBgm: startBgm,
    stopBgm: stopBgm,
    setMuted: setMuted,
    isMuted: isMuted,
    ensureCtx: ensureCtx,
    get inited() { return inited; },
    set inited(v) { inited = v; }
  };
})();

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
          m: (p.melds || []).length,
          f: (p.flowers || []).length
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
        AUDIO.playSfx('discard');
        const discards = next.players[seat].discards || [];
        const tile = discards[discards.length - 1];
        if (tile) AUDIO.speak(label(tile));
      }

      /* 摸牌：手牌多出一张，从牌墙飞回这一家面前 */
      if (b.h > a.h) {
        const el = seat === me
          ? lastTile('#seat-bottom .tile.hand')
          : lastTile('#seat-' + pos + ' .backs .tile');
        if (el) { queue.push({ el: el, from: wall, rot: 0, dur: 380 }); pulse(el, 'fx-glow', 820); }
        pulse(document.querySelector('.center-core .big'), 'fx-pulse', 640);
        AUDIO.playSfx('draw');
      }

      /* 碰 / 杠：副露成型，从牌墙弹出。melds 最后一个 tiles.length>=4 是杠，否则碰 */
      if (b.m > a.m) {
        const el = lastTile('#seat-' + pos + ' .meld');
        if (el) { queue.push({ el: el, from: wall, rot: 0, dur: 380 }); pulse(el, 'fx-glow', 820); }
        const melds = next.players[seat].melds || [];
        const last = melds[melds.length - 1];
        const isKong = last && last.tiles && last.tiles.length >= 4;
        AUDIO.playSfx(isKong ? 'kong' : 'pong');
        AUDIO.speak(isKong ? '杠' : '碰');
      }

      /* 补花：花区多出牌 */
      if (b.f > a.f) {
        AUDIO.playSfx('flower');
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
  if (state.gameOver) {
    $('roundTag').textContent = '游戏结束';
  } else if (state.roundNo) {
    const streak = state.dealerStreak > 0 ? ' · 连' + (state.dealerStreak + 1) : '';
    $('roundTag').textContent = '第' + state.circleNo + '圈 第' + state.roundInCircle + '局' + streak;
  } else {
    $('roundTag').textContent = '等待开始';
  }
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
    else if (p.ready) html += '<div class="action-tip ready-tag">已准备 ✓</div>';
    else html += '<div class="action-tip">未准备</div>';
    box.innerHTML = html;
    return;
  }

  /* 花区：中发白 + 春夏秋冬梅兰竹菊，全部用小牌面展示，硬花一目了然 */
  if (p.flowers && p.flowers.length) {
    html += '<div class="flowers-row"><span class="lb">花</span>' + p.flowers.map(function (t) {
      return tileHTML(t, 'mini flower');
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
    const readyN = state.players.filter(function (p) { return p.ready; }).length;
    const myReady = state.players[state.me.seat] && state.players[state.me.seat].ready;
    out.push('<span class="action-tip">已入座 <b>' + n + '/4</b> · 已准备 <b>' + readyN + '/' + n + '</b></span>');
    out.push('<button class="' + (myReady ? 'ghost' : 'gold') + '" data-act="ready">' + (myReady ? '已准备 ✓（取消）' : '准备') + '</button>');
    if (n < 4) out.push('<span class="action-tip">不足 4 人将自动补电脑</span>');
    else out.push('<span class="action-tip">全部准备后自动开局</span>');
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
  const key = state.roundNo + ':' + (r.kind === 'win' ? r.winInfo.seat + ':' + r.winInfo.tile + ':' + r.winInfo.selfDraw : r.kind === 'gameover' ? 'gameover' : 'draw');
  if (key === lastResultKey) return;
  lastResultKey = key;
  if (r.kind === 'win') {
    AUDIO.playSfx('hu');
    const w = r.winInfo;
    AUDIO.speak((w.selfDraw ? '自摸' : '胡牌') + ' ' + (state.players[w.seat].name || ''));
  }

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
      (res.bonus ? '，门清/大胡加分 +' + res.bonus : '') + (res.extra ? '，附加 +' + res.extra : '') + '</div>';
    body += '<div class="pattern-list">' + res.labels.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</div>';
  } else if (r.kind === 'gameover') {
    body += '<h2>游戏结束</h2><div class="sub">打满 ' + state.totalCircles + ' 圈，最终成绩</div>';
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
  if (r.kind === 'gameover') {
    body += '<button class="gold" data-act="ready">再来一局</button>';
  } else {
    body += '<button class="gold" data-act="next">继续下一局</button>';
    body += '<div class="sub" style="margin-top:10px">' + (r.dealerKeeps ? '庄家连庄' : '庄家换人') + '· 20 秒后自动开始</div>';
  }

  ov.innerHTML = '<div class="result-card">' + body + '</div>';
  ov.classList.remove('hidden');
  ov.onclick = function (e) {
    if (e.target.closest('[data-act="next"]')) doNext();
    else if (e.target.closest('[data-act="ready"]')) doReady();
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
  /* 首次用户交互：创建 AudioContext 并启动 BGM（浏览器自动播放策略要求） */
  if (!AUDIO.inited) {
    AUDIO.inited = true;
    AUDIO.ensureCtx();
    if (!AUDIO.isMuted()) AUDIO.startBgm();
    /* 激活 speechSynthesis：iOS/Android 都要求首次 speak 在用户手势内，
       否则后续 SSE 推送触发的语音播报全部被静默阻止 */
    if (window.speechSynthesis) {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.lang = 'zh-CN';
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  }

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
  else if (act === 'ready') doReady();
});

async function startGame() {
  const d = await post('/api/start', { token: token, fillBots: true });
  if (d.error) toast(d.error);
}

async function doReady() {
  await post('/api/ready', { token: token });
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

/* 静音按钮：切换 muted，同步图标；首次点击也顺带 init AudioContext */
function updateMuteIcon() {
  const btn = $('muteBtn');
  if (btn) btn.textContent = AUDIO.isMuted() ? '🔇' : '🔊';
}
$('muteBtn').addEventListener('click', function () {
  AUDIO.setMuted(!AUDIO.isMuted());
  updateMuteIcon();
  toast(AUDIO.isMuted() ? '已静音' : '声音已开');
});
updateMuteIcon();

boot();
