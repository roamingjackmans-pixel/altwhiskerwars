// Whisker Wars menus & screens.
import {
  HEROES, HERO_BY_ID, CLANS, FURS, HATS, MAPS, MAP_BY_ID, THEMES, AI_LEVELS, CAMPAIGN, ACHIEVEMENTS, BUILDINGS, EMOTES,
  randomMap, teamColor, RULES, COINS,
} from '../shared/data.js';
import * as P from './profile.js';
import { audio } from './audio.js';
import { Match } from './match.js';
import { OnlineSession } from './online.js';
import { detectServer, cleanCode } from './net.js';
import { heroPortraitURL, catPreviewURL, buildingPreviewURL } from './art.js';
import { normalizeObstacles } from '../shared/nav.js';
import { maskSnap } from '../shared/game.js';
import { initFriends, presence, friends, addFriend, removeFriend, isFriend, myFriendCode, fmtFriendCode, cleanFriendCode, onFriends, setBusyCheck, recentPlayers, noteRecent, beReachable } from './friends.js';
import { isPhone, applyDeviceClass, enterFullscreen, keepAwake, deviceSummary, desktopSiteMode } from './device.js';
import { BUILD, isDev, versionLabel, fetchLatest, isNewer, reloadTo } from './update.js';
import { isInstalled, promptInstall, installSteps, onInstallChange } from './install.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.warn(e); return ''; } };
const portrait = (id, s = 128) => safe(heroPortraitURL, id, s);
const catImg = (fur, hat, s = 96, o = 0) => safe(catPreviewURL, fur, hat, s, o);
const bImg = (t, l, o, s = 96) => safe(buildingPreviewURL, t, l, o, s);

let canvas, screens, hudRoot, modalRoot, toastRoot;
let attract = null, match = null, session = null;
const sentInvites = new Map();   // friend code -> invite waiting for an answer (for the room you are in)
const comingFriends = new Map(); // friend code -> when they said yes (shown as "joining" for a little while)
let inviteChanged = () => { };   // the lobby redraws its invite list through this
let current = null;
const state = { practice: { map: 'meadow', ai: 'normal', enemy: 'random', rules: {}, players: 2 }, lastCampaign: null };

function rulesRow(rules, readonly) {
  return `<div class="rules-row"><div class="rules-l">Fun modifiers${readonly ? ' <span class="muted small">(host picks)</span>' : ''}:</div>${RULES.map(r => `<button class="btn small rule-btn ${rules[r.id] ? 'on' : ''}" data-rule="${r.id}" title="${r.desc}" ${readonly ? 'disabled' : ''}>${r.icon} ${r.name}<small>${r.desc}</small></button>`).join('')}</div>`;
}

// debug handle for testing in the browser console
window.__WW = { get match() { return match; }, get session() { return session; }, get attract() { return attract; }, go };

export function initUI() {
  canvas = $('#game'); screens = $('#screens'); hudRoot = $('#hud'); modalRoot = $('#modal'); toastRoot = $('#toasts');
  document.addEventListener('pointerdown', () => audio.init(), { capture: true });
  document.addEventListener('click', ev => {
    const b = ev.target.closest('button, .clickable');
    if (b && !b.classList.contains('silent')) audio.play(b.classList.contains('back') ? 'back' : 'click', { vol: 0.6 });
  }, { capture: true });
  document.addEventListener('pointerover', ev => { const b = ev.target.closest('.btn, .card.clickable'); if (b && !b._hov) { b._hov = 1; audio.play('hover', { vol: 0.25 }); b.addEventListener('pointerleave', () => (b._hov = 0), { once: true }); } });
  P.onChange(() => refreshTopbar());
  const st = P.profile().settings;
  audio.setVolumes({ sfx: st.sfx, music: st.music });
  audio.setMuted(!!st.muted);
  applyDeviceClass();
  window.addEventListener('resize', applyDeviceClass);
  // The phone's back button (or browser back) mid-battle opens the battle menu instead of leaving the game.
  window.addEventListener('popstate', () => {
    if (match && !match.over && match.hud) {
      try { history.pushState({ ww: 'battle' }, ''); } catch { /* ignore */ }
      match.hud.openPause();
    }
  });
  // friends: invites pop up anywhere in the menus; mid-battle (or with a friend in your lobby) they get "busy"
  setBusyCheck(() => !!match || !!(session && session.peerHere));
  onFriends('invite', showInvite);
  onFriends('invite-gone', inv => {
    const el = document.querySelector('.invite-pop');
    if (el && el._inv === inv) { el.remove(); if (inv.withdrawn) toast(`${esc(inv.name)} cancelled the invite`); }
  });
  onFriends('request', ({ code, name }) => {
    const t = document.createElement('div');
    t.className = 'invite-pop request';
    t.innerHTML = `<div class="ip-t">😺 <b>${esc(name)}</b> added you as a friend</div><div class="ip-b"><button class="btn small primary yes">➕ Add back</button><button class="btn small no">Not now</button></div>`;
    document.body.appendChild(t);
    t.querySelector('.yes').onclick = () => { addFriend(code, name); toast(`😺 ${esc(name)} is now your friend!`, 'good'); t.remove(); };
    t.querySelector('.no').onclick = () => t.remove();
    setTimeout(() => t.remove(), 30000);
  });
  initFriends();
}

/** A friend wants to battle: Join takes you straight into their room. */
function showInvite(inv) {
  document.querySelectorAll('.invite-pop').forEach(e => e.remove());
  const t = document.createElement('div');
  t.className = 'invite-pop';
  t._inv = inv;
  t.innerHTML = `<div class="ip-t">⚔️ <b>${esc(inv.name)}</b> wants to battle!</div>
    <div class="ip-b"><button class="btn primary yes">🐾 Join battle</button><button class="btn small no">Not now</button></div>`;
  document.body.appendChild(t);
  audio.play('meow');
  t.querySelector('.yes').onclick = () => {
    t.remove();
    if (match || (session && session.peerHere)) { inv.respond('busy'); return; }
    inv.respond('yes');
    endSession();
    go('friend', { code: inv.room, auto: true });
  };
  t.querySelector('.no').onclick = () => { inv.respond('no'); t.remove(); };
}

// ---------------------------------------------------------------- attract-mode background battle
function startAttract() {
  if (attract || match) return;
  const heroes = HEROES.map(h => h.id);
  const pick = () => heroes[Math.floor(Math.random() * heroes.length)];
  const map = Math.random() < 0.35 ? randomMap((Math.random() * 1e6) | 0) : structuredClone(MAPS[Math.floor(Math.random() * MAPS.length)]);
  const seats = map.players || 2;
  const furs = FURS.map(f => f.id), hats = HATS.map(h => h.id);
  const r = a => a[Math.floor(Math.random() * a.length)];
  attract = new Match(canvas, hudRoot, {
    mode: 'attract', role: 'local', me: -1, fxLevel: 'medium',
    cfg: { map, seed: (Math.random() * 1e9) | 0, timeLimit: 400, players: Array.from({ length: seats }, (_, i) => ({ name: 'ABCD'[i], hero: pick(), fur: r(furs), hat: r(hats), ai: 'normal' })) },
    onEnd: () => { stopAttract(); if (!match) startAttract(); },
  });
  attract.start(0);
  canvas.classList.add('attract');
}
function stopAttract() { if (attract) { attract.stop(); attract = null; } canvas.classList.remove('attract'); }

// ---------------------------------------------------------------- navigation
export function go(name, params = {}) {
  if (current && current.leave) current.leave(name);
  modalRoot.innerHTML = '';
  const S = SCREENS[name];
  current = { name, leave: null };
  screens.className = 'screens show screen-' + name;
  screens.innerHTML = '';
  if (name !== 'results') startAttract();
  const res = S(params);
  screens.scrollTop = 0;
  if (res && res.leave) current.leave = res.leave;
  if (name === 'home' || name === 'friend') audio.music('menu');
  refreshTopbar();
  renderUpdateBanner();
}

// ---------------------------------------------------------------- version & updates
export const isBusy = () => !!(match || session);
export const currentScreen = () => (current ? current.name : '');
let pendingUpdate = null;
let warnedDesktopSite = false;
/** a newer build exists: show a banner in the menus (never during a battle) */
export function offerUpdate(l) { pendingUpdate = l; renderUpdateBanner(); }
function renderUpdateBanner() {
  let b = document.querySelector('.update-banner');
  if (!pendingUpdate || !current || current.name === 'match') { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('button');
    b.className = 'update-banner silent';
    b.onclick = () => { if (!match) reloadTo(pendingUpdate); };
    document.body.appendChild(b);
  }
  b.innerHTML = `✨ New version <b>v${esc(pendingUpdate.version)}</b> is ready · <u>Update now</u>`;
}
function layoutLine(d) {
  return d.layout === 'phone' ? `📱 Phone${d.forced ? ' (set in Settings)' : ' (detected)'}` : `🖥️ Computer / tablet${d.forced ? ' (set in Settings)' : ' (detected)'}`;
}
function versionBadge(corner = false) {
  return `<button class="ver-badge silent${corner ? ' corner' : ''}" title="Version and device info">${versionLabel()} · ${isPhone() ? '📱' : '🖥️'}</button>`;
}
function wireVersionBadge(root = screens) { const b = $('.ver-badge', root); if (b) b.onclick = () => versionInfo(); }
function versionInfo() {
  const d = deviceSummary();
  const m = modal(`<div class="ver-info">
    <h2>🐾 Whisker Wars</h2>
    <div class="ver-rows">
      <div><span>Version</span><b>v${esc(BUILD.version)}</b></div>
      <div><span>Build</span><b>${isDev() ? 'local test copy' : esc(BUILD.commit)}${BUILD.built ? ` · ${esc(BUILD.built)}` : ''}</b></div>
      <div><span>Battle layout</span><b>${layoutLine(d)}</b></div>
      <div><span>Screen</span><b>${d.screen}${d.touch ? ' · touch' : ''}</b></div>
    </div>
    ${d.desktopSite ? '<p class="ver-warn">Your browser is showing the <b>desktop site</b>. Turn off "Desktop site" in the browser menu for the best phone layout.</p>' : ''}
    <div class="ver-status muted">Checking for updates...</div>
    <div class="row center"><button class="btn small ver-layout">📱 Change layout</button><button class="btn primary small ver-done">Done</button></div>
  </div>`, { cls: 'ver-modal' });
  $('.ver-done', m.el).onclick = m.close;
  $('.ver-layout', m.el).onclick = () => go('settings');
  const st = $('.ver-status', m.el);
  if (isDev()) { st.textContent = 'Local test copy: updates come from the live site.'; return; }
  fetchLatest().then(l => {
    if (!st.isConnected) return;
    if (!l) { st.textContent = "Couldn't check for updates (offline?)."; return; }
    if (!isNewer(l)) { st.innerHTML = '✅ You have the newest version.'; return; }
    st.innerHTML = `✨ <b>v${esc(l.version)}</b> (${esc(l.commit)}) is available. <button class="btn primary small ver-up">Update now</button>`;
    $('.ver-up', st).onclick = () => reloadTo(l);
  });
}

