// Whisker Wars — synthesized audio. Every sound and every note of music is generated
// at runtime with the Web Audio API. No audio files, no libraries.
//
//   audio.init()                         call on the first user gesture (safe to repeat)
//   audio.play(name, {vol, pitch, pan})  fire-and-forget sound effect
//   audio.music(track)                   'menu' | 'battle' | 'tense' | 'victory' | 'defeat' | null
//   audio.setVolumes({sfx, music})       0..1 each
//   audio.setMuted(bool) / audio.muted / audio.ready

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- state
let ac = null;
let master, comp, limiter, sfxBus, musicBus, reverb;
let sfxVol = 0.8, musicVol = 0.45, isMuted = false;
let wantTrack = null, curTrack = null;
const players = [];
let schedTimer = null;
const recent = new Map();

// ---------------------------------------------------------------- shared buffers
const noiseCache = new WeakMap();
function noiseBuffer(c) {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}
const pulseCache = new WeakMap();
function pulseWave(c, duty) {
  let m = pulseCache.get(c);
  if (!m) { m = {}; pulseCache.set(c, m); }
  if (!m[duty]) {
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    m[duty] = c.createPeriodicWave(re, im);
  }
  return m[duty];
}
function impulse(c, seconds = 1.8) {
  const len = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

// ---------------------------------------------------------------- building blocks
function disc(...nodes) { for (const n of nodes) { try { n && n.disconnect(); } catch (e) { /* ignore */ } } }

function envGain(c, t, a, peak, dur, hold = 0) {
  const g = c.createGain();
  const end = t + Math.max(dur, a + hold + 0.01);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  if (hold > 0) g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  return g;
}

// attack / decay / sustain / release on an AudioParam. Returns end time.
function adsr(param, t, peak, a, dcy, sus, dur, rel) {
  peak = Math.max(peak, 0.0002);
  const s = Math.max(peak * sus, 0.0001);
  const tOff = t + Math.max(dur, a + 0.01);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (t + a + dcy < tOff) { param.exponentialRampToValueAtTime(s, t + a + dcy); param.setValueAtTime(s, tOff); }
  else param.exponentialRampToValueAtTime(s, tOff);
  param.exponentialRampToValueAtTime(0.0001, tOff + rel);
  return tOff + rel;
}

// One oscillator voice with optional pitch glide, vibrato and swept lowpass.
function tone(c, dest, o) {
  const { type = 'sine', f, f2, t, dur, a = 0.005, peak = 0.3, hold = 0, gt, lin = false,
    detune = 0, wave, vib = 0, vibRate = 6, vibDelay = 0, lp } = o;
  const osc = c.createOscillator();
  if (wave) osc.setPeriodicWave(wave); else osc.type = type;
  osc.frequency.setValueAtTime(Math.max(f, 1), t);
  if (f2) {
    const tt = t + (gt ?? dur);
    if (lin) osc.frequency.linearRampToValueAtTime(f2, tt);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), tt);
  }
  if (detune) osc.detune.setValueAtTime(detune, t);
  const g = envGain(c, t, a, peak, dur, hold);
  let lfo = null, lg = null, flt = null;
  if (vib) {
    lfo = c.createOscillator(); lfo.frequency.setValueAtTime(vibRate, t);
    lg = c.createGain();
    lg.gain.setValueAtTime(0, t + vibDelay);
    lg.gain.linearRampToValueAtTime(vib, t + vibDelay + 0.12);
    lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.06);
  }
  if (lp) {
    flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.setValueAtTime(lp[2] ?? 0.8, t);
    flt.frequency.setValueAtTime(lp[0], t);
    if (lp[1] && lp[1] !== lp[0]) flt.frequency.exponentialRampToValueAtTime(lp[1], t + (gt ?? dur));
    osc.connect(flt); flt.connect(g);
  } else osc.connect(g);
  g.connect(dest);
  osc.start(t); osc.stop(t + dur + 0.06);
  osc.onended = () => disc(osc, g, lfo, lg, flt);
  return osc;
}

// Filtered noise burst with optional cutoff sweep.
function noise(c, dest, o) {
  const { t, dur, a = 0.005, peak = 0.3, hold = 0, type = 'bandpass', f = 1000, f2, q = 1, gt, lin = false } = o;
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true;
  const flt = c.createBiquadFilter(); flt.type = type; flt.Q.setValueAtTime(q, t);
  flt.frequency.setValueAtTime(f, t);
  if (f2) {
    const tt = t + (gt ?? dur);
    if (lin) flt.frequency.linearRampToValueAtTime(f2, tt); else flt.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), tt);
  }
  const g = envGain(c, t, a, peak, dur, hold);
  src.connect(flt); flt.connect(g); g.connect(dest);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.06);
  src.onended = () => disc(src, flt, g);
  return src;
}

function bandpassSweep(c, t, dur, points, q) {
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.setValueAtTime(q, t);
  f.frequency.setValueAtTime(points[0][1], t);
  for (let i = 1; i < points.length; i++) f.frequency.linearRampToValueAtTime(points[i][1], t + dur * points[i][0]);
  return f;
}

// ---------------------------------------------------------------- the meow
// Sawtooth "vocal cords" -> mouth lowpass (m- opening, -ow closing) -> two moving formants.
function meowVoice(c, d, t, p, { f0, fp, fe, dur, vol }) {
  const src = c.createOscillator(); src.type = 'sawtooth';
  const fr = src.frequency;
  fr.setValueAtTime(f0 * p, t);
  fr.linearRampToValueAtTime(fp * p, t + dur * 0.32);
  fr.exponentialRampToValueAtTime(fe * p, t + dur);
  const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(7.2, t);
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(fp * p * 0.025, t + dur * 0.6);
  lfo.connect(lg); lg.connect(fr);

  const mouth = c.createBiquadFilter(); mouth.type = 'lowpass'; mouth.Q.setValueAtTime(1.5, t);
  mouth.frequency.setValueAtTime(450, t);
  mouth.frequency.exponentialRampToValueAtTime(4200, t + dur * 0.22);
  mouth.frequency.exponentialRampToValueAtTime(1300, t + dur);

  const F1 = bandpassSweep(c, t, dur, [[0, 600 * p], [0.35, 1050 * p], [1, 620 * p]], 4);
  const F2 = bandpassSweep(c, t, dur, [[0, 2500 * p], [0.4, 1750 * p], [1, 1050 * p]], 6);
  const g1 = c.createGain(); g1.gain.value = 2.2;
  const g2 = c.createGain(); g2.gain.value = 1.4;
  const g3 = c.createGain(); g3.gain.value = 0.18;
  const out = envGain(c, t, 0.035, vol, dur, dur * 0.45);
  src.connect(mouth);
  mouth.connect(F1); F1.connect(g1); g1.connect(out);
  mouth.connect(F2); F2.connect(g2); g2.connect(out);
  mouth.connect(g3); g3.connect(out);
  out.connect(d);
  src.start(t); lfo.start(t);
  src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  src.onended = () => disc(src, lfo, lg, mouth, F1, F2, g1, g2, g3, out);
  noise(c, d, { t, dur: dur * 0.45, a: 0.02, peak: vol * 0.04, type: 'bandpass', f: 3800, q: 1 });
}

