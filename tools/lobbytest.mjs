// In-memory test of the lobby/session protocol (no network): node tools/lobbytest.mjs
// A host and up to three guests on a fake hub that behaves like the relay: guests are numbered by slot,
// the host can message one guest or all of them.
import { OnlineSession } from '../public/js/online.js';

class Hub {
  constructor() { this.guests = new Map(); }
  hostEnd() { const h = this.host = new End(this, 0); return h; }
  guestEnd(pid) { const slot = [1, 2, 3].find(s => !this.guests.has(s)); const g = new End(this, slot, pid || 'player-' + (++Hub.n)); this.guests.set(slot, g); setTimeout(() => this.host.emit('peer-join', slot), 0); return g; }
}
Hub.n = 0;
class End {
  // (every fake player shares this process's saved profile, so each end gives its hello its own player id)
  constructor(hub, slot, pid) { this.hub = hub; this.slot = slot; this.pid = pid; this.h = {}; this.kind = 'test'; }
  on(e, f) { (this.h[e] ||= []).push(f); }
  emit(e, ...a) { (this.h[e] || []).forEach(f => f(...a)); }
  send(m, to) {
    const d = JSON.parse(JSON.stringify(m));
    if (d.type === 'hello' && d.p) d.p.id = this.pid;
    if (this.slot) return setTimeout(() => this.hub.host.emit('message', d, this.slot), 1);
    for (const [s, g] of this.hub.guests) if (!to || to === s) setTimeout(() => g.emit('message', d, 0), 1);
  }
  close() { if (this.slot) { this.hub.guests.delete(this.slot); setTimeout(() => this.hub.host.emit('peer-leave', this.slot), 0); } }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (label, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) process.exitCode = 1; };

const hub = new Hub();
const host = new OnlineSession(hub.hostEnd(), true, '12345');
const g1 = new OnlineSession(hub.guestEnd(), false, '12345');
await wait(20);
check('first guest gets seat 1', g1.me === 1);
check('2-player lobby is full with one guest', host.joined() === 2);
const g2 = new OnlineSession(hub.guestEnd(), false, '12345');
let full = false; g2.on('error', e => { full = /full/i.test(e.message); });
await wait(20);
check('a third player is turned away from a 2-player lobby', full);
g2.close(); await wait(10);

check('host can grow the lobby to 4', host.setSize(4, 'fourcorners'));
await wait(10);
check('guests see the new size and map', g1.lobby.size === 4 && g1.lobby.map === 'fourcorners');
const g3 = new OnlineSession(hub.guestEnd(), false, '12345');
const g4 = new OnlineSession(hub.guestEnd(), false, '12345');
await wait(30);
check('later guests take seats 2 and 3', g3.me === 2 && g4.me === 3);
check('lobby cannot shrink below the players here', host.setSize(3) === false);

g1.setPick({ hero: 'shadow' }); g3.setPick({ hero: 'luna' }); await wait(20);
check('picks land in the right seats', host.lobby.players[1].hero === 'shadow' && host.lobby.players[2].hero === 'luna');
check('cannot start before everyone is ready', !host.canStart());
g1.setReady(true); g3.setReady(true); g4.setReady(true); await wait(20);
check('can start when all three are ready', host.canStart());

let started = 0; for (const g of [g1, g3, g4]) g.on('start', () => started++);
host.markMatch(); host.send({ type: 'start', info: { x: 1 }, snap: { t: 0 } }); await wait(20);
check('everyone gets the start', started === 3);
const cmds = []; host.on('cmd', (c, seat) => cmds.push(seat));
g4.send({ type: 'cmd', c: { k: 'send' } }); g1.send({ type: 'cmd', c: { k: 'send' } }); await wait(20);
check('commands arrive tagged with the sender\'s seat', cmds.join(',') === '3,1');
let snaps = 0; for (const g of [g1, g3, g4]) g.on('snap', () => snaps++);
host.send({ type: 'snap', s: { t: 1 } }); await wait(20);
check('snapshots reach every guest', snaps === 3);

// a guest drops mid-battle and comes back into the same seat
host.inMatch = true;
let leftSeat = -1, resumed = -1; host.on('peer-leave', s => { leftSeat = s; }); host.on('guest-resume', s => { resumed = s; });
g3.t.close(); await wait(20);
check('host hears which seat dropped', leftSeat === 2);
const back = new OnlineSession(hub.guestEnd(g3.t.pid), false, '12345');
await wait(30);
check('the returning player gets their seat back', resumed === 2 && back.me === 2);

let emotes = 0; g4.on('lemote', (id, from) => { if (from === 1) emotes++; });
g1.lobbyEmote('meow'); await wait(20);
check('lobby emotes are passed on to the other guests', emotes === 1);
let rr = 0; for (const s of [host, g1, g4]) s.on('rematch-request', () => rr++);
g1.toLobby(); await wait(20);
check('a rematch request reaches everyone', rr >= 3 && host.lobby.phase === 'lobby');
for (const s of [host, g1, g2, g3, g4, back]) s.close();
console.log(process.exitCode ? '\nlobby test FAILED' : '\nlobby test OK');
