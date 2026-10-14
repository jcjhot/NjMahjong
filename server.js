'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const T = require('./tiles');
const M = require('./mahjong');
const BOT = require('./bot');

const PORT = Number(process.env.PORT || 8420);
const ROOT = path.join(__dirname, 'public');
const ROUND_AUTO_NEXT_MS = 20000;
const BOT_DELAY = Number(process.env.BOT_DELAY || 750);
const BOT_CLAIM_DELAY = Number(process.env.BOT_CLAIM_DELAY || 600);
/* 真人玩家超过该时长不出牌，由电脑托管代打，避免对局永久卡住；
   已经掉线的玩家只等 3 秒 */
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 20000);
const OFFLINE_TIMEOUT_MS = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* ================= 房间 ================= */

const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom() {
  const code = makeCode();
  const room = {
    code: code,
    players: [],
    game: null,
    createdAt: Date.now(),
    nextRoundAt: 0,
    idle: false,
    idleAt: 0,
    seq: 0
  };
  rooms.set(code, room);
  return room;
}

function findOpenRoom() {
  let best = null;
  rooms.forEach(function (r) {
    if (r.game && r.game.roundNo > 0) return;
    if (r.players.length >= 4) return;
    if (!best || r.players.length < best.players.length) best = r;
  });
  return best;
}

function broadcast(room) {
  room.seq++;
  for (let i = 0; i < room.players.length; i++) {
    const pl = room.players[i];
    if (!pl.res) continue;
    send(pl.res, buildView(room, i));
  }
}

function send(res, payload) {
  try {
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  } catch (e) { /* 连接已断开 */ }
}

function seatsInfo(room) {
  return room.players.map(function (p, i) {
    return { seat: i, name: p.name, isBot: p.isBot, connected: p.connected, online: !!p.res };
  });
}

function buildView(room, seat) {
  const g = room.game;
  const finished = g && g.phase === 'finished';

  const players = [];
  for (let i = 0; i < 4; i++) {
    const rp = room.players[i];
    const gp = g ? g.players[i] : null;
    players.push({
      seat: i,
      name: rp ? rp.name : '空位',
      isBot: rp ? rp.isBot : false,
      connected: rp ? rp.connected : false,
      seated: !!rp,
      score: gp ? gp.score : 0,
      handCount: gp ? gp.hand.length : 0,
      hand: gp && (i === seat || finished) ? gp.hand : null,
      melds: gp ? gp.melds : [],
      flowers: gp ? gp.flowers : [],
      discards: gp ? gp.discards : [],
      waiting: gp && !finished ? gp.waiting : []
    });
  }

  const me = { seat: seat, inGame: false };
  if (g) {
    me.inGame = true;
    me.isTurn = g.turn === seat && g.phase === 'playing';
    me.canDiscard = g.phase === 'playing' && !g.pending && g.turn === seat && g.players[seat].hand.length % 3 === 2;
    /* 刚摸进来的那张：客户端把它从理好的手牌里抽出来，单列在最右侧 */
    me.drawnTile = me.canDiscard ? g.drawnTile : null;
    me.selfKong = g.phase === 'playing' ? g.selfKongOptions(seat) : [];
    const z = g.phase === 'playing' ? g.selfWinCheck(seat) : null;
    me.canZimo = !!z;
    me.zimoResult = z;
    if (g.pending && g.pending.options[seat] && !g.pending.responses[seat]) {
      me.claimOptions = g.pending.options[seat];
      me.claimTile = g.pending.tile;
      me.claimFrom = g.pending.from;
      me.claimDeadline = g.pending.deadline;
    }
  }

  return {
    type: 'state',
    seq: room.seq,
    code: room.code,
    phase: g ? g.phase : 'lobby',
    turn: g ? g.turn : -1,
    dealer: g ? g.dealer : 0,
    roundNo: g ? g.roundNo : 0,
    wallCount: g ? g.wall.length : 0,
    players: players,
    lastDiscard: g ? g.lastDiscard : null,
    result: g ? g.result : null,
    log: g ? g.log.slice(-30) : [],
    me: me,
    seats: seatsInfo(room),
    canStart: room.players.length >= 2 && (!g || g.phase === 'finished'),
    roundStarted: !!g && g.roundNo > 0 && g.phase !== 'finished'
  };
}

