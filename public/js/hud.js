// Whisker Wars in-match HUD (HTML overlay on top of the canvas).
import { HEROES, heroById, BUILDINGS, CONVERT_COST, EMOTES, MAX_CATNIP, RULES, PURR, purrFill, teamColor, findSpell } from '../shared/data.js';
import { bfxHas } from '../shared/game.js';
import { heroPortraitURL } from './art.js';
import { audio } from './audio.js';
import { profile, setSetting, save as saveProfile } from './profile.js';
import { exitFullscreen, inFullscreen, vibrate } from './device.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const TARGET_LABEL = { own: 'Your building', enemy: 'Enemy building', neutral: 'Stray building', notown: 'Enemy or stray building', owned: 'Any player\'s building', any: 'Any building', area: 'Area', global: 'Instant' };
const safeURL = (id, s) => { try { return heroPortraitURL(id, s); } catch { return ''; } };
const PURR_TIP = `Purr Power: your army's morale. Each star gives ALL your cats +${Math.round(PURR.def * 100)}% defense, +${Math.round(PURR.atk * 100)}% attack and +${Math.round(PURR.spd * 100)}% speed. Earn it by capturing (rival buildings most), upgrading and knocking out attackers. Losing buildings, losing cats in attacks and sitting still drain it, fast at high stars.`;
// five stars; the next one fills up as you earn purr
const purrMeter = (side, label = true) => `<span class="purr" data-side="${side}" title="${PURR_TIP}">${label ? '<span class="pl">PURR</span>' : ''}<span class="pss">${'<i class="ps">★</i>'.repeat(5)}</span><span class="pb"></span></span>`;
// ---------------------------------------------------------------- building facts for the hold-to-read tooltips
const num2 = v => (Math.round(v * 100) / 100).toString();
const pctOf = v => Math.round(v * 100) + '%';
/** what a building of this type does at this level, as [key, icon, label, value] rows (the key lines up two levels) */
function bFacts(type, lv, { boom = false } = {}) {
  const d = BUILDINGS[type], i = Math.max(0, Math.min(d.maxLevel, lv) - 1), rows = [];
  rows.push(['cap', '🐾', 'Holds', `${d.cap[i]} cats`]);
  if (d.prod[i] > 0) rows.push(['prod', '🐱', 'Makes kittens', `${num2(d.prod[i] * (boom ? 1.5 : 1))}/s`]);
  if (d.range) rows.push(['range', '🎯', 'Hairball range', `${d.range[i]}`]);
  if (d.fireEvery) rows.push(['fire', '💥', 'Throws a hairball', `every ${d.fireEvery[i]}s`]);
  if (d.atkBonus) rows.push(['atk', '⚔', 'All your cats hit', `+${pctOf(d.atkBonus[i])} harder`]);
  if (d.catnipBonus) rows.push(['nip', '🌿', 'Your catnip refills', `+${pctOf(d.catnipBonus[i])} faster`]);
  rows.push(['def', '🛡', 'Defense', `×${d.defense}`]);
  return rows;
}
const factRows = rows => rows.map(([, ic, label, v, cls]) => `<div class="ht-r ${cls || ''}"><span>${ic} ${label}</span><b>${v}</b></div>`).join('');

const purrBonus = n => n > 0 ? `+${Math.round(n * PURR.def * 100)}% 🛡 +${Math.round(n * PURR.atk * 100)}% ⚔ +${Math.round(n * PURR.spd * 100)}% 💨` : '';

export class Hud {
  constructor(root, match) {
    this.root = root;
    this.m = match;
    root.innerHTML = '';
    root.className = 'hud active';
    this.acc = 0;
    this.tense = false;
  }

