// "Download app": put Whisker Wars on the home screen or desktop as its own app.
// Chrome, Edge and Android browsers offer a real install prompt (caught here as soon as the page loads, because the
// browser only offers it once). Safari on iPhone/iPad and a few others have no prompt, so we show the steps instead.

let offer = null;            // the browser's install prompt, saved for when the player taps the button
let justInstalled = false;
const listeners = new Set();
const changed = () => { for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } };

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer = e; changed(); });
window.addEventListener('appinstalled', () => { offer = null; justInstalled = true; changed(); });

/** Run fn whenever the install state changes. Returns a function that stops listening. */
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Are we already running as the installed app (or was it just installed)? */
export function isInstalled() {
  if (justInstalled || navigator.standalone) return true;
  const mm = q => window.matchMedia && matchMedia(q).matches;
  // (a full-screen battle in the browser also counts as "fullscreen", so only trust it outside one)
  return mm('(display-mode: standalone)') || mm('(display-mode: minimal-ui)') || (mm('(display-mode: fullscreen)') && !document.fullscreenElement);
}

/** True when tapping the button opens the browser's own install prompt. */
export const canPrompt = () => !!offer;

/** Open the browser's install prompt. Resolves 'accepted', 'dismissed', or 'manual' (no prompt: show the steps). */
export async function promptInstall() {
  if (!offer) return 'manual';
  const p = offer;
  offer = null;
  try {
    await p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome === 'accepted') justInstalled = true;
    changed();
    return outcome;
  } catch (e) { console.warn(e); changed(); return 'manual'; }
}

/** What to tell the player when the browser has no install prompt: a title and a few steps. */
export function installSteps() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|Twitter|; wv\)/i.test(ua);
  const firefox = /Firefox|FxiOS/i.test(ua);
  const macSafari = !ios && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  if (inApp) return {
    title: 'Open Whisker Wars in your browser first',
    steps: [`Tap the <b>⋯</b> or share menu and choose <b>Open in ${ios ? 'Safari' : 'Chrome'}</b> (or "Open in browser").`, 'Then tap <b>📲 Download app</b> again in Settings.'],
  };
  if (ios) return {
    title: 'Add Whisker Wars to your Home Screen',
    steps: [
      `Tap the <b>Share</b> button <span class="ia-ico">⬆️</span> ${/CriOS|EdgiOS|FxiOS/.test(ua) ? 'in the address bar' : 'at the bottom of Safari (top right on iPad)'}.`,
      'Scroll down and tap <b>Add to Home Screen</b> <span class="ia-ico">➕</span>.',
      'Tap <b>Add</b>. Whisker Wars appears on your Home Screen and opens full screen, like an app.',
    ],
  };
  if (android) return {
    title: 'Install Whisker Wars on your phone',
    steps: [
      'Open your browser menu <span class="ia-ico">⋮</span> (top right).',
      `Tap <b>Install app</b> or <b>Add to Home screen</b>${firefox ? ' (in Firefox: <b>Install</b>)' : ''}.`,
      'Confirm, and Whisker Wars appears on your home screen and app drawer.',
    ],
  };
  if (macSafari) return {
    title: 'Add Whisker Wars to your Dock',
    steps: ['In the menu bar, choose <b>File → Add to Dock</b>.', 'Click <b>Add</b>. Whisker Wars opens in its own window from the Dock.'],
  };
  if (firefox) return {
    title: 'Install Whisker Wars',
    steps: ['Firefox on computers can\'t install web apps yet.', 'Open this page in <b>Chrome</b> or <b>Edge</b> and tap <b>📲 Download app</b> there, or just bookmark it.'],
  };
  return {
    title: 'Install Whisker Wars',
    steps: [
      'Click the install icon <span class="ia-ico">⊕</span> at the right end of the address bar. (Or open the browser menu <span class="ia-ico">⋮</span> and choose <b>Install Whisker Wars</b>; in Edge: <b>Apps → Install this site as an app</b>.)',
      'Click <b>Install</b>. Whisker Wars opens in its own window and gets a desktop / Start menu shortcut.',
    ],
  };
}
