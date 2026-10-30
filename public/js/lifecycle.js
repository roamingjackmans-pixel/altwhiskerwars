// Knows when this page has "stepped away": something covered the app (a notification pop-up, the edge panel, a
// pop-up window, another app) and the browser hid, paused or froze the page. Online play uses it to tell the other
// players this phone is away for a moment, which is different from a lost connection.
//
// Phones don't always say so: some freeze the page without any event, so a jump in the clock counts too.

const subs = { away: new Set(), back: new Set() };
let away = false, since = 0, last = Date.now();

function set(v, why) {
  if (v === away) return;
  away = v;
  const gap = v ? 0 : Date.now() - since;
  if (v) since = Date.now();
  for (const f of subs[v ? 'away' : 'back']) { try { f(v ? why : gap, why); } catch (e) { console.error(e); } }
}

// (only in a browser: the headless test tools load the online code too)
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => set(document.visibilityState === 'hidden', 'hidden'));
  window.addEventListener('pagehide', () => set(true, 'pagehide'));
  window.addEventListener('pageshow', () => { if (document.visibilityState !== 'hidden') set(false, 'pageshow'); });
  document.addEventListener('freeze', () => set(true, 'freeze'));
  document.addEventListener('resume', () => { if (document.visibilityState !== 'hidden') set(false, 'resume'); });
  // frozen without a word: the 1-second tick suddenly comes back several seconds late
  setInterval(() => {
    const now = Date.now();
    if (!away && now - last > 4000) {
      since = last;
      away = true;
      set(false, 'gap');
    }
    last = now;
  }, 1000);
}

/** fn(why) when the page steps away */
export const onAway = fn => { subs.away.add(fn); return () => subs.away.delete(fn); };
/** fn(msAway) when it comes back */
export const onBack = fn => { subs.back.add(fn); return () => subs.back.delete(fn); };
export const isAway = () => away;
