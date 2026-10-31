// Alt Whisker Wars - interactive tutorial.
// A real battle on a small practice field. A coach card walks you through it one step at a time: each step points
// at what to do (glowing rings, a paw that shows the drag, glowing buttons) and waits until you have done it.
// The red cat stays still until the last step, except when the tutorial sends it in to show you something.
import { BUILDINGS, CONVERT_COST, PURR, purrLevel, heroById, HEROES } from '../shared/data.js';
import { audio } from './audio.js';

// The practice field: you on the left, the red cat on the right, strays in between.
export const TUTORIAL_MAP = {
  id: 'tutorial', name: 'Training Meadow', theme: 'meadow', size: 'Tutorial', obstacles: [],
  buildings: [
    { id: 0, x: 240, y: 450, type: 'cottage', level: 2, owner: 0, count: 22 },
    { id: 1, x: 480, y: 250, type: 'cottage', level: 1, owner: -1, count: 5 },
    { id: 2, x: 480, y: 660, type: 'cottage', level: 1, owner: -1, count: 12 },
    { id: 3, x: 770, y: 450, type: 'cottage', level: 1, owner: -1, count: 8 },
    { id: 4, x: 1370, y: 450, type: 'cottage', level: 2, owner: 1, count: 16 },
    { id: 5, x: 1110, y: 250, type: 'cottage', level: 1, owner: 1, count: 6 },
    { id: 6, x: 1110, y: 660, type: 'cottage', level: 1, owner: 1, count: 6 },
  ],
};
const HOME = 0, EASY = 1, BIG = 2, FRONT = 3, ENEMY_HOME = 4, ENEMY_A = 5, ENEMY_B = 6;

export class Tutorial {
  /** match: a local Match on TUTORIAL_MAP with you in seat 0 and the red cat in seat 1 (its AI switched off). */
  constructor(match, onQuit) {
    this.m = match;
    this.onQuit = onQuit;
    this.k = -1;
    this.seen = [];      // events since the step started
    this.t = 0;          // seconds since the step started
    this.card = null;
    this.cardH = 0;
    this.steps = this.makeSteps();
  }

  /** extra room the battlefield leaves at the top for the coach card */
  space() { return this.cardH ? this.cardH + 10 : 0; }
  /** the coach card on screen (buildings are kept out from under it) */
  rect() { return this.card && this.card.isConnected && this.cardH ? this.card.getBoundingClientRect() : null; }

  start() {
    const root = this.m.hud.root;
    this.card = document.createElement('div');
    this.card.className = 'tut-coach';
    root.appendChild(this.card);
    this.go(0);
  }

  get step() { return this.steps[this.k]; }
  owner(id) { const b = this.m.game.byId.get(id); return b ? b.owner : -2; }
  mine(id) { return this.owner(id) === 0; }
  count(id) { const b = this.m.game.byId.get(id); return b ? b.count : 0; }
  hero() { return heroById(this.m.info.players[0].hero) || HEROES[0]; }
  phone() { return !!this.m.phone; }
  /** your cottage, or whatever you hold if you lost it */
  home() { if (this.mine(HOME)) return HOME; const b = this.m.game.buildings.find(x => x.owner === 0); return b ? b.id : HOME; }

  go(k) {
    this.k = k;
    this.seen = [];
    this.t = 0;
    const s = this.step;
    if (!s) return this.finish();
    if (s.enter) s.enter();
    this.m.hold = !!s.hold;
    this.drawCard();
    audio.play(k === 0 ? 'meow' : 'star', { vol: 0.5 });
  }
  next() { this.go(this.k + 1); }

