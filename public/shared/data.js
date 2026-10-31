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
// Only two heroes have a skill that shows them: Doctor Whirl (Spy Eye) and Morrow (Food Poisoning).
export const TURRET = { range: 195, fireEvery: 0.95 };
// cost (in cats) to convert a building into another type (resets to level 1)
export const CONVERT_COST = { cottage: 10, tower: 20, forge: 20, garden: 20 };

// ---------------- Clans & Heroes ----------------
export const CLANS = {
  royal:  { name: 'Fallen Crown', color: '#ffcf4d', icon: '👑', desc: 'Rusty knights and old legends who still think they run the block.' },
  tech:   { name: 'Glitch Gang',  color: '#3de0ff', icon: '📡', desc: 'Hackers, mad scientists and stuff that fell out of the sky.' },
  mystic: { name: 'Hex Coven',    color: '#b08cff', icon: '🔮', desc: 'Witches, hexes and weird moon magic.' },
  alley:  { name: 'Gutter Punks', color: '#ff8a3d', icon: '🤘', desc: 'Back-street punks, ghosts and grave-robbers.' },
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
  mul: ['Defense', 'x'], spd: ['Speed', '+%'], atk: ['Attack', 'x%'], slow: ['Speed', '%'], prod: ['Kitten-making', '%'],
  boost: ['Kitten-making', 'x'], tlv: ['Tower level', 'n'], splash: ['Blast', 'n'], fill: ['Arrive in', 's'], back: ['Rewind', 's'],
  drop: ['Defense lost', '%'], delay: ['Delay', 's'], range: ['Range', '+%'], rate: ['Cats lost', '/s'], chance: ['Spread chance', '%'],
  bld: ['Buildings', 'n'], slowx: ['Slower', 'x'], mult: ['Hits', 'x'], clone: ['Extra copies', '%'], purr: ['Purr per cat', 'n'],
  split: ['Come back', '%'],
};

