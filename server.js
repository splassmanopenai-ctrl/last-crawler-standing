// Relay server: serves the phone UI, holds every room's hidden state, sends each player only their own view.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { newGame, act, view } = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || ''; // if set, required to create a room
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const rooms = new Map(); // shortcut: in memory only, a restart ends all games; add storage if that ever matters

const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');

const roomView = (room, i) => ({
  code: room.code, you: i, host: i === 0, names: room.players.map(p => p.name),
  game: room.game ? view(room.game, i) : null,
});

function push(room) {
  room.touched = Date.now();
  room.players.forEach((p, i) => p.res && p.res.write(`data: ${JSON.stringify(roomView(room, i))}\n\n`));
}

function seat(code, token) {
  const room = rooms.get(String(code).toUpperCase());
  const i = room ? room.players.findIndex(p => p.token === token) : -1;
  return i < 0 ? null : { room, i };
}

const api = {
  join({ code, name, passcode }) {
    name = String(name || '').trim().slice(0, 16);
    if (!name) throw 'Enter a name';
    let room;
    if (code) {
      room = rooms.get(String(code).trim().toUpperCase());
      if (!room) throw 'No such room';
      if (room.game) throw 'That game has already started';
      if (room.players.length >= 6) throw 'Room is full';
    } else {
      if (PASSCODE && passcode !== PASSCODE) throw 'Wrong host passcode';
      do room = { code: newCode(), players: [], game: null }; while (rooms.has(room.code));
      rooms.set(room.code, room);
    }
    const token = crypto.randomBytes(16).toString('hex');
    room.players.push({ name, token, res: null });
    push(room);
    return { code: room.code, token };
  },

  move({ code, token, move }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    const { room, i } = s;
    if (move && move.type === 'start') {
      if (i !== 0) throw 'Only the host can start';
      if (room.game && room.game.phase !== 'over') throw 'Game in progress';
      if (room.players.length < 2) throw 'Need at least 2 players';
      room.game = newGame(room.players.map(p => p.name));
    } else {
      if (!room.game) throw 'Game has not started';
      const err = act(room.game, i, move);
      if (err) throw err;
    }
    push(room);
    return {};
  },
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : '';

  if (req.method === 'POST' && Object.hasOwn(api, name)) {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try { json(res, 200, api[name](JSON.parse(body))); }
      catch (e) { json(res, 400, { error: typeof e === 'string' ? e : 'Bad request' }); }
    });
    return;
  }

  if (name === 'events') {
    const s = seat(url.searchParams.get('code'), url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    if (!s) return res.end('event: gone\ndata: {}\n\n'); // tells the phone to forget this seat
    const p = s.room.players[s.i];
    if (p.res) p.res.end();
    p.res = res;
    res.write(`data: ${JSON.stringify(roomView(s.room, s.i))}\n\n`);
    req.on('close', () => { if (p.res === res) p.res = null; });
    return;
  }

  const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Nope' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Last Crawler Standing on http://localhost:${PORT}${PASSCODE ? ' (host passcode required)' : ''}`));

setInterval(() => {
  for (const room of rooms.values()) {
    room.players.forEach(p => p.res && p.res.write(': ping\n\n')); // keeps tunnels and proxies from closing idle streams
    if (Date.now() - room.touched > 6 * 3600e3) { room.players.forEach(p => p.res && p.res.end()); rooms.delete(room.code); }
  }
}, 25e3).unref();
