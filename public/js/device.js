// Phone detection and phone-only niceties (vibration, full screen, keeping the screen awake).
import { profile } from './profile.js';

const setting = (k, d) => { const s = profile().settings || {}; return s[k] ?? d; };

/** True when the phone layout should be used: the user's choice, otherwise automatic detection. */
export function isPhone() {
  const pref = setting('layout', 'auto');
  if (pref === 'phone') return true;
  if (pref === 'desktop') return false;
  return detectPhone();
}

/**
 * Phone = a phone browser, or a touch screen whose physical short side is phone-sized.
 * screen.* (not the window) is used so a phone in "Desktop site" mode, which fakes a ~980px wide window, still counts.
 */
export function detectPhone() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|Windows Phone|IEMobile|Opera Mini/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  const touch = (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const short = Math.min(screen.width || 9999, screen.height || 9999);
  return !!touch && short < 600;
}

/** A phone browser showing the "Desktop site" version (tiny text, faked wide window). */
export function desktopSiteMode() {
  const short = Math.min(screen.width || 9999, screen.height || 9999);
  return detectPhone() && short < 600 && Math.min(window.innerWidth, window.innerHeight) > short * 1.4;
}

/** what the version panel shows about this device */
export function deviceSummary() {
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return {
    layout: isPhone() ? 'phone' : 'desktop',
    forced: setting('layout', 'auto') !== 'auto',
    screen: `${screen.width}×${screen.height}`,
    window: `${window.innerWidth}×${window.innerHeight}`,
    touch,
    desktopSite: desktopSiteMode(),
  };
}

/** Portrait screens show the battlefield standing up so it can use the whole height. */
export const isPortrait = () => window.innerHeight > window.innerWidth * 1.05;

/** Tags <html> so the menus can adapt too. */
export function applyDeviceClass() {
  const el = document.documentElement;
  el.classList.toggle('phone', isPhone());
  el.classList.toggle('portrait', isPortrait());
}

export function vibrate(pattern) {
  try {
    if (!navigator.vibrate || !setting('vibrate', true) || !isPhone()) return;
    // browsers refuse (and complain) until the player has touched the page
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch { /* not supported */ }
}

// iPhones ignore user-scalable=no; stop pinch-zoom from grabbing the battlefield
document.addEventListener('gesturestart', e => e.preventDefault());

/**
 * Android browsers hide their address bar in full screen. iPhones ignore this (Add to Home Screen does it there).
 * Only for battles: full screen also hides the phone's own Home / Back buttons, and on phones that use the three
 * buttons (not gestures) a swipe only shows them for a moment. So battles leave full screen when they end, and
 * the battle menu has an "Exit full screen" button.
 */
export function enterFullscreen() {
  try {
    if (!isPhone() || !setting('fullscreen', true)) return;
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch { /* not allowed */ }
}
/** Back to the normal screen, with the phone's Home / Back buttons. */
export function exitFullscreen() {
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch { /* not allowed */ }
}
export const inFullscreen = () => !!document.fullscreenElement;

let lock = null;
/** Stops the screen dimming mid-battle. */
export async function keepAwake(on) {
  try {
    if (on) {
      if (lock || !navigator.wakeLock) return;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (lock) { const l = lock; lock = null; await l.release(); }
  } catch { lock = null; }
}
// the browser drops the lock when the tab is hidden; take it back when we return mid-match
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && keepAwake.wanted) keepAwake(true); });
keepAwake.wanted = false;
