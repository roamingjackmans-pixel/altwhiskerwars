# 🐱 Whisker Wars

Real-time cat-kingdom strategy for the browser. Drag to send your army of adorable cats, capture cottages,
cast silly spells and battle your friends online with a 5-number room code.

**Play:** https://josephjackman.com/whiskerwars/

## Play locally

```bash
npm install
npm start
```

Open http://localhost:8080. To test online play by yourself, open a second browser window
(or an incognito window), create a room in one and join it from the other.

## What's inside

| Feature | Details |
| --- | --- |
| Online, 2-4 players | 5-number room codes + invite links (`?room=CODE`), lobby for 2, 3 or 4 players with hero/map/time pick (only maps for that many players), ready check, emotes, rematch, ping display, 20-second reconnect if someone's connection drops (with 3-4 players, someone who doesn't come back is knocked out and the battle carries on) |
| Friends | Every player has an 8-number friend code. Add friends by code, or with one tap on the player you just battled in the lobby. Friends with the game open show as online. The lobby lists them at the top (with people you played recently): tap **Invite** and they get a popup that drops them straight into your room |
| Fun modifiers | Zoomies (fast cats), Catnip Frenzy, Kitten Boom, Big Start — toggle in the lobby or practice setup |
| 12 heroes | 4 clans, each hero has a passive + 3 spells (36 spells), unlocked with fish coins earned by playing |
| 5 building types | Kitten Cottage (5 levels), Scratch Tower, Yarn Forge, Catnip Garden, Grand Cat Tree. Upgrade or convert any time |
| Maps | 35 maps. 2 players: 6 open fields and 13 with terrain (ponds, rivers, islands joined by bridges, hedges, walls, snow ridges, dirt mounds) that make cats walk the long way round. 3 players: 3 compact maps that repeat three ways around the middle, and 5 that fill the whole field without being symmetric (each seat has a different spot, kept fair by equal road lengths and tuned strays). 4 players: 8 maps mirrored into every corner. Open and terrain maps for each player count. Random maps (2 players) get lumps and ponds too. Each player's view is turned so their own base is at the bottom / left |
| Core mechanics | Drag-to-send (the arrow shows the road your cats will take), swipe across buildings for multi-send, 25/50/75/100% send, field battles between squads, towers, Purr Power stars (momentum), catnip spell energy. A building taken from the other player drops one upgrade level. Nobody can see how many cats are inside another player's buildings (they show **?**, strays stay visible; the AI only guesses too): every hero has the 🦉 Owl Scout (15 catnip, hotkey 4) to see them for 10 s. Unowned towers shoot at everyone's cats until someone takes them. Unowned buildings grow back to their starting cats a few seconds after a failed attack (bigger ones faster: a full refill takes about 24 s); your own towers grow back lost cats at the kitten rate; towers, forges and gardens never shrink on their own |
| Solo | 12-level campaign with 3-star ratings, practice against 1-3 computer cats at 4 difficulties, live AI battle on the menu background |
| Progression | Coins, XP & levels, daily gift, first-win bonus, 13 achievements, 15 furs + 12 hats (your whole army wears them), match history |
| Polish | Procedural art, synthesized music & SFX, spell VFX, screen shake, keyboard shortcuts |
| Phones | Own layout, on by default on phones: the field stands up in portrait (your base at the bottom), zooms onto the buildings, big tap zones, thumb dock (send %, 🐾 ALL, spells), compact upgrade bar, hold-to-read spells, vibration, full screen on Android, screen stays awake, back button opens the battle menu. Settings → Battle layout overrides it. Settings → 📲 Download app installs it on the home screen or desktop (the browser's install prompt in Chrome, Edge and Android; step-by-step help on iPhone, iPad, Safari and Firefox) |

## How online play works

The person who creates the room is the **host**: their browser runs the game simulation and streams
it to the guest 10×/second. Moves travel through one of two connections, chosen automatically:

1. **Game server mode** (most reliable): when the site is served by `server/index.js`, players connect
   through its WebSocket relay at `/ws`.
2. **Peer-to-peer mode** (zero setup): when the files sit on a plain static host, browsers connect
   directly using WebRTC. Matchmaking uses the free public PeerJS service, with its TURN relay as fallback.

Joining tries the server first, then peer-to-peer, so both kinds of rooms work from the same page.

A room holds up to 4 players: the host runs the battle and streams it to up to 3 guests.

Friends (online status and invites) always go peer-to-peer: once a player has opened Battle a Friend (or has friends)
they keep a small PeerJS "presence" peer open while the game is open, and an invite is a short message carrying the room code.

## Deploying

### Option A — any static website (easiest)
Upload the contents of `public/` to any web host (GitHub Pages, Netlify, Cloudflare Pages, your own site,
or a sub-folder of one). It runs in peer-to-peer mode. Done.

This repo already does this: `.github/workflows/pages.yml` publishes `public/` to GitHub Pages on every
push to `main`. The site appears under the account's custom domain at `/whiskerwars/` because the repo
is named `whiskerwars`.
Each deploy stamps the version shown on the home screen, e.g. `v1.3.42 · 1a2b3c4`: major.minor come from
`package.json`, the last number counts commits, and the 7 characters are the commit.

### Option B — Node server (most reliable online play)
Deploy this whole folder to any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS):

- Build command: `npm install`
- Start command: `npm start`
- Port: taken from the `PORT` environment variable (default 8080)

A `render.yaml` is included for one-click Render deploys.

### Option C — files on your website, server elsewhere
Put `public/` on your website and run the server on a Node host, then edit `public/config.js`:

```js
window.WW_CONFIG = { server: 'wss://your-server.onrender.com/ws', peerPrefix: 'whiskerwars-v1-' };
```

## Tools

```bash
node tools/simtest.mjs 40     # AI-vs-AI crash test on all maps
node tools/maptest.mjs        # every map: clear ground under buildings, every road walkable, fair to both sides
node tools/maptest.mjs ridge  # ...and draws the named map(s) as text
node tools/balance.mjs        # round-robin hero win rates (both sides Hard AI)
node tools/probe.mjs duchess  # one hero vs everyone (add a spell id or "passive" to disable it)
node tools/relaytest.mjs      # tests the WebSocket relay with a host and 3 guests (server must be running)
node tools/rejointest.mjs     # tests reconnecting into a room (server must be running)
node tools/lobbytest.mjs      # tests the 2-4 player lobby/match message protocol in memory
node tools/seats.mjs          # 3-4 player maps: road length between bases, strays each seat reaches first, how close seats touch
node tools/seatsim.mjs tripass 900  # does a map favour a seat? same hero and AI on every seat, many games
```

Add `?p2p` to the page URL to force peer-to-peer mode even when the server is available.
`public/dev/art-test.html` and `public/dev/audio-test.html` are preview pages for the art and sound,
and `public/dev/maps.html` shows every map's real background (also stood up the way phones see it).

## Project layout

```
public/            the game (deploy this folder for static hosting)
  index.html, config.js, css/style.css
  shared/          data.js (heroes, spells, buildings, maps), game.js (simulation), ai.js, nav.js (terrain + roads)
  js/              main, ui (menus), match (game loop/input), render, hud, art, audio, net, online, profile
  vendor/          peerjs.min.js
server/index.js    static file server + WebSocket room relay
tools/             headless tests
```

Progress (coins, unlocks, stats) is saved in each player's browser (localStorage).
