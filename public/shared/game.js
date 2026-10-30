// Whisker Wars - authoritative game simulation.
// Pure logic: runs in the browser (practice / P2P host) and in Node (server tests).
import {
  WORLD_W, WORLD_H, TICK, BASE_SPEED, MAX_CATNIP, BASE_CATNIP_REGEN, START_CATNIP, TIME_LIMIT,
  OVERCAP_DECAY, SQUAD_CHUNK, PURR_PER_STAR, PURR_ATK_PER_STAR, PURR_SPD_PER_STAR,
  BTYPES, BUILDINGS, CONVERT_COST, HERO_BY_ID, AI_LEVELS, TURRET, TOWER_REGROW, STRAY_REGROW, strayRegrowRate, SCOUT, mulberry32,
} from './data.js';
import { getNav } from './nav.js';

// Effect flag bits (shared with the client renderer)
export const BFX = ['shield', 'stink', 'disabled', 'curse', 'tea', 'fortify', 'firewall', 'hack', 'turret', 'shadowstep', 'frozen'];
export const SFX = ['stealth', 'frozen', 'slow', 'haste', 'asleep', 'laser', 'stun', 'left', 'wait'];
export const PFX = ['rally', 'grog', 'eclipsed'];
const BFX_BIT = Object.fromEntries(BFX.map((n, i) => [n, 1 << i]));
const SFX_BIT = Object.fromEntries(SFX.map((n, i) => [n, 1 << i]));

export function radiusOf(type, level) {
  const r = BUILDINGS[type].radius;
  return r[Math.min(level, r.length) - 1];
}
export function hasFlag(mask, name, table = BFX) { return (mask & (1 << table.indexOf(name))) !== 0; }

const r1 = v => Math.round(v * 10) / 10;

