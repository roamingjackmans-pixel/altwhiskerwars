// Whisker Wars - map terrain and pathfinding, shared by the simulation, the AI and the renderer.
//
// Obstacles (map.obstacles) come in three classes:
//   water  ('water', 'gap')                  impassable, but islands and bridges cut walkable land out of it
//   solid  ('mound', 'rock', 'gumdrop', 'hedge', 'wall') impassable, always
//   pass   ('island', 'bridge')              walkable land laid over water
// and four shapes: circle {x,y,r}, ellipse {x,y,rx,ry,a}, polygon {poly:[[x,y],...]}, thick line {pts:[[x,y],...], w}.
//
// The field is rasterised once per map into a grid. Every building gets one Dijkstra tree (paths TO it from
// anywhere), so building-to-building routes and their lengths are worked out once when the map loads, and a
// route from any point (a squad turned around mid-field) is just a walk down that tree.
import { WORLD_W, WORLD_H, BUILDINGS } from './data.js';

export const NAV_COLS = 96, NAV_ROWS = 54;       // 1600/96 = 900/54: square cells, grid is point-symmetric
const CW = WORLD_W / NAV_COLS, CH = WORLD_H / NAV_ROWS;
export const CLEARANCE = 20;  // squads keep this far from water and walls
const EDGE = 26;              // ...and from the edge of the world
const BLD_PAD = 20;           // squads walk around other buildings by this much
const BLD_COST = 5;           // ...unless walking through is much shorter
const LOS_STEP = 4;

const CLASS = { water: 'water', gap: 'water', mound: 'solid', rock: 'solid', gumdrop: 'solid', hedge: 'solid', wall: 'solid', island: 'pass', bridge: 'pass' };
export function obstacleClass(t) { return CLASS[t] || 'solid'; }

// ---------------- geometry ----------------
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}
export function ellipsePoints(x, y, rx, ry, a = 0, n = 28) {
  const out = [], ca = Math.cos(a), sa = Math.sin(a);
  for (let k = 0; k < n; k++) {
    const u = k / n * Math.PI * 2, ex = Math.cos(u) * rx, ey = Math.sin(u) * ry;
    out.push([x + ex * ca - ey * sa, y + ex * sa + ey * ca]);
  }
  return out;
}

/** Turns map obstacles into plain shapes: { t, cls, g: 'circle'|'poly'|'line', x,y,r | pts, w, box } */
export function normalizeObstacles(list) {
  const out = [];
  for (const o of list || []) {
    if (!o || !o.t) continue;
    const s = { t: o.t, cls: obstacleClass(o.t) };
    if (Array.isArray(o.pts) && o.pts.length >= 2) { s.g = 'line'; s.pts = o.pts.map(p => [+p[0], +p[1]]); s.w = +o.w || 40; }
    else if (Array.isArray(o.poly) && o.poly.length >= 3) { s.g = 'poly'; s.pts = o.poly.map(p => [+p[0], +p[1]]); }
    else if (o.rx != null) { s.g = 'poly'; s.pts = ellipsePoints(+o.x, +o.y, +o.rx, +(o.ry ?? o.rx), +o.a || 0); }
    else if (o.r != null) { s.g = 'circle'; s.x = +o.x; s.y = +o.y; s.r = +o.r; }
    else continue;
    if (s.g === 'circle') s.box = [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
    else {
      const pad = s.g === 'line' ? s.w / 2 : 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      s.box = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }
    out.push(s);
  }
  return out;
}

/** Map obstacles moved through fwd(x, y) (e.g. the flipped / stood-up view), as circles, polygons and lines. */
export function transformObstacles(list, fwd) {
  return normalizeObstacles(list).map(s => {
    const P = p => { const v = fwd(p[0], p[1]); return [v.x, v.y]; };
    if (s.g === 'circle') { const v = fwd(s.x, s.y); return { t: s.t, x: v.x, y: v.y, r: s.r }; }
    if (s.g === 'line') return { t: s.t, pts: s.pts.map(P), w: s.w };
    return { t: s.t, poly: s.pts.map(P) };
  });
}

/** Signed distance from a point to a shape's edge (negative inside). */
export function shapeDist(s, x, y) {
  if (s.g === 'circle') { const dx = x - s.x, dy = y - s.y; return Math.sqrt(dx * dx + dy * dy) - s.r; }
  const P = s.pts;
  let best = Infinity;
  if (s.g === 'line') {
    for (let i = 0; i < P.length - 1; i++) best = Math.min(best, segDist2(x, y, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]));
    return Math.sqrt(best) - s.w / 2;
  }
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    best = Math.min(best, segDist2(x, y, xi, yi, xj, yj));
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}
function near(s, x, y, m) { const b = s.box; return x > b[0] - m && x < b[2] + m && y > b[1] - m && y < b[3] + m; }

