// Does a map favour a seat? node tools/seatsim.mjs <mapId[,mapId...]> [games=36] [firstSeed=1]
// Every seat gets the same hero and the same AI level (both change from game to game), so only the map differs.
// The AIs act in a shuffled order every tick, so no seat always gets the last word.
import { Game } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';
import { MAP_BY_ID, HEROES, TICK } from '../public/shared/data.js';

const [idArg, gArg, sArg] = process.argv.slice(2);
const N = +gArg || 36, seed0 = +sArg || 1;
const levels = ['normal', 'hard', 'insane'];
for (const id of idArg.split(',')) {
  const map = MAP_BY_ID[id];
  if (!map) { console.log('no map', id); continue; }
  const n = map.players || 2, wins = new Array(n).fill(0);
  let draws = 0, timeouts = 0, time = 0;
  const t0 = Date.now();
  for (let g = 0; g < N; g++) {
    const hero = HEROES[(g * 5 + seed0) % HEROES.length].id, lv = levels[g % levels.length];
    const game = new Game({ map: structuredClone(map), seed: seed0 * 1000 + g, players: Array.from({ length: n }, (_, i) => ({ name: 'ABCD'[i], hero, ai: lv })) });
    const ais = Array.from({ length: n }, (_, i) => new AI(game, i, lv));
    let steps = 0;
    const order = ais.slice();
    let r = (seed0 * 7919 + g * 104729) >>> 0;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    while (!game.over && steps < 20 * (game.timeLimit + 50)) {
      for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
      for (const ai of order) ai.update(TICK);
      game.step(TICK); game.events.length = 0; steps++;
    }
    time += game.time;
    if (game.endReason === 'time') timeouts++;
    if (game.winner >= 0) wins[game.winner]++; else draws++;
  }
  console.log(`${id.padEnd(13)} ${N} games  seat wins ${wins.map((w, k) => `${k}:${w} (${Math.round(100 * w / N)}%)`).join('  ')}  draws ${draws}  timeouts ${timeouts}  avg ${Math.round(time / N)}s  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}
