// Relay test: a host and up to three guests; messages to everyone, to one guest, and back. (server must be running)
//   node tools/relaytest.mjs [ws://localhost:8080/ws]
import WebSocket from 'ws';
const url = process.argv[2] || 'ws://localhost:8080/ws';
const open = () => new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); });
const next = (w, pred, ms = 3000) => new Promise((res, rej) => { const t = setTimeout(() => { w.off('message', h); rej(new Error('timeout')); }, ms); const h = raw => { const m = JSON.parse(raw); if (pred(m)) { clearTimeout(t); w.off('message', h); res(m); } }; w.on('message', h); });
const none = (w, pred, ms = 300) => next(w, pred, ms).then(() => false, () => true);
const check = (label, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) process.exitCode = 1; };

const host = await open();
host.send(JSON.stringify({ t: 'host' }));
const { code } = await next(host, m => m.t === 'hosted');
check(`room code ${code} is 5 digits`, /^\d{5}$/.test(code));
const stranger = await open();
stranger.send(JSON.stringify({ t: 'join', code: '00000' }));
check('a wrong code is not found', (await next(stranger, m => m.t === 'error')).code === 'notfound');

const guests = [];
for (let k = 1; k <= 3; k++) {
  const g = await open();
  const pj = next(host, m => m.t === 'peer-join');
  g.send(JSON.stringify({ t: 'join', code, pid: 'p' + k }));
  const j = await next(g, m => m.t === 'joined');
  check(`guest ${k} joins in slot ${j.slot}`, j.slot === k && (await pj).slot === k);
  guests.push(g);
}
const fifth = await open();
fifth.send(JSON.stringify({ t: 'join', code, pid: 'p5' }));
check('a 5th player finds the room full', (await next(fifth, m => m.t === 'error')).code === 'full');

const all = guests.map(g => next(g, m => m.t === 'msg'));
host.send(JSON.stringify({ t: 'msg', d: { type: 'snap', s: { t: 1.5 } } }));
check('a host message reaches all three guests', (await Promise.all(all)).every(m => m.d.s.t === 1.5));
const toTwo = next(guests[1], m => m.t === 'msg');
const notOne = none(guests[0], m => m.t === 'msg'), notThree = none(guests[2], m => m.t === 'msg');
host.send(JSON.stringify({ t: 'msg', d: { type: 'start' }, to: 2 }));
check('a message for slot 2 reaches only guest 2', (await toTwo).d.type === 'start' && await notOne && await notThree);
const back = next(host, m => m.t === 'msg');
guests[2].send(JSON.stringify({ t: 'msg', d: { type: 'cmd', c: { k: 'send' } } }));
const bm = await back;
check('a guest message reaches the host tagged with its slot', bm.from === 3 && bm.d.type === 'cmd');
const left = next(host, m => m.t === 'peer-leave');
guests[1].close();
check('the host hears that slot 2 left', (await left).slot === 2);
const rejoin = await open();
rejoin.send(JSON.stringify({ t: 'join', code, pid: 'p6' }));
check('a new player can take the free slot', (await next(rejoin, m => m.t === 'joined')).slot === 2);
const bye = [guests[0], guests[2], rejoin].map(g => next(g, m => m.t === 'peer-leave'));
host.close();
check('everyone hears when the host leaves', (await Promise.all(bye)).length === 3);
[stranger, fifth, ...guests, rejoin].forEach(w => { try { w.close(); } catch { } });
console.log(process.exitCode ? 'relay test FAILED' : 'OK');
process.exit(process.exitCode || 0);
