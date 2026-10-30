// Round-robin hero balance test, both sides Hard AI: node tools/balance.mjs
import { Game } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';
import { MAPS, HEROES, TICK } from '../public/shared/data.js';
const W = {}, G = {};
for (const a of HEROES) for (const b of HEROES) {
  if (a.id >= b.id) continue;
  for (const map of MAPS.filter(m => (m.players || 2) === 2)) for (const swap of [0, 1]) {
    const hs = swap ? [b.id, a.id] : [a.id, b.id];
    const game = new Game({ map: structuredClone(map), seed: map.id.length * 31 + swap, players: hs.map(h => ({ hero: h, ai: 'hard' })) });
    const ais = [new AI(game, 0, 'hard'), new AI(game, 1, 'hard')];
    let n = 0;
    while (!game.over && n++ < 14000) { ais[0].update(TICK); ais[1].update(TICK); game.step(TICK); game.events.length = 0; }
    hs.forEach((h, i) => { G[h] = (G[h] || 0) + 1; if (game.winner === i) W[h] = (W[h] || 0) + 1; });
  }
}
console.log(HEROES.map(h => `${h.id} ${Math.round(100 * (W[h.id] || 0) / G[h.id])}%`).sort((x, y) => parseInt(y.split(' ')[1]) - parseInt(x.split(' ')[1])).join('\n'));
