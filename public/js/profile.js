// Player profile, currency, unlocks and achievements (saved in this browser).
import { HEROES, FURS, HATS, ACHIEVEMENTS, COINS, AI_LEVELS, CAMPAIGN, HERO_BY_ID } from '../shared/data.js';

const KEY = 'whiskerwars.profile.v1';
const NAMES = ['Whiskerpop', 'Sir Fluff', 'Captain Paws', 'Mochi', 'Noodle', 'Biscuit', 'Pickles', 'Tofu', 'Meowzart', 'Purrlock', 'Socks', 'Butterbean', 'Mittensworth', 'Clawdia', 'Catniss'];

function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

function fresh() {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2, 10),
    name: NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 90 + 10),
    coins: 200,
    xp: 0, level: 1,
    heroes: HEROES.filter(h => h.cost === 0).map(h => h.id),
    furs: FURS.filter(f => f.cost === 0).map(f => f.id),
    hats: ['none'],
    equip: { hero: 'whiskers', fur: 'ginger', hat: 'none' },
    stats: { matches: 0, wins: 0, onlineMatches: 0, onlineWins: 0, captures: 0, spells: 0, produced: 0, bestStreak: 0, streak: 0, fastestWin: 0 },
    ach: {},
    campaign: {},
    history: [],
    lastDaily: '', lastFirstWin: '',
    settings: { sfx: 0.8, music: 0.45, muted: false, fx: 'high', showTips: true, layout: 'auto', vibrate: true, fullscreen: true },
    seenTutorial: false,
  };
}

let P = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const base = fresh();
      return { ...base, ...p, equip: { ...base.equip, ...p.equip }, stats: { ...base.stats, ...p.stats }, settings: { ...base.settings, ...p.settings } };
    }
  } catch { /* storage blocked */ }
  return fresh();
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* ignore */ } }
export function profile() { return P; }
export function resetProfile() { P = fresh(); save(); }

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { save(); for (const f of listeners) try { f(P); } catch (e) { console.error(e); } }

export function setName(n) { P.name = String(n || '').trim().slice(0, 16) || P.name; changed(); }
export function equip(kind, id) { P.equip[kind] = id; changed(); }
export function addCoins(n) { P.coins = Math.max(0, Math.round(P.coins + n)); changed(); }
export function owns(kind, id) { return (kind === 'hero' ? P.heroes : kind === 'fur' ? P.furs : P.hats).includes(id); }

export function xpForLevel(lv) { return 100 + (lv - 1) * 60; }

/** Try to buy. Returns { ok, msg, newAch } */
export function buy(kind, id) {
  const list = kind === 'hero' ? HEROES : kind === 'fur' ? FURS : HATS;
  const item = list.find(x => x.id === id);
  if (!item) return { ok: false, msg: 'Unknown item' };
  if (owns(kind, id)) return { ok: false, msg: 'Already owned' };
  if (P.coins < item.cost) return { ok: false, msg: `Need ${item.cost - P.coins} more fish coins` };
  P.coins -= item.cost;
  (kind === 'hero' ? P.heroes : kind === 'fur' ? P.furs : P.hats).push(id);
  const newAch = checkAchievements({});
  changed();
  return { ok: true, newAch };
}

/** Daily gift: returns coins granted or 0 */
export function claimDaily() {
  if (P.lastDaily === today()) return 0;
  P.lastDaily = today();
  P.coins += COINS.dailyGift;
  changed();
  return COINS.dailyGift;
}
export function dailyAvailable() { return P.lastDaily !== today(); }

function grant(id) {
  if (P.ach[id]) return null;
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return null;
  P.ach[id] = Date.now();
  P.coins += a.reward;
  return a;
}

function checkAchievements(ctx) {
  const out = [];
  const g = id => { const a = grant(id); if (a) out.push(a); };
  const s = P.stats;
  if (s.wins >= 1) g('firstwin');
  if (s.onlineMatches >= 1) g('online1');
  if (s.onlineWins >= 5) g('online5');
  if (ctx.maxCottage >= 5) g('maxcottage');
  if (s.captures >= 50) g('capture50');
  if (s.spells >= 50) g('spells50');
  if (P.heroes.length >= 5) g('heroes5');
  if (ctx.realWin && ctx.lostBuildings === 0) g('flawless');
  if (ctx.realWin && ctx.time > 0 && ctx.time < 180) g('speedy');
  if (ctx.realWin && ctx.ai === 'insane') g('insane');
  if (CAMPAIGN.every(l => (P.campaign[l.id] || 0) > 0)) g('campaign');
  if (P.furs.length + P.hats.length - 3 >= 5) g('fashion');
  if (ctx.peakArmy >= 200) g('army200');
  return out;
}

