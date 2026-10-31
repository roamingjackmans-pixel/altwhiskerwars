// Alt Whisker Wars - authoritative game simulation.
// Pure logic: runs in the browser (practice / P2P host) and in Node (server tests).
import {
  WORLD_W, WORLD_H, TICK, BASE_SPEED, MAX_CATNIP, BASE_CATNIP_REGEN, START_CATNIP, TIME_LIMIT,
  OVERCAP_DECAY, SQUAD_CHUNK, PURR, purrLevel,
  BTYPES, BUILDINGS, CONVERT_COST, HEROES, heroById, findSpell, skillAt, SKILL_MAX, AI_LEVELS, TOWER_REGROW, STRAY_REGROW, strayRegrowRate, mulberry32,
} from './data.js';
import { getNav } from './nav.js';

// Effect flag bits (shared with the client renderer). Buildings have more effects than fit in one 32-bit mask:
// the first BFX_WORD names go in snapshot b[5], the rest in b[9] (see bfxHas).
export const BFX = ['stone', 'shackle', 'popup', 'boom', 'ranks', 'beam', 'pods', 'kboom', 'paper', 'frozen', 'fly', 'shortcut', 'plague', 'soul', 'invuln', 'defect', 'bounce', 'echo',
  'build', 'transfer', 'arms', 'shrink', 'cannon', 'fort', 'cycle', 'barrier', 'unity', 'wind', 'wave', 'chill', 'haunt', 'possess', 'cauldron', 'seal', 'hypno'];
export const BFX_WORD = 30;
export const SFX = ['stealth', 'frozen', 'slow', 'boost', 'rage', 'chicken', 'stun', 'left', 'wait', 'fly', 'plague',
  'aura', 'slug', 'ball', 'rock', 'lift', 'stash', 'ghost', 'cannon', 'arms', 'shrunk', 'bones'];
// player flags in snapshot p[5]
export const PF = { scouting: 8, silenced: 16, purrLock: 32, golden: 64, glacier: 128, blood: 256 };
// lasting areas on the field
export const ZONES = ['uturn', 'fog', 'spy', 'intel', 'vortex', 'tornado', 'fence', 'magnet',
  'moths', 'ufo', 'slime', 'barrier', 'totem', 'rain', 'sand', 'qsand', 'wind', 'wave', 'worm', 'mine', 'reap'];
const SFX_BIT = Object.fromEntries(SFX.map((n, i) => [n, 1 << i]));
const NEXT_SEND = 30;      // "next cats you send" skills wait this long
const TUNNEL_TIME = 3.5;   // Shortcut
const BEAM_TIME = 2;       // Beam Me Up
const LOSS_MEMORY = 5;     // Second Life looks this far back
const HIST_EVERY = 0.25, HIST_KEEP = 4;   // squad position history for Rewind
const HYPNO_TIME = 5;      // Hypnotize: how long you have to give the order
const STASH_MAX = 45;      // Stash: cats wait at most this long for a friend to walk past
const AURA_KILL = 20;      // Static Fluff: enemy cats knocked out per second while touching a shielded squad
const MOTH_EAT = 2;        // Moth Dome: the building's own cats it uses up per second
const MOTH_KILL = 12;      // Moth Dome: enemy cats knocked out per second per squad under it
const LIFT_TIME = 3;       // Zero-G float time
const WORM_TIME = 4;       // Sand Worm
const SEAL_TIME = 5;       // Iron Seal
const CYCLE_CATS = 20;     // Circle of Life
const SLIME_EVERY = 0.4, SLIME_LIFE = 5, SLIME_R = 26;   // Slug Army trail

export function radiusOf(type, level) {
  const r = BUILDINGS[type].radius;
  return r[Math.min(level, r.length) - 1];
}
export function hasFlag(mask, name, table = BFX) { return (mask & (1 << table.indexOf(name))) !== 0; }
/** does a client-side building ({ fx, fx2 } from the snapshot) show this effect? */
export function bfxHas(b, name) {
  const i = BFX.indexOf(name);
  if (i < 0) return false;
  return i < BFX_WORD ? ((b.fx || 0) & (1 << i)) !== 0 : ((b.fx2 || 0) & (1 << (i - BFX_WORD))) !== 0;
}
/** the 4 skills a player brings into battle: their hero's, or for Riddle a random hero's skill in each slot */
export function rollSlots(hero, skills, rng) {
  if (!hero.random) return hero.spells.map(sp => ({ sp, lv: skills[sp.id] || 1 }));
  const pool = HEROES.filter(h => !h.random);
  return hero.spells.map((own, k) => {
    const h = pool[Math.floor(rng() * pool.length) % pool.length];
    return { sp: h.spells[k], lv: skills[own.id] || 1, via: own.id };
  });
}

const r1 = v => Math.round(v * 10) / 10;
const dist = (a, x, y) => Math.hypot(a.x - x, a.y - y);

export class Game {
  /**
   * cfg = { map: {id,name,theme,buildings:[{id,x,y,type,level,owner,count}]}, players:[{name,hero,fur,hat,ai?,skills?}], seed, timeLimit }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = mulberry32((cfg.seed || 1) >>> 0);
    this.time = 0;
    this.tickNo = 0;
    // more players, more to conquer: 3-4 player battles get 15 minutes unless the lobby picked a time
    this.timeLimit = cfg.timeLimit ?? (cfg.players.length > 2 ? TIME_LIMIT * 1.5 : TIME_LIMIT);
    this.rules = cfg.rules || {};
    this.players = cfg.players.map((p, i) => {
      const hero = heroById(p.hero) || HEROES[0];
      const skills = cleanSkills(p.skills);
      const slots = rollSlots(hero, skills, this.rng);
      return {
        idx: i, name: p.name || ('Player ' + (i + 1)), heroId: hero.id, hero, slots,
        fur: p.fur, hat: p.hat, ai: p.ai || null, skills,
        catnip: START_CATNIP, purr: PURR.start, purrLock: 0, silenced: 0, cds: [0, 0, 0, 0], gcd: 0, alive: true, scoutUntil: 0, scoutCd: 0,
        lastAction: 0, lastEmote: -9,
        // Copy Cat: the slot it lives in and the skill it copied (used once)
        stealSlot: slots.findIndex(s => s.sp.id === 'steal'), stolen: null, lastCast: null,
        goldUntil: 0, glacierUntil: 0, bloodUntil: 0, bloodPurr: 0, redirect: null, cauldron: -1, transferTo: -1, hypno: -1,
        bonusProd: p.ai && AI_LEVELS[p.ai] ? (AI_LEVELS[p.ai].bonusProd || 0) : 0,
        stats: { produced: 0, lost: 0, killed: 0, captured: 0, lostBuildings: 0, spells: 0, sent: 0, peakArmy: 0, upgrades: 0, maxCottage: 1 },
      };
    });
    this.buildings = cfg.map.buildings.map(b => ({
      id: b.id, x: b.x, y: b.y, type: b.type, level: b.level || 1, owner: b.owner ?? -1, count: b.count ?? 10,
      prodAcc: 0, defAcc: 0, fireCd: 1 + this.rng(), fx: {}, fxp: {}, lastHit: -9, losses: [], ghosts: 0,
    }));
    if (this.rules.bigstart) for (const b of this.buildings) b.count *= 2;
    // full: how many cats a building "should" have. Its owner sending cats out or spending them lowers it;
    // enemy attacks don't, so a tower can grow back what it lost in a failed attack.
    for (const b of this.buildings) b.full = b.count;
    this.byId = new Map(this.buildings.map(b => [b.id, b]));
    this.squads = [];
    this.nextSquad = 1;
    this.zones = [];
    this.nextZone = 1;
    this.pending = [];      // delayed spell impacts
    this.projectiles = [];  // tower shots in flight
    this.events = [];
    // walking routes between buildings, around the map's ponds, walls and mounds (worked out once per map)
    this.nav = getNav(cfg.map);
    this.over = false;
    this.winner = -1;
    this.endReason = '';
  }

  // ---------- helpers ----------
  P(i) { return this.players[i]; }
  hero(i) { return this.players[i].hero; }
  /** a skill in one of a player's slots, with its numbers at their level (Copy Cat swaps in the copied skill) */
  spell(i, slot) {
    const p = this.players[i];
    if (!p) return null;
    if (p.stolen && slot === p.stealSlot) { const sp = findSpell(p.stolen.id); if (sp) return { ...skillAt(sp, p.stolen.lv), stolen: true }; }
    const s = p.slots[slot];
    return s ? skillAt(s.sp, s.lv) : null;
  }
  /** level of one of this player's skills (0 when they don't have it this battle) */
  skillLv(i, id) { const p = this.players[i], s = p && p.slots.find(q => q.sp.id === id); return s ? s.lv : 0; }
  fx(b, name) { return (b.fx[name] || 0) > this.time; }
  fxp(b, name) { return this.fx(b, name) ? b.fxp[name] || {} : null; }
  setFx(b, name, until, params = {}) { b.fx[name] = until; b.fxp[name] = params; }
  radius(b) { return radiusOf(b.type, b.level); }
  emit(e) { this.events.push(e); }
  enemiesOf(i) { return this.players.filter(p => p.idx !== i && p.alive).map(p => p.idx); }
  /** what a building is doing right now: a Pop-up Tower or a Fortress counts as a tower */
  btype(b) { return this.fx(b, 'popup') || this.fx(b, 'fort') ? 'tower' : b.type; }
  /** level it shoots at (a Pop-up Tower is capped by the skill, a Fortress is a top-level tower) */
  shootLevel(b) {
    if (this.fx(b, 'fort')) return BUILDINGS.tower.maxLevel;
    if (this.fx(b, 'popup')) return Math.max(1, Math.min(b.level, b.fxp.popup.tlv || 1, BUILDINGS.tower.maxLevel));
    return b.level;
  }
  working(b) { return !this.fx(b, 'frozen') && !this.fx(b, 'popup') && !this.fx(b, 'fort'); }
  /** cats in a building that can be sent out or spent (ghosts from Haunted House can't) */
  real(b) { return Math.max(0, b.count - (b.ghosts || 0)); }

