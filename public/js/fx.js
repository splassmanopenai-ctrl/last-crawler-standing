// Sound and animation. Nothing here changes the game; it only shows what just happened.
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

// An Exposé: everyone sees that a card was inspected and what was decided, but never the card itself.
function exposeShow(g, e) {
  const { animate } = window.anime, by = g.players[e.by].name, who = g.players[e.target].name;
  const el = overlay('showdown', h('p', { className: 'burst' }, 'Exposé!'),
    h('p', { className: 'who' }, `${by} got a good look at one of ${who}'s cards`),
    h('img', { className: 'solo', src: CARD_BACK, alt: '' }),
    h('p', { className: 'verdict' }, e.swap ? `${who} has to redraw it` : `${who} keeps it`));
  animate(el, { opacity: { from: 0 }, duration: 200 });
  animate(el.querySelector('.burst'), { scale: { from: 3 }, rotate: { from: 18 }, duration: 450, ease: 'outBack' });
  animate(el.querySelector('.solo'), { rotate: { from: -20 }, scale: { from: .4 }, duration: 600, delay: 300, ease: 'outBack' });
  if (e.swap) animate(el.querySelector('.solo'), { x: { from: 120 }, duration: 500, delay: 1300, ease: 'outQuad' });
  animate(el.querySelector('.verdict'), { scale: { from: 0 }, duration: 400, delay: 1100, ease: 'outBack' });
  later(2700, () => animate(el, { opacity: 0, duration: 350, onComplete: () => el.remove() }));
  return 3000;
}

// The start of every game, on every phone at once.
function startShow() {
  const { animate, stagger } = window.anime;
  const el = overlay('showdown', h('p', { className: 'verdict' }, 'Now get out there and'),
    h('p', { className: 'burst' }, 'Kill,'), h('p', { className: 'burst' }, 'kill,'), h('p', { className: 'burst' }, 'kill!'));
  animate(el, { opacity: { from: 0 }, duration: 200 });
  animate(el.querySelector('.verdict'), { y: { from: 20 }, opacity: { from: 0 }, duration: 300, ease: 'outQuad' });
  animate(el.querySelectorAll('.burst'), { scale: { from: 3 }, rotate: { from: -20 }, opacity: { from: 0 }, duration: 380, delay: stagger(260, { start: 350 }), ease: 'outBack' });
  later(1700, () => animate(el, { opacity: 0, duration: 300, onComplete: () => el.remove() }));
}

// The winner's moment, on every phone at once.
function winShow(g, delay) {
  const { animate } = window.anime;
  const el = overlay('showdown win', h('p', { className: 'burst' }, g.players[g.winner].name),
    h('p', { className: 'verdict' }, 'Last Crawler Standing'));
  el.style.opacity = 0;
  later(delay, () => {
    el.style.opacity = '';
    animate(el, { opacity: { from: 0 }, duration: 250 });
    animate(el.querySelector('.burst'), { scale: { from: 0 }, rotate: { from: -30 }, duration: 600, ease: 'outBack' });
    animate(el.querySelector('.verdict'), { y: { from: 30 }, opacity: { from: 0 }, duration: 400, delay: 350, ease: 'outQuad' });
  });
  later(delay + 2800, () => animate(el, { opacity: 0, duration: 400, onComplete: () => el.remove() }));
}

// Where a player sits on this screen (their purse), or the bank (the announcer box) for null.
function spotOf(id) {
  const r = (id == null ? document.getElementById('announcer') : document.querySelector(`[data-pid="${id}"] .coin`))?.getBoundingClientRect();
  return r && { x: r.left + r.width / 2, y: id == null ? r.top + 8 : r.top + r.height / 2 };
}
const placed = (cls, at, ...kids) => { const el = overlay(cls, ...kids); el.style.left = `${at.x}px`; el.style.top = `${at.y}px`; return el; };
const shake = (strength, delay) => window.anime.animate(app, { x: { from: strength }, duration: 600, delay, ease: 'outElastic(1, .3)' });

// Each character's signature move, played with its comic stamp.
function signature(e, delay) {
  const { animate } = window.anime, from = spotOf(e.actor), to = spotOf(e.target);
  const flash = (color, d) => { const f = overlay('flash'); f.style.background = color;
    animate(f, { opacity: { from: .85, to: 0 }, duration: 450, delay: d, onComplete: () => f.remove() }); };
  if (e.action === 'assassinate' && from && to) { // Carl's Special Delivery: a grenade lobbed at the target
    const n = placed('grenade', from);
    animate(n, { x: to.x - from.x, rotate: 540, duration: 700, delay, ease: 'linear' });
    animate(n, { y: to.y - from.y, duration: 700, delay, ease: 'inQuad', onComplete: () => { n.remove(); flash('radial-gradient(circle, #fff6c2, #f28c28 45%, transparent 75%)', 0); shake(-14, 0); } });
  } else if (e.action === 'coup') { // Boss Fight: the whole screen takes it
    flash('rgba(216,38,44,.75)', delay); shake(-22, delay);
  } else if (e.action === 'steal' && to) { // Mongo's Chomp: jaws snap shut on the victim's purse
    const j = placed('jaws', to, h('i', { className: 'top' }), h('i', { className: 'bottom' }));
    animate(j.querySelector('.top'), { y: { from: -34 }, duration: 260, delay, ease: 'inQuad' });
    animate(j.querySelector('.bottom'), { y: { from: 34 }, duration: 260, delay, ease: 'inQuad' });
    later(delay + 700, () => animate(j, { opacity: 0, duration: 250, onComplete: () => j.remove() }));
  } else if (e.action === 'tax' && from) { // Princess Donut's Royal Tribute: a crown lands on her claimant
    const c = placed('crown', from);
    animate(c, { y: { from: -260 }, duration: 750, delay, ease: 'outBounce' });
    later(delay + 1300, () => animate(c, { opacity: 0, duration: 300, onComplete: () => c.remove() }));
  } else if (e.action === 'exchange' && from) { // Zev's Spin Control / Odette's Retcon: cards swirl in a bubble
    const b = placed('bubble', from, h('img', { src: CARD_BACK, alt: '' }), h('img', { src: CARD_BACK, alt: '' }));
    animate(b, { scale: { from: 0 }, duration: 350, delay, ease: 'outBack' });
    animate(b.querySelectorAll('img'), { rotate: 720, duration: 1100, delay, ease: 'inOutQuad' });
    later(delay + 1200, () => animate(b, { scale: 0, duration: 250, onComplete: () => b.remove() }));
  } else if (e.action === 'examine') { // Odette's Exposé: a camera flash
    flash('#fff', delay);
  } else if (e.block === 'bouncer' && from) { // Mordecai's Antidote: a potion shield
    const s = placed('shield', from);
    animate(s, { scale: { from: 0 }, opacity: { from: 0 }, duration: 450, delay, ease: 'outBack' });
    later(delay + 1000, () => animate(s, { opacity: 0, scale: 1.4, duration: 300, onComplete: () => s.remove() }));
  }
}

