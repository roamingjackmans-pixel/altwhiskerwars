// Whisker Wars entry point
import { initUI, go, handleDeepLink, isBusy, currentScreen, offerUpdate } from './ui.js';
import { audio } from './audio.js';
import { fetchLatest, isNewer, alreadyTried, reloadTo, stripVersionParam, sinceLastCheck } from './update.js';

const startSearch = location.search;   // kept so an update reload can keep a ?room= invite
stripVersionParam();

function boot(latest) {
  // an old copy of the game (cached by the browser): hop onto the newest build before anything starts
  if (isNewer(latest) && !alreadyTried(latest)) { reloadTo(latest, startSearch); return; }
  initUI();
  if (!handleDeepLink()) go('home');
  audio.music('menu');
  const loader = document.getElementById('loader');
  if (loader) { loader.classList.add('done'); setTimeout(() => loader.remove(), 600); }
  if (isNewer(latest)) offerUpdate(latest);
}

// make sure the cute font is ready before canvas text is drawn (and ask which build is newest meanwhile)
const wait = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
const fontReady = document.fonts && document.fonts.load ? wait(document.fonts.load('700 20px Fredoka'), 1500) : Promise.resolve();
const latestP = wait(fetchLatest(), 1500);
Promise.all([fontReady.catch(() => {}), latestP]).then(([, latest]) => {
  try { boot(latest || null); }
  catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#2b1d3a;color:#fff;font:18px sans-serif;padding:20px;text-align:center">😿 Something went wrong loading Whisker Wars.<br><small>${String(e && e.message || e)}</small></div>`);
  }
});

// coming back to the game later (phones keep tabs open for days): look for a newer build
async function recheck() {
  if (sinceLastCheck() < 60000) return;
  const l = await fetchLatest();
  if (!isNewer(l)) return;
  if (!isBusy() && currentScreen() === 'home' && !alreadyTried(l)) reloadTo(l);
  else offerUpdate(l);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
setInterval(() => { if (document.visibilityState === 'visible') recheck(); }, 5 * 60 * 1000);

window.addEventListener('error', e => console.error('Uncaught', e.error || e.message));
