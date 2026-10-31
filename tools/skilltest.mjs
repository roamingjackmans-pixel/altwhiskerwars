// Casts every skill of every hero in a live battle and checks it goes off cleanly.
//   node tools/skilltest.mjs            all heroes
//   node tools/skilltest.mjs orbit      one hero
import { MAPS, HEROES, TICK, findSpell } from '../public/shared/data.js';
import { Game, maskSnap } from '../public/shared/game.js';
import { AI } from '../public/shared/ai.js';

const only = process.argv[2];
// skills aimed at my own walking cats (the rest of the area skills go on the enemy's)
const AT_MINE = new Set(['zoomboots', 'fury', 'cloak', 'deposit', 'heads', 'pulse', 'aura', 'slugs', 'totem', 'stones', 'vortex', 'fog', 'spyeye', 'mindread']);
const NEXT_SEND = new Set(['ranks', 'flying', 'shortcut', 'beam', 'barrier', 'wind', 'coldwave', 'unity', 'toarms', 'bfg', 'builder']);
let fails = 0, casts = 0;

function battle(hero, seed) {
  const map = structuredClone(MAPS[1]);
  const g = new Game({ map, seed, players: [{ name: 'Tester', hero, skills: {} }, { name: 'Rival', hero: 'barnaby', ai: 'hard', skills: {} }] });
  const rival = new AI(g, 1, 'hard');
  const step = sec => { for (let k = 0; k < sec / TICK; k++) { rival.update(TICK); g.step(TICK); const s = g.snapshot(); maskSnap(s, 0); maskSnap(s, 1); if (g.over) break; } };
  return { g, step };
}
const biggest = (g, pred) => g.buildings.filter(pred).sort((a, b) => b.count - a.count)[0];

function trySkill(h, slot, seed) {
  const { g, step } = battle(h.id, seed);
  // grow a bit, then get armies walking on both sides
  step(12);
  const mine = () => biggest(g, b => b.owner === 0), theirs = () => biggest(g, b => b.owner === 1);
  // the tester doesn't play by itself: hand it a couple of strays so it has a few buildings
  for (const b of g.buildings.filter(q => q.owner < 0).slice(0, 2)) b.owner = 0;
  for (const b of g.buildings) if (b.owner >= 0) b.count = Math.max(b.count, 40);
  // give both sides something to work with: a level-3 cottage each, a lost-cats history, purr
  for (const b of g.buildings) if (b.owner >= 0 && b.type === 'cottage') { b.level = 3; break; }
  g.players[0].purr = 1200; g.players[1].purr = 2500;
  const tgt0 = theirs(), src0 = mine();
  g.command(0, { k: 'send', from: [src0.id], to: tgt0.id, pct: 0.5 });
  g.command(1, { k: 'send', from: [tgt0.id], to: src0.id, pct: 0.5 });
  // a rival cast to copy
  g.players[1].lastCast = { id: 'stonepaws', lv: 2, t: g.time };
  step(1.6);
  const p = g.players[0];
  p.catnip = 100; p.cds = [0, 0, 0, 0]; p.gcd = 0; p.silenced = 0;
  const sp = g.spell(0, slot);
  const cmd = { k: 'spell', slot };
  const sq = owner => g.squads.filter(s => s.owner === owner && s.wait <= 0).sort((a, b) => b.count - a.count)[0];
  if (sp.target === 'area') {
    const s = sq(AT_MINE.has(sp.id) ? 0 : 1) || sq(0) || sq(1);
    if (s) { cmd.x = s.x; cmd.y = s.y; } else { cmd.x = 800; cmd.y = 450; }
  } else if (sp.target !== 'global') {
    let b = null;
    if (sp.target === 'own') {
      b = ['popup'].includes(sp.id) ? biggest(g, q => q.owner === 0 && q.type === 'cottage')
        : ['boomballs', 'soulsnatch'].includes(sp.id) ? (biggest(g, q => q.owner === 0 && q.type === 'tower') || (() => { const q = mine(); q.type = 'tower'; q.level = 2; return q; })())
        : mine();
    } else b = sp.id === 'evenout' ? mine() : theirs();
    if (sp.id === 'secondlife') b.losses.push({ t: g.time, n: 20 });
    if (sp.id === 'lifecycle') b.level = Math.max(2, b.level);
    if (sp.id === 'tempdown' || sp.id === 'crumble') b.level = Math.max(2, b.level);
    cmd.b = b.id;
  }
  g.events = [];
  g.command(0, cmd);
  const ev = g.events.find(e => (e.k === 'spell' || e.k === 'err') && e.o === 0);
  casts++;
  if (!ev || ev.k !== 'spell') {
    fails++;
    console.log(`✗ ${h.name} slot ${slot + 1} ${sp.name} (${sp.id}): ${ev ? ev.msg : 'nothing happened'}`);
    return;
  }
  // "next cats you send" skills: send from the building now
  if (NEXT_SEND.has(sp.id) && cmd.b != null) {
    const other = sp.id === 'beam' || sp.id === 'unity' ? g.buildings.find(q => q.owner === 0 && q.id !== cmd.b) : theirs();
    if (sp.id === 'builder') g.command(0, { k: 'up', b: cmd.b });
    else if (other) g.command(0, { k: 'send', from: [cmd.b], to: other.id, pct: 0.75 });
  }
  if (sp.id === 'hypno') g.command(0, { k: 'send', from: [cmd.b], to: mine().id, pct: 1 });
  if (sp.id === 'steal') {
    // now cast the copied skill
    const st = g.spell(0, slot);
    if (!st || !st.stolen) { fails++; console.log(`✗ ${h.name} Copy Cat did not copy anything`); return; }
    p.catnip = 100; p.gcd = 0;
    g.command(0, { k: 'spell', slot, b: mine().id });
    if (p.stolen) { fails++; console.log(`✗ ${h.name} copied skill could not be used`); return; }
  }
  try { step(25); } catch (e) { fails++; console.log(`✗ ${h.name} ${sp.name}: crashed after casting`, e); return; }
  const res = g.events.length;
  void res;
}

for (const h of HEROES) {
  if (only && h.id !== only) continue;
  for (let slot = 0; slot < 4; slot++) {
    try { trySkill(h, slot, 11 + slot); }
    catch (e) { fails++; console.log(`✗ ${h.name} slot ${slot + 1}: crashed`, e); }
  }
}
// Riddle rolls a random hero's skill per slot: make sure every roll is a real skill
for (let seed = 1; seed < 40; seed++) {
  const g = new Game({ map: structuredClone(MAPS[0]), seed, players: [{ hero: 'riddle' }, { hero: 'barnaby' }] });
  for (let k = 0; k < 4; k++) { const sp = g.spell(0, k); if (!sp || sp.mystery || !findSpell(sp.id) || sp.slot !== k) { fails++; console.log('✗ Riddle rolled a bad skill', seed, k, sp && sp.id); } }
}
// old saves: old hero ids still load
{
  const g = new Game({ map: structuredClone(MAPS[0]), seed: 3, players: [{ hero: 'velvet' }, { hero: 'hexley' }] });
  if (g.players[0].heroId !== 'whirl' || g.players[1].heroId !== 'jinx') { fails++; console.log('✗ old hero ids do not map onto the new heroes'); }
}
console.log(`${casts} casts, ${fails} problems`);
process.exit(fails ? 1 : 0);
