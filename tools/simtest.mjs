// Headless AI-vs-AI balance/crash test:  node tools/simtest.mjs [games]
import { Game } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';
import { MAPS, HEROES, randomMap, TICK } from '../public/shared/data.js';

const N = +process.argv[2] || 24;
const wins = {}, games = {}, spellCasts = {};
let totalTime = 0, timeouts = 0, errors = 0;
const levels = ['easy', 'normal', 'hard', 'insane'];
for (let g = 0; g < N; g++) {
  const map = g % 7 === 6 ? randomMap(1000 + g) : MAPS[g % MAPS.length];
  const h0 = HEROES[g % HEROES.length].id, h1 = HEROES[(g * 5 + 3) % HEROES.length].id;
  const lv = levels[(g >> 1) % 4];
  const n = map.players || 2;
  const heroes = [h0, h1, HEROES[(g * 7 + 1) % HEROES.length].id, HEROES[(g * 11 + 5) % HEROES.length].id].slice(0, n);
  // 3-4 players: the opponents get a mix of levels (three Easy cats left alone can slap each other for ages)
  const lvls = heroes.map((_, i) => (i === 0 ? 'hard' : levels[((g >> 1) + i - 1) % 4]));
  const game = new Game({ map: structuredClone(map), seed: 77 + g, players: heroes.map((h, i) => ({ name: 'ABCD'[i], hero: h, ai: lvls[i] })) });
  const ais = heroes.map((_, i) => new AI(game, i, lvls[i]));
  let steps = 0;
  try {
    while (!game.over && steps < 20 * (game.timeLimit + 100)) {
      for (const ai of ais) ai.update(TICK);
      game.step(TICK); steps++;
      const snap = game.snapshot();
      for (const e of snap.e) if (e.k === 'spell') spellCasts[e.id] = (spellCasts[e.id] || 0) + 1;
      if (steps % 200 === 0) JSON.stringify(snap);
    }
  } catch (e) { errors++; console.error('ERR', map.id, h0, h1, e); }
  totalTime += game.time;
  if (game.endReason === 'time') timeouts++;
  heroes.forEach((h, i) => { games[h] = (games[h] || 0) + 1; if (game.winner === i) wins[h] = (wins[h] || 0) + 1; });
  console.log(`${map.id.padEnd(11)} ${heroes.map(h => h.padEnd(10)).join(' vs ')} (${lv.padEnd(6)}) -> winner ${game.winner} in ${game.time.toFixed(0)}s (${game.endReason}) bldg=${game.buildings.length} squads=${game.squads.length}`);
}
console.log('\navg match', (totalTime / N).toFixed(0), 's; timeouts', timeouts, '; errors', errors);
console.log('hero win rates:', Object.keys(games).map(h => `${h} ${(wins[h] || 0)}/${games[h]}`).join(', '));
const allSpells = HEROES.flatMap(h => h.spells.map(s => s.id));
console.log('spells never cast:', allSpells.filter(s => !spellCasts[s]).join(', ') || 'none');
