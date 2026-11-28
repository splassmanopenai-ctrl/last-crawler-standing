// Relay server: serves the phone UI, holds every room's hidden state, sends each player only their own view.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { newGame, act, view, waitingOn, autoMove, forfeit, actionsFor, revive, REACTIONS, BOT_NAMES, ACHIEVEMENTS, BOXES, achievementsFor, tally, SHOP, looksOf } = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || '';
const BOT_DELAY = Number(process.env.BOT_DELAY) || 900; // ms a bot "thinks" before moving; tests shorten it
const AWAY_MS = Number(process.env.AWAY_MS) || 120e3; // a player whose phone has been disconnected this long can be skipped
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Changes every time the server starts. Phones that kept the page open across a rebuild see a new value and reload,
// so nobody keeps playing on old code.
const BUILD = String(Date.now());
const rooms = new Map(); // also saved to rooms.json on every change, so a restart doesn't end games

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

// Player cards: each player's saved state, signed by the server and copied onto every phone that visits. Phones and
// server swap whatever the other has older (see `sync`), so if this server forgets (a wiped disk, a fresh deploy),
// the next phone to visit hands the cards back. shortcut: every phone holds every card, fine for a friends group.
// The signing key must outlive the disk for that to work: set STATS_KEY, or it is kept next to players.json.
// Servers sharing one STATS_KEY can also share players. shortcut: newest card wins whole; two servers updating the
// same player at once keep only the later change, fine while friends play on one server at a time.
const SIGN = (() => {
  if (process.env.STATS_KEY) return process.env.STATS_KEY;
  const f = path.join(path.dirname(DATA), 'stats.key');
  try { return fs.readFileSync(f, 'utf8'); } catch { /* first run */ }
  const k = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, k); } catch (e) { console.error('Could not save stats.key:', e.message); }
  return k;
})();
const sign = d => crypto.createHmac('sha256', SIGN).update(d).digest('hex');
const touch = id => { players[id].at = Date.now(); save(); }; // every change gets a timestamp, so the newest card wins
function cardOf(id) {
  const { name, key, known, record, points, ach, spent, owned, title, back, at } = players[id];
  const d = JSON.stringify({ id, name, key, known, record, points, ach, spent, owned, title, back, at: at || 0 });
  return { d, s: sign(d) };
}
// Take back any card that is genuine and newer than what this server holds.
function absorb(cards) {
  if (!Array.isArray(cards)) return;
  for (const c of cards.slice(0, 500)) {
    if (!c || typeof c.d !== 'string' || typeof c.s !== 'string' || c.s.length !== 64) continue;
    if (!crypto.timingSafeEqual(Buffer.from(sign(c.d)), Buffer.from(c.s))) continue;
    const { id, ...p } = JSON.parse(c.d);
    if (!players[id] || (players[id].at || 0) < p.at) { players[id] = p; save(); }
  }
}
// Points earned outside any one game, banked for badges and perks later.
const pointsFor = (won, callsRight) => 1 + (won ? 3 : 0) + callsRight;

