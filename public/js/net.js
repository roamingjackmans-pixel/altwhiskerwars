// Whisker Wars networking: two interchangeable transports.
//  - WSTransport: relay through the included Node server (most reliable)
//  - P2PTransport: direct WebRTC via PeerJS (works on any static website), with a backup relay for players
//    whose phone or network can't connect directly: if the direct connection fails or hasn't opened within
//    6 s, their messages go through public MQTT servers over secure websockets instead (relay.js). The host
//    always listens there too. (PeerJS's own free relay server has shut down.)
// A room has a host and up to 3 guests. Guests are numbered by slot (1-3). Events: 'message'(data, fromSlot),
// 'peer-join'(slot), 'peer-leave'(slot); a guest hears from the host as slot 0. send(data, toSlot?) on the
// host goes to one guest or, without a slot, to all of them.
import { RelayHost, RelayGuest } from './relay.js';

const MAX_GUESTS = 3;
const RTC_WAIT = 6000;    // how long the direct connection gets before a guest tries the relay as well
// ?forcerelay in the page address skips the direct connection, for testing the relay
const FORCE_RELAY = typeof location !== 'undefined' && /[?&]forcerelay\b/.test(location.search);
// Room codes are 5 digits: easy to read out and type on a phone's number pad.
const CODE_ALPHABET = '0123456789';
export function genCode(n = 5) {
  let c = '';
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  for (let i = 0; i < n; i++) c += i === 0 ? String(1 + (a[i] % 9)) : CODE_ALPHABET[a[i] % CODE_ALPHABET.length]; // never starts with 0
  return c;
}
// (letters are still accepted so a room made with an old letter code can be joined)
export function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return this; }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); }
  emit(ev, ...a) { for (const f of this._h[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }
}

const cfg = () => window.WW_CONFIG || {};

let detected;
const FORCE_P2P = typeof location !== 'undefined' && new URLSearchParams(location.search).has('p2p');
/** Returns the relay server ws:// URL to use, or null for peer-to-peer. */
export async function detectServer() {
  if (detected !== undefined) return detected;
  const s = FORCE_P2P ? 'p2p' : (cfg().server || 'auto');
  if (s === 'p2p' || s === 'none') return (detected = null);
  if (/^wss?:\/\//.test(s)) return (detected = s);
  // GitHub Pages only serves static files, so there is never a server to find there
  if (location.protocol === 'file:' || /\.github\.io$/.test(location.hostname)) return (detected = null);
  // the server answers at <app folder>/api/health (or the site root)
  for (const rel of ['api/health', '/api/health']) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const url = new URL(rel, location.href);
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      const j = await r.json();
      if (j && j.ok && j.name === 'whisker-wars') {
        const ws = new URL(rel.replace('api/health', 'ws'), location.href);
        ws.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return (detected = ws.href);
      }
    } catch { /* static host */ }
  }
  return (detected = null);
}

export class WSTransport extends Emitter {
  constructor(url) { super(); this.url = url; this.kind = 'server'; this.ws = null; this.code = null; this.isHost = false; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('Server timeout')); }, 6000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach the game server')); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.emit('close'); } };
      ws.onmessage = ev => this._onMsg(ev.data);
      this.ws = ws;
    });
  }
  _onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'msg') this.emit('message', m.d, m.from || 0);
    else if (m.t === 'peer-join') this.emit('peer-join', m.slot || 1);
    else if (m.t === 'peer-leave') this.emit('peer-leave', m.slot || 0);
    else if (m.t === 'pong') this.emit('server-pong', m.ts);
    else this.emit('ctl', m);
  }
  _await(types, ms = 6000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('ctl', h); reject(new Error('Server did not answer')); }, ms);
      const h = m => {
        if (m.t === 'error') { clearTimeout(t); this.off('ctl', h); const e = new Error(m.msg || 'Error'); e.code = m.code; reject(e); }
        else if (types.includes(m.t)) { clearTimeout(t); this.off('ctl', h); resolve(m); }
      };
      this.on('ctl', h);
    });
  }
  async host() {
    await this.connect();
    this.ws.send(JSON.stringify({ t: 'host' }));
    const m = await this._await(['hosted']);
    this.code = m.code; this.isHost = true;
    return m.code;
  }
  async join(code, pid) {
    await this.connect();
    this.ws.send(JSON.stringify({ t: 'join', code, pid }));
    const m = await this._await(['joined']);
    this.code = code; this.isHost = false; this.slot = m.slot || 1;
  }
  send(d, to) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(to ? { t: 'msg', d, to } : { t: 'msg', d })); }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  close() { const ws = this.ws; this.ws = null; if (ws) { try { ws.send(JSON.stringify({ t: 'leave' })); } catch {} try { ws.close(); } catch {} } }
}