export class Game {
  /**
   * cfg = { map: {id,name,theme,buildings:[{id,x,y,type,level,owner,count}]}, players:[{name,hero,fur,hat,ai?}], seed, timeLimit }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = mulberry32((cfg.seed || 1) >>> 0);
    this.time = 0;
    this.tickNo = 0;
    // more players, more to conquer: 3-4 player battles get 15 minutes unless the lobby picked a time
    this.timeLimit = cfg.timeLimit ?? (cfg.players.length > 2 ? TIME_LIMIT * 1.5 : TIME_LIMIT);
    this.rules = cfg.rules || {};
    this.players = cfg.players.map((p, i) => ({
      idx: i, name: p.name || ('Player ' + (i + 1)), heroId: p.hero, hero: HERO_BY_ID[p.hero] || HERO_BY_ID.whiskers,
      fur: p.fur, hat: p.hat, ai: p.ai || null,
      catnip: START_CATNIP, purr: 10, cds: [0, 0, 0], gcd: 0, alive: true, scoutUntil: 0, scoutCd: 0,
      rally: 0, grog: 0, eclipsed: 0, lastAction: 0, lastEmote: -9,
      bonusProd: p.ai && AI_LEVELS[p.ai] ? (AI_LEVELS[p.ai].bonusProd || 0) : 0,
      stats: { produced: 0, lost: 0, killed: 0, captured: 0, lostBuildings: 0, spells: 0, sent: 0, peakArmy: 0, upgrades: 0, maxCottage: 1 },
    }));
    this.buildings = cfg.map.buildings.map(b => ({
      id: b.id, x: b.x, y: b.y, type: b.type, level: b.level || 1, owner: b.owner ?? -1, count: b.count ?? 10,
      prodAcc: 0, fireCd: 1 + this.rng(), fx: {}, hackBy: -1, lastHit: -9,
    }));
    if (this.rules.bigstart) for (const b of this.buildings) b.count *= 2;
    // full: how many cats a building "should" have. Its owner sending cats out or spending them lowers it;
    // enemy attacks don't, so a tower can grow back what it lost in a failed attack.
    for (const b of this.buildings) b.full = b.count;
    this.byId = new Map(this.buildings.map(b => [b.id, b]));
    this.squads = [];
    this.nextSquad = 1;
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
  passive(i, id) { return i >= 0 && this.players[i] && this.players[i].hero.passive.id === id; }
  fx(b, name) { return (b.fx[name] || 0) > this.time; }
  radius(b) { return radiusOf(b.type, b.level); }
  emit(e) { this.events.push(e); }
  enemiesOf(i) { return this.players.filter(p => p.idx !== i && p.alive).map(p => p.idx); }

  cap(b) {
    let c = BUILDINGS[b.type].cap[b.level - 1];
    if (this.passive(b.owner, 'wellfed')) c *= 1.2;
    if (this.fx(b, 'fortify')) c *= 1.5;
    return Math.round(c);
  }
  defense(b) {
    let d = BUILDINGS[b.type].defense;
    if (this.fx(b, 'fortify')) d *= 1.5;
    if (this.fx(b, 'firewall')) d *= 1.6;
    if (this.fx(b, 'stink')) d *= 0.7;
    if (this.fx(b, 'shield')) d /= 0.3;
    if (this.passive(b.owner, 'bigboned')) d /= 0.85;
    return d;
  }
  stars(i) { return Math.min(5, Math.floor(this.players[i].purr / PURR_PER_STAR)); }
  forgeBonus(i) {
    let s = 0;
    for (const b of this.buildings) if (b.owner === i && b.type === 'forge') s += BUILDINGS.forge.atkBonus[b.level - 1];
    return Math.min(s, 0.6);
  }
  attack(i, squad, vsBuilding) {
    const p = this.players[i];
    let a = 1 + this.forgeBonus(i) + this.stars(i) * PURR_ATK_PER_STAR;
    if (p.grog > this.time) a += 0.5;
    if (squad && (squad.fx.haste || 0) > this.time) a += 0.3;
    if (vsBuilding && this.passive(i, 'chivalry')) a *= 1.1;
    return a;
  }
  squadSpeed(s) {
    const t = this.time;
    if ((s.fx.frozen || 0) > t || (s.fx.asleep || 0) > t || (s.fx.stun || 0) > t) return 0;
    const p = this.players[s.owner];
    let v = BASE_SPEED * (1 + this.stars(s.owner) * PURR_SPD_PER_STAR);
    if (this.passive(s.owner, 'lightpaws')) v *= 1.2;
    if (this.passive(s.owner, 'starcharts')) v *= 1.08;
    if (p.rally > t) v *= 1.6;
    if ((s.fx.haste || 0) > t) v *= 2;
    if ((s.fx.slow || 0) > t) v *= 0.3;
    if (this.rules.zoomies) v *= 1.5;
    return v;
  }
  catnipRegen(i) {
    let m = 1;
    for (const b of this.buildings) if (b.owner === i && b.type === 'garden') m += BUILDINGS.garden.catnipBonus[b.level - 1];
    if (this.passive(i, 'arcane')) m *= 1.25;
    return BASE_CATNIP_REGEN * m * (this.rules.frenzy ? 2 : 1);
  }
  spellCd(i, base) { return this.passive(i, 'overclock') ? base * 0.75 : base; }
  upgradeCost(b) {
    const c = BUILDINGS[b.type].upgradeCost[b.level - 1];
    if (c == null) return null;
    return this.passive(b.owner, 'engineering') ? Math.ceil(c * 0.75) : c;
  }
  convertCost(b, to) {
    const c = CONVERT_COST[to];
    return this.passive(b.owner, 'engineering') ? Math.ceil(c * 0.75) : c;
  }
  addPurr(i, v) {
    if (i < 0) return;
    const p = this.players[i];
    const before = this.stars(i);
    p.purr = Math.max(0, Math.min(100, p.purr + v));
    const after = this.stars(i);
    if (after > before) this.emit({ k: 'star', o: i, n: after });
    else if (after < before) this.emit({ k: 'unstar', o: i, n: after });
  }
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
    p.lastAction = this.time;
    switch (c.k) {
      case 'send': return this.cmdSend(i, c);
      case 'up': return this.cmdUpgrade(i, c);
      case 'conv': return this.cmdConvert(i, c);
      case 'spell': return this.cmdSpell(i, c);
      case 'scout': return this.cmdScout(i);
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
    const pct = clamp(Number(c.pct) || 0.5, 0.05, 1);
    for (const fid of c.from.slice(0, 30)) {
      const from = this.byId.get(fid);
      if (!from || from.owner !== i || from.id === to.id) continue;
      if (this.fx(from, 'stink')) { this.err(i, 'Those cats refuse to leave the stink!'); continue; }
      const n = Math.floor(from.count * pct);
      if (n < 1) continue;
      from.count -= n;
      from.full = from.count;
      this.players[i].stats.sent += n;
      if (this.fx(from, 'shadowstep')) {
        from.fx.shadowstep = 0;
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n });
        this.arrive({ owner: i, count: n, fx: {}, from: from.id }, to);
        continue;
      }
      this.launch(i, from, to, n);
      this.emit({ k: 'send', o: i, from: from.id, to: to.id, n });
    }
  }
  launch(i, from, to, n, opts = {}) {
    const path = opts.path || this.path(from, to);
    const first = path[0];
    const ang = Math.atan2(first.y - from.y, first.x - from.x);
    const r = this.radius(from) * 0.7;
    let k = 0;
    while (n > 0) {
      const c = Math.min(n, SQUAD_CHUNK);
      n -= c;
      const jitter = (this.rng() - 0.5) * 16;
      this.squads.push({
        id: this.nextSquad++, owner: i, count: c, from: from.id, to: to.id,
        x: from.x + Math.cos(ang) * r - Math.sin(ang) * jitter, y: from.y + Math.sin(ang) * r + Math.cos(ang) * jitter,
        path, wp: 0, wait: k * 0.45 + (opts.delay || 0), fx: {}, face: Math.cos(ang) < 0 ? 1 : 0,
      });
      k++;
    }
  }
  cmdUpgrade(i, c) {
    const b = this.byId.get(c.b);
    if (!b || b.owner !== i) return;
    const def = BUILDINGS[b.type];
    if (b.level >= def.maxLevel) return this.err(i, 'Already max level!');
    const cost = this.upgradeCost(b);
    if (b.count < cost) return this.err(i, `Needs ${cost} cats to upgrade`);
    b.count -= cost; b.full = b.count;
    this.doUpgrade(b, i);
  }
  doUpgrade(b, i) {
    b.level = Math.min(b.level + 1, BUILDINGS[b.type].maxLevel);
    const st = this.players[i].stats;
    st.upgrades++;
    if (b.type === 'cottage') st.maxCottage = Math.max(st.maxCottage, b.level);
    this.addPurr(i, 5);
    this.emit({ k: 'up', o: i, b: b.id, lv: b.level });
  }
  cmdConvert(i, c) {
    const b = this.byId.get(c.b);
    if (!b || b.owner !== i || !CONVERT_COST[c.to] || b.type === c.to || BUILDINGS[b.type].noConvert) return;
    const cost = this.convertCost(b, c.to);
    if (b.count < cost) return this.err(i, `Needs ${cost} cats to convert`);
    b.count -= cost; b.full = b.count;
    b.type = c.to; b.level = 1; b.fireCd = 1;
    this.emit({ k: 'conv', o: i, b: b.id, to: c.to });
  }

  /** Owl Scout: see every enemy building's cats for a few seconds. */
  cmdScout(i) {
    const p = this.players[i];
    if (!p || !p.alive) return;
    if (p.scoutCd > 0) return this.err(i, 'The owl is resting');
    if (p.catnip < SCOUT.cost) return this.err(i, `Owl Scout needs ${SCOUT.cost} catnip`);
    p.catnip -= SCOUT.cost;
    p.scoutUntil = this.time + SCOUT.dur;
    p.scoutCd = SCOUT.cd;
    p.stats.spells++;
    this.emit({ k: 'scout', o: i });
  }
  scouting(i) { const p = this.players[i]; return !!p && p.scoutUntil > this.time; }