// ---------------------------------------------------------------- music instruments
// Signature: (ctx, dest, time, midi, durationSeconds, velocity)
function ep(c, d, t, m, dur, v) { // FM electric piano
  const f = mtof(m);
  const car = c.createOscillator(); car.type = 'sine'; car.frequency.setValueAtTime(f, t);
  const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.setValueAtTime(f, t);
  const mg = c.createGain();
  mg.gain.setValueAtTime(f * 1.1, t); mg.gain.exponentialRampToValueAtTime(f * 0.06, t + 0.45);
  mod.connect(mg); mg.connect(car.frequency);
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.1 * v, 0.006, 0.55, 0.35, dur, 0.5);
  car.connect(g); g.connect(d);
  car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
  car.onended = () => disc(car, mod, mg, g);
}
function vibe(c, d, t, m, dur, v) { // soft vibraphone with tremolo
  const f = mtof(m);
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
  const trem = c.createGain(); trem.gain.setValueAtTime(0.8, t);
  const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(4.6, t);
  const lg = c.createGain(); lg.gain.setValueAtTime(0.2, t);
  lfo.connect(lg); lg.connect(trem.gain);
  const g = envGain(c, t, 0.004, 0.11 * v, Math.max(dur, 0.25) + 1.1);
  o.connect(trem); trem.connect(g); g.connect(d);
  const end = t + Math.max(dur, 0.25) + 1.15;
  o.start(t); lfo.start(t); o.stop(end); lfo.stop(end);
  o.onended = () => disc(o, trem, lfo, lg, g);
  tone(c, d, { type: 'sine', f: f * 4, t, dur: 0.18, a: 0.002, peak: 0.018 * v });
}
function bassSoft(c, d, t, m, dur, v) {
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.setValueAtTime(f, t);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(f, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(800, t);
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.32 * v, 0.01, 0.3, 0.55, dur, 0.12);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g);
}
function bassChip(c, d, t, m, dur, v) {
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.setValueAtTime(f, t);
  const o2 = c.createOscillator(); o2.setPeriodicWave(pulseWave(c, 0.5)); o2.frequency.setValueAtTime(f, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(500, t + 0.12);
  const g1 = c.createGain(); g1.gain.value = 1;
  const g2 = c.createGain(); g2.gain.value = 0.28;
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.3 * v, 0.004, 0.1, 0.6, dur, 0.05);
  o1.connect(g1); g1.connect(g); o2.connect(lp); lp.connect(g2); g2.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g1, g2, g);
}
function pluck(c, d, t, m, dur, v) { // chiptune-ish pulse lead
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.setPeriodicWave(pulseWave(c, 0.25)); o1.frequency.setValueAtTime(f, t);
  const o2 = c.createOscillator(); o2.setPeriodicWave(pulseWave(c, 0.25)); o2.frequency.setValueAtTime(f, t); o2.detune.setValueAtTime(9, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.setValueAtTime(1.2, t);
  lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(1900, t + 0.14);
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.075 * v, 0.004, 0.1, 0.6, dur, 0.07);
  let lfo = null, lg = null;
  if (dur > 0.24) {
    lfo = c.createOscillator(); lfo.frequency.setValueAtTime(5.5, t);
    lg = c.createGain(); lg.gain.setValueAtTime(0, t + 0.16); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.3);
    lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    lfo.start(t); lfo.stop(end + 0.03);
  }
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g, lfo, lg);
}
function marimba(c, d, t, m, dur, v) {
  const f = mtof(m);
  tone(c, d, { type: 'sine', f, t, dur: 0.32, a: 0.002, peak: 0.13 * v });
  tone(c, d, { type: 'sine', f: f * 4, t, dur: 0.06, a: 0.001, peak: 0.03 * v });
}
function stab(c, d, t, m, dur, v) { // staccato strings
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(f, t); o1.detune.setValueAtTime(-8, t);
  const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(f, t); o2.detune.setValueAtTime(8, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1700, t); lp.Q.setValueAtTime(0.9, t);
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.045 * v, 0.005, 0.1, 0.3, dur, 0.08);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g);
}
function pad(c, d, t, m, dur, v) {
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(f, t); o1.detune.setValueAtTime(-11, t);
  const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(f, t); o2.detune.setValueAtTime(11, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t);
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.03 * v, 0.35, 0.2, 0.85, dur, 0.6);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g);
}
function brass(c, d, t, m, dur, v, wah = false) {
  const f = mtof(m);
  const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(f, t);
  const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(f, t); o2.detune.setValueAtTime(8, t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.setValueAtTime(wah ? 4 : 1, t);
  lp.frequency.setValueAtTime(wah ? 350 : 300, t);
  lp.frequency.exponentialRampToValueAtTime(wah ? 1500 : 2600, t + 0.07);
  lp.frequency.exponentialRampToValueAtTime(wah ? 450 : 1300, t + Math.max(dur, 0.1));
  const g = c.createGain();
  const end = adsr(g.gain, t, 0.07 * v, 0.03, 0.15, 0.8, dur, 0.12);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(d);
  o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
  o1.onended = () => disc(o1, o2, lp, g);
  return [o1, o2];
}
// drums
function kick(c, d, t, m, dur, v) {
  tone(c, d, { type: 'sine', f: 155, f2: 45, gt: 0.11, t, dur: 0.32, a: 0.002, peak: 0.75 * v });
  noise(c, d, { t, dur: 0.015, a: 0.001, peak: 0.08 * v, type: 'highpass', f: 3000 });
}
function snare(c, d, t, m, dur, v) {
  noise(c, d, { t, dur: 0.16, a: 0.001, peak: 0.3 * v, type: 'bandpass', f: 2600, q: 0.6 });
  tone(c, d, { type: 'triangle', f: 210, f2: 170, t, dur: 0.09, a: 0.001, peak: 0.2 * v });
}
function hat(c, d, t, m, dur, v) { noise(c, d, { t, dur: 0.04, a: 0.001, peak: 0.13 * v, type: 'highpass', f: 7500, q: 0.5 }); }
function ohat(c, d, t, m, dur, v) { noise(c, d, { t, dur: 0.22, a: 0.001, peak: 0.1 * v, type: 'highpass', f: 7000, q: 0.5 }); }
function shaker(c, d, t, m, dur, v) { noise(c, d, { t, dur: 0.07, a: 0.012, peak: 0.07 * v, type: 'bandpass', f: 7000, q: 1.2 }); }
function rim(c, d, t, m, dur, v) {
  tone(c, d, { type: 'triangle', f: 1100, t, dur: 0.035, a: 0.001, peak: 0.12 * v });
  tone(c, d, { type: 'sine', f: 1700, t, dur: 0.02, a: 0.001, peak: 0.07 * v });
}
function tom(c, d, t, m, dur, v) { const f = mtof(m || 50); tone(c, d, { type: 'sine', f, f2: f * 0.65, gt: 0.25, t, dur: 0.3, a: 0.002, peak: 0.42 * v }); }
function crash(c, d, t, m, dur, v) {
  noise(c, d, { t, dur: 1.4, a: 0.003, peak: 0.11 * v, type: 'highpass', f: 4500, q: 0.4 });
  noise(c, d, { t, dur: 0.9, a: 0.003, peak: 0.05 * v, type: 'bandpass', f: 8000, q: 0.8 });
}

// ---------------------------------------------------------------- sound effects
// Each takes (ctx, dest, time, pitchMultiplier) and returns its length in seconds.
const SFX = {
  meow(c, d, t, p) { meowVoice(c, d, t, p, { f0: 600, fp: 900, fe: 480, dur: 0.42, vol: 0.55 }); return 0.5; },
  mew(c, d, t, p) { meowVoice(c, d, t, p, { f0: 950, fp: 1320, fe: 860, dur: 0.22, vol: 0.45 }); return 0.3; },
  hiss(c, d, t, p) {
    noise(c, d, { t, dur: 0.55, a: 0.06, hold: 0.2, peak: 0.3, type: 'highpass', f: 2600 * p, q: 0.7 });
    noise(c, d, { t, dur: 0.5, a: 0.05, hold: 0.15, peak: 0.22, type: 'bandpass', f: 5600 * p, f2: 4200 * p, q: 2 });
    return 0.6;
  },
  purr(c, d, t, p) {
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(280 * p, t);
    const am = c.createGain(); am.gain.setValueAtTime(0.5, t);
    const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(24 * p, t);
    const lg = c.createGain(); lg.gain.setValueAtTime(0.5, t);
    lfo.connect(lg); lg.connect(am.gain);
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(52 * p, t);
    const sg = c.createGain(); sg.gain.setValueAtTime(0.5, t);
    const env = c.createGain(); const e = env.gain;
    e.setValueAtTime(0.0001, t); e.linearRampToValueAtTime(0.9, t + 0.15); e.linearRampToValueAtTime(0.6, t + 0.38);
    e.linearRampToValueAtTime(0.1, t + 0.43); e.linearRampToValueAtTime(0.75, t + 0.56); e.exponentialRampToValueAtTime(0.0001, t + 0.86);
    src.connect(lp); lp.connect(am); sub.connect(sg); sg.connect(am); am.connect(env); env.connect(d);
    src.start(t, Math.random()); lfo.start(t); sub.start(t);
    src.stop(t + 0.9); lfo.stop(t + 0.9); sub.stop(t + 0.9);
    src.onended = () => disc(src, lp, am, lfo, lg, sub, sg, env);
    return 0.9;
  },
  click(c, d, t, p) {
    tone(c, d, { f: 1300 * p, f2: 900 * p, t, dur: 0.05, a: 0.002, peak: 0.22 });
    noise(c, d, { t, dur: 0.02, a: 0.001, peak: 0.06, type: 'highpass', f: 4000 });
    return 0.08;
  },
  hover(c, d, t, p) { tone(c, d, { f: 2200 * p, t, dur: 0.03, a: 0.002, peak: 0.05 }); return 0.05; },
  back(c, d, t, p) { tone(c, d, { type: 'triangle', f: 900 * p, f2: 520 * p, t, dur: 0.1, a: 0.003, peak: 0.24 }); return 0.12; },
  error(c, d, t, p) {
    tone(c, d, { f: 330 * p, f2: 160 * p, gt: 0.08, t, dur: 0.2, a: 0.002, peak: 0.36 });
    noise(c, d, { t, dur: 0.06, a: 0.001, peak: 0.12, type: 'lowpass', f: 700 });
    tone(c, d, { type: 'triangle', f: 250 * p, f2: 150 * p, t: t + 0.11, dur: 0.18, a: 0.002, peak: 0.22 });
    return 0.32;
  },
  send(c, d, t, p) {
    noise(c, d, { t, dur: 0.32, a: 0.08, peak: 0.16, type: 'bandpass', f: 500 * p, f2: 2400 * p, q: 1.2 });
    for (let i = 0; i < 6; i++) tone(c, d, { f: rand(1300, 1900) * p, t: t + 0.05 + i * 0.045 + rand(0, 0.01), dur: 0.04, a: 0.001, peak: 0.06 });
    return 0.4;
  },
  pop(c, d, t, p) {
    tone(c, d, { f: 380 * p, f2: 1200 * p, gt: 0.045, t, dur: 0.08, a: 0.002, peak: 0.38 });
    tone(c, d, { f: 1800 * p, t: t + 0.04, dur: 0.025, a: 0.001, peak: 0.05 });
    return 0.1;
  },
  hit(c, d, t, p) {
    tone(c, d, { f: 190 * p, f2: 60, gt: 0.1, t, dur: 0.16, a: 0.002, peak: 0.45 });
    noise(c, d, { t, dur: 0.06, a: 0.001, peak: 0.16, type: 'lowpass', f: 900 });
    return 0.18;
  },
  fight(c, d, t, p) {
    SFX.hit(c, d, t, p);
    for (let i = 0; i < 8; i++) noise(c, d, { t: t + i * 0.06 + rand(0, 0.02), dur: 0.07, a: 0.003, peak: rand(0.1, 0.2), type: 'bandpass', f: rand(600, 3000) * p, q: 2 });
    for (let i = 0; i < 2; i++) tone(c, d, { type: 'square', f: rand(300, 500) * p, f2: rand(600, 900) * p, t: t + rand(0.1, 0.4), dur: 0.06, a: 0.002, peak: 0.04 });
    noise(c, d, { t: t + 0.18, dur: 0.12, a: 0.01, peak: 0.08, type: 'highpass', f: 3500 });
    return 0.65;
  },
  shot(c, d, t, p) {
    noise(c, d, { t, dur: 0.14, a: 0.003, peak: 0.24, type: 'bandpass', f: 2400 * p, f2: 500 * p, q: 1.5 });
    tone(c, d, { type: 'triangle', f: 800 * p, f2: 280 * p, t, dur: 0.12, a: 0.002, peak: 0.15 });
    return 0.16;
  },
  capture(c, d, t, p) {
    const pw = pulseWave(c, 0.25);
    [72, 76, 79, 84].forEach((m, i) => {
      const tt = t + i * 0.07, f = mtof(m) * p;
      tone(c, d, { wave: pw, f, t: tt, dur: 0.18, a: 0.003, peak: 0.08 });
      tone(c, d, { type: 'triangle', f, t: tt, dur: 0.2, a: 0.003, peak: 0.14 });
    });
    [84, 88, 91].forEach(m => tone(c, d, { type: 'triangle', f: mtof(m) * p, t: t + 0.28, dur: 0.5, a: 0.005, peak: 0.09, vib: 8, vibRate: 6, vibDelay: 0.1 }));
    noise(c, d, { t: t + 0.28, dur: 0.4, a: 0.02, peak: 0.05, type: 'highpass', f: 8000 });
    return 0.85;
  },
  lost(c, d, t, p) {
    tone(c, d, { type: 'triangle', f: 620 * p, f2: 420 * p, gt: 0.18, t, dur: 0.22, a: 0.004, peak: 0.3 });
    tone(c, d, { type: 'triangle', f: 440 * p, f2: 250 * p, gt: 0.3, t: t + 0.2, dur: 0.36, a: 0.004, peak: 0.3 });
    return 0.6;
  },
  upgrade(c, d, t, p) {
    [67, 69, 72, 74, 76, 79, 81, 84].forEach((m, i) => {
      const f = mtof(m) * p, tt = t + i * 0.045;
      tone(c, d, { type: 'triangle', f, t: tt, dur: 0.25, a: 0.003, peak: 0.14 });
      tone(c, d, { f: f * 2, t: tt, dur: 0.15, a: 0.002, peak: 0.04 });
    });
    noise(c, d, { t: t + 0.15, dur: 0.5, a: 0.05, peak: 0.04, type: 'highpass', f: 6000 });
    return 0.75;
  },
  convert(c, d, t, p) {
    tone(c, d, { f: 400 * p, f2: 1200 * p, lin: true, t, dur: 0.6, a: 0.05, hold: 0.25, peak: 0.12, vib: 150 * p, vibRate: 12 });
    tone(c, d, { type: 'triangle', f: 600 * p, f2: 1800 * p, lin: true, t, dur: 0.6, a: 0.05, hold: 0.2, peak: 0.06, vib: 200 * p, vibRate: 9 });
    noise(c, d, { t, dur: 0.6, a: 0.1, peak: 0.08, type: 'bandpass', f: 800, f2: 4000, q: 2 });
    return 0.7;
  },
  coin(c, d, t, p) {
    tone(c, d, { type: 'square', f: mtof(83) * p, t, dur: 0.07, a: 0.002, peak: 0.07 });
    tone(c, d, { type: 'square', f: mtof(88) * p, t: t + 0.07, dur: 0.35, a: 0.002, hold: 0.04, peak: 0.07 });
    tone(c, d, { f: mtof(88) * p * 2, t: t + 0.07, dur: 0.2, a: 0.002, peak: 0.04 });
    return 0.45;
  },
  coins(c, d, t, p) {
    const ns = [83, 85, 88, 90, 95];
    for (let i = 0; i < 10; i++) {
      const tt = t + i * 0.08 + rand(0, 0.03), f = mtof(ns[Math.floor(Math.random() * ns.length)]) * p;
      tone(c, d, { type: 'square', f, t: tt, dur: 0.18, a: 0.002, peak: 0.045 });
      tone(c, d, { f: f * 2, t: tt, dur: 0.12, a: 0.002, peak: 0.035 });
    }
    return 1.15;
  },
  unlock(c, d, t, p) {
    [[0, 67, 0.12], [0.14, 67, 0.12], [0.28, 67, 0.12], [0.42, 72, 0.75]].forEach(([o, m, l]) => brass(c, d, t + o, m + 12 * Math.log2(p), l, 1.3));
    [60, 64, 67].forEach(m => brass(c, d, t + 0.42, m, 0.8, 0.9));
    kick(c, d, t, 0, 0, 0.8); kick(c, d, t + 0.42, 0, 0, 1);
    tom(c, d, t + 0.28, 45, 0, 0.6);
    crash(c, d, t + 0.42, 0, 0, 0.9);
    [84, 88, 91, 96].forEach((m, i) => tone(c, d, { f: mtof(m) * p, t: t + 0.55 + i * 0.06, dur: 0.4, a: 0.003, peak: 0.07 }));
    return 1.5;
  },
  countdown(c, d, t, p) {
    tone(c, d, { f: 880 * p, t, dur: 0.15, a: 0.003, hold: 0.06, peak: 0.3 });
    tone(c, d, { type: 'triangle', f: 1760 * p, t, dur: 0.1, a: 0.003, peak: 0.05 });
    return 0.2;
  },
  go(c, d, t, p) {
    tone(c, d, { type: 'triangle', f: 1320 * p, t, dur: 0.6, a: 0.003, peak: 0.28 });
    tone(c, d, { f: 660 * p, t, dur: 0.7, a: 0.003, peak: 0.24 });
    tone(c, d, { f: 1980 * p, t, dur: 0.3, a: 0.003, peak: 0.07 });
    return 0.75;
  },
  emote(c, d, t, p) {
    tone(c, d, { f: 520 * p, f2: 820 * p, gt: 0.06, t, dur: 0.12, a: 0.003, peak: 0.3 });
    tone(c, d, { f: 820 * p, f2: 1040 * p, gt: 0.05, t: t + 0.08, dur: 0.1, a: 0.003, peak: 0.2 });
    return 0.2;
  },
  star(c, d, t, p) {
    tone(c, d, { f: mtof(88) * p, t, dur: 0.18, a: 0.002, peak: 0.14 });
    tone(c, d, { f: mtof(95) * p, t: t + 0.07, dur: 0.35, a: 0.002, peak: 0.14 });
    noise(c, d, { t, dur: 0.3, a: 0.02, peak: 0.04, type: 'highpass', f: 7000 });
    return 0.45;
  },

  // ---- spells
  spell(c, d, t, p) {
    [72, 76, 79, 83, 86].forEach((m, i) => {
      const f = mtof(m) * p;
      tone(c, d, { f, f2: f * 1.03, t: t + i * 0.03, dur: 0.7, a: 0.04, peak: 0.06, vib: f * 0.01, vibRate: 7 });
    });
    noise(c, d, { t, dur: 0.6, a: 0.2, peak: 0.05, type: 'highpass', f: 5000, f2: 9000 });
    return 0.8;
  },
  explosion(c, d, t, p) {
    tone(c, d, { f: 130 * p, f2: 32, gt: 0.5, t, dur: 0.8, a: 0.003, peak: 0.85 });
    noise(c, d, { t, dur: 0.9, a: 0.005, peak: 0.5, type: 'lowpass', f: 2500, f2: 180, gt: 0.7, q: 0.7 });
    noise(c, d, { t, dur: 0.3, a: 0.002, peak: 0.25, type: 'bandpass', f: 400, q: 1 });
    return 1.0;
  },
  freeze(c, d, t, p) {
    for (let i = 0; i < 11; i++) tone(c, d, { f: rand(2000, 5500) * p, t: t + rand(0, 0.5), dur: 0.25, a: 0.002, peak: 0.045 });
    noise(c, d, { t, dur: 0.8, a: 0.1, peak: 0.08, type: 'highpass', f: 6000, f2: 3000 });
    tone(c, d, { type: 'triangle', f: 1568 * p, f2: 1760 * p, t, dur: 0.8, a: 0.05, peak: 0.05, vib: 20, vibRate: 9 });
    return 1.0;
  },
  heal(c, d, t, p) {
    [60, 64, 67, 72].forEach((m, i) => {
      const f = mtof(m) * p, tt = t + i * 0.08;
      tone(c, d, { type: 'triangle', f, f2: f * 1.01, t: tt, dur: 0.9, a: 0.08, peak: 0.1 });
      tone(c, d, { f: f * 2, t: tt, dur: 0.7, a: 0.08, peak: 0.035 });
    });
    return 1.15;
  },
  buff(c, d, t, p) {
    tone(c, d, { type: 'sawtooth', f: 180 * p, f2: 1100 * p, gt: 0.45, t, dur: 0.5, a: 0.02, peak: 0.1, lp: [600, 4000] });
    noise(c, d, { t, dur: 0.5, a: 0.05, peak: 0.12, type: 'bandpass', f: 400, f2: 3000, q: 1.5 });
    return 0.6;
  },
  zap(c, d, t, p) {
    const o = c.createOscillator(); o.type = 'square';
    for (let k = 0; k < 16; k++) o.frequency.setValueAtTime(rand(200, 2000) * p, t + k * 0.015);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t);
    const g = envGain(c, t, 0.002, 0.08, 0.25);
    o.connect(lp); lp.connect(g); g.connect(d);
    o.start(t); o.stop(t + 0.3); o.onended = () => disc(o, lp, g);
    noise(c, d, { t, dur: 0.25, a: 0.002, peak: 0.1, type: 'highpass', f: 3000 });
    return 0.32;
  },
  laser(c, d, t, p) {
    tone(c, d, { type: 'square', f: 1600 * p, f2: 280 * p, gt: 0.22, t, dur: 0.25, a: 0.002, peak: 0.07, vib: 60, vibRate: 30 });
    tone(c, d, { f: 1600 * p, f2: 280 * p, gt: 0.22, t, dur: 0.25, a: 0.002, peak: 0.12 });
    return 0.3;
  },
  vacuum(c, d, t, p) {
    noise(c, d, { t, dur: 1.3, a: 0.15, hold: 0.7, peak: 0.22, type: 'bandpass', f: 300 * p, f2: 2600 * p, gt: 1.0, q: 6 });
    tone(c, d, { type: 'sawtooth', f: 110 * p, f2: 330 * p, gt: 1.0, t, dur: 1.3, a: 0.15, hold: 0.7, peak: 0.07, lp: [900, 900] });
    tone(c, d, { f: 2600 * p, f2: 3400 * p, t, dur: 1.2, a: 0.3, peak: 0.02 });
    return 1.4;
  },
  snore(c, d, t, p) {
    tone(c, d, { type: 'sawtooth', f: 75 * p, f2: 95 * p, lin: true, t, dur: 0.58, a: 0.22, peak: 0.16, lp: [300, 750] });
    noise(c, d, { t, dur: 0.58, a: 0.22, peak: 0.1, type: 'lowpass', f: 600 });
    tone(c, d, { f: 1100 * p, f2: 1500 * p, t: t + 0.66, gt: 0.4, dur: 0.5, a: 0.1, peak: 0.08 });
    return 1.25;
  },
  cannon(c, d, t, p) {
    tone(c, d, { f: 95 * p, f2: 38, gt: 0.3, t, dur: 0.55, a: 0.002, peak: 0.85 });
    noise(c, d, { t, dur: 0.45, a: 0.002, peak: 0.5, type: 'lowpass', f: 3500, f2: 300, gt: 0.3 });
    noise(c, d, { t, dur: 0.08, a: 0.001, peak: 0.28, type: 'bandpass', f: 1200, q: 1 });
    return 0.7;
  },
  magic(c, d, t, p) {
    const ns = [84, 86, 88, 91, 93, 96, 98, 100];
    for (let i = 0; i < 8; i++) tone(c, d, { f: mtof(ns[Math.floor(Math.random() * ns.length)]) * p, t: t + i * 0.06, dur: 0.3, a: 0.003, peak: 0.07 });
    noise(c, d, { t, dur: 0.6, a: 0.1, peak: 0.03, type: 'highpass', f: 8000 });
    return 0.85;
  },
  orbital(c, d, t, p) {
    tone(c, d, { type: 'sawtooth', f: 90 * p, f2: 1400 * p, gt: 1.4, t, dur: 1.5, a: 0.1, hold: 1.2, peak: 0.06, vib: 30, vibRate: 12, lp: [400, 4000] });
    tone(c, d, { f: 180 * p, f2: 2800 * p, gt: 1.4, t, dur: 1.5, a: 0.1, hold: 1.2, peak: 0.05 });
    SFX.explosion(c, d, t + 1.45, p);
    tone(c, d, { type: 'square', f: 2400 * p, f2: 200 * p, t: t + 1.45, dur: 0.4, a: 0.002, peak: 0.07 });
    return 2.5;
  },
  smoke(c, d, t, p) {
    noise(c, d, { t, dur: 0.4, a: 0.02, peak: 0.34, type: 'lowpass', f: 3500 * p, f2: 250, gt: 0.3, q: 0.8 });
    tone(c, d, { f: 220 * p, f2: 90, t, dur: 0.2, a: 0.003, peak: 0.14 });
    return 0.45;
  },
  coinflip(c, d, t, p) {
    [1, 1.12, 1.26].forEach((k, i) => {
      const tt = t + i * 0.11, f = 2400 * k * p;
      tone(c, d, { f, t: tt, dur: 0.25, a: 0.001, peak: 0.12 });
      tone(c, d, { f: f * 2.76, t: tt, dur: 0.12, a: 0.001, peak: 0.04 });
    });
    return 0.55;
  },
  ufo(c, d, t, p) {
    tone(c, d, { f: 650 * p, t, dur: 1.2, a: 0.1, hold: 0.8, peak: 0.14, vib: 220, vibRate: 7 });
    tone(c, d, { type: 'triangle', f: 980 * p, t, dur: 1.2, a: 0.1, hold: 0.8, peak: 0.06, vib: 300, vibRate: 5.3 });
    return 1.3;
  },
  curse(c, d, t, p) {
    [57, 60, 63, 66].forEach(m => tone(c, d, { type: 'sawtooth', f: mtof(m) * p, t, dur: 1.3, a: 0.4, hold: 0.4, peak: 0.045, detune: rand(-9, 9), lp: [300, 1200] }));
    tone(c, d, { f: 55 * p, t, dur: 1.3, a: 0.3, hold: 0.5, peak: 0.22 });
    return 1.4;
  },
  warp(c, d, t, p) {
    noise(c, d, { t, dur: 0.35, a: 0.03, peak: 0.16, type: 'bandpass', f: 3000 * p, f2: 300 * p, q: 3 });
    noise(c, d, { t: t + 0.3, dur: 0.4, a: 0.03, peak: 0.16, type: 'bandpass', f: 300 * p, f2: 3000 * p, q: 3 });
    tone(c, d, { f: 900 * p, f2: 200 * p, t, gt: 0.3, dur: 0.35, a: 0.01, peak: 0.1 });
    tone(c, d, { f: 200 * p, f2: 1400 * p, t: t + 0.3, gt: 0.35, dur: 0.4, a: 0.01, peak: 0.1 });
    return 0.8;
  },
  drain(c, d, t, p) {
    for (let i = 0; i < 9; i++) tone(c, d, { type: 'square', f: mtof(96 - i * 2.5 + rand(-0.5, 0.5)) * p, t: t + i * 0.055, dur: 0.05, a: 0.002, peak: 0.045 });
    tone(c, d, { f: 900 * p, f2: 200 * p, t, dur: 0.5, a: 0.02, peak: 0.06 });
    return 0.6;
  },
  shield(c, d, t, p) {
    const f = 520 * p;
    [[1, 0.25, 0.9], [2.76, 0.15, 0.6], [5.4, 0.08, 0.4], [8.93, 0.05, 0.25]].forEach(([k, a, dc]) =>
      tone(c, d, { f: f * k, t, dur: dc, a: 0.001, peak: a }));
    noise(c, d, { t, dur: 0.5, a: 0.05, peak: 0.05, type: 'highpass', f: 7000 });
    return 1.0;
  },

  // ---- stingers (also used by music('victory'/'defeat'))
  victory(c, d, t, p = 1) {
    const s = 0.1; // one 16th note at 150 bpm
    const tr = 12 * Math.log2(p);
    [[0, 72, 1], [1, 76, 1], [2, 79, 1], [3, 84, 3], [6, 83, 1], [7, 84, 1], [8, 86, 2], [10, 83, 1], [11, 79, 1], [12, 84, 10]]
      .forEach(([st, m, l]) => {
        pluck(c, d, t + st * s, m + tr, l * s, 1.2);
        tone(c, d, { type: 'triangle', f: mtof(m + tr), t: t + st * s, dur: l * s + 0.15, a: 0.004, peak: 0.1, vib: l > 4 ? 6 : 0, vibRate: 6, vibDelay: 0.2 });
      });
    [[0, [60, 64, 67], 4], [4, [60, 65, 69], 2], [6, [62, 67, 71], 2], [8, [62, 65, 71], 4], [12, [60, 64, 67, 72], 12]]
      .forEach(([st, ch, l]) => ch.forEach(m => ep(c, d, t + st * s, m + tr, l * s, 1.1)));
    [[0, 48, 4], [4, 41, 2], [6, 43, 2], [8, 43, 4], [12, 36, 12]].forEach(([st, m, l]) => bassSoft(c, d, t + st * s, m + tr, l * s, 1));
    [0, 4, 8, 12].forEach(st => kick(c, d, t + st * s, 0, 0, 0.8));
    [2, 6, 10, 11].forEach(st => snare(c, d, t + st * s, 0, 0, 0.6));
    crash(c, d, t + 12 * s, 0, 0, 1);
    [84, 88, 91, 96, 100].forEach((m, i) => tone(c, d, { f: mtof(m + tr), t: t + 12.5 * s + i * 0.07, dur: 0.5, a: 0.003, peak: 0.06 }));
    return 2.8;
  },
  defeat(c, d, t, p = 1) {
    const tr = 12 * Math.log2(p);
    [[62, 0, 0.42], [61, 0.45, 0.42], [60, 0.9, 0.42]].forEach(([m, o, l]) => {
      const os = brass(c, d, t + o, m + tr, l, 1.4, true);
      os.forEach(x => x.frequency.exponentialRampToValueAtTime(mtof(m + tr) * 0.97, t + o + l));
    });
    const last = brass(c, d, t + 1.35, 59 + tr, 1.1, 1.5, true);
    const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(5, t + 1.35);
    const lg = c.createGain(); lg.gain.setValueAtTime(0, t + 1.35); lg.gain.linearRampToValueAtTime(7, t + 1.7);
    lfo.connect(lg); last.forEach(x => lg.connect(x.frequency));
    lfo.start(t + 1.35); lfo.stop(t + 2.6); lfo.onended = () => disc(lfo, lg);
    last.forEach(x => x.frequency.exponentialRampToValueAtTime(mtof(59 + tr) * 0.93, t + 2.45));
    tom(c, d, t + 1.35, 38, 0, 0.5);
    return 2.7;
  },
};
const VARY = new Set(['meow', 'mew', 'hit', 'pop', 'shot', 'send', 'fight', 'coin', 'click', 'hover', 'emote', 'star',
  'hiss', 'purr', 'zap', 'smoke', 'error', 'back', 'lost', 'laser']);
