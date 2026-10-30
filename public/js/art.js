// Whisker Wars - procedural art (Canvas 2D). No image files.
// All drawing is vector-ish canvas paths; expensive results are cached in offscreen canvases.
import {
  FURS, FUR_BY_ID, HATS, BUILDINGS, THEMES, HEROES, HERO_BY_ID, CLANS,
  teamColor, WORLD_W, WORLD_H, mulberry32,
} from '../shared/data.js';
import { normalizeObstacles, makeBlockTest, shapeDist } from '../shared/nav.js';

// Battlefield size used by the background and ambient art. Phones in portrait use a tall field.
let AW = WORLD_W, AH = WORLD_H;
export function setArtSize(w, h) { AW = w; AH = h; }

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- utils
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const _rgb = new Map();
function rgb(hex) {
  let v = _rgb.get(hex);
  if (v) return v;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  _rgb.set(hex, v);
  return v;
}
function toHex(r, g, b) {
  const c = x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function shade(hex, amt) { return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt); }
function rgba(hex, a) { const A = rgb(hex); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; }
function isDark(hex) { const [r, g, b] = rgb(hex); return r * 0.3 + g * 0.59 + b * 0.11 < 95; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }
function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); }
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// stroke (outline) then fill: leaves a clean outer outline of width lw/2
function sf(ctx, fill, line, lw) {
  if (line) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.stroke(); }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}
