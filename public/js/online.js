// Whisker Wars online session: lobby + match messaging over a transport (server relay or P2P).
// The host runs the game for everyone. Guests join a free seat (1-3, up to the lobby's player count); the
// transport numbers guests by slot and the session keeps track of which slot sits in which seat.
import { hostRoom, joinRoom } from './net.js';
import { publicProfile, profile } from './profile.js';
import { onAway, onBack, isAway } from './lifecycle.js';

const PROTO = 2;
const SEATS = 4;
// a relayed connection to a player (or host) who stepped away may stay silent this long before it counts as gone
export const AWAY_PATIENCE = 125000;

export class OnlineSession {
  constructor(transport, isHost, code) {
    this.t = transport; this.isHost = isHost; this.code = code;
    this.me = isHost ? 0 : 1;          // a guest learns its real seat from the host's 'welcome'
    this.h = {};
    this.ping = null;
    this.pings = new Map();            // host: round trip per guest slot
    this.slots = new Map();            // host: transport slot -> seat
    this.pids = new Map();             // host: seat -> player id (to give a reconnecting player their seat back)
    this.away = new Set();             // seats whose app is covered or paused right now
    this.closed = false;
    const players = Array(SEATS).fill(null);
    players[0] = isHost ? publicProfile() : null;
    // upgrades: false puts everyone on level 1 skills, so fish spent on upgrades gives no edge
    this.lobby = { size: 2, players, ready: Array(SEATS).fill(false), map: 'meadow', time: 600, rules: {}, upgrades: true, phase: 'lobby', seed: (Math.random() * 1e9) | 0 };
    this.wire(transport);
    if (!isHost) this.send({ type: 'hello', p: publicProfile(), v: PROTO });
    this.pingTimer = setInterval(() => { if (this.peerHere) this.send({ type: 'ping', t: performance.now() }); }, 2000);
    // this phone's app got covered or paused, or came back: tell the others
    this.offLife = [
      onAway(() => this.stepAway(true)),
      onBack(() => { try { this.t.refresh && this.t.refresh(); } catch { } this.stepAway(false); this.emit('back'); }),
    ];
  }
  /** host: is anyone connected? guest: always (it talks to the host) */
  get peerHere() { return this.isHost ? this.slots.size > 0 : !this.closed; }
  wire(transport) {
    const live = () => transport === this.t;
    transport.on('message', (m, from) => live() && this.onMsg(m, from || 0));
    transport.on('peer-join', () => { if (live()) this.emit('peer-join'); });
    transport.on('peer-leave', slot => {
      if (!live()) return;
      if (!this.isHost) { this.emit('peer-leave', 0); return; }
      const seat = this.slots.get(slot);
      this.slots.delete(slot); this.pings.delete(slot);
      if (seat == null) return;
      if (this.lobby.phase !== 'match') { this.lobby.players[seat] = null; this.lobby.ready[seat] = false; this.pids.delete(seat); this.broadcast(); }
      this.emit('peer-leave', seat);
      this.emit('lobby', this.lobby);
    });
    transport.on('close', () => { if (live() && !this.closed) this.emit('disconnected'); });
  }
  /** Guest: try to get back into the same room after a connection drop. */
  async rejoin() {
    const t = await joinRoom(this.code, profile().id);
    try { this.t.close(); } catch { }
    this.t = t;
    this.wire(t);
    this.send({ type: 'hello', p: publicProfile(), v: PROTO, resume: true });
    // reconnected while the app is still covered: say so again
    if (isAway()) this.send({ type: 'away', v: 1 });
  }
  static async host() { const { transport, code } = await hostRoom(); return new OnlineSession(transport, true, code); }
  static async join(code) { const t = await joinRoom(code, profile().id); return new OnlineSession(t, false, code); }

