// Alt Whisker Wars - computer opponent. Runs on the authority, issues normal commands.
import { BUILDINGS, AI_LEVELS, BASE_SPEED, STRAY_REGROW, strayRegrowRate } from './data.js';

// buildings are compared by how far a cat has to WALK (around ponds, walls and mounds), not as the crow flies

// area skills aimed at a clump of enemy squads: how many enemy cats make it worth it
const AREA_ENEMY = {
  firering: 12, uturn: 10, rewind: 12, sweettalk: 10, chickens: 12, frostring: 12, slowmo: 12, gohome: 12, tornado: 10,
  ufo: 8, gravity: 12, rain: 12, sandstorm: 14, mines: 10, icerain: 12, zapfence: 14,
};
// area skills that help my own attacking squads
const AREA_MINE = { zoomboots: 12, fury: 14, cloak: 12, vortex: 14, fog: 14, slugs: 12, pulse: 12, aura: 12, totem: 12, stones: 12, heads: 10 };
// "next cats you send from here" skills: cast on a rich building, then attack from it
const NEXT_SEND = ['ranks', 'flying', 'shortcut', 'toarms', 'bfg', 'barrier', 'wind', 'coldwave'];
// area skills that hit everyone: keep them off my own cats
const HITS_ALL = ['frostring', 'slowmo', 'gohome', 'icerain'];

export class AI {
  constructor(game, idx, level = 'normal') {
    this.g = game;
    this.i = idx;
    this.L = AI_LEVELS[level] || AI_LEVELS.normal;
    this.timer = 1.5 + Math.random();
    this.preferSource = -1;
    this.initIntel();
  }

  // ---------- what it knows about rival buildings ----------
  // Nobody can see how many cats are inside another player's buildings, the computer included. It remembers the last count it saw, adds the kittens a building could have made since, takes away
  // the squads it watches leave and adds the ones it watches arrive. Spy Eye and Food Poisoning (if its hero has them) show the truth.
  initIntel() {
    this.seen = new Map();     // building id -> { c: cats, t: when, o: owner then }
    for (const b of this.g.buildings) this.seen.set(b.id, { c: b.count, t: this.g.time, o: b.owner });
    this.watch = new Map();    // squad id -> { to, count, owner } for squads on the field
  }
  visible(b) { return this.g.canSee(this.i, b); }
  /** How many cats this AI thinks are in building b (the real number for its own buildings and strays). */
  est(b) {
    if (this.visible(b)) return b.count;
    const s = this.seen.get(b.id);
    if (!s) return b.count;
    const cap = this.g.cap(b), prod = BUILDINGS[b.type].prod[b.level - 1] || 0;
    return s.c >= cap ? s.c : Math.min(cap, s.c + prod * (this.g.time - s.t));
  }
  updateIntel() {
    const g = this.g, t = g.time;
    for (const b of g.buildings) {
      const s = this.seen.get(b.id);
      if (!s) { this.seen.set(b.id, { c: b.count, t, o: b.owner }); continue; }
      if (this.visible(b)) { s.c = b.count; s.t = t; s.o = b.owner; }
      else if (s.o !== b.owner) { s.c = 4; s.t = t; s.o = b.owner; }   // just changed hands: a few cats left over (a guess)
    }
    const here = new Set();
    for (const q of g.squads) {
      here.add(q.id);
      if (!this.watch.has(q.id)) {
        // a rival squad leaving one of its buildings takes cats out of it
        const fb = g.byId.get(q.from), sf = fb && this.seen.get(fb.id);
        if (sf && q.owner !== this.i && fb.owner === q.owner && !this.visible(fb)) { sf.c = Math.max(0, this.est(fb) - q.count); sf.t = t; }
      }
      this.watch.set(q.id, { to: q.to, count: q.count, owner: q.owner });
    }
    for (const [id, w] of this.watch) {
      if (here.has(id)) continue;
      this.watch.delete(id);
      const tb = g.byId.get(w.to), st = tb && this.seen.get(tb.id);
      if (!st || this.visible(tb) || tb.owner !== st.o) continue;
      if (w.owner === tb.owner) { st.c = this.est(tb) + w.count; st.t = t; }   // a rival reinforcing its own building
      else if (w.owner === this.i) {
        // my attack bounced off: it held, so what is left is what I guessed minus what I hit it with (at least a few)
        st.c = Math.max(2, this.est(tb) - w.count * g.attack(this.i, null) / g.defense(tb)); st.t = t;
      }
    }
  }

