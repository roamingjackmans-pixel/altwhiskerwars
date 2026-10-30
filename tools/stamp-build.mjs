// Stamps a deploy with its version and makes every file URL unique to that build.
//   node tools/stamp-build.mjs <public dir> <commit>
// Run by the GitHub Pages workflow on a throwaway copy of public/ (never commit the result).
// Why: hosts like GitHub Pages let browsers reuse files for ~10 minutes, and a phone can end up mixing
// old and new code. With ?v=<commit> on every script, stylesheet and import, a new build is all-new URLs.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const [dir = 'public', commitArg = 'dev'] = process.argv.slice(2);
const commit = String(commitArg).slice(0, 7);
const root = path.resolve(dir);
const pkg = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'));
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
// The version number goes up with every deploy: major.minor from package.json, then the number of commits
// (or WW_BUILD / the GitHub run number when there's no history), e.g. v1.3.57.
const build = (() => {
  if (/^\d+$/.test(process.env.WW_BUILD || '')) return process.env.WW_BUILD;
  try { const n = execSync('git rev-list --count HEAD', { cwd: path.join(root, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (/^\d+$/.test(n) && n !== '1') return n; } catch { /* not a git checkout */ }
  return /^\d+$/.test(process.env.GITHUB_RUN_NUMBER || '') ? process.env.GITHUB_RUN_NUMBER : null;
})();
const [maj = '1', min = '0', patch = '0'] = String(pkg.version).split('.');
const info = { version: `${maj}.${min}.${build ?? patch}`, commit, built };

fs.writeFileSync(path.join(root, 'version.js'),
  `// Build stamp (written at deploy time).\nwindow.WW_VERSION = ${JSON.stringify(info)};\n`);
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(info) + '\n');

// index.html: local scripts and stylesheets
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
let n = 0;
html = html.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")((?!https?:|data:|\/\/)[^"?#]+\.(?:js|css))(")/g,
  (m, a, url, b) => { n++; return `${a}${url}?v=${commit}${b}`; });
fs.writeFileSync(indexPath, html);

// ES module imports: from './x.js', import('./x.js'), import './x.js'
let m = 0;
for (const sub of ['js', 'shared']) {
  const d = path.join(root, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(d, f);
    const src = fs.readFileSync(p, 'utf8');
    const out = src.replace(/((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g,
      (all, a, url, b) => { m++; return `${a}${url}?v=${commit}${b}`; });
    if (out !== src) fs.writeFileSync(p, out);
  }
}
console.log(`stamped v${info.version} (${commit}) · ${n} page assets · ${m} imports`);
