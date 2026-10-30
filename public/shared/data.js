// Whisker Wars - shared game data (used by browser and Node server)

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const TICK = 0.05;            // simulation step, seconds (20 Hz)
export const SNAP_EVERY = 2;         // send a network snapshot every N ticks (10 Hz)
export const BASE_SPEED = 72;        // world units per second
export const MAX_CATNIP = 100;
export const BASE_CATNIP_REGEN = 0.805; // per second (30% slower than Whisker Wars: Catnip Gardens matter more)
export const START_CATNIP = 0;      // everyone starts with an empty catnip bar
export const TIME_LIMIT = 600;       // seconds; then most cats wins
export const OVERCAP_DECAY = 1.0;    // cats per second lost when above capacity
export const SQUAD_CHUNK = 24;       // big sends split into waves of this size

// ---------------- Purr Power (army morale) ----------------
// Purr points earn 0-5 stars. Every star makes the WHOLE army much tougher: +25% defense, +5% attack, +10% speed,
// so at 4 stars one defending cat is worth two attacking cats from a 0-star army. Never attack into higher purr:
// defend, upgrade and wait for theirs to cool off (it drains fast at high stars once you stop doing things).
export const PURR = {
  stars: [0, 500, 1000, 2000, 4000, 8000],   // purr points needed for 0..5 stars
  max: 10000, start: 0,
  def: 0.25, atk: 0.05, spd: 0.10,           // per star
  killDefending: 10,     // each enemy attacker knocked out while you defend
  lostAttacking: -10,    // each of your cats knocked out while attacking a rival (on the road too)
  // capturing a rival's / a stray building, by building type and level
  capEnemy: { cottage: [100, 250, 400, 550, 750], tower: [200, 500, 800], forge: [300, 300, 300], garden: [300, 300, 300], cattree: [750] },
  capStray: { cottage: [40, 100, 160, 220, 300], tower: [80, 200, 320], forge: [200, 200, 200], garden: [200, 200, 200], cattree: [300] },
  lose: { cottage: [-50, -120, -200, -280, -380], tower: [-100, -250, -400], forge: [-100, -100, -100], garden: [-100, -100, -100], cattree: [-380] },
  upgrade: { cottage: [50, 100, 150, 200], tower: [100, 200], forge: [100, 100], garden: [100, 100] },   // upgrading FROM level 1, 2...
  idleAfter: [10, 9, 8, 7, 6, 5],            // seconds without doing anything before purr drains, by stars
  idleDrain: [10, 20, 25, 50, 100, 200],     // purr points per second while idle, by stars
  // comeback: each of your cats knocked out attacking a rival refills catnip, more when your purr is low
  catnipPerLoss: 0.09, catnipK: [5, 4, 3, 2, 1, 1],
};
export function purrLevel(v) { let n = 0; for (let k = 1; k <= 5; k++) if (v >= PURR.stars[k]) n = k; return n; }
/** 0..1: how far along toward the next star */
export function purrFill(v) { const n = purrLevel(v); if (n >= 5) return 1; return Math.max(0, Math.min(1, (v - PURR.stars[n]) / (PURR.stars[n + 1] - PURR.stars[n]))); }

export const TEAM_COLORS = [
  { id: 0, name: 'Blue',  main: '#3d9bff', dark: '#1d5fb8', light: '#b5dcff', glow: 'rgba(61,155,255,0.55)' },
  { id: 1, name: 'Red',   main: '#ff5468', dark: '#b8243a', light: '#ffc0c8', glow: 'rgba(255,84,104,0.55)' },
  { id: 2, name: 'Green', main: '#3fd47a', dark: '#1f8a4c', light: '#bff5d4', glow: 'rgba(63,212,122,0.55)' },
  { id: 3, name: 'Gold',  main: '#ffc23d', dark: '#b8851d', light: '#ffe9b5', glow: 'rgba(255,194,61,0.55)' },
];
export const NEUTRAL_COLOR = { id: -1, name: 'Stray', main: '#cfc6ba', dark: '#8e857a', light: '#f2ede6', glow: 'rgba(220,210,200,0.4)' };
export function teamColor(owner) { return owner >= 0 ? TEAM_COLORS[owner] : NEUTRAL_COLOR; }

// ---------------- Buildings ----------------
// type ids are strings in data, ints on the wire (BTYPE index)
export const BTYPES = ['cottage', 'tower', 'forge', 'garden', 'cattree'];

export const BUILDINGS = {
  cottage: {
    name: 'Kitten Cottage', icon: '🏠', maxLevel: 5,
    desc: 'Makes new kittens. Upgrade it to make them faster and hold more.',
    cap: [20, 30, 40, 50, 60], prod: [0.55, 0.75, 0.95, 1.15, 1.35],
    upgradeCost: [10, 15, 20, 25], defense: 1.0, radius: [34, 36, 38, 40, 42],
  },
  tower: {
    name: 'Scratch Tower', icon: '🗼', maxLevel: 3,
    desc: 'Flings hairballs at enemy cats walking past. An unowned tower flings them at everyone until someone takes it. Each upgrade reaches much farther. Tough to capture.',
    cap: [20, 30, 40], prod: [0, 0, 0], range: [175, 255, 340], fireEvery: [1.25, 0.95, 0.7], dmg: 1,
    upgradeCost: [15, 25], defense: 1.5, radius: [36, 38, 40],
  },
  forge: {
    name: 'Yarn Forge', icon: '🧶', maxLevel: 3,
    desc: 'Spins battle yarn. Every forge you own makes ALL your cats hit harder.',
    cap: [20, 30, 40], prod: [0, 0, 0], atkBonus: [0.12, 0.2, 0.3],
    upgradeCost: [15, 25], defense: 1.0, radius: [37, 39, 41],
  },
  garden: {
    name: 'Catnip Garden', icon: '🌿', maxLevel: 3,
    desc: 'Grows catnip. Catnip is scarce, and every garden you own makes yours refill a lot faster.',
    // same catnip per second as in Whisker Wars, on a 30% slower base: each garden is worth much more here
    cap: [20, 30, 40], prod: [0, 0, 0], catnipBonus: [0.36, 0.57, 0.86],
    upgradeCost: [15, 25], defense: 1.0, radius: [36, 38, 40],
  },
  cattree: {
    name: 'Grand Cat Tree', icon: '🌳', maxLevel: 1,
    desc: 'A legendary landmark. Makes kittens fast, holds a huge army and defends itself.',
    cap: [90], prod: [1.3], range: [200], fireEvery: [1.1], dmg: 1,
    upgradeCost: [], defense: 1.3, radius: [56], noConvert: true,
  },
};
// A tower that fights off an attack slowly grows back the cats it lost, at a level-1 cottage's pace, starting
// a few seconds after the last hit. Knocking a tower half down and walking away no longer leaves the other
// player a cheap prize.
export const TOWER_REGROW = { rate: BUILDINGS.cottage.prod[0], delay: 4 };
// An unowned building (cottage, tower, Cat Tree...) that fought off an attack grows back to the cats it started with,
// a few seconds after the fighting stops. Bigger garrisons refill faster: a full refill takes about 24 s at any size
// (an 8-cat cottage gets back ~0.33 cats/s, a 20-cat one ~0.83, a 45-cat Cat Tree ~1.9).
export const STRAY_REGROW = { refill: 24, min: 0.3, delay: 4 };
export const strayRegrowRate = full => Math.max(STRAY_REGROW.min, full / STRAY_REGROW.refill);
// Nobody can see how many cats are inside another player's buildings (strays stay visible), not even the computer.
// Only two heroes have a skill that shows them: Agent Velvet (Spy Eye) and Chef Grimsby (Food Poisoning).
// Prof. Purrcival's Auto-Turret spell bolts on a fixed-size hairball turret
export const TURRET = { range: 195, fireEvery: 0.95 };
// cost (in cats) to convert a building into another type (resets to level 1)
export const CONVERT_COST = { cottage: 10, tower: 20, forge: 20, garden: 20 };

// ---------------- Clans & Heroes ----------------
export const CLANS = {
  royal:  { name: 'Royal Court',   color: '#ffcf4d', icon: '👑', desc: 'Knights and nobles of the Velvet Cushion.' },
  tech:   { name: 'Tech Whiskers', color: '#3de0ff', icon: '🔧', desc: 'Gadgets, beams and things from outer space.' },
  mystic: { name: 'Moon Mystics',  color: '#b08cff', icon: '🌙', desc: 'Wild magic: frost, storms and charm.' },
  alley:  { name: 'Alley Cats',    color: '#ff8a3d', icon: '🗑️', desc: 'Spooky tricksters of the back streets.' },
};

// Every hero has 4 skills and no passive. A skill's slot sets its catnip cost and its cooldown; each skill has 5
// levels (bought with fish) that shorten the cooldown and make it stronger.
export const SLOTS = [
  { cost: 20, cd: [40, 35, 30, 25, 20] },
  { cost: 40, cd: [60, 55, 50, 45, 40] },
  { cost: 60, cd: [100, 90, 80, 75, 70] },
  { cost: 80, cd: [140, 130, 120, 110, 100] },
];
// how each per-level number reads on the upgrade button
export const LV_INFO = {
  cd: ['Cooldown', 's'], dur: ['Lasts', 's'], r: ['Area', 'n'], n: ['Cats', 'n'], cap: ['Up to', 'n'], pct: ['Share', '%'],
  mul: ['Defense', 'x'], spd: ['Speed', '+%'], atk: ['Attack', 'x%'], slow: ['Enemy speed', '%'], prod: ['Kitten-making', '%'],
  boost: ['Kitten-making', 'x'], tlv: ['Tower level', 'n'], splash: ['Blast', 'n'], fill: ['Arrive in', 's'], back: ['Rewind', 's'],
  drop: ['Defense lost', '%'], delay: ['Delay', 's'], range: ['Range', '+%'], rate: ['Cats lost', '/s'], chance: ['Spread chance', '%'],
  bld: ['Buildings', 'n'], slowx: ['Slower', 'x'],
};

