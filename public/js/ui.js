// Building blocks shared by every screen: elements, buttons, toasts, cards, coins, QR codes.
// The scripts in public/js load in order (ui, net, fx, screens, app) and share their top-level names.
const { ROLES, REACTIONS, actionsFor, rolesFor, awards } = window.Game;
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

function toast(msg) {
  toastEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 3000);
}

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

// Invite QR code, so friends at the table can scan instead of typing. Skipped if the library is missing.
function qrFor(link) {
  if (!window.qrcode) return null;
  const q = window.qrcode(0, 'M');
  q.addData(link); q.make();
  const img = h('img', { className: 'qr', src: q.createDataURL(6, 2), alt: `QR code for ${link}` });
  // A localhost link only works on this computer: tell the host to open the game at its network address instead.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return [img, local && h('p', { className: 'tag' }, "This code points at this computer only. Open the game at your computer's network address so other phones can scan it.")];
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
