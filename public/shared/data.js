// Whisker Wars - shared game data (used by browser and Node server)

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const TICK = 0.05;            // simulation step, seconds (20 Hz)
export const SNAP_EVERY = 2;         // send a network snapshot every N ticks (10 Hz)
export const BASE_SPEED = 72;        // world units per second
export const MAX_CATNIP = 100;
export const BASE_CATNIP_REGEN = 1.15; // per second
export const START_CATNIP = 25;
export const TIME_LIMIT = 600;       // seconds; then most cats wins
export const OVERCAP_DECAY = 1.0;    // cats per second lost when above capacity
export const SQUAD_CHUNK = 24;       // big sends split into waves of this size
export const PURR_PER_STAR = 20;     // purr points per star (5 stars max)
export const PURR_ATK_PER_STAR = 0.04;
export const PURR_SPD_PER_STAR = 0.03;

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
    desc: 'Grows catnip. Every garden you own speeds up your spell energy.',
    cap: [20, 30, 40], prod: [0, 0, 0], catnipBonus: [0.25, 0.4, 0.6],
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
// Nobody can see how many cats are inside another player's buildings (strays stay visible). Every hero can send the
// Owl Scout: for a few seconds you see every enemy building's count (and their army totals).
export const SCOUT = { id: 'scout', name: 'Owl Scout', icon: '🦉', cost: 15, cd: 30, dur: 10, target: 'global',
  desc: 'An owl flies over the battlefield: for 10s you can see how many cats are inside every enemy building.' };
// Prof. Purrcival's Auto-Turret spell bolts on a fixed-size hairball turret
export const TURRET = { range: 195, fireEvery: 0.95 };
// cost (in cats) to convert a building into another type (resets to level 1)
export const CONVERT_COST = { cottage: 10, tower: 20, forge: 20, garden: 20 };

// ---------------- Clans & Heroes ----------------
export const CLANS = {
  royal:  { name: 'Royal Court',   color: '#ffcf4d', icon: '👑', desc: 'Nobles of the Velvet Cushion.' },
  alley:  { name: 'Alley Cats',    color: '#ff8a3d', icon: '🗑️', desc: 'Scrappy rogues of the back streets.' },
  mystic: { name: 'Moon Mystics',  color: '#b08cff', icon: '🌙', desc: 'Keepers of old cat magic.' },
  tech:   { name: 'Tech Whiskers', color: '#3de0ff', icon: '🔧', desc: 'Inventors with too many gadgets.' },
};