  update(dt) {
    if (this.g.over || !this.g.players[this.i].alive) return;
    this.updateIntel();
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.L.think * (0.75 + Math.random() * 0.5);
    try { this.think(); } catch (e) { console.error('AI error', e); }
  }

  cmd(c) { this.g.command(this.i, c); }
  blocked(b) { return this.g.fx(b, 'shackle') || this.g.fx(b, 'possess'); }

  think() {
    const g = this.g, me = this.i;
    const mine = g.buildings.filter(b => b.owner === me);
    if (!mine.length) return;
    if (Math.random() < this.L.mistakes * 0.5) return; // daydreaming kitten

    // Incoming pressure per building
    this.incoming = new Map();
    this.reinf = new Map();
    for (const s of g.squads) {
      const b = g.byId.get(s.to);
      if (!b) continue;
      if (s.owner !== b.owner) this.incoming.set(b.id, (this.incoming.get(b.id) || 0) + s.count * g.attack(s.owner, s));
      else this.reinf.set(b.id, (this.reinf.get(b.id) || 0) + s.count);
    }
    const threatened = [];
    for (const b of mine) {
      const inc = this.incoming.get(b.id) || 0;
      b._margin = (b.count + (this.reinf.get(b.id) || 0)) * g.defense(b) - inc;
      if (inc > 0 && b._margin < 3) threatened.push(b);
    }
    this.threatened = threatened;

    if (Math.random() < this.L.spellUse) this.trySpells(mine);
    this.defend(mine);
    if (Math.random() < this.L.upgrade) this.tryUpgrade(mine);
    // never attack into a rival with more Purr Power unless clearly stronger: their buildings defend much better
    if (Math.random() < 0.35 + this.L.aggression * 0.65) this.tryAttack(mine);
  }

  reserve(b) { return 2 + (1 - this.L.aggression) * 6 + (this.isFront(b) ? 3 : 0); }
  isFront(b) {
    const g = this.g;
    let de = Infinity;
    for (const o of g.buildings) {
      if (o === b) continue;
      if (o.owner >= 0 && o.owner !== this.i) de = Math.min(de, g.pathLen(o, b));
    }
    return de < 380;
  }

  defend(mine) {
    const g = this.g;
    for (const b of this.threatened) {
      let need = (3 - b._margin) / g.defense(b) + 2;
      const helpers = mine.filter(h => h !== b && !this.threatened.includes(h) && h.count > 5 && !this.blocked(h))
        .sort((a, c) => g.pathLen(a, b) - g.pathLen(c, b));
      for (const h of helpers) {
        if (need <= 0) break;
        const take = Math.min(h.count - 3, need);
        if (take < 2) continue;
        this.cmd({ k: 'send', from: [h.id], to: b.id, pct: Math.min(1, take / h.count + 0.02) });
        need -= take;
      }
    }
  }

