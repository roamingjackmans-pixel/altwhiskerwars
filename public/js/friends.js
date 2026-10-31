// Whisker Wars friends: friend codes, who is online, and one-tap battle invites.
//
// Works on the plain static site and with the Node server alike: every player who uses friends keeps one small
// PeerJS "presence" peer open (id: <peerPrefix>friend-<friendCode>). Seeing whether a friend is online means
// trying to reach their presence peer; an invite is a short message over that connection carrying a room code,
// which the friend then joins the normal way.
//
// Some phones can't make direct connections, so everyone also listens on the backup relay (relay.js, topic
// f<friendCode>). Online checks ask both ways at once; invites try direct first and use the relay if that
// fails, so nobody gets the same invite twice. A phone that can't reach the PeerJS service at all still
// works through the relay alone.
//
// Friend requests work even when the other player is offline: adding someone puts a request in their mailbox on
// the relay's message servers (a retained message, see relay.js), and they find it the next time they open the
// game. Until they add you back, your request is put there again every time you play, in case a server forgot
// it. Adding someone who already sent you a request is a yes: it goes to their mailbox the same way.
import { profile, save } from './profile.js';
import { RelayHost, RelayDialer, mailTopic, mailbox } from './relay.js';

const MAX_FRIENDS = 40;
const MAX_REQUESTS = 30;
const MAX_IGNORED = 200;
const CHECK_EVERY = 25000;       // re-check who is online this often while the friends list is on screen
const INVITE_WAIT = 45000;       // an unanswered invite expires after this long
const cfg = () => window.WW_CONFIG || {};
const prefix = () => (cfg().peerPrefix || 'altwhiskerwars-v1-') + 'friend-';
// ?forcerelay in the page address: act like a phone that can't use PeerJS at all (relay only), for testing
const FORCE_RELAY = typeof location !== 'undefined' && /[?&]forcerelay\b/.test(location.search);

// ---------------- the friend list (saved in the profile) ----------------
export function cleanFriendCode(s) { return String(s || '').replace(/\D/g, '').slice(0, 8); }
export function fmtFriendCode(c) { c = cleanFriendCode(c); return c.length > 4 ? c.slice(0, 4) + ' ' + c.slice(4) : c; }
export function myFriendCode() {
  const p = profile();
  if (!/^\d{8}$/.test(p.friendCode || '')) {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    p.friendCode = String(10000000 + (a[0] % 90000000));
    save();
  }
  return p.friendCode;
}
export function friends() { const p = profile(); if (!Array.isArray(p.friends)) p.friends = []; return p.friends; }
export function isFriend(code) { return friends().some(f => f.code === code); }
export function addFriend(code, name) {
  code = cleanFriendCode(code);
  if (code.length !== 8) return { ok: false, msg: 'Friend codes have 8 numbers' };
  if (code === myFriendCode()) return { ok: false, msg: "That's your own friend code!" };
  const list = friends(), old = list.find(f => f.code === code);
  if (old) { if (name) old.name = cleanName(name); save(); return { ok: true, already: true, friend: old }; }
  if (list.length >= MAX_FRIENDS) return { ok: false, msg: `You can have up to ${MAX_FRIENDS} friends` };
  // they asked first: this is a yes, so you're friends both ways right away
  const p = profile();
  const req = (p.requests || []).find(r => r.code === code);
  const f = { code, name: name ? cleanName(name) : req ? req.name : 'Friend ' + fmtFriendCode(code), added: Date.now(), pending: !req };
  list.push(f);
  p.ignored = (p.ignored || []).filter(c => c !== code);
  p.mailGone = (p.mailGone || []).filter(c => c !== code);
  if (req) { p.mailOut = [...new Set([...(p.mailOut || []), code])]; dropRequest(code); }
  save();
  presence.start();
  presence.sendRequest(code);
  presence.check(code, true);
  emit('change');
  return { ok: true, friend: f, accepted: !!req };
}
export function removeFriend(code) {
  const p = profile();
  p.friends = friends().filter(f => f.code !== code);
  // take back a request they haven't answered yet
  p.mailOut = (p.mailOut || []).filter(c => c !== code);
  p.mailGone = [...new Set([...(p.mailGone || []), code])].slice(-MAX_IGNORED);
  save();
  presence.withdraw(code);
  presence.status.delete(code);
  emit('change');
}
/** true while you've added them but they haven't added you back (as far as we know) */
export function isPending(code) { const f = friends().find(x => x.code === code); return !!(f && f.pending); }

