const { ROLES, actionsFor, rolesFor, awards } = window.Game;
const ART_V = 6; // bump when card art changes: phones cache images for a day

// The back of every card: a pulp skull on show-red. One drawing, used by rivals' hidden cards and the bluff showdown.
const CARD_BACK = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="1.5" y="1.5" width="57" height="77" rx="6" fill="#7d1418" stroke="#000" stroke-width="3"/>
  <rect x="7" y="7" width="46" height="66" rx="3" fill="none" stroke="#f5b921" stroke-width="2"/>
  <circle cx="30" cy="36" r="13" fill="#ecdcb4" stroke="#000" stroke-width="2"/>
  <rect x="23" y="44" width="14" height="10" rx="2" fill="#ecdcb4" stroke="#000" stroke-width="2"/>
  <circle cx="25" cy="35" r="3.6" fill="#000"/><circle cx="35" cy="35" r="3.6" fill="#000"/>
  <path d="M30 40l-2.4 4h4.8z" fill="#000"/><path d="M27 48v5M30 48v5M33 48v5" stroke="#000" stroke-width="1.5"/></svg>`);
document.documentElement.style.setProperty('--card-back', `url("${CARD_BACK}")`);
const KEY = 'lcs-session';
const app = document.getElementById('app'), toastEl = document.getElementById('toast');

// Names are player-typed: everything goes through textContent/append, never innerHTML.
const fill = (e, ...kids) => { e.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); return e; };
const h = (tag, props = {}, ...kids) => fill(Object.assign(document.createElement(tag), props), kids);
const btn = (label, onclick, cls = '', sub) => h('button', { onclick, className: cls }, label, sub && h('small', {}, sub));

let session = JSON.parse(localStorage.getItem(KEY) || 'null');
let prev = null, fresh = false; // previous game view, and whether this render follows a server update
let headlines = []; // every announcer line the latest update added, so chained events are all shown
let v = null, es = null, picking = null, choosing = null, keep = [], toastTimer;

function toast(msg) {
  toastEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 3000);
}

// Sound: short synth beeps, no audio files. Browsers only allow audio after a tap, hence the pointerdown hook.
let audio, wasMyMove = false, deadlineAt = null;
const muted = () => localStorage.getItem('lcs-mute') === '1';
addEventListener('pointerdown', () => {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
});
function tone(freqs, dur = 0.12, type = 'square') {
  if (!audio || muted()) return;
  freqs.forEach((f, i) => {
    const o = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + i * dur;
    o.type = type; o.frequency.value = f;
    gain.gain.setValueAtTime(0.08, t); gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gain).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  });
}

function tick() {
  const el = document.getElementById('clock');
  if (!el) return;
  const s = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)) : null;
  el.textContent = s == null ? '' : `${s}s left`;
  el.classList.toggle('late', s != null && s <= 5);
}
setInterval(tick, 500);

// A role's name on its own card colour.
const chip = (role, cls = '') => h('span', { className: `pip${cls}`, style: `background:${ROLES[role].color}` }, ROLES[role].name);
function gold(n, cls = '', from, pid) {
  const e = h('span', { className: `gold${cls}` }, h('i', { className: 'coin' }), h('span', { className: 'num' }, String(n)));
  if (pid != null) e.dataset.pid = pid;
  if (from != null) e.lastChild.dataset.from = from; // polish() counts up or down from here
  e.setAttribute('aria-label', `${n} gold`);
  return e;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function kickBtn(i, name) {
  const b = btn('✕', () => confirm(`Remove ${name} from the game?`) && send({ type: 'kick', target: i }), 'ghost mini');
  b.setAttribute('aria-label', `Remove ${name}`);
  return b;
}

async function post(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = move => { picking = choosing = null; post('move', { ...session, move }).catch(e => toast(e.message)); };

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?code=${session.code}&token=${session.token}`);
  es.onmessage = e => { prev = v && v.game; v = JSON.parse(e.data); deadlineAt = v.left == null ? null : Date.now() + v.left; fresh = true; render(); fresh = false; };
  // The server says "gone" when the room no longer exists. Plain errors are not trusted for this:
  // a page reload also fires one. Dropped connections retry on their own.
  es.addEventListener('gone', leave);
}