  cap(b) { return Math.round(BUILDINGS[b.type].cap[b.level - 1]); }
  defense(b) {
    let d = BUILDINGS[this.btype(b)].defense;
    const st = this.fxp(b, 'stone'); if (st) d *= st.mul;
    if (b.owner >= 0) d *= 1 + this.stars(b.owner) * PURR.def;
    const pw = this.fxp(b, 'paper'); if (pw) d *= Math.max(0.15, 1 - pw.drop);
    // Teeny Tiny: the shrunken garrison fights weaker
    const sh = this.fxp(b, 'shrink'); if (sh) d *= sh.atk;
    // Rage Totem: an extra forge for buildings in its area
    if (b.owner >= 0) { const z = this.inZone('totem', b.x, b.y, q => q.o === b.owner); if (z) d *= z.atk; }
    return d;
  }
  stars(i) {
    if (i < 0 || !this.players[i]) return 0;
    const p = this.players[i];
    return p.goldUntil > this.time ? 5 : purrLevel(p.purr);
  }
  forgeBonus(i) {
    if (i < 0) return 0;
    let s = 0;
    for (const b of this.buildings) if (b.owner === i && b.type === 'forge' && this.working(b)) s += BUILDINGS.forge.atkBonus[b.level - 1];
    return Math.min(s, 0.6);
  }
  attack(i, squad) {
    // chickens get no forge or Purr Power bonus
    if (squad && squad.chick) return squad.chick;
    // wild sand cats (no owner) fight plain
    if (i < 0) return 1;
    // Purr Power multiplies everything else
    let a = (1 + this.forgeBonus(i)) * (1 + this.stars(i) * PURR.atk);
    if (squad && squad.atkMul) a *= squad.atkMul;
    if (squad && squad.totem) a *= squad.totem;
    return a;
  }
  inZone(kind, x, y, pred) {
    for (const z of this.zones) if (z.k === kind && Math.hypot(z.x - x, z.y - y) <= z.r && (!pred || pred(z))) return z;
    return null;
  }
  /** skills can't touch cannonballs, ghosts or shielded cats */
  shielded(s) { return !!s.immune || (s.fx.aura || 0) > this.time; }
  squadSpeed(s) {
    const t = this.time;
    if ((s.fx.frozen || 0) > t || (s.fx.stun || 0) > t || (s.fx.lift || 0) > t || s.stash) return 0;
    let v = BASE_SPEED * (1 + this.stars(s.owner) * PURR.spd) * (s.spdMul || 1) / (s.slowmo || 1);
    if (!this.shielded(s)) {
      for (const z of this.zones) {
        if (z.k === 'wind') { v *= this.windFactor(z, s); continue; }
        if (Math.hypot(z.x - s.x, z.y - s.y) > z.r) continue;
        if (z.k === 'vortex') v *= 1.5;
        else if (z.o === s.owner) continue;
        else if (z.k === 'fog' || z.k === 'rain' || z.k === 'qsand' || z.k === 'slime') v *= z.slow;
        else if (z.k === 'sand') return 0;   // stuck in the sandstorm
      }
    }
    if (this.rules.zoomies) v *= 1.5;
    return v;
  }
  /** Gust: faster walking with the wind, slower against it (only inside the wind's lane) */
  windFactor(z, s) {
    const px = s.x - z.x, py = s.y - z.y;
    const along = px * z.ux + py * z.uy, side = Math.abs(px * z.uy - py * z.ux);
    if (along < -20 || along > z.len || side > z.w) return 1;
    const pt = s.path && s.path[s.wp];
    if (!pt) return 1;
    const dx = pt.x - s.x, dy = pt.y - s.y, d = Math.hypot(dx, dy) || 1;
    const dot = (dx * z.ux + dy * z.uy) / d;
    return dot > 0.3 ? z.spd : dot < -0.3 ? 1 / z.spd : 1;
  }
  catnipRegen(i) {
    const p = this.players[i];
    if (p && p.glacierUntil > this.time) return 0;   // Big Freeze
    let m = 1;
    for (const b of this.buildings) if (b.owner === i && b.type === 'garden' && this.working(b)) m += BUILDINGS.garden.catnipBonus[b.level - 1];
    return BASE_CATNIP_REGEN * m * (this.rules.frenzy ? 2 : 1);
  }
  upgradeCost(b) { const c = BUILDINGS[b.type].upgradeCost[b.level - 1]; return c == null ? null : c; }
  convertCost(b, to) { return CONVERT_COST[to]; }
  addPurr(i, v, force = false) {
    if (i < 0 || !this.players[i]) return;
    const p = this.players[i];
    if (!force && p.purrLock > this.time) return;
    const before = this.stars(i);
    p.purr = Math.max(0, Math.min(PURR.max, p.purr + v));
    const after = this.stars(i);
    if (after > before) this.emit({ k: 'star', o: i, n: after });
    else if (after < before) this.emit({ k: 'unstar', o: i, n: after });
  }
  setPurr(i, v) { this.addPurr(i, v - this.players[i].purr, true); }
  armyOf(i) {
    let n = 0;
    for (const b of this.buildings) if (b.owner === i) n += b.count;
    for (const s of this.squads) if (s.owner === i) n += s.count;
    return n;
  }
  nearestOwned(i, x, y, exceptId = -1) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== i || b.id === exceptId) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  /** can player i see the cats inside building b? (their own, strays, Spy Eye, Food Poisoning) */
  canSee(i, b) {
    if (b.owner === i || b.owner < 0) return true;
    const p = this.players[i];
    if (!p) return true;
    return this.revealed(i, b);
  }
  revealed(i, b) {
    const pl = this.fxp(b, 'plague');
    if (pl && pl.by === i) return true;
    return !!this.inZone('spy', b.x, b.y, z => z.o === i);
  }

  // ---------- paths ----------
  /** Waypoints from building to building (shared, read-only arrays). */
  path(from, to) { return this.nav.path(from.id, to.id); }
  /** Walking distance between two buildings: what travel time, AI choices and previews go by. */
  pathLen(from, to) { return this.nav.len(from.id, to.id); }
  /** Waypoints from any point to a building, e.g. a squad turned around mid-field. */
  computePath(x0, y0, to) { return this.nav.pathFrom(x0, y0, to.id); }
  /** Your building with the shortest walk to `b`. */
  nearestOwnedByPath(i, b) {
    let best = null, bd = Infinity;
    for (const o of this.buildings) {
      if (o.owner !== i || o.id === b.id) continue;
      const d = this.nav.len(b.id, o.id);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------- commands ----------
  command(i, c) {
    if (this.over || !c || !this.players[i] || !this.players[i].alive) return;
    const p = this.players[i];
    // doing things keeps your Purr Power from draining (emotes don't count)
    if (c.k !== 'emote') p.lastAction = this.time;
    switch (c.k) {
      case 'send': return this.cmdSend(i, c);
      case 'up': return this.cmdUpgrade(i, c);
      case 'conv': return this.cmdConvert(i, c);
      case 'spell': return this.cmdSpell(i, c);
      case 'emote':
        if (this.time - p.lastEmote < 1.2) return;
        p.lastEmote = this.time;
        return this.emit({ k: 'emote', o: i, id: String(c.id).slice(0, 12) });
      case 'surrender':
        this.eliminate(i, 'surrender');
        return;
    }
  }
  err(i, msg) { this.emit({ k: 'err', o: i, msg }); }

  cmdSend(i, c) {
    const to = this.byId.get(c.to);
    if (!to || !Array.isArray(c.from)) return;
    if (this.fx(to, 'cauldron')) return this.err(i, 'That building is under a cauldron!');
    // Charm Shield: rivals can't send attacks at it
    if (to.owner >= 0 && to.owner !== i && this.fx(to, 'bounce')) return this.err(i, 'That building is charmed: no attacks right now!');
    const pct = clamp(Number(c.pct) || 0.5, 0.05, 1);
    const t = this.time;
    for (const fid of c.from.slice(0, 30)) {
      const from = this.byId.get(fid);
      if (!from || from.id === to.id) continue;
      if (from.owner !== i) {
        // Hypnotize: the spellbound share of a rival or stray building follows your order
        const hy = this.fxp(from, 'hypno');
        if (!hy || hy.by !== i) continue;
        const n = Math.floor(from.count * hy.pct);
        from.fx.hypno = 0; this.players[i].hypno = -1;
        if (n < 1) continue;
        from.count -= n; from.full = Math.min(from.full, from.count);
        if (from.owner >= 0) this.players[from.owner].stats.lost += n;
        this.players[i].stats.sent += n;
        this.launch(i, from, to, n);
        this.emit({ k: 'send', o: i, from: from.id, to: to.id, n });
        continue;
      }
      if (this.fx(from, 'shackle')) { this.err(i, 'That building is in shackles!'); continue; }
      if (this.fx(from, 'possess')) { this.err(i, 'A possessed building can\'t send cats out'); continue; }
      // Pack Up: every cat moves into your other building at once
      if (this.fx(from, 'unity') && to.owner === i) {
        const n = this.real(from);
        from.fx.unity = 0;
        if (n < 1) continue;
        from.count -= n; from.full = from.count; to.count += n;
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n: Math.round(n), fx: 'unity' });
        continue;
      }
      // Beam Me Up: a share of the building's cats beams straight to another of your buildings
      const beam = this.fxp(from, 'beam');
      if (beam && to.owner === i) {
        const n = Math.floor(this.real(from) * beam.pct);
        if (n < 1) continue;
        from.count -= n; from.full = from.count; from.fx.beam = 0;
        this.pending.push({ at: t + BEAM_TIME, k: 'land', o: i, to: to.id, from: from.id, n });
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n, fx: 'beam' });
        continue;
      }
      let n = Math.floor(this.real(from) * pct);
      if (n < 1) continue;
      const sent = n;
      from.count -= n;
      from.full = from.count;
      this.players[i].stats.sent += n;
      const plague = this.fxp(from, 'plague');
      const carry = plague ? { ...plague, until: from.fx.plague } : null;
      // what the building gives everything it sends: To Arms!, Teeny Tiny
      const mods = { plague: carry };
      const arms = this.fxp(from, 'arms'); if (arms) { mods.atkMul = arms.atk; mods.tag = 'arms'; }
      const shr = this.fxp(from, 'shrink'); if (shr) { mods.atkMul = (mods.atkMul || 1) * shr.atk; mods.spdMul = shr.slow; mods.tag = 'shrunk'; }
      const go = (k, o = {}) => this.launch(i, from, to, k, { ...mods, ...o, spdMul: (o.spdMul || 1) * (mods.spdMul || 1) });
      this.nextSendZones(i, from, to);
      // Kitty Cannon: everything flies on cannonballs
      const cn = this.fxp(from, 'cannon');
      if (cn) {
        go(n, { fly: true, packed: true, spdMul: 2, atkMul: (mods.atkMul || 1) * cn.atk, cannon: true });
        this.emit({ k: 'send', o: i, from: from.id, to: to.id, n: sent });
        continue;
      }
      // Shortcut: up to N cats take a tunnel and pop out at the target a few seconds later
      const sc = this.fxp(from, 'shortcut');
      if (sc) {
        const k = Math.min(n, sc.n); n -= k; from.fx.shortcut = 0;
        this.pending.push({ at: t + TUNNEL_TIME, k: 'land', o: i, to: to.id, from: from.id, n: k, plague: carry });
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n: k, fx: 'tunnel' });
        if (n < 1) continue;
      }
      // Bee Lift: straight over everything, faster
      const fly = this.fxp(from, 'fly');
      if (fly) {
        const k = Math.min(n, fly.n); n -= k; from.fx.fly = 0;
        go(k, { fly: true, spdMul: fly.spd, packed: true, bees: true });
      }
      // Tight Formation: one packed, faster squad
      const rk = this.fxp(from, 'ranks');
      if (rk && n > 0) {
        const k = Math.min(n, rk.n); n -= k; from.fx.ranks = 0;
        go(k, { packed: true, spdMul: rk.spd });
      }
      if (n > 0) go(n);
      this.emit({ k: 'send', o: i, from: from.id, to: to.id, n: sent });
    }
  }
  /** Laser Wall, Gust and Frost Wave start along the road of the next cats sent */
  nextSendZones(i, from, to) {
    const t = this.time;
    const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const bar = this.fxp(from, 'barrier');
    if (bar) {
      from.fx.barrier = 0;
      const r0 = this.radius(from) + 6, r1 = this.radius(to) + 6, len = Math.max(20, d - r0 - r1);
      const x0 = from.x + ux * r0, y0 = from.y + uy * r0;
      this.addZone({ k: 'barrier', o: i, x: x0 + ux * len / 2, y: y0 + uy * len / 2, r: len / 2, x0, y0, ux, uy, len, until: t + bar.dur, left: bar.cap });
    }
    const wd = this.fxp(from, 'wind');
    if (wd) {
      from.fx.wind = 0;
      const len = 1900;
      this.addZone({ k: 'wind', o: i, x: from.x, y: from.y, r: len, ux, uy, len, w: 80, spd: wd.spd, until: t + wd.dur });
    }
    const wv = this.fxp(from, 'wave');
    if (wv) {
      from.fx.wave = 0;
      this.addZone({ k: 'wave', o: i, x: from.x, y: from.y, x0: from.x, y0: from.y, r: 46, ux, uy, len: d, speed: 300, until: t + d / 300 + 0.3, freeze: wv.dur, born: t });
    }
  }
  launch(i, from, to, n, opts = {}) {
    const path = opts.fly ? [{ x: to.x, y: to.y }] : opts.path || this.path(from, to);
    const first = path[0];
    const ang = Math.atan2(first.y - from.y, first.x - from.x);
    const r = this.radius(from) * 0.7;
    let k = 0;
    while (n > 0.01) {
      const c = opts.packed ? n : Math.min(n, SQUAD_CHUNK);
      n -= c;
      const jitter = (this.rng() - 0.5) * 16;
      const s = {
        id: this.nextSquad++, owner: i, count: c, from: from.id, to: to.id,
        x: from.x + Math.cos(ang) * r - Math.sin(ang) * jitter, y: from.y + Math.sin(ang) * r + Math.cos(ang) * jitter,
        path, wp: 0, wait: k * 0.45 + (opts.delay || 0), fx: {}, face: Math.cos(ang) < 0 ? 1 : 0, hist: [], born: this.time,
      };
      if (opts.spdMul && opts.spdMul !== 1) s.spdMul = opts.spdMul;
      if (opts.atkMul && opts.atkMul !== 1) s.atkMul = opts.atkMul;
      if (opts.tag) s.fx[opts.tag] = Infinity;
      if (opts.fly) { s.fly = true; if (opts.bees) s.fx.fly = Infinity; }
      if (opts.cannon) { s.immune = true; s.noTower = true; s.air = true; s.fx.cannon = Infinity; }
      if (opts.plague) { s.plague = opts.plague; s.fx.plague = Infinity; }
      this.squads.push(s);
      k++;
    }
  }
  /** a squad that appears out of nowhere at (x, y) and walks (or flies) to building `to` */
  spawnSquad(i, n, x, y, to, o = {}) {
    const s = {
      id: this.nextSquad++, owner: i, count: n, from: o.from ?? -1, to: to.id, x, y,
      path: o.fly ? [{ x: to.x, y: to.y }] : this.computePath(x, y, to), wp: 0, wait: o.wait || 0,
      fx: { ...(o.fx || {}) }, face: to.x < x ? 1 : 0, hist: [],
    };
    if (o.fly) s.fly = true;
    if (o.immune) { s.immune = true; s.noTower = true; }
    this.squads.push(s);
    return s;
  }
  /** a spot just outside building b, on the side facing player i's nearest building */
  besidePoint(i, b, dist = 75) {
    const home = this.nearestOwned(i, b.x, b.y, b.id);
    let a = home ? Math.atan2(home.y - b.y, home.x - b.x) : this.rng() * Math.PI * 2;
    const r = this.radius(b) + dist;
    return { x: clamp(b.x + Math.cos(a) * r, 10, WORLD_W - 10), y: clamp(b.y + Math.sin(a) * r, 10, WORLD_H - 10) };
  }
  cmdUpgrade(i, c) {
    const b = this.byId.get(c.b);
    if (!b || b.owner !== i) return;
    const def = BUILDINGS[b.type];
    if (b.level >= def.maxLevel) return this.err(i, 'Already max level!');
    // Free Build: this one costs nothing
    const free = this.fx(b, 'build');
    const cost = free ? 0 : this.upgradeCost(b);
    if (this.real(b) < cost) return this.err(i, `Needs ${cost} cats to upgrade`);
    if (free) b.fx.build = 0;
    b.count -= cost; b.full = b.count;
    this.doUpgrade(b, i);
  }
  doUpgrade(b, i) {
    const gain = (PURR.upgrade[b.type] || [])[b.level - 1] || 0;
    b.level = Math.min(b.level + 1, BUILDINGS[b.type].maxLevel);
    const st = this.players[i].stats;
    st.upgrades++;
    if (b.type === 'cottage') st.maxCottage = Math.max(st.maxCottage, b.level);
    this.addPurr(i, gain);
    this.emit({ k: 'up', o: i, b: b.id, lv: b.level });
  }
  cmdConvert(i, c) {
    const b = this.byId.get(c.b);
    if (!b || b.owner !== i || !CONVERT_COST[c.to] || b.type === c.to || BUILDINGS[b.type].noConvert) return;
    const free = this.fx(b, 'build');
    const cost = free ? 0 : this.convertCost(b, c.to);
    if (this.real(b) < cost) return this.err(i, `Needs ${cost} cats to convert`);
    if (free) b.fx.build = 0;
    b.count -= cost; b.full = b.count;
    b.type = c.to; b.level = 1; b.fireCd = 1;
    b.fx.popup = 0;
    // a building that was cooled to level 1 by Cold Snap stays at its new level
    if (b.fxp.chill) b.fxp.chill.lv = 1;
    this.emit({ k: 'conv', o: i, b: b.id, to: c.to });
  }

  // ---------- skills ----------
  cmdSpell(i, c) {
    const p = this.players[i];
    const slot = c.slot | 0;
    const sp = this.spell(i, slot);
    if (!sp) return;
    if (p.silenced > this.time) return this.err(i, 'Hush! No skills right now');
    // a copied skill can be used while Copy Cat itself recharges
    if ((p.cds[slot] > 0 && !sp.stolen) || p.gcd > 0) return this.err(i, 'Skill is recharging');
    if (p.catnip < sp.cost) return this.err(i, 'Not enough catnip!');
    let b = null, x = Number(c.x), y = Number(c.y);
    if (['own', 'enemy', 'neutral', 'notown', 'owned', 'any'].includes(sp.target)) {
      b = this.byId.get(c.b);
      if (!b) return;
      if (!targetOk(sp.target, b, i)) return this.err(i, 'Pick a glowing building');
      if (this.fx(b, 'cauldron')) return this.err(i, 'That building is under a cauldron');
      x = b.x; y = b.y;
    } else if (sp.target === 'area') {
      if (!isFinite(x) || !isFinite(y)) return;
      x = clamp(x, 0, WORLD_W); y = clamp(y, 0, WORLD_H);
    }
    const res = this.applySpell(i, sp, b, x, y);
    if (res === false) return;
    p.catnip -= sp.cost;
    if (sp.stolen) p.stolen = null;
    else p.cds[slot] = sp.cd;
    p.gcd = 0.8;
    p.stats.spells++;
    if (sp.id !== 'steal') p.lastCast = { id: sp.id, lv: sp.level, t: this.time };
    this.emit({ k: 'spell', o: i, id: sp.id, fx: sp.fx, x: r1(x || 0), y: r1(y || 0), b: b ? b.id : -1, r: sp.r || 0, res: res != null ? String(res) : undefined, lv: sp.level });
  }

  /** squads in a circle that skills can affect (cannonballs, ghosts and shielded cats are left alone) */
  squadsIn(x, y, r, pred) { return this.squads.filter(s => s.wait <= 0 && !this.shielded(s) && Math.hypot(s.x - x, s.y - y) <= r + 6 && (!pred || pred(s))); }
  enemySquadsIn(i, x, y, r) { return this.squadsIn(x, y, r, s => s.owner !== i); }
  /**
   * Knock cats out of a squad. kind: 'tower' / 'field' (they count as cats lost attacking: Purr Power and comeback
   * catnip) or 'spell' (skill knockouts give neither).
   */
  killSquadCats(s, n, killer, kind = 'spell') {
    n = Math.min(s.count, n);
    if (n <= 0) return 0;
    s.count -= n;
    this.onLosses(s.owner, n, s.x, s.y, killer, kind);
    this.slugSplit(s, n);
    if (s.count < 0.5) this.removeSquad(s, 'pop');
    return n;
  }
  /** Slug Army: some knocked-out slugs split in two and keep crawling */
  slugSplit(s, n) {
    if (!s.slug || n <= 0) return;
    const back = n * s.slug.split;
    if (back <= 0) return;
    s.count += back;
    if (s.owner >= 0) this.players[s.owner].stats.produced += back;
    if (back >= 1) this.emit({ k: 'split', x: r1(s.x), y: r1(s.y), n: Math.round(back) });
  }
  removeSquad(s, why) {
    const idx = this.squads.indexOf(s);
    if (idx >= 0) this.squads.splice(idx, 1);
    if (why) this.emit({ k: why, x: r1(s.x), y: r1(s.y), o: s.owner });
  }
  /**
   * Bookkeeping for knocked-out cats.
   *   attack:   `owner` lost cats attacking a rival. Their purr drops, they get comeback catnip, the defender's purr rises.
   *   field:    cats lost fighting on the road (both sides count it as attacking).
   *   tower:    shot by a rival's tower (like attacking).
   *   garrison: cats inside a building knocked out by attackers (losing the building is what costs purr).
   *   spell:    knocked out by a skill (no purr, no catnip).
   */
  onLosses(owner, n, x, y, killer, kind) {
    if (n <= 0) return;
    this.reapSouls(n, x, y);
    if (owner < 0) return;
    const p = this.players[owner];
    p.stats.lost += n;
    if (killer >= 0 && killer !== owner) this.players[killer].stats.killed += n;
    const vsRival = killer >= 0 && killer !== owner;
    // Blood Pact: every lost cat earns Purr Power instead
    const blood = p.bloodUntil > this.time;
    if (blood) this.addPurr(owner, p.bloodPurr * n);
    if ((kind === 'attack' || kind === 'field' || kind === 'tower') && vsRival) {
      if (!blood) this.addPurr(owner, PURR.lostAttacking * n);
      p.catnip = Math.min(MAX_CATNIP, p.catnip + PURR.catnipPerLoss * PURR.catnipK[this.stars(owner)] * n);
      if (kind !== 'field') this.addPurr(killer, PURR.killDefending * n);
    }
  }
  /** Soul Harvest: cats knocked out near the harvesting building come back inside it */
  reapSouls(n, x, y) {
    for (const z of this.zones) {
      if (z.k !== 'reap' || z.until <= this.time || Math.hypot(z.x - x, z.y - y) > z.r) continue;
      const b = this.byId.get(z.b);
      if (!b || b.owner !== z.o) continue;
      const k = n * z.pct;
      b.count += k;
      this.players[z.o].stats.produced += k;
      z.acc = (z.acc || 0) + k;
      if (z.acc >= 3) { this.emit({ k: 'souls', o: z.o, x: r1(x), y: r1(y), b: b.id, n: Math.round(z.acc) }); z.acc = 0; }
      return;
    }
  }
  /** cats knocked out of a building (by a skill, a tornado, poison...) */
  damageBuilding(b, n, attacker, kind = 'spell', noEcho = false) {
    if (this.fx(b, 'invuln') && attacker !== b.owner) return 0;
    const d = Math.min(b.count, n);
    if (d <= 0) return 0;
    b.count -= d;
    b.lastHit = this.time;
    if (b.ghosts) b.ghosts = Math.max(0, b.ghosts - d);
    if (b.owner >= 0) { this.onLosses(b.owner, d, b.x, b.y, attacker, kind); b.losses.push({ t: this.time, n: d }); }
    if (!noEcho) this.echo(b, d);
    return d;
  }
  /** Echo Hex: cats knocked out of the hexed building are also knocked out of the nearest buildings that aren't the caster's */
  echo(b, d) {
    const e = this.fxp(b, 'echo');
    if (!e || d <= 0) return;
    const near = this.buildings.filter(o => o !== b && o.owner !== e.by && !this.fx(o, 'cauldron')).sort((p, q) => dist(p, b.x, b.y) - dist(q, b.x, b.y)).slice(0, e.bld);
    for (const o of near) {
      const k = this.damageBuilding(o, d * e.pct, e.by, 'spell', true);
      if (k > 0.5) this.emit({ k: 'echo', o: e.by, from: b.id, b: o.id, n: r1(k) });
    }
  }
  /** a squad gives up and walks back to where it came from (or its owner's nearest building) */
  turnHome(s, stun = 0.4) {
    let home = this.byId.get(s.from);
    if (!home || home.owner !== s.owner) {
      home = null;
      let bd = Infinity;
      for (const o of this.buildings) if (o.owner === s.owner) { const d = this.nav.distFrom(s.x, s.y, o.id); if (d < bd) { bd = d; home = o; } }
    }
    if (!home) return false;
    s.to = home.id; s.from = home.id;
    s.path = s.fly ? [{ x: home.x, y: home.y }] : this.computePath(s.x, s.y, home); s.wp = 0;
    if (stun) s.fx.stun = this.time + stun;
    return true;
  }
  addZone(z) { z.id = this.nextZone++; this.zones.push(z); return z; }

  applySpell(i, sp, b, x, y) {
    const t = this.time, p = this.players[i];
    const dur = sp.dur || 0;
    const mine = s => s.owner === i;
    switch (sp.id) {
      // ================================================================ Sir Barnaby
      case 'stonepaws': this.setFx(b, 'stone', t + dur, { mul: sp.mul }); return;
      case 'zoomboots':
        for (const s of this.squadsIn(x, y, sp.r)) { s.spdMul = (s.spdMul || 1) * sp.spd; s.fx.boost = Infinity; }
        return;
      case 'luckystar': {
        const lv = purrLevel(p.purr);
        if (lv < 5) this.setPurr(i, Math.max(p.purr, PURR.stars[lv + 1]));
        p.purrLock = Math.max(p.purrLock, t + dur);
        return;
      }
      case 'sneak': this.pending.push({ at: t + (sp.delay || 2.2), k: 'sneak', o: i, n: sp.n }); return;
      // ================================================================ Major Mortar
      case 'popup':
        if (!['cottage', 'forge', 'garden'].includes(b.type)) { this.err(i, 'Only cottages, forges and gardens'); return false; }
        this.setFx(b, 'popup', t + dur, { tlv: sp.tlv }); b.fireCd = 0.3; return;
      case 'boomballs':
        if (!(BUILDINGS[this.btype(b)].range)) { this.err(i, 'Pick one of your towers'); return false; }
        this.setFx(b, 'boom', t + dur, { splash: sp.splash }); return;
      case 'ranks': this.setFx(b, 'ranks', t + NEXT_SEND, { n: sp.n, spd: sp.spd }); return;
      case 'bomb': {
        this.damageBuilding(b, Math.ceil(b.count * sp.pct), i, 'spell');
        let n = 0;
        for (const s of this.enemySquadsIn(i, b.x, b.y, sp.r)) n += this.killSquadCats(s, s.count, i, 'spell');
        return Math.round(n);
      }
      // ================================================================ Hammerpaw
      case 'builder': this.setFx(b, 'build', t + NEXT_SEND); return;
      case 'prodshift': this.setFx(b, 'transfer', t + dur); p.transferTo = b.id; return;
      case 'evenout': {
        const list = this.buildings.filter(q => q.owner === b.owner);
        if (list.length < 2) { this.err(i, 'That player has only one building'); return false; }
        const avg = list.reduce((a, q) => a + q.count, 0) / list.length;
        for (const q of list) { q.count = avg; q.full = avg; q.ghosts = Math.min(q.ghosts || 0, avg); }
        return Math.round(avg);
      }
      case 'goldpurr': p.goldUntil = Math.max(p.goldUntil, t + dur); return;
      // ================================================================ General Cinder
      case 'shackles': this.setFx(b, 'shackle', t + dur); return;
      case 'evenpurr': {
        const alive = this.players.filter(q => q.alive);
        const avg = alive.reduce((a, q) => a + q.purr, 0) / Math.max(1, alive.length);
        for (const q of alive) this.setPurr(q.idx, avg);
        return;
      }
      case 'fury':
        for (const s of this.squadsIn(x, y, sp.r)) { s.atkMul = Math.max(s.atkMul || 1, sp.atk); s.spdMul = (s.spdMul || 1) * sp.spd; s.fx.rage = Infinity; }
        return;
      case 'firering': this.pending.push({ at: t + 0.7, k: 'fire', o: i, x, y, r: sp.r, cap: sp.cap }); return;
      // ================================================================ Elder Mossbeard
      case 'maneuver': {
        const n = Math.floor(b.count * 0.25);
        if (n < 1) { this.err(i, 'Nobody home to snatch!'); return false; }
        const home = this.nearestOwnedByPath(i, b);
        if (!home) return false;
        b.count -= n; b.full = Math.min(b.full, b.count);
        if (b.owner >= 0) this.players[b.owner].stats.lost += n;
        this.launch(i, b, home, n);
        return n;
      }
      case 'lifecycle':
        if (b.level < 2) { this.err(i, 'Only level 2 or higher buildings'); return false; }
        this.setFx(b, 'cycle', t + dur); return;
      case 'slugs': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, mine)) { s.slug = { split: sp.split, slow: sp.slow }; s.fx.slug = Infinity; s.slimeT = 0; n += s.count; }
        return Math.round(n);
      }
      case 'moths':
        if (b.count < 1) { this.err(i, 'The dome needs cats inside'); return false; }
        for (const z of this.zones) if (z.k === 'moths' && z.b === b.id) z.until = t;
        this.addZone({ k: 'moths', o: i, b: b.id, x: b.x, y: b.y, r: this.radius(b) + 10, rmax: sp.r, until: t + 120, left: sp.cap });
        return;
      // ================================================================ King Thunderpurr
      case 'toarms': this.setFx(b, 'arms', t + dur, { atk: sp.atk }); return;
      case 'shrink': this.setFx(b, 'shrink', t + dur, { atk: sp.atk, slow: sp.slow }); return;
      case 'bfg':
        if (b.type === 'cattree') { this.err(i, 'Not on the Grand Cat Tree'); return false; }
        this.setFx(b, 'cannon', t + dur, { atk: sp.atk }); return;
      case 'fortify': {
        let n = 0;
        for (const q of this.buildings) if (q.owner === i && q.type !== 'cattree') { this.setFx(q, 'fort', t + dur); q.fireCd = Math.min(q.fireCd, 0.3 + n * 0.05); n++; }
        return n;
      }
      // ================================================================ Commander Nova
      case 'beam': this.setFx(b, 'beam', t + NEXT_SEND, { pct: sp.pct }); return;
      case 'cloak': for (const s of this.squadsIn(x, y, sp.r, mine)) s.fx.stealth = t + dur; return;
      case 'uturn': this.addZone({ k: 'uturn', o: i, x, y, r: sp.r, until: t + dur }); return;
      case 'pods': this.setFx(b, 'pods', t + sp.fill, { left: sp.n, rate: sp.n / sp.fill }); return;
      // ================================================================ Count Tickstorm
      case 'mindread': this.addZone({ k: 'intel', o: i, x, y, r: sp.r, until: t + (sp.dur || 8) }); return;
      case 'rewind': {
        let n = 0;
        for (const s of this.enemySquadsIn(i, x, y, sp.r)) if (this.rewind(s, sp.back)) n++;
        return n;
      }
      case 'shortcut': this.setFx(b, 'shortcut', t + NEXT_SEND, { n: sp.n }); return;
      case 'chain': {
        let s0 = null, bd = 120;
        for (const s of this.squads) { if (s.wait > 0 || this.shielded(s)) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; s0 = s; } }
        if (!s0) { this.err(i, 'Tap right next to a squad'); return false; }
        const o = s0.owner, hit = new Set(), pts = [];
        let cur = s0, left = sp.cap;
        while (cur && left > 0.5) {
          hit.add(cur.id); pts.push([Math.round(cur.x), Math.round(cur.y)]);
          const cx = cur.x, cy = cur.y;
          left -= this.killSquadCats(cur, Math.min(left, cur.count), i, 'spell');
          let next = null, nd = 230;
          for (const s of this.squads) { if (s.owner !== o || hit.has(s.id) || s.wait > 0 || this.shielded(s)) continue; const d = Math.hypot(s.x - cx, s.y - cy); if (d < nd) { nd = d; next = s; } }
          cur = next;
        }
        this.emit({ k: 'chain', o: i, pts });
        return Math.round(sp.cap - left);
      }
      // ================================================================ Rift
      case 'deposit': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, q => q.owner === i && !q.stash)) {
          const add = s.count * sp.clone;
          s.count += add; p.stats.produced += add; n += s.count;
          s.stash = t + STASH_MAX; s.fx.stealth = t + STASH_MAX; s.fx.stash = t + STASH_MAX;
        }
        return Math.round(n);
      }
      case 'barrier': this.setFx(b, 'barrier', t + NEXT_SEND, { dur: sp.dur, cap: sp.cap }); return;
      case 'heads': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, q => q.owner === i && !q.stash)) {
          let tg = null, bd = Infinity;
          for (const q of this.buildings) { if (q.owner === i || this.fx(q, 'cauldron')) continue; const d = dist(q, s.x, s.y); if (d < bd) { bd = d; tg = q; } }
          if (!tg) continue;
          s.to = tg.id; s.path = [{ x: tg.x, y: tg.y }]; s.wp = 0; s.fly = true;
          s.ball = sp.mult; s.fx.ball = Infinity; s.spdMul = (s.spdMul || 1) * 1.3;
          n += s.count;
        }
        return Math.round(n);
      }
      case 'clone': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, q => !q.stash)) {
          const back = this.byId.get(s.from);
          if (!back || back.id === s.to) continue;
          const k = s.count * sp.pct;
          if (k < 0.5) continue;
          const c = this.spawnSquad(i, k, s.x, s.y, back, { from: s.to, fx: { stun: t + 0.3 } });
          if (s.fly) { c.fly = true; c.path = [{ x: back.x, y: back.y }]; }
          p.stats.produced += k; n += k;
        }
        return Math.round(n);
      }
      // ================================================================ Orbit
      case 'ufo': this.addZone({ k: 'ufo', o: i, x, y, r: sp.r, until: t + 6, left: sp.n, cd: 0.5 }); return;
      case 'pulse': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, mine)) { s.spdMul = (s.spdMul || 1) * sp.spd; s.fx.boost = Infinity; n += s.count; }
        return Math.round(n);
      }
      case 'aura': {
        let n = 0;
        for (const s of this.squadsIn(x, y, sp.r, mine)) { s.fx.aura = t + dur; n += s.count; }
        return Math.round(n);
      }
      case 'gravity': {
        const ids = [];
        for (const s of this.enemySquadsIn(i, x, y, sp.r)) { s.fx.lift = t + LIFT_TIME; ids.push(s.id); }
        this.pending.push({ at: t + LIFT_TIME, k: 'drop', o: i, ids, pct: sp.pct });
        return ids.length;
      }
      // ================================================================ Doctor Whirl
      case 'spyeye': this.addZone({ k: 'spy', o: i, x, y, r: sp.r, until: t + dur, prod: sp.prod }); return;
      case 'fog': this.addZone({ k: 'fog', o: i, x, y, r: sp.r, until: t + (sp.dur || 15), slow: sp.slow }); return;
      case 'hypno': {
        if (b.count < 1.5) { this.err(i, 'Nobody home to hypnotize!'); return false; }
        if (p.hypno >= 0) { const o = this.byId.get(p.hypno); if (o) o.fx.hypno = 0; }
        this.setFx(b, 'hypno', t + HYPNO_TIME, { by: i, pct: sp.pct });
        p.hypno = b.id;
        return;
      }
      case 'zapfence': {
        // an electric dome: cats crossing its edge (in or out) get zapped; note who starts inside
        const seen = new Map();
        for (const s of this.squads) seen.set(s.id, Math.hypot(s.x - x, s.y - y) <= sp.r);
        this.addZone({ k: 'fence', o: i, x, y, r: sp.r, until: t + dur, left: sp.cap, seen });
        return;
      }
      // ================================================================ Glacia
      case 'tempdown': {
        if (b.level <= 1) { this.err(i, 'Already level 1'); return false; }
        const was = b.level;
        b.level = 1;
        this.setFx(b, 'chill', t + dur, { lv: was, owner: b.owner });
        this.emit({ k: 'down', o: i, b: b.id, lv: 1 });
        return;
      }
      case 'coldwave': this.setFx(b, 'wave', t + NEXT_SEND, { dur: sp.dur }); return;
      case 'glaciate': for (const q of this.players) if (q.alive && q.idx !== i) q.glacierUntil = Math.max(q.glacierUntil, t + dur); return;
      case 'icerain': this.pending.push({ at: t + 0.6, k: 'hail', o: i, x, y, r: sp.r, pct: sp.pct }); return;
      // ================================================================ Madame Pebble
      case 'vortex': this.addZone({ k: 'vortex', o: i, x, y, r: sp.r, until: t + dur }); return;
      case 'purrfreeze': for (const q of this.players) if (q.alive) q.purrLock = Math.max(q.purrLock, t + dur); return;
      case 'chickens': for (const s of this.enemySquadsIn(i, x, y, sp.r)) { s.chick = sp.atk; s.atkMul = 1; s.totem = 0; s.fx.chicken = Infinity; s.fx.rage = 0; s.fx.arms = 0; } return;
      case 'magnet':
        for (const z of this.zones) if (z.k === 'magnet' && z.b === b.id) z.until = t;
        this.addZone({ k: 'magnet', o: i, b: b.id, x: b.x, y: b.y, r: sp.r, until: t + dur }); return;
      // ================================================================ Willow
      case 'quicksand': this.addZone({ k: 'qsand', o: i, b: b.id, x: b.x, y: b.y, r: this.radius(b) + 95, until: t + dur, slow: sp.slow }); return;
      case 'unity': this.setFx(b, 'unity', t + NEXT_SEND); return;
      case 'wind': this.setFx(b, 'wind', t + NEXT_SEND, { dur: sp.dur, spd: sp.spd }); return;
      case 'worm': {
        const n = b.count * sp.pct;
        if (n > 0) {
          b.count -= n; b.full = Math.min(b.full, b.count);
          if (b.ghosts) b.ghosts = Math.max(0, b.ghosts - n);
          if (b.owner >= 0) this.onLosses(b.owner, n, b.x, b.y, i, 'spell');
        }
        this.addZone({ k: 'worm', o: i, b: b.id, x: b.x, y: b.y, r: sp.r, until: t + WORM_TIME, eaten: n });
        return Math.round(n);
      }
      // ================================================================ Saffron
      case 'totem': this.addZone({ k: 'totem', o: i, x, y, r: sp.r, until: t + dur, atk: sp.atk }); return;
      case 'stones': {
        let left = sp.n;
        const hit = this.squadsIn(x, y, sp.r, q => q.owner === i && !q.stash && !q.ball).sort((a, c) => dist(a, x, y) - dist(c, x, y));
        for (const s of hit) {
          if (left < 1) break;
          let rock = s;
          if (s.count > left) {
            // only part of the squad curls up: split it
            s.count -= left;
            rock = { ...s, id: this.nextSquad++, count: left, fx: { ...s.fx }, hist: [] };
            this.squads.push(rock);
          }
          left -= rock.count;
          rock.ball = sp.mult; rock.rock = true; rock.fx.rock = Infinity;
        }
        return Math.round(sp.n - left);
      }
      case 'rain': this.addZone({ k: 'rain', o: i, x, y, r: sp.r, until: t + dur, slow: sp.slow }); return;
      case 'sandstorm': this.addZone({ k: 'sand', o: i, x, y, r: sp.r, until: t + dur, pct: sp.pct }); return;
      // ================================================================ Queen Marigold
      case 'kittenboom':
        if (!(BUILDINGS[b.type].prod[b.level - 1] > 0)) { this.err(i, 'Only buildings that make kittens'); return false; }
        this.setFx(b, 'kboom', t + dur, { boost: sp.boost }); return;
      case 'hush': for (const q of this.players) if (q.alive) q.silenced = Math.max(q.silenced, t + dur); return;
      case 'paperwalls': this.setFx(b, 'paper', t + dur, { drop: sp.drop }); return;
      case 'sweettalk': {
        let left = sp.n;
        const hit = this.enemySquadsIn(i, x, y, sp.r).sort((a, c) => dist(a, x, y) - dist(c, x, y));
        for (const s of hit) {
          if (left < 1) break;
          if (s.count <= left) { left -= s.count; s.owner = i; s.fx = { stun: t + 0.4 }; s.chick = 0; s.plague = null; s.slug = null; continue; }
          s.count -= left;
          this.squads.push({ ...s, id: this.nextSquad++, owner: i, count: left, fx: { stun: t + 0.4 }, chick: 0, plague: null, slug: null, hist: [] });
          left = 0;
        }
        return Math.round(sp.n - left);
      }
      // ================================================================ Honeydew
      case 'deepfreeze': this.setFx(b, 'frozen', t + dur); return;
      case 'flying': this.setFx(b, 'fly', t + NEXT_SEND, { n: sp.n, spd: sp.spd }); return;
      case 'frostring': for (const s of this.squadsIn(x, y, sp.r)) s.fx.frozen = t + dur; return;
      case 'tornado': this.addZone({ k: 'tornado', o: i, cx: x, cy: y, x, y, r: 46, orbit: 85, until: t + dur, ph: this.rng() * 6.28, t0: t }); return;
      // ================================================================ Wispera
      case 'haunt':
        b.count += sp.n; b.ghosts = (b.ghosts || 0) + sp.n;
        this.setFx(b, 'haunt', Math.max(b.fx.haunt || 0, t + dur));
        return;
      case 'possess': {
        const prev = b.owner;
        b.owner = i;
        this.setFx(b, 'possess', t + dur, { prev, by: i });
        b.fireCd = 1; b.prodAcc = 0;
        this.emit({ k: 'cap', b: b.id, o: i, prev, bonus: 0, spell: 1, down: 0 });
        return;
      }
      case 'spirited': p.redirect = { b: b.id, until: t + dur }; return;
      case 'ghostarmy': {
        const pt = this.besidePoint(i, b, 80);
        this.spawnSquad(i, sp.n, pt.x, pt.y, b, { fly: true, immune: true, fx: { ghost: Infinity } });
        p.stats.produced += sp.n;
        return;
      }
      // ================================================================ Morrow
      case 'soulsnatch':
        if (!(BUILDINGS[this.btype(b)].range)) { this.err(i, 'Pick one of your towers'); return false; }
        this.setFx(b, 'soul', t + dur, { range: sp.range }); return;
      case 'untouchable': this.setFx(b, 'invuln', t + 10, { from: t + 0.5 }); return;
      case 'slowmo': for (const s of this.squadsIn(x, y, sp.r)) { s.slowmo = Math.max(s.slowmo || 1, sp.slowx); s.fx.slow = Infinity; } return;
      case 'poison': this.setFx(b, 'plague', t + (sp.dur || 12), { rate: sp.rate, prod: sp.prod, chance: sp.chance, by: i }); return;
      // ================================================================ Ironclaw
      case 'seal': this.setFx(b, 'seal', t + SEAL_TIME, { per: b.count * sp.pct, by: i }); return;
      case 'mines': {
        let left = sp.n;
        const hit = this.enemySquadsIn(i, x, y, sp.r).sort((a, c) => dist(a, x, y) - dist(c, x, y));
        for (const s of hit) {
          if (left < 1) break;
          const k = Math.min(s.count, left);
          left -= k;
          this.addZone({ k: 'mine', o: i, x: s.x, y: s.y, r: 16 + Math.sqrt(k) * 3, until: t + 40, left: k });
          this.killSquadCats(s, k, i, 'spell');
        }
        return Math.round(sp.n - left);
      }
      case 'thief': {
        const v = this.players[b.owner];
        if (!v || v.purr <= 0) { this.err(i, 'They have no Purr Power to steal'); return false; }
        const n = purrLevel(v.purr);
        const width = n > 0 ? PURR.stars[n] - PURR.stars[n - 1] : PURR.stars[1];
        const amt = Math.min(v.purr, width);
        this.setPurr(v.idx, v.purr - amt);
        this.setPurr(i, p.purr + amt);
        return Math.round(amt);
      }
      case 'reap':
        for (const z of this.zones) if (z.k === 'reap' && z.b === b.id) z.until = t;
        this.addZone({ k: 'reap', o: i, b: b.id, x: b.x, y: b.y, r: sp.r, until: t + dur, pct: sp.pct }); return;
      // ================================================================ Baron Bones
      case 'crumble':
        if (b.level <= 1) { this.err(i, 'Already level 1'); return false; }
        b.level--; this.emit({ k: 'down', o: i, b: b.id, lv: b.level });
        return;
      case 'secondlife': {
        const recent = b.losses.filter(l => l.t > t - LOSS_MEMORY).reduce((a, l) => a + l.n, 0);
        const n = recent * sp.pct;
        if (n < 1) { this.err(i, 'No cats were lost there just now'); return false; }
        b.count += n; b.losses = [];
        return Math.round(n);
      }
      case 'gohome': { let n = 0; for (const s of this.squadsIn(x, y, sp.r)) if (this.turnHome(s)) n++; return n; }
      case 'panic': this.pending.push({ at: t + sp.delay, k: 'panic', o: i, b: b.id, owner: b.owner, pct: sp.pct }); this.setFx(b, 'shackle', t + sp.delay); return;
      // ================================================================ Cackle
      case 'skeletons': {
        if (b.type === 'cottage' && b.level >= 5) { this.err(i, 'Not on a level 5 cottage'); return false; }
        const pt = this.besidePoint(i, b, 55);
        this.spawnSquad(i, sp.n, pt.x, pt.y, b, { fly: true, wait: 0.4, fx: { bones: Infinity } });
        p.stats.produced += sp.n;
        return;
      }
      case 'steal': {
        let best = null;
        for (const q of this.players) if (q.idx !== i && q.lastCast && (!best || q.lastCast.t > best.t)) best = q.lastCast;
        if (!best) { this.err(i, 'Nobody has cast a skill to copy yet'); return false; }
        p.stolen = { id: best.id, lv: best.lv };
        const s0 = findSpell(best.id);
        return s0 ? s0.name : '';
      }
      case 'bloodpact': p.bloodUntil = Math.max(p.bloodUntil, t + dur); p.bloodPurr = sp.purr; return;
      case 'cauldron': {
        // lift the cauldron off the last building
        if (p.cauldron >= 0) { const o = this.byId.get(p.cauldron); if (o && this.fx(o, 'cauldron')) { o.fx.cauldron = 0; o.fxp.cauldron = null; this.emit({ k: 'lift', b: o.id }); } }
        const prev = b.owner;
        b.owner = -1; b.level = 1;
        b.fx = { cauldron: Infinity }; b.fxp = { cauldron: { by: i } };
        b.full = b.count; b.prodAcc = 0; b.defAcc = 0; b.losses = []; b.ghosts = 0;
        if (b.count > this.cap(b)) b.count = this.cap(b);
        p.cauldron = b.id;
        if (prev >= 0) this.players[prev].stats.lostBuildings++;
        // anyone already walking there turns back
        for (const s of this.squads) if (s.to === b.id) this.turnHome(s, 0.3);
        this.emit({ k: 'cap', b: b.id, o: -1, prev, bonus: 0, spell: 1, down: 0 });
        return;
      }
      // ================================================================ Jinx
      case 'defectors':
        if (!(BUILDINGS[b.type].prod[b.level - 1] > 0)) { this.err(i, 'Only buildings that make kittens'); return false; }
        this.setFx(b, 'defect', t + dur, { by: i }); return;
      case 'bounce': this.setFx(b, 'bounce', t + dur, { left: sp.n }); return;
      case 'swap': {
        const mine2 = this.buildings.filter(o => o.owner === i);
        if (!mine2.length) return false;
        const m = mine2[Math.floor(this.rng() * mine2.length)];
        const them = b.owner;
        for (const [o, to, prev] of [[b, i, them], [m, them, i]]) {
          o.owner = to; o.fx = {}; o.fxp = {}; o.full = o.count; o.prodAcc = 0; o.fireCd = 1; o.losses = []; o.ghosts = 0;
          this.emit({ k: 'cap', b: o.id, o: to, prev, bonus: 0, spell: 1, down: 0 });
        }
        return;
      }
      case 'echo': this.setFx(b, 'echo', t + dur, { bld: sp.bld, pct: sp.pct, by: i }); return;
    }
  }

  /** Rewind: a squad jumps back to where it was `back` seconds ago */
  rewind(s, back) {
    if (!s.hist || !s.hist.length) return false;
    const when = this.time - back;
    let e = s.hist[0];
    for (const h of s.hist) if (h.t <= when) e = h;
    s.x = e.x; s.y = e.y; s.path = e.path; s.wp = e.wp; s.to = e.to;
    s.hist = s.hist.filter(h => h.t <= e.t);
    return true;
  }

  resolvePending() {
    const t = this.time;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const e = this.pending[k];
      if (e.at > t) continue;
      this.pending.splice(k, 1);
      if (!this.players[e.o]) continue;
      if (e.k === 'fire') {
        let left = e.cap;
        const hit = this.enemySquadsIn(e.o, e.x, e.y, e.r).sort((a, c) => dist(a, e.x, e.y) - dist(c, e.x, e.y));
        for (const s of hit) { if (left < 0.5) break; left -= this.killSquadCats(s, Math.min(left, s.count), e.o, 'spell'); }
        this.emit({ k: 'boom', o: e.o, x: r1(e.x), y: r1(e.y), r: e.r, fx: 'fire', n: Math.round(e.cap - left) });
      } else if (e.k === 'sneak') {
        const targets = this.buildings.filter(b => b.owner >= 0 && b.owner !== e.o);
        if (!targets.length || !this.players[e.o].alive) continue;
        const each = Math.floor(e.n / targets.length);
        let extra = e.n - each * targets.length;
        for (const b of targets) {
          const n = each + (extra-- > 0 ? 1 : 0);
          if (n < 1) continue;
          this.emit({ k: 'sneakhit', o: e.o, b: b.id, n });
          this.arrive({ owner: e.o, count: n, fx: {}, from: -1, to: b.id }, b);
        }
      } else if (e.k === 'land') {
        const to = this.byId.get(e.to);
        if (!to || !this.players[e.o].alive) continue;
        this.emit({ k: 'warpin', o: e.o, b: to.id, n: e.n });
        this.arrive({ owner: e.o, count: e.n, fx: {}, from: e.from, to: to.id, plague: e.plague }, to);
      } else if (e.k === 'panic') {
        const b = this.byId.get(e.b);
        if (!b || b.owner !== e.owner || b.owner < 0) continue;
        const others = this.buildings.filter(o => o.owner === b.owner && o !== b);
        const n = Math.floor(b.count * e.pct);
        if (!others.length || n < 1) continue;
        b.count -= n; b.full = b.count;
        const each = n / others.length;
        for (const o of others) this.launch(b.owner, b, o, each);
        this.emit({ k: 'panic', o: e.o, b: b.id, n });
      } else if (e.k === 'drop') {
        // Zero-G: the floating cats fall back down
        let n = 0;
        for (const id of e.ids) {
          const s = this.squads.find(q => q.id === id);
          if (!s) continue;
          s.fx.lift = 0;
          n += this.killSquadCats(s, s.count * e.pct, e.o, 'spell');
          this.emit({ k: 'thud', x: r1(s.x), y: r1(s.y) });
        }
        if (n >= 1) this.emit({ k: 'dropped', o: e.o, n: Math.round(n) });
      } else if (e.k === 'hail') {
        let n = 0;
        for (const s of this.squadsIn(e.x, e.y, e.r, q => q.owner !== e.o)) n += this.killSquadCats(s, s.count, e.o, 'spell');
        for (const b of this.buildings) {
          if (b.owner === e.o || b.owner < 0 || dist(b, e.x, e.y) > e.r + this.radius(b) * 0.6) continue;
          n += this.damageBuilding(b, b.count * e.pct, e.o, 'spell');
        }
        this.emit({ k: 'boom', o: e.o, x: r1(e.x), y: r1(e.y), r: e.r, fx: 'hail', n: Math.round(n) });
      }
    }
  }

  // ---------- lasting areas ----------
  updateZones(dt) {
    const t = this.time;
    for (let k = this.zones.length - 1; k >= 0; k--) {
      const z = this.zones[k];
      if (z.until <= t) {
        if (z.k === 'sand') this.sandstormEnds(z);
        else if (z.k === 'worm') this.wormEnds(z);
        this.zones.splice(k, 1);
        continue;
      }
      switch (z.k) {
        case 'uturn':
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o && s.uz !== z.id)) { s.uz = z.id; if (this.turnHome(s)) this.emit({ k: 'turned', x: r1(s.x), y: r1(s.y), o: s.owner }); }
          break;
        case 'fog':
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner === z.o)) s.fx.stealth = Math.max(s.fx.stealth || 0, t + 0.25);
          break;
        case 'tornado': {
          const a = z.ph + (t - z.t0) * 1.6;
          z.x = z.cx + Math.cos(a) * z.orbit; z.y = z.cy + Math.sin(a * 1.3) * z.orbit * 0.6;
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o)) this.killSquadCats(s, Math.min(s.count, 10 * dt), z.o, 'spell');
          for (const b of this.buildings) if (b.owner >= 0 && b.owner !== z.o && dist(b, z.x, z.y) <= z.r + this.radius(b) * 0.6) this.damageBuilding(b, 3 * dt, z.o, 'spell');
          break;
        }
        case 'fence': {
          // Zap Dome: enemy cats crossing the edge, either way, are knocked out
          if (z.left < 0.5) { z.until = t; break; }
          for (const s of this.squads) {
            if (s.wait > 0) continue;
            const inside = Math.hypot(s.x - z.x, s.y - z.y) <= z.r;
            const was = z.seen.get(s.id);
            z.seen.set(s.id, inside);
            if (was == null || was === inside || s.owner === z.o || this.shielded(s)) continue;
            const n = this.killSquadCats(s, Math.min(s.count, z.left), z.o, 'spell');
            z.left -= n;
            if (n > 0) this.emit({ k: 'zapped', x: r1(s.x), y: r1(s.y), n: Math.round(n) });
            if (z.left < 0.5) break;
          }
          break;
        }
        case 'magnet': {
          // works on anyone's building: its owner's cats move in, everyone else's attack it
          const b = this.byId.get(z.b);
          if (!b || this.fx(b, 'cauldron')) { z.until = t; break; }
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.to !== b.id && s.mz !== z.id && !s.stash)) {
            s.mz = z.id; s.to = b.id; s.path = s.fly ? [{ x: b.x, y: b.y }] : this.computePath(s.x, s.y, b); s.wp = 0;
          }
          break;
        }
        case 'moths': {
          const b = this.byId.get(z.b);
          if (!b || b.owner !== z.o || b.count < 0.05 || z.left < 0.5) { z.until = t; break; }
          const eat = Math.min(b.count, MOTH_EAT * dt);
          b.count -= eat; this.players[z.o].stats.lost += eat;
          if (b.ghosts) b.ghosts = Math.min(b.ghosts, b.count);
          z.r = Math.min(z.rmax, z.r + 30 * dt);
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o)) {
            const n = this.killSquadCats(s, Math.min(s.count, z.left, MOTH_KILL * dt), z.o, 'spell');
            z.left -= n;
            if (z.left < 0.5) break;
          }
          break;
        }
        case 'ufo': {
          z.cd -= dt;
          if (z.cd > 0 || z.left < 0.5) break;
          let best = null, bd = z.r + 6;
          for (const s of this.squads) {
            if (s.owner === z.o || s.wait > 0 || this.shielded(s) || (s.fx.stealth || 0) > t) continue;
            const d = Math.hypot(s.x - z.x, s.y - z.y);
            if (d < bd) { bd = d; best = s; }
          }
          if (!best) { z.cd = 0.15; break; }
          z.cd = 0.28;
          this.emit({ k: 'ufozap', o: z.o, x: r1(z.x), y: r1(z.y), tx: r1(best.x), ty: r1(best.y) });
          z.left -= this.killSquadCats(best, 1, z.o, 'spell');
          break;
        }
        case 'totem':
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner === z.o)) { s.totem = Math.max(s.totem || 1, z.atk); s.fx.rage = Infinity; }
          break;
        case 'barrier': {
          if (z.left < 0.5) { z.until = t; break; }
          for (const s of this.squads) {
            if (s.owner === z.o || s.wait > 0 || s.air || this.shielded(s)) continue;
            const px = s.x - z.x0, py = s.y - z.y0, along = px * z.ux + py * z.uy;
            if (along < -8 || along > z.len + 8 || Math.abs(px * z.uy - py * z.ux) > 13) continue;
            const n = this.killSquadCats(s, Math.min(s.count, z.left), z.o, 'spell');
            z.left -= n;
            if (n > 0) this.emit({ k: 'zapped', x: r1(s.x), y: r1(s.y), n: Math.round(n) });
            if (z.left < 0.5) break;
          }
          break;
        }
        case 'qsand': {
          const b = this.byId.get(z.b);
          if (!b) z.until = t;
          break;
        }
        case 'wave': {
          // Frost Wave rolls along the road and freezes every cat it rolls over (not the ones riding behind it)
          const go = Math.min(z.len, (t - z.born) * z.speed);
          z.x = z.x0 + z.ux * go; z.y = z.y0 + z.uy * go;
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.wz !== z.id && !(s.owner === z.o && s.born >= z.born - 0.01))) {
            s.wz = z.id; s.fx.frozen = Math.max(s.fx.frozen || 0, t + z.freeze);
          }
          if (go >= z.len) z.until = Math.min(z.until, t + 0.2);
          break;
        }
        case 'worm': {
          const b = this.byId.get(z.b);
          if (!b) { z.until = t; break; }
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o && s.worm !== z.id && !s.stash)) {
            s.worm = z.id; s.to = b.id; s.path = s.fly ? [{ x: b.x, y: b.y }] : this.computePath(s.x, s.y, b); s.wp = 0;
          }
          break;
        }
        case 'mine': {
          if (z.left < 0.5) { z.until = t; break; }
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o && !s.air)) {
            const n = this.killSquadCats(s, Math.min(s.count, z.left), z.o, 'spell');
            z.left -= n;
            if (n > 0) this.emit({ k: 'boom', o: z.o, x: r1(z.x), y: r1(z.y), r: z.r, fx: 'mine', n: Math.round(n) });
            if (z.left < 0.5) { z.until = t; break; }
          }
          break;
        }
        case 'reap': {
          const b = this.byId.get(z.b);
          if (!b || b.owner !== z.o) z.until = t;
          break;
        }
      }
    }
  }
  /** Sandstorm over: the trapped cats have lost their way. Some turn into wild sand cats, the rest wander home. */
  sandstormEnds(z) {
    for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o)) {
      const k = s.count * z.pct;
      let tg = null, bd = Infinity;
      for (const b of this.buildings) { if (b.owner < 0 || this.fx(b, 'cauldron')) continue; const d = this.nav.distFrom(s.x, s.y, b.id); if (d < bd) { bd = d; tg = b; } }
      if (k >= 0.5 && tg) {
        s.count -= k;
        this.onLosses(s.owner, k, s.x, s.y, z.o, 'spell');
        this.spawnSquad(-1, k, s.x, s.y, tg, { fx: { stun: this.time + 0.3 } });
      }
      if (s.count < 0.5) this.removeSquad(s, 'pop');
      else this.turnHome(s, 0.3);
    }
    this.emit({ k: 'sandend', x: r1(z.x), y: r1(z.y), r: z.r });
  }
  /** Sand Worm over: everything it ate comes back as the caster's sand cats and attacks the building */
  wormEnds(z) {
    const b = this.byId.get(z.b);
    if (!b || !this.players[z.o] || !this.players[z.o].alive || z.eaten < 0.5) return;
    this.emit({ k: 'wormout', o: z.o, b: b.id, n: Math.round(z.eaten) });
    this.arrive({ owner: z.o, count: z.eaten, fx: {}, from: -1, to: b.id }, b);
  }

  // ---------- combat ----------
  arrive(s, b) {
    const i = s.owner;
    // Big Cauldron: nobody gets in
    if (this.fx(b, 'cauldron')) {
      if (s.id != null && this.turnHome(s, 0.3)) { this.squads.push(s); return; }
      if (i >= 0) this.onLosses(i, s.count, b.x, b.y, -1, 'spell');
      return;
    }
    // Sand Worm: cats pulled in get eaten
    if (s.worm != null) {
      const z = this.zones.find(q => q.id === s.worm && q.k === 'worm' && q.until > this.time);
      if (z) { z.eaten += s.count; this.onLosses(i, s.count, b.x, b.y, z.o, 'spell'); this.emit({ k: 'eaten', b: b.id, n: Math.round(s.count) }); return; }
    }
    if (b.owner === i) {
      b.count += s.count;
      // Food Poisoning travels with the cats
      if (s.plague && s.plague.until > this.time && !this.fx(b, 'plague') && this.rng() < s.plague.chance) {
        this.setFx(b, 'plague', s.plague.until, { rate: s.plague.rate, prod: s.plague.prod, chance: s.plague.chance, by: s.plague.by });
        this.emit({ k: 'infect', b: b.id, o: s.plague.by });
      }
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 1 });
      return;
    }
    const rival = b.owner >= 0;
    // Charm Shield: enemy cats turn around at the door and hurry home
    const bo = rival ? this.fxp(b, 'bounce') : null;
    if (bo && bo.left > 0 && s.id != null) {
      bo.left -= s.count;
      if (this.turnHome(s, 0.5)) { s.spdMul = (s.spdMul || 1) * 1.5; this.squads.push(s); this.emit({ k: 'bounced', b: b.id, o: b.owner, n: Math.round(s.count) }); return; }
    }
    // Spirited Away: the hit lands on the building its owner picked instead (it can't be captured that way)
    const rd = rival ? this.redirectOf(b) : null;
    if (rd) {
      const dmg = s.count * this.attack(i, s) * (s.ball || 1) / this.defense(rd);
      const n = this.damageBuilding(rd, dmg, b.owner, 'spell');
      this.onLosses(i, s.count, b.x, b.y, b.owner, 'attack');
      this.emit({ k: 'redirect', o: b.owner, from: b.id, b: rd.id, n: Math.round(n) });
      return;
    }
    b.lastHit = this.time;
    // Untouchable: attackers can't hurt it
    if (rival && this.fx(b, 'invuln')) {
      this.onLosses(i, s.count, b.x, b.y, b.owner, 'attack');
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0, blocked: 1 });
      return;
    }
    const atk = this.attack(i, s) * (s.ball || 1);
    const def = this.defense(b);
    const dmg = s.count * atk / def;
    // Bouncy Heads / Rolling Boulders hit hard but can't capture
    const noCap = !!s.ball;
    if (dmg <= b.count + 1e-6 || noCap) {
      const killed = Math.min(b.count, dmg);
      b.count = Math.max(0, b.count - dmg);
      if (b.ghosts) b.ghosts = Math.max(0, b.ghosts - killed);
      this.onLosses(i, s.count, b.x, b.y, rival ? b.owner : -1, 'attack');
      if (rival) {
        this.onLosses(b.owner, killed, b.x, b.y, i, 'garrison');
        b.losses.push({ t: this.time, n: killed });
      }
      this.echo(b, killed);
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
      return;
    }
    const used = b.count * def / atk;
    const survivors = s.count - used;
    const defenders = b.count;
    this.onLosses(i, used, b.x, b.y, rival ? b.owner : -1, 'attack');
    if (rival) this.onLosses(b.owner, defenders, b.x, b.y, i, 'garrison');
    this.echo(b, defenders);
    this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
    // Circle of Life: instead of falling, the building drops a level and 20 fresh cats pop up to keep fighting
    if (rival && b.level >= 2 && this.fx(b, 'cycle')) {
      b.level--; b.count = CYCLE_CATS; b.full = CYCLE_CATS; b.ghosts = 0;
      this.players[b.owner].stats.produced += CYCLE_CATS;
      this.emit({ k: 'cycle', b: b.id, o: b.owner, lv: b.level });
      if (survivors > 0.05) this.arrive({ ...s, id: null, count: survivors }, b);
      return;
    }
    this.capture(b, i, Math.max(0, survivors), false);
  }
  /** the building that takes the hit instead of `b` (Spirited Away), or null */
  redirectOf(b) {
    const rd = this.players[b.owner] && this.players[b.owner].redirect;
    if (!rd || rd.until <= this.time || rd.b === b.id) return null;
    const r = this.byId.get(rd.b);
    return r && r.owner >= 0 && !this.fx(r, 'cauldron') ? r : null;
  }
  capture(b, i, garrison, bySpell) {
    const prev = b.owner;
    const lv = b.level, type = b.type;
    b.owner = i;
    b.count = garrison;
    // a building taken from another player loses one upgrade level (strays keep theirs)
    const down = prev >= 0 && prev !== i && b.level > 1;
    if (down) b.level--;
    b.fx = {}; b.fxp = {};
    b.prodAcc = 0; b.defAcc = 0;
    b.fireCd = 1;
    b.losses = [];
    b.ghosts = 0;
    b.full = b.count;
    // wild sand cats took it: it's a stray now
    if (i < 0) {
      if (prev >= 0) { this.players[prev].stats.lostBuildings++; this.addPurr(prev, ((PURR.lose[type] || [])[lv - 1]) ?? -100); }
      this.emit({ k: 'cap', b: b.id, o: -1, prev, bonus: 0, spell: 0, down: down ? b.level : 0 });
      return;
    }
    const p = this.players[i];
    p.stats.captured++;
    const pick = (tbl, d) => ((tbl[type] || [])[lv - 1] ?? (tbl[type] || [d]).slice(-1)[0] ?? d);
    if (prev >= 0) {
      this.players[prev].stats.lostBuildings++;
      this.addPurr(prev, pick(PURR.lose, -100));
      this.addPurr(i, pick(PURR.capEnemy, 100));
    } else this.addPurr(i, pick(PURR.capStray, 40));
    b.full = b.count;
    this.emit({ k: 'cap', b: b.id, o: i, prev, bonus: 0, spell: bySpell ? 1 : 0, down: down ? b.level : 0 });
  }
  fieldCombat() {
    const S = this.squads, t = this.time;
    // cats that can't meet anyone on the road: waiting, hidden, flying on cannonballs, floating or stashed away
    const out = q => q.wait > 0 || (q.fx.stealth || 0) > t || q.count <= 0 || q.air || (q.fx.lift || 0) > t || q.stash;
    for (let a = 0; a < S.length; a++) {
      const A = S[a];
      if (out(A)) continue;
      for (let c = a + 1; c < S.length; c++) {
        const B = S[c];
        if (B.owner === A.owner || out(B)) continue;
        const rr = 7 + Math.sqrt(A.count) * 1.5 + 7 + Math.sqrt(B.count) * 1.5;
        const dx = A.x - B.x, dy = A.y - B.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        const mx = r1((A.x + B.x) / 2), my = r1((A.y + B.y) / 2);
        // Static Fluff: a shielded squad zaps whatever touches it and loses nobody
        const auA = (A.fx.aura || 0) > t, auB = (B.fx.aura || 0) > t;
        if (auA !== auB) {
          const [W, L] = auA ? [A, B] : [B, A];
          const n = Math.min(L.count, AURA_KILL * TICK);
          L.count -= n;
          this.onLosses(L.owner, n, L.x, L.y, W.owner, 'spell');
          this.slugSplit(L, n);
          if (this.tickNo % 4 === 0) this.emit({ k: 'zapped', x: r1(L.x), y: r1(L.y), n: Math.round(n) });
          if (A.count <= 0) break;
          continue;
        }
        const aa = this.attack(A.owner, A), ab = this.attack(B.owner, B);
        const sa = A.count * aa, sb = B.count * ab;
        if (sa > sb) {
          const lostA = sb / aa, lostB = B.count;
          this.onLosses(B.owner, B.count, B.x, B.y, A.owner, 'field');
          this.onLosses(A.owner, lostA, A.x, A.y, B.owner, 'field');
          A.count -= lostA;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(B.count + lostA), w: A.owner });
          B.count = 0;
          this.slugSplit(A, lostA); this.slugSplit(B, lostB);
        } else {
          const lostB = sa / ab, lostA = A.count;
          this.onLosses(A.owner, A.count, A.x, A.y, B.owner, 'field');
          this.onLosses(B.owner, lostB, B.x, B.y, A.owner, 'field');
          B.count -= lostB;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(A.count + lostB), w: B.owner });
          A.count = 0;
          this.slugSplit(A, lostA); this.slugSplit(B, lostB);
        }
        if (A.count <= 0) break;
      }
    }
    for (let k = S.length - 1; k >= 0; k--) if (S[k].count < 0.5) S.splice(k, 1);
  }

  /** effects on a building that do something when they run out */
  buildingTimers(b) {
    if (b.ghosts > b.count) b.ghosts = b.count;
    // Haunted House: the ghosts leave
    if (b.ghosts > 0 && !this.fx(b, 'haunt')) {
      const n = Math.min(b.ghosts, b.count);
      b.count -= n; b.ghosts = 0;
      if (n >= 0.5) this.emit({ k: 'vanish', b: b.id, n: Math.round(n) });
    }
    // Possession: the building goes back to its owner with whatever cats are left
    const pp = b.fxp.possess;
    if (pp && !this.fx(b, 'possess')) {
      b.fxp.possess = null;
      if (b.owner === pp.by) {
        const back = this.players[pp.prev] && this.players[pp.prev].alive ? pp.prev : -1;
        b.owner = back; b.fireCd = 1; b.prodAcc = 0; b.full = b.count;
        this.emit({ k: 'cap', b: b.id, o: back, prev: pp.by, bonus: 0, spell: 1, down: 0 });
      }
    }
    // Cold Snap: the levels come back
    const ch = b.fxp.chill;
    if (ch && !this.fx(b, 'chill')) {
      b.fxp.chill = null;
      if (b.owner === ch.owner && ch.lv > b.level) { b.level = Math.min(ch.lv, BUILDINGS[b.type].maxLevel); this.emit({ k: 'up', o: b.owner, b: b.id, lv: b.level }); }
    }
    // Hypnotize: the spell fades if no order was given
    if (b.fxp.hypno && !this.fx(b, 'hypno')) {
      const p = this.players[b.fxp.hypno.by];
      if (p && p.hypno === b.id) p.hypno = -1;
      b.fxp.hypno = null;
    }
  }
  /** Kitten Express: where a cottage's kittens go right now (null: into the cottage itself) */
  transferTarget(b) {
    const p = this.players[b.owner];
    if (!p || p.transferTo < 0 || p.transferTo === b.id || b.type !== 'cottage') return null;
    const tg = this.byId.get(p.transferTo);
    return tg && tg.owner === b.owner && this.fx(tg, 'transfer') ? tg : null;
  }
  /** Defectors: new kittens walk over to the other side. Returns true when they did. */
  defect(b, add) {
    const dx = this.fxp(b, 'defect');
    if (!dx || dx.by === b.owner || !this.players[dx.by] || !this.players[dx.by].alive) return false;
    b.defAcc += add;
    if (b.defAcc >= 1) {
      const home = this.nearestOwnedByPath(dx.by, b);
      const n = Math.floor(b.defAcc);
      b.defAcc -= n;
      if (home) this.launch(dx.by, b, home, n);
    }
    return true;
  }
  /** Stash: hidden cats wait for a friendly squad to walk past, then join it. Returns true while they keep waiting. */
  stashWait(s, k) {
    if (this.time >= s.stash) { s.stash = 0; s.fx.stealth = 0; s.fx.stash = 0; return false; }
    for (const q of this.squads) {
      if (q === s || q.owner !== s.owner || q.stash || q.wait > 0 || Math.hypot(q.x - s.x, q.y - s.y) > 45) continue;
      q.count += s.count;
      this.squads.splice(k, 1);
      this.emit({ k: 'join', x: r1(s.x), y: r1(s.y), o: s.owner, n: Math.round(s.count) });
      return true;
    }
    return true;
  }

  // ---------- main step ----------
  step(dt = TICK) {
    if (this.over) return;
    this.time += dt;
    this.tickNo++;
    const t = this.time;

    // players
    for (const p of this.players) {
      if (!p.alive) continue;
      p.catnip = Math.min(MAX_CATNIP, p.catnip + this.catnipRegen(p.idx) * dt);
      for (let k = 0; k < p.cds.length; k++) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
      if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
      // sitting still drains Purr Power, and the higher it is the sooner and faster it goes
      const lv = purrLevel(p.purr);
      if (p.purr > 0 && t - p.lastAction > PURR.idleAfter[lv]) this.addPurr(p.idx, -PURR.idleDrain[lv] * dt);
    }

    this.updateZones(dt);

    // buildings: skill effects, production, decay, towers
    for (const b of this.buildings) {
      this.buildingTimers(b);
      const def = BUILDINGS[b.type];
      if (b.owner >= 0) {
        const owner = this.players[b.owner];
        const cap = this.cap(b);
        // Drop Pods
        const pods = this.fxp(b, 'pods');
        if (pods && pods.left > 0) { const add = Math.min(pods.left, pods.rate * dt); pods.left -= add; b.count += add; owner.stats.produced += add; }
        // Untouchable eats its own garrison (after a half-second grace)
        const inv = this.fxp(b, 'invuln');
        if (inv && t >= (inv.from || 0)) {
          const n = Math.min(b.count, 6 * dt);
          b.count -= n; owner.stats.lost += n;
          if (b.ghosts) b.ghosts = Math.min(b.ghosts, b.count);
          if (b.count <= 0.01) b.fx.invuln = 0;
        }
        // Food Poisoning
        const plague = this.fxp(b, 'plague');
        if (plague) this.damageBuilding(b, plague.rate * dt, plague.by, 'spell', true);
        // Iron Seal
        const seal = this.fxp(b, 'seal');
        if (seal) this.damageBuilding(b, seal.per * dt, seal.by, 'spell');
        // kittens
        let rate = this.fx(b, 'popup') || this.fx(b, 'fort') || seal ? 0 : def.prod[b.level - 1] || 0;
        if (rate > 0 && this.zones.some(z => z.k === 'moths' && z.b === b.id)) rate = 0;   // Moth Dome
        const stopped = this.fx(b, 'frozen');
        rate *= 1 + owner.bonusProd;
        if (this.rules.boom) rate *= 1.5;
        const kb = this.fxp(b, 'kboom'); if (kb) rate *= kb.boost;
        if (plague) rate *= plague.prod;
        for (const z of this.zones) if (z.k === 'spy' && z.o !== b.owner && dist(b, z.x, z.y) <= z.r) rate *= z.prod;
        // Kitten Express: this cottage's kittens appear in the chosen building instead
        const tr = rate > 0 && !stopped ? this.transferTarget(b) : null;
        if (tr) {
          tr.count += rate * dt;
          owner.stats.produced += rate * dt;
        } else if (!stopped && rate > 0 && b.count < cap) {
          const add = Math.min(rate * dt, cap - b.count);
          if (!this.defect(b, add)) {
            b.count += add;
            owner.stats.produced += add;
          }
        } else if (b.count > cap && def.prod[b.level - 1] > 0) {
          // over-full cottages and Cat Trees slowly lose the extra; towers, forges and gardens just hold what they have
          b.count = Math.max(cap, b.count - OVERCAP_DECAY * dt);
        }
      }
      // an unowned building that fought off an attack grows back to the cats it started with (bigger ones faster)
      if (b.owner < 0) {
        if (b.count > b.full) b.full = b.count;
        if (b.count < b.full && t - b.lastHit > STRAY_REGROW.delay) {
          const add = Math.min(b.full - b.count, strayRegrowRate(b.full) * dt);
          // (Defectors on a stray: what grows back walks over instead)
          if (!this.defect(b, add)) b.count += add;
        }
      } else if (b.type === 'tower') {
        // your tower grows back what it lost at the normal kitten rate
        if (b.count > b.full) b.full = b.count;
        const target = Math.min(b.full, this.cap(b));
        if (b.count < target && t - b.lastHit > TOWER_REGROW.delay && !this.fx(b, 'frozen') && !this.fx(b, 'plague')) {
          const add = Math.min(TOWER_REGROW.rate * dt, target - b.count);
          b.count += add;
          this.players[b.owner].stats.produced += add;
        }
      }
      // towers (an unowned tower shoots at everyone's cats until somebody takes it; one under a cauldron can't)
      const bt = this.btype(b), tdef = BUILDINGS[bt];
      const stray = b.owner < 0;
      if (tdef.range && (!stray || bt === 'tower') && b.count >= 1 && !this.fx(b, 'frozen') && !this.fx(b, 'cauldron')) {
        b.fireCd -= dt;
        if (b.fireCd <= 0) {
          const lv = this.shootLevel(b);
          let range = tdef.range[Math.min(lv, tdef.range.length) - 1];
          const every = tdef.fireEvery[Math.min(lv, tdef.fireEvery.length) - 1];
          const soul = this.fxp(b, 'soul'); if (soul) range *= soul.range;
          let best = null, bd = range;
          for (const s of this.squads) {
            // (cannonballs and ghosts can't be shot; floating or stashed cats are out of reach)
            if (s.wait > 0 || (s.fx.stealth || 0) > t || s.owner === b.owner || s.noTower || (s.fx.lift || 0) > t || s.stash) continue;
            const d = Math.hypot(s.x - b.x, s.y - b.y);
            if (d >= bd) continue;
            // towers can't shoot into a rival's Fog Cloud
            if (this.inZone('fog', s.x, s.y, z => z.o !== b.owner)) continue;
            bd = d; best = s;
          }
          if (best) {
            b.fireCd = every;
            const ft = 0.12 + bd / 650;
            const boom = this.fxp(b, 'boom');
            this.projectiles.push({ at: t + ft, s: best.id, o: b.owner, b: b.id, splash: boom ? boom.splash : 0, soul: !!soul });
            this.emit({ k: 'shot', b: b.id, s: best.id, x: r1(best.x), y: r1(best.y), ft: r1(ft), h: boom ? 1 : 0 });
          } else b.fireCd = 0.2;
        }
      }
    }

    // projectiles land
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const pr = this.projectiles[k];
      if (pr.at > t) continue;
      this.projectiles.splice(k, 1);
      const s = this.squads.find(q => q.id === pr.s);
      if (!s) continue;
      const sx = s.x, sy = s.y;
      // Static Fluff: a tower hit pops the shield instead
      if ((s.fx.aura || 0) > t) { s.fx.aura = 0; this.emit({ k: 'pop', x: r1(sx), y: r1(sy), o: s.owner }); continue; }
      let n = this.killSquadCats(s, 1, pr.o, 'tower');
      if (pr.splash) {
        for (const q of this.squadsIn(sx, sy, pr.splash, q => q !== s && q.owner !== pr.o)) n += this.killSquadCats(q, 1, pr.o, 'tower');
        this.emit({ k: 'splash', x: r1(sx), y: r1(sy), r: pr.splash });
      }
      // Soul Snatcher: what the tower knocks out joins it
      if (pr.soul && n > 0) { const b = this.byId.get(pr.b); if (b && b.owner === pr.o && pr.o >= 0) { b.count += n; this.emit({ k: 'souls', o: pr.o, x: r1(sx), y: r1(sy), b: b.id, n }); } }
    }

    this.resolvePending();

    // squads move (and remember where they were, for Rewind)
    const sample = this.tickNo % Math.max(1, Math.round(HIST_EVERY / dt)) === 0;
    for (let k = this.squads.length - 1; k >= 0; k--) {
      const s = this.squads[k];
      if (s.wait > 0) { s.wait -= dt; continue; }
      const to = this.byId.get(s.to);
      if (!to) { this.squads.splice(k, 1); continue; }
      if (s.stash && this.stashWait(s, k)) continue;
      // Slug Army: a sticky trail behind every slug squad
      if (s.slug && (s.slimeT = (s.slimeT || 0) - dt) <= 0 && this.squadSpeed(s) > 0) {
        s.slimeT = SLIME_EVERY;
        this.addZone({ k: 'slime', o: s.owner, x: s.x, y: s.y, r: SLIME_R, until: t + SLIME_LIFE, slow: s.slug.slow });
      }
      if (sample) {
        s.hist.push({ t, x: s.x, y: s.y, wp: s.wp, path: s.path, to: s.to });
        while (s.hist.length && s.hist[0].t < t - HIST_KEEP) s.hist.shift();
      }
      let rem = this.squadSpeed(s) * dt;
      while (rem > 0 && s.wp < s.path.length) {
        const pt = s.path[s.wp];
        const last = s.wp === s.path.length - 1;
        const dx = pt.x - s.x, dy = pt.y - s.y;
        const d = Math.hypot(dx, dy);
        const stopAt = last ? this.radius(to) * 0.5 : 0;
        if (d - stopAt <= rem) {
          if (last) { this.squads.splice(k, 1); this.arrive(s, to); rem = 0; break; }
          s.x = pt.x; s.y = pt.y; rem -= d; s.wp++;
        } else {
          s.x += dx / d * rem; s.y += dy / d * rem; rem = 0;
          if (Math.abs(dx) > 0.5) s.face = dx < 0 ? 1 : 0;
        }
      }
    }

    this.fieldCombat();

    // bookkeeping twice a second
    if (this.tickNo % 10 === 0) this.checkEnd();
  }

  eliminate(i, why) {
    const p = this.players[i];
    if (!p.alive) return;
    p.alive = false;
    this.emit({ k: 'out', o: i, why });
    const alive = this.players.filter(q => q.alive);
    if (alive.length <= 1) { this.finish(alive.length ? alive[0].idx : -1, why); return; }
    // 3-4 players and the battle goes on: a player who leaves or surrenders leaves stray buildings behind
    for (const b of this.buildings) if (b.owner === i) { b.owner = -1; b.fx = {}; b.fxp = {}; b.full = b.count; this.emit({ k: 'cap', b: b.id, o: -1, prev: i, bonus: 0, spell: 0, down: 0 }); }
    for (let k = this.squads.length - 1; k >= 0; k--) if (this.squads[k].owner === i) this.removeSquad(this.squads[k], 'pop');
    for (let k = this.zones.length - 1; k >= 0; k--) if (this.zones[k].o === i) this.zones.splice(k, 1);
  }
  checkEnd() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const army = this.armyOf(p.idx);
      p.stats.peakArmy = Math.max(p.stats.peakArmy, army);
      // (a building someone possessed for a moment still counts as yours)
      const hasB = this.buildings.some(b => b.owner === p.idx || (b.fxp.possess && b.fxp.possess.prev === p.idx && this.fx(b, 'possess')));
      const hasS = this.squads.some(s => s.owner === p.idx);
      const hasP = this.pending.some(e => e.o === p.idx && (e.k === 'land' || e.k === 'sneak'));
      if (!hasB && !hasS && !hasP) this.eliminate(p.idx, 'wiped');
    }
    if (!this.over && this.time >= this.timeLimit) {
      const alive = this.players.filter(q => q.alive);
      const score = q => this.armyOf(q.idx) + this.buildings.filter(b => b.owner === q.idx).length * 5;
      alive.sort((a, b) => score(b) - score(a));
      if (alive.length > 1 && Math.round(score(alive[0])) === Math.round(score(alive[1]))) this.finish(-1, 'time');
      else this.finish(alive[0].idx, 'time');
    }
  }
  finish(winner, why) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.endReason = why;
    this.emit({ k: 'end', w: winner, why });
  }

  // ---------- network views ----------
  staticInfo() {
    return {
      map: { id: this.cfg.map.id, name: this.cfg.map.name, theme: this.cfg.map.theme, seed: this.cfg.seed, obstacles: this.cfg.map.obstacles || [], players: this.players.length, rot3: this.cfg.map.rot3 || null },
      buildings: this.buildings.map(b => ({ id: b.id, x: b.x, y: b.y, r: this.nav.radiusOf(b.id), o: this.cfg.map.buildings.find(m => m.id === b.id)?.owner ?? -1 })),
      // slots: the skill in each slot this battle (Riddle's are random), lvs: their levels
      players: this.players.map(p => ({ name: p.name, hero: p.heroId, fur: p.fur, hat: p.hat, ai: p.ai, skills: p.skills, slots: p.slots.map(q => q.sp.id), lvs: p.slots.map(q => q.lv) })),
      timeLimit: this.timeLimit,
      rules: this.rules,
    };
  }
  snapshot() {
    const t = this.time;
    // building effects as two bit masks (BFX has more names than fit in one)
    const bfx = (b, word) => {
      let m = 0;
      const from = word * BFX_WORD, to = Math.min(BFX.length, from + BFX_WORD);
      for (let k = from; k < to; k++) if ((b.fx[BFX[k]] || 0) > t) m |= 1 << (k - from);
      return m;
    };
    const sfx = s => {
      let m = 0;
      for (const n of SFX) if ((s.fx[n] || 0) > t) m |= SFX_BIT[n];
      if (s.face) m |= SFX_BIT.left;
      if (s.wait > 0) m |= SFX_BIT.wait;
      return m;
    };
    const snap = {
      t: r1(t * 10) / 10,
      // [id, owner, type, level, cats, effects, cap, pop-up tower level, stray full, more effects]
      b: this.buildings.map(b => [b.id, b.owner, BTYPES.indexOf(b.type), b.level, r1(b.count), bfx(b, 0), this.cap(b), this.fx(b, 'popup') || this.fx(b, 'fort') ? this.shootLevel(b) : 0, b.owner < 0 ? r1(b.full) : 0, bfx(b, 1)]),
      s: this.squads.map(s => [s.id, s.owner, Math.round(s.count * 10) / 10, Math.round(s.x), Math.round(s.y), sfx(s), s.to]),
      p: this.players.map(p => [
        r1(p.catnip), Math.round(p.purr), r1(p.cds[0]), r1(p.cds[1]), r1(p.cds[2]),
        (p.scoutUntil > t ? PF.scouting : 0) | (p.silenced > t ? PF.silenced : 0) | (p.purrLock > t ? PF.purrLock : 0)
          | (p.goldUntil > t ? PF.golden : 0) | (p.glacierUntil > t ? PF.glacier : 0) | (p.bloodUntil > t ? PF.blood : 0),
        p.alive ? 1 : 0, Math.round(this.armyOf(p.idx)), this.stars(p.idx), r1(p.gcd), r1(p.scoutCd), r1(p.cds[3]),
        // Copy Cat: the copied skill and its level; Hypnotize: the building waiting for your order
        p.stolen ? p.stolen.id : '', p.stolen ? p.stolen.lv : 0, p.hypno,
      ]),
      // [kind, x, y, r, owner, seconds left, direction (degrees), lane half-width]
      z: this.zones.map(z => [ZONES.indexOf(z.k), Math.round(z.x), Math.round(z.y), Math.round(z.r), z.o, r1(Math.min(99, z.until - t)),
        z.ux != null ? Math.round(Math.atan2(z.uy, z.ux) * 180 / Math.PI) : 0, z.w || 0]),
      // which rival buildings each player can see into right now (Spy Eye, Food Poisoning)
      rv: this.players.map(p => this.buildings.filter(b => b.owner >= 0 && b.owner !== p.idx && this.revealed(p.idx, b)).map(b => b.id)),
      e: this.events,
    };
    if (this.over) snap.over = { w: this.winner, why: this.endReason, stats: this.players.map(p => roundStats(p.stats)), time: Math.round(t) };
    this.events = [];
    return snap;
  }
}