const P_ = v => Math.round(v * 100) + '%';
const UP = v => '+' + Math.round((v - 1) * 100) + '%';
// target kinds: own | enemy | neutral | notown | owned (any player's) | any | area | global (see game.js)
const H = list => list.map(h => ({ ...h, spells: h.spells.map((s, k) => ({ ...s, slot: k, cost: SLOTS[k].cost, cd: SLOTS[k].cd[0], lv: { cd: SLOTS[k].cd, ...(s.lv || {}) } })) }));
export const HEROES = H([
  // ================================================================ Royal Court
  {
    id: 'barnaby', name: 'Sir Barnaby', title: 'The Rusty Knight', clan: 'royal', cost: 0, fur: 'gray', role: 'Defense · Easy',
    blurb: 'An armoured knight in a castle-tower crown. Holds the walls, cheers the army on, then strikes everywhere at once.',
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
    id: 'mortar', name: 'Major Mortar', title: 'The Old Artillery Cat', clan: 'royal', cost: 0, fur: 'calico', role: 'Defense · Easy',
    blurb: 'A veteran gunner with goggles and a steel helmet. Builds towers wherever trouble shows up, then makes them go boom.',
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
    id: 'hammerpaw', name: 'Hammerpaw', title: 'The Rogue Builder', clan: 'royal', cost: 2000, fur: 'orange', role: 'Economy · Medium',
    blurb: 'Hard hat on, pencil behind the ear. Builds for free, moves whole villages of kittens and keeps everyone in line.',
    spells: [
      { id: 'builder', name: 'Free Build', icon: '🔨', target: 'own', fx: 'build',
        desc: () => 'Tap one of your buildings: its next upgrade or convert (within 30s) costs no cats at all.' },
      { id: 'prodshift', name: 'Kitten Express', icon: '🚚', target: 'own', fx: 'transfer', lv: { dur: [8, 9, 10, 11, 12] },
        desc: s => `For ${s.dur}s every kitten your other cottages make appears in this building instead.` },
      { id: 'evenout', name: 'Fair Shares', icon: '⚖️', target: 'owned', fx: 'mean',
        desc: () => 'Pick any player\'s building, yours or a rival\'s: every building that player owns ends up with the same number of cats (their average).' },
      { id: 'goldpurr', name: 'Golden Purr', icon: '🏆', target: 'global', fx: 'gold', lv: { dur: [3, 3.5, 4, 4.5, 5] },
        desc: s => `Your Purr Power shines at the full 5 stars for ${s.dur}s, then goes back to what it was.` },
    ],
  },
  {
    id: 'cinder', name: 'General Cinder', title: 'The Fire Marshal', clan: 'royal', cost: 11500, fur: 'ginger', role: 'Attack · Hard',
    blurb: 'Plays with fire, and with everybody\'s nerves. Brilliant when you\'re behind.',
    spells: [
      { id: 'shackles', name: 'Shackles', icon: '⛓️', target: 'enemy', fx: 'shackle', lv: { dur: [8, 9, 10, 11, 12] },
        desc: s => `An enemy building can't send any cats out for ${s.dur}s.` },
      { id: 'evenpurr', name: 'Even Purr', icon: '🤝', target: 'global', fx: 'even',
        desc: () => 'Every player\'s Purr Power becomes the average of everyone\'s. Cheap, and huge when your rival is far ahead.' },
      { id: 'fury', name: 'Battle Fury', icon: '😤', target: 'area', fx: 'fury', lv: { atk: [1.5, 1.55, 1.6, 1.65, 1.75], spd: [1.1, 1.15, 1.2, 1.25, 1.3], r: [125, 137, 150, 162, 175] },
        desc: s => `Every cat walking in the area hits ×${s.atk} as hard and runs ${UP(s.spd)} faster until it arrives. Anyone's cats, so aim carefully.` },
      { id: 'firering', name: 'Ring of Fire', icon: '🔥', target: 'area', fx: 'fire', lv: { cap: [100, 125, 150, 200, 1000], r: [100, 110, 120, 130, 140] },
        desc: s => `A ring of fire spreads out from the spot and knocks out up to ${s.cap} enemy cats walking in the area. Knockouts from it give no Purr Power.` },
    ],
  },
  {
    id: 'mossbeard', name: 'Elder Mossbeard', title: 'Hermit of the Deep Caves', clan: 'royal', cost: 12500, fur: 'graytabby', role: 'All-round · Medium',
    blurb: 'The oldest cat around. Lived for years in the caves with slugs and moths for company. Wants peace, in his own way.',
    spells: [
      { id: 'maneuver', name: 'Snatch Squad', icon: '🫳', target: 'notown', fx: 'snatch',
        desc: () => '25% of the cats in an enemy or stray building switch to your side and walk to your nearest building.' },
      { id: 'lifecycle', name: 'Circle of Life', icon: '♻️', target: 'own', fx: 'cycle', lv: { dur: [10, 11, 12, 13.5, 15] },
        desc: s => `For ${s.dur}s, if attackers knock every cat out of your building it doesn't fall: it drops one level and 20 fresh cats pop up inside. Level 2+ buildings only.` },
      { id: 'slugs', name: 'Slug Army', icon: '🐛', target: 'area', fx: 'slug', lv: { r: [100, 107, 115, 122, 130], slow: [0.6, 0.57, 0.55, 0.52, 0.5], split: [0.25, 0.3, 0.35, 0.4, 0.5] },
        desc: s => `Your cats walking in the area turn into slugs until they arrive. They leave a sticky trail that slows enemy cats to ${P_(s.slow)} speed, and when slugs are knocked out some split in two and keep going (about ${P_(s.split)} come back).` },
      { id: 'moths', name: 'Moth Dome', icon: '🦋', target: 'own', fx: 'moths', lv: { cap: [60, 70, 80, 90, 100], r: [150, 160, 170, 185, 200] },
        desc: s => `A dome of moths grows around your building (up to ${s.r} wide) and knocks out enemy cats under it, up to ${s.cap}. It eats 2 of the building's cats a second and ends when they run out. A cottage makes no kittens meanwhile.` },
    ],
  },
  {
    id: 'thunderpurr', name: 'King Thunderpurr', title: 'Legend of a Thousand Brawls', clan: 'royal', cost: 19500, fur: 'golden', role: 'All-round · Medium',
    blurb: 'The warlord from the old stories, in a winged golden helmet. Young cats still try to fight like him. Few can.',
    spells: [
      { id: 'toarms', name: 'To Arms!', icon: '🗡️', target: 'own', fx: 'arms', lv: { dur: [6, 7, 8, 9, 10], atk: [1.3, 1.35, 1.4, 1.45, 1.5] },
        desc: s => `For ${s.dur}s every cat sent out of your building carries extra weapons and hits ×${s.atk} as hard.` },
      { id: 'shrink', name: 'Teeny Tiny', icon: '🔍', target: 'enemy', fx: 'shrink', lv: { dur: [8, 9, 10, 11, 12], atk: [0.8, 0.77, 0.75, 0.72, 0.7], slow: [0.8, 0.77, 0.75, 0.72, 0.7] },
        desc: s => `For ${s.dur}s an enemy building shrinks: its cats fight at only ${P_(s.atk)} strength, and cats it sends out also walk at ${P_(s.slow)} speed.` },
      { id: 'bfg', name: 'Kitty Cannon', icon: '🎯', target: 'own', fx: 'cannon', lv: { dur: [6, 7, 8, 9, 10], atk: [1.3, 1.35, 1.4, 1.45, 1.5] },
        desc: s => `For ${s.dur}s your building is a cannon: cats sent from it ride cannonballs straight to their target at double speed and hit ×${s.atk} as hard. Towers can't shoot them and skills can't touch them. Not on the Grand Cat Tree.` },
      { id: 'fortify', name: 'Fortress', icon: '🏰', target: 'global', fx: 'fort', lv: { dur: [5, 5.5, 6, 6.5, 7] },
        desc: s => `For ${s.dur}s every building you own becomes a top-level tower: it shoots and defends like one, but stops its normal job meanwhile.` },
    ],
  },
  // ================================================================ Tech Whiskers
  {
    id: 'nova', name: 'Commander Nova', title: 'Rogue Warp Pilot', clan: 'tech', cost: 750, fur: 'white', role: 'All-round · Easy',
    blurb: 'Beams cats wherever they\'re needed and hides them where they aren\'t expected.',
    spells: [
      { id: 'beam', name: 'Beam Me Up', icon: '🛸', target: 'own', fx: 'beam', lv: { pct: [0.5, 0.55, 0.6, 0.65, 0.75] },
        desc: s => `Charge up one of your buildings. Within 30s, send cats from it to another of your buildings: ${P_(s.pct)} of its cats beam straight there in 2s.` },
      { id: 'cloak', name: 'Cloak', icon: '🫥', target: 'area', fx: 'cloak', lv: { dur: [10, 11, 12, 13.5, 15], r: [150, 175, 200, 225, 250] },
        desc: s => `Your cats walking in the area turn invisible for ${s.dur}s: towers can't see them and enemy squads walk right past.` },
      { id: 'uturn', name: 'U-Turn Field', icon: '↩️', target: 'area', fx: 'uturn', lv: { dur: [1.5, 2, 2.5, 3, 4], r: [100, 112, 125, 137, 150] },
        desc: s => `For ${s.dur}s, enemy cats walking into the area turn around and go home.` },
      { id: 'pods', name: 'Drop Pods', icon: '🚀', target: 'own', fx: 'pods', lv: { n: [75, 80, 85, 90, 100], fill: [7, 6, 5.5, 5, 4] },
        desc: s => `${s.n} fresh cats beam down into your building over ${s.fill}s.` },
    ],
  },
  {
    id: 'tickstorm', name: 'Count Tickstorm', title: 'Keeper of the Thunder Clock', clan: 'tech', cost: 3000, fur: 'tuxedo', role: 'All-round · Medium',
    blurb: 'A clock on his top hat and sparks in his whiskers. Knows where your cats are going, and where they were.',
    spells: [
      { id: 'mindread', name: 'Mind Reader', icon: '🧠', target: 'area', fx: 'intel', dur: 8, lv: { r: [175, 200, 217, 232, 250] },
        desc: s => `For 8s, lines show where every enemy squad in the area is heading (not how many cats a building has).` },
      { id: 'rewind', name: 'Rewind', icon: '⏪', target: 'area', fx: 'rewind', lv: { back: [2.5, 2.75, 3, 3.25, 3.5], r: [125, 137, 150, 155, 160] },
        desc: s => `Enemy and stray cats walking in the area jump back to where they were ${s.back}s ago.` },
      { id: 'shortcut', name: 'Shortcut', icon: '🕳️', target: 'own', fx: 'shortcut', lv: { n: [25, 28, 31, 33, 35] },
        desc: s => `The next cats you send from this building (within 30s, up to ${s.n}) take a secret tunnel and arrive 3.5s later.` },
      { id: 'chain', name: 'Chain Reaction', icon: '🔗', target: 'area', fx: 'chain', r: 60, lv: { cap: [70, 75, 80, 90, 100] },
        desc: s => `Tap next to a squad: a chain reaction jumps from it to the nearby squads of the same colour, knocking out up to ${s.cap} cats. It can hit your own cats if you tap them!` },
    ],
  },
  {
    id: 'rift', name: 'Rift', title: 'Walker of the Fourth Dimension', clan: 'tech', cost: 4500, fur: 'black', role: 'All-round · Easy',
    blurb: 'Raised on a far-off planet, Rift learned to fold space. Never keeps you waiting for a nasty surprise.',
    spells: [
      { id: 'deposit', name: 'Stash', icon: '📦', target: 'area', fx: 'stash', lv: { r: [100, 107, 115, 122, 130], clone: [0.1, 0.12, 0.15, 0.17, 0.2] },
        desc: s => `Your cats walking in the area stop and turn invisible, and ${P_(s.clone)} extra copies pop up among them. They wait until another squad of yours walks past, then join it.` },
      { id: 'barrier', name: 'Laser Wall', icon: '🚧', target: 'own', fx: 'barrier', lv: { dur: [8, 8.5, 9, 9.5, 10], cap: [40, 45, 50, 55, 60] },
        desc: s => `The next cats you send from this building (within 30s) leave a laser wall along their road for ${s.dur}s. Enemy cats crossing it are knocked out (up to ${s.cap}).` },
      { id: 'heads', name: 'Bouncy Heads', icon: '⚽', target: 'area', fx: 'heads', lv: { r: [100, 107, 115, 122, 130], mult: [1.5, 1.6, 1.75, 1.9, 2] },
        desc: s => `Your cats walking in the area curl into balls and bounce straight at the nearest enemy or stray building, hitting ×${s.mult} as hard. Balls can't capture: they only knock cats out.` },
      { id: 'clone', name: 'Copycat', icon: '👯', target: 'area', fx: 'clone', lv: { r: [100, 107, 115, 122, 130], pct: [0.6, 0.7, 0.8, 0.9, 1] },
        desc: s => `Every squad walking in the area gets copied (${P_(s.pct)} as many cats). The copies are yours and march the opposite way, back to where that squad came from.` },
    ],
  },
  {
    id: 'orbit', name: 'Orbit', title: 'The Saucer Ace', clan: 'tech', cost: 10500, fur: 'galaxy', role: 'Attack · Medium',
    blurb: 'Flies a tiny saucer and wears another one on her head. Zaps, pushes and floats your cats wherever she likes.',
    spells: [
      { id: 'ufo', name: 'Saucer Strike', icon: '👽', target: 'area', fx: 'ufo', lv: { n: [10, 12, 14, 16, 20], r: [100, 107, 115, 122, 130] },
        desc: s => `A flying saucer hovers over the spot for 6s and zaps enemy cats walking under it, one at a time (up to ${s.n}).` },
      { id: 'pulse', name: 'Turbo Pulse', icon: '⏩', target: 'area', fx: 'pulse', lv: { spd: [1.5, 1.55, 1.6, 1.65, 1.7], r: [125, 132, 140, 150, 160] },
        desc: s => `Your cats walking in the area instantly speed up: ${UP(s.spd)} faster until they arrive. Only yours.` },
      { id: 'aura', name: 'Static Fluff', icon: '🔆', target: 'area', fx: 'aura', lv: { dur: [6, 7, 8, 9, 10], r: [100, 107, 115, 122, 130] },
        desc: s => `For ${s.dur}s your cats walking in the area wear an energy shield: enemy cats that bump into them get knocked out while yours lose none, and skills can't touch them. A tower hit pops the shield.` },
      { id: 'gravity', name: 'Zero-G', icon: '🪐', target: 'area', fx: 'grav', lv: { pct: [0.3, 0.35, 0.4, 0.45, 0.5], r: [100, 110, 120, 130, 140] },
        desc: s => `Enemy cats walking in the area float helplessly up into the air for 3s. Then they drop, and ${P_(s.pct)} of them are knocked out.` },
    ],
  },
  {
    id: 'whirl', name: 'Doctor Whirl', title: 'The Mind Bender', clan: 'tech', cost: 13500, fur: 'siamese', role: 'All-round · Easy', sees: true,
    blurb: 'A hypnotist with a spiral jewel on his turban. Knows exactly how many cats you have. Soon, so will you.',
    spells: [
      { id: 'spyeye', name: 'Spy Eye', icon: '🔭', target: 'area', fx: 'spy', lv: { dur: [5, 5.5, 6, 6.5, 7], prod: [0.95, 0.9, 0.85, 0.8, 0.75], r: [200, 212, 225, 237, 250] },
        desc: s => `For ${s.dur}s you can see how many cats are inside enemy buildings in the area, and they make kittens at only ${P_(s.prod)} speed.` },
      { id: 'fog', name: 'Fog Cloud', icon: '🌫️', target: 'area', fx: 'fog', dur: 15, lv: { slow: [0.95, 0.9, 0.8, 0.75, 0.7], r: [200, 212, 225, 237, 250] },
        desc: s => `A fog cloud for 15s: your cats inside are hidden, towers can't shoot into it, and enemy cats inside walk at ${P_(s.slow)} speed.` },
      { id: 'hypno', name: 'Hypnotize', icon: '🌀', target: 'notown', fx: 'hypno', lv: { pct: [0.7, 0.725, 0.75, 0.78, 0.8] },
        desc: s => `Put an enemy or stray building under your spell. For the next 5s you can send cats out of it like your own: ${P_(s.pct)} of the cats inside follow your order. Wait too long and the spell fades.` },
      { id: 'zapfence', name: 'Zap Dome', icon: '⚡', target: 'area', fx: 'fence', r: 110, lv: { dur: [7, 8, 9, 9.5, 10], cap: [75, 100, 115, 130, 150] },
        desc: s => `An electric dome covers the spot for ${s.dur}s. Enemy cats that cross its edge, going in or coming out, are knocked out (up to ${s.cap}).` },
    ],
  },
  // ================================================================ Moon Mystics
  {
    id: 'glacia', name: 'Glacia', title: 'The Frozen Exile', clan: 'mystic', cost: 4000, fur: 'white', role: 'All-round · Easy',
    blurb: 'Found old ice relics on her travels and was cast out for it. Now she studies the cold, and shares it generously.',
    spells: [
      { id: 'tempdown', name: 'Cold Snap', icon: '🥶', target: 'enemy', fx: 'chill', lv: { dur: [5, 6, 7, 8, 10] },
        desc: s => `An enemy building drops all the way to level 1 for ${s.dur}s, then gets its levels back.` },
      { id: 'coldwave', name: 'Frost Wave', icon: '🌊', target: 'own', fx: 'wave', lv: { dur: [3, 3.5, 4, 4.5, 5] },
        desc: s => `The next cats you send from this building (within 30s) push a wave of cold ahead of them: every other cat it rolls over on the way freezes for ${s.dur}s.` },
      { id: 'glaciate', name: 'Big Freeze', icon: '🏔️', target: 'global', fx: 'glacier', lv: { dur: [6, 7, 8, 9, 10] },
        desc: s => `Ice creeps over every rival's screen and their catnip stops refilling for ${s.dur}s.` },
      { id: 'icerain', name: 'Hailstorm', icon: '🌨️', target: 'area', fx: 'hail', lv: { r: [90, 97, 105, 112, 120], pct: [0.3, 0.35, 0.4, 0.45, 0.5] },
        desc: s => `Hail crashes down on the spot: every enemy cat walking in the area is knocked out, and enemy buildings in it lose ${P_(s.pct)} of their cats.` },
    ],
  },
  {
    id: 'pebble', name: 'Madame Pebble', title: 'Mistress of Stone and Soil', clan: 'mystic', cost: 5000, fur: 'maneki', role: 'All-round · Medium',
    blurb: 'Rules the earth from under a straw hat, a pet hen on top. One stern look and you feel like a chicken.',
    spells: [
      { id: 'vortex', name: 'Zoomies Vortex', icon: '💨', target: 'area', fx: 'vortex', lv: { dur: [5.5, 6, 6.5, 7, 7.5], r: [100, 107, 115, 122, 125] },
        desc: s => `For ${s.dur}s, every cat walking through the area runs 50% faster. Anyone's cats.` },
      { id: 'purrfreeze', name: 'Purr Freeze', icon: '⏸️', target: 'global', fx: 'pfreeze', lv: { dur: [10, 11.5, 13, 14, 15] },
        desc: s => `Everyone's Purr Power is locked for ${s.dur}s: nobody gains or loses stars. Lock in your lead!` },
      { id: 'chickens', name: 'Chicken Out', icon: '🐔', target: 'area', fx: 'chicken', lv: { atk: [0.8, 0.75, 0.7, 0.65, 0.6], r: [150, 162, 175, 187, 200] },
        desc: s => `Enemy cats walking in the area turn into chickens until they arrive: no forge or Purr Power bonus, and they only hit at ${P_(s.atk)} strength.` },
      { id: 'magnet', name: 'Cat Magnet', icon: '🧲', target: 'any', fx: 'magnet', lv: { dur: [5, 6, 7, 8, 8.5], r: [200, 212, 225, 237, 250] },
        desc: s => `For ${s.dur}s any building you pick (yours, a rival's or a stray) pulls in every cat walking within ${s.r}. Its owner's cats move in; everyone else's have to attack it.` },
    ],
  },
  {
    id: 'willow', name: 'Willow', title: 'Tamer of Wild Beasts', clan: 'mystic', cost: 6000, fur: 'graytabby', role: 'All-round · Medium',
    blurb: 'Knew from a kitten that animals listen to her. The bigger she grew, the bigger the beasts that answer.',
    spells: [
      { id: 'quicksand', name: 'Quicksand', icon: '⏳', target: 'any', fx: 'qsand', lv: { dur: [6, 7, 8, 9, 10], slow: [0.6, 0.55, 0.5, 0.45, 0.4] },
        desc: s => `For ${s.dur}s the ground around any building turns to quicksand: enemy cats walking near it move at ${P_(s.slow)} speed.` },
      { id: 'unity', name: 'Pack Up', icon: '🧳', target: 'own', fx: 'unity',
        desc: () => 'The next time you send cats from this building to another of yours (within 30s), every cat in it moves over at once.' },
      { id: 'wind', name: 'Gust', icon: '🌬️', target: 'own', fx: 'wind', lv: { dur: [5, 6, 7, 8, 9], spd: [1.4, 1.45, 1.5, 1.55, 1.6] },
        desc: s => `The next cats you send from this building (within 30s) whip up a wind along their road for ${s.dur}s. Every cat walking with the wind goes ${UP(s.spd)} faster; every cat walking against it slows down as much.` },
      { id: 'worm', name: 'Sand Worm', icon: '🪱', target: 'notown', fx: 'worm', lv: { pct: [0.4, 0.45, 0.5, 0.55, 0.6], r: [150, 162, 175, 187, 200] },
        desc: s => `A giant worm bursts up under an enemy or stray building for 4s. It gobbles ${P_(s.pct)} of the cats inside and pulls in every other cat walking within ${s.r}. Everything it eats comes back as your sand cats and attacks the building.` },
    ],
  },
  {
    id: 'saffron', name: 'Saffron', title: 'The Desert Shaman', clan: 'mystic', cost: 8000, fur: 'ginger', role: 'All-round · Medium',
    blurb: 'Speaks to the sand and the sky. Raises totems, rolls boulders and brings the rain wherever she pleases.',
    spells: [
      { id: 'totem', name: 'Rage Totem', icon: '🗿', target: 'area', fx: 'totem', lv: { dur: [8, 9, 10, 11, 12], atk: [1.2, 1.22, 1.25, 1.27, 1.3], r: [100, 107, 115, 122, 130] },
        desc: s => `A totem stands on the spot for ${s.dur}s, like an extra Yarn Forge: your cats walking past it hit ×${s.atk} as hard, and your buildings in its area defend ×${s.atk} as well.` },
      { id: 'stones', name: 'Rolling Boulders', icon: '🪨', target: 'area', fx: 'stones', lv: { n: [20, 25, 30, 35, 40], r: [100, 107, 115, 122, 130], mult: [1.5, 1.6, 1.75, 1.9, 2] },
        desc: s => `Up to ${s.n} of your cats walking in the area curl into boulders and keep rolling to their target. Boulders hit ×${s.mult} as hard but can't capture.` },
      { id: 'rain', name: 'Sleepy Rain', icon: '🌧️', target: 'area', fx: 'rain', lv: { dur: [8, 9, 10, 11, 12], slow: [0.6, 0.55, 0.5, 0.45, 0.4], r: [125, 135, 145, 155, 165] },
        desc: s => `Rain falls on the spot for ${s.dur}s: enemy and stray cats walking through it slow to ${P_(s.slow)} speed.` },
      { id: 'sandstorm', name: 'Sandstorm', icon: '🏜️', target: 'area', fx: 'sand', lv: { dur: [4, 4.5, 5, 5.5, 6], pct: [0.2, 0.25, 0.3, 0.35, 0.4], r: [125, 132, 140, 150, 160] },
        desc: s => `A sandstorm traps enemy cats walking in the area for ${s.dur}s. When it ends they've lost their way and wander home, and ${P_(s.pct)} of them turn into wild sand cats: strays that attack the nearest building.` },
    ],
  },
  {
    id: 'marigold', name: 'Queen Marigold', title: 'The Queen of Mean', clan: 'mystic', cost: 7000, fur: 'persian', role: 'Attack · Hard',
    blurb: 'Pampered, powerful and very persuasive. Every one of her skills works against everybody.',
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
    id: 'honeydew', name: 'Honeydew', title: 'Boss of the Killer Bees', clan: 'mystic', cost: 9500, fur: 'cream', role: 'Defense · Medium',
    blurb: 'A nature witch with flowers in her hair. The bees carry her cats, the wind does the rest.',
    spells: [
      { id: 'deepfreeze', name: 'Deep Freeze', icon: '🧊', target: 'enemy', fx: 'freeze', lv: { dur: [4, 4.5, 5, 5.5, 6] },
        desc: s => `Freezes an enemy building for ${s.dur}s: no kittens, no tower shots, and a forge or garden gives no bonus.` },
      { id: 'flying', name: 'Bee Lift', icon: '🐝', target: 'own', fx: 'fly', lv: { n: [50, 60, 70, 85, 100], spd: [1.3, 1.4, 1.5, 1.6, 1.7] },
        desc: s => `The next cats you send from this building (within 30s, up to ${s.n}) are carried by bees straight over ponds, walls and hedges, ${UP(s.spd)} faster.` },
      { id: 'frostring', name: 'Ring of Frost', icon: '❄️', target: 'area', fx: 'frost', lv: { dur: [8, 9, 10, 11, 12], r: [100, 112, 125, 137, 150] },
        desc: s => `Every cat walking in the area freezes solid for ${s.dur}s. Yours too!` },
      { id: 'tornado', name: 'Tornado', icon: '🌪️', target: 'area', fx: 'tornado', lv: { dur: [10, 11, 12, 13, 15] },
        desc: s => `A tornado whirls around the spot for ${s.dur}s, knocking out enemy cats it touches and pulling cats out of enemy buildings it passes over.` },
    ],
  },
  {
    id: 'wispera', name: 'Wispera', title: 'The Ghost Caller', clan: 'mystic', cost: 17000, fur: 'void', role: 'All-round · Medium',
    blurb: 'Keeps coming back from beyond, and brings a few friends every time. Her old tribe banned her magic. She kept it anyway.',
    spells: [
      { id: 'haunt', name: 'Haunted House', icon: '🕯️', target: 'own', fx: 'haunt', lv: { n: [10, 12, 14, 17, 20], dur: [8, 9, 10, 11, 12] },
        desc: s => `${s.n} ghost cats move into your building for ${s.dur}s. They help defend it but can't be sent out, and they vanish when the time is up.` },
      { id: 'possess', name: 'Possession', icon: '🎭', target: 'enemy', fx: 'possess', lv: { dur: [5, 6, 7, 8, 10] },
        desc: s => `An enemy building becomes yours for ${s.dur}s, cats and all. You can't send cats out of it, but you can upgrade or convert it. Then it goes back to its owner with whatever cats are left.` },
      { id: 'spirited', name: 'Spirited Away', icon: '↪️', target: 'owned', fx: 'redirect', lv: { dur: [4, 4.5, 5, 5.5, 6] },
        desc: s => `For ${s.dur}s, enemy attacks on any of your buildings hit the building you picked instead. Pick a strong one of yours to soak them up, or a rival's so they hit their own. Redirected hits can't capture it.` },
      { id: 'ghostarmy', name: 'Ghost Army', icon: '👥', target: 'any', fx: 'ghosts', lv: { n: [30, 34, 38, 42, 45] },
        desc: s => `${s.n} ghost cats rise next to any building and march in: they reinforce yours or attack anyone else's. They fight like your normal cats, but towers can't hit them and skills can't touch them.` },
    ],
  },
  // ================================================================ Alley Cats
  {
    id: 'morrow', name: 'Morrow', title: 'Master of Lost Souls', clan: 'alley', cost: 1500, fur: 'black', role: 'Defense · Easy', sees: true,
    blurb: 'Collects souls in a little lantern. His towers never go hungry and his potions are... an acquired taste.',
    spells: [
      { id: 'soulsnatch', name: 'Soul Snatcher', icon: '🏮', target: 'own', fx: 'soul', lv: { range: [1.2, 1.25, 1.3, 1.4, 1.5], dur: [10, 11, 12, 13.5, 15] },
        desc: s => `For ${s.dur}s your tower reaches ${UP(s.range)} farther, and every enemy cat it knocks out joins the tower.` },
      { id: 'untouchable', name: 'Untouchable', icon: '🔮', target: 'own', fx: 'invuln',
        desc: () => 'Nothing can hurt your building, but after half a second the spell starts eating 6 of its own cats every second until they run out (10s at most).' },
      { id: 'slowmo', name: 'Slow-Mo Ring', icon: '🐌', target: 'area', fx: 'slowmo', lv: { slowx: [2, 2.25, 2.5, 2.75, 3], r: [112, 125, 137, 150, 162] },
        desc: s => `Every cat walking in the area moves ${s.slowx}× slower until it arrives. Anyone's cats.` },
      { id: 'poison', name: 'Food Poisoning', icon: '🤢', target: 'enemy', fx: 'plague', dur: 12, lv: { rate: [2, 2.5, 3, 3.5, 4], prod: [0.5, 0.4, 0.3, 0.15, 0], chance: [0.5, 0.6, 0.7, 0.85, 1] },
        desc: s => `For 12s an enemy building loses ${s.rate} cats a second and makes kittens at ${P_(s.prod)} speed, and you can see its count. Cats sent out of it carry it along (${P_(s.chance)} chance).` },
    ],
  },
  {
    id: 'ironclaw', name: 'Ironclaw', title: 'The Iron Fist', clan: 'alley', cost: 3500, fur: 'gray', role: 'Defense · Easy',
    blurb: 'Something old and angry moved into this cat and never left. Now he passes the suffering on, one iron paw at a time.',
    spells: [
      { id: 'seal', name: 'Iron Seal', icon: '🔏', target: 'enemy', fx: 'seal', lv: { pct: [0.05, 0.06, 0.07, 0.08, 0.09] },
        desc: s => `For 5s an enemy building loses ${P_(s.pct)} of the cats it had every second, and a cottage stops making kittens.` },
      { id: 'mines', name: 'Mine Field', icon: '✴️', target: 'area', fx: 'mines', lv: { n: [20, 25, 30, 35, 40], r: [100, 107, 115, 122, 130] },
        desc: s => `Up to ${s.n} enemy cats walking in the area freeze into mines. Any other enemy cat that walks into a mine is knocked out.` },
      { id: 'thief', name: 'Purr Thief', icon: '💰', target: 'enemy', fx: 'thief',
        desc: () => 'Pick an enemy building: steals up to one Purr Power star from its owner and adds it to yours.' },
      { id: 'reap', name: 'Soul Harvest', icon: '🌾', target: 'own', fx: 'reap', lv: { dur: [6, 7, 8, 9, 10], r: [150, 162, 175, 187, 200], pct: [0.6, 0.7, 0.8, 0.9, 1] },
        desc: s => `For ${s.dur}s, ${P_(s.pct)} of every cat knocked out within ${s.r} of your building (anyone's) comes back to life inside it as yours.` },
    ],
  },
  {
    id: 'bones', name: 'Baron Bones', title: 'Lord of the Long Nap', clan: 'alley', cost: 15500, fur: 'void', role: 'Attack · Hard',
    blurb: 'Wears a skull for a hat. Cats have nine lives; he knows where the other eight went.',
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
    id: 'cackle', name: 'Cackle', title: 'The Cauldron Witch', clan: 'alley', cost: 16500, fur: 'siamese', role: 'Attack · Hard',
    blurb: 'Raises skeletons, borrows other heroes\' tricks and drops cauldrons on things. Usually laughing.',
    spells: [
      { id: 'skeletons', name: 'Bone Rush', icon: '🦴', target: 'enemy', fx: 'bones', lv: { n: [10, 12, 14, 16, 20] },
        desc: s => `${s.n} skeleton cats claw out of the ground right next to an enemy building and attack it. Not on a level 5 cottage.` },
      { id: 'steal', name: 'Copy Cat', icon: '🎒', target: 'global', fx: 'steal',
        desc: () => 'Copies the last skill a rival cast. This button turns into that skill (at their level) until you use it once; it costs its usual catnip.' },
      { id: 'bloodpact', name: 'Blood Pact', icon: '🩸', target: 'global', fx: 'blood', lv: { dur: [8, 9, 10, 11, 12], purr: [10, 12, 14, 17, 20] },
        desc: s => `For ${s.dur}s every cat you lose gives you Purr Power (+${s.purr} each) instead of taking it away.` },
      { id: 'cauldron', name: 'Big Cauldron', icon: '🍲', target: 'enemy', fx: 'cauldron',
        desc: () => 'An enemy building turns into a level 1 stray under a cauldron: nobody can send cats to it. Casting it again lifts the cauldron off the last one.' },
    ],
  },
  {
    id: 'jinx', name: 'Jinx', title: 'The Switcheroo', clan: 'alley', cost: 18000, fur: 'orange', role: 'Attack · Hard',
    blurb: 'A jester with bells on. Swaps your buildings, charms your attackers and makes every loss hurt twice.',
    spells: [
      { id: 'defectors', name: 'Defectors', icon: '🏃', target: 'notown', fx: 'defect', lv: { dur: [8, 8.5, 9, 9.5, 10] },
        desc: s => `For ${s.dur}s, every kitten an enemy or stray building makes walks over to your nearest building.` },
      { id: 'bounce', name: 'Charm Shield', icon: '🪞', target: 'own', fx: 'bounce', lv: { dur: [8, 8.5, 9, 9.5, 10], n: [40, 45, 50, 55, 60] },
        desc: s => `For ${s.dur}s (or until ${s.n} cats bounce off) rivals can't send attacks at your building, and enemy cats already on the way turn around at the door and hurry home.` },
      { id: 'swap', name: 'Swap!', icon: '🔀', target: 'enemy', fx: 'swap',
        desc: () => 'Swaps an enemy building with a random one of yours, cats and all. Their effects wear off.' },
      { id: 'echo', name: 'Echo Hex', icon: '📣', target: 'notown', fx: 'echo', lv: { dur: [8, 8.5, 9, 9.5, 10], bld: [3, 3, 4, 4, 5], pct: [0.75, 0.8, 0.85, 0.95, 1] },
        desc: s => `For ${s.dur}s, ${P_(s.pct)} of every cat knocked out of an enemy or stray building is also knocked out of the ${s.bld} nearest buildings that aren't yours.` },
    ],
  },
  {
    id: 'riddle', name: 'Riddle', title: 'The Cat of Many Faces', clan: 'alley', cost: 21000, fur: 'galaxy', role: 'All-round · Hard', random: true,
    blurb: 'A riddle with no answer behind a two-faced mask. One battle brute strength, the next pure cunning. Why stick to one talent?',
    spells: [1, 2, 3, 4].map(k => ({
      id: 'bek' + k, name: `Mystery Skill ${k}`, icon: '❓', target: 'global', fx: 'mystery', mystery: true,
      desc: () => `A random hero's skill ${k}, picked fresh at the start of every battle. Leveling this up makes whatever skill you get stronger.`,
    })),
  },
]);
export const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));
// heroes from before the 24-hero roster: old saves and old clients map onto the hero with the same skills
export const LEGACY_HEROES = {
  pounce: 'barnaby', kibble: 'mortar', bristle: 'cinder', zap: 'nova', velvet: 'whirl', paradox: 'tickstorm',
  paprika: 'marigold', snowpaw: 'honeydew', mischief: 'pebble', graveclaw: 'bones', grimsby: 'morrow', hexley: 'jinx',
};
export function heroById(id) { return HERO_BY_ID[id] || HERO_BY_ID[LEGACY_HEROES[id]] || null; }
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
  // the weird ones: punk prints first, then stranger and stranger (drawn in art.js, one pattern each)
  { id: 'tartan',    name: 'Tartan Punk',     cost: 1800,   base: '#c8102e', dark: '#7a0a1c', belly: '#c8102e', pattern: 'plaid' },
  { id: 'leopard',   name: 'Leopard Print',   cost: 2200,   base: '#e8b25a', dark: '#3a2414', belly: '#f6dca8', pattern: 'leopard' },
  { id: 'zebra',     name: 'Zebra',           cost: 2600,   base: '#f7f5f0', dark: '#16151a', belly: '#f7f5f0', pattern: 'zebra' },
  { id: 'camo',      name: 'Urban Camo',      cost: 3000,   base: '#8c9096', dark: '#3a3d43', belly: '#8c9096', pattern: 'camo' },
  { id: 'checker',   name: 'Skate Checker',   cost: 3500,   base: '#f4f2ee', dark: '#141318', belly: '#f4f2ee', pattern: 'checker' },
  { id: 'neontiger', name: 'Neon Tiger',      cost: 4000,   base: '#1a1720', dark: '#ff2e88', belly: '#1a1720', pattern: 'neon' },
  { id: 'tiedye',    name: 'Tie-Dye',         cost: 5000,   base: '#ff6ec7', dark: '#7a3cff', belly: '#ff6ec7', pattern: 'tiedye' },
  { id: 'tattoo',    name: 'Tattoo Flash',    cost: 6000,   base: '#f1dfc4', dark: '#b8946a', belly: '#f8ecd9', pattern: 'tattoo' },
  { id: 'spray',     name: 'Spray Paint',     cost: 7000,   base: '#c9c6c0', dark: '#6b6762', belly: '#c9c6c0', pattern: 'spray' },
  { id: 'toxic',     name: 'Toxic Ooze',      cost: 8500,   base: '#8cff3a', dark: '#2f9e1a', belly: '#8cff3a', pattern: 'toxic' },
  { id: 'zombie',    name: 'Zombie Stitch',   cost: 10000,  base: '#94ab8c', dark: '#5d7356', belly: '#b4c7a8', pattern: 'zombie' },
  { id: 'xray',      name: 'X-Ray',           cost: 12000,  base: '#141a2a', dark: '#0a0e18', belly: '#141a2a', pattern: 'xray' },
  { id: 'chrome',    name: 'Liquid Chrome',   cost: 14000,  base: '#c3cad3', dark: '#5b636e', belly: '#c3cad3', pattern: 'chrome' },
  { id: 'lava',      name: 'Molten Lava',     cost: 16500,  base: '#2b1b18', dark: '#120a09', belly: '#2b1b18', pattern: 'lava' },
  { id: 'static',    name: 'TV Static',       cost: 19000,  base: '#8a8a8a', dark: '#2a2a2a', belly: '#8a8a8a', pattern: 'static' },
  { id: 'glitch',    name: 'Glitch',          cost: 22000,  base: '#1de9e3', dark: '#ff2a6d', belly: '#1de9e3', pattern: 'glitch' },
  { id: 'holo',      name: 'Holographic',     cost: 25000,  base: '#e6d4ff', dark: '#9fd9ff', belly: '#e6d4ff', pattern: 'holo' },
  { id: 'pixel',     name: '8-Bit',           cost: 29000,  base: '#8bac0f', dark: '#306230', belly: '#8bac0f', pattern: 'pixel' },
  { id: 'alleyes',   name: 'All-Seeing',      cost: 34000,  base: '#6b2f8f', dark: '#3b1552', belly: '#6b2f8f', pattern: 'eyes' },
  { id: 'ghost',     name: 'Ghost',           cost: 40000,  base: '#dfeaff', dark: '#9fb6e6', belly: '#dfeaff', pattern: 'ghost' },
  { id: 'pizza',     name: 'Pizza',           cost: 47000,  base: '#ffcf4a', dark: '#d98c2b', belly: '#ffcf4a', pattern: 'pizza' },
  { id: 'disco',     name: 'Disco Ball',      cost: 55000,  base: '#c9d0da', dark: '#59606c', belly: '#c9d0da', pattern: 'disco' },
  { id: 'eldritch',  name: 'Eldritch',        cost: 65000,  base: '#2a1140', dark: '#7b2fc0', belly: '#2a1140', pattern: 'eldritch' },
  { id: 'inferno',   name: 'Rainbow Inferno', cost: 80000,  base: '#ff5a1f', dark: '#b3200a', belly: '#ff5a1f', pattern: 'inferno' },
  { id: 'missing',   name: 'Missing Texture', cost: 100000, base: '#ff00ff', dark: '#000000', belly: '#ff00ff', pattern: 'missing' },
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
  // the weird ones (drawn in art.js drawHat), sorted by price
  { id: 'snapback',    name: 'Backwards Snapback', cost: 1200 },
  { id: 'mohawk',      name: 'Neon Mohawk',        cost: 1500 },
  { id: 'bandana',     name: 'Skull Bandana',      cost: 1800 },
  { id: 'headphones',  name: 'Big Headphones',     cost: 2200 },
  { id: 'shades',      name: 'Shutter Shades',     cost: 2600 },
  { id: 'horns',       name: 'Devil Horns',        cost: 3000 },
  { id: 'spikehelm',   name: 'Spiked Helmet',      cost: 3500 },
  { id: 'cone',        name: 'Traffic Cone',       cost: 4200 },
  { id: 'liberty',     name: 'Liberty Spikes',     cost: 5000 },
  { id: 'plunger',     name: 'Plunger',            cost: 6000 },
  { id: 'gasmask',     name: 'Gas Mask',           cost: 7000 },
  { id: 'duck',        name: 'Rubber Duck',        cost: 8500 },
  { id: 'fishbowl',    name: 'Fishbowl Helmet',    cost: 10000 },
  { id: 'antennae',    name: 'Alien Antennae',     cost: 12000 },
  { id: 'candles',     name: 'Melting Candles',    cost: 14000 },
  { id: 'toast',       name: 'Slice of Toast',     cost: 16500 },
  { id: 'skullcrown',  name: 'Skull Crown',        cost: 19000 },
  { id: 'squid',       name: 'Squid Hat',          cost: 22000 },
  { id: 'eyestalks',   name: 'Eyeball Stalks',     cost: 25000 },
  { id: 'ufo',         name: 'Tiny UFO',           cost: 29000 },
  { id: 'blackhole',   name: 'Pocket Black Hole',  cost: 34000 },
  { id: 'fire',        name: 'Head on Fire',       cost: 40000 },
  { id: 'thirdeye',    name: 'Third Eye',          cost: 50000 },
  { id: 'tinycat',     name: 'Tiny Cat',           cost: 65000 },
  { id: 'galaxybrain', name: 'Galaxy Brain',       cost: 100000 },
];
export const HAT_BY_ID = Object.fromEntries(HATS.map(h => [h.id, h]));

