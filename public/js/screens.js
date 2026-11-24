// The screens: join, lobby and the game itself, plus the prompts and host tools inside them.
function kickBtn(i, name) {
  const b = btn('✕', () => confirm(`Remove ${name} from the game?`) && send({ type: 'kick', target: i }), 'ghost mini');
  b.setAttribute('aria-label', `Remove ${name}`);
  return b;
}

// Season leaderboard: everyone who has played on this server, loaded when opened.
function hallOfFame() {
  const list = h('div', { className: 'group' }, h('p', { className: 'tag' }, 'Loading…'));
  const box = h('details', {}, h('summary', {}, 'Hall of fame'), list);
  box.addEventListener('toggle', () => box.open && post('leaders', {}).then(rows => fill(list,
    rows.length ? rows.map((r, i) => h('div', { className: 'rival' }, h('span', { className: 'note' }, `${i + 1}.`), h('span', { className: 'name' }, r.name),
      h('span', { className: 'note' }, `${plural(r.wins, 'win')} in ${plural(r.games, 'game')}, ${plural(r.points, 'pt')}`)))
      : h('p', { className: 'tag' }, 'Nobody has finished a game yet. Be the first.')), () => fill(list, h('p', { className: 'tag' }, 'Could not load the hall of fame.'))));
  return box;
}

// How to play, built from the rules in game.js so it always matches the card set in use.
function howToPlay(variant, open = false) {
  const A = actionsFor(variant), names = rs => rs.map(r => ROLES[r].name).join(' or ');
  const box = h('details', { className: 'howto' }, h('summary', {}, 'How to play'),
    h('h2', {}, 'The goal'),
    h('p', {}, 'Everyone starts with 2 hidden cards and 2 gold. Lose both cards and you are out. The last crawler with a card left wins.'),
    h('h2', {}, 'Your turn'),
    h('p', {}, 'Take one action. Some need a character: you may claim any character, whether you hold it or not.'),
    Object.values(A).map(a => h('p', {}, h('b', {}, a.name), ` ${a.text}.`, a.claim && [' Claim ', chip(a.claim), '.'],
      a.blockBy && ` Blocked by ${names(a.blockBy)}.`, !a.claim && !a.blockBy && a.cost && ' Cannot be stopped.')),
    h('p', {}, `With 10 or more gold you must ${A.coup.name}.`),
    h('h2', {}, 'Calling bluffs'),
    h('p', {}, 'When someone claims a character, anyone may call the bluff. If they lied, they lose a card. If they told the truth, the caller loses a card, and the claimant swaps the proven card for a fresh one.'),
    h('p', {}, 'Blocks are claims too, so a block can be called out the same way.'),
    h('h2', {}, 'The cast'),
    rolesFor(variant).map(k => h('p', {}, chip(k), ` ${ROLES[k].title}. ${ROLES[k].text}`)));
  box.open = open;
  return box;
}

// A rival's row at the table: name, cards (backs unless you may see them), gold. Used by the game and the TV.
function seatRow(g, p, old) {
  const pop = old && old[p.id].coins !== p.coins ? ' pop' : '';
  const slam = i => old && p.cards[i].revealed && !old[p.id].cards[i].revealed ? ' slam' : '';
  return h('div', { className: `rival${g.turn === p.id && g.phase !== 'over' ? ' turn' : ''}${p.cards.every(c => c.revealed) ? ' dead' : ''}` },
    h('span', { className: 'name' }, p.name),
    (v.away || [])[p.id] && g.phase !== 'over' && h('span', { className: 'note' }, 'away'),
    p.cards.map((c, i) => c.revealed ? chip(c.role, slam(i)) : c.role ? chip(c.role, ' peek')
      : Object.assign(h('span', { className: 'back' }), { title: 'Hidden card' })),
    p.cards.every(c => c.revealed) && Object.assign(h('span', { className: 'cancelled' }, 'Cancelled'), { id: `out-${p.id}` }),
    gold(p.coins, pop, old && old[p.id].coins, p.id),
    v.host && g.phase !== 'over' && p.cards.some(c => !c.revealed) && kickBtn(p.id, p.name));
}