function topbar(back = true, title = '') {
  const p = P.profile();
  return `<div class="topbar">
    ${back ? `<button class="btn small back" data-go="home">← Back</button>` : `<div class="logo-small">🐾 Whisker Wars</div>`}
    ${title ? `<h1 class="screen-title">${title}</h1>` : '<div></div>'}
    <div class="wallet">
      <span class="pill lvl" title="Player level">⭐ Lv <b class="tb-lv">${p.level}</b></span>
      <span class="pill coins" title="Fish coins: earned by playing"><span class="fish">🐟</span> <b class="tb-coins">${p.coins}</b></span>
    </div>
  </div>`;
}
function refreshTopbar() {
  const p = P.profile();
  $$('.tb-coins').forEach(e => { if (+e.textContent !== p.coins) { e.textContent = p.coins; e.parentElement.classList.remove('bump'); void e.offsetWidth; e.parentElement.classList.add('bump'); } });
  $$('.tb-lv').forEach(e => e.textContent = p.level);
}
function wireGo(root = screens) {
  $$('[data-go]', root).forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
}

export function toast(html, kind = '') {
  const t = document.createElement('div');
  t.className = 'mtoast ' + kind;
  t.innerHTML = html;
  toastRoot.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 500); }, 3200);
}
function modal(html, opts = {}) {
  modalRoot.innerHTML = `<div class="modal-bg"><div class="modal ${opts.cls || ''}">${opts.close !== false ? '<button class="modal-x back">✕</button>' : ''}${html}</div></div>`;
  const bg = $('.modal-bg', modalRoot);
  const close = () => { modalRoot.innerHTML = ''; opts.onClose && opts.onClose(); };
  const x = $('.modal-x', modalRoot); if (x) x.onclick = close;
  if (opts.close !== false) bg.addEventListener('click', ev => { if (ev.target === bg) close(); });
  return { el: $('.modal', modalRoot), close };
}

// ---------------------------------------------------------------- shared widgets
function heroCard(h, { selected, locked, small } = {}) {
  const c = CLANS[h.clan];
  return `<div class="hero-card card clickable ${selected ? 'sel' : ''} ${locked ? 'locked' : ''} ${small ? 'small' : ''}" data-hero="${h.id}" style="--clan:${c.color}">
    <img src="${portrait(h.id, small ? 96 : 140)}" alt="">
    <div class="hc-name">${h.name}</div>
    ${small ? '' : `<div class="hc-title">${h.title}</div>`}
    ${locked ? `<div class="hc-lock">🔒 <span class="fish">🐟</span>${h.cost}</div>` : ''}
  </div>`;
}
function heroDetail(h) {
  const c = CLANS[h.clan];
  const tl = { own: 'your building', enemy: 'enemy building', neutral: 'stray building', notown: 'enemy/stray building', area: 'area', global: 'instant' };
  return `<div class="hero-detail" style="--clan:${c.color}">
    <div class="hd-top">
      <img class="hd-portrait" src="${portrait(h.id, 200)}" alt="">
      <div>
        <div class="hd-clan">${c.icon} ${c.name}</div>
        <h2>${h.name}</h2><div class="hd-title">${h.title}</div>
        <p class="hd-blurb">${h.blurb}</p>
      </div>
    </div>
    <div class="ability passive"><div class="ab-icon">✦</div><div><b>${h.passive.name}</b> <span class="ab-tag">passive</span><div>${h.passive.desc}</div></div></div>
    ${h.spells.map((s, k) => `<div class="ability"><div class="ab-icon">${s.icon}</div><div><b>${s.name}</b> <span class="ab-tag">${k + 1}</span>
      <div>${s.desc}</div><div class="ab-meta">🌿 ${s.cost} catnip · ⏱ ${s.cd}s · 🎯 ${tl[s.target]}</div></div></div>`).join('')}
  </div>`;
}
/** Inline hero picker (unlocked heroes selectable; locked shown). */
function heroPicker(root, selected, onPick) {
  const draw = () => {
    root.innerHTML = `<div class="hero-strip">${HEROES.map(h => heroCard(h, { selected: h.id === selected, locked: !P.heroUnlocked(h.id), small: true })).join('')}</div>`;
    $$('.hero-card', root).forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.hero;
      if (!P.heroUnlocked(id)) { showHero(id, () => { draw(); }); return; }
      selected = id; draw(); onPick(id);
      audio.play('meow', { vol: 0.5, pitch: 1 + Math.random() * 0.2 });
    }));
  };
  draw();
}
function showHero(id, after) {
  const h = HERO_BY_ID[id];
  const owned = P.heroUnlocked(id);
  const p = P.profile();
  const m = modal(`${heroDetail(h)}
    <div class="modal-actions">
      ${owned ? `<button class="btn primary act-equip">${p.equip.hero === id ? '✔ Your main hero' : 'Make main hero'}</button>`
      : `<button class="btn primary act-buy ${p.coins >= h.cost ? '' : 'off'}">Unlock for <span class="fish">🐟</span> ${h.cost}</button>`}
    </div>`, { cls: 'wide' });
  const buy = $('.act-buy', m.el);
  if (buy) buy.onclick = () => {
    const r = P.buy('hero', id);
    if (!r.ok) { audio.play('error'); toast(r.msg, 'warn'); return; }
    audio.play('unlock'); toast(`🎉 <b>${h.name}</b> joined your clowder!`, 'good');
    for (const a of r.newAch || []) toast(`🏆 Achievement: <b>${a.name}</b> +${a.reward} 🐟`, 'good');
    P.equip('hero', id);
    m.close(); after && after();
  };
  const eq = $('.act-equip', m.el);
  if (eq) eq.onclick = () => { P.equip('hero', id); m.close(); after && after(); };
}
// thumbnail colours for terrain: [water, solid lumps, hedges/walls, bridges]
const MINI_TERRAIN = {
  meadow: ['#4aa8d8', '#9a6e42', '#3f8f3a', '#b98552'], rooftop: ['#3a2530', '#8a4634', '#843f30', '#b3865c'],
  snow: ['#4a85bb', '#a9c2df', '#8fc0e6', '#b98d64'], night: ['#15304a', '#3b4653', '#1b4537', '#86735e'],
  beach: ['#2a9fc4', '#d0aa68', '#7b736c', '#d6ab76'], candy: ['#6a3820', '#663620', '#ff5d8f', '#ebbc7c'],
};
function miniTerrain(m, th) {
  const C = MINI_TERRAIN[m.theme] || MINI_TERRAIN.meadow, k = 10;
  const pts = s => s.pts.map(([x, y]) => `${(x / k).toFixed(1)},${(y / k).toFixed(1)}`).join(' ');
  const el = (s, fill) => s.g === 'circle' ? `<circle cx="${s.x / k}" cy="${s.y / k}" r="${s.r / k}" fill="${fill}"/>`
    : s.g === 'poly' ? `<polygon points="${pts(s)}" fill="${fill}"/>`
    : `<polyline points="${pts(s)}" fill="none" stroke="${fill}" stroke-width="${s.w / k}" stroke-linecap="${s.t === 'bridge' ? 'butt' : 'round'}" stroke-linejoin="round"/>`;
  const S = normalizeObstacles(m.obstacles);
  return S.filter(s => s.cls === 'water').map(s => el(s, C[0])).join('')
    + S.filter(s => s.t === 'island').map(s => el(s, th.ground)).join('')
    + S.filter(s => s.t === 'bridge').map(s => el(s, C[3])).join('')
    + S.filter(s => s.cls === 'solid').map(s => el(s, s.g === 'line' && s.t !== 'mound' ? C[2] : C[1])).join('');
}
function mapPreview(m) {
  const th = THEMES[m.theme] || THEMES.meadow;
  const terrain = m.obstacles && m.obstacles.length ? `<clipPath id="mc-${m.id}"><rect width="160" height="90" rx="8"/></clipPath><g clip-path="url(#mc-${m.id})">${miniTerrain(m, th)}</g>` : '';
  const dots = (m.buildings || []).map(b => {
    const c = b.owner >= 0 ? teamColor(b.owner).main : '#efe8dc';
    const r = b.type === 'cattree' ? 7 : 4.5;
    return `<circle cx="${b.x / 10}" cy="${b.y / 10}" r="${r}" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`;
  }).join('');
  return `<svg viewBox="0 0 160 90" class="map-svg"><rect width="160" height="90" rx="8" fill="${th.ground}"/><rect x="4" y="4" width="152" height="82" rx="6" fill="${th.ground2}" opacity=".5"/>${terrain}${dots}</svg>`;
}
/** maps for this many players (random maps are 2-player only) */
function mapsFor(n) {
  const list = MAPS.filter(m => (m.players || 2) === n);
  return n === 2 ? [...list, { id: 'random', name: 'Random Map', theme: 'meadow', size: '???', desc: 'A brand new battlefield every time.', buildings: [] }] : list;
}
const mapPlayers = id => (id === 'random' ? 2 : (MAP_BY_ID[id] && MAP_BY_ID[id].players) || 2);
function mapPicker(root, selected, onPick, opts = {}) {
  const maps = mapsFor(opts.players || 2);
  const draw = () => {
    root.innerHTML = `<div class="map-grid">${maps.map(m => `<div class="map-card card ${opts.readonly ? '' : 'clickable'} ${m.id === selected ? 'sel' : ''}" data-map="${m.id}">
      ${m.id === 'random' ? '<div class="map-svg rnd">🎲</div>' : mapPreview(m)}
      <div class="mc-name">${m.name}</div><div class="mc-size">${m.size}${m.theme && m.id !== 'random' ? ' · ' + THEMES[m.theme].name : ''}</div></div>`).join('')}</div>`;
    if (!opts.readonly) $$('.map-card', root).forEach(el => el.addEventListener('click', () => { selected = el.dataset.map; draw(); onPick(selected); }));
  };
  draw();
}
function resolveMap(id, seed) {
  return id === 'random' ? randomMap(seed >>> 0) : structuredClone(MAP_BY_ID[id] || MAPS[0]);
}

