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

test('10+ gold forces a Boss Fight; view hides rival cards', () => {
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

test('a bluffed block on a Special Delivery, when called, costs the target both cards', () => {
  const g = setup([['backstabber', 'goblin'], ['goblin', 'showrunner'], ['goblin', 'goblin']], 3);
  ok(g, 0, { type: 'action', action: 'assassinate', target: 1 });
  ok(g, 1, { type: 'block', role: 'bouncer' });
  ok(g, 0, { type: 'challenge' });
  const logAt = g.log.length;
  ok(g, 1, { type: 'lose', card: 0 }); // one tap...
  assert.ok(g.players[1].cards.every(c => c.revealed)); // ...both cards: one for the lie, one for the Special Delivery
  assert.deepStrictEqual(g.log.slice(logAt, logAt + 3).map(l => l.split(' ')[0] + ' ' + l.split(' ')[1]), ['P1 loses', 'Special Delivery', 'P1 loses'], 'both losses, and why, are announced');
});

test('moves emit events for the phones, and stats for the awards', () => {
  const g = setup([['goblin', 'bouncer'], ['bouncer', 'showrunner'], ['bouncer', 'bouncer']]);
  ok(g, 0, { type: 'action', action: 'steal', target: 1 });
  ok(g, 1, { type: 'pass' }); ok(g, 2, { type: 'pass' });
  assert.deepStrictEqual(g.ev, [{ type: 'sfx', text: 'Chomp!', action: 'steal', actor: 0, target: 1 }, { type: 'gold', from: 1, to: 0, n: 2 }]);
  assert.strictEqual(g.stats[1].stolenFrom, 2);

  // Player 1 bluffs: claims Zev to Spin Control without holding one, and gets called.
  ok(g, 1, { type: 'action', action: 'exchange' }); // claims Changeling without holding one
  assert.strictEqual(g.stats[1].lies, 1);
  const seq = g.seq;
  ok(g, 2, { type: 'challenge' });
  assert.ok(g.seq > seq);
  assert.deepStrictEqual(g.ev[0], { type: 'challenge', by: 2, claimant: 1, role: 'changeling', held: false });
  assert.strictEqual(g.stats[2].callsRight, 1);
  assert.strictEqual(g.stats[1].caught, 1);
});

test('knocked-out players see every card; living players do not', () => {
  const g = setup([['goblin', 'bouncer'], ['bouncer', 'showrunner'], ['bouncer', 'bouncer']]);
  forfeit(g, 2);
  assert.deepStrictEqual(g.out, [2]);
  assert.strictEqual(view(g, 2).players[0].cards[0].role, 'goblin');
  assert.strictEqual(view(g, 1).players[0].cards[0].role, null);
  assert.strictEqual(view(g, 1).stats, null);
});

test('awards go to a single clear leader, never to a tie', () => {
  const { awards } = require('../public/game.js');
  const z = () => ({ lies: 0, caught: 0, callsRight: 0, callsWrong: 0, stolenFrom: 0 });
  const st = [{ ...z(), lies: 3 }, { ...z(), lies: 1, caught: 1, stolenFrom: 4 }, { ...z(), callsRight: 1 }, { ...z(), callsRight: 1 }];
  const got = Object.fromEntries(awards(st, [1, 3]).map(a => [a.title, a.id]));
  assert.deepStrictEqual(got, { 'Pants on Fire': 0, 'Teflon Crawler': 0, 'Piñata': 1, 'First to Die': 1 });
});

test('an Exposé is announced to everyone without revealing the card', () => {
  const g = newGame(['A', 'B', 'C'], Math.random, true);
  g.turn = 0;
  ok(g, 0, { type: 'action', action: 'examine', target: 1 });
  ok(g, 1, { type: 'pass' }); ok(g, 2, { type: 'pass' });
  ok(g, 1, { type: 'show', card: 0 });
  ok(g, 0, { type: 'peek', swap: true });
  assert.deepStrictEqual(g.ev, [{ type: 'expose', by: 0, target: 1, swap: true }]);
  assert.ok(!JSON.stringify(view(g, 2).ev).includes('role'));
});

test('The System comments on caught lies and keeps a highlight reel', () => {
  const g = setup([['goblin', 'bouncer'], ['bouncer', 'showrunner']]);
  ok(g, 0, { type: 'action', action: 'tax' }); // a lie: no Princess Donut
  ok(g, 1, { type: 'challenge' });
  assert.ok(g.log.some(l => l.includes('P0') && /red-handed|liar|Busted/.test(l)));
  assert.deepStrictEqual(g.reel.map(e => e.type), ['challenge']);
  assert.strictEqual(view(g, 1).reel, null); // only shown once the game is over
});

test('a game saved to JSON at any point can be restored and played to the end', () => {
  const { revive, waitingOn, autoMove } = require('../public/game.js');
  for (let run = 0; run < 200; run++) {
    let g = newGame(['A', 'B', 'C', 'D'].slice(0, 2 + (run % 3)), Math.random, run % 2 === 1);
    for (let i = 0; g.phase !== 'over'; i++) {
      assert.ok(i < 3000, 'game did not finish');
      if (Math.random() < .2) g = revive(JSON.parse(JSON.stringify(g)));
      // Mix real choices with the dull fallback so challenges, blocks and card losses all happen.
      const id = waitingOn(g)[0], pick = a => a[Math.floor(Math.random() * a.length)];
      const err = act(g, id, pick([{ type: 'challenge' }, { type: 'block', role: pick(Object.keys(ROLES)) },
        { type: 'action', action: pick(['tax', 'steal', 'assassinate', 'income']), target: pick(g.players).id }]));
      if (err) autoMove(g, id);
    }
  }
});

test('every achievement is complete, and checking them after random games never throws', () => {
  const { ACHIEVEMENTS, BOXES, achievementsFor, tally } = require('../public/game.js');
  const all = Object.values(ACHIEVEMENTS);
  assert.ok(all.length >= 114);
  for (const a of all) assert.ok(BOXES[a.box] && a.title && a.text && a.reward && typeof a.when === 'function', a.title);
  assert.strictEqual(new Set(all.map(a => a.title)).size, all.length, 'titles are unique');
  let seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    let r = seed + 1; const rng = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const g = newGame(['A', 'B', 'C', 'D'].slice(0, 2 + seed % 3), rng, seed % 2 === 1);
    // Everyone plays randomly-ish via the dullest moves and occasional claims, until someone wins.
    for (let i = 0; i < 500 && g.phase !== 'over'; i++) {
      const id = waitingOn(g)[0], p = g.players[id];
      if (g.phase === 'turn' && rng() < .5) {
        const acts = Object.entries(actionsFor(g.variant)).filter(([, a]) => p.coins >= (a.cost || 0) && (p.coins < 10 || a === actionsFor(g.variant).coup));
        const [k] = acts[Math.floor(rng() * acts.length)], t = g.players.find(x => x.id !== id && x.cards.some(c => !c.revealed));
        if (!act(g, id, { type: 'action', action: k, target: t.id })) continue;
      }
      if ((g.phase === 'react' || g.phase === 'blockReact') && rng() < .2 && !act(g, id, { type: 'challenge' })) continue;
      autoMove(g, id);
    }
    assert.strictEqual(g.phase, 'over');
    g.players.forEach((_, i) => {
      const t = tally(g, i);
      for (const k of achievementsFor(g, i, { games: 1, wins: +!!t.won, t, streak: t.won, cold: 1 - t.won }, 1)) seen.add(k);
    });
  }
  assert.ok(seen.size >= 10, `random games earn a spread of achievements (${seen.size})`);
});