function gloss(ctx, x, y, rx, ry, a = 0.35) {
  const R = Math.max(rx, ry) * 1.25;
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.45, 0, x - rx * 0.25, y - ry * 0.35, R);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - rx * 1.6, y - ry * 1.6, rx * 3.2, ry * 3.2);
}
function underShade(ctx, x, y, rx, ry, a = 0.2) {
  const g = ctx.createLinearGradient(0, y - ry * 0.1, 0, y + ry);
  g.addColorStop(0, 'rgba(40,20,50,0)');
  g.addColorStop(1, `rgba(40,20,50,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(x - rx * 1.6, y - ry * 1.6, rx * 3.2, ry * 3.2);
}
function capsule(ctx, x1, y1, x2, y2, r) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}
function starPath(ctx, x, y, r1, r2, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = rot + i * Math.PI / n;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function sparkle(ctx, x, y, r, col = '#ffffff') {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
}
function blobPath(ctx, x, y, rx, ry, fluffy, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  if (fluffy) {
    const n = 15, r = Math.min(rx, ry) * 0.27;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + 0.2;
      const px = x + Math.cos(a) * rx * 0.94, py = y + Math.sin(a) * ry * 0.94;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU);
    }
  }
}

// ---------------------------------------------------------------- cat palettes
const OUTW = 0.55; // outline half-width in sprite units
const _furPal = new Map();
function furPal(fur) {
  let p = _furPal.get(fur.id);
  if (p) return p;
  const pat = fur.pattern;
  const dk = isDark(fur.base);
  const line = pat === 'gold' ? '#7a5512'
    : (pat === 'void' || pat === 'galaxy') ? '#0b0716'
    : pat === 'tuxedo' ? '#0c0b10'
    : dk ? '#0f0d14' : mix(fur.dark, '#2a1830', 0.55);
  p = {
    fur, pat, base: fur.base, dark: fur.dark, belly: fur.belly, line,
    spot2: fur.spot2 || '#3a3434',
    spotO: pat === 'spots' ? '#f2913f' : fur.dark,
    fluffy: !!fur.fluffy,
    earIn: pat === 'void' ? '#7a4fd0' : pat === 'galaxy' ? '#b48cff' : dk ? '#c47a98' : '#ffadc2',
    eye: '#2b2135',
    glowEye: pat === 'void',
    legFar: pat === 'gold' ? '#d29b1d' : shade(pat === 'points' ? fur.dark : fur.base, -0.16),
    legNear: pat === 'gold' ? '#f0c23a' : pat === 'points' ? fur.dark : fur.base,
    tail: pat === 'points' ? fur.dark : pat === 'gold' ? '#f0c23a' : fur.base,
    isDark: dk,
  };
  _furPal.set(fur.id, p);
  return p;
}
function baseFill(ctx, P, reg) {
  const { x, y, rx, ry } = reg;
  if (P.pat === 'gold') {
    const g = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
    g.addColorStop(0, '#fff3ad'); g.addColorStop(0.45, '#ffd34d'); g.addColorStop(1, '#cf9418');
    return g;
  }
  if (P.pat === 'galaxy') {
    const g = ctx.createRadialGradient(x - rx * 0.2, y - ry * 0.2, 0, x, y, Math.max(rx, ry) * 1.1);
    g.addColorStop(0, '#5d45b8'); g.addColorStop(1, '#22165a');
    return g;
  }
  if (P.pat === 'void') {
    const g = ctx.createRadialGradient(x - rx * 0.2, y - ry * 0.3, 0, x, y, Math.max(rx, ry) * 1.1);
    g.addColorStop(0, '#2d2350'); g.addColorStop(1, '#110c20');
    return g;
  }
  return P.base;
}
function starDots(ctx, x, y, rx, ry, n, seed) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r());
    const px = x + Math.cos(a) * rx * d, py = y + Math.sin(a) * ry * d;
    if (r() < 0.25) sparkle(ctx, px, py, 0.9 + r() * 0.5, 'rgba(255,255,255,0.95)');
    else { circ(ctx, px, py, 0.18 + r() * 0.22); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
  }
}
function furDetails(ctx, P, reg, part, fo, seed) {
  const { x, y, rx, ry } = reg;
  const pat = P.pat;
  if (part === 'body') {
    if (pat === 'tuxedo') {
      ell(ctx, x + 5.4, y + 1.0, 4.4, 4.6); ctx.fillStyle = '#ffffff'; ctx.fill();
      ell(ctx, x + 1.5, y + 3.9, 5.6, 2.4); ctx.fill();
    } else if (P.belly !== P.base && pat !== 'galaxy' && pat !== 'void') {
      ell(ctx, x + 2.4, y + 3.5, 5.9, 2.7); ctx.fillStyle = P.belly; ctx.fill();
    }
    if (pat === 'tabby') {
      ctx.strokeStyle = P.dark; ctx.lineCap = 'round'; ctx.lineWidth = 1.25;
      for (let i = 0; i < 4; i++) {
        const sx = x - 5.6 + i * 3.1;
        ctx.beginPath(); ctx.moveTo(sx - 0.8, y - ry - 0.5); ctx.quadraticCurveTo(sx + 0.9, y - 2.5, sx + 0.2, y + 0.6); ctx.stroke();
      }
    } else if (pat === 'calico') {
      ell(ctx, x - 1.2, y - 2.6, 4.8, 3.4, 0.2); ctx.fillStyle = P.dark; ctx.fill();
      ell(ctx, x - 6.4, y - 0.6, 2.9, 2.8); ctx.fillStyle = P.spot2; ctx.fill();
      ell(ctx, x + 3.4, y - 4.2, 1.8, 1.4); ctx.fill();
    } else if (pat === 'spots') {
      ell(ctx, x - 2.2, y - 2.8, 3.9, 3.0, -0.2); ctx.fillStyle = P.spot2; ctx.fill();
      ell(ctx, x - 6.9, y + 0.2, 2.3, 2.1); ctx.fillStyle = P.spotO; ctx.fill();
    } else if (pat === 'points') {
      const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
      g.addColorStop(0, rgba(P.dark, 0.55)); g.addColorStop(0.45, rgba(P.dark, 0.0));
      ctx.fillStyle = g; ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    } else if (pat === 'galaxy') {
      let g = ctx.createRadialGradient(x - 3, y - 2, 0, x - 3, y - 2, 5.5);
      g.addColorStop(0, 'rgba(255,110,210,0.55)'); g.addColorStop(1, 'rgba(255,110,210,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      g = ctx.createRadialGradient(x + 3.5, y + 1, 0, x + 3.5, y + 1, 4.5);
      g.addColorStop(0, 'rgba(90,210,255,0.45)'); g.addColorStop(1, 'rgba(90,210,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      starDots(ctx, x, y, rx, ry, 9, seed);
    }
  } else if (part === 'head') {
    const fx = x + fo, fy = y + 0.6;
    if (pat === 'tuxedo') {
      ctx.fillStyle = '#ffffff';
      ell(ctx, fx, fy + 3.6, 4.5, 3.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(fx - 1.1, fy + 1.5); ctx.lineTo(fx, fy - 2.6); ctx.lineTo(fx + 1.1, fy + 1.5); ctx.closePath(); ctx.fill();
    } else if (P.belly !== P.base && pat !== 'galaxy' && pat !== 'void' && pat !== 'points') {
      ell(ctx, fx, fy + 3.3, 3.5, 2.4); ctx.fillStyle = P.belly; ctx.fill();
    }
    if (pat === 'tabby') {
      ctx.strokeStyle = P.dark; ctx.lineCap = 'round'; ctx.lineWidth = 0.95;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.moveTo(fx + k * 1.9, y - ry * 1.02); ctx.lineTo(fx + k * 1.35, y - ry * 0.58); ctx.stroke();
      }
      for (const s of [-1, 1]) {
        const ex = x + s * rx;
        ctx.beginPath(); ctx.moveTo(ex, fy + 0.4); ctx.lineTo(ex - s * 2.2, fy + 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, fy + 2.0); ctx.lineTo(ex - s * 1.8, fy + 2.1); ctx.stroke();
      }
    } else if (pat === 'calico') {
      ell(ctx, x - rx * 0.62, y - ry * 0.6, 4.4, 3.8, 0.3); ctx.fillStyle = P.spot2; ctx.fill();
      ell(ctx, x + rx * 0.72, y - ry * 0.55, 3.0, 2.7); ctx.fillStyle = P.dark; ctx.fill();
    } else if (pat === 'spots') {
      ell(ctx, x + rx * 0.62, y - ry * 0.62, 3.8, 3.3); ctx.fillStyle = P.spotO; ctx.fill();
      ell(ctx, x - rx * 0.8, y - ry * 0.75, 2.2, 2.0); ctx.fillStyle = P.spot2; ctx.fill();
    } else if (pat === 'points') {
      const g = ctx.createRadialGradient(fx, fy + 2.2, 0, fx, fy + 2.2, 6.4);
      g.addColorStop(0, rgba(P.dark, 0.95)); g.addColorStop(0.55, rgba(P.dark, 0.6)); g.addColorStop(1, rgba(P.dark, 0));
      ctx.fillStyle = g; ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    } else if (pat === 'galaxy') {
      const g = ctx.createRadialGradient(x - 3, y - 3, 0, x - 3, y - 3, 6);
      g.addColorStop(0, 'rgba(255,120,220,0.45)'); g.addColorStop(1, 'rgba(255,120,220,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      starDots(ctx, x - 1, y - 2.5, rx * 0.8, ry * 0.5, 6, seed + 7);
    }
  } else if (part === 'leg') {
    if (pat === 'tabby') {
      ctx.strokeStyle = P.dark; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x - 2, y - 0.6); ctx.lineTo(x + 2, y - 0.9); ctx.stroke();
    }
  }
}
function furPart(ctx, P, path, reg, part, fo = 1.4, seed = 1) {
  path(); ctx.lineJoin = 'round'; ctx.lineWidth = OUTW * 2; ctx.strokeStyle = P.line; ctx.stroke();
  path(); ctx.fillStyle = baseFill(ctx, P, reg); ctx.fill();
  ctx.save(); path(); ctx.clip();
  furDetails(ctx, P, reg, part, fo, seed);
  gloss(ctx, reg.x, reg.y, reg.rx, reg.ry, P.isDark ? 0.22 : 0.4);
  underShade(ctx, reg.x, reg.y, reg.rx, reg.ry, P.isDark ? 0.28 : 0.17);
  if (P.pat === 'void') { path(); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(176,120,255,0.6)'; ctx.stroke(); }
  if (P.pat === 'gold') {
    ell(ctx, reg.x - reg.rx * 0.25, reg.y - reg.ry * 0.35, reg.rx * 0.55, reg.ry * 0.16, -0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- cat parts
function earPath(ctx, hx, hy, rx, ry, a, len, spread, k = 0.8) {
  const tx = hx + Math.cos(a) * (rx + len), ty = hy + Math.sin(a) * (ry + len);
  const b1x = hx + Math.cos(a - spread) * rx * k, b1y = hy + Math.sin(a - spread) * ry * k;
  const b2x = hx + Math.cos(a + spread) * rx * k, b2y = hy + Math.sin(a + spread) * ry * k;
  const q = 0.24;
  ctx.beginPath(); ctx.moveTo(b1x, b1y);
  ctx.lineTo(tx + (b1x - tx) * q, ty + (b1y - ty) * q);
  ctx.quadraticCurveTo(tx, ty, tx + (b2x - tx) * q, ty + (b2y - ty) * q);
  ctx.lineTo(b2x, b2y); ctx.closePath();
}
function earColor(P, i) {
  if (P.pat === 'points') return P.dark;
  if (P.pat === 'calico') return i === 0 ? P.spot2 : P.dark;
  if (P.pat === 'spots') return i === 1 ? P.spotO : P.base;
  if (P.pat === 'gold') return '#f3c43c';
  if (P.pat === 'galaxy') return '#3a2a80';
  if (P.pat === 'void') return '#1d1630';
  return P.base;
}
// Draw a cat head (with ears + face). o: {rx, ry, faceOff, ears:[a,a], eyesClosed, lashes, chubby, seed}
function drawCatHead(ctx, P, hx, hy, o = {}) {
  const rx = o.rx || 7.9, ry = o.ry || 7.2, fo = o.faceOff ?? 1.4;
  const ears = o.ears || [-2.06, -0.96];
  ears.forEach((a, i) => {
    earPath(ctx, hx, hy, rx, ry, a, 4.7, 0.44);
    sf(ctx, earColor(P, i), P.line, OUTW * 2);
    earPath(ctx, hx, hy, rx * 0.9, ry * 0.9, a, 2.6, 0.24, 0.92);
    ctx.fillStyle = P.earIn; ctx.fill();
  });
  const path = () => blobPath(ctx, hx, hy, rx, ry, P.fluffy);
  furPart(ctx, P, path, { x: hx, y: hy, rx, ry }, 'head', fo, (o.seed || 3) + 11);
  drawFace(ctx, P, hx + fo, hy + 0.6, o);
}
function drawFace(ctx, P, fx, fy, o = {}) {
  const es = o.eyeScale || 1;
  // blush
  ctx.fillStyle = 'rgba(255,110,150,0.42)';
  ell(ctx, fx - 4.7, fy + 2.4, 1.45, 0.85); ctx.fill();
  ell(ctx, fx + 4.7, fy + 2.4, 1.45, 0.85); ctx.fill();
  for (const s of [-1, 1]) {
    const ex = fx + s * 3.05, ey = fy - 0.7;
    if (o.eyesClosed) {
      ctx.beginPath(); ctx.arc(ex, ey - 0.2, 1.3, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.strokeStyle = P.isDark ? '#d9cfe8' : '#2b2135'; ctx.lineWidth = 0.55; ctx.lineCap = 'round'; ctx.stroke();
      continue;
    }
    if (P.glowEye) {
      ctx.save(); ctx.shadowColor = '#b77cff'; ctx.shadowBlur = 2.5;
      ell(ctx, ex, ey, 1.6 * es, 2.0 * es); ctx.fillStyle = '#c99bff'; ctx.fill(); ctx.restore();
      ell(ctx, ex, ey, 0.42 * es, 1.45 * es); ctx.fillStyle = '#2a0a40'; ctx.fill();
    } else {
      ell(ctx, ex, ey, 1.55 * es, 1.95 * es); ctx.fillStyle = P.eye; ctx.fill();
      if (P.isDark) { ell(ctx, ex, ey, 1.55 * es, 1.95 * es); ctx.strokeStyle = 'rgba(255,230,120,0.55)'; ctx.lineWidth = 0.35; ctx.stroke(); }
    }
    circ(ctx, ex + 0.52 * es, ey - 0.72 * es, 0.62 * es); ctx.fillStyle = '#ffffff'; ctx.fill();
    circ(ctx, ex - 0.45 * es, ey + 0.68 * es, 0.3 * es); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    if (o.lashes) {
      ctx.strokeStyle = '#2b2135'; ctx.lineWidth = 0.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex + s * 1.3, ey - 1.4); ctx.lineTo(ex + s * 2.3, ey - 2.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + s * 0.5, ey - 1.9); ctx.lineTo(ex + s * 1.0, ey - 3.0); ctx.stroke();
    }
  }
  // nose
  ctx.beginPath(); ctx.moveTo(fx - 0.85, fy + 1.75); ctx.lineTo(fx + 0.85, fy + 1.75); ctx.lineTo(fx, fy + 2.7); ctx.closePath();
  ctx.fillStyle = '#ff8aa3'; ctx.fill();
  // mouth
  ctx.strokeStyle = P.isDark ? '#d9cfe8' : rgba(P.line, 0.85); ctx.lineWidth = 0.45; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fx, fy + 2.7); ctx.quadraticCurveTo(fx - 0.2, fy + 3.6, fx - 1.0, fy + 3.4);
  ctx.moveTo(fx, fy + 2.7); ctx.quadraticCurveTo(fx + 0.2, fy + 3.6, fx + 1.0, fy + 3.4); ctx.stroke();
  // whiskers
  ctx.strokeStyle = P.isDark ? 'rgba(230,225,240,0.75)' : rgba(P.line, 0.5); ctx.lineWidth = 0.32;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(fx + s * 5.2, fy + 2.0); ctx.lineTo(fx + s * 9.4, fy + 1.1);
    ctx.moveTo(fx + s * 5.2, fy + 2.8); ctx.lineTo(fx + s * 9.5, fy + 3.3);
    ctx.stroke();
  }
}
function drawTail(ctx, P, x0, y0, sw) {
  const path = () => {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 - 5, y0 + 0.6, x0 - 8.2 + sw, y0 - 4, x0 - 6 + sw * 1.4, y0 - 10.6);
  };
  const w = P.fluffy ? 4.4 : 3.0;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = P.line; ctx.lineWidth = w + OUTW * 2; ctx.stroke();
  path(); ctx.strokeStyle = P.pat === 'galaxy' ? '#3d2c86' : P.pat === 'void' ? '#1d1630' : P.tail; ctx.lineWidth = w; ctx.stroke();
  if (P.pat === 'tabby') {
    ctx.setLineDash([1.2, 1.7]); path(); ctx.strokeStyle = P.dark; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]);
  } else if (P.pat === 'calico' || P.pat === 'spots') {
    circ(ctx, x0 - 6 + sw * 1.4, y0 - 10.4, w * 0.55); ctx.fillStyle = P.pat === 'calico' ? P.spot2 : P.spotO; ctx.fill();
  } else if (P.pat === 'tuxedo') {
    circ(ctx, x0 - 6 + sw * 1.4, y0 - 10.4, w * 0.5); ctx.fillStyle = '#ffffff'; ctx.fill();
  } else if (P.pat === 'galaxy') {
    circ(ctx, x0 - 4, y0 - 2.5, 0.3); ctx.fillStyle = '#fff'; ctx.fill();
    circ(ctx, x0 - 6.2 + sw, y0 - 7, 0.35); ctx.fill();
  } else if (P.pat === 'void') {
    path(); ctx.strokeStyle = 'rgba(176,120,255,0.45)'; ctx.lineWidth = w * 0.35; ctx.stroke();
  }
  ctx.save(); ctx.translate(-0.35, -0.45);
  path(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = w * 0.3; ctx.stroke();
  ctx.restore();
}
function drawLeg(ctx, P, x, topY, s, far) {
  const fx = x + s, fy = -1.25;
  const path = () => {
    capsule(ctx, x, topY, fx, fy, 1.45);
    ctx.moveTo(fx + 0.5 + 1.95, fy + 0.2); ctx.ellipse(fx + 0.5, fy + 0.2, 1.95, 1.2, 0, 0, TAU);
  };
  path(); ctx.lineJoin = 'round'; ctx.lineWidth = OUTW * 2; ctx.strokeStyle = P.line; ctx.stroke();
  path(); ctx.fillStyle = far ? P.legFar : P.legNear; ctx.fill();
  if (P.pat === 'tuxedo' || P.pat === 'calico' || P.pat === 'spots') {
    ell(ctx, fx + 0.5, fy + 0.15, 1.75, 1.05); ctx.fillStyle = far ? '#e4e0ea' : '#ffffff'; ctx.fill();
  }
  if (P.pat === 'galaxy') { ell(ctx, fx + 0.5, fy + 0.2, 1.75, 1.05); ctx.fillStyle = far ? '#2c2066' : '#3d2c86'; ctx.fill(); }
  if (P.pat === 'void') { ell(ctx, fx + 0.5, fy + 0.2, 1.75, 1.05); ctx.fillStyle = far ? '#140f24' : '#1d1630'; ctx.fill(); }
}
function drawScarf(ctx, owner, hx, hy, front = false) {
  if (owner == null || owner < 0) return;
  const c = teamColor(owner);
  const line = mix(c.dark, '#1a1020', 0.45);
  if (front) {
    circ(ctx, hx + 1.6, hy + 8.3, 0.95); sf(ctx, '#ffd447', '#7a4d10', 0.55);
    circ(ctx, hx + 1.35, hy + 8.0, 0.32); ctx.fillStyle = '#fff6c4'; ctx.fill();
    return;
  }
  // flowing tails behind the neck
  const nx = hx - 4.6, ny = hy + 5.6;
  ctx.beginPath();
  ctx.moveTo(nx + 0.6, ny - 0.8);
  ctx.quadraticCurveTo(nx - 3.0, ny - 0.4, nx - 5.6, ny + 2.2);
  ctx.lineTo(nx - 4.9, ny + 3.0); ctx.lineTo(nx - 3.9, ny + 2.5);
  ctx.quadraticCurveTo(nx - 2.0, ny + 1.3, nx + 1.0, ny + 1.4);
  ctx.closePath();
  sf(ctx, c.dark, line, OUTW * 2);
  ctx.beginPath();
  ctx.moveTo(nx + 0.4, ny + 0.2);
  ctx.quadraticCurveTo(nx - 1.8, ny + 2.0, nx - 3.2, ny + 4.4);
  ctx.lineTo(nx - 2.0, ny + 4.6);
  ctx.quadraticCurveTo(nx - 0.8, ny + 2.8, nx + 1.4, ny + 1.6);
  ctx.closePath();
  sf(ctx, c.main, line, OUTW * 2);
  // collar: only the part under the chin stays visible once the head is drawn
  ell(ctx, hx + 0.4, hy + 2.6, 7.2, 6.5);
  sf(ctx, c.main, line, OUTW * 2);
  ctx.save(); ell(ctx, hx + 0.4, hy + 2.6, 7.2, 6.5); ctx.clip();
  ell(ctx, hx + 0.4, hy + 9.6, 6.5, 1.0); ctx.fillStyle = c.dark; ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- hats
// (hx,hy) = head center, head ry ~7.2. Units = sprite/world units.
function drawHat(ctx, id, hx, hy) {
  if (!id || id === 'none') return;
  const L = OUTW * 2;
  ctx.save();
  switch (id) {
    case 'bow': {
      ctx.translate(hx + 5.0, hy - 5.8); ctx.rotate(0.45);
      const c = '#ff5f9e', d = '#9a2257';
      ctx.beginPath(); ctx.moveTo(-0.6, 0.4); ctx.lineTo(-1.8, 3.6); ctx.lineTo(-0.4, 3.0); ctx.lineTo(0.2, 3.9); ctx.lineTo(0.6, 0.4); ctx.closePath(); sf(ctx, '#e8478a', d, L);
      ell(ctx, -2.4, -0.2, 2.5, 1.7, -0.25); sf(ctx, c, d, L);
      ell(ctx, 2.4, -0.2, 2.5, 1.7, 0.25); sf(ctx, c, d, L);
      ell(ctx, -2.6, -0.6, 1.3, 0.5, -0.25); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      ell(ctx, 2.2, -0.6, 1.3, 0.5, 0.25); ctx.fill();
      circ(ctx, 0, -0.1, 1.05); sf(ctx, '#ff86b6', d, L);
      break;
    }
    case 'party': {
      ctx.translate(hx + 1.2, hy - 6.5); ctx.rotate(0.18);
      const path = () => { ctx.beginPath(); ctx.moveTo(-3.6, 0.8); ctx.quadraticCurveTo(0, 1.8, 3.6, 0.8); ctx.lineTo(0.5, -9.6); ctx.closePath(); };
      path(); sf(ctx, '#45c6ff', '#1f3c78', L);
      ctx.save(); path(); ctx.clip();
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.3;
      for (let k = -12; k < 6; k += 3.1) { ctx.beginPath(); ctx.moveTo(-5, k + 5); ctx.lineTo(5, k); ctx.stroke(); }
      gloss(ctx, -1, -3, 3, 5, 0.45);
      ctx.restore();
      for (let k = 0; k < 3; k++) { circ(ctx, -2.4 + k * 2.4, 0.9, 0.55); ctx.fillStyle = ['#ff6fa8', '#ffe066', '#7cf08a'][k]; ctx.fill(); }
      circ(ctx, 0.5, -10, 1.55); sf(ctx, '#ff6fa8', '#8f2352', L);
      circ(ctx, 0.0, -10.5, 0.5); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      break;
    }
    case 'beanie': {
      ctx.translate(hx + 0.6, hy - 3.2); ctx.rotate(0.06);
      const c = '#4fc3a1', d = '#1d6b57';
      // ear bumps
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 2.4, -5.2); ctx.quadraticCurveTo(s * 5.4, -10.8, s * 6.2, -9.4); ctx.quadraticCurveTo(s * 6.9, -6.0, s * 6.4, -3.4); ctx.closePath(); sf(ctx, c, d, L); }
      const dome = () => { ctx.beginPath(); ctx.moveTo(-7.0, 1.0); ctx.bezierCurveTo(-7.4, -9.2, 7.4, -9.2, 7.0, 1.0); ctx.closePath(); };
      dome(); sf(ctx, c, d, L);
      ctx.save(); dome(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.55;
      for (let k = -6; k <= 6; k += 1.6) { ctx.beginPath(); ctx.moveTo(k, 1); ctx.quadraticCurveTo(k * 0.8, -4, k * 0.25, -8); ctx.stroke(); }
      gloss(ctx, -1.5, -4, 5, 4, 0.4);
      ctx.restore();
      rr(ctx, -7.4, -1.2, 14.8, 3.2, 1.5); sf(ctx, '#fff1e2', d, L);
      ctx.strokeStyle = 'rgba(29,107,87,0.35)'; ctx.lineWidth = 0.4;
      for (let k = -6.5; k <= 6.5; k += 1.3) { ctx.beginPath(); ctx.moveTo(k, -0.9); ctx.lineTo(k, 1.7); ctx.stroke(); }
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; circ(ctx, Math.cos(a) * 1.1, -7.6 + Math.sin(a) * 1.1, 1.2); ctx.fillStyle = '#ffffff'; ctx.fill(); }
      circ(ctx, 0, -7.6, 1.6); sf(ctx, '#ffffff', '#c9c0b6', 0.6);
      break;
    }
    case 'flower': {
      const cols = ['#ff8fb8', '#fff27a', '#ffffff', '#c7a6ff', '#ffb36b'];
      for (let i = 0; i < 6; i++) {
        const a = -2.65 + i * 0.36;
        const fx = hx + Math.cos(a) * 7.4, fy = hy + Math.sin(a) * 6.9;
        ell(ctx, fx + 1.0, fy + 0.6, 1.3, 0.6, 0.6); sf(ctx, '#6fcf5a', '#2f6b2a', 0.6);
      }
      for (let i = 0; i < 5; i++) {
        const a = -2.55 + i * 0.4;
        const fx = hx + Math.cos(a) * 7.5, fy = hy + Math.sin(a) * 7.0;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const pa = k / 5 * TAU; ctx.moveTo(fx + Math.cos(pa) * 1.05 + 1.0, fy + Math.sin(pa) * 1.05); ctx.arc(fx + Math.cos(pa) * 1.05, fy + Math.sin(pa) * 1.05, 1.0, 0, TAU); }
        sf(ctx, cols[i], '#8a4a6a', 0.7);
        circ(ctx, fx, fy, 0.65); ctx.fillStyle = '#ffcf3d'; ctx.fill();
      }
      break;
    }
    case 'wizard': {
      ctx.translate(hx + 0.8, hy - 6.4); ctx.rotate(0.1);
      const c = '#5b4bd6', d = '#241a66';
      ell(ctx, 0, 0.9, 7.6, 1.9); sf(ctx, '#4a3cc0', d, L);
      const cone = () => { ctx.beginPath(); ctx.moveTo(-4.3, 0.6); ctx.quadraticCurveTo(-2.4, -6.2, -6.4, -12.2); ctx.quadraticCurveTo(0.8, -7.5, 4.3, 0.6); ctx.quadraticCurveTo(0, 1.6, -4.3, 0.6); ctx.closePath(); };
      cone(); sf(ctx, c, d, L);
      ctx.save(); cone(); ctx.clip();
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(-6, -1.4, 12, 1.5);
      gloss(ctx, -1.5, -5, 4, 6, 0.35);
      ctx.restore();
      starPath(ctx, -0.6, -4.4, 1.1, 0.45); ctx.fillStyle = '#ffe680'; ctx.fill();
      starPath(ctx, 1.8, -2.4, 0.7, 0.3); ctx.fill();
      starPath(ctx, -3.6, -8.6, 0.75, 0.32); ctx.fill();
      circ(ctx, -6.4, -12.2, 0.8); ctx.fill();
      break;
    }
    case 'pirate': {
      ctx.translate(hx + 0.8, hy - 5.8); ctx.rotate(0.1);
      const p = () => { ctx.beginPath(); ctx.moveTo(-7.2, 0.8); ctx.quadraticCurveTo(-6.8, -3.4, -3.6, -4.6); ctx.quadraticCurveTo(0, -7.6, 3.6, -4.6); ctx.quadraticCurveTo(6.8, -3.4, 7.2, 0.8); ctx.quadraticCurveTo(0, -1.4, -7.2, 0.8); ctx.closePath(); };
      p(); sf(ctx, '#2b2733', '#0d0b10', L);
      ctx.save(); p(); ctx.clip(); gloss(ctx, -2, -4, 5, 3, 0.25); ctx.restore();
      ctx.strokeStyle = '#e8bf4f'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-6.6, 0.1); ctx.quadraticCurveTo(0, -2.0, 6.6, 0.1); ctx.stroke();
      circ(ctx, 0, -3.4, 1.25); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#2b2733'; circ(ctx, -0.45, -3.5, 0.3); ctx.fill(); circ(ctx, 0.45, -3.5, 0.3); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(-1.6, -1.4); ctx.lineTo(1.6, -2.6); ctx.moveTo(1.6, -1.4); ctx.lineTo(-1.6, -2.6); ctx.stroke();
      break;
    }
    case 'cowboy': {
      ctx.translate(hx + 0.8, hy - 6.0); ctx.rotate(0.12);
      rr(ctx, -3.8, -6.0, 7.6, 6.4, 2.4); sf(ctx, '#b0713f', '#4f2a12', L);
      ctx.beginPath(); ctx.moveTo(-1, -6); ctx.quadraticCurveTo(0, -4.6, 1, -6); ctx.strokeStyle = '#6b3e1f'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.fillStyle = '#6b3e1f'; ctx.fillRect(-3.8, -1.8, 7.6, 1.3);
      const brim = () => { ctx.beginPath(); ctx.moveTo(-8.4, -1.4); ctx.quadraticCurveTo(-8.8, -3.4, -7.4, -2.8); ctx.quadraticCurveTo(0, 1.4, 7.4, -2.8); ctx.quadraticCurveTo(8.8, -3.4, 8.4, -1.4); ctx.quadraticCurveTo(0, 3.6, -8.4, -1.4); ctx.closePath(); };
      brim(); sf(ctx, '#c4844f', '#4f2a12', L);
      ctx.save(); brim(); ctx.clip(); gloss(ctx, -2, -1, 6, 2, 0.3); ctx.restore();
      starPath(ctx, 0, -1.15, 0.6, 0.26); ctx.fillStyle = '#ffd447'; ctx.fill();
      break;
    }
    case 'viking': {
      ctx.translate(hx + 0.6, hy - 3.6); ctx.rotate(0.06);
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * 5.0, -1.6); ctx.quadraticCurveTo(s * 10.6, -2.6, s * 10.0, -9.6); ctx.quadraticCurveTo(s * 8.6, -4.8, s * 4.6, -4.4); ctx.closePath();
        sf(ctx, '#f6ecd4', '#6b5a3a', L);
        ctx.beginPath(); ctx.moveTo(s * 9.0, -6.2); ctx.quadraticCurveTo(s * 9.9, -7.6, s * 10.0, -9.6); ctx.strokeStyle = '#cdbb94'; ctx.lineWidth = 0.7; ctx.stroke();
      }
      const dome = () => { ctx.beginPath(); ctx.moveTo(-6.4, 0.6); ctx.arc(0, 0.6, 6.4, Math.PI, 0); ctx.closePath(); };
      dome();
      const g = ctx.createLinearGradient(-6, -6, 6, 1); g.addColorStop(0, '#eef2f6'); g.addColorStop(1, '#7d8794');
      sf(ctx, g, '#2e3440', L);
      ctx.beginPath(); ctx.moveTo(0, -5.8); ctx.lineTo(0, 0.4); ctx.strokeStyle = '#a3acb8'; ctx.lineWidth = 0.9; ctx.stroke();
      rr(ctx, -6.8, -0.8, 13.6, 2.3, 1); sf(ctx, '#b07a3c', '#4f2f12', L);
      ctx.fillStyle = '#ffd56a';
      for (let k = -5; k <= 5; k += 2.5) { circ(ctx, k, 0.35, 0.4); ctx.fill(); }
      break;
    }
    case 'tophat': {
      ctx.translate(hx + 0.8, hy - 6.4); ctx.rotate(0.14);
      ell(ctx, 0, 0.5, 6.3, 1.6); sf(ctx, '#25222b', '#08070a', L);
      rr(ctx, -3.8, -8.8, 7.6, 9.2, 1.0); sf(ctx, '#2c2833', '#08070a', L);
      ctx.fillStyle = '#d6334c'; ctx.fillRect(-3.8, -2.2, 7.6, 1.6);
      ell(ctx, 0, -8.8, 3.8, 1.0); ctx.fillStyle = '#3d3846'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-2.9, -8, 1.0, 5.5);
      break;
    }
    case 'crown': {
      ctx.translate(hx + 0.8, hy - 6.8); ctx.rotate(0.1);
      const p = () => { ctx.beginPath(); ctx.moveTo(-4.8, 0.8); ctx.lineTo(-5.3, -4.6); ctx.lineTo(-2.6, -2.0); ctx.lineTo(0, -6.0); ctx.lineTo(2.6, -2.0); ctx.lineTo(5.3, -4.6); ctx.lineTo(4.8, 0.8); ctx.quadraticCurveTo(0, 1.8, -4.8, 0.8); ctx.closePath(); };
      p();
      const g = ctx.createLinearGradient(0, -6, 0, 1); g.addColorStop(0, '#fff2a0'); g.addColorStop(1, '#e09a16');
      sf(ctx, g, '#7a4d10', L);
      ctx.save(); p(); ctx.clip(); gloss(ctx, -1.5, -3, 4, 3, 0.5); ctx.restore();
      ctx.fillStyle = '#fff6c4';
      circ(ctx, -5.3, -4.6, 0.8); ctx.fill(); circ(ctx, 0, -6.0, 0.85); ctx.fill(); circ(ctx, 5.3, -4.6, 0.8); ctx.fill();
      circ(ctx, -2.5, -0.5, 0.75); ctx.fillStyle = '#ff3d6e'; ctx.fill();
      circ(ctx, 0, -0.4, 0.8); ctx.fillStyle = '#3db6ff'; ctx.fill();
      circ(ctx, 2.5, -0.5, 0.75); ctx.fillStyle = '#3dff8c'; ctx.fill();
      break;
    }
    case 'halo': {
      ctx.translate(hx + 0.6, hy - 12.2);
      ctx.shadowColor = '#fff2a0'; ctx.shadowBlur = 3;
      ell(ctx, 0, 0, 5.4, 1.55); ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.shadowBlur = 0;
      ell(ctx, 0, -0.15, 5.1, 1.35); ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 0.45; ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- full cat
const CAT_GEO = { bx: -2.6, by: -6.9, brx: 8.1, bry: 5.5, hx: 3.7, hy: -15.6 };
function drawCatFigure(ctx, fur, hatId, owner, frame, opt = {}) {
  const P = furPal(fur);
  const bob = (frame & 1) ? -0.75 : 0;
  const sw = [1.7, 0, -1.7, 0][frame];
  const tsw = [-0.7, 0.9, 0.7, -0.9][frame];
  const { brx, bry } = CAT_GEO;
  const bx = CAT_GEO.bx, by = CAT_GEO.by + bob;
  const hx = CAT_GEO.hx, hy = CAT_GEO.hy + bob * 1.15;
  if (opt.shadow !== false) { ell(ctx, -1.4, 0.1, 10.8, 2.5); ctx.fillStyle = 'rgba(35,20,45,0.22)'; ctx.fill(); }
  drawTail(ctx, P, bx - brx + 1.6, by - 1.4, tsw);
  drawLeg(ctx, P, bx - 5.2, by + 2.2, -sw, true);
  drawLeg(ctx, P, bx + 4.2, by + 2.2, sw, true);
  drawLeg(ctx, P, bx - 3.4, by + 2.6, sw, false);
  drawLeg(ctx, P, bx + 6.0, by + 2.6, -sw, false);
  const bodyPath = () => blobPath(ctx, bx, by, brx, bry, P.fluffy);
  furPart(ctx, P, bodyPath, { x: bx, y: by, rx: brx, ry: bry }, 'body', 1.4, 5);
  drawScarf(ctx, owner, hx, hy);
  drawCatHead(ctx, P, hx, hy, { faceOff: 1.4, seed: 9 });
  drawScarf(ctx, owner, hx, hy, true);
  drawHat(ctx, hatId, hx, hy);
  if (P.pat === 'gold') { sparkle(ctx, hx + 6.5, hy - 6.5, 1.8, '#ffffff'); sparkle(ctx, bx - 5, by - 4, 1.1, '#fffbe0'); }
}

// ---------------------------------------------------------------- sprite API
const SPR_S = 3, SPR_W = 40, SPR_H = 44, SPR_AX = 19, SPR_AY = 40;
const _sprites = new Map();
export function getCatSprite(furId, hatId, owner, frame) {
  frame = (((frame | 0) % 4) + 4) % 4;
  const key = furId + '|' + hatId + '|' + owner + '|' + frame;
  let s = _sprites.get(key);
  if (s) return s;
  const fur = FUR_BY_ID[furId] || FURS[0];
  const c = makeCanvas(SPR_W * SPR_S, SPR_H * SPR_S);
  const ctx = c.getContext('2d');
  ctx.scale(SPR_S, SPR_S);
  ctx.translate(SPR_AX, SPR_AY);
  drawCatFigure(ctx, fur, hatId || 'none', owner, frame);
  s = { canvas: c, w: SPR_W, h: SPR_H, ax: SPR_AX, ay: SPR_AY };
  _sprites.set(key, s);
  return s;
}

const _urlCache = new Map();
export function catPreviewURL(furId, hatId, size = 96, owner = 0) {
  const key = 'cat|' + furId + '|' + hatId + '|' + size + '|' + owner;
  let u = _urlCache.get(key);
  if (u) return u;
  const fur = FUR_BY_ID[furId] || FURS[0];
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const k = size / 41;
  ctx.translate(size / 2 + 1.6 * k, size * 0.9);
  ctx.scale(k, k);
  drawCatFigure(ctx, fur, hatId || 'none', owner, 0);
  u = c.toDataURL('image/png');
  _urlCache.set(key, u);
  return u;
}

// ================================================================ BUILDINGS
// Each building is designed in "design units" (radius R0) with (0,0) = ground center, y up = negative.
const _bp = new Map();
function bpal(owner) {
  const key = owner == null ? -1 : owner;
  let p = _bp.get(key);
  if (p) return p;
  const s = key < 0;
  const c = teamColor(s ? -1 : key);
  p = {
    stray: s,
    roof: s ? '#b8aa97' : c.main, roofD: s ? '#8a7c6a' : c.dark, roofL: s ? '#d9cebf' : c.light,
    wall: s ? '#ddcdb2' : '#fff4e0', wallD: s ? '#bba88c' : '#efd6b2',
    wood: s ? '#977a5e' : '#b8743f', woodD: s ? '#6c5440' : '#83502a',
    line: s ? '#5b4a40' : '#3f2a2c',
    glow: s ? '#8d8878' : '#ffeb9a', glowD: s ? '#6b6759' : '#ffa93a',
    stone: s ? '#a59d92' : '#cfc6bb', stoneD: s ? '#81796f' : '#9d9489',
    sisal: s ? '#c6ae88' : '#e6c189', sisalD: s ? '#9a8361' : '#b98b51',
    carpet: s ? '#cbbda7' : '#f2e6d0', carpetD: s ? '#a69780' : '#d4c2a2',
    leaf: s ? '#8fa879' : '#59c766', leafD: s ? '#5f774f' : '#2d8a47', leafL: s ? '#b9cba5' : '#9df08f',
    metal: s ? '#8b8780' : '#8e8aa0', metalD: s ? '#66625c' : '#625e75',
  };
  _bp.set(key, p);
  return p;
}
function drawShadow(ctx, rx, ry, oy = 1) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(30,18,40,0.42)');
  g.addColorStop(0.65, 'rgba(30,18,40,0.22)');
  g.addColorStop(1, 'rgba(30,18,40,0)');
  ctx.save(); ctx.translate(0, oy); ctx.scale(1, ry / rx);
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
function drawPips(ctx, n, y) {
  if (n < 1) return;
  const sp = 7.6, x0 = -(n - 1) * sp / 2;
  for (let i = 0; i < n; i++) {
    starPath(ctx, x0 + i * sp, y, 3.7, 1.65); sf(ctx, '#ffd447', '#6b4210', 1.9);
    starPath(ctx, x0 + i * sp - 0.5, y - 0.7, 1.5, 0.65); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
  }
}
function paw(ctx, x, y, r, col) {
  ctx.fillStyle = col;
  ell(ctx, x, y + r * 0.38, r * 0.6, r * 0.48); ctx.fill();
  circ(ctx, x - r * 0.62, y - r * 0.12, r * 0.24); ctx.fill();
  circ(ctx, x + r * 0.62, y - r * 0.12, r * 0.24); ctx.fill();
  circ(ctx, x - r * 0.24, y - r * 0.55, r * 0.25); ctx.fill();
  circ(ctx, x + r * 0.24, y - r * 0.55, r * 0.25); ctx.fill();
}
// cylinder: side band from topY to botY, then top ellipse
function cyl(ctx, cx, topY, botY, rx, ry, side, top, line, lw = 2.4) {
  ctx.beginPath();
  ctx.moveTo(cx - rx, topY); ctx.lineTo(cx - rx, botY);
  ctx.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, topY);
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  sf(ctx, side, line, lw);
  ctx.save(); ctx.clip();
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(40,20,40,0.22)');
  ctx.fillStyle = g; ctx.fillRect(cx - rx, topY - ry, rx * 2, botY - topY + ry * 2);
  ctx.restore();
  ell(ctx, cx, topY, rx, ry); sf(ctx, top, line, lw);
  ctx.save(); ell(ctx, cx, topY, rx, ry); ctx.clip(); gloss(ctx, cx, topY, rx, ry, 0.3); ctx.restore();
}
function bWindow(ctx, P, x, y, w, h, arch = true) {
  const path = (inset = 0) => {
    const X = x + inset, Y = y + inset, W = w - inset * 2, H = h - inset * 2;
    ctx.beginPath();
    if (arch) { ctx.moveTo(X, Y + H); ctx.lineTo(X, Y + W / 2); ctx.arc(X + W / 2, Y + W / 2, W / 2, Math.PI, 0); ctx.lineTo(X + W, Y + H); ctx.closePath(); }
    else rr(ctx, X, Y, W, H, 1.5);
  };
  path(); sf(ctx, P.stray ? '#cdbfa6' : '#ffffff', P.line, 2.2);
  path(1.4);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, P.glow); g.addColorStop(1, P.glowD);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = P.stray ? '#cdbfa6' : '#ffffff'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(x + w / 2, y + 1.5); ctx.lineTo(x + w / 2, y + h - 1); ctx.moveTo(x + 1, y + h * 0.58); ctx.lineTo(x + w - 1, y + h * 0.58); ctx.stroke();
  if (P.stray) {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.35);
    rr(ctx, -w * 0.62, -1.4, w * 1.24, 2.8, 0.6); sf(ctx, '#a08566', P.line, 1.3);
    ctx.restore();
  } else {
    ell(ctx, x + w * 0.3, y + h * 0.3, w * 0.12, h * 0.16, 0.4); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
  }
  rr(ctx, x - 1.5, y + h - 0.6, w + 3, 2.3, 1); sf(ctx, P.wallD, P.line, 1.6);
}
function flowerBox(ctx, P, cx, y, w) {
  if (P.stray) {
    rr(ctx, cx - w / 2, y, w, 3.4, 1); sf(ctx, P.woodD, P.line, 1.6);
    ctx.strokeStyle = '#7d6a4a'; ctx.lineWidth = 0.8;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(cx + k * 3, y); ctx.quadraticCurveTo(cx + k * 3 + 1.5, y - 2, cx + k * 3 + 2.5, y - 1); ctx.stroke(); }
    return;
  }
  const cols = ['#ff6fa8', '#ffe066', '#ff8a4c', '#c7a6ff', '#ffffff'];
  for (let k = 0; k < 5; k++) {
    const fx = cx - w / 2 + 2 + k * (w - 4) / 4, fy = y - 1.6 - (k % 2) * 1.2;
    ell(ctx, fx + 1, fy + 1.4, 1.5, 0.8, 0.5); ctx.fillStyle = '#4fb85a'; ctx.fill();
    circ(ctx, fx, fy, 1.45); sf(ctx, cols[k], '#8a4a6a', 0.8);
    circ(ctx, fx, fy, 0.5); ctx.fillStyle = '#ffcf3d'; ctx.fill();
  }
  rr(ctx, cx - w / 2, y, w, 3.6, 1); sf(ctx, P.wood, P.line, 1.6);
}
function bush(ctx, x, y, s, P) {
  const col = P.leaf, d = P.leafD;
  ctx.beginPath();
  ctx.arc(x - 4 * s, y - 3 * s, 4.2 * s, 0, TAU); ctx.moveTo(x + 4 * s, y - 4 * s); ctx.arc(x, y - 5 * s, 5 * s, 0, TAU);
  ctx.moveTo(x + 9 * s, y - 3 * s); ctx.arc(x + 4.6 * s, y - 3 * s, 4.2 * s, 0, TAU);
  sf(ctx, col, P.line, 2);
  ctx.save(); ctx.clip(); underShade(ctx, x, y - 4 * s, 9 * s, 5 * s, 0.3); gloss(ctx, x, y - 5 * s, 8 * s, 5 * s, 0.35); ctx.restore();
  if (!P.stray) { ctx.fillStyle = '#ff6f8f'; circ(ctx, x - 3 * s, y - 5 * s, 0.9 * s); ctx.fill(); circ(ctx, x + 3 * s, y - 7 * s, 0.9 * s); ctx.fill(); circ(ctx, x + 6 * s, y - 3 * s, 0.9 * s); ctx.fill(); }
  ctx.strokeStyle = d; ctx.lineWidth = 0.8;
}

// ---------------------------------------------------------------- cottage
const COT = [
  { hw: 18, wh: 22, rh: 24 },
  { hw: 21, wh: 25, rh: 27 },
  { hw: 23, wh: 27, rh: 29 },
  { hw: 24, wh: 41, rh: 29 },
  { hw: 25, wh: 43, rh: 31 },
];
function cottageGeo(L) {
  const g = COT[L - 1];
  const base = -3, top = base - g.wh, rb = top + 2, apex = rb - g.rh, oh = g.hw + 7;
  const chx = g.hw * 0.4;
  const chTop = rb - g.rh * 0.88;
  return { ...g, base, top, rb, apex, oh, chx, chTop, smokeX: chx + 3.8, smokeY: chTop - 2.5 };
}
function roofPath(ctx, G) {
  ctx.beginPath();
  ctx.moveTo(-G.oh, G.rb + 1.5);
  ctx.lineTo(-3.6, G.apex + 2.4);
  ctx.quadraticCurveTo(0, G.apex - 0.9, 3.6, G.apex + 2.4);
  ctx.lineTo(G.oh, G.rb + 1.5);
  ctx.quadraticCurveTo(G.oh + 1.6, G.rb + 4.6, G.oh - 2, G.rb + 4.6);
  ctx.lineTo(-G.oh + 2, G.rb + 4.6);
  ctx.quadraticCurveTo(-G.oh - 1.6, G.rb + 4.6, -G.oh, G.rb + 1.5);
  ctx.closePath();
}
function roofEar(ctx, P, ax, ay, ex, ey, side, size) {
  // ear on a roof slope from apex (ax,ay) toward eave (ex,ey)
  const pt = f => [ax + (ex - ax) * f, ay + (ey - ay) * f];
  const [b1x, b1y] = pt(0.08), [b2x, b2y] = pt(0.5), [mx, my] = pt(0.27);
  const dx = ex - ax, dy = ey - ay, len = Math.hypot(dx, dy);
  let nx = dy / len, ny = -dx / len; // normal
  if (ny > 0) { nx = -nx; ny = -ny; }
  const tx = mx + nx * size + side * size * 0.15, ty = my + ny * size - size * 0.25;
  const q = 0.22;
  ctx.beginPath(); ctx.moveTo(b1x, b1y);
  ctx.lineTo(tx + (b1x - tx) * q, ty + (b1y - ty) * q);
  ctx.quadraticCurveTo(tx, ty, tx + (b2x - tx) * q, ty + (b2y - ty) * q);
  ctx.lineTo(b2x, b2y); ctx.closePath();
  sf(ctx, P.roof, P.line, 2.4);
  const cx = (b1x + b2x + tx) / 3, cy = (b1y + b2y + ty) / 3;
  const k = 0.55;
  ctx.beginPath();
  ctx.moveTo(cx + (b1x - cx) * k, cy + (b1y - cy) * k);
  ctx.lineTo(cx + (tx - cx) * k, cy + (ty - cy) * k);
  ctx.lineTo(cx + (b2x - cx) * k, cy + (b2y - cy) * k);
  ctx.closePath();
  ctx.fillStyle = P.stray ? '#d8b4b0' : '#ffb3c7'; ctx.fill();
}
function drawRoof(ctx, P, G) {
  roofEar(ctx, P, 0, G.apex, -G.oh, G.rb, -1, 10);
  roofEar(ctx, P, 0, G.apex, G.oh, G.rb, 1, 10);
  roofPath(ctx, G); sf(ctx, P.roof, P.line, 2.6);
  ctx.save(); roofPath(ctx, G); ctx.clip();
  ctx.strokeStyle = P.roofD; ctx.lineWidth = 0.95;
  for (let y = G.apex + 6.5, row = 0; y < G.rb + 4; y += 4.6, row++) {
    for (let x = -G.oh - 4 + (row % 2) * 3; x < G.oh + 4; x += 6) {
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0.15, Math.PI - 0.15); ctx.stroke();
    }
  }
  const g = ctx.createLinearGradient(-G.oh, 0, G.oh, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(30,10,30,0.18)');
  ctx.fillStyle = g; ctx.fillRect(-G.oh - 2, G.apex - 2, G.oh * 2 + 4, G.rb - G.apex + 8);
  if (P.stray) {
    ctx.fillStyle = 'rgba(60,40,30,0.55)';
    ctx.beginPath(); ctx.moveTo(G.oh * 0.25, G.rb - 8); ctx.lineTo(G.oh * 0.45, G.rb - 10); ctx.lineTo(G.oh * 0.5, G.rb - 5); ctx.lineTo(G.oh * 0.3, G.rb - 4); ctx.closePath(); ctx.fill();
    rr(ctx, -G.oh * 0.55, G.rb - 12, 9, 5, 0.8); sf(ctx, '#a08566', P.line, 1.2);
  }
  ctx.restore();
  rr(ctx, -G.oh + 1, G.rb + 1.3, (G.oh - 1) * 2, 3.4, 1.7); sf(ctx, P.roofD, P.line, 1.8);
  ctx.beginPath(); ctx.moveTo(-G.oh * 0.55, G.apex + (G.rb - G.apex) * 0.55); ctx.lineTo(-4, G.apex + 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4; ctx.stroke();
}
function door(ctx, P, x, base, hw, h) {
  const path = () => { ctx.beginPath(); ctx.moveTo(x - hw, base); ctx.lineTo(x - hw, base - h + hw); ctx.arc(x, base - h + hw, hw, Math.PI, 0); ctx.lineTo(x + hw, base); ctx.closePath(); };
  path(); sf(ctx, P.wood, P.line, 2.2);
  ctx.save(); path(); ctx.clip();
  ctx.strokeStyle = P.woodD; ctx.lineWidth = 0.8;
  for (let k = -hw + 2.6; k < hw; k += 2.6) { ctx.beginPath(); ctx.moveTo(x + k, base - h); ctx.lineTo(x + k, base); ctx.stroke(); }
  gloss(ctx, x, base - h / 2, hw, h / 2, 0.25);
  ctx.restore();
  rr(ctx, x - 2.4, base - 5, 4.8, 4.2, 1.8); sf(ctx, P.woodD, P.line, 1);
  circ(ctx, x + hw * 0.55, base - h * 0.45, 0.95); sf(ctx, '#ffd447', P.line, 0.8);
  rr(ctx, x - hw - 1.6, base - 0.8, hw * 2 + 3.2, 2.8, 1.2); sf(ctx, P.stone, P.line, 1.6);
}
function atticWindow(ctx, P, x, y, r) {
  circ(ctx, x, y, r); sf(ctx, P.stray ? '#cdbfa6' : '#ffffff', P.line, 2.2);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, P.glow); g.addColorStop(1, P.glowD);
  circ(ctx, x, y, r - 1.3); ctx.fillStyle = g; ctx.fill();
  paw(ctx, x, y + 0.3, r * 0.62, P.stray ? '#6b6252' : 'rgba(150,80,40,0.75)');
}
function wallLantern(ctx, P, x, y) {
  if (!P.stray) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
    g.addColorStop(0, 'rgba(255,220,120,0.55)'); g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 9, y - 9, 18, 18);
  }
  ctx.strokeStyle = P.line; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 3, y - 4); ctx.lineTo(x, y - 4); ctx.lineTo(x, y - 2.5); ctx.stroke();
  rr(ctx, x - 1.8, y - 2.6, 3.6, 4.8, 1); sf(ctx, P.glow, P.line, 1.3);
}
function turret(ctx, P, x, base) {
  const w = 13, top = base - 54;
  rr(ctx, x, top, w, base - top - 1, 2); sf(ctx, P.wall, P.line, 2.4);
  ctx.save(); rr(ctx, x, top, w, base - top - 1, 2); ctx.clip();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(90,50,30,0.25)');
  ctx.fillStyle = g; ctx.fillRect(x, top, w, base - top);
  ctx.restore();
  bWindow(ctx, P, x + 3, top + 10, 7, 9);
  bWindow(ctx, P, x + 3, top + 28, 7, 9);
  const ap = top - 22;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x + w / 2 + s * 3, ap + 9); ctx.lineTo(x + w / 2 + s * 8, ap + 3); ctx.lineTo(x + w / 2 + s * 8.6, ap + 12); ctx.closePath(); sf(ctx, P.roof, P.line, 2);
  }
  ctx.beginPath(); ctx.moveTo(x - 4, top + 2); ctx.quadraticCurveTo(x + w / 2, top + 5, x + w + 4, top + 2); ctx.lineTo(x + w / 2, ap); ctx.closePath();
  sf(ctx, P.roof, P.line, 2.4);
  ctx.save(); ctx.clip();
  ctx.strokeStyle = P.roofD; ctx.lineWidth = 0.9;
  for (let y = ap + 6; y < top + 4; y += 4) { ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + w + 4, y); ctx.stroke(); }
  const g2 = ctx.createLinearGradient(x - 4, 0, x + w + 4, 0); g2.addColorStop(0, 'rgba(255,255,255,0.25)'); g2.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = g2; ctx.fillRect(x - 5, ap, w + 10, top - ap + 6);
  ctx.restore();
  if (!P.stray) {
    ctx.strokeStyle = P.line; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + w / 2, ap); ctx.lineTo(x + w / 2, ap - 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w / 2, ap - 11); ctx.lineTo(x + w / 2 + 8, ap - 8.5); ctx.lineTo(x + w / 2, ap - 6); ctx.closePath(); sf(ctx, P.roofL, P.line, 1.3);
  }
}
function cottageBack(ctx, L, P) {
  const G = cottageGeo(L);
  if (L === 5) turret(ctx, P, G.hw - 1, G.base);
  // chimney behind roof
  rr(ctx, G.chx, G.chTop, 7.6, G.rb - G.chTop - 2, 1);
  sf(ctx, P.stray ? '#9b8274' : '#c96d50', P.line, 2.2);
  ctx.save(); rr(ctx, G.chx, G.chTop, 7.6, G.rb - G.chTop - 2, 1); ctx.clip();
  ctx.strokeStyle = 'rgba(80,30,20,0.4)'; ctx.lineWidth = 0.7;
  for (let y = G.chTop + 3, r = 0; y < G.rb; y += 3, r++) { ctx.beginPath(); ctx.moveTo(G.chx, y); ctx.lineTo(G.chx + 8, y); ctx.moveTo(G.chx + (r % 2 ? 2 : 5), y - 3); ctx.lineTo(G.chx + (r % 2 ? 2 : 5), y); ctx.stroke(); }
  ctx.restore();
  rr(ctx, G.chx - 1.4, G.chTop - 2.4, 10.4, 3.4, 1.2); sf(ctx, P.stray ? '#7d685c' : '#9c4d37', P.line, 1.8);
  // foundation
  rr(ctx, -G.hw - 3.5, G.base - 5, (G.hw + 3.5) * 2, 8.5, 3); sf(ctx, P.stone, P.line, 2.4);
  ctx.strokeStyle = P.stoneD; ctx.lineWidth = 0.8;
  for (let x = -G.hw; x < G.hw; x += 6.5) { ctx.beginPath(); ctx.moveTo(x, G.base - 4.5); ctx.lineTo(x + 1, G.base + 3); ctx.stroke(); }
  // walls
  rr(ctx, -G.hw, G.top, G.hw * 2, G.wh, 2); sf(ctx, P.wall, P.line, 2.4);
  ctx.save(); rr(ctx, -G.hw, G.top, G.hw * 2, G.wh, 2); ctx.clip();
  ctx.strokeStyle = P.stray ? 'rgba(120,90,60,0.25)' : 'rgba(200,150,100,0.22)'; ctx.lineWidth = 0.7;
  for (let y = G.top + 5; y < G.base; y += 4) { ctx.beginPath(); ctx.moveTo(-G.hw, y); ctx.lineTo(G.hw, y); ctx.stroke(); }
  const g = ctx.createLinearGradient(-G.hw, 0, G.hw, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(110,60,30,0.2)');
  ctx.fillStyle = g; ctx.fillRect(-G.hw, G.top, G.hw * 2, G.wh);
  ctx.fillStyle = 'rgba(90,45,30,0.2)'; ctx.fillRect(-G.hw, G.top, G.hw * 2, 6);
  if (P.stray) {
    ctx.strokeStyle = 'rgba(90,70,50,0.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-G.hw + 4, G.top + 6); ctx.lineTo(-G.hw + 7, G.top + 10); ctx.lineTo(-G.hw + 5, G.top + 14); ctx.stroke();
  }
  ctx.restore();
  if (L >= 3) {
    ctx.fillStyle = P.wood;
    for (const x of [-G.hw, G.hw - 2.6]) { rr(ctx, x, G.top + 2, 2.6, G.wh - 2, 0.8); sf(ctx, P.wood, P.line, 1.4); }
  }
  if (L >= 4) { rr(ctx, -G.hw - 1, G.base - 25, G.hw * 2 + 2, 3.2, 1); sf(ctx, P.wood, P.line, 1.6); }
  // door & windows
  const dx = L === 1 ? -6 : L === 2 ? -7 : 0;
  door(ctx, P, dx, G.base, L >= 3 ? 6.2 : 5.4, L >= 3 ? 17 : 15);
  if (L === 1) bWindow(ctx, P, 4, G.base - 18, 9, 10);
  if (L === 2) { bWindow(ctx, P, 4.5, G.base - 20, 11, 12); flowerBox(ctx, P, 10, G.base - 7.4, 14); }
  if (L >= 3) {
    bWindow(ctx, P, -G.hw + 4.5, G.base - 19.5, 10, 11); flowerBox(ctx, P, -G.hw + 9.5, G.base - 7.9, 13);
    bWindow(ctx, P, G.hw - 14.5, G.base - 19.5, 10, 11); flowerBox(ctx, P, G.hw - 9.5, G.base - 7.9, 13);
    wallLantern(ctx, P, 10.5, G.base - 15);
  }
  if (L >= 4) {
    bWindow(ctx, P, -G.hw + 5, G.base - 40, 9, 10);
    bWindow(ctx, P, G.hw - 14, G.base - 40, 9, 10);
    circ(ctx, 0, G.base - 34, 4.2); sf(ctx, P.wallD, P.line, 1.6);
    paw(ctx, 0, G.base - 33.8, 2.6, P.roof);
  }
  drawRoof(ctx, P, G);
  if (L >= 2) atticWindow(ctx, P, 0, G.rb - G.rh * 0.38, L >= 4 ? 5.2 : 4.5);
  if (L >= 5) { bush(ctx, -G.hw - 7, G.base + 2, 0.75, P); bush(ctx, G.hw + 10, G.base + 3, 0.7, P); }
}
function cottageFront(ctx, L) {
  const G = cottageGeo(L);
  drawPips(ctx, L, G.apex - 8);
}
function cottageLive(ctx, L, P, t, ph) {
  if (P.stray) return;
  const G = cottageGeo(L);
  ctx.fillStyle = '#f6f2ee';
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.42 + i / 3 + ph) % 1;
    const x = G.smokeX + p * 7 + Math.sin(p * 6 + i) * 1.4, y = G.smokeY - p * 20, r = 2.2 + p * 4.0;
    ctx.globalAlpha = (1 - p) * 0.7 * Math.min(1, p * 5);
    circ(ctx, x, y, r); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- tower
function towerGeo(L) {
  const pt = -(56 + (L - 1) * 10);
  return { pt, roofApex: pt - 44, flagX: L === 3 ? 21 : 17, flagY: L === 3 ? pt - 24 : pt - 4, flagH: L === 3 ? 22 : 28, pipY: L === 3 ? pt - 52 : pt - 22 };
}
function parapet(ctx, P, y, part) {
  const rx = 21, ry = 7.2, h = 6;
  const back = part === 'back';
  const a0 = back ? Math.PI : 0, a1 = back ? TAU : Math.PI;
  const col = back ? P.stoneD : P.stone;
  ctx.beginPath(); ctx.ellipse(0, y, rx, ry, 0, a0, a1); ctx.ellipse(0, y - h, rx, ry, 0, a1, a0, true); ctx.closePath();
  sf(ctx, col, P.line, 2.0);
  for (let a = a0 + 0.22; a < a1 - 0.1; a += 0.44) {
    const mx = Math.cos(a) * rx, my = y - h + Math.sin(a) * ry;
    rr(ctx, mx - 2.4, my - 3.8, 4.8, 4.6, 1.1); sf(ctx, col, P.line, 1.8);
  }
  if (!back) {
    ctx.beginPath(); ctx.ellipse(0, y - h * 0.4, rx - 0.5, ry, 0, 0.12, Math.PI - 0.12);
    ctx.strokeStyle = P.roof; ctx.lineWidth = 2.2; ctx.stroke();
  }
}
function towerBack(ctx, L, P) {
  const G = towerGeo(L);
  cyl(ctx, 0, -6, 0, 24, 8, P.carpetD, P.carpet, P.line);
  ctx.beginPath(); ctx.ellipse(0, -2.6, 23.6, 8, 0, 0.1, Math.PI - 0.1); ctx.strokeStyle = P.roof; ctx.lineWidth = 2; ctx.stroke();
  const pw = 9.5, top = G.pt + 2;
  rr(ctx, -pw, top, pw * 2, -6 - top + 1, 2.5); sf(ctx, P.sisal, P.line, 2.4);
  ctx.save(); rr(ctx, -pw, top, pw * 2, -6 - top + 1, 2.5); ctx.clip();
  for (let y = top + 2; y < -4; y += 2.3) {
    ctx.beginPath(); ctx.moveTo(-pw, y); ctx.quadraticCurveTo(0, y + 1.6, pw, y);
    ctx.strokeStyle = P.sisalD; ctx.lineWidth = 0.75; ctx.stroke();
  }
  const g = ctx.createLinearGradient(-pw, 0, pw, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(60,30,10,0.3)');
  ctx.fillStyle = g; ctx.fillRect(-pw, top, pw * 2, -top);
  ctx.strokeStyle = 'rgba(255,240,210,0.8)'; ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(1 + k * 2, -24 - k); ctx.lineTo(4 + k * 2, -14 - k); ctx.stroke(); }
  ctx.restore();
  if (L >= 2) {
    const my = -6 + (G.pt + 6) * 0.45;
    cyl(ctx, 0, my - 3, my + 1, 15, 4.8, P.roofD, P.roof, P.line, 2.2);
    ctx.strokeStyle = P.line; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(11, my + 2); ctx.lineTo(12, my + 11); ctx.stroke();
    circ(ctx, 12, my + 13, 2.6); sf(ctx, P.stray ? '#c9b9a3' : '#ff8fb8', P.line, 1.4);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(12, my + 13, 1.6, 3.6, 5.2); ctx.stroke();
  }
  cyl(ctx, 0, G.pt, G.pt + 6, 23, 7.8, P.roofD, P.roof, P.line);
  ell(ctx, 0, G.pt, 17, 5.2); ctx.fillStyle = rgba(P.roofL, 0.45); ctx.fill();
  parapet(ctx, P, G.pt, 'back');
}
function towerFront(ctx, L, P) {
  const G = towerGeo(L);
  parapet(ctx, P, G.pt, 'front');
  if (L === 3) {
    for (const s of [-1, 1]) { rr(ctx, s * 17 - 1.5, G.pt - 26, 3, 22, 1); sf(ctx, P.wood, P.line, 1.6); }
    roofEar(ctx, P, 0, G.roofApex, -26, G.pt - 23, -1, 7);
    roofEar(ctx, P, 0, G.roofApex, 26, G.pt - 23, 1, 7);
    const rp = () => { ctx.beginPath(); ctx.moveTo(-27, G.pt - 22); ctx.lineTo(-2.5, G.roofApex + 1.5); ctx.quadraticCurveTo(0, G.roofApex - 1, 2.5, G.roofApex + 1.5); ctx.lineTo(27, G.pt - 22); ctx.quadraticCurveTo(0, G.pt - 17, -27, G.pt - 22); ctx.closePath(); };
    rp(); sf(ctx, P.roof, P.line, 2.4);
    ctx.save(); rp(); ctx.clip();
    ctx.strokeStyle = P.roofD; ctx.lineWidth = 0.9;
    for (let y = G.roofApex + 6, row = 0; y < G.pt - 16; y += 4.4, row++) for (let x = -28 + (row % 2) * 3; x < 28; x += 6) { ctx.beginPath(); ctx.arc(x, y, 3, 0.15, Math.PI - 0.15); ctx.stroke(); }
    const g = ctx.createLinearGradient(-27, 0, 27, 0); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(20,0,30,0.18)');
    ctx.fillStyle = g; ctx.fillRect(-28, G.roofApex - 2, 56, 30);
    ctx.restore();
    circ(ctx, 0, G.roofApex - 1, 2.4); sf(ctx, '#ffd447', P.line, 1.4);
  }
  drawPips(ctx, L, G.pipY);
}
function towerMid(ctx, L, P, t, ph) {
  const G = towerGeo(L);
  const y = G.pt - 6;
  const look = Math.sin(t * 0.7 + ph * 6.3), sx = look * 2.2;
  const furC = P.stray ? '#b5aca2' : '#f2a65a', furL = P.stray ? '#5b4a40' : '#5a3020';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sx + s * 1.6, y - 5.2); ctx.lineTo(sx + s * 4.8, y - 9.4); ctx.lineTo(sx + s * 5.4, y - 3.4); ctx.closePath();
    sf(ctx, furC, furL, 1.6);
  }
  ell(ctx, sx, y - 2.4, 5.8, 5.0); sf(ctx, furC, furL, 1.8);
  if (!P.stray) {
    ctx.fillStyle = '#c96d2a';
    for (let k = -1; k <= 1; k++) { rr(ctx, sx + k * 1.6 - 0.35, y - 7.2, 0.7, 2, 0.3); ctx.fill(); }
  }
  const ex = sx + look * 1.1;
  const closed = P.stray || ((t + ph * 7) % 4.3) < 0.14;
  ctx.fillStyle = '#2b2135'; ctx.strokeStyle = '#2b2135'; ctx.lineWidth = 0.7;
  for (const s of [-1, 1]) {
    if (closed) { ctx.beginPath(); ctx.arc(ex + s * 2.1, y - 2.8, 1.0, 0.2, Math.PI - 0.2); ctx.stroke(); }
    else { ell(ctx, ex + s * 2.1, y - 2.8, 0.95, 1.2); ctx.fill(); circ(ctx, ex + s * 2.1 + 0.35, y - 3.3, 0.38); ctx.fillStyle = '#fff'; ctx.fill(); ctx.fillStyle = '#2b2135'; }
  }
  ctx.fillStyle = '#ff8aa3'; circ(ctx, ex, y - 1.0, 0.6); ctx.fill();
  ctx.fillStyle = 'rgba(255,110,150,0.4)'; ell(ctx, ex - 3.4, y - 0.8, 1.1, 0.6); ctx.fill(); ell(ctx, ex + 3.4, y - 0.8, 1.1, 0.6); ctx.fill();
  ell(ctx, sx - 3.4, y + 3.6, 2.0, 1.4); sf(ctx, furC, furL, 1.4);
  ell(ctx, sx + 3.4, y + 3.6, 2.0, 1.4); sf(ctx, furC, furL, 1.4);
  if (P.stray) {
    ctx.fillStyle = 'rgba(80,70,100,0.8)'; ctx.font = 'bold 5px sans-serif';
    const zp = (t * 0.6 + ph) % 1; ctx.globalAlpha = 1 - zp; ctx.fillText('z', sx + 5 + zp * 4, y - 8 - zp * 8); ctx.globalAlpha = 1;
  }
}
function drawFlag(ctx, x, y, h, w, P, t, ph) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = P.line; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.strokeStyle = '#e9e2d6'; ctx.lineWidth = 1.2; ctx.stroke();
  const fy = y - h + 1.5, fh = w * 0.62;
  ctx.beginPath(); ctx.moveTo(x, fy);
  for (let k = 1; k <= 4; k++) ctx.lineTo(x + w * k / 4, fy + Math.sin(t * 5 + k * 1.1 + ph * 6) * 1.5 * k / 4);
  ctx.lineTo(x + w - 3.5, fy + fh * 0.5 + Math.sin(t * 5 + 3.8 + ph * 6) * 1.2);
  for (let k = 4; k >= 0; k--) ctx.lineTo(x + w * k / 4, fy + fh + Math.sin(t * 5 + k * 1.1 + ph * 6) * 1.5 * k / 4);
  ctx.closePath();
  sf(ctx, P.roof, P.line, 1.8);
  paw(ctx, x + w * 0.42, fy + fh * 0.5 + Math.sin(t * 5 + 2.2 + ph * 6) * 0.8, fh * 0.34, 'rgba(255,255,255,0.92)');
  circ(ctx, x, y - h, 1.7); sf(ctx, '#ffd447', P.line, 1.2);
}
function towerLive(ctx, L, P, t, ph) {
  if (P.stray) return;
  const G = towerGeo(L);
  drawFlag(ctx, G.flagX, G.flagY, G.flagH, 15, P, t, ph);
}

// ---------------------------------------------------------------- forge
function forgeGeo(L) {
  const hw = 26 + (L - 1) * 2, base = -2, wt = base - 25 - (L - 1) * 2;
  const R = 14 + (L - 1) * 2.2;
  const bx = -7, by = wt - 7 - R + 1;
  return { hw, base, wt, R, bx, by, chx: hw - 12, chTop: wt - 24 - (L - 1) * 2, top: by - R };
}
function yarnBall(ctx, x, y, R, c, cd, cl, line) {
  circ(ctx, x, y, R); sf(ctx, c, line, 2.4);
  ctx.save(); circ(ctx, x, y, R); ctx.clip();
  ctx.lineCap = 'round';
  const lw = Math.max(0.7, R * 0.07);
  const groups = [[0.5, cd, 0.0], [-0.9, cl, 0.35], [2.0, cd, -0.3]];
  for (const [rot, col, off] of groups) {
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    const c0 = Math.cos(rot), s0 = Math.sin(rot);
    for (let k = -3; k <= 3; k++) {
      const d = (k + off) * R * 0.24;
      const cx = x + c0 * d, cy = y + s0 * d;
      const half = Math.sqrt(Math.max(0, R * R - d * d)) * 1.05;
      ctx.beginPath();
      ctx.moveTo(cx - s0 * half, cy + c0 * half);
      ctx.quadraticCurveTo(cx + c0 * R * 0.18, cy + s0 * R * 0.18, cx + s0 * half, cy - c0 * half);
      ctx.stroke();
    }
  }
  gloss(ctx, x, y, R, R, 0.5);
  underShade(ctx, x, y, R, R, 0.3);
  ctx.restore();
}
function needle(ctx, x1, y1, x2, y2, knob) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = '#3f2a2c'; ctx.lineWidth = 3.2; ctx.stroke();
  ctx.strokeStyle = '#ece6dc'; ctx.lineWidth = 1.6; ctx.stroke();
  circ(ctx, x1, y1, 2.2); sf(ctx, knob, '#3f2a2c', 1.4);
}
function gear(ctx, x, y, r, P) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, rad = i % 2 ? r : r * 0.78;
    const a2 = a + TAU / 32;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    ctx.lineTo(x + Math.cos(a2) * rad, y + Math.sin(a2) * rad);
  }
  ctx.closePath(); sf(ctx, P.stray ? '#a59a85' : '#d9a441', P.line, 2);
  circ(ctx, x, y, r * 0.35); sf(ctx, P.metalD, P.line, 1.4);
}
function forgeBack(ctx, L, P) {
  const G = forgeGeo(L);
  if (L >= 2) gear(ctx, -G.hw + 1, G.wt + 3, 9, P);
  // chimney
  rr(ctx, G.chx, G.chTop, 9, G.wt - G.chTop + 2, 1.5); sf(ctx, P.metal, P.line, 2.2);
  ctx.save(); rr(ctx, G.chx, G.chTop, 9, G.wt - G.chTop + 2, 1.5); ctx.clip();
  const gm = ctx.createLinearGradient(G.chx, 0, G.chx + 9, 0); gm.addColorStop(0, 'rgba(255,255,255,0.35)'); gm.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gm; ctx.fillRect(G.chx, G.chTop, 9, 40);
  ctx.restore();
  for (const yy of [G.chTop + 8, G.chTop + 16]) { rr(ctx, G.chx - 0.8, yy, 10.6, 2.2, 1); sf(ctx, P.metalD, P.line, 1.2); }
  rr(ctx, G.chx - 2, G.chTop - 3, 13, 4, 1.5); sf(ctx, P.metalD, P.line, 1.8);
  // walls
  rr(ctx, -G.hw, G.wt, G.hw * 2, G.base - G.wt, 2.5); sf(ctx, P.stone, P.line, 2.4);
  ctx.save(); rr(ctx, -G.hw, G.wt, G.hw * 2, G.base - G.wt, 2.5); ctx.clip();
  ctx.strokeStyle = P.stoneD; ctx.lineWidth = 0.8;
  for (let y = G.wt + 4, r = 0; y < G.base + 4; y += 5, r++) {
    ctx.beginPath(); ctx.moveTo(-G.hw, y); ctx.lineTo(G.hw, y); ctx.stroke();
    for (let x = -G.hw + (r % 2 ? 4 : 0); x < G.hw; x += 9) { ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.stroke(); }
  }
  const g = ctx.createLinearGradient(-G.hw, 0, G.hw, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.25)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,30,30,0.22)');
  ctx.fillStyle = g; ctx.fillRect(-G.hw, G.wt, G.hw * 2, G.base - G.wt);
  ctx.restore();
  // furnace arch
  const aw = 9, ah = 19;
  const arch = () => { ctx.beginPath(); ctx.moveTo(-aw, G.base); ctx.lineTo(-aw, G.base - ah + aw); ctx.arc(0, G.base - ah + aw, aw, Math.PI, 0); ctx.lineTo(aw, G.base); ctx.closePath(); };
  arch(); ctx.lineWidth = 6; ctx.strokeStyle = P.line; ctx.stroke(); ctx.lineWidth = 3.6; ctx.strokeStyle = P.stoneD; ctx.stroke();
  arch(); ctx.fillStyle = '#2a1416'; ctx.fill();
  const fg = ctx.createRadialGradient(0, G.base - 3, 0, 0, G.base - 3, 16);
  if (P.stray) { fg.addColorStop(0, '#7a5a44'); fg.addColorStop(1, 'rgba(50,30,25,0.6)'); }
  else { fg.addColorStop(0, '#fff2a8'); fg.addColorStop(0.35, '#ffad3b'); fg.addColorStop(0.75, '#e2471f'); fg.addColorStop(1, 'rgba(120,20,20,0.6)'); }
  arch(); ctx.fillStyle = fg; ctx.fill();
  if (!P.stray) {
    ctx.fillStyle = '#ff6a2a';
    for (let k = -2; k <= 2; k++) { circ(ctx, k * 3, G.base - 1.5, 2.2); ctx.fill(); }
    ctx.fillStyle = '#ffd36b';
    for (let k = -1; k <= 1; k++) { circ(ctx, k * 3.5 + 1, G.base - 2.5, 1.2); ctx.fill(); }
  }
  // awning
  const ax0 = -G.hw - 3, aw2 = G.hw * 2 + 6, ay = G.wt + 2;
  ctx.beginPath(); ctx.moveTo(ax0, ay);
  ctx.lineTo(ax0 + aw2, ay); ctx.lineTo(ax0 + aw2, ay + 5);
  const n = 7, sw = aw2 / n;
  for (let i = n - 1; i >= 0; i--) ctx.arc(ax0 + sw * (i + 0.5), ay + 5, sw / 2, 0, Math.PI);
  ctx.closePath();
  sf(ctx, '#ffffff', P.line, 2.2);
  ctx.save(); ctx.clip();
  ctx.fillStyle = P.roof;
  for (let i = 0; i < n; i += 2) ctx.fillRect(ax0 + sw * i, ay - 1, sw, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(ax0, ay + 3, aw2, 10);
  ctx.restore();
  // roof slab
  ctx.beginPath(); ctx.moveTo(-G.hw - 4, G.wt + 2); ctx.lineTo(-G.hw + 1, G.wt - 6); ctx.lineTo(G.hw - 1, G.wt - 6); ctx.lineTo(G.hw + 4, G.wt + 2); ctx.closePath();
  sf(ctx, P.stray ? '#8a8378' : '#6a6378', P.line, 2.4);
  rr(ctx, -G.hw - 4, G.wt - 0.5, G.hw * 2 + 8, 3, 1.4); sf(ctx, L === 3 && !P.stray ? '#ffd447' : P.roofD, P.line, 1.6);
  // spindle stand
  const sx1 = G.bx - G.R - 2.5, sx2 = G.bx + G.R - 1;
  for (const sx of [sx1, sx2]) { rr(ctx, sx, G.by - 2, 3.5, G.wt - 6 - G.by + 3, 1); sf(ctx, P.wood, P.line, 1.6); }
  rr(ctx, sx1 - 1, G.wt - 8, sx2 - sx1 + 5.5, 3, 1); sf(ctx, P.woodD, P.line, 1.6);
  ctx.beginPath(); ctx.moveTo(sx1, G.by); ctx.lineTo(sx2 + 3.5, G.by); ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.stroke();
  // strand to the ground
  const strand = () => { ctx.beginPath(); ctx.moveTo(G.bx + G.R * 0.75, G.by + G.R * 0.6); ctx.bezierCurveTo(G.bx + G.R + 12, G.by + G.R + 4, G.hw + 1, G.wt - 6, G.hw + 7, G.base - 2); };
  strand(); ctx.strokeStyle = P.line; ctx.lineWidth = 2.8; ctx.stroke();
  strand(); ctx.strokeStyle = P.roof; ctx.lineWidth = 1.4; ctx.stroke();
  yarnBall(ctx, G.hw + 8, G.base - 2.5, 3.6, P.roof, P.roofD, P.roofL, P.line);
  yarnBall(ctx, G.bx, G.by, G.R, P.roof, P.roofD, P.roofL, P.line);
  needle(ctx, G.bx - G.R * 1.05, G.by - G.R * 1.1, G.bx + G.R * 0.55, G.by + G.R * 0.3, P.stray ? '#c9b9a3' : '#ff8fb8');
  needle(ctx, G.bx + G.R * 1.05, G.by - G.R * 1.15, G.bx - G.R * 0.5, G.by + G.R * 0.35, P.stray ? '#c9b9a3' : '#7fd6ff');
  if (L === 3) yarnBall(ctx, -G.hw - 6, G.base - 6, 6.5, P.roofL, P.roof, '#ffffff', P.line);
  // anvil
  const axx = G.hw - 9;
  ctx.beginPath(); ctx.moveTo(axx - 7, G.base - 7); ctx.lineTo(axx + 7, G.base - 7); ctx.quadraticCurveTo(axx + 8, G.base - 5, axx + 4, G.base - 4.5);
  ctx.lineTo(axx + 3, G.base - 2); ctx.lineTo(axx + 5, G.base + 1); ctx.lineTo(axx - 5, G.base + 1); ctx.lineTo(axx - 3, G.base - 2); ctx.lineTo(axx - 4, G.base - 4.5); ctx.quadraticCurveTo(axx - 9, G.base - 5, axx - 7, G.base - 7); ctx.closePath();
  sf(ctx, '#5b5768', P.line, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(axx - 6, G.base - 7, 12, 1);
}
function forgeFront(ctx, L) { const G = forgeGeo(L); drawPips(ctx, L, G.top - 9); }
function forgeLive(ctx, L, P, t, ph) {
  if (P.stray) return;
  const G = forgeGeo(L);
  // furnace flicker
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t * 9 + ph * 20) * Math.sin(t * 5.3);
  ell(ctx, 0, G.base - 7, 8, 9); ctx.fillStyle = '#ff9a3a'; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // sparks
  ctx.fillStyle = '#ffd25a';
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.9 + i / 6 + ph) % 1;
    const sx = Math.sin(i * 7.3) * 4 + Math.sin(i * 3.1 + 1) * p * 10;
    const sy = G.base - 6 - p * 26 + p * p * 10;
    ctx.globalAlpha = 1 - p;
    circ(ctx, sx, sy, 1.1 * (1 - p) + 0.3); ctx.fill();
  }
  // steam
  ctx.fillStyle = '#f2f0f5';
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.5 + i / 3 + ph * 2) % 1;
    ctx.globalAlpha = (1 - p) * 0.65 * Math.min(1, p * 5);
    circ(ctx, G.chx + 4.5 - p * 3 + Math.sin(p * 7 + i) * 1.5, G.chTop - 4 - p * 20, 2.5 + p * 4); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- garden
function gardenGeo(L) {
  const rx = 26 + (L - 1) * 2.5, soilY = -10, dh = 38 + (L - 1) * 5;
  return { rx, soilY, dh, apex: soilY - dh, top: soilY - dh - (L === 3 ? 13 : 4) };
}
function leafCluster(ctx, x, y, h, P, seed) {
  const r = mulberry32(seed);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42 + (r() - 0.5) * 0.2;
    const len = h * (0.65 + r() * 0.4);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.38, -len * 0.5, 0, -len); ctx.quadraticCurveTo(-len * 0.38, -len * 0.5, 0, 0); ctx.closePath();
    sf(ctx, i % 2 ? P.leaf : shade(P.leaf, 0.12), P.leafD, 1.6);
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, -len * 0.85); ctx.strokeStyle = rgba(P.leafL, 0.8); ctx.lineWidth = 0.6; ctx.stroke();
    ctx.restore();
  }
}
function gardenBack(ctx, L, P) {
  const G = gardenGeo(L);
  if (L >= 2) for (const s of [-1, 1]) {
    const px = s * (G.rx + 6);
    leafCluster(ctx, px, -9, 10, P, 40 + s);
    ctx.beginPath(); ctx.moveTo(px - 6, -9); ctx.lineTo(px + 6, -9); ctx.lineTo(px + 4.5, 0); ctx.lineTo(px - 4.5, 0); ctx.closePath();
    sf(ctx, P.stray ? '#a98a72' : '#d9824f', P.line, 1.8);
    rr(ctx, px - 7, -11, 14, 3, 1); sf(ctx, P.stray ? '#c0a088' : '#ef9a64', P.line, 1.4);
  }
  cyl(ctx, 0, G.soilY, -1, G.rx, 9, P.stray ? '#a98a72' : '#cf7446', P.stray ? '#5e4a3c' : '#5a3b2a', P.line);
  ell(ctx, 0, G.soilY, G.rx, 9); ctx.strokeStyle = P.stray ? '#c0a088' : '#ef9a64'; ctx.lineWidth = 2.6; ctx.stroke();
  // back glass
  ctx.beginPath(); ctx.ellipse(0, G.soilY, G.rx - 2, G.dh, 0, Math.PI, TAU); ctx.closePath();
  ctx.fillStyle = P.stray ? 'rgba(210,220,215,0.18)' : 'rgba(200,245,255,0.2)'; ctx.fill();
  if (!P.stray) {
    const gl = ctx.createRadialGradient(0, G.soilY - G.dh * 0.35, 0, 0, G.soilY - G.dh * 0.35, G.dh);
    gl.addColorStop(0, 'rgba(180,255,150,0.5)'); gl.addColorStop(1, 'rgba(180,255,150,0)');
    ctx.fillStyle = gl; ctx.fill();
  }
  // plants
  const xs = [-0.62, -0.3, 0, 0.32, 0.64];
  xs.forEach((f, i) => leafCluster(ctx, f * G.rx, G.soilY + 3 - (i % 2) * 2, 13 + (2 - Math.abs(i - 2)) * 4 + L * 1.5, P, 7 + i * 13));
  if (!P.stray) {
    for (const f of [-0.45, 0.12, 0.5]) {
      const fx = f * G.rx, fy = G.soilY - 18 - (f === 0.12 ? 8 : 0);
      ctx.strokeStyle = P.leafD; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fx, G.soilY); ctx.lineTo(fx, fy); ctx.stroke();
      for (let k = 0; k < 4; k++) { circ(ctx, fx + (k % 2 ? 1 : -1), fy + k * 2.2, 1.5); sf(ctx, '#d7b8ff', '#7d5aa8', 0.9); }
    }
  }
}
function gardenFront(ctx, L, P) {
  const G = gardenGeo(L);
  const rx = G.rx - 2;
  const brass = P.stray ? '#a69a80' : '#e8b955';
  const arcs = () => {
    ctx.beginPath(); ctx.ellipse(0, G.soilY, rx, G.dh, 0, Math.PI, TAU);
    for (const k of [0.6]) { ctx.moveTo(-rx * k, G.soilY); ctx.ellipse(0, G.soilY, rx * k, G.dh, 0, Math.PI, TAU); }
    ctx.moveTo(rx * 0.83, G.soilY - G.dh * 0.55); ctx.ellipse(0, G.soilY - G.dh * 0.55, rx * 0.83, 3.2, 0, 0, Math.PI);
  };
  ctx.beginPath(); ctx.ellipse(0, G.soilY, rx, G.dh, 0, Math.PI, TAU); ctx.closePath();
  const gg = ctx.createLinearGradient(-rx, G.apex, rx * 0.6, G.soilY);
  gg.addColorStop(0, P.stray ? 'rgba(235,240,235,0.32)' : 'rgba(225,250,255,0.42)');
  gg.addColorStop(0.5, 'rgba(210,245,255,0.1)');
  gg.addColorStop(1, P.stray ? 'rgba(200,210,200,0.2)' : 'rgba(170,230,255,0.24)');
  ctx.fillStyle = gg; ctx.fill();
  arcs(); ctx.strokeStyle = P.line; ctx.lineWidth = 2.6; ctx.stroke();
  arcs(); ctx.strokeStyle = brass; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, G.soilY, rx * 0.72, G.dh * 0.88, 0, Math.PI * 1.13, Math.PI * 1.38);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, G.soilY, rx * 0.72, G.dh * 0.88, 0, Math.PI * 1.45, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, G.soilY, rx, 9, 0, 0.05, Math.PI - 0.05); ctx.strokeStyle = P.line; ctx.lineWidth = 4.6; ctx.stroke();
  ctx.strokeStyle = P.roof; ctx.lineWidth = 2.6; ctx.stroke();
  circ(ctx, 0, G.apex, 3.4); sf(ctx, P.roof, P.line, 1.8);
  if (L === 3) {
    rr(ctx, -1.2, G.apex - 7, 2.4, 5, 0.6); sf(ctx, brass, P.line, 1.2);
    const og = ctx.createRadialGradient(-1.2, G.apex - 11.5, 0, 0, G.apex - 10, 5);
    og.addColorStop(0, '#ffffff'); og.addColorStop(0.4, P.stray ? '#c9d6c0' : '#b6ffb0'); og.addColorStop(1, P.stray ? '#7d8f74' : '#2fd46a');
    circ(ctx, 0, G.apex - 10, 4.8); sf(ctx, og, P.line, 1.6);
  }
  drawPips(ctx, L, G.top - 6);
}
function gardenMid(ctx, L, P, t, ph) {
  if (P.stray) return;
  const G = gardenGeo(L);
  for (let i = 0; i < 7; i++) {
    const p = (t * 0.33 + i / 7 + ph) % 1;
    const x = Math.sin(i * 2.3 + t * 0.8) * (G.rx - 8) * (1 - p * 0.4);
    const y = G.soilY - 6 - p * (G.dh - 10);
    const s = 1.9 * Math.sin(p * Math.PI);
    ctx.globalAlpha = Math.sin(p * Math.PI);
    sparkle(ctx, x, y, s + 0.3, i % 2 ? '#f4ffd8' : '#c8ff9a');
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- grand cat tree
function sleepyCat(ctx, x, y, s, furId, flip = 1) {
  const P = furPal(FUR_BY_ID[furId] || FURS[0]);
  ctx.save(); ctx.translate(x, y); ctx.scale(s * flip, s);
  ctx.beginPath(); ctx.moveTo(-7, -1); ctx.quadraticCurveTo(-11, 1, -5, 1.6); ctx.quadraticCurveTo(2, 2.4, 6, 0.5);
  ctx.strokeStyle = P.line; ctx.lineWidth = 3.6; ctx.lineCap = 'round'; ctx.stroke(); ctx.strokeStyle = P.base; ctx.lineWidth = 2.4; ctx.stroke();
  ell(ctx, -1, -3.2, 7.6, 4.4); sf(ctx, P.base, P.line, 1.1);
  if (P.pat === 'tabby') { ctx.strokeStyle = P.dark; ctx.lineWidth = 1.1; for (let k = -4; k <= 2; k += 2.6) { ctx.beginPath(); ctx.moveTo(k, -7.4); ctx.quadraticCurveTo(k + 1, -4.5, k + 0.4, -2.5); ctx.stroke(); } }
  for (const a of [-0.6, 0.6]) { ctx.beginPath(); ctx.moveTo(4.8 + a * 2.4, -5.5); ctx.lineTo(5.4 + a * 4.2, -9.6); ctx.lineTo(5.6 + a * 0.4 + (a > 0 ? 2.4 : 0), -6.2); ctx.closePath(); sf(ctx, P.base, P.line, 1.1); }
  ell(ctx, 5.6, -4.2, 4.0, 3.5); sf(ctx, P.base, P.line, 1.1);
  ctx.strokeStyle = P.isDark ? '#ddd' : '#2b2135'; ctx.lineWidth = 0.55;
  ctx.beginPath(); ctx.arc(4.3, -4.4, 0.8, 0.2, Math.PI - 0.2); ctx.moveTo(7.7, -4.4); ctx.arc(7.0, -4.4, 0.8, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,110,150,0.45)'; ell(ctx, 3.4, -3.0, 0.9, 0.5); ctx.fill(); ell(ctx, 8.2, -3.0, 0.9, 0.5); ctx.fill();
  ctx.restore();
}
function sisalPost(ctx, P, x, top, bot, w) {
  rr(ctx, x - w, top, w * 2, bot - top, 2); sf(ctx, P.sisal, P.line, 2.2);
  ctx.save(); rr(ctx, x - w, top, w * 2, bot - top, 2); ctx.clip();
  ctx.strokeStyle = P.sisalD; ctx.lineWidth = 0.7;
  for (let y = top + 2; y < bot; y += 2.3) { ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y + 1.4, x + w, y); ctx.stroke(); }
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(60,30,10,0.3)');
  ctx.fillStyle = g; ctx.fillRect(x - w, top, w * 2, bot - top);
  ctx.restore();
}
const CT_LIGHTS = [[-44, -116], [-30, -128], [-14, -136], [4, -140], [22, -136], [38, -128], [50, -116]];
function catTreeBack(ctx, L, P) {
  // canopy
  const blobs = [[-40, -120, 17], [42, -122, 18], [-24, -148, 22], [24, -152, 24], [0, -168, 25], [-6, -140, 20]];
  ctx.beginPath(); for (const [x, y, r] of blobs) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  sf(ctx, P.leafD, P.line, 2.6);
  ctx.save(); ctx.clip();
  for (const [x, y, r] of blobs) { circ(ctx, x - r * 0.15, y - r * 0.2, r * 0.82); ctx.fillStyle = P.leaf; ctx.fill(); }
  for (const [x, y, r] of blobs) { circ(ctx, x - r * 0.35, y - r * 0.4, r * 0.4); ctx.fillStyle = P.leafL; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
  // garland
  ctx.beginPath(); ctx.moveTo(CT_LIGHTS[0][0], CT_LIGHTS[0][1]);
  for (let i = 1; i < CT_LIGHTS.length; i++) { const [x0, y0] = CT_LIGHTS[i - 1], [x1, y1] = CT_LIGHTS[i]; ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 5, x1, y1); }
  ctx.strokeStyle = P.line; ctx.lineWidth = 0.8; ctx.stroke();
  // base
  cyl(ctx, 0, -8, 0, 52, 14, P.carpetD, P.carpet, P.line);
  ctx.beginPath(); ctx.ellipse(0, -4, 51.5, 14, 0, 0.08, Math.PI - 0.08); ctx.strokeStyle = P.roof; ctx.lineWidth = 2.6; ctx.stroke();
  ell(ctx, 0, -8, 42, 10.5); sf(ctx, P.roofL, P.line, 1.6);
  ell(ctx, 0, -8, 34, 8); ctx.strokeStyle = rgba(P.roof, 0.7); ctx.lineWidth = 1.6; ctx.setLineDash([3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
  sisalPost(ctx, P, -34, -64, -7, 6);
  sisalPost(ctx, P, 31, -92, -7, 6);
  sisalPost(ctx, P, 0, -132, -7, 9.5);
  for (const [bx, by, c] of [[-16, -6, '#ff8fb8'], [22, -4, '#7fd6ff']]) yarnBall(ctx, bx, by, 3.6, P.stray ? '#c9b9a3' : c, P.stray ? '#a39580' : shade(c, -0.25), '#ffffff', P.line);
  // hammock
  ctx.beginPath(); ctx.moveTo(-30, -40); ctx.quadraticCurveTo(-18, -24, -7, -40); ctx.quadraticCurveTo(-18, -32, -30, -40); ctx.closePath();
  sf(ctx, P.roofL, P.line, 1.8);
  // cubby
  rr(ctx, -14, -84, 28, 28, 5); sf(ctx, P.roof, P.line, 2.4);
  ctx.save(); rr(ctx, -14, -84, 28, 28, 5); ctx.clip(); gloss(ctx, 0, -70, 14, 14, 0.35); underShade(ctx, 0, -70, 14, 14, 0.25); ctx.restore();
  circ(ctx, 0, -69, 7.5); sf(ctx, '#2a1d26', P.line, 2);
  ctx.fillStyle = P.stray ? '#c8c06a' : '#ffe34d';
  ell(ctx, -2.6, -70, 1.2, 1.6); ctx.fill(); ell(ctx, 2.6, -70, 1.2, 1.6); ctx.fill();
  ctx.fillStyle = '#2a1d26'; ell(ctx, -2.6, -70, 0.35, 1.2); ctx.fill(); ell(ctx, 2.6, -70, 0.35, 1.2); ctx.fill();
  // platforms
  cyl(ctx, -34, -64, -59, 19, 5.6, P.roofD, P.roof, P.line, 2.2);
  sleepyCat(ctx, -35, -64, 1.0, P.stray ? 'gray' : 'ginger', 1);
  cyl(ctx, 31, -92, -87, 19, 5.6, P.roofD, P.roof, P.line, 2.2);
  sleepyCat(ctx, 31, -92, 0.9, P.stray ? 'cream' : 'calico', -1);
  cyl(ctx, 0, -132, -125, 27, 8, P.roofD, P.roof, P.line, 2.4);
  sleepyCat(ctx, -2, -133, 1.15, P.stray ? 'white' : 'graytabby', 1);
  // scratch marks
  ctx.strokeStyle = 'rgba(255,240,210,0.8)'; ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(1 + k * 2, -30 - k); ctx.lineTo(4 + k * 2, -18 - k); ctx.stroke(); }
}
function catTreeLive(ctx, L, P, t, ph) {
  // fairy lights
  const cols = ['#ff6fa8', '#ffe066', '#7cf0ff', '#a6ff8a'];
  for (let i = 0; i < CT_LIGHTS.length; i++) {
    const [x, y] = CT_LIGHTS[i];
    const on = P.stray ? 0.25 : 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7 + ph * 6);
    ctx.globalAlpha = on * 0.45; circ(ctx, x, y + 2, 3.2); ctx.fillStyle = cols[i % 4]; ctx.fill();
    ctx.globalAlpha = Math.min(1, on + 0.2); circ(ctx, x, y + 2, 1.4); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // hanging toy mouse
  const a = Math.sin(t * 2.1 + ph * 6) * 0.35;
  const ox = 40, oy = -87, len = 20;
  const mx = ox + Math.sin(a) * len, my = oy + Math.cos(a) * len;
  ctx.strokeStyle = '#6b5a50'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(mx, my); ctx.stroke();
  ctx.save(); ctx.translate(mx, my + 3); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(-3.5, 2); ctx.quadraticCurveTo(-7, 4, -6, 7); ctx.strokeStyle = '#ff9fb4'; ctx.lineWidth = 0.8; ctx.stroke();
  ell(ctx, 0, 0, 4.4, 3.4); sf(ctx, '#b9b3c4', P.line, 1.4);
  circ(ctx, -1.6, -2.8, 1.5); sf(ctx, '#ffb3c7', P.line, 0.9); circ(ctx, 1.6, -2.8, 1.5); sf(ctx, '#ffb3c7', P.line, 0.9);
  circ(ctx, 0, 1.4, 0.7); ctx.fillStyle = '#ff6f8f'; ctx.fill();
  ctx.fillStyle = '#2b2135'; circ(ctx, -1.2, -0.2, 0.5); ctx.fill(); circ(ctx, 1.2, -0.2, 0.5); ctx.fill();
  ctx.restore();
  // zzz
  ctx.fillStyle = 'rgba(70,60,110,0.85)';
  for (let i = 0; i < 2; i++) {
    const p = (t * 0.35 + i * 0.5 + ph) % 1;
    ctx.globalAlpha = Math.sin(p * Math.PI);
    ctx.font = `bold ${4 + p * 4}px sans-serif`;
    ctx.fillText('z', 6 + p * 8, -142 - p * 14);
  }
  ctx.globalAlpha = 1;
  if (!P.stray) drawFlag(ctx, 22, -134, 44, 22, P, t, ph);
}

// ---------------------------------------------------------------- building API
const BEXT = {
  cottage: { hw: 66, top: 112, bot: 20, R0: 36, fit: [52, 96] },
  tower:   { hw: 50, top: 140, bot: 18, R0: 36, fit: [36, 132] },
  forge:   { hw: 62, top: 112, bot: 18, R0: 37, fit: [46, 104] },
  garden:  { hw: 60, top: 108, bot: 18, R0: 36, fit: [44, 100] },
  cattree: { hw: 82, top: 200, bot: 26, R0: 56, fit: [70, 196] },
};
const BDRAW = {
  cottage: { shadow: [46, 15], back: cottageBack, front: cottageFront, mid: null, live: cottageLive },
  tower:   { shadow: [34, 12], back: towerBack, front: towerFront, mid: towerMid, live: towerLive },
  forge:   { shadow: [46, 14], back: forgeBack, front: forgeFront, mid: null, live: forgeLive },
  garden:  { shadow: [42, 14], back: gardenBack, front: gardenFront, mid: gardenMid, live: null },
  cattree: { shadow: [66, 20], back: catTreeBack, front: null, mid: null, live: catTreeLive },
};
const BLD_PS = 2.5;
const _bcache = new Map();
function getLayers(type, L, owner, r) {
  const key = type + '|' + L + '|' + owner + '|' + Math.round(r * 4);
  let v = _bcache.get(key);
  if (v) return v;
  const e = BEXT[type], s = r / e.R0, P = bpal(owner), D = BDRAW[type];
  const mk = fn => {
    if (!fn) return null;
    const w = e.hw * 2 * s, h = (e.top + e.bot) * s;
    const c = makeCanvas(w * BLD_PS, h * BLD_PS);
    const x = c.getContext('2d');
    x.scale(BLD_PS * s, BLD_PS * s); x.translate(e.hw, e.top);
    fn(x);
    return { canvas: c, w, h, ax: e.hw * s, ay: e.top * s };
  };
  v = {
    s, P,
    shadow: mk(x => drawShadow(x, D.shadow[0], D.shadow[1])),
    back: mk(x => D.back(x, L, P)),
    front: D.front ? mk(x => D.front(x, L, P)) : null,
  };
  _bcache.set(key, v);
  return v;
}
function blit(ctx, l, x, y) { if (l) ctx.drawImage(l.canvas, x - l.ax, y - l.ay, l.w, l.h); }

export function drawBuilding(ctx, b, t) {
  const type = BDRAW[b.type] ? b.type : 'cottage';
  const B = BUILDINGS[type];
  const L = Math.max(1, Math.min(B.maxLevel, (b.level | 0) || 1));
  const r = b.radius || B.radius[L - 1];
  const owner = b.owner == null ? -1 : b.owner;
  const layers = getLayers(type, L, owner, r);
  const D = BDRAW[type];
  const hit = Math.max(0, Math.min(1, b.hit || 0));
  const ph = (((b.x || 0) * 0.0131 + (b.y || 0) * 0.0173) % 1 + 1) % 1;
  blit(ctx, layers.shadow, b.x, b.y);
  ctx.save();
  let x = b.x, y = b.y;
  if (hit > 0) {
    x += Math.sin(t * 83) * hit * 1.6;
    ctx.translate(x, y); ctx.scale(1 + hit * 0.05, 1 - hit * 0.06); ctx.translate(-x, -y);
  }
  blit(ctx, layers.back, x, y);
  const live = fn => { if (!fn) return; ctx.save(); ctx.translate(x, y); ctx.scale(layers.s, layers.s); fn(ctx, L, layers.P, t, ph); ctx.restore(); };
  live(D.mid);
  blit(ctx, layers.front, x, y);
  live(D.live);
  const glow = (b.hover ? 0.16 : 0) + hit * 0.6;
  if (glow > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, glow);
    blit(ctx, layers.back, x, y);
    blit(ctx, layers.front, x, y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

export function buildingPreviewURL(type, level, owner, size = 96) {
  const key = 'b|' + type + '|' + level + '|' + owner + '|' + size;
  let u = _urlCache.get(key);
  if (u) return u;
  const T = BDRAW[type] ? type : 'cottage';
  const e = BEXT[T];
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const [fw, fh] = e.fit, bot = 14;
  const k = Math.min(size * 0.94 / (fw * 2), size * 0.94 / (fh + bot));
  ctx.translate(size / 2, size / 2 + (fh - bot) * k / 2);
  ctx.scale(k, k);
  drawBuilding(ctx, { x: 0, y: 0, type: T, level, owner, radius: e.R0 }, 0.6);
  u = c.toDataURL('image/png');
  _urlCache.set(key, u);
  return u;
}

// ================================================================ BACKGROUNDS
const DL = '#3f2a2c'; // decoration outline
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function softBlob(ctx, x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function groundGrad(ctx, a, b) {
  const g = ctx.createLinearGradient(0, 0, AW * 0.3, AH);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, AW, AH);
}
function tufts(ctx, rnd, n, cols, len = 5) {
  ctx.lineCap = 'round'; ctx.lineWidth = 1.3;
  for (let i = 0; i < n; i++) {
    const x = rnd() * AW, y = rnd() * AH, l = len * (0.6 + rnd() * 0.7);
    ctx.strokeStyle = cols[i % cols.length];
    ctx.beginPath();
    ctx.moveTo(x - 2, y - l * 0.8); ctx.lineTo(x, y); ctx.lineTo(x + 0.4, y - l);
    ctx.moveTo(x, y); ctx.lineTo(x + 2.4, y - l * 0.7);
    ctx.stroke();
  }
}
function tinyFlowers(ctx, rnd, n, cols) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * AW, y = rnd() * AH, c = cols[Math.floor(rnd() * cols.length)];
    ctx.fillStyle = c;
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; circ(ctx, x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5, 1.2); ctx.fill(); }
    circ(ctx, x, y, 0.9); ctx.fillStyle = '#ffd84a'; ctx.fill();
  }
}

// ---- ground painters
function gMeadow(ctx, rnd) {
  groundGrad(ctx, '#9fdc76', '#76bf55');
  for (let i = 0; i < 46; i++) softBlob(ctx, rnd() * AW, rnd() * AH, 60 + rnd() * 140, i % 2 ? '#c6f09a' : '#4f9a3c', 0.22);
  tufts(ctx, rnd, 1500, ['#5fa844', '#8fd36a', '#4e9638', '#a7e47f'], 6);
  tinyFlowers(ctx, rnd, 170, ['#ffffff', '#ffe066', '#ff8fb8', '#c7a6ff']);
}
function gRooftop(ctx, rnd) {
  groundGrad(ctx, '#dca07a', '#b07052');
  const cols = ['#c97c5a', '#b9694d', '#a86f6a', '#c98a5e', '#9a6a7a', '#b8785e'];
  const xs = [0];
  while (xs[xs.length - 1] < AW - 200) xs.push(xs[xs.length - 1] + 200 + rnd() * 220);
  xs.push(AW);
  const tile = (x0, y0, x1, y1, c) => {
    ctx.fillStyle = c; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.strokeStyle = rgba(shade(c, -0.28), 0.55); ctx.lineWidth = 1.2;
    for (let y = y0 + 8, row = 0; y < y1 + 10; y += 15, row++) for (let x = x0 - 10 + (row % 2) * 9; x < x1 + 10; x += 18) { ctx.beginPath(); ctx.arc(x, y, 9, 0.1, Math.PI - 0.1); ctx.stroke(); }
    const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(60,20,30,0.12)');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  };
  const gutters = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const split = 220 + rnd() * 460;
    tile(xs[i], 0, xs[i + 1], split, cols[(i * 2) % cols.length]);
    tile(xs[i], split, xs[i + 1], AH, cols[(i * 2 + 3) % cols.length]);
    gutters.push([xs[i], split, xs[i + 1], split]);
    if (i > 0) gutters.push([xs[i], 0, xs[i], AH]);
  }
  for (const [x0, y0, x1, y1] of gutters) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = 'rgba(70,40,35,0.75)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 - (y0 === y1 ? 0 : 2), y0 - (y0 === y1 ? 2 : 0)); ctx.lineTo(x1 - (y0 === y1 ? 0 : 2), y1 - (y0 === y1 ? 2 : 0)); ctx.strokeStyle = 'rgba(255,220,180,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (let i = 0; i < 20; i++) softBlob(ctx, rnd() * AW, rnd() * AH, 80 + rnd() * 120, i % 2 ? '#ffd2a0' : '#5a2c2c', 0.15);
  const sun = ctx.createLinearGradient(0, 0, 0, AH);
  sun.addColorStop(0, 'rgba(255,190,110,0.25)'); sun.addColorStop(1, 'rgba(120,60,120,0.18)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, AW, AH);
}
function gSnow(ctx, rnd) {
  groundGrad(ctx, '#f6faff', '#d7e6f6');
  for (let i = 0; i < 40; i++) {
    const x = rnd() * AW, y = rnd() * AH, r = 60 + rnd() * 120;
    softBlob(ctx, x, y + r * 0.25, r, '#9fbfe0', 0.18);
    softBlob(ctx, x, y, r * 0.9, '#ffffff', 0.55);
  }
  ctx.strokeStyle = 'rgba(150,180,215,0.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) { const x = rnd() * AW, y = rnd() * AH, w = 40 + rnd() * 60; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y - 12, x + w, y); ctx.stroke(); }
  for (let i = 0; i < 380; i++) { const x = rnd() * AW, y = rnd() * AH; circ(ctx, x, y, 0.6 + rnd() * 0.9); ctx.fillStyle = rnd() < 0.5 ? '#ffffff' : '#bfe0ff'; ctx.fill(); }
}
function gNight(ctx, rnd) {
  groundGrad(ctx, '#355772', '#1f3447');
  for (let i = 0; i < 40; i++) softBlob(ctx, rnd() * AW, rnd() * AH, 70 + rnd() * 140, i % 2 ? '#4f7a8c' : '#152536', 0.3);
  softBlob(ctx, AW * 0.78, AH * 0.18, 520, '#bcd6ff', 0.18);
  tufts(ctx, rnd, 1200, ['#2c4a5e', '#46708a', '#25404f'], 6);
  for (let i = 0; i < 90; i++) { const x = rnd() * AW, y = rnd() * AH; circ(ctx, x, y, 1 + rnd()); ctx.fillStyle = rnd() < 0.5 ? 'rgba(185,166,255,0.6)' : 'rgba(150,255,220,0.5)'; ctx.fill(); }
}
function gBeach(ctx, rnd) {
  groundGrad(ctx, '#f7e2ae', '#e8c98b');
  for (let i = 0; i < 40; i++) softBlob(ctx, rnd() * AW, rnd() * AH, 60 + rnd() * 140, i % 2 ? '#fff3cf' : '#d4ad6c', 0.28);
  ctx.strokeStyle = 'rgba(190,150,90,0.35)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 160; i++) { const x = rnd() * AW, y = 90 + rnd() * (AH - 180), w = 10 + rnd() * 18; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y - 4, x + w, y); ctx.stroke(); }
  for (let i = 0; i < 260; i++) { circ(ctx, rnd() * AW, rnd() * AH, 0.8); ctx.fillStyle = 'rgba(160,120,70,0.4)'; ctx.fill(); }
  // water bands
  const band = (top) => {
    const y0 = top ? 0 : AH - 62, y1 = top ? 62 : AH;
    const g = ctx.createLinearGradient(0, top ? 0 : AH, 0, top ? 62 : AH - 62);
    g.addColorStop(0, '#2a9fc4'); g.addColorStop(0.7, '#5fd0e6'); g.addColorStop(1, '#9de8f2');
    ctx.beginPath();
    const edge = x => (top ? 52 : AH - 52) + Math.sin(x * 0.02) * 6 * (top ? 1 : -1) + Math.sin(x * 0.053) * 3;
    ctx.moveTo(0, top ? 0 : AH);
    for (let x = 0; x <= AW; x += 20) ctx.lineTo(x, edge(x));
    ctx.lineTo(AW, top ? 0 : AH); ctx.closePath();
    ctx.fillStyle = 'rgba(200,170,120,0.5)'; ctx.save(); ctx.translate(0, top ? 6 : -6); ctx.fill(); ctx.restore();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); for (let x = 0; x <= AW; x += 20) ctx.lineTo(x, edge(x));
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { const x = rnd() * AW, y = y0 + rnd() * (y1 - y0 - 14) + (top ? 0 : 14); ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.quadraticCurveTo(x, y - 4, x + 9, y); ctx.stroke(); }
  };
  band(true); band(false);
}
function gCandy(ctx, rnd) {
  groundGrad(ctx, '#ffd3ea', '#ffb0d4');
  for (let i = 0; i < 36; i++) softBlob(ctx, rnd() * AW, rnd() * AH, 70 + rnd() * 140, i % 2 ? '#ffffff' : '#ff8fc4', 0.3);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * AW, y = rnd() * AH, r = 20 + rnd() * 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 6;
    ctx.beginPath(); for (let a = 0; a < TAU * 1.6; a += 0.2) { const rr2 = r * (1 - a / (TAU * 2)); ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * 0.6); } ctx.stroke();
  }
  const sc = ['#ff5d8f', '#ffd23d', '#5ad1ff', '#7cf08a', '#b48cff', '#ffffff', '#ff9a3d'];
  for (let i = 0; i < 900; i++) {
    const x = rnd() * AW, y = rnd() * AH, a = rnd() * Math.PI;
    ctx.strokeStyle = sc[i % sc.length]; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 2.2, y - Math.sin(a) * 2.2); ctx.lineTo(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2); ctx.stroke();
  }
}

// ---- trails between nearby buildings (straight, or along the walking routes when the renderer passes them)
function trailPairs(blds) {
  const pairs = new Set(), out = [];
  blds.forEach((b, i) => {
    const near = blds.map((o, j) => [j, Math.hypot(o.x - b.x, o.y - b.y)]).filter(([j]) => j !== i).sort((a, c) => a[1] - c[1]).slice(0, 2);
    for (const [j, d] of near) { const k = Math.min(i, j) + ':' + Math.max(i, j); if (!pairs.has(k) && d < 520) { pairs.add(k); out.push([blds[i], blds[j]]); } }
  });
  return out;
}
function drawTrails(ctx, theme, lines, rnd) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const P of lines) {
    if (!P || P.length < 2) continue;
    const line = (ox = 0, oy = 0) => { ctx.beginPath(); ctx.moveTo(P[0].x + ox, P[0].y + oy); for (let k = 1; k < P.length; k++) ctx.lineTo(P[k].x + ox, P[k].y + oy); };
    // per-segment details
    const each = fn => { for (let k = 1; k < P.length; k++) { const a = P[k - 1], b = P[k], len = Math.hypot(b.x - a.x, b.y - a.y) || 1; fn(a, b, len, (b.x - a.x) / len, (b.y - a.y) / len); } };
    if (theme === 'meadow') {
      line(); ctx.strokeStyle = 'rgba(150,115,60,0.25)'; ctx.lineWidth = 22; ctx.stroke();
      line(); ctx.strokeStyle = 'rgba(226,196,140,0.75)'; ctx.lineWidth = 15; ctx.stroke();
      each((a, b, len, ux, uy) => { for (let d = 10; d < len; d += 13) { circ(ctx, a.x + ux * d + (rnd() - 0.5) * 9, a.y + uy * d + (rnd() - 0.5) * 9, 1 + rnd() * 1.2); ctx.fillStyle = 'rgba(150,120,80,0.6)'; ctx.fill(); } });
    } else if (theme === 'rooftop' || theme === 'beach') {
      const wood = theme === 'beach' ? '#c99d6a' : '#a77a55';
      line(); ctx.strokeStyle = 'rgba(60,35,25,0.3)'; ctx.lineWidth = 20; ctx.stroke();
      line(); ctx.strokeStyle = wood; ctx.lineWidth = 15; ctx.stroke();
      ctx.strokeStyle = rgba(shade(wood, -0.35), 0.8); ctx.lineWidth = 1;
      each((a, b, len, ux, uy) => { for (let d = 4; d < len; d += 7) { const cx = a.x + ux * d, cy = a.y + uy * d; ctx.beginPath(); ctx.moveTo(cx - uy * 7.5, cy + ux * 7.5); ctx.lineTo(cx + uy * 7.5, cy - ux * 7.5); ctx.stroke(); } });
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
      each((a, b, len, ux, uy) => { ctx.beginPath(); ctx.moveTo(a.x - uy * 5, a.y + ux * 5); ctx.lineTo(b.x - uy * 5, b.y + ux * 5); ctx.stroke(); });
    } else if (theme === 'snow') {
      line(); ctx.strokeStyle = 'rgba(140,175,215,0.35)'; ctx.lineWidth = 20; ctx.stroke();
      line(); ctx.strokeStyle = 'rgba(232,242,252,0.95)'; ctx.lineWidth = 13; ctx.stroke();
      ctx.fillStyle = 'rgba(130,160,200,0.55)';
      each((a, b, len, ux, uy) => { for (let d = 14, k = 0; d < len - 8; d += 11, k++) { const s = k % 2 ? 3.5 : -3.5; const cx = a.x + ux * d - uy * s, cy = a.y + uy * d + ux * s; ell(ctx, cx, cy, 1.6, 1.3); ctx.fill(); circ(ctx, cx + ux * 2.2 - uy * 1.1, cy + uy * 2.2 + ux * 1.1, 0.55); ctx.fill(); circ(ctx, cx + ux * 2.2 + uy * 1.1, cy + uy * 2.2 - ux * 1.1, 0.55); ctx.fill(); } });
    } else if (theme === 'night') {
      each((a, b, len, ux, uy) => { for (let d = 12; d < len; d += 21) { const cx = a.x + ux * d + (rnd() - 0.5) * 4, cy = a.y + uy * d + (rnd() - 0.5) * 4; ell(ctx, cx, cy + 1.5, 7.5, 4.6); ctx.fillStyle = 'rgba(10,20,30,0.35)'; ctx.fill(); ell(ctx, cx, cy, 7.5, 4.6, rnd()); sf(ctx, '#6f8494', '#2a3a48', 1.6); ell(ctx, cx - 2, cy - 1.2, 3, 1.4); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill(); } });
    } else if (theme === 'candy') {
      line(); ctx.strokeStyle = 'rgba(150,80,60,0.25)'; ctx.lineWidth = 20; ctx.stroke();
      line(); ctx.strokeStyle = '#f1cf98'; ctx.lineWidth = 15; ctx.stroke();
      ctx.fillStyle = '#7a4a32';
      each((a, b, len, ux, uy) => { for (let d = 8; d < len; d += 12) { circ(ctx, a.x + ux * d + (rnd() - 0.5) * 8, a.y + uy * d + (rnd() - 0.5) * 8, 1.6); ctx.fill(); } });
    }
  }
}

// ---- terrain: water (with islands), bridges, mounds, rocks and hedges. Shapes come from shared/nav.js.
function shapePath(ctx, s, ox = 0, oy = 0) {
  ctx.beginPath();
  if (s.g === 'circle') { ctx.arc(s.x + ox, s.y + oy, Math.max(0.5, s.r), 0, TAU); return; }
  ctx.moveTo(s.pts[0][0] + ox, s.pts[0][1] + oy);
  for (let k = 1; k < s.pts.length; k++) ctx.lineTo(s.pts[k][0] + ox, s.pts[k][1] + oy);
  if (s.g === 'poly') ctx.closePath();
}
/** Paint a shape, grown outwards by `grow` world units (lines become thicker strokes). */
function paintShape(ctx, s, color, grow = 0, ox = 0, oy = 0) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (s.g === 'circle') { ctx.beginPath(); ctx.arc(s.x + ox, s.y + oy, Math.max(0.5, s.r + grow), 0, TAU); ctx.fill(); return; }
  shapePath(ctx, s, ox, oy);
  if (s.g === 'poly') { ctx.fill(); if (grow > 0) { ctx.lineWidth = grow * 2; ctx.stroke(); } }
  else { ctx.lineWidth = Math.max(1, s.w + grow * 2); ctx.stroke(); }
}
function clipShape(ctx, s) {
  if (s.g === 'line') {
    // a thick line has no fill path: clip to the union of its segment rectangles and joint circles
    ctx.beginPath();
    const r = s.w / 2;
    for (let k = 0; k < s.pts.length; k++) {
      const [x, y] = s.pts[k];
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      if (k) {
        const [px, py] = s.pts[k - 1], L = Math.hypot(x - px, y - py) || 1, nx = -(y - py) / L * r, ny = (x - px) / L * r;
        ctx.moveTo(px + nx, py + ny); ctx.lineTo(x + nx, y + ny); ctx.lineTo(x - nx, y - ny); ctx.lineTo(px - nx, py - ny); ctx.closePath();
      }
    }
  } else shapePath(ctx, s);
  ctx.clip('nonzero');
}
/** Random points inside a shape, at least `inset` from its edge. */
function pointsIn(s, n, rnd, inset = 0) {
  const out = [], b = s.box;
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const x = b[0] + rnd() * (b[2] - b[0]), y = b[1] + rnd() * (b[3] - b[1]);
    if (shapeDist(s, x, y) < -inset) out.push([x, y]);
  }
  return out;
}

const WATER_STYLE = {
  meadow:  { deep: '#3b9bd0', shallow: '#8fe2f2', rim: '#e4fbff', bank: '#d9c48c', wet: '#b99e66', edge: 'rgba(70,55,25,0.5)', detail: 'lily' },
  snow:    { deep: '#3a73a8', shallow: '#a3d8f2', rim: '#ffffff', bank: '#ffffff', wet: '#cfe2f6', edge: 'rgba(80,120,170,0.65)', detail: 'floes' },
  night:   { deep: '#13293f', shallow: '#3a6a8a', rim: '#a6d6ee', bank: '#4d6170', wet: '#33434f', edge: 'rgba(4,8,16,0.65)', detail: 'moon' },
  beach:   { deep: '#1b8bbd', shallow: '#6fe0ee', rim: '#ffffff', bank: '#f8e8bb', wet: '#e0bf82', edge: 'rgba(140,100,50,0.45)', detail: 'foam' },
  candy:   { deep: '#6a3820', shallow: '#a8673f', rim: '#ecc095', bank: '#f7dcaa', wet: '#e0b274', edge: 'rgba(110,55,35,0.55)', detail: 'cream' },
  rooftop: { deep: '#24161f', shallow: '#5b3a3d', rim: '#9a6a52', bank: '#7d4b3a', wet: '#5a3329', edge: 'rgba(25,8,8,0.65)', detail: 'alley' },
};
function waterDetails(ctx, style, water, rnd, inWater) {
  const spots = [];
  for (const s of water) for (const p of pointsIn(s, Math.ceil(((s.box[2] - s.box[0]) * (s.box[3] - s.box[1])) / 9000) + 2, rnd, 10)) if (inWater(p[0], p[1])) spots.push(p);
  ctx.lineCap = 'round';
  for (const [x, y] of spots) {
    const k = rnd();
    switch (style) {
      case 'lily':
        if (k < 0.3) { ell(ctx, x, y, 8, 4.5); ctx.fillStyle = '#5fbf5a'; ctx.fill(); ctx.strokeStyle = '#2f6b2a'; ctx.lineWidth = 1.2; ctx.stroke(); if (k < 0.12) { circ(ctx, x + 2, y - 1, 2); ctx.fillStyle = '#ff9fc4'; ctx.fill(); } }
        else { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.quadraticCurveTo(x, y - 4, x + 9, y); ctx.stroke(); }
        break;
      case 'floes':
        if (k < 0.35) { ctx.beginPath(); const r = 6 + rnd() * 9; for (let a = 0; a < 6; a++) { const rr2 = r * (0.7 + rnd() * 0.4); ctx.lineTo(x + Math.cos(a / 6 * TAU) * rr2, y + Math.sin(a / 6 * TAU) * rr2 * 0.6); } ctx.closePath(); sf(ctx, '#f4fbff', '#8fb8dc', 1.4); }
        else { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x, y - 3, x + 8, y); ctx.stroke(); }
        break;
      case 'moon':
        if (k < 0.25) { ell(ctx, x, y, 7, 4); ctx.fillStyle = '#2f6b55'; ctx.fill(); circ(ctx, x + 2, y - 1, 1.8); ctx.fillStyle = '#ffd6f4'; ctx.fill(); softBlob(ctx, x + 2, y - 1, 12, '#ffb3ec', 0.35); }
        else { ctx.strokeStyle = 'rgba(200,225,255,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.stroke(); }
        break;
      case 'foam':
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.quadraticCurveTo(x - 5, y - 4, x, y); ctx.quadraticCurveTo(x + 5, y - 4, x + 10, y); ctx.stroke();
        if (k < 0.12) sparkle(ctx, x, y - 6, 3, '#ffffff');
        break;
      case 'cream':
        ctx.strokeStyle = 'rgba(255,236,210,0.55)'; ctx.lineWidth = 2.4; ctx.beginPath();
        for (let a = 0; a < TAU * 1.3; a += 0.3) { const r = 2 + a * 1.6; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.55); }
        ctx.stroke();
        break;
      case 'alley':
        // the street far below: lit windows and the odd lamp
        if (k < 0.5) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,214,120,0.75)' : 'rgba(255,180,100,0.5)'; ctx.fillRect(x, y, 3, 4); ctx.fillRect(x + 6, y, 3, 4); }
        else if (k < 0.62) softBlob(ctx, x, y, 14, '#ffcf7a', 0.35);
        break;
    }
  }
}
function drawWaterLayer(ctx, theme, shapes, scale, rnd) {
  const water = shapes.filter(s => s.cls === 'water');
  if (!water.length) return;
  const isl = shapes.filter(s => s.t === 'island');
  const W = WATER_STYLE[theme] || WATER_STYLE.meadow;
  const BANK = 10;
  const pw = ctx.canvas.width, ph = ctx.canvas.height;
  const L = makeCanvas(pw, ph), lc = L.getContext('2d');
  lc.scale(scale, scale);
  for (const s of water) paintShape(lc, s, W.deep);
  // shallows: let the land cast a soft light-blue glow into the water along every shore
  const M = makeCanvas(pw, ph), mc = M.getContext('2d');
  mc.scale(scale, scale);
  mc.fillStyle = '#000'; mc.fillRect(0, 0, AW, AH);
  mc.globalCompositeOperation = 'destination-out';
  for (const s of water) paintShape(mc, s, '#000');
  mc.globalCompositeOperation = 'source-over';
  for (const s of isl) paintShape(mc, s, '#000');
  lc.save();
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = 'source-atop';
  lc.shadowColor = W.shallow; lc.shadowBlur = 30 * scale; lc.drawImage(M, 0, 0);
  lc.shadowColor = W.rim; lc.shadowBlur = 6 * scale; lc.drawImage(M, 0, 0);
  lc.restore();
  lc.save();
  lc.globalCompositeOperation = 'source-atop';
  const wet = makeBlockTest([...water, ...isl]);
  waterDetails(lc, W.detail, water, rnd, (x, y) => wet(x, y, 0));
  lc.restore();
  // banks: wet edge, dry edge and a dark outline, all tucked under the water
  lc.save();
  lc.globalCompositeOperation = 'destination-over';
  for (const s of water) paintShape(lc, s, W.wet, BANK * 0.45);
  for (const s of water) paintShape(lc, s, W.bank, BANK);
  for (const s of water) paintShape(lc, s, W.edge, BANK + 2.5);
  lc.restore();
  // islands: a beach ring, then cut the island out so the real ground shows through
  for (const s of isl) paintShape(lc, s, W.edge, BANK + 2.5);
  for (const s of isl) paintShape(lc, s, W.bank, BANK);
  for (const s of isl) paintShape(lc, s, W.wet, BANK * 0.45);
  lc.save();
  lc.globalCompositeOperation = 'destination-out';
  for (const s of isl) paintShape(lc, s, '#000');
  lc.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(L, 0, 0);
  ctx.restore();
}

const BRIDGE_STYLE = {
  meadow:  { deck: '#c99a5e', plank: '#8a5f36', rail: '#7a5232', post: '#5e3d22' },
  snow:    { deck: '#b98d64', plank: '#7f5b3d', rail: '#ffffff', post: '#6a4a33', snowy: true },
  night:   { deck: '#86735e', plank: '#4e4034', rail: '#3a3440', post: '#2a2530', lamp: true },
  beach:   { deck: '#d6ab76', plank: '#94693f', rail: '#f2e2c0', post: '#7a5232', rope: true },
  candy:   { deck: '#ebbc7c', plank: '#b98249', rail: '#ff5d8f', post: '#ffffff', stripes: true },
  rooftop: { deck: '#b3865c', plank: '#6e4c32', rail: null, post: '#5a3d28' },
};
function drawBridge(ctx, theme, s) {
  const B = BRIDGE_STYLE[theme] || BRIDGE_STYLE.meadow;
  const P = s.pts, hw = s.w * 0.42;
  for (let k = 1; k < P.length; k++) {
    const [ax, ay] = P[k - 1], [bx, by] = P[k];
    const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
    const quad = (o0, o1, e = 0) => { ctx.beginPath(); ctx.moveTo(ax - ux * e + nx * o0, ay - uy * e + ny * o0); ctx.lineTo(bx + ux * e + nx * o0, by + uy * e + ny * o0); ctx.lineTo(bx + ux * e + nx * o1, by + uy * e + ny * o1); ctx.lineTo(ax - ux * e + nx * o1, ay - uy * e + ny * o1); ctx.closePath(); };
    // shadow on the water, then the deck
    ctx.save(); ctx.translate(3, 7); quad(-hw, hw); ctx.fillStyle = 'rgba(10,20,30,0.28)'; ctx.fill(); ctx.restore();
    quad(-hw, hw); sf(ctx, B.deck, DL, 3);
    ctx.save(); quad(-hw, hw); ctx.clip();
    ctx.strokeStyle = rgba(B.plank, 0.85); ctx.lineWidth = 1.4;
    for (let d = 6; d < L; d += 10) { ctx.beginPath(); ctx.moveTo(ax + ux * d + nx * hw, ay + uy * d + ny * hw); ctx.lineTo(ax + ux * d - nx * hw, ay + uy * d - ny * hw); ctx.stroke(); }
    if (B.stripes) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; for (let o = -hw + 6; o < hw; o += 8) { ctx.beginPath(); ctx.moveTo(ax + nx * o, ay + ny * o); ctx.lineTo(bx + nx * o, by + ny * o); ctx.stroke(); } }
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; quad(-hw, -hw * 0.55); ctx.fill();
    ctx.restore();
    // rails and posts
    for (const side of [-1, 1]) {
      const o = side * hw;
      if (B.rail) {
        ctx.beginPath(); ctx.moveTo(ax + nx * o, ay + ny * o - 5); ctx.lineTo(bx + nx * o, by + ny * o - 5);
        ctx.strokeStyle = DL; ctx.lineWidth = B.rope ? 3.2 : 5; ctx.stroke();
        ctx.strokeStyle = B.rail; ctx.lineWidth = B.rope ? 1.6 : 3; ctx.stroke();
        if (B.stripes) { ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.setLineDash([]); }
      }
      for (let d = 0; d <= L + 0.1; d += Math.max(22, L / Math.max(1, Math.round(L / 34)))) {
        const px = ax + ux * d + nx * o, py = ay + uy * d + ny * o;
        rr(ctx, px - 2.6, py - 9, 5.2, 10, 1.5); sf(ctx, B.post, DL, 1.6);
        if (B.snowy) { ell(ctx, px, py - 9, 3.4, 1.8); ctx.fillStyle = '#ffffff'; ctx.fill(); }
      }
    }
    if (B.lamp) for (const [lx, ly] of [[ax + nx * hw, ay + ny * hw], [bx - nx * hw, by - ny * hw]]) { softBlob(ctx, lx, ly - 16, 26, '#ffd37a', 0.5); rr(ctx, lx - 3, ly - 20, 6, 8, 2); sf(ctx, '#ffe9a0', DL, 1.4); }
  }
}

// solid terrain: top / side colours, height and texture per theme
const SOLID_STYLE = {
  meadow:  { mound: { top: '#b48452', side: '#7c5330', h: 14, tex: 'dirt' },  rock: { top: '#bdb7be', side: '#86808a', h: 18, tex: 'rock', cap: '#86cf6a' }, hedge: { top: '#5cc25a', side: '#37803b', h: 16, tex: 'leaves', bloom: '#ffb3d1' }, wall: { top: '#c9c2b4', side: '#8e877a', h: 18, tex: 'stones' } },
  snow:    { mound: { top: '#ffffff', side: '#b6cfea', h: 14, tex: 'drift' }, rock: { top: '#a9b4c6', side: '#717e95', h: 18, tex: 'rock', cap: '#ffffff' }, hedge: { top: '#e2f3ff', side: '#93c4ea', h: 16, tex: 'ice' }, wall: { top: '#e2f3ff', side: '#93c4ea', h: 18, tex: 'ice' } },
  night:   { mound: { top: '#5e6c7b', side: '#36414e', h: 14, tex: 'glow' },  rock: { top: '#6a7786', side: '#3b4653', h: 18, tex: 'rock', cap: '#4f8a6a' }, hedge: { top: '#2f6b55', side: '#1b4537', h: 16, tex: 'leaves', bloom: '#c9a6ff', glow: true }, wall: { top: '#5e6c7b', side: '#36414e', h: 18, tex: 'stones' } },
  beach:   { mound: { top: '#f5dda6', side: '#d0aa68', h: 13, tex: 'dune' },  rock: { top: '#a9a19a', side: '#706962', h: 18, tex: 'rock', cap: '#ff8a5a' }, hedge: { top: '#b9b1a8', side: '#7b736c', h: 16, tex: 'stones' }, wall: { top: '#c99d6a', side: '#8a6440', h: 16, tex: 'planks' } },
  candy:   { mound: { top: '#a8673f', side: '#663620', h: 14, tex: 'choc' },  rock: { top: '#bdf1ff', side: '#79c3dd', h: 18, tex: 'facets' }, gumdrop: { top: '#7cf08a', side: '#3fb85a', h: 20, tex: 'sugar', colors: ['#7cf08a', '#ffd23d', '#b48cff', '#ff7aa8', '#5ad1ff', '#ff9a3d'] }, hedge: { top: '#fff2f8', side: '#ff5d8f', h: 16, tex: 'stripes' }, wall: { top: '#fff2f8', side: '#ff5d8f', h: 16, tex: 'stripes' } },
  rooftop: { mound: { top: '#8d8698', side: '#58526a', h: 16, tex: 'vents' }, rock: { top: '#aaa5b4', side: '#6c6678', h: 16, tex: 'vents' }, hedge: { top: '#ead8b4', side: '#8a3f2e', h: 20, tex: 'coping' }, wall: { top: '#ead8b4', side: '#8a3f2e', h: 20, tex: 'coping' } },
};
function solidStyle(theme, t, s) {
  const T = SOLID_STYLE[theme] || SOLID_STYLE.meadow, S = T[t] || T.mound;
  if (!S.colors || !s) return S;
  // each gumdrop gets its own flavour
  const c = S.colors[Math.abs(Math.round(s.box[0] * 7 + s.box[1] * 13)) % S.colors.length];
  return { ...S, top: c, side: shade(c, -0.3) };
}
function solidTexture(ctx, S, s, rnd, theme) {
  const isLine = s.g === 'line';
  // detail spots: inside a blob, or along a wall
  const spots = [];
  if (isLine) {
    for (let k = 1; k < s.pts.length; k++) {
      const [ax, ay] = s.pts[k - 1], [bx, by] = s.pts[k], L = Math.hypot(bx - ax, by - ay) || 1;
      for (let d = 0; d < L; d += 9) { const o = (rnd() - 0.5) * s.w * 0.6; spots.push([ax + (bx - ax) * d / L - (by - ay) / L * o, ay + (by - ay) * d / L + (bx - ax) / L * o, (bx - ax) / L, (by - ay) / L]); }
    }
  } else for (const p of pointsIn(s, Math.ceil(((s.box[2] - s.box[0]) * (s.box[3] - s.box[1])) / 260), rnd, 3)) spots.push([p[0], p[1], 1, 0]);
  ctx.lineCap = 'round';
  switch (S.tex) {
    case 'dirt':
      for (const [x, y] of spots) { const k = rnd(); if (k < 0.35) { ell(ctx, x, y, 2.6, 1.8); ctx.fillStyle = 'rgba(90,58,30,0.55)'; ctx.fill(); } else if (k < 0.5) { ell(ctx, x, y, 3.4, 2.4); sf(ctx, '#cfc6bc', DL, 1); } else if (k < 0.62) { ctx.strokeStyle = '#5fa844'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 2, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + 2.4, y - 4); ctx.stroke(); } }
      break;
    case 'drift':
      for (const [x, y] of spots) { if (rnd() < 0.3) { ctx.strokeStyle = 'rgba(150,185,225,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x, y - 3, x + 7, y); ctx.stroke(); } else if (rnd() < 0.15) sparkle(ctx, x, y, 2.4, '#bfe0ff'); }
      break;
    case 'glow':
      for (const [x, y] of spots) { const k = rnd(); if (k < 0.08) dMushroom(ctx, x, y + 4, 0.45, k < 0.04 ? '#7cf0ff' : '#ff8fd0', true); else if (k < 0.35) { ell(ctx, x, y, 3, 2); ctx.fillStyle = 'rgba(79,138,106,0.7)'; ctx.fill(); } }
      break;
    case 'dune':
      ctx.strokeStyle = 'rgba(190,150,90,0.5)'; ctx.lineWidth = 1.3;
      for (const [x, y] of spots) { const k = rnd(); if (k < 0.3) { ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.quadraticCurveTo(x, y - 4, x + 9, y); ctx.stroke(); } else if (k < 0.4) { ctx.strokeStyle = '#7fae4a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 8); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 9); ctx.moveTo(x, y); ctx.lineTo(x + 4, y - 7); ctx.stroke(); ctx.strokeStyle = 'rgba(190,150,90,0.5)'; ctx.lineWidth = 1.3; } }
      break;
    case 'choc':
      for (const [x, y] of spots) { const k = rnd(); if (k < 0.18) { ctx.strokeStyle = ['#ff5d8f', '#ffd23d', '#5ad1ff', '#7cf08a', '#ffffff'][Math.floor(rnd() * 5)]; ctx.lineWidth = 2; const a = rnd() * Math.PI; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 2.5, y - Math.sin(a) * 2.5); ctx.lineTo(x + Math.cos(a) * 2.5, y + Math.sin(a) * 2.5); ctx.stroke(); } else if (k < 0.24) { ctx.strokeStyle = 'rgba(255,240,225,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.bezierCurveTo(x - 3, y - 5, x + 3, y + 5, x + 8, y); ctx.stroke(); } }
      break;
    case 'rock':
      for (const [x, y] of spots) { const k = rnd(); if (k < 0.18) { ctx.strokeStyle = 'rgba(40,30,40,0.45)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x - 5, y - 2); ctx.lineTo(x, y + 1); ctx.lineTo(x + 3, y - 3); ctx.stroke(); } else if (k < 0.3 && S.cap) { ell(ctx, x, y, 4, 2.5); ctx.fillStyle = rgba(S.cap, 0.75); ctx.fill(); } }
      break;
    case 'facets':
      for (const [x, y] of spots) { if (rnd() < 0.3) { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(255,170,220,0.5)'; ctx.fill(); } }
      break;
    case 'leaves':
      for (const [x, y] of spots) { const k = rnd(); circ(ctx, x, y, 3.5 + rnd() * 2.5); ctx.fillStyle = rgba(shade(S.top, k < 0.5 ? 0.25 : -0.15), 0.85); ctx.fill(); if (k < 0.1 && S.bloom) { circ(ctx, x, y, 2); ctx.fillStyle = S.bloom; ctx.fill(); if (S.glow) softBlob(ctx, x, y, 9, S.bloom, 0.5); } }
      break;
    case 'ice':
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.3;
      for (const [x, y] of spots) { if (rnd() < 0.25) { ctx.beginPath(); ctx.moveTo(x - 4, y - 3); ctx.lineTo(x + 1, y); ctx.lineTo(x - 1, y + 3); ctx.stroke(); } }
      break;
    case 'stripes':
      for (const [x, y, ux, uy] of spots) { if (rnd() < 0.55) { ctx.strokeStyle = 'rgba(255,93,143,0.85)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x - uy * 9 - ux * 4, y + ux * 9 - uy * 4); ctx.lineTo(x + uy * 9 + ux * 4, y - ux * 9 + uy * 4); ctx.stroke(); } }
      break;
    case 'stones':
      for (const [x, y] of spots) { ell(ctx, x, y, 4 + rnd() * 3, 3 + rnd() * 2, rnd()); ctx.fillStyle = rgba(shade(S.top, rnd() < 0.5 ? 0.2 : -0.15), 0.9); ctx.fill(); ctx.strokeStyle = 'rgba(40,30,40,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
      break;
    case 'planks':
      ctx.strokeStyle = 'rgba(80,50,30,0.6)'; ctx.lineWidth = 1.2;
      for (const [x, y, ux, uy] of spots) { ctx.beginPath(); ctx.moveTo(x - uy * 8, y + ux * 8); ctx.lineTo(x + uy * 8, y - ux * 8); ctx.stroke(); }
      break;
    case 'sugar':
      for (const [x, y] of spots) { if (rnd() < 0.45) { circ(ctx, x, y, 0.9 + rnd() * 0.8); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill(); } }
      break;
    case 'coping':
      ctx.strokeStyle = 'rgba(120,80,50,0.55)'; ctx.lineWidth = 1.4;
      for (const [x, y, ux, uy] of spots) { if (rnd() < 0.5) { ctx.beginPath(); ctx.moveTo(x - uy * 30, y + ux * 30); ctx.lineTo(x + uy * 30, y - ux * 30); ctx.stroke(); } }
      break;
    case 'bricks':
      ctx.strokeStyle = 'rgba(70,25,20,0.45)'; ctx.lineWidth = 1;
      for (const [x, y] of spots) { if (rnd() < 0.6) { ctx.strokeRect(x - 5, y - 2.5, 10, 5); } }
      break;
    case 'vents':
      for (const [x, y] of spots) { if (rnd() < 0.12) { rr(ctx, x - 7, y - 5, 14, 10, 2); sf(ctx, '#cfcad8', DL, 1.2); ctx.strokeStyle = 'rgba(60,55,70,0.6)'; ctx.lineWidth = 1; for (let k = -4; k <= 4; k += 2.6) { ctx.beginPath(); ctx.moveTo(x + k, y - 3); ctx.lineTo(x + k, y + 3); ctx.stroke(); } } }
      break;
  }
}
// bushy / rocky walls are drawn as a chain of overlapping clumps instead of one smooth tube
const LUMPY = { leaves: 1, stones: 1, drift: 1, dune: 1, dirt: 1, glow: 1, choc: 1, rock: 1 };
function lumps(s, rnd) {
  const out = [], r0 = s.w / 2;
  for (let k = 1; k < s.pts.length; k++) {
    const [ax, ay] = s.pts[k - 1], [bx, by] = s.pts[k], L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
    const n = Math.max(1, Math.round(L / (s.w * 0.42)));
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const u = i / n, o = (rnd() - 0.5) * s.w * 0.12, r = r0 * (0.88 + rnd() * 0.16);
      out.push({ g: 'circle', x: ax + (bx - ax) * u + nx * o, y: ay + (by - ay) * u + ny * o, r });
    }
  }
  return out;
}
function drawLumpy(ctx, S, s, rnd, theme) {
  const H = S.h, step = 2.5, B = lumps(s, rnd);
  for (const b of B) paintShape(ctx, b, 'rgba(30,20,30,0.2)', 3, 7, H + 4);
  for (let oy = H; oy >= 0; oy -= step) for (const b of B) paintShape(ctx, b, DL, 2.2, 0, oy);
  for (let oy = H; oy >= 0; oy -= step) for (const b of B) paintShape(ctx, b, S.side, 0, 0, oy);
  for (const b of B) paintShape(ctx, b, rgba(DL, 0.9), 1.4);
  for (const b of B) paintShape(ctx, b, S.top);
  // each clump gets its own soft highlight, so the wall reads as bushes / boulders
  for (const b of B) { circ(ctx, b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.55); ctx.fillStyle = rgba(shade(S.top, 0.3), 0.55); ctx.fill(); }
  ctx.save();
  ctx.beginPath();
  for (const b of B) { ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, TAU); }
  ctx.clip('nonzero');
  solidTexture(ctx, S, s, rnd, theme);
  ctx.restore();
}
function drawSolid(ctx, theme, s, rnd) {
  const S = solidStyle(theme, s.t, s);
  if (s.g === 'line' && LUMPY[S.tex]) return drawLumpy(ctx, S, s, rnd, theme);
  const H = S.h, step = 2.5;
  // shadow, outline silhouette, the raised side, then the top face
  paintShape(ctx, s, 'rgba(30,20,30,0.2)', 4, 7, H + 4);
  for (let oy = H; oy >= 0; oy -= step) paintShape(ctx, s, DL, 2.2, 0, oy);
  for (let oy = H; oy >= 0; oy -= step) paintShape(ctx, s, S.side, 0, 0, oy);
  ctx.save();
  clipShape(ctx, { ...s, g: s.g, pts: s.pts && s.pts.map(([x, y]) => [x, y + H]), x: s.x, y: s.g === 'circle' ? s.y + H : s.y });
  ctx.fillStyle = 'rgba(30,15,30,0.18)'; ctx.fillRect(s.box[0] - 10, s.box[1] - 10, s.box[2] - s.box[0] + 20, s.box[3] - s.box[1] + H + 20);
  ctx.restore();
  paintShape(ctx, s, rgba(DL, 0.9), 1.6);
  paintShape(ctx, s, S.top);
  ctx.save();
  clipShape(ctx, s);
  const g = ctx.createLinearGradient(0, s.box[1], 0, s.box[3]);
  g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(40,20,40,0.12)');
  ctx.fillStyle = g; ctx.fillRect(s.box[0] - 4, s.box[1] - 4, s.box[2] - s.box[0] + 8, s.box[3] - s.box[1] + 8);
  solidTexture(ctx, S, s, rnd, theme);
  ctx.restore();
}
/** Flat terrain in view coordinates: the water layer and bridges. Raised solids are drawn with the decorations. */
function drawTerrain(ctx, theme, shapes, scale, rnd) {
  drawWaterLayer(ctx, theme, shapes, scale, rnd);
  for (const s of shapes) if (s.t === 'bridge' && s.g === 'line') drawBridge(ctx, theme, s);
}
function drawPlaza(ctx, theme, b) {
  const r = b.r + 14, ry = r * 0.5, x = b.x, y = b.y + 2;
  ell(ctx, x, y + 3, r + 4, ry + 3); ctx.fillStyle = 'rgba(30,20,30,0.14)'; ctx.fill();
  switch (theme) {
    case 'meadow': ell(ctx, x, y, r, ry); sf(ctx, '#e6c993', '#b8935c', 3); ell(ctx, x - r * 0.2, y - ry * 0.25, r * 0.6, ry * 0.45); ctx.fillStyle = 'rgba(255,245,220,0.4)'; ctx.fill(); break;
    case 'rooftop': ell(ctx, x, y, r, ry); sf(ctx, '#b48660', '#5e3f2d', 3); ctx.save(); ell(ctx, x, y, r, ry); ctx.clip(); ctx.strokeStyle = 'rgba(80,50,35,0.45)'; ctx.lineWidth = 1; for (let k = -r; k < r; k += 8) { ctx.beginPath(); ctx.moveTo(x + k, y - ry); ctx.lineTo(x + k, y + ry); ctx.stroke(); } ctx.restore(); break;
    case 'snow': ell(ctx, x, y, r, ry); sf(ctx, '#ffffff', '#a9c4e2', 3); ell(ctx, x, y + ry * 0.3, r * 0.85, ry * 0.5); ctx.fillStyle = 'rgba(170,200,235,0.25)'; ctx.fill(); break;
    case 'night': ell(ctx, x, y, r, ry); sf(ctx, '#55697a', '#24323f', 3); ctx.save(); ell(ctx, x, y, r, ry); ctx.clip(); ctx.strokeStyle = 'rgba(30,40,50,0.5)'; ctx.lineWidth = 1; for (let k = 1; k < 4; k++) { ell(ctx, x, y, r * k / 4, ry * k / 4); ctx.stroke(); } ctx.restore(); break;
    case 'beach': ell(ctx, x, y, r, ry); sf(ctx, '#d2a874', '#7a5232', 3); ctx.save(); ell(ctx, x, y, r, ry); ctx.clip(); ctx.strokeStyle = 'rgba(110,70,40,0.45)'; ctx.lineWidth = 1; for (let k = -ry; k < ry; k += 6) { ctx.beginPath(); ctx.moveTo(x - r, y + k); ctx.lineTo(x + r, y + k); ctx.stroke(); } ctx.restore(); break;
    case 'candy': ell(ctx, x, y, r, ry); sf(ctx, '#e9b878', '#9a6236', 3); ell(ctx, x, y - 1, r * 0.82, ry * 0.75); ctx.fillStyle = '#fff4fa'; ctx.fill(); ctx.fillStyle = '#6b3a24'; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.3; circ(ctx, x + Math.cos(a) * r * 0.91, y + Math.sin(a) * ry * 0.9, 2.2); ctx.fill(); } break;
  }
}

// ---- decorations (x,y = ground point)
function dShadow(ctx, x, y, rx) { ell(ctx, x, y, rx, rx * 0.32); ctx.fillStyle = 'rgba(30,20,30,0.22)'; ctx.fill(); }
function dTree(ctx, x, y, s, col = '#5cc25a', blossom = null) {
  dShadow(ctx, x + 4 * s, y, 22 * s);
  rr(ctx, x - 3.5 * s, y - 22 * s, 7 * s, 23 * s, 2 * s); sf(ctx, '#9a6a44', DL, 2.2);
  const blobs = [[0, -38, 17], [-12, -28, 12], [12, -27, 12], [0, -26, 13]];
  ctx.beginPath(); for (const [bx, by, r] of blobs) { ctx.moveTo(x + (bx + r) * s, y + by * s); ctx.arc(x + bx * s, y + by * s, r * s, 0, TAU); }
  sf(ctx, shade(col, -0.25), DL, 2.4);
  ctx.save(); ctx.clip();
  for (const [bx, by, r] of blobs) { circ(ctx, x + (bx - r * 0.2) * s, y + (by - r * 0.25) * s, r * 0.8 * s); ctx.fillStyle = col; ctx.fill(); }
  for (const [bx, by, r] of blobs) { circ(ctx, x + (bx - r * 0.4) * s, y + (by - r * 0.45) * s, r * 0.35 * s); ctx.fillStyle = rgba(shade(col, 0.45), 0.7); ctx.fill(); }
  ctx.restore();
  if (blossom) { ctx.fillStyle = blossom; for (const [bx, by] of [[-6, -40], [7, -34], [-13, -27], [12, -24], [2, -46]]) { circ(ctx, x + bx * s, y + by * s, 2 * s); ctx.fill(); } }
}
function dPine(ctx, x, y, s, snow) {
  dShadow(ctx, x + 4 * s, y, 16 * s);
  rr(ctx, x - 3 * s, y - 10 * s, 6 * s, 11 * s, 1.5 * s); sf(ctx, '#7a5236', DL, 2);
  for (let k = 0; k < 3; k++) {
    const by = y - 8 * s - k * 11 * s, w = (17 - k * 4) * s;
    ctx.beginPath(); ctx.moveTo(x - w, by); ctx.quadraticCurveTo(x, by + 4 * s, x + w, by); ctx.lineTo(x, by - 18 * s); ctx.closePath();
    sf(ctx, snow ? '#3f8a6a' : '#2f7a4f', DL, 2.2);
    if (snow) { ctx.beginPath(); ctx.moveTo(x - w * 0.55, by - 7 * s); ctx.quadraticCurveTo(x, by - 4 * s, x + w * 0.55, by - 7 * s); ctx.lineTo(x, by - 18 * s); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); }
  }
}
function dBush(ctx, x, y, s, col = '#5cc25a', berry = '#ff6f8f') {
  dShadow(ctx, x, y, 14 * s);
  ctx.beginPath();
  for (const [bx, by, r] of [[-7, -6, 7], [0, -10, 9], [8, -6, 7]]) { ctx.moveTo(x + (bx + r) * s, y + by * s); ctx.arc(x + bx * s, y + by * s, r * s, 0, TAU); }
  sf(ctx, col, DL, 2.2);
  ctx.save(); ctx.clip(); underShade(ctx, x, y - 8 * s, 15 * s, 9 * s, 0.35); gloss(ctx, x, y - 10 * s, 14 * s, 9 * s, 0.35); ctx.restore();
  if (berry) { ctx.fillStyle = berry; for (const [bx, by] of [[-6, -9], [3, -14], [9, -7], [-1, -6]]) { circ(ctx, x + bx * s, y + by * s, 1.4 * s); ctx.fill(); } }
}
function dRock(ctx, x, y, s, col = '#a7a2a8', cap = null) {
  dShadow(ctx, x, y, 12 * s);
  ctx.beginPath(); ctx.moveTo(x - 11 * s, y); ctx.quadraticCurveTo(x - 12 * s, y - 9 * s, x - 3 * s, y - 12 * s); ctx.quadraticCurveTo(x + 9 * s, y - 13 * s, x + 11 * s, y - 3 * s); ctx.quadraticCurveTo(x + 11 * s, y + 1 * s, x, y + 1 * s); ctx.closePath();
  sf(ctx, col, DL, 2.2);
  ctx.save(); ctx.clip(); gloss(ctx, x, y - 6 * s, 11 * s, 7 * s, 0.4); underShade(ctx, x, y - 6 * s, 11 * s, 7 * s, 0.3);
  if (cap) { ell(ctx, x - 1 * s, y - 12 * s, 10 * s, 4.5 * s); ctx.fillStyle = cap; ctx.fill(); }
  ctx.restore();
}
function dFlowers(ctx, x, y, s, rnd) {
  const cols = ['#ff8fb8', '#ffe066', '#ffffff', '#c7a6ff', '#ff9a5a'];
  for (let i = 0; i < 6; i++) {
    const fx = x + (rnd() - 0.5) * 22 * s, fy = y + (rnd() - 0.5) * 10 * s;
    ctx.strokeStyle = '#3f8a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 6 * s); ctx.stroke();
    ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; ctx.moveTo(fx + Math.cos(a) * 1.8 * s + 1.5 * s, fy - 6 * s + Math.sin(a) * 1.8 * s); ctx.arc(fx + Math.cos(a) * 1.8 * s, fy - 6 * s + Math.sin(a) * 1.8 * s, 1.5 * s, 0, TAU); }
    sf(ctx, cols[i % cols.length], 'rgba(90,50,70,0.6)', 1);
    circ(ctx, fx, fy - 6 * s, 1 * s); ctx.fillStyle = '#ffcf3d'; ctx.fill();
  }
}
function dYarn(ctx, x, y, s, col) {
  dShadow(ctx, x, y, 9 * s);
  yarnBall(ctx, x, y - 6 * s, 6.5 * s, col, shade(col, -0.25), shade(col, 0.4), DL);
  ctx.beginPath(); ctx.moveTo(x + 5 * s, y - 3 * s); ctx.bezierCurveTo(x + 12 * s, y + 2 * s, x + 16 * s, y - 4 * s, x + 24 * s, y); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
}
function dBox(ctx, x, y, s, peek) {
  dShadow(ctx, x, y, 16 * s);
  if (peek) {
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + k * 2 * s, y - 18 * s); ctx.lineTo(x + k * 5.5 * s, y - 24 * s); ctx.lineTo(x + k * 7.5 * s, y - 17 * s); ctx.closePath(); sf(ctx, '#3a3440', DL, 1.6); }
    ell(ctx, x, y - 17 * s, 7.5 * s, 5 * s); sf(ctx, '#3a3440', DL, 1.6);
    ctx.fillStyle = '#ffe34d'; ell(ctx, x - 2.6 * s, y - 18 * s, 1.4 * s, 1.8 * s); ctx.fill(); ell(ctx, x + 2.6 * s, y - 18 * s, 1.4 * s, 1.8 * s); ctx.fill();
    ctx.fillStyle = '#1a1420'; ell(ctx, x - 2.6 * s, y - 18 * s, 0.45 * s, 1.4 * s); ctx.fill(); ell(ctx, x + 2.6 * s, y - 18 * s, 0.45 * s, 1.4 * s); ctx.fill();
  }
  rr(ctx, x - 13 * s, y - 15 * s, 26 * s, 15 * s, 1.5 * s); sf(ctx, '#d9a86a', DL, 2.2);
  ctx.beginPath(); ctx.moveTo(x - 13 * s, y - 15 * s); ctx.lineTo(x - 18 * s, y - 21 * s); ctx.lineTo(x - 6 * s, y - 20 * s); ctx.lineTo(x - 3 * s, y - 15 * s); ctx.closePath(); sf(ctx, '#e8bd84', DL, 1.8);
  ctx.beginPath(); ctx.moveTo(x + 13 * s, y - 15 * s); ctx.lineTo(x + 18 * s, y - 22 * s); ctx.lineTo(x + 7 * s, y - 21 * s); ctx.lineTo(x + 3 * s, y - 15 * s); ctx.closePath(); sf(ctx, '#c79458', DL, 1.8);
  ctx.fillStyle = 'rgba(120,80,40,0.35)'; ctx.fillRect(x - 2 * s, y - 14 * s, 4 * s, 13 * s);
}
function dFishbone(ctx, x, y, s) {
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 10 * s, y); ctx.lineTo(x + 7 * s, y);
  for (let k = -6; k <= 4; k += 3.3) { ctx.moveTo(x + k * s, y - 4 * s); ctx.lineTo(x + (k + 1) * s, y); ctx.lineTo(x + k * s, y + 4 * s); }
  ctx.moveTo(x - 10 * s, y); ctx.lineTo(x - 14 * s, y - 4 * s); ctx.moveTo(x - 10 * s, y); ctx.lineTo(x - 14 * s, y + 4 * s);
  ctx.stroke();
  ell(ctx, x + 9 * s, y, 3.2 * s, 3 * s); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  circ(ctx, x + 9.5 * s, y - 0.6 * s, 0.8 * s); ctx.fillStyle = '#3a3440'; ctx.fill();
}
function dMushroom(ctx, x, y, s, col, glow) {
  if (glow) softBlob(ctx, x, y - 8 * s, 22 * s, col, 0.45);
  rr(ctx, x - 2.5 * s, y - 9 * s, 5 * s, 9 * s, 2 * s); sf(ctx, '#f2ead8', DL, 1.8);
  ctx.beginPath(); ctx.moveTo(x - 9 * s, y - 8 * s); ctx.quadraticCurveTo(x - 9 * s, y - 18 * s, x, y - 18 * s); ctx.quadraticCurveTo(x + 9 * s, y - 18 * s, x + 9 * s, y - 8 * s); ctx.closePath();
  sf(ctx, col, DL, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; circ(ctx, x - 3 * s, y - 13 * s, 1.6 * s); ctx.fill(); circ(ctx, x + 3.5 * s, y - 11.5 * s, 1.2 * s); ctx.fill();
}
function dLantern(ctx, x, y, s) {
  softBlob(ctx, x, y - 30 * s, 40 * s, '#ffd37a', 0.45);
  dShadow(ctx, x, y, 8 * s);
  rr(ctx, x - 1.6 * s, y - 30 * s, 3.2 * s, 30 * s, 1 * s); sf(ctx, '#3a3c4a', DL, 1.8);
  rr(ctx, x - 5 * s, y - 40 * s, 10 * s, 11 * s, 2 * s); sf(ctx, '#ffe9a0', DL, 2);
  ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 40 * s); ctx.lineTo(x, y - 46 * s); ctx.lineTo(x + 7 * s, y - 40 * s); ctx.closePath(); sf(ctx, '#3a3c4a', DL, 1.8);
}
function dSnowman(ctx, x, y, s) {
  dShadow(ctx, x, y, 14 * s);
  circ(ctx, x, y - 9 * s, 10 * s); sf(ctx, '#ffffff', '#7f9cc0', 2.2);
  for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + k * 2 * s, y - 25 * s); ctx.lineTo(x + k * 6 * s, y - 33 * s); ctx.lineTo(x + k * 7.5 * s, y - 24 * s); ctx.closePath(); sf(ctx, '#ffffff', '#7f9cc0', 1.8); }
  circ(ctx, x, y - 23 * s, 7.5 * s); sf(ctx, '#ffffff', '#7f9cc0', 2.2);
  ctx.fillStyle = '#2b2135'; circ(ctx, x - 2.6 * s, y - 24 * s, 1 * s); ctx.fill(); circ(ctx, x + 2.6 * s, y - 24 * s, 1 * s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y - 22 * s); ctx.lineTo(x + 5 * s, y - 21 * s); ctx.lineTo(x, y - 20.5 * s); ctx.closePath(); ctx.fillStyle = '#ff8a3d'; ctx.fill();
  rr(ctx, x - 7 * s, y - 17.5 * s, 14 * s, 3 * s, 1.4 * s); sf(ctx, '#ff5468', DL, 1.4);
  ctx.strokeStyle = '#7a5236'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 9 * s, y - 11 * s); ctx.lineTo(x - 17 * s, y - 17 * s); ctx.moveTo(x + 9 * s, y - 11 * s); ctx.lineTo(x + 17 * s, y - 16 * s); ctx.stroke();
}
function dIcePond(ctx, x, y, s) {
  ell(ctx, x, y, 34 * s, 14 * s); sf(ctx, '#bfe3ff', '#7fb0dc', 2.4);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x - 20 * s, y - 4 * s); ctx.lineTo(x - 6 * s, y - 8 * s); ctx.moveTo(x + 4 * s, y + 5 * s); ctx.lineTo(x + 18 * s, y + 1 * s); ctx.stroke();
}
function dPond(ctx, x, y, s, night) {
  ell(ctx, x, y, 36 * s, 15 * s); sf(ctx, night ? '#2a4a6a' : '#5fc0dc', night ? '#16283a' : '#3f7a5a', 3);
  ell(ctx, x - 6 * s, y - 3 * s, 20 * s, 6 * s); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
  if (night) { circ(ctx, x + 10 * s, y - 2 * s, 5 * s); ctx.fillStyle = 'rgba(255,250,220,0.75)'; ctx.fill(); }
  for (const [px, py] of [[-18, 3], [14, 5]]) { ell(ctx, x + px * s, y + py * s, 5 * s, 2.6 * s); sf(ctx, '#5fbf5a', '#2f6b2a', 1.2); }
  circ(ctx, x - 17 * s, y + 2 * s, 1.5 * s); ctx.fillStyle = '#ff9fc4'; ctx.fill();
}
function dCandyCane(ctx, x, y, s) {
  dShadow(ctx, x, y, 7 * s);
  const p = () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 30 * s); ctx.arc(x + 5 * s, y - 30 * s, 5 * s, Math.PI, 0); ctx.lineTo(x + 10 * s, y - 26 * s); };
  ctx.lineCap = 'round';
  p(); ctx.strokeStyle = DL; ctx.lineWidth = 6.4 * s; ctx.stroke();
  p(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4.6 * s; ctx.stroke();
  ctx.setLineDash([3 * s, 3 * s]); p(); ctx.strokeStyle = '#ff3d5e'; ctx.stroke(); ctx.setLineDash([]);
}
function dLollipop(ctx, x, y, s, col) {
  dShadow(ctx, x, y, 7 * s);
  rr(ctx, x - 1.2 * s, y - 26 * s, 2.4 * s, 26 * s, 1); sf(ctx, '#ffffff', DL, 1.6);
  circ(ctx, x, y - 32 * s, 10 * s); sf(ctx, col, DL, 2.2);
  ctx.beginPath(); for (let a = 0; a < TAU * 2; a += 0.25) { const r = a / (TAU * 2) * 9 * s; ctx.lineTo(x + Math.cos(a) * r, y - 32 * s + Math.sin(a) * r); }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * s; ctx.stroke();
  gloss(ctx, x, y - 32 * s, 10 * s, 10 * s, 0.25);
}
function dGumdrop(ctx, x, y, s, col) {
  dShadow(ctx, x, y, 9 * s);
  ctx.beginPath(); ctx.moveTo(x - 8 * s, y); ctx.quadraticCurveTo(x - 8 * s, y - 13 * s, x, y - 13 * s); ctx.quadraticCurveTo(x + 8 * s, y - 13 * s, x + 8 * s, y); ctx.closePath();
  sf(ctx, col, DL, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (const [a, b] of [[-3, -9], [2, -6], [4, -10], [-5, -4]]) { circ(ctx, x + a * s, y + b * s, 0.8 * s); ctx.fill(); }
}
function dCupcake(ctx, x, y, s) {
  dShadow(ctx, x, y, 10 * s);
  ctx.beginPath(); ctx.moveTo(x - 8 * s, y - 10 * s); ctx.lineTo(x + 8 * s, y - 10 * s); ctx.lineTo(x + 6 * s, y); ctx.lineTo(x - 6 * s, y); ctx.closePath(); sf(ctx, '#7fd6ff', DL, 2);
  ctx.beginPath(); ctx.arc(x - 4 * s, y - 12 * s, 5 * s, 0, TAU); ctx.moveTo(x + 9 * s, y - 12 * s); ctx.arc(x + 4 * s, y - 12 * s, 5 * s, 0, TAU); ctx.moveTo(x + 5 * s, y - 17 * s); ctx.arc(x, y - 17 * s, 5 * s, 0, TAU);
  sf(ctx, '#fff0f6', DL, 2);
  circ(ctx, x, y - 23 * s, 2.6 * s); sf(ctx, '#ff3d5e', DL, 1.4);
}
function dUmbrella(ctx, x, y, s, col) {
  dShadow(ctx, x + 6 * s, y, 20 * s);
  ctx.strokeStyle = DL; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2 * s, y - 34 * s); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke();
  const p = () => { ctx.beginPath(); ctx.moveTo(x - 20 * s, y - 28 * s); ctx.quadraticCurveTo(x + 2 * s, y - 50 * s, x + 24 * s, y - 28 * s); ctx.quadraticCurveTo(x + 2 * s, y - 32 * s, x - 20 * s, y - 28 * s); ctx.closePath(); };
  p(); sf(ctx, '#ffffff', DL, 2.2);
  ctx.save(); p(); ctx.clip(); ctx.fillStyle = col;
  for (let k = -3; k < 3; k += 2) { ctx.beginPath(); ctx.moveTo(x + 2 * s, y - 46 * s); ctx.lineTo(x + k * 9 * s, y - 26 * s); ctx.lineTo(x + (k + 1) * 9 * s, y - 26 * s); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function dPalm(ctx, x, y, s) {
  dShadow(ctx, x + 8 * s, y, 18 * s);
  ctx.beginPath(); ctx.moveTo(x - 3 * s, y); ctx.quadraticCurveTo(x + 2 * s, y - 22 * s, x + 8 * s, y - 42 * s); ctx.lineTo(x + 12 * s, y - 41 * s); ctx.quadraticCurveTo(x + 7 * s, y - 20 * s, x + 4 * s, y); ctx.closePath();
  sf(ctx, '#b98552', DL, 2);
  const tx = x + 10 * s, ty = y - 42 * s;
  for (const a of [-2.8, -2.1, -1.4, -0.7, -0.1]) {
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(a) * 14 * s, ty + Math.sin(a) * 14 * s - 6 * s, tx + Math.cos(a) * 24 * s, ty + Math.sin(a) * 24 * s + 6 * s);
    ctx.quadraticCurveTo(tx + Math.cos(a) * 12 * s, ty + Math.sin(a) * 12 * s + 2 * s, tx, ty);
    sf(ctx, '#4fbf5a', DL, 1.8);
  }
  ctx.fillStyle = '#7a5236'; circ(ctx, tx - 2 * s, ty + 2 * s, 2.4 * s); ctx.fill(); circ(ctx, tx + 2.5 * s, ty + 2.5 * s, 2.4 * s); ctx.fill();
}
function dCrate(ctx, x, y, s) {
  dShadow(ctx, x, y, 14 * s);
  rr(ctx, x - 11 * s, y - 13 * s, 22 * s, 13 * s, 1.5 * s); sf(ctx, '#b88a5a', DL, 2);
  ctx.strokeStyle = '#7a5232'; ctx.lineWidth = 1; for (const k of [-4, 3]) { ctx.beginPath(); ctx.moveTo(x - 11 * s, y + k * s - 6 * s); ctx.lineTo(x + 11 * s, y + k * s - 6 * s); ctx.stroke(); }
  for (const [fx, c] of [[-5, '#7fc8e8'], [2, '#ffb36b'], [8, '#9fd8f0']]) { ell(ctx, x + fx * s, y - 14 * s, 4.2 * s, 2.2 * s, -0.3); sf(ctx, c, DL, 1.2); }
}
function dStarfish(ctx, x, y, s) { starPath(ctx, x, y, 6 * s, 2.6 * s, 5, -1.2); sf(ctx, '#ff8a5a', DL, 1.6); ctx.fillStyle = 'rgba(255,255,255,0.6)'; circ(ctx, x, y, 0.8 * s); ctx.fill(); }
function dShell(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x - 5 * s, y); ctx.quadraticCurveTo(x, y - 9 * s, x + 5 * s, y); ctx.closePath(); sf(ctx, '#ffd9e6', DL, 1.4); ctx.strokeStyle = 'rgba(200,120,150,0.7)'; ctx.lineWidth = 0.7; for (const k of [-2.5, 0, 2.5]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + k * s, y - 5 * s); ctx.stroke(); } }
function dBarrel(ctx, x, y, s) {
  dShadow(ctx, x, y, 10 * s);
  rr(ctx, x - 8 * s, y - 18 * s, 16 * s, 18 * s, 4 * s); sf(ctx, '#a8703f', DL, 2);
  ctx.fillStyle = '#5b5768'; ctx.fillRect(x - 8 * s, y - 15 * s, 16 * s, 2 * s); ctx.fillRect(x - 8 * s, y - 5 * s, 16 * s, 2 * s);
  ell(ctx, x, y - 18 * s, 8 * s, 2.6 * s); sf(ctx, '#c48a52', DL, 1.4);
}
function dChimney(ctx, x, y, s) {
  dShadow(ctx, x + 4 * s, y, 14 * s);
  rr(ctx, x - 8 * s, y - 30 * s, 16 * s, 30 * s, 1.5 * s); sf(ctx, '#b8604a', DL, 2.2);
  ctx.strokeStyle = 'rgba(80,30,20,0.4)'; ctx.lineWidth = 0.9;
  for (let k = 5; k < 30; k += 5) { ctx.beginPath(); ctx.moveTo(x - 8 * s, y - k * s); ctx.lineTo(x + 8 * s, y - k * s); ctx.stroke(); }
  rr(ctx, x - 10 * s, y - 34 * s, 20 * s, 5 * s, 1.5 * s); sf(ctx, '#8f4a37', DL, 2);
}
function dAntenna(ctx, x, y, s) {
  ctx.strokeStyle = DL; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 40 * s); ctx.moveTo(x - 10 * s, y - 32 * s); ctx.lineTo(x + 10 * s, y - 32 * s); ctx.moveTo(x - 7 * s, y - 25 * s); ctx.lineTo(x + 7 * s, y - 25 * s); ctx.moveTo(x - 4 * s, y - 38 * s); ctx.lineTo(x + 4 * s, y - 38 * s); ctx.stroke();
  ctx.strokeStyle = '#c9c4d4'; ctx.lineWidth = 0.9; ctx.stroke();
  circ(ctx, x, y - 41 * s, 1.6 * s); ctx.fillStyle = '#ff5468'; ctx.fill();
}
function dSkylight(ctx, x, y, s) {
  ctx.beginPath(); ctx.moveTo(x - 12 * s, y); ctx.lineTo(x - 9 * s, y - 10 * s); ctx.lineTo(x + 9 * s, y - 10 * s); ctx.lineTo(x + 12 * s, y); ctx.closePath();
  sf(ctx, '#9fd8f0', DL, 2);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 10 * s); ctx.moveTo(x - 6 * s, y - 3 * s); ctx.lineTo(x - 3 * s, y - 8 * s); ctx.stroke();
}
function dPot(ctx, x, y, s) {
  dShadow(ctx, x, y, 9 * s);
  dBush(ctx, x, y - 9 * s, 0.6 * s, '#5cc25a', '#ff8fb8');
  ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 10 * s); ctx.lineTo(x + 7 * s, y - 10 * s); ctx.lineTo(x + 5 * s, y); ctx.lineTo(x - 5 * s, y); ctx.closePath(); sf(ctx, '#d9824f', DL, 2);
}
function dPresent(ctx, x, y, s, col) {
  dShadow(ctx, x, y, 10 * s);
  rr(ctx, x - 8 * s, y - 14 * s, 16 * s, 14 * s, 1.5 * s); sf(ctx, col, DL, 2);
  ctx.fillStyle = '#ffd447'; ctx.fillRect(x - 1.5 * s, y - 14 * s, 3 * s, 14 * s);
  ell(ctx, x - 3 * s, y - 16 * s, 3.2 * s, 2 * s, -0.4); sf(ctx, '#ffd447', DL, 1.2); ell(ctx, x + 3 * s, y - 16 * s, 3.2 * s, 2 * s, 0.4); sf(ctx, '#ffd447', DL, 1.2);
}
function dHedge(ctx, x, y, s) { dBush(ctx, x, y, s * 1.2, '#2f6b55', null); circ(ctx, x + 4 * s, y - 12 * s, 1.6 * s); ctx.fillStyle = '#b9a6ff'; ctx.fill(); }

// theme -> [fn(ctx,x,y,s,rnd), weight, tall, isPond]
const DECOR = {
  meadow: [[(c, x, y, s) => dTree(c, x, y, s, '#5cc25a', '#ffb3d1'), 3, true], [(c, x, y, s) => dTree(c, x, y, s, '#6fd06a'), 3, true], [(c, x, y, s) => dBush(c, x, y, s), 4], [(c, x, y, s) => dRock(c, x, y, s, '#b3aeb4', '#7fcf6a'), 2], [(c, x, y, s, r) => dFlowers(c, x, y, s, r), 5], [(c, x, y, s) => dYarn(c, x, y, s, '#ff8fb8'), 1], [(c, x, y, s) => dBox(c, x, y, s, true), 1, true], [(c, x, y, s) => dPond(c, x, y, s, false), 0.5, false, 'pond']],
  rooftop: [[(c, x, y, s) => dChimney(c, x, y, s), 3, true], [(c, x, y, s) => dAntenna(c, x, y, s), 2, true], [(c, x, y, s) => dSkylight(c, x, y, s), 3], [(c, x, y, s) => dPot(c, x, y, s), 3], [(c, x, y, s) => dBox(c, x, y, s, false), 1], [(c, x, y, s) => dFishbone(c, x, y, s), 2], [(c, x, y, s) => dYarn(c, x, y, s, '#7fd6ff'), 1]],
  snow: [[(c, x, y, s) => dPine(c, x, y, s, true), 5, true], [(c, x, y, s) => dSnowman(c, x, y, s), 2, true], [(c, x, y, s) => dRock(c, x, y, s, '#9aa6b8', '#ffffff'), 3], [(c, x, y, s) => dPresent(c, x, y, s, '#ff5468'), 1], [(c, x, y, s) => dPresent(c, x, y, s, '#3fd47a'), 1], [(c, x, y, s) => dIcePond(c, x, y, s), 0.6, false, 'pond']],
  night: [[(c, x, y, s) => dLantern(c, x, y, s), 3, true], [(c, x, y, s) => dMushroom(c, x, y, s, '#7cf0ff', true), 3], [(c, x, y, s) => dMushroom(c, x, y, s, '#ff8fd0', true), 2], [(c, x, y, s) => dHedge(c, x, y, s), 4], [(c, x, y, s) => dTree(c, x, y, s, '#2f6b55'), 3, true], [(c, x, y, s) => dRock(c, x, y, s, '#62707e', '#4f8a6a'), 2], [(c, x, y, s) => dPond(c, x, y, s, true), 0.5, false, 'pond']],
  beach: [[(c, x, y, s) => dUmbrella(c, x, y, s, '#ff5468'), 2, true], [(c, x, y, s) => dUmbrella(c, x, y, s, '#3d9bff'), 2, true], [(c, x, y, s) => dPalm(c, x, y, s), 3, true], [(c, x, y, s) => dCrate(c, x, y, s), 3], [(c, x, y, s) => dStarfish(c, x, y, s), 3], [(c, x, y, s) => dShell(c, x, y, s), 3], [(c, x, y, s) => dBarrel(c, x, y, s), 2], [(c, x, y, s) => dFishbone(c, x, y, s), 2]],
  candy: [[(c, x, y, s) => dCandyCane(c, x, y, s), 3, true], [(c, x, y, s) => dLollipop(c, x, y, s, '#ff5d8f'), 2, true], [(c, x, y, s) => dLollipop(c, x, y, s, '#5ad1ff'), 2, true], [(c, x, y, s) => dGumdrop(c, x, y, s, '#7cf08a'), 2], [(c, x, y, s) => dGumdrop(c, x, y, s, '#ffd23d'), 2], [(c, x, y, s) => dGumdrop(c, x, y, s, '#b48cff'), 2], [(c, x, y, s) => dCupcake(c, x, y, s), 3]],
};
const GROUND = { meadow: gMeadow, rooftop: gRooftop, snow: gSnow, night: gNight, beach: gBeach, candy: gCandy };
const VIG = { meadow: '30,60,20', rooftop: '70,25,40', snow: '60,90,140', night: '5,10,25', beach: '120,80,30', candy: '140,40,100' };

/**
 * terrain (optional, view coordinates): { shapes: map obstacles, trails: [[{x,y},...], ...] walking routes to pave }
 */
export function renderBackground(themeId, seed, buildings, scale = 1, w = WORLD_W, h = WORLD_H, terrain = null) {
  setArtSize(w, h);
  const theme = GROUND[themeId] ? themeId : 'meadow';
  const c = makeCanvas(AW * scale, AH * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  const rnd = mulberry32(((seed >>> 0) ^ hashStr(theme)) >>> 0);
  const blds = (buildings || []).map(b => ({ x: b.x, y: b.y, r: b.radius || 40 }));
  const shapes = normalizeObstacles(terrain && terrain.shapes);
  const trails = terrain && terrain.trails ? terrain.trails : trailPairs(blds).map(([a, b]) => [a, b]);
  GROUND[theme](ctx, rnd);
  drawTrails(ctx, theme, trails, rnd);
  const trnd = mulberry32(((seed >>> 0) ^ 0x51ed) >>> 0);
  if (shapes.length) drawTerrain(ctx, theme, shapes, scale, trnd);
  for (const b of blds) drawPlaza(ctx, theme, b);
  // decorations stay off the water, the walls and the bridges
  const solidAt = makeBlockTest(shapes);
  const onBridge = shapes.filter(s => s.t === 'bridge');
  const terrainAt = (x, y) => solidAt(x, y, 14) || onBridge.some(s => shapeDist(s, x, y) < 10);
  const segs = [];
  for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
    if (!shapes.length && Math.hypot(blds[i].x - blds[j].x, blds[i].y - blds[j].y) < 950) segs.push([blds[i].x, blds[i].y, blds[j].x, blds[j].y]);
  }
  for (const P of trails) for (let k = 1; k < (P ? P.length : 0); k++) segs.push([P[k - 1].x, P[k - 1].y, P[k].x, P[k].y]);
  const list = DECOR[theme], tot = list.reduce((a, d) => a + d[1], 0);
  const placed = [];
  const yMin = theme === 'beach' ? 85 : 30, yMax = theme === 'beach' ? AH - 70 : AH - 10;
  const hasWater = shapes.length > 0;
  for (let n = 0; n < 70; n++) {
    let pick = rnd() * tot, d = list[0];
    for (const it of list) { pick -= it[1]; if (pick <= 0) { d = it; break; } }
    // little decorative ponds would look like real water you cannot cross
    if (hasWater && d[3]) continue;
    const tall = !!d[2];
    for (let tries = 0; tries < 30; tries++) {
      const x = 25 + rnd() * (AW - 50), y = yMin + rnd() * (yMax - yMin);
      if (blds.some(b => Math.hypot(b.x - x, b.y - y) < b.r + 45 + (tall ? 16 : 4))) continue;
      if (shapes.length && terrainAt(x, y)) continue;
      if (placed.some(p => Math.hypot(p.x - x, p.y - y) < (tall || p.tall ? 46 : 28))) continue;
      if (tall) {
        const edge = x < 140 || x > AW - 140 || y < 130 || y > AH - 90;
        if (!edge && rnd() > 0.12) continue;
        if (segs.some(sg => segDist(x, y, ...sg) < 34)) continue;
      }
      placed.push({ x, y, d, tall, s: tall ? 1.05 + rnd() * 0.5 : 0.8 + rnd() * 0.45 });
      break;
    }
  }
  // raised terrain joins the decorations, back to front
  for (const s of shapes) if (s.cls === 'solid') placed.push({ y: s.box[3], solid: s });
  placed.sort((a, b) => a.y - b.y);
  for (const p of placed) { if (p.solid) drawSolid(ctx, theme, p.solid, trnd); else p.d[0](ctx, p.x, p.y, p.s, rnd); }
  // vignette
  const g = ctx.createRadialGradient(AW / 2, AH / 2, AH * 0.42, AW / 2, AH / 2, AW * 0.62);
  g.addColorStop(0, `rgba(${VIG[theme]},0)`); g.addColorStop(1, `rgba(${VIG[theme]},${theme === 'night' ? 0.55 : 0.32})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, AW, AH);
  return c;
}

