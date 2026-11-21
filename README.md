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

### Letting friends in

- **Same Wi-Fi:** friends open `http://<your-computer's-IP>:3000`.
- **Anywhere:** put a tunnel in front of it, for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and share the address it prints.
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
| Sponsor Deal | +3 gold | Princess Donut | — |
| Yoink | Steal 2 gold | Mongo | Mongo, Zev |
| Respec | Draw 2, keep the same number you had | Zev | — |
| Shiv | Pay 3, a rival loses a card | Carl | Mordecai |
| Boss Drop | Pay 7, a rival loses a card | — | nothing |

- **Call the bluff:** anyone can challenge a role claim, including a block. If the claimant lied they lose a card. If they told the truth, the challenger loses one and the claimant swaps the proven card for a fresh one.
- With 10 or more gold you must Boss Drop.
- There are 3 copies of each role in the deck.

## Host controls

- **Move timer** (lobby): Off, 30s or 60s. When it runs out, anyone being waited on makes the dullest legal move: pass, Grind, or lose their first card.
- **Card set** (lobby): Classic, or the Odette variant. Odette replaces Zev: Respec swaps only 1 card, and Exposé lets you see one of a rival's cards (they choose which) and decide whether they must redraw it. Odette also blocks Yoink.
- **Remove a player** (✕ next to their name): in the lobby it frees the seat; mid-game it kills their cards and they sit out the rematch.

Sound and vibration cue your turn; the speaker button in the header mutes it.

## Saved players and invites

- The first time you enter a name, your phone becomes your player: it keeps a private key and the server remembers you. There is no password or sign-up.
- When a game starts, everyone in it is added to each other's "players you know" list.
- In a lobby, tap **Invite** next to someone you know. They see "You're invited" with a Join button on the home screen the next time they have the game open.
- New phone? Open **Switching phones?** on the home screen and copy your player code across. Clearing the browser's site data without the code means starting as a new player.
- Players are stored in `data/players.json` (`DATA_DIR` changes the folder); in Docker this is the `players` volume. Secrets are stored hashed.

## Changing the theme

Every role name, action name and announcer line lives at the top of [public/game.js](public/game.js). Card art (bump the `?v=` number in `public/app.js` when you replace it, since phones cache images for a day) is one image per role in `public/art/`, named after the role's key in that file (256×512 JPEG, the whole card), plus a `-dead` version shown once the card is lost. The art has no printed text: each card's parchment is blank, and its `blurb` from `game.js` is laid over it at the position listed in `SLOTS` in `public/app.js`.

## Development

```bash
node --test
```

- `public/game.js` — rules engine, shared by server and browser
- `server.js` — rooms and per-player views (the server never sends you another player's hidden cards)
- `public/app.js`, `public/index.html` — the phone UI

Known limits: games live in memory, so restarting the server ends them (saved players are kept). A player who closes their browser for good stalls the game unless a move timer is on or the host removes them; reopening the page on the same phone puts them back in their seat.