const P_ = v => Math.round(v * 100) + '%';
const UP = v => '+' + Math.round((v - 1) * 100) + '%';
// target kinds: own | enemy | neutral | notown | area | global (see game.js)
const H = list => list.map(h => ({ ...h, spells: h.spells.map((s, k) => ({ ...s, slot: k, cost: SLOTS[k].cost, cd: SLOTS[k].cd[0], lv: { cd: SLOTS[k].cd, ...(s.lv || {}) } })) }));
export const HEROES = H([
  // ---------------- Royal Court
  {
    id: 'pounce', name: 'Sir Pounce', title: 'Shield of the Hearth', clan: 'royal', cost: 0, fur: 'ginger', art: 'whiskers', role: 'Defense · Easy',
    blurb: 'A steady knight who keeps your cottages standing and your army in good spirits. Great for learning.',
    spells: [
      { id: 'stonepaws', name: 'Stone Paws', icon: '🛡️', target: 'own', fx: 'stone', lv: { mul: [1.25, 1.27, 1.29, 1.32, 1.35], dur: [5, 7, 8, 9, 10] },
        desc: s => `Your building defends ×${s.mul} as well for ${s.dur}s.` },
      { id: 'zoomboots', name: 'Zoom Boots', icon: '👢', target: 'area', fx: 'boots', lv: { spd: [1.45, 1.5, 1.55, 1.6, 1.65], r: [125, 132, 140, 150, 160] },
        desc: s => `Every cat walking in the area runs ${UP(s.spd)} faster until it reaches a building. That means enemy cats too, so aim it at your own.` },
      { id: 'luckystar', name: 'Lucky Star', icon: '⭐', target: 'global', fx: 'star', lv: { dur: [5, 6, 7, 8, 10] },
        desc: s => `Your Purr Power jumps up one star right away and can't drop for ${s.dur}s.` },
      { id: 'sneak', name: 'Sneak Attack', icon: '🥷', target: 'global', fx: 'sneak', delay: 2.2, lv: { n: [30, 34, 38, 42, 45] },
        desc: s => `After 2s, ${s.n} of your cats pop up and attack every enemy building at once, split evenly between them. Anything they capture earns Purr Power as usual.` },
    ],
  },
  {
    id: 'kibble', name: 'Corporal Kibble', title: 'Master of Towers', clan: 'royal', cost: 0, fur: 'orange', art: 'chonk', role: 'All-round · Easy',
    blurb: 'Builds towers wherever trouble shows up, then makes them go boom.',
    spells: [
      { id: 'popup', name: 'Pop-up Tower', icon: '🗼', target: 'own', fx: 'popup', lv: { dur: [6, 7, 7.5, 8, 8.5], tlv: [1, 2, 3, 3, 3] },
        desc: s => `A cottage, forge or garden of yours turns into a tower (up to level ${s.tlv}) for ${s.dur}s: it shoots and defends like one, but stops its normal job meanwhile.` },
      { id: 'boomballs', name: 'Boom Hairballs', icon: '💣', target: 'own', fx: 'boom', lv: { dur: [5, 5.5, 6, 6.5, 7], splash: [45, 47, 50, 52, 55] },
        desc: s => `For ${s.dur}s your tower's hairballs explode, knocking a cat out of every enemy squad within ${s.splash} of each hit. Works on any building that shoots.` },
      { id: 'ranks', name: 'Tight Formation', icon: '🐾', target: 'own', fx: 'ranks', lv: { n: [75, 85, 90, 95, 100], spd: [1.25, 1.3, 1.35, 1.4, 1.5] },
        desc: s => `The next cats you send from this building (within 30s, up to ${s.n}) march as one tight squad, ${UP(s.spd)} faster.` },
      { id: 'bomb', name: 'Catnip Bomb', icon: '🧨', target: 'enemy', fx: 'bomb', lv: { pct: [0.75, 0.8, 0.85, 0.9, 0.95], r: [75, 87, 100, 112, 125] },
        desc: s => `Knocks out ${P_(s.pct)} of an enemy building's cats, and every enemy cat walking within ${s.r} of it.` },
    ],
  },
  {
    id: 'bristle', name: 'Baron Bristle', title: 'The Warmonger', clan: 'royal', cost: 11500, fur: 'calico', art: 'clawbeard', role: 'Attack · Hard',
    blurb: 'Plays with fire, and with everybody\'s nerves. Brilliant when you\'re behind.',
    spells: [
      { id: 'shackles', name: 'Shackles', icon: '⛓️', target: 'enemy', fx: 'shackle', lv: { dur: [8, 9, 10, 11, 12] },
        desc: s => `An enemy building can't send any cats out for ${s.dur}s.` },
      { id: 'evenpurr', name: 'Even Purr', icon: '⚖️', target: 'global', fx: 'even',
        desc: () => 'Every player\'s Purr Power becomes the average of everyone\'s. Cheap, and huge when your rival is far ahead.' },
      { id: 'fury', name: 'Battle Fury', icon: '😤', target: 'area', fx: 'fury', lv: { atk: [1.5, 1.55, 1.6, 1.65, 1.75], spd: [1.1, 1.15, 1.2, 1.25, 1.3], r: [125, 137, 150, 162, 175] },
        desc: s => `Every cat walking in the area hits ×${s.atk} as hard and runs ${UP(s.spd)} faster until it arrives. Anyone's cats, so aim carefully.` },
      { id: 'firering', name: 'Ring of Fire', icon: '🔥', target: 'area', fx: 'fire', lv: { cap: [100, 125, 150, 200, 1000], r: [100, 110, 120, 130, 140] },
        desc: s => `A ring of fire spreads out from the spot and knocks out up to ${s.cap} enemy cats walking in the area. Knockouts from it give no Purr Power.` },
    ],
  },
  // ---------------- Tech Whiskers
  {
    id: 'zap', name: 'Captain Zap', title: 'Star Pilot', clan: 'tech', cost: 750, fur: 'siamese', art: 'astro', role: 'All-round · Easy',
    blurb: 'Beams cats wherever they\'re needed and hides them where they aren\'t expected.',
    spells: [
      { id: 'beam', name: 'Beam Me Up', icon: '🛸', target: 'own', fx: 'beam', lv: { pct: [0.5, 0.55, 0.6, 0.65, 0.75] },
        desc: s => `Charge up one of your buildings. Within 30s, send cats from it to another of your buildings: ${P_(s.pct)} of its cats beam straight there in 2s.` },
      { id: 'cloak', name: 'Cloak', icon: '👻', target: 'area', fx: 'cloak', lv: { dur: [10, 11, 12, 13.5, 15], r: [150, 175, 200, 225, 250] },
        desc: s => `Your cats walking in the area turn invisible for ${s.dur}s: towers can't see them and enemy squads walk right past.` },
      { id: 'uturn', name: 'U-Turn Field', icon: '↩️', target: 'area', fx: 'uturn', lv: { dur: [1.5, 2, 2.5, 3, 4], r: [100, 112, 125, 137, 150] },
        desc: s => `For ${s.dur}s, enemy cats walking into the area turn around and go home.` },
      { id: 'pods', name: 'Drop Pods', icon: '🚀', target: 'own', fx: 'pods', lv: { n: [75, 80, 85, 90, 100], fill: [7, 6, 5.5, 5, 4] },
        desc: s => `${s.n} fresh cats beam down into your building over ${s.fill}s.` },
    ],
  },
  {
    id: 'velvet', name: 'Agent Velvet', title: 'Spy of the Night Roofs', clan: 'tech', cost: 13500, fur: 'black', art: 'shadow', role: 'All-round · Hard', sees: true,
    blurb: 'Knows exactly how many cats you have. Soon, so will you.',
    spells: [
      { id: 'spyeye', name: 'Spy Eye', icon: '🔭', target: 'area', fx: 'spy', lv: { dur: [5, 5.5, 6, 6.5, 7], prod: [0.95, 0.9, 0.85, 0.8, 0.75], r: [200, 212, 225, 237, 250] },
        desc: s => `For ${s.dur}s you can see how many cats are inside enemy buildings in the area, and they make kittens at only ${P_(s.prod)} speed.` },
      { id: 'fog', name: 'Fog Cloud', icon: '🌫️', target: 'area', fx: 'fog', dur: 15, lv: { slow: [0.95, 0.9, 0.8, 0.75, 0.7], r: [200, 212, 225, 237, 250] },
        desc: s => `A fog cloud for 15s: your cats inside are hidden, towers can't shoot into it, and enemy cats inside walk at ${P_(s.slow)} speed.` },
      { id: 'hypno', name: 'Hypnotize', icon: '🌀', target: 'notown', fx: 'hypno', lv: { pct: [0.7, 0.725, 0.75, 0.78, 0.8] },
        desc: s => `${P_(s.pct)} of the cats in an enemy or stray building fall under your spell and walk to your nearest building.` },
      { id: 'zapfence', name: 'Zap Fence', icon: '⚡', target: 'own', fx: 'fence', lv: { dur: [7, 8, 9, 9.5, 10], cap: [75, 100, 115, 130, 150] },
        desc: s => `An electric fence rings your building for ${s.dur}s and knocks out enemy cats that cross it (up to ${s.cap}).` },
    ],
  },
  {
    id: 'paradox', name: 'Professor Paradox', title: 'Keeper of Clocks', clan: 'tech', cost: 3000, fur: 'graytabby', art: 'purrcival', role: 'All-round · Easy',
    blurb: 'Was here yesterday. Will be here tomorrow. Knows where your cats are going.',
    spells: [
      { id: 'mindread', name: 'Mind Reader', icon: '🧠', target: 'area', fx: 'intel', dur: 8, lv: { r: [175, 200, 217, 232, 250] },
        desc: s => `For 8s, lines show where every enemy squad in the area is heading (not how many cats a building has).` },
      { id: 'rewind', name: 'Rewind', icon: '⏪', target: 'area', fx: 'rewind', lv: { back: [2.5, 2.75, 3, 3.25, 3.5], r: [125, 137, 150, 155, 160] },
        desc: s => `Enemy cats walking in the area jump back to where they were ${s.back}s ago.` },
      { id: 'shortcut', name: 'Shortcut', icon: '🕳️', target: 'own', fx: 'shortcut', lv: { n: [25, 28, 31, 33, 35] },
        desc: s => `The next cats you send from this building (within 30s, up to ${s.n}) take a secret tunnel and arrive 3.5s later.` },
      { id: 'chain', name: 'Chain Reaction', icon: '🔗', target: 'area', fx: 'chain', r: 60, lv: { cap: [70, 75, 80, 90, 100] },
        desc: s => `Tap next to a squad: a chain reaction jumps from it to the nearby squads of the same colour, knocking out up to ${s.cap} cats. It can hit your own cats if you tap them!` },
    ],
  },
  // ---------------- Moon Mystics
  {
    id: 'paprika', name: 'Princess Paprika', title: 'The Sweet Talker', clan: 'mystic', cost: 7000, fur: 'persian', art: 'duchess', role: 'Attack · Medium',
    blurb: 'Pampered, powerful and very persuasive. Enemy cats find her hard to say no to.',
    spells: [
      { id: 'kittenboom', name: 'Kitten Boom', icon: '🍼', target: 'own', fx: 'kboom', lv: { boost: [1.5, 1.6, 1.7, 1.85, 2], dur: [7.5, 8, 8.5, 9, 10] },
        desc: s => `Your cottage makes kittens ×${s.boost} as fast for ${s.dur}s.` },
      { id: 'hush', name: 'Hush', icon: '🤫', target: 'global', fx: 'hush', lv: { dur: [3.5, 4, 4.5, 5, 6] },
        desc: s => `Nobody can use skills for ${s.dur}s, you included. Cast it right after your own big skill.` },
      { id: 'paperwalls', name: 'Paper Walls', icon: '📄', target: 'notown', fx: 'paper', lv: { drop: [0.75, 0.8, 0.85, 0.9, 1], dur: [1.5, 1.7, 1.9, 2.1, 2.4] },
        desc: s => `For ${s.dur}s a building loses ${P_(s.drop)} of its defense (it always keeps a little). Time it for when your cats arrive!` },
      { id: 'sweettalk', name: 'Sweet Talk', icon: '💘', target: 'area', fx: 'charm', lv: { n: [30, 32, 35, 37, 40], r: [100, 107, 115, 120, 125] },
        desc: s => `Up to ${s.n} enemy cats walking in the area switch to your side and keep going where they were headed.` },
    ],
  },
  {
    id: 'snowpaw', name: 'Snowpaw', title: 'Witch of the Frozen Peaks', clan: 'mystic', cost: 9500, fur: 'white', art: 'mittens', role: 'Attack · Medium',
    blurb: 'Tiny paws, enormous storms. Everything slows down when she\'s around.',
    spells: [
      { id: 'deepfreeze', name: 'Deep Freeze', icon: '🧊', target: 'enemy', fx: 'freeze', lv: { dur: [4, 4.5, 5, 5.5, 6] },
        desc: s => `Freezes an enemy building for ${s.dur}s: no kittens, no tower shots, and a forge or garden gives no bonus.` },
      { id: 'flying', name: 'Flying Kittens', icon: '🎈', target: 'own', fx: 'fly', lv: { n: [50, 60, 70, 85, 100], spd: [1.3, 1.4, 1.5, 1.6, 1.7] },
        desc: s => `The next cats you send from this building (within 30s, up to ${s.n}) float straight over ponds, walls and hedges, ${UP(s.spd)} faster.` },
      { id: 'frostring', name: 'Ring of Frost', icon: '❄️', target: 'area', fx: 'frost', lv: { dur: [8, 9, 10, 11, 12], r: [100, 112, 125, 137, 150] },
        desc: s => `Every cat walking in the area freezes solid for ${s.dur}s. Yours too!` },
      { id: 'tornado', name: 'Tornado', icon: '🌪️', target: 'area', fx: 'tornado', lv: { dur: [10, 11, 12, 13, 15] },
        desc: s => `A tornado whirls around the spot for ${s.dur}s, knocking out enemy cats it touches and pulling cats out of enemy buildings it passes over.` },
    ],
  },
  {
    id: 'mischief', name: 'Miss Mischief', title: 'The Lucky Charm', clan: 'mystic', cost: 5000, fur: 'maneki', art: 'neko', role: 'All-round · Medium',
    blurb: 'One wave of her paw and the whole battlefield goes a bit silly.',
    spells: [
      { id: 'vortex', name: 'Zoomies Vortex', icon: '💨', target: 'area', fx: 'vortex', lv: { dur: [5.5, 6, 6.5, 7, 7.5], r: [100, 107, 115, 122, 125] },
        desc: s => `For ${s.dur}s, every cat walking through the area runs 50% faster. Anyone's cats.` },
      { id: 'purrfreeze', name: 'Purr Freeze', icon: '⏸️', target: 'global', fx: 'pfreeze', lv: { dur: [10, 11.5, 13, 14, 15] },
        desc: s => `Everyone's Purr Power is locked for ${s.dur}s: nobody gains or loses stars. Lock in your lead!` },
      { id: 'chickens', name: 'Chicken Out', icon: '🐔', target: 'area', fx: 'chicken', lv: { atk: [0.8, 0.75, 0.7, 0.65, 0.6], r: [150, 162, 175, 187, 200] },
        desc: s => `Enemy cats walking in the area turn into chickens until they arrive: no forge or Purr Power bonus, and they only hit at ${P_(s.atk)} strength.` },
      { id: 'magnet', name: 'Cat Magnet', icon: '🧲', target: 'own', fx: 'magnet', lv: { dur: [5, 6, 7, 8, 8.5], r: [200, 212, 225, 237, 250] },
        desc: s => `For ${s.dur}s your building pulls in every cat walking within ${s.r}: yours move in, and enemy cats have to attack it.` },
    ],
  },
  // ---------------- Alley Cats
  {
    id: 'graveclaw', name: 'Lord Graveclaw', title: 'Keeper of Nine Lives', clan: 'alley', cost: 15500, fur: 'void', art: 'luna', role: 'Attack · Hard',
    blurb: 'Cats have nine lives. He knows where the other eight went.',
    spells: [
      { id: 'crumble', name: 'Crumble', icon: '🏚️', target: 'enemy', fx: 'crumble',
        desc: () => 'An enemy building drops one level.' },
      { id: 'secondlife', name: 'Second Life', icon: '💫', target: 'own', fx: 'revive', lv: { pct: [0.8, 0.85, 0.9, 0.95, 1] },
        desc: s => `${P_(s.pct)} of the cats knocked out inside your building in the last 5s come back.` },
      { id: 'gohome', name: 'Go Home', icon: '🏠', target: 'area', fx: 'home', lv: { r: [150, 162, 175, 187, 200] },
        desc: s => `Every cat walking in the area turns around and goes back where it came from. Anyone's cats.` },
      { id: 'panic', name: 'Panic', icon: '😱', target: 'enemy', fx: 'panic', lv: { pct: [0.75, 0.85, 0.9, 0.95, 1], delay: [2, 1.75, 1.5, 1.25, 1] },
        desc: s => `After ${s.delay}s, ${P_(s.pct)} of an enemy building's cats panic and run off to their other buildings, leaving it almost empty.` },
    ],
  },
  {
    id: 'grimsby', name: 'Chef Grimsby', title: 'The Spooky Cook', clan: 'alley', cost: 1500, fur: 'cream', art: 'chef', role: 'Defense · Easy', sees: true,
    blurb: 'His towers never go hungry and his soup is... an acquired taste.',
    spells: [
      { id: 'soulsnatch', name: 'Soul Snatcher', icon: '🥄', target: 'own', fx: 'soul', lv: { range: [1.2, 1.25, 1.3, 1.4, 1.5], dur: [10, 11, 12, 13.5, 15] },
        desc: s => `For ${s.dur}s your tower reaches ${UP(s.range)} farther, and every enemy cat it knocks out joins the tower.` },
      { id: 'untouchable', name: 'Untouchable', icon: '🔮', target: 'own', fx: 'invuln',
        desc: () => 'Nothing can hurt your building, but the spell eats 6 of its own cats every second until they run out (10s at most).' },
      { id: 'slowmo', name: 'Slow-Mo Ring', icon: '🐌', target: 'area', fx: 'slowmo', lv: { slowx: [2, 2.25, 2.5, 2.75, 3], r: [112, 125, 137, 150, 162] },
        desc: s => `Every cat walking in the area moves ${s.slowx}× slower until it arrives. Anyone's cats.` },
      { id: 'poison', name: 'Food Poisoning', icon: '🤢', target: 'enemy', fx: 'plague', dur: 12, lv: { rate: [2, 2.5, 3, 3.5, 4], prod: [0.5, 0.4, 0.3, 0.15, 0], chance: [0.5, 0.6, 0.7, 0.85, 1] },
        desc: s => `For 12s an enemy building loses ${s.rate} cats a second and makes kittens at ${P_(s.prod)} speed, and you can see its count. Cats sent out of it carry it along (${P_(s.chance)} chance).` },
    ],
  },
  {
    id: 'hexley', name: 'Hexley', title: 'The Trickster', clan: 'alley', cost: 18000, fur: 'tuxedo', art: 'glitch', role: 'Attack · Hard',
    blurb: 'Sits on your keyboard, your towers and your plans.',
    spells: [
      { id: 'defectors', name: 'Defectors', icon: '🏃', target: 'enemy', fx: 'defect', lv: { dur: [8, 8.5, 9, 9.5, 10] },
        desc: s => `For ${s.dur}s, every kitten an enemy building makes walks over to your nearest building.` },
      { id: 'bounce', name: 'Bounce Shield', icon: '🪞', target: 'own', fx: 'bounce', lv: { dur: [8, 8.5, 9, 9.5, 10], n: [40, 45, 50, 55, 60] },
        desc: s => `For ${s.dur}s (or until ${s.n} cats bounce off) enemy cats that reach your building turn around and go home.` },
      { id: 'swap', name: 'Swap!', icon: '🔀', target: 'enemy', fx: 'swap',
        desc: () => 'Swaps an enemy building with a random one of yours, cats and all. Their effects wear off.' },
      { id: 'echo', name: 'Echo Hex', icon: '📣', target: 'enemy', fx: 'echo', lv: { dur: [8, 8.5, 9, 9.5, 10], bld: [3, 3, 4, 4, 5], pct: [0.75, 0.8, 0.85, 0.95, 1] },
        desc: s => `For ${s.dur}s, ${P_(s.pct)} of every cat knocked out of an enemy building is also knocked out of its ${s.bld} nearest buildings.` },
    ],
  },
]);
export const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));
export function findSpell(id) {
  for (const h of HEROES) for (const s of h.spells) if (s.id === id) return s;
  return null;
}

