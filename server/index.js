// Whisker Wars server: serves the game files and relays real-time messages
// between two players in a room (matched by a short room code).
// Run:  npm install && npm start      (PORT env var supported, default 8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8080;
const VERSION = '1.0.0';
const CODE_ALPHABET = '0123456789'; // room codes are 5 digits

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

/** code -> { host, guests: Map(seat 1-3 -> socket), created } */
const rooms = new Map();
let totalConnections = 0;

function newCode() {
  for (let n = 0; n < 1000; n++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += i === 0 ? String(1 + Math.floor(Math.random() * 9)) : CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; // never starts with 0
    if (!rooms.has(c)) return c;
  }
  throw new Error('no codes left');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, name: 'whisker-wars', version: VERSION, rooms: rooms.size, players: wss.clients.size }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // unknown paths fall back to the app (so /?room=CODE style links always work)
      if (!path.extname(rel)) return sendFile(res, path.join(PUBLIC, 'index.html'), req.method);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    sendFile(res, file, req.method);
  });
});

function sendFile(res, file, method) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400',
  });
  if (method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

const MAX_GUESTS = 3; // rooms hold up to 4 players

function leaveRoom(ws) {
  const code = ws.room;
  if (!code) return;
  const room = rooms.get(code);
  ws.room = null;
  if (!room) return;
  if (room.host === ws) {
    for (const g of room.guests.values()) { send(g, { t: 'peer-leave', slot: 0 }); g.room = null; }
    rooms.delete(code);
  } else if (room.guests.get(ws.slot) === ws) {
    room.guests.delete(ws.slot);
    send(room.host, { t: 'peer-leave', slot: ws.slot });
  }
}

wss.on('connection', (ws, req) => {
  totalConnections++;
  ws.isAlive = true;
  ws.room = null;
  ws.msgBudget = 200;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    if (--ws.msgBudget < 0) return; // flood protection (refilled every second)
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'host': {
        leaveRoom(ws);
        const code = newCode();
        rooms.set(code, { host: ws, guests: new Map(), created: Date.now() });
        ws.room = code;
        send(ws, { t: 'hosted', code });
        break;
      }
      case 'join': {
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', code: 'notfound', msg: 'Room not found' });
        if (room.host === ws) return send(ws, { t: 'error', code: 'self', msg: 'That is your own room' });
        const pid = String(m.pid || '').slice(0, 32);
        // the same player reconnecting takes back their seat and replaces their stale connection
        let slot = 0;
        for (const [s, g] of room.guests) if (pid && g.pid === pid && g !== ws) { slot = s; g.room = null; try { g.terminate(); } catch {} room.guests.delete(s); }
        if (!slot) {
          for (let s = 1; s <= MAX_GUESTS && !slot; s++) if (!room.guests.has(s)) slot = s;
          if (!slot) return send(ws, { t: 'error', code: 'full', msg: 'Room is full' });
        }
        leaveRoom(ws);
        room.guests.set(slot, ws);
        ws.room = code;
        ws.slot = slot;
        ws.pid = pid;
        send(ws, { t: 'joined', code, slot });
        send(room.host, { t: 'peer-join', slot });
        break;
      }
      case 'msg': {
        const room = rooms.get(ws.room);
        if (!room) return;
        if (room.host === ws) {
          // host -> one guest (to = seat) or everyone
          const out = JSON.stringify({ t: 'msg', d: m.d, from: 0 });
          if (m.to) { const g = room.guests.get(m.to); if (g && g.readyState === 1) g.send(out); }
          else for (const g of room.guests.values()) if (g.readyState === 1) g.send(out);
        } else if (room.host && room.host.readyState === 1) room.host.send(JSON.stringify({ t: 'msg', d: m.d, from: ws.slot }));
        break;
      }
      case 'leave': leaveRoom(ws); break;
      case 'ping': send(ws, { t: 'pong', ts: m.ts }); break;
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

// heartbeat + budget refill + stale room cleanup
setInterval(() => {
  for (const ws of wss.clients) ws.msgBudget = 200;
}, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.guests.size && now - room.created > 3 * 3600 * 1000) { try { room.host.close(); } catch {} rooms.delete(code); }
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`\n  🐱 Whisker Wars server running`);
  console.log(`     Game:   http://localhost:${PORT}/`);
  console.log(`     Health: http://localhost:${PORT}/api/health\n`);
});