  tryUpgrade(mine) {
    const g = this.g;
    const cand = mine.filter(b => b.type === 'cottage' && b.level < 5 && !this.threatened.includes(b) && !(this.incoming.get(b.id)))
      .sort((a, c) => a.level - c.level);
    for (const b of cand) {
      const cost = g.upgradeCost(b);
      if (cost != null && b.count >= cost + 4 + (this.isFront(b) ? 8 : 0)) { this.cmd({ k: 'up', b: b.id }); return; }
    }
    // occasionally build a forge / garden in the back line, or a tower up front, when rich
    if (mine.length >= 4 && Math.random() < 0.25 * this.L.upgrade) {
      const has = t => mine.some(b => b.type === t);
      const back = mine.filter(b => b.type === 'cottage' && b.level === 1 && !this.isFront(b) && b.count > 26);
      if (back.length && (!has('forge') || !has('garden'))) { this.cmd({ k: 'conv', b: back[0].id, to: !has('garden') ? 'garden' : 'forge' }); return; }
      const front = mine.filter(b => b.type === 'cottage' && b.level === 1 && this.isFront(b) && b.count > 30);
      if (front.length && mine.filter(b => b.type === 'tower').length < 2 && Math.random() < 0.4) this.cmd({ k: 'conv', b: front[0].id, to: 'tower' });
    }
  }

  /** Roughly how many cats enemy towers (and unowned towers, which shoot everyone) will knock out of a squad walking this route. */
  towerLoss(from, to) {
    const g = this.g;
    const route = g.nav.fullPath(from.id, to.id);
    let shots = 0;
    for (const t of g.buildings) {
      const bt = g.btype(t), def = BUILDINGS[bt];
      if (!def.range || (t.owner < 0 && bt !== 'tower') || t.owner === this.i || this.est(t) < 1 || t === to || g.fx(t, 'frozen')) continue;
      const lv = Math.min(g.shootLevel(t), def.range.length);
      const range = def.range[lv - 1];
      let inRange = 0;
      for (let k = 1; k < route.length; k++) inRange += chordIn(t, range, route[k - 1], route[k]);
      shots += inRange / BASE_SPEED / def.fireEvery[lv - 1];
    }
    return shots;
  }

  value(tg) {
    let base = tg.type === 'cottage' ? 2 + tg.level * 0.8 : tg.type === 'cattree' ? 8 : tg.type === 'tower' ? 3 : 3.1;
    if (tg.type === 'tower' && tg.owner < 0) {
      // an unowned tower shoots everyone: one sitting on my doorstep is worth clearing early
      const r = BUILDINGS.tower.range[tg.level - 1] + 120;
      for (const b of this.g.buildings) if (b.owner === this.i && Math.hypot(b.x - tg.x, b.y - tg.y) < r) base += 2;
    }
    // taking a rival building swings Purr Power both ways
    return base * (tg.owner >= 0 ? 1.4 : 1);
  }

