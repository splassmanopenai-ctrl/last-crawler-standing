// Rules engine and all theme text. `blurb` is the line printed on the card's blank parchment. The server is the authority; the browser only reads ROLES/ACTIONS for labels.
(function (exports) {
  // quip: a one-liner shown in italics under the card; empty strings are skipped.
  // blockSfx: the comic stamp when this character's block holds.
  const ROLES = {
    showrunner: { name: 'Princess Donut', title: 'The Headliner', quip: '', blockSfx: 'Denied!', color: '#f5b921',
      blurb: 'Royal Tribute: Take 3 gold. Blocks Fan Donations.', text: 'Royal Tribute: take 3 gold. Blocks Fan Donations.' },
    backstabber: { name: 'Carl', title: 'The Demolitionist', quip: '', color: '#e0433f',
      blurb: 'Special Delivery: Pay 3 gold, a rival loses a card.', text: 'Special Delivery: pay 3 gold, a rival loses a card.' },
    goblin: { name: 'Mongo', title: 'The Retriever', quip: '', blockSfx: 'Mine!', color: '#7cc142',
      blurb: 'Chomp: Steal 2 gold. Blocks Chomp.', text: 'Chomp: steal 2 gold. Blocks Chomp.' },
    changeling: { name: 'Zev', title: 'The Handler', quip: '', blockSfx: 'No comment!', color: '#b07ae6',
      blurb: 'Spin Control: Swap cards with the deck. Blocks Chomp.', text: 'Spin Control: swap cards with the deck. Blocks Chomp.' },
    paparazzo: { name: 'Odette', title: 'Exposé Queen', quip: '', blockSfx: 'Not on my show!', color: '#f28c28',
      blurb: 'Exposé: Inspect a rival\'s card. Retcon: Swap 1 card. Blocks Chomp.',
      text: 'Exposé: see a rival\'s card and maybe make them redraw it. Retcon: swap 1 card with the deck. Blocks Chomp.' },
    bouncer: { name: 'Mordecai', title: 'The Alchemist', quip: '', blockSfx: 'Gulp!', color: '#4aa3e8',
      blurb: 'Antidote: Blocks Special Delivery.', text: 'Antidote: blocks Special Delivery.' },
  };

  const ACTIONS = {
    income: { name: 'Grind', text: '+1 gold' },
    aid: { name: 'Fan Donations', text: '+2 gold', blockBy: ['showrunner'], sfx: 'Cha-ching!' },
    tax: { name: 'Royal Tribute', text: '+3 gold', claim: 'showrunner', sfx: 'Bow!' },
    steal: { name: 'Chomp', text: 'Steal 2', claim: 'goblin', target: true, blockBy: ['goblin', 'changeling'], sfx: 'Chomp!' },
    exchange: { name: 'Spin Control', text: 'Swap cards', claim: 'changeling', sfx: 'Spin!' },
    assassinate: { name: 'Special Delivery', text: 'Pay 3: kill a card', claim: 'backstabber', cost: 3, target: true, blockBy: ['bouncer'], sfx: 'Kaboom!' },
    coup: { name: 'Boss Fight', text: 'Pay 7: kill a card', cost: 7, target: true, sfx: 'Boss fight!' },
  };
  // Odette variant: Odette replaces Zev (a smaller swap, plus Exposé).
  const VARIANT = {
    ...ACTIONS,
    steal: { ...ACTIONS.steal, blockBy: ['goblin', 'paparazzo'] },
    exchange: { name: 'Retcon', text: 'Swap 1 card', claim: 'paparazzo', sfx: 'Cut!' },
    examine: { name: 'Exposé', text: 'See a rival card', claim: 'paparazzo', target: true, sfx: 'Snap!' },
  };
  // The System's running commentary. {name} is replaced with the crawler in question; one line is picked at random.
  const COMMENTS = {
    caught: [
      '{name} got caught red-handed. The ratings just doubled.',
      '{name}: a liar, and not even a good one. The audience adores a bad liar.',
      'Busted! {name} should stick to honest work. Or at least better lies.',
    ],
    wrongCall: [
      '{name} called a bluff on an honest crawler. Bold. Wrong, but bold.',
      'Paranoia is not a strategy, {name}.',
      '{name} just paid for their trust issues.',
    ],
    death: [
      '{name} has been eliminated. Please hold your applause. Actually, applaud.',
      'Farewell, {name}. You will be forgotten by the next commercial break.',
      '{name} is out. The sponsors are already pretending they never met.',
    ],
    rich: [
      '{name} is sitting on a pile of gold. The audience smells a Boss Fight.',
      '{name} is rich. Being rich in a dungeon is how you get a target on your back.',
    ],
    lastTwo: [
      'Two crawlers left. Somebody get the popcorn.',
      'Final two! This is the part where friendships end.',
    ],
  };

  // Heckles a knocked-out crawler can send across everyone's screen.
  const REACTIONS = ['Boo!', 'Liar!', 'Do it!', 'Ouch!', 'RIP', 'More blood!'];
  // Opponents in a practice game.
  const BOT_NAMES = ['Sentient Toaster', 'Goblin Intern', 'Unpaid Extra', 'Floor 3 Janitor', 'Cursed Mannequin'];

  // End-of-game awards from The System. Each picks one player (or nobody) from the game's stats.
  const AWARDS = [
    { title: 'Pants on Fire', pick: (st) => top(st, s => s.lies), say: s => `${s.lies} lie${s.lies === 1 ? '' : 's'} told on live TV.` },
    { title: 'Teflon Crawler', pick: (st) => top(st, s => s.caught ? 0 : s.lies), say: s => `Lied ${s.lies} time${s.lies === 1 ? '' : 's'}. Never caught.` },
    { title: 'Lie Detector', pick: (st) => top(st, s => s.callsRight), say: s => `Called ${s.callsRight} bluff${s.callsRight === 1 ? '' : 's'} correctly.` },
    { title: 'Should Have Stayed Quiet', pick: (st) => top(st, s => s.callsWrong), say: s => `Called ${s.callsWrong} bluff${s.callsWrong === 1 ? '' : 's'} on honest crawlers.` },
    { title: 'Piñata', pick: (st) => top(st, s => s.stolenFrom), say: s => `Had ${s.stolenFrom} gold chomped.` },
    { title: 'First to Die', pick: (st, out) => out.length ? out[0] : null, say: () => 'The viewers barely learned their name.' },
  ];
  // Index of the single highest score above zero; ties give nobody the award.
  function top(stats, score) {
    const scores = stats.map(score), best = Math.max(...scores);
    return best > 0 && scores.filter(x => x === best).length === 1 ? scores.indexOf(best) : null;
  }
  const awards = (stats, out) => AWARDS.map(a => ({ a, id: a.pick(stats, out) })).filter(x => x.id != null)
    .map(({ a, id }) => ({ title: a.title, id, text: a.say(stats[id]) }));

  const actionsFor = variant => variant ? VARIANT : ACTIONS;
  const rolesFor = variant => Object.keys(ROLES).filter(r => r !== (variant ? 'changeling' : 'paparazzo'));
  const A = g => actionsFor(g.variant);

  const alive = p => p.cards.some(c => !c.revealed);
  const holds = (p, role) => p.cards.find(c => !c.revealed && c.role === role);
  const say = (g, text) => { g.log.push(text); };
  // What just happened, for the phones to animate. Replaced on every move; `seq` tells phones it is new.
  // Bluffs called, Exposés and eliminations are also kept for the end-of-game highlight reel.
  const emit = (g, e) => { g.ev.push(e); if (['challenge', 'expose', 'out'].includes(e.type)) g.reel.push(e); };
  const comment = (g, kind, id) => { const lines = COMMENTS[kind]; say(g, lines[Math.floor(g.rng() * lines.length)].replace('{name}', id == null ? '' : g.players[id].name)); };
  const gold = (g, from, to, n) => { if (n > 0) emit(g, { type: 'gold', from, to, n }); }; // from/to null = the bank

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame(names, rng = Math.random, variant = false) {
    const g = { rng, variant, peekCard: null, log: [], ev: [{ type: 'deal' }], seq: 1, out: [], reel: [], rich: [], phase: 'turn', cur: null, block: null, waiting: [], canChallenge: false, loser: null, offer: null, after: null, winner: null };
    g.deck = shuffle(rolesFor(variant).flatMap(r => [r, r, r]), rng);
    g.players = names.map((name, id) => ({
      id, name, coins: 2,
      cards: [g.deck.pop(), g.deck.pop()].map(role => ({ role, revealed: false })),
    }));
    g.stats = g.players.map(() => ({ lies: 0, caught: 0, callsRight: 0, callsWrong: 0, stolenFrom: 0 })); // for the end-of-game awards
    g.turn = Math.floor(rng() * names.length);
    say(g, `Welcome, Crawlers! ${g.players[g.turn].name} goes first. Now get out there and kill, kill, kill!`);
    return g;
  }

  function reveal(g, p, card) {
    card.revealed = true;
    const what = ROLES[card.role].name;
    say(g, alive(p) ? `${p.name} loses their ${what}.` : `${p.name} loses their ${what} and is DEAD. The viewers love it.`);
    if (!alive(p)) {
      g.out.push(p.id); emit(g, { type: 'out', id: p.id });
      const left = g.players.filter(alive).length;
      if (left > 1) comment(g, left === 2 ? 'lastTwo' : 'death', p.id);
    }
  }

  // Player loses a card: asks them to pick if they still have two, then carries on with `next`.
  // `next` is a name, not a function, so a paused game is plain data that can be saved and restored.
  function lose(g, pid, next) {
    const p = g.players[pid], left = p.cards.filter(c => !c.revealed);
    if (left.length === 2) { g.phase = 'lose'; g.loser = pid; g.after = next; return; }
    if (left.length) reveal(g, p, left[0]);
    proceed(g, next);
  }

  function blocked(g) {
    say(g, `${A(g)[g.cur.action].name} is blocked.`);
    emit(g, { type: 'sfx', text: ROLES[g.block.role].blockSfx || 'Blocked!', block: g.block.role, actor: g.block.by });
  }

  // What happens after a card is lost. 'block:…' and 'action:…' follow a called bluff on a block or an action.
  function proceed(g, next) {
    const c = g.cur, a = c && A(g)[c.action];
    if (next === 'block:held') { blocked(g); return endTurn(g); }
    if (next === 'block:lie') return resolve(g);
    if (next === 'action:held') return a.blockBy ? openReact(g, false) : resolve(g);
    if (next === 'action:lie') { // caught bluffing: the action never happened
      g.players[c.actor].coins += a.cost || 0;
      gold(g, null, c.actor, a.cost || 0);
    }
    endTurn(g);
  }

  // `on` is 'block' or 'action': which claim was called.
  function challenge(g, challengerId, claimantId, role, on) {
    const ch = g.players[challengerId], cl = g.players[claimantId], card = holds(cl, role);
    emit(g, { type: 'challenge', by: challengerId, claimant: claimantId, role, held: !!card });
    g.stats[challengerId][card ? 'callsWrong' : 'callsRight']++;
    if (!card) g.stats[claimantId].caught++;
    if (card) {
      say(g, `${ch.name} calls the bluff. ${cl.name} really is the ${ROLES[role].name}. Awkward.`);
      comment(g, 'wrongCall', challengerId);
      g.deck.push(card.role); shuffle(g.deck, g.rng); card.role = g.deck.pop();
      lose(g, challengerId, `${on}:held`);
    } else {
      say(g, `${ch.name} calls the bluff. ${cl.name} was lying!`);
      comment(g, 'caught', claimantId);
      lose(g, claimantId, `${on}:lie`);
    }
  }

  function openReact(g, canChallenge) {
    const c = g.cur, a = A(g)[c.action];
    if (!alive(g.players[c.actor])) return endTurn(g); // actor was removed mid-action
    g.phase = 'react'; g.canChallenge = canChallenge;
    g.waiting = g.players
      .filter(p => alive(p) && p.id !== c.actor && (canChallenge || (a.blockBy && (c.target == null || c.target === p.id))))
      .map(p => p.id);
    if (!g.waiting.length) resolve(g);
  }

  function finish(g) {
    const living = g.players.filter(alive);
    if (living.length !== 1) return false;
    g.phase = 'over'; g.winner = living[0].id;
    say(g, `${living[0].name} is the Last Crawler Standing!`);
    return true;
  }

  function endTurn(g) {
    g.cur = g.block = g.offer = g.loser = g.peekCard = null; g.waiting = [];
    if (finish(g)) return;
    for (const p of g.players) if (alive(p) && p.coins >= 7 && !g.rich.includes(p.id)) { g.rich.push(p.id); comment(g, 'rich', p.id); }
    do g.turn = (g.turn + 1) % g.players.length; while (!alive(g.players[g.turn]));
    g.phase = 'turn';
  }

  function resolve(g) {
    const c = g.cur, p = g.players[c.actor], t = g.players[c.target];
    if (!alive(p)) return endTurn(g); // actor was removed mid-action
    if (A(g)[c.action].sfx) emit(g, { type: 'sfx', text: A(g)[c.action].sfx, action: c.action, actor: p.id, target: c.target });
    switch (c.action) {
      case 'income': p.coins += 1; gold(g, null, p.id, 1); break;
      case 'aid': p.coins += 2; gold(g, null, p.id, 2); break;
      case 'tax': p.coins += 3; gold(g, null, p.id, 3); break;
      case 'steal': { const n = Math.min(2, t.coins); t.coins -= n; p.coins += n; gold(g, t.id, p.id, n); g.stats[t.id].stolenFrom += n; break; }
      case 'coup': case 'assassinate':
        say(g, `${A(g)[c.action].name} lands on ${t.name}.`);
        return lose(g, c.target, 'end');
      case 'exchange':
        g.offer = [...p.cards.filter(x => !x.revealed).map(x => x.role), g.deck.pop()];
        if (!g.variant) g.offer.push(g.deck.pop());
        g.phase = 'exchange';
        return;
      case 'examine': { // target picks which card to show; with one card left there is no choice
        const left = t.cards.map((x, i) => x.revealed ? -1 : i).filter(i => i >= 0);
        if (!left.length) break;
        if (left.length === 1) { g.peekCard = left[0]; g.phase = 'peek'; } else g.phase = 'show';
        return;
      }
    }
    endTurn(g);
  }

  // Apply one player's move. Returns an error string, or undefined on success.
  function act(g, pid, m) {
    const p = g.players[pid];
    if (!p || !m || typeof m !== 'object') return 'Bad move';
    if (!alive(p)) return 'You are dead';
    g.ev = []; g.seq++;
    const c = g.cur, a = c && A(g)[c.action];

    if (g.phase === 'turn') {
      if (pid !== g.turn || m.type !== 'action' || !Object.hasOwn(A(g), m.action)) return 'Not your move';
      const act = A(g)[m.action];
      if (p.coins >= 10 && m.action !== 'coup') return `With 10+ gold you must ${A(g).coup.name}`;
      if (p.coins < (act.cost || 0)) return 'Not enough gold';
      const t = act.target && Number.isInteger(m.target) ? g.players[m.target] : null;
      if (act.target && (!t || t === p || !alive(t))) return 'Pick a living rival';
      p.coins -= act.cost || 0;
      gold(g, pid, null, act.cost || 0);
      if (act.claim && !holds(p, act.claim)) g.stats[pid].lies++;
      g.cur = { action: m.action, actor: pid, target: t ? t.id : null };
      say(g, `${p.name} goes for ${act.name}${t ? ` on ${t.name}` : ''}${act.claim ? `, claiming ${ROLES[act.claim].name}` : ''}.`);
      if (act.claim || act.blockBy) openReact(g, !!act.claim); else resolve(g);
      return;
    }

    if (g.phase === 'react' || g.phase === 'blockReact') {
      const i = g.waiting.indexOf(pid);
      if (i < 0) return 'Not your move';
      const blocking = g.phase === 'blockReact';
      if (m.type === 'pass') {
        g.waiting.splice(i, 1);
        if (!g.waiting.length) {
          if (blocking) { blocked(g); endTurn(g); } else resolve(g);
        }
        return;
      }
      if (m.type === 'challenge') {
        if (blocking) {
          return challenge(g, pid, g.block.by, g.block.role, 'block');
        }
        if (!g.canChallenge) return 'Nothing to challenge';
        return challenge(g, pid, c.actor, a.claim, 'action');
      }
      if (m.type === 'block' && !blocking) {
        if (!a.blockBy || !a.blockBy.includes(m.role) || (c.target != null && c.target !== pid)) return 'You cannot block that';
        g.block = { by: pid, role: m.role };
        if (!holds(p, m.role)) g.stats[pid].lies++;
        say(g, `${p.name} blocks, claiming ${ROLES[m.role].name}.`);
        g.phase = 'blockReact';
        g.waiting = g.players.filter(x => alive(x) && x.id !== pid).map(x => x.id);
        return;
      }
      return 'Bad move';
    }

    if (g.phase === 'lose') {
      const card = Number.isInteger(m.card) ? p.cards[m.card] : null;
      if (pid !== g.loser || m.type !== 'lose' || !card || card.revealed) return 'Not your move';
      reveal(g, p, card);
      const next = g.after; g.after = g.loser = null;
      proceed(g, next);
      return;
    }

    if (g.phase === 'exchange') {
      const mine = p.cards.filter(x => !x.revealed), keep = m.keep;
      if (pid !== c.actor || m.type !== 'exchange') return 'Not your move';
      if (!Array.isArray(keep) || keep.length !== mine.length || new Set(keep).size !== keep.length ||
          keep.some(k => !Number.isInteger(k) || k < 0 || k >= g.offer.length)) return `Keep exactly ${mine.length}`;
      mine.forEach((card, n) => { card.role = g.offer[keep[n]]; });
      g.deck.push(...g.offer.filter((_, k) => !keep.includes(k)));
      shuffle(g.deck, g.rng);
      endTurn(g);
      return;
    }

    if (g.phase === 'show') {
      const card = Number.isInteger(m.card) ? p.cards[m.card] : null;
      if (pid !== c.target || m.type !== 'show' || !card || card.revealed) return 'Not your move';
      g.peekCard = m.card; g.phase = 'peek';
      return;
    }

    if (g.phase === 'peek') {
      if (pid !== c.actor || m.type !== 'peek') return 'Not your move';
      const t = g.players[c.target], card = t.cards[g.peekCard];
      emit(g, { type: 'expose', by: pid, target: t.id, swap: !!(m.swap && !card.revealed) });
      if (m.swap && !card.revealed) {
        g.deck.push(card.role); shuffle(g.deck, g.rng); card.role = g.deck.pop();
        say(g, `${p.name} didn't like what they saw. ${t.name} redraws that card.`);
      } else say(g, `${p.name} takes a good look and lets ${t.name} keep it.`);
      endTurn(g);
      return;
    }

    return 'Game over';
  }

  // What one player is allowed to see.
  function view(g, pid) {
    const seated = g.players[pid]; // no seat (pid -1) is the TV view: no hidden cards until the game is over
    const spectator = g.phase === 'over' || (seated && !alive(seated));
    return {
      phase: g.phase, turn: g.turn, cur: g.cur, block: g.block, waiting: g.waiting, canChallenge: g.canChallenge,
      loser: g.loser, winner: g.winner, log: g.log.slice(-40), ev: g.ev, seq: g.seq, out: g.out,
      stats: g.phase === 'over' ? g.stats : null, reel: g.phase === 'over' ? g.reel : null,
      offer: g.phase === 'exchange' && g.cur.actor === pid ? g.offer : null,
      variant: g.variant,
      peek: g.phase === 'peek' ? { card: g.peekCard, role: g.cur.actor === pid ? g.players[g.cur.target].cards[g.peekCard].role : null } : null,
      players: g.players.map(p => ({
        id: p.id, name: p.name, coins: p.coins,
        // Knocked-out players, and everyone once the game is over, may watch with every card face up.
        cards: p.cards.map(c => ({ revealed: c.revealed, role: c.revealed || p.id === pid || spectator ? c.role : null })),
      })),
    };
  }

  // Ids of the players the game cannot continue without.
  function waitingOn(g) {
    if (g.phase === 'turn') return [g.turn];
    if (g.phase === 'react' || g.phase === 'blockReact') return g.waiting.slice();
    if (g.phase === 'lose') return [g.loser];
    if (g.phase === 'exchange' || g.phase === 'peek') return [g.cur.actor];
    if (g.phase === 'show') return [g.cur.target];
    return [];
  }

  // The dullest legal move, for a player who ran out of time or left.
  function autoMove(g, pid) {
    const p = g.players[pid];
    if (g.phase === 'turn') {
      const rival = g.players.find(x => x !== p && alive(x));
      return act(g, pid, p.coins >= 10 ? { type: 'action', action: 'coup', target: rival.id } : { type: 'action', action: 'income' });
    }
    if (g.phase === 'lose') return act(g, pid, { type: 'lose', card: p.cards.findIndex(c => !c.revealed) });
    if (g.phase === 'show') return act(g, pid, { type: 'show', card: p.cards.findIndex(c => !c.revealed) });
    if (g.phase === 'peek') return act(g, pid, { type: 'peek', swap: false });
    if (g.phase === 'exchange') return act(g, pid, { type: 'exchange', keep: p.cards.filter(c => !c.revealed).map((_, i) => i) });
    return act(g, pid, { type: 'pass' });
  }

  // Remove a player mid-game: settle anything they owe, then kill their cards.
  function forfeit(g, pid) {
    const p = g.players[pid];
    for (let n = 0; n < 10 && waitingOn(g).includes(pid); n++) autoMove(g, pid);
    if (g.phase === 'over' || !alive(p)) return;
    p.cards.forEach(c => { c.revealed = true; });
    g.out.push(pid); emit(g, { type: 'out', id: pid });
    say(g, `${p.name} has been dragged off the show.`);
    if (g.phase === 'turn') finish(g);
    else if (g.cur.actor === pid && g.phase !== 'lose') endTurn(g); // their pending action dies with them
  }

  // A game read back from disk: everything is plain data except the shuffler, which is reattached here.
  const revive = (g, rng = Math.random) => Object.assign(g, { rng });

  Object.assign(exports, { revive, ROLES, ACTIONS, REACTIONS, BOT_NAMES, actionsFor, rolesFor, awards, newGame, act, view, waitingOn, autoMove, forfeit });
})(typeof module !== 'undefined' ? module.exports : (window.Game = {}));