// Loudness normalization (measured raw peaks -> UI ~0.25, frequent game sounds ~0.35, big moments ~0.7)
const LEVEL = {
  meow: 0.6, mew: 0.9, send: 2.5, coin: 2.2, coins: 2.6, drain: 2.6, buff: 2.3, magic: 2.3, vacuum: 2.6, warp: 2.3,
  freeze: 1.9, heal: 1.9, upgrade: 1.7, convert: 1.7, capture: 1.7, spell: 1.7, star: 1.7, laser: 1.7, zap: 1.4,
  ufo: 1.6, snore: 1.9, coinflip: 1.7, cannon: 0.6, victory: 0.55, orbital: 0.7, explosion: 0.75, unlock: 0.85,
};

// ---------------------------------------------------------------- composition helpers
const pcsOf = notes => [...new Set(notes.map(n => ((n % 12) + 12) % 12))];

// Motif-based melody: bars 1-2 of each 4-bar phrase are new, bar 3 echoes bar 1's
// rhythm and contour, bar 4 is a cadence landing on the chord root.
function genMelody({ seed, chords, scale, lo, hi, rhythms, cadences, start }) {
  const rnd = mulberry32(seed);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const pool = [];
  for (let m = lo; m <= hi; m++) if (scale.includes(m % 12)) pool.push(m);
  const clampIdx = i => (i < 0 ? -i : i >= pool.length ? 2 * (pool.length - 1) - i : i);
  let idx = 0, bd = 1e9;
  pool.forEach((m, i) => { const dd = Math.abs(m - (start ?? (lo + hi) / 2)); if (dd < bd) { bd = dd; idx = i; } });
  const nearestWithPc = (target, pcs) => {
    let best = null, bdd = 1e9;
    pool.forEach((m, i) => { if (pcs.includes(m % 12)) { const dd = Math.abs(i - target) + rnd() * 0.6; if (dd < bdd) { bdd = dd; best = i; } } });
    return best ?? clampIdx(target);
  };
  const bars = [];
  let motif = null;
  chords.forEach((ch, bar) => {
    const pos = bar % 4;
    let rhythm, contour = null;
    if (pos === 3) rhythm = pick(cadences);
    else if (pos === 2 && motif) { rhythm = motif.rhythm; contour = motif.contour; }
    else rhythm = pick(rhythms);
    const notes = [], my = [];
    let first = null;
    rhythm.forEach(([s, l], k) => {
      const lastOfCadence = pos === 3 && k === rhythm.length - 1;
      if (lastOfCadence) idx = nearestWithPc(idx, [ch.root]);
      else if (contour && k > 0 && contour[k] !== undefined) idx = Math.max(0, Math.min(pool.length - 1, first + contour[k]));
      else if (k === 0 || s % 4 === 0) idx = nearestWithPc(idx + Math.round((rnd() * 2 - 1) * 2), ch.pcs);
      else {
        let st = pick([-2, -1, -1, 1, 1, 2]);
        if (idx > pool.length * 0.75) st = -Math.abs(st);
        if (idx < pool.length * 0.25) st = Math.abs(st);
        idx = clampIdx(idx + st);
      }
      if (k === 0) first = idx;
      my.push(idx - first);
      notes.push({ s, l, m: pool[idx], v: s % 4 === 0 ? 0.9 : 0.7 });
    });
    if (pos === 0) motif = { rhythm, contour: my };
    bars.push(notes);
  });
  return bars;
}