// ---------------- Skill levels (upgraded with fish between battles) ----------------
export const SKILL_MAX = 5;
const SKILL_COST = [300, 750, 1500, 3000];    // fish to go from level 1->2, 2->3, 3->4, 4->5
export const skillUpgradeCost = lv => SKILL_COST[lv - 1] ?? null;
/**
 * A skill's numbers at one level. Skills list what grows with level under `lv` ({ dur: [l1..l5], ... }); this
 * returns the skill with those filled in, plus `level` and a ready-to-read `text`.
 */
export function skillAt(sp, level = 1) {
  if (!sp) return null;
  const L = Math.max(1, Math.min(SKILL_MAX, level | 0 || 1));
  const out = { ...sp, level: L };
  for (const [k, arr] of Object.entries(sp.lv || {})) out[k] = arr[Math.min(arr.length, L) - 1];
  out.text = typeof sp.desc === 'function' ? sp.desc(out) : sp.desc;
  return out;
}
/** what changes when a skill goes up a level, e.g. "Cooldown 40s → 35s" (for the upgrade button) */
export function skillGain(sp, level) {
  const out = [];
  for (const [k, arr] of Object.entries(sp.lv || {})) {
    const a = arr[Math.min(arr.length, level) - 1], b = arr[Math.min(arr.length, level + 1) - 1];
    if (a === b) continue;
    const [name, f] = LV_INFO[k] || [k, 'n'];
    out.push(name + ' ' + fmtLv(a, f) + ' → ' + fmtLv(b, f));
  }
  return out;
}
function fmtLv(v, f) {
  if (f === 's') return v + 's';
  if (f === '%') return Math.round(v * 100) + '%';
  if (f === '+%') return '+' + Math.round((v - 1) * 100) + '%';
  if (f === 'x%') return '×' + v;
  if (f === 'x') return '×' + v;
  if (f === '/s') return v + '/s';
  return String(v);
}