function leave() {
  if (es) es.close();
  localStorage.removeItem(KEY);
  session = v = es = null;
  render();
}

// Saved player: this phone's id and secret, issued by the server on first visit. No password, no sign-up.
const ME = 'lcs-player';
let me = JSON.parse(localStorage.getItem(ME) || 'null'), profile = null, prefilled = false;

async function hello(name) {
  const r = await post('hello', { player: me, name });
  if (!r.known) { me = profile = null; localStorage.removeItem(ME); return; }
  if (r.secret) { me = { id: r.id, secret: r.secret }; localStorage.setItem(ME, JSON.stringify(me)); }
  profile = r;
}

// Home screen only: fetch my saved name and any invites, without re-rendering the form being typed in.
async function refreshHome() {
  if (session || !me || document.hidden) return;
  try { await hello(); } catch { return; }
  const box = document.getElementById('invites'), name = document.getElementById('name');
  if (!box || !profile) return;
  if (!prefilled && !name.value) name.value = profile.name;
  prefilled = true;
  const r = profile.record;
  fill(box, r && r.games > 0 && h('p', { className: 'tag' }, `Welcome back, ${profile.name}. ${plural(r.wins, 'win')} in ${plural(r.games, 'game')}.`),
    profile.invites.length > 0 && h('div', { className: 'panel' }, h('h2', {}, "You're invited"),
    profile.invites.map(i => btn(`Join ${i.from}'s room`, () => join(i.code), 'hot', `Room ${i.code}`))));
}
setInterval(refreshHome, 5000);

async function usePlayerCode(text) {
  const [id, secret] = text.trim().split('.'), old = me;
  me = { id, secret };
  try { await hello(); } catch { me = null; }
  if (!me) {
    me = old;
    if (old) localStorage.setItem(ME, JSON.stringify(old));
    return toast('That player code is not valid');
  }
  localStorage.setItem(ME, JSON.stringify(me));
  toast(`Welcome back, ${profile.name}`);
  render();
}

async function join(code) {
  try {
    const name = document.getElementById('name').value, passcode = document.getElementById('pass').value;
    if (!name.trim()) return toast('Enter a name');
    await hello(name); // creates this phone's saved player on first visit, or renames it
    session = await post('join', { name, code, passcode, player: me });
    localStorage.setItem(KEY, JSON.stringify(session));
    connect();
  } catch (e) { toast(e.message); }
}

// The cast, fanned like a hand of cards. Zev joins once his banner card is ready.
const FAN = ['backstabber', 'goblin', 'showrunner', 'bouncer', 'paparazzo'];
let fanned = false;
function fan() {
  const mid = (FAN.length - 1) / 2;
  const el = h('div', { className: 'fan' }, FAN.map((r, i) => h('img', { src: `art/${r}.jpg?v=${ART_V}`, alt: '', width: 400, height: 536,
    style: `translate:calc(-50% + ${(i - mid) * 38}px) ${Math.abs(i - mid) * 10}px;rotate:${(i - mid) * 9}deg;z-index:${i}` })));
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
      h('details', {}, h('summary', {}, 'My server needs a passcode'), pass)),
    h('details', {}, h('summary', {}, 'Switching phones?'),
      me && h('p', {}, 'This phone is your player. To move it, copy this code to the other phone. Keep it private.'), me && mine,
      h('p', {}, 'Have a code from your other phone?'), theirs, btn('Use this code', () => usePlayerCode(theirs.value), 'ghost')),
  );
  refreshHome();
}