function makeScore(bars, spb) {
  const score = Array.from({ length: bars * spb }, () => []);
  const add = (bar, step, i, m, d, v) => { const k = bar * spb + step; if (k >= 0 && k < score.length) score[k].push({ i, m, d, v }); };
  return { score, add };
}

// ---------------------------------------------------------------- tracks
function buildMenu() {
  const spb = 16, BARS = 32;
  const C = (ch, root, bass) => ({ ch, root, bass, pcs: pcsOf(ch) });
  const prog = [
    C([57, 60, 64, 67], 5, 41), C([55, 60, 64, 69], 9, 45), C([58, 62, 65, 69], 10, 46), C([58, 62, 64, 67], 0, 48),
    C([57, 60, 64, 67], 5, 41), C([53, 57, 60, 64], 2, 50), C([58, 62, 65, 69], 7, 43), C([58, 60, 64, 67], 0, 48),
    C([58, 62, 65, 69], 10, 46), C([55, 60, 64, 69], 9, 45), C([58, 62, 65, 67], 7, 43), C([57, 60, 64, 67], 5, 41),
    C([57, 60, 62, 65], 2, 50), C([58, 62, 65, 67], 7, 43), C([58, 62, 65, 67], 0, 48), C([58, 61, 64, 67], 0, 48),
  ];
  const { score, add } = makeScore(BARS, spb);
  const compA = [[0, 2, 0.75], [3, 2, 0.55], [6, 3, 0.6], [10, 2, 0.55], [13, 3, 0.5]];
  const compB = [[0, 3, 0.7], [4, 2, 0.5], [7, 3, 0.6], [10, 2, 0.5], [12, 2, 0.5], [14, 2, 0.45]];
  for (let bar = 0; bar < BARS; bar++) {
    const c = prog[bar % 16];
    for (const [s, l, v] of (bar % 2 ? compB : compA)) for (const m of c.ch) add(bar, s, ep, m, l, v);
    const r = c.bass, fifth = r + 7 > 52 ? r - 5 : r + 7;
    add(bar, 0, bassSoft, r, 5, 0.9); add(bar, 6, bassSoft, fifth, 2, 0.6);
    add(bar, 8, bassSoft, r, 5, 0.8); add(bar, 14, bassSoft, fifth, 2, 0.55);
    add(bar, 0, kick, 0, 1, 0.55); add(bar, bar % 2 ? 10 : 8, kick, 0, 1, 0.35);
    for (const s of [3, 6, 10, 12]) add(bar, s, rim, 0, 1, 0.22);
    for (let s = 0; s < 16; s++) add(bar, s, shaker, 0, 1, s % 4 === 2 ? 0.9 : 0.5);
  }
  const scale = [5, 7, 9, 0, 2];
  const rhythms = [[[0, 4], [6, 2], [8, 6]], [[2, 2], [4, 4], [10, 4]], [[0, 6], [8, 2], [10, 2], [12, 4]], [[0, 3], [3, 3], [6, 6]], [[4, 4], [8, 4], [12, 4]]];
  const cadences = [[[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 12]]];
  const mel1 = genMelody({ seed: 11, chords: prog.slice(4, 16), scale, lo: 65, hi: 84, rhythms, cadences, start: 72 });
  mel1.forEach((ns, i) => ns.forEach(n => add(4 + i, n.s, vibe, n.m, n.l, n.v)));
  const mel2 = genMelody({ seed: 23, chords: prog, scale, lo: 65, hi: 84, rhythms, cadences, start: 76 });
  mel2.forEach((ns, i) => { if (i >= 8 && i < 12) return; ns.forEach(n => add(16 + i, n.s, vibe, n.m, n.l, n.v * 0.95)); });
  return { bpm: 88, spb, len: BARS * spb, score, swing: 0.14, human: true, lp: 5200 };
}

