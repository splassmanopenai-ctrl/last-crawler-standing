const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ACHIEVEMENTS, BOXES } = require('../public/game.js');

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, PASSCODE: '', BOT_DELAY: '15', AWAY_MS: '300', ...env } });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/`); return child; } catch { await sleep(100); } }
  throw new Error('server did not start');
}
async function post(name, body) {
  const r = await fetch(`http://localhost:${PORT}/api/${name}`, { method: 'POST', body: JSON.stringify(body) });
  return { ok: r.ok, ...(await r.json()) };
}

test('players are saved, learn who they played with, and can invite them', async () => {
  let server = await boot();
  try {
    assert.strictEqual((await post('hello', {})).known, false);
    const a = await post('hello', { name: 'Ann' }), b = await post('hello', { name: 'Bo' }), c = await post('hello', { name: 'Cy' });
    const A = { id: a.id, secret: a.secret }, B = { id: b.id, secret: b.secret }, C = { id: c.id, secret: c.secret };
    assert.strictEqual((await post('hello', { player: { id: a.id, secret: 'wrong' } })).known, false);

    // Ann and Bo play a game together.
    const r1 = await post('join', { name: 'Ann', player: A });
    await post('join', { name: 'Bo', code: r1.code, player: B });
    assert.ok((await post('move', { code: r1.code, token: r1.token, move: { type: 'start' } })).ok);

    // Ann opens a new room: she may invite Bo, but not Cy, whom she has never played with.
    const r2 = await post('join', { name: 'Ann', player: A });
    assert.strictEqual((await post('invite', { code: r2.code, token: r2.token, to: c.id })).ok, false);
    assert.ok((await post('invite', { code: r2.code, token: r2.token, to: b.id })).ok);
    assert.deepStrictEqual((await post('hello', { player: B })).invites, [{ code: r2.code, from: 'Ann' }]);
    assert.deepStrictEqual((await post('hello', { player: C })).invites, []);

    // Joining uses up the invite.
    await post('join', { name: 'Bo', code: r2.code, player: B });
    assert.deepStrictEqual((await post('hello', { player: B })).invites, []);

    // Finish the first game: Ann, as host, removes Bo, so Ann wins. Both records update.
    assert.ok((await post('move', { code: r1.code, token: r1.token, move: { type: 'kick', target: 1 } })).ok);
    const annRec = (await post('hello', { player: A })).record, boRec = (await post('hello', { player: B })).record;
    assert.deepStrictEqual([annRec.games, annRec.wins, boRec.games, boRec.wins], [1, 1, 1, 0]);
    // Points: 1 a game, 3 a win, plus each new achievement's box (bronze 2, silver 5, gold 10).
    const annNow = await post('hello', { player: A }), boNow = await post('hello', { player: B });
    const boxes = ach => Object.keys(ach).reduce((n, k) => n + BOXES[ACHIEVEMENTS[k].box].points, 0);
    assert.ok(['boyscout', 'first', 'firstwin', 'untouched', 'duel'].every(k => annNow.ach[k]));
    assert.ok(['first', 'opening'].every(k => boNow.ach[k]));
    assert.deepStrictEqual([annNow.points, boNow.points], [4 + boxes(annNow.ach), 1 + boxes(boNow.ach)]);

    // A restart keeps the players but, as before, not the rooms.
    await sleep(400);
    server.kill(); await sleep(200);
    server = await boot();
    const again = await post('hello', { player: A });
    assert.strictEqual(again.name, 'Ann');
    assert.strictEqual(again.secret, undefined);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'players.json'), 'utf8'));
    assert.ok(saved[a.id].known[b.id] && saved[b.id].known[a.id] && !saved[a.id].known[c.id]);
    assert.ok(!JSON.stringify(saved).includes(a.secret), 'secrets are stored hashed');
  } finally { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// Reads the room's live updates and answers whenever the game waits on us, until the game ends.
async function playOut(code, token, timeoutMs) {
  const res = await fetch(`http://localhost:${PORT}/api/events?code=${code}&token=${token}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', last = null;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
      if (!chunk.startsWith('data: ')) continue;
      const v = JSON.parse(chunk.slice(6)), g = v.game;
      last = v;
      if (!g) continue;
      if (g.phase === 'over') { reader.cancel(); return v; }
      const me = g.players[0], live = me.cards.filter(c => !c.revealed).length;
      let m = null;
      if (g.phase === 'turn' && g.turn === 0) m = { type: 'action', action: me.coins >= 10 ? 'coup' : 'income', target: g.players.findIndex((p, i) => i && p.cards.some(c => !c.revealed)) };
      else if ((g.phase === 'react' || g.phase === 'blockReact') && g.waiting.includes(0)) m = { type: 'pass' };
      else if (g.phase === 'lose' && g.loser === 0) m = { type: 'lose', card: me.cards.findIndex(c => !c.revealed) };
      else if (g.phase === 'exchange' && g.cur.actor === 0) m = { type: 'exchange', keep: Array.from({ length: live }, (_, i) => i) };
      else if (g.phase === 'show' && g.cur.target === 0) m = { type: 'show', card: me.cards.findIndex(c => !c.revealed) };
      else if (g.phase === 'peek' && g.cur.actor === 0) m = { type: 'peek', swap: false };
      if (m) await post('move', { code, token, move: m });
    }
  }
  reader.cancel();
  return last;
}

test('a practice game against two bots plays to the end, and does not count toward records', { timeout: 120000 }, async () => {
  const server = await boot();
  try {
    const me = await post('hello', { name: 'Solo' });
    const r = await post('join', { name: 'Solo', practice: true, player: { id: me.id, secret: me.secret } });
    assert.strictEqual((await post('join', { name: 'Gatecrasher', code: r.code })).ok, false);
    assert.ok((await post('move', { code: r.code, token: r.token, move: { type: 'start' } })).ok);
    const end = await playOut(r.code, r.token, 110000);
    assert.strictEqual(end.game.phase, 'over');
    assert.strictEqual(end.game.players.length, 3);
    assert.deepStrictEqual((await post('hello', { player: { id: me.id, secret: me.secret } })).record.games, 0);
  } finally { server.kill(); }
});

// The first update a seat receives on connecting.
async function firstView(code, token) {
  const res = await fetch(`http://localhost:${PORT}/api/events?code=${code}&token=${token}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  while (!buf.includes('\n\n')) buf += dec.decode((await reader.read()).value);
  reader.cancel();
  return buf.startsWith('data: ') ? JSON.parse(buf.slice(6, buf.indexOf('\n\n'))) : null;
}

test('a game in progress survives a server restart', async () => {
  let server = await boot();
  try {
    const a = await post('join', { name: 'Ann' }), b = await post('join', { name: 'Bo', code: a.code });
    assert.ok((await post('move', { code: a.code, token: a.token, move: { type: 'start' } })).ok);
    const before = await firstView(a.code, a.token);
    await sleep(500); // rooms are written to disk shortly after each change
    server.kill(); await sleep(200);
    server = await boot();
    const after = await firstView(a.code, a.token);
    assert.deepStrictEqual(after.game.log, before.game.log);
    assert.strictEqual(after.game.turn, before.game.turn);
    assert.notStrictEqual(after.build, before.build); // phones see a new build and reload onto it
    const mover = after.game.turn === 0 ? a : b;
    assert.ok((await post('move', { code: a.code, token: mover.token, move: { type: 'action', action: 'income' } })).ok);
  } finally { server.kill(); }
});

test('a seat can move to a new phone: by host link, or by a saved player rejoining', async () => {
  const server = await boot();
  try {
    const bo = await post('hello', { name: 'Bo' }), B = { id: bo.id, secret: bo.secret };
    const a = await post('join', { name: 'Ann' }), b = await post('join', { name: 'Bo', code: a.code, player: B });
    assert.ok((await post('move', { code: a.code, token: a.token, move: { type: 'start' } })).ok);
    // Bo's phone dies; the host makes a seat link.
    assert.strictEqual((await post('reseat', { code: a.code, token: b.token, target: 1 })).ok, false); // only the host
    const link = await post('reseat', { code: a.code, token: a.token, target: 1 });
    assert.strictEqual(await firstView(a.code, b.token), null); // old phone is signed out
    assert.strictEqual((await firstView(a.code, link.token)).you, 1);
    // Bo, a saved player, can also just rejoin the room with their player code.
    const again = await post('join', { name: 'Bo', code: a.code, player: B });
    assert.strictEqual((await firstView(a.code, again.token)).you, 1);
  } finally { server.kill(); }
});

test('one device cannot flood the server with rooms', async () => {
  const server = await boot();
  try {
    const made = [];
    for (let i = 0; i < 13; i++) made.push((await post('join', { name: `R${i}` })).ok);
    assert.deepStrictEqual(made.filter(Boolean).length, 12);
    const r = await post('join', { name: 'One more' });
    assert.match(r.error, /Too many new rooms/);
  } finally { server.kill(); }
});

test('player cards sync both ways: phones bring players back to a server that forgot them, and cannot forge them', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
  let server = await boot({ DATA_DIR: other, STATS_KEY: 'shared-key' });
  try {
    const a = await post('hello', { name: 'Ann' }), A = { id: a.id, secret: a.secret };
    const b = await post('hello', { name: 'Bo' });
    const r = await post('join', { name: 'Ann', player: A });
    await post('join', { name: 'Bo', code: r.code, player: { id: b.id, secret: b.secret } });
    await post('move', { code: r.code, token: r.token, move: { type: 'start' } });
    await post('move', { code: r.code, token: r.token, move: { type: 'kick', target: 1 } }); // Ann wins

    // Ann's phone syncs from nothing: it gets every card, and the server wants none.
    const first = await post('sync', { have: {} });
    assert.strictEqual(first.cards.length, 2);
    assert.deepStrictEqual(first.want, []);
    const cards = first.cards, have = Object.fromEntries(cards.map(c => [JSON.parse(c.d).id, JSON.parse(c.d).at]));
    assert.strictEqual((await post('sync', { have })).cards.length, 0); // up to date: nothing comes back

    // The disk is wiped: a fresh data folder, same STATS_KEY.
    server.kill(); await sleep(200);
    fs.rmSync(other, { recursive: true, force: true });
    server = await boot({ DATA_DIR: other, STATS_KEY: 'shared-key' });
    assert.strictEqual((await post('hello', { player: A })).known, false);

    // A forged card (more wins, signature kept) is ignored.
    const annCard = cards.find(c => JSON.parse(c.d).id === a.id), fake = JSON.parse(annCard.d);
    fake.record.wins = 99; fake.at++;
    await post('sync', { have: {}, cards: [{ d: JSON.stringify(fake), s: annCard.s }] });
    assert.strictEqual((await post('hello', { player: A })).known, false);

    // Ann's phone syncs: the server asks for both cards, she sends them, and Ann is known again with everything.
    const ask = await post('sync', { have });
    assert.deepStrictEqual(ask.want.sort(), [a.id, b.id].sort());
    await post('sync', { have, cards });
    const back = await post('hello', { player: A });
    assert.deepStrictEqual([back.name, back.record.wins, back.points > 4, back.ach.firstwin > 0], ['Ann', 1, true, true]);
    // A brand new phone now gets the whole group, for its Hall of Fame.
    assert.strictEqual((await post('sync', { have: {} })).cards.length, 2);
    const room = await post('join', { name: 'Ann', player: A });
    assert.deepStrictEqual((await firstView(room.code, room.token)).friends.map(f => f.name), ['Bo']);
  } finally { server.kill(); fs.rmSync(other, { recursive: true, force: true }); }
});

test('a game in progress comes back from a phone\'s sealed copy after the server loses its disk', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
  let server = await boot({ DATA_DIR: other, STATS_KEY: 'shared-key' });
  try {
    const a = await post('join', { name: 'Ann' }), b = await post('join', { name: 'Bo', code: a.code });
    await post('move', { code: a.code, token: a.token, move: { type: 'start' } });
    const before = await firstView(a.code, a.token);
    assert.ok(!before.seal.includes('Ann'), 'the copy is encrypted');
    server.kill(); await sleep(200);
    fs.rmSync(other, { recursive: true, force: true });
    server = await boot({ DATA_DIR: other, STATS_KEY: 'shared-key' });
    assert.strictEqual(await firstView(a.code, a.token), null); // the server forgot the room

    const bad = before.seal.slice(0, -4) + (before.seal.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.strictEqual((await post('restore', { seal: bad })).ok, false); // tampered copies are refused
    assert.ok((await post('restore', { seal: before.seal })).ok);
    const after = await firstView(a.code, a.token);
    assert.deepStrictEqual([after.game.log, after.game.turn], [before.game.log, before.game.turn]);
    assert.strictEqual((await firstView(a.code, b.token)).you, 1);
    // Once someone plays on, an older copy can't roll the game back.
    const mover = after.game.turn === 0 ? a : b;
    assert.ok((await post('move', { code: a.code, token: mover.token, move: { type: 'action', action: 'income' } })).ok);
    await post('restore', { seal: before.seal });
    assert.notDeepStrictEqual((await firstView(a.code, a.token)).game.log, before.game.log);
  } finally { server.kill(); fs.rmSync(other, { recursive: true, force: true }); }
});

test('a player whose phone is gone can be skipped, and a TV watches without seeing hidden cards', async () => {
  const server = await boot();
  try {
    const a = await post('join', { name: 'Ann' }), b = await post('join', { name: 'Bo', code: a.code });
    await post('move', { code: a.code, token: a.token, move: { type: 'start' } });
    await firstView(a.code, b.token); // Bo's phone connects, then goes away
    if ((await firstView(a.code, a.token)).game.turn === 0) await post('move', { code: a.code, token: a.token, move: { type: 'action', action: 'income' } });
    assert.strictEqual((await post('move', { code: a.code, token: a.token, move: { type: 'skip', target: 1 } })).ok, false); // not gone long enough
    await sleep(400);
    assert.deepStrictEqual((await firstView(a.code, a.token)).away, [false, true]);
    assert.ok((await post('move', { code: a.code, token: a.token, move: { type: 'skip', target: 1 } })).ok);
    const tvView = await firstView(a.code + '&tv=1', '');
    assert.strictEqual(tvView.tv, true);
    assert.strictEqual(tvView.game.turn, 0); // Bo's turn was played for him
    assert.ok(tvView.game.players.every(p => p.cards.every(c => c.role === null)));
  } finally { server.kill(); }
});
