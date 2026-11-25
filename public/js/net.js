// Talking to the server: this phone's seat and saved player, live updates, joining a room.
let session = JSON.parse(localStorage.getItem(KEY) || 'null');
// A seat link from the host (?room=…&seat=…) moves that seat onto this phone.
{
  const q = new URLSearchParams(location.search);
  if (q.get('room') && q.get('seat')) {
    session = { code: q.get('room').toUpperCase(), token: q.get('seat') };
    localStorage.setItem(KEY, JSON.stringify(session));
    history.replaceState(null, '', location.pathname); // the seat link is a secret; don't leave it in the address bar
  }
}
let handoff = null; // host tools: the seat link being shown
// TV view (?tv=CODE): a shared screen that watches a room from no seat.
const tv = (new URLSearchParams(location.search).get('tv') || '').toUpperCase() || null;

// Player cards: signed copies of the saved players this phone has played with (and its own). If the server forgets
// its players, every phone hands these back on its next visit and the records come back. Newest copy wins.
const CARDS = 'lcs-cards';
function keepCards(list) {
  if (!list) return;
  let all;
  try { all = JSON.parse(localStorage.getItem(CARDS) || '{}'); } catch { all = {}; }
  for (const c of list) {
    const d = JSON.parse(c.d), had = all[d.id];
    if (!had || JSON.parse(had.d).at < d.at) all[d.id] = c;
  }
  // shortcut: keep the 100 most recently updated, plenty for a friends group
  const top = Object.entries(all).sort((a, b) => JSON.parse(b[1].d).at - JSON.parse(a[1].d).at).slice(0, 100);
  try { localStorage.setItem(CARDS, JSON.stringify(Object.fromEntries(top))); } catch { /* storage full: the server still has them */ }
}
const myCards = () => { try { return Object.values(JSON.parse(localStorage.getItem(CARDS) || '{}')); } catch { return []; } };
let build = null; // the server version this page was loaded from
// The server restarted with newer code than this page: reload to pick it up. Sessions are in localStorage, so it's seamless.
function stale(b) {
  if (build && b && b !== build) { location.reload(); return true; }
  build = b || build;
  return false;
}
let prev = null, fresh = false; // previous game view, and whether this render follows a server update
let headlines = []; // every announcer line the latest update added, so chained events are all shown
let v = null, es = null, picking = null, choosing = null, keep = [], toastTimer;

function tick() {
  const el = document.getElementById('clock');
  if (!el) return;
  const s = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)) : null;
  el.textContent = s == null ? '' : `${s}s left`;
  el.classList.toggle('late', s != null && s <= 5);
}
setInterval(tick, 500);

async function post(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = move => { picking = choosing = null; post('move', { ...session, move }).catch(e => toast(e.message)); };

function connect() {
  if (es) es.close();
  es = new EventSource(tv ? `/api/events?code=${tv}&tv=1` : `/api/events?code=${session.code}&token=${session.token}`);
  es.onmessage = e => {
    const next = JSON.parse(e.data);
    if (stale(next.build)) return;
    keepCards(next.cards);
    prev = v && v.game; v = next; deadlineAt = v.left == null ? null : Date.now() + v.left; fresh = true; render(); fresh = false; };
  // The server says "gone" when the room no longer exists. Plain errors are not trusted for this:
  // a page reload also fires one. Dropped connections retry on their own.
  // Rooms only vanish when the server restarts, which may bring new code, so reload rather than just leave.
  es.addEventListener('gone', () => { if (tv) { es.close(); v = null; render(); return; } leave(); location.reload(); });
  es.addEventListener('react', e => heckle(JSON.parse(e.data)));
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
  const r = await post('hello', { player: me, name, cards: myCards() });
  if (stale(r.build)) return;
  keepCards(r.card && [r.card]);
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
  fill(box, r && r.games > 0 && h('p', { className: 'tag' }, `Welcome back, ${profile.name}. ${plural(r.wins, 'win')} in ${plural(r.games, 'game')}. ${plural(profile.points, 'point')} banked.`),
    trophyCase(profile.ach || {}),
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

async function join(code, practice = false) {
  try {
    const name = document.getElementById('name').value, passcode = document.getElementById('pass').value;
    if (!name.trim()) return toast('Enter a name');
    await hello(name); // creates this phone's saved player on first visit, or renames it
    session = await post('join', { name, code, passcode, player: me, practice });
    localStorage.setItem(KEY, JSON.stringify(session));
    connect();
  } catch (e) { toast(e.message); }
}
