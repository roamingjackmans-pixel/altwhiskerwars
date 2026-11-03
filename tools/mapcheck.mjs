// Try out a map before it goes in MAPS: node tools/mapcheck.mjs <map file or map id> [games=0] [firstSeed=1] [--quiet]
// The file is an ES module whose default export is a map object (build it with MAP_KIT from public/shared/data.js).
// Prints: problems (buildings in terrain, buildings that can't reach each other, wrong number of bases), a text
// drawing (P Q R S T = seats 0-4, other letters/digits = building ids, # solid, ~ water, = bridge), each seat's road
// distances and stray share (tools/seats.mjs), and, with games > 0, how often each seat wins when every seat has the
// same hero and AI level (tools/seatsim.mjs). A fair seat wins about 1/players of the games; with 200+ games each
// seat should land within about 5 points of that.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { MAP_BY_ID, HEROES, TICK, WORLD_W, WORLD_H } from '../public/shared/data.js';
import { Nav, shapeDist } from '../public/shared/nav.js';
import { Game } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';
import { seatReport, seatProblems } from './seats.mjs';

const args = process.argv.slice(2), quiet = args.includes('--quiet');
const [src, gArg, sArg] = args.filter(a => !a.startsWith('--'));
if (!src) { console.log('usage: node tools/mapcheck.mjs <map.mjs | mapId> [games] [firstSeed]'); process.exit(1); }
const map = MAP_BY_ID[src] || (await import(pathToFileURL(resolve(src)).href)).default;
const games = +gArg || 0, seed0 = +sArg || 1;
const n = map.players || 2, B = map.buildings;

// ---- the ground
const nav = new Nav(B, map.obstacles || [], { rot3: map.rot3, rot5: map.rot5 });
const problems = [];
const ids = new Set();
for (const b of B) {
  if (ids.has(b.id)) problems.push(`two buildings share id ${b.id}`);
  ids.add(b.id);
  if (nav.blockTest(b.x, b.y, 50)) problems.push(`building ${b.id} (${b.x},${b.y}) is too close to terrain`);
  if (b.x < 60 || b.y < 60 || b.x > WORLD_W - 60 || b.y > WORLD_H - 60) problems.push(`building ${b.id} (${b.x},${b.y}) is too close to the edge`);
  for (const o of B) if (o.id > b.id && Math.hypot(o.x - b.x, o.y - b.y) < 110) problems.push(`buildings ${b.id} and ${o.id} are only ${Math.round(Math.hypot(o.x - b.x, o.y - b.y))} apart (keep 110+)`);
}
if (nav.unreachable) problems.push(`${nav.unreachable} building pairs cannot reach each other`);
for (let s = 0; s < n; s++) if (B.filter(b => b.owner === s).length !== 1) problems.push(`seat ${s} has ${B.filter(b => b.owner === s).length} starting bases (needs 1)`);
if (B.some(b => b.owner >= n)) problems.push('a building belongs to a seat this map does not have');
let worst = 0, worstPair = '';
for (const a of B) for (const b of B) if (a.id < b.id) {
  const r = nav.len(a.id, b.id) / Math.hypot(a.x - b.x, a.y - b.y);
  if (r > worst) { worst = r; worstPair = `${a.id}->${b.id}`; }
}
console.log(`${map.id} (${map.name}) ${n} players, ${B.length} buildings, ${(map.obstacles || []).length} terrain pieces, longest detour x${worst.toFixed(2)} (${worstPair})`);
for (const p of problems) console.log('  !! ' + p);
if (!quiet) draw();

// ---- seats by road
const r = seatReport(map);
console.log(`  bases apart by road: ${r.pair.map(Math.round).join(' / ')}`);
r.homes.forEach((h, k) => console.log(`  seat ${k} (${h.x},${h.y})  rivals ${r.rivals[k].map(Math.round).join(', ').padEnd(24)} strays first ${(100 * r.share[k]).toFixed(1).padStart(4)}% (${r.count[k].toFixed(1)} bldg, ${Math.round(r.garrison[k])} cats)  opening ${r.opening[k].map(Math.round).join(', ')}`));
for (const p of seatProblems(r, n)) console.log('  ~ ' + p);

// ---- seat sims
if (games > 0) {
  const levels = ['normal', 'hard', 'insane'], wins = new Array(n).fill(0);
  let draws = 0, timeouts = 0, time = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const hero = HEROES[(g * 5 + seed0) % HEROES.length].id, lv = levels[g % levels.length];
    const game = new Game({ map: structuredClone(map), seed: seed0 * 1000 + g, players: Array.from({ length: n }, (_, i) => ({ name: 'ABCDE'[i], hero, ai: lv })) });
    const ais = Array.from({ length: n }, (_, i) => new AI(game, i, lv));
    const order = ais.slice();
    let rs = (seed0 * 7919 + g * 104729) >>> 0;
    const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
    let steps = 0;
    while (!game.over && steps < 20 * (game.timeLimit + 50)) {
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      for (const ai of order) ai.update(TICK);
      game.step(TICK); game.events.length = 0; steps++;
    }
    time += game.time;
    if (game.endReason === 'time') timeouts++;
    if (game.winner >= 0) wins[game.winner]++; else draws++;
  }
  const fair = 100 / n;
  console.log(`  seat wins over ${games} games (fair ${fair.toFixed(0)}%): ${wins.map((w, k) => `${k}:${(100 * w / games).toFixed(0)}%`).join('  ')}  draws ${draws}  timeouts ${timeouts}  avg ${Math.round(time / games)}s  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  const off = wins.map((w, k) => [k, 100 * w / games - fair]).filter(([, d]) => Math.abs(d) > 5);
  if (off.length) console.log(`  ~ off by more than 5 points: ${off.map(([k, d]) => `seat ${k} ${d > 0 ? '+' : ''}${d.toFixed(0)}`).join(', ')}`);
}
process.exitCode = problems.length ? 1 : 0;

function draw() {
  const S = 25, W = WORLD_W / S, H = WORLD_H / S, rows = [];
  const hit = cls => (x, y) => nav.shapes.some(sh => sh.cls === cls && shapeDist(sh, x, y) < 0);
  const solid = hit('solid'), water = hit('water'), pass = hit('pass');
  for (let j = 0; j < H; j++) {
    let row = '';
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * S, y = (j + 0.5) * S;
      row += solid(x, y) ? '#' : water(x, y) ? (pass(x, y) ? '=' : '~') : nav.walkable(x, y) ? '.' : ' ';
    }
    rows.push(row.split(''));
  }
  const sym = '0123456789abcdefghijklmnopqrstuvwxyz';
  const mark = b => (b.owner >= 0 ? 'PQRST'[b.owner] : sym[b.id % sym.length]);
  for (const b of B) rows[Math.min(H - 1, Math.floor(b.y / S))][Math.min(W - 1, Math.floor(b.x / S))] = mark(b);
  console.log(rows.map(r => '   ' + r.join('')).join('\n'));
  console.log('   buildings: ' + B.map(b => `${mark(b)}=${b.id}:${b.type}${b.level > 1 ? b.level : ''}(${b.count})`).join(' '));
}
