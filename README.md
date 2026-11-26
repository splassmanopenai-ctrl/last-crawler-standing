# Last Crawler Standing

A bluffing card game for 2–6 players, played on phone browsers. You are contestants on a televised death-dungeon show. Lie about who you are, loot your rivals, and be the last one alive.

No accounts, no app install, no npm dependencies. One person runs the server; everyone else opens a link.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
node server.js
```

Then open `http://localhost:3000`, tap **Host a new game**, and share the invite link or 5-letter room code.

### Or with Docker

```bash
docker compose up -d --build
```

Stop it with `docker compose down`. To require a host passcode, start it with `PASSCODE=something-secret docker compose up -d --build`.

### Or on Render

Create a Web Service from this repo; Render builds the `Dockerfile` and sets `PORT` itself. Saved players and games in progress live in a data folder, and a Render service's own disk is wiped on every deploy and restart, so:

- attach a **persistent disk** (a paid feature) mounted at `/app/data`, or set `DATA_DIR` to wherever you mount it; without one, players, records and games reset on each deploy;
- or, on the free plan, set `STATS_KEY` to any long random string: phones keep signed copies of everyone's player card, so players, records and points come back as people visit (games in progress are still lost);
- set `PASSCODE` in the service's environment, since the address is public;
- free instances sleep when idle, so the first visit after a quiet spell takes a little while to load.

### Letting friends in

- **Same Wi-Fi:** friends open `http://<your-computer's-IP>:3000`.
- **Anywhere:** start the optional Cloudflare tunnel alongside the game. It needs no account and prints a random public `https://…trycloudflare.com` address that changes each time it starts:

  ```bash
  PASSCODE=something-secret docker compose --profile public up -d
  docker compose logs tunnel | grep trycloudflare
  ```

  Stop it with `docker compose --profile public down`. Without Docker, `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000` do the same.
- **Invite only:** only people with the room code can join, and a room closes to newcomers once the game starts. To stop strangers creating rooms on your server, set a host passcode:

```bash
PASSCODE=something-secret node server.js
```

`PORT` changes the port.

## Rules

Everyone starts with 2 hidden cards and 2 gold. Lose both cards and you are dead.

On your turn pick one action. You may claim **any** role, whether you hold it or not.

| Action | Effect | Needs | Blocked by |
|---|---|---|---|
| Grind | +1 gold | — | — |
| Fan Donations | +2 gold | — | Princess Donut |
| Royal Tribute | +3 gold | Princess Donut | — |
| Chomp | Steal 2 gold | Mongo | Mongo, Zev |
| Spin Control | Draw 2, keep the same number you had | Zev | — |
| Special Delivery | Pay 3, a rival loses a card | Carl | Mordecai |
| Boss Fight | Pay 7, a rival loses a card | — | nothing |

- **Call the bluff:** anyone can challenge a role claim, including a block. If the claimant lied they lose a card. If they told the truth, the challenger loses one and the claimant swaps the proven card for a fresh one.
- With 10 or more gold you must Boss Fight.
- There are 3 copies of each role in the deck.

## Host controls

- **Move timer** (lobby): Off, 30s or 60s. When it runs out, anyone being waited on makes the dullest legal move: pass, Grind, or lose their first card.
- **Card set** (lobby): Classic, or the Odette variant. Odette replaces Zev: Retcon swaps only 1 card, and Exposé lets you see one of a rival's cards (they choose which) and decide whether they must redraw it. Odette also blocks Chomp.
- **Remove a player** (✕ next to their name): in the lobby it frees the seat; mid-game it kills their cards and they sit out the rematch.

Sound and vibration cue your turn; the speaker button in the header mutes it.

## On screen

- **Bluff showdown:** when someone calls a bluff, the doubted card turns over in front of everyone: real, or stamped *Liar*.
- **Comic sound effects** for each action, **coins that fly** between purses, cards that **flip** to their defeated side, and a **Cancelled** stamp on knocked-out crawlers. All of this uses anime.js and is skipped for players who turn on "reduce motion".
- **Spectating:** once you are out, every card is face up for you. At the end of a game everyone sees all the cards.
- **Awards:** The System hands out titles at the end of each game (biggest liar, never caught, best bluff caller, most robbed, first to die). Titles live in `AWARDS` in `public/game.js`.
- **Add to Home Screen** opens the game full screen with its own icon. On iPhone the home-screen app keeps separate storage from Safari, so copy your player code across (see below) to stay the same player.

