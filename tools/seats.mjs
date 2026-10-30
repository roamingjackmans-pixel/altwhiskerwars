// Seat balance for 3 and 4 player maps (they don't have to be symmetric): node tools/seats.mjs [mapId ...] [--draw]
// For every seat: walking distance to each rival base, the strays it reaches first (by road, worth weighted by type
// and level, with their garrisons), and its opening (the nearest strays). Flags a map whose seats differ too much.
import { MAPS, WORLD_W, WORLD_H } from '../public/shared/data.js';
import { Nav } from '../public/shared/nav.js';

const args = process.argv.slice(2), drawIt = args.includes('--draw'), ids = args.filter(a => !a.startsWith('--'));
// what a stray is worth to whoever takes it: kitten makers snowball, so they count most
export const worth = b => b.type === 'cattree' ? 2.4 : b.type === 'cottage' ? 1 + 0.35 * ((b.level || 1) - 1) : b.type === 'forge' ? 0.7 : b.type === 'garden' ? 0.6 : 0.5;
const TIE = 0.04;   // roads within 4% of each other count as a shared stray

export function seatReport(map) {
  const nav = new Nav(map.buildings, map.obstacles || [], { rot3: map.rot3 });
  const B = map.buildings, n = map.players || 2;
  const homes = Array.from({ length: n }, (_, s) => B.find(b => b.owner === s));
  const strays = B.filter(b => b.owner < 0);
  const L = (a, b) => nav.len(a.id, b.id);
  // rival distances
  const rivals = homes.map(h => homes.filter(o => o !== h).map(o => L(h, o)));
  const pair = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pair.push(L(homes[a], homes[b]));
  // strays each seat reaches first (ties shared)
  const share = new Array(n).fill(0), garrison = new Array(n).fill(0), count = new Array(n).fill(0);
  let total = 0;
  for (const s of strays) {
    const d = homes.map(h => L(h, s)), m = Math.min(...d), near = d.map((x, k) => (x <= m * (1 + TIE) ? k : -1)).filter(k => k >= 0);
    for (const k of near) { share[k] += worth(s) / near.length; garrison[k] += s.count / near.length; count[k] += 1 / near.length; }
    total += worth(s);
  }
  // opening: the three nearest strays (road length, plus a little for each cat guarding them)
  const opening = homes.map(h => strays.map(s => L(h, s) + s.count * 6).sort((a, b) => a - b).slice(0, 3));
  // contact: how close two seats' lands come (each building belongs to the seat whose base is nearest by road);
  // the average of the four shortest roads between them. A seat that touches both rivals much more than they
  // touch each other gets squeezed from two sides.
  // (a building about as near to two bases is no man's land and belongs to nobody here)
  const side = B.map(b => { const d = homes.map(h => L(h, b)), m = Math.min(...d); return d.filter(x => x <= m * (1 + TIE)).length > 1 ? -1 : d.indexOf(m); });
  const contact = {};
  for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) {
    const ds = [];
    for (const x of B) for (const y of B) if (side[x.id] === a && side[y.id] === c) ds.push(L(x, y));
    ds.sort((p, q) => p - q);
    const k = Math.min(4, ds.length);
    contact[a + '-' + c] = k ? ds.slice(0, k).reduce((p, q) => p + q, 0) / k : Infinity;
  }
  return { nav, homes, rivals, pair, share: share.map(x => x / total), garrison, count, opening, strays, contact };
}

export function seatProblems(r, n) {
  const out = [];
  // every seat should have its rivals at the same distances (nearest with nearest, furthest with furthest)
  const sorted = r.rivals.map(v => v.slice().sort((a, b) => a - b));
  for (let j = 0; j < n - 1; j++) {
    const v = sorted.map(s => s[j]), lo = Math.min(...v), hi = Math.max(...v);
    if (hi / lo > 1.07) out.push(`rival #${j + 1} is ${(100 * (hi / lo - 1)).toFixed(0)}% further for some seats (${v.map(Math.round).join(' / ')})`);
  }
  const want = 1 / n;
  r.share.forEach((s, k) => { if (Math.abs(s - want) > 0.035) out.push(`seat ${k} reaches ${(100 * s).toFixed(0)}% of the strays first (fair is ${(100 * want).toFixed(0)}%)`); });
  for (let j = 0; j < 3; j++) {
    const v = r.opening.map(o => o[j]), lo = Math.min(...v), hi = Math.max(...v);
    if (hi - lo > 90 && hi / lo > 1.15) out.push(`opening stray #${j + 1} is much further for one seat (${v.map(Math.round).join(' / ')})`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('seats.mjs')) {
  let bad = 0;
  for (const map of MAPS) {
    const n = map.players || 2;
    if (n < 3 || (ids.length && !ids.includes(map.id))) continue;
    const r = seatReport(map);
    console.log(`${map.id.padEnd(13)} ${n}p  bases ${r.pair.map(Math.round).join('/')}  contact ${Object.entries(r.contact).map(([k, v]) => k + ':' + Math.round(v)).join(' ')}`);
    r.homes.forEach((h, k) => console.log(`   seat ${k} (${h.x},${h.y})  rivals ${r.rivals[k].map(Math.round).join(', ').padEnd(16)} strays ${(100 * r.share[k]).toFixed(1).padStart(4)}% (${r.count[k].toFixed(1)} bldg, ${Math.round(r.garrison[k])} cats)  opening ${r.opening[k].map(Math.round).join(', ')}`));
    const p = seatProblems(r, n);
    for (const s of p) console.log('   !! ' + s);
    bad += p.length;
    if (drawIt) draw(map, r.nav);
  }
  console.log(bad ? `\n${bad} problem(s)` : '\nseats balanced');
  process.exitCode = bad ? 1 : 0;
}

function draw(map, nav) {
  const S = 25, W = WORLD_W / S, H = WORLD_H / S, rows = [];
  for (let j = 0; j < H; j++) {
    const row = [];
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * S, y = (j + 0.5) * S;
      row.push(nav.blockTest(x, y, 0) ? '#' : nav.walkable(x, y) ? '.' : ' ');
    }
    rows.push(row);
  }
  const sym = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const b of map.buildings) rows[Math.floor(b.y / S)][Math.floor(b.x / S)] = b.owner >= 0 ? 'PQRS'[b.owner] : sym[b.id % sym.length];
  console.log(rows.map(r => '   ' + r.join('')).join('\n'));
}