  setup(info, me) {
    this.info = info; this.me = me;
    const P = info.players;
    // everyone else, in seat order (2 players: just the one opponent)
    this.opps = P.map((_, i) => i).filter(i => i !== me);
    const opp = this.opps[0];
    this.opp = opp;
    const many = this.opps.length > 1;
    const card = (i, side) => {
      const h = heroById(P[i].hero) || HEROES[0];
      const c = teamColor(i);
      return `<div class="pcard ${side}${many && side === 'opp' ? ' mini' : ''}" data-o="${i}" style="--tc:${c.main};--td:${c.dark}">
        <img class="portrait" src="${safeURL(h.id, 96)}" alt="">
        <div class="pinfo">
          <div class="pname">${esc(P[i].name)}${P[i].ai ? ' <span class="tag">AI</span>' : ''}</div>
          <div class="phero">${h.name}</div>
          <div class="pmeta">${purrMeter(side === 'me' ? 'me' : String(i))}<span class="bcount" title="Buildings">🏠 0</span></div>
        </div>
        <div class="emote-pop"></div>
      </div>`;
    };
    const hero = heroById(P[me].hero) || HEROES[0];
    this.hero = hero;
    // this battle's skills (Riddle rolls random ones; Copy Cat swaps its button for the copied skill)
    this.sk = [0, 1, 2, 3].map(k => this.m.mySlotSpell(k)).filter(Boolean);
    const phone = this.phone = !!this.m.phone;
    if (phone) this.root.classList.add('phone');
    const rules = RULES.filter(r => info.rules && info.rules[r.id]);
    if (info.rules && info.rules.evenSkills) rules.push({ id: 'evenSkills', icon: '⚖️', name: 'Even skills', desc: 'Skill upgrades are off: every skill is level 1.' });
    const ruleIcons = rules.length ? `<div class="rule-icons">${rules.map(r => `<span title="${r.name}: ${r.desc}">${r.icon}</span>`).join('')}</div>` : '';
    // one coloured share of the bar per player: you first, then the others
    const armybar = `<div class="armybar" title="Buildings each player holds. Your cats on the left; enemy cats are hidden">
            ${[me, ...this.opps].map(i => `<div class="fill${i === me ? ' me' : ''}" data-o="${i}" style="background:${teamColor(i).main}"></div>`).join('')}
            <span class="l">0</span><span class="r">0</span>
          </div>`;
    const oppCards = `<div class="opps${many ? ' many' : ''}">${this.opps.map(o => card(o, 'opp')).join('')}</div>`;
    const spellBtns = this.sk.map((s, k) => `<button class="spell" data-slot="${k}">
              <span class="sicon">${s.icon}</span><span class="scost">${s.cost}</span>
              <div class="scd"></div><span class="scdtxt"></span>${phone ? '' : `<kbd>${k + 1}</kbd>`}</button>`).join('');
    const catnip = `<div class="catnip" title="Catnip: spell energy. Gardens make it faster.">
            <div class="catnip-fill"></div><span class="catnip-txt">🌿 0</span>
          </div>`;
    const desktop = `
      <div class="hud-top">
        ${card(me, 'me')}
        <div class="hud-center">
          <div class="timer">--:--</div>
          ${ruleIcons}
          ${armybar}
        </div>
        ${oppCards}
      </div>
      <div class="hud-bottom">
        <div class="pct" title="How many cats to send (wheel or Q/W/E/R)">
          <div class="pct-label">SEND</div>
          ${[0.25, 0.5, 0.75, 1].map((p, k) => `<button class="pct-btn" data-p="${p}">${p * 100}%<kbd>${'QWER'[k]}</kbd></button>`).join('')}
        </div>
        <div class="spellbar">
          <div class="sb-top">${catnip}${hero.passive ? `<div class="passive" title="${esc(hero.passive.name + ': ' + hero.passive.desc)}">✦ ${hero.passive.name}</div>` : `<div class="passive">${esc(hero.name)}</div>`}</div>
          <div class="spells">${spellBtns}</div>
        </div>
        <div class="actions">
          <button class="emote-btn" title="Emotes (T)">😺</button>
          <button class="menu-btn" title="Menu">☰</button>
        </div>
      </div>`;
    // Phones: slim top bar and a thumb dock at the bottom (CSS arranges both for portrait or landscape).
    const phoneHtml = `
      <div class="ph-top${many ? ' many' : ''}">
        ${card(me, 'me')}
        <div class="hud-center">
          <div class="timer">--:--</div>
          ${armybar}
        </div>
        ${oppCards}
        ${ruleIcons}
      </div>
      <div class="ph-dock">
        <div class="ph-purr">${purrMeter('me')}</div>
        <div class="pct">${[0.25, 0.5, 0.75, 1].map(p => `<button class="pct-btn" data-p="${p}">${p * 100}<small>%</small></button>`).join('')}</div>
        <div class="ph-row">
          <div class="mystat">
            <span class="bcount">🏠 0</span>
            ${catnip}
            <div class="emote-pop"></div>
          </div>
          <button class="all-btn" aria-label="Select all your buildings">🐾<span>ALL</span></button>
          <div class="spells">${spellBtns}</div>
          <div class="ph-actions">
            <button class="emote-btn" aria-label="Emotes">😺</button>
            <button class="menu-btn" aria-label="Menu">☰</button>
          </div>
        </div>
      </div>`;
    this.root.innerHTML = `
      ${phone ? phoneHtml : desktop}
      <div class="emote-wheel hidden">${EMOTES.map(e => `<button data-e="${e.id}" title="${e.text}">${e.icon}</button>`).join('')}</div>
      <div class="bmenu hidden"></div>
      <div class="spell-tip hidden"></div>
      <div class="hold-tip hidden"></div>
      <div class="toasts"></div>
      <div class="targeting-hint hidden"></div>
      <div class="countdown hidden"></div>
      <div class="banner hidden"></div>
      <div class="pause hidden"></div>
      <div class="ping"></div>`;
    const $ = s => this.root.querySelector(s);
    this.$ = $;
    this.els = {
      timer: $('.timer'), fills: [...this.root.querySelectorAll('.armybar .fill')], armyL: $('.armybar .l'), armyR: $('.armybar .r'),
      cards: [...this.root.querySelectorAll('.pcard[data-o]')],
      catFill: $('.catnip-fill'), catTxt: $('.catnip-txt'), spells: [...this.root.querySelectorAll('.spell[data-slot]')],
      purr: [...this.root.querySelectorAll('.purr')].map(e => ({ e, side: e.dataset.side, stars: [...e.querySelectorAll('.ps')], bonus: e.querySelector('.pb'), n: -1, v: -1 })),
      bMe: [...this.root.querySelectorAll('.pcard.me .bcount, .mystat .bcount')], bOpp: [...this.root.querySelectorAll('.pcard.opp .bcount')],
      toasts: $('.toasts'), bmenu: $('.bmenu'), tip: $('.spell-tip'), holdTip: $('.hold-tip'), wheel: $('.emote-wheel'), hint: $('.targeting-hint'), ping: $('.ping'),
    };
    this.root.querySelectorAll('.pct-btn').forEach(b => b.addEventListener('click', () => this.m.setPct(+b.dataset.p)));
    this.setPct(this.m.pct);
    this.els.spells.forEach(b => {
      const slot = +b.dataset.slot;
      if (this.phone) {
        // phones: tap to cast, press and hold to read what the spell does
        let timer = null, held = false;
        b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; this.showTip(slot, b); }, 420); });
        const end = () => { clearTimeout(timer); if (held) setTimeout(() => this.els.tip.classList.add('hidden'), 1400); };
        b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('pointerleave', end);
        b.addEventListener('contextmenu', ev => ev.preventDefault());
        b.addEventListener('click', ev => { if (held) { ev.preventDefault(); held = false; return; } audio.init(); this.m.selectSpell(slot); });
      } else {
        b.addEventListener('click', () => { audio.init(); this.m.selectSpell(slot); });
        b.addEventListener('pointerenter', () => this.showTip(slot, b));
        // leaving a button brings back the tooltip of the skill you are aiming, if any
        b.addEventListener('pointerleave', () => { const t = this.m.ui.targetingSlot; if (t >= 0) this.showTip(t, this.els.spells[t]); else this.els.tip.classList.add('hidden'); });
      }
    });
    const all = $('.all-btn');
    if (all) all.addEventListener('click', () => { audio.init(); this.m.toggleAll(); });
    $('.emote-btn').addEventListener('click', () => this.toggleEmotes());
    this.els.wheel.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.m.emote(b.dataset.e); this.closeEmotes(); }));
    $('.menu-btn').addEventListener('click', () => this.openPause());
    // tap the modifier icons to see what they do (phones have no hover tooltips)
    this.root.querySelectorAll('.rule-icons').forEach(el => el.addEventListener('click', () => this.toast(rules.map(r => `${r.icon} <b>${r.name}</b>: ${r.desc}`).join('<br>'))));
    this.bmenuFor = null;
    this.holdFor = null;
    this.bindMenuHold();
  }

  // ---------- hold to read: your buildings, and the menu's upgrade / change buttons ----------
  /** the upgrade / change button under a press: { kind: 'up' } or { kind: 'conv', to } (with a selector to find it again) */
  menuTarget(btn) {
    if (!btn) return null;
    if (btn.classList.contains('bm-up')) return { kind: 'up', sel: '.bm-up' };
    if (btn.classList.contains('bm-yes') && this.convAsk) return { kind: 'conv', to: this.convAsk.t, sel: '.bm-yes' };
    if (btn.dataset.t) return { kind: 'conv', to: btn.dataset.t, sel: `[data-t="${btn.dataset.t}"]` };
    return null;
  }
  bindMenuHold() {
    const bm = this.els.bmenu, BTN = '.bm-up, .bm-cv, .bm-conv button, .bm-yes';
    let timer = null, sx = 0, sy = 0;
    bm.addEventListener('pointerdown', ev => {
      const t = this.menuTarget(ev.target.closest(BTN));
      if (!t) return;
      this.holdUsed = false; sx = ev.clientX; sy = ev.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => { this.holdUsed = true; this.showHoldTip({ ...t, id: this.bmenuFor }); if (this.phone) vibrate(10); }, 380);
    });
    bm.addEventListener('pointermove', ev => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) clearTimeout(timer); });
    // letting go anywhere ends it (the menu may have redrawn the button meanwhile)
    this.endMenuHold = () => { clearTimeout(timer); if (this.holdFor && this.holdFor.kind !== 'b' && !this.holdFor.hover) this.hideHoldTip(); };
    window.addEventListener('pointerup', this.endMenuHold);
    window.addEventListener('pointercancel', this.endMenuHold);
    // a hold only reads: it never presses the button
    bm.addEventListener('click', ev => { if (this.holdUsed) { this.holdUsed = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
    bm.addEventListener('contextmenu', ev => ev.preventDefault());
    // mouse: hovering a button shows the same thing
    bm.addEventListener('pointerover', ev => {
      if (ev.pointerType !== 'mouse') return;
      const t = this.menuTarget(ev.target.closest(BTN));
      if (t) this.showHoldTip({ ...t, id: this.bmenuFor, hover: true });
    });
    bm.addEventListener('pointerout', ev => {
      if (ev.pointerType !== 'mouse' || !this.holdFor || !this.holdFor.hover) return;
      if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest(BTN)) this.hideHoldTip();
    });
  }
  /** what: { kind: 'b' | 'up' | 'conv', id, to? } */
  showHoldTip(what) {
    this.holdFor = what;
    this.holdT = 0;
    this.drawHoldTip();
  }
  hideHoldTip() { this.holdFor = null; this.els.holdTip.classList.add('hidden'); }
  drawHoldTip() {
    const h = this.holdFor, V = this.m.view, tip = this.els.holdTip;
    const b = h && V ? V.byId.get(h.id) : null;
    // only for your own buildings
    if (!b || b.owner !== this.me) return this.hideHoldTip();
    const def = BUILDINGS[b.type], n = Math.floor(b.count);
    const boom = !!(this.m.info && this.m.info.rules && this.m.info.rules.boom);
    const free = bfxHas(b, 'build');
    let html = '';
    if (h.kind === 'b') {
      const stars = (V.players[this.me] || {}).stars || 0;
      const rows = bFacts(b.type, b.level, { boom });
      rows.unshift(['in', '🐈', 'Cats inside', `${n} / ${b.cap}`]);
      const p = rows.find(r => r[0] === 'prod');
      if (p) {
        if (bfxHas(b, 'frozen') || bfxHas(b, 'popup') || bfxHas(b, 'fort') || bfxHas(b, 'seal')) { p[3] = 'paused by a skill'; p[4] = 'bad'; }
        else if (n >= b.cap) p[3] += ' · full';
      }
      if (stars) { const d = rows.find(r => r[0] === 'def'); d[3] += ` · ×${num2(def.defense * (1 + stars * PURR.def))} with your Purr`; }
      const cost = def.upgradeCost[b.level - 1];
      const next = cost == null ? (def.maxLevel > 1 ? '★ Max level' : '') : `⬆ Level ${b.level + 1} costs ${free ? 'nothing (Free Build)' : cost + ' 🐾'}`;
      html = `<div class="ht-h">${def.icon} ${def.name} <span class="tt-lv">Lv ${b.level}${def.maxLevel > 1 ? '/' + def.maxLevel : ''}</span></div>
        <div class="ht-d">${def.desc}</div><div class="ht-rows">${factRows(rows)}</div>${next ? `<div class="ht-f">${next}</div>` : ''}`;
    } else if (h.kind === 'up') {
      const cost = def.upgradeCost[b.level - 1];
      if (cost == null) return this.hideHoldTip();
      const now = bFacts(b.type, b.level, { boom }), after = bFacts(b.type, b.level + 1, { boom });
      const rows = after.map(([k, ic, label, v]) => {
        const was = (now.find(r => r[0] === k) || [])[3];
        return was === v ? [k, ic, label, v, 'same'] : [k, ic, label, `${was} → <em>${v}</em>`, 'up'];
      });
      const c = free ? 0 : cost, purr = (PURR.upgrade[b.type] || [])[b.level - 1] || 0;
      html = `<div class="ht-h">⬆ ${def.name}: Lv ${b.level} → <em>Lv ${b.level + 1}</em></div>
        <div class="ht-rows">${factRows(rows)}</div>
        <div class="ht-f">${c ? `Costs ${c} 🐾 from this building` : 'Free (Free Build)'}${purr ? ` · +${purr} Purr` : ''}${n < c ? ` · <span class="bad">you have ${n}</span>` : ''}</div>`;
    } else {
      const to = BUILDINGS[h.to];
      if (!to || b.type === h.to) return this.hideHoldTip();
      const c = free ? 0 : CONVERT_COST[h.to], left = Math.max(0, n - c);
      const rows = bFacts(h.to, 1, { boom });
      rows.unshift(['in', '🐈', 'Cats inside', `${left} / ${to.cap[0]}`]);
      html = `<div class="ht-h">${def.icon} → ${to.icon} Change to ${to.name}</div>
        <div class="ht-d">${to.desc}</div><div class="ht-rows">${factRows(rows)}</div>
        <div class="ht-f">Starts again at level 1${b.level > 1 ? ` (this ${def.name} is level ${b.level})` : ''} · ${c ? `costs ${c} 🐾` : 'free (Free Build)'}${n < c ? ` · <span class="bad">you have ${n}</span>` : ''}</div>`;
    }
    if (html !== this.holdHtml || tip.classList.contains('hidden')) { tip.innerHTML = html; this.holdHtml = html; }
    tip.classList.remove('hidden');
    this.placeHoldTip(b);
  }
  /** building tips float above the building (your finger is on it); button tips sit above the menu */
  placeHoldTip(b) {
    const tip = this.els.holdTip, h = this.holdFor, W = window.innerWidth, H = window.innerHeight;
    const w = tip.offsetWidth || 260, ht = tip.offsetHeight || 140;
    const R = this.m.renderer, pad = this.phone && R.pad ? R.pad : { top: 60, bottom: 90, left: 6, right: 6 };
    let x, y;
    if (h.kind === 'b') {
      const s = R.toScreen(b.x, b.y), rp = b.radius * R.view.scale;
      x = s.x - w / 2;
      y = s.y - rp * 1.6 - ht - 14;
      if (y < pad.top + 2) y = s.y + rp + 34;
    } else {
      const m = this.els.bmenu.getBoundingClientRect();
      const btn = this.els.bmenu.querySelector(h.sel);
      if (!btn || this.els.bmenu.classList.contains('hidden')) return this.hideHoldTip();
      const r = btn.getBoundingClientRect();
      x = r.left + r.width / 2 - w / 2;
      y = m.top - ht - 8;
      if (y < pad.top + 2) y = m.bottom + 8;
    }
    tip.style.left = Math.max(6, Math.min(W - w - 6, x)) + 'px';
    tip.style.top = Math.max(6, Math.min(H - ht - 6, y)) + 'px';
  }

  setPct(p) { this.root.querySelectorAll('.pct-btn').forEach(b => b.classList.toggle('on', +b.dataset.p === p)); }
  /** a player whose app is covered or whose connection dropped: 📵 on their card (with seconds left, if given) */
  setAway(seat, v) {
    for (const c of this.els.cards) {
      if (+c.dataset.o !== seat) continue;
      c.classList.toggle('away', v !== false && v != null);
      let b = c.querySelector('.away-tag');
      if (!b) { b = el('div', 'away-tag'); c.appendChild(b); }
      b.textContent = typeof v === 'number' ? `📵 ${v}s` : '📵 away';
    }
  }
  setAll(on) {
    const b = this.root.querySelector('.all-btn');
    if (b) b.classList.toggle('on', on);
    if (on) this.hintMsg('🐾 <b>All buildings</b> selected: tap a target', () => this.m.setAll(false));
    else if (this.hintKind === 'all') this.hintMsg(null);
  }

  /** first full-screen battle: how to get the phone's own buttons back */
  fsTip() {
    const p = profile();
    if (p.fsTip || !inFullscreen()) return;
    p.fsTip = 1; saveProfile();
    this.toast(`⛶ Full screen battle! To get your phone's Home and Back buttons, tap <b>☰</b> then <b>Exit full screen</b>.`);
  }
  /** first few phone battles: a one-line reminder of how to send cats */
  coach() {
    const p = profile();
    const n = p.phoneHints || 0;
    if (n >= 3 || p.settings.showTips === false) return;
    p.phoneHints = n + 1; saveProfile();
    this.hintMsg('👆 <b>Drag</b> from your building to another to send cats, or <b>tap</b> yours then the target', () => this.hintMsg(null), 'coach');
    setTimeout(() => { if (this.hintKind === 'coach') this.hintMsg(null); }, 7000);
  }

  // ---------- phone layout ----------
  layoutPhone(portrait) {
    this.root.classList.toggle('portrait', !!portrait);
    this.root.classList.toggle('landscape', !portrait);
  }
  /** desktop: the battlefield goes between the top bar (player cards) and the bottom bar (send %, spells) */
  desktopPadding() {
    const H = window.innerHeight;
    const kids = s => [...this.root.querySelectorAll(s)].map(e => e.getBoundingClientRect()).filter(r => r.height > 0);
    const top = kids('.hud-top > *'), bot = kids('.hud-bottom > *');
    return {
      top: Math.round((top.length ? Math.max(...top.map(r => r.bottom)) : 52) + 4),
      bottom: Math.round(H - (bot.length ? Math.min(...bot.map(r => r.top)) : H - 76) + 4),
      left: 6, right: 6,
    };
  }
  /** desktop: the HUD panels buildings must stay clear of (the field may pass under the gaps between them) */
  desktopPanels() {
    const sel = ['.hud-top .pcard', '.hud-top .hud-center', '.hud-bottom .pct', '.hud-bottom .spellbar', '.hud-bottom .actions'];
    return sel.flatMap(s => [...this.root.querySelectorAll(s)]).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
  }
  /** free space for the battlefield, measured from where the bars actually ended up */
  phonePadding() {
    const W = window.innerWidth, H = window.innerHeight;
    const r = s => { const e = this.root.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const top = r('.ph-top'), dock = r('.ph-dock');
    if (this.root.classList.contains('portrait')) {
      return { top: Math.round((top ? top.bottom : 50) + 2), bottom: Math.round(H - (dock ? dock.top : H - 130) + 2), left: 2, right: 2 };
    }
    const lefts = ['.ph-dock .pct', '.all-btn'].map(r).filter(Boolean);
    const rights = ['.ph-dock .spells', '.mystat', '.ph-actions'].map(r).filter(Boolean);
    const leftEdge = Math.max(0, ...lefts.map(x => x.right));
    const rightEdge = Math.min(W, ...rights.map(x => x.left));
    return { top: Math.round((top ? top.bottom : 40) + 2), bottom: 4, left: Math.round(leftEdge + 4), right: Math.round(W - rightEdge + 4) };
  }
  showTip(slot, btn) {
    const s = this.sk[slot];
    const tip = this.els.tip;
    tip.innerHTML = `<div class="tt-h">${s.icon} ${s.name}${s.level ? ` <span class="tt-lv">Lv ${s.level}</span>` : ''}</div><div class="tt-d">${s.text || s.desc}</div>
      <div class="tt-m"><span>🌿 ${s.cost}</span><span>⏱ ${s.cd}s</span><span>🎯 ${TARGET_LABEL[s.target]}</span>${this.phone ? '' : `<span class="tt-k">hotkey <kbd>${slot + 1}</kbd></span>`}</div>`;
    tip.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - 268, r.left + r.width / 2 - 130)) + 'px';
    tip.style.bottom = (window.innerHeight - r.top + 10) + 'px';
  }
  /** desktop: briefly show a skill's tooltip (instant skills cast straight from a hotkey) */
  pulseTip(slot) {
    if (this.phone) return;
    this.showTip(slot, this.els.spells[slot]);
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => this.els.tip.classList.add('hidden'), 1800);
  }
  flashSpell(slot, msg) {
    const b = this.els.spells[slot];
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    this.toast(msg, 'warn');
  }
  setTargeting(slot) {
    this.els.spells.forEach((b, k) => b.classList.toggle('targeting', k === slot));
    // desktop: picking a skill (mouse or hotkey) keeps its tooltip up until you cast or cancel
    if (!this.phone) { clearTimeout(this.tipTimer); if (slot >= 0) this.showTip(slot, this.els.spells[slot]); else this.els.tip.classList.add('hidden'); }
    if (slot >= 0) {
      const s = this.sk[slot];
      if (this.phone) this.hintMsg(`${s.icon} <b>${s.name}</b>: ${s.target === 'area' ? 'tap a spot' : 'tap a glowing building'}<div class="th-d">${s.text}</div>`, () => this.m.cancelTargeting(), 'spell');
      else this.hintMsg(`${s.icon} <b>${s.name}</b> — ${s.target === 'area' ? 'tap a spot on the map' : 'tap a glowing building'} <span>(right-click / Esc to cancel)</span>`, null, 'spell');
    } else if (this.hintKind === 'spell') this.hintMsg(null);
  }
  /** one hint bar above the controls; phones get a ✕ because there is no Esc key or right-click */
  hintMsg(html, onCancel, kind = 'all') {
    const h = this.els.hint;
    if (!html) { h.classList.add('hidden'); this.hintKind = null; return; }
    this.hintKind = kind;
    h.innerHTML = `<span class="th-t">${html}</span>${onCancel && this.phone ? '<button class="th-x" aria-label="Cancel">✕</button>' : ''}`;
    const x = h.querySelector('.th-x');
    if (x) x.onclick = ev => { ev.stopPropagation(); onCancel(); };
    h.classList.remove('hidden');
  }

  update(V, dt) {
    this.acc += dt;
    if (this.bmenuFor != null) this.refreshBMenu(V);
    if (this.holdFor && (this.holdT = (this.holdT || 0) + dt) > 0.2) { this.holdT = 0; this.drawHoldTip(); }
    if (this.acc < 0.066) return;
    this.acc = 0;
    const me = V.players[this.me], op = V.players[this.opp];
    if (!me || !op) return;
    const others = this.opps.map(i => V.players[i]).filter(Boolean);
    const remain = (V.timeLimit || 600) - V.t;
    this.els.timer.textContent = fmtTime(remain);
    this.els.timer.classList.toggle('low', remain < 60);
    if (!this.tense && remain < 90 && !this.m.over) { this.tense = true; audio.music('tense'); }
    const owned = {};
    for (const b of V.buildings) owned[b.owner] = (owned[b.owner] || 0) + 1;
    // enemy armies are hidden (-1): then the bar shares out buildings held instead
    const hiddenArmy = others.some(p => p.army < 0);
    const share = (p, i) => (hiddenArmy ? owned[i] || 0 : Math.max(0, p ? p.army : 0));
    const tot = Math.max(1, share(me, this.me) + this.opps.reduce((a, i) => a + share(V.players[i], i), 0));
    for (const f of this.els.fills) { const i = +f.dataset.o; f.style.width = (share(V.players[i], i) / tot * 100) + '%'; }
    this.els.armyL.textContent = me.army;
    this.els.armyR.textContent = hiddenArmy ? '?' : Math.max(0, ...others.map(p => p.army));
    for (const c of this.els.cards) { const p = V.players[+c.dataset.o]; c.classList.toggle('out', !!p && !p.alive); }
    for (const P of this.els.purr) {
      const pl = P.side === 'me' ? me : V.players[+P.side];
      if (!pl) continue;
      const v = pl.purr || 0, n = pl.stars;
      P.e.classList.toggle('locked', !!pl.purrLock);
      if (v === P.v && n === P.n) continue;
      // full stars, then the next one filling up
      P.stars.forEach((s, k) => { const f = k < n ? 1 : k === n ? purrFill(v) : 0; s.style.setProperty('--f', f.toFixed(2)); s.classList.toggle('on', k < n); });
      P.bonus.textContent = purrBonus(n);
      if (P.n >= 0 && n !== P.n) { P.e.classList.remove('up', 'down'); void P.e.offsetWidth; P.e.classList.add(n > P.n ? 'up' : 'down'); }
      P.e.classList.toggle('max', n >= 5);
      P.v = v; P.n = n;
    }
    this.els.bMe.forEach(e => { e.textContent = '🏠 ' + (owned[this.me] || 0); });
    this.els.bOpp.forEach(e => { e.textContent = '🏠 ' + (owned[+e.closest('.pcard').dataset.o] || 0); });
    this.els.catFill.style.width = (me.catnip / MAX_CATNIP * 100) + '%';
    this.els.catTxt.textContent = '🌿 ' + Math.floor(me.catnip);
    this.root.classList.toggle('hushed', !!me.silenced);
    this.root.classList.toggle('glaciated', !!me.glacier);
    this.sk.forEach((s0, k) => {
      const b = this.els.spells[k];
      // Copy Cat: the button turns into the copied skill until it is used
      const s = this.m.mySkill(k) || s0;
      if (s.id !== s0.id) {
        this.sk[k] = s;
        b.querySelector('.sicon').textContent = s.icon;
        b.querySelector('.scost').textContent = s.cost;
        b.classList.toggle('stolen', !!s.stolen);
        if (s.stolen) this.toast(`${s.icon} Copied <b>${s.name}</b>! Use it once from button ${k + 1}`, 'mine');
      }
      const cd = s.stolen ? 0 : me.cds[k] || 0;
      const max = this.m.mySlotSpell(k) ? this.m.mySlotSpell(k).cd : s.cd;
      b.classList.toggle('poor', me.catnip < s.cost);
      b.classList.toggle('ready', cd <= 0 && me.catnip >= s.cost);
      const cdEl = b.querySelector('.scd'), txt = b.querySelector('.scdtxt');
      if (cd > 0) { cdEl.style.background = `conic-gradient(rgba(20,16,40,0.72) ${cd / max * 360}deg, transparent 0)`; txt.textContent = Math.ceil(cd); }
      else if (me.catnip < s.cost) { const need = (s.cost - me.catnip) / MAX_CATNIP; cdEl.style.background = `linear-gradient(to top, transparent ${100 - need * 100}%, rgba(20,16,40,0.45) 0)`; txt.textContent = ''; }
      else { cdEl.style.background = 'none'; txt.textContent = ''; }
    });
    const ping = this.m.opts.getPing ? this.m.opts.getPing() : null;
    this.els.ping.textContent = ping != null ? `📶 ${ping} ms` : '';
  }

  onEvent(e, V) {
    const me = this.me;
    switch (e.k) {
      case 'spell': {
        const s = findSpell(e.id);
        if (!s) break;
        const who = this.info.players[e.o];
        this.toast(`${s.icon} <b>${esc(who.name)}</b> cast <b>${s.name}</b>${e.res && e.fx === 'coin' ? ` → ${e.res}` : ''}`, e.o === me ? 'mine' : 'theirs', e.o);
        break;
      }
      case 'err': if (e.o === me) this.toast(e.msg, 'warn'); break;
      case 'star':
        if (e.o === me) this.purrBurst(e.n, true);
        else this.toast(`⭐ ${esc(this.info.players[e.o].name)} reached Purr Power ${'★'.repeat(e.n)}`, 'theirs', e.o);
        break;
      case 'unstar': if (e.o === me) this.purrBurst(e.n, false); break;
      case 'emote': {
        // (portrait phones hide your own card; your emotes pop from the dock instead)
        const card = e.o === me
          ? [...this.root.querySelectorAll('.pcard.me .emote-pop, .mystat .emote-pop')].find(x => x.parentElement.offsetParent !== null)
          : this.root.querySelector(`.pcard[data-o="${e.o}"] .emote-pop`);
        const em = EMOTES.find(x => x.id === e.id);
        if (card && em) { card.textContent = `${em.icon} ${em.text}`; card.classList.remove('show'); void card.offsetWidth; card.classList.add('show'); }
        break;
      }
      case 'out':
        if (e.o === me) break;
        if (e.why === 'surrender') this.toast(`🏳️ ${esc(this.info.players[e.o].name)} surrendered`, 'theirs');
        else if (this.opps.length > 1) this.toast(`💥 <b>${esc(this.info.players[e.o].name)}</b> is out!`, 'theirs', e.o);
        break;
    }
  }

  /** big middle-of-the-screen announcement when your Purr Power gains or loses a star */
  purrBurst(n, up) {
    const old = this.root.querySelector('.purr-burst');
    if (old) old.remove();
    const stars = '★'.repeat(n) + '<s>' + '★'.repeat(5 - n) + '</s>';
    const b = el('div', 'purr-burst ' + (up ? 'up' : 'down'), up
      ? `<div class="pbs">${stars}</div><div class="pbt">PURR POWER${n >= 5 ? ' MAX!' : '!'}</div><div class="pbd">All your cats ${purrBonus(n)}</div>`
      : `<div class="pbs">${stars}</div><div class="pbt">Purr Power down</div><div class="pbd">${n ? 'Now ' + purrBonus(n) : 'Capture buildings and beat back attacks to purr again'}</div>`);
    this.root.appendChild(b);
    setTimeout(() => b.remove(), up ? 2200 : 1700);
  }
  toast(html, kind = '', owner = -1) {
    const t = el('div', 'toast ' + kind, html);
    if (owner >= 0) t.style.setProperty('--tc', teamColor(owner).main);
    this.els.toasts.prepend(t);
    while (this.els.toasts.children.length > (this.phone ? 2 : 4)) this.els.toasts.lastChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  // ---------- building menu ----------
  openBMenu(b, V) {
    this.bmenuFor = b.id;
    this.convAsk = null;
    this.bmenuKey = '';
    this.els.bmenu.classList.remove('hidden');
    this.refreshBMenu(V, true);
    this.positionBMenu(b);
  }
  closeBMenu() { this.bmenuFor = null; this.convAsk = null; this.els.bmenu.classList.add('hidden'); if (this.holdFor && this.holdFor.kind !== 'b') this.hideHoldTip(); }
  positionBMenu(b) {
    const R = this.m.renderer;
    const s = R.toScreen(b.x, b.y);
    const menu = this.els.bmenu;
    const w = menu.offsetWidth || 230, h = menu.offsetHeight || 120;
    const rp = b.radius * R.view.scale;
    if (this.phone) {
      // float just above the building; flip below its count badge when there is no room
      const pad = R.pad;
      let y = s.y - rp * 1.7 - h - 4;
      if (y < pad.top) y = s.y + rp * 0.62 + 24 * R.uiScale * R.view.scale + 10;
      y = Math.min(y, window.innerHeight - pad.bottom - h - 2);
      menu.style.left = Math.max(pad.left + 2, Math.min(window.innerWidth - pad.right - w - 2, s.x - w / 2)) + 'px';
      menu.style.top = Math.max(pad.top, y) + 'px';
      return;
    }
    let x = s.x - w / 2, y = s.y + rp * 0.9 + 22;
    if (y + h > window.innerHeight - 100) y = s.y - rp * 2.1 - h;
    menu.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x)) + 'px';
    menu.style.top = Math.max(60, y) + 'px';
  }
  refreshBMenu(V, force) {
    this.lastV = V;
    const b = V.byId.get(this.bmenuFor);
    if (!b) return this.closeBMenu();
    const def = BUILDINGS[b.type];
    // Free Build: the next upgrade or convert costs nothing
    const free = bfxHas(b, 'build');
    const cost = def.upgradeCost[b.level - 1] != null ? (free ? 0 : def.upgradeCost[b.level - 1]) : null;
    const n = Math.floor(b.count);
    const convs = def.noConvert ? [] : Object.keys(CONVERT_COST).filter(t => t !== b.type).map(t => ({ t, c: free ? 0 : CONVERT_COST[t] }));
    // changing a building's type asks first: the first tap picks the new type, the second confirms it
    const ask = this.convAsk && this.convAsk.id === b.id ? convs.find(c => c.t === this.convAsk.t) : null;
    const key = `${free}|${b.id}|${b.type}|${b.level}|${cost != null && n >= cost}|${convs.map(c => n >= c.c ? 1 : 0).join('')}|${ask ? ask.t : ''}`;
    if (!force && key === this.bmenuKey) return;
    this.bmenuKey = key;
    let info = '';
    if (def.prod[b.level - 1]) info = `🐱 ${def.prod[b.level - 1].toFixed(2)}/s · holds ${b.cap}`;
    else if (def.range) info = `🎯 range ${def.range[b.level - 1]}${def.range[b.level] ? ` (next ${def.range[b.level]})` : ''} · holds ${b.cap}`;
    else if (def.atkBonus) info = `⚔ +${Math.round(def.atkBonus[b.level - 1] * 100)}% attack for all cats`;
    else if (def.catnipBonus) info = `🌿 +${Math.round(def.catnipBonus[b.level - 1] * 100)}% catnip regen`;
    const m = this.els.bmenu;
    if (ask) return this.drawConvertAsk(m, b, def, ask, n);
    if (this.phone) {
      m.innerHTML = `
        <div class="bm-h">${def.icon} ${def.name} <span class="lv">Lv ${b.level}</span></div>
        <div class="bm-row">
          ${cost != null ? `<button class="bm-up ${n >= cost ? '' : 'off'}" aria-label="Upgrade">⬆<span>${cost}</span></button>` : ''}
          ${convs.map(c => `<button data-t="${c.t}" class="bm-cv ${n >= c.c ? '' : 'off'}" aria-label="Convert to ${BUILDINGS[c.t].name}">${BUILDINGS[c.t].icon}<span>${c.c}</span></button>`).join('')}
          <button class="bm-x" aria-label="Close">✕</button>
        </div>`;
      m.querySelector('.bm-x').onclick = () => this.m.closeMenu();
      const upb = m.querySelector('.bm-up');
      if (upb) upb.onclick = () => { this.m.upgrade(b.id); };
      m.querySelectorAll('.bm-cv').forEach(x => x.onclick = () => this.askConvert(b, x.dataset.t));
      requestAnimationFrame(() => this.bmenuFor === b.id && this.positionBMenu(b));
      return;
    }
    m.innerHTML = `
      <div class="bm-h">${def.icon} ${def.name} <span class="lv">Lv ${b.level}${def.maxLevel > 1 ? '/' + def.maxLevel : ''}</span><button class="bm-x">✕</button></div>
      <div class="bm-i">${info}</div>
      ${cost != null ? `<button class="bm-up ${n >= cost ? '' : 'off'}">⬆ Upgrade <span>${cost} 🐾</span></button>` : `<div class="bm-max">${def.maxLevel > 1 ? '★ Max level' : ''}</div>`}
      ${convs.length ? `<div class="bm-conv-l">Convert to:</div><div class="bm-conv">${convs.map(c => `<button data-t="${c.t}" class="${n >= c.c ? '' : 'off'}" aria-label="Change to ${BUILDINGS[c.t].name}">${BUILDINGS[c.t].icon}<span>${c.c}</span></button>`).join('')}</div>` : ''}
      <div class="bm-tip">Tap another building to send cats · double-tap to upgrade · hold a button to compare</div>`;
    m.querySelector('.bm-x').onclick = () => this.m.closeMenu();
    const up = m.querySelector('.bm-up');
    if (up) up.onclick = () => { this.m.upgrade(b.id); };
    m.querySelectorAll('.bm-conv button').forEach(x => x.onclick = () => this.askConvert(b, x.dataset.t));
  }
  askConvert(b, t) {
    this.convAsk = t ? { id: b.id, t } : null;
    if (!this.lastV) return;
    this.refreshBMenu(this.lastV, true);
    requestAnimationFrame(() => this.bmenuFor === b.id && this.positionBMenu(b));
  }
  /** "Change this Forge into a Tower?" with a yes and a cancel button. */
  drawConvertAsk(m, b, def, ask, n) {
    const to = BUILDINGS[ask.t], off = n >= ask.c ? '' : 'off';
    if (this.phone) {
      m.innerHTML = `
        <div class="bm-h">${def.icon} → ${to.icon} Change to ${to.name}?</div>
        <div class="bm-row">
          <button class="bm-yes ${off}" aria-label="Yes, change it">✔<span>${ask.c}</span></button>
          <button class="bm-no" aria-label="Cancel">✕</button>
        </div>`;
    } else {
      m.innerHTML = `
        <div class="bm-h">${def.icon} → ${to.icon} ${to.name}?<button class="bm-x">✕</button></div>
        <div class="bm-i">Change this ${def.name} into a ${to.name} for <b>${ask.c} 🐾</b>. It starts again at level 1.</div>
        <div class="bm-ask"><button class="bm-yes ${off}">✔ Yes, change it</button><button class="bm-no">Cancel</button></div>`;
      m.querySelector('.bm-x').onclick = () => this.m.closeMenu();
    }
    m.querySelector('.bm-yes').onclick = () => { this.convAsk = null; this.m.convert(b.id, ask.t); };
    m.querySelector('.bm-no').onclick = () => this.askConvert(b, null);
    requestAnimationFrame(() => this.bmenuFor === b.id && this.positionBMenu(b));
  }

  // ---------- emotes / pause ----------
  toggleEmotes() { this.els.wheel.classList.toggle('hidden'); }
  closeEmotes() { this.els.wheel.classList.add('hidden'); }
  toggleMute() { const v = !audio.muted; audio.setMuted(v); setSetting('muted', v); this.toast(v ? '🔇 Sound off' : '🔊 Sound on'); }
  openPause() {
    const p = this.$('.pause');
    const canPause = this.m.canPause;
    this.m.setPaused(true);
    const st = profile().settings;
    p.innerHTML = `<div class="pause-card">
      <h2>${canPause ? '⏸ Paused' : '☰ Menu'}</h2>
      ${canPause ? '' : '<p class="muted">Online matches keep running!</p>'}
      <button class="btn primary p-resume">Resume</button>
      <div class="row"><button class="btn p-music">${st.music > 0 ? '🎵 Music: on' : '🎵 Music: off'}</button><button class="btn p-sound">${audio.muted ? '🔇 Sound: off' : '🔊 Sound: on'}</button></div>
      <div class="help-mini">${this.phone ? `
        <div><b>Drag</b> from your building to a target, or <b>tap</b> yours then <b>tap</b> the target</div>
        <div><b>Swipe</b> across several of yours to send from all · <b>🐾 ALL</b> picks every building</div>
        <div>Tapping yours also shows <b>upgrade</b> and <b>convert</b> · <b>double-tap</b> upgrades</div>
        <div><b>Hold</b> a spell button to read what it does</div>
        <div>Enemy cat counts are hidden (<b>?</b>). Only some heroes have a skill that shows them</div>
        <div>⭐ <b>Purr Power</b> makes your whole army tougher. Don't attack into a rival with more stars!</div>` : `
        <div><b>Drag</b> from your building to send cats · <b>swipe</b> across several to send from all</div>
        <div><b>Tap</b> a building for upgrade/convert · <b>double-tap</b> to upgrade</div>
        <div><b>1-${this.sk.length}</b> skills · <b>Q W E R</b> send 25-100% · <b>T</b> emotes · <b>Esc</b> cancel</div>
        <div>⭐ <b>Purr Power</b> makes your whole army tougher. Don't attack into a rival with more stars!</div>
        <div>Enemy cat counts are hidden (<b>?</b>). Only some heroes have a skill that shows them</div>`}
      </div>
      ${inFullscreen() ? '<button class="btn p-exitfs">⛶ Exit full screen<small>brings back your phone&#39;s Home and Back buttons</small></button>' : ''}
      <button class="btn danger p-surrender">🏳️ Surrender</button>
    </div>`;
    p.classList.remove('hidden');
    const close = () => { p.classList.add('hidden'); this.m.setPaused(false); };
    p.querySelector('.p-resume').onclick = close;
    p.onclick = ev => { if (ev.target === p) close(); };
    p.querySelector('.p-music').onclick = ev => {
      const on = !(profile().settings.music > 0);
      setSetting('music', on ? 0.45 : 0); audio.setVolumes({ music: on ? 0.45 : 0 });
      ev.target.textContent = on ? '🎵 Music: on' : '🎵 Music: off';
    };
    p.querySelector('.p-sound').onclick = ev => { this.toggleMute(); ev.target.textContent = audio.muted ? '🔇 Sound: off' : '🔊 Sound: on'; };
    const fsb = p.querySelector('.p-exitfs');
    if (fsb) fsb.onclick = () => { exitFullscreen(); fsb.remove(); this.toast('⛶ Full screen off. Turn it off for good in Settings.'); };
    p.querySelector('.p-surrender').onclick = ev => {
      if (ev.target.dataset.sure) { close(); this.m.surrender(); }
      else { ev.target.dataset.sure = 1; ev.target.textContent = 'Tap again to give up'; }
    };
  }

  countdown(n, done) {
    const c = this.$('.countdown');
    c.classList.remove('hidden');
    const tick = k => {
      if (!this.m.running) return;
      c.innerHTML = `<span class="cd-num">${k > 0 ? k : 'GO!'}</span>`;
      audio.play(k > 0 ? 'countdown' : 'go');
      if (k > 0) setTimeout(() => tick(k - 1), 800);
      else { done(); setTimeout(() => c.classList.add('hidden'), 700); }
    };
    tick(n);
  }
  banner(text, kind, why) {
    const b = this.$('.banner');
    const sub = why === 'out' ? 'you were knocked out' : why === 'surrender' ? 'by surrender' : why === 'disconnect' ? 'opponent disconnected' : why === 'time' ? 'time ran out — biggest army wins' : '';
    b.className = 'banner ' + kind;
    b.innerHTML = `<div class="banner-t">${text}</div>${sub ? `<div class="banner-s">${sub}</div>` : ''}`;
    this.closeBMenu(); this.closeEmotes();
    this.$('.pause').classList.add('hidden');
  }
  waiting(text) {
    let w = this.root.querySelector('.waiting');
    if (!text) { if (w) w.remove(); return; }
    if (!w) { w = el('div', 'waiting'); this.root.appendChild(w); }
    w.innerHTML = '<div class="waiting-card"><div class="waiting-cat">📡</div><div>' + text + '</div></div>';
  }
  destroy() {
    if (this.endMenuHold) { window.removeEventListener('pointerup', this.endMenuHold); window.removeEventListener('pointercancel', this.endMenuHold); }
    this.holdFor = null;
    this.root.innerHTML = ''; this.root.className = 'hud';
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
