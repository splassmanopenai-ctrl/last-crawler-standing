// Relay server: serves the phone UI, holds every room's hidden state, sends each player only their own view.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { newGame, act, view, waitingOn, autoMove, forfeit } = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || ''; // if set, required to create a room
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Changes every time the server starts. Phones that kept the page open across a rebuild see a new value and reload,
// so nobody keeps playing on old code.
const BUILD = String(Date.now());
const rooms = new Map(); // shortcut: in memory only, a restart ends all games; add storage if that ever matters

// Saved players: who has played here and who they have played with. Rooms and games stay in memory.
// shortcut: one JSON file rewritten on change, fine for a friends-sized group; move to SQLite if it grows.
const DATA = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'players.json');
const players = Object.create(null); // id -> { name, key: sha256 of the phone's secret, known: { id: lastPlayedMs } }
try { Object.assign(players, JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch { /* first run */ }
const invites = new Map(); // player id -> [{ code, from }]; in memory, since rooms are too
let saving;
function save() {
  clearTimeout(saving);
  saving = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA), { recursive: true });
      fs.writeFileSync(DATA + '.tmp', JSON.stringify(players));
      fs.renameSync(DATA + '.tmp', DATA); // rename is atomic: a crash never leaves half a file
    } catch (e) { console.error('Could not save players:', e.message); }
  }, 200);
}
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const cleanName = name => String(name || '').trim().slice(0, 16);

// A phone proves who it is with the id and secret it was given on first visit.
function auth(player) {
  const p = player && typeof player.id === 'string' && players[player.id];
  return p && crypto.timingSafeEqual(Buffer.from(p.key, 'hex'), hash(player.secret)) ? player.id : null;
}

const openInvites = id => (invites.get(id) || []).filter(v => rooms.has(v.code) && !rooms.get(v.code).game && rooms.get(v.code).players.length < 6);

function friendsOf(room, pid) {
  if (!pid) return [];
  return Object.entries(players[pid].known).filter(([id]) => players[id]).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => ({
    id, name: players[id].name, wins: recordOf(id).wins, games: recordOf(id).games,
    here: room.players.some(p => p.pid === id),
    invited: (invites.get(id) || []).some(v => v.code === room.code),
  }));
}

const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');

const roomView = (room, i) => ({
  build: BUILD, code: room.code, you: i, host: i === 0, names: room.players.map(p => p.name),
  game: room.game ? view(room.game, i) : null,
  friends: room.game ? [] : friendsOf(room, room.players[i].pid),
  record: room.players[i].pid ? recordOf(room.players[i].pid) : null,
  timer: room.timer || 0, variant: !!room.variant, left: room.deadline ? room.deadline - Date.now() : null, // ms left, so phone clocks need not agree
});

const GONE = 'event: gone\ndata: {}\n\n'; // tells a phone to forget its seat
const drop = p => p.res && p.res.end(GONE);

// Optional move timer: when it runs out, everyone being waited on makes the dullest legal move.
function arm(room) {
  clearTimeout(room.t);
  room.deadline = null;
  const g = room.game;
  if (!g || g.phase === 'over' || !room.timer) return;
  room.deadline = Date.now() + room.timer * 1000;
  room.t = setTimeout(() => {
    for (const id of waitingOn(g)) {
      if (!waitingOn(g).includes(id)) continue;
      g.log.push(`${g.players[id].name} ran out the clock.`);
      autoMove(g, id);
    }
    arm(room);
    push(room);
  }, room.timer * 1000);
}

// Saved players keep a running record across games: played, won, bluffs called correctly, lies told.
function record(room) {
  const g = room.game;
  if (!g || g.phase !== 'over' || g.recorded) return;
  g.recorded = true;
  room.players.forEach((seat, i) => {
    const p = seat.pid && players[seat.pid];
    if (!p) return;
    const r = p.record || (p.record = { games: 0, wins: 0, callsRight: 0, lies: 0 });
    r.games++; if (g.winner === i) r.wins++;
    r.callsRight += g.stats[i].callsRight; r.lies += g.stats[i].lies;
  });
  save();
}
const recordOf = id => players[id].record || { games: 0, wins: 0, callsRight: 0, lies: 0 };

