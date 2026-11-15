# Last Crawler Standing — design

**Intent:** a phone-browser bluffing card game for 2–6 invited friends, in a public GitHub repo, self-hosted.

**Goals:** play a whole game on phones with a room code; hidden cards stay hidden; survive a phone locking mid-game.
**Non-goals:** accounts, matchmaking, chat, bots, persistence across server restarts, kicking players.
**Anti-goal:** copying another work's characters, names or art. Theme is an original televised death-dungeon.

## Approaches
1. Phone-to-phone (WebRTC) from GitHub Pages — no server, but the host phone knows every card and strict networks block it.
2. **Small self-hosted Node relay (picked)** — server is the authority, zero npm dependencies, Server-Sent Events down and POST up. Chosen by the user: host locally, invite specific players.
3. Hosted realtime service — needs accounts and keys; unnecessary.

## Rules
Coup-style: 2 hidden cards and 2 gold each, 5 roles x 3 copies. Any role claim can be challenged; loser of a challenge loses a card; a proven card is swapped for a fresh one. 10+ gold forces a Boss Drop.

| Role | Action | Blocks |
|---|---|---|
| Showrunner | Sponsor Deal: +3 gold | Fan Donations |
| Backstabber | Shiv: pay 3, target loses a card | — |
| Loot Goblin | Yoink: steal 2 | Yoink |
| Changeling | Respec: draw 2, keep your count | Yoink |
| Bouncer | — | Shiv |

Anyone: Grind (+1), Fan Donations (+2), Boss Drop (pay 7, target loses a card, unstoppable).

## Parts
- `public/game.js` — pure rules engine plus all theme text; used by server and browser.
- `server.js` — rooms, invite codes, optional `PASSCODE` to create rooms, per-player views.
- `public/index.html`, `public/app.js` — phone UI.
- `test/game.test.js` — rule scenarios and a random-play fuzz.

## Builder's calls
- One reaction window (challenge or block or pass) instead of two sequential ones; blocks reopen after a failed challenge.
- A challenged player who holds the card reveals it automatically.