  tryAttack(mine) {
    const g = this.g, me = this.i;
    const atk = g.attack(me, null);
    const aggr = this.L.aggression;
    const options = [];
    for (const tg of g.buildings) {
      if (tg.owner === me) continue;
      if (g.fx(tg, 'invuln') || g.fx(tg, 'cauldron') || (tg.owner >= 0 && g.fx(tg, 'bounce'))) continue;
      const srcs = mine
        .filter(b => !this.threatened.includes(b) && !this.blocked(b))
        .map(b => ({ b, d: g.pathLen(b, tg), avail: b.count - this.reserve(b) }))
        .filter(x => x.avail >= 2)
        .sort((a, c) => (a.b.id === this.preferSource ? -1 : 0) - (c.b.id === this.preferSource ? -1 : 0) || a.d - c.d);
      if (!srcs.length) continue;
      const def = g.defense(tg);
      let gathered = 0, maxD = 0;
      const used = [];
      for (const s of srcs) {
        used.push(s);
        gathered += s.avail;
        maxD = Math.max(maxD, s.d);
        const eta = maxD / BASE_SPEED;
        // owned buildings keep making kittens; strays that were hit grow back once the fighting stops
        const prod = tg.owner >= 0 ? (BUILDINGS[tg.type].prod[tg.level - 1] || 0) * eta
          : tg.count < tg.full ? Math.min(tg.full - tg.count, strayRegrowRate(tg.full) * Math.max(0, eta - Math.max(0, STRAY_REGROW.delay - (g.time - tg.lastHit)))) : 0;
        const theirReinf = this.reinf.get(tg.id) || 0;
        const already = [...g.squads].filter(q => q.owner === me && q.to === tg.id).reduce((a, q) => a + q.count, 0);
        let need = ((this.est(tg) + prod + theirReinf) * def / atk) * (1.12 + (1 - aggr) * 0.35) + 2 + this.towerLoss(s.b, tg) - already;
        if (Math.random() < this.L.mistakes) need *= 0.7;
        // cats already on the way (nearly) cover it: don't drip-feed tiny squads in after them
        if (already > 0 && need < 5) break;
        if (gathered >= need) {
          options.push({ tg, used: used.slice(), need: Math.max(need, 1), maxD });
          break;
        }
        if (used.length >= 3) break;
      }
    }
    if (!options.length) return;
    for (const o of options) o.score = this.value(o.tg) / (o.need + o.maxD * 0.045);
    options.sort((a, b) => b.score - a.score);
    const pick = Math.random() < this.L.mistakes ? options[Math.floor(Math.random() * options.length)] : options[0];

    let remaining = pick.need * 1.05;
    for (const s of pick.used) {
      if (remaining <= 0) break;
      const take = Math.min(s.avail, remaining);
      remaining -= take;
      this.cmd({ k: 'send', from: [s.b.id], to: pick.tg.id, pct: Math.min(1, take / s.b.count + 0.02) });
    }
    this.preferSource = -1;
  }