/* ================= 机器人驱动 ================= */

/* 走完一家的一个回合（摸牌后出牌），机器人与托管共用 */
function playOneTurn(g, seat) {
  if (g.selfWinCheck(seat)) {
    g.doWin(seat, null, { selfDraw: true });
    return;
  }
  const k = BOT.decideSelfKong(g, seat);
  if (k) g.doKong(seat, k.tile, k.type);
  else g.discard(seat, BOT.chooseDiscard(g, seat));
}

function botTick(room) {
  const g = room.game;
  if (!g || g.phase !== 'playing' || room.idle) return false;

  if (g.pending) {
    if (Date.now() >= g.pending.deadline) { g.autoPassExpired(); broadcast(room); return true; }
    const keys = Object.keys(g.pending.options);
    for (let i = 0; i < keys.length; i++) {
      const s = +keys[i];
      const rp = room.players[s];
      if (rp && rp.isBot && !g.pending.responses[s] && !rp.thinking) {
        rp.thinking = true;
        setTimeout(function () {
          rp.thinking = false;
          if (room.game === g && g.pending && !g.pending.responses[s]) {
            g.claim(s, BOT.decideClaim(g, s, g.pending.options[s]));
          }
          broadcast(room);
          setImmediate(function () { botTick(room); });
        }, BOT_CLAIM_DELAY);
        return true;
      }
    }
    return false;
  }

  const seat = g.turn;
  const rp = room.players[seat];
  if (!rp || !rp.isBot || rp.thinking) return false;
  rp.thinking = true;
  setTimeout(function () {
    rp.thinking = false;
    if (room.game === g && g.phase === 'playing' && g.turn === seat && !g.pending) {
      try { playOneTurn(g, seat); } catch (e) { console.log('机器人异常:', e && e.message); }
    }
    broadcast(room);
    setImmediate(function () { botTick(room); });
  }, BOT_DELAY);
  return true;
}

/* 用「轮到谁 + 已摸牌数 + 牌河总数」标识一个回合，变化即重新计时 */
function turnKeyOf(g) {
  let d = 0;
  for (let i = 0; i < 4; i++) d += g.players[i].discards.length;
  return g.turn + ':' + d + ':' + g.players[g.turn].hand.length;
}

function humanTurnTick(room, now) {
  const g = room.game;
  if (!g || g.phase !== 'playing' || g.pending) return false;
  const rp = room.players[g.turn];
  if (!rp || rp.isBot || rp.thinking) return false;

  const key = turnKeyOf(g);
  if (room.turnKey !== key) { room.turnKey = key; room.turnAt = now; return false; }
  const limit = rp.connected === false ? OFFLINE_TIMEOUT_MS : TURN_TIMEOUT_MS;
  if (now - room.turnAt < limit) return false;

  room.turnKey = '';
  room.turnAt = now;
  const seat = g.turn;
  try {
    g.addLog(rp.name + (rp.connected === false ? ' 已掉线，由电脑代打' : ' 超时，由电脑代打'));
    playOneTurn(g, seat);
  } catch (e) { console.log('托管异常:', e && e.message); }
  broadcast(room);
  setImmediate(function () { botTick(room); });
  return true;
}