  get kind() { return this.t.kind; }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return () => { this.h[ev] = this.h[ev].filter(f => f !== fn); }; }
  emit(ev, ...a) { for (const f of this.h[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }
  /** host: to one guest slot, or to everyone; guest: to the host */
  send(m, toSlot) { this.t.send(m, toSlot); }
  slotOf(seat) { for (const [slot, s] of this.slots) if (s === seat) return slot; return null; }

  onMsg(m, from) {
    if (!m || typeof m !== 'object') return;
    if (this.isHost) return this.onGuestMsg(m, from);
    switch (m.type) {
      case 'welcome': this.me = m.seat | 0; this.emit('lobby', this.lobby); break;
      case 'lobby': this.lobby = m.s; this.emit('lobby', this.lobby); break;
      case 'start': this.lobby.phase = 'match'; this.emit(m.resume ? 'resume' : 'start', m); break;
      case 'snap': this.emit('snap', m.s); break;
      case 'lemote': this.emit('lemote', m.id, m.from | 0); break;
      case 'tolobby': this.emit('rematch-request'); break;
      case 'ping': this.send({ type: 'pong', t: m.t }); break;
      case 'pong': this.ping = Math.round(performance.now() - m.t); break;
      case 'full': this.emit('error', new Error('That room is already full')); break;
      case 'away': this.setAwayFlag(m.seat | 0, !!m.v); break;
    }
  }
  /**
   * This phone stepped away (its app was covered or paused) or came back. Guests tell the host; the host tells
   * everyone (about itself or about a guest).
   */
  stepAway(v) {
    if (this.closed) return;
    if (this.isHost) { this.setAwayFlag(0, v); this.send({ type: 'away', seat: 0, v: v ? 1 : 0 }); }
    else this.send({ type: 'away', v: v ? 1 : 0 });
    if (!v) this.send({ type: 'ping', t: performance.now() });
  }
  setAwayFlag(seat, v) {
    // a guest waits longer for a host that stepped away before deciding the connection is gone
    if (!this.isHost && seat === 0 && this.t.setPatience) this.t.setPatience(v ? AWAY_PATIENCE : 0);
    if (v === this.away.has(seat)) return;
    if (v) this.away.add(seat); else this.away.delete(seat);
    this.emit('away', seat, v);
  }
  onGuestMsg(m, from) {
    const L = this.lobby;
    const seat = this.slots.get(from);
    switch (m.type) {
      case 'hello': {
        const p = sanitize(m.p);
        // a returning player gets their seat back; a new one takes the first free seat
        let s = [...this.pids].find(([, pid]) => pid && pid === p.id)?.[0];
        if (s == null) {
          if (L.phase === 'match') { this.send({ type: 'full' }, from); return; }
          for (let k = 1; k < L.size; k++) if (!L.players[k]) { s = k; break; }
        }
        if (s == null) { this.send({ type: 'full' }, from); return; }
        for (const [slot, x] of this.slots) if (x === s && slot !== from) this.slots.delete(slot);
        this.slots.set(from, s);
        this.pids.set(s, p.id);
        L.players[s] = p;
        L.ready[s] = false;
        this.send({ type: 'welcome', seat: s }, from);
        if (this.inMatch) {
          L.phase = 'match';
          // a player reconnecting is back, whether or not they said they'd stepped away
          if (this.away.has(s)) { this.setAwayFlag(s, false); this.send({ type: 'away', seat: s, v: 0 }); }
          this.emit('guest-resume', s, from);
          break;
        }
        this.broadcast();
        this.emit('guest-hello', p, s);
        break;
      }
      case 'pick':
        if (seat == null || !L.players[seat]) return;
        Object.assign(L.players[seat], sanitize({ ...L.players[seat], ...m.p }));
        this.broadcast();
        break;
      case 'ready':
        if (seat == null) return;
        L.ready[seat] = !!m.v;
        this.broadcast();
        break;
      case 'cmd': if (seat != null) this.emit('cmd', m.c, seat); break;
      case 'away':
        if (seat == null) return;
        // give a player who stepped away more time before their connection counts as gone
        if (this.t.setPatience) this.t.setPatience(m.v ? AWAY_PATIENCE : 0, from);
        this.setAwayFlag(seat, !!m.v);
        this.send({ type: 'away', seat, v: m.v ? 1 : 0 });
        break;
      case 'lemote':
        if (seat == null) return;
        this.emit('lemote', m.id, seat);
        for (const slot of this.slots.keys()) if (slot !== from) this.send({ type: 'lemote', id: m.id, from: seat }, slot);
        break;
      case 'tolobby':
        this.resetLobby();
        this.send({ type: 'tolobby' });
        this.emit('rematch-request');
        break;
      case 'ping': this.send({ type: 'pong', t: m.t }, from); break;
      case 'pong': this.pings.set(from, Math.round(performance.now() - m.t)); this.ping = Math.max(...this.pings.values()); break;
    }
  }
  broadcast() {
    if (!this.isHost) return;
    this.send({ type: 'lobby', s: this.lobby });
    this.emit('lobby', this.lobby);
  }

  // ---- lobby actions ----
  setPick(p) {
    const L = this.lobby;
    if (this.isHost) { Object.assign(L.players[0], p); this.broadcast(); }
    else { if (L.players[this.me]) Object.assign(L.players[this.me], p); this.send({ type: 'pick', p }); }
  }
  setReady(v) {
    if (this.isHost) { this.lobby.ready[0] = !!v; this.broadcast(); }
    else { this.lobby.ready[this.me] = !!v; this.send({ type: 'ready', v: !!v }); this.emit('lobby', this.lobby); }
  }
  /** host: 2, 3 or 4 players (never fewer seats than players already here); `map` fits the new count */
  setSize(n, map) {
    const L = this.lobby;
    if (!this.isHost || n < 2 || n > SEATS) return false;
    for (let k = n; k < SEATS; k++) if (L.players[k]) return false;
    L.size = n;
    if (map) L.map = map;
    if (n > 2 && L.time === 600) L.time = 900;
    if (n === 2 && L.time === 900) L.time = 600;
    this.broadcast();
    return true;
  }
  setMap(id) { if (this.isHost) { this.lobby.map = id; if (id === 'random') this.lobby.seed = (Math.random() * 1e9) | 0; this.broadcast(); } }
  setTime(s) { if (this.isHost) { this.lobby.time = s; this.broadcast(); } }
  setUpgrades(on) { if (this.isHost) { this.lobby.upgrades = !!on; this.broadcast(); } }
  toggleRule(id) { if (this.isHost) { this.lobby.rules = { ...this.lobby.rules, [id]: !this.lobby.rules[id] }; this.broadcast(); } }
  lobbyEmote(id) { this.send({ type: 'lemote', id, from: this.me }); }
  /** seats filled so far (host included) */
  joined() { return this.lobby.players.slice(0, this.lobby.size).filter(Boolean).length; }
  canStart() {
    const L = this.lobby;
    if (!this.isHost) return false;
    for (let k = 1; k < L.size; k++) if (!L.players[k] || !L.ready[k]) return false;
    return true;
  }
  markMatch() { this.lobby.phase = 'match'; this.lobby.ready = Array(SEATS).fill(false); if (this.isHost) this.broadcast(); }
  resetLobby() {
    const L = this.lobby;
    L.phase = 'lobby'; L.ready = Array(SEATS).fill(false); L.seed = (Math.random() * 1e9) | 0;
    // anyone who left during the battle frees their seat
    const here = new Set(this.slots.values());
    for (let k = 1; k < SEATS; k++) if (L.players[k] && !here.has(k)) { L.players[k] = null; this.pids.delete(k); }
    this.broadcast();
  }
  /** Ask for a rematch: everyone returns to the lobby. */
  toLobby() {
    if (this.isHost) { this.resetLobby(); this.send({ type: 'tolobby' }); }
    else this.send({ type: 'tolobby' });
  }
  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    for (const f of this.offLife || []) f();
    try { this.t.close(); } catch { }
  }
}

/** { skillId: level 1-5 } as sent by a player's lobby pick */
function cleanSkills(s) {
  const out = {};
  if (s && typeof s === 'object') for (const [k, v] of Object.entries(s).slice(0, 12)) { const n = v | 0; if (n >= 1) out[String(k).slice(0, 16)] = Math.min(5, n); }
  return out;
}
function sanitize(p) {
  if (!p) return null;
  return {
    id: String(p.id || '').slice(0, 16), name: String(p.name || 'Kitty').slice(0, 16), level: Math.max(1, Math.min(999, p.level | 0)),
    hero: String(p.hero || 'barnaby').slice(0, 16), fur: String(p.fur || 'ginger').slice(0, 16), hat: String(p.hat || 'none').slice(0, 16),
    heroes: Array.isArray(p.heroes) ? p.heroes.slice(0, 40).map(String) : [],
    fc: /^\d{8}$/.test(String(p.fc || '')) ? String(p.fc) : '',
    skills: cleanSkills(p.skills),
  };
}