// A phone that has been gone a while is holding up the game: anyone still playing may move for it.
function awayPrompt(g, me) {
  if (g.phase === 'over' || !g.players[me].cards.some(c => !c.revealed)) return null;
  const stuck = waitingOn(g).filter(id => id !== me && (v.away || [])[id]);
  return stuck.length > 0 && h('div', { className: 'panel' }, stuck.map(id => [
    h('p', {}, `${g.players[id].name}'s phone has been gone for a while.`),
    btn('Skip their move', () => send({ type: 'skip', target: id }), 'hot', 'The System makes the dullest move for them'),
    v.host && h('p', { className: 'tag' }, 'Or remove them with ✕ next to their name.')]));
}

// The cast, fanned like a hand of cards.
const FAN = ['backstabber', 'goblin', 'showrunner', 'changeling', 'bouncer', 'paparazzo'];
let fanned = false;
function fan() {
  const mid = (FAN.length - 1) / 2;
  const el = h('div', { className: 'fan' }, FAN.map((r, i) => h('img', { src: `art/${r}.jpg?v=${ART_V}`, alt: '', width: 400, height: 536,
    style: `translate:calc(-50% + ${(i - mid) * 30}px) ${Math.abs(i - mid) * 8}px;rotate:${(i - mid) * 8}deg;z-index:${i}` })));
  el.setAttribute('aria-hidden', 'true');
  if (!fanned) { fanned = true; requestAnimationFrame(() => polishFan(el)); } // the join screen's one entrance
  return el;
}

function renderJoin() {
  const room = new URLSearchParams(location.search).get('room') || '';
  const code = h('input', { id: 'code', placeholder: 'ABCDE', value: room, maxLength: 5, autocapitalize: 'characters', autocomplete: 'off' });
  code.setAttribute('aria-label', 'Room code');
  const name = h('input', { id: 'name', maxLength: 16, autocomplete: 'nickname' });
  name.setAttribute('aria-label', 'Your crawler name');
  const pass = h('input', { id: 'pass', placeholder: 'Host passcode', type: 'password', autocomplete: 'off' });
  pass.setAttribute('aria-label', 'Host passcode');
  const mine = h('input', { readOnly: true, value: me ? `${me.id}.${me.secret}` : '', onfocus: e => e.target.select() });
  mine.setAttribute('aria-label', 'My player code');
  const theirs = h('input', { placeholder: 'Paste player code', autocomplete: 'off' });
  theirs.setAttribute('aria-label', 'Player code from another phone');
  prefilled = false;
  fill(app,
    fan(),
    h('h1', {}, 'Last Crawler Standing'),
    h('p', { className: 'tag' }, 'Lie. Loot. Backstab. The whole galaxy is watching.'),
    h('div', { id: 'invites' }),
    h('label', { className: 'group' }, h('h2', {}, 'Your crawler name'), name),
    h('label', { className: 'group' }, h('h2', {}, 'Join with a room code'), code),
    btn('Join room', () => code.value.trim() ? join(code.value) : toast('Enter the room code')),
    h('div', { className: 'group' }, h('h2', {}, 'Or start your own'), btn('Host a new game', () => join('')),
      btn('Practice against bots', () => join('', true), 'ghost', 'A quick game to learn the ropes'),
      h('details', {}, h('summary', {}, 'My server needs a passcode'), pass)),
    howToPlay(false),
    hallOfFame(),
    h('details', {}, h('summary', {}, 'Switching phones?'),
      me && h('p', {}, 'This phone is your player. To move it, copy this code to the other phone. Keep it private.'), me && mine,
      h('p', {}, 'Have a code from your other phone?'), theirs, btn('Use this code', () => usePlayerCode(theirs.value), 'ghost')),
  );
  refreshHome();
}