function housekeeping() {
  const now = Date.now();
  rooms.forEach(function (room) {
    const g = room.game;

    /* 没有人在线：停掉机器人，别让空房间一直空转；久无人回来自动回收 */
    const anyOnline = room.players.some(function (p) { return !!p.res; });
    if (!anyOnline) {
      room.idle = true;
      if (!room.idleAt) room.idleAt = now;
      if (now - room.idleAt > 180000) rooms.delete(room.code);
      return;
    }
    room.idle = false;
    room.idleAt = 0;

    if (g && g.phase === 'finished') {
      if (!room.nextRoundAt) room.nextRoundAt = now + ROUND_AUTO_NEXT_MS;
      else if (now >= room.nextRoundAt) {
        room.nextRoundAt = 0;
        startRound(room, g.result ? g.result.nextDealer : (g.dealer + 1) % 4);
        broadcast(room);
        return;
      }
    } else {
      room.nextRoundAt = 0;
    }
    if (g && g.phase === 'playing') {
      if (!botTick(room)) humanTurnTick(room, now);
    }
    // 清理空房间
    const humans = room.players.filter(function (p) { return !p.isBot; });
    if (humans.length === 0 && now - room.createdAt > 120000) rooms.delete(room.code);
  });
}

/* ================= 开局 ================= */

function startRound(room, dealer) {
  if (!room.game) {
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const rp = room.players[i];
      seats.push({ name: rp ? rp.name : '电脑' + (i + 1), isBot: rp ? rp.isBot : true });
    }
    room.game = new M.Game(seats);
  } else {
    if (room.players.length < 4) {
      for (let i = room.players.length; i < 4; i++) {
        room.players[i] = { name: '电脑' + (i + 1), isBot: true, connected: true, token: 'bot' + i + room.code };
        room.game.players[i].name = room.players[i].name;
        room.game.players[i].isBot = true;
      }
    }
    room.game.newRound(dealer);
  }
  room.players.forEach(function (p) { p.thinking = false; });
  room.turnKey = '';
  room.turnAt = Date.now();
}

/* ================= HTTP ================= */

function readBody(req, cb) {
  let data = '';
  req.on('data', function (c) {
    data += c;
    if (data.length > 1e6) req.destroy();
  });
  req.on('end', function () {
    try { cb(JSON.parse(data || '{}')); } catch (e) { cb({}); }
  });
}

