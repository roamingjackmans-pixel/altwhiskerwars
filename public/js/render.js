// Whisker Wars renderer: draws the battlefield, cats, effects and drag/targeting overlays.
import { WORLD_W, WORLD_H, BUILDINGS, THEMES, TURRET, teamColor, findSpell } from '../shared/data.js';
import { SFX, bfxHas, targetOk } from '../shared/game.js';
import { getNav, transformObstacles } from '../shared/nav.js';
import * as art from './art.js';

const BIT = {}; SFX.forEach((n, i) => { BIT['s_' + n] = 1 << i; });
// squad effects: one bit mask; building effects: two (see bfxHas)
const has = (mask, name) => (mask & BIT[name]) !== 0;
const bh = (b, name) => bfxHas(b, name);
// building effects shown as a little orbiting icon: [effect, icon, phase]
const B_ICONS = [['shackle', '⛓️', 0], ['ranks', '🐾', 1], ['pods', '🚀', 2], ['kboom', '🍼', 3], ['paper', '📄', 4], ['fly', '🐝', 5], ['soul', '🏮', 6], ['defect', '🏃', 7],
  ['echo', '📣', 8], ['plague', '🤢', 9], ['shortcut', '🕳️', 10], ['beam', '🛸', 11], ['build', '🔨', 12], ['transfer', '🚚', 13], ['arms', '🗡️', 14], ['shrink', '🔍', 15],
  ['cannon', '🎯', 16], ['cycle', '♻️', 17], ['barrier', '🚧', 18], ['unity', '🧳', 19], ['wind', '🌬️', 20], ['wave', '🌊', 21], ['chill', '🥶', 22], ['haunt', '🕯️', 23],
  ['possess', '🎭', 24], ['seal', '🔏', 25], ['hypno', '🌀', 26]];
const FONT = (w, s) => `${w} ${s}px "Space Grotesk", "Trebuchet MS", system-ui, sans-serif`;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - t, 3);