// Spell target kinds:
//  'own'     - one of your buildings
//  'enemy'   - an opponent building
//  'neutral' - a stray (neutral) building
//  'notown'  - enemy or neutral building
//  'area'    - a point on the map (uses radius)
//  'global'  - no target
// fx: visual effect key the renderer understands
export const HEROES = [
  {
    id: 'whiskers', name: 'Sir Whiskers', title: 'The Valiant', clan: 'royal', cost: 0, fur: 'ginger',
    blurb: 'A noble knight who never backs down from a scrap. Great for learning the ropes.',
    passive: { id: 'chivalry', name: 'Chivalry', desc: 'Your cats deal +10% damage when attacking buildings.' },
    spells: [
      { id: 'rally', name: 'Rally Cry', icon: '📯', cost: 30, cd: 20, target: 'global', dur: 6, fx: 'rally',
        desc: 'All your cats on the field run 60% faster for 6s.' },
      { id: 'shieldwall', name: 'Shield Wall', icon: '🛡️', cost: 35, cd: 18, target: 'own', dur: 8, fx: 'shield',
        desc: 'Your building takes 70% less damage for 8s.' },
      { id: 'decree', name: 'Royal Decree', icon: '📜', cost: 55, cd: 30, target: 'own', fx: 'upgrade',
        desc: 'Instantly upgrade one of your buildings for free.' },
    ],
  },
  {
    id: 'mittens', name: 'Mittens', title: 'Apprentice Archmage', clan: 'mystic', cost: 0, fur: 'white',
    blurb: 'Tiny paws, enormous spells. Mittens turns catnip into chaos.',
    passive: { id: 'arcane', name: 'Arcane Purr', desc: 'Your catnip refills 25% faster.' },
    spells: [
      { id: 'meteor', name: 'Yarnball Meteor', icon: '☄️', cost: 40, cd: 18, target: 'area', radius: 125, delay: 1.2, fx: 'meteor',
        desc: 'A flaming yarnball lands after 1.2s: knocks out up to 16 cats from each enemy squad in the area, and 10 from enemy buildings.' },
      { id: 'frost', name: 'Frost Hiss', icon: '❄️', cost: 35, cd: 20, target: 'area', radius: 140, dur: 4, fx: 'frost',
        desc: 'Freezes enemy cats in the area for 4s and stops enemy kitten-making there for 6s.' },
      { id: 'polymorph', name: 'Purrlymorph', icon: '🪄', cost: 55, cd: 35, target: 'notown', fx: 'polymorph',
        desc: 'Turns an enemy or stray tower, forge or garden into a plain level 1 cottage.' },
    ],
  },
  {
    id: 'shadow', name: 'Shadow', title: 'Ninja of the Night Roofs', clan: 'alley', cost: 750, fur: 'black',
    blurb: 'You never see Shadow coming. Neither do the towers.',
    passive: { id: 'lightpaws', name: 'Light Paws', desc: 'Your cats move 20% faster.' },
    spells: [
      { id: 'smoke', name: 'Smoke Bomb', icon: '💨', cost: 30, cd: 18, target: 'area', radius: 150, dur: 6, fx: 'smoke',
        desc: 'Your cats in the area turn invisible for 6s: towers ignore them and they slip past enemy squads.' },
      { id: 'shuriken', name: 'Shuriken Storm', icon: '✴️', cost: 35, cd: 18, target: 'enemy', fx: 'shuriken',
        desc: 'Knocks out 35% of an enemy building\'s cats (up to 22).' },
      { id: 'shadowstep', name: 'Shadow Step', icon: '🌀', cost: 45, cd: 25, target: 'own', dur: 10, fx: 'portal',
        desc: 'The next squad sent from this building (within 10s) teleports straight to its target.' },
    ],
  },
  {
    id: 'chef', name: 'Chef Pawtisserie', title: 'Master of the Fish Kitchen', clan: 'royal', cost: 3000, fur: 'cream',
    blurb: 'An army marches on its stomach. Chef keeps every belly full.',
    passive: { id: 'wellfed', name: 'Well Fed', desc: 'Your buildings hold 20% more cats.' },
    spells: [
      { id: 'feast', name: 'Fish Feast', icon: '🐟', cost: 30, cd: 15, target: 'own', fx: 'feast',
        desc: 'Serves dinner: +12 cats in your building.' },
      { id: 'pepper', name: 'Hot Pepper', icon: '🌶️', cost: 35, cd: 18, target: 'area', radius: 140, dur: 6, fx: 'pepper',
        desc: 'Your cats in the area run twice as fast and hit 30% harder for 6s.' },
      { id: 'sardines', name: 'Stinky Sardines', icon: '🥫', cost: 45, cd: 25, target: 'enemy', dur: 8, fx: 'stink',
        desc: 'Enemy cats in this building refuse to leave for 8s and its defense drops 30%.' },
    ],
  },
  {
    id: 'chonk', name: 'Sgt. Chonk', title: 'The Unmovable', clan: 'alley', cost: 5000, fur: 'orange',
    blurb: 'Twenty-two pounds of pure determination.',
    passive: { id: 'bigboned', name: 'Big Boned', desc: 'Your buildings take 15% less damage.' },
    spells: [
      { id: 'bellyflop', name: 'Belly Flop', icon: '💥', cost: 40, cd: 18, target: 'area', radius: 120, dur: 2, fx: 'flop',
        desc: 'Chonk lands with a boom: knocks out 8 enemy cats in the area and stuns the rest for 2s.' },
      { id: 'fortify', name: 'Fortify', icon: '🏰', cost: 35, cd: 22, target: 'own', dur: 20, fx: 'fortify',
        desc: 'Your building holds 50% more cats and defends 50% better for 20s.' },
      { id: 'naptime', name: 'Nap Time', icon: '😴', cost: 60, cd: 40, target: 'global', dur: 3.5, fx: 'nap',
        desc: 'Every enemy cat on the field falls asleep for 3.5s.' },
    ],
  },
  {
    id: 'duchess', name: 'Duchess Fluffington', title: 'Heiress of the Velvet Cushion', clan: 'royal', cost: 7000, fur: 'persian',
    blurb: 'Why fight when you can simply... buy the kingdom?',
    passive: { id: 'pampered', name: 'Pampered', desc: 'Your cottages make kittens 8% faster.' },
    spells: [
      { id: 'teaparty', name: 'Tea Party', icon: '🫖', cost: 40, cd: 22, target: 'own', dur: 10, fx: 'tea',
        desc: 'Your building makes kittens 2x faster for 10s (towers, forges and gardens make 1 per second).' },
      { id: 'bribe', name: 'Bribe', icon: '💰', cost: 60, cd: 40, target: 'neutral', max: 20, fx: 'bribe',
        desc: 'A stray building with 20 or fewer cats joins you instantly, cats and all.' },
      { id: 'goldenlitter', name: 'Golden Litter', icon: '✨', cost: 50, cd: 45, target: 'global', fx: 'golden',
        desc: '+3 cats in every building you own.' },
    ],
  },
  {
    id: 'clawbeard', name: 'Captain Clawbeard', title: 'Terror of the Fish Docks', clan: 'alley', cost: 9500, fur: 'calico',
    blurb: 'Arrr. Every building is treasure if you claw hard enough.',
    passive: { id: 'plunder', name: 'Plunder', desc: 'Capturing a building gives you +8 catnip.' },
    spells: [
      { id: 'cannon', name: 'Cannonball', icon: '💣', cost: 40, cd: 18, target: 'enemy', dur: 5, fx: 'cannon',
        desc: 'Knocks out 15 cats in an enemy building and jams it for 5s (no kittens, no shooting).' },
      { id: 'grog', name: 'Grog Rush', icon: '🍺', cost: 35, cd: 25, target: 'global', dur: 8, fx: 'grog',
        desc: 'All your cats hit 50% harder for 8s.' },
      { id: 'mutiny', name: 'Mutiny', icon: '🏴‍☠️', cost: 60, cd: 40, target: 'area', radius: 110, fx: 'mutiny',
        desc: 'Enemy squads in the area switch sides and fight for you.' },
    ],
  },
  {
    id: 'neko', name: 'Neko-chan', title: 'The Lucky Charm', clan: 'mystic', cost: 11500, fur: 'maneki',
    blurb: 'One wave of her paw and fortune smiles on you.',
    passive: { id: 'fortune', name: 'Fortune', desc: 'Each capture has a 30% chance to grant +5 bonus cats.' },
    spells: [
      { id: 'luckycoin', name: 'Lucky Coin', icon: '🪙', cost: 25, cd: 15, target: 'global', fx: 'coin',
        desc: 'Flip a coin: +30 catnip, OR +3 cats everywhere, OR a free upgrade on a random building.' },
      { id: 'beckon', name: 'Beckoning Paw', icon: '🐾', cost: 40, cd: 22, target: 'notown', max: 15, fx: 'beckon',
        desc: '30% of a building\'s cats (up to 15) walk over to your side.' },
      { id: 'jackpot', name: 'Jackpot', icon: '🎰', cost: 65, cd: 40, target: 'own', max: 30, fx: 'jackpot',
        desc: 'Doubles the cats in your building (up to +30).' },
    ],
  },
  {
    id: 'astro', name: 'Astro', title: 'First Cat on the Moon', clan: 'tech', cost: 13500, fur: 'siamese',
    blurb: 'Astro has seen the stars. Now the stars fight for Astro.',
    passive: { id: 'starcharts', name: 'Star Charts', desc: 'Your towers reach 25% farther and fire 25% faster. Your cats move 8% faster.' },
    spells: [
      { id: 'zerog', name: 'Zero Gravity', icon: '🪐', cost: 30, cd: 16, target: 'area', radius: 150, dur: 6, fx: 'zerog',
        desc: 'Enemy cats in the area float helplessly, moving 70% slower for 6s, and 4 cats from each squad drift away.' },
      { id: 'tractor', name: 'Tractor Beam', icon: '🛸', cost: 45, cd: 22, target: 'area', radius: 120, fx: 'tractor',
        desc: 'A UFO turns enemy squads in the area around and sends them back home.' },
      { id: 'orbital', name: 'Orbital Strike', icon: '🛰️', cost: 60, cd: 38, target: 'enemy', delay: 2.5, fx: 'orbital',
        desc: 'After 2.5s a space laser knocks out 35 cats in an enemy building.' },
    ],
  },
  {
    id: 'purrcival', name: 'Prof. Purrcival', title: 'Inventor Extraordinaire', clan: 'tech', cost: 15500, fur: 'graytabby',
    blurb: 'His gadgets are 90% genius and 10% explosion.',
    passive: { id: 'engineering', name: 'Engineering', desc: 'Upgrades and conversions cost 25% fewer cats.' },
    spells: [
      { id: 'laser', name: 'Laser Pointer', icon: '🔴', cost: 30, cd: 16, target: 'area', radius: 130, dur: 4, fx: 'laser',
        desc: 'Enemy cats in the area drop everything to chase the red dot for 4s.' },
      { id: 'turret', name: 'Auto-Turret', icon: '🔫', cost: 40, cd: 22, target: 'own', dur: 15, fx: 'turret',
        desc: 'Bolts a hairball turret onto your building: it shoots like a tower for 15s.' },
      { id: 'vacuum', name: 'Robo-Vacuum', icon: '🤖', cost: 55, cd: 30, target: 'area', radius: 150, fx: 'vacuum',
        desc: 'Unleashes every cat\'s nightmare: removes 45% of each enemy squad in the area.' },
    ],
  },
  {
    id: 'luna', name: 'Luna', title: 'Witch of the Silver Moon', clan: 'mystic', cost: 18000, fur: 'void',
    blurb: 'Cats have nine lives. Luna knows where the other eight went.',
    passive: { id: 'ninelives', name: 'Nine Lives', desc: '12% of your cats knocked out in battle return to your nearest building.' },
    spells: [
      { id: 'moonbeam', name: 'Moonbeam', icon: '🌕', cost: 35, cd: 18, target: 'own', max: 18, fx: 'moon',
        desc: 'Moonlight fills your building: +35% cats (at least 5, up to 18).' },
      { id: 'curse', name: 'Black Cat Curse', icon: '🐈‍⬛', cost: 45, cd: 25, target: 'enemy', dur: 10, fx: 'curse',
        desc: 'An enemy building stops making kittens and loses 1.5 cats per second for 10s.' },
      { id: 'eclipse', name: 'Eclipse', icon: '🌑', cost: 70, cd: 45, target: 'global', dur: 7, fx: 'eclipse',
        desc: 'Darkness falls: enemy towers stop shooting and enemy kitten-making stops for 7s.' },
    ],
  },
  {
    id: 'glitch', name: 'Glitch', title: 'The Keyboard Cat', clan: 'tech', cost: 20000, fur: 'tuxedo',
    blurb: 'Sits on your keyboard. Sits on your network. Sits on your towers.',
    passive: { id: 'overclock', name: 'Overclock', desc: 'Your spell cooldowns are 25% shorter.' },
    spells: [
      { id: 'firewall', name: 'Firewall', icon: '🔥', cost: 30, cd: 18, target: 'own', dur: 10, fx: 'firewall',
        desc: 'Your building defends 60% better and ignores enemy spells for 10s.' },
      { id: 'hack', name: 'Tower Hack', icon: '💻', cost: 50, cd: 30, target: 'enemy', dur: 10, fx: 'hack',
        desc: 'An enemy tower (or Cat Tree) shoots at its OWN side\'s cats for 10s.' },
      { id: 'drain', name: 'Data Drain', icon: '📡', cost: 35, cd: 25, target: 'global', max: 35, fx: 'drain',
        desc: 'Steal up to 35 catnip from your opponent.' },
    ],
  },
];
export const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));
export function findSpell(id) {
  for (const h of HEROES) for (const s of h.spells) if (s.id === id) return s;
  return null;
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
  { id: 1,  name: 'First Whiskers',    map: 'meadow',   ai: 'easy',   enemy: 'whiskers', reward: 300, tip: 'Drag from your cottage to a stray building to send cats.' },
  { id: 2,  name: 'Tower Trouble',     map: 'rooftops', ai: 'easy',   enemy: 'mittens',  reward: 300, tip: 'Towers shoot cats walking past. Send a big group at once!' },
  { id: 3,  name: 'Snowball Fight',    map: 'snowy',    ai: 'easy',   enemy: 'chef',     reward: 360, tip: 'Tap your cottage to upgrade it. Upgraded cottages make kittens faster.' },
  { id: 4,  name: 'Garden Party',      map: 'moonlit',  ai: 'normal', enemy: 'duchess',  reward: 390, tip: 'Gardens refill your catnip faster. Spells win battles!' },
  { id: 5,  name: 'Dockside Dash',     map: 'docks',    ai: 'normal', enemy: 'clawbeard',reward: 420, tip: 'Forges make all your cats hit harder.' },
  { id: 6,  name: 'Sugar Rush',        map: 'candy',    ai: 'normal', enemy: 'neko',     reward: 450, tip: 'The Grand Cat Tree is worth fighting for.' },
  { id: 7,  name: 'Ninja Night',       map: 'maze',     ai: 'hard',   enemy: 'shadow',   reward: 510, tip: 'Cats walk around hedges and ponds. Drag onto a building to see the road they will take.' },
  { id: 8,  name: 'Chonk Wall',        map: 'ridge',    ai: 'hard',   enemy: 'chonk',    reward: 540, tip: 'Purr Power stars boost your whole army. Keep capturing!' },
  { id: 9,  name: 'Space Race',        map: 'alleys',   ai: 'hard',   enemy: 'astro',    reward: 600, tip: 'Swipe across several of your buildings to send from all of them at once.' },
  { id: 10, name: 'Mad Science',       map: 'archipelago', ai: 'hard', enemy: 'purrcival',reward: 660, tip: 'Bridges are chokepoints. Spread out so one area spell cannot hit everything.' },
  { id: 11, name: 'Witching Hour',     map: 'chocoriver', ai: 'insane', enemy: 'luna',   reward: 750, tip: 'The enemy grows stronger. So do you. Convert buildings to change their job.' },
  { id: 12, name: 'The Keyboard King', map: 'hedgerow', ai: 'insane', enemy: 'glitch',   reward: 1200, tip: 'The final boss. Show them who the real top cat is!' },
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
export const COINS = { onlineWin: 450, onlineLoss: 180, firstWinOfDay: 300, dailyGift: 150, perfMax: 180, perfPerCapture: 6, perfPerSpell: 3, newStar: 120, levelUpBase: 150, levelUpPerLevel: 15 };