// ---------------- Cosmetics ----------------
// pattern: solid | tabby | calico | tuxedo | points | spots | galaxy | gold | void
export const FURS = [
  { id: 'ginger',    name: 'Ginger Tabby',  cost: 0,    base: '#f39a3c', dark: '#c96b1c', belly: '#ffe3c2', pattern: 'tabby' },
  { id: 'gray',      name: 'Smoky Gray',    cost: 0,    base: '#9aa3ad', dark: '#6b737c', belly: '#e3e7eb', pattern: 'solid' },
  { id: 'white',     name: 'Snowball',      cost: 150,  base: '#fbfaf7', dark: '#d9d4cc', belly: '#ffffff', pattern: 'solid' },
  { id: 'black',     name: 'Midnight',      cost: 150,  base: '#2c2a33', dark: '#16151b', belly: '#45424f', pattern: 'solid' },
  { id: 'cream',     name: 'Vanilla Cream', cost: 150,  base: '#f4dfb8', dark: '#d6b98a', belly: '#fff6e6', pattern: 'solid' },
  { id: 'orange',    name: 'Chonky Orange', cost: 200,  base: '#ff8c2b', dark: '#d1621a', belly: '#ffd9a8', pattern: 'tabby' },
  { id: 'graytabby', name: 'Silver Tabby',  cost: 200,  base: '#b9bfc6', dark: '#5e646b', belly: '#eef0f2', pattern: 'tabby' },
  { id: 'tuxedo',    name: 'Tuxedo',        cost: 250,  base: '#25232b', dark: '#121117', belly: '#ffffff', pattern: 'tuxedo' },
  { id: 'calico',    name: 'Calico',        cost: 300,  base: '#fbf6ee', dark: '#e07b2c', belly: '#ffffff', pattern: 'calico', spot2: '#3a3434' },
  { id: 'siamese',   name: 'Siamese',       cost: 350,  base: '#f3e6d2', dark: '#5a3f33', belly: '#fff8ee', pattern: 'points' },
  { id: 'persian',   name: 'Fluffy Persian',cost: 350,  base: '#f7f2ff', dark: '#cfc3e6', belly: '#ffffff', pattern: 'solid', fluffy: true },
  { id: 'maneki',    name: 'Lucky Maneki',  cost: 450,  base: '#ffffff', dark: '#e8473f', belly: '#ffffff', pattern: 'spots', spot2: '#2d2a2a' },
  { id: 'void',      name: 'Void Witch',    cost: 600,  base: '#1d1630', dark: '#0d0a18', belly: '#3b2d63', pattern: 'void' },
  { id: 'galaxy',    name: 'Galaxy',        cost: 900,  base: '#3b2a7a', dark: '#1a1240', belly: '#7b6cff', pattern: 'galaxy' },
  { id: 'golden',    name: 'Solid Gold',    cost: 1500, base: '#ffd34d', dark: '#c8961b', belly: '#fff2b0', pattern: 'gold' },
];
export const FUR_BY_ID = Object.fromEntries(FURS.map(f => [f.id, f]));

export const HATS = [
  { id: 'none',      name: 'No Hat',          cost: 0 },
  { id: 'bow',       name: 'Ribbon Bow',      cost: 100 },
  { id: 'party',     name: 'Party Hat',       cost: 150 },
  { id: 'beanie',    name: 'Cozy Beanie',     cost: 150 },
  { id: 'flower',    name: 'Flower Crown',    cost: 200 },
  { id: 'wizard',    name: 'Wizard Hat',      cost: 250 },
  { id: 'pirate',    name: 'Pirate Hat',      cost: 300 },
  { id: 'cowboy',    name: 'Cowboy Hat',      cost: 300 },
  { id: 'viking',    name: 'Viking Helmet',   cost: 350 },
  { id: 'tophat',    name: 'Fancy Top Hat',   cost: 400 },
  { id: 'crown',     name: 'Royal Crown',     cost: 600 },
  { id: 'halo',      name: 'Angel Halo',      cost: 750 },
];
export const HAT_BY_ID = Object.fromEntries(HATS.map(h => [h.id, h]));

export const EMOTES = [
  { id: 'meow',  text: 'Meow!',      icon: '😺' },
  { id: 'gg',    text: 'Good game!', icon: '🤝' },
  { id: 'hiss',  text: 'Hissss!',    icon: '😾' },
  { id: 'lol',   text: 'LOL',        icon: '😹' },
  { id: 'love',  text: 'Purr~',      icon: '😻' },
  { id: 'wow',   text: 'Whoa!',      icon: '🙀' },
  { id: 'nap',   text: 'Zzz...',     icon: '😴' },
  { id: 'fish',  text: 'Fish pls',   icon: '🐟' },
];

// ---------------- Map themes ----------------
export const THEMES = {
  meadow:  { name: 'Sunny Meadow',    ground: '#8fd16a', ground2: '#7cc35a', accent: '#ffe27a', ambient: 'petals' },
  rooftop: { name: 'Sunset Rooftops', ground: '#c98f6b', ground2: '#b77c5a', accent: '#ffb36b', ambient: 'leaves' },
  snow:    { name: 'Snowy Peaks',     ground: '#eaf4ff', ground2: '#d6e7f7', accent: '#9fd0ff', ambient: 'snow' },
  night:   { name: 'Moonlit Garden',  ground: '#2f4a5e', ground2: '#28405a', accent: '#b9a6ff', ambient: 'fireflies' },
  beach:   { name: 'Fishmarket Docks',ground: '#f2d9a0', ground2: '#e6c886', accent: '#5fd0e6', ambient: 'bubbles' },
  candy:   { name: 'Candy Kingdom',   ground: '#ffc6e2', ground2: '#ffb3d8', accent: '#b8f0ff', ambient: 'sparkles' },
};

// ---------------- Maps ----------------
// Each map lists P0's half; mirror() adds the point-symmetric half for P1.
// owner: 0 = player 1, -1 = neutral. center:true means it sits on the center and is not mirrored.
function mirror(half) {
  const out = [];
  for (const b of half) {
    out.push({ ...b });
    if (!b.center) out.push({ ...b, x: WORLD_W - b.x, y: WORLD_H - b.y, owner: b.owner === 0 ? 1 : b.owner });
  }
  return out.map((b, i) => ({ id: i, x: b.x, y: b.y, type: b.type, level: b.level || 1, owner: b.owner ?? -1, count: b.count ?? 10 }));
}

// ---------------- Terrain ----------------
// Obstacles cats must walk around (see shared/nav.js for the shapes). Like buildings, a map lists P0's half and
// terrain() adds the point-symmetric copy for P1; center:true pieces are symmetric already and listed once.
//   water: ponds, rivers, the sea (rooftop maps draw it as an alley drop)   island / bridge: walkable land over water
//   mound / rock / gumdrop: raised lumps        hedge / wall: long barriers
function terrain(half) {
  const R = ([x, y]) => [WORLD_W - x, WORLD_H - y];
  const out = [];
  for (const o of half) {
    const { center, ...s } = o;
    out.push(s);
    if (center) continue;
    const m = { ...s };
    if (m.poly) m.poly = m.poly.map(R);
    if (m.pts) m.pts = m.pts.map(R);
    if (m.x != null) { m.x = WORLD_W - m.x; m.y = WORLD_H - m.y; }
    out.push(m);
  }
  return out;
}
// lumpy outline; sym = point-symmetric around its own centre (for pieces sitting on the map centre)
function blobPoly(x, y, rx, ry, rough, sym) {
  const rnd = mulberry32(((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)) >>> 0);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283], H = sym ? [2, 4, 6] : [2, 3, 5], n = 22, pts = [];
  for (let k = 0; k < n; k++) {
    const u = k / n * Math.PI * 2;
    const f = 1 + rough * (0.5 * Math.sin(H[0] * u + ph[0]) + 0.3 * Math.sin(H[1] * u + ph[1]) + 0.2 * Math.sin(H[2] * u + ph[2]));
    pts.push([Math.round((x + Math.cos(u) * rx * f) * 10) / 10, Math.round((y + Math.sin(u) * ry * f) * 10) / 10]);
  }
  return pts;
}
const pond = (x, y, rx, ry = rx, a = 0) => ({ t: 'water', x, y, rx, ry, a });
const sea = poly => ({ t: 'water', poly });
const river = (pts, w) => ({ t: 'water', pts, w });
const island = (x, y, rx, ry = rx) => ({ t: 'island', x, y, rx, ry });
const bridge = (x1, y1, x2, y2, w = 90) => ({ t: 'bridge', pts: [[x1, y1], [x2, y2]], w });
const mound = (x, y, rx, ry = rx * 0.8, rough = 0.16, sym = false) => ({ t: 'mound', poly: blobPoly(x, y, rx, ry, rough, sym) });
const rock = (x, y, r) => ({ t: 'rock', poly: blobPoly(x, y, r, r * 0.85, 0.22, false) });
const gumdrop = (x, y, rx, ry = rx * 0.8) => ({ t: 'gumdrop', poly: blobPoly(x, y, rx, ry, 0.08, false) });
const ridge = (pts, w = 56) => ({ t: 'mound', pts, w });
const hedge = (pts, w = 42) => ({ t: 'hedge', pts, w });
const wall = (pts, w = 44) => ({ t: 'wall', pts, w });
const C = o => ({ ...o, center: true });

// ---------------- 3 and 4 player maps ----------------
// 4 players: list the top-left quarter; mirror4 copies it into all four corners (seats go clockwise from the
// top left: 0 TL, 1 TR, 2 BR, 3 BL). Pieces on the middle lines appear twice, the centre once.
const finish = list => list.map((b, i) => ({ id: i, x: b.x, y: b.y, type: b.type, level: b.level || 1, owner: b.owner ?? -1, count: b.count ?? 10 }));
function mirror4(quarter) {
  const out = [], seen = new Set();
  for (const b of quarter) {
    for (const [x, y, k] of [[b.x, b.y, 0], [WORLD_W - b.x, b.y, 1], [WORLD_W - b.x, WORLD_H - b.y, 2], [b.x, WORLD_H - b.y, 3]]) {
      const key = Math.round(x) + ',' + Math.round(y);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...b, x, y, owner: b.owner === 0 ? k : -1 });
    }
  }
  return finish(out);
}
// 3 players: list one base's share; rot3 turns it to the other two bases around the centre (cx, cy).
// (center:true pieces sit on the centre and appear once.)
function rot3(share, cx, cy) {
  const out = [];
  for (let k = 0; k < 3; k++) for (const b of share) {
    if (b.center && k) continue;
    const [x, y] = turn([b.x, b.y], cx, cy, k);
    out.push({ ...b, x, y, owner: b.owner === 0 ? k : -1 });
  }
  return finish(out);
}
function turn([x, y], cx, cy, k) {
  const a = k * 2 * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
  return [Math.round((cx + dx * c - dy * s) * 10) / 10, Math.round((cy + dx * s + dy * c) * 10) / 10];
}
// terrain counterparts: same copies for ponds, rivers, hedges and lumps (duplicates on the middle lines dropped)
function shapeKey(o) {
  const P = (o.poly || o.pts || [[o.x, o.y]]).map(p => Math.round(p[0]) + ',' + Math.round(p[1])).sort().join(';');
  return [o.t, o.w || 0, o.r || 0, o.rx || 0, o.ry || 0, P].join('|');
}
function moveShape(o, f, angle) {
  const m = { ...o };
  delete m.center;
  if (m.poly) m.poly = m.poly.map(f);
  if (m.pts) m.pts = m.pts.map(f);
  if (m.x != null) { [m.x, m.y] = f([m.x, m.y]); if (m.rx != null) m.a = angle(m.a || 0); }
  return m;
}
function terrain4(quarter) {
  const out = [], seen = new Set();
  const flips = [[false, false], [true, false], [true, true], [false, true]];
  for (const o of quarter) for (const [fx, fy] of flips) {
    const m = moveShape(o, ([x, y]) => [fx ? WORLD_W - x : x, fy ? WORLD_H - y : y], a => (fx !== fy ? -a : a));
    const k = shapeKey(m);
    if (!seen.has(k)) { seen.add(k); out.push(m); }
  }
  return out;
}
// 3 players on the whole field, without turning: two seats mirror each other across the middle line ('y': top and
// bottom, 'x': left and right) and the third seat sits on that line, kept fair by hand (tools/seats.mjs, seatsim.mjs).
// List seat 0's pieces, seat 1's half and the line; seat 1's mirror image becomes seat 2. axis:true = on the line.
function pair3(list, axis) {
  const out = [];
  for (const b of list) {
    const { axis: on, ...c } = b;
    out.push(c);
    if (on) continue;
    out.push({ ...c, x: axis === 'x' ? WORLD_W - c.x : c.x, y: axis === 'y' ? WORLD_H - c.y : c.y, owner: c.owner === 1 ? 2 : c.owner === 0 ? 0 : c.owner });
  }
  return finish(out);
}
function terrainPair(list, axis) {
  const out = [], seen = new Set();
  for (const o of list) for (const flip of [false, true]) {
    if (flip && o.center) continue;
    const m = moveShape(o, ([x, y]) => (flip ? (axis === 'x' ? [WORLD_W - x, y] : [x, WORLD_H - y]) : [x, y]), a => (flip ? -a : a));
    const k = shapeKey(m);
    if (!seen.has(k)) { seen.add(k); out.push(m); }
  }
  return out;
}
function terrain3(share, cx, cy) {
  const out = [];
  for (let k = 0; k < 3; k++) for (const o of share) {
    if (o.center && k) continue;
    out.push(moveShape(o, p => turn(p, cx, cy, k), a => a + k * 2 * Math.PI / 3));
  }
  return out;
}