// Host's game settings: in the lobby, and again between games. Everyone else sees a summary.
function settings() {
  if (!v.host) return h('p', { className: 'tag' }, `${v.timer ? `${v.timer}s move timer` : 'No move timer'}. ${v.variant ? ROLES.paparazzo.name : 'Classic'} card set.`);
  const choice = (label, on, move) => { const b = btn(label, () => send(move), on ? '' : 'ghost'); b.setAttribute('aria-pressed', on); return b; };
  return h('div', { className: 'group' }, h('h2', {}, 'Move timer'),
    h('div', { className: 'grid three' }, [0, 30, 60].map(s => choice(s ? `${s}s` : 'Off', v.timer === s, { type: 'timer', seconds: s }))),
    h('p', { className: 'tag' }, 'When time runs out, a slow crawler passes or Grinds automatically.'),
    h('h2', {}, 'Card set'),
    h('div', { className: 'grid' }, [false, true].map(on => choice(on ? ROLES.paparazzo.name : 'Classic', v.variant === on, { type: 'variant', on }))),
    h('p', { className: 'tag' }, v.variant ? `${ROLES.paparazzo.name} replaces ${ROLES.changeling.name}. ${ROLES.paparazzo.text}` : `Includes ${ROLES.changeling.name}. ${ROLES.changeling.text}`));
}

function renderLobby() {
  const link = `${location.origin}/?room=${v.code}`;
  const share = () => navigator.share ? navigator.share({ title: 'Last Crawler Standing', url: link }).catch(() => {})
    : navigator.clipboard.writeText(link).then(() => toast('Invite link copied'), () => toast(link));
  fill(app,
    h('h1', {}, 'Last Crawler Standing'),
    h('div', { className: 'group' }, h('h2', {}, 'Room code'), h('div', { className: 'code' }, v.code), btn('Share invite link', share), qrFor(link)),
    h('div', { className: 'group' }, h('h2', {}, `Crawlers (${v.names.length} of 6)`),
      v.names.map((n, i) => h('div', { className: 'rival' }, h('span', { className: 'name' }, n), i === 0 && h('span', { className: 'note' }, 'host'), i === v.you && h('span', { className: 'note' }, 'you'), v.host && i > 0 && kickBtn(i, n)))),
    settings(),
    v.practice && h('p', { className: 'tag' }, 'Practice round: your opponents are bots, and this game does not count toward your record.'),
    v.record && v.record.games > 0 && h('p', { className: 'tag' }, `Your record: ${plural(v.record.wins, 'win')} in ${plural(v.record.games, 'game')}. ${plural(v.points, 'point')} banked.`),
    !v.practice && v.friends.length > 0 && h('div', { className: 'group' }, h('h2', {}, 'Invite players you know'),
      v.friends.slice().sort((a, b) => b.wins - a.wins).map(f => h('div', { className: 'rival' }, h('span', { className: 'name' }, f.name),
        h('span', { className: 'note' }, plural(f.wins, 'win')),
        f.here ? h('span', { className: 'note' }, 'here') : f.invited ? h('span', { className: 'note' }, 'invited')
          : btn('Invite', () => post('invite', { ...session, to: f.id }).catch(e => toast(e.message)), 'mini'))),
      h('p', { className: 'tag' }, 'They see the invite when they open the game.')),
    v.host ? btn('Start the show', () => send({ type: 'start' }), '', v.names.length < 2 ? 'Needs at least 2 crawlers' : null)
      : h('p', { className: 'tag' }, `Waiting for ${v.names[0]} to start the show…`),
    howToPlay(v.variant),
    h('details', {}, h('summary', {}, 'Show it on a TV'),
      h('p', {}, 'Open this on a TV or laptop browser to show the table to the room. It never shows hidden cards:'),
      h('a', { href: `/?tv=${v.code}`, target: '_blank' }, `${location.host}/?tv=${v.code}`)),
    btn('Leave', leave, 'ghost'),
  );
}

// Rematch: everyone taps ready, and the next game starts when the last human does. The host can also start now.
function rematch(g, me) {
  const ready = v.ready || [], count = ready.filter(Boolean).length;
  return [
    h('p', { className: 'tag' }, `${count} of ${ready.length} ready for another round.`),
    ready[me] ? h('p', {}, 'You are ready. Waiting for the others…') : btn('Ready for another round', () => send({ type: 'ready' }), 'hot'),
    v.host && btn('Start now', () => send({ type: 'start' }), 'ghost', count < ready.length ? 'Without waiting for everyone' : null),
    v.host && h('details', {}, h('summary', {}, 'Change settings for the next game'), settings()),
  ];
}