function renderLobby() {
  const link = `${location.origin}/?room=${v.code}`;
  const share = () => navigator.share ? navigator.share({ title: 'Last Crawler Standing', url: link }).catch(() => {})
    : navigator.clipboard.writeText(link).then(() => toast('Invite link copied'), () => toast(link));
  fill(app,
    h('h1', {}, 'Last Crawler Standing'),
    h('div', { className: 'group' }, h('h2', {}, 'Room code'), h('div', { className: 'code' }, v.code), btn('Share invite link', share)),
    h('div', { className: 'group' }, h('h2', {}, `Crawlers (${v.names.length} of 6)`),
      v.names.map((n, i) => h('div', { className: 'rival' }, h('span', { className: 'name' }, n), i === 0 && h('span', { className: 'note' }, 'host'), i === v.you && h('span', { className: 'note' }, 'you'), v.host && i > 0 && kickBtn(i, n)))),
    v.host ? h('div', { className: 'group' }, h('h2', {}, 'Move timer'),
      h('div', { className: 'grid three' }, [0, 30, 60].map(s => {
        const b = btn(s ? `${s}s` : 'Off', () => send({ type: 'timer', seconds: s }), v.timer === s ? '' : 'ghost');
        b.setAttribute('aria-pressed', v.timer === s);
        return b;
      })),
      h('p', { className: 'tag' }, 'When time runs out, a slow crawler passes or Grinds automatically.'),
      h('h2', {}, 'Card set'),
      h('div', { className: 'grid' }, [false, true].map(on => {
        const b = btn(on ? 'Odette' : 'Classic', () => send({ type: 'variant', on }), v.variant === on ? '' : 'ghost');
        b.setAttribute('aria-pressed', v.variant === on);
        return b;
      })),
      h('p', { className: 'tag' }, v.variant ? `${ROLES.paparazzo.name} replaces ${ROLES.changeling.name}. ${ROLES.paparazzo.text}` : `Includes ${ROLES.changeling.name}. ${ROLES.changeling.text}`))
      : h('p', { className: 'tag' }, `${v.timer ? `${v.timer}s move timer` : 'No move timer'}. ${v.variant ? ROLES.paparazzo.name : 'Classic'} card set.`),
    v.record && v.record.games > 0 && h('p', { className: 'tag' }, `Your record: ${plural(v.record.wins, 'win')} in ${plural(v.record.games, 'game')}.`),
    v.friends.length > 0 && h('div', { className: 'group' }, h('h2', {}, 'Invite players you know'),
      v.friends.slice().sort((a, b) => b.wins - a.wins).map(f => h('div', { className: 'rival' }, h('span', { className: 'name' }, f.name),
        h('span', { className: 'note' }, plural(f.wins, 'win')),
        f.here ? h('span', { className: 'note' }, 'here') : f.invited ? h('span', { className: 'note' }, 'invited')
          : btn('Invite', () => post('invite', { ...session, to: f.id }).catch(e => toast(e.message)), 'mini'))),
      h('p', { className: 'tag' }, 'They see the invite when they open the game.')),
    v.host ? btn('Start the show', () => send({ type: 'start' }), '', v.names.length < 2 ? 'Needs at least 2 crawlers' : null)
      : h('p', { className: 'tag' }, `Waiting for ${v.names[0]} to start the show…`),
    btn('Leave', leave, 'ghost'),
  );
}

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
    v.host ? btn('Play again', () => send({ type: 'start' }), 'hot') : h('p', { className: 'tag' }, 'The host can start a rematch.'));
  if (!isAlive(my)) return say("You're out. Every card is face up for you now, so enjoy the show.");

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
    return say(my.coins >= 10 ? 'Your turn. 10+ gold: you must Boss Drop.' : 'Your turn. Play one of your cards below, or:',
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
      // A Shiv aimed at you is the one move where a single mistake costs both cards.
      g.canChallenge && btn('Call the bluff', () => send({ type: 'challenge' }), 'hot', shivOnMe ? "If you're wrong, you lose a card and the Shiv still lands" : "If you're wrong, you lose a card"),
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
    return say(`Respec: keep ${n}.`, h('div', { className: 'grid' }, g.offer.map((r, i) => card(r, keep.includes(i) ? 'on' : '',
      () => { keep = keep.includes(i) ? keep.filter(k => k !== i) : [...keep, i]; render(); }))), ok);
  }
}