export const MAPS = [
  {
    id: 'meadow', name: 'Sunny Meadow', theme: 'meadow', size: 'Small', desc: 'A gentle first battlefield. Grab the strays and charge!',
    buildings: mirror([
      { x: 210, y: 450, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 390, y: 250, type: 'cottage', count: 8 },
      { x: 390, y: 655, type: 'cottage', count: 8 },
      { x: 575, y: 450, type: 'cottage', count: 14 },
      { x: 640, y: 215, type: 'tower', count: 14 },
      { x: 800, y: 450, type: 'cottage', level: 2, count: 24, center: true },
    ]),
  },
  {
    id: 'rooftops', name: 'Rooftop Rumble', theme: 'rooftop', size: 'Medium', desc: 'Leap across the chimneys. Hold the central tower!',
    buildings: mirror([
      { x: 180, y: 300, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 175, y: 650, type: 'cottage', count: 8 },
      { x: 390, y: 470, type: 'forge', count: 14 },
      { x: 520, y: 215, type: 'cottage', count: 12 },
      { x: 560, y: 705, type: 'tower', count: 16 },
      { x: 690, y: 330, type: 'cottage', count: 15 },
      { x: 800, y: 520, type: 'tower', level: 2, count: 28, center: true },
    ]),
  },
  {
    id: 'snowy', name: 'Snowy Paws', theme: 'snow', size: 'Medium', desc: 'The Grand Cat Tree stands in the snow. Whoever holds it rules the peak.',
    buildings: mirror([
      { x: 150, y: 450, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 300, y: 205, type: 'cottage', count: 10 },
      { x: 300, y: 700, type: 'cottage', count: 10 },
      { x: 480, y: 345, type: 'forge', count: 14 },
      { x: 480, y: 565, type: 'garden', count: 14 },
      { x: 650, y: 180, type: 'tower', count: 16 },
      { x: 640, y: 725, type: 'cottage', count: 18 },
      { x: 800, y: 450, type: 'cattree', count: 45, center: true },
    ]),
  },
  {
    id: 'moonlit', name: 'Moonlit Garden', theme: 'night', size: 'Medium', desc: 'Catnip glows under the moon. Spells fly fast here.',
    buildings: mirror([
      { x: 200, y: 225, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 195, y: 680, type: 'cottage', count: 8 },
      { x: 410, y: 455, type: 'garden', count: 12 },
      { x: 560, y: 165, type: 'cottage', count: 12 },
      { x: 600, y: 740, type: 'garden', count: 16 },
      { x: 690, y: 450, type: 'tower', count: 20 },
    ]),
  },
  {
    id: 'docks', name: 'Fishmarket Docks', theme: 'beach', size: 'Large', desc: 'Salty air, big fish, bigger battles.',
    buildings: mirror([
      { x: 160, y: 760, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 160, y: 510, type: 'cottage', count: 10 },
      { x: 365, y: 640, type: 'cottage', count: 10 },
      { x: 330, y: 300, type: 'tower', count: 18 },
      { x: 570, y: 770, type: 'forge', count: 15 },
      { x: 600, y: 480, type: 'cottage', level: 2, count: 20 },
      { x: 545, y: 170, type: 'cottage', count: 12 },
      { x: 760, y: 300, type: 'garden', count: 18 },
    ]),
  },
  {
    id: 'candy', name: 'Candy Kingdom', theme: 'candy', size: 'Huge', desc: 'Sugar-rushed chaos with a Cat Tree in the middle. Expect mayhem.',
    buildings: mirror([
      { x: 150, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 335, y: 145, type: 'cottage', count: 6 },
      { x: 150, y: 345, type: 'cottage', count: 6 },
      { x: 350, y: 360, type: 'forge', count: 12 },
      { x: 545, y: 200, type: 'cottage', count: 15 },
      { x: 200, y: 600, type: 'tower', count: 15 },
      { x: 480, y: 560, type: 'cottage', count: 14 },
      { x: 670, y: 370, type: 'garden', count: 16 },
      { x: 420, y: 765, type: 'cottage', count: 10 },
      { x: 660, y: 720, type: 'tower', count: 20 },
      { x: 800, y: 450, type: 'cattree', count: 50, center: true },
    ]),
  },
  // ---- terrain maps: the road between two buildings can be much longer than the straight line
  {
    id: 'ponds', name: 'Lily Pad Lanes', theme: 'meadow', size: 'Medium', desc: 'Two long ponds split the meadow into three lanes.',
    buildings: mirror([
      { x: 170, y: 450, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 330, y: 215, type: 'cottage', count: 8 },
      { x: 330, y: 685, type: 'cottage', count: 8 },
      { x: 480, y: 450, type: 'cottage', count: 12 },
      { x: 680, y: 130, type: 'cottage', count: 12 },
      { x: 560, y: 775, type: 'tower', count: 14 },
      { x: 800, y: 450, type: 'cottage', level: 2, count: 24, center: true },
    ]),
    obstacles: terrain([
      pond(800, 285, 255, 68),
      rock(215, 140, 34),
    ]),
  },
  {
    id: 'hedgerow', name: 'The Long Hedge', theme: 'meadow', size: 'Medium', desc: 'A hedge runs right across the middle. The only way over is all the way around.',
    buildings: mirror([
      { x: 520, y: 205, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 290, y: 250, type: 'cottage', count: 8 },
      { x: 770, y: 120, type: 'cottage', count: 10 },
      { x: 640, y: 345, type: 'cottage', count: 12 },
      { x: 1080, y: 240, type: 'tower', count: 14 },
      { x: 150, y: 450, type: 'cottage', count: 14 },
    ]),
    obstacles: terrain([
      C(hedge([[340, 450], [1260, 450]], 46)),
      rock(400, 110, 30),
    ]),
  },
  {
    id: 'molehills', name: 'Molehill Meadow', theme: 'meadow', size: 'Large', desc: 'The moles have been busy. Every road wiggles between dirt mounds.',
    buildings: mirror([
      { x: 160, y: 760, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 160, y: 500, type: 'cottage', count: 10 },
      { x: 380, y: 640, type: 'cottage', count: 10 },
      { x: 330, y: 290, type: 'tower', count: 18 },
      { x: 590, y: 790, type: 'forge', count: 15 },
      { x: 610, y: 480, type: 'cottage', level: 2, count: 20 },
      { x: 560, y: 160, type: 'cottage', count: 12 },
      { x: 780, y: 285, type: 'garden', count: 18 },
    ]),
    obstacles: terrain([
      mound(268, 700, 58, 40),
      mound(240, 395, 52, 58),
      mound(492, 562, 62, 46),
      mound(445, 222, 56, 44),
      mound(600, 640, 70, 42),
      mound(692, 385, 46, 40),
      C(mound(800, 450, 82, 70, 0.16, true)),
    ]),
  },
  {
    id: 'moat', name: 'Moonlit Moat', theme: 'night', size: 'Medium', desc: 'The Grand Cat Tree sits on an island. One bridge each, so guard yours!',
    buildings: mirror([
      { x: 170, y: 450, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 330, y: 200, type: 'cottage', count: 10 },
      { x: 330, y: 700, type: 'cottage', count: 10 },
      { x: 480, y: 450, type: 'garden', count: 14 },
      { x: 610, y: 135, type: 'tower', count: 16 },
      { x: 570, y: 770, type: 'cottage', count: 16 },
      { x: 800, y: 450, type: 'cattree', count: 45, center: true },
    ]),
    obstacles: terrain([
      C(pond(800, 450, 215, 200)),
      C(island(800, 450, 125, 112)),
      bridge(560, 360, 720, 420, 92),
      hedge([[430, 250], [470, 330]], 40),
    ]),
  },
  {
    id: 'archipelago', name: 'Cattail Archipelago', theme: 'beach', size: 'Large', desc: 'Island hopping! Every bridge is a chokepoint.',
    buildings: mirror([
      { x: 200, y: 450, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 235, y: 235, type: 'cottage', count: 8 },
      { x: 235, y: 665, type: 'cottage', count: 8 },
      { x: 570, y: 215, type: 'cottage', count: 12 },
      { x: 570, y: 685, type: 'forge', count: 14 },
      { x: 800, y: 450, type: 'cottage', level: 2, count: 26, center: true },
    ]),
    obstacles: terrain([
      C(sea([[-60, -60], [1660, -60], [1660, 960], [-60, 960]])),
      island(220, 450, 205, 330),
      island(575, 215, 140, 115),
      island(575, 685, 140, 115),
      C(island(800, 450, 150, 128)),
      bridge(345, 300, 480, 245),
      bridge(345, 600, 480, 655),
      bridge(655, 265, 735, 360),
      bridge(660, 705, 940, 705, 86),
    ]),
  },
  {
    id: 'piers', name: 'Pier Pressure', theme: 'beach', size: 'Medium', desc: 'Two bays bite into the docks. Take the pier or walk round the long way.',
    buildings: mirror([
      { x: 180, y: 300, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 200, y: 650, type: 'cottage', count: 10 },
      { x: 420, y: 470, type: 'cottage', count: 12 },
      { x: 420, y: 170, type: 'cottage', count: 8 },
      { x: 600, y: 620, type: 'tower', count: 16 },
      { x: 900, y: 180, type: 'cottage', count: 14 },
      { x: 800, y: 450, type: 'garden', count: 18, center: true },
    ]),
    obstacles: terrain([
      sea([[555, -60], [785, -60], [770, 280], [740, 405], [665, 425], [595, 300]]),
      bridge(520, 135, 815, 135, 84),
      rock(330, 790, 36),
    ]),
  },
  {
    id: 'alleys', name: 'Alley Leap', theme: 'rooftop', size: 'Medium', desc: 'Two deep alleys and one plank across each. Zig-zag to victory.',
    buildings: mirror([
      { x: 210, y: 450, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 230, y: 190, type: 'cottage', count: 8 },
      { x: 230, y: 710, type: 'cottage', count: 8 },
      { x: 390, y: 450, type: 'forge', count: 14 },
      { x: 700, y: 170, type: 'cottage', count: 12 },
      { x: 690, y: 610, type: 'cottage', count: 14 },
      { x: 800, y: 450, type: 'tower', count: 20, center: true },
    ]),
    obstacles: terrain([
      river([[530, -60], [545, 300], [560, 600], [545, 960]], 78),
      bridge(470, 205, 625, 205, 100),
    ]),
  },
  {
    id: 'chimneys', name: 'Chimney Switchback', theme: 'rooftop', size: 'Medium', desc: 'Brick walls drop from the sky. The road snakes down, across and up again.',
    buildings: mirror([
      { x: 200, y: 250, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 200, y: 650, type: 'cottage', count: 10 },
      { x: 420, y: 460, type: 'cottage', count: 12 },
      { x: 430, y: 150, type: 'tower', count: 14 },
      { x: 470, y: 770, type: 'cottage', count: 12 },
      { x: 760, y: 240, type: 'cottage', count: 14 },
      { x: 800, y: 450, type: 'garden', count: 16, center: true },
    ]),
    obstacles: terrain([
      wall([[600, -40], [600, 590]], 46),
      rock(300, 450, 30),
    ]),
  },
  {
    id: 'fjord', name: 'Frozen Fjord', theme: 'snow', size: 'Large', desc: 'An icy river winds through the peaks. Only two bridges cross it.',
    buildings: mirror([
      { x: 200, y: 260, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 190, y: 620, type: 'cottage', count: 10 },
      { x: 420, y: 430, type: 'cottage', count: 12 },
      { x: 380, y: 130, type: 'cottage', count: 8 },
      { x: 470, y: 770, type: 'forge', count: 14 },
      { x: 640, y: 570, type: 'cottage', level: 2, count: 18 },
      { x: 760, y: 800, type: 'tower', count: 16 },
    ]),
    obstacles: terrain([
      C(river([[560, -60], [640, 180], [720, 330], [800, 450], [880, 570], [960, 720], [1040, 960]], 110)),
      bridge(573, 257, 747, 163, 92),
      mound(300, 440, 50, 38),
      rock(560, 300, 34),
    ]),
  },
  {
    id: 'ridge', name: 'Snowdrift Ridge', theme: 'snow', size: 'Medium', desc: 'A great snowy ridge zig-zags across the peak. Neighbours are close, roads are long.',
    buildings: mirror([
      { x: 190, y: 520, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 210, y: 250, type: 'cottage', count: 8 },
      { x: 400, y: 730, type: 'cottage', count: 10 },
      { x: 520, y: 430, type: 'forge', count: 14 },
      { x: 680, y: 565, type: 'cottage', count: 14 },
      { x: 600, y: 105, type: 'tower', count: 16 },
      { x: 840, y: 170, type: 'cottage', count: 12 },
    ]),
    obstacles: terrain([
      C(ridge([[380, 185], [760, 300], [840, 600], [1220, 715]], 60)),
    ]),
  },
  {
    id: 'chocoriver', name: 'Chocolate River', theme: 'candy', size: 'Large', desc: 'A river of melted chocolate. Wafer bridges, gumdrop hills, sticky decisions.',
    buildings: mirror([
      { x: 200, y: 600, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 420, y: 790, type: 'cottage', count: 10 },
      { x: 450, y: 470, type: 'cottage', count: 12 },
      { x: 160, y: 390, type: 'cottage', count: 8 },
      { x: 700, y: 700, type: 'forge', count: 14 },
      { x: 640, y: 525, type: 'cottage', level: 2, count: 18 },
      { x: 920, y: 795, type: 'tower', count: 16 },
    ]),
    obstacles: terrain([
      C(river([[-60, 265], [300, 200], [600, 300], [800, 450], [1000, 600], [1300, 700], [1660, 635]], 100)),
      C(bridge(857, 374, 743, 526, 92)),
      bridge(300, 115, 300, 290, 90),
      mound(320, 655, 46, 38),
      mound(575, 640, 40, 34),
    ]),
  },
  {
    id: 'gumdrops', name: 'Gumdrop Ring', theme: 'candy', size: 'Medium', desc: 'A ring of giant gumdrops guards the Cat Tree. Slip through the gaps!',
    buildings: mirror([
      { x: 170, y: 450, type: 'cottage', level: 2, owner: 0, count: 22 },
      { x: 330, y: 210, type: 'cottage', count: 10 },
      { x: 330, y: 690, type: 'cottage', count: 10 },
      { x: 500, y: 450, type: 'cottage', count: 14 },
      { x: 600, y: 140, type: 'garden', count: 14 },
      { x: 590, y: 770, type: 'tower', count: 16 },
      { x: 800, y: 450, type: 'cattree', count: 48, center: true },
    ]),
    obstacles: terrain([
      gumdrop(982, 540, 58, 48),
      gumdrop(800, 630, 62, 46),
      gumdrop(618, 540, 58, 48),
      rock(200, 820, 30),
    ]),
  },
  {
    id: 'maze', name: 'Moonlit Maze', theme: 'night', size: 'Medium', desc: 'Hedges twist through the moonlit garden. Find the way in before they do.',
    buildings: mirror([
      { x: 180, y: 250, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 180, y: 690, type: 'cottage', count: 10 },
      { x: 470, y: 230, type: 'cottage', count: 10 },
      { x: 420, y: 465, type: 'forge', count: 14 },
      { x: 680, y: 150, type: 'cottage', count: 12 },
      { x: 640, y: 690, type: 'cottage', count: 14 },
      { x: 800, y: 285, type: 'cottage', level: 2, count: 18 },
    ]),
    obstacles: terrain([
      hedge([[370, 115], [370, 365], [570, 365]]),
      hedge([[290, 565], [525, 565], [525, 780]]),
      C(hedge([[700, 330], [700, 450], [900, 450], [900, 570]])),
    ]),
  },
];
// map pickers list each theme's classic open map first, then its terrain maps
// ---- 3 player maps (centre of the triangle a bit below the middle, so the three bases fit the field)
const T3 = [800, 540];
const at3 = (r, deg) => ({ x: Math.round(T3[0] + r * Math.cos(deg * Math.PI / 180)), y: Math.round(T3[1] + r * Math.sin(deg * Math.PI / 180)) });
const pt3 = (r, deg) => { const p = at3(r, deg); return [p.x, p.y]; };
// the lagoon map sits a little higher and tighter, so no road gets squeezed against the bottom edge
const L3 = [800, 515];
const atL = (r, deg) => ({ x: Math.round(L3[0] + r * Math.cos(deg * Math.PI / 180)), y: Math.round(L3[1] + r * Math.sin(deg * Math.PI / 180)) });
const ptL = (r, deg) => { const p = atL(r, deg); return [p.x, p.y]; };
MAPS.push(
  {
    id: 'tripaws', rot3: T3, name: 'Three Paws', theme: 'night', size: 'Medium', players: 3, desc: 'Three clowders, one Cat Tree. Every neighbour is the same distance away.',
    buildings: rot3([
      { ...at3(430, -90), type: 'cottage', level: 2, owner: 0, count: 20 },
      { ...at3(290, -122), type: 'cottage', count: 8 },
      { ...at3(290, -58), type: 'cottage', count: 8 },
      { ...at3(205, -90), type: 'tower', count: 14 },
      { ...at3(255, -30), type: 'garden', count: 12 },
      { x: T3[0], y: T3[1], type: 'cattree', count: 45, center: true },
    ], ...T3),
  },
  {
    id: 'trilagoon', rot3: L3, name: 'Tri-Pond Lagoon', theme: 'beach', size: 'Medium', players: 3, desc: 'A lagoon with an island in the middle. Each of you gets one bridge to it.',
    buildings: rot3([
      { ...atL(405, -90), type: 'cottage', level: 2, owner: 0, count: 20 },
      { ...atL(280, -126), type: 'cottage', count: 8 },
      { ...atL(280, -54), type: 'cottage', count: 8 },
      { ...atL(240, -90), type: 'forge', count: 12 },
      { x: L3[0], y: L3[1], type: 'cattree', count: 45, center: true },
    ], ...L3),
    obstacles: terrain3([
      C(pond(L3[0], L3[1], 165)),
      C(island(L3[0], L3[1], 95)),
      { t: 'bridge', pts: [ptL(78, -90), ptL(198, -90)], w: 86 },
    ], ...L3),
  },
  {
    id: 'triridge', rot3: T3, name: 'Three Ridges', theme: 'snow', size: 'Medium', players: 3, desc: 'Snowy ridges split the peak three ways. Squeeze past the middle or go the long way round.',
    buildings: rot3([
      { ...at3(430, -90), type: 'cottage', level: 2, owner: 0, count: 20 },
      { ...at3(300, -124), type: 'cottage', count: 8 },
      { ...at3(300, -56), type: 'cottage', count: 8 },
      { ...at3(215, -90), type: 'cottage', level: 2, count: 16 },
    ], ...T3),
    obstacles: terrain3([
      C(mound(T3[0], T3[1], 88, 80, 0.12, false)),
      ridge([pt3(205, -30), pt3(345, -30)], 56),
    ], ...T3),
  },
);
// ---- 3 player maps on the whole field (not turned around a point; seats kept fair with roads and strays)
MAPS.push(
  {
    id: 'trifork', name: 'Forked River', theme: 'beach', size: 'Large', players: 3,
    desc: 'A river splits the two eastern docks from the Cat Tree to the east ford. The west holds the whole shore.',
    buildings: pair3([
      { x: 130, y: 450, type: 'cottage', level: 2, owner: 0, count: 20, axis: true },
      { x: 330, y: 450, type: 'cottage', count: 12, axis: true },
      { x: 180, y: 185, type: 'cottage', count: 8 },
      { x: 430, y: 255, type: 'tower', count: 14 },
      { x: 590, y: 130, type: 'forge', count: 14 },
      { x: 1100, y: 170, type: 'cottage', level: 2, owner: 1, count: 20 },
      { x: 1340, y: 110, type: 'cottage', count: 8 },
      { x: 1290, y: 320, type: 'cottage', count: 10 },
      { x: 1500, y: 250, type: 'cottage', count: 9 },
      { x: 900, y: 315, type: 'tower', count: 14 },
      { x: 1500, y: 95, type: 'garden', count: 12 },
      { x: 655, y: 450, type: 'cattree', count: 45, axis: true },
    ], 'y'),
    obstacles: terrainPair([
      C(river([[765, 450], [1420, 450]], 90)),
    ], 'y'),
  },
  {
    id: 'tripass', name: 'Frostbite Pass', theme: 'snow', size: 'Large', players: 3,
    desc: 'Two long ridges cut the slopes. Climb past their tops or sneak round their feet by the corners.',
    buildings: pair3([
      { x: 800, y: 790, type: 'cottage', level: 2, owner: 0, count: 20, axis: true },
      { x: 800, y: 610, type: 'cottage', count: 8, axis: true },
      { x: 620, y: 770, type: 'cottage', count: 7 },
      { x: 560, y: 600, type: 'tower', count: 10 },
      { x: 300, y: 240, type: 'cottage', level: 2, owner: 1, count: 20 },
      { x: 130, y: 120, type: 'cottage', count: 9 },
      { x: 610, y: 150, type: 'cottage', count: 11 },
      { x: 140, y: 420, type: 'cottage', count: 12 },
      { x: 420, y: 380, type: 'tower', count: 13 },
      { x: 130, y: 640, type: 'forge', count: 15 },
      { x: 800, y: 300, type: 'cattree', count: 40, axis: true },
      { x: 800, y: 130, type: 'cottage', count: 14, axis: true },
    ], 'x'),
    obstacles: terrainPair([
      ridge([[330, 700], [690, 290]], 56),
      rock(560, 450, 30),
    ], 'x'),
  },
  {
    id: 'trihedge', name: 'Moonlit Hedgerows', theme: 'night', size: 'Large', players: 3,
    desc: 'A long hedge runs from the Cat Tree to the west gate. Two gardens share the west; the east stands alone.',
    buildings: finish([
      { x: 1470, y: 430, type: 'cottage', level: 2, owner: 1, count: 20 },
      { x: 1270, y: 450, type: 'cottage', count: 11 },
      { x: 1420, y: 170, type: 'cottage', count: 7 },
      { x: 1420, y: 720, type: 'cottage', count: 7 },
      { x: 1170, y: 250, type: 'tower', count: 13 },
      { x: 1170, y: 650, type: 'tower', count: 13 },
      { x: 520, y: 170, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 270, y: 110, type: 'cottage', count: 11 },
      { x: 310, y: 330, type: 'cottage', count: 14 },
      { x: 100, y: 260, type: 'cottage', count: 12 },
      { x: 720, y: 330, type: 'tower', count: 18 },
      { x: 110, y: 90, type: 'garden', count: 15 },
      { x: 470, y: 745, type: 'cottage', level: 2, owner: 2, count: 20 },
      { x: 230, y: 790, type: 'cottage', count: 6 },
      { x: 290, y: 600, type: 'cottage', count: 7 },
      { x: 100, y: 660, type: 'cottage', count: 6 },
      { x: 680, y: 610, type: 'tower', count: 9 },
      { x: 720, y: 820, type: 'garden', count: 8 },
      { x: 945, y: 460, type: 'cattree', count: 40 },
      { x: 1000, y: 120, type: 'forge', count: 18 },
      { x: 1000, y: 800, type: 'forge', count: 10 },
    ]),
    obstacles: [
      hedge([[840, 462], [520, 466], [170, 476]]),
      pond(250, 470, 60, 40),
    ],
  },
  {
    id: 'trichoco', name: 'Chocolate Falls', theme: 'candy', size: 'Large', players: 3,
    desc: 'A chocolate river pours from the Cat Tree to the east shore. Gumdrop hills shelter the west.',
    buildings: finish([
      { x: 170, y: 390, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 380, y: 450, type: 'cottage', count: 13 },
      { x: 150, y: 120, type: 'cottage', count: 10 },
      { x: 180, y: 640, type: 'cottage', count: 11 },
      { x: 450, y: 200, type: 'tower', count: 17 },
      { x: 470, y: 640, type: 'tower', count: 17 },
      { x: 1170, y: 160, type: 'cottage', level: 2, owner: 1, count: 20 },
      { x: 1370, y: 110, type: 'cottage', count: 7 },
      { x: 1330, y: 320, type: 'cottage', count: 9 },
      { x: 960, y: 140, type: 'cottage', count: 7 },
      { x: 980, y: 340, type: 'tower', count: 13 },
      { x: 1500, y: 230, type: 'garden', count: 11 },
      { x: 1140, y: 740, type: 'cottage', level: 2, owner: 2, count: 20 },
      { x: 1470, y: 790, type: 'cottage', count: 7 },
      { x: 1380, y: 600, type: 'cottage', count: 9 },
      { x: 980, y: 800, type: 'cottage', count: 8 },
      { x: 990, y: 640, type: 'tower', count: 13 },
      { x: 700, y: 470, type: 'cattree', count: 40 },
      { x: 560, y: 120, type: 'forge', count: 17 },
      { x: 630, y: 790, type: 'garden', count: 13 },
    ]),
    obstacles: [
      river([[810, 480], [1050, 480], [1250, 460], [1410, 470]], 92),
      gumdrop(300, 230, 46),
      gumdrop(330, 560, 40),
      gumdrop(560, 360, 34),
    ],
  },
  {
    id: 'trichimney', name: 'Chimney Diagonal', theme: 'rooftop', size: 'Large', players: 3,
    desc: 'An alley cuts from the Cat Tree up to the north-east corner. Three gangs, three very different rooftops.',
    buildings: finish([
      { x: 200, y: 770, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 120, y: 560, type: 'cottage', count: 11 },
      { x: 430, y: 810, type: 'cottage', count: 10 },
      { x: 450, y: 630, type: 'cottage', count: 14 },
      { x: 280, y: 420, type: 'tower', count: 17 },
      { x: 620, y: 720, type: 'tower', count: 17 },
      { x: 980, y: 140, type: 'cottage', level: 2, owner: 1, count: 20 },
      { x: 760, y: 110, type: 'cottage', count: 5 },
      { x: 1125, y: 90, type: 'cottage', count: 6 },
      { x: 950, y: 340, type: 'cottage', count: 7 },
      { x: 750, y: 300, type: 'tower', count: 9 },
      { x: 1245, y: 165, type: 'garden', count: 8 },
      { x: 1240, y: 720, type: 'cottage', level: 2, owner: 2, count: 20 },
      { x: 1450, y: 590, type: 'cottage', count: 9 },
      { x: 1480, y: 790, type: 'cottage', count: 11 },
      { x: 1180, y: 520, type: 'cottage', count: 13 },
      { x: 950, y: 790, type: 'tower', count: 17 },
      { x: 1490, y: 420, type: 'forge', count: 14 },
      { x: 790, y: 530, type: 'cattree', count: 40 },
      { x: 130, y: 130, type: 'garden', count: 17 },
    ]),
    obstacles: [
      sea([[870, 500], [920, 450], [1370, 160], [1415, 205], [960, 530], [905, 560]]),
      wall([[430, 470], [560, 380]], 44),
      rock(560, 560, 26),
    ],
  },
);
// ---- 4 player maps (mirrored into all four corners)
MAPS.push(
  {
    id: 'fourcorners', name: 'Four Corners', theme: 'meadow', size: 'Large', players: 4, desc: 'One corner each and a Cat Tree in the middle. Make friends... briefly.',
    buildings: mirror4([
      { x: 170, y: 140, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 170, y: 340, type: 'cottage', count: 8 },
      { x: 430, y: 300, type: 'cottage', count: 12 },
      { x: 650, y: 160, type: 'tower', count: 14 },
      { x: 600, y: 360, type: 'forge', count: 14 },
      { x: 800, y: 250, type: 'cottage', count: 15 },
      { x: 330, y: 450, type: 'cottage', count: 12 },
      { x: 800, y: 450, type: 'cattree', count: 50 },
    ]),
  },
  {
    id: 'quarters', name: 'Rooftop Quarters', theme: 'rooftop', size: 'Medium', players: 4, desc: 'Four rooftops, four cat gangs, no rules.',
    buildings: mirror4([
      { x: 180, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 180, y: 360, type: 'cottage', count: 8 },
      { x: 420, y: 160, type: 'cottage', count: 10 },
      { x: 450, y: 340, type: 'tower', count: 14 },
      { x: 680, y: 200, type: 'cottage', count: 14 },
      { x: 800, y: 330, type: 'garden', count: 16 },
      { x: 620, y: 450, type: 'forge', count: 15 },
    ]),
  },
  {
    id: 'crossroads', name: 'River Crossroads', theme: 'beach', size: 'Large', players: 4, desc: 'Rivers split the docks into four. One bridge to each neighbour, and a Cat Tree where the rivers end.',
    buildings: mirror4([
      { x: 160, y: 140, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 400, y: 120, type: 'cottage', count: 8 },
      { x: 160, y: 330, type: 'cottage', count: 8 },
      { x: 450, y: 290, type: 'cottage', count: 12 },
      { x: 640, y: 200, type: 'tower', count: 14 },
      { x: 560, y: 340, type: 'forge', count: 14 },
      { x: 800, y: 450, type: 'cattree', count: 48 },
    ]),
    obstacles: terrain4([
      river([[800, -60], [800, 290]], 90),
      river([[-60, 450], [610, 450]], 90),
      bridge(722, 150, 878, 150, 86),
      bridge(300, 372, 300, 528, 86),
    ]),
  },
  {
    id: 'clover', name: 'Hedge Clover', theme: 'night', size: 'Large', players: 4, desc: 'Hedges ring the middle cottage and fence off each corner. Find the gaps.',
    buildings: mirror4([
      { x: 170, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 420, y: 130, type: 'cottage', count: 8 },
      { x: 160, y: 340, type: 'cottage', count: 10 },
      { x: 430, y: 320, type: 'cottage', count: 12 },
      { x: 640, y: 170, type: 'garden', count: 14 },
      { x: 800, y: 450, type: 'cottage', level: 2, count: 26 },
    ]),
    obstacles: terrain4([
      hedge([[585, 392], [612, 352], [652, 320], [720, 292]]),
      hedge([[800, 30], [800, 205]]),
      hedge([[30, 450], [255, 450]]),
    ]),
  },
  {
    id: 'frozenlake', name: 'Frozen Lake', theme: 'snow', size: 'Large', players: 4, desc: 'The Cat Tree sits on an island in a frozen lake. Four bridges, one from every corner.',
    buildings: mirror4([
      { x: 170, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 170, y: 370, type: 'cottage', count: 9 },
      { x: 420, y: 130, type: 'cottage', count: 9 },
      { x: 440, y: 330, type: 'tower', count: 14 },
      { x: 650, y: 140, type: 'cottage', count: 12 },
      { x: 300, y: 450, type: 'forge', count: 14 },
      { x: 800, y: 450, type: 'cattree', count: 50 },
    ]),
    obstacles: terrain4([
      pond(800, 450, 235, 175),
      island(800, 450, 110, 90),
      bridge(722, 402, 592, 322, 80),
      rock(560, 120, 28),
    ]),
  },
  {
    id: 'gumdrophills', name: 'Gumdrop Hills', theme: 'candy', size: 'Medium', players: 4, desc: 'Gumdrop hills hide every corner from its neighbours. A big cottage waits in the middle.',
    buildings: mirror4([
      { x: 170, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 160, y: 370, type: 'cottage', count: 9 },
      { x: 420, y: 140, type: 'cottage', count: 10 },
      { x: 450, y: 350, type: 'garden', count: 12 },
      { x: 650, y: 240, type: 'cottage', count: 12 },
      { x: 800, y: 110, type: 'tower', count: 14 },
      { x: 300, y: 450, type: 'cottage', count: 12 },
      { x: 800, y: 450, type: 'cottage', level: 2, count: 26 },
    ]),
    obstacles: terrain4([
      gumdrop(640, 380, 48),
      gumdrop(300, 290, 40),
      gumdrop(590, 105, 34),
    ]),
  },
  {
    id: 'rooftopring', name: 'Rooftop Ring', theme: 'rooftop', size: 'Large', players: 4, desc: 'Brick walls ring the Cat Tree. The gates face your neighbours, not you.',
    buildings: mirror4([
      { x: 170, y: 150, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 170, y: 380, type: 'cottage', count: 9 },
      { x: 420, y: 130, type: 'cottage', count: 9 },
      { x: 400, y: 340, type: 'tower', count: 14 },
      { x: 800, y: 130, type: 'cottage', count: 13 },
      { x: 220, y: 450, type: 'forge', count: 14 },
      { x: 680, y: 350, type: 'cottage', count: 10 },
      { x: 800, y: 450, type: 'cattree', count: 45 },
    ]),
    obstacles: terrain4([
      wall([[650, 240], [560, 240], [560, 335]], 44),
      rock(600, 520, 26),
    ]),
  },
  {
    id: 'grandmeadow', name: 'Grand Meadow', theme: 'meadow', size: 'Large', players: 4, desc: 'Wide open fields packed with cottages. Grow fast and keep an eye on both neighbours.',
    buildings: mirror4([
      { x: 160, y: 140, type: 'cottage', level: 2, owner: 0, count: 20 },
      { x: 160, y: 350, type: 'cottage', count: 8 },
      { x: 380, y: 120, type: 'cottage', count: 8 },
      { x: 390, y: 320, type: 'cottage', count: 12 },
      { x: 600, y: 190, type: 'tower', count: 14 },
      { x: 610, y: 380, type: 'cottage', count: 14 },
      { x: 800, y: 110, type: 'cottage', count: 15 },
      { x: 260, y: 450, type: 'garden', count: 13 },
      { x: 800, y: 450, type: 'cattree', count: 50 },
    ]),
  },
);
// map pickers list 2-player maps, then 3, then 4; each theme's classic open map first, then its terrain maps
{ const order = Object.keys(THEMES); MAPS.sort((a, b) => ((a.players || 2) - (b.players || 2)) || (order.indexOf(a.theme) - order.indexOf(b.theme))); }
export const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));