function buildBattle() {
  const spb = 16;
  const C = (ch, root, bass) => ({ ch, root, bass, pcs: pcsOf(ch) });
  const G = C([55, 59, 62], 7, 43), D = C([54, 57, 62], 2, 38), Em = C([55, 59, 64], 4, 40), Cc = C([55, 60, 64], 0, 36);
  const Bm = C([54, 59, 62], 11, 35), Am = C([57, 60, 64], 9, 45), D7 = C([54, 57, 60, 62], 2, 38);
  const A = [G, D, Em, Cc, G, D, Cc, D];
  const B = [Cc, D, Bm, Em, Cc, D, Am, D7];
  const form = [['A', A, 1], ['A', A, 2], ['B', B, 1], ['B', B, 2]];
  const BARS = 32;
  const { score, add } = makeScore(BARS, spb);
  const scale = [7, 9, 11, 0, 2, 4, 6];
  const rhythms = [
    [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]],
    [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]],
    [[0, 2], [2, 1], [3, 1], [4, 4], [8, 2], [10, 2], [12, 2], [14, 2]],
    [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]],
    [[0, 1], [1, 1], [2, 2], [4, 2], [6, 2], [8, 2], [10, 6]],
  ];
  const cadences = [[[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 3], [3, 3], [6, 10]]];
  const melA = genMelody({ seed: 5, chords: A, scale, lo: 67, hi: 86, rhythms, cadences, start: 74 });
  const melB = genMelody({ seed: 41, chords: B, scale, lo: 67, hi: 88, rhythms, cadences, start: 79 });
  const patA = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 1];
  const patB = [0, 2, 1, 3, 0, 2, 1, 3, 1, 3, 2, 0, 1, 3, 2, 3];
  let bar = 0;
  for (const [sec, chords, pass] of form) {
    chords.forEach((c, i) => {
      const arp = [];
      for (let m = 67; m <= 86 && arp.length < 4; m++) if (c.pcs.includes(m % 12)) arp.push(m);
      // bass
      for (let s = 0; s < 16; s += 2) {
        const m = sec === 'A' ? (s % 4 === 0 ? c.bass : c.bass + 12) : [c.bass, c.bass, c.bass + 7, c.bass + 12][(s / 2) % 4];
        add(bar, s, bassChip, m, 1.6, s % 4 === 0 ? 0.95 : 0.75);
      }
      // arps
      const pat = sec === 'A' ? patA : patB;
      for (let s = 0; s < 16; s++) {
        if (sec === 'A' && pass === 1 && s % 2) continue;
        add(bar, s, marimba, arp[pat[s] % arp.length], 1, s % 4 === 0 ? 0.32 : 0.2);
      }
      // drums
      if (i === 0) add(bar, 0, crash, 0, 1, sec === 'B' ? 0.9 : 0.6);
      if (sec === 'A') { add(bar, 0, kick, 0, 1, 1); add(bar, 8, kick, 0, 1, 0.9); if (i % 2) add(bar, 10, kick, 0, 1, 0.6); }
      else for (const s of [0, 4, 8, 12]) add(bar, s, kick, 0, 1, s ? 0.85 : 1);
      add(bar, 4, snare, 0, 1, 0.8);
      if (i % 4 === 3) { [12, 13, 14, 15].forEach((s, k) => add(bar, s, snare, 0, 1, 0.35 + k * 0.15)); }
      else add(bar, 12, snare, 0, 1, 0.8);
      for (let s = 0; s < 16; s += (sec === 'A' ? 2 : 1)) add(bar, s, hat, 0, 1, s % 4 === 2 ? 0.8 : 0.45);
      if (sec === 'B') add(bar, 14, ohat, 0, 1, 0.5);
      // pads under B
      if (sec === 'B') for (const m of c.ch) add(bar, 0, pad, m, 16, 0.9);
      // melody
      const mel = (sec === 'A' ? melA : melB)[i];
      for (const n of mel) {
        if (sec === 'A' && pass === 1) add(bar, n.s, marimba, n.m, n.l, n.v * 1.6);
        else {
          add(bar, n.s, pluck, n.m, n.l, n.v);
          if (sec === 'A' && pass === 2) add(bar, n.s, marimba, n.m - 12, n.l, n.v * 0.9);
          if (sec === 'B' && pass === 2) add(bar, n.s, pluck, n.m + 12, n.l, n.v * 0.35);
        }
      }
      bar++;
    });
  }
  return { bpm: 128, spb, len: BARS * spb, score, swing: 0, human: false };
}

