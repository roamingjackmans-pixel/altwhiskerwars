// Alt Whisker Wars - authoritative game simulation.
// Pure logic: runs in the browser (practice / P2P host) and in Node (server tests).
import {
  WORLD_W, WORLD_H, TICK, BASE_SPEED, MAX_CATNIP, BASE_CATNIP_REGEN, START_CATNIP, TIME_LIMIT,
  OVERCAP_DECAY, SQUAD_CHUNK, PURR, purrLevel,
  BTYPES, BUILDINGS, CONVERT_COST, HERO_BY_ID, HEROES, skillAt, SKILL_MAX, AI_LEVELS, TOWER_REGROW, STRAY_REGROW, strayRegrowRate, mulberry32,
} from './data.js';
import { getNav } from './nav.js';

// Effect flag bits (shared with the client renderer)
export const BFX = ['stone', 'shackle', 'popup', 'boom', 'ranks', 'beam', 'pods', 'kboom', 'paper', 'frozen', 'fly', 'shortcut', 'plague', 'soul', 'invuln', 'defect', 'bounce', 'echo'];
export const SFX = ['stealth', 'frozen', 'slow', 'boost', 'rage', 'chicken', 'stun', 'left', 'wait', 'fly', 'plague'];
// player flags in snapshot p[5]
export const PF = { scouting: 8, silenced: 16, purrLock: 32 };
// lasting areas on the field
export const ZONES = ['uturn', 'fog', 'spy', 'intel', 'vortex', 'tornado', 'fence', 'magnet'];
const BFX_BIT = Object.fromEntries(BFX.map((n, i) => [n, 1 << i]));
const SFX_BIT = Object.fromEntries(SFX.map((n, i) => [n, 1 << i]));
const NEXT_SEND = 30;      // "next cats you send" skills wait this long
const TUNNEL_TIME = 3.5;   // Shortcut
const BEAM_TIME = 2;       // Beam Me Up
const LOSS_MEMORY = 5;     // Second Life looks this far back
const HIST_EVERY = 0.25, HIST_KEEP = 4;   // squad position history for Rewind