/** blocked(x, y, margin): is this point inside an obstacle (or closer than margin to one)? */
export function makeBlockTest(shapes) {
  const water = shapes.filter(s => s.cls === 'water'), pass = shapes.filter(s => s.cls === 'pass'), solid = shapes.filter(s => s.cls === 'solid');
  return (x, y, m = 0) => {
    for (const s of solid) if (near(s, x, y, m) && shapeDist(s, x, y) < m) return true;
    let wet = false;
    for (const s of water) if (near(s, x, y, m) && shapeDist(s, x, y) < m) { wet = true; break; }
    if (!wet) return false;
    for (const s of pass) if (near(s, x, y, 0) && shapeDist(s, x, y) < -m) return false;
    return true;
  };
}

function navRadius(b) {
  if (b.r != null) return +b.r;
  const def = BUILDINGS[b.type];
  if (!def) return 40;
  return def.radius[Math.min(b.level || 1, def.radius.length) - 1];
}

// ---------------- heap ----------------
class Heap {
  constructor() { this.c = []; this.p = []; }
  get size() { return this.c.length; }
  less(i, j) { return this.p[i] < this.p[j] || (this.p[i] === this.p[j] && this.c[i] < this.c[j]); }
  swap(i, j) { let t = this.c[i]; this.c[i] = this.c[j]; this.c[j] = t; t = this.p[i]; this.p[i] = this.p[j]; this.p[j] = t; }
  push(c, p) {
    this.c.push(c); this.p.push(p);
    let i = this.c.length - 1;
    while (i > 0) { const u = (i - 1) >> 1; if (!this.less(i, u)) break; this.swap(i, u); i = u; }
  }
  pop() {
    const top = this.c[0], n = this.c.length - 1;
    this.c[0] = this.c[n]; this.p[0] = this.p[n]; this.c.pop(); this.p.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
}

// cell centres, computed so mirrored cells get exactly mirrored coordinates
function cellX(i) { return i < NAV_COLS / 2 ? (i + 0.5) * WORLD_W / NAV_COLS : WORLD_W - (NAV_COLS - i - 0.5) * WORLD_W / NAV_COLS; }
function cellY(j) { return j < NAV_ROWS / 2 ? (j + 0.5) * WORLD_H / NAV_ROWS : WORLD_H - (NAV_ROWS - j - 0.5) * WORLD_H / NAV_ROWS; }

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// ---------------- the nav mesh ----------------
export class Nav {
  /** buildings: [{id, x, y, r? | type+level}], obstacles: raw map obstacles */
  /** opts.rot3: [cx, cy] for 3-player maps that repeat three times around that point */
  constructor(buildings, obstacles, opts = {}) {
    this.rot3 = Array.isArray(opts.rot3) ? opts.rot3 : null;
    this.shapes = normalizeObstacles(obstacles);
    this.hasTerrain = this.shapes.length > 0;
    this.blockTest = makeBlockTest(this.shapes);
    this.B = buildings.map(b => ({ id: b.id, x: +b.x, y: +b.y, r: navRadius(b) }));
    this.index = new Map(this.B.map((b, k) => [b.id, k]));
    const N = NAV_COLS * NAV_ROWS;
    this.blocked = new Uint8Array(N);
    this.discA = new Int16Array(N).fill(-1);
    this.discB = new Int16Array(N).fill(-1);
    for (let j = 0; j < NAV_ROWS; j++) for (let i = 0; i < NAV_COLS; i++) {
      const x = cellX(i), y = cellY(j), c = j * NAV_COLS + i;
      if (x < EDGE || y < EDGE || x > WORLD_W - EDGE || y > WORLD_H - EDGE || this.blockTest(x, y, CLEARANCE)) this.blocked[c] = 1;
      for (let k = 0; k < this.B.length; k++) {
        const b = this.B[k], dx = x - b.x, dy = y - b.y, R = b.r + BLD_PAD;
        if (dx * dx + dy * dy > R * R) continue;
        if (this.discA[c] < 0) this.discA[c] = k; else if (this.discB[c] < 0) this.discB[c] = k;
      }
    }
    // a building always stands on walkable ground, even if a careless map squeezes it against a wall
    this.home = this.B.map(b => this.freeCell(b.x, b.y));
    this.dist = []; this.prev = [];
    for (let k = 0; k < this.B.length; k++) this.flood(k);
    // building-to-building routes: one polyline per pair, the return trip is the same road walked backwards
    const n = this.B.length;
    this.routes = new Array(n * n);
    this.lens = new Float64Array(n * n);
    this.unreachable = 0;
    // on a point-symmetric map, P1's road between two buildings is P0's road turned around the centre: fair to the pixel
    // (4-player maps are also mirrored left/right and top/bottom, so every corner gets the same roads)
    const syms = this.symmetries();
    for (let a = 0; a < n; a++) pairs: for (let b = a + 1; b < n; b++) {
      for (const { map: mir, inv, exact } of syms) {
        if (mir[a] < 0 || mir[b] < 0) continue;
        const ma = mir[a], mb = mir[b], twin = this.full && this.full[ma * n + mb];
        if (!twin || (ma === a && mb === b) || (ma === b && mb === a)) continue;
        // twin is the road between the images of a and b; carry it back onto a and b
        const turned = twin.map(inv);
        let ok = true;
        if (exact) {
          // mirrored on the same grid: the copy must pass the same line-of-sight test (a short step the original
          // took without a clear line of sight is fine for the copy too)
          for (let k = 1; k < turned.length && ok; k++) ok = this.los(turned[k - 1], turned[k], a, b) || !this.los(twin[k - 1], twin[k], ma, mb);
        } else ok = this.clearOfTerrain(turned);   // turned by 120°: check against the real obstacle shapes
        if (ok) { this.setRoute(a, b, turned); continue pairs; }
      }
      const full = this.route(a, b);
      if (!full) {
        this.unreachable++;
        const s = this.B[a], t = this.B[b];
        this.setRoute(a, b, [{ x: s.x, y: s.y }, { x: t.x, y: t.y }]);
      } else this.setRoute(a, b, full);
    }
  }

