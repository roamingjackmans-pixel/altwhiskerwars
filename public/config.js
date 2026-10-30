// Whisker Wars connection settings.
//
// server:
//   'auto'  -> if this website is running the included Node server, use it;
//              otherwise connect players directly (peer-to-peer, works on ANY static host).
//   'p2p'   -> always use peer-to-peer.
//   'wss://your-server.example.com/ws' -> always use that relay server
//              (lets you put the game files on a static host and the server elsewhere).
//
// iceServers (optional): extra STUN/TURN servers for peer-to-peer mode, e.g.
//   [{ urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }]
window.WW_CONFIG = {
  server: 'auto',
  peerPrefix: 'whiskerwars-v1-',
  iceServers: null,
};
