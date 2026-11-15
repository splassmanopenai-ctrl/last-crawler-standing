const { ROLES, actionsFor, rolesFor } = window.Game;
const KEY = 'lcs-session';
const app = document.getElementById('app'), toastEl = document.getElementById('toast');

// Names are player-typed: everything goes through textContent/append, never innerHTML.
const fill = (e, ...kids) => { e.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); return e; };
const h = (tag, props = {}, ...kids) => fill(Object.assign(document.createElement(tag), props), kids);
const btn = (label, onclick, cls = '', sub) => h('button', { onclick, className: cls }, label, sub && h('small', {}, sub));

let session = JSON.parse(localStorage.getItem(KEY) || 'null');
let prev = null, fresh = false; // previous game view, and whether this render follows a server update
let v = null, es = null, picking = null, keep = [], toastTimer;

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
  el.textContent = s == null ? '' : `⏱ ${s}s`;
  el.classList.toggle('late', s != null && s <= 5);
}
setInterval(tick, 500);

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
const send = move => { picking = null; post('move', { ...session, move }).catch(e => toast(e.message)); };

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

async function join(code) {
  try {
    const name = document.getElementById('name').value, passcode = document.getElementById('pass').value;
    session = await post('join', { name, code, passcode });
    localStorage.setItem(KEY, JSON.stringify(session));
    connect();
  } catch (e) { toast(e.message); }
}

function renderJoin() {
  const room = new URLSearchParams(location.search).get('room') || '';
  const code = h('input', { id: 'code', placeholder: 'Room code', value: room, maxLength: 5, autocapitalize: 'characters', autocomplete: 'off' });
  code.setAttribute('aria-label', 'Room code');
  const name = h('input', { id: 'name', placeholder: 'Your crawler name', maxLength: 16, autocomplete: 'nickname' });
  name.setAttribute('aria-label', 'Your crawler name');
  const pass = h('input', { id: 'pass', placeholder: 'Host passcode', type: 'password', autocomplete: 'off' });
  pass.setAttribute('aria-label', 'Host passcode');
  fill(app,
    h('h1', {}, 'Last Crawler Standing'),
    h('p', { className: 'tag' }, 'Lie. Loot. Backstab. The whole galaxy is watching.'),
    h('div', { className: 'panel' }, name),
    h('div', { className: 'panel' }, h('h2', {}, 'Got an invite?'), code,
      btn('Join room', () => code.value.trim() ? join(code.value) : toast('Enter the room code'))),
    h('div', { className: 'panel' }, h('h2', {}, 'Or host'), btn('Host a new game', () => join(''), 'hot'),
      h('details', {}, h('summary', {}, 'My server needs a passcode'), pass)),
  );
}

function renderLobby() {
  const link = `${location.origin}/?room=${v.code}`;
  const share = () => navigator.share ? navigator.share({ title: 'Last Crawler Standing', url: link }).catch(() => {})
    : navigator.clipboard.writeText(link).then(() => toast('Invite link copied'), () => toast(link));
  fill(app,
    h('h1', {}, 'Last Crawler Standing'),
    h('div', { className: 'panel' }, h('h2', {}, 'Room code'), h('div', { className: 'big code' }, v.code), btn('Share invite link', share)),
    h('div', { className: 'panel' }, h('h2', {}, `Crawlers (${v.names.length}/6)`),
      v.names.map((n, i) => h('div', { className: 'rival' }, h('span', { className: 'name' }, n), i === 0 && h('span', { className: 'pip' }, 'host'), i === v.you && h('span', { className: 'pip' }, 'you'), v.host && i > 0 && kickBtn(i, n)))),
    v.host ? h('div', { className: 'panel' }, h('h2', {}, 'Move timer'),
      h('div', { className: 'grid three' }, [0, 30, 60].map(s => {
        const b = btn(s ? `${s}s` : 'Off', () => send({ type: 'timer', seconds: s }), v.timer === s ? '' : 'ghost');
        b.setAttribute('aria-pressed', v.timer === s);
        return b;
      })),
      h('p', { className: 'tag' }, 'When time runs out, a slow crawler passes or Grinds automatically.'),
      h('h2', {}, 'Card set'),
      h('div', { className: 'grid' }, [false, true].map(on => {
        const b = btn(on ? 'Paparazzo' : 'Classic', () => send({ type: 'variant', on }), v.variant === on ? '' : 'ghost');
        b.setAttribute('aria-pressed', v.variant === on);
        return b;
      })),
      h('p', { className: 'tag' }, v.variant ? `${ROLES.paparazzo.icon} Paparazzo replaces the Changeling. ${ROLES.paparazzo.text}` : `${ROLES.changeling.icon} Changeling. ${ROLES.changeling.text}`))
      : h('p', { className: 'tag' }, `Move timer: ${v.timer ? `${v.timer}s` : 'off'} · Card set: ${v.variant ? 'Paparazzo' : 'Classic'}`),
    v.host ? btn('Start the show', () => send({ type: 'start' }), 'hot', v.names.length < 2 ? 'Needs at least 2 crawlers' : null)
      : h('p', { className: 'tag' }, `Waiting for ${v.names[0]} to start the show…`),
    btn('Leave', leave, 'ghost'),
  );
}