/**
 * Record a finished match and pay out rewards.
 * r = { mode:'online'|'practice'|'campaign', win, draw, ai, stats:{...myStats}, time, opponent, hero, map, level? }
 * Returns a breakdown for the results screen.
 */
export function recordMatch(r) {
  const lines = [];
  let coins = 0;
  const st = r.stats || {};
  if (r.mode === 'online') {
    const c = r.win ? COINS.onlineWin : r.draw ? Math.round((COINS.onlineWin + COINS.onlineLoss) / 2) : COINS.onlineLoss;
    lines.push([r.win ? 'Online victory' : r.draw ? 'Online draw' : 'Online battle', c]); coins += c;
  } else {
    const L = AI_LEVELS[r.ai] || AI_LEVELS.normal;
    const c = r.win ? L.coinsWin : L.coinsLoss;
    lines.push([r.win ? `Beat ${L.name} AI` : `Battled ${L.name} AI`, c]); coins += c;
  }
  const perf = Math.min(COINS.perfMax, Math.round((st.captured || 0) * COINS.perfPerCapture + (st.spells || 0) * COINS.perfPerSpell));
  if (perf > 0) { lines.push(['Captures & spells bonus', perf]); coins += perf; }
  if (r.win && P.lastFirstWin !== today()) { P.lastFirstWin = today(); lines.push(['First win of the day!', COINS.firstWinOfDay]); coins += COINS.firstWinOfDay; }
  let stars = 0;
  if (r.mode === 'campaign' && r.win && r.level) {
    stars = 1 + (r.time < 300 ? 1 : 0) + ((st.lostBuildings || 0) === 0 ? 1 : 0);
    const prev = P.campaign[r.level.id] || 0;
    if (!prev) { lines.push([`Level ${r.level.id} cleared!`, r.level.reward]); coins += r.level.reward; }
    else if (stars > prev) { const c = COINS.newStar * (stars - prev); lines.push(['New star record', c]); coins += c; }
    P.campaign[r.level.id] = Math.max(prev, stars);
  }

  // stats
  const s = P.stats;
  s.matches++;
  if (r.win) { s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); if (!s.fastestWin || r.time < s.fastestWin) s.fastestWin = r.time; }
  else s.streak = 0;
  if (r.mode === 'online') { s.onlineMatches++; if (r.win) s.onlineWins++; }
  s.captures += st.captured || 0;
  s.spells += st.spells || 0;
  s.produced += st.produced || 0;

  // xp
  const xp = 40 + (r.win ? 60 : 0) + Math.min(60, (st.captured || 0) * 3);
  P.xp += xp;
  const levelUps = [];
  while (P.xp >= xpForLevel(P.level)) {
    P.xp -= xpForLevel(P.level);
    P.level++;
    const bonus = COINS.levelUpBase + P.level * COINS.levelUpPerLevel;
    levelUps.push({ level: P.level, coins: bonus });
    coins += bonus;
    lines.push([`Reached level ${P.level}!`, bonus]);
  }
  P.coins += coins;

  P.history.unshift({ t: Date.now(), mode: r.mode, win: !!r.win, draw: !!r.draw, opp: r.opponent || '?', hero: r.hero, map: r.map, time: r.time });
  P.history = P.history.slice(0, 15);

  // flawless / speed achievements only count when the opponent was actually defeated
  const realWin = r.win && (r.why === 'wiped' || r.why === 'time');
  const ach = checkAchievements({ win: r.win, realWin, lostBuildings: st.lostBuildings, time: r.time, ai: r.ai, maxCottage: st.maxCottage, peakArmy: st.peakArmy });
  for (const a of ach) lines.push([`🏆 ${a.name}`, a.reward]);
  const total = coins + ach.reduce((a, x) => a + x.reward, 0);
  changed();

  // what can I afford now?
  const nextHero = HEROES.filter(h => !P.heroes.includes(h.id)).sort((a, b) => a.cost - b.cost)[0] || null;
  return { lines, total, xp, levelUps, achievements: ach, stars, nextHero, coins: P.coins };
}

export function publicProfile() {
  return { id: P.id, name: P.name, level: P.level, hero: P.equip.hero, fur: P.equip.fur, hat: P.equip.hat, heroes: P.heroes.slice(), fc: P.friendCode || '' };
}
export function setSetting(k, v) { P.settings[k] = v; changed(); }
export function heroUnlocked(id) { return P.heroes.includes(id) || (HERO_BY_ID[id] && HERO_BY_ID[id].cost === 0); }
