// Whisker Wars - computer opponent. Runs on the authority, issues normal commands.
import { BUILDINGS, AI_LEVELS, BASE_SPEED, STRAY_REGROW, strayRegrowRate, SCOUT } from './data.js';

// buildings are compared by how far a cat has to WALK (around ponds, walls and mounds), not as the crow flies

const AREA_ENEMY = { meteor: 9, frost: 9, bellyflop: 7, mutiny: 12, zerog: 9, tractor: 10, laser: 9, vacuum: 10 };

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
  // Nobody can see how many cats are inside another player's buildings, the computer included (see SCOUT in
  // data.js). It remembers the last count it saw, adds the kittens a building could have made since, takes away
  // the squads it watches leave and adds the ones it watches arrive. Its Owl Scout shows everything again.
  initIntel() {
    this.seen = new Map();     // building id -> { c: cats, t: when, o: owner then }
    for (const b of this.g.buildings) this.seen.set(b.id, { c: b.count, t: this.g.time, o: b.owner });
    this.watch = new Map();    // squad id -> { to, count, owner } for squads on the field
  }
  visible(b) { return b.owner === this.i || b.owner < 0 || this.g.scouting(this.i); }
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
        st.c = Math.max(2, this.est(tb) - w.count * g.attack(this.i, null, true) / g.defense(tb)); st.t = t;
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
      if (s.owner !== b.owner) this.incoming.set(b.id, (this.incoming.get(b.id) || 0) + s.count * g.attack(s.owner, s, true));
      else this.reinf.set(b.id, (this.reinf.get(b.id) || 0) + s.count);
    }
    const threatened = [];
    for (const b of mine) {
      const inc = this.incoming.get(b.id) || 0;
      b._margin = (b.count + (this.reinf.get(b.id) || 0)) * g.defense(b) - inc;
      if (inc > 0 && b._margin < 3) threatened.push(b);
    }
    this.threatened = threatened;

    // now and then send the Owl Scout to see what the rivals really have
    const P = g.players[me];
    if (P.scoutCd <= 0 && P.catnip >= SCOUT.cost + 25 && g.time - (this.lastScout ?? -99) > 40 && Math.random() < 0.3 + this.L.spellUse * 0.5) {
      this.cmd({ k: 'scout' }); this.lastScout = g.time;
    }
    if (Math.random() < this.L.spellUse) this.trySpells(mine);
    this.defend(mine);
    if (Math.random() < this.L.upgrade) this.tryUpgrade(mine);
    if (Math.random() < 0.35 + this.L.aggression * 0.65) this.tryAttack(mine);
  }

  reserve(b) { return 2 + (1 - this.L.aggression) * 6 + (this.isFront(b) ? 3 : 0); }
  isFront(b) {
    const g = this.g;
    let dm = Infinity, de = Infinity;
    for (const o of g.buildings) {
      if (o === b) continue;
      const d = g.pathLen(o, b);
      if (o.owner === this.i) dm = Math.min(dm, d); else if (o.owner >= 0) de = Math.min(de, d);
    }
    return de < 380;
  }

  defend(mine) {
    const g = this.g;
    for (const b of this.threatened) {
      let need = (3 - b._margin) / g.defense(b) + 2;
      const helpers = mine.filter(h => h !== b && !this.threatened.includes(h) && h.count > 5 && !g.fx(h, 'stink'))
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
    // occasionally build a forge / garden in the back line when rich
    if (mine.length >= 4 && Math.random() < 0.25 * this.L.upgrade) {
      const hasForge = mine.some(b => b.type === 'forge');
      const hasGarden = mine.some(b => b.type === 'garden');
      const back = mine.filter(b => b.type === 'cottage' && b.level === 1 && !this.isFront(b) && b.count > 26);
      if (back.length && (!hasForge || !hasGarden)) this.cmd({ k: 'conv', b: back[0].id, to: !hasForge ? 'forge' : 'garden' });
    }
  }

  /** Roughly how many cats enemy towers (and unowned towers, which shoot everyone) will knock out of a squad walking this route. */
  towerLoss(from, to) {
    const g = this.g;
    const route = g.nav.fullPath(from.id, to.id);
    let shots = 0;
    for (const t of g.buildings) {
      const def = BUILDINGS[t.type];
      if (!def.range || (t.owner < 0 && t.type !== 'tower') || t.owner === this.i || this.est(t) < 1 || t === to) continue;
      const range = def.range[t.level - 1];
      let inRange = 0;
      for (let k = 1; k < route.length; k++) inRange += chordIn(t, range, route[k - 1], route[k]);
      shots += inRange / BASE_SPEED / def.fireEvery[t.level - 1];
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
    return base * (tg.owner >= 0 ? 1.3 : 1);
  }

  tryAttack(mine) {
    const g = this.g, me = this.i;
    const atk = g.attack(me, null, true);
    const aggr = this.L.aggression;
    const options = [];
    for (const tg of g.buildings) {
      if (tg.owner === me) continue;
      const srcs = mine
        .filter(b => !this.threatened.includes(b) && !g.fx(b, 'stink'))
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
        // cats already on the way (nearly) cover it: don't drip-feed tiny squads in after them. Trickles get eaten
        // one by one while the defender tops up, and on long roads that can go on for the whole match.
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

    // Shadow Step synergy
    const p = g.players[me];
    const ss = p.hero.spells.findIndex(s => s.id === 'shadowstep');
    if (ss >= 0 && p.cds[ss] <= 0 && p.catnip >= p.hero.spells[ss].cost && p.gcd <= 0 && pick.used[0].avail > 9) {
      this.cmd({ k: 'spell', slot: ss, b: pick.used[0].b.id });
    }

    let remaining = pick.need * 1.05;
    for (const s of pick.used) {
      if (remaining <= 0) break;
      const take = Math.min(s.avail, remaining);
      remaining -= take;
      this.cmd({ k: 'send', from: [s.b.id], to: pick.tg.id, pct: Math.min(1, take / s.b.count + 0.02) });
    }
    this.preferSource = -1;
  }

  // ---------- spells ----------
  trySpells(mine) {
    const g = this.g, me = this.i, p = g.players[me];
    if (p.gcd > 0) return false;
    const order = [0, 1, 2].sort((a, b) => p.hero.spells[b].cost - p.hero.spells[a].cost);
    if (this.saveFor == null || Math.random() < 0.1) this.saveFor = Math.random() < 0.55 ? order[0] : -1;
    for (const slot of order) {
      const sp = p.hero.spells[slot];
      if (p.cds[slot] > 0) continue;
      if (p.catnip < sp.cost) {
        if (slot === this.saveFor) return false; // saving up for the big one
        continue;
      }
      const tgt = this.spellTarget(sp, mine);
      if (tgt) {
        this.cmd({ k: 'spell', slot, ...tgt });
        if (slot === this.saveFor) this.saveFor = null;
        return true;
      }
    }
    return false;
  }

  bestCluster(owners, r, pred = 0) {
    const g = this.g;
    let best = null, bestN = 0;
    const list = g.squads.filter(s => owners(s.owner) && s.wait <= 0);
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

  spellTarget(sp, mine) {
    const g = this.g, me = this.i;
    const enemyB = g.buildings.filter(b => b.owner >= 0 && b.owner !== me);
    const notMine = g.buildings.filter(b => b.owner !== me);
    const isEnemy = o => o !== me;
    const maxBy = (arr, f) => arr.reduce((a, b) => (a == null || f(b) > f(a) ? b : a), null);

    if (AREA_ENEMY[sp.id] != null) {
      const c = this.bestCluster(isEnemy, sp.radius, sp.delay || 0);
      if (c && c.n >= AREA_ENEMY[sp.id]) return { x: c.x, y: c.y };
      return null;
    }
    switch (sp.id) {
      case 'smoke': case 'pepper': {
        const c = this.bestCluster(o => o === me, sp.radius);
        if (c && c.n >= 12) { const tg = g.byId.get(c.s.to); if (tg && tg.owner !== me) return { x: c.x, y: c.y }; }
        return null;
      }
      case 'shieldwall': case 'fortify': case 'firewall': case 'turret': {
        const b = maxBy(this.threatened, x => this.incoming.get(x.id) || 0);
        return b ? { b: b.id } : null;
      }
      case 'feast': case 'moonbeam': {
        const b = this.threatened[0] || (Math.random() < 0.5 ? maxBy(mine.filter(x => this.isFront(x)), x => -x.count) : null);
        return b ? { b: b.id } : null;
      }
      case 'jackpot': {
        const b = maxBy(mine, x => x.count);
        return b && b.count >= 22 ? { b: b.id } : null;
      }
      case 'teaparty': {
        const b = maxBy(mine.filter(x => x.type === 'cottage' && x.count < g.cap(x) * 0.7), x => x.level);
        return b ? { b: b.id } : null;
      }
      case 'decree': {
        const b = maxBy(mine.filter(x => x.level < BUILDINGS[x.type].maxLevel), x => (x.type === 'cottage' ? 10 : 0) + x.level);
        return b ? { b: b.id } : null;
      }
      case 'shadowstep': return null; // used together with attacks
      case 'shuriken': { const b = maxBy(enemyB, x => this.est(x)); return b && this.est(b) >= 18 ? { b: b.id } : null; }
      case 'cannon': { const b = maxBy(enemyB, x => this.est(x) + (BUILDINGS[x.type].range ? 10 : 0)); return b && this.est(b) >= 12 ? { b: b.id } : null; }
      case 'orbital': { const b = maxBy(enemyB, x => this.est(x)); return b && this.est(b) >= 26 ? { b: b.id } : null; }
      case 'curse': { const b = maxBy(enemyB.filter(x => BUILDINGS[x.type].prod[0] > 0), x => x.level + this.est(x) / 20); return b ? { b: b.id } : null; }
      case 'sardines': { const b = maxBy(enemyB, x => this.est(x)); return b && this.est(b) >= 20 ? { b: b.id } : null; }
      case 'hack': {
        const towers = enemyB.filter(x => BUILDINGS[x.type].range && this.est(x) >= 1);
        const b = maxBy(towers, x => g.squads.filter(s => s.owner !== me && Math.hypot(s.x - x.x, s.y - x.y) < 260).length + Math.random());
        return b ? { b: b.id } : null;
      }
      case 'polymorph': {
        const c = notMine.filter(x => ['tower', 'forge', 'garden'].includes(x.type) && !(x.owner >= 0 && g.fx(x, 'firewall')));
        const b = maxBy(c, x => (x.owner >= 0 ? 10 : 0) - Math.min(...mine.map(m => g.pathLen(m, x))) / 100);
        return b ? { b: b.id } : null;
      }
      case 'beckon': { const b = maxBy(notMine, x => this.est(x)); return b && this.est(b) >= 14 ? { b: b.id } : null; }
      case 'bribe': {
        const c = g.buildings.filter(x => x.owner < 0 && x.count <= sp.max && x.count >= 8);
        const b = maxBy(c, x => this.value(x) * x.count - Math.min(...mine.map(m => g.pathLen(m, x))) / 50);
        return b ? { b: b.id } : null;
      }
      case 'rally': case 'grog': {
        const n = g.squads.filter(s => s.owner === me && (g.byId.get(s.to) || {}).owner !== me).reduce((a, s) => a + s.count, 0);
        return n >= 16 ? {} : null;
      }
      case 'naptime': {
        const n = g.squads.filter(s => s.owner !== me).reduce((a, s) => a + s.count, 0);
        return n >= 16 ? {} : null;
      }
      case 'goldenlitter': return mine.length >= 4 ? {} : null;
      case 'eclipse': return enemyB.length >= 4 ? {} : null;
      case 'luckycoin': return {};
      case 'drain': return g.players.some(p => p.idx !== me && p.catnip >= 30) ? {} : null;
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
