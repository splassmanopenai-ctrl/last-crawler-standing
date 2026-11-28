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

// Player cards: signed copies of every saved player (records, points, achievements, who they know). Every visit swaps
// cards with the server both ways, newest copy winning, so each phone holds the whole group and the Hall of Fame.
// If the server forgets its players, the next phone to visit hands them back.
const CARDS = 'lcs-cards';
function keepCards(list) {
  if (!list) return;
  let all;
  try { all = JSON.parse(localStorage.getItem(CARDS) || '{}'); } catch { all = {}; }
  for (const c of list) {
    const d = JSON.parse(c.d), had = all[d.id];
    if (!had || JSON.parse(had.d).at < d.at) all[d.id] = c;
  }
  try { localStorage.setItem(CARDS, JSON.stringify(all)); } catch { /* storage full: the server still has them */ }
}
const players = () => myCards().map(c => JSON.parse(c.d));
// Swap cards with the server: get everything it has newer, then send what it asked for.
async function sync() {
  const have = Object.fromEntries(players().map(p => [p.id, p.at]));
  const r = await post('sync', { have });
  keepCards(r.cards);
  if (r.want.length) await post('sync', { have, cards: myCards().filter(c => r.want.includes(JSON.parse(c.d).id)) });
}
let syncing = null;
const syncSoon = () => syncing || (syncing = sync().catch(() => {}).finally(() => { syncing = null; }));
// This phone's own saved player, from its card: name, record, points and achievements, shown before the server answers.
function myCard() {
  const c = me && myCards().find(c => JSON.parse(c.d).id === me.id);
  return c ? JSON.parse(c.d) : null;
}
const myCards = () => { try { return Object.values(JSON.parse(localStorage.getItem(CARDS) || '{}')); } catch { return []; } };
const SEAL = 'lcs-seal'; // the server's encrypted copy of the room this phone sits in; only the server can read it
let restoring = false;
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
  let r;
  try { r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error("Can't reach the server. Check your signal and try again."); }
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
    if (next.seal) localStorage.setItem(SEAL, next.seal);
    // Someone joined, or a game just ended: their newer player cards are worth fetching.
    if (!v || String(v.names) !== String(next.names) || (next.game && next.game.phase === 'over' && !(v.game && v.game.phase === 'over'))) syncSoon();
    restoring = false;
    prev = v && v.game; v = next; deadlineAt = v.left == null ? null : Date.now() + v.left; fresh = true; render(); fresh = false;
    if (!alertTried && !tv) { alertTried = true; alertMe(false).catch(() => {}); } // quietly re-arm alerts if allowed before
  };
  // The server says "gone" when the room no longer exists. Plain errors are not trusted for this:
  // a page reload also fires one. Dropped connections retry on their own.
  // Rooms vanish when the server restarts without its disk: first offer it this phone's sealed copy of the room.
  // If that doesn't bring the seat back, leave (and reload, since a restart may bring new code).
  es.addEventListener('gone', () => {
    if (tv) { es.close(); v = null; render(); return; }
    const copy = localStorage.getItem(SEAL);
    if (copy && !restoring) { restoring = true; es.close(); post('restore', { seal: copy }).then(connect, () => { leave(); location.reload(); }); return; }
    leave(); location.reload();
  });
  es.addEventListener('react', e => heckle(JSON.parse(e.data)));
}

// Turn alerts: a push notification when the game waits on you and your screen is off. Needs the service worker,
// and on iPhone the game added to the Home Screen. `ask` shows the browser's permission prompt (needs a tap).
let alertTried = false;
const canAlert = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function alertMe(ask) {
  if (!canAlert() || !v || !v.vapid) return;
  if (ask && await Notification.requestPermission() !== 'granted') return toast('Alerts are blocked. Allow notifications for this site in your settings.');
  if (Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready, key = Uint8Array.from(atob(v.vapid.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  // Subscribed under an older server key (STATS_KEY changed): start over.
  if (sub && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== key.join()) { await sub.unsubscribe(); sub = null; }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await post('pushsub', { ...session, sub: sub.toJSON() });
  if (ask) toast("Alerts on. We'll buzz you when it's your move.");
}
// Tell the server when this screen goes off or comes back, so alerts reach a phone whose connection lingers.
document.addEventListener('visibilitychange', () => {
  if (session && !tv) navigator.sendBeacon('/api/seen', JSON.stringify({ ...session, hidden: document.hidden }));
});

function leave() {
  if (es) es.close();
  localStorage.removeItem(KEY); localStorage.removeItem(SEAL);
  alertTried = false;
  session = v = es = null;
  render();
}

// Saved player: this phone's id and secret, issued by the server on first visit. No password, no sign-up.
const ME = 'lcs-player';
let me = JSON.parse(localStorage.getItem(ME) || 'null'), profile = null, prefilled = false;

async function hello(name) {
  await syncSoon(); // first, so a server that forgot this player gets their card back before we ask who we are
  const r = await post('hello', { player: me, name });
  if (stale(r.build)) return;
  if (r.name) localStorage.setItem('lcs-name', r.name); // the name field is filled in on every visit
  if (!r.known) { me = profile = null; localStorage.removeItem(ME); return; }
  if (r.secret) { me = { id: r.id, secret: r.secret }; localStorage.setItem(ME, JSON.stringify(me)); }
  profile = r;
}

// Home screen only: fetch my saved name and any invites, without re-rendering the form being typed in.
async function refreshHome() {
  if (session || document.hidden) return;
  if (!me) { await syncSoon(); return fillHall(); } // no player yet, but the Hall of Fame still syncs
  try { await hello(); } catch { return; }
  fillHall();
  if (!profile) return;
  // Fill in whichever home page is showing, without redrawing anything someone is typing in.
  const el = id => document.getElementById(id), name = el('name'), box = el('invites');
  if (name && !prefilled && !name.value) name.value = profile.name;
  prefilled = true;
  if (el('profile')) fill(el('profile'), profileBox(profile));
  if (el('mine')) fill(el('mine'), myPage(profile));
  if (box) fill(box, profile.invites.length > 0 && h('div', { className: 'panel' }, h('h2', {}, "You're invited"),
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