// Seeded random symmetric map
export function randomMap(seed) {
  const rnd = mulberry32(seed >>> 0);
  const themes = Object.keys(THEMES);
  const theme = themes[Math.floor(rnd() * themes.length)];
  const half = [{ x: 150 + rnd() * 80, y: 200 + rnd() * 500, type: 'cottage', level: 2, owner: 0, count: 20 }];
  const n = 5 + Math.floor(rnd() * 4);
  const types = ['cottage', 'cottage', 'cottage', 'cottage', 'tower', 'forge', 'garden'];
  let tries = 0;
  while (half.length < n + 1 && tries++ < 600) {
    const x = 120 + rnd() * 600, y = 130 + rnd() * 640;
    const ok = half.every(b => Math.hypot(b.x - x, b.y - y) > 150 && Math.hypot((WORLD_W - b.x) - x, (WORLD_H - b.y) - y) > 150)
      && Math.hypot(WORLD_W - x - x, WORLD_H - y - y) > 160;
    if (!ok) continue;
    const t = types[Math.floor(rnd() * types.length)];
    half.push({ x, y, type: t, count: 6 + Math.floor(rnd() * 14) });
  }
  if (rnd() < 0.5) half.push({ x: 800, y: 450, type: rnd() < 0.5 ? 'cattree' : 'cottage', level: 2, count: 30 + Math.floor(rnd() * 15), center: true });
  return { id: 'random', name: 'Wild Lands #' + (seed % 1000), theme, size: 'Random', desc: 'A freshly generated battlefield.', buildings: mirror(half), obstacles: randomTerrain(rnd, theme, half) };
}
// A few lumps and ponds dropped between the buildings. Every piece keeps a wide gap to the buildings, the edges and
// the other pieces, so no road is ever cut off.
function randomTerrain(rnd, theme, half) {
  if (rnd() < 0.3) return [];
  const kinds = theme === 'rooftop' ? ['rock', 'mound', 'mound'] : theme === 'beach' ? ['pond', 'mound', 'rock'] : ['mound', 'pond', 'rock', 'mound'];
  const blds = half.flatMap(b => [b, { x: WORLD_W - b.x, y: WORLD_H - b.y }]);
  const placed = [], out = [];
  const want = 2 + Math.floor(rnd() * 3);
  for (let tries = 0; placed.length < want && tries < 400; tries++) {
    const r = 42 + rnd() * 38, R = r * 1.25;
    const x = 110 + R + rnd() * (WORLD_W / 2 - 110 - R), y = 110 + R + rnd() * (WORLD_H - 220 - 2 * R);
    if (blds.some(b => Math.hypot(b.x - x, b.y - y) < R + 100)) continue;
    if (Math.hypot(WORLD_W - 2 * x, WORLD_H - 2 * y) < 2 * R + 120) continue; // too close to its own mirror image
    if (placed.some(o => Math.hypot(o.x - x, o.y - y) < o.R + R + 120 || Math.hypot(WORLD_W - o.x - x, WORLD_H - o.y - y) < o.R + R + 120)) continue;
    placed.push({ x, y, R });
    const k = kinds[Math.floor(rnd() * kinds.length)], X = Math.round(x), Y = Math.round(y);
    out.push(k === 'pond' ? pond(X, Y, Math.round(r * 1.15), Math.round(r * 0.75), Math.round(rnd() * 10) / 10 - 0.5) : k === 'rock' ? rock(X, Y, Math.round(r * 0.75)) : mound(X, Y, Math.round(r), Math.round(r * 0.8)));
  }
  return terrain(out);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- AI difficulty ----------------
export const AI_LEVELS = {
  easy:   { name: 'Kitten',    think: 3.4, aggression: 0.3,  spellUse: 0.2,  upgrade: 0.25, mistakes: 0.4,  coinsWin: 120, coinsLoss: 45,  bonusProd: -0.25 },
  normal: { name: 'House Cat', think: 2.0, aggression: 0.6,  spellUse: 0.55, upgrade: 0.55, mistakes: 0.15, coinsWin: 210, coinsLoss: 75,  bonusProd: -0.08 },
  hard:   { name: 'Alley Boss', think: 1.0, aggression: 0.85, spellUse: 0.9, upgrade: 0.8,  mistakes: 0.04, coinsWin: 300, coinsLoss: 105, bonusProd: 0.05 },
  insane: { name: 'Lion King', think: 0.5, aggression: 1.0,  spellUse: 1.0,  upgrade: 0.95, mistakes: 0.0,  coinsWin: 420, coinsLoss: 135, bonusProd: 0.2 },
};

// ---------------- Campaign ----------------
export const CAMPAIGN = [
  { id: 1,  name: 'First Whiskers',    map: 'meadow',   ai: 'easy',   enemy: 'pounce', reward: 300, tip: 'Drag from your cottage to a stray building to send cats.' },
  { id: 2,  name: 'Tower Trouble',     map: 'rooftops', ai: 'easy',   enemy: 'kibble',   reward: 300, tip: 'Towers shoot cats walking past. Send a big group at once!' },
  { id: 3,  name: 'Snowball Fight',    map: 'snowy',    ai: 'easy',   enemy: 'zap',      reward: 360, tip: 'Tap your cottage to upgrade it. Upgraded cottages make kittens faster.' },
  { id: 4,  name: 'Garden Party',      map: 'moonlit',  ai: 'normal', enemy: 'grimsby',  reward: 390, tip: 'Catnip is scarce. Gardens refill it much faster, and skills win battles!' },
  { id: 5,  name: 'Dockside Dash',     map: 'docks',    ai: 'normal', enemy: 'paradox',  reward: 420, tip: 'Forges make all your cats hit harder.' },
  { id: 6,  name: 'Sugar Rush',        map: 'candy',    ai: 'normal', enemy: 'mischief', reward: 450, tip: 'The Grand Cat Tree is worth fighting for.' },
  { id: 7,  name: 'Ninja Night',       map: 'maze',     ai: 'hard',   enemy: 'paprika',  reward: 510, tip: 'Cats walk around hedges and ponds. Drag onto a building to see the road they will take.' },
  { id: 8,  name: 'Chonk Wall',        map: 'ridge',    ai: 'hard',   enemy: 'snowpaw',  reward: 540, tip: 'Purr Power stars make your buildings much tougher. Never attack into a rival with more stars than you.' },
  { id: 9,  name: 'Space Race',        map: 'alleys',   ai: 'hard',   enemy: 'bristle',  reward: 600, tip: 'Swipe across several of your buildings to send from all of them at once.' },
  { id: 10, name: 'Mad Science',       map: 'archipelago', ai: 'hard', enemy: 'velvet',   reward: 660, tip: 'Bridges are chokepoints. Spread out so one area spell cannot hit everything.' },
  { id: 11, name: 'Witching Hour',     map: 'chocoriver', ai: 'insane', enemy: 'graveclaw', reward: 750, tip: 'The enemy grows stronger. So do you. Convert buildings to change their job.' },
  { id: 12, name: 'The Keyboard King', map: 'hedgerow', ai: 'insane', enemy: 'hexley',   reward: 1200, tip: 'The final boss. Show them who the real top cat is!' },
];

// ---------------- Achievements ----------------
export const ACHIEVEMENTS = [
  { id: 'firstwin',   name: 'First Paw',        desc: 'Win your first match.',                     reward: 300 },
  { id: 'online1',    name: 'Friendly Fire',    desc: 'Play an online match with a friend.',       reward: 300 },
  { id: 'online5',    name: 'Neighborhood Boss',desc: 'Win 5 online matches.',                     reward: 750 },
  { id: 'maxcottage', name: 'Dream House',      desc: 'Upgrade a cottage to level 5.',             reward: 300 },
  { id: 'capture50',  name: 'Conqueror',        desc: 'Capture 50 buildings (total).',             reward: 450 },
  { id: 'spells50',   name: 'Spell Slinger',    desc: 'Cast 50 spells (total).',                   reward: 450 },
  { id: 'heroes5',    name: 'Cat Collector',    desc: 'Unlock 5 heroes.',                          reward: 750 },
  { id: 'flawless',   name: 'Untouchable',      desc: 'Win without losing a single building.',     reward: 600 },
  { id: 'speedy',     name: 'Zoomies',          desc: 'Win a match in under 3 minutes.',           reward: 600 },
  { id: 'insane',     name: 'Lion Tamer',       desc: 'Beat the Lion King (Insane) AI.',           reward: 900 },
  { id: 'campaign',   name: 'Legend of the Litter', desc: 'Finish the whole campaign.',            reward: 1500 },
  { id: 'fashion',    name: 'Cat Walk',         desc: 'Own 5 cosmetic items.',                     reward: 300 },
  { id: 'army200',    name: 'Crazy Cat Lady',   desc: 'Have 200 cats at once.',                    reward: 450 },
];

export const RULES = [
  { id: 'zoomies',  icon: '⚡', name: 'Zoomies',        desc: 'All cats run 50% faster.' },
  { id: 'frenzy',   icon: '🌿', name: 'Catnip Frenzy',  desc: 'Catnip refills twice as fast. Spells everywhere!' },
  { id: 'boom',     icon: '🍼', name: 'Kitten Boom',    desc: 'Buildings make kittens 50% faster.' },
  { id: 'bigstart', icon: '🏰', name: 'Big Start',      desc: 'Every building starts with double the cats.' },
];

// fish coin income (tripled in v1.3)
export const COINS = { tutorial: 600, onlineWin: 450, onlineLoss: 180, firstWinOfDay: 300, dailyGift: 150, perfMax: 180, perfPerCapture: 6, perfPerSpell: 3, newStar: 120, levelUpBase: 150, levelUpPerLevel: 15 };