// Host tools: move any player's seat to a new phone with a one-time link or QR code.
function hostTools(g) {
  const make = async (i, name) => {
    try {
      const r = await post('reseat', { ...session, target: i });
      handoff = { name, link: `${location.origin}/?room=${v.code}&seat=${r.token}` };
      render();
    } catch (e) { toast(e.message); }
  };
  const box = h('details', {}, h('summary', {}, 'Host tools: move a player to a new phone'),
    h('p', { className: 'tag' }, "If someone's phone dies, make them a seat link and open it on their new phone. Their old phone is signed out of the seat."),
    g.players.filter((p, i) => i !== v.you && !(v.bots || [])[i]).map(p => h('div', { className: 'rival' }, h('span', { className: 'name' }, p.name),
      btn('Seat link', () => make(p.id, p.name), 'mini'))),
    handoff && [h('p', {}, `Seat link for ${handoff.name}. It works once, so share it only with them:`), qrFor(handoff.link),
      btn('Copy link', () => navigator.clipboard.writeText(handoff.link).then(() => toast('Seat link copied'), () => toast(handoff.link)), 'ghost'),
      btn('Done', () => { handoff = null; render(); }, 'ghost')]);
  if (handoff) box.open = true;
  return box;
}

// Practice rounds: a one-line hint for what the prompt is asking.
const TIPS = {
  turn: 'Tip: playing a card you hold is safe. Bluffing a card you don\'t hold pays off, unless someone calls it.',
  react: 'Tip: call the bluff only when you\'re fairly sure they don\'t hold that card. Being wrong costs you a card.',
  blockReact: 'Tip: a block is a claim too, so you can call its bluff.',
  lose: 'Tip: keep the card you\'re most likely to use.',
};

