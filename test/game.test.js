const test = require('node:test');
const assert = require('node:assert');
const { ACTIONS, ROLES, actionsFor, newGame, act, view, waitingOn, autoMove, forfeit } = require('../public/game.js');

test('forfeit on your own turn passes the turn and kills you', () => {
  const g = newGame(['A', 'B', 'C']);
  g.turn = 0;
  forfeit(g, 0);
  assert.ok(g.players[0].cards.every(c => c.revealed));
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.phase, 'turn');
});

test('forfeit with a pending action cancels it; last rival wins', () => {
  const g = newGame(['A', 'B']);
  g.turn = 0;
  act(g, 0, { type: 'action', action: 'tax' });
  forfeit(g, 0);
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.winner, 1);
});

test('auto-play alone always finishes a game', () => {
  const g = newGame(['A', 'B', 'C', 'D']);
  for (let i = 0; g.phase !== 'over'; i++) {
    assert.ok(i < 2000);
    assert.strictEqual(autoMove(g, waitingOn(g)[0]), undefined);
  }
});

// Game with known hands; player 0 to move.
function setup(hands, coins = 2) {
  const g = newGame(hands.map((_, i) => 'P' + i));
  g.players.forEach((p, i) => { p.coins = coins; p.cards.forEach((c, n) => { c.role = hands[i][n]; }); });
  g.turn = 0;
  return g;
}
const ok = (g, pid, m) => assert.strictEqual(act(g, pid, m), undefined);

test('unchallenged tax pays 3 and passes the turn', () => {
  const g = setup([['bouncer', 'bouncer'], ['goblin', 'goblin'], ['goblin', 'bouncer']]);
  ok(g, 0, { type: 'action', action: 'tax' });
  ok(g, 1, { type: 'pass' }); ok(g, 2, { type: 'pass' });
  assert.strictEqual(g.players[0].coins, 5);
  assert.strictEqual(g.turn, 1);
});

test('caught bluff: liar loses a card, gets nothing', () => {
  const g = setup([['bouncer', 'bouncer'], ['goblin', 'goblin']]);
  ok(g, 0, { type: 'action', action: 'tax' });
  ok(g, 1, { type: 'challenge' });
  assert.strictEqual(g.phase, 'lose');
  ok(g, 0, { type: 'lose', card: 1 });
  assert.strictEqual(g.players[0].coins, 2);
  assert.ok(g.players[0].cards[1].revealed);
  assert.strictEqual(g.turn, 1);
});

test('wrong challenge: challenger loses a card, action goes through', () => {
  const g = setup([['showrunner', 'bouncer'], ['goblin', 'goblin']]);
  ok(g, 0, { type: 'action', action: 'tax' });
  ok(g, 1, { type: 'challenge' });
  ok(g, 1, { type: 'lose', card: 0 });
  assert.strictEqual(g.players[0].coins, 5);
});

test('shiv blocked by bouncer costs the gold and kills nobody', () => {
  const g = setup([['backstabber', 'bouncer'], ['bouncer', 'goblin']], 3);
  ok(g, 0, { type: 'action', action: 'assassinate', target: 1 });
  ok(g, 1, { type: 'block', role: 'bouncer' });
  ok(g, 0, { type: 'pass' });
  assert.strictEqual(g.players[0].coins, 0);
  assert.ok(g.players[1].cards.every(c => !c.revealed));
});

test('failed challenge then shiv costs the target both cards', () => {
  const g = setup([['backstabber', 'bouncer'], ['goblin', 'goblin'], ['goblin', 'bouncer']], 3);
  ok(g, 0, { type: 'action', action: 'assassinate', target: 1 });
  ok(g, 1, { type: 'challenge' });
  ok(g, 1, { type: 'lose', card: 0 });
  ok(g, 1, { type: 'pass' }); // declines to block
  assert.ok(g.players[1].cards.every(c => c.revealed));
});

test('10+ gold forces a Boss Drop; view hides rival cards', () => {
  const g = setup([['bouncer', 'bouncer'], ['goblin', 'goblin']], 10);
  assert.match(act(g, 0, { type: 'action', action: 'income' }), /must/);
  assert.strictEqual(view(g, 0).players[1].cards[0].role, null);
  assert.strictEqual(view(g, 0).players[0].cards[0].role, 'bouncer');
  assert.strictEqual(act(g, 0, { type: 'action', action: 'coup', target: 0 }), 'Pick a living rival');
});

test('random play always ends with one winner and 15 cards', () => {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  for (let n = 2; n <= 6; n++) for (let run = 0; run < 30; run++) {
    const g = newGame(Array.from({ length: n }, (_, i) => 'P' + i), Math.random, run % 2 === 1);
    for (let i = 0; g.phase !== 'over'; i++) {
      assert.ok(i < 50000, 'game did not finish');
      if (Math.random() < 0.01) forfeit(g, pick(g.players).id);
      if (g.phase === 'over') break;
      assert.ok(waitingOn(g).length && waitingOn(g).every(id => g.players[id].cards.some(c => !c.revealed)), 'waiting on nobody or a dead player');
      act(g, pick(g.players).id, pick([
        { type: 'action', action: pick(Object.keys(actionsFor(true))), target: pick(g.players).id },
        { type: 'pass' }, { type: 'challenge' }, { type: 'block', role: pick(Object.keys(ROLES)) },
        { type: 'lose', card: pick([0, 1]) }, { type: 'show', card: pick([0, 1]) }, { type: 'peek', swap: pick([true, false]) }, { type: 'exchange', keep: pick([[0], [1], [2], [0, 1], [1, 2], [0, 2], [0, 3], [2, 3]]) },
      ]));
      assert.ok(g.players.every(p => p.coins >= 0));
      const inPlay = g.players.length * 2 + g.deck.length + (g.phase === 'exchange' ? (g.variant ? 1 : 2) : 0);
      assert.strictEqual(inPlay, 15);
    }
    assert.strictEqual(g.players.filter(p => p.cards.some(c => !c.revealed)).length, 1);
  }
});

test('Paparazzo variant: Exposé shows one card to the actor only, and can force a redraw', () => {
  const g = newGame(['A', 'B', 'C'], Math.random, true);
  assert.ok(!g.deck.includes('changeling') && g.players.every(p => p.cards.every(c => c.role !== 'changeling')));
  g.turn = 0;
  g.players[1].cards[1].role = 'bouncer';
  ok(g, 0, { type: 'action', action: 'examine', target: 1 });
  ok(g, 1, { type: 'pass' }); ok(g, 2, { type: 'pass' });
  assert.strictEqual(g.phase, 'show');
  ok(g, 1, { type: 'show', card: 1 });
  assert.strictEqual(view(g, 0).peek.role, 'bouncer');
  assert.strictEqual(view(g, 2).peek.role, null);
  ok(g, 0, { type: 'peek', swap: true });
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.players.length * 2 + g.deck.length, 15);
});

test('classic game rejects the variant-only action', () => {
  const g = newGame(['A', 'B']);
  g.turn = 0;
  assert.ok(act(g, 0, { type: 'action', action: 'examine', target: 1 }));
});