  // ---------- spells ----------
  cmdSpell(i, c) {
    const p = this.players[i];
    const slot = c.slot | 0;
    const sp = p.hero.spells[slot];
    if (!sp) return;
    if (p.cds[slot] > 0 || p.gcd > 0) return this.err(i, 'Spell is recharging');
    if (p.catnip < sp.cost) return this.err(i, 'Not enough catnip!');
    let b = null, x = Number(c.x), y = Number(c.y);
    if (['own', 'enemy', 'neutral', 'notown'].includes(sp.target)) {
      b = this.byId.get(c.b);
      if (!b) return;
      const ok = sp.target === 'own' ? b.owner === i
        : sp.target === 'enemy' ? (b.owner >= 0 && b.owner !== i)
        : sp.target === 'neutral' ? b.owner < 0
        : b.owner !== i;
      if (!ok) return this.err(i, 'Invalid target');
      if (b.owner >= 0 && b.owner !== i && this.fx(b, 'firewall')) {
        this.emit({ k: 'blocked', o: i, b: b.id });
        return this.err(i, 'Blocked by a Firewall!');
      }
      x = b.x; y = b.y;
    } else if (sp.target === 'area') {
      if (!isFinite(x) || !isFinite(y)) return;
      x = clamp(x, 0, WORLD_W); y = clamp(y, 0, WORLD_H);
    }
    const res = this.applySpell(i, sp, b, x, y);
    if (res === false) return;
    p.catnip -= sp.cost;
    p.cds[slot] = this.spellCd(i, sp.cd);
    p.gcd = 0.8;
    p.stats.spells++;
    this.emit({ k: 'spell', o: i, id: sp.id, fx: sp.fx, x: r1(x || 0), y: r1(y || 0), b: b ? b.id : -1, r: sp.radius || 0, res: typeof res === 'string' ? res : undefined });
  }