function json(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  let p = urlPath.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('forbidden'); }
  // 牌面图是静态资源且体积不小（43 张 SVG），缓存一天；其余文件保持 no-store 方便改完即生效
  const cache = p.indexOf('/tiles/') === 0 ? 'public, max-age=86400' : 'no-store';
  fs.readFile(file, function (err, buf) {
    if (err) {
      // 顶层共享模块（tiles.js）
      const alt = path.join(__dirname, path.basename(p));
      return fs.readFile(alt, function (e2, b2) {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(alt)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(b2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}

const server = http.createServer(function (req, res) {
  const url = req.url || '/';

  if (url.indexOf('/api/session') === 0) {
    const q = new URLSearchParams(url.split('?')[1] || '');
    const token = q.get('token');
    let found = false, code = null;
    rooms.forEach(function (r) {
      if (r.players.some(function (p) { return p.token === token; })) { found = true; code = r.code; }
    });
    return json(res, { ok: found, code: code });
  }

  if (url.indexOf('/api/join') === 0 && req.method === 'POST') {
    return readBody(req, function (body) {
      const name = String(body.name || '').trim().slice(0, 8) || '玩家';
      let room = null;
      if (body.code) {
        room = rooms.get(String(body.code).toUpperCase());
        if (!room) room = createRoom();
      } else {
        room = findOpenRoom();
        if (!room) room = createRoom();
      }
      if (room.players.length >= 4) return json(res, { error: '这个房间已经坐满了' }, 400);
      const token = crypto.randomBytes(12).toString('hex');
      const seat = room.players.length;
      room.players.push({ name: name, isBot: false, connected: true, token: token, thinking: false });
      json(res, { token: token, seat: seat, code: room.code });
    });
  }

  if (url.indexOf('/api/stream') === 0) {
    const q = new URLSearchParams(url.split('?')[1] || '');
    const token = q.get('token');
    let room = null, seat = -1;
    rooms.forEach(function (r) {
      const i = r.players.findIndex(function (p) { return p.token === token; });
      if (i >= 0) { room = r; seat = i; }
    });
    if (!room) { res.writeHead(404); return res.end('no room'); }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    room.players[seat].res = res;
    room.players[seat].connected = true;
    room.idle = false;
    room.idleAt = 0;
    send(res, buildView(room, seat));
    broadcast(room);

    const ka = setInterval(function () {
      try { res.write(': ping\n\n'); } catch (e) { /* ignore */ }
    }, 20000);
    req.on('close', function () {
      clearInterval(ka);
      if (room.players[seat] && room.players[seat].res === res) room.players[seat].res = null;
      if (room.players[seat]) room.players[seat].connected = false;
      broadcast(room);
    });
    return;
  }

  if (url.indexOf('/api/action') === 0 && req.method === 'POST') {
    return readBody(req, function (body) {
      const token = body.token;
      let room = null, seat = -1;
      rooms.forEach(function (r) {
        const i = r.players.findIndex(function (p) { return p.token === token; });
        if (i >= 0) { room = r; seat = i; }
      });
      if (!room || !room.game) return json(res, { error: '无效会话' }, 400);
      const g = room.game;
      const a = body.action || {};
      let ok = false;

      if (a.type === 'discard') ok = g.discard(seat, a.tile);
      else if (a.type === 'claim') ok = g.claim(seat, a.value);
      else if (a.type === 'kong') ok = g.doKong(seat, a.tile, a.kongType);
      else if (a.type === 'zimo') ok = g.doWin(seat, null, { selfDraw: true });
      else if (a.type === 'pass') ok = g.claim(seat, 'pass');

      if (ok) {
        broadcast(room);
        setImmediate(function () { botTick(room); });
      }
      json(res, { ok: ok });
    });
  }

  if (url.indexOf('/api/start') === 0 && req.method === 'POST') {
    return readBody(req, function (body) {
      const token = body.token;
      let room = null, seat = -1;
      rooms.forEach(function (r) {
        const i = r.players.findIndex(function (p) { return p.token === token; });
        if (i >= 0) { room = r; seat = i; }
      });
      if (!room) return json(res, { error: '无效会话' }, 400);
      if (room.game && room.game.phase !== 'finished') return json(res, { error: '对局进行中' }, 400);
      if (body.fillBots !== false) {
        while (room.players.length < 4) {
          const i = room.players.length;
          room.players.push({ name: '电脑' + (i + 1), isBot: true, connected: true, token: 'bot' + i + room.code, thinking: false });
        }
      }
      if (room.players.length < 2) return json(res, { error: '至少需要 2 位玩家' }, 400);
      const dealer = body.next ? (room.game ? room.game.result.nextDealer : 0) : 0;
      startRound(room, dealer);
      broadcast(room);
      json(res, { ok: true });
    });
  }

  if (url.indexOf('/api/ping') === 0) return json(res, { ok: true, rooms: rooms.size });

  serveStatic(res, url);
});

/* ================= 启动 ================= */

function lanIP() {
  const ifs = os.networkInterfaces();
  const out = [];
  Object.keys(ifs).forEach(function (k) {
    (ifs[k] || []).forEach(function (i) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

setInterval(housekeeping, 400);

server.listen(PORT, '0.0.0.0', function () {
  const ips = lanIP();
  console.log('');
  console.log('  南京麻将 · 联机服务器已启动');
  console.log('  ------------------------------------');
  console.log('  本机打开:   http://localhost:' + PORT);
  ips.forEach(function (ip) {
    console.log('  同一 WiFi:  http://' + ip + ':' + PORT);
  });
  console.log('  ------------------------------------');
  console.log('  4 人各开一台设备打开网址，同一个房间号即可开局');
  console.log('');
});
