// Map checker: node tools/maptest.mjs [mapId ...]   (no ids = check every map; ids = also draw them)
// Checks every building stands clear of terrain, every building can walk to every other, the map is fair
// (point-symmetric terrain and routes), and reports how much longer the roads are than straight lines.
import { MAPS, randomMap, WORLD_W, WORLD_H } from '../public/shared/data.js';
import { Nav, NAV_COLS, NAV_ROWS } from '../public/shared/nav.js';

const ids = process.argv.slice(2);
const list = [...MAPS, ...[11, 222, 3333, 44444, 555555].map(s => randomMap(s))];
let bad = 0;
for (const map of list) {
  if (ids.length && !ids.includes(map.id)) continue;
  const t0 = performance.now();
  const nav = new Nav(map.buildings, map.obstacles || [], { rot3: map.rot3 });
  const ms = performance.now() - t0;
  const B = map.buildings, problems = [];
  // clear ground under every building
  for (const b of B) if (nav.blockTest(b.x, b.y, 50)) problems.push(`building ${b.id} (${b.x},${b.y}) is too close to terrain`);
  if (nav.unreachable) problems.push(`${nav.unreachable} building pairs cannot reach each other`);
  const seats = map.players || 2;
  const bases = B.filter(b => b.owner >= 0);
  if (bases.length !== seats) problems.push(`${bases.length} starting bases for ${seats} players`);
  // terrain grid is point-symmetric (2 and 4 players; 4-player maps are mirrored both ways too)
  let asym = 0;
  if (seats !== 3) for (let c = 0; c < NAV_COLS * NAV_ROWS; c++) if (nav.blocked[c] !== nav.blocked[NAV_COLS * NAV_ROWS - 1 - c]) asym++;
  if (asym) problems.push(`${asym} terrain cells are not mirrored`);
  // every seat sees the same roads: compare each base's sorted walking distances to everything else
  // (only for maps built by turning or mirroring every seat; the hand-balanced 3 player maps are checked by
  // tools/seats.mjs and tools/seatsim.mjs instead)
  let seatGap = 0;
  if (seats === 4 || map.rot3) {
    const prof = bases.map(a => B.filter(b => b !== a).map(b => nav.len(a.id, b.id)).sort((x, y) => x - y));
    for (const p of prof) for (let k = 0; k < p.length; k++) seatGap = Math.max(seatGap, Math.abs(p[k] - prof[0][k]) / Math.max(200, prof[0][k]));
    if (seatGap > 0.05) problems.push(`seats differ: roads up to ${(seatGap * 100).toFixed(1)}% longer for one player`);
  }
  // routes are fair: P0's road from a to b is as long as P1's road between the mirrored buildings
  // (an old map may have a "centre" building a little off centre: it counts as its own mirror)
  const mirrorOf = b => B.find(o => Math.abs(o.x - (WORLD_W - b.x)) < 0.5 && Math.abs(o.y - (WORLD_H - b.y)) < 0.5) || (Math.abs(b.x - WORLD_W / 2) < 1 ? b : null) || (seats === 3 ? b : null);
  let worstFair = 0, worstDetour = 0, sumDetour = 0, n = 0, worstPair = '';
  for (const a of B) for (const b of B) {
    if (a.id >= b.id) continue;
    const L = nav.len(a.id, b.id), st = Math.hypot(a.x - b.x, a.y - b.y);
    const ma = mirrorOf(a), mb = mirrorOf(b);
    if (!ma || !mb) { problems.push(`building ${a.id} or ${b.id} has no mirror`); continue; }
    const offCentre = o => mirrorOf(o) === o && Math.abs(o.y - WORLD_H / 2) > 1;
    if (seats !== 3 && !offCentre(a) && !offCentre(b)) worstFair = Math.max(worstFair, Math.abs(L - nav.len(ma.id, mb.id)) / L);
    const r = L / st;
    if (r > worstDetour) { worstDetour = r; worstPair = `${a.id}->${b.id} ${Math.round(st)} vs ${Math.round(L)}`; }
    sumDetour += r; n++;
  }
  const lopsided = seats === 2 && B.some(b => mirrorOf(b) === b && Math.abs(b.y - WORLD_H / 2) > 1);
  if (worstFair > 0.04 && !lopsided) problems.push(`routes differ between the two sides by up to ${(worstFair * 100).toFixed(1)}%`);
  else if (lopsided) console.log('   (note: this map has a "centre" building off the centre, so it is not exactly symmetric)');
  const p0 = B.find(b => b.owner === 0), p1 = B.find(b => b.owner === 1);
  console.log(`${(map.id + (map.id === 'random' ? '#' + map.name.split('#')[1] : '')).padEnd(13)} ${seats}p ${String(B.length).padStart(2)} bldg ${String((map.obstacles || []).length).padStart(2)} obst  nav ${ms.toFixed(0).padStart(3)}ms  bases ${Math.round(nav.len(p0.id, p1.id))} (straight ${Math.round(Math.hypot(p0.x - p1.x, p0.y - p1.y))})  detour avg ${(sumDetour / n).toFixed(2)} max ${worstDetour.toFixed(2)} [${worstPair}]  fair ${(worstFair * 100).toFixed(1)}%${seats === 4 || map.rot3 ? ` seats ${(seatGap * 100).toFixed(1)}%` : seats === 3 ? ' (hand-balanced)' : ''}`);
  for (const p of problems) { console.log('   !! ' + p); bad++; }
  if (ids.length) draw(map, nav);
}
console.log(bad ? `\n${bad} problem(s)` : '\nall maps OK');
process.exitCode = bad ? 1 : 0;

function draw(map, nav) {
  const S = 25, W = WORLD_W / S, H = WORLD_H / S, rows = [];
  for (let j = 0; j < H; j++) {
    let row = '';
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * S, y = (j + 0.5) * S;
      let ch = nav.blockTest(x, y, 0) ? '#' : nav.walkable(x, y) ? '.' : ' ';
      if (ch === '#' && nav.shapes.some(s => s.cls === 'water') && !nav.shapes.some(s => s.cls === 'solid' && distIn(s, x, y))) ch = '~';
      if (ch !== '#' && ch !== '~' && nav.shapes.some(s => s.t === 'bridge' && distIn(s, x, y))) ch = '=';
      row += ch;
    }
    rows.push(row.split(''));
  }
  const sym = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const b of map.buildings) {
    const i = Math.floor(b.x / S), j = Math.floor(b.y / S);
    rows[j][i] = b.owner >= 0 ? 'PQRS'[b.owner] : sym[b.id % sym.length];
  }
  console.log(rows.map(r => '   ' + r.join('')).join('\n'));
}
function distIn(s, x, y) {
  if (s.g === 'circle') return Math.hypot(x - s.x, y - s.y) < s.r;
  if (s.g === 'line') {
    for (let k = 1; k < s.pts.length; k++) {
      const [ax, ay] = s.pts[k - 1], [bx, by] = s.pts[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < s.w / 2) return true;
    }
    return false;
  }
  let inside = false;
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    const [xi, yi] = s.pts[i], [xj, yj] = s.pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