  enemySquadsIn(i, x, y, r) {
    return this.squads.filter(s => s.owner !== i && s.wait <= 0 && Math.hypot(s.x - x, s.y - y) <= r + 6);
  }
  killSquadCats(s, n, killer) {
    n = Math.min(s.count, n);
    s.count -= n;
    this.onLosses(s.owner, n, s.x, s.y, killer);
    if (s.count < 0.5) this.removeSquad(s, 'pop');
    return n;
  }
  removeSquad(s, why) {
    const idx = this.squads.indexOf(s);
    if (idx >= 0) this.squads.splice(idx, 1);
    if (why) this.emit({ k: why, x: r1(s.x), y: r1(s.y), o: s.owner });
  }
  onLosses(owner, n, x, y, killer) {
    if (n <= 0 || owner < 0) return;
    this.players[owner].stats.lost += n;
    if (killer >= 0 && killer !== owner) this.players[killer].stats.killed += n;
    this.addPurr(owner, -0.12 * n);
    if (this.passive(owner, 'ninelives')) {
      const back = n * 0.12;
      const home = this.nearestOwned(owner, x, y);
      if (home && back > 0) { home.count += back; this.emit({ k: 'souls', o: owner, x: r1(x), y: r1(y), b: home.id, n: r1(back) }); }
    }
  }
  damageBuilding(b, n, attacker) {
    const d = Math.min(b.count, n);
    b.count -= d;
    b.lastHit = this.time;
    if (b.owner >= 0) this.onLosses(b.owner, d, b.x, b.y, attacker);
    return d;
  }