// Turn alerts: Web Push (RFC 8291 encryption, RFC 8292 VAPID) with Node's own crypto, no dependencies. The VAPID key
// is derived from the signing key, so phones' alert subscriptions survive restarts and redeploys while STATS_KEY does.
const b64u = b => Buffer.from(b).toString('base64url');
const VAPID = (() => {
  const d = crypto.createHash('sha256').update('vapid:' + SIGN).digest(), ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  return { key, pub: b64u(pub) };
})();
const PUSH_CONTACT = process.env.PUSH_CONTACT || 'https://github.com/splassmanopenai-ctrl/last-crawler-standing';
// Only the browsers' own push services: a subscription is a URL the server will POST to, so never an arbitrary one.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const pushable = u => (u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)) || (!!process.env.PUSH_ALLOW && u.origin === process.env.PUSH_ALLOW); // PUSH_ALLOW: tests only
function cleanSub(sub) {
  try {
    const url = new URL(sub.endpoint), p256dh = Buffer.from(sub.keys.p256dh, 'base64url'), auth = Buffer.from(sub.keys.auth, 'base64url');
    if (!pushable(url) || p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
    return { endpoint: url.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  } catch { return null; }
}
// aes128gcm content encoding, one record: salt | record size | key id length | our public key | ciphertext.
function encryptPush(sub, text) {
  const ua = Buffer.from(sub.keys.p256dh, 'base64url'), auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'), as = ecdh.generateKeys(), salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(ua), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, as, body]);
}
async function sendPush(p, data) {
  const url = new URL(p.sub.endpoint);
  const part = o => b64u(JSON.stringify(o));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_CONTACT })}`;
  const jwt = `${unsigned}.${b64u(crypto.sign('sha256', Buffer.from(unsigned), { key: VAPID.key, dsaEncoding: 'ieee-p1363' }))}`;
  const r = await fetch(p.sub.endpoint, { method: 'POST', body: encryptPush(p.sub, JSON.stringify(data)), headers: {
    TTL: '120', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${jwt}, k=${VAPID.pub}` } });
  if (r.status === 404 || r.status === 410) p.sub = null; // the phone unsubscribed or the subscription expired
}
// Alert anyone the game is waiting on whose screen is off or who has left the page: once per decision, not per update.
function alertTurns(room) {
  const g = room.game;
  if (!g || g.phase === 'over') return;
  const key = `${g.phase}:${g.turn}:${JSON.stringify(g.cur)}`;
  for (const i of waitingOn(g)) {
    const p = room.players[i];
    if (!p || p.bot || !p.sub || (p.res && !p.hidden) || p.pinged === key) continue;
    p.pinged = key;
    sendPush(p, { title: 'Your move!', body: `Room ${room.code}: ${g.log[g.log.length - 1]}`, code: room.code })
      .catch(e => console.error('Turn alert failed:', e.message));
  }
}

// Sealed rooms: each phone in a room also keeps an encrypted copy of it, so a game survives a server that forgot it.
// Encrypted (not just signed) because a room holds everyone's hidden cards and seat tokens. Same key as the cards.
const ROOM_KEY = crypto.createHash('sha256').update('room:' + SIGN).digest();
function seal(data) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', ROOM_KEY, iv);
  const body = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function unseal(text) {
  const b = Buffer.from(String(text), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', ROOM_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString()); // throws if tampered with
}

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
  build: BUILD, code: room.code, you: i, practice: !!room.practice, bots: room.players.map(p => !!p.bot),
  ready: room.game && room.game.phase === 'over' ? room.players.map((p, j) => p.bot || room.ready.has(j)) : null, host: i === 0, names: room.players.map(p => p.name),
  game: room.game ? view(room.game, i) : null,
  friends: room.game ? [] : friendsOf(room, room.players[i].pid),
  record: room.players[i].pid ? recordOf(room.players[i].pid) : null,
  points: room.players[i].pid ? players[room.players[i].pid].points || 0 : 0,
  // Everyone's player cards, for each phone to keep: shared in the lobby and after each game, when they change.
  seal: room.sealed || (room.sealed = seal(roomData(room))), // this phone's encrypted backup of the room
  achieved: (room.game && room.game.achieved && room.game.achieved[i]) || [], // this seat's new achievements from the game just ended
  timer: room.timer || 0, variant: !!room.variant, left: room.deadline ? room.deadline - Date.now() : null, // ms left, so phone clocks need not agree
  away: awayList(room),
  looks: looksFor(room),
  vapid: VAPID.pub, alerts: !!room.players[i].sub, // turn alerts: the key phones subscribe with, and whether this seat has
});
// Each seat's title, card back and badge, for everyone at the table to see.
const looksFor = room => room.players.map(p => p.pid ? looksOf(players[p.pid]) : null);
// Seats whose phone has been gone a while: the others may move for them, so one closed browser can't stall a game.
const isAway = p => !p.bot && !p.kicked && !p.res && p.away && Date.now() - p.away > AWAY_MS;
const awayList = room => room.players.map(isAway);