export const EMOTES = [
  { id: 'meow',  text: 'Rawr!',      icon: '😼' },
  { id: 'gg',    text: 'Good game!', icon: '🤝' },
  { id: 'hiss',  text: 'Hissss!',    icon: '😾' },
  { id: 'lol',   text: 'LOL',        icon: '😹' },
  { id: 'love',  text: 'Rock on!',   icon: '🤘' },
  { id: 'wow',   text: 'Whoa!',      icon: '🙀' },
  { id: 'nap',   text: 'Zzz...',     icon: '😴' },
  { id: 'fish',  text: 'Fish pls',   icon: '🐟' },
];

// ---------------- Map themes ----------------
export const THEMES = {
  meadow:  { name: 'Overgrown Lot',   ground: '#8fd16a', ground2: '#7cc35a', accent: '#ffe27a', ambient: 'petals' },
  rooftop: { name: 'Rooftop Riot',    ground: '#c98f6b', ground2: '#b77c5a', accent: '#ffb36b', ambient: 'leaves' },
  snow:    { name: 'Frostbite Peaks', ground: '#eaf4ff', ground2: '#d6e7f7', accent: '#9fd0ff', ambient: 'snow' },
  night:   { name: 'Midnight Garden', ground: '#2f4a5e', ground2: '#28405a', accent: '#b9a6ff', ambient: 'fireflies' },
  beach:   { name: 'Rusty Docks',     ground: '#f2d9a0', ground2: '#e6c886', accent: '#5fd0e6', ambient: 'bubbles' },
  candy:   { name: 'Sugar Crash',     ground: '#ffc6e2', ground2: '#ffb3d8', accent: '#b8f0ff', ambient: 'sparkles' },
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
// One level for every hero, getting harder as you go. Every two-player map is used once; the five 'random' levels
// each get their own fixed map (the level's seed makes it), so they play the same every time.
// boss: the last four rivals wear a crown and bring their skills one level higher.
export const CAMPAIGN = [
  { id: 1,  name: 'New Kid on the Block',     map: 'meadow',      ai: 'easy',   enemy: 'barnaby',     reward: 300,  tip: 'Drag from your cottage to a stray building to send cats.' },
  { id: 2,  name: 'Tower Trouble',      map: 'rooftops',    ai: 'easy',   enemy: 'mortar',      reward: 300,  tip: 'Towers shoot cats walking past. Send a big group at once!' },
  { id: 3,  name: 'Frostbite',     map: 'snowy',       ai: 'easy',   enemy: 'glacia',      reward: 330,  tip: 'Tap your cottage to upgrade it. Upgraded cottages make kittens faster.' },
  { id: 4,  name: 'Builder\'s Yard',     map: 'ponds',       ai: 'easy',   enemy: 'hammerpaw',   reward: 360,  tip: 'Tap one of your buildings to change its job: towers up front, forges and gardens at the back.' },
  { id: 5,  name: 'Lantern Moat',       map: 'moat',        ai: 'easy',   enemy: 'morrow',      reward: 390,  tip: 'You can\'t see how many cats a rival has inside (?). Watch the squads that leave and arrive to guess.' },
  { id: 6,  name: 'Killer Bees',       map: 'moonlit',     ai: 'normal', enemy: 'honeydew',    reward: 420,  tip: 'Catnip is scarce. Gardens refill it much faster, and skills win battles!' },
  { id: 7,  name: 'Dockside Dash',      map: 'docks',       ai: 'normal', enemy: 'nova',        reward: 450,  tip: 'Forges make all your cats hit harder.' },
  { id: 8,  name: 'Iron Bridges',       map: 'fjord',       ai: 'normal', enemy: 'ironclaw',    reward: 480,  tip: 'Only two bridges cross the fjord. Whoever holds them controls the battle.' },
  { id: 9,  name: 'Ninja Night',        map: 'maze',        ai: 'normal', enemy: 'rift',        reward: 510,  tip: 'Cats walk around hedges and ponds. Drag onto a building to see the road they will take.' },
  { id: 10, name: 'Sugar Rush',         map: 'candy',       ai: 'normal', enemy: 'pebble',      reward: 540,  tip: 'The Grand Cat Tree is worth fighting for.' },
  { id: 11, name: 'Into the Wild',      map: 'random',      ai: 'normal', enemy: 'willow',      reward: 570,  tip: 'Uncharted land! Grab the strays closest to you before your rival does.' },
  { id: 12, name: 'Sandy Shores',       map: 'piers',       ai: 'normal', enemy: 'saffron',     reward: 600,  tip: 'Rain slows every cat walking under it. Send your squads around the clouds.' },
  { id: 13, name: 'Crash the Ball',         map: 'gumdrops',    ai: 'hard',   enemy: 'marigold',    reward: 640,  tip: 'Hush stops everyone\'s skills for a few seconds. Cast your big one first, or wait it out.' },
  { id: 14, name: 'Mad Science',        map: 'archipelago', ai: 'hard',   enemy: 'tickstorm',   reward: 680,  tip: 'Bridges are chokepoints. Spread out so one area spell cannot hit everything.' },
  { id: 15, name: 'Space Race',         map: 'alleys',      ai: 'hard',   enemy: 'orbit',       reward: 720,  tip: 'Swipe across several of your buildings to send from all of them at once.' },
  { id: 16, name: 'Moth Caves',         map: 'molehills',   ai: 'hard',   enemy: 'mossbeard',   reward: 760,  tip: 'Circle of Life can save a building once, with 20 fresh cats. Bring a second wave.' },
  { id: 17, name: 'Trial by Fire',      map: 'chimneys',    ai: 'hard',   enemy: 'cinder',      reward: 800,  tip: 'Spread your squads out: a Ring of Fire hits everything inside one circle.' },
  { id: 18, name: 'Switcheroo',         map: 'random',      ai: 'hard',   enemy: 'jinx',        reward: 850,  tip: 'Don\'t pile every cat into one building: Swap! can trade it away.' },
  { id: 19, name: 'Haunted Hollow',     map: 'random',      ai: 'hard',   enemy: 'wispera',     reward: 900,  tip: 'Ghost cats ignore towers. Keep a few cats at home to meet them.' },
  { id: 20, name: 'Mind Games',         map: 'ridge',       ai: 'hard',   enemy: 'whirl',       reward: 950,  tip: 'Purr Power stars make your buildings much tougher. Never attack into a rival with more stars than you.' },
  { id: 21, name: 'Bone Yard',          map: 'random',      ai: 'insane', enemy: 'bones',       reward: 1000, tip: 'Panic empties a building in a moment. Keep a few strong buildings, not one huge one.', boss: true, seed: 1372 },
  { id: 22, name: 'Witching Hour',      map: 'chocoriver',  ai: 'insane', enemy: 'cackle',      reward: 1100, tip: 'Copy Cat steals the last skill you cast. Save your biggest one for the right moment.', boss: true },
  { id: 23, name: 'Last Legend Standing', map: 'random',      ai: 'insane', enemy: 'thunderpurr', reward: 1200, tip: 'Fortress turns all his buildings into towers for a few seconds. Wait it out, then strike.', boss: true },
  { id: 24, name: 'Many Faces',         map: 'hedgerow',    ai: 'insane', enemy: 'riddle',      reward: 1500, tip: 'The final boss. Show them who the real top cat is!', boss: true },
];
/** a campaign level's battle seed (it also makes the map for the 'random' levels; a level can pick its own) */
export const campaignSeed = l => l.seed ?? 1000 + l.id * 17;
// the 12-level campaign: old level number -> the new level with the same rival, so saved stars carry over
export const LEGACY_CAMPAIGN = { 1: 1, 2: 2, 3: 3, 4: 6, 5: 7, 6: 10, 7: 9, 8: 8, 9: 15, 10: 14, 11: 22, 12: 24 };

// ---------------- Achievements ----------------
export const ACHIEVEMENTS = [
  { id: 'firstwin',   name: 'First Scratch',    desc: 'Win your first match.',                     reward: 300 },
  { id: 'online1',    name: 'Friendly Fire',    desc: 'Play an online match with a friend.',       reward: 300 },
  { id: 'online5',    name: 'Runs the Block',   desc: 'Win 5 online matches.',                     reward: 750 },
  { id: 'maxcottage', name: 'Punk House',       desc: 'Upgrade a cottage to level 5.',             reward: 300 },
  { id: 'capture50',  name: 'Turf Taker',       desc: 'Capture 50 buildings (total).',             reward: 450 },
  { id: 'spells50',   name: 'Spell Slinger',    desc: 'Cast 50 spells (total).',                   reward: 450 },
  { id: 'heroes5',    name: 'Misfit Collector', desc: 'Unlock 5 heroes.',                          reward: 750 },
  { id: 'flawless',   name: 'Untouchable',      desc: 'Win without losing a single building.',     reward: 600 },
  { id: 'speedy',     name: 'Zoomies',          desc: 'Win a match in under 3 minutes.',           reward: 600 },
  { id: 'insane',     name: 'Lion Tamer',       desc: 'Beat the Lion King (Insane) AI.',           reward: 900 },
  { id: 'campaign',   name: 'Legend of the Litter', desc: 'Finish the whole campaign.',            reward: 1500 },
  { id: 'fashion',    name: 'Thrift Store Icon', desc: 'Own 5 cosmetic items.',                     reward: 300 },
  { id: 'army200',    name: 'Cat Riot',         desc: 'Have 200 cats at once.',                    reward: 450 },
];

export const RULES = [
  { id: 'zoomies',  icon: '⚡', name: 'Zoomies',        desc: 'All cats run 50% faster.' },
  { id: 'frenzy',   icon: '🌿', name: 'Catnip Frenzy',  desc: 'Catnip refills twice as fast. Spells everywhere!' },
  { id: 'boom',     icon: '🍼', name: 'Kitten Boom',    desc: 'Buildings make kittens 50% faster.' },
  { id: 'bigstart', icon: '🏰', name: 'Big Start',      desc: 'Every building starts with double the cats.' },
];

// fish coin income (tripled in v1.3)
export const COINS = { tutorial: 600, onlineWin: 450, onlineLoss: 180, firstWinOfDay: 300, dailyGift: 150, perfMax: 180, perfPerCapture: 6, perfPerSpell: 3, newStar: 120, levelUpBase: 150, levelUpPerLevel: 15 };