/**
 * What one seat may see of a snapshot: the cats inside other players' buildings and their army totals are hidden
 * (-1) unless a Spy Eye or Food Poisoning of theirs shows that building. Strays stay
 * visible. seat < 0 (a spectator) sees everything.
 */
export function maskSnap(snap, seat) {
  if (seat == null || seat < 0) return snap;
  const me = snap.p[seat];
  const out = { ...snap, rv: undefined };
  const seen = new Set((snap.rv && snap.rv[seat]) || []);
  out.b = snap.b.map(a => (a[1] >= 0 && a[1] !== seat && !seen.has(a[0]) ? [a[0], a[1], a[2], a[3], -1, ...a.slice(5)] : a));
  out.p = snap.p.map((a, k) => (k === seat ? a : [...a.slice(0, 7), -1, ...a.slice(8)]));
  return out;
}

/** can a skill with this target kind be cast on building b by player i? */
export function targetOk(kind, b, i) {
  if (!b) return false;
  switch (kind) {
    case 'own': return b.owner === i;
    case 'enemy': return b.owner >= 0 && b.owner !== i;
    case 'neutral': return b.owner < 0;
    case 'notown': return b.owner !== i;
    case 'owned': return b.owner >= 0;
    case 'any': return true;
  }
  return false;
}

/** skill levels from a lobby or profile: { skillId: 1..SKILL_MAX } (anything else is dropped) */
function cleanSkills(s) {
  const out = {};
  if (s && typeof s === 'object') for (const [k, v] of Object.entries(s).slice(0, 12)) { const n = v | 0; if (n >= 1) out[String(k).slice(0, 16)] = Math.min(SKILL_MAX, n); }
  return out;
}
function roundStats(s) {
  const o = {};
  for (const k in s) o[k] = Math.round(s[k]);
  return o;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