- **How to play:** on the home screen, in the lobby and in the game, built from the rules in `game.js` so it always matches the card set.
- **TV view:** open `/?tv=ROOMCODE` on a TV or laptop (the lobby's **Show it on a TV** has the link). It shows the table, the announcer and the big moments, never hidden cards, and the lobby's QR code for joining.

## Keeping games running

- **Restarts:** rooms and games in progress are saved to `data/rooms.json` (the `players` volume in Docker), so restarting or rebuilding the server doesn't end a game. Phones reconnect and reload onto the new code by themselves.
- **Someone wandered off:** if a player's phone has been disconnected for 2 minutes and the game is waiting on them, everyone else sees **Skip their move**, which makes the dullest legal move for them. Works with the move timer off.
- **A dead phone:** the host opens **Host tools: move a player to a new phone** on the game screen and makes a seat link (with a QR code) for that player. Opening it on another phone moves the seat there and signs the old phone out. Saved players can also just rejoin the room with the same room code from a phone holding their player code.
- **Public links:** each device is limited to 120 requests a minute and 12 new rooms every 10 minutes, and the server holds at most 300 rooms, so a stranger with your tunnel link can't clog it. Set `PASSCODE` as well.

## Saved players and invites

- The first time you enter a name, your phone becomes your player: it keeps a private key and the server remembers you. There is no password or sign-up.
- When a game starts, everyone in it is added to each other's "players you know" list.
- Each saved player keeps a record (games, wins, bluffs called, lies told) and **points**, banked for badges and perks later: 1 per game, 3 more for a win, 1 per bluff called correctly. Practice games don't count.
- **Home screen:** your phone remembers your name and shows your profile card (record, points, **My achievements** with dates and rewards) straight away from its own player card, before the server even answers. Below it: **Play**, then the **Hall of Fame** (top 20 by wins); tap a crawler there to see the achievements they've earned.
- **Achievements:** 125 of them, from The System, earned once each from a finished game (win without losing a card, three uncaught lies, first one out, died calling a bluff…) or a career (win streaks, losing streaks, 100 lies, 25 gold stolen, 20 opponents…). Each pops up as **New Achievement!** with its reward and pays a box: Bronze 2 points, Silver 5, Gold 10, Legendary 25. Each saved player's record keeps career totals of every game stat for these. The room's log announces it, and **My achievements** on the home screen lists yours with dates. Titles, jokes and rules live in `ACHIEVEMENTS` in `public/game.js`.
- **Player cards:** each player's saved state (name, record, points, who they know) carries a timestamp and is signed by the server. Phones keep a copy of their own card and of everyone they play with, handed out in the lobby and after each game, along with the cards of everyone those players know (up to 40), so each phone backs up the wider group. If the server forgets its players, phones hand the cards back on their next visit and the newest copy wins. Edited cards fail the signature and are ignored. The signing key is `STATS_KEY`, or `stats.key` in the data folder; servers sharing a key share players. Your record shows on the home screen and in the lobby, and the players you know are listed by wins.
- In a lobby, tap **Invite** next to someone you know. They see "You're invited" with a Join button on the home screen the next time they have the game open.
- New phone? Open **Switching phones?** on the home screen and copy your player code across. Clearing the browser's site data without the code means starting as a new player.
- Players are stored in `data/players.json` (`DATA_DIR` changes the folder); in Docker this is the `players` volume. Secrets are stored hashed.

## Changing the theme

Every role name, action name and announcer line lives at the top of [public/game.js](public/game.js). Card art (bump `ART_V` in `public/js/ui.js` when you replace it, since phones cache images for a day) is one image per role in `public/art/`, named after the role's key in that file (400×536 JPEG, the whole card), plus a `-dead` version shown once the card is lost. The art has no printed text: each card's parchment is blank, and its `blurb` from `game.js` is laid over it at the position listed in `SLOTS` in `public/js/ui.js`.

## Development

```bash
node --test
```

- `public/game.js` — rules engine, shared by server and browser
- `server.js` — rooms and per-player views (the server never sends you another player's hidden cards)
- `public/index.html` and `public/js/` — the phone UI: `ui.js` (building blocks), `net.js` (server and session), `screens.js` (join, lobby, game), `fx.js` (sound and animation), `app.js` (start-up). They are plain scripts loaded in that order, sharing their top-level names.
- `public/vendor/qrcode.js` — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 (MIT, licence in the file header), for the lobby's invite QR code
- `public/vendor/anime.umd.min.js` — [anime.js](https://animejs.com) 4.5.0 (MIT, see `anime-LICENSE.md`), used for the event animations; served locally so LAN games need no internet

Known limits: rate limits are per device address and reset when the server restarts. A player card is replaced whole by a newer copy, so two servers updating the same player at the same time keep only the later change.
