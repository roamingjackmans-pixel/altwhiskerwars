// Whisker Wars renderer: draws the battlefield, cats, effects and drag/targeting overlays.
import { WORLD_W, WORLD_H, BUILDINGS, THEMES, TURRET, teamColor, findSpell } from '../shared/data.js';
import { BFX, SFX } from '../shared/game.js';
import { getNav, transformObstacles } from '../shared/nav.js';
import * as art from './art.js';

const BIT = {}; BFX.forEach((n, i) => { BIT['b_' + n] = 1 << i; }); SFX.forEach((n, i) => { BIT['s_' + n] = 1 << i; });
const has = (mask, name) => (mask & BIT[name]) !== 0;
const FONT = (w, s) => `${w} ${s}px Fredoka, "Baloo 2", "Trebuchet MS", system-ui, sans-serif`;
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
    if (this.fxLevel !== 'low') { try { art.setArtSize(VW, VH); art.drawAmbient(ctx, this.theme, t); } catch { /* optional */ } }
    for (const b of V.buildings) this.drawBadge(ctx, b);
    for (const s of V.squads) if (!has(s.fx, 's_wait')) this.drawSquadBadge(ctx, s);
    if (ui) this.drawOverlayUI(ctx, V, ui, t);

    // eclipse / screen tints
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const me = V.players[this.me];
    if (me && (me.buffs & 4)) { this.dim = Math.min(1, this.dim + dt * 2); } else this.dim = Math.max(0, this.dim - dt * 1.5);
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
    if (has(b.fx, 'b_shadowstep')) this.portalFx(ctx, b.x, b.y + rad * 0.15, rad * 1.05, t);
    if (has(b.fx, 'b_fortify')) this.fortifyFx(ctx, b, t);
    try {
      art.drawBuilding(ctx, { x: b.x, y: b.y, type: b.type, level: b.level, owner: b.owner, radius: rad, flags: b.fx, hover, selected: sel, hit }, t);
    } catch (e) {
      ctx.fillStyle = teamColor(b.owner).main; ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, TAU); ctx.fill();
    }
    // status overlays
    if (has(b.fx, 'b_shield')) this.bubble(ctx, b.x, b.y - rad * 0.55, rad * 1.45, 'rgba(140,210,255,', t);
    if (has(b.fx, 'b_firewall')) this.flameRing(ctx, b, t);
    if (has(b.fx, 'b_stink')) this.stinkFx(ctx, b, t);
    if (has(b.fx, 'b_curse')) this.curseFx(ctx, b, t);
    if (has(b.fx, 'b_disabled')) this.sparksFx(ctx, b, t);
    if (has(b.fx, 'b_tea')) this.iconOrbit(ctx, b, t, '🫖', 1);
    if (has(b.fx, 'b_frozen')) this.iconOrbit(ctx, b, t, '❄️', 3);
    if (has(b.fx, 'b_hack')) this.hackFx(ctx, b, t);
    if (has(b.fx, 'b_turret')) this.turretFx(ctx, b, t);
  }

  drawBadge(ctx, b) {
    const c = teamColor(b.owner);
    // (another player's cats are hidden: count -1, shown as "?" until your Owl Scout flies over)
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
    const moving = !(frozen || asleep || stun);
    const left = has(s.fx, 's_left');
    const stealth = has(s.fx, 's_stealth');
    const slow = has(s.fx, 's_slow');
    const owner = V.players[s.owner];
    ctx.save();
    const us = this.unitScale;
    if (us !== 1) { ctx.translate(s.x, s.y); ctx.scale(us, us); ctx.translate(-s.x, -s.y); }
    if (stealth) ctx.globalAlpha = s.owner === this.me ? 0.45 : 0.1;
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
    if (has(s.fx, 's_haste') || (owner && (owner.buffs & 1))) {
      if (this.fxLevel !== 'low' && Math.random() < 0.35) this.spawn({ x: s.x + rand(-r, r) * 0.6, y: s.y + rand(-4, 2), vx: left ? 30 : -30, vy: -10, life: 0.35, size: 3, color: has(s.fx, 's_haste') ? '#ff7a2f' : '#ffd84d', kind: 'dot' });
    }
    if (owner && (owner.buffs & 2) && this.fxLevel !== 'low' && Math.random() < 0.08) this.spawn({ x: s.x, y: s.y - 14, vx: rand(-10, 10), vy: -25, life: 0.6, size: 4, color: '#fff3c4', kind: 'dot' });
    // high Purr Power: golden stars twinkle off the whole army
    if (owner && owner.stars >= 3 && this.fxLevel !== 'low' && Math.random() < 0.035 * (owner.stars - 2)) this.spawn({ x: s.x + rand(-r, r) * 0.7, y: s.y - 10 - rand(0, 12), vx: rand(-8, 8), vy: -28, life: 0.7, size: 3.5 + owner.stars * 0.4, color: owner.stars >= 5 ? '#ffe066' : '#ffd23d', kind: 'star' });
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
    if (hb && (BUILDINGS[hb.type].range || has(hb.fx, 'b_turret'))) {
      const def = BUILDINGS[hb.type];
      const range = def.range ? def.range[hb.level - 1] : TURRET.range;
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
        ctx.beginPath(); ctx.arc(x, y, sp.radius, 0, TAU); ctx.fill(); ctx.stroke();
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
        if (e.fx === 'meteor') {
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
    if (sp.target === 'area') this.ring(e.x, e.y, sp.radius, '#ffffff', 0.45, 4);
    switch (e.fx) {
      case 'rally': for (const q of myB) this.ring(q.x, q.y, q.radius * 1.8, '#ffd84d', 0.6, 4); this.screenText('📯', 'RALLY!', e.o); break;
      case 'shield': this.burst(x, y - 30, { n: 18, colors: ['#bfe6ff', '#fff'], speed: 120, life: 0.7, size: 4, kind: 'star' }); break;
      case 'upgrade': this.emoji(x, y - 60, '📜', 34, 1.2); break;
      case 'meteor': this.timed.push({ kind: 'meteor', x: e.x, y: e.y, r: sp.radius, t: 0, dur: sp.delay || 1.2 }); break;
      case 'frost':
        this.ring(e.x, e.y, sp.radius, '#bfefff', 0.7, 8);
        for (let k = 0; k < (lowFx ? 8 : 26); k++) { const a = rand(0, TAU), r = rand(0, sp.radius); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.7, vx: rand(-15, 15), vy: rand(-40, -10), life: rand(0.8, 1.6), size: rand(10, 16), kind: 'emoji', text: '❄️' }); }
        break;
      case 'polymorph': this.burst(x, y - 30, { n: 30, colors: ['#e0a6ff', '#ff9ad5', '#fff'], speed: 160, life: 1, size: 6, kind: 'star' }); this.emoji(x, y - 70, '🪄', 30, 1); break;
      case 'smoke':
        for (let k = 0; k < (lowFx ? 10 : 30); k++) { const a = rand(0, TAU), r = rand(0, sp.radius); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.7, vx: rand(-20, 20), vy: rand(-25, -5), life: rand(1.2, 2.2), size: rand(14, 26), color: '#6d6a7a', kind: 'puff' }); }
        break;
      case 'shuriken': for (let k = 0; k < 6; k++) this.timed.push({ kind: 'shuriken', x, y: y - 20, sx: x + rand(-400, 400), sy: -40, t: -k * 0.08, dur: 0.45 }); break;
      case 'portal': this.ring(x, y, 70, '#b48cff', 0.6, 5); break;
      case 'feast': this.rain(x, y, '🐟', lowFx ? 5 : 12); this.text(x, y - 80, '+12', '#fff', 20, '#2f8a3a', 1.2); break;
      case 'pepper':
        this.ring(e.x, e.y, sp.radius, '#ff5a2f', 0.6, 8);
        for (let k = 0; k < (lowFx ? 6 : 18); k++) { const a = rand(0, TAU), r = rand(0, sp.radius); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.7, vx: 0, vy: -50, life: 0.9, size: 14, kind: 'emoji', text: '🌶️' }); }
        break;
      case 'stink': this.emoji(x, y - 70, '🥫', 30, 1); break;
      case 'flop':
        this.timed.push({ kind: 'flop', x: e.x, y: e.y, r: sp.radius, t: 0, dur: 0.45 });
        break;
      case 'fortify': this.burst(x, y, { n: 16, colors: ['#c9b79a', '#8a7a64'], speed: 90, life: 0.8, size: 6, kind: 'puff' }); break;
      case 'nap': for (const q of enemyS) this.emoji(q.x, q.y - 30, '💤', 18, 1.4); this.screenText('😴', 'NAP TIME!', e.o); break;
      case 'tea': this.emoji(x, y - 70, '🫖', 30, 1.2); this.burst(x, y - 40, { n: 14, colors: ['#ffd1e8', '#fff'], speed: 80, life: 1, size: 5, kind: 'heart' }); break;
      case 'bribe': this.rain(x, y, '💰', 8); this.burst(x, y - 30, { n: 24, colors: ['#ffd84d', '#fff2a8'], speed: 180, life: 1, size: 5, kind: 'star' }); break;
      case 'golden': for (const q of myB) { this.burst(q.x, q.y - 30, { n: lowFx ? 4 : 12, colors: ['#ffd84d', '#fff'], speed: 90, life: 1, size: 4, kind: 'star' }); this.text(q.x, q.y - q.radius * 1.8, '+3', '#fff', 15, '#b8851d'); } break;
      case 'cannon': {
        const from = this.homeOf(V, e.o) || { x: x < 800 ? -40 : 1640, y: 200 };
        this.timed.push({ kind: 'cannon', x, y: y - 20, sx: from.x, sy: from.y - 40, t: 0, dur: 0.6 });
        break;
      }
      case 'grog': for (const q of myB) this.emoji(q.x, q.y - q.radius * 1.8, '🍺', 22, 1); this.screenText('🍺', 'GROG RUSH!', e.o); break;
      case 'mutiny': this.ring(e.x, e.y, sp.radius * 1.2, '#222', 0.6, 8); for (let k = 0; k < 8; k++) this.emoji(e.x + rand(-60, 60), e.y + rand(-40, 40), '🏴‍☠️', 20, 1.2); if (e.res && e.res !== '0') this.text(e.x, e.y - 60, `+${e.res} defected!`, '#fff', 18, '#222', 1.4); break;
      case 'coin': {
        const home = this.homeOf(V, e.o);
        const label = e.res === 'catnip' ? '+30 catnip!' : e.res === 'cats' ? '+3 cats everywhere!' : 'Free upgrade!';
        if (home) { this.emoji(home.x, home.y - 90, '🪙', 34, 1.2); this.text(home.x, home.y - 120, label, '#fff', 17, '#b8851d', 1.6); }
        break;
      }
      case 'beckon': this.emoji(x, y - 80, '🐾', 34, 1.3); this.burst(x, y - 40, { n: 16, colors: ['#ff9ad5', '#fff'], speed: 90, life: 1, size: 5, kind: 'heart' }); break;
      case 'jackpot': this.emoji(x, y - 80, '🎰', 36, 1.3); this.rain(x, y, '🪙', 10); this.burst(x, y - 40, { n: 30, colors: ['#ffd84d', '#ff6a8a', '#7dd3ff'], speed: 200, life: 1.2, size: 5, kind: 'confetti', gravity: 220 }); break;
      case 'zerog':
        this.ring(e.x, e.y, sp.radius, '#c4a6ff', 0.8, 6);
        for (let k = 0; k < (lowFx ? 6 : 20); k++) { const a = rand(0, TAU), r = rand(0, sp.radius); this.spawn({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.7, vx: 0, vy: -20, life: 2, size: rand(5, 10), color: 'rgba(196,166,255,0.8)', kind: 'bubble' }); }
        break;
      case 'tractor': this.timed.push({ kind: 'ufo', x: e.x, y: e.y, r: sp.radius, t: 0, dur: 1.8 }); break;
      case 'orbital': this.timed.push({ kind: 'reticle', b: e.b, x, y, t: 0, dur: sp.delay || 2.5 }); break;
      case 'laser': this.timed.push({ kind: 'laser', x: e.x, y: e.y, r: sp.radius, t: 0, dur: sp.dur || 4 }); break;
      case 'turret': this.burst(x, y - 50, { n: 12, colors: ['#bbb', '#fff'], speed: 90, life: 0.6, size: 4, kind: 'star' }); break;
      case 'vacuum': this.timed.push({ kind: 'vacuum', x: e.x, y: e.y, r: sp.radius, t: 0, dur: 1.4 }); break;
      case 'moon': this.timed.push({ kind: 'beam', x, y, t: 0, dur: 1.0, color: '#e6e9ff' }); this.burst(x, y - 30, { n: 20, colors: ['#e6e9ff', '#b9c4ff'], speed: 100, life: 1.2, size: 4, kind: 'star', gravity: -30 }); break;
      case 'curse': this.emoji(x, y - 80, '🐈‍⬛', 34, 1.4); this.ring(x, y, 80, '#7b3fbf', 0.7, 6); break;
      case 'eclipse': this.screenText('🌑', 'ECLIPSE!', e.o); break;
      case 'firewall': this.ring(x, y, 70, '#ff7a2f', 0.6, 6); break;
      case 'hack': this.text(x, y - 90, 'HACKED!', '#7dff9a', 18, '#0b3d1a', 1.4); break;
      case 'drain': {
        const home = this.homeOf(V, e.o);
        const opp = V.buildings.filter(q => q.owner >= 0 && q.owner !== e.o);
        if (home) for (const q of opp.slice(0, 8)) this.projs.push({ x0: q.x, y0: q.y - 30, x1: home.x, y1: home.y - 30, t: -Math.random() * 0.3, dur: 0.9, data: 1 });
        if (home && e.res) this.text(home.x, home.y - 110, `+${e.res} catnip`, '#fff', 17, '#1b6f8a', 1.4);
        break;
      }
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
  turretFx(ctx, b, t) {
    const x = b.x + b.radius * 0.5, y = b.y - b.radius * 1.5;
    ctx.fillStyle = '#5c6474'; ctx.fillRect(x - 8, y - 4, 16, 10);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 2) * 0.6);
    ctx.fillStyle = '#3a3f4b'; ctx.fillRect(0, -3, 16, 6); ctx.restore();
  }
}

export function spellTargetOk(sp, b, me) {
  switch (sp.target) {
    case 'own': return b.owner === me;
    case 'enemy': return b.owner >= 0 && b.owner !== me;
    case 'neutral': return b.owner < 0;
    case 'notown': return b.owner !== me;
  }
  return false;
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