function buildTense() {
  const spb = 16;
  const C = (ch, root, bass) => ({ ch, root, bass, pcs: pcsOf(ch) });
  const Am = C([57, 60, 64], 9, 45), F = C([57, 60, 65], 5, 41), G = C([59, 62, 67], 7, 43), E = C([56, 59, 64], 4, 40);
  const Dm = C([57, 62, 65], 2, 38), Em = C([55, 59, 64], 4, 40), E7 = C([56, 59, 62, 64], 4, 40);
  const P1 = [Am, F, G, E, Am, F, Dm, E];
  const P2 = [F, G, Em, Am, Dm, E, Am, E7];
  const scale = [9, 11, 0, 2, 4, 5, 8];
  const rhythms = [[[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 6], [6, 2], [8, 6], [14, 2]], [[0, 3], [3, 3], [6, 3], [9, 3], [12, 4]]];
  const cadences = [[[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 12]]];
  const m1 = genMelody({ seed: 77, chords: P2, scale, lo: 64, hi: 83, rhythms, cadences, start: 72 });
  const m2 = genMelody({ seed: 91, chords: P1, scale, lo: 64, hi: 83, rhythms, cadences, start: 76 });
  const form = [[P1, null], [P2, m1], [P1, m2], [P2, m1]];
  const BARS = 32;
  const { score, add } = makeScore(BARS, spb);
  let bar = 0;
  form.forEach(([chords, mel], fi) => {
    chords.forEach((c, i) => {
      for (let s = 0; s < 16; s += 2) add(bar, s, bassChip, s === 6 || s === 14 ? c.bass + 12 : c.bass, 1.5, s % 4 === 0 ? 0.95 : 0.7);
      for (const s of [0, 3, 6, 8, 11, 14]) for (const m of c.ch) add(bar, s, stab, m, 1.5, s % 8 === 0 ? 1 : 0.7);
      if (fi >= 2) for (const m of c.ch) add(bar, 0, pad, m + 12, 16, 0.6);
      for (const s of [0, 6, 8]) add(bar, s, kick, 0, 1, s === 0 ? 1 : 0.75);
      add(bar, 4, snare, 0, 1, 0.75); add(bar, 12, snare, 0, 1, 0.8);
      for (let s = 0; s < 16; s++) add(bar, s, hat, 0, 1, s % 2 ? 0.35 : 0.6);
      if (i % 4 === 3) [[12, 57], [13, 52], [14, 47], [15, 43]].forEach(([s, m]) => add(bar, s, tom, m, 1, 0.7));
      if (i === 0) add(bar, 0, crash, 0, 1, 0.6);
      if (mel) for (const n of mel[i]) add(bar, n.s, pluck, fi === 3 ? n.m + 12 : n.m, n.l, n.v * (fi === 3 ? 0.8 : 1));
      bar++;
    });
  });
  return { bpm: 132, spb, len: BARS * spb, score, swing: 0, human: false };
}