// TV view: the table as seen from no seat at all (no hidden cards), for a shared screen. Anyone with the room code
// can watch, as anyone with it can join the lobby.
const tvView = room => ({ build: BUILD, tv: true, code: room.code, names: room.players.map(p => p.name), bots: room.players.map(p => !!p.bot),
  game: room.game ? view(room.game, -1) : null, timer: room.timer || 0, variant: !!room.variant,
  left: room.deadline ? room.deadline - Date.now() : null, away: awayList(room), looks: looksFor(room) });

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
  if (!g || g.phase !== 'over' || g.recorded || room.practice) return; // practice games against bots don't count
  g.recorded = true;
  room.players.forEach((seat, i) => {
    const p = seat.pid && players[seat.pid];
    if (!p) return;
    const r = p.record || (p.record = { games: 0, wins: 0, callsRight: 0, lies: 0 });
    r.games++; if (g.winner === i) r.wins++;
    r.callsRight += g.stats[i].callsRight; r.lies += g.stats[i].lies;
    // Career totals of every stat, and runs of wins and losses, for the career achievements.
    r.t = r.t || {};
    for (const [k, n] of Object.entries(tally(g, i))) if (typeof n === 'number') r.t[k] = (r.t[k] || 0) + n;
    r.streak = g.winner === i ? (r.streak || 0) + 1 : 0;
    r.best = Math.max(r.best || 0, r.streak);
    r.cold = g.winner === i ? 0 : (r.cold || 0) + 1;
    p.points = (p.points || 0) + pointsFor(g.winner === i, g.stats[i].callsRight);
    // New achievements: each pays its box's points, and the room hears about it.
    const got = achievementsFor(g, i, r, Object.keys(p.known).length, p.ach, p.points);
    if (got.length) {
      p.ach = p.ach || {}; g.achieved = g.achieved || {}; g.achieved[i] = got;
      for (const k of got) {
        p.ach[k] = Date.now();
        p.points += BOXES[ACHIEVEMENTS[k].box].points;
        g.log.push(`New Achievement! ${seat.name}: ${ACHIEVEMENTS[k].title}`);
      }
    }
    touch(seat.pid);
  });
}
const recordOf = id => players[id].record || { games: 0, wins: 0, callsRight: 0, lies: 0 };

// Rooms on disk: everything except live connections and timers. Written in one go via a temp file, so a crash
// mid-write never leaves half a file. shortcut: rewrites every room on each change; fine for a friends-sized server.
const ROOMS = path.join(path.dirname(DATA), 'rooms.json');
let savingRooms;
const roomData = r => ({
  code: r.code, practice: r.practice, timer: r.timer, variant: r.variant, touched: r.touched, ready: [...r.ready],
  players: r.players.map(({ name, token, pid, bot, kicked, sub }) => ({ name, token, pid, bot, kicked, sub })),
  // plain data; the shuffler function is left out by JSON and reattached on load. Phones only ever show the last 40
  // log lines, so older ones are dropped to keep every phone's sealed copy small.
  game: r.game && { ...r.game, log: r.game.log.slice(-60) },
});
// A room read back from disk or from a phone's sealed copy.
const roomFrom = r => ({ ...r, ready: new Set(r.ready), players: r.players.map(p => ({ ...p, res: null, away: Date.now() })), game: r.game && revive(r.game) });
function saveRooms() {
  clearTimeout(savingRooms);
  savingRooms = setTimeout(() => {
    const data = [...rooms.values()].map(roomData);
    try {
      fs.mkdirSync(path.dirname(ROOMS), { recursive: true });
      fs.writeFileSync(ROOMS + '.tmp', JSON.stringify(data));
      fs.renameSync(ROOMS + '.tmp', ROOMS);
    } catch (e) { console.error('Could not save rooms:', e.message); }
  }, 300);
}
try {
  for (const r of JSON.parse(fs.readFileSync(ROOMS, 'utf8'))) {
    rooms.set(r.code, roomFrom(r));
  }
} catch { /* first run, or no rooms */ }

