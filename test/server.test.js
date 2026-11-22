const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, PASSCODE: '', BOT_DELAY: '15' } });
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