export class P2PTransport extends Emitter {
  constructor() { super(); this.kind = 'p2p'; this.peer = null; this.conn = null; this.conns = new Map(); this.code = null; this.isHost = false; }
  _peerOpts() {
    const o = { debug: 1 };
    const ice = cfg().iceServers;
    if (Array.isArray(ice) && ice.length) {
      o.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...ice] };
    }
    return o;
  }
  _newPeer(id) {
    if (!window.Peer) throw new Error('Peer-to-peer library failed to load');
    return new Promise((resolve, reject) => {
      const peer = id ? new window.Peer(id, this._peerOpts()) : new window.Peer(this._peerOpts());
      const timer = setTimeout(() => reject(new Error('Could not reach the matchmaking service')), 10000);
      peer.on('open', () => { clearTimeout(timer); resolve(peer); });
      peer.on('error', err => { clearTimeout(timer); reject(err); });
    });
  }
  /** guest: the one connection to the host */
  _wire(conn) {
    this.conn = conn;
    conn.on('data', d => this.emit('message', d, 0));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.emit('peer-leave', 0); } });
    conn.on('error', () => {});
  }
  /** host: one connection per guest slot */
  _wireGuest(conn, slot) {
    this.conns.set(slot, conn);
    conn.on('data', d => { if (this.conns.get(slot) === conn) this.emit('message', d, slot); });
    conn.on('close', () => { if (this.conns.get(slot) === conn) { this.conns.delete(slot); this.emit('peer-leave', slot); } });
    conn.on('error', () => {});
  }
  async host() {
    const prefix = cfg().peerPrefix || 'whiskerwars-v1-';
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = genCode();
      try {
        this.peer = await this._newPeer(prefix + code);
        this.code = code; this.isHost = true;
        this.peer.on('connection', conn => {
          const slot = this._slotFor(conn.metadata && conn.metadata.pid);
          if (!slot) { conn.on('open', () => { conn.send({ type: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
          this.conns.set(slot, conn);
          conn.on('open', () => { this._wireGuest(conn, slot); this.emit('peer-join', slot); });
        });
        this.peer.on('disconnected', () => { try { this.peer && !this.peer.destroyed && this.peer.reconnect(); } catch {} });
        this.peer.on('error', e => console.warn('peer error', e && e.type));
        // players who can't connect directly come in through the relay
        this.hub = new RelayHost(code, conn => this._acceptRelay(conn)).start();
        return code;
      } catch (e) {
        lastErr = e;
        try { this.peer && this.peer.destroy(); } catch {}
        if (!(e && e.type === 'unavailable-id')) break;
      }
    }
    throw lastErr || new Error('Could not create room');
  }
  /** host: the same player reconnecting takes back their slot; otherwise the next free one (up to 3 guests) */
  _slotFor(pid) {
    let slot = 0;
    for (const [s, c] of this.conns) if (pid && c.metadata && c.metadata.pid === pid) { slot = s; this.conns.delete(s); try { c.close(); } catch {} }
    if (!slot) for (let s = 1; s <= MAX_GUESTS && !slot; s++) if (!this.conns.has(s) || !this.conns.get(s).open) slot = s;
    return slot;
  }
  /** host: a player coming in through the relay. Their first message says who they are. */
  _acceptRelay(conn) {
    let placed = false;
    conn.on('data', m => {
      if (placed || !m || m.t !== 'relay-hello') return;
      placed = true;
      conn.metadata = { pid: m.pid };
      const slot = this._slotFor(m.pid);
      conn.send({ t: 'relay-ok' });
      if (!slot) { conn.send({ type: 'full' }); setTimeout(() => conn.close(), 300); return; }
      this._wireGuest(conn, slot);
      this.emit('peer-join', slot);
    });
  }
  /**
   * Join: straight to the host's browser if we can, otherwise through the relay. The relay starts connecting at
   * once, so switching over is quick, and gets used if the direct connection fails or hasn't opened within
   * RTC_WAIT. Without the matchmaking service at all, the relay is the only way in.
   */
  async join(code, pid) {
    const prefix = cfg().peerPrefix || 'whiskerwars-v1-';
    this.peer = await this._newPeer(null).catch(() => null);
    const relay = new RelayGuest(code).prepare();
    const notFound = msg => Object.assign(new Error(msg), { code: 'notfound' });
    await new Promise((resolve, reject) => {
      let path = null, done = false, conn = null, slow = 0;
      const finish = err => {
        if (done) return;
        done = true; clearTimeout(timer); clearTimeout(slow);
        if (err) { relay.close(); reject(err); } else resolve();
      };
      const timer = setTimeout(() => finish(notFound('Room not found (or the connection was blocked)')), 20000);
      const blocked = () => finish(new Error(this.peer ? "Couldn't connect to that room. Your network may be blocking it." : 'Could not reach the game servers. Check your internet connection.'));
      const useRelay = why => {
        if (path || done) return;
        console.debug('[net] trying the relay:', why);
        if (relay.dead) return blocked();
        path = 'relay';
        clearTimeout(slow);
        if (conn) { try { conn.close(); } catch {} }
        relay.on('data', m => {
          if (done || !m || m.t !== 'relay-ok') return;
          this.kind = 'relay';
          this._wire(relay);
          console.debug('[net] joined through the relay', relay.via);
          finish();
        });
        relay.on('dead', () => { if (!done) blocked(); });
        relay.hello({ t: 'relay-hello', pid });
      };
      if (!this.peer || FORCE_RELAY) { useRelay(this.peer ? 'forced' : 'no matchmaking service'); return; }
      conn = this.peer.connect(prefix + code, { reliable: true, serialization: 'json', metadata: { pid } });
      slow = setTimeout(() => useRelay('direct connection is slow'), RTC_WAIT);
      this.peer.on('error', e => {
        if (done) return;
        if (e && e.type === 'peer-unavailable') finish(notFound('Room not found'));
        else useRelay('error ' + (e && e.type));
      });
      conn.on('open', () => {
        if (path || done) { try { conn.close(); } catch {} return; }
        path = 'direct';
        relay.close();
        this._wire(conn);
        finish();
      });
      conn.on('close', () => { if (!path && !done) useRelay('direct connection failed'); });
      conn.on('error', () => {});
    });
    this.code = code; this.isHost = false;
  }
  send(d, to) {
    const out = c => { if (c && c.open) { try { c.send(d); } catch (e) { console.warn(e); } } };
    if (!this.isHost) return out(this.conn);
    if (to) out(this.conns.get(to)); else for (const c of this.conns.values()) out(c);
  }
  get connected() { return this.isHost ? [...this.conns.values()].some(c => c.open) : !!this.conn && this.conn.open; }
  close() {
    try { this.hub && this.hub.stop(); } catch {}
    this.hub = null;
    try { this.conn && this.conn.close(); } catch {}
    for (const c of this.conns.values()) { try { c.close(); } catch {} }
    try { this.peer && this.peer.destroy(); } catch {}
    this.conn = null; this.conns.clear(); this.peer = null;
  }
}

/** Create a room. Returns { transport, code }. */
export async function hostRoom() {
  const url = await detectServer();
  if (url) {
    const t = new WSTransport(url);
    try { const code = await t.host(); return { transport: t, code }; }
    catch (e) { console.warn('server host failed, falling back to P2P', e); t.close(); }
  }
  const t = new P2PTransport();
  const code = await t.host();
  return { transport: t, code };
}

/** Join a room by code. Tries the relay server first, then peer-to-peer. */
export async function joinRoom(code, pid) {
  code = cleanCode(code);
  if (code.length < 4) throw new Error('Room codes are 5 numbers');
  const url = await detectServer();
  let firstErr;
  if (url) {
    const t = new WSTransport(url);
    try { await t.join(code, pid); return t; }
    catch (e) { firstErr = e; t.close(); }
  }
  const t = new P2PTransport();
  try { await t.join(code, pid); return t; }
  catch (e) { t.close(); throw (firstErr && firstErr.code !== 'notfound') ? firstErr : e; }
}