  applySpell(i, sp, b, x, y) {
    const t = this.time, p = this.players[i];
    const dur = sp.dur || 0;
    switch (sp.id) {
      // --- Sir Whiskers
      case 'rally': p.rally = t + dur; return;
      case 'shieldwall': b.fx.shield = t + dur; return;
      case 'decree':
        if (b.level >= BUILDINGS[b.type].maxLevel) { this.err(i, 'Already max level!'); return false; }
        this.doUpgrade(b, i); return;
      // --- Mittens
      case 'meteor': this.pending.push({ at: t + sp.delay, k: 'meteor', o: i, x, y, r: sp.radius }); return;
      case 'frost':
        for (const s of this.enemySquadsIn(i, x, y, sp.radius)) s.fx.frozen = t + dur;
        for (const e of this.buildings) if (e.owner >= 0 && e.owner !== i && Math.hypot(e.x - x, e.y - y) <= sp.radius + this.radius(e) * 0.5) e.fx.frozen = t + 6;
        return;
      case 'polymorph':
        if (!['tower', 'forge', 'garden'].includes(b.type)) { this.err(i, 'Only towers, forges and gardens!'); return false; }
        b.type = 'cottage'; b.level = 1; return;
      // --- Shadow
      case 'smoke':
        for (const s of this.squads) if (s.owner === i && Math.hypot(s.x - x, s.y - y) <= sp.radius + 6) s.fx.stealth = t + dur;
        return;
      case 'shuriken': this.damageBuilding(b, Math.min(22, Math.ceil(b.count * 0.35)), i); return;
      case 'shadowstep': b.fx.shadowstep = t + dur; return;
      // --- Chef
      case 'feast': b.count += 12; return;
      case 'pepper':
        for (const s of this.squads) if (s.owner === i && Math.hypot(s.x - x, s.y - y) <= sp.radius + 6) s.fx.haste = t + dur;
        return;
      case 'sardines': b.fx.stink = t + dur; return;
      // --- Chonk
      case 'bellyflop':
        for (const s of this.enemySquadsIn(i, x, y, sp.radius)) { s.fx.stun = t + dur; this.killSquadCats(s, 8, i); }
        return;
      case 'fortify': b.fx.fortify = t + dur; return;
      case 'naptime':
        for (const s of this.squads) if (s.owner !== i) s.fx.asleep = t + dur;
        return;
      // --- Duchess
      case 'teaparty': b.fx.tea = t + dur; return;
      case 'bribe':
        if (b.count > sp.max) { this.err(i, `Too many cats to bribe (max ${sp.max})`); return false; }
        this.capture(b, i, b.count, true); return;
      case 'goldenlitter':
        for (const e of this.buildings) if (e.owner === i) e.count += 3;
        return;
      // --- Clawbeard
      case 'cannon': this.damageBuilding(b, 15, i); b.fx.disabled = t + dur; return;
      case 'grog': p.grog = t + dur; return;
      case 'mutiny': {
        const hit = this.enemySquadsIn(i, x, y, sp.radius);
        for (const s of hit) { s.owner = i; s.fx = {}; }
        return hit.length ? `${hit.reduce((a, s) => a + Math.round(s.count), 0)}` : '0';
      }
      // --- Neko
      case 'luckycoin': {
        const roll = Math.floor(this.rng() * 3);
        if (roll === 0) { p.catnip = Math.min(MAX_CATNIP, p.catnip + 30 + sp.cost); return 'catnip'; }
        if (roll === 1) { for (const e of this.buildings) if (e.owner === i) e.count += 3; return 'cats'; }
        const ups = this.buildings.filter(e => e.owner === i && e.level < BUILDINGS[e.type].maxLevel);
        if (!ups.length) { p.catnip = Math.min(MAX_CATNIP, p.catnip + 30 + sp.cost); return 'catnip'; }
        this.doUpgrade(ups[Math.floor(this.rng() * ups.length)], i); return 'upgrade';
      }
      case 'beckon': {
        const n = Math.min(sp.max, Math.floor(b.count * 0.3));
        if (n < 1) { this.err(i, 'Nobody home to beckon!'); return false; }
        const home = this.nearestOwnedByPath(i, b);
        if (!home) return false;
        b.count -= n;
        if (b.owner >= 0) this.players[b.owner].stats.lost += n;
        this.launch(i, b, home, n);
        return;
      }
      case 'jackpot': b.count += Math.min(b.count, sp.max); return;
      // --- Astro
      case 'zerog': for (const s of this.enemySquadsIn(i, x, y, sp.radius)) { s.fx.slow = t + dur; this.killSquadCats(s, 4, i); } return;
      case 'tractor':
        for (const s of this.enemySquadsIn(i, x, y, sp.radius)) {
          let home = this.byId.get(s.from);
          if (!home || home.owner !== s.owner) {
            home = null;
            let bd = Infinity;
            for (const o of this.buildings) if (o.owner === s.owner) { const d = this.nav.distFrom(s.x, s.y, o.id); if (d < bd) { bd = d; home = o; } }
          }
          if (!home) continue;
          s.to = home.id; s.path = this.computePath(s.x, s.y, home); s.wp = 0; s.fx.stun = t + 0.6;
        }
        return;
      case 'orbital': this.pending.push({ at: t + sp.delay, k: 'orbital', o: i, b: b.id, x, y }); return;
      // --- Purrcival
      case 'laser':
        for (const s of this.enemySquadsIn(i, x, y, sp.radius)) s.fx.laser = t + dur, s.lx = x, s.ly = y;
        return;
      case 'turret': b.fx.turret = t + dur; return;
      case 'vacuum':
        for (const s of this.enemySquadsIn(i, x, y, sp.radius)) this.killSquadCats(s, Math.max(1, Math.floor(s.count * 0.45)), i);
        return;
      // --- Luna
      case 'moonbeam': b.count += clamp(b.count * 0.35, 5, sp.max); return;
      case 'curse': b.fx.curse = t + dur; return;
      case 'eclipse': for (const e of this.enemiesOf(i)) this.players[e].eclipsed = t + dur; return;
      // --- Glitch
      case 'firewall': b.fx.firewall = t + dur; return;
      case 'hack':
        if (!(b.type === 'tower' || b.type === 'cattree' || this.fx(b, 'turret'))) { this.err(i, 'Only towers can be hacked!'); return false; }
        b.fx.hack = t + dur; b.hackBy = i; return;
      case 'drain': {
        let got = 0;
        for (const e of this.enemiesOf(i)) { const n = Math.min(sp.max, this.players[e].catnip); this.players[e].catnip -= n; got += n; }
        p.catnip = Math.min(MAX_CATNIP, p.catnip + got);
        return String(Math.round(got));
      }
    }
  }