// ================================================================ AMBIENT
const AMB_N = 56;
const AMB = new Float32Array(AMB_N * 6);
{ const r = mulberry32(777); for (let i = 0; i < AMB.length; i++) AMB[i] = r(); }
function wrap(v, m) { return ((v % m) + m) % m; }
export function drawAmbient(ctx, themeId, t) {
  ctx.save();
  const W = AW + 40, H = AH + 40;
  switch (themeId) {
    case 'meadow': {
      for (let i = 0; i < 34; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2], d = AMB[o + 3], e = AMB[o + 4];
        const x = wrap(a * W + t * (16 + b * 18), W) - 20;
        const y = wrap(c * H + t * (9 + d * 10) + Math.sin(t * 1.3 + i) * 14, H) - 20;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#ffc2dc' : '#ffe9a0';
        ctx.beginPath(); ctx.ellipse(x, y, 3.4, 1.8 + Math.sin(t * 3 + i) * 0.7, t * (1 + e) + i, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'rooftop': {
      for (let i = 0; i < 26; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2], d = AMB[o + 3];
        const x = wrap(a * W + t * (22 + b * 20) + Math.sin(t * 1.1 + i) * 20, W) - 20;
        const y = wrap(c * H + t * (14 + d * 12), H) - 20;
        const r = Math.sin(t * 2 + i * 1.7) * 1.2;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = i % 3 === 0 ? '#ff9a3d' : i % 3 === 1 ? '#e8573f' : '#ffc94d';
        ctx.beginPath(); ctx.ellipse(x, y, 4.2, 2.2, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,50,20,0.6)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(r) * 4.2, y - Math.sin(r) * 4.2); ctx.lineTo(x + Math.cos(r) * 4.2, y + Math.sin(r) * 4.2); ctx.stroke();
      }
      break;
    }
    case 'snow': {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < AMB_N; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2], d = AMB[o + 3];
        const x = wrap(a * W + Math.sin(t * 0.8 + i) * 22 + t * 9, W) - 20;
        const y = wrap(b * H + t * (24 + c * 30), H) - 20;
        ctx.globalAlpha = 0.6 + d * 0.4;
        circ(ctx, x, y, 1.1 + d * 2.3); ctx.fill();
      }
      break;
    }
    case 'night': {
      for (let i = 0; i < 32; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2], d = AMB[o + 3], e = AMB[o + 4];
        const x = a * AW + Math.sin(t * 0.5 * (0.5 + b) + i) * 40;
        const y = c * AH + Math.cos(t * 0.4 * (0.5 + d) + i * 2) * 30;
        const p = 0.5 + 0.5 * Math.sin(t * 3 * (0.5 + e) + i * 5);
        ctx.fillStyle = '#e8ff8a';
        ctx.globalAlpha = 0.18 * p; circ(ctx, x, y, 8); ctx.fill();
        ctx.globalAlpha = 0.35 * p; circ(ctx, x, y, 3.6); ctx.fill();
        ctx.globalAlpha = 0.4 + 0.6 * p; circ(ctx, x, y, 1.5); ctx.fill();
      }
      break;
    }
    case 'beach': {
      for (let i = 0; i < 34; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2];
        const x = a * AW, y = i % 2 ? c * 55 + 2 : AH - c * 55 - 2;
        const tw = Math.max(0, Math.sin(t * 2 * (0.6 + b) + i * 3));
        ctx.globalAlpha = tw * tw * tw;
        sparkle(ctx, x + Math.sin(t + i) * 4, y, 3.5, '#ffffff');
      }
      for (let i = 0; i < 16; i++) {
        const o = (i + 34) * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2];
        const x = a * AW, y = 90 + c * (AH - 180);
        const tw = Math.max(0, Math.sin(t * 1.6 * (0.6 + b) + i * 2.1));
        ctx.globalAlpha = tw * tw * tw * tw * 0.8;
        sparkle(ctx, x, y, 2.4, '#fff8d8');
      }
      break;
    }
    case 'candy': {
      const cols = ['#ffffff', '#fff27a', '#ff9fd0', '#9fe8ff'];
      for (let i = 0; i < 40; i++) {
        const o = i * 6, a = AMB[o], b = AMB[o + 1], c = AMB[o + 2], d = AMB[o + 3];
        const x = a * AW + Math.sin(t * 0.7 + i) * 10;
        const y = wrap(c * H - t * (8 + d * 10), H) - 20;
        const tw = 0.5 + 0.5 * Math.sin(t * 3 * (0.6 + b) + i * 2);
        ctx.globalAlpha = tw;
        sparkle(ctx, x, y, 2 + tw * 2.5, cols[i % 4]);
      }
      break;
    }
  }
  ctx.restore();
}