  drawCard() {
    const s = this.step, n = this.steps.length;
    const text = typeof s.text === 'function' ? s.text() : s.text;
    this.card.innerHTML = `
      <div class="tc-top"><span class="tc-step">Tutorial · ${this.k + 1}/${n}</span><span class="tc-title">${s.title}</span><button class="tc-skip">Skip ✕</button></div>
      <div class="tc-body">${text}</div>
      ${s.next ? `<div class="tc-row"><button class="btn primary small tc-next">${s.nextLabel || 'Next →'}</button></div>` : `<div class="tc-wait">${s.waitLabel || '👆 Your turn!'}</div>`}`;
    const nb = this.card.querySelector('.tc-next');
    if (nb) nb.onclick = () => this.next();
    const sk = this.card.querySelector('.tc-skip');
    sk.onclick = () => {
      if (sk.dataset.sure) { this.quit(); return; }
      sk.dataset.sure = 1; sk.textContent = 'Tap again to skip';
      setTimeout(() => { if (sk.isConnected) { delete sk.dataset.sure; sk.textContent = 'Skip ✕'; } }, 2500);
    };
    // glowing HUD buttons
    document.querySelectorAll('.tut-glow').forEach(e => e.classList.remove('tut-glow'));
    for (const sel of s.glow || []) document.querySelectorAll(`#hud ${sel}`).forEach(e => e.classList.add('tut-glow'));
    // make room for the card, then lay the battlefield out again
    requestAnimationFrame(() => {
      if (!this.card || !this.card.isConnected) return;
      this.positionCard();
      const h = Math.round(this.card.getBoundingClientRect().height);
      if (Math.abs(h - this.cardH) > 4) { this.cardH = h; this.m.applyPadding(); this.positionCard(); }
    });
  }
  positionCard() {
    const R = this.m.renderer;
    // the HUD's own top bar ends where the battlefield padding (minus our card) starts
    const top = Math.max(4, R.pad.top - this.space() + 4);
    this.card.style.top = top + 'px';
  }

  update(V, dt) {
    if (!this.step) return;
    if (!this.m.hold) this.t += dt;
    const s = this.step;
    this.m.ui.tut = {
      hl: typeof s.hl === 'function' ? s.hl() : s.hl || [],
      from: typeof s.from === 'function' ? s.from() : s.from,
      to: typeof s.to === 'function' ? s.to() : s.to,
    };
    if (s.live) { const el = this.card.querySelector('.tc-live'); if (el) el.innerHTML = s.live(V); }
    if (s.done && s.done(V)) this.next();
  }
  onEvent(e) { if (this.step) this.seen.push(e); }
  saw(pred) { return this.seen.some(pred); }

  finish() {
    this.m.hold = false;
    this.m.ui.tut = null;
    if (this.card) this.card.remove();
    document.querySelectorAll('.tut-glow').forEach(e => e.classList.remove('tut-glow'));
  }
  quit() { this.finish(); this.onQuit && this.onQuit(); }