function push(room) {
  record(room);
  room.touched = Date.now();
  room.sealed = seal(roomData(room)); room.restored = false;
  room.players.forEach((p, i) => p.res && p.res.write(`data: ${JSON.stringify(roomView(room, i))}\n\n`));
  alertTurns(room);
  if (room.tvs && room.tvs.size) { const msg = `data: ${JSON.stringify(tvView(room))}\n\n`; room.tvs.forEach(r => r.write(msg)); }
  room.awaySeen = awayList(room).join();
  nudgeBots(room);
  saveRooms();
}

function seat(code, token) {
  const room = rooms.get(String(code).toUpperCase());
  const i = room ? room.players.findIndex(p => p.token === token) : -1;
  return i < 0 ? null : { room, i };
}

// New seat token: the old phone is signed out of the seat (and goes back to the join screen).
function reissue(room, p) {
  p.token = crypto.randomBytes(16).toString('hex');
  drop(p); p.res = null;
  saveRooms();
  return p.token;
}

function startGame(room) {
  const staying = room.players.filter(p => !p.kicked);
  if (staying.length < 2) throw 'Need at least 2 players';
  room.players.filter(p => p.kicked).forEach(drop);
  room.players = staying;
  room.ready = new Set();
  room.game = newGame(staying.map(p => p.name), Math.random, !!room.variant);
  const pids = [...new Set(staying.map(p => p.pid).filter(Boolean))]; // everyone here has now played together
  for (const a of pids) for (const b of pids) if (a !== b) players[a].known[b] = Date.now();
  if (pids.length > 1) pids.forEach(touch);
}

// Bots, for practice games: a simple, slightly reckless opponent. Never sees hidden cards except its own.
function botMove(g, id) {
  const p = g.players[id], A = actionsFor(g.variant), c = g.cur, a = c && A[c.action];
  const has = r => p.cards.some(x => !x.revealed && x.role === r);
  const chance = n => Math.random() < n;
  const rivals = g.players.filter(x => x.id !== id && x.cards.some(y => !y.revealed));
  const strongest = rivals.reduce((m, x) => (x.coins + 3 * x.cards.filter(y => !y.revealed).length > m.coins + 3 * m.cards.filter(y => !y.revealed).length ? x : m), rivals[0]);
  const move = (() => {
    if (g.phase === 'turn') {
      if (p.coins >= 7) return { type: 'action', action: 'coup', target: strongest.id };
      if (p.coins >= 3 && (has('backstabber') || chance(.15))) return { type: 'action', action: 'assassinate', target: strongest.id };
      if (has('showrunner') || chance(.25)) return { type: 'action', action: 'tax' };
      if (has('goblin') && strongest.coins >= 2) return { type: 'action', action: 'steal', target: strongest.id };
      return { type: 'action', action: chance(.5) ? 'aid' : 'income' };
    }
    if (g.phase === 'react') {
      if (a.blockBy && (c.target == null || c.target === id)) {
        const mine = a.blockBy.find(has);
        if (mine) return { type: 'block', role: mine };
        if (c.target === id && chance(.25)) return { type: 'block', role: a.blockBy[0] };
      }
      return g.canChallenge && chance(c.target === id ? .3 : .12) ? { type: 'challenge' } : { type: 'pass' };
    }
    if (g.phase === 'blockReact') return chance(.15) ? { type: 'challenge' } : { type: 'pass' };
    if (g.phase === 'lose') return { type: 'lose', card: p.cards.findIndex(x => !x.revealed) };
    return null; // exchange, show and peek: take the dullest legal move
  })();
  if (!move || act(g, id, move)) autoMove(g, id);
}