function prompt(g, me) {
  const name = id => g.players[id].name, my = g.players[me];
  const ACTIONS = actionsFor(g.variant);
  // Only you see this: whether a claim would be true for your hand.
  const held = r => my.cards.some(x => !x.revealed && x.role === r) ? 'You hold it' : 'A bluff';
  const isAlive = p => p.cards.some(c => !c.revealed);
  const c = g.cur, a = c && ACTIONS[c.action];
  const say = (text, ...kids) => [h('p', {}, text), ...kids];
  const waitingOn = () => `Waiting on ${g.waiting.map(name).join(', ')}…`;

  if (g.phase === 'over') return say(`${name(g.winner)} is the Last Crawler Standing!`,
    g.stats && h('div', { className: 'awards' }, h('h2', {}, "The System's awards"),
      awards(g.stats, g.out).map(x => h('p', {}, h('b', {}, x.title), ` ${name(x.id)}. ${x.text}`))),
    g.reel && g.reel.length > 0 && moving() && btn('Watch the highlights', () => playReel(g), 'ghost'),
    rematch(g, me));
  // Knocked out: watch with every card face up, and heckle.
  if (!isAlive(my)) return say("You're out. Every card is face up for you now, so enjoy the show. Heckle away:",
    h('div', { className: 'grid three' }, REACTIONS.map((r, i) => btn(r, () => post('react', { ...session, i }).catch(e => toast(e.message)), 'ghost'))));

  if (g.phase === 'turn') {
    if (g.turn !== me) return say(`${name(g.turn)} is deciding…`);
    if (picking) return say(`${ACTIONS[picking].name}: pick your victim`,
      h('div', { className: 'grid' }, g.players.filter(p => p.id !== me && isAlive(p)).map(p => btn(p.name, () => send({ type: 'action', action: picking, target: p.id }), 'hot', `${p.coins} gold`))),
      btn('Cancel', () => { picking = null; render(); }, 'ghost'));
    const mk = ([id, act]) => {
      const b = btn(act.name, () => start(id, act), act.claim ? '' : 'ghost', act.text + (act.claim ? `, as ${ROLES[act.claim].name}` : ''));
      if (act.claim) b.style.background = ROLES[act.claim].color;
      b.disabled = my.coins < (act.cost || 0) || (my.coins >= 10 && id !== 'coup');
      return b;
    };
    const all = Object.entries(ACTIONS), holds = r => my.cards.some(x => !x.revealed && x.role === r);
    if (choosing) return say(`${ROLES[choosing].name}: which move?`,
      h('div', { className: 'grid' }, all.filter(([, a]) => a.claim === choosing).map(mk)),
      btn('Cancel', () => { choosing = null; render(); }, 'ghost'));
    // Honest plays live on your own cards below; this panel keeps the moves anyone can make, and the lies.
    const bluffs = all.filter(([, a]) => a.claim && !holds(a.claim));
    return say(my.coins >= 10 ? `Your turn. 10+ gold: you must ${ACTIONS.coup.name}.` : 'Your turn. Play one of your cards below, or:',
      h('div', { className: 'grid three' }, all.filter(([, a]) => !a.claim).map(mk)),
      bluffs.length > 0 && h('p', { className: 'tag' }, "Or bluff a card you don't hold:"),
      h('div', { className: 'grid' }, bluffs.map(mk)));
  }

  if (g.phase === 'react') {
    const onWhom = c.target != null ? ` on ${c.target === me ? 'you' : name(c.target)}` : '';
    const what = a.claim ? `${name(c.actor)} claims ${ROLES[a.claim].name} to use ${a.name}${onWhom}.` : `${name(c.actor)} is taking ${a.name}.`;
    if (!g.waiting.includes(me)) return say(what, h('p', { className: 'tag' }, waitingOn()));
    const canBlock = a.blockBy && (c.target == null || c.target === me);
    const shivOnMe = c.action === 'assassinate' && c.target === me && my.cards.filter(x => !x.revealed).length === 2;
    return say(what, h('div', { className: 'grid' },
      // A Special Delivery aimed at you is the one move where a single mistake costs both cards.
      g.canChallenge && btn('Call the bluff', () => send({ type: 'challenge' }), 'hot', shivOnMe ? `If you're wrong, you lose a card and the ${a.name} still lands` : "If you're wrong, you lose a card"),
      canBlock && a.blockBy.map(r => Object.assign(btn(`Block as ${ROLES[r].name}`, () => send({ type: 'block', role: r }), '',
        shivOnMe && held(r) === 'A bluff' ? 'A bluff. If called, you lose both cards' : held(r)), { style: `background:${ROLES[r].color}` })),
      btn('Let it happen', () => send({ type: 'pass' }), 'ghost')));
  }

  if (g.phase === 'blockReact') {
    const what = `${name(g.block.by)} claims ${ROLES[g.block.role].name} to block ${a.name}.`;
    if (!g.waiting.includes(me)) return say(what, h('p', { className: 'tag' }, waitingOn()));
    return say(what, h('div', { className: 'grid' }, btn('Call the bluff', () => send({ type: 'challenge' }), 'hot', "If you're wrong, you lose a card"), btn('Accept the block', () => send({ type: 'pass' }), 'ghost')));
  }

  if (g.phase === 'show') return say(c.target === me ? `${name(c.actor)} gets a look at one of your cards. Tap the one to show.` : `${name(c.target)} is choosing a card to show ${name(c.actor)}…`);

  if (g.phase === 'peek') {
    if (c.actor !== me) return say(`${name(c.actor)} is inspecting ${c.target === me ? 'your' : `${name(c.target)}'s`} card…`);
    return say(`${name(c.target)} is holding:`, h('div', { className: 'grid' }, card(g.peek.role, '', null)),
      h('div', { className: 'grid' }, btn('Make them redraw', () => send({ type: 'peek', swap: true }), 'hot'), btn('Let them keep it', () => send({ type: 'peek', swap: false }), 'ghost')));
  }

  if (g.phase === 'lose') return say(g.loser === me ? 'Tap one of your cards below to lose it.' : `${name(g.loser)} is choosing a card to lose…`);

  if (g.phase === 'exchange') {
    if (!g.offer) return say(`${name(c.actor)} is respeccing…`);
    const n = my.cards.filter(x => !x.revealed).length;
    const ok = btn(`Keep these (${keep.length}/${n})`, () => send({ type: 'exchange', keep }), 'hot');
    ok.disabled = keep.length !== n;
    return say(`${a.name}: keep ${n}.`, h('div', { className: 'grid' }, g.offer.map((r, i) => card(r, keep.includes(i) ? 'on' : '',
      () => { keep = keep.includes(i) ? keep.filter(k => k !== i) : [...keep, i]; render(); }))), ok);
  }
}

// Begin an action: targeted ones go to the victim picker first.
function start(id, act) {
  if (act.target) { picking = id; choosing = null; render(); } else send({ type: 'action', action: id });
}

function renderGame() {
  const g = v.game, me = v.you, my = g.players[me];
  if (g.phase !== 'exchange') keep = [];
  if (g.phase !== 'turn') picking = choosing = null;
  // Animate only what changed in the update that just arrived, not on every local re-render.
  const old = fresh && prev && prev.players.length === g.players.length ? prev.players : null;
  const pop = p => old && old[p.id].coins !== p.coins ? ' pop' : '';
  const slam = (p, i) => old && p.cards[i].revealed && !old[p.id].cards[i].revealed ? ' slam' : '';
  const news = fresh && (!prev || prev.log[prev.log.length - 1] !== g.log[g.log.length - 1]);
  if (news) {
    const from = prev ? g.log.lastIndexOf(prev.log[prev.log.length - 1]) + 1 : g.log.length - 1;
    headlines = g.log.slice(Math.max(from, g.log.length - 4));
  } else if (!headlines.length) headlines = g.log.slice(-1);
  const myMove = g.phase !== 'over' && my.cards.some(c => !c.revealed) &&
    ((g.phase === 'turn' && g.turn === me) || g.waiting.includes(me) || g.loser === me || !!g.offer ||
      (g.phase === 'show' && g.cur.target === me) || (g.phase === 'peek' && g.cur.actor === me));
  const deaths = g.players.flatMap(p => p.cards).filter(c => c.revealed).length; // viewers love bloodshed
  let motion = null;
  if (fresh) {
    motion = { g, ev: !prev || prev.seq !== g.seq ? g.ev : [], deal: (!prev || prev.phase === 'over') && g.phase !== 'over', yourMove: myMove && (!wasMyMove || !prev || prev.phase !== g.phase),
      win: g.phase === 'over' && (!prev || prev.phase !== 'over') };
    if (g.phase === 'over' && (!prev || prev.phase !== 'over')) tone([523, 659, 784, 1047], 0.15);
    else if (g.players.some(p => p.cards.some((c, i) => slam(p, i)))) tone([140, 90], 0.2, 'sawtooth');
    if (myMove && !wasMyMove) { tone([660, 880]); if (navigator.vibrate) navigator.vibrate(150); }
    wasMyMove = myMove;
  }
  const mute = btn(muted() ? 'Sound off' : 'Sound on', () => { localStorage.setItem('lcs-mute', muted() ? '0' : '1'); render(); }, 'ghost mini');
  mute.setAttribute('aria-label', muted() ? 'Turn sound on' : 'Turn sound off');
  fill(app,
    g.phase === 'over' && fresh && h('div', { className: 'confetti' }, Array.from({ length: 16 }, (_, i) =>
      h('span', { style: `left:${(i * 37) % 100}%;background:${Object.values(ROLES)[i % 6].color}` }))),
    h('div', { className: 'bar' }, h('div', {}, h('h2', {}, `Room ${v.code}`), h('p', { className: 'tag' }, `Live to ${(2.4 + deaths * 1.7).toFixed(1)}M viewers`)), mute),
    h('div', { id: 'announcer', className: news ? 'in' : '' }, headlines.map(l => h('p', {}, l))),
    g.players.filter(p => p.id !== me).map(p => seatRow(g, p, old)),
    awayPrompt(g, me),
    h('div', { className: myMove || g.phase === 'over' ? 'panel' : 'status' }, h('div', { id: 'clock', className: 'clock' }), prompt(g, me),
      v.practice && myMove && TIPS[g.phase] && h('p', { className: 'tag' }, TIPS[g.phase])),
    h('div', { className: 'bar' }, h('h2', {}, 'Your cards'), gold(my.coins, pop(my), old && old[me].coins, me)),
    h('div', { className: 'grid' }, my.cards.map((c, i) => {
      if (c.revealed) return card(c.role, 'gone' + slam(my, i), null);
      if (g.phase === 'lose' && g.loser === me) return card(c.role, '', () => send({ type: 'lose', card: i }));
      if (g.phase === 'show' && g.cur.target === me) return card(c.role, '', () => send({ type: 'show', card: i }));
      if (g.phase !== 'turn' || g.turn !== me || picking) return card(c.role, '', null);
      // My turn: a card I hold plays its own action, truthfully.
      const acts = Object.entries(actionsFor(g.variant)).filter(([, a]) => a.claim === c.role);
      const can = acts.filter(([, a]) => my.coins >= (a.cost || 0));
      if (!acts.length) return card(c.role, '', null, 'Blocks only');
      if (my.coins >= 10) return card(c.role, '', null, `Must ${actionsFor(g.variant).coup.name}`);
      if (!can.length) return card(c.role, '', null, `${acts[0][1].name} needs ${acts[0][1].cost} gold`);
      return card(c.role, 'play', () => { if (can.length > 1) { choosing = c.role; render(); } else start(...can[0]); },
        `Play ${can.map(([, a]) => a.name).join(' or ')}`);
    })),
    h('details', {}, h('summary', {}, 'Show log'), g.log.slice().reverse().map(l => h('p', {}, l))),
    v.host && !v.practice && hostTools(g),
    howToPlay(g.variant),
    g.phase === 'over' && btn('Leave room', leave, 'ghost'),
  );
  if (motion) polish(motion);
}

// The TV: the whole table for a room to watch, big. No seat, so no hidden cards and no buttons.
function renderTV() {
  document.body.classList.add('tv');
  if (!v) return fill(app, h('h1', {}, 'Last Crawler Standing'), h('p', { className: 'tag' }, `Room ${tv} is not open. Start a room on a phone, then open this page again.`));
  if (!v.game) return fill(app, h('h1', {}, 'Last Crawler Standing'),
    h('div', { className: 'tvlobby' }, h('div', { className: 'group' }, h('h2', {}, 'Join on your phone'), h('div', { className: 'code' }, v.code), qrFor(`${location.origin}/?room=${v.code}`)),
      h('div', { className: 'group' }, h('h2', {}, `Crawlers (${v.names.length} of 6)`), v.names.map(n => h('p', { className: 'tvname' }, n)))),
    h('p', { className: 'tag' }, 'Waiting for the host to start the show…'));
  const g = v.game, name = id => g.players[id].name;
  const old = fresh && prev && prev.players.length === g.players.length ? prev.players : null;
  const news = fresh && (!prev || prev.log[prev.log.length - 1] !== g.log[g.log.length - 1]);
  if (news) headlines = g.log.slice(Math.max(prev ? g.log.lastIndexOf(prev.log[prev.log.length - 1]) + 1 : g.log.length - 1, g.log.length - 4));
  else if (!headlines.length) headlines = g.log.slice(-1);
  const status = g.phase === 'over' ? [h('p', { className: 'winner' }, `${name(g.winner)} is the Last Crawler Standing!`),
    g.stats && h('div', { className: 'awards' }, h('h2', {}, "The System's awards"), awards(g.stats, g.out).map(x => h('p', {}, h('b', {}, x.title), ` ${name(x.id)}. ${x.text}`)))]
    : h('p', {}, `Waiting on ${waitingOn(g).map(name).join(', ')}…`);
  fill(app,
    h('div', { className: 'bar' }, h('h2', {}, `Room ${v.code}`), h('div', { id: 'clock', className: 'clock' })),
    h('div', { id: 'announcer', className: news ? 'in' : '' }, headlines.map(l => h('p', {}, l))),
    h('div', { className: 'tvtable' }, g.players.map(p => seatRow(g, p, old))),
    h('div', { className: g.phase === 'over' ? 'panel' : 'status' }, status),
    h('div', { className: 'tvlog' }, g.log.slice(-8).reverse().map(l => h('p', {}, l))));
  if (fresh) polish({ g, ev: !prev || prev.seq !== g.seq ? g.ev : [], deal: (!prev || prev.phase === 'over') && g.phase !== 'over', yourMove: false,
    win: g.phase === 'over' && (!prev || prev.phase !== 'over') });
}

function render() {
  if (tv) { renderTV(); return tick(); }
  if (!session || !v) return session ? fill(app,h('p', { className: 'tag' }, 'Reconnecting…')) : renderJoin();
  v.game ? renderGame() : renderLobby();
  tick();
}