// Begin an action: targeted ones go to the victim picker first.
function start(id, act) {
  if (act.target) { picking = id; choosing = null; render(); } else send({ type: 'action', action: id });
}

// Blank parchment on each card art, as [left, top, width, height] in % of the image (live card, then its -dead version).
// Most banner cards (3:4) share one parchment position; Carl's cards are taller and Zev still uses the older 1:2 art
// with no name banner.
const NEW_SLOT = [8, 68, 84, 18];
const SLOTS = {
  backstabber: [8, 79.5, 84, 10], 'backstabber-dead': [8, 68, 84, 17],
  changeling: [8.6, 82.8, 89.1, 13.7], 'changeling-dead': [8.6, 78.9, 89.1, 13.7],
};
const SIZES = { backstabber: [400, 596], 'backstabber-dead': [400, 596], changeling: [256, 512], 'changeling-dead': [256, 512] };
const NO_BANNER = new Set(['changeling', 'changeling-dead']);
const artSize = art => SIZES[art] || [400, 536];

function card(role, cls, onclick, foot) {
  const art = role + (cls.includes('gone') ? '-dead' : ''), slot = SLOTS[art] || NEW_SLOT;
  const b = h('button', { className: `card ${cls}`, onclick, disabled: !onclick },
    // Revealed cards use the defeated version of the art. The art has no name banner or printed text: the name goes in
    // the text below and the blurb is laid over the blank parchment.
    h('div', { className: 'art' },
      h('img', { src: `art/${art}.jpg?v=${ART_V}`, alt: '', width: artSize(art)[0], height: artSize(art)[1] }),
      h('span', { className: 'slot', style: `left:${slot[0]}%;top:${slot[1]}%;width:${slot[2]}%;height:${slot[3]}%` }, ROLES[role].blurb)),
    // Banner art already shows the name; the older art without a banner needs it written out.
    h('small', {}, NO_BANNER.has(art) ? [h('b', {}, ROLES[role].name), ', '] : null, ROLES[role].title, ROLES[role].quip && h('q', {}, ROLES[role].quip)),
    foot && h('b', { className: 'foot' }, foot));
  if (onclick) b.setAttribute('aria-pressed', cls === 'on');
  return b;
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
    g.players.filter(p => p.id !== me).map(p => h('div', { className: `rival${g.turn === p.id && g.phase !== 'over' ? ' turn' : ''}${p.cards.every(c => c.revealed) ? ' dead' : ''}` },
      h('span', { className: 'name' }, p.name),
      p.cards.map((c, i) => c.revealed ? chip(c.role, slam(p, i)) : c.role ? chip(c.role, ' peek')
        : Object.assign(h('span', { className: 'back' }), { title: 'Hidden card' })),
      p.cards.every(c => c.revealed) && Object.assign(h('span', { className: 'cancelled' }, 'Cancelled'), { id: `out-${p.id}` }),
      gold(p.coins, pop(p), old && old[p.id].coins, p.id),
      v.host && g.phase !== 'over' && p.cards.some(c => !c.revealed) && kickBtn(p.id, p.name))),
    h('div', { className: myMove || g.phase === 'over' ? 'panel' : 'status' }, h('div', { id: 'clock', className: 'clock' }), prompt(g, me)),
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
      if (my.coins >= 10) return card(c.role, '', null, 'Must Boss Drop');
      if (!can.length) return card(c.role, '', null, `${acts[0][1].name} needs ${acts[0][1].cost} gold`);
      return card(c.role, 'play', () => { if (can.length > 1) { choosing = c.role; render(); } else start(...can[0]); },
        `Play ${can.map(([, a]) => a.name).join(' or ')}`);
    })),
    h('details', {}, h('summary', {}, 'Show log'), g.log.slice().reverse().map(l => h('p', {}, l))),
    h('details', {}, h('summary', {}, 'Rules'),
      h('p', {}, 'Everyone has 2 hidden cards. Lose both and you are dead. Last one alive wins.'),
      h('p', {}, 'You may claim any role, held or not. If someone calls your bluff and you lied, you lose a card. If you told the truth, they do.'),
      rolesFor(g.variant).map(k => h('p', {}, chip(k), ` ${ROLES[k].title}. ${ROLES[k].text}`)),
      h('p', {}, 'Anyone: Grind +1, Fan Donations +2, Boss Drop (7 gold, cannot be stopped; forced at 10+ gold).')),
    g.phase === 'over' && btn('Leave room', leave, 'ghost'),
  );
  if (motion) polish(motion);
}