// ---------------------------------------------------------------- SCREENS
const SCREENS = {};

SCREENS.home = () => {
  const p = P.profile();
  const eq = HERO_BY_ID[p.equip.hero] || HEROES[0];
  screens.innerHTML = `${topbar(false)}
    <div class="home">
      <div class="logo">
        <div class="logo-ears"><span></span><span></span></div>
        <div class="logo-text"><span class="w1">Whisker</span><span class="w2">Wars</span></div>
        <div class="logo-sub">Real-time cat kingdom battles</div>
      </div>
      <div class="home-main">
        <button class="btn huge primary pulse" data-go="friend">⚔️ Battle a Friend<small>Real-time online PvP · share a room code</small></button>
        <div class="home-grid">
          <button class="btn tile" data-go="campaign"><span class="ti">🗺️</span>Campaign<small>${Object.keys(p.campaign).length}/${CAMPAIGN.length} cleared</small></button>
          <button class="btn tile" data-go="practice"><span class="ti">🤖</span>Practice<small>vs computer cats</small></button>
          <button class="btn tile" data-go="heroes"><span class="ti">😺</span>Heroes<small>${p.heroes.length}/${HEROES.length} unlocked</small></button>
          <button class="btn tile" data-go="shop"><span class="ti">🛍️</span>Cat Shop<small>furs & hats</small></button>
          <button class="btn tile" data-go="profile"><span class="ti">🏆</span>Profile<small>stats & trophies</small></button>
          <button class="btn tile" data-go="howto"><span class="ti">📖</span>How to Play<small>learn in 1 minute</small></button>
        </div>
      </div>
      <div class="home-me card clickable" data-go="profile">
        <img src="${catImg(p.equip.fur, p.equip.hat, 96, 0)}" alt="">
        <div><div class="hm-name">${esc(p.name)}</div><div class="hm-sub">Main hero: ${eq.name}</div></div>
      </div>
      <button class="btn icon settings-btn" data-go="settings" title="Settings">⚙️</button>
    </div>
    ${versionBadge(true)}`;
  wireGo();
  wireVersionBadge();
  if (desktopSiteMode() && !warnedDesktopSite) {
    warnedDesktopSite = true;
    setTimeout(() => toast('📱 Your browser is showing the <b>desktop site</b>. Turn off "Desktop site" in its menu for the phone layout.', 'warn'), 900);
  }
  if (!p.seenTutorial) setTimeout(() => welcome(), 400);
  else if (P.dailyAvailable()) setTimeout(() => dailyGift(), 500);
};

function welcome() {
  const p = P.profile();
  const m = modal(`<div class="welcome">
    <img class="welcome-cat" src="${catImg('ginger', 'crown', 160, 0)}" alt="">
    <h2>Welcome to Whisker Wars!</h2>
    <p>Lead an army of adorable cats, capture cottages, cast silly spells and conquer your friends.</p>
    <label>What should we call you, commander?</label>
    <div class="row"><input class="name-in" maxlength="16" value="${esc(p.name)}"><button class="btn small dice silent" title="Random name">🎲</button></div>
    <button class="btn primary big go-tut">Let's go! 🐾</button>
    <p class="muted small">Tip: open <b>How to Play</b> for a 1-minute guide.</p>
  </div>`, { close: false });
  const names = ['Mochi', 'Noodle', 'Biscuit', 'Pickles', 'Tofu', 'Meowzart', 'Purrlock', 'Socks', 'Butterbean', 'Clawdia', 'Catniss', 'Sushi', 'Waffles', 'Pudding'];
  $('.dice', m.el).onclick = () => { $('.name-in', m.el).value = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 90 + 10); audio.play('mew'); };
  $('.go-tut', m.el).onclick = () => {
    P.setName($('.name-in', m.el).value);
    P.profile().seenTutorial = true; P.save();
    m.close();
    audio.play('meow');
    go('home'); // home shows the daily gift
  };
}
function dailyGift() {
  const m = modal(`<div class="daily"><div class="gift">🎁</div><h2>Daily Gift!</h2><p>The Cat Council sends you a basket of fish.</p>
    <button class="btn primary big claim">Claim <span class="fish">🐟</span> ${COINS.dailyGift}</button></div>`, { close: false });
  $('.claim', m.el).onclick = () => { const n = P.claimDaily(); audio.play('coins'); toast(`+${n} 🐟 fish coins!`, 'good'); m.close(); };
}

// ---------- Friend (create / join)
SCREENS.friend = (params = {}) => {
  screens.innerHTML = `${topbar(true, 'Battle a Friend')}
    <div class="friend ${friends().length ? 'has-friends' : ''}">
      <div class="card panel">
        <div class="big-emoji">🏠</div>
        <h2>Create a room</h2>
        <p>Get a 5-number code (and a link) to send to your friend.</p>
        <button class="btn primary big create">Create Room</button>
      </div>
      <div class="card panel">
        <div class="big-emoji">🔑</div>
        <h2>Join a room</h2>
        <p>Type the code your friend sent you.</p>
        <input class="code-in" maxlength="6" placeholder="12345" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(params.code || '')}">
        <button class="btn primary big join">Join Room</button>
      </div>
      <div class="card panel friends-panel">
        <h2>😺 Friends</h2>
        <div class="fp-me">Your friend code <b class="fp-code">${fmtFriendCode(myFriendCode())}</b> <button class="btn small copy-fc">📋 Copy</button></div>
        <div class="fp-add"><input class="fc-in" maxlength="9" placeholder="Friend's code" inputmode="numeric" autocomplete="off"><button class="btn small primary add-fc">➕ Add</button></div>
        <div class="fp-list"></div>
        <p class="muted small">Friends with Whisker Wars open show up as online. Tap <b>Invite</b> and they can jump straight into your room. You can also add the player you just battled from the lobby.</p>
      </div>
    </div>
    <div class="net-mode muted small center"></div>`;
  wireGo();
  detectServer().then(u => { const el = $('.net-mode'); if (el) el.innerHTML = u ? '🟢 Connected via the Whisker Wars server' : '🟢 Direct peer-to-peer mode (no server needed)'; });
  const createBtn = $('.create'), joinBtn = $('.join'), input = $('.code-in');
  input.addEventListener('input', () => { input.value = cleanCode(input.value); });
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') joinBtn.click(); });
  createBtn.onclick = async () => {
    createBtn.disabled = true; createBtn.textContent = 'Creating...';
    try { endSession(); session = await OnlineSession.host(); go('lobby'); }
    catch (e) { console.error(e); toast('😿 Could not create a room: ' + esc(e.message || e), 'warn'); createBtn.disabled = false; createBtn.textContent = 'Create Room'; }
  };
  joinBtn.onclick = async () => {
    const code = cleanCode(input.value);
    if (code.length < 5) { toast('Room codes have 5 numbers', 'warn'); audio.play('error'); return; }
    joinBtn.disabled = true; joinBtn.textContent = 'Joining...';
    try { endSession(); session = await OnlineSession.join(code); go('lobby'); }
    catch (e) {
      console.error(e);
      toast(e.code === 'notfound' ? `😿 No room called <b>${code}</b>. Check the code with your friend.` : '😿 ' + esc(e.message || 'Could not join'), 'warn');
      joinBtn.disabled = false; joinBtn.textContent = 'Join Room';
    }
  };
  if (params.code && params.auto) setTimeout(() => joinBtn.click(), 300);

  // ---- friends
  const list = $('.fp-list');
  const STATE = { online: ['on', 'Online'], busy: ['busy', 'Playing'], offline: ['off', 'Offline'], checking: ['chk', 'Checking…'] };
  const drawFriends = () => {
    if (!list.isConnected) return;
    const fs = friends();
    if (!fs.length) { list.innerHTML = '<div class="fp-empty muted">No friends yet. Swap friend codes, or add someone you just battled.</div>'; return; }
    const rank = c => ({ online: 0, busy: 1, checking: 2 }[(presence.status.get(c) || {}).state] ?? 3);
    list.innerHTML = fs.slice().sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name)).map(f => {
      const st = (presence.status.get(f.code) || { state: 'checking' }).state, [cls, label] = STATE[st] || STATE.offline;
      return `<div class="fp-row ${cls}" data-code="${f.code}"><span class="fp-dot"></span>
        <div class="fp-who"><b>${esc(f.name)}</b><span class="muted small">${label} · ${fmtFriendCode(f.code)}</span></div>
        <button class="btn small primary inv" ${st === 'online' ? '' : 'disabled'}>⚔️ Invite</button>
        <button class="btn small fp-x silent" title="Remove friend" aria-label="Remove ${esc(f.name)}">✕</button></div>`;
    }).join('');
    $$('.fp-row .inv', list).forEach(b => b.onclick = () => inviteFriend(b.closest('.fp-row').dataset.code, b));
    $$('.fp-row .fp-x', list).forEach(b => b.onclick = () => {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Remove?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = '✕'; } }, 2500); return; }
      removeFriend(b.closest('.fp-row').dataset.code);
    });
  };
  const fcIn = $('.fc-in');
  fcIn.addEventListener('input', () => { fcIn.value = fmtFriendCode(fcIn.value); });
  const add = () => {
    const r = addFriend(cleanFriendCode(fcIn.value));
    if (!r.ok) { toast(r.msg, 'warn'); audio.play('error'); return; }
    toast(r.already ? 'Already your friend' : '😺 Friend added! Checking if they are online…', 'good');
    fcIn.value = '';
    drawFriends();
  };
  $('.add-fc').onclick = add;
  fcIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
  $('.copy-fc').onclick = () => navigator.clipboard?.writeText(myFriendCode()).then(() => toast('📋 Friend code copied!', 'good'), () => toast(myFriendCode()));
  const offChange = onFriends('change', drawFriends);
  beReachable();
  const stopWatch = presence.watch();
  drawFriends();
  return { leave: () => { offChange(); stopWatch(); } };
};

/** Make a room and invite a friend into it. */
async function inviteFriend(code, btn) {
  if (!friends().some(x => x.code === code)) return;
  btn.disabled = true; btn.textContent = 'Inviting…';
  try { endSession(); session = await OnlineSession.host(); }
  catch (e) { console.error(e); toast('😿 Could not create a room: ' + esc(e.message || e), 'warn'); btn.disabled = false; btn.textContent = '⚔️ Invite'; return; }
  go('lobby');
  sendInvite(code);
}

