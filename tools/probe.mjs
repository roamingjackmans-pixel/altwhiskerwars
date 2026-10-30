// node tools/probe.mjs <hero> [disableSpellIdOrPassive]
import { Game } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';
import { MAPS, HEROES, HERO_BY_ID, TICK } from '../public/shared/data.js';
const [hero, off] = process.argv.slice(2);
const H = HERO_BY_ID[hero];
if (off === 'passive') H.passive = { ...H.passive, id: 'none' };
else if (off) H.spells = H.spells.map(s => s.id === off ? { ...s, id: 'shadowstep_x', cost: 999 } : s);
let w = 0, n = 0;
for (const opp of HEROES) { if (opp.id === hero) continue;
  for (const map of MAPS.filter(m => (m.players || 2) === 2)) for (const swap of [0, 1]) {
    const hs = swap ? [opp.id, hero] : [hero, opp.id];
    const game = new Game({ map: structuredClone(map), seed: 5 + swap, players: hs.map(h => ({ hero: h, ai: 'hard' })) });
    const ais = [new AI(game, 0, 'hard'), new AI(game, 1, 'hard')];
    let k = 0; while (!game.over && k++ < 14000) { ais[0].update(TICK); ais[1].update(TICK); game.step(TICK); game.events.length = 0; }
    n++; if (game.winner === (swap ? 1 : 0)) w++;
  } }
console.log(hero, 'off=' + (off || '-'), Math.round(100 * w / n) + '%');