  // ---------- skills ----------
  trySpells(mine) {
    const g = this.g, me = this.i, p = g.players[me];
    if (p.gcd > 0 || p.silenced > g.time) return false;
    const n = p.slots.length;
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => b - a);   // big skills first
    if (this.saveFor == null || Math.random() < 0.1) this.saveFor = Math.random() < 0.5 ? order[0] : -1;
    for (const slot of order) {
      const sp = g.spell(me, slot);
      if (!sp || (p.cds[slot] > 0 && !sp.stolen)) continue;
      if (p.catnip < sp.cost) {
        if (slot === this.saveFor) return false; // saving up for the big one
        continue;
      }
      const tgt = this.spellTarget(sp, mine);
      if (tgt) {
        this.cmd({ k: 'spell', slot, ...tgt });
        if (slot === this.saveFor) this.saveFor = null;
        if (tgt.after) tgt.after();
        return true;
      }
    }
    return false;
  }

  bestCluster(owners, r, pred = 0, filter) {
    const g = this.g;
    let best = null, bestN = 0;
    const list = g.squads.filter(s => owners(s.owner) && s.wait <= 0 && (!filter || filter(s)));
    for (const c of list) {
      let n = 0;
      for (const s of list) if (Math.hypot(s.x - c.x, s.y - c.y) <= r * 0.85) n += s.count;
      if (n > bestN) { bestN = n; best = c; }
    }
    if (!best) return null;
    let x = best.x, y = best.y;
    if (pred > 0 && best.path && best.path[best.wp]) {
      const pt = best.path[best.wp];
      const d = Math.hypot(pt.x - x, pt.y - y) || 1;
      const mv = Math.min(d, g.squadSpeed(best) * pred);
      x += (pt.x - x) / d * mv; y += (pt.y - y) / d * mv;
    }
    return { x, y, n: bestN, s: best };
  }
  /** cats of a given side near a point */
  catsNear(x, y, r, owners) { return this.g.squads.filter(s => owners(s.owner) && Math.hypot(s.x - x, s.y - y) <= r).reduce((a, s) => a + s.count, 0); }

  spellTarget(sp, mine) {
    const g = this.g, me = this.i, P = g.players[me];
    const enemyB = g.buildings.filter(b => b.owner >= 0 && b.owner !== me);
    const notMine = g.buildings.filter(b => b.owner !== me);
    const isEnemy = o => o !== me, isMe = o => o === me;
    const maxBy = (arr, f) => arr.reduce((a, b) => (a == null || f(b) > f(a) ? b : a), null);
    const attacking = s => { const tg = g.byId.get(s.to); return tg && tg.owner !== me; };
    const atMe = s => { const tg = g.byId.get(s.to); return tg && tg.owner === me; };
    const r = sp.r || 120;

    if (AREA_ENEMY[sp.id] != null) {
      // the ones that hit everybody shouldn't land on my own cats
      const c = this.bestCluster(isEnemy, r, ['firering', 'icerain'].includes(sp.id) ? 0.7 : 0, ['uturn', 'gohome', 'slowmo', 'rewind', 'rain', 'zapfence'].includes(sp.id) ? atMe : null);
      if (!c || c.n < AREA_ENEMY[sp.id]) return null;
      if (HITS_ALL.includes(sp.id) && this.catsNear(c.x, c.y, r, isMe) > c.n * 0.3) return null;
      return { x: c.x, y: c.y };
    }
    if (AREA_MINE[sp.id] != null) {
      const c = this.bestCluster(isMe, r, 0, s => attacking(s) && !s.stash && !s.ball);
      if (!c || c.n < AREA_MINE[sp.id]) return null;
      if (['zoomboots', 'fury', 'vortex'].includes(sp.id) && this.catsNear(c.x, c.y, r, isEnemy) > c.n * 0.4) return null;
      return { x: c.x, y: c.y };
    }
    if (NEXT_SEND.includes(sp.id)) {
      const b = maxBy(mine.filter(x => !this.threatened.includes(x) && !this.blocked(x) && x.count >= 24 && !(sp.id === 'bfg' && x.type === 'cattree')), x => x.count);
      if (!b) return null;
      return { b: b.id, after: () => { this.preferSource = b.id; } };
    }
    const threat = () => maxBy(this.threatened, x => this.incoming.get(x.id) || 0);
    const incomingAll = () => [...this.incoming.values()].reduce((a, v) => a + v, 0);
    switch (sp.id) {
      // ---- my buildings under attack
      case 'stonepaws': case 'bounce': case 'untouchable': case 'haunt': case 'reap': case 'quicksand': {
        const b = threat();
        if (!b) return null;
        if (sp.id === 'untouchable' && b.count < 8) return null;
        if (sp.id === 'reap' && (this.incoming.get(b.id) || 0) < 15) return null;
        return { b: b.id };
      }
      case 'lifecycle': { const b = maxBy(this.threatened.filter(x => x.level >= 2), x => this.incoming.get(x.id) || 0); return b ? { b: b.id } : null; }
      case 'moths': {
        const b = maxBy(mine.filter(x => x.count >= 15), x => this.catsNear(x.x, x.y, 170, isEnemy));
        return b && this.catsNear(b.x, b.y, 170, isEnemy) >= 12 ? { b: b.id } : null;
      }
      case 'fortify': return this.threatened.length >= 2 || incomingAll() >= 30 ? {} : null;
      case 'spirited': {
        // their attack lands on their own richest building
        if (!this.threatened.length) return null;
        const b = maxBy(enemyB.filter(x => !g.fx(x, 'cauldron')), x => this.est(x));
        return b ? { b: b.id } : null;
      }
      case 'pods': {
        const b = this.threatened[0] || (Math.random() < 0.4 ? maxBy(mine.filter(x => this.isFront(x)), x => -x.count) : null);
        return b ? { b: b.id } : null;
      }
      case 'magnet': {
        // pull enemy squads into a strong building
        const b = maxBy(mine.filter(x => x.count >= 15), x => this.catsNear(x.x, x.y, sp.r, isEnemy) * g.defense(x));
        return b && this.catsNear(b.x, b.y, sp.r, isEnemy) >= 10 ? { b: b.id } : null;
      }
      // ---- my economy
      case 'builder': {
        const b = maxBy(mine.filter(x => x.type === 'cottage' && x.level < 5), x => -x.level);
        return b ? { b: b.id, after: () => this.cmd({ k: 'up', b: b.id }) } : null;
      }
      case 'prodshift': {
        if (mine.filter(x => x.type === 'cottage').length < 3) return null;
        const b = threat() || (Math.random() < 0.3 ? maxBy(mine.filter(x => this.isFront(x) && !this.blocked(x)), x => x.count) : null);
        return b ? { b: b.id, after: () => { this.preferSource = b.id; } } : null;
      }
      case 'goldpurr': case 'bloodpact': return this.threatened.length || g.squads.filter(s => s.owner === me && attacking(s)).reduce((a, s) => a + s.count, 0) >= 25 ? {} : null;
      case 'unity': {
        const need = this.threatened[0];
        if (!need) return null;
        const src = maxBy(mine.filter(x => x !== need && !this.threatened.includes(x) && !this.blocked(x) && x.count >= 15), x => x.count);
        return src ? { b: src.id, after: () => this.cmd({ k: 'send', from: [src.id], to: need.id, pct: 1 }) } : null;
      }
      case 'deposit': {
        // copy a big group of reinforcements walking between my own buildings
        const c = this.bestCluster(isMe, r, 0, atMe);
        return c && c.n >= 15 && g.squads.filter(s => s.owner === me && !s.stash).length >= 3 ? { x: c.x, y: c.y } : null;
      }
      case 'clone': {
        const c = this.bestCluster(isEnemy, r, 0, s => s.owner >= 0 && g.byId.get(s.from) && g.byId.get(s.from).owner === s.owner);
        return c && c.n >= 15 ? { x: c.x, y: c.y } : null;
      }
      case 'ghostarmy': case 'skeletons': {
        const n = sp.n * g.attack(me, null);
        const b = maxBy(enemyB.filter(x => !g.fx(x, 'cauldron') && !(sp.id === 'skeletons' && x.type === 'cottage' && x.level >= 5) && this.est(x) * g.defense(x) < n * 0.9), x => this.value(x));
        return b ? { b: b.id } : null;
      }
      case 'popup': {
        const b = maxBy([...this.threatened, ...mine.filter(x => this.isFront(x))].filter(x => ['cottage', 'forge', 'garden'].includes(x.type) && x.count >= 5), x => (this.incoming.get(x.id) || 0) + this.catsNear(x.x, x.y, 250, isEnemy));
        return b && this.catsNear(b.x, b.y, 260, isEnemy) >= 6 ? { b: b.id } : null;
      }
      case 'boomballs': case 'soulsnatch': {
        const towers = mine.filter(x => BUILDINGS[g.btype(x)].range);
        const b = maxBy(towers, x => this.catsNear(x.x, x.y, 260, isEnemy));
        return b && this.catsNear(b.x, b.y, 260, isEnemy) >= 8 ? { b: b.id } : null;
      }
      case 'kittenboom': {
        const b = maxBy(mine.filter(x => BUILDINGS[x.type].prod[x.level - 1] > 0 && x.count < g.cap(x) * 0.7), x => x.level);
        return b ? { b: b.id } : null;
      }
      case 'secondlife': {
        const lost = x => x.losses.filter(l => l.t > g.time - 5).reduce((a, l) => a + l.n, 0);
        const b = maxBy(mine, lost);
        return b && lost(b) >= 10 ? { b: b.id } : null;
      }
      case 'beam': {
        // beam a rich back building's cats to a building in trouble
        const need = this.threatened[0];
        if (!need) return null;
        const src = maxBy(mine.filter(x => x !== need && !this.threatened.includes(x) && !this.blocked(x) && x.count >= 15), x => x.count);
        if (!src) return null;
        return { b: src.id, after: () => this.cmd({ k: 'send', from: [src.id], to: need.id, pct: 1 }) };
      }
      // ---- enemy buildings
      case 'bomb': { const b = maxBy(enemyB, x => this.est(x) + this.catsNear(x.x, x.y, sp.r, isEnemy)); return b && this.est(b) + this.catsNear(b.x, b.y, sp.r, isEnemy) >= 20 ? { b: b.id } : null; }
      case 'shackles': { const b = maxBy(enemyB, x => this.est(x)); return b && this.est(b) >= 18 ? { b: b.id } : null; }
      case 'deepfreeze': {
        const b = maxBy(enemyB, x => (BUILDINGS[g.btype(x)].range ? this.catsNear(x.x, x.y, 260, isMe) : 0) + (x.type === 'forge' || x.type === 'garden' ? 12 : 0) + x.level * 2);
        return b ? { b: b.id } : null;
      }
      case 'poison': case 'defectors': {
        const b = maxBy(enemyB.filter(x => sp.id === 'poison' || BUILDINGS[x.type].prod[x.level - 1] > 0), x => x.level * 3 + this.est(x) / 5);
        return b ? { b: b.id } : null;
      }
      case 'crumble': { const b = maxBy(enemyB.filter(x => x.level >= 2), x => x.level + (x.type === 'tower' ? 1 : 0)); return b ? { b: b.id } : null; }
      case 'panic': { const b = maxBy(enemyB.filter(x => g.buildings.some(o => o !== x && o.owner === x.owner)), x => this.est(x)); return b && this.est(b) >= 15 ? { b: b.id } : null; }
      case 'swap': {
        const b = maxBy(enemyB, x => this.est(x) + x.level * 4);
        const avg = mine.reduce((a, x) => a + x.count, 0) / mine.length;
        return b && mine.length >= 2 && this.est(b) > avg + 12 ? { b: b.id } : null;
      }
      case 'echo': case 'paperwalls': {
        // the building my cats are about to hit
        const near = g.squads.filter(s => s.owner === me && attacking(s)).map(s => ({ s, tg: g.byId.get(s.to) }))
          .filter(o => o.tg && (sp.id === 'paperwalls' || o.tg.owner >= 0) && Math.hypot(o.s.x - o.tg.x, o.s.y - o.tg.y) < (sp.id === 'paperwalls' ? 110 : 260));
        const best = maxBy(near, o => o.s.count);
        return best && best.s.count >= 8 ? { b: best.tg.id } : null;
      }
      case 'hypno': case 'maneuver': case 'worm': {
        const b = maxBy(notMine.filter(x => !g.fx(x, 'cauldron')), x => this.est(x) * (x.owner >= 0 ? 1.3 : 1) + (sp.id === 'worm' ? this.catsNear(x.x, x.y, sp.r, isEnemy) : 0));
        if (!b || this.est(b) < (sp.id === 'worm' ? 20 : 14)) return null;
        if (sp.id !== 'hypno') return { b: b.id };
        // Hypnotize: give the spellbound cats their order straight away (march them home)
        return { b: b.id, after: () => { const home = g.nearestOwnedByPath(me, b); if (home) this.cmd({ k: 'send', from: [b.id], to: home.id, pct: 1 }); } };
      }
      case 'shrink': case 'seal': {
        const b = maxBy(enemyB.filter(x => !g.fx(x, 'cauldron')), x => this.est(x) + (this.isFront(x) ? 10 : 0));
        return b && this.est(b) >= 15 ? { b: b.id } : null;
      }
      case 'tempdown': { const b = maxBy(enemyB.filter(x => x.level >= 3 && !g.fx(x, 'cauldron')), x => x.level * 4 + this.est(x) / 5); return b ? { b: b.id } : null; }
      case 'possess': {
        // take it for a moment and throw away its upgrades
        const b = maxBy(enemyB.filter(x => x.level >= 2 && x.type !== 'cattree' && !g.fx(x, 'cauldron')), x => x.level * 5 + this.est(x) / 4);
        return b ? { b: b.id, after: () => this.cmd({ k: 'conv', b: b.id, to: b.type === 'cottage' ? 'garden' : 'cottage' }) } : null;
      }
      case 'cauldron': { const b = maxBy(enemyB, x => this.value(x) * x.level + this.est(x) / 5); return b && (b.level >= 3 || b.type === 'cattree' || this.est(b) >= 30) ? { b: b.id } : null; }
      case 'thief': {
        const rich = g.players.filter(q => q.alive && q.idx !== me && g.stars(q.idx) >= 1 && q.purr > P.purr);
        const v = maxBy(rich, q => q.purr);
        const b = v && g.buildings.find(x => x.owner === v.idx && !g.fx(x, 'cauldron'));
        return b ? { b: b.id } : null;
      }
      case 'evenout': {
        // a rival with one big stack and thin edges: spread it out
        for (const q of g.players) {
          if (!q.alive || q.idx === me) continue;
          const theirs = g.buildings.filter(x => x.owner === q.idx);
          if (theirs.length < 3) continue;
          const big = maxBy(theirs, x => this.est(x));
          const avg = theirs.reduce((a, x) => a + this.est(x), 0) / theirs.length;
          if (this.est(big) >= 30 && this.est(big) > avg * 2.2) return { b: big.id };
        }
        return null;
      }
      case 'glaciate': return g.players.some(q => q.alive && q.idx !== me && q.catnip >= 30 && q.catnip < 80) ? {} : null;
      case 'steal': {
        const last = g.players.filter(q => q.idx !== me && q.lastCast).sort((a, b) => b.lastCast.t - a.lastCast.t)[0];
        return last && P.catnip >= 60 ? {} : null;
      }
      // ---- whole-battle skills
      case 'luckystar': return g.stars(me) <= 3 && (this.threatened.length || g.squads.some(s => s.owner === me && attacking(s) && s.count >= 12)) ? {} : null;
      case 'sneak': return enemyB.length >= 2 && enemyB.length <= 8 ? {} : null;
      case 'evenpurr': {
        const others = g.players.filter(q => q.alive && q.idx !== me);
        const avg = others.reduce((a, q) => a + q.purr, P.purr) / (others.length + 1);
        return avg > P.purr + 600 ? {} : null;
      }
      case 'purrfreeze': return g.stars(me) >= 2 && g.players.every(q => !q.alive || q.idx === me || q.purr < P.purr) ? {} : null;
      case 'hush': return g.players.some(q => q.alive && q.idx !== me && q.catnip >= 55) && P.cds.some(c => c > 5) ? {} : null;
      case 'spyeye': {
        const b = maxBy(enemyB, x => enemyB.filter(o => Math.hypot(o.x - x.x, o.y - x.y) < sp.r).length);
        return b ? { x: b.x, y: b.y } : null;
      }
      case 'mindread': { const c = this.bestCluster(isEnemy, sp.r); return c && c.n >= 15 ? { x: c.x, y: c.y } : null; }
      case 'chain': {
        const s = maxBy(g.squads.filter(q => q.owner !== me && q.wait <= 0), q => q.count + g.squads.filter(o => o.owner === q.owner && Math.hypot(o.x - q.x, o.y - q.y) < 220).length * 3);
        // aim right on top of it so the chain can't start on my own cats
        return s && s.count >= 10 && this.catsNear(s.x, s.y, 120, isMe) === 0 ? { x: s.x, y: s.y } : null;
      }
    }
    return null;
  }
}

/** Length of segment a-b that lies within distance r of point c. */
function chordIn(c, r, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 < 1e-6) return 0;
  const fx = a.x - c.x, fy = a.y - c.y;
  const B = (fx * dx + fy * dy) / L2, C = (fx * fx + fy * fy - r * r) / L2;
  const disc = B * B - C;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, -B - sq), t1 = Math.min(1, -B + sq);
  return t1 > t0 ? (t1 - t0) * Math.sqrt(L2) : 0;
}