  /**
   * The map's symmetries (turned around the centre, mirrored left/right, mirrored top/bottom) that the terrain
   * really has: each with how to move a point and which building lands on which (-1 where none does).
   */
  symmetries() {
    const C = NAV_COLS, R = NAV_ROWS, out = [];
    const kinds = [
      { cell: (i, j) => (R - 1 - j) * C + (C - 1 - i), f: p => ({ x: WORLD_W - p.x, y: WORLD_H - p.y }) },
      { cell: (i, j) => j * C + (C - 1 - i), f: p => ({ x: WORLD_W - p.x, y: p.y }) },
      { cell: (i, j) => (R - 1 - j) * C + i, f: p => ({ x: p.x, y: WORLD_H - p.y }) },
    ];
    for (const k of kinds) {
      let same = true;
      for (let j = 0; j < R && same; j++) for (let i = 0; i < C; i++) if (this.blocked[j * C + i] !== this.blocked[k.cell(i, j)]) { same = false; break; }
      if (!same) continue;
      const map = this.B.map(b => { const q = k.f(b); return this.B.findIndex(o => Math.abs(o.x - q.x) < 0.01 && Math.abs(o.y - q.y) < 0.01 && Math.abs(o.r - b.r) < 0.01); });
      if (map.some(m => m >= 0)) out.push({ map, f: k.f, inv: k.f, exact: true });
    }
    // 3-player maps: the layout repeats every 120° around rot3, so one seat's roads, turned, serve the others
    if (this.rot3) {
      const [cx, cy] = this.rot3;
      const turnBy = k => { const a = k * 2 * Math.PI / 3, c = Math.cos(a), s = Math.sin(a); return p => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }); };
      for (const k of [1, 2]) {
        const f = turnBy(k), inv = turnBy(3 - k);
        const map = this.B.map(b => { const q = f(b); return this.B.findIndex(o => Math.abs(o.x - q.x) < 1.5 && Math.abs(o.y - q.y) < 1.5 && Math.abs(o.r - b.r) < 0.01); });
        if (map.some(m => m >= 0)) out.push({ map, f, inv, exact: false });
      }
    }
    return out;
  }
  /** Does this route keep clear of water and walls (a little closer than the grid allows is fine)? */
  clearOfTerrain(pts) {
    const m = CLEARANCE * 0.3;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k], L = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2), steps = Math.max(1, Math.ceil(L / 5));
      for (let s = 0; s <= steps; s++) {
        const x = p.x + (q.x - p.x) * s / steps, y = p.y + (q.y - p.y) * s / steps;
        if (x < EDGE * 0.5 || y < EDGE * 0.5 || x > WORLD_W - EDGE * 0.5 || y > WORLD_H - EDGE * 0.5) return false;
        // the start and end are building centres, which always stand on open ground
        if (k > 1 || s > 0) if (k < pts.length - 1 || s < steps) if (this.blockTest(x, y, m)) return false;
      }
    }
    return true;
  }
  setRoute(a, b, full) {
    const n = this.B.length, L = polyLen(full);
    this.routes[a * n + b] = full.slice(1);
    this.routes[b * n + a] = full.slice().reverse().slice(1);
    this.full = this.full || new Array(n * n);
    this.full[a * n + b] = full;
    this.full[b * n + a] = full.slice().reverse();
    this.lens[a * n + b] = this.lens[b * n + a] = L;
  }

  // Grid lookups round the right/bottom half from the far edge, so a point and its mirror image always land in
  // mirrored cells (map coordinates like 200 sit exactly on a cell border, where plain rounding would not be fair).
  cellOf(x, y) {
    let i = x <= WORLD_W / 2 ? Math.floor(x * NAV_COLS / WORLD_W) : NAV_COLS - 1 - Math.floor((WORLD_W - x) * NAV_COLS / WORLD_W);
    let j = y <= WORLD_H / 2 ? Math.floor(y * NAV_ROWS / WORLD_H) : NAV_ROWS - 1 - Math.floor((WORLD_H - y) * NAV_ROWS / WORLD_H);
    i = i < 0 ? 0 : i >= NAV_COLS ? NAV_COLS - 1 : i;
    j = j < 0 ? 0 : j >= NAV_ROWS ? NAV_ROWS - 1 : j;
    return j * NAV_COLS + i;
  }
  cellCenter(c) { const i = c % NAV_COLS, j = Math.floor(c / NAV_COLS); return { x: cellX(i), y: cellY(j) }; }
  walkable(x, y) { return x >= 0 && y >= 0 && x <= WORLD_W && y <= WORLD_H && !this.blocked[this.cellOf(x, y)]; }
  freeCell(x, y) {
    const c0 = this.cellOf(x, y);
    if (!this.blocked[c0]) return c0;
    const i0 = c0 % NAV_COLS, j0 = Math.floor(c0 / NAV_COLS);
    for (let r = 1; r < 30; r++) {
      let best = -1, bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= NAV_COLS || j >= NAV_ROWS) continue;
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        const c = j * NAV_COLS + i;
        if (this.blocked[c]) continue;
        const p = this.cellCenter(c), d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0) return best;
    }
    return c0;
  }
  penalised(c, k) {
    const a = this.discA[c], b = this.discB[c];
    return (a >= 0 && a !== k) || (b >= 0 && b !== k);
  }

  /** Dijkstra from building k outwards: dist/prev say how to walk TO building k from any cell. */
  flood(k) {
    const N = NAV_COLS * NAV_ROWS;
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const start = this.home[k];
    const heap = new Heap();
    dist[start] = 0; heap.push(start, 0);
    const blocked = this.blocked;
    while (heap.size) {
      const c = heap.pop();
      const dc = dist[c];
      const i = c % NAV_COLS, j = (c - i) / NAV_COLS;
      const cc = this.penalised(c, k) ? BLD_COST : 1;
      for (const [di, dj, len] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NAV_COLS || nj >= NAV_ROWS) continue;
        const n = nj * NAV_COLS + ni;
        if (blocked[n]) continue;
        if (di && dj && (blocked[j * NAV_COLS + ni] || blocked[nj * NAV_COLS + i])) continue; // no corner cutting
        const nd = dc + len * CW * (cc + (this.penalised(n, k) ? BLD_COST : 1)) / 2;
        if (nd < dist[n] - 1e-4) { dist[n] = nd; prev[n] = c; heap.push(n, nd); }
      }
    }
    this.dist[k] = dist; this.prev[k] = prev;
  }

  /** Line of sight on the grid. Buildings other than the ends (or whose yard an end already stands in) block it. */
  los(p, q, f0, f1) {
    const cp = this.cellOf(p.x, p.y), cq = this.cellOf(q.x, q.y);
    const e0 = this.discA[cp], e1 = this.discB[cp], e2 = this.discA[cq], e3 = this.discB[cq];
    const ok = d => d < 0 || d === f0 || d === f1 || d === e0 || d === e1 || d === e2 || d === e3;
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(L / LOS_STEP);
    for (let s = 1; s < steps; s++) {
      const c = this.cellOf(p.x + dx * s / steps, p.y + dy * s / steps);
      if (this.blocked[c] || !ok(this.discA[c]) || !ok(this.discB[c])) return false;
    }
    return true;
  }

  /** Walk down building k's tree from cell c0 (starting at point p0) and straighten the zig-zags. */
  walk(c0, p0, k, f0) {
    const prev = this.prev[k], t = this.B[k];
    if (c0 !== this.home[k] && prev[c0] < 0) return null;
    const raw = [p0];
    let c = c0, guard = 0;
    while (c !== this.home[k] && guard++ < 20000) { c = prev[c]; if (c < 0) return null; if (c !== this.home[k]) raw.push(this.cellCenter(c)); }
    raw.push({ x: t.x, y: t.y });
    const out = [raw[0]];
    for (let a = 0; a < raw.length - 1;) {
      let m = a + 1;
      while (m + 1 < raw.length && this.los(raw[a], raw[m + 1], f0, k)) m++;
      out.push(raw[m]); a = m;
    }
    return out.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  }
  route(a, b) { const s = this.B[a]; return this.walk(this.home[a], { x: s.x, y: s.y }, b, a); }

  // ---------------- public API (by building id) ----------------
  /** Waypoints from building `from` to building `to`, not including the start, ending at `to`'s centre. */
  path(fromId, toId) {
    const a = this.index.get(fromId), b = this.index.get(toId);
    if (a == null || b == null || a === b) { const t = this.B[b] || { x: 0, y: 0 }; return [{ x: t.x, y: t.y }]; }
    return this.routes[a * this.B.length + b];
  }
  /** Same, including the start point. */
  fullPath(fromId, toId) {
    const a = this.index.get(fromId), b = this.index.get(toId);
    if (a == null || b == null || a === b) return [];
    return this.full[a * this.B.length + b];
  }
  /** Walking distance between two buildings. */
  len(fromId, toId) {
    const a = this.index.get(fromId), b = this.index.get(toId);
    if (a == null || b == null || a === b) return 0;
    return this.lens[a * this.B.length + b];
  }
  /** Waypoints from any point to a building (squads turned around mid-field). */
  pathFrom(x, y, toId) {
    const k = this.index.get(toId);
    if (k == null) return [{ x, y }];
    const t = this.B[k];
    const c0 = this.freeCell(x, y);
    const out = this.walk(c0, { x, y }, k, this.discA[c0]);
    return out ? out.slice(1) : [{ x: t.x, y: t.y }];
  }
  /** Rough walking distance from a point to a building (for picking the nearest one). */
  distFrom(x, y, toId) {
    const k = this.index.get(toId);
    if (k == null) return Infinity;
    const c = this.freeCell(x, y), p = this.cellCenter(c);
    return this.dist[k][c] + Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2);
  }
  radiusOf(id) { const k = this.index.get(id); return k == null ? 40 : this.B[k].r; }
}

export function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) { const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y; L += Math.sqrt(dx * dx + dy * dy); }
  return L;
}

// Building a nav takes a few milliseconds; matches on the same map (rematches, test runs) share one.
const cache = new Map();
export function getNav(map) {
  const buildings = (map.buildings || []).map(b => ({ id: b.id, x: b.x, y: b.y, r: navRadius(b) }));
  const key = JSON.stringify([buildings.map(b => [b.id, b.x, b.y, b.r]), map.obstacles || [], map.rot3 || 0]);
  let nav = cache.get(key);
  if (nav) { cache.delete(key); cache.set(key, nav); return nav; }
  nav = new Nav(buildings, map.obstacles || [], { rot3: map.rot3 });
  cache.set(key, nav);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return nav;
}