function push(room) {
  record(room);
  room.touched = Date.now();
  room.players.forEach((p, i) => p.res && p.res.write(`data: ${JSON.stringify(roomView(room, i))}\n\n`));
}

function seat(code, token) {
  const room = rooms.get(String(code).toUpperCase());
  const i = room ? room.players.findIndex(p => p.token === token) : -1;
  return i < 0 ? null : { room, i };
}

const api = {
  // Who am I? Creates a saved player on first visit (when a name is given), and lists waiting invites.
  hello({ player, name }) {
    let id = auth(player), secret;
    name = cleanName(name);
    if (!id) {
      if (!name) return { known: false, build: BUILD };
      id = crypto.randomBytes(8).toString('hex');
      secret = crypto.randomBytes(16).toString('hex');
      players[id] = { name, key: hash(secret).toString('hex'), known: {} };
      save();
    } else if (name && name !== players[id].name) { players[id].name = name; save(); }
    return { build: BUILD, known: true, id, secret, name: players[id].name, record: recordOf(id), invites: openInvites(id) };
  },

  // Invite someone you have played with before into the room you are sitting in.
  invite({ code, token, to }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    const from = s.room.players[s.i];
    if (s.room.game) throw 'That game has already started';
    if (!from.pid || typeof to !== 'string' || !players[from.pid].known[to]) throw 'You can only invite players you have played with';
    const list = (invites.get(to) || []).filter(v => v.code !== s.room.code).slice(-9);
    invites.set(to, [...list, { code: s.room.code, from: from.name }]);
    push(s.room);
    return {};
  },

  join({ code, name, passcode, player }) {
    name = cleanName(name);
    if (!name) throw 'Enter a name';
    const pid = auth(player);
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
    room.players.push({ name, token, res: null, pid });
    if (pid) invites.set(pid, (invites.get(pid) || []).filter(v => v.code !== room.code));
    push(room);
    return { code: room.code, token };
  },

  move({ code, token, move }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    const { room, i } = s;
    const type = move && move.type;
    if (type === 'start' || type === 'timer' || type === 'variant' || type === 'kick') {
      if (i !== 0) throw 'Only the host can do that';
      const playing = room.game && room.game.phase !== 'over';
      if (type === 'timer') {
        if (![0, 30, 60].includes(move.seconds)) throw 'Bad timer';
        room.timer = move.seconds;
      } else if (type === 'variant') {
        room.variant = move.on === true; // applies from the next game
      } else if (type === 'kick') {
        const t = move.target;
        if (!Number.isInteger(t) || t < 1 || t >= room.players.length) throw 'Bad target';
        if (room.game) { forfeit(room.game, t); room.players[t].kicked = true; } // seat ids must not shift mid-game
        else drop(room.players.splice(t, 1)[0]);
      } else {
        if (playing) throw 'Game in progress';
        const staying = room.players.filter(p => !p.kicked);
        if (staying.length < 2) throw 'Need at least 2 players';
        room.players.filter(p => p.kicked).forEach(drop);
        room.players = staying;
        room.game = newGame(staying.map(p => p.name), Math.random, !!room.variant);
        const pids = [...new Set(staying.map(p => p.pid).filter(Boolean))]; // everyone here has now played together
        for (const a of pids) for (const b of pids) if (a !== b) players[a].known[b] = Date.now();
        if (pids.length > 1) save();
      }
    } else {
      if (!room.game) throw 'Game has not started';
      const err = act(room.game, i, move);
      if (err) throw err;
    }
    arm(room);
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
    if (!s) return res.end(GONE);
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
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': /\.(jpg|png)$/.test(file) ? 'max-age=86400' : 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Last Crawler Standing on http://localhost:${PORT}${PASSCODE ? ' (host passcode required)' : ''}`));

setInterval(() => {
  for (const room of rooms.values()) {
    room.players.forEach(p => p.res && p.res.write(': ping\n\n')); // keeps tunnels and proxies from closing idle streams
    if (Date.now() - room.touched > 6 * 3600e3) { clearTimeout(room.t); room.players.forEach(drop); rooms.delete(room.code); }
  }
}, 25e3).unref();
