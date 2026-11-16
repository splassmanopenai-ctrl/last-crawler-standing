const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, PASSCODE: '' } });
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