const TRACKS = { menu: buildMenu, battle: buildBattle, tense: buildTense };
const trackCache = {};
function getTrack(name) { if (!trackCache[name]) trackCache[name] = TRACKS[name](); return trackCache[name]; }

// ---------------------------------------------------------------- audio graph + scheduler
function buildGraph() {
  master = ac.createGain(); master.gain.value = isMuted ? 0 : 1;
  comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
  limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  sfxBus = ac.createGain(); sfxBus.gain.value = sfxVol;
  musicBus = ac.createGain(); musicBus.gain.value = musicVol;
  reverb = ac.createConvolver(); reverb.buffer = impulse(ac, 1.8);
  const revTone = ac.createBiquadFilter(); revTone.type = 'lowpass'; revTone.frequency.value = 5000;
  const revOut = ac.createGain(); revOut.gain.value = 0.55;
  const sendS = ac.createGain(); sendS.gain.value = 0.12;
  const sendM = ac.createGain(); sendM.gain.value = 0.22;
  sfxBus.connect(comp); musicBus.connect(comp);
  sfxBus.connect(sendS); sendS.connect(reverb);
  musicBus.connect(sendM); sendM.connect(reverb);
  reverb.connect(revTone); revTone.connect(revOut); revOut.connect(comp);
  comp.connect(master); master.connect(limiter); limiter.connect(ac.destination);
}