function prompt(g, me) {
  const name = id => g.players[id].name, my = g.players[me];
  const ACTIONS = actionsFor(g.variant);
  // Only you see this: whether a claim would be true for your hand.
  const held = r => my.cards.some(x => !x.revealed && x.role === r) ? '✓ you hold it' : '🤥 bluff';
  const isAlive = p => p.cards.some(c => !c.revealed);
  const c = g.cur, a = c && ACTIONS[c.action];
  const say = (text, ...kids) => [h('p', {}, text), ...kids];
  const waitingOn = () => `Waiting on ${g.waiting.map(name).join(', ')}…`;

  if (g.phase === 'over') return say(`${name(g.winner)} is the Last Crawler Standing!`, v.host ? btn('Play again', () => send({ type: 'start' }), 'hot') : h('p', { className: 'tag' }, 'The host can start a rematch.'));
  if (!isAlive(my)) return say('You are dead. Enjoy the show from the afterlife.');

  if (g.phase === 'turn') {
    if (g.turn !== me) return say(`${name(g.turn)} is deciding…`);
    if (picking) return say(`${ACTIONS[picking].name}: pick your victim`,
      h('div', { className: 'grid' }, g.players.filter(p => p.id !== me && isAlive(p)).map(p => btn(p.name, () => send({ type: 'action', action: picking, target: p.id }), 'hot', `${p.coins} gold`))),
      btn('Cancel', () => { picking = null; render(); }, 'ghost'));
    return say(my.coins >= 10 ? 'Your turn. 10+ gold: you must Boss Drop.' : 'Your turn. Claim anything. Nobody checks unless they dare.',
      h('div', { className: 'grid' }, Object.entries(ACTIONS).map(([id, act]) => {
        const b = btn(act.name, () => { if (act.target) { picking = id; render(); } else send({ type: 'action', action: id }); },
          act.claim ? '' : 'ghost', act.text + (act.claim ? ` · ${ROLES[act.claim].name} · ${held(act.claim)}` : ''));
        b.disabled = my.coins < (act.cost || 0) || (my.coins >= 10 && id !== 'coup');
        return b;
      })));
  }

  if (g.phase === 'react') {
    const what = `${name(c.actor)} → ${a.name}${c.target != null ? ` on ${c.target === me ? 'YOU' : name(c.target)}` : ''}${a.claim ? ` (claims ${ROLES[a.claim].name})` : ''}`;
    if (!g.waiting.includes(me)) return say(what, h('p', { className: 'tag' }, waitingOn()));
    const canBlock = a.blockBy && (c.target == null || c.target === me);
    return say(what, h('div', { className: 'grid' },
      g.canChallenge && btn('Call the bluff', () => send({ type: 'challenge' }), 'hot', 'Wrong? You lose a card'),
      canBlock && a.blockBy.map(r => btn(`Block as ${ROLES[r].name}`, () => send({ type: 'block', role: r }), '', held(r))),
      btn('Let it happen', () => send({ type: 'pass' }), 'ghost')));
  }

  if (g.phase === 'blockReact') {
    const what = `${name(g.block.by)} blocks ${a.name} as ${ROLES[g.block.role].name}`;
    if (!g.waiting.includes(me)) return say(what, h('p', { className: 'tag' }, waitingOn()));
    return say(what, h('div', { className: 'grid' }, btn('Call the bluff', () => send({ type: 'challenge' }), 'hot', 'Wrong? You lose a card'), btn('Accept the block', () => send({ type: 'pass' }), 'ghost')));
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

function card(role, cls, onclick) {
  const b = h('button', { className: `card ${cls}`, onclick, disabled: !onclick },
    h('div', { className: 'big' }, `${ROLES[role].icon} ${ROLES[role].name}`), h('small', {}, ROLES[role].text));
  if (onclick) b.setAttribute('aria-pressed', cls === 'on');
  return b;
}

function renderGame() {
  const g = v.game, me = v.you, my = g.players[me];
  if (g.phase !== 'exchange') keep = [];
  if (g.phase !== 'turn') picking = null;
  // Animate only what changed in the update that just arrived, not on every local re-render.
  const old = fresh && prev && prev.players.length === g.players.length ? prev.players : null;
  const pop = p => old && old[p.id].coins !== p.coins ? ' pop' : '';
  const slam = (p, i) => old && p.cards[i].revealed && !old[p.id].cards[i].revealed ? ' slam' : '';
  const news = fresh && (!prev || prev.log[prev.log.length - 1] !== g.log[g.log.length - 1]);
  const myMove = g.phase !== 'over' && my.cards.some(c => !c.revealed) &&
    ((g.phase === 'turn' && g.turn === me) || g.waiting.includes(me) || g.loser === me || !!g.offer ||
      (g.phase === 'show' && g.cur.target === me) || (g.phase === 'peek' && g.cur.actor === me));
  const deaths = g.players.flatMap(p => p.cards).filter(c => c.revealed).length; // viewers love bloodshed
  if (fresh) {
    if (g.phase === 'over' && (!prev || prev.phase !== 'over')) tone([523, 659, 784, 1047], 0.15);
    else if (g.players.some(p => p.cards.some((c, i) => slam(p, i)))) tone([140, 90], 0.2, 'sawtooth');
    if (myMove && !wasMyMove) { tone([660, 880]); if (navigator.vibrate) navigator.vibrate(150); }
    wasMyMove = myMove;
  }
  const mute = btn(muted() ? '🔇' : '🔊', () => { localStorage.setItem('lcs-mute', muted() ? '0' : '1'); render(); }, 'ghost mini');
  mute.setAttribute('aria-label', muted() ? 'Turn sound on' : 'Turn sound off');
  fill(app,
    g.phase === 'over' && fresh && h('div', { className: 'confetti' }, Array.from({ length: 16 }, (_, i) =>
      h('span', { style: `left:${(i * 37) % 100}%;animation-delay:${(i % 5) * 0.15}s` }, ['🎉', '🪙', '💀', '⭐'][i % 4]))),
    h('div', { className: 'bar' }, h('h2', {}, h('span', { className: 'live' }, '● LIVE'), ` Room ${v.code}`),
      h('span', { className: 'tag' }, `👁 ${(2.4 + deaths * 1.7).toFixed(1)}M watching`), mute),
    h('div', { id: 'announcer', className: news ? 'in' : '' }, h('b', {}, 'THE SYSTEM'), g.log[g.log.length - 1]),
    g.players.filter(p => p.id !== me).map(p => h('div', { className: `rival${g.turn === p.id && g.phase !== 'over' ? ' turn' : ''}${p.cards.every(c => c.revealed) ? ' dead' : ''}` },
      h('span', { className: 'name' }, p.name),
      p.cards.map((c, i) => h('span', { className: `pip${c.revealed ? ' gone' : ''}${slam(p, i)}` }, c.revealed ? `${ROLES[c.role].icon} ${ROLES[c.role].name}` : '🂠 hidden')),
      h('span', { className: `gold${pop(p)}` }, `🪙 ${p.coins}`),
      v.host && g.phase !== 'over' && p.cards.some(c => !c.revealed) && kickBtn(p.id, p.name))),
    h('div', { className: `panel${myMove ? ' myturn' : ''}` }, h('div', { id: 'clock', className: 'clock' }), prompt(g, me)),
    h('div', { className: 'bar' }, h('h2', {}, `${my.name} · your cards`), h('span', { className: `gold${pop(my)}` }, `🪙 ${my.coins}`)),
    h('div', { className: 'grid' }, my.cards.map((c, i) => card(c.role, (c.revealed ? 'gone' : '') + slam(my, i),
      c.revealed ? null : g.phase === 'lose' && g.loser === me ? () => send({ type: 'lose', card: i })
        : g.phase === 'show' && g.cur.target === me ? () => send({ type: 'show', card: i }) : null))),
    h('details', {}, h('summary', {}, 'Show log'), g.log.slice().reverse().map(l => h('p', {}, l))),
    h('details', {}, h('summary', {}, 'Rules'),
      h('p', {}, 'Everyone has 2 hidden cards. Lose both and you are dead. Last one alive wins.'),
      h('p', {}, 'You may claim any role, held or not. If someone calls your bluff and you lied, you lose a card. If you told the truth, they do.'),
      rolesFor(g.variant).map(k => ROLES[k]).map(r => h('p', {}, `${r.icon} ${r.name}. ${r.text}`)),
      h('p', {}, 'Anyone: Grind +1, Fan Donations +2, Boss Drop (7 gold, cannot be stopped; forced at 10+ gold).')),
    g.phase === 'over' && btn('Leave room', leave, 'ghost'),
  );
}

function render() {
  if (!session || !v) return session ? fill(app,h('p', { className: 'tag' }, 'Reconnecting…')) : renderJoin();
  v.game ? renderGame() : renderLobby();
  tick();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && session && es && es.readyState === 2) connect(); });
render();
if (session) connect();