// cat formation offsets (golden-angle spiral, squashed for perspective)
const FORM = [];
for (let k = 0; k < 18; k++) { const r = 6.2 * Math.sqrt(k), a = k * 2.39996; FORM.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62 }); }
const FORM_SORTED = FORM.map((o, i) => ({ ...o, i }));

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.pad = { top: 60, bottom: 84, left: 8, right: 8 };
    this.bg = null; this.bgScale = 0;
    this.theme = 'meadow'; this.seed = 1;
    this.parts = []; this.timed = []; this.decals = []; this.projs = [];
    this.hits = new Map();
    this.shake = 0; this.time = 0;
    this.players = [];
    this.fxLevel = 'high';
    this.me = 0;
    this.dim = 0;
    // view size: WORLD_W x WORLD_H normally, swapped when a portrait phone shows the field standing up
    this.VW = WORLD_W; this.VH = WORLD_H;
    this.fit = null;          // optional rect (view coords) to zoom onto instead of the whole field
    this.phone = false;       // bigger labels, units and touch-friendly overlays
    this.uiScale = 1; this.textScale = 1; this.unitScale = 1; this.artScale = 1;
    this.fitPts = null;       // buildings to keep in view (with room for their art and badges)
    this.resize();
  }

  // ---------- setup ----------
  setPadding(p) { this.pad = { ...this.pad, ...p }; this.resize(); }
  /**
   * HUD panels (screen rectangles) that must not cover any building. With these set, the field may slide under
   * the HUD bars wherever no building would be hidden, instead of keeping whole bands free.
   */
  setAvoid(rects) { this.avoid = rects && rects.length ? rects : null; this.resize(); }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr; this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    let L = this.layoutFor(this.pad);
    if (this.avoid && this.fitPts) {
      // try smaller top/bottom margins and keep the biggest zoom that leaves every building clear of the HUD
      const step = 8;
      for (let pt = 4; pt < this.pad.top; pt += step) for (let pb = 4; pb < this.pad.bottom; pb += step) {
        const c = this.layoutFor({ ...this.pad, top: pt, bottom: pb });
        if (c.scale > L.scale * 1.005 && !this.hidesBuilding(c)) L = c;
      }
    }
    this.fit = L.f;
    this.view = { scale: L.scale, ox: L.ox, oy: L.oy };
    Object.assign(this, this.sizesFor(L.scale));
    if (this.bgInfo && Math.abs(L.scale * dpr - this.bgScale) / this.bgScale > 0.15) this.buildBackground();
  }
  /** Where the field goes inside the window minus `pad`. */
  layoutFor(pad) {
    const aw = Math.max(50, this.w - pad.left - pad.right), ah = Math.max(50, this.h - pad.top - pad.bottom);
    let f = { x0: 0, y0: 0, x1: this.VW, y1: this.VH };
    let scale = Math.max(0.12, Math.min(aw / this.VW, ah / this.VH));
    if (this.fitPts && this.fitPts.length) {
      // Zoom onto the buildings. How much room each one needs (its art above, its count badge below) depends on
      // the zoom itself, because phones draw buildings and badges bigger when the field is small, so settle it
      // in a few rounds. Every building, badge included, ends up inside the free area.
      for (let round = 0; round < 5; round++) {
        f = this.fitBox(scale);
        scale = Math.max(0.12, Math.min(aw / (f.x1 - f.x0), ah / (f.y1 - f.y0)));
      }
    }
    const fw = f.x1 - f.x0, fh = f.y1 - f.y0;
    return { f, scale, ox: pad.left + (aw - fw * scale) / 2 - f.x0 * scale, oy: pad.top + (ah - fh * scale) / 2 - f.y0 * scale };
  }
  /** Would any building (art, ring or count badge) end up under a HUD panel with this layout? */
  hidesBuilding(L) {
    const { uiScale: k, artScale: a } = this.sizesFor(L.scale), m = 3;
    for (const p of this.fitPts) {
      const R = p.R * a, side = Math.max(R * 1.25, 21 * k) + 8, top = R * (p.tall ? 2.35 : 1.95) + 6, bottom = R * 0.62 + 22 * k + 6;
      const x0 = L.ox + (p.x - side) * L.scale, x1 = L.ox + (p.x + side) * L.scale;
      const y0 = L.oy + (p.y - top) * L.scale, y1 = L.oy + (p.y + bottom) * L.scale;
      for (const r of this.avoid) if (x0 < r.right + m && x1 > r.left - m && y0 < r.bottom + m && y1 > r.top - m) return true;
    }
    return false;
  }
  /** Phones keep numbers readable (~13px) and buildings big enough to tap however small the field gets. */
  sizesFor(scale) {
    if (!this.phone) return { uiScale: 1, textScale: 1, unitScale: 1, artScale: 1 };
    const uiScale = Math.max(1, Math.min(2.6, 13 / (15 * scale)));
    return { uiScale, textScale: 1 + (uiScale - 1) * 0.7, unitScale: Math.max(1, Math.min(1.6, 0.62 / scale)), artScale: Math.max(1, Math.min(1.45, 0.58 / scale)) };
  }
  /** The part of the field to show at this zoom: every building with its art, selection ring and count badge. */
  fitBox(scale) {
    const { uiScale: k, artScale: a } = this.sizesFor(scale);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.fitPts) {
      const R = p.R * a;
      const side = Math.max(R * 1.25, 21 * k) + 8;            // art / selection ring, or the badge if wider
      const top = R * (p.tall ? 2.35 : 1.95) + 6;              // roof, flag, level pips
      const bottom = R * 0.62 + 22 * k + 6;                    // count badge under the building
      x0 = Math.min(x0, p.x - side); x1 = Math.max(x1, p.x + side);
      y0 = Math.min(y0, p.y - top); y1 = Math.max(y1, p.y + bottom);
    }
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.VW, x1), y1: Math.min(this.VH, y1) };
  }
  /**
   * view: { w, h, fwd(x, y) -> {x, y}, fit } maps world positions to what this player sees
   * (flipped for player 2, stood up in portrait). Defaults to the plain world.
   */
  setMatch(info, me = 0, view = null) {
    this.info = info;
    this.me = me;
    this.theme = info.map.theme || 'meadow';
    this.seed = info.map.seed || 1;
    this.players = info.players;
    // the same walking routes the simulation uses, for drag arrows and the trails painted on the ground
    try { this.nav = getNav({ buildings: info.buildings, obstacles: info.map.obstacles || [], rot3: info.map.rot3 }); } catch (e) { console.error('nav', e); this.nav = null; }
    this.setView(view);
  }
  setView(view) {
    const fwd = view ? view.fwd : (x, y) => ({ x, y });
    this.fwd = fwd;
    this.routeCache = new Map();
    this.VW = view ? view.w : WORLD_W; this.VH = view ? view.h : WORLD_H;
    this.bpos = new Map(this.info.buildings.map(b => { const p = fwd(b.x, b.y); return [b.id, { ...b, x: p.x, y: p.y }]; }));
    const pts = [...this.bpos.values()];
    this.bgInfo = pts.map(b => ({ x: b.x, y: b.y, radius: 44 }));
    this.terrain = { shapes: transformObstacles(this.info.map.obstacles || [], fwd), trails: this.trailRoutes() };
    // zoom onto the buildings (sized for their biggest upgrade, so the view doesn't need to change mid-battle)
    this.fitPts = view && view.fit && pts.length ? pts.map(b => ({ x: b.x, y: b.y, R: b.r >= 50 ? b.r : Math.max(b.r || 40, 42), tall: (b.r || 0) >= 50 })) : null;
    this.parts.length = 0; this.timed.length = 0; this.decals.length = 0; this.projs.length = 0; this.hits.clear();
    this.bgScale = 0;
    this.resize();
    this.buildBackground();
  }
  buildBackground() {
    const s = Math.min(this.view.scale * this.dpr, 2.2);
    try { this.bg = art.renderBackground(this.theme, this.seed, this.bgInfo || [], s, this.VW, this.VH, this.terrain); }
    catch (e) { console.error('bg', e); this.bg = null; }
    this.bgScale = s;
  }
  /** Walking route between two buildings in view coordinates (start and end included). */
  routeView(fromId, toId) {
    if (!this.nav) return null;
    const key = fromId + ':' + toId;
    let r = this.routeCache.get(key);
    if (!r) {
      const w = this.nav.fullPath(fromId, toId);
      if (!w || w.length < 2) return null;
      r = w.map(p => this.fwd(p.x, p.y));
      this.routeCache.set(key, r);
    }
    return r;
  }
  /** Trails on the ground: each building to its two nearest neighbours (by walking distance), along the real route. */
  trailRoutes() {
    if (!this.nav) return null;
    const ids = this.info.buildings.map(b => b.id), seen = new Set(), out = [];
    for (const a of ids) {
      const near = ids.filter(b => b !== a).map(b => [b, this.nav.len(a, b)]).sort((p, q) => p[1] - q[1]).slice(0, 2);
      for (const [b, d] of near) {
        const k = Math.min(a, b) + ':' + Math.max(a, b);
        if (seen.has(k) || d > 640) continue;
        seen.add(k);
        out.push(this.nav.fullPath(a, b).map(p => this.fwd(p.x, p.y)));
      }
    }
    return out;
  }
  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale }; }
  toScreen(wx, wy) { return { x: wx * this.view.scale + this.view.ox, y: wy * this.view.scale + this.view.oy }; }

  // ---------- frame ----------
  draw(V, ui, dt) {
    this.time += dt;
    const t = this.time;
    const ctx = this.ctx, d = this.dpr, { scale, ox, oy } = this.view;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const th = THEMES[this.theme] || THEMES.meadow;
    ctx.fillStyle = shade(th.ground2, -0.35);
    ctx.fillRect(0, 0, this.w, this.h);
    // extend the battlefield art softly past the playable area so there are no empty bars
    const VW = this.VW, VH = this.VH;
    if (this.bg && (ox > 2 || oy > 2 || ox + VW * scale < this.w - 2 || oy + VH * scale < this.h - 2)) {
      const k = Math.max(this.w / (VW * scale), this.h / (VH * scale)) * 1.04;
      const bw = VW * scale * k, bh = VH * scale * k;
      ctx.drawImage(this.bg, this.w / 2 - bw / 2, this.h / 2 - bh / 2, bw, bh);
      ctx.fillStyle = 'rgba(25,15,40,0.42)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28;
      ctx.fillStyle = th.ground;
      ctx.fillRect(ox, oy, VW * scale, VH * scale);
      ctx.restore();
    }

    let sx = 0, sy = 0;
    if (this.shake > 0.1 && this.fxLevel !== 'low') { sx = rand(-1, 1) * this.shake; sy = rand(-1, 1) * this.shake; }
    this.shake *= Math.pow(0.02, dt);
    const wt = () => ctx.setTransform(d * scale, 0, 0, d * scale, d * (ox + sx), d * (oy + sy));
    wt();
    if (this.bg) ctx.drawImage(this.bg, 0, 0, VW, VH);
    else { ctx.fillStyle = th.ground; ctx.fillRect(0, 0, VW, VH); }
    if (!V) return;

    this.drawDecals(ctx, dt);
    this.drawZones(ctx, V, t);
    if (ui) this.drawGroundUI(ctx, V, ui, t);

    // y-sorted drawables
    const list = [];
    for (const b of V.buildings) list.push({ y: b.y, b });
    for (const s of V.squads) list.push({ y: s.y, s });
    list.sort((a, b) => a.y - b.y);
    // shadows first for squads
    for (const it of list) if (it.s && !has(it.s.fx, 's_wait')) this.drawSquadShadow(ctx, it.s);
    for (const it of list) {
      if (it.b) this.drawBuilding(ctx, it.b, V, t, ui);
      else this.drawSquad(ctx, it.s, V, t);
    }
    this.drawProjectiles(ctx, V, dt);
    this.updateParticles(ctx, dt);
    this.drawTimed(ctx, V, dt, t);
    this.drawZoneTops(ctx, V, t);
    if (this.fxLevel !== 'low') { try { art.setArtSize(VW, VH); art.drawAmbient(ctx, this.theme, t); } catch { /* optional */ } }
    for (const b of V.buildings) this.drawBadge(ctx, b);
    for (const s of V.squads) if (!has(s.fx, 's_wait')) this.drawSquadBadge(ctx, s);
    if (ui) this.drawOverlayUI(ctx, V, ui, t);

    // eclipse / screen tints
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const me = V.players[this.me];
    if (me && (me.buffs & 4)) { this.dim = Math.min(1, this.dim + dt * 2); } else this.dim = Math.max(0, this.dim - dt * 1.5);
    if (me && me.glacier) this.frost = Math.min(1, (this.frost || 0) + dt * 2.5); else this.frost = Math.max(0, (this.frost || 0) - dt * 1.5);
    if (this.frost > 0) this.frostFx(ctx, this.frost, t);
    if (me && me.golden) {
      const g2 = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      g2.addColorStop(0, 'rgba(255,210,60,0)'); g2.addColorStop(1, `rgba(255,200,40,${0.28 + 0.08 * Math.sin(t * 5)})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.dim > 0) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, 50, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
      g.addColorStop(0, `rgba(20,10,40,${0.25 * this.dim})`); g.addColorStop(1, `rgba(5,0,15,${0.7 * this.dim})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  // ---------- buildings ----------
  drawBuilding(ctx, b, V, t, ui) {
    const hit = this.hits.get(b.id) || 0;
    if (hit > 0) this.hits.set(b.id, Math.max(0, hit - 0.05));
    const sel = ui && (ui.sources?.includes(b.id) || ui.selected === b.id);
    const hover = ui && (ui.hover === b.id || ui.target === b.id);
    const rad = b.radius;
    // under-effects
    if (bh(b, 'beam') || bh(b, 'shortcut') || bh(b, 'unity')) this.portalFx(ctx, b.x, b.y + rad * 0.15, rad * 1.05, t);
    if (bh(b, 'stone')) this.fortifyFx(ctx, b, t);
    if (bh(b, 'hypno')) this.hypnoFx(ctx, b, t);
    try {
      art.drawBuilding(ctx, { x: b.x, y: b.y, type: b.tlv ? 'tower' : b.type, level: b.tlv || b.level, owner: b.owner, radius: rad, flags: b.fx, hover, selected: sel, hit }, t);
    } catch (e) {
      ctx.fillStyle = teamColor(b.owner).main; ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, TAU); ctx.fill();
    }
    // status overlays
    if (bh(b, 'invuln')) this.bubble(ctx, b.x, b.y - rad * 0.55, rad * 1.45, 'rgba(255,215,90,', t);
    if (bh(b, 'bounce')) this.bubble(ctx, b.x, b.y - rad * 0.55, rad * 1.5, 'rgba(255,150,210,', t);
    if (bh(b, 'plague')) this.stinkFx(ctx, b, t);
    if (bh(b, 'echo') || bh(b, 'defect') || bh(b, 'possess') || bh(b, 'seal') || bh(b, 'shrink')) this.curseFx(ctx, b, t);
    if (bh(b, 'boom') || bh(b, 'arms') || bh(b, 'cannon')) this.flameRing(ctx, b, t);
    if (bh(b, 'frozen') || bh(b, 'chill')) this.iconOrbit(ctx, b, t, '❄️', 3);
    if (bh(b, 'haunt')) this.iconOrbit(ctx, b, t * 0.7, '👻', 3);
    if (bh(b, 'cauldron')) this.cauldronFx(ctx, b, t);
    for (const [name, ch, n] of B_ICONS) if (bh(b, name)) this.iconOrbit(ctx, b, t + n, ch, 1);
    if (b.tlv) this.iconOrbit(ctx, b, t, '🗼', 1);
  }

  drawBadge(ctx, b) {
    const c = teamColor(b.owner);
    // (another player's cats are hidden: count -1, shown as "?" unless a spy skill shows it)
    const hidden = b.count < 0;
    const n = Math.floor(b.count);
    const k = this.uiScale;
    const y = b.y + b.radius * 0.62 + 10 * k;
    const txt = hidden ? '?' : String(n);
    ctx.font = FONT(700, 15);
    const w = Math.max(30, ctx.measureText(txt).width + 16);
    const full = !hidden && b.owner >= 0 && b.count >= b.cap - 0.01;
    ctx.save();
    if (k !== 1) { ctx.translate(b.x, y); ctx.scale(k, k); ctx.translate(-b.x, -y); }
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    rr(ctx, b.x - w / 2, y - 11, w, 22, 11);
    ctx.fillStyle = b.owner >= 0 ? c.dark : '#7d756b';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(ctx, b.x - w / 2 + 2, y - 9, w - 4, 18, 9);
    ctx.fillStyle = b.owner >= 0 ? c.main : '#a89f94';
    ctx.fill();
    if (full) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeText(txt, b.x, y + 1);
    ctx.fillText(txt, b.x, y + 1);
    ctx.restore();
  }

  // ---------- squads ----------
  visibleCount(n) { return n <= 8 ? n : Math.min(this.fxLevel === 'low' ? 10 : 18, 8 + Math.floor((n - 8) / 3)); }
  drawSquadShadow(ctx, s) {
    const n = Math.max(1, Math.round(s.count));
    const r = (6 + Math.sqrt(this.visibleCount(n)) * 5.5) * this.unitScale;
    const st = has(s.fx, 's_stealth');
    ctx.fillStyle = `rgba(0,0,0,${st ? 0.05 : 0.16})`;
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, r, r * 0.45, 0, 0, TAU); ctx.fill();
  }
  drawSquad(ctx, s, V, t) {
    if (has(s.fx, 's_wait')) return;
    const p = this.players[s.owner] || {};
    const n = Math.max(1, Math.round(s.count));
    const vis = this.visibleCount(n);
    const frozen = has(s.fx, 's_frozen'), asleep = has(s.fx, 's_asleep'), stun = has(s.fx, 's_stun');
    const lift = has(s.fx, 's_lift');
    const moving = !(frozen || asleep || stun || lift);
    // balls, boulders and cannonballs: no cats to see, just the thing they turned into
    if (has(s.fx, 's_ball') || has(s.fx, 's_rock') || has(s.fx, 's_cannon')) { this.drawRoller(ctx, s, t); return; }
    const left = has(s.fx, 's_left');
    const stealth = has(s.fx, 's_stealth');
    const slow = has(s.fx, 's_slow');
    const owner = V.players[s.owner];
    ctx.save();
    const us = this.unitScale;
    if (us !== 1) { ctx.translate(s.x, s.y); ctx.scale(us, us); ctx.translate(-s.x, -s.y); }
    if (stealth) ctx.globalAlpha = s.owner === this.me ? 0.45 : 0.1;
    if (has(s.fx, 's_ghost')) ctx.globalAlpha = 0.55;
    // Zero-G: floating up in the air
    if (lift) ctx.translate(0, -26 - Math.sin(t * 3 + s.id) * 5);
    if (has(s.fx, 's_shrunk')) { ctx.translate(s.x, s.y); ctx.scale(0.72, 0.72); ctx.translate(-s.x, -s.y); }
    const order = FORM_SORTED.slice(0, vis).sort((a, b) => a.y - b.y);
    for (const o of order) {
      const ph = s.id * 7.3 + o.i * 1.7;
      const frame = moving ? Math.floor(t * 10 + ph) & 3 : 0;
      let bob = moving ? Math.abs(Math.sin(t * 11 + ph)) * 1.8 : 0;
      if (slow) bob += 4 + Math.sin(t * 2 + ph) * 3;
      let spr;
      try { spr = art.getCatSprite(p.fur || 'ginger', p.hat || 'none', s.owner, frame); } catch { spr = null; }
      const x = s.x + o.x, y = s.y + o.y - bob;
      if (spr) {
        if (left) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(spr.canvas, -spr.ax, y - spr.ay, spr.w, spr.h); ctx.restore(); }
        else ctx.drawImage(spr.canvas, x - spr.ax, y - spr.ay, spr.w, spr.h);
      } else { ctx.fillStyle = teamColor(s.owner).main; ctx.beginPath(); ctx.arc(x, y - 8, 6, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    const r = 8 + Math.sqrt(vis) * 5.5;
    if (frozen) {
      ctx.save();
      ctx.fillStyle = 'rgba(170,225,255,0.45)'; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
      rr(ctx, s.x - r, s.y - r - 12, r * 2, r * 1.6 + 8, 6); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (asleep) {
      ctx.font = FONT(700, 12); ctx.fillStyle = '#e8ecff'; ctx.textAlign = 'center';
      for (let k = 0; k < 3; k++) { const ph = (t * 0.8 + k / 3) % 1; ctx.globalAlpha = 1 - ph; ctx.fillText('z', s.x + 6 + ph * 12, s.y - r - 6 - ph * 18); }
      ctx.globalAlpha = 1;
    }
    if (stun) {
      ctx.font = FONT(700, 10);
      for (let k = 0; k < 3; k++) { const a = t * 6 + k * TAU / 3; ctx.fillText('⭐', s.x + Math.cos(a) * 12, s.y - r - 8 + Math.sin(a) * 4); }
    }
    if (has(s.fx, 's_boost') || has(s.fx, 's_rage')) {
      if (this.fxLevel !== 'low' && Math.random() < 0.35) this.spawn({ x: s.x + rand(-r, r) * 0.6, y: s.y + rand(-4, 2), vx: left ? 30 : -30, vy: -10, life: 0.35, size: 3, color: has(s.fx, 's_rage') ? '#ff4a2f' : '#ffd84d', kind: 'dot' });
    }
    if (has(s.fx, 's_plague') && this.fxLevel !== 'low' && Math.random() < 0.12) this.spawn({ x: s.x + rand(-r, r) * 0.5, y: s.y - 12, vx: 0, vy: -20, life: 0.7, size: 4, color: '#8fdc4a', kind: 'dot' });
    if (has(s.fx, 's_chicken')) { ctx.font = FONT(400, 18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🐔', s.x + Math.sin(t * 6 + s.id) * 6, s.y - r - 10); }
    if (has(s.fx, 's_fly')) { ctx.font = FONT(400, 16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🐝', s.x - 10, s.y - r - 16 + Math.sin(t * 9 + s.id) * 3); ctx.fillText('🐝', s.x + 12, s.y - r - 10 + Math.cos(t * 8 + s.id) * 3); }
    // little badges for the other skill effects
    const tag = (ch, dx, dy = 0) => { ctx.font = FONT(400, 14); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, s.x + dx, s.y - r - 12 + dy); };
    if (has(s.fx, 's_slug')) { tag('🐛', 12, Math.sin(t * 4 + s.id) * 2); if (this.fxLevel !== 'low' && Math.random() < 0.15) this.spawn({ x: s.x + rand(-r, r) * 0.6, y: s.y + 2, vx: 0, vy: 0, life: 0.9, size: 3, color: 'rgba(140,220,90,0.8)', kind: 'dot' }); }
    if (has(s.fx, 's_arms')) tag('🗡️', -12);
    if (has(s.fx, 's_bones')) tag('💀', 10);
    if (has(s.fx, 's_ghost')) tag('👻', 12, Math.sin(t * 3 + s.id) * 3);
    if (has(s.fx, 's_stash') && s.owner === this.me) tag('📦', 0, -4);
    if (lift) tag('🪐', 0, -34);
    if (has(s.fx, 's_aura')) {
      ctx.save();
      ctx.strokeStyle = `rgba(120,240,255,${0.55 + 0.35 * Math.sin(t * 10 + s.id)})`; ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(120,240,255,0.12)';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - 8, r + 6, (r + 6) * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // high Purr Power: golden stars twinkle off the whole army
    if (owner && owner.stars >= 3 && this.fxLevel !== 'low' && Math.random() < 0.035 * (owner.stars - 2)) this.spawn({ x: s.x + rand(-r, r) * 0.7, y: s.y - 10 - rand(0, 12), vx: rand(-8, 8), vy: -28, life: 0.7, size: 3.5 + owner.stars * 0.4, color: owner.stars >= 5 ? '#ffe066' : '#ffd23d', kind: 'star' });
  }
  /** Bouncy Heads (balls), Rolling Boulders (rocks) and Kitty Cannon (cannonballs) */
  drawRoller(ctx, s, t) {
    const c = teamColor(s.owner);
    const n = Math.max(1, Math.round(s.count));
    const R = (9 + Math.sqrt(n) * 1.6) * this.unitScale;
    const left = has(s.fx, 's_left');
    const spin = t * (left ? -9 : 9) + s.id;
    const hop = has(s.fx, 's_ball') ? Math.abs(Math.sin(t * 8 + s.id)) * 14 : 0;
    const y = s.y - R - hop;
    ctx.save();
    ctx.translate(s.x, y); ctx.rotate(spin);
    if (has(s.fx, 's_cannon')) {
      ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b6b78'; ctx.beginPath(); ctx.arc(-R * 0.3, -R * 0.3, R * 0.35, 0, TAU); ctx.fill();
      ctx.rotate(-spin);
      ctx.fillStyle = c.main; ctx.beginPath(); ctx.arc(0, -R * 0.15, R * 0.42, 0, TAU); ctx.fill();
      if (this.fxLevel !== 'low' && Math.random() < 0.5) this.spawn({ x: s.x + (left ? R : -R), y, vx: left ? 40 : -40, vy: -10, life: 0.5, size: 6, color: 'rgba(120,120,130,0.6)', kind: 'puff' });
    } else if (has(s.fx, 's_rock')) {
      ctx.fillStyle = '#8d8478'; ctx.strokeStyle = '#4f483f'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU, rr2 = R * (0.86 + ((k * 37) % 7) / 40); ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.main; ctx.fillRect(-R * 0.5, -R * 0.12, R, R * 0.24);
    } else {
      ctx.fillStyle = c.main; ctx.strokeStyle = c.dark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, R * 0.22, 0, TAU); ctx.fill(); }
      // ears
      ctx.fillStyle = c.dark;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * R * 0.35, -R * 0.85); ctx.lineTo(sx * R * 0.75, -R * 1.25); ctx.lineTo(sx * R * 0.85, -R * 0.55); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, R, R * 0.4, 0, 0, TAU); ctx.fill();
  }
  drawSquadBadge(ctx, s) {
    const n = Math.max(1, Math.round(s.count));
    if (has(s.fx, 's_stealth') && s.owner !== this.me) return;
    const c = teamColor(s.owner);
    const vis = this.visibleCount(n);
    const k = this.uiScale;
    const y = s.y - (26 + Math.sqrt(vis) * 4.2) * this.unitScale - (k - 1) * 4;
    const txt = String(n);
    ctx.save();
    if (k !== 1) { ctx.translate(s.x, y); ctx.scale(k * 0.9, k * 0.9); ctx.translate(-s.x, -y); }
    ctx.font = FONT(700, 11);
    const w = Math.max(20, ctx.measureText(txt).width + 10);
    rr(ctx, s.x - w / 2, y - 8, w, 16, 8);
    ctx.fillStyle = c.dark; ctx.fill();
    rr(ctx, s.x - w / 2 + 1.5, y - 6.5, w - 3, 13, 6.5);
    ctx.fillStyle = c.main; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, s.x, y + 0.5);
    ctx.restore();
  }

  // ---------- ground & overlay UI ----------
  drawGroundUI(ctx, V, ui, t) {
    const byId = V.byId;
    // tower range for hovered/selected tower
    const show = ui.selected ?? ui.hover;
    const hb = show != null ? byId.get(show) : null;
    if (hb && (BUILDINGS[hb.type].range || hb.tlv)) {
      const def = BUILDINGS[hb.tlv ? 'tower' : hb.type];
      const range = def.range[Math.min(hb.tlv || hb.level, def.range.length) - 1];
      ctx.save();
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = teamColor(hb.owner).main; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(hb.x, hb.y, range, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.07; ctx.fillStyle = teamColor(hb.owner).main; ctx.fill();
      ctx.restore();
    }
    // selection rings
    const ring = (b, col, w, dash) => {
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = w;
      if (dash) { ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 30; }
      ctx.beginPath(); ctx.ellipse(b.x, b.y + b.radius * 0.25, b.radius * 1.15, b.radius * 0.62, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    };
    const myc = teamColor(this.me);
    for (const id of ui.sources || []) { const b = byId.get(id); if (b) ring(b, myc.light, 4, true); }
    if (ui.selected != null) { const b = byId.get(ui.selected); if (b) ring(b, '#fff', 3.5, true); }
    if (ui.target != null) {
      const b = byId.get(ui.target);
      if (b) ring(b, b.owner === this.me ? '#7dffb0' : '#ff8a8a', 4.5, false);
    } else if (ui.hover != null && !ui.sources?.length) {
      const b = byId.get(ui.hover);
      if (b) ring(b, 'rgba(255,255,255,0.6)', 2.5, false);
    }
  }
  drawOverlayUI(ctx, V, ui, t) {
    const byId = V.byId;
    // drag arrows
    if (ui.sources && ui.sources.length && ui.point) {
      const tb = ui.target != null ? byId.get(ui.target) : null;
      const tx = tb ? tb.x : ui.point.x, ty = tb ? tb.y : ui.point.y;
      const col = teamColor(this.me);
      for (const id of ui.sources) {
        const b = byId.get(id);
        if (!b || b.id === ui.target) continue;
        // locked onto a target: show the road the cats will actually walk
        const route = tb ? this.routeView(b.id, tb.id) : null;
        if (route && route.length > 2) this.routeArrow(ctx, route, b, tb, col, t);
        else this.arrow(ctx, b.x, b.y - b.radius * 0.3, tx, ty - (tb ? tb.radius * 0.3 : 0), col, t, !!tb);
      }
      if (ui.prediction && tb) {
        const p = ui.prediction;
        const k = this.uiScale;
        ctx.font = FONT(700, 16);
        const w = ctx.measureText(p.text).width + 20;
        // on touch screens keep the pill clear of the fingertip
        let y = tb.y - tb.radius * 1.9 - 18 * k;
        if (this.phone) y = Math.min(y, tb.y - 78 / this.view.scale);
        const top = (this.fit ? this.fit.y0 : 0) + 16 * k;
        let x = tb.x;
        if (y < top) y = tb.y + tb.radius + 40 * k;   // no room above: show it below instead
        ctx.save();
        if (k !== 1) { ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-x, -y); }
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6;
        rr(ctx, x - w / 2, y - 14, w, 28, 14);
        ctx.fillStyle = p.good ? 'rgba(40,170,95,0.95)' : p.neutral ? 'rgba(70,120,200,0.95)' : 'rgba(210,60,70,0.95)';
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.text, x, y + 1);
        ctx.restore();
      }
    }
    // spell targeting
    if (ui.targeting) {
      const sp = ui.targeting;
      if (sp.target === 'area' && ui.point) {
        const { x, y } = ui.point;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.ellipse(x, y, sp.r || 110, (sp.r || 110) * 0.62, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = FONT(400, 30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sp.icon, x, y);
        ctx.restore();
      } else if (sp.target !== 'global') {
        for (const b of V.buildings) {
          if (!spellTargetOk(sp, b, this.me)) continue;
          const pulse = 0.5 + 0.5 * Math.sin(t * 6);
          ctx.save();
          ctx.strokeStyle = `rgba(255,240,120,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3 + pulse * 2;
          ctx.beginPath(); ctx.ellipse(b.x, b.y + b.radius * 0.25, b.radius * 1.25, b.radius * 0.7, 0, 0, TAU); ctx.stroke();
          ctx.restore();
          if (ui.hover === b.id) { ctx.font = FONT(400, 28); ctx.textAlign = 'center'; ctx.fillText(sp.icon, b.x, b.y - b.radius * 1.9); }
        }
      }
    }
    if (ui.tut) this.drawTutorial(ctx, V, ui.tut, t);
  }
  /** lasting skill areas: fog, spy eye, u-turn field, vortex, tornado, fences, magnets */
  drawZones(ctx, V, t) {
    for (const z of V.zones || []) {
      const c = teamColor(z.o), mine = z.o === this.me;
      const fade = Math.min(1, z.left / 0.6);
      ctx.save();
      ctx.globalAlpha = fade;
      const circle = (fill, stroke, dash) => {
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.62, 0, 0, TAU);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = -t * 30; } ctx.stroke(); ctx.setLineDash([]); }
      };
      const label = ch => { ctx.font = FONT(400, 24); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, z.x, z.y - z.r * 0.62 - 6); };
      switch (z.k) {
        case 'fog': {
          circle('rgba(200,205,215,0.42)', null);
          if (this.fxLevel !== 'low' && Math.random() < 0.3) this.spawn({ x: z.x + rand(-z.r, z.r) * 0.8, y: z.y + rand(-z.r, z.r) * 0.45, vx: rand(-10, 10), vy: -6, life: 1.6, size: rand(18, 30), color: 'rgba(230,232,240,0.5)', kind: 'puff' });
          break;
        }
        case 'spy': circle(mine ? 'rgba(120,200,255,0.10)' : 'rgba(255,255,255,0.05)', hexA(c.main, 0.8), [6, 8]); label('🔭'); break;
        case 'intel': circle('rgba(255,170,255,0.07)', hexA(c.main, 0.6), [4, 10]); label('🧠');
          if (mine) for (const s of V.squads) {
            if (s.owner === this.me || Math.hypot(s.x - z.x, (s.y - z.y) / 0.62) > z.r) continue;
            const tb = V.byId.get(s.to); if (!tb) continue;
            ctx.strokeStyle = hexA(teamColor(s.owner).main, 0.85); ctx.lineWidth = 2.5; ctx.setLineDash([5, 6]); ctx.lineDashOffset = -t * 40;
            ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tb.x, tb.y - tb.radius * 0.3); ctx.stroke(); ctx.setLineDash([]);
          }
          break;
        case 'uturn': circle('rgba(255,120,200,0.14)', '#ff7ad0', [10, 6]); label('↩️'); break;
        case 'vortex': {
          circle('rgba(120,230,255,0.10)', null);
          ctx.strokeStyle = 'rgba(140,235,255,0.75)'; ctx.lineWidth = 3;
          for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * (0.35 + k * 0.25), z.r * (0.35 + k * 0.25) * 0.62, 0, t * (2 + k) + k, t * (2 + k) + k + 2.2); ctx.stroke(); }
          break;
        }
        case 'tornado': {
          ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(z.x, z.y + 6, z.r, z.r * 0.4, 0, 0, TAU); ctx.fill();
          for (let k = 0; k < 6; k++) {
            const w = z.r * (0.35 + k * 0.13), y = z.y - k * 16;
            ctx.strokeStyle = `rgba(170,180,200,${0.75 - k * 0.08})`; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.ellipse(z.x + Math.sin(t * 5 + k) * 6, y, w, w * 0.32, 0, t * 6 + k, t * 6 + k + 4.4); ctx.stroke();
          }
          if (this.fxLevel !== 'low' && Math.random() < 0.5) this.spawn({ x: z.x + rand(-z.r, z.r), y: z.y - rand(0, 60), vx: rand(-60, 60), vy: -40, life: 0.6, size: 4, color: '#9a8a70', kind: 'dot' });
          break;
        }
        case 'fence': {
          ctx.fillStyle = 'rgba(120,220,255,0.07)'; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.62, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(120,220,255,${0.6 + 0.4 * Math.sin(t * 20)})`; ctx.lineWidth = 3;
          ctx.beginPath();
          for (let k = 0; k <= 40; k++) { const a = k / 40 * TAU, j = (k % 2 ? 6 : -6) * Math.sin(t * 30 + k); const x = z.x + Math.cos(a) * (z.r + j), y = z.y + Math.sin(a) * (z.r + j) * 0.62; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke();
          break;
        }
        case 'magnet': circle('rgba(255,90,90,0.07)', hexA(c.main, 0.7), [14, 10]); label('🧲'); break;
        case 'moths': {
          circle(`rgba(230,215,255,${0.14 + 0.05 * Math.sin(t * 3)})`, 'rgba(200,170,255,0.6)', [3, 7]);
          break;
        }
        case 'ufo': {
          const hy = z.y - 120 + Math.sin(t * 4) * 6;
          const g = ctx.createLinearGradient(0, hy, 0, z.y + 10);
          g.addColorStop(0, 'rgba(160,255,200,0.4)'); g.addColorStop(1, 'rgba(160,255,200,0.04)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(z.x - 22, hy + 8); ctx.lineTo(z.x + 22, hy + 8); ctx.lineTo(z.x + z.r, z.y + 6); ctx.lineTo(z.x - z.r, z.y + 6); ctx.closePath(); ctx.fill();
          circle(null, 'rgba(160,255,200,0.5)', [6, 8]);
          break;
        }
        case 'slime': ctx.globalAlpha = fade * 0.8; ctx.fillStyle = 'rgba(140,220,90,0.35)'; ctx.beginPath(); ctx.ellipse(z.x, z.y + 2, z.r, z.r * 0.55, 0, 0, TAU); ctx.fill(); break;
        case 'barrier': {
          if (z.ux == null) break;
          const x0 = z.x - z.ux * z.r, y0 = z.y - z.uy * z.r, x1 = z.x + z.ux * z.r, y1 = z.y + z.uy * z.r;
          ctx.strokeStyle = `rgba(255,60,90,${0.55 + 0.4 * Math.sin(t * 25)})`; ctx.lineWidth = 5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x0, y0 - 10); ctx.lineTo(x1, y1 - 10); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,220,230,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y0 - 10); ctx.lineTo(x1, y1 - 10); ctx.stroke();
          ctx.fillStyle = '#5c6474';
          const n = Math.max(2, Math.round(z.r / 40));
          for (let k = 0; k <= n; k++) { const u = k / n, px = lerp(x0, x1, u), py = lerp(y0, y1, u); ctx.fillRect(px - 2.5, py - 16, 5, 16); }
          break;
        }
        case 'totem': {
          circle('rgba(255,90,40,0.08)', hexA(c.main, 0.6), [10, 8]);
          ctx.font = FONT(400, 34); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('🗿', z.x, z.y + 8);
          if (this.fxLevel !== 'low' && Math.random() < 0.25) this.spawn({ x: z.x + rand(-z.r, z.r) * 0.7, y: z.y + rand(-z.r, z.r) * 0.4, vx: 0, vy: -30, life: 0.8, size: 3, color: '#ff6a3a', kind: 'dot' });
          break;
        }
        case 'rain': {
          circle('rgba(90,140,220,0.12)', 'rgba(120,170,255,0.5)', [4, 8]);
          ctx.strokeStyle = 'rgba(170,205,255,0.8)'; ctx.lineWidth = 1.5;
          for (let k = 0; k < 26; k++) {
            const ph = (t * 1.6 + k * 0.137) % 1, a = k * 2.4, rr2 = z.r * ((k * 0.37) % 1);
            const x = z.x + Math.cos(a) * rr2, y = z.y + Math.sin(a) * rr2 * 0.62 - 60 + ph * 60;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); ctx.stroke();
          }
          break;
        }
        case 'sand': {
          circle('rgba(220,180,110,0.35)', 'rgba(190,150,80,0.6)', null);
          ctx.strokeStyle = 'rgba(160,120,60,0.6)'; ctx.lineWidth = 3;
          for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * (0.3 + k * 0.2), z.r * (0.3 + k * 0.2) * 0.62, 0, t * (3 - k * 0.4) + k, t * (3 - k * 0.4) + k + 2.4); ctx.stroke(); }
          if (this.fxLevel !== 'low' && Math.random() < 0.6) { const a = rand(0, TAU); this.spawn({ x: z.x + Math.cos(a) * z.r * 0.8, y: z.y + Math.sin(a) * z.r * 0.5, vx: -Math.sin(a) * 90, vy: Math.cos(a) * 50, life: 0.6, size: 3, color: '#c9a46a', kind: 'dot' }); }
          break;
        }
        case 'qsand': {
          circle('rgba(170,130,70,0.22)', 'rgba(140,100,50,0.5)', [5, 6]);
          ctx.strokeStyle = 'rgba(120,85,40,0.45)'; ctx.lineWidth = 2;
          for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k / 4, z.r * k / 4 * 0.62, 0, -t * 0.8 * k, -t * 0.8 * k + 3.5); ctx.stroke(); }
          break;
        }
        case 'wind': {
          if (z.ux == null) break;
          const L = Math.min(z.r, 1900), w = z.w || 80;
          ctx.strokeStyle = 'rgba(220,245,255,0.55)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          for (let k = 0; k < 18; k++) {
            const along = ((t * 220 + k * 113) % L), side = ((k * 47) % (w * 2)) - w;
            const x = z.x + z.ux * along - z.uy * side, y = z.y + z.uy * along + z.ux * side;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + z.ux * 30, y + z.uy * 30); ctx.stroke();
          }
          break;
        }
        case 'wave': {
          if (z.ux == null) break;
          const px = -z.uy, py = z.ux;
          ctx.strokeStyle = 'rgba(190,240,255,0.9)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(z.x + px * z.r, z.y + py * z.r * 0.62); ctx.quadraticCurveTo(z.x + z.ux * 18, z.y + z.uy * 18, z.x - px * z.r, z.y - py * z.r * 0.62); ctx.stroke();
          if (this.fxLevel !== 'low') this.spawn({ x: z.x + rand(-z.r, z.r) * 0.5, y: z.y + rand(-10, 10), vx: 0, vy: -20, life: 0.6, size: 3.5, color: '#e6f7ff', kind: 'star' });
          break;
        }
        case 'worm': {
          circle('rgba(150,110,60,0.10)', 'rgba(150,110,60,0.6)', [12, 8]);
          ctx.fillStyle = 'rgba(110,80,40,0.55)'; ctx.beginPath(); ctx.ellipse(z.x, z.y + 4, 46, 18, 0, 0, TAU); ctx.fill();
          break;
        }
        case 'mine': {
          const on = Math.sin(t * 8 + z.x) > 0;
          ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.arc(z.x, z.y - 4, Math.min(12, z.r * 0.5), 0, TAU); ctx.fill();
          ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 2;
          for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx.beginPath(); ctx.moveTo(z.x + Math.cos(a) * 9, z.y - 4 + Math.sin(a) * 9); ctx.lineTo(z.x + Math.cos(a) * 15, z.y - 4 + Math.sin(a) * 15); ctx.stroke(); }
          ctx.fillStyle = on ? '#ff3a3a' : '#7a1f1f'; ctx.beginPath(); ctx.arc(z.x, z.y - 8, 3, 0, TAU); ctx.fill();
          break;
        }
        case 'reap': circle('rgba(60,40,80,0.10)', 'rgba(150,230,140,0.55)', [8, 10]); label('🌾'); break;
      }
      ctx.restore();
    }
  }
  /** skill areas with a part that floats above buildings and cats: the saucer, the worm, the moths */
  drawZoneTops(ctx, V, t) {
    for (const z of V.zones || []) {
      if (z.k !== 'ufo' && z.k !== 'worm' && z.k !== 'moths') continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, z.left / 0.6);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (z.k === 'ufo') {
        const hy = z.y - 120 + Math.sin(t * 4) * 6;
        ctx.fillStyle = '#9fb3c8'; ctx.beginPath(); ctx.ellipse(z.x, hy, 46, 14, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9f7ff'; ctx.beginPath(); ctx.ellipse(z.x, hy - 8, 20, 16, 0, Math.PI, TAU); ctx.fill();
        for (let j = 0; j < 4; j++) { ctx.fillStyle = (Math.floor(t * 8) + j) % 2 ? '#ffe066' : '#ff6a8a'; ctx.beginPath(); ctx.arc(z.x - 30 + j * 20, hy + 3, 3.5, 0, TAU); ctx.fill(); }
      } else if (z.k === 'worm') {
        ctx.font = FONT(400, 52 + Math.sin(t * 6) * 5);
        ctx.fillText('🪱', z.x + (z.x > this.VW / 2 ? -30 : 30), z.y - 22);
      } else {
        ctx.font = FONT(400, 14);
        for (let k = 0; k < 10; k++) { const a = t * (0.8 + (k % 3) * 0.3) + k * 0.7, rr2 = z.r * (0.35 + (k % 4) * 0.17); ctx.fillText('🦋', z.x + Math.cos(a) * rr2, z.y + Math.sin(a) * rr2 * 0.62 - 14 + Math.sin(t * 9 + k) * 3); }
      }
      ctx.restore();
    }
  }
  /** Tutorial: glowing rings on the buildings it talks about, and a paw that shows the drag to make. */
  drawTutorial(ctx, V, tut, t) {
    const k = this.uiScale;
    for (const id of tut.hl || []) {
      const b = V.byId.get(id);
      if (!b) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.save();
      ctx.strokeStyle = `rgba(255,224,102,${0.55 + pulse * 0.45})`; ctx.lineWidth = 4 + pulse * 3;
      ctx.shadowColor = 'rgba(255,200,40,.9)'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.ellipse(b.x, b.y + b.radius * 0.25, b.radius * (1.35 + pulse * 0.12), b.radius * (0.78 + pulse * 0.07), 0, 0, TAU); ctx.stroke();
      ctx.restore();
      const y = b.y - b.radius * 2.1 - 16 * k - Math.abs(Math.sin(t * 4)) * 12;
      ctx.font = FONT(400, 30 * k); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👇', b.x, y);
    }
    const a = tut.from != null ? V.byId.get(tut.from) : null, z = tut.to != null ? V.byId.get(tut.to) : null;
    if (a && z) {
      const route = this.routeView(a.id, z.id) || [{ x: a.x, y: a.y }, { x: z.x, y: z.y }];
      const pts = route.map(p => ({ x: p.x, y: p.y }));
      pts[0] = { x: a.x, y: a.y - a.radius * 0.3 }; pts[pts.length - 1] = { x: z.x, y: z.y - z.radius * 0.3 };
      let L = 0; const seg = [];
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); L += d; }
      ctx.save();
      ctx.setLineDash([6, 10]); ctx.lineDashOffset = -t * 40; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      ctx.restore();
      // the paw slides along the road, rests at the end, then starts again
      const u = Math.min(1, ((t % 2.2) / 1.6));
      let d = u * L, i = 0;
      while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const p0 = pts[i], p1 = pts[i + 1] || pts[i], f = seg[i] ? d / seg[i] : 0;
      const hx = p0.x + (p1.x - p0.x) * f, hy = p0.y + (p1.y - p0.y) * f;
      ctx.font = FONT(400, 34 * k); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = u >= 1 ? 0.6 : 1;
      ctx.fillText('🐾', hx, hy);
      ctx.globalAlpha = 1;
    }
  }
  routeArrow(ctx, route, from, to, col, t) {
    const pts = route.map(p => ({ x: p.x, y: p.y }));
    pts[0] = { x: from.x, y: from.y - from.radius * 0.3 };
    const n = pts.length;
    pts[n - 1] = { x: to.x, y: to.y - to.radius * 0.3 };
    // stop a little short of the target so the head sits in front of it
    const a = pts[n - 2], z = pts[n - 1], dl = Math.hypot(z.x - a.x, z.y - a.y) || 1;
    const cut = Math.min(to.radius * 0.55, dl * 0.5);
    const end = { x: z.x - (z.x - a.x) / dl * cut, y: z.y - (z.y - a.y) / dl * cut };
    pts[n - 1] = end;
    const trace = oy => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y + oy);
      for (let k = 1; k < n - 1; k++) {
        const p = pts[k], q = pts[k + 1];
        ctx.quadraticCurveTo(p.x, p.y + oy, (p.x + q.x) / 2, (p.y + q.y) / 2 + oy);
      }
      ctx.lineTo(end.x, end.y + oy);
    };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 9; trace(3); ctx.stroke();
    ctx.strokeStyle = col.light; ctx.lineWidth = 6;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 60;
    trace(0); ctx.stroke();
    ctx.setLineDash([]);
    const ux = (end.x - a.x) / (Math.hypot(end.x - a.x, end.y - a.y) || 1), uy = (end.y - a.y) / (Math.hypot(end.x - a.x, end.y - a.y) || 1);
    ctx.fillStyle = col.light;
    ctx.beginPath();
    ctx.moveTo(end.x + ux * 6, end.y + uy * 6);
    ctx.lineTo(end.x - ux * 16 - uy * 11, end.y - uy * 16 + ux * 11);
    ctx.lineTo(end.x - ux * 16 + uy * 11, end.y - uy * 16 - ux * 11);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  arrow(ctx, x0, y0, x1, y1, col, t, locked) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 20) return;
    const mx = (x0 + x1) / 2 - dy * 0.12, my = (y0 + y1) / 2 + dx * 0.12 - L * 0.08;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x0, y0 + 3); ctx.quadraticCurveTo(mx, my + 3, x1, y1 + 3); ctx.stroke();
    ctx.strokeStyle = locked ? col.light : col.main; ctx.lineWidth = 6;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 60;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    // arrow head
    const ex = x1 - mx, ey = y1 - my, el = Math.hypot(ex, ey) || 1;
    const ux = ex / el, uy = ey / el;
    ctx.fillStyle = locked ? col.light : col.main;
    ctx.beginPath();
    ctx.moveTo(x1 + ux * 6, y1 + uy * 6);
    ctx.lineTo(x1 - ux * 16 - uy * 11, y1 - uy * 16 + ux * 11);
    ctx.lineTo(x1 - ux * 16 + uy * 11, y1 - uy * 16 - ux * 11);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------- events -> effects ----------
  event(e, V) {
    const B = id => V.byId.get(id);
    const lowFx = this.fxLevel === 'low';
    switch (e.k) {
      case 'send': {
        const b = B(e.from); if (b) this.burst(b.x, b.y, { n: lowFx ? 2 : 5, color: teamColor(e.o).light, speed: 40, life: 0.4, size: 3 });
        break;
      }
      case 'arrive': {
        const b = B(e.b); if (!b) break;
        if (!e.f) {
          this.hits.set(b.id, 1);
          this.burst(b.x, b.y - b.radius * 0.3, { n: lowFx ? 3 : 8, color: '#fff7e0', speed: 70, life: 0.5, size: 4, kind: 'puff' });
          this.text(b.x + rand(-10, 10), b.y - b.radius * 1.4, '-' + e.n, '#ffffff', 15, teamColor(e.o).dark);
        } else {
          this.burst(b.x, b.y - b.radius * 0.4, { n: lowFx ? 2 : 5, color: teamColor(e.o).light, speed: 35, life: 0.5, size: 3, kind: 'star' });
        }
        break;
      }
      case 'cap': {
        const b = B(e.b); if (!b) break;
        const c = teamColor(e.o);
        this.ring(b.x, b.y, b.radius * 2.4, c.light, 0.6, 6);
        this.burst(b.x, b.y - b.radius * 0.6, { n: lowFx ? 10 : 34, colors: [c.main, c.light, '#fff', '#ffe066'], speed: 220, life: 1.1, size: 5, kind: 'confetti', gravity: 260 });
        if (e.o === this.me) this.text(b.x, b.y - b.radius * 2, 'CAPTURED!', '#fff', 20, c.dark, 1.3);
        else if (e.prev === this.me) this.text(b.x, b.y - b.radius * 2, 'LOST!', '#fff', 20, '#a01d2c', 1.3);
        if (e.bonus) this.text(b.x, b.y - b.radius * 2.6, `🍀 +${e.bonus}`, '#fff', 16, '#2f8a3a', 1.2);
        if (e.down) this.text(b.x, b.y + b.radius * 0.2, `▼ Level ${e.down}`, '#fff', 14, '#6a4a3a', 1.4);
        this.shake = Math.max(this.shake, e.o === this.me || e.prev === this.me ? 5 : 2);
        break;
      }
      case 'fight': {
        this.burst(e.x, e.y - 8, { n: lowFx ? 4 : 12, color: '#fff3e0', speed: 90, life: 0.55, size: 6, kind: 'puff' });
        this.burst(e.x, e.y - 12, { n: lowFx ? 1 : 4, color: '#ffd84d', speed: 120, life: 0.6, size: 7, kind: 'star' });
        if (!lowFx) this.emoji(e.x + rand(-6, 6), e.y - 20, Math.random() < 0.5 ? '💢' : '💥', 18, 0.7);
        this.text(e.x, e.y - 28, '-' + e.n, '#fff', 14, '#333');
        break;
      }
      case 'shot': {
        const b = B(e.b); if (!b) break;
        this.projs.push({ x0: b.x, y0: b.y - b.radius * 1.5, sid: e.s, x1: e.x, y1: e.y, t: 0, dur: e.ft || 0.3, hacked: e.h });
        break;
      }
      case 'pop': this.burst(e.x, e.y - 8, { n: lowFx ? 2 : 6, color: '#ffffff', speed: 60, life: 0.4, size: 4, kind: 'puff' }); break;
      case 'up': {
        const b = B(e.b); if (!b) break;
        this.burst(b.x, b.y - b.radius, { n: lowFx ? 6 : 20, colors: ['#ffe066', '#fff', '#ffb84d'], speed: 120, life: 1, size: 5, kind: 'star', gravity: -40 });
        this.ring(b.x, b.y, b.radius * 2, '#ffe066', 0.5, 4);
        this.text(b.x, b.y - b.radius * 2.1, `LEVEL ${e.lv}!`, '#fff', 17, '#b8851d', 1.2);
        break;
      }
      case 'conv': {
        const b = B(e.b); if (!b) break;
        this.burst(b.x, b.y - b.radius * 0.6, { n: lowFx ? 6 : 24, colors: ['#c9a6ff', '#fff', '#8fd3ff'], speed: 140, life: 0.9, size: 5, kind: 'star' });
        this.ring(b.x, b.y, b.radius * 2, '#c9a6ff', 0.6, 5);
        this.text(b.x, b.y - b.radius * 2.1, (BUILDINGS[e.to] || {}).name || 'Converted!', '#fff', 15, '#6a3fb8', 1.2);
        break;
      }
      case 'souls': {
        const b = B(e.b); if (!b) break;
        this.projs.push({ x0: e.x, y0: e.y - 10, x1: b.x, y1: b.y - b.radius, t: 0, dur: 0.9, soul: 1 });
        break;
      }
      case 'warp': {
        const a = B(e.from), b = B(e.to);
        if (a) this.ring(a.x, a.y, 80, '#b48cff', 0.5, 6);
        if (b) { this.ring(b.x, b.y, 90, '#b48cff', 0.6, 6); this.burst(b.x, b.y - 20, { n: 20, colors: ['#b48cff', '#3a1f6e', '#fff'], speed: 160, life: 0.8, size: 5, kind: 'star' }); this.text(b.x, b.y - b.radius * 2, `🌀 ${e.n}`, '#fff', 16, '#4b2a8a'); }
        break;
      }
      case 'boom': {
        if (e.fx === 'fire') {
          this.shake = Math.max(this.shake, 10);
          if (e.n) this.text(e.x, e.y - 40, `🔥 -${e.n}`, '#fff', 20, '#a3300f', 1.3);
        } else if (e.fx === 'hail') {
          this.ring(e.x, e.y, e.r * 1.05, '#d8f0ff', 0.6, 10);
          this.burst(e.x, e.y - 20, { n: lowFx ? 12 : 46, colors: ['#ffffff', '#d8f0ff', '#9fd0ff'], speed: 240, life: 0.9, size: 5, kind: 'star' });
          this.decals.push({ x: e.x, y: e.y, r: e.r * 0.8, life: 5, max: 5, color: '220,240,255' });
          if (e.n) this.text(e.x, e.y - 40, `🌨️ -${e.n}`, '#fff', 20, '#2a5a8a', 1.3);
          this.shake = Math.max(this.shake, 9);
        } else if (e.fx === 'mine') {
          this.burst(e.x, e.y - 8, { n: lowFx ? 6 : 18, colors: ['#ff7a2f', '#ffd84d', '#333'], speed: 160, life: 0.6, size: 6, kind: 'puff' });
          this.shake = Math.max(this.shake, 4);
        } else if (e.fx === 'meteor') {
          this.ring(e.x, e.y, e.r * 1.1, '#ffb347', 0.5, 10);
          this.burst(e.x, e.y, { n: lowFx ? 12 : 46, colors: ['#ff6a2f', '#ffd84d', '#fff2c4', '#7a3a1a'], speed: 260, life: 0.9, size: 7, kind: 'puff' });
          this.decals.push({ x: e.x, y: e.y, r: e.r * 0.7, life: 6, max: 6, color: '40,20,10' });
          this.shake = Math.max(this.shake, 12);
        } else {
          this.timed.push({ kind: 'beam', x: e.x, y: e.y, t: 0, dur: 0.7, color: '#7ff6ff' });
          this.ring(e.x, e.y, 130, '#7ff6ff', 0.6, 10);
          this.burst(e.x, e.y - 20, { n: lowFx ? 12 : 50, colors: ['#7ff6ff', '#ffffff', '#4ab8ff'], speed: 300, life: 1, size: 6, kind: 'star' });
          this.decals.push({ x: e.x, y: e.y, r: 60, life: 6, max: 6, color: '20,40,60' });
          this.shake = Math.max(this.shake, 14);
        }
        break;
      }
      case 'blocked': {
        const b = B(e.b); if (b) { this.ring(b.x, b.y, b.radius * 2, '#ff7a2f', 0.5, 6); this.text(b.x, b.y - b.radius * 2, 'BLOCKED!', '#fff', 16, '#c2410c'); }
        break;
      }
      case 'emote': {
        const home = this.homeOf(V, e.o);
        if (home) this.emoteBubble(home.x, home.y - home.radius * 2.2, e.id, e.o);
        break;
      }
      case 'spell': this.spellFx(e, V); break;
      case 'warpin': { const b = B(e.b); if (b) { this.ring(b.x, b.y, 80, '#b48cff', 0.6, 6); this.text(b.x, b.y - b.radius * 2, `🕳️ ${e.n}`, '#fff', 16, '#4b2a8a'); } break; }
      case 'sneakhit': { const b = B(e.b); if (b) { this.burst(b.x, b.y - 20, { n: lowFx ? 4 : 12, colors: ['#333', '#fff'], speed: 120, life: 0.6, size: 5, kind: 'puff' }); this.text(b.x, b.y - b.radius * 2.3, `🥷 ${e.n}`, '#fff', 15, '#222'); } break; }
      case 'chain': {
        const pts = (e.pts || []).map(([x, y]) => this.fwd(x, y));
        for (let k = 0; k < pts.length; k++) {
          this.burst(pts[k].x, pts[k].y - 10, { n: lowFx ? 4 : 12, colors: ['#9ff', '#fff', '#ffe066'], speed: 140, life: 0.5, size: 4, kind: 'star' });
          if (k) this.projs.push({ x0: pts[k - 1].x, y0: pts[k - 1].y - 10, x1: pts[k].x, y1: pts[k].y - 10, t: -k * 0.08, dur: 0.18, data: 1 });
        }
        break;
      }
      case 'echo': { const a = B(e.from), b = B(e.b); if (a && b) this.projs.push({ x0: a.x, y0: a.y - 30, x1: b.x, y1: b.y - 30, t: 0, dur: 0.5, soul: 1 }); if (b) this.text(b.x, b.y - b.radius * 1.6, '📣 -' + Math.round(e.n), '#fff', 14, '#7b3fbf'); break; }
      case 'bounced': { const b = B(e.b); if (b) { this.ring(b.x, b.y, b.radius * 2, '#c8aaff', 0.5, 6); this.text(b.x, b.y - b.radius * 2, 'BOUNCED!', '#fff', 16, '#6a3fb8'); } break; }
      case 'zapped': this.burst(e.x, e.y - 8, { n: lowFx ? 3 : 10, colors: ['#9ff', '#fff'], speed: 140, life: 0.4, size: 3, kind: 'star' }); break;
      case 'splash': this.burst(e.x, e.y - 6, { n: lowFx ? 3 : 10, colors: ['#ff7a2f', '#ffd84d', '#555'], speed: 120, life: 0.45, size: 5, kind: 'puff' }); break;
      case 'turned': this.emoji(e.x, e.y - 24, '↩️', 18, 0.8); break;
      case 'panic': { const b = B(e.b); if (b) { this.emoji(b.x, b.y - 80, '😱', 34, 1.2); this.text(b.x, b.y - b.radius * 2.4, `${e.n} fled!`, '#fff', 16, '#a01d2c', 1.3); } break; }
      case 'infect': { const b = B(e.b); if (b) this.emoji(b.x, b.y - 70, '🤢', 28, 1.1); break; }
      case 'down': { const b = B(e.b); if (b) this.text(b.x, b.y - b.radius * 2, `▼ Level ${e.lv}`, '#fff', 16, '#6a4a3a', 1.4); break; }
      case 'ufozap': {
        const p0 = { x: e.x, y: e.y }, p1 = this.fwd(e.tx, e.ty);
        this.timed.push({ kind: 'zapline', x0: p0.x, y0: p0.y - 115, x1: p1.x, y1: p1.y - 8, t: 0, dur: 0.18 });
        this.burst(p1.x, p1.y - 8, { n: lowFx ? 2 : 5, colors: ['#9fffcf', '#fff'], speed: 90, life: 0.3, size: 3, kind: 'star' });
        break;
      }
      case 'thud': this.burst(e.x, e.y, { n: lowFx ? 3 : 10, colors: ['#d8c8a8', '#fff'], speed: 90, life: 0.5, size: 5, kind: 'puff' }); break;
      case 'split': if (!lowFx) this.text(e.x, e.y - 30, `🐛 +${e.n}`, '#fff', 13, '#3f7a2a', 0.9); break;
      case 'join': this.burst(e.x, e.y - 8, { n: lowFx ? 2 : 8, color: teamColor(e.o).light, speed: 70, life: 0.5, size: 4, kind: 'star' }); break;
      case 'cycle': { const b = B(e.b); if (b) { this.ring(b.x, b.y, b.radius * 2.2, '#8fe07a', 0.7, 8); this.text(b.x, b.y - b.radius * 2.2, '♻️ +20', '#fff', 18, '#2f8a3a', 1.4); } break; }
      case 'redirect': { const a = B(e.from), b = B(e.b); if (a && b) this.projs.push({ x0: a.x, y0: a.y - 30, x1: b.x, y1: b.y - 30, t: 0, dur: 0.6, soul: 1 }); if (b) this.text(b.x, b.y - b.radius * 1.8, '↪️ -' + e.n, '#fff', 15, '#4b2a8a'); break; }
      case 'vanish': { const b = B(e.b); if (b) { this.emoji(b.x, b.y - b.radius * 1.6, '👻', 26, 1.2); this.text(b.x, b.y - b.radius * 2.2, `-${e.n}`, '#fff', 14, '#4b2a8a'); } break; }
      case 'eaten': { const b = B(e.b); if (b) this.text(b.x + rand(-14, 14), b.y - b.radius * 1.6, `🪱 -${e.n}`, '#fff', 14, '#6a4a2a'); break; }
      case 'wormout': { const b = B(e.b); if (b) { this.burst(b.x, b.y - 10, { n: lowFx ? 10 : 34, colors: ['#c9a46a', '#8a6a3a', '#fff'], speed: 200, life: 0.9, size: 6, kind: 'puff' }); this.text(b.x, b.y - b.radius * 2.3, `🏜️ ${e.n} sand cats!`, '#fff', 16, '#8a6a3a', 1.4); this.shake = Math.max(this.shake, 8); } break; }
      case 'sandend': this.burst(e.x, e.y, { n: lowFx ? 8 : 30, colors: ['#e0c38a', '#c9a46a'], speed: 180, life: 0.8, size: 5, kind: 'puff' }); break;
      case 'lift': { const b = B(e.b); if (b) { this.ring(b.x, b.y, b.radius * 2, '#9a8a70', 0.5, 6); this.emoji(b.x, b.y - b.radius * 2, '🍲', 26, 1); } break; }
    }
  }
  homeOf(V, o) {
    let best = null;
    for (const b of V.buildings) if (b.owner === o && (!best || b.count > best.count)) best = b;
    return best;
  }

  spellFx(e, V) {
    const sp = findSpell(e.id) || {};
    const b = e.b >= 0 ? V.byId.get(e.b) : null;
    const x = b ? b.x : e.x, y = b ? b.y : e.y;
    const c = teamColor(e.o);
    const lowFx = this.fxLevel === 'low';
    const myB = V.buildings.filter(q => q.owner === e.o);
    const enemyS = V.squads.filter(q => q.owner !== e.o);
    if (sp.target === 'area') this.ring(e.x, e.y, sp.r || 110, '#ffffff', 0.45, 4);
    switch (e.fx) {
      case 'stone': this.burst(x, y - 30, { n: 18, colors: ['#d8cbb0', '#fff'], speed: 120, life: 0.7, size: 4, kind: 'star' }); break;
      case 'boots': case 'fury': case 'cloak': case 'chicken': case 'slowmo': case 'frost': case 'home': case 'charm': case 'rewind': {
        const col = { boots: '#ffd84d', fury: '#ff4a2f', cloak: '#6d6a7a', chicken: '#ffe9a0', slowmo: '#8fd3ff', frost: '#bfefff', home: '#ffb38a', charm: '#ff7ab0', rewind: '#c4a6ff' }[e.fx];
        const ch = { boots: '👢', fury: '😤', cloak: '💨', chicken: '🪶', slowmo: '🐌', frost: '❄️', home: '🏠', charm: '💘', rewind: '⏪' }[e.fx];
        this.ring(e.x, e.y, sp.r || 120, col, 0.7, 8);
        for (let k = 0; k < (lowFx ? 6 : 18); k++) { const a = rand(0, TAU), r = rand(0, sp.r || 120); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.62, vx: rand(-15, 15), vy: rand(-40, -10), life: rand(0.8, 1.4), size: rand(10, 16), kind: 'emoji', text: ch }); }
        if (e.fx === 'charm' && e.res && e.res !== '0') this.text(e.x, e.y - 60, `+${e.res} joined!`, '#fff', 18, '#b0306a', 1.4);
        break;
      }
      case 'star': this.screenText('⭐', 'LUCKY STAR!', e.o); break;
      case 'sneak': this.screenText('🥷', 'SNEAK ATTACK!', e.o); break;
      case 'even': this.screenText('⚖️', 'EVEN PURR!', e.o); break;
      case 'hush': this.screenText('🤫', 'HUSH!', e.o); break;
      case 'pfreeze': this.screenText('⏸️', 'PURR FREEZE!', e.o); break;
      case 'popup': case 'boom': case 'soul': this.burst(x, y - 50, { n: 16, colors: ['#bbb', '#ffd84d', '#fff'], speed: 100, life: 0.6, size: 4, kind: 'star' }); this.emoji(x, y - 70, sp.icon || '🗼', 30, 1); break;
      case 'ranks': case 'fly': case 'beam': case 'shortcut': case 'pods': case 'kboom': this.emoji(x, y - 70, sp.icon || '✨', 30, 1.1); this.ring(x, y, 70, c.light, 0.6, 5); break;
      case 'bomb': {
        const from = this.homeOf(V, e.o) || { x: x < 800 ? -40 : 1640, y: 200 };
        this.timed.push({ kind: 'cannon', x, y: y - 20, sx: from.x, sy: from.y - 40, t: 0, dur: 0.6 });
        this.ring(x, y, sp.r || 90, '#ff7a2f', 0.8, 8);
        break;
      }
      case 'shackle': case 'paper': case 'freeze': case 'crumble': case 'defect': case 'echo': case 'plague': case 'panic': case 'hypno':
        this.emoji(x, y - 80, sp.icon || '✨', 34, 1.3); this.ring(x, y, 80, c.main, 0.7, 6);
        if (e.fx === 'hypno' && e.res) this.text(x, y - 110, `${e.res} hypnotized`, '#fff', 16, '#4b2a8a', 1.4);
        break;
      case 'fire': this.timed.push({ kind: 'firering', x: e.x, y: e.y, r: sp.r || 120, t: 0, dur: 0.8 }); break;
      case 'tornado': case 'vortex': case 'uturn': case 'spy': case 'fog': case 'intel': this.ring(e.x, e.y, sp.r || 90, '#ffffff', 0.5, 4); break;
      case 'fence': case 'magnet': case 'invuln': case 'bounce': this.ring(x, y, 90, c.light, 0.6, 6); this.emoji(x, y - 80, sp.icon || '✨', 30, 1.1); break;
      case 'revive': this.timed.push({ kind: 'beam', x, y, t: 0, dur: 1.0, color: '#e6e9ff' }); if (e.res) this.text(x, y - 90, `+${e.res}`, '#fff', 20, '#2f8a3a', 1.2); break;
      case 'swap': this.burst(x, y - 30, { n: 30, colors: ['#e0a6ff', '#7dd3ff', '#fff'], speed: 160, life: 1, size: 6, kind: 'star' }); this.emoji(x, y - 70, '🔀', 32, 1); break;
      case 'chain': case 'mystery': break;
      case 'gold': this.screenText('🏆', 'GOLDEN PURR!', e.o); break;
      case 'fort': this.screenText('🏰', 'FORTRESS!', e.o); for (const q of myB) this.ring(q.x, q.y, q.radius * 2, c.light, 0.6, 5); break;
      case 'glacier': this.screenText('🏔️', 'BIG FREEZE!', e.o); break;
      case 'blood': this.screenText('🩸', 'BLOOD PACT!', e.o); break;
      case 'steal': this.screenText('🎒', e.res ? `COPIED ${String(e.res).toUpperCase()}!` : 'COPY CAT!', e.o); break;
      case 'ghosts': case 'bones': this.burst(x, y - 20, { n: lowFx ? 6 : 20, colors: ['#e6e9ff', '#b8b0d8', '#fff'], speed: 130, life: 0.9, size: 6, kind: 'puff' }); this.emoji(x, y - 80, sp.icon || '👻', 32, 1.2); break;
      case 'cauldron': this.emoji(x, y - 80, '🍲', 38, 1.4); this.ring(x, y, 90, '#5a5048', 0.7, 8); this.shake = Math.max(this.shake, 6); break;
      case 'thief': this.emoji(x, y - 80, '💰', 34, 1.3); if (e.res) this.text(x, y - 110, `+${e.res} purr`, '#fff', 16, '#b8851d', 1.4); break;
      case 'mean': this.emoji(x, y - 80, '⚖️', 34, 1.3); if (e.res) this.text(x, y - 110, `all ${e.res}`, '#fff', 16, '#4b2a8a', 1.4); break;
      case 'possess': this.emoji(x, y - 80, '🎭', 34, 1.3); this.ring(x, y, 90, c.main, 0.7, 6); break;
      case 'snatch': this.emoji(x, y - 80, '🫳', 34, 1.3); if (e.res) this.text(x, y - 110, `${e.res} snatched`, '#fff', 16, '#4b2a8a', 1.4); break;
      case 'worm': this.shake = Math.max(this.shake, 8); this.burst(x, y, { n: lowFx ? 8 : 26, colors: ['#c9a46a', '#8a6a3a'], speed: 160, life: 0.8, size: 6, kind: 'puff' }); break;
      default:
        if (sp.target === 'area') {
          this.ring(e.x, e.y, sp.r || 110, c.light, 0.7, 7);
          for (let k = 0; k < (lowFx ? 5 : 14); k++) { const a = rand(0, TAU), r = rand(0, sp.r || 110); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.62, vx: rand(-15, 15), vy: rand(-40, -10), life: rand(0.8, 1.3), size: rand(10, 15), kind: 'emoji', text: sp.icon || '✨' }); }
        } else if (b) { this.emoji(x, y - 80, sp.icon || '✨', 32, 1.2); this.ring(x, y, 80, c.light, 0.6, 6); }
        else this.screenText(sp.icon || '✨', String(sp.name || '').toUpperCase() + '!', e.o);
    }
  }
  screenText(icon, text, owner) { this.timed.push({ kind: 'screentext', icon, text, owner, t: 0, dur: 1.4 }); }

  // ---------- particles ----------
  spawn(p) {
    if (this.parts.length > (this.fxLevel === 'low' ? 250 : 900)) return;
    p.t = 0; p.max = p.life; p.rot = p.rot ?? rand(0, TAU); p.vr = p.vr ?? rand(-5, 5);
    this.parts.push(p);
  }
  burst(x, y, o) {
    for (let k = 0; k < o.n; k++) {
      const a = rand(0, TAU), v = rand(0.3, 1) * o.speed;
      this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.75 - o.speed * 0.25, life: o.life * rand(0.7, 1.2), size: o.size * rand(0.7, 1.3), color: o.colors ? o.colors[k % o.colors.length] : o.color, kind: o.kind || 'dot', g: o.gravity || 0 });
    }
  }
  ring(x, y, r, color, dur, w) { this.timed.push({ kind: 'ring', x, y, r, color, t: 0, dur, w }); }
  text(x, y, str, color, size, outline, dur = 1) { this.spawn({ x, y, vx: 0, vy: -38, life: dur, size, color, kind: 'text', text: str, outline: outline || 'rgba(0,0,0,0.5)', rot: 0, vr: 0 }); }
  emoji(x, y, ch, size, dur) { this.spawn({ x, y, vx: 0, vy: -25, life: dur, size, kind: 'emoji', text: ch, rot: 0, vr: 0, pop: 1 }); }
  rain(x, y, ch, n) { for (let k = 0; k < n; k++) this.spawn({ x: x + rand(-50, 50), y: y - rand(120, 220), vx: rand(-10, 10), vy: rand(120, 200), life: 0.9, size: rand(14, 20), kind: 'emoji', text: ch, rot: 0, vr: 0, g: 200, stopY: y - 10 }); }
  emoteBubble(x, y, id, o) { this.timed.push({ kind: 'emote', x, y, id, o, t: 0, dur: 2.4 }); }

  updateParticles(ctx, dt) {
    const P = this.parts;
    for (let k = P.length - 1; k >= 0; k--) {
      const p = P[k];
      p.t += dt;
      if (p.t >= p.max) { P[k] = P[P.length - 1]; P.pop(); continue; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.stopY != null && p.y > p.stopY) { p.y = p.stopY; p.vy = 0; p.vx *= 0.5; }
      if (p.kind !== 'text' && p.kind !== 'emoji') { p.vx *= 0.96; p.vy *= p.g ? 1 : 0.96; }
      const life = 1 - p.t / p.max;
      ctx.globalAlpha = Math.min(1, life * 2);
      switch (p.kind) {
        case 'dot': ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * life + 0.5, 0, TAU); ctx.fill(); break;
        case 'puff': ctx.fillStyle = p.color; ctx.globalAlpha = life * 0.75; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - life * 0.6), 0, TAU); ctx.fill(); break;
        case 'bubble': ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.t * 4) * 4, p.y, p.size, 0, TAU); ctx.stroke(); break;
        case 'star': star(ctx, p.x, p.y, p.size * (0.6 + life * 0.6), p.rot, p.color); break;
        case 'heart': heart(ctx, p.x, p.y, p.size * 1.2, p.color); break;
        case 'confetti': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); break;
        case 'text': {
          const s = this.textScale * p.size * (p.t < 0.12 ? 0.6 + p.t / 0.12 * 0.5 : 1.1 - Math.min(0.1, (p.t - 0.12)));
          ctx.font = FONT(700, s); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 4; ctx.strokeStyle = p.outline; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
          if (p.t > 0.25) p.vy *= 0.92;
          break;
        }
        case 'emoji': {
          const s = this.textScale * (p.pop && p.t < 0.2 ? p.size * (0.4 + p.t / 0.2 * 0.8) : p.size);
          ctx.font = FONT(400, s); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.text, p.x, p.y);
          if (p.pop) p.vy *= 0.94;
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawDecals(ctx, dt) {
    for (let k = this.decals.length - 1; k >= 0; k--) {
      const d = this.decals[k];
      d.life -= dt;
      if (d.life <= 0) { this.decals.splice(k, 1); continue; }
      const a = Math.min(1, d.life / d.max * 1.5) * 0.35;
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
      g.addColorStop(0, `rgba(${d.color},${a})`); g.addColorStop(1, `rgba(${d.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.6, 0, 0, TAU); ctx.fill();
    }
  }

  drawProjectiles(ctx, V, dt) {
    for (let k = this.projs.length - 1; k >= 0; k--) {
      const p = this.projs[k];
      p.t += dt;
      if (p.t < 0) continue;
      if (p.sid != null) { const s = V.squadById.get(p.sid); if (s) { p.x1 = s.x; p.y1 = s.y - 8; } }
      const u = Math.min(1, p.t / p.dur);
      if (u >= 1) {
        this.projs.splice(k, 1);
        if (p.sid != null) this.burst(p.x1, p.y1, { n: 4, color: p.hacked ? '#7dff9a' : '#e8d3b0', speed: 50, life: 0.35, size: 3, kind: 'puff' });
        continue;
      }
      const x = lerp(p.x0, p.x1, u), y = lerp(p.y0, p.y1, u) - Math.sin(u * Math.PI) * (p.soul ? 40 : 28);
      if (p.soul) { ctx.globalAlpha = 0.8; ctx.font = FONT(400, 14); ctx.textAlign = 'center'; ctx.fillText('👻', x, y); ctx.globalAlpha = 1; continue; }
      if (p.data) { ctx.fillStyle = '#7ff6ff'; ctx.fillRect(x - 3, y - 3, 6, 6); continue; }
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(lerp(p.x0, p.x1, u), lerp(p.y0, p.y1, u) + 10, 4, 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.hacked ? '#59e07a' : '#a0784f';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = p.hacked ? '#c8ffd6' : '#d9b98c';
      ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2.2, 0, TAU); ctx.fill();
    }
  }

  drawTimed(ctx, V, dt, time) {
    for (let k = this.timed.length - 1; k >= 0; k--) {
      const e = this.timed[k];
      e.t += dt;
      if (e.t >= e.dur) {
        this.timed.splice(k, 1);
        if (e.kind === 'shuriken' || e.kind === 'cannon') {
          this.burst(e.x, e.y, { n: e.kind === 'cannon' ? 26 : 6, colors: ['#ffd84d', '#fff', '#ff7a2f', '#555'], speed: e.kind === 'cannon' ? 200 : 100, life: 0.6, size: 5, kind: e.kind === 'cannon' ? 'puff' : 'star' });
          if (e.kind === 'cannon') this.shake = Math.max(this.shake, 8);
        }
        if (e.kind === 'flop') { this.ring(e.x, e.y, e.r * 1.2, '#ffcf8a', 0.5, 12); this.burst(e.x, e.y, { n: 36, colors: ['#e8d3b0', '#c2a27a', '#fff'], speed: 240, life: 0.8, size: 8, kind: 'puff' }); this.shake = Math.max(this.shake, 14); }
        continue;
      }
      const u = e.t / e.dur;
      if (e.t < 0) continue;
      switch (e.kind) {
        case 'ring':
          ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - u; ctx.lineWidth = e.w * (1 - u) + 1;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * ease(u), e.r * ease(u) * 0.62, 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'meteor': {
          ctx.save();
          ctx.strokeStyle = `rgba(255,90,60,${0.5 + 0.5 * Math.sin(time * 20)})`; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
          ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.62, 0, 0, TAU); ctx.stroke();
          ctx.fillStyle = 'rgba(255,90,60,0.12)'; ctx.fill();
          ctx.restore();
          const mx = lerp(e.x + 380, e.x, ease(u * u)), my = lerp(e.y - 700, e.y, u * u);
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.ellipse(e.x, e.y, 20 * u + 4, (20 * u + 4) * 0.5, 0, 0, TAU); ctx.fill();
          for (let j = 0; j < 6; j++) this.fxLevel !== 'low' && this.spawn({ x: mx + rand(-8, 8), y: my + rand(-8, 8), vx: rand(10, 40), vy: rand(-60, -20), life: 0.4, size: rand(5, 10), color: j % 2 ? '#ffb347' : '#ff5a2f', kind: 'puff' });
          ctx.fillStyle = '#e8473f'; ctx.beginPath(); ctx.arc(mx, my, 22, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#ff9a8a'; ctx.lineWidth = 3;
          for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(mx, my, 22, j * 0.8 + time * 3, j * 0.8 + time * 3 + 1.8); ctx.stroke(); }
          break;
        }
        case 'shuriken': {
          const x = lerp(e.sx, e.x, u), y = lerp(e.sy, e.y, u);
          star(ctx, x, y, 10, time * 25, '#d6dbe6', 4);
          break;
        }
        case 'cannon': {
          const x = lerp(e.sx, e.x, u), y = lerp(e.sy, e.y, u) - Math.sin(u * Math.PI) * 160;
          ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.fill();
          ctx.fillStyle = '#6b6b78'; ctx.beginPath(); ctx.arc(x - 3, y - 3, 4, 0, TAU); ctx.fill();
          break;
        }
        case 'flop': {
          const s = 1 - u;
          ctx.fillStyle = `rgba(0,0,0,${0.15 + u * 0.25})`;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (0.3 + u * 0.7), e.r * (0.3 + u * 0.7) * 0.5, 0, 0, TAU); ctx.fill();
          ctx.font = FONT(400, 60 + u * 40); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('🐈', e.x, e.y - 260 * s * s - 20);
          break;
        }
        case 'firering': {
          const rr = e.r * ease(u);
          ctx.strokeStyle = `rgba(255,110,40,${1 - u})`; ctx.lineWidth = 14 * (1 - u) + 3;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, rr, rr * 0.62, 0, 0, TAU); ctx.stroke();
          if (this.fxLevel !== 'low') for (let j = 0; j < 4; j++) { const a = rand(0, TAU); this.spawn({ x: e.x + Math.cos(a) * rr, y: e.y + Math.sin(a) * rr * 0.62, vx: 0, vy: -50, life: 0.4, size: rand(6, 11), color: j % 2 ? '#ffb347' : '#ff5a2f', kind: 'puff' }); }
          break;
        }
        case 'beam': {
          const a = Math.sin(u * Math.PI);
          const g = ctx.createLinearGradient(e.x - 30, 0, e.x + 30, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, hexA(e.color, 0.85 * a)); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(e.x - 34, -50, 68, e.y + 50);
          ctx.fillStyle = `rgba(255,255,255,${0.7 * a})`; ctx.fillRect(e.x - 6, -50, 12, e.y + 50);
          break;
        }
        case 'reticle': {
          const b = V.byId.get(e.b);
          const x = b ? b.x : e.x, y = b ? b.y : e.y;
          const r = 90 - u * 50;
          ctx.save(); ctx.translate(x, y); ctx.rotate(time * 2);
          ctx.strokeStyle = `rgba(127,246,255,${0.6 + 0.4 * Math.sin(time * 18)})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
          for (let j = 0; j < 4; j++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r - 14, 0); ctx.lineTo(r + 14, 0); ctx.stroke(); }
          ctx.restore();
          ctx.fillStyle = `rgba(127,246,255,${0.15 + u * 0.3})`; ctx.fillRect(x - 3 - u * 6, -40, 6 + u * 12, y + 40);
          break;
        }
        case 'ufo': {
          const hover = Math.sin(time * 4) * 6;
          const yy = e.y - 150 + hover;
          const a = u < 0.15 ? u / 0.15 : u > 0.85 ? (1 - u) / 0.15 : 1;
          ctx.globalAlpha = a;
          const g = ctx.createLinearGradient(0, yy, 0, e.y + 20);
          g.addColorStop(0, 'rgba(160,255,200,0.55)'); g.addColorStop(1, 'rgba(160,255,200,0.05)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(e.x - 25, yy + 10); ctx.lineTo(e.x + 25, yy + 10); ctx.lineTo(e.x + e.r, e.y + 10); ctx.lineTo(e.x - e.r, e.y + 10); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#9fb3c8'; ctx.beginPath(); ctx.ellipse(e.x, yy, 58, 18, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#c9f7ff'; ctx.beginPath(); ctx.ellipse(e.x, yy - 10, 26, 20, 0, Math.PI, TAU); ctx.fill();
          for (let j = 0; j < 5; j++) { ctx.fillStyle = (Math.floor(time * 8) + j) % 2 ? '#ffe066' : '#ff6a8a'; ctx.beginPath(); ctx.arc(e.x - 40 + j * 20, yy + 4, 4, 0, TAU); ctx.fill(); }
          ctx.font = FONT(400, 18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🐱', e.x, yy - 14);
          ctx.globalAlpha = 1;
          break;
        }
        case 'zapline': {
          ctx.strokeStyle = `rgba(150,255,200,${1 - u})`; ctx.lineWidth = 4 * (1 - u) + 1;
          ctx.beginPath(); ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); ctx.stroke();
          break;
        }
        case 'laser': {
          const jx = e.x + Math.sin(time * 7.3) * 30 + Math.sin(time * 13.1) * 12, jy = e.y + Math.cos(time * 5.7) * 18 + Math.cos(time * 11.3) * 8;
          ctx.fillStyle = 'rgba(255,30,30,0.35)'; ctx.beginPath(); ctx.arc(jx, jy, 12, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(jx, jy, 5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(jx - 1.5, jy - 1.5, 1.6, 0, TAU); ctx.fill();
          break;
        }
        case 'vacuum': {
          const x = lerp(e.x - e.r - 40, e.x + e.r + 40, u), y = e.y + Math.sin(u * TAU * 2) * 30;
          ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x, y + 10, 36, 12, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3a3f4b'; ctx.beginPath(); ctx.ellipse(x, y, 34, 22, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#5c6474'; ctx.beginPath(); ctx.ellipse(x, y - 5, 26, 14, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = Math.floor(time * 6) % 2 ? '#42ff8a' : '#1f9a52'; ctx.beginPath(); ctx.arc(x + 14, y - 6, 3, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ff4d4d'; ctx.fillRect(x - 12, y - 9, 10, 3);
          if (this.fxLevel !== 'low') this.spawn({ x: x - 30, y: y + rand(-8, 8), vx: -40, vy: rand(-10, 10), life: 0.5, size: 6, color: '#cfc6ba', kind: 'puff' });
          break;
        }
        case 'screentext': {
          const a = u < 0.15 ? u / 0.15 : u > 0.75 ? (1 - u) / 0.25 : 1;
          const s = 1 + (u < 0.15 ? (1 - u / 0.15) * 0.6 : 0);
          ctx.save();
          ctx.globalAlpha = a;
          const f = this.fit || { x0: 0, y0: 0, x1: this.VW, y1: this.VH };
          const fitS = Math.min(1, (f.x1 - f.x0) * 0.9 / 820);   // keep the big text inside a narrow field
          ctx.translate((f.x0 + f.x1) / 2, f.y0 + (f.y1 - f.y0) * 0.42);
          ctx.scale(s * fitS, s * fitS);
          ctx.font = FONT(700, 64); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 10; ctx.strokeStyle = teamColor(e.owner).dark; ctx.strokeText(`${e.icon} ${e.text}`, 0, 0);
          ctx.fillStyle = '#fff'; ctx.fillText(`${e.icon} ${e.text}`, 0, 0);
          ctx.restore();
          break;
        }
        case 'emote': {
          const a = u < 0.1 ? u / 0.1 : u > 0.85 ? (1 - u) / 0.15 : 1;
          const s = u < 0.1 ? 0.5 + u / 0.1 * 0.5 : 1;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(e.x, e.y - u * 14);
          ctx.scale(s, s);
          ctx.fillStyle = '#fff'; ctx.strokeStyle = teamColor(e.o).main; ctx.lineWidth = 3;
          rr(ctx, -42, -30, 84, 46, 18); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-8, 15); ctx.lineTo(0, 28); ctx.lineTo(8, 15); ctx.closePath(); ctx.fill();
          ctx.font = FONT(400, 28); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(EMOJI[e.id] || '😺', 0, -7);
          ctx.restore();
          break;
        }
      }
    }
  }

  // ---------- status effect helpers ----------
  bubble(ctx, x, y, r, rgb, t) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, rgb + '0.10)'); g.addColorStop(0.8, rgb + '0.22)'); g.addColorStop(1, rgb + '0.5)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgb + (0.6 + 0.3 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r * 0.82, -2.4, -1.7); ctx.stroke();
  }
  portalFx(ctx, x, y, r, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.5);
    for (let k = 0; k < 3; k++) {
      ctx.rotate(t * (1.5 + k * 0.4));
      ctx.strokeStyle = `rgba(${150 + k * 30},100,255,${0.55 - k * 0.12})`; ctx.lineWidth = 6 - k;
      ctx.beginPath(); ctx.arc(0, 0, r * (1 - k * 0.18), 0, Math.PI * 1.3); ctx.stroke();
    }
    ctx.restore();
  }
  fortifyFx(ctx, b, t) {
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU;
      const x = b.x + Math.cos(a) * b.radius * 1.2, y = b.y + b.radius * 0.25 + Math.sin(a) * b.radius * 0.68;
      ctx.fillStyle = k % 2 ? '#9c8a70' : '#b8a68a';
      ctx.fillRect(x - 7, y - 12, 14, 14);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x - 7, y, 14, 2);
    }
  }
  flameRing(ctx, b, t) {
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * TAU + t;
      const x = b.x + Math.cos(a) * b.radius * 1.15, y = b.y + b.radius * 0.2 + Math.sin(a) * b.radius * 0.62;
      const h = 10 + Math.sin(t * 9 + k) * 4;
      ctx.fillStyle = k % 2 ? 'rgba(255,120,40,0.85)' : 'rgba(255,200,60,0.85)';
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.quadraticCurveTo(x, y - h * 2, x + 5, y); ctx.fill();
    }
  }
  stinkFx(ctx, b, t) {
    for (let k = 0; k < 5; k++) {
      const ph = (t * 0.6 + k / 5) % 1;
      const x = b.x + Math.sin(k * 2.1 + t) * b.radius * 0.6, y = b.y - b.radius * 0.8 - ph * 50;
      ctx.strokeStyle = `rgba(120,200,60,${0.8 * (1 - ph)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.bezierCurveTo(x + 8, y + 8, x - 8, y + 4, x, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,200,60,0.12)'; ctx.beginPath(); ctx.ellipse(b.x, b.y - b.radius * 0.3, b.radius * 1.3, b.radius, 0, 0, TAU); ctx.fill();
  }
  curseFx(ctx, b, t) {
    ctx.fillStyle = `rgba(110,40,180,${0.18 + 0.08 * Math.sin(t * 5)})`;
    ctx.beginPath(); ctx.ellipse(b.x, b.y - b.radius * 0.3, b.radius * 1.35, b.radius * 1.05, 0, 0, TAU); ctx.fill();
    if (Math.random() < 0.2 && this.fxLevel !== 'low') this.spawn({ x: b.x + rand(-b.radius, b.radius), y: b.y - rand(0, b.radius), vx: 0, vy: -30, life: 1, size: 4, color: '#b48cff', kind: 'dot' });
  }
  sparksFx(ctx, b, t) {
    if (Math.random() < 0.3 && this.fxLevel !== 'low') this.spawn({ x: b.x + rand(-20, 20), y: b.y - b.radius * rand(0.5, 1.4), vx: rand(-60, 60), vy: rand(-80, -20), life: 0.4, size: 2.5, color: '#ffd84d', kind: 'dot', g: 300 });
    if (Math.random() < 0.15 && this.fxLevel !== 'low') this.spawn({ x: b.x + rand(-15, 15), y: b.y - b.radius * 1.2, vx: rand(-8, 8), vy: -30, life: 1.2, size: 9, color: 'rgba(70,70,80,0.6)', kind: 'puff' });
  }
  iconOrbit(ctx, b, t, ch, n) {
    ctx.font = FONT(400, 16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < n; k++) { const a = t * 1.5 + k * TAU / n; ctx.fillText(ch, b.x + Math.cos(a) * b.radius * 1.1, b.y - b.radius * 0.6 + Math.sin(a) * b.radius * 0.4); }
  }
  hackFx(ctx, b, t) {
    ctx.font = FONT(700, 11); ctx.fillStyle = '#5dff8a'; ctx.textAlign = 'center';
    for (let k = 0; k < 10; k++) {
      const ph = (t * 0.9 + k * 0.137) % 1;
      ctx.globalAlpha = 1 - ph;
      ctx.fillText(((k * 7 + Math.floor(t * 8)) % 2) ? '1' : '0', b.x + Math.sin(k * 3.7) * b.radius, b.y - b.radius * 1.8 + ph * b.radius * 1.6);
    }
    ctx.globalAlpha = 1;
  }
  /** Big Freeze: ice creeping over the whole screen */
  frostFx(ctx, a, t) {
    const W = this.w, H = this.h;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.12, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, `rgba(220,240,255,${0.28 * a})`); g.addColorStop(0.6, `rgba(200,230,255,${0.6 * a})`); g.addColorStop(1, `rgba(235,248,255,${0.92 * a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.7 * a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    const seed = 7;
    for (let k = 0; k < 26; k++) {
      const ex = ((k * 197 + seed) % 100) / 100, edge = k % 4;
      const x0 = edge === 0 ? 0 : edge === 1 ? W : ex * W, y0 = edge === 2 ? 0 : edge === 3 ? H : ex * H;
      const ang = Math.atan2(H / 2 - y0, W / 2 - x0) + (((k * 53) % 10) - 5) / 10;
      let x = x0, y = y0; const len = (0.12 + ((k * 31) % 10) / 60) * Math.min(W, H);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 1; j <= 5; j++) { x += Math.cos(ang + (j % 2 ? 0.4 : -0.4)) * len / 5; y += Math.sin(ang + (j % 2 ? 0.4 : -0.4)) * len / 5; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.restore();
  }
  /** Big Cauldron: a pot sitting over the building */
  cauldronFx(ctx, b, t) {
    const r = b.radius * 1.15, y = b.y - b.radius * 0.35;
    ctx.save();
    ctx.fillStyle = '#2f2b33'; ctx.strokeStyle = '#121016'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(b.x, y, r, r * 0.85, 0, 0, Math.PI); ctx.lineTo(b.x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(b.x, y, r * 1.02, r * 0.3, 0, 0, TAU); ctx.fillStyle = '#45404a'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(b.x, y, r * 0.85, r * 0.22, 0, 0, TAU); ctx.fillStyle = '#6fd65a'; ctx.fill();
    for (let k = 0; k < 4; k++) { const ph = (t * 0.9 + k / 4) % 1; ctx.fillStyle = `rgba(160,240,120,${1 - ph})`; ctx.beginPath(); ctx.arc(b.x + Math.sin(k * 2.3) * r * 0.5, y - ph * 26, 3 + ph * 3, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  /** Hypnotize: a slow spiral over the building waiting for your order */
  hypnoFx(ctx, b, t) {
    ctx.save(); ctx.translate(b.x, b.y - b.radius * 0.6); ctx.rotate(t * 3);
    ctx.strokeStyle = 'rgba(190,120,255,0.75)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k < 60; k++) { const a = k * 0.32, r = k * b.radius * 0.022; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.62); }
    ctx.stroke(); ctx.restore();
  }
  turretFx(ctx, b, t) {
    const x = b.x + b.radius * 0.5, y = b.y - b.radius * 1.5;
    ctx.fillStyle = '#5c6474'; ctx.fillRect(x - 8, y - 4, 16, 10);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 2) * 0.6);
    ctx.fillStyle = '#3a3f4b'; ctx.fillRect(0, -3, 16, 6); ctx.restore();
  }
}

export function spellTargetOk(sp, b, me) {
  return targetOk(sp.target, b, me) && !bfxHas(b, 'cauldron');
}

const EMOJI = { meow: '😺', gg: '🤝', hiss: '😾', lol: '😹', love: '😻', wow: '🙀', nap: '😴', fish: '🐟' };

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function star(ctx, x, y, r, rot, color, points = 5) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color; ctx.beginPath();
  for (let k = 0; k < points * 2; k++) { const rad = k % 2 ? r * 0.45 : r; const a = k * Math.PI / points; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function heart(ctx, x, y, s, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.35);
  ctx.fill();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