const inRoom = (S, code) => !!S && S.lobby.players.some(pl => pl && pl.fc === code);
const personName = code => (friends().find(x => x.code === code) || recentPlayers().find(x => x.code === code) || { name: 'Your friend' }).name;

/** Invite a friend (or someone you played recently) into the room you are in. They get a pop-up and one tap joins. */
function sendInvite(code) {
  const S = session;
  if (!S || sentInvites.has(code)) return;
  const name = personName(code);
  const inv = presence.invite(code, S.code);
  sentInvites.set(code, inv);
  comingFriends.delete(code);
  inviteChanged();
  toast(`📨 Invite sent to <b>${esc(name)}</b>…`, 'good');
  inv.then(ans => {
    if (sentInvites.get(code) !== inv) return;
    sentInvites.delete(code);
    if (session !== S) return;
    if (ans === 'yes') { comingFriends.set(code, Date.now()); setTimeout(() => { comingFriends.delete(code); inviteChanged(); }, 20000); toast(`😺 <b>${esc(name)}</b> is on the way!`, 'good'); }
    else if (ans === 'busy') toast(`⚔️ <b>${esc(name)}</b> is already playing right now`, 'warn');
    else if (ans === 'offline') toast(`😿 Couldn't reach <b>${esc(name)}</b>. Send them the room code instead.`, 'warn');
    else if (ans !== 'cancelled' && !inRoom(S, code)) toast(`😿 <b>${esc(name)}</b> can't play right now`, 'warn');
    inviteChanged();
  });
}

function endSession() {
  for (const inv of sentInvites.values()) inv.cancel();
  sentInvites.clear();
  comingFriends.clear();
  if (session) { session.close(); session = null; }
}