// Event animations, via anime.js. The page is already drawn in its final state and each animation plays *from* an
// offset, so with reduced motion on, or if the library failed to load, nothing is missing.
const calm = matchMedia('(prefers-reduced-motion: reduce)');
if (window.anime && !calm.matches) document.documentElement.classList.add('anime');
const rnd = (a, b) => a + Math.random() * (b - a);
const $ = sel => [...document.querySelectorAll(sel)];
const moving = () => window.anime && !calm.matches;

function polishFan(el) {
  if (!moving()) return;
  window.anime.animate(el.querySelectorAll('img'), { y: { from: 220 }, opacity: { from: 0 }, duration: 750, delay: window.anime.stagger(90), ease: 'outBack' });
}

// Something that lives over the game for a moment, then removes itself.
// Exits start on a timer, not as a delayed animation: anime.js lets a newer animation of the same property replace
// an older one at once, so a delayed fade-out would cancel the fade-in.
const later = (ms, fn) => setTimeout(fn, ms);
function overlay(cls, ...kids) {
  const el = h('div', { className: cls }, kids);
  el.setAttribute('aria-hidden', 'true'); // the announcer already says it in words
  document.body.append(el);
  return el;
}

// A bluff was called: the claimed card is turned over in front of everyone.
function showdown(g, e) {
  const { animate } = window.anime, by = g.players[e.by].name, who = g.players[e.claimant].name;
  const flip = h('div', { className: 'flip' }, h('img', { className: 'face front', src: `art/${e.role}.jpg?v=${ART_V}`, alt: '' }),
    h('img', { className: 'face back', src: CARD_BACK, alt: '' }));
  const el = overlay('showdown', h('p', { className: 'burst' }, 'Bluff called!'),
    h('p', { className: 'who' }, `${by} doubts ${who}'s ${ROLES[e.role].name}`), flip,
    h('p', { className: `verdict${e.held ? '' : ' lie'}` }, e.held ? `It's real. ${by} pays.` : `${who} was lying!`));
  animate(el, { opacity: { from: 0 }, duration: 200 });
  animate(el.querySelector('.burst'), { scale: { from: 3 }, rotate: { from: -18 }, duration: 450, ease: 'outBack' });
  animate(flip, { rotateY: { from: 180 }, duration: 700, delay: 550, ease: 'inOutQuad', onComplete: () => { if (!e.held) flip.classList.add('liar'); } });
  if (!e.held) animate(flip, { x: { from: -14 }, duration: 700, delay: 1300, ease: 'outElastic(1, .3)' });
  animate(el.querySelector('.verdict'), { scale: { from: 0 }, duration: 400, delay: 1300, ease: 'outBack' });
  later(2700, () => animate(el, { opacity: 0, duration: 350, onComplete: () => el.remove() }));
  return 3000;
}

// Comic sound effect across the screen.
function sfx(text, delay) {
  const { animate } = window.anime, el = overlay('sfx', text);
  el.style.opacity = 0; // hidden until its moment, in case a showdown plays first
  later(delay, () => { el.style.opacity = ''; animate(el, { scale: { from: 0 }, rotate: { from: -25 }, duration: 380, ease: 'outBack' }); });
  later(delay + 1100, () => animate(el, { opacity: 0, duration: 300, onComplete: () => el.remove() }));
}