  resolvePending() {
    const t = this.time;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const e = this.pending[k];
      if (e.at > t) continue;
      this.pending.splice(k, 1);
      if (e.k === 'meteor') {
        for (const s of this.enemySquadsIn(e.o, e.x, e.y, e.r)) this.killSquadCats(s, 16, e.o);
        for (const b of this.buildings) if (b.owner >= 0 && b.owner !== e.o && Math.hypot(b.x - e.x, b.y - e.y) <= e.r) this.damageBuilding(b, 10, e.o);
        this.emit({ k: 'boom', o: e.o, x: r1(e.x), y: r1(e.y), r: e.r, fx: 'meteor' });
      } else if (e.k === 'orbital') {
        const b = this.byId.get(e.b);
        if (b && b.owner !== e.o) {
          if (!(b.owner >= 0 && this.fx(b, 'firewall'))) this.damageBuilding(b, 35, e.o);
          this.emit({ k: 'boom', o: e.o, x: b.x, y: b.y, r: 70, fx: 'orbital', b: b.id });
        }
      }
    }
  }

  // ---------- combat ----------
  arrive(s, b) {
    const i = s.owner;
    if (b.owner === i) {
      b.count += s.count;
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 1 });
      return;
    }
    const atk = this.attack(i, s, true);
    const def = this.defense(b);
    const dmg = s.count * atk / def;
    b.lastHit = this.time;
    if (dmg <= b.count + 1e-6) {
      const killed = Math.min(b.count, dmg);
      b.count -= dmg;
      if (b.count < 0) b.count = 0;
      this.onLosses(i, s.count, b.x, b.y, b.owner);
      if (b.owner >= 0) {
        this.onLosses(b.owner, killed, b.x, b.y, i);
        if (s.count >= 5) this.addPurr(b.owner, 3);
      }
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
    } else {
      const survivors = s.count - b.count * def / atk;
      const defenders = b.count;
      this.onLosses(i, s.count - survivors, b.x, b.y, b.owner);
      if (b.owner >= 0) this.onLosses(b.owner, defenders, b.x, b.y, i);
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
      this.capture(b, i, Math.max(0, survivors), false);
    }
  }
  capture(b, i, garrison, bySpell) {
    const prev = b.owner;
    b.owner = i;
    b.count = garrison;
    // a building taken from another player loses one upgrade level (strays keep theirs)
    const down = prev >= 0 && prev !== i && b.level > 1;
    if (down) b.level--;
    b.fx = {};
    b.hackBy = -1;
    b.prodAcc = 0;
    b.fireCd = 1;
    const p = this.players[i];
    p.stats.captured++;
    if (prev >= 0) { this.players[prev].stats.lostBuildings++; this.addPurr(prev, -14); this.addPurr(i, 12); }
    else this.addPurr(i, 7);
    let bonus = 0;
    if (this.passive(i, 'plunder')) p.catnip = Math.min(MAX_CATNIP, p.catnip + 8);
    if (this.passive(i, 'fortune') && this.rng() < 0.3) { b.count += 5; bonus = 5; }
    b.full = b.count;
    this.emit({ k: 'cap', b: b.id, o: i, prev, bonus, spell: bySpell ? 1 : 0, down: down ? b.level : 0 });
  }
  fieldCombat() {
    const S = this.squads, t = this.time;
    for (let a = 0; a < S.length; a++) {
      const A = S[a];
      if (A.wait > 0 || (A.fx.stealth || 0) > t) continue;
      for (let c = a + 1; c < S.length; c++) {
        const B = S[c];
        if (B.owner === A.owner || B.wait > 0 || (B.fx.stealth || 0) > t) continue;
        const rr = 7 + Math.sqrt(A.count) * 1.5 + 7 + Math.sqrt(B.count) * 1.5;
        const dx = A.x - B.x, dy = A.y - B.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        const aa = this.attack(A.owner, A, false), ab = this.attack(B.owner, B, false);
        const sa = A.count * aa, sb = B.count * ab;
        const mx = r1((A.x + B.x) / 2), my = r1((A.y + B.y) / 2);
        if (sa > sb) {
          const lostA = sb / aa;
          this.onLosses(B.owner, B.count, B.x, B.y, A.owner);
          this.onLosses(A.owner, lostA, A.x, A.y, B.owner);
          A.count -= lostA;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(B.count + lostA), w: A.owner });
          B.count = 0;
        } else {
          const lostB = sa / ab;
          this.onLosses(A.owner, A.count, A.x, A.y, B.owner);
          this.onLosses(B.owner, lostB, B.x, B.y, A.owner);
          B.count -= lostB;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(A.count + lostB), w: B.owner });
          A.count = 0;
        }
      }
    }
    for (let k = S.length - 1; k >= 0; k--) if (S[k].count < 0.5) S.splice(k, 1);
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
      for (let k = 0; k < 3; k++) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
      if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
      if (p.scoutCd > 0) p.scoutCd = Math.max(0, p.scoutCd - dt);
      if (t - p.lastAction > 12 && !p.ai) this.addPurr(p.idx, -1 * dt);
    }

    // buildings: production, decay, towers
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (b.owner >= 0) {
        const owner = this.players[b.owner];
        const cap = this.cap(b);
        const stopped = this.fx(b, 'curse') || this.fx(b, 'disabled') || this.fx(b, 'frozen') || owner.eclipsed > t;
        let rate = def.prod[b.level - 1] || 0;
        if (rate > 0 && b.type === 'cottage' && this.passive(b.owner, 'pampered')) rate *= 1.08;
        rate *= 1 + owner.bonusProd;
        if (this.rules.boom) rate *= 1.5;
        if (this.fx(b, 'tea')) rate = rate > 0 ? rate * 2 : 1;
        if (!stopped && rate > 0 && b.count < cap) {
          const add = Math.min(rate * dt, cap - b.count);
          b.count += add;
          owner.stats.produced += add;
        } else if (b.count > cap && rate > 0) {
          // over-full cottages and Cat Trees slowly lose the extra; towers, forges and gardens just hold what they have
          b.count = Math.max(cap, b.count - OVERCAP_DECAY * dt);
        }
        if (this.fx(b, 'curse')) {
          const n = Math.min(b.count, 1.5 * dt);
          b.count -= n; owner.stats.lost += n;
        }
      }
      // an unowned building that fought off an attack grows back to the cats it started with (bigger ones faster)
      if (b.owner < 0) {
        if (b.count > b.full) b.full = b.count;
        if (b.count < b.full && t - b.lastHit > STRAY_REGROW.delay) b.count = Math.min(b.full, b.count + strayRegrowRate(b.full) * dt);
      } else if (b.type === 'tower') {
        // your tower grows back what it lost at the normal kitten rate
        if (b.count > b.full) b.full = b.count;
        const target = Math.min(b.full, this.cap(b));
        const halted = this.fx(b, 'curse') || this.fx(b, 'disabled') || this.fx(b, 'frozen') || this.players[b.owner].eclipsed > t;
        if (b.count < target && t - b.lastHit > TOWER_REGROW.delay && !halted) {
          const add = Math.min(TOWER_REGROW.rate * dt, target - b.count);
          b.count += add;
          this.players[b.owner].stats.produced += add;
        }
      }
      // towers (an unowned tower shoots at everyone's cats until somebody takes it)
      const shooter = def.range || this.fx(b, 'turret');
      const stray = b.owner < 0;
      if (shooter && (!stray || b.type === 'tower') && b.count >= 1 && !this.fx(b, 'disabled') && !(!stray && this.players[b.owner].eclipsed > t)) {
        b.fireCd -= dt;
        if (b.fireCd <= 0) {
          let range = def.range ? def.range[b.level - 1] : TURRET.range;
          let every = def.fireEvery ? def.fireEvery[b.level - 1] : TURRET.fireEvery;
          if (!stray && this.passive(b.owner, 'starcharts')) { range *= 1.25; every *= 0.75; }
          const hacked = this.fx(b, 'hack');
          const shooterOwner = hacked ? b.hackBy : b.owner;
          let best = null, bd = range;
          for (const s of this.squads) {
            if (s.wait > 0 || (s.fx.stealth || 0) > t) continue;
            if (hacked ? s.owner !== b.owner : s.owner === b.owner) continue;
            const d = Math.hypot(s.x - b.x, s.y - b.y);
            if (d < bd) { bd = d; best = s; }
          }
          if (best) {
            b.fireCd = every;
            const ft = 0.12 + bd / 650;
            this.projectiles.push({ at: t + ft, s: best.id, o: shooterOwner });
            this.emit({ k: 'shot', b: b.id, s: best.id, x: r1(best.x), y: r1(best.y), ft: r1(ft), h: hacked ? 1 : 0 });
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
      if (s) this.killSquadCats(s, 1, pr.o);
    }

    this.resolvePending();

    // squads move
    for (let k = this.squads.length - 1; k >= 0; k--) {
      const s = this.squads[k];
      if (s.wait > 0) { s.wait -= dt; continue; }
      const to = this.byId.get(s.to);
      if (!to) { this.squads.splice(k, 1); continue; }
      if ((s.fx.laser || 0) > t) {
        const dx = s.lx - s.x, dy = s.ly - s.y, d = Math.hypot(dx, dy);
        if (d > 4) {
          // chase the dot, but not into a pond or through a wall
          const v = Math.min(BASE_SPEED * 0.5 * dt, d), nx = s.x + dx / d * v, ny = s.y + dy / d * v, nav = this.nav;
          if (nav.walkable(nx, ny) || !nav.walkable(s.x, s.y)) { s.x = nx; s.y = ny; }
          else if (nav.walkable(nx, s.y)) s.x = nx;
          else if (nav.walkable(s.x, ny)) s.y = ny;
          s.face = dx < 0 ? 1 : 0;
        }
        s.lasered = true;
        continue;
      }
      if (s.lasered) { s.lasered = false; s.path = this.computePath(s.x, s.y, to); s.wp = 0; }
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
    for (const b of this.buildings) if (b.owner === i) { b.owner = -1; b.fx = {}; b.hackBy = -1; b.full = b.count; this.emit({ k: 'cap', b: b.id, o: -1, prev: i, bonus: 0, spell: 0, down: 0 }); }
    for (let k = this.squads.length - 1; k >= 0; k--) if (this.squads[k].owner === i) this.removeSquad(this.squads[k], 'pop');
  }
  checkEnd() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const army = this.armyOf(p.idx);
      p.stats.peakArmy = Math.max(p.stats.peakArmy, army);
      const hasB = this.buildings.some(b => b.owner === p.idx);
      const hasS = this.squads.some(s => s.owner === p.idx);
      if (!hasB && !hasS) this.eliminate(p.idx, 'wiped');
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
      players: this.players.map(p => ({ name: p.name, hero: p.heroId, fur: p.fur, hat: p.hat, ai: p.ai })),
      timeLimit: this.timeLimit,
      rules: this.rules,
    };
  }
  snapshot() {
    const t = this.time;
    const bfx = b => {
      let m = 0;
      for (const n of BFX) if ((b.fx[n] || 0) > t) m |= BFX_BIT[n];
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
      b: this.buildings.map(b => [b.id, b.owner, BTYPES.indexOf(b.type), b.level, r1(b.count), bfx(b), this.cap(b), b.hackBy, b.owner < 0 ? r1(b.full) : 0]),
      s: this.squads.map(s => [s.id, s.owner, Math.round(s.count * 10) / 10, Math.round(s.x), Math.round(s.y), sfx(s), s.to]),
      p: this.players.map(p => [
        r1(p.catnip), Math.round(p.purr), r1(p.cds[0]), r1(p.cds[1]), r1(p.cds[2]),
        (p.rally > t ? 1 : 0) | (p.grog > t ? 2 : 0) | (p.eclipsed > t ? 4 : 0) | (p.scoutUntil > t ? 8 : 0),
        p.alive ? 1 : 0, Math.round(this.armyOf(p.idx)), this.stars(p.idx), r1(p.gcd), r1(p.scoutCd),
      ]),
      e: this.events,
    };
    if (this.over) snap.over = { w: this.winner, why: this.endReason, stats: this.players.map(p => roundStats(p.stats)), time: Math.round(t) };
    this.events = [];
    return snap;
  }
}

/**
 * What one seat may see of a snapshot: the cats inside other players' buildings and their army totals are hidden
 * (-1) unless that seat's Owl Scout is out. Strays stay visible. seat < 0 (a spectator) sees everything.
 */
export function maskSnap(snap, seat) {
  if (seat == null || seat < 0) return snap;
  const me = snap.p[seat];
  if (me && (me[5] & 8)) return snap;
  const out = { ...snap };
  out.b = snap.b.map(a => (a[1] >= 0 && a[1] !== seat ? [a[0], a[1], a[2], a[3], -1, ...a.slice(5)] : a));
  out.p = snap.p.map((a, k) => (k === seat ? a : [...a.slice(0, 7), -1, ...a.slice(8)]));
  return out;
}

function roundStats(s) {
  const o = {};
  for (const k in s) o[k] = Math.round(s[k]);
  return o;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