function isReady() { return !!ac && ac.state === 'running'; }

function startTrack(name) {
  const track = getTrack(name);
  const now = ac.currentTime;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(1, now + 1.0);
  let tail = null;
  if (track.lp) { tail = ac.createBiquadFilter(); tail.type = 'lowpass'; tail.frequency.value = track.lp; g.connect(tail); tail.connect(musicBus); }
  else g.connect(musicBus);
  players.push({ name, track, g, tail, step: 0, next: now + 0.1, stopAt: Infinity });
  if (!schedTimer) schedTimer = setInterval(tick, 25);
}

function fadeOutPlayers(time) {
  const now = ac.currentTime;
  for (const p of players) {
    if (p.stopAt !== Infinity) continue;
    const gp = p.g.gain;
    const cur = Math.max(gp.value, 0.0002);
    gp.cancelScheduledValues(now); gp.setValueAtTime(cur, now); gp.exponentialRampToValueAtTime(0.0001, now + time);
    p.stopAt = now + time;
  }
}

function tick() {
  if (!ac) return;
  const now = ac.currentTime;
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    if (now > p.stopAt + 0.1) {
      players.splice(i, 1);
      const g = p.g, tl = p.tail;
      setTimeout(() => disc(g, tl), 2500);
      continue;
    }
    const tr = p.track, sd = 60 / tr.bpm / 4;
    if (p.next < now - 0.1) { const skip = Math.ceil((now - p.next) / sd); p.next += skip * sd; p.step += skip; }
    while (p.next < now + 0.12 && p.next < p.stopAt) {
      let t = p.next;
      if (tr.swing && p.step % 2 === 1) t += tr.swing * sd;
      const evs = tr.score[p.step % tr.len];
      for (const e of evs) {
        const tt = tr.human ? t + (Math.random() - 0.5) * 0.008 : t;
        const vv = tr.human ? e.v * (0.93 + Math.random() * 0.12) : e.v;
        try { e.i(ac, p.g, Math.max(tt, now), e.m, e.d * sd, vv); } catch (err) { /* keep the music going */ }
      }
      p.next += sd; p.step++;
    }
  }
  if (!players.length && schedTimer) { clearInterval(schedTimer); schedTimer = null; }
}

function applyMusic() {
  if (!isReady()) return;
  const name = wantTrack;
  if (name === curTrack) return;
  curTrack = name;
  const sting = name === 'victory' || name === 'defeat';
  fadeOutPlayers(sting ? 0.5 : name ? 1.0 : 1.2);
  if (!name) return;
  if (sting) {
    const g = ac.createGain(); g.gain.value = name === 'victory' ? 0.75 : 1.4; g.connect(musicBus);
    const len = SFX[name](ac, g, ac.currentTime + 0.12, 1);
    setTimeout(() => disc(g), (len + 2) * 1000);
    return;
  }
  if (TRACKS[name]) startTrack(name);
}

// ---------------------------------------------------------------- public API
export const audio = {
  init() {
    if (!AC) return;
    try {
      if (!ac) {
        try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { ac = new AC(); }
        buildGraph();
        ac.onstatechange = () => { if (isReady()) applyMusic(); };
      }
      if (ac.state === 'suspended' || ac.state === 'interrupted') {
        const pr = ac.resume();
        if (pr && pr.then) pr.then(applyMusic).catch(() => { });
      } else applyMusic();
    } catch (e) { /* audio is optional */ }
  },

  play(name, { vol = 1, pitch = 1, pan = 0 } = {}) {
    try {
      if (!isReady() || isMuted) return;
      const fn = SFX[name];
      if (!fn) return;
      const ms = nowMs();
      let arr = recent.get(name);
      if (!arr) recent.set(name, (arr = []));
      while (arr.length && ms - arr[0] > 80) arr.shift();
      if (arr.length >= 4) return;
      arr.push(ms);
      const g = ac.createGain(); g.gain.value = clamp(+vol || 0, 0, 2) * (LEVEL[name] ?? 1);
      let pn = null;
      if (pan && ac.createStereoPanner) { pn = ac.createStereoPanner(); pn.pan.value = clamp(+pan || 0, -1, 1); g.connect(pn); pn.connect(sfxBus); }
      else g.connect(sfxBus);
      let p = pitch > 0 ? +pitch : 1;
      if (VARY.has(name)) p *= 0.96 + Math.random() * 0.08;
      const dur = fn(ac, g, ac.currentTime + 0.005, p) || 1;
      setTimeout(() => disc(g, pn), (dur + 0.6) * 1000);
    } catch (e) { /* never throw from a sound */ }
  },

  music(track) {
    wantTrack = track === 'victory' || track === 'defeat' || TRACKS[track] ? track : null;
    try { applyMusic(); } catch (e) { /* ignore */ }
  },

  setVolumes({ sfx, music } = {}) {
    if (typeof sfx === 'number') sfxVol = clamp(sfx, 0, 1);
    if (typeof music === 'number') musicVol = clamp(music, 0, 1);
    if (!ac) return;
    try {
      sfxBus.gain.setTargetAtTime(sfxVol, ac.currentTime, 0.03);
      musicBus.gain.setTargetAtTime(musicVol, ac.currentTime, 0.03);
    } catch (e) { /* ignore */ }
  },

  setMuted(b) {
    isMuted = !!b;
    if (!ac) return;
    try { master.gain.setTargetAtTime(isMuted ? 0 : 1, ac.currentTime, 0.03); } catch (e) { /* ignore */ }
  },
  get muted() { return isMuted; },
  get ready() { return isReady(); },

  // ---- dev helpers (used by public/dev/audio-test.html)
  get _sfxNames() { return Object.keys(SFX); },
  get _tracks() { return Object.keys(TRACKS); },
  async _renderOffline(name, seconds = 2) {
    const OAC = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;
    if (!OAC) return null;
    const sr = 44100, oc = new OAC(2, Math.ceil(sr * seconds), sr);
    const g = oc.createGain(); g.connect(oc.destination);
    if (name.startsWith('music:')) {
      const tr = getTrack(name.slice(6)), sd = 60 / tr.bpm / 4;
      for (let s = 0, t = 0.01; t < seconds; s++, t += sd) for (const e of tr.score[s % tr.len]) e.i(oc, g, t, e.m, e.d * sd, e.v);
    } else {
      const fn = SFX[name];
      if (!fn) return null;
      fn(oc, g, 0.01, 1);
    }
    const buf = await oc.startRendering();
    const dd = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < dd.length; i++) { const a = Math.abs(dd[i]); if (a > peak) peak = a; sum += dd[i] * dd[i]; }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / dd.length).toFixed(4) };
  },
};

export default audio;