// Gold travels: from the bank (the announcer box) or a player's purse, to a player's purse or back to the bank.
function coins(e, delay) {
  const { animate } = window.anime;
  const spot = id => { const r = (id == null ? document.getElementById('announcer') : document.querySelector(`[data-pid="${id}"] .coin`))?.getBoundingClientRect();
    return r && { x: r.left + r.width / 2, y: id == null ? r.top + 8 : r.top + r.height / 2 }; };
  const a = spot(e.from), b = spot(e.to);
  if (!a || !b) return;
  for (let i = 0; i < Math.min(e.n, 5); i++) {
    const c = overlay('flycoin');
    c.style.left = `${a.x}px`; c.style.top = `${a.y}px`;
    animate(c, { x: b.x - a.x, y: b.y - a.y, scale: { from: 1.5, to: .8 }, duration: 620, delay: delay + i * 90,
      ease: 'inOutQuad', onComplete: () => c.remove() });
  }
}

function polish({ g, ev, deal, yourMove, win }) {
  if (!moving()) return;
  const { animate, stagger } = window.anime;
  // A called bluff plays first; everything else waits for it.
  let wait = 0;
  for (const e of ev) if (e.type === 'challenge') wait = showdown(g, e);
  for (const e of ev) {
    if (e.type === 'sfx') sfx(e.text, wait);
    if (e.type === 'gold') coins(e, wait + 150);
    const stamp = e.type === 'out' && document.getElementById(`out-${e.id}`);
    if (stamp) animate(stamp, { scale: { from: 3 }, opacity: { from: 0 }, duration: 500, delay: wait, ease: 'outBack' });
  }
  // New game: your two cards are dealt onto the table.
  if (deal) animate($('#app > .grid .card'), { y: { from: -90 }, rotate: { from: -10 }, scale: { from: .6 }, opacity: { from: 0 },
    duration: 650, delay: stagger(150), ease: 'outBack' });
  // The System's new lines arrive one after another.
  const lines = $('#announcer.in p');
  if (lines.length) animate(lines, { x: { from: -16 }, opacity: { from: 0 }, duration: 320, delay: stagger(120), ease: 'outQuad' });
  // Gold counts up or down to its new total, and the coin flips.
  for (const el of $('.gold.pop')) {
    const num = el.querySelector('.num'), from = Number(num.dataset.from), to = Number(num.textContent), tally = { n: from };
    if (Number.isFinite(from)) animate(tally, { n: to, duration: 700, ease: 'outQuad', onUpdate: () => { num.textContent = Math.round(tally.n); } });
    animate(el.querySelector('.coin'), { rotateY: { from: 540 }, scale: { from: 1.7 }, duration: 650, ease: 'outBack' });
  }
  // A card that just died: yours turns over to its defeated side; a rival's tag takes the hit.
  const flips = $('.card.slam'), hits = $('.pip.slam');
  if (flips.length) animate(flips, { rotateY: { from: 180 }, duration: 700, ease: 'inOutQuad' });
  if (hits.length) animate(hits, { x: { from: -12 }, rotate: { from: -6 }, scale: { from: 1.18 }, duration: 900, ease: 'outElastic(1, .35)' });
  // The game turns to you: your options rise into place.
  if (yourMove) animate($('.panel button'), { y: { from: 12 }, opacity: { from: 0 }, duration: 260, delay: stagger(40), ease: 'outQuad' });
  // Winner: confetti, each piece on its own path.
  if (win) for (const s of $('.confetti span')) animate(s, { y: innerHeight + 80, x: rnd(-90, 90), rotate: rnd(-720, 720),
    duration: rnd(1800, 2900), delay: rnd(0, 600), ease: 'inQuad' });
}

function render() {
  if (!session || !v) return session ? fill(app,h('p', { className: 'tag' }, 'Reconnecting…')) : renderJoin();
  v.game ? renderGame() : renderLobby();
  tick();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && session && es && es.readyState === 2) connect(); });
render();
if (session) connect();
