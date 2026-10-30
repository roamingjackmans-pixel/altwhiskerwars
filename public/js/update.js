// Version tracking and self-update.
// Phones keep old game files for a while (and an open tab keeps running old code), so the game asks the
// server which build is newest and reloads onto it when it's safe (never mid-battle).

export const BUILD = window.WW_VERSION || { version: '?', commit: 'dev', built: '' };
export const isDev = () => !BUILD.commit || BUILD.commit === 'dev';
export const versionLabel = () => `v${BUILD.version} · ${isDev() ? 'dev' : BUILD.commit}`;

let lastCheck = 0;
/** newest build info from the server, or null when offline / running locally without one */
export async function fetchLatest() {
  lastCheck = Date.now();
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.commit ? j : null;
  } catch { return null; }
}
export const sinceLastCheck = () => Date.now() - lastCheck;

/** true when the server has a different (newer) build than the one running */
export const isNewer = l => !!(l && l.commit && l.commit !== 'dev' && !isDev() && l.commit !== BUILD.commit);

/** only auto-reload once per build per tab, so a slow cache can never cause a reload loop */
export function alreadyTried(l) { try { return sessionStorage.getItem('ww-update-to') === l.commit; } catch { return true; } }

/** Reload onto the new build. The ?v= makes the browser fetch a fresh page instead of its cached copy. */
export function reloadTo(l, search = location.search) {
  const q = new URLSearchParams(search);
  q.set('v', l.commit);
  try { sessionStorage.setItem('ww-update-to', l.commit); } catch { /* private mode */ }
  location.replace(location.pathname + '?' + q.toString());
}

/** tidy the address bar after an update reload */
export function stripVersionParam() {
  const q = new URLSearchParams(location.search);
  if (!q.has('v')) return;
  q.delete('v');
  const s = q.toString();
  history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
}