// ---------------- friend requests (people who added you) ----------------
export function friendRequests() {
  const p = profile();
  if (!Array.isArray(p.requests)) p.requests = [];
  return p.requests.filter(r => !isFriend(r.code));
}
/** Add them back. */
export function acceptRequest(code) {
  const r = friendRequests().find(x => x.code === code);
  return addFriend(code, r ? r.name : '');
}
/** Not now: the request goes away and doesn't come back (unless you add them yourself later). */
export function ignoreRequest(code) {
  const p = profile();
  dropRequest(code);
  p.ignored = [code, ...(p.ignored || []).filter(c => c !== code)].slice(0, MAX_IGNORED);
  save();
  emit('change');
}
function dropRequest(code) {
  const p = profile();
  if (Array.isArray(p.requests)) p.requests = p.requests.filter(r => r.code !== code);
  presence.clearMail(code);
}
/** Someone added you. Returns true if this request is new. */
function noteRequest(code, name, at) {
  const p = profile();
  if (isFriend(code) || (p.ignored || []).includes(code)) return false;
  if (!Array.isArray(p.requests)) p.requests = [];
  const old = p.requests.find(r => r.code === code);
  if (old) { if (name && old.name !== cleanName(name)) { old.name = cleanName(name); save(); emit('change'); } return false; }
  p.requests = [{ code, name: cleanName(name), at: Math.min(Date.now(), +at || Date.now()) }, ...p.requests].slice(0, MAX_REQUESTS);
  save();
  emit('change');
  return true;
}
/** They added you back: you're friends both ways now. */
function markMutual(code, name) {
  const f = friends().find(x => x.code === code);
  if (!f) return;
  if (name) rename(code, name);
  if (!f.pending) return;
  f.pending = false;
  save();
  emit('accepted', { code, name: f.name });
  emit('change');
}
// players you met in an online room (not friends yet): the lobby lists them as "played recently" so you can invite them again
const MAX_RECENT = 6;
export function recentPlayers() { const p = profile(); if (!Array.isArray(p.recent)) p.recent = []; return p.recent.filter(r => !isFriend(r.code)); }
export function noteRecent(code, name) {
  code = cleanFriendCode(code);
  if (code.length !== 8 || code === myFriendCode() || isFriend(code)) return;
  const p = profile(), old = (p.recent || []).find(r => r.code === code);
  if (old && old.name === cleanName(name) && Date.now() - old.at < 60000) return;
  p.recent = [{ code, name: cleanName(name), at: Date.now() }, ...(p.recent || []).filter(r => r.code !== code && !isFriend(r.code))].slice(0, MAX_RECENT);
  save();
  emit('change');
}
function cleanName(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Friend'; }
function rename(code, name) {
  const f = friends().find(x => x.code === code);
  if (f && name && f.name !== cleanName(name)) { f.name = cleanName(name); save(); }
}

// ---------------- events for the UI ----------------
const handlers = {};
export function onFriends(ev, fn) { (handlers[ev] ||= new Set()).add(fn); return () => handlers[ev].delete(fn); }
function emit(ev, ...a) { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }

// The UI tells us when the player is in the middle of something (a battle, a full lobby): invites get "busy".
let busyCheck = () => false;
export function setBusyCheck(fn) { busyCheck = fn; }

// ---------------- presence ----------------
class Presence {
  constructor() {
    this.peer = null;
    this.reachable = false;          // false if another tab already holds our presence id
    this.starting = null;
    this.status = new Map();         // friend code -> { state: 'checking' | 'online' | 'offline', at }
    this.pending = new Map();        // friend code -> callbacks for a connection attempt in flight
    this.timer = null;
    this.hub = null;                 // our ear on the relay (and the server connections the dialer shares)
    this.dialer = null;
    this.viaRelay = new Set();       // friends who last answered through the relay: invite them that way first
    this.clears = new Set();         // requests in our mailbox to delete (again on every server that connects)
  }
  get ready() { return !!this.peer && !this.peer.destroyed && this.peer.open; }

  /** Open our presence peer (once) and our ear on the relay. Resolves when we can talk to friends. */
  start() {
    if (this.ready) return Promise.resolve(true);
    if (this.starting) return this.starting;
    // no PeerJS here (or it failed a moment ago): the relay alone will do
    if (!window.Peer || FORCE_RELAY || (this.hub && Date.now() - (this.peerFailed || 0) < 120000)) { this.startRelay(true); return Promise.resolve(true); }
    this.starting = this.open(prefix() + myFriendCode())
      .then(() => { this.reachable = true; this.startRelay(true); return true; })
      // another tab of ours is already reachable: just talk from this one
      .catch(e => (e && e.type === 'unavailable-id' ? this.open(null).then(() => { this.startRelay(false); return true; }) : Promise.reject(e)))
      // no PeerJS service from here: the relay alone still works
      .catch(() => { this.peerFailed = Date.now(); this.startRelay(true); return true; })
      .finally(() => { this.starting = null; emit('change'); });
    return this.starting;
  }
  /** listen: answer friends on the relay too (only the tab that owns our presence, so invites don't pop up twice) */
  startRelay(listen) {
    if (this.hub) return;
    this.hub = new RelayHost('f' + myFriendCode(), conn => this.incoming(conn), m => m.type === 'hello' || m.type === 'invite', listen);
    this.dialer = new RelayDialer(this.hub);
    // our mailbox on every server (everything else on the hub's extra topics is for the dialer)
    const dial = this.hub.onOther;
    this.hub.onOther = (l, t, p) => (t.startsWith(this.mailPrefix) ? this.mail(t, p) : dial && dial(l, t, p));
    this.hub.listen(mailbox(myFriendCode()));
    // send after a moment, so requests already waiting for us (maybe a yes to ours) arrive first
    this.hub.onLink = link => setTimeout(() => this.flushMail(link), 2500);
    this.hub.start();
  }
  open(id) {
    return new Promise((resolve, reject) => {
      const opts = { debug: 0 };
      const ice = cfg().iceServers;
      if (Array.isArray(ice) && ice.length) opts.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...ice] };
      const peer = id ? new window.Peer(id, opts) : new window.Peer(opts);
      const t = setTimeout(() => { try { peer.destroy(); } catch { } reject(new Error('timeout')); }, 12000);
      peer.on('open', () => {
        clearTimeout(t);
        this.peer = peer;
        peer.on('connection', conn => this.incoming(conn));
        peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch { } });
        resolve(peer);
      });
      peer.on('error', e => {
        if (this.peer !== peer) { clearTimeout(t); try { peer.destroy(); } catch { } reject(e); return; }
        // "Could not connect to peer <id>": that friend is not online
        if (e && e.type === 'peer-unavailable') {
          const m = /friend-(\d{8})/.exec(String(e.message || ''));
          if (m && this.pending.has(m[1])) this.pending.get(m[1]).unreachable();
        }
      });
    });
  }
  stop() {
    clearInterval(this.timer); this.timer = null;
    try { this.peer && this.peer.destroy(); } catch { }
    try { this.hub && this.hub.stop(); } catch { }
    this.peer = null; this.hub = null; this.dialer = null; this.reachable = false;
  }

  setStatus(code, state) { this.status.set(code, { state, at: Date.now() }); emit('change'); }

  /**
   * Reach a friend, send `msg` and wait for the first reply. Rejects with 'offline' if they are not around.
   * both = ask directly and through the relay at the same time (fine for "are you there?"); otherwise direct
   * first, and the relay only if that fails or is slow (so an invite never arrives twice).
   */
  talk(code, msg, wait = 9000, both = false) {
    return this.start().then(ok => new Promise((resolve, reject) => {
      if (!ok) return reject('offline');
      if (this.pending.has(code)) this.pending.get(code).fail('superseded');
      const relayUp = () => !!this.dialer && this.dialer.ready;
      let done = false, direct = null, relay = null, opened = false, gone = false, slow = 0;
      const finish = (fn, v, keep) => {
        if (done) return;
        done = true; clearTimeout(t); clearTimeout(slow); this.pending.delete(code);
        for (const c of [direct, relay]) if (c && c !== keep) { try { c.close(); } catch { } }
        fn(v);
      };
      let t = setTimeout(() => finish(reject, 'offline'), wait);
      const shorten = ms => { clearTimeout(t); t = setTimeout(() => finish(reject, 'offline'), ms); };
      const answered = (c, viaRelay) => d => {
        if (viaRelay) this.viaRelay.add(code); else this.viaRelay.delete(code);
        finish(resolve, { reply: d, conn: c }, c);
      };
      const useRelay = () => {
        if (done || relay || !relayUp()) return false;
        relay = this.dialer.dial('f' + code);
        relay.on('data', answered(relay, true));
        relay.hello(msg);
        return true;
      };
      // the direct way didn't work: whatever the relay can do now is all there is
      const unreachable = () => {
        if (done || gone) return;
        gone = true; clearTimeout(slow);
        if (direct) { const d = direct; direct = null; try { d.close(); } catch { } }
        if (relay || useRelay()) shorten(both ? 3000 : 5000);
        else finish(reject, 'offline');
      };
      this.pending.set(code, { fail: why => finish(reject, why), unreachable });
      if (both || !this.ready || this.viaRelay.has(code)) useRelay();
      if (!this.ready || (!both && relay)) { if (!relay) finish(reject, 'offline'); return; }
      const conn = direct = this.peer.connect(prefix() + code, { reliable: true, serialization: 'json' });
      if (!both) slow = setTimeout(() => { if (!opened) unreachable(); }, 4000);
      conn.on('open', () => { opened = true; clearTimeout(slow); if (direct === conn) conn.send(msg); });
      conn.on('data', d => { if (direct === conn) answered(conn, false)(d); });
      conn.on('error', () => { });
      conn.on('close', () => { if (direct === conn) unreachable(); });
    }));
  }
  hello() { const p = profile(); return { type: 'hello', v: 1, code: myFriendCode(), name: p.name }; }

  // ---- the mailbox (friend requests that wait for an offline player) ----
  get mailPrefix() { return mailTopic(myFriendCode(), ''); }
  /** our request (or our yes to theirs) as it sits in their mailbox */
  requestMsg(code) {
    const f = friends().find(x => x.code === code);
    return JSON.stringify({ type: 'req', v: 1, code: myFriendCode(), name: profile().name, at: f ? f.added : Date.now() });
  }
  /** publish on every connected server; false if none is connected yet (then it goes out when one connects) */
  everywhere(topic, text) {
    let sent = false;
    for (const l of this.hub ? this.hub.links : []) if (l.publish(topic, text, true)) sent = true;
    return sent;
  }
  sendRequest(code) {
    if (!this.everywhere(mailTopic(code, myFriendCode()), this.requestMsg(code))) return;
    const p = profile();
    if ((p.mailOut || []).includes(code)) { p.mailOut = p.mailOut.filter(c => c !== code); save(); }
  }
  /** delete a request in our mailbox (answered or ignored) */
  clearMail(code) { this.clears.add(code); this.everywhere(mailTopic(myFriendCode(), code), ''); }
  /** delete our request from their mailbox (we removed them) */
  withdraw(code) {
    if (!this.everywhere(mailTopic(code, myFriendCode()), '')) return;
    const p = profile();
    p.mailGone = (p.mailGone || []).filter(c => c !== code);
    save();
  }
  /** a server just connected: (re)send whatever is waiting */
  flushMail(link) {
    if (!link.ready || !this.hub || !this.hub.links.has(link)) return;
    const me = myFriendCode(), p = profile(), out = new Set(p.mailOut || []), gone = p.mailGone || [];
    for (const f of friends()) if (f.pending || out.has(f.code)) link.publish(mailTopic(f.code, me), this.requestMsg(f.code), true);
    for (const c of gone) link.publish(mailTopic(c, me), '', true);
    for (const c of this.clears) link.publish(mailTopic(me, c), '', true);
    if (out.size || gone.length) { p.mailOut = []; p.mailGone = []; save(); }
  }
  /** a request in our mailbox (on connecting we get every one that is waiting) */
  mail(topic, text) {
    if (!text) return;                       // a request that was just deleted
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || m.type !== 'req') return;
    const code = cleanFriendCode(topic.slice(topic.lastIndexOf('/') + 1));
    if (code.length !== 8 || code !== cleanFriendCode(m.code) || code === myFriendCode()) return;
    const name = cleanName(m.name);
    // already friends: they said yes to our request (or you both added each other)
    if (isFriend(code)) { markMutual(code, name); this.clearMail(code); return; }
    if ((profile().ignored || []).includes(code)) { this.clearMail(code); return; }
    if (noteRequest(code, name, m.at)) emit('request', { code, name });
  }

  /** Is this friend online right now? (quiet: don't show "checking" again for someone already known) */
  check(code, quiet) {
    const s = this.status.get(code);
    if (!quiet || !s) this.setStatus(code, 'checking');
    return this.talk(code, { ...this.hello(), added: isFriend(code) }, 9000, true)
      .then(({ reply, conn }) => {
        if (reply && reply.type === 'hi') { rename(code, reply.name); if (reply.added) markMutual(code, reply.name); this.setStatus(code, reply.busy ? 'busy' : 'online'); }
        setTimeout(() => { try { conn.close(); } catch { } }, 200);
      })
      .catch(why => { if (why !== 'superseded') this.setStatus(code, 'offline'); });
  }
  checkAll() {
    [...friends(), ...recentPlayers()].forEach((f, k) => setTimeout(() => this.check(f.code, true), k * 350));
  }
  /** Keep checking while a friends list is showing. Returns a stop function. */
  watch() {
    this.start().then(() => this.checkAll());
    clearInterval(this.timer);
    this.timer = setInterval(() => this.checkAll(), CHECK_EVERY);
    return () => { clearInterval(this.timer); this.timer = null; };
  }

  /**
   * Invite a friend into room `room`. Resolves 'yes' | 'no' | 'busy' | 'offline'.
   * The returned promise has .cancel() to withdraw the invite (e.g. when you leave the lobby).
   */
  invite(code, room) {
    let conn = null, cancelled = false;
    const p = this.talk(code, { ...this.hello(), type: 'invite', room }, 8000)
      .then(({ reply, conn: c }) => {
        conn = c;
        if (reply && reply.type === 'invite-reply') return reply.answer;
        // they got it: wait for their answer
        return new Promise(resolve => {
          const t = setTimeout(() => resolve('no'), INVITE_WAIT);
          c.on('data', d => { if (d && d.type === 'invite-reply') { clearTimeout(t); resolve(d.answer); } });
          c.on('close', () => { clearTimeout(t); resolve(cancelled ? 'cancelled' : 'no'); });
        });
      })
      .catch(() => 'offline')
      .then(ans => { setTimeout(() => { try { conn && conn.close(); } catch { } }, 400); if (ans === 'yes' || ans === 'busy') this.setStatus(code, ans === 'busy' ? 'busy' : 'online'); else if (ans === 'offline') this.setStatus(code, 'offline'); return ans; });
    p.cancel = () => { cancelled = true; try { conn && conn.open && conn.send({ type: 'invite-cancel' }); } catch { } };
    return p;
  }

  /** Someone reached our presence peer. */
  incoming(conn) {
    conn.on('data', m => {
      if (!m || typeof m !== 'object') return;
      const code = cleanFriendCode(m.code), name = cleanName(m.name);
      if (code.length !== 8 || code === myFriendCode()) return;
      if (isFriend(code)) { rename(code, name); this.setStatus(code, 'online'); }
      else if (recentPlayers().some(r => r.code === code)) this.setStatus(code, 'online');
      if (m.type === 'hello') {
        conn.send({ type: 'hi', v: 1, code: myFriendCode(), name: profile().name, busy: !!busyCheck(), added: isFriend(code) });
        // someone added us: it goes in the friend requests (with a pop-up the first time)
        if (m.added && isFriend(code)) markMutual(code, name);
        else if (m.added && noteRequest(code, name)) emit('request', { code, name });
      } else if (m.type === 'invite') {
        if (busyCheck()) { conn.send({ type: 'invite-reply', answer: 'busy' }); return; }
        const room = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (room.length < 4) return;
        conn.send({ type: 'invite-ack' });
        let answered = false;
        const respond = answer => {
          if (answered) return; answered = true;
          try { conn.send({ type: 'invite-reply', answer }); } catch { }
          if (answer === 'yes' && !isFriend(code)) addFriend(code, name);
        };
        const inv = { code, name, room, respond, withdrawn: false };
        setTimeout(() => { if (!answered) { respond('no'); emit('invite-gone', inv); } }, INVITE_WAIT - 3000);
        conn.on('close', () => { if (!answered) { answered = true; inv.withdrawn = true; emit('invite-gone', inv); } });
        conn.on('data', d => { if (d && d.type === 'invite-cancel' && !answered) { answered = true; inv.withdrawn = true; emit('invite-gone', inv); } });
        emit('invite', inv);
      }
    });
  }
}
export const presence = new Presence();

/** Call once at startup: you stay reachable while the game is open once you have friends or have played online. */
export function initFriends() {
  myFriendCode();
  const p = profile();
  if (friends().length || recentPlayers().length || p.friendsOn || friendRequests().length || (p.mailOut || []).length || (p.mailGone || []).length) presence.start();
}
/** Opening Battle a Friend makes you reachable (now and on later visits): friends see you online and can invite you. */
export function beReachable() {
  const p = profile();
  if (!p.friendsOn) { p.friendsOn = true; save(); }
  return presence.start();
}
