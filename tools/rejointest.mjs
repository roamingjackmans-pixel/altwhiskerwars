// A guest whose old socket is still "open" (stale) can rejoin with the same player id and keeps their slot.
//   node tools/rejointest.mjs [ws://localhost:8080/ws]   (server must be running)
import WebSocket from 'ws';
const url = process.argv[2] || 'ws://localhost:8080/ws';
const open = () => new Promise((res, rej) => { const w = new WebSocket(url); w.on('open', () => res(w)); w.on('error', rej); });
const next = (w, pred) => new Promise(res => { const h = raw => { const m = JSON.parse(raw); if (pred(m)) { w.off('message', h); res(m); } }; w.on('message', h); });
const host = await open(), g1 = await open(), g2 = await open(), other = await open();
host.send(JSON.stringify({ t: 'host' }));
const { code } = await next(host, m => m.t === 'hosted');
g1.send(JSON.stringify({ t: 'join', code, pid: 'player-A' })); const j1 = await next(g1, m => m.t === 'joined');
other.send(JSON.stringify({ t: 'join', code, pid: 'someone-else' }));
console.log('another player joins too ->', (await next(other, m => m.t === 'joined')).slot);
g2.send(JSON.stringify({ t: 'join', code, pid: 'player-A' }));
const j2 = await next(g2, m => m.t === 'joined');
console.log('same player rejoining ->', j2.t, 'slot', j2.slot, j2.slot === j1.slot ? '(same slot)' : '(DIFFERENT SLOT)');
const got = next(g2, m => m.t === 'msg');
host.send(JSON.stringify({ t: 'msg', d: 'hello again', to: j2.slot }));
console.log('new socket receives ->', (await got).d);
[host, g1, g2, other].forEach(w => w.close());
process.exit(j2.slot === j1.slot ? 0 : 1);