// A heckle from a knocked-out crawler floats up every screen.
function heckle({ name, text }) {
  const el = overlay('heckle', h('b', {}, text), ` ${name}`);
  el.style.left = `${15 + Math.random() * 60}%`;
  if (!moving()) return later(1800, () => el.remove());
  window.anime.animate(el, { y: { from: 0, to: -260 }, duration: 1800, ease: 'outQuad', onComplete: () => el.remove() });
  later(1300, () => window.anime.animate(el, { opacity: 0, duration: 400 }));
}

// End-of-game highlight reel: the game's bluffs called, Exposés and eliminations, replayed in order, then the winner.
function playReel(g) {
  let t = 0;
  for (const e of g.reel.slice(-8)) {
    if (e.type === 'challenge') later(t, () => showdown(g, e));
    else if (e.type === 'expose') later(t, () => exposeShow(g, e));
    else later(t, () => outShow(g, e));
    t += e.type === 'out' ? 1800 : 3100;
  }
  winShow(g, t);
}

function outShow(g, e) {
  const { animate } = window.anime;
  const el = overlay('showdown', h('p', { className: 'burst' }, 'Cancelled'), h('p', { className: 'who' }, `${g.players[e.id].name} is out of the show`));
  animate(el, { opacity: { from: 0 }, duration: 200 });
  animate(el.querySelector('.burst'), { scale: { from: 3 }, rotate: { from: -12 }, duration: 450, ease: 'outBack' });
  later(1500, () => animate(el, { opacity: 0, duration: 250, onComplete: () => el.remove() }));
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
  const a = spotOf(e.from), b = spotOf(e.to);
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
  for (const e of ev) if (e.type === 'expose') wait = exposeShow(g, e);
  for (const e of ev) {
    if (e.type === 'sfx') { sfx(e.text, wait); signature(e, wait); }
    if (e.type === 'gold') coins(e, wait + 150);
    const stamp = e.type === 'out' && document.getElementById(`out-${e.id}`);
    if (stamp) animate(stamp, { scale: { from: 3 }, opacity: { from: 0 }, duration: 500, delay: wait, ease: 'outBack' });
  }
  // New game: The System sends everyone in, then your two cards are dealt onto the table.
  if (deal) startShow();
  if (deal) animate($('#app > .grid .card'), { y: { from: -90 }, rotate: { from: -10 }, scale: { from: .6 }, opacity: { from: 0 },
    duration: 650, delay: stagger(150, { start: 1900 }), ease: 'outBack' });
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
  if (win) winShow(g, wait);
  if (win) for (const s of $('.confetti span')) animate(s, { y: innerHeight + 80, x: rnd(-90, 90), rotate: rnd(-720, 720),
    duration: rnd(1800, 2900), delay: rnd(0, 600), ease: 'inQuad' });
}

// New Achievement! The System's notice, one at a time; tap to see the next. Stays until dismissed, so nobody misses it.
function achieveShow(keys) {
  const k = keys[0];
  if (!k) return;
  const a = ACHIEVEMENTS[k], box = BOXES[a.box];
  const ok = btn(keys.length > 1 ? 'Next' : 'Keep crawling', () => { el.remove(); achieveShow(keys.slice(1)); }, 'hot');
  const el = h('div', { className: 'achieve' }, h('div', { className: `notice box-${a.box}` },
    h('p', { className: 'burst' }, 'New Achievement!'), h('h2', {}, a.title), h('p', {}, a.text),
    h('p', { className: 'reward' }, h('b', {}, `Reward: you've received a ${box.name}!`), ` Inside: ${a.reward} Plus ${box.points} points.`), ok));
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `New achievement: ${a.title}`);
  document.body.append(el);
  ok.focus();
  tone([392, 523, 659, 1047], 0.12);
  if (moving()) {
    window.anime.animate(el.querySelector('.notice'), { scale: { from: .3 }, rotate: { from: -8 }, opacity: { from: 0 }, duration: 550, ease: 'outBack' });
    window.anime.animate(el.querySelector('.burst'), { scale: { from: 2.4 }, duration: 500, delay: 200, ease: 'outBack' });
  }
}
