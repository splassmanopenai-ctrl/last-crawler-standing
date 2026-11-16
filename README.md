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
| Fan Donations | +2 gold | — | Showrunner |
| Sponsor Deal | +3 gold | Showrunner | — |
| Yoink | Steal 2 gold | Loot Goblin | Loot Goblin, Changeling |
| Respec | Draw 2, keep the same number you had | Changeling | — |
| Shiv | Pay 3, a rival loses a card | Backstabber | Bouncer |
| Boss Drop | Pay 7, a rival loses a card | — | nothing |

- **Call the bluff:** anyone can challenge a role claim, including a block. If the claimant lied they lose a card. If they told the truth, the challenger loses one and the claimant swaps the proven card for a fresh one.
- With 10 or more gold you must Boss Drop.
- There are 3 copies of each role in the deck.

## Host controls

- **Move timer** (lobby): Off, 30s or 60s. When it runs out, anyone being waited on makes the dullest legal move: pass, Grind, or lose their first card.
- **Card set** (lobby): Classic, or the Paparazzo variant. The Paparazzo replaces the Changeling: Respec swaps only 1 card, and Exposé lets you see one of a rival's cards (they choose which) and decide whether they must redraw it. The Paparazzo also blocks Yoink.
- **Remove a player** (✕ next to their name): in the lobby it frees the seat; mid-game it kills their cards and they sit out the rematch.

Sound and vibration cue your turn; the speaker button in the header mutes it.

## Changing the theme

Every role name, action name and announcer line lives at the top of [public/game.js](public/game.js). Card art is one image per role in `public/art/`, named after the role's key in that file (512×304 JPEG).

## Development

```bash
node --test
```

- `public/game.js` — rules engine, shared by server and browser
- `server.js` — rooms and per-player views (the server never sends you another player's hidden cards)
- `public/app.js`, `public/index.html` — the phone UI

Known limits: games live in memory, so restarting the server ends them. A player who closes their browser for good stalls the game unless a move timer is on or the host removes them; reopening the page on the same phone puts them back in their seat.