export function radiusOf(type, level) {
  const r = BUILDINGS[type].radius;
  return r[Math.min(level, r.length) - 1];
}
export function hasFlag(mask, name, table = BFX) { return (mask & (1 << table.indexOf(name))) !== 0; }

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
    this.players = cfg.players.map((p, i) => ({
      idx: i, name: p.name || ('Player ' + (i + 1)), heroId: (HERO_BY_ID[p.hero] || HEROES[0]).id, hero: HERO_BY_ID[p.hero] || HEROES[0],
      fur: p.fur, hat: p.hat, ai: p.ai || null, skills: cleanSkills(p.skills),
      catnip: START_CATNIP, purr: PURR.start, purrLock: 0, silenced: 0, cds: [0, 0, 0, 0], gcd: 0, alive: true, scoutUntil: 0, scoutCd: 0,
      lastAction: 0, lastEmote: -9,
      bonusProd: p.ai && AI_LEVELS[p.ai] ? (AI_LEVELS[p.ai].bonusProd || 0) : 0,
      stats: { produced: 0, lost: 0, killed: 0, captured: 0, lostBuildings: 0, spells: 0, sent: 0, peakArmy: 0, upgrades: 0, maxCottage: 1 },
    }));
    this.buildings = cfg.map.buildings.map(b => ({
      id: b.id, x: b.x, y: b.y, type: b.type, level: b.level || 1, owner: b.owner ?? -1, count: b.count ?? 10,
      prodAcc: 0, defAcc: 0, fireCd: 1 + this.rng(), fx: {}, fxp: {}, lastHit: -9, losses: [],
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
  /** a hero skill with its numbers at this player's level */
  spell(i, slot) { const p = this.players[i], sp = p && p.hero.spells[slot]; return sp ? skillAt(sp, p.skills[sp.id] || 1) : null; }
  /** level of one of this player's skills (0 when the hero has no such skill) */
  skillLv(i, id) { const p = this.players[i]; return p && p.hero.spells.some(s => s.id === id) ? (p.skills[id] || 1) : 0; }
  fx(b, name) { return (b.fx[name] || 0) > this.time; }
  fxp(b, name) { return this.fx(b, name) ? b.fxp[name] || {} : null; }
  setFx(b, name, until, params = {}) { b.fx[name] = until; b.fxp[name] = params; }
  radius(b) { return radiusOf(b.type, b.level); }
  emit(e) { this.events.push(e); }
  enemiesOf(i) { return this.players.filter(p => p.idx !== i && p.alive).map(p => p.idx); }
  /** what a building is doing right now: a Pop-up Tower counts as a tower */
  btype(b) { return this.fx(b, 'popup') ? 'tower' : b.type; }
  /** level it shoots at (a Pop-up Tower is capped by the skill) */
  shootLevel(b) {
    if (this.fx(b, 'popup')) return Math.max(1, Math.min(b.level, b.fxp.popup.tlv || 1, BUILDINGS.tower.maxLevel));
    return b.level;
  }
  working(b) { return !this.fx(b, 'frozen') && !this.fx(b, 'popup'); }

  cap(b) { return Math.round(BUILDINGS[b.type].cap[b.level - 1]); }
  defense(b) {
    let d = BUILDINGS[this.btype(b)].defense;
    const st = this.fxp(b, 'stone'); if (st) d *= st.mul;
    if (b.owner >= 0) d *= 1 + this.stars(b.owner) * PURR.def;
    const pw = this.fxp(b, 'paper'); if (pw) d *= Math.max(0.15, 1 - pw.drop);
    return d;
  }
  stars(i) { return i >= 0 && this.players[i] ? purrLevel(this.players[i].purr) : 0; }
  forgeBonus(i) {
    let s = 0;
    for (const b of this.buildings) if (b.owner === i && b.type === 'forge' && this.working(b)) s += BUILDINGS.forge.atkBonus[b.level - 1];
    return Math.min(s, 0.6);
  }
  attack(i, squad) {
    // chickens get no forge or Purr Power bonus
    if (squad && squad.chick) return squad.chick;
    // Purr Power multiplies everything else
    let a = (1 + this.forgeBonus(i)) * (1 + this.stars(i) * PURR.atk);
    if (squad && squad.atkMul) a *= squad.atkMul;
    return a;
  }
  inZone(kind, x, y, pred) {
    for (const z of this.zones) if (z.k === kind && Math.hypot(z.x - x, z.y - y) <= z.r && (!pred || pred(z))) return z;
    return null;
  }
  squadSpeed(s) {
    const t = this.time;
    if ((s.fx.frozen || 0) > t || (s.fx.stun || 0) > t) return 0;
    let v = BASE_SPEED * (1 + this.stars(s.owner) * PURR.spd) * (s.spdMul || 1) / (s.slowmo || 1);
    for (const z of this.zones) {
      if (Math.hypot(z.x - s.x, z.y - s.y) > z.r) continue;
      if (z.k === 'vortex') v *= 1.5;
      else if (z.k === 'fog' && z.o !== s.owner) v *= z.slow;
    }
    if (this.rules.zoomies) v *= 1.5;
    return v;
  }
  catnipRegen(i) {
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
    const pct = clamp(Number(c.pct) || 0.5, 0.05, 1);
    const t = this.time;
    for (const fid of c.from.slice(0, 30)) {
      const from = this.byId.get(fid);
      if (!from || from.owner !== i || from.id === to.id) continue;
      if (this.fx(from, 'shackle')) { this.err(i, 'That building is in shackles!'); continue; }
      // Beam Me Up: a share of the building's cats beams straight to another of your buildings
      const beam = this.fxp(from, 'beam');
      if (beam && to.owner === i) {
        const n = Math.floor(from.count * beam.pct);
        if (n < 1) continue;
        from.count -= n; from.full = from.count; from.fx.beam = 0;
        this.pending.push({ at: t + BEAM_TIME, k: 'land', o: i, to: to.id, from: from.id, n });
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n, fx: 'beam' });
        continue;
      }
      let n = Math.floor(from.count * pct);
      if (n < 1) continue;
      const sent = n;
      from.count -= n;
      from.full = from.count;
      this.players[i].stats.sent += n;
      const plague = this.fxp(from, 'plague');
      const carry = plague ? { ...plague, until: from.fx.plague } : null;
      // Shortcut: up to N cats take a tunnel and pop out at the target a few seconds later
      const sc = this.fxp(from, 'shortcut');
      if (sc) {
        const k = Math.min(n, sc.n); n -= k; from.fx.shortcut = 0;
        this.pending.push({ at: t + TUNNEL_TIME, k: 'land', o: i, to: to.id, from: from.id, n: k, plague: carry });
        this.emit({ k: 'warp', o: i, from: from.id, to: to.id, n: k, fx: 'tunnel' });
        if (n < 1) continue;
      }
      // Flying Kittens: straight over everything, faster
      const fly = this.fxp(from, 'fly');
      if (fly) {
        const k = Math.min(n, fly.n); n -= k; from.fx.fly = 0;
        this.launch(i, from, to, k, { fly: true, spdMul: fly.spd, packed: true, plague: carry });
      }
      // Tight Formation: one packed, faster squad
      const rk = this.fxp(from, 'ranks');
      if (rk && n > 0) {
        const k = Math.min(n, rk.n); n -= k; from.fx.ranks = 0;
        this.launch(i, from, to, k, { packed: true, spdMul: rk.spd, plague: carry });
      }
      if (n > 0) this.launch(i, from, to, n, { plague: carry });
      this.emit({ k: 'send', o: i, from: from.id, to: to.id, n: sent });
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
        path, wp: 0, wait: k * 0.45 + (opts.delay || 0), fx: {}, face: Math.cos(ang) < 0 ? 1 : 0, hist: [],
      };
      if (opts.spdMul) s.spdMul = opts.spdMul;
      if (opts.fly) { s.fly = true; s.fx.fly = Infinity; }
      if (opts.plague) { s.plague = opts.plague; s.fx.plague = Infinity; }
      this.squads.push(s);
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
    const cost = this.convertCost(b, c.to);
    if (b.count < cost) return this.err(i, `Needs ${cost} cats to convert`);
    b.count -= cost; b.full = b.count;
    b.type = c.to; b.level = 1; b.fireCd = 1;
    b.fx.popup = 0;
    this.emit({ k: 'conv', o: i, b: b.id, to: c.to });
  }

  // ---------- skills ----------
  cmdSpell(i, c) {
    const p = this.players[i];
    const slot = c.slot | 0;
    const sp = this.spell(i, slot);
    if (!sp) return;
    if (p.silenced > this.time) return this.err(i, 'Hush! No skills right now');
    if (p.cds[slot] > 0 || p.gcd > 0) return this.err(i, 'Skill is recharging');
    if (p.catnip < sp.cost) return this.err(i, 'Not enough catnip!');
    let b = null, x = Number(c.x), y = Number(c.y);
    if (['own', 'enemy', 'neutral', 'notown'].includes(sp.target)) {
      b = this.byId.get(c.b);
      if (!b) return;
      const ok = sp.target === 'own' ? b.owner === i
        : sp.target === 'enemy' ? (b.owner >= 0 && b.owner !== i)
        : sp.target === 'neutral' ? b.owner < 0
        : b.owner !== i;
      if (!ok) return this.err(i, 'Pick a glowing building');
      x = b.x; y = b.y;
    } else if (sp.target === 'area') {
      if (!isFinite(x) || !isFinite(y)) return;
      x = clamp(x, 0, WORLD_W); y = clamp(y, 0, WORLD_H);
    }
    const res = this.applySpell(i, sp, b, x, y);
    if (res === false) return;
    p.catnip -= sp.cost;
    p.cds[slot] = sp.cd;
    p.gcd = 0.8;
    p.stats.spells++;
    this.emit({ k: 'spell', o: i, id: sp.id, fx: sp.fx, x: r1(x || 0), y: r1(y || 0), b: b ? b.id : -1, r: sp.r || 0, res: res != null ? String(res) : undefined, lv: sp.level });
  }

  squadsIn(x, y, r, pred) { return this.squads.filter(s => s.wait <= 0 && Math.hypot(s.x - x, s.y - y) <= r + 6 && (!pred || pred(s))); }
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
    if (s.count < 0.5) this.removeSquad(s, 'pop');
    return n;
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
    if (n <= 0 || owner < 0) return;
    const p = this.players[owner];
    p.stats.lost += n;
    if (killer >= 0 && killer !== owner) this.players[killer].stats.killed += n;
    const vsRival = killer >= 0 && killer !== owner;
    if ((kind === 'attack' || kind === 'field' || kind === 'tower') && vsRival) {
      this.addPurr(owner, PURR.lostAttacking * n);
      p.catnip = Math.min(MAX_CATNIP, p.catnip + PURR.catnipPerLoss * PURR.catnipK[this.stars(owner)] * n);
      if (kind !== 'field') this.addPurr(killer, PURR.killDefending * n);
    }
  }
  /** cats knocked out of a building (by a skill, a tornado, poison...) */
  damageBuilding(b, n, attacker, kind = 'spell', noEcho = false) {
    if (this.fx(b, 'invuln') && attacker !== b.owner) return 0;
    const d = Math.min(b.count, n);
    if (d <= 0) return 0;
    b.count -= d;
    b.lastHit = this.time;
    if (b.owner >= 0) { this.onLosses(b.owner, d, b.x, b.y, attacker, kind); b.losses.push({ t: this.time, n: d }); }
    if (!noEcho) this.echo(b, d);
    return d;
  }
  /** Echo Hex: cats knocked out of the hexed building are also knocked out of its nearest friends */
  echo(b, d) {
    const e = this.fxp(b, 'echo');
    if (!e || d <= 0 || b.owner < 0) return;
    const near = this.buildings.filter(o => o !== b && o.owner === b.owner).sort((p, q) => dist(p, b.x, b.y) - dist(q, b.x, b.y)).slice(0, e.bld);
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
    switch (sp.id) {
      // ---------------- Sir Pounce
      case 'stonepaws': this.setFx(b, 'stone', t + dur, { mul: sp.mul }); return;
      case 'zoomboots':
        for (const s of this.squadsIn(x, y, sp.r)) { s.spdMul = (s.spdMul || 1) * sp.spd; s.fx.boost = Infinity; }
        return;
      case 'luckystar': {
        const lv = this.stars(i);
        if (lv < 5) this.setPurr(i, Math.max(p.purr, PURR.stars[lv + 1]));
        p.purrLock = Math.max(p.purrLock, t + dur);
        return;
      }
      case 'sneak': this.pending.push({ at: t + (sp.delay || 2.2), k: 'sneak', o: i, n: sp.n }); return;
      // ---------------- Corporal Kibble
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
      // ---------------- Baron Bristle
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
      // ---------------- Captain Zap
      case 'beam': this.setFx(b, 'beam', t + NEXT_SEND, { pct: sp.pct }); return;
      case 'cloak': for (const s of this.squadsIn(x, y, sp.r, s => s.owner === i)) s.fx.stealth = t + dur; return;
      case 'uturn': this.addZone({ k: 'uturn', o: i, x, y, r: sp.r, until: t + dur }); return;
      case 'pods': this.setFx(b, 'pods', t + sp.fill, { left: sp.n, rate: sp.n / sp.fill }); return;
      // ---------------- Agent Velvet
      case 'spyeye': this.addZone({ k: 'spy', o: i, x, y, r: sp.r, until: t + dur, prod: sp.prod }); return;
      case 'fog': this.addZone({ k: 'fog', o: i, x, y, r: sp.r, until: t + (sp.dur || 15), slow: sp.slow }); return;
      case 'hypno': {
        const n = Math.floor(b.count * sp.pct);
        if (n < 1) { this.err(i, 'Nobody home to hypnotize!'); return false; }
        const home = this.nearestOwnedByPath(i, b);
        if (!home) return false;
        b.count -= n; b.full = Math.min(b.full, b.count);
        if (b.owner >= 0) this.players[b.owner].stats.lost += n;
        this.launch(i, b, home, n);
        return n;
      }
      case 'zapfence': this.addZone({ k: 'fence', o: i, b: b.id, x: b.x, y: b.y, r: this.radius(b) + 70, until: t + dur, left: sp.cap }); return;
      // ---------------- Professor Paradox
      case 'mindread': this.addZone({ k: 'intel', o: i, x, y, r: sp.r, until: t + (sp.dur || 8) }); return;
      case 'rewind': {
        let n = 0;
        for (const s of this.enemySquadsIn(i, x, y, sp.r)) if (this.rewind(s, sp.back)) n++;
        return n;
      }
      case 'shortcut': this.setFx(b, 'shortcut', t + NEXT_SEND, { n: sp.n }); return;
      case 'chain': {
        let s0 = null, bd = 120;
        for (const s of this.squads) { if (s.wait > 0) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; s0 = s; } }
        if (!s0) { this.err(i, 'Tap right next to a squad'); return false; }
        const o = s0.owner, hit = new Set(), pts = [];
        let cur = s0, left = sp.cap;
        while (cur && left > 0.5) {
          hit.add(cur.id); pts.push([Math.round(cur.x), Math.round(cur.y)]);
          const cx = cur.x, cy = cur.y;
          left -= this.killSquadCats(cur, Math.min(left, cur.count), i, 'spell');
          let next = null, nd = 230;
          for (const s of this.squads) { if (s.owner !== o || hit.has(s.id) || s.wait > 0) continue; const d = Math.hypot(s.x - cx, s.y - cy); if (d < nd) { nd = d; next = s; } }
          cur = next;
        }
        this.emit({ k: 'chain', o: i, pts });
        return Math.round(sp.cap - left);
      }
      // ---------------- Princess Paprika
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
          if (s.count <= left) { left -= s.count; s.owner = i; s.fx = { stun: t + 0.4 }; s.chick = 0; s.plague = null; continue; }
          s.count -= left;
          this.squads.push({ ...s, id: this.nextSquad++, owner: i, count: left, fx: { stun: t + 0.4 }, chick: 0, plague: null, hist: [] });
          left = 0;
        }
        return Math.round(sp.n - left);
      }
      // ---------------- Snowpaw
      case 'deepfreeze': this.setFx(b, 'frozen', t + dur); return;
      case 'flying': this.setFx(b, 'fly', t + NEXT_SEND, { n: sp.n, spd: sp.spd }); return;
      case 'frostring': for (const s of this.squadsIn(x, y, sp.r)) s.fx.frozen = t + dur; return;
      case 'tornado': this.addZone({ k: 'tornado', o: i, cx: x, cy: y, x, y, r: 46, orbit: 85, until: t + dur, ph: this.rng() * 6.28, t0: t }); return;
      // ---------------- Miss Mischief
      case 'vortex': this.addZone({ k: 'vortex', o: i, x, y, r: sp.r, until: t + dur }); return;
      case 'purrfreeze': for (const q of this.players) if (q.alive) q.purrLock = Math.max(q.purrLock, t + dur); return;
      case 'chickens': for (const s of this.enemySquadsIn(i, x, y, sp.r)) { s.chick = sp.atk; s.atkMul = 1; s.fx.chicken = Infinity; s.fx.rage = 0; } return;
      case 'magnet': this.addZone({ k: 'magnet', o: i, b: b.id, x: b.x, y: b.y, r: sp.r, until: t + dur }); return;
      // ---------------- Lord Graveclaw
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
      // ---------------- Chef Grimsby
      case 'soulsnatch':
        if (!(BUILDINGS[this.btype(b)].range)) { this.err(i, 'Pick one of your towers'); return false; }
        this.setFx(b, 'soul', t + dur, { range: sp.range }); return;
      case 'untouchable': this.setFx(b, 'invuln', t + 10); return;
      case 'slowmo': for (const s of this.squadsIn(x, y, sp.r)) { s.slowmo = Math.max(s.slowmo || 1, sp.slowx); s.fx.slow = Infinity; } return;
      case 'poison': this.setFx(b, 'plague', t + (sp.dur || 12), { rate: sp.rate, prod: sp.prod, chance: sp.chance, by: i }); return;
      // ---------------- Hexley
      case 'defectors':
        if (!(BUILDINGS[b.type].prod[b.level - 1] > 0)) { this.err(i, 'Only buildings that make kittens'); return false; }
        this.setFx(b, 'defect', t + dur, { by: i }); return;
      case 'bounce': this.setFx(b, 'bounce', t + dur, { left: sp.n }); return;
      case 'swap': {
        const mine = this.buildings.filter(o => o.owner === i);
        if (!mine.length) return false;
        const m = mine[Math.floor(this.rng() * mine.length)];
        const them = b.owner;
        for (const [o, to, prev] of [[b, i, them], [m, them, i]]) {
          o.owner = to; o.fx = {}; o.fxp = {}; o.full = o.count; o.prodAcc = 0; o.fireCd = 1; o.losses = [];
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
      }
    }
  }

  // ---------- lasting areas ----------
  updateZones(dt) {
    const t = this.time;
    for (let k = this.zones.length - 1; k >= 0; k--) {
      const z = this.zones[k];
      if (z.until <= t) { this.zones.splice(k, 1); continue; }
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
          const b = this.byId.get(z.b);
          if (!b || b.owner !== z.o || z.left < 0.5) { z.until = t; break; }
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.owner !== z.o)) {
            const k = this.killSquadCats(s, Math.min(s.count, z.left), z.o, 'spell');
            z.left -= k;
            if (k > 0) this.emit({ k: 'zapped', x: r1(s.x), y: r1(s.y), n: Math.round(k) });
            if (z.left < 0.5) break;
          }
          break;
        }
        case 'magnet': {
          const b = this.byId.get(z.b);
          if (!b || b.owner !== z.o) { z.until = t; break; }
          for (const s of this.squadsIn(z.x, z.y, z.r, s => s.to !== b.id && s.mz !== z.id)) {
            s.mz = z.id; s.to = b.id; s.path = s.fly ? [{ x: b.x, y: b.y }] : this.computePath(s.x, s.y, b); s.wp = 0;
          }
          break;
        }
      }
    }
  }

  // ---------- combat ----------
  arrive(s, b) {
    const i = s.owner;
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
    // Bounce Shield: enemy cats turn around at the door
    const bo = rival ? this.fxp(b, 'bounce') : null;
    if (bo && bo.left > 0 && s.id != null) {
      bo.left -= s.count;
      if (this.turnHome(s, 0.5)) { this.squads.push(s); this.emit({ k: 'bounced', b: b.id, o: b.owner, n: Math.round(s.count) }); return; }
    }
    b.lastHit = this.time;
    // Untouchable: attackers can't hurt it
    if (rival && this.fx(b, 'invuln')) {
      this.onLosses(i, s.count, b.x, b.y, b.owner, 'attack');
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0, blocked: 1 });
      return;
    }
    const atk = this.attack(i, s);
    const def = this.defense(b);
    const dmg = s.count * atk / def;
    if (dmg <= b.count + 1e-6) {
      const killed = Math.min(b.count, dmg);
      b.count -= dmg;
      if (b.count < 0) b.count = 0;
      this.onLosses(i, s.count, b.x, b.y, rival ? b.owner : -1, 'attack');
      if (rival) {
        this.onLosses(b.owner, killed, b.x, b.y, i, 'garrison');
        b.losses.push({ t: this.time, n: killed });
        this.echo(b, killed);
      }
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
    } else {
      const survivors = s.count - b.count * def / atk;
      const defenders = b.count;
      this.onLosses(i, s.count - survivors, b.x, b.y, rival ? b.owner : -1, 'attack');
      if (rival) { this.onLosses(b.owner, defenders, b.x, b.y, i, 'garrison'); this.echo(b, defenders); }
      this.emit({ k: 'arrive', b: b.id, o: i, n: Math.round(s.count), f: 0 });
      this.capture(b, i, Math.max(0, survivors), false);
    }
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
    for (let a = 0; a < S.length; a++) {
      const A = S[a];
      if (A.wait > 0 || (A.fx.stealth || 0) > t || A.count <= 0) continue;
      for (let c = a + 1; c < S.length; c++) {
        const B = S[c];
        if (B.owner === A.owner || B.wait > 0 || (B.fx.stealth || 0) > t || B.count <= 0) continue;
        const rr = 7 + Math.sqrt(A.count) * 1.5 + 7 + Math.sqrt(B.count) * 1.5;
        const dx = A.x - B.x, dy = A.y - B.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        const aa = this.attack(A.owner, A), ab = this.attack(B.owner, B);
        const sa = A.count * aa, sb = B.count * ab;
        const mx = r1((A.x + B.x) / 2), my = r1((A.y + B.y) / 2);
        if (sa > sb) {
          const lostA = sb / aa;
          this.onLosses(B.owner, B.count, B.x, B.y, A.owner, 'field');
          this.onLosses(A.owner, lostA, A.x, A.y, B.owner, 'field');
          A.count -= lostA;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(B.count + lostA), w: A.owner });
          B.count = 0;
        } else {
          const lostB = sa / ab;
          this.onLosses(A.owner, A.count, A.x, A.y, B.owner, 'field');
          this.onLosses(B.owner, lostB, B.x, B.y, A.owner, 'field');
          B.count -= lostB;
          this.emit({ k: 'fight', x: mx, y: my, n: Math.round(A.count + lostB), w: B.owner });
          A.count = 0;
        }
        if (A.count <= 0) break;
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
      for (let k = 0; k < p.cds.length; k++) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
      if (p.gcd > 0) p.gcd = Math.max(0, p.gcd - dt);
      // sitting still drains Purr Power, and the higher it is the sooner and faster it goes
      const lv = this.stars(p.idx);
      if (p.purr > 0 && t - p.lastAction > PURR.idleAfter[lv]) this.addPurr(p.idx, -PURR.idleDrain[lv] * dt);
    }

    this.updateZones(dt);

    // buildings: skill effects, production, decay, towers
    for (const b of this.buildings) {
      const def = BUILDINGS[b.type];
      if (b.owner >= 0) {
        const owner = this.players[b.owner];
        const cap = this.cap(b);
        // Drop Pods
        const pods = this.fxp(b, 'pods');
        if (pods && pods.left > 0) { const add = Math.min(pods.left, pods.rate * dt); pods.left -= add; b.count += add; owner.stats.produced += add; }
        // Untouchable eats its own garrison
        if (this.fx(b, 'invuln')) {
          const n = Math.min(b.count, 6 * dt);
          b.count -= n; owner.stats.lost += n;
          if (b.count <= 0.01) b.fx.invuln = 0;
        }
        // Food Poisoning
        const plague = this.fxp(b, 'plague');
        if (plague) this.damageBuilding(b, plague.rate * dt, plague.by, 'spell', true);
        // kittens
        let rate = this.fx(b, 'popup') ? 0 : def.prod[b.level - 1] || 0;
        const stopped = this.fx(b, 'frozen');
        rate *= 1 + owner.bonusProd;
        if (this.rules.boom) rate *= 1.5;
        const kb = this.fxp(b, 'kboom'); if (kb) rate *= kb.boost;
        if (plague) rate *= plague.prod;
        for (const z of this.zones) if (z.k === 'spy' && z.o !== b.owner && dist(b, z.x, z.y) <= z.r) rate *= z.prod;
        if (!stopped && rate > 0 && b.count < cap) {
          const add = Math.min(rate * dt, cap - b.count);
          const dx = this.fxp(b, 'defect');
          if (dx && this.players[dx.by] && this.players[dx.by].alive) {
            // Defectors: new kittens walk over to the other side
            b.defAcc += add;
            if (b.defAcc >= 1) {
              const home = this.nearestOwnedByPath(dx.by, b);
              const n = Math.floor(b.defAcc);
              b.defAcc -= n;
              if (home) this.launch(dx.by, b, home, n);
            }
          } else {
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
        if (b.count < b.full && t - b.lastHit > STRAY_REGROW.delay) b.count = Math.min(b.full, b.count + strayRegrowRate(b.full) * dt);
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
      // towers (an unowned tower shoots at everyone's cats until somebody takes it)
      const bt = this.btype(b), tdef = BUILDINGS[bt];
      const stray = b.owner < 0;
      if (tdef.range && (!stray || bt === 'tower') && b.count >= 1 && !this.fx(b, 'frozen')) {
        b.fireCd -= dt;
        if (b.fireCd <= 0) {
          const lv = this.shootLevel(b);
          let range = tdef.range[Math.min(lv, tdef.range.length) - 1];
          const every = tdef.fireEvery[Math.min(lv, tdef.fireEvery.length) - 1];
          const soul = this.fxp(b, 'soul'); if (soul) range *= soul.range;
          let best = null, bd = range;
          for (const s of this.squads) {
            if (s.wait > 0 || (s.fx.stealth || 0) > t || s.owner === b.owner) continue;
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
      const hasB = this.buildings.some(b => b.owner === p.idx);
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
      players: this.players.map(p => ({ name: p.name, hero: p.heroId, fur: p.fur, hat: p.hat, ai: p.ai, skills: p.skills })),
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
      // [id, owner, type, level, cats, effects, cap, pop-up tower level, stray full]
      b: this.buildings.map(b => [b.id, b.owner, BTYPES.indexOf(b.type), b.level, r1(b.count), bfx(b), this.cap(b), this.fx(b, 'popup') ? this.shootLevel(b) : 0, b.owner < 0 ? r1(b.full) : 0]),
      s: this.squads.map(s => [s.id, s.owner, Math.round(s.count * 10) / 10, Math.round(s.x), Math.round(s.y), sfx(s), s.to]),
      p: this.players.map(p => [
        r1(p.catnip), Math.round(p.purr), r1(p.cds[0]), r1(p.cds[1]), r1(p.cds[2]),
        (p.scoutUntil > t ? PF.scouting : 0) | (p.silenced > t ? PF.silenced : 0) | (p.purrLock > t ? PF.purrLock : 0),
        p.alive ? 1 : 0, Math.round(this.armyOf(p.idx)), this.stars(p.idx), r1(p.gcd), r1(p.scoutCd), r1(p.cds[3]),
      ]),
      // [kind, x, y, r, owner, seconds left]
      z: this.zones.map(z => [ZONES.indexOf(z.k), Math.round(z.x), Math.round(z.y), Math.round(z.r), z.o, r1(z.until - t)]),
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