  // ------------------------------------------------------------------ the lesson
  makeSteps() {
    const g = () => this.m.game, ph = this.phone();
    const drag = ph ? '<b>Drag</b> from your building to the target (or <b>tap</b> yours, then <b>tap</b> the target)' : '<b>Drag</b> from your building to the target';
    const conv = t => CONVERT_COST[t];
    const P = () => g().players[0];
    return [
      {
        title: 'Your kingdom', hold: true, next: true, hl: [HOME],
        text: `Welcome to the block, boss! The <b style="color:#3d9bff">blue</b> cottage is <b>yours</b>. The number on it is how many cats live inside, and a cottage makes new kittens all the time.
          The <b style="color:#ff5468">red</b> buildings belong to your rival. The grey ones are <b>strays</b>: nobody owns them yet.`,
      },
      {
        title: 'Send your cats', hl: () => [this.home(), EASY], from: () => this.home(), to: EASY,
        text: `${drag} to the stray cottage with <b>5 cats</b>. Half your cats march out. When they arrive they fight the cats inside, and if more of yours arrive than there are defenders, the building is yours.`,
        waitLabel: '👆 Capture the glowing stray cottage',
        done: () => this.mine(EASY),
      },
      {
        title: 'How many to send', glow: ['.pct-btn[data-p="1"]'], hl: () => [this.home(), EASY, BIG], to: BIG, from: () => this.home(),
        text: `Captured! That stray has <b>12 cats</b>: half of yours won't be enough. Use the <b>SEND</b> buttons ${ph ? 'above your thumbs' : 'at the bottom left (or Q W E R)'} to send <b>25, 50, 75 or 100%</b>.
          Pick <b>100%</b>, then ${ph ? '<b>swipe</b> across both of your buildings' : '<b>swipe</b> across both of your buildings before letting go'} and end on the 12-cat stray to send from both at once.
          <div class="tc-tip">While you drag, the pill over the target shows <b>your cats ⚔ cats needed</b>. Green ✔ means it's enough.</div>`,
        waitLabel: '👆 Capture the 12-cat stray',
        done: () => this.mine(BIG),
      },
      {
        title: 'Upgrade', hl: () => [this.home()],
        text: () => `Upgraded cottages make kittens faster and hold more cats. ${ph ? '<b>Tap</b> your big cottage, then tap <b>⬆</b>' : '<b>Click</b> your big cottage, then <b>⬆ Upgrade</b>'} (or ${ph ? 'double-tap' : 'double-click'} it).
          Upgrading costs <b>${BUILDINGS.cottage.upgradeCost[1]} cats</b> from inside the building, so wait until it has enough.
          <div class="tc-live"></div>`,
        live: V => { const b = V.byId.get(this.home()); return b ? `<div class="tc-tip">Cats inside: <b>${Math.floor(b.count)}</b> / ${BUILDINGS.cottage.upgradeCost[b.level - 1] ?? '-'}</div>` : ''; },
        waitLabel: '👆 Upgrade a cottage',
        done: () => this.saw(e => e.k === 'up' && e.o === 0),
      },
      {
        title: 'The front line', hl: [FRONT], from: () => this.home(), to: FRONT,
        text: `The cottage in the middle sits on the <b>front line</b>, closest to your rival. Take it.`,
        waitLabel: '👆 Capture the middle cottage',
        done: () => this.mine(FRONT),
      },
      {
        title: 'Reinforce', hl: [FRONT], from: () => (this.mine(BIG) ? BIG : this.home()), to: FRONT,
        text: `Cats sent to <b>your own</b> building move in and make it stronger. Send cats to the front cottage until it has <b>${conv('tower')} cats</b>.
          <div class="tc-live"></div>`,
        live: V => { const b = V.byId.get(FRONT); return b && b.owner === 0 ? `<div class="tc-tip">Front cottage: <b>${Math.floor(b.count)}</b> / ${conv('tower')} cats</div>` : ''; },
        waitLabel: `👆 Get the front cottage to ${conv('tower')} cats`,
        done: () => this.mine(FRONT) && this.count(FRONT) >= conv('tower'),
      },
      {
        title: 'Switch buildings', hl: [FRONT],
        text: `Any building can <b>switch</b> to a different job (it costs cats and starts again at level 1). Picking the right job for each spot wins battles:
          <div class="tc-jobs">
            <div>🏠 <b>Cottage</b>: makes kittens. Keep them where they are safe.</div>
            <div>🗼 <b>Scratch Tower</b>: shoots enemy cats walking past and is 50% harder to capture. Best on the <b>front line</b>.</div>
            <div>🧶 <b>Yarn Forge</b>: makes <b>all</b> your cats hit harder, everywhere.</div>
            <div>🌿 <b>Catnip Garden</b>: catnip (skill power) refills much faster. Catnip is scarce, so gardens are valuable.</div>
          </div>
          ${ph ? '<b>Tap</b>' : '<b>Click</b>'} the front cottage and switch it to a <b>🗼 Scratch Tower</b> (${conv('tower')} cats).`,
        waitLabel: '👆 Switch the front cottage to a tower',
        done: () => this.saw(e => e.k === 'conv' && e.o === 0 && e.to === 'tower'),
      },
      {
        title: 'Here they come!', hl: [FRONT],
        enter: () => {
          // the red cat sends a raid down the middle, right past your new tower
          const from = [ENEMY_A, ENEMY_B].filter(id => this.owner(id) === 1);
          if (from.length) g().command(1, { k: 'send', from, to: FRONT, pct: 0.55 });
        },
        text: `Your rival is attacking the front! Watch the tower <b>knock cats out</b> as they walk into range. A tower on the front line guards everything behind it.`,
        waitLabel: '👀 Watch the tower...',
        done: () => this.t > 3 && !g().squads.some(s => s.owner === 1),
      },
      {
        title: 'Switch for power', hl: () => g().buildings.filter(b => b.owner === 0 && b.id !== FRONT).map(b => b.id),
        text: () => `${this.mine(FRONT) ? 'Your tower held!' : 'They took it. Towers are much stronger with more cats inside.'} Buildings at the back are safe, so give them a job that helps your whole army.
          Switch one of your back buildings into a <b>🧶 Yarn Forge</b> (all your cats +${Math.round(BUILDINGS.forge.atkBonus[0] * 100)}% attack) or a <b>🌿 Catnip Garden</b> (catnip refills +${Math.round(BUILDINGS.garden.catnipBonus[0] * 100)}% faster). It costs ${conv('forge')} cats.
          <div class="tc-tip">Losing a forge or garden loses its bonus, and a cottage that switched stops making kittens. Switch when it helps more than it costs.</div>`,
        waitLabel: '👆 Switch a back building into a forge or garden',
        done: () => this.saw(e => e.k === 'conv' && e.o === 0 && (e.to === 'forge' || e.to === 'garden')),
      },
      {
        title: 'Hidden enemies', hold: true, next: true, hl: [ENEMY_A, ENEMY_B, ENEMY_HOME],
        text: () => {
          const h = this.hero();
          return `Notice the <b>?</b> on red buildings: <b>nobody can see how many cats are inside a rival's buildings</b>. Not you, and not the computer either. Cats walking on the road always show their numbers.
          <div class="tc-jobs">
            <div>👁 Only two heroes have a skill that looks inside: <b>Doctor Whirl</b> (Spy Eye shows every building in an area) and <b>Morrow</b> (Food Poisoning shows the building it poisons).</div>
            <div>🧮 Everyone else has to <b>guess</b>: remember what a building had, watch the squads that leave it and arrive at it, and count on it making kittens while you wait.</div>
          </div>
          ${h.sees ? `<div class="tc-tip">👁 Good news: <b>${h.name}</b> is one of the heroes who can look inside!</div>` : ''}`;
        },
      },
      {
        title: 'Hero skills', glow: ['.spell[data-slot]'],
        text: () => {
          const h = this.hero();
          return `Your hero, <b>${h.name}</b>, has <b>${h.spells.length} skills</b> that cost catnip: 20, 40, 60 and 80, so the strongest ones take a while to save up for. ${ph ? 'Tap a skill (hold it to read what it does)' : 'Click a skill or press <kbd>1</kbd>-<kbd>' + h.spells.length + '</kbd> (hover to read it)'}, then tap the map or a glowing building.
            <div class="tc-tip">Between battles, <b>level up every skill with 🐟 fish</b> on the Heroes screen: shorter cooldowns and bigger effects.</div>
            <div class="tc-live"></div>`;
        },
        live: V => { const me = V.players[0]; return me ? `<div class="tc-tip">🌿 Catnip: <b>${Math.floor(me.catnip)}</b>. Your first skill costs 20.</div>` : ''; },
        waitLabel: '👆 Use one of your hero skills',
        done: () => this.saw(e => e.k === 'spell' && e.o === 0),
      },
      {
        title: 'Attack!', hl: () => [ENEMY_A, ENEMY_B].filter(id => this.owner(id) === 1),
        text: `Attack a red building with <b>more cats than it has</b>, plus a few extra: it keeps making kittens while your cats walk. These cottages started with 6 cats and grow about one every 2-3 seconds, so bring plenty.
          <div class="tc-tip">A building you take from your rival <b>drops one level</b>, so their best buildings are worth less once you own them.</div>`,
        waitLabel: '👆 Capture a red building',
        done: () => this.saw(e => e.k === 'cap' && e.o === 0 && e.prev === 1),
      },
      {
        title: 'Purr Power', hold: true, next: true, glow: ['.purr'],
        text: () => `The stars by your name are your army's <b>Purr Power</b>. Each star makes <b>every one</b> of your cats tougher:
          <div class="tc-jobs">
            <div>🛡 <b>+${Math.round(PURR.def * 100)}% defense</b>, ⚔ <b>+${Math.round(PURR.atk * 100)}% attack</b> and 💨 <b>+${Math.round(PURR.spd * 100)}% speed</b> per star.</div>
            <div>At 4 stars one of your defenders is worth <b>two</b> attackers from a 0-star army. <b>Never attack into a rival with more stars!</b></div>
          </div>
          <div class="tc-jobs">
            <div>📈 <b>Earn it:</b> capture buildings (a rival's are worth the most), upgrade, and knock out cats that attack you (+${PURR.killDefending} each).</div>
            <div>📉 <b>Lose it:</b> lose buildings, lose cats while attacking (${PURR.lostAttacking} each), or sit still. The more stars you have, the faster they drain when you stop doing things.</div>
            <div>🌿 Cats you lose attacking give back a little catnip, and a lot more when your Purr Power is low.</div>
          </div>
          <div class="tc-live"></div>`,
        live: V => this.purrLine(V),
      },
      {
        title: 'Earn a star', glow: ['.purr'], hl: () => [this.strongest()],
        enter: () => {
          // a head start, then the red cat throws a raid at your strongest building: every cat you knock out is +10
          const p = P();
          if (purrLevel(p.purr) < 1) g().setPurr(0, Math.max(p.purr, PURR.stars[1] - 220));
          const to = this.strongest();
          const from = g().buildings.filter(b => b.owner === 1).map(b => b.id);
          if (from.length && to != null) g().command(1, { k: 'send', from, to, pct: 0.6 });
        },
        text: `Here comes a raid on your strongest building! Every attacker it knocks out gives you <b>+${PURR.killDefending}</b> Purr, and every cat the red cat throws away costs it Purr. Send more cats there if it looks thin.
          <div class="tc-live"></div>`,
        live: V => this.purrLine(V),
        waitLabel: '⭐ Beat back the raid',
        done: () => {
          if (purrLevel(P().purr) >= 1 && this.t > 2) return true;
          // the raid is over: whatever happened, hand out the first star so the lesson can carry on
          if (this.t > 4 && !g().squads.some(s => s.owner === 1)) { g().setPurr(0, Math.max(P().purr, PURR.stars[1] + 20)); return true; }
          return false;
        },
      },
      {
        title: 'Win the battle', next: true, nextLabel: 'Let\'s go! ⚔️', hold: true,
        text: () => `${purrLevel(P().purr) >= 1 ? '⭐ <b>Your first star!</b> Your buildings now defend ' + Math.round(PURR.def * 100) + '% better. ' : ''}That's everything! Your rival will now fight back for real. Take every red building to win.
          <div class="tc-tip">Remember: towers on the front, forges and gardens at the back, guess hidden armies generously, and keep doing things so your Purr Power doesn't drain.</div>`,
      },
      {
        title: 'Win the battle', hl: () => g().buildings.filter(b => b.owner === 1).map(b => b.id),
        enter: () => this.m.wakeAI && this.m.wakeAI(),
        text: () => `Capture every red building. ${g().buildings.filter(b => b.owner === 1).length} left.`,
        waitLabel: '⚔️ Defeat your rival',
        done: () => false,
      },
    ];
  }

  /** your building that can take the most punishment */
  strongest() {
    const g = this.m.game;
    const mine = g.buildings.filter(b => b.owner === 0);
    if (!mine.length) return null;
    return mine.reduce((a, b) => (b.count * g.defense(b) > a.count * g.defense(a) ? b : a)).id;
  }
  purrLine(V) {
    const p = this.m.game.players[0], lv = purrLevel(p.purr);
    const next = lv < 5 ? PURR.stars[lv + 1] : null;
    return `<div class="tc-tip">⭐ You: <b>${lv} star${lv === 1 ? '' : 's'}</b> · ${Math.floor(p.purr)} purr${next ? ` (next star at ${next})` : ' (max!)'}</div>`;
  }
}