// After every update, if the game is waiting on a bot, let it think for a moment and move.
function nudgeBots(room) {
  const g = room.game;
  if (room.botTimer || !g || g.phase === 'over') return;
  const id = waitingOn(g).find(i => room.players[i] && room.players[i].bot);
  if (id == null) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game !== g || !waitingOn(g).includes(id)) return nudgeBots(room);
    botMove(g, id);
    arm(room);
    push(room);
  }, BOT_DELAY * (1 + Math.random()));
}

const api = {
  // Two-way sync of player cards. The phone says which cards it has and how new (`have`: id -> timestamp) and
  // may send cards; it gets back every card the server has newer, and the ids the server wants from it.
  sync({ have, cards }) {
    absorb(cards);
    have = have && typeof have === 'object' ? have : {};
    const ids = Object.keys(have).slice(0, 500);
    return {
      cards: Object.keys(players).filter(id => !(have[id] >= (players[id].at || 0))).map(cardOf),
      want: ids.filter(id => !players[id] || (players[id].at || 0) < have[id]),
    };
  },

  // A phone whose room this server doesn't know (it restarted, or its disk was wiped) hands back its sealed copy.
  // A copy only replaces a room nobody has played in since it came back, and only with a newer copy.
  restore({ seal: text }) {
    let r;
    try { r = unseal(text); } catch { throw 'That room copy is not valid'; }
    if (Date.now() - r.touched > 6 * 3600e3) throw 'That game is too old';
    const old = rooms.get(r.code);
    if (old && !(old.restored && old.touched < r.touched)) return {};
    if (!old && rooms.size >= MAX_ROOMS) throw 'The server is full right now. Try again in a little while.';
    if (old) { clearTimeout(old.t); old.players.forEach(drop); }
    const room = { ...roomFrom(r), restored: true };
    rooms.set(room.code, room);
    arm(room); nudgeBots(room); saveRooms();
    return {};
  },

  // Host tool: a one-time link that moves a player's seat to another phone (theirs died, or they switched).
  reseat({ code, token, target }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    if (s.i !== 0) throw 'Only the host can do that';
    const p = Number.isInteger(target) && s.room.players[target];
    if (!p || p.bot || p.kicked) throw 'Bad player';
    return { token: reissue(s.room, p) };
  },

  // A knocked-out player heckles: a short line floats across every screen in the room.
  react({ code, token, i, h }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    const g = s.room.game, me = s.room.players[s.i];
    if (!g || g.phase === 'over' || g.players[s.i].cards.some(c => !c.revealed)) throw 'Only knocked-out crawlers can heckle';
    // A standard heckle by number, or one bought from the Loot Shop by key.
    const mine = h && SHOP[h] && SHOP[h].kind === 'heckle' && me.pid && (players[me.pid].owned || {})[h];
    const text = mine ? SHOP[h].name : Number.isInteger(i) && REACTIONS[i];
    if (!text) throw 'Bad reaction';
    if (Date.now() - (me.reacted || 0) < 1200) throw 'Easy there';
    me.reacted = Date.now();
    const msg = `event: react\ndata: ${JSON.stringify({ name: me.name, text })}\n\n`;
    s.room.players.forEach(p => p.res && p.res.write(msg));
    if (s.room.tvs) s.room.tvs.forEach(r => r.write(msg));
    return {};
  },

  // Who am I? Creates a saved player on first visit (when a name is given), and lists waiting invites.
  hello({ player, name }) {
    let id = auth(player), secret;
    name = cleanName(name);
    if (!id) {
      if (!name) return { known: false, build: BUILD };
      id = crypto.randomBytes(8).toString('hex');
      secret = crypto.randomBytes(16).toString('hex');
      players[id] = { name, key: hash(secret).toString('hex'), known: {} };
      touch(id);
    } else if (name && name !== players[id].name) { players[id].name = name; touch(id); }
    return { build: BUILD, known: true, id, secret, name: players[id].name, record: recordOf(id), points: players[id].points || 0, ach: players[id].ach || {},
      spent: players[id].spent || 0, owned: players[id].owned || {}, title: players[id].title || null, back: players[id].back || null, invites: openInvites(id) };
  },

  // Turn alerts: this seat's phone hands over its push subscription.
  pushsub({ code, token, sub }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    const clean = cleanSub(sub);
    if (!clean) throw "That phone can't do alerts";
    s.room.players[s.i].sub = clean;
    saveRooms();
    return {};
  },

  // The phone's screen went off or came back: alerts go to hidden screens even while their connection lingers.
  seen({ code, token, hidden }) {
    const s = seat(code, token);
    if (!s) throw 'You are not in this room';
    s.room.players[s.i].hidden = hidden === true;
    if (hidden === true) alertTurns(s.room);
    return {};
  },

  // The Loot Shop: spend banked points on a cosmetic. Points earned never go down; the balance is points - spent.
  buy({ player, item }) {
    const id = auth(player), it = Object.hasOwn(SHOP, item) && SHOP[item];
    if (!id) throw 'Play a game first to become a saved player';
    if (!it) throw 'No such item';
    const p = players[id];
    p.owned = p.owned || {};
    if (p.owned[item]) throw 'You already own that';
    if ((p.points || 0) - (p.spent || 0) < it.cost) throw 'Not enough points';
    p.owned[item] = Date.now(); p.spent = (p.spent || 0) + it.cost;
    touch(id);
    return { spent: p.spent, owned: p.owned };
  },

  // Wear a title (a bought one, or 'a:<achievement>' for one you've earned) and/or a card back. null takes it off.
  wear({ player, title, back }) {
    const id = auth(player);
    if (!id) throw 'Play a game first to become a saved player';
    const p = players[id], owned = p.owned || {};
    if (title !== undefined) {
      const ok = title === null || (typeof title === 'string' && (title.startsWith('a:') ? (p.ach || {})[title.slice(2)]
        : owned[title] && SHOP[title].kind === 'title'));
      if (!ok) throw "You haven't got that title";
      p.title = title;
    }
    if (back !== undefined) {
      if (back !== null && !(owned[back] && SHOP[back].kind === 'back')) throw "You haven't got that card back";
      p.back = back;
    }
    touch(id);
    for (const room of rooms.values()) if (room.players.some(s => s.pid === id)) push(room); // show it at the table now
    return { title: p.title || null, back: p.back || null };
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

  join({ code, name, passcode, player, practice }) {
    name = cleanName(name);
    if (!name) throw 'Enter a name';
    const pid = auth(player);
    let room;
    if (code) {
      room = rooms.get(String(code).trim().toUpperCase());
      if (!room) throw 'No such room';
      // A saved player rejoining a room they are already in takes their seat back, e.g. from a new phone.
      const mine = pid && room.players.find(p => p.pid === pid && !p.kicked);
      if (mine) return { code: room.code, token: reissue(room, mine) };
      if (room.practice) throw "That's a practice room";
      if (room.game) throw 'That game has already started';
      if (room.players.length >= 6) throw 'Room is full';
    } else {
      if (PASSCODE && passcode !== PASSCODE) throw 'Wrong host passcode';
      if (rooms.size >= MAX_ROOMS) throw 'The server is full right now. Try again in a little while.';
      if (tooMany('room', this.ip, 12, 10 * 60e3)) throw 'Too many new rooms from this device. Try again in a few minutes.';
      do room = { code: newCode(), players: [], game: null, ready: new Set(), practice: practice === true }; while (rooms.has(room.code));
      rooms.set(room.code, room);
    }
    const token = crypto.randomBytes(16).toString('hex');
    room.players.push({ name, token, res: null, pid });
    if (room.practice && room.players.length === 1) // two bots join a practice room
      for (const bot of BOT_NAMES.slice().sort(() => Math.random() - .5).slice(0, 2))
        room.players.push({ name: bot, token: crypto.randomBytes(16).toString('hex'), res: null, bot: true });
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
        startGame(room);
      }
    } else if (type === 'skip') {
      // Anyone still playing may make the dullest move for a seat whose phone has been gone a while.
      const g = room.game, t = move.target;
      if (!g || g.phase === 'over') throw 'Game has not started';
      if (!Number.isInteger(t) || !room.players[t] || !isAway(room.players[t]) || !waitingOn(g).includes(t)) throw "They're not holding up the game";
      g.log.push(`${room.players[i].name} skipped ${room.players[t].name}, who wandered off.`);
      autoMove(g, t);
    } else if (type === 'ready') {
      // Rematch: everyone taps ready; when the last human does, the next game starts by itself.
      if (!room.game || room.game.phase !== 'over') throw 'The game is still on';
      room.ready.add(i);
      if (room.players.every((p, j) => p.bot || p.kicked || room.ready.has(j))) startGame(room);
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

// Rate limits, so one noisy visitor to a public link can't clog the server.
// shortcut: in-memory counters per address; stops a careless or bored stranger, not a determined attack.
const MAX_ROOMS = 300;
const hits = new Map(); // "kind address" -> { n, until }
function tooMany(kind, ip, max, ms) {
  const k = `${kind} ${ip}`, now = Date.now();
  const h = hits.get(k);
  if (!h || now > h.until) { hits.set(k, { n: 1, until: now + ms }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.until) hits.delete(k); }, 60e3).unref();
// Behind a proxy (Render, the Cloudflare tunnel) every request arrives from the proxy, so use the visitor address it
// passes along; otherwise all players would share one limit. The header could be faked by someone reaching the server
// directly, which only lets them dodge their own limit.
const addressOf = req => String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : '';

  if (req.method === 'POST' && Object.hasOwn(api, name)) {
    const ip = addressOf(req);
    if (tooMany('api', ip, 120, 60e3)) return json(res, 429, { error: 'Slow down a little and try again.' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 512e3) req.destroy(); }); // room for a phone's player cards
    req.on('end', () => {
      try { json(res, 200, api[name].call({ ip }, JSON.parse(body))); }
      catch (e) { json(res, 400, { error: typeof e === 'string' ? e : 'Bad request' }); }
    });
    return;
  }

  if (name === 'events' && url.searchParams.has('tv')) {
    const room = rooms.get(String(url.searchParams.get('code')).toUpperCase());
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    if (!room) return res.end(GONE);
    room.tvs = room.tvs || new Set();
    if (room.tvs.size >= 4) return res.end(GONE);
    room.tvs.add(res);
    res.write(`data: ${JSON.stringify(tvView(room))}\n\n`);
    req.on('close', () => room.tvs.delete(res));
    return;
  }

  if (name === 'events') {
    const s = seat(url.searchParams.get('code'), url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    if (!s) return res.end(GONE);
    const p = s.room.players[s.i];
    if (p.res) p.res.end();
    p.res = res; p.away = null; p.hidden = false;
    res.write(`data: ${JSON.stringify(roomView(s.room, s.i))}\n\n`);
    req.on('close', () => { if (p.res === res) { p.res = null; p.away = Date.now(); } });
    return;
  }

  const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Nope' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': /\.(jpg|png)$/.test(file) ? 'max-age=86400' : 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => {
  for (const room of rooms.values()) { arm(room); nudgeBots(room); } // restored games: restart clocks and bots
  console.log(`Last Crawler Standing on http://localhost:${PORT}${PASSCODE ? ' (host passcode required)' : ''}${rooms.size ? `, ${rooms.size} room(s) restored` : ''}`);
});

setInterval(() => {
  for (const room of rooms.values()) {
    room.players.forEach(p => p.res && p.res.write(': ping\n\n')); // keeps tunnels and proxies from closing idle streams
    if (room.tvs) room.tvs.forEach(r => r.write(': ping\n\n'));
    if (room.game && room.game.phase !== 'over' && awayList(room).join() !== room.awaySeen) push(room); // someone just counted as away
    if (Date.now() - room.touched > 6 * 3600e3) { clearTimeout(room.t); room.players.forEach(drop); if (room.tvs) room.tvs.forEach(r => r.end(GONE)); rooms.delete(room.code); saveRooms(); }
  }
}, 25e3).unref();