// ---------- Lobby
SCREENS.lobby = () => {
  if (!session) return go('friend');
  const S = session;
  const p = P.profile();
  if (!P.heroUnlocked(p.equip.hero)) P.equip('hero', 'whiskers');
  S.setPick({ hero: p.equip.hero, fur: p.equip.fur, hat: p.equip.hat, name: p.name, level: p.level });
  const link = `${location.origin}${location.pathname}?room=${S.code}`;
  screens.innerHTML = `${topbar(false, 'Battle Lobby')}
    <div class="lobby">
      <div class="room card">
        <div class="invite-box">
          <div class="ib-head"><b>😺 Invite friends</b><span class="ib-note muted small"></span><button class="btn small ib-addbtn">➕ Add friend</button></div>
          <div class="ib-add" hidden>
            <div class="fp-add"><input class="fc-in" maxlength="9" placeholder="Friend's code" inputmode="numeric" autocomplete="off"><button class="btn small primary add-fc">➕ Add</button></div>
            <div class="fp-me small">Your friend code <b class="fp-code">${fmtFriendCode(myFriendCode())}</b> <button class="btn small copy-fc">📋 Copy</button></div>
          </div>
          <div class="ib-list"></div>
        </div>
        <div class="room-l">OR SEND THE ROOM CODE</div>
        <div class="room-code">${S.code.split('').map(c => `<span>${c}</span>`).join('')}</div>
        <div class="row center">
          <button class="btn small copy-code">📋 Copy code</button>
          <button class="btn small copy-link">🔗 Copy invite link</button>
          ${navigator.share ? '<button class="btn small share">📤 Share</button>' : ''}
        </div>
        <div class="room-mode muted small">${S.kind === 'server' ? 'via game server' : S.kind === 'relay' ? 'via backup relay' : 'peer-to-peer'}</div>
      </div>
      <div class="lobby-seats"></div>
      <div class="lobby-cols">
        <div class="card panel"><h3>Choose your hero</h3><div class="lobby-heroes"></div><div class="lobby-hero-detail"></div></div>
        <div class="card panel"><h3>Battlefield ${S.isHost ? '' : '<span class="muted small">(host picks)</span>'}</h3>
          <div class="size-row">Players: ${[2, 3, 4].map(n => `<button class="btn small size-btn" data-n="${n}" ${S.isHost ? '' : 'disabled'}>${'🐱'.repeat(n)} ${n}</button>`).join('')}</div>
          <div class="lobby-maps"></div>
          <div class="time-row">Time limit: ${[300, 480, 600, 900].map(t => `<button class="btn small time-btn" data-t="${t}" ${S.isHost ? '' : 'disabled'}>${t / 60} min</button>`).join('')}</div>
          <div class="lobby-rules"></div>
          <div class="lobby-emotes">${EMOTES.map(e => `<button class="btn small lem" data-e="${e.id}" title="${e.text}">${e.icon}</button>`).join('')}</div>
        </div>
      </div>
      <div class="lobby-bar">
        <button class="btn back leave">🚪 Leave</button>
        <div class="lobby-status"></div>
        <button class="btn primary big ready-btn"></button>
      </div>
    </div>`;
  const copy = (txt, what) => { navigator.clipboard?.writeText(txt).then(() => toast(`📋 ${what} copied!`, 'good'), () => toast(txt)); };
  $('.copy-code').onclick = () => copy(S.code, 'Code');
  $('.copy-link').onclick = () => copy(link, 'Invite link');
  const sh = $('.share'); if (sh) sh.onclick = () => navigator.share({ title: 'Whisker Wars', text: `Battle me in Whisker Wars! Room code: ${S.code}`, url: link }).catch(() => { });
  $('.leave').onclick = () => { endSession(); go('home'); };

  // ---- invite friends: online friends (and people you played recently) get a pop-up, one tap joins this room
  const ibList = $('.ib-list'), ibAdd = $('.ib-add'), ibNote = $('.ib-note'), fcIn = $('.fc-in', ibAdd);
  const SHOW = isPhone() ? 4 : 6, DOT = { online: 'on', busy: 'busy', checking: 'chk', offline: 'off' };
  let ibAll = false, stopWatch = null;
  const watch = () => { if (!stopWatch && (friends().length || recentPlayers().length)) stopWatch = presence.watch(); };
  const drawInvites = () => {
    if (!ibList.isConnected) return;
    watch();
    const L = S.lobby, size = L.size || 2, full = S.joined() >= size;
    const st = c => (presence.status.get(c) || { state: 'checking' }).state;
    const people = [...friends().map(f => ({ ...f, recent: false })), ...recentPlayers().map(r => ({ ...r, recent: true }))];
    if (!people.length) {
      ibNote.textContent = '';
      ibList.innerHTML = '<div class="ib-empty muted small">No friends yet. Add one with their friend code, or tap <b>➕ Add friend</b> on someone you battle.</div>';
      return;
    }
    const rank = f => inRoom(S, f.code) ? 0 : comingFriends.has(f.code) || sentInvites.has(f.code) ? 1 : ({ online: 2, busy: 3, checking: 4 }[st(f.code)] ?? 5) + (f.recent ? 0.5 : 0);
    people.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const online = people.filter(f => st(f.code) === 'online' && !inRoom(S, f.code)).length;
    ibNote.textContent = full ? (S.isHost && size < 4 ? 'Room full: pick more players below to invite more' : 'Room full') : online ? `${online} online` : '';
    ibList.innerHTML = (ibAll ? people : people.slice(0, SHOW)).map(f => {
      const s = st(f.code), here = inRoom(S, f.code), sent = sentInvites.has(f.code), coming = comingFriends.has(f.code);
      const label = here ? '✔ Here' : coming ? '🐾 Joining' : sent ? '📨 Sent' : s === 'online' ? '⚔️ Invite' : s === 'busy' ? 'Playing' : s === 'checking' ? '…' : 'Offline';
      const can = !here && !sent && !coming && s === 'online' && !full;
      return `<div class="ib-f ${here ? 'here' : DOT[s] || 'off'}" data-code="${f.code}"><span class="fp-dot"></span>
        <span class="ib-n"><b>${esc(f.name)}</b>${f.recent ? '<small>played recently</small>' : ''}</span>
        ${f.recent ? `<button class="btn small ib-plus" title="Add ${esc(f.name)} as a friend" aria-label="Add ${esc(f.name)} as a friend">➕</button>` : ''}
        <button class="btn small ${can ? 'primary' : ''} ib-inv" ${can ? '' : 'disabled'}>${label}</button></div>`;
    }).join('') + (people.length > SHOW ? `<button class="btn small ib-more">${ibAll ? 'Show fewer' : `Show all ${people.length}`}</button>` : '');
    $$('.ib-inv', ibList).forEach(b => b.onclick = () => sendInvite(b.closest('.ib-f').dataset.code));
    $$('.ib-plus', ibList).forEach(b => b.onclick = () => {
      const c = b.closest('.ib-f').dataset.code, n = personName(c), r = addFriend(c, n);
      toast(r.ok ? `😺 <b>${esc(n)}</b> is now your friend` : r.msg, r.ok ? 'good' : 'warn');
    });
    const more = $('.ib-more', ibList); if (more) more.onclick = () => { ibAll = !ibAll; drawInvites(); };
  };
  if (!friends().length && !recentPlayers().length) ibAdd.hidden = false;
  $('.ib-addbtn').onclick = () => { ibAdd.hidden = !ibAdd.hidden; if (!ibAdd.hidden) fcIn.focus(); };
  fcIn.addEventListener('input', () => { fcIn.value = fmtFriendCode(fcIn.value); });
  const addFc = () => {
    const r = addFriend(cleanFriendCode(fcIn.value));
    if (!r.ok) { toast(r.msg, 'warn'); audio.play('error'); return; }
    toast(r.already ? 'Already your friend' : '😺 Friend added! Checking if they are online…', 'good');
    fcIn.value = ''; ibAdd.hidden = true;
    drawInvites();
  };
  $('.add-fc', ibAdd).onclick = addFc;
  fcIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') addFc(); });
  $('.copy-fc', ibAdd).onclick = () => copy(myFriendCode(), 'Friend code');
  inviteChanged = drawInvites;
  const offFriends = onFriends('change', drawInvites);
  beReachable();

  let myHero = p.equip.hero;
  const drawDetail = () => { $('.lobby-hero-detail').innerHTML = heroDetail(HERO_BY_ID[myHero]); };
  heroPicker($('.lobby-heroes'), myHero, id => { myHero = id; P.equip('hero', id); S.setPick({ hero: id }); if (S.lobby.ready[S.me]) S.setReady(false); drawDetail(); });
  drawDetail();
  let lastMap = null, lastSize = 0;
  // only maps made for the lobby's number of players
  const drawMaps = () => mapPicker($('.lobby-maps'), S.lobby.map, id => S.setMap(id), { readonly: !S.isHost, players: S.lobby.size || 2 });
  $$('.time-btn').forEach(b => b.onclick = () => S.setTime(+b.dataset.t));
  $$('.size-btn').forEach(b => b.onclick = () => {
    const n = +b.dataset.n;
    if (n === S.lobby.size) return;
    const map = mapPlayers(S.lobby.map) === n ? S.lobby.map : mapsFor(n)[0].id;
    if (!S.setSize(n, map)) { audio.play('error'); toast(`${S.joined()} players are already here`, 'warn'); }
  });
  $$('.lem').forEach(b => b.onclick = () => { S.lobbyEmote(b.dataset.e); showLobbyEmote(S.me, b.dataset.e); audio.play('emote'); });

  const slot = (pl, i, ready) => {
    if (!pl) return `<div class="pcard-l empty" data-seat="${i}"><div class="waiting-cat">🐾</div><div>Waiting for a friend...</div><div class="muted small">Send them the code <b>${S.code}</b></div></div>`;
    const h = HERO_BY_ID[pl.hero] || HEROES[0];
    return `<div class="pcard-l${i === S.me ? ' mine' : ''}" data-seat="${i}" style="--tc:${teamColor(i).main}">
      <img class="pl-hero" src="${portrait(h.id, 120)}" alt="">
      <div class="pl-info"><div class="pl-name">${esc(pl.name)} <span class="pill tiny">Lv ${pl.level}</span></div><div class="pl-hero-n">${h.name}</div>
      <div class="pl-cat"><img src="${catImg(pl.fur, pl.hat, 64, i)}" alt=""></div></div>
      <div class="pl-ready ${ready ? 'on' : ''}">${ready ? '✔ READY' : i === 0 && S.isHost ? 'HOST' : 'not ready'}</div>
      ${i !== S.me && /^\d{8}$/.test(pl.fc || '') ? (isFriend(pl.fc) ? '<div class="pl-friend">😺 Friend</div>' : '<button class="btn small pl-add">➕ Add friend</button>') : ''}
      <div class="lemote-pop"></div>
    </div>`;
  };
  const showLobbyEmote = (i, id) => {
    const el = $(`.lobby-seats [data-seat="${i}"] .lemote-pop`);
    const em = EMOTES.find(x => x.id === id);
    if (el && em) { el.textContent = `${em.icon} ${em.text}`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
  };
  const render = () => {
    const L = S.lobby;
    const me = S.me, size = L.size || 2;
    // you first, then everyone else in seat order (each seat has its team colour)
    const seats = [me, ...Array.from({ length: size }, (_, k) => k).filter(k => k !== me)];
    for (const [k, pl] of L.players.entries()) if (pl && k !== me && pl.fc) noteRecent(pl.fc, pl.name);
    const box = $('.lobby-seats');
    box.className = 'lobby-seats n' + size;
    box.innerHTML = seats.map((k, n) => (n === 1 && size === 2 ? '<div class="vs">VS</div>' : '') + slot(L.players[k], k, L.ready[k])).join('');
    $$('.lobby-seats .pl-add').forEach(btn => btn.onclick = () => {
      const o = S.lobby.players[+btn.closest('[data-seat]').dataset.seat];
      const r = addFriend(o.fc, o.name);
      toast(r.ok ? `😺 <b>${esc(o.name)}</b> is now your friend. Invite them any time from Battle a Friend!` : r.msg, r.ok ? 'good' : 'warn');
      render();
    });
    $$('.size-btn').forEach(b => b.classList.toggle('on', +b.dataset.n === size));
    if (L.map !== lastMap || size !== lastSize) { lastMap = L.map; lastSize = size; drawMaps(); }
    $$('.time-btn').forEach(b => b.classList.toggle('on', +b.dataset.t === L.time));
    $('.lobby-rules').innerHTML = rulesRow(L.rules || {}, !S.isHost);
    if (S.isHost) $$('.rule-btn').forEach(b => b.onclick = () => S.toggleRule(b.dataset.rule));
    const rb = $('.ready-btn'), st = $('.lobby-status');
    const here = S.joined(), readyN = L.ready.slice(1, size).filter(Boolean).length;
    if (S.isHost) {
      rb.textContent = '⚔️ Start Battle!';
      rb.classList.toggle('off', !S.canStart());
      st.innerHTML = size === 2
        ? (here < 2 ? 'Waiting for your friend to join...' : L.ready[1] ? '<b>Your friend is ready!</b> Start when you are.' : 'Waiting for your friend to press Ready...')
        : (here < size ? `<b>${here} of ${size}</b> players here. Send the code to your friends!` : readyN < size - 1 ? `${readyN} of ${size - 1} friends ready...` : '<b>Everyone is ready!</b> Start when you are.');
    } else {
      rb.textContent = L.ready[me] ? '✔ Ready! (tap to cancel)' : '👍 I\'m Ready!';
      rb.classList.toggle('on', !!L.ready[me]);
      st.innerHTML = L.ready[me] ? 'Waiting for the host to start...' : 'Pick your hero, then press Ready.';
    }
    drawInvites();
  };
  $('.ready-btn').onclick = () => {
    if (S.isHost) {
      if (!S.canStart()) { audio.play('error'); toast(S.joined() < (S.lobby.size || 2) ? 'Not everyone is here yet — send them the code!' : 'Not everyone is ready yet', 'warn'); return; }
      startOnline();
    } else S.setReady(!S.lobby.ready[S.me]);
  };
  const offs = [
    S.on('lobby', render),
    S.on('guest-hello', pl => { toast(`😺 <b>${esc(pl.name)}</b> joined the room!`, 'good'); audio.play('meow'); }),
    S.on('peer-leave', () => { toast('😿 A friend left the room', 'warn'); }),
    S.on('lemote', (id, from) => { showLobbyEmote(from, id); audio.play('emote'); }),
    S.on('start', m => startGuest(m)),
    S.on('disconnected', () => { toast('😿 Lost connection to the room', 'warn'); endSession(); go('friend'); }),
    S.on('error', e => { toast('😿 ' + esc(e.message), 'warn'); if (/full/i.test(e.message)) { endSession(); go('friend'); } }),
  ];
  render();
  return { leave: () => { offs.forEach(f => f()); offFriends(); if (stopWatch) stopWatch(); inviteChanged = () => { }; } };
};

function startOnline() {
  const S = session;
  const L = S.lobby;
  const cfg = {
    map: resolveMap(L.map, L.seed), seed: L.seed, timeLimit: L.time, rules: L.rules || {},
    players: L.players.slice(0, L.size || 2).map(pl => ({ name: pl.name, hero: pl.hero, fur: pl.fur, hat: pl.hat })),
  };
  S.markMatch();
  const m = beginMatch({
    mode: 'online', role: 'host', me: 0, cfg,
    send: msg => S.send(msg), getPing: () => S.ping,
    // every guest gets their own snapshot: enemy building counts are hidden from them
    sendSnap: out => { for (const [slot, seat] of S.slots) S.send({ type: 'snap', s: maskSnap(out, seat) }, slot); },
  });
  for (const [slot, seat] of S.slots) S.send({ type: 'start', info: m.info, snap: m.currentSnap(seat) }, slot);
  wireSessionToMatch(m);
}
function startGuest(msg) {
  const S = session;
  const m = beginMatch({ mode: 'online', role: 'guest', me: S.me, info: msg.info, firstSnap: msg.snap, send: x => S.send(x), getPing: () => S.ping });
  wireSessionToMatch(m);
}
function wireSessionToMatch(m) {
  const S = session;
  S.inMatch = true;
  const GRACE = 20;
  let timer = null;
  const offs = [S.on('snap', s => m.pushRemoteSnap(s))];
  if (S.isHost) {
    // host: pause and wait for a dropped player to come back. 2 players: if they don't, you win.
    // 3-4 players: if they don't, they're out (their buildings go stray) and the battle carries on.
    const waits = new Map();   // seat -> seconds left
    const many = (m.info.players || []).length > 2;
    const show = () => {
      if (!waits.size) { m.hud && m.hud.waiting(null); return; }
      const names = [...waits.keys()].map(k => esc((m.info.players[k] || {}).name || 'A player')).join(', ');
      const left = Math.max(...waits.values());
      m.hud && m.hud.waiting(`${names} lost connection...<br>Waiting <b>${left}s</b> for them to come back`);
    };
    const tick = () => {
      timer = null;
      if (m.over) return;
      for (const [k, s] of [...waits]) {
        if (s > 0) { waits.set(k, s - 1); continue; }
        waits.delete(k);
        if (!many) { m.hud && m.hud.waiting(null); m.netPause(false); m.forceEnd(S.me, 'disconnect'); return; }
        if (m.game && !m.game.over) m.game.eliminate(k, 'disconnect');
      }
      show();
      if (waits.size) timer = setTimeout(tick, 1000); else m.netPause(false);
    };
    const lost = seat => {
      if (m.over || seat == null || waits.has(seat) || !m.game || !(m.game.players[seat] || {}).alive) return;
      waits.set(seat, GRACE);
      m.netPause(true);
      show();
      if (!timer) timer = setTimeout(tick, 1000);
    };
    offs.push(
      S.on('cmd', (c, seat) => m.remoteCommand(c, seat)),
      S.on('peer-leave', lost),
      S.on('guest-resume', (seat, slot) => {
        if (m.over) return;
        S.send({ type: 'start', info: m.info, snap: m.currentSnap(seat), resume: true }, slot);
        if (!waits.has(seat)) return;
        waits.delete(seat);
        toast(`😺 ${esc((m.info.players[seat] || {}).name || 'Your friend')} reconnected!`, 'good');
        if (!waits.size) {
          clearTimeout(timer); timer = null;
          m.hud && m.hud.waiting('Everyone is back! Resuming...');
          setTimeout(() => { if (!waits.size) { m.hud && m.hud.waiting(null); m.netPause(false); } }, 1500);
        } else show();
      }),
      S.on('disconnected', () => { if (!m.over) m.forceEnd(-1, 'disconnect'); }),
    );
  } else {
    // guest: try to get back into the room
    let trying = false;
    const lost = async () => {
      if (m.over || trying) return;
      trying = true;
      const t0 = Date.now();
      while (!m.over && Date.now() - t0 < GRACE * 1000) {
        m.hud && m.hud.waiting('Connection lost... reconnecting (' + Math.max(0, GRACE - Math.round((Date.now() - t0) / 1000)) + 's)');
        try { await S.rejoin(); m.hud && m.hud.waiting('Reconnected! Waiting for the host...'); return; }
        catch (e) { await new Promise(r => setTimeout(r, 1500)); }
      }
      trying = false;
      m.hud && m.hud.waiting(null);
      if (!m.over) m.forceEnd(-1, 'disconnect');
    };
    offs.push(
      S.on('peer-leave', lost),
      S.on('disconnected', lost),
      S.on('resume', msg => {
        if (m.over) return;
        trying = false;
        m.hud && m.hud.waiting(null);
        const nm = beginMatch({ ...m.opts, info: msg.info, firstSnap: msg.snap, countdown: 0 });
        wireSessionToMatch(nm);
      }),
    );
  }
  m._offs = offs;
}

// ---------- start any match
function beginMatch(opts) {
  stopAttract();
  if (match) { if (match._offs) match._offs.forEach(f => f()); match.stop(); match = null; }
  screens.className = 'screens';
  screens.innerHTML = '';
  modalRoot.innerHTML = '';
  if (current && current.leave) { current.leave('match'); current.leave = null; }
  current = { name: 'match' };
  renderUpdateBanner();
  const st = P.profile().settings;
  // phones: hide the browser bars (Android) and keep the screen awake for the battle
  enterFullscreen();
  keepAwake.wanted = true; keepAwake(true);
  if (!history.state || history.state.ww !== 'battle') { try { history.pushState({ ww: 'battle' }, ''); } catch { /* ignore */ } }
  const m = new Match(canvas, hudRoot, {
    ...opts, fxLevel: st.fx,
    onEnd: res => onMatchEnd(m, opts, res),
  });
  match = m;
  m.start(opts.countdown ?? 3);
  return m;
}

function onMatchEnd(m, opts, res) {
  keepAwake.wanted = false; keepAwake(false);
  if (m._offs) m._offs.forEach(f => f());
  if (session) session.inMatch = false;
  m.stop();
  if (match === m) match = null;
  const me = res.me;
  const st = res.stats ? res.stats[me] : {};
  const info = res.info;
  const opponent = info.players.filter((_, i) => i !== me).map(p => p.name).join(', ');
  const reward = P.recordMatch({
    mode: opts.mode, win: res.win, draw: res.draw, why: res.why, ai: opts.aiLevel, stats: st || {}, time: res.time,
    opponent, hero: info.players[me].hero, map: info.map.name, level: opts.level,
  });
  go('results', { res, opts, reward });
}

// ---------- Results
const shortName = n => { const w = String(n || '').split(' ')[0]; return w.length > 8 ? w.slice(0, 7) + '…' : w; };
SCREENS.results = ({ res, opts, reward }) => {
  const info = res.info, me = res.me;
  const others = info.players.map((_, i) => i).filter(i => i !== me), opp = others[0];
  const mine = info.players[me], theirs = info.players[opp];
  const many = others.length > 1;
  const S = res.stats || [];
  const cols = [me, ...others];
  const row = (label, key) => `<tr><td>${label}</td>${cols.map(i => `<td>${S[i] ? S[i][key] : '-'}</td>`).join('')}</tr>`;
  const head = `<tr><th></th>${cols.map(i => `<th>${i === me ? 'You' : many ? esc(shortName(info.players[i].name)) : 'Them'}</th>`).join('')}</tr>`;
  const p = P.profile();
  const nh = reward.nextHero;
  const isCampaign = opts.mode === 'campaign';
  const nextLevel = isCampaign ? CAMPAIGN.find(l => l.id === opts.level.id + 1) : null;
  screens.innerHTML = `<div class="results ${res.win ? 'win' : res.draw ? 'draw' : 'lose'}">
    <div class="res-banner">${res.win ? '🏆 VICTORY!' : res.draw ? '🤝 DRAW' : '😿 DEFEAT'}</div>
    <div class="res-sub">${res.why === 'out' ? 'You were knocked out' : res.why === 'surrender' ? (res.win ? (many ? 'The last of your rivals surrendered' : 'Your opponent surrendered') : 'You surrendered') : res.why === 'disconnect' ? 'Opponent disconnected' : res.why === 'time' ? 'Time ran out: the biggest army wins' : res.win ? 'You conquered every building!' : many && res.winner >= 0 ? `${esc(info.players[res.winner].name)} took the kingdom` : 'Your clowder has been scattered...'}
      · ${Math.floor(res.time / 60)}:${String(res.time % 60).padStart(2, '0')}</div>
    ${isCampaign && res.win ? `<div class="res-stars">${[1, 2, 3].map(k => `<span class="${k <= reward.stars ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
    ${many ? `<div class="res-vs many">${cols.map(i => `<div class="res-p ${i === res.winner ? 'won' : ''}"><img src="${portrait(info.players[i].hero, 110)}"><div>${i === res.winner ? '👑 ' : ''}${esc(info.players[i].name)}${i === me ? ' (you)' : ''}</div></div>`).join('')}</div>`
      : `<div class="res-vs">
      <div class="res-p"><img src="${portrait(mine.hero, 140)}"><div>${esc(mine.name)}</div></div>
      <div class="vs">VS</div>
      <div class="res-p"><img src="${portrait(theirs.hero, 140)}"><div>${esc(theirs.name)}</div></div>
    </div>`}
    <div class="res-cols">
      <div class="card panel">
        <h3>Battle stats</h3>
        <table class="stats">${head}
          ${row('🐱 Kittens made', 'produced')}${row('🏠 Buildings captured', 'captured')}${row('💥 Cats knocked out', 'killed')}
          ${row('✨ Spells cast', 'spells')}${row('📈 Biggest army', 'peakArmy')}${row('⬆ Upgrades', 'upgrades')}
        </table>
      </div>
      <div class="card panel rewards">
        <h3>Rewards</h3>
        <div class="rw-lines">${reward.lines.map(([l, c], k) => `<div class="rw-line" style="animation-delay:${0.2 + k * 0.25}s"><span>${l}</span><b>+${c} 🐟</b></div>`).join('')}</div>
        <div class="rw-total">Total <b class="rw-count">0</b> <span class="fish">🐟</span></div>
        <div class="xpbar"><div style="width:${Math.round(p.xp / P.xpForLevel(p.level) * 100)}%"></div><span>Lv ${p.level} · ${p.xp}/${P.xpForLevel(p.level)} XP</span></div>
        ${nh ? `<div class="next-hero"><img src="${portrait(nh.id, 64)}"><div><b>Next unlock: ${nh.name}</b><div class="progress"><div style="width:${Math.min(100, Math.round(p.coins / nh.cost * 100))}%"></div></div>
          <div class="small">${p.coins >= nh.cost ? '✨ You can unlock this hero now!' : `${nh.cost - p.coins} more fish coins`}</div></div></div>` : '<div class="next-hero">🎉 You have unlocked every hero!</div>'}
      </div>
    </div>
    <div class="res-actions">
      ${opts.mode === 'online' ? `<button class="btn primary big rematch">🔁 Rematch</button><button class="btn big back leave">🚪 Leave room</button>` : ''}
      ${opts.mode === 'practice' ? `<button class="btn primary big again">🔁 Play again</button><button class="btn big" data-go="practice">⚙️ Change setup</button>` : ''}
      ${isCampaign ? `${res.win && nextLevel ? `<button class="btn primary big next">▶ Next: ${nextLevel.name}</button>` : `<button class="btn primary big again">🔁 ${res.win ? 'Replay' : 'Try again'}</button>`}<button class="btn big" data-go="campaign">🗺️ Campaign</button>` : ''}
      <button class="btn big" data-go="home">🏠 Menu</button>
      ${nh && p.coins >= nh.cost ? `<button class="btn big gold" data-go="heroes">😺 Unlock heroes</button>` : ''}
    </div>
  </div>`;
  wireGo();
  // count-up
  const el = $('.rw-count');
  const t0 = performance.now(), dur = 1200 + reward.lines.length * 200;
  const step = now => { const u = Math.min(1, (now - t0) / dur); el.textContent = Math.round(reward.total * u); if (u < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => audio.play('coins'), 400);
  for (const lu of reward.levelUps) setTimeout(() => { toast(`⭐ Level up! You are now level <b>${lu.level}</b>`, 'good'); audio.play('unlock'); }, 1200);
  for (const a of reward.achievements) setTimeout(() => toast(`🏆 Achievement unlocked: <b>${a.name}</b>`, 'good'), 1800);
  setTimeout(() => audio.music('menu'), 2600);

  const again = $('.again');
  if (again) again.onclick = () => opts.mode === 'campaign' ? playCampaign(opts.level) : playPractice();
  const next = $('.next');
  if (next) next.onclick = () => playCampaign(nextLevel);
  if (opts.mode === 'online') {
    const S = session;
    if (!S) { $('.rematch').classList.add('off'); }
    $('.rematch').onclick = () => { if (!session) return; session.toLobby(); go('lobby'); };
    $('.leave').onclick = () => { endSession(); go('home'); };
    const offs = S ? [
      S.on('rematch-request', () => { toast('😺 Your friend wants a rematch!', 'good'); audio.play('meow'); const b = $('.rematch'); if (b) b.classList.add('pulse'); }),
      S.on('lobby', L => { if (L.phase === 'lobby' && !S.isHost) { /* host reset lobby; guest can join when ready */ } }),
      S.on('peer-leave', () => { toast('😿 Your friend left the room', 'warn'); }),
    ] : [];
    return { leave: () => offs.forEach(f => f()) };
  }
};

// ---------- Practice
SCREENS.practice = () => {
  const p = P.profile();
  const sp = state.practice;
  screens.innerHTML = `${topbar(true, 'Practice vs Computer')}
    <div class="setup">
      <div class="card panel"><h3>Your hero</h3><div class="pr-heroes"></div><div class="pr-detail"></div></div>
      <div class="card panel">
        <h3>Players</h3>
        <div class="seg n-seg">${[2, 3, 4].map(n => `<button class="btn small ${(sp.players || 2) === n ? 'on' : ''}" data-n="${n}">${'🐱'.repeat(n)}<small>${n} players</small></button>`).join('')}</div>
        <h3>Opponent<span class="opp-n muted small"></span></h3>
        <div class="seg ai-seg">${Object.entries(AI_LEVELS).map(([k, v]) => `<button class="btn small ${sp.ai === k ? 'on' : ''}" data-ai="${k}">${v.name}<small>${k}</small></button>`).join('')}</div>
        <div class="row"><label>Enemy hero:</label><select class="enemy-sel"><option value="random">🎲 Random</option>${HEROES.map(h => `<option value="${h.id}" ${sp.enemy === h.id ? 'selected' : ''}>${h.name}</option>`).join('')}</select></div>
        <h3>Battlefield</h3><div class="pr-maps"></div>
        <div class="pr-rules"></div>
        <button class="btn primary huge start">⚔️ Start Battle</button>
      </div>
    </div>`;
  wireGo();
  let hero = P.heroUnlocked(p.equip.hero) ? p.equip.hero : 'whiskers';
  const det = () => $('.pr-detail').innerHTML = heroDetail(HERO_BY_ID[hero]);
  heroPicker($('.pr-heroes'), hero, id => { hero = id; P.equip('hero', id); det(); });
  det();
  const drawMaps = () => {
    const n = sp.players || 2;
    if (mapPlayers(sp.map) !== n) sp.map = mapsFor(n)[0].id;
    mapPicker($('.pr-maps'), sp.map, id => { sp.map = id; }, { players: n });
    $('.opp-n').textContent = n > 2 ? ` · ${n - 1} computer cats (the rest get random heroes)` : '';
  };
  drawMaps();
  $$('[data-n]').forEach(b => b.onclick = () => { sp.players = +b.dataset.n; $$('[data-n]').forEach(x => x.classList.toggle('on', x === b)); drawMaps(); });
  $$('[data-ai]').forEach(b => b.onclick = () => { sp.ai = b.dataset.ai; $$('[data-ai]').forEach(x => x.classList.toggle('on', x === b)); });
  $('.enemy-sel').onchange = ev => { sp.enemy = ev.target.value; };
  const drawRules = () => { $('.pr-rules').innerHTML = rulesRow(sp.rules, false); $$('.pr-rules .rule-btn').forEach(b => b.onclick = () => { sp.rules = { ...sp.rules, [b.dataset.rule]: !sp.rules[b.dataset.rule] }; drawRules(); }); };
  drawRules();
  $('.start').onclick = () => playPractice();
};
function aiName() { return ['Sir Hiss-a-lot', 'Lady Scratchington', 'Baron Von Floof', 'Count Clawdius', 'Duke Nibbles', 'Madame Mischief', 'Lord Snugglepuss'][Math.floor(Math.random() * 7)]; }
function playPractice() {
  const p = P.profile();
  const sp = state.practice;
  const n = mapPlayers(sp.map);
  const seed = (Math.random() * 1e9) | 0;
  const hats = HATS.map(h => h.id);
  const names = [...new Set(Array.from({ length: 20 }, aiName))];
  const foes = Array.from({ length: n - 1 }, (_, k) => {
    const hero = k === 0 && sp.enemy !== 'random' ? sp.enemy : HEROES[Math.floor(Math.random() * HEROES.length)].id;
    return { name: names[k] || aiName(), hero, fur: HERO_BY_ID[hero].fur, hat: hats[Math.floor(Math.random() * hats.length)], ai: sp.ai };
  });
  beginMatch({
    mode: 'practice', role: 'local', me: 0, aiLevel: sp.ai,
    cfg: {
      map: resolveMap(sp.map, seed), seed, timeLimit: n > 2 ? 900 : 600, rules: { ...sp.rules },
      players: [{ name: p.name, hero: p.equip.hero, fur: p.equip.fur, hat: p.equip.hat }, ...foes],
    },
  });
}

// ---------- Campaign
SCREENS.campaign = () => {
  const p = P.profile();
  const unlockedUpTo = CAMPAIGN.reduce((n, l) => (p.campaign[l.id] ? Math.max(n, l.id + 1) : n), 1);
  const stars = CAMPAIGN.reduce((a, l) => a + (p.campaign[l.id] || 0), 0);
  screens.innerHTML = `${topbar(true, 'Campaign')}
    <div class="campaign">
      <div class="camp-head card">🗺️ <b>The Great Cat Kingdom</b> — defeat 12 rival heroes to become Top Cat. <span class="pill">★ ${stars}/${CAMPAIGN.length * 3}</span></div>
      <div class="camp-path">${CAMPAIGN.map((l, k) => {
        const done = p.campaign[l.id] || 0, locked = l.id > unlockedUpTo;
        const e = HERO_BY_ID[l.enemy];
        return `<div class="camp-node card ${locked ? 'locked' : 'clickable'} ${done ? 'done' : ''} ${l.id === unlockedUpTo ? 'current' : ''}" data-lv="${l.id}" style="--d:${k}">
          <div class="cn-num">${l.id}</div>
          <img src="${portrait(e.id, 96)}" alt="">
          <div class="cn-name">${l.name}</div>
          <div class="cn-stars">${[1, 2, 3].map(s => `<span class="${s <= done ? 'on' : ''}">★</span>`).join('')}</div>
          <div class="cn-ai">${AI_LEVELS[l.ai].name}</div>
          ${locked ? '<div class="cn-lock">🔒</div>' : ''}
        </div>`;
      }).join('')}</div>
      <p class="muted small center">★ win · ★★ win in under 5 minutes · ★★★ also without losing a building</p>
    </div>`;
  wireGo();
  $$('.camp-node.clickable').forEach(n => n.onclick = () => {
    const l = CAMPAIGN.find(x => x.id === +n.dataset.lv);
    const e = HERO_BY_ID[l.enemy];
    let hero = P.heroUnlocked(p.equip.hero) ? p.equip.hero : 'whiskers';
    const m = modal(`<div class="level-card">
      <div class="lc-top"><img src="${portrait(e.id, 140)}"><div><div class="muted">Level ${l.id}</div><h2>${l.name}</h2>
        <div>Enemy: <b>${e.name}</b> (${AI_LEVELS[l.ai].name} AI)</div><div>Map: <b>${MAP_BY_ID[l.map].name}</b></div>
        <div>First clear: <b>+${l.reward} 🐟</b></div></div></div>
      <div class="tip">💡 ${l.tip}</div>
      <h3>Your hero</h3><div class="lc-heroes"></div>
      <button class="btn primary huge go-level">⚔️ Fight!</button></div>`, { cls: 'wide' });
    heroPicker($('.lc-heroes', m.el), hero, id => { hero = id; P.equip('hero', id); });
    $('.go-level', m.el).onclick = () => { m.close(); playCampaign(l); };
  });
};
function playCampaign(l) {
  const p = P.profile();
  const seed = 1000 + l.id * 17;
  beginMatch({
    mode: 'campaign', role: 'local', me: 0, aiLevel: l.ai, level: l,
    cfg: {
      map: resolveMap(l.map, seed), seed, timeLimit: 600,
      players: [
        { name: p.name, hero: p.equip.hero, fur: p.equip.fur, hat: p.equip.hat },
        { name: HERO_BY_ID[l.enemy].name, hero: l.enemy, fur: HERO_BY_ID[l.enemy].fur, hat: l.id >= 11 ? 'crown' : 'none', ai: l.ai },
      ],
    },
  });
  setTimeout(() => { if (match && match.hud) match.hud.toast('💡 ' + l.tip, 'mine'); }, 3200);
}

// ---------- Heroes
SCREENS.heroes = () => {
  const p = P.profile();
  const byClan = Object.keys(CLANS).map(c => ({ c, list: HEROES.filter(h => h.clan === c) }));
  screens.innerHTML = `${topbar(true, 'Heroes')}
    <div class="heroes">
      <p class="center muted">Unlock new heroes with fish coins 🐟 earned from every battle. Each hero has a passive power and 3 unique spells.</p>
      ${byClan.map(({ c, list }) => `<div class="clan-row"><h3 style="color:${CLANS[c].color}">${CLANS[c].icon} ${CLANS[c].name} <span class="muted small">${CLANS[c].desc}</span></h3>
        <div class="hero-grid">${list.map(h => heroCard(h, { selected: p.equip.hero === h.id, locked: !P.heroUnlocked(h.id) })).join('')}</div></div>`).join('')}
    </div>`;
  wireGo();
  $$('.hero-card').forEach(el => el.onclick = () => showHero(el.dataset.hero, () => go('heroes')));
};

// ---------- Shop
SCREENS.shop = (params = {}) => {
  const tab = params.tab || 'fur';
  const p = P.profile();
  const items = tab === 'fur' ? FURS : HATS;
  screens.innerHTML = `${topbar(true, 'Cat Shop')}
    <div class="shop">
      <div class="shop-preview card"><img class="shop-cat" src="${catImg(p.equip.fur, p.equip.hat, 200, 0)}"><div><b>Your army looks like this!</b><div class="muted small">Every cat you send into battle wears your fur & hat.</div></div></div>
      <div class="seg tabs"><button class="btn ${tab === 'fur' ? 'on' : ''}" data-tab="fur">🎨 Furs</button><button class="btn ${tab === 'hat' ? 'on' : ''}" data-tab="hat">🎩 Hats</button></div>
      <div class="shop-grid">${items.map(it => {
        const own = P.owns(tab, it.id), eq = p.equip[tab] === it.id;
        const img = tab === 'fur' ? catImg(it.id, 'none', 120, 0) : catImg(p.equip.fur, it.id, 120, 0);
        return `<div class="shop-item card clickable ${eq ? 'sel' : ''}" data-id="${it.id}">
          <img src="${img}" alt=""><div class="si-name">${it.name}</div>
          <div class="si-price">${eq ? '✔ Equipped' : own ? 'Owned · tap to wear' : `<span class="fish">🐟</span> ${it.cost}`}</div></div>`;
      }).join('')}</div>
    </div>`;
  wireGo();
  $$('[data-tab]').forEach(b => b.onclick = () => go('shop', { tab: b.dataset.tab }));
  $$('.shop-item').forEach(el => el.onclick = () => {
    const id = el.dataset.id;
    if (P.owns(tab, id)) { P.equip(tab, id); audio.play('purr'); go('shop', { tab }); return; }
    const it = items.find(x => x.id === id);
    if (p.coins < it.cost) { audio.play('error'); toast(`Need ${it.cost - p.coins} more 🐟 — win battles to earn more!`, 'warn'); return; }
    const m = modal(`<div class="center"><img src="${tab === 'fur' ? catImg(id, p.equip.hat, 160, 0) : catImg(p.equip.fur, id, 160, 0)}"><h2>${it.name}</h2>
      <button class="btn primary big buy">Buy for <span class="fish">🐟</span> ${it.cost}</button></div>`);
    $('.buy', m.el).onclick = () => {
      const r = P.buy(tab, id);
      if (!r.ok) { toast(r.msg, 'warn'); return; }
      P.equip(tab, id); audio.play('unlock'); toast(`✨ New look: <b>${it.name}</b>!`, 'good');
      for (const a of r.newAch || []) toast(`🏆 Achievement: <b>${a.name}</b> +${a.reward} 🐟`, 'good');
      m.close(); go('shop', { tab });
    };
  });
};

// ---------- Profile
SCREENS.profile = () => {
  const p = P.profile();
  const s = p.stats;
  screens.innerHTML = `${topbar(true, 'Profile')}
    <div class="profile">
      <div class="card panel prof-head">
        <img src="${catImg(p.equip.fur, p.equip.hat, 140, 0)}">
        <div class="ph-main">
          <div class="row"><input class="name-in" maxlength="16" value="${esc(p.name)}"><button class="btn small save-name">Save</button></div>
          <div>Level <b>${p.level}</b></div>
          <div class="xpbar"><div style="width:${Math.round(p.xp / P.xpForLevel(p.level) * 100)}%"></div><span>${p.xp}/${P.xpForLevel(p.level)} XP</span></div>
        </div>
      </div>
      <div class="stat-grid">
        ${[['⚔️', 'Battles', s.matches], ['🏆', 'Wins', s.wins], ['🌐', 'Online wins', `${s.onlineWins}/${s.onlineMatches}`], ['🔥', 'Best streak', s.bestStreak],
          ['🏠', 'Captures', s.captures], ['✨', 'Spells', s.spells], ['🐱', 'Kittens made', Math.round(s.produced)], ['⚡', 'Fastest win', s.fastestWin ? `${Math.floor(s.fastestWin / 60)}:${String(s.fastestWin % 60).padStart(2, '0')}` : '-']]
          .map(([i, l, v]) => `<div class="stat card"><div class="si">${i}</div><b>${v}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="card panel"><h3>🏆 Achievements (${Object.keys(p.ach).length}/${ACHIEVEMENTS.length})</h3>
        <div class="ach-grid">${ACHIEVEMENTS.map(a => `<div class="ach ${p.ach[a.id] ? 'got' : ''}"><div class="ach-i">${p.ach[a.id] ? '🏆' : '🔒'}</div><div><b>${a.name}</b><div class="small">${a.desc}</div></div><div class="ach-r">+${a.reward}🐟</div></div>`).join('')}</div></div>
      <div class="card panel"><h3>📜 Recent battles</h3>
        ${p.history.length ? `<div class="hist">${p.history.map(h => `<div class="hist-row ${h.win ? 'w' : h.draw ? 'd' : 'l'}"><span>${h.win ? 'WIN' : h.draw ? 'DRAW' : 'LOSS'}</span><span>${h.mode}</span><span>vs ${esc(h.opp)}</span><span>${HERO_BY_ID[h.hero]?.name || ''}</span><span>${esc(h.map || '')}</span></div>`).join('')}</div>` : '<p class="muted">No battles yet. Go get \'em!</p>'}
      </div>
    </div>`;
  wireGo();
  $('.save-name').onclick = () => { P.setName($('.name-in').value); toast('Name saved!', 'good'); };
};

// ---------- How to play
SCREENS.howto = () => {
  screens.innerHTML = `${topbar(true, 'How to Play')}
    <div class="howto">
      <div class="card panel how">
        <div class="how-i">👆</div><div><h3>1. Send your cats</h3><p><b>Drag</b> from one of your buildings to any other building. Half the cats inside march out (change it to 25/50/75/100% at the bottom left, with the mouse wheel, or Q/W/E/R).</p>
        <p><b>Swipe</b> across several of your buildings before letting go to send from all of them at once!</p></div>
      </div>
      <div class="card panel how">
        <div class="how-i">⚔️</div><div><h3>2. Capture buildings</h3><p>When your cats reach a stray or enemy building, they fight the cats inside. Knock them all out and the building becomes yours. Send cats to your own buildings to reinforce them. Squads that meet on the road fight too!</p></div>
      </div>
      <div class="card panel how buildings-how">
        <div><h3>3. Know your buildings</h3>
        <div class="bgrid">${Object.entries(BUILDINGS).map(([k, b]) => `<div class="bitem"><img src="${bImg(k, Math.min(2, b.maxLevel), 0, 110)}"><div><b>${b.icon} ${b.name}</b><div class="small">${b.desc}</div></div></div>`).join('')}</div>
        <p><b>Tap</b> your building to <b>upgrade</b> it (costs cats) or <b>convert</b> it to another type. Double-tap to upgrade quickly.</p></div>
      </div>
      <div class="card panel how">
        <div class="how-i">🌿</div><div><h3>4. Cast spells</h3><p>Your hero has 3 spells powered by <b>catnip</b>, which refills over time (faster with Catnip Gardens). Tap a spell (or press 1/2/3), then tap the map or a glowing building. Every hero also has a passive power.</p></div>
      </div>
      <div class="card panel how">
        <div class="how-i">⭐</div><div><h3>5. Purr Power</h3><p>Capturing, upgrading and defending fill your Purr Power stars. Each star makes all your cats a bit stronger and faster. Losing buildings, losing cats or sitting idle drains it.</p></div>
      </div>
      <div class="card panel how">
        <div class="how-i">🏆</div><div><h3>6. Win!</h3><p>Take every enemy building and squad to win. If the timer runs out, the biggest army wins. Every battle earns fish coins 🐟 to unlock heroes, furs and hats.</p></div>
      </div>
      <div class="center"><button class="btn primary big" data-go="practice">Try it vs the computer →</button></div>
    </div>`;
  wireGo();
};

// ---------- Settings
SCREENS.settings = () => {
  const s = P.profile().settings;
  screens.innerHTML = `${topbar(true, 'Settings')}
    <div class="settings card panel">
      <div class="app-row">
        <div class="app-txt"><b>📲 Whisker Wars app</b><span class="muted small"></span></div>
        <button class="btn primary dl-app">📲 Download app</button>
      </div>
      <hr>
      <label>🔊 Sound effects <input type="range" min="0" max="1" step="0.05" value="${s.sfx}" class="r-sfx"></label>
      <label>🎵 Music <input type="range" min="0" max="1" step="0.05" value="${s.music}" class="r-music"></label>
      <label>🔇 Mute everything <input type="checkbox" class="c-mute" ${s.muted ? 'checked' : ''}></label>
      <label>✨ Visual effects <select class="s-fx"><option value="high" ${s.fx === 'high' ? 'selected' : ''}>High</option><option value="medium" ${s.fx === 'medium' ? 'selected' : ''}>Medium</option><option value="low" ${s.fx === 'low' ? 'selected' : ''}>Low (older devices)</option></select></label>
      <label>📱 Battle layout <select class="s-layout">
        <option value="auto" ${(s.layout || 'auto') === 'auto' ? 'selected' : ''}>Automatic (${isPhone() && (s.layout || 'auto') === 'auto' ? 'phone' : 'detect'})</option>
        <option value="phone" ${s.layout === 'phone' ? 'selected' : ''}>Phone</option>
        <option value="desktop" ${s.layout === 'desktop' ? 'selected' : ''}>Computer / tablet</option></select></label>
      <label>📳 Vibration on phones <input type="checkbox" class="c-vib" ${s.vibrate !== false ? 'checked' : ''}></label>
      <label>⛶ Full screen battles on phones <input type="checkbox" class="c-fs" ${s.fullscreen !== false ? 'checked' : ''}></label>
      <div class="net-info muted small"></div>
      <div class="muted small">${versionBadge()}</div>
      <hr>
      <button class="btn danger small reset">Reset all progress</button>
    </div>`;
  wireGo();
  $('.r-sfx').oninput = ev => { P.setSetting('sfx', +ev.target.value); audio.setVolumes({ sfx: +ev.target.value }); audio.play('meow'); };
  $('.r-music').oninput = ev => { P.setSetting('music', +ev.target.value); audio.setVolumes({ music: +ev.target.value }); };
  $('.c-mute').onchange = ev => { P.setSetting('muted', ev.target.checked); audio.setMuted(ev.target.checked); };
  $('.s-fx').onchange = ev => P.setSetting('fx', ev.target.value);
  $('.s-layout').onchange = ev => {
    P.setSetting('layout', ev.target.value); applyDeviceClass();
    const b = $('.ver-badge'); if (b) b.textContent = `${versionLabel()} · ${isPhone() ? '📱' : '🖥️'}`;
  };
  wireVersionBadge();
  $('.c-vib').onchange = ev => P.setSetting('vibrate', ev.target.checked);
  $('.c-fs').onchange = ev => P.setSetting('fullscreen', ev.target.checked);
  detectServer().then(u => { $('.net-info').textContent = u ? `Online play: game server (${u})` : 'Online play: direct peer-to-peer (PeerJS)'; });
  $('.reset').onclick = ev => {
    if (!ev.target.dataset.sure) { ev.target.dataset.sure = 1; ev.target.textContent = 'Tap again to erase everything'; return; }
    P.resetProfile(); toast('Progress reset', 'warn'); go('home');
  };
  // ---- download app: the browser's install prompt where there is one, otherwise the steps for this device
  const dl = $('.dl-app'), dlTxt = $('.app-txt span');
  const drawApp = () => {
    if (!dl.isConnected) return;
    const done = isInstalled();
    dl.disabled = done;
    dl.textContent = done ? '✔ App installed' : '📲 Download app';
    dlTxt.textContent = done ? "You're playing in the app. It updates itself." : 'Play from your home screen or desktop, full screen. Free, and it updates itself.';
  };
  dl.onclick = async () => {
    const r = await promptInstall();
    if (r === 'accepted') toast('📲 Installing Whisker Wars...', 'good');
    else if (r === 'manual') showInstallSteps();
    drawApp();
  };
  drawApp();
  return { leave: onInstallChange(drawApp) };
};

/** How to install on this device, for browsers without an install prompt (Safari on iPhone and iPad, Firefox...). */
function showInstallSteps() {
  const { title, steps } = installSteps();
  const m = modal(`<div class="install-help">
    <img class="ih-icon" src="icons/icon-192.png" alt="">
    <h2>${title}</h2>
    <ol>${steps.map(x => `<li>${x}</li>`).join('')}</ol>
    <button class="btn primary ok">Got it</button></div>`);
  $('.ok', m.el).onclick = m.close;
}

export function handleDeepLink() {
  const q = new URLSearchParams(location.search);
  const room = cleanCode(q.get('room'));
  if (room) {
    history.replaceState(null, '', location.pathname);
    const p = P.profile();
    if (!p.seenTutorial) { p.seenTutorial = true; P.save(); }
    go('friend', { code: room, auto: true });
    return true;
  }
  return false;
}
