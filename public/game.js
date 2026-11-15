// Rules engine and all theme text. The server is the authority; the browser only reads ROLES/ACTIONS for labels.
(function (exports) {
  const ROLES = {
    showrunner: { name: 'Showrunner', icon: '🎬', text: 'Sponsor Deal: take 3 gold. Blocks Fan Donations.' },
    backstabber: { name: 'Backstabber', icon: '🗡️', text: 'Shiv: pay 3 gold, a rival loses a card.' },
    goblin: { name: 'Loot Goblin', icon: '💰', text: 'Yoink: steal 2 gold. Blocks Yoink.' },
    changeling: { name: 'Changeling', icon: '🎭', text: 'Respec: swap cards with the deck. Blocks Yoink.' },
    bouncer: { name: 'Bouncer', icon: '🛡️', text: 'Safe Room: blocks Shiv.' },
  };

  const ACTIONS = {
    income: { name: 'Grind', text: '+1 gold' },
    aid: { name: 'Fan Donations', text: '+2 gold', blockBy: ['showrunner'] },
    tax: { name: 'Sponsor Deal', text: '+3 gold', claim: 'showrunner' },
    steal: { name: 'Yoink', text: 'Steal 2', claim: 'goblin', target: true, blockBy: ['goblin', 'changeling'] },
    exchange: { name: 'Respec', text: 'Swap cards', claim: 'changeling' },
    assassinate: { name: 'Shiv', text: 'Pay 3: kill a card', claim: 'backstabber', cost: 3, target: true, blockBy: ['bouncer'] },
    coup: { name: 'Boss Drop', text: 'Pay 7: kill a card', cost: 7, target: true },
  };

  const alive = p => p.cards.some(c => !c.revealed);
  const holds = (p, role) => p.cards.find(c => !c.revealed && c.role === role);
  const say = (g, text) => { g.log.push(text); };

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame(names, rng = Math.random) {
    const g = { rng, log: [], phase: 'turn', cur: null, block: null, waiting: [], canChallenge: false, loser: null, offer: null, after: null, winner: null };
    g.deck = shuffle(Object.keys(ROLES).flatMap(r => [r, r, r]), rng);
    g.players = names.map((name, id) => ({
      id, name, coins: 2,
      cards: [g.deck.pop(), g.deck.pop()].map(role => ({ role, revealed: false })),
    }));
    g.turn = Math.floor(rng() * names.length);
    say(g, `Welcome, Crawlers! ${g.players[g.turn].name} goes first. Try not to die boringly.`);
    return g;
  }

  function reveal(g, p, card) {
    card.revealed = true;
    const what = ROLES[card.role].name;
    say(g, alive(p) ? `${p.name} loses their ${what}.` : `${p.name} loses their ${what} and is DEAD. The viewers love it.`);
  }

  // Player loses a card: asks them to pick if they still have two, then runs `after`.
  function lose(g, pid, after) {
    const p = g.players[pid], left = p.cards.filter(c => !c.revealed);
    if (left.length === 2) { g.phase = 'lose'; g.loser = pid; g.after = after; return; }
    if (left.length) reveal(g, p, left[0]);
    after();
  }

  function challenge(g, challengerId, claimantId, role, done) {
    const ch = g.players[challengerId], cl = g.players[claimantId], card = holds(cl, role);
    if (card) {
      say(g, `${ch.name} calls the bluff. ${cl.name} really is the ${ROLES[role].name}. Awkward.`);
      g.deck.push(card.role); shuffle(g.deck, g.rng); card.role = g.deck.pop();
      lose(g, challengerId, () => done(true));
    } else {
      say(g, `${ch.name} calls the bluff. ${cl.name} was lying!`);
      lose(g, claimantId, () => done(false));
    }
  }

  function openReact(g, canChallenge) {
    const c = g.cur, a = ACTIONS[c.action];
    g.phase = 'react'; g.canChallenge = canChallenge;
    g.waiting = g.players
      .filter(p => alive(p) && p.id !== c.actor && (canChallenge || (a.blockBy && (c.target == null || c.target === p.id))))
      .map(p => p.id);
    if (!g.waiting.length) resolve(g);
  }

  function endTurn(g) {
    g.cur = g.block = g.offer = g.loser = null; g.waiting = [];
    const living = g.players.filter(alive);
    if (living.length === 1) {
      g.phase = 'over'; g.winner = living[0].id;
      say(g, `${living[0].name} is the Last Crawler Standing!`);
      return;
    }
    do g.turn = (g.turn + 1) % g.players.length; while (!alive(g.players[g.turn]));
    g.phase = 'turn';
  }

  function resolve(g) {
    const c = g.cur, p = g.players[c.actor], t = g.players[c.target];
    switch (c.action) {
      case 'income': p.coins += 1; break;
      case 'aid': p.coins += 2; break;
      case 'tax': p.coins += 3; break;
      case 'steal': { const n = Math.min(2, t.coins); t.coins -= n; p.coins += n; break; }
      case 'coup': case 'assassinate': return lose(g, c.target, () => endTurn(g));
      case 'exchange':
        g.offer = [...p.cards.filter(x => !x.revealed).map(x => x.role), g.deck.pop(), g.deck.pop()];
        g.phase = 'exchange';
        return;
    }
    endTurn(g);
  }

  // Apply one player's move. Returns an error string, or undefined on success.
  function act(g, pid, m) {
    const p = g.players[pid];
    if (!p || !m || typeof m !== 'object') return 'Bad move';
    if (!alive(p)) return 'You are dead';
    const c = g.cur, a = c && ACTIONS[c.action];

    if (g.phase === 'turn') {
      if (pid !== g.turn || m.type !== 'action' || !Object.hasOwn(ACTIONS, m.action)) return 'Not your move';
      const act = ACTIONS[m.action];
      if (p.coins >= 10 && m.action !== 'coup') return 'With 10+ gold you must Boss Drop';
      if (p.coins < (act.cost || 0)) return 'Not enough gold';
      const t = act.target && Number.isInteger(m.target) ? g.players[m.target] : null;
      if (act.target && (!t || t === p || !alive(t))) return 'Pick a living rival';
      p.coins -= act.cost || 0;
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
          if (blocking) { say(g, `${ACTIONS[c.action].name} is blocked.`); endTurn(g); } else resolve(g);
        }
        return;
      }
      if (m.type === 'challenge') {
        if (blocking) {
          return challenge(g, pid, g.block.by, g.block.role, held => {
            if (held) { say(g, `${a.name} is blocked.`); endTurn(g); } else resolve(g);
          });
        }
        if (!g.canChallenge) return 'Nothing to challenge';
        return challenge(g, pid, c.actor, a.claim, held => {
          if (held) return a.blockBy ? openReact(g, false) : resolve(g);
          g.players[c.actor].coins += a.cost || 0; // caught bluffing: the action never happened
          endTurn(g);
        });
      }
      if (m.type === 'block' && !blocking) {
        if (!a.blockBy || !a.blockBy.includes(m.role) || (c.target != null && c.target !== pid)) return 'You cannot block that';
        g.block = { by: pid, role: m.role };
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
      const after = g.after; g.after = g.loser = null;
      after();
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

    return 'Game over';
  }

  // What one player is allowed to see.
  function view(g, pid) {
    return {
      phase: g.phase, turn: g.turn, cur: g.cur, block: g.block, waiting: g.waiting, canChallenge: g.canChallenge,
      loser: g.loser, winner: g.winner, log: g.log.slice(-40),
      offer: g.phase === 'exchange' && g.cur.actor === pid ? g.offer : null,
      players: g.players.map(p => ({
        id: p.id, name: p.name, coins: p.coins,
        cards: p.cards.map(c => ({ revealed: c.revealed, role: c.revealed || p.id === pid ? c.role : null })),
      })),
    };
  }

  Object.assign(exports, { ROLES, ACTIONS, newGame, act, view });
})(typeof module !== 'undefined' ? module.exports : (window.Game = {}));