// ================================================================ HERO PORTRAITS
function headClip(ctx, rx, ry, hy) { ell(ctx, 0, hy, rx, ry); ctx.clip(); }
function outfit(ctx, id, P) {
  const body = () => ell(ctx, 0, 15, 10.6, 6.8);
  const fills = {
    whiskers: '#c9d2dd', mittens: '#3d6fe0', shadow: '#2b2f45', chef: '#ffffff', chonk: '#6b7a3a', duchess: '#ff9fc8',
    clawbeard: '#c8323c', neko: null, astro: '#eef1f6', purrcival: '#8a5a3a', luna: '#5b3a9a', glitch: '#26262e',
  };
  const f = fills[id];
  body();
  if (!f) { furPart(ctx, P, body, { x: 0, y: 15, rx: 10.6, ry: 6.8 }, 'body', 0, 4); return; }
  sf(ctx, f, '#2a1830', OUTW * 2);
  ctx.save(); body(); ctx.clip();
  switch (id) {
    case 'whiskers': {
      const g = ctx.createLinearGradient(-10, 9, 10, 20); g.addColorStop(0, '#eef3f8'); g.addColorStop(1, '#7d8898');
      ctx.fillStyle = g; ctx.fillRect(-11, 8, 22, 14);
      ctx.fillStyle = '#d63a4a'; ctx.fillRect(-3.4, 8, 6.8, 14);
      paw(ctx, 0, 13.6, 2.2, '#ffd447');
      ctx.strokeStyle = '#ffd447'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.ellipse(0, 15, 10, 6.2, 0, Math.PI, TAU); ctx.stroke();
      break;
    }
    case 'mittens': starPath(ctx, -5, 13, 1.4, 0.6); ctx.fillStyle = '#ffe066'; ctx.fill(); starPath(ctx, 5.5, 15, 1.1, 0.5); ctx.fill(); starPath(ctx, 1, 18, 0.9, 0.4); ctx.fill(); break;
    case 'shadow': ctx.strokeStyle = '#4a5070'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(2, 18); ctx.moveTo(6, 8); ctx.lineTo(-2, 18); ctx.stroke(); ctx.fillStyle = '#d63a4a'; ctx.fillRect(-11, 18.5, 22, 2); break;
    case 'chef': ctx.fillStyle = '#c9c4cf'; for (const y of [11.5, 14.5, 17.5]) { circ(ctx, -2.2, y, 0.55); ctx.fill(); circ(ctx, 2.2, y, 0.55); ctx.fill(); } ctx.beginPath(); ctx.moveTo(-4.5, 8.6); ctx.lineTo(0, 12.5); ctx.lineTo(4.5, 8.6); ctx.closePath(); ctx.fillStyle = '#e8473f'; ctx.fill(); break;
    case 'chonk': ctx.strokeStyle = '#c9d0d8'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(-3, 9); ctx.quadraticCurveTo(0, 13, 3, 9); ctx.stroke(); rr(ctx, -1.3, 12.2, 2.6, 3.2, 0.6); sf(ctx, '#d9dee5', '#555', 0.4); ctx.fillStyle = 'rgba(0,0,0,0.15)'; for (let k = -8; k < 9; k += 4) { circ(ctx, k, 17, 1.2); ctx.fill(); } break;
    case 'duchess': ctx.fillStyle = '#ffffff'; for (let k = -9; k <= 9; k += 2.2) { circ(ctx, k, 9.3 + Math.abs(k) * 0.08, 1.2); ctx.fill(); } break;
    case 'clawbeard': ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-3, 8.5); ctx.lineTo(3, 8.5); ctx.lineTo(1.5, 14); ctx.lineTo(-1.5, 14); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffd447'; for (const y of [12, 15, 18]) { circ(ctx, -5.5, y, 0.7); ctx.fill(); circ(ctx, 5.5, y, 0.7); ctx.fill(); } break;
    case 'astro': rr(ctx, 3.5, 12, 4.2, 3, 0.5); ctx.fillStyle = '#3d9bff'; ctx.fill(); ctx.fillStyle = '#ff5468'; ctx.fillRect(3.5, 12, 1.4, 3); ctx.fillStyle = '#ffd447'; starPath(ctx, -5, 14, 1.2, 0.5); ctx.fill(); break;
    case 'purrcival': ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-3.2, 8.4); ctx.lineTo(3.2, 8.4); ctx.lineTo(0, 16); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.4; for (let k = -10; k < 10; k += 1.6) { ctx.beginPath(); ctx.moveTo(k, 8); ctx.lineTo(k + 3, 22); ctx.stroke(); } break;
    case 'luna': ctx.fillStyle = '#ffd447'; starPath(ctx, 0, 10.4, 1.6, 0.7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.7)'; for (const [x, y] of [[-6, 13], [6, 16], [-3, 18], [4, 12]]) { circ(ctx, x, y, 0.35); ctx.fill(); } break;
    case 'glitch': ctx.fillStyle = '#3dff8c'; for (const [x, y] of [[-6, 13], [-4.8, 13], [-3.6, 14.2], [-4.8, 15.4], [-6, 15.4], [4, 13], [5.2, 13], [6.4, 14.2], [5.2, 15.4], [4, 15.4]]) ctx.fillRect(x, y, 1.1, 1.1); ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-2, 8.5); ctx.lineTo(-2.4, 13); ctx.moveTo(2, 8.5); ctx.lineTo(2.4, 13); ctx.stroke(); break;
  }
  gloss(ctx, 0, 14, 10, 6, 0.3);
  ctx.restore();
}
function heroAccessory(ctx, id, P, hy, rx, ry) {
  const L = OUTW * 2, OL = '#2a1830';
  switch (id) {
    case 'whiskers': {
      // plume
      ctx.beginPath(); ctx.moveTo(1, hy - 8.4); ctx.bezierCurveTo(-2, hy - 15, -8, hy - 14.5, -11, hy - 10); ctx.bezierCurveTo(-7, hy - 11.5, -3, hy - 11, 2.4, hy - 7.6); ctx.closePath();
      sf(ctx, '#e8384a', OL, L);
      ctx.strokeStyle = '#ff8a96'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0.5, hy - 9); ctx.bezierCurveTo(-3, hy - 13, -7, hy - 12.5, -10, hy - 10.2); ctx.stroke();
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 3.2, hy - 6.5); ctx.lineTo(s * 7.4, hy - 11.4); ctx.lineTo(s * 8.2, hy - 4); ctx.closePath(); sf(ctx, '#b9c3cf', OL, L); }
      const helm = () => {
        ctx.beginPath(); ctx.moveTo(-8.6, hy + 4.8);
        ctx.lineTo(-8.6, hy); ctx.bezierCurveTo(-8.8, hy - 10, 8.8, hy - 10, 8.6, hy);
        ctx.lineTo(8.6, hy + 4.8); ctx.lineTo(6.4, hy + 4.8); ctx.lineTo(6.6, hy - 1.6);
        ctx.quadraticCurveTo(0, hy - 4.6, -6.6, hy - 1.6); ctx.lineTo(-6.4, hy + 4.8); ctx.closePath();
      };
      helm();
      const g = ctx.createLinearGradient(-8, hy - 8, 8, hy + 4); g.addColorStop(0, '#f4f7fb'); g.addColorStop(0.5, '#b8c2ce'); g.addColorStop(1, '#6f7a8a');
      sf(ctx, g, OL, L);
      rr(ctx, -7.6, hy - 8.4, 15.2, 2.8, 1.3); sf(ctx, '#9aa5b3', OL, L);
      ctx.fillStyle = '#3a3f4a'; for (let k = -5; k <= 5; k += 2.5) ctx.fillRect(k - 0.7, hy - 7.4, 1.4, 0.8);
      ctx.strokeStyle = '#ffd447'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, hy - 5.4); ctx.lineTo(0, hy - 3.6); ctx.stroke();
      break;
    }
    case 'mittens': {
      ell(ctx, 0.4, hy - 5.6, 10.4, 2.5); sf(ctx, '#2f58c0', OL, L);
      const cone = () => { ctx.beginPath(); ctx.moveTo(-5.8, hy - 6); ctx.quadraticCurveTo(-3.5, hy - 11, -8.6, hy - 15.2); ctx.quadraticCurveTo(1.5, hy - 12.4, 5.8, hy - 6); ctx.quadraticCurveTo(0, hy - 4.8, -5.8, hy - 6); ctx.closePath(); };
      cone(); sf(ctx, '#3d6fe0', OL, L);
      ctx.save(); cone(); ctx.clip(); ctx.fillStyle = '#ffd447'; ctx.fillRect(-7, hy - 7.6, 14, 1.6); gloss(ctx, -2, hy - 10, 4, 5, 0.35); ctx.restore();
      ctx.fillStyle = '#ffe680';
      starPath(ctx, -1.6, hy - 10.4, 1.3, 0.55); ctx.fill(); starPath(ctx, 2.4, hy - 8.8, 0.8, 0.35); ctx.fill(); starPath(ctx, -5.6, hy - 13.4, 0.8, 0.35); ctx.fill();
      circ(ctx, -8.6, hy - 15.2, 1); ctx.fill();
      break;
    }
    case 'shadow': {
      ctx.save(); headClip(ctx, rx, ry, hy);
      ctx.beginPath(); ctx.moveTo(-9, hy + 1.2); ctx.quadraticCurveTo(0, hy + 2.8, 9, hy + 1.2); ctx.lineTo(9, hy + 9); ctx.lineTo(-9, hy + 9); ctx.closePath();
      ctx.fillStyle = '#3a3f5c'; ctx.fill();
      ctx.strokeStyle = '#555b80'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(-6, hy + 4); ctx.quadraticCurveTo(0, hy + 5.5, 6, hy + 4); ctx.stroke();
      ctx.fillStyle = '#d63a4a'; ctx.beginPath(); ctx.moveTo(-9, hy - 5.6); ctx.quadraticCurveTo(0, hy - 7.2, 9, hy - 5.6); ctx.lineTo(9, hy - 3.6); ctx.quadraticCurveTo(0, hy - 5.2, -9, hy - 3.6); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(-7.4, hy - 4.8); ctx.quadraticCurveTo(-10.5, hy - 7, -13.4, hy - 5.2); ctx.lineTo(-12.6, hy - 4); ctx.quadraticCurveTo(-10, hy - 5.2, -7.6, hy - 3.6); ctx.closePath(); sf(ctx, '#d63a4a', OL, L);
      ctx.beginPath(); ctx.moveTo(-7.4, hy - 4.2); ctx.quadraticCurveTo(-10, hy - 2.6, -12.4, hy - 0.8); ctx.lineTo(-11.4, hy + 0.2); ctx.quadraticCurveTo(-9.6, hy - 1.8, -7.4, hy - 3.2); ctx.closePath(); sf(ctx, '#b82a3a', OL, L);
      break;
    }
    case 'chef': {
      ctx.beginPath(); ctx.arc(-4.4, hy - 11, 3.7, 0, TAU); ctx.moveTo(4.2, hy - 12.8); ctx.arc(0, hy - 12.8, 4.2, 0, TAU); ctx.moveTo(8.1, hy - 11); ctx.arc(4.4, hy - 11, 3.7, 0, TAU);
      sf(ctx, '#ffffff', '#6b6470', L);
      ctx.save(); ctx.clip(); underShade(ctx, 0, hy - 11, 8, 4, 0.2); ctx.restore();
      rr(ctx, -6.4, hy - 9.2, 12.8, 3.6, 1.2); sf(ctx, '#f4f2f6', '#6b6470', L);
      ctx.strokeStyle = '#d8d4dc'; ctx.lineWidth = 0.4; for (const k of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(k, hy - 9); ctx.lineTo(k, hy - 5.8); ctx.stroke(); }
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(0, hy + 3.0); ctx.quadraticCurveTo(s * 2.4, hy + 2.0, s * 4.4, hy + 3.4); ctx.quadraticCurveTo(s * 5.4, hy + 2.6, s * 4.6, hy + 1.8);
        ctx.quadraticCurveTo(s * 5.6, hy + 4.4, s * 3.4, hy + 4.0); ctx.quadraticCurveTo(s * 1.6, hy + 3.4, 0, hy + 3.6); ctx.closePath();
        sf(ctx, '#3a2a22', '#1a1010', 0.6);
      }
      break;
    }
    case 'chonk': {
      const dome = () => { ctx.beginPath(); ctx.ellipse(0, hy - 2.4, 9.9, 7.4, 0, Math.PI, TAU); ctx.closePath(); };
      dome(); sf(ctx, '#6b7a3a', OL, L);
      ctx.save(); dome(); ctx.clip();
      ctx.strokeStyle = 'rgba(40,50,20,0.45)'; ctx.lineWidth = 0.4;
      for (let k = -10; k < 10; k += 2.2) { ctx.beginPath(); ctx.moveTo(k, hy - 10); ctx.lineTo(k + 4, hy - 2); ctx.moveTo(k + 4, hy - 10); ctx.lineTo(k, hy - 2); ctx.stroke(); }
      gloss(ctx, -2, hy - 7, 7, 4, 0.3); ctx.restore();
      rr(ctx, -10.6, hy - 3.6, 21.2, 2.6, 1.3); sf(ctx, '#55622c', OL, L);
      starPath(ctx, 0, hy - 6.4, 1.8, 0.75); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = '#3d4520'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-9, hy - 1.2); ctx.quadraticCurveTo(-8, hy + 6, 0, hy + 7.6); ctx.stroke();
      break;
    }
    case 'duchess': {
      ctx.beginPath(); ctx.moveTo(-5.6, hy - 6.2); ctx.lineTo(-4.2, hy - 9.2); ctx.lineTo(-2.2, hy - 7.6); ctx.lineTo(0, hy - 11.2); ctx.lineTo(2.2, hy - 7.6); ctx.lineTo(4.2, hy - 9.2); ctx.lineTo(5.6, hy - 6.2); ctx.quadraticCurveTo(0, hy - 7.6, -5.6, hy - 6.2); ctx.closePath();
      const g = ctx.createLinearGradient(0, hy - 11, 0, hy - 6); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9c3d6');
      sf(ctx, g, '#4a4a66', L);
      circ(ctx, 0, hy - 8.0, 1.1); sf(ctx, '#ff5fa2', '#7a1f4a', 0.4);
      circ(ctx, -4.2, hy - 8.7, 0.55); ctx.fillStyle = '#9fd8ff'; ctx.fill(); circ(ctx, 4.2, hy - 8.7, 0.55); ctx.fill();
      circ(ctx, 0, hy - 11.4, 0.6); ctx.fillStyle = '#ffffff'; ctx.fill();
      break;
    }
    case 'clawbeard': {
      ctx.strokeStyle = '#1a1418'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-8, hy + 1.6); ctx.lineTo(6.8, hy - 6.2); ctx.stroke();
      ell(ctx, -3.05, hy - 0.2, 2.3, 2.5); sf(ctx, '#1a1418', '#000', 0.4);
      ctx.save(); ctx.translate(0.3, hy - 5.8); ctx.scale(1.45, 1.45);
      const p = () => { ctx.beginPath(); ctx.moveTo(-7.2, 0.8); ctx.quadraticCurveTo(-6.8, -3.4, -3.6, -4.6); ctx.quadraticCurveTo(0, -7.6, 3.6, -4.6); ctx.quadraticCurveTo(6.8, -3.4, 7.2, 0.8); ctx.quadraticCurveTo(0, -1.4, -7.2, 0.8); ctx.closePath(); };
      p(); sf(ctx, '#2b2733', '#0d0b10', 0.8);
      ctx.save(); p(); ctx.clip(); gloss(ctx, -2, -4, 5, 3, 0.25); ctx.restore();
      ctx.strokeStyle = '#e8bf4f'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-6.6, 0.1); ctx.quadraticCurveTo(0, -2.0, 6.6, 0.1); ctx.stroke();
      circ(ctx, 0, -3.4, 1.25); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#2b2733'; circ(ctx, -0.45, -3.5, 0.3); ctx.fill(); circ(ctx, 0.45, -3.5, 0.3); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(7.6, hy - 1.2, 1.3, 0, TAU); ctx.strokeStyle = '#ffd447'; ctx.lineWidth = 0.55; ctx.stroke();
      break;
    }
    case 'neko': {
      ell(ctx, 0, hy + 7.8, 6.9, 1.7); sf(ctx, '#e8473f', OL, L);
      circ(ctx, 0, hy + 9.8, 1.9); sf(ctx, '#ffd447', '#7a4d10', 0.6);
      ctx.strokeStyle = '#7a4d10'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(-1.2, hy + 10.2); ctx.lineTo(1.2, hy + 10.2); ctx.stroke();
      circ(ctx, 0, hy + 10.9, 0.35); ctx.fillStyle = '#7a4d10'; ctx.fill();
      capsule(ctx, -6.6, hy + 13, -9.0, hy + 0.8, 2.6); sf(ctx, P.base, P.line, L);
      ell(ctx, -9.2, hy - 0.6, 3.2, 3.0); sf(ctx, P.base, P.line, L);
      ctx.fillStyle = '#ffadc2';
      ell(ctx, -9.1, hy + 0.4, 1.3, 1.0); ctx.fill();
      circ(ctx, -10.8, hy - 1.4, 0.6); ctx.fill(); circ(ctx, -9.2, hy - 2.3, 0.6); ctx.fill(); circ(ctx, -7.6, hy - 1.4, 0.6); ctx.fill();
      ctx.strokeStyle = P.line; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.arc(-9.2, hy - 4.4, 2.2, 3.6, 5.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(-9.2, hy - 4.4, 3.4, 3.7, 5.7); ctx.stroke();
      break;
    }
    case 'astro': {
      ctx.strokeStyle = '#2a1830'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(4, hy - 9.5); ctx.lineTo(6, hy - 13); ctx.stroke();
      circ(ctx, 6, hy - 13, 1); ctx.fillStyle = '#ff5468'; ctx.fill();
      circ(ctx, 0, hy + 0.6, 10.4);
      ctx.fillStyle = 'rgba(190,230,255,0.2)'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#2a1830'; ctx.stroke();
      ctx.lineWidth = 0.8; ctx.strokeStyle = '#dff3ff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, hy + 0.6, 8.8, 3.5, 4.4); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, hy + 0.6, 8.8, 4.6, 4.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, hy + 0.6, 9, 0.3, 0.7); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
      break;
    }
    case 'purrcival': {
      ctx.save(); headClip(ctx, rx, ry, hy);
      ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.moveTo(-9, hy - 6.6); ctx.quadraticCurveTo(0, hy - 7.6, 9, hy - 6.6); ctx.lineTo(9, hy - 4.8); ctx.quadraticCurveTo(0, hy - 5.8, -9, hy - 4.8); ctx.closePath(); ctx.fill();
      ctx.restore();
      for (const s of [-1, 1]) {
        circ(ctx, s * 3.3, hy - 5.9, 2.5); sf(ctx, '#d9a441', OL, L);
        circ(ctx, s * 3.3, hy - 5.9, 1.7); ctx.fillStyle = '#9fd8f0'; ctx.fill();
        circ(ctx, s * 3.3 - 0.6, hy - 6.5, 0.55); ctx.fillStyle = '#ffffff'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(3.05, hy - 0.1, 2.5, 0, TAU); ctx.fillStyle = 'rgba(200,240,255,0.25)'; ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4.4, hy + 2.0); ctx.quadraticCurveTo(6.5, hy + 6, 5, hy + 9.5); ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 0.4; ctx.setLineDash([0.6, 0.4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, hy + 8.4); ctx.lineTo(-3, hy + 7); ctx.lineTo(-3, hy + 9.8); ctx.closePath(); ctx.moveTo(0, hy + 8.4); ctx.lineTo(3, hy + 7); ctx.lineTo(3, hy + 9.8); ctx.closePath();
      sf(ctx, '#d63a4a', OL, 0.8); circ(ctx, 0, hy + 8.4, 0.8); ctx.fillStyle = '#a82a3a'; ctx.fill();
      break;
    }
    case 'luna': {
      ell(ctx, 0.3, hy - 5.6, 10.8, 2.5); sf(ctx, '#3e2670', OL, L);
      const cone = () => { ctx.beginPath(); ctx.moveTo(-5.6, hy - 6); ctx.quadraticCurveTo(-3, hy - 12, 1.5, hy - 13.6); ctx.quadraticCurveTo(5, hy - 14.6, 8.4, hy - 12.2); ctx.quadraticCurveTo(4.4, hy - 12, 3.6, hy - 10.8); ctx.quadraticCurveTo(4.6, hy - 8, 5.6, hy - 6); ctx.quadraticCurveTo(0, hy - 4.8, -5.6, hy - 6); ctx.closePath(); };
      cone(); sf(ctx, '#5b3a9a', OL, L);
      ctx.save(); cone(); ctx.clip(); ctx.fillStyle = '#b08cff'; ctx.fillRect(-7, hy - 7.8, 14, 1.8); gloss(ctx, -2, hy - 10, 4, 4, 0.3); ctx.restore();
      ctx.beginPath(); ctx.arc(-1.2, hy - 9.6, 1.6, 0, TAU); ctx.arc(-0.5, hy - 10.0, 1.4, 0, TAU, true); ctx.fillStyle = '#ffd447'; ctx.fill('evenodd');
      starPath(ctx, 2.2, hy - 8.8, 0.6, 0.25); ctx.fill();
      break;
    }
    case 'glitch': {
      ctx.beginPath(); ctx.arc(0, hy + 0.5, 9.2, Math.PI * 1.08, Math.PI * 1.92);
      ctx.strokeStyle = '#2a1830'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 1.3; ctx.stroke();
      for (const s of [-1, 1]) {
        rr(ctx, s * 9.2 - 1.9, hy - 2.6, 3.8, 6.4, 1.6); sf(ctx, '#3a3a48', OL, L);
        rr(ctx, s * 9.2 - 0.6, hy - 1.2, 1.2, 3.6, 0.6); ctx.fillStyle = '#3de0ff'; ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(-8.6, hy + 2.6); ctx.quadraticCurveTo(-7.4, hy + 6.6, -3.2, hy + 5.4); ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 0.8; ctx.stroke();
      circ(ctx, -3, hy + 5.3, 0.9); ctx.fillStyle = '#3a3a48'; ctx.fill();
      ctx.fillStyle = '#0d0d12';
      const px = 0.9, y0 = hy - 1.9;
      ctx.fillRect(-6.8, y0, 13.6, px);
      for (const s of [-1, 1]) { const x0 = s < 0 ? -6.3 : 0.9; ctx.fillRect(x0, y0 + px, 5.4, px * 2); ctx.fillRect(x0 + px, y0 + px * 3, 5.4 - px * 2, px); }
      ctx.fillStyle = '#ffffff';
      for (const x0 of [-5.4, 1.8]) { ctx.fillRect(x0, y0 + px, px * 0.9, px * 0.9); ctx.fillRect(x0 + px, y0 + px * 2, px * 0.9, px * 0.9); }
      break;
    }
  }
}
function drawHeroBust(ctx, h, P) {
  const hy = 3.4;
  const chonk = h.id === 'chonk';
  const rx = chonk ? 9.4 : 7.9, ry = chonk ? 7.8 : 7.2;
  if (h.id === 'astro') { ell(ctx, 0, 10.6, 9.2, 2.4); sf(ctx, '#c9ced8', '#2a1830', OUTW * 2); }
  outfit(ctx, h.id, P);
  if (h.id === 'astro') { ell(ctx, 0, 10.2, 8.6, 2.2); sf(ctx, '#d9dee6', '#2a1830', OUTW * 2); }
  drawCatHead(ctx, P, 0, hy, { faceOff: 0, ears: [-2.12, -1.02], rx, ry, lashes: h.id === 'duchess', seed: hashStr(h.id) % 1000 });
  heroAccessory(ctx, h.id, P, hy, rx, ry);
}
export function drawHeroPortrait(ctx, heroId, cx, cy, size) {
  const h = HERO_BY_ID[heroId] || HEROES[0];
  const fur = FUR_BY_ID[h.fur] || FURS[0];
  const P = furPal(fur);
  const col = (CLANS[h.clan] || { color: '#ffcf4d' }).color;
  const K = size / 100;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(K, K);
  const g = ctx.createRadialGradient(-14, -18, 4, 0, 0, 52);
  g.addColorStop(0, shade(col, 0.6)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.4));
  circ(ctx, 0, 0, 48); ctx.fillStyle = g; ctx.fill();
  ctx.save(); circ(ctx, 0, 0, 48); ctx.clip();
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(0, 8); ctx.arc(0, 8, 80, a, a + 0.15); ctx.closePath(); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.scale(3.6, 3.6); drawHeroBust(ctx, h, P); ctx.restore();
  ctx.restore();
  circ(ctx, 0, 0, 48); ctx.lineWidth = 4; ctx.strokeStyle = shade(col, -0.5); ctx.stroke();
  circ(ctx, 0, 0, 45.6); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
  ctx.restore();
}
export function heroPortraitURL(heroId, size = 128) {
  const key = 'h|' + heroId + '|' + size;
  let u = _urlCache.get(key);
  if (u) return u;
  const c = makeCanvas(size, size);
  drawHeroPortrait(c.getContext('2d'), heroId, size / 2, size / 2, size);
  u = c.toDataURL('image/png');
  _urlCache.set(key, u);
  return u;
}
