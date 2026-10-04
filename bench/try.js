// Feel the difference: NEO before and after this branch, side by side, each
// on a throwaway library with the same 100k-word manuscript open, and a panel
// in the corner timing every keystroke.
//
//   npm run try                      both windows, on this machine as it is
//   npm run try -- --base <ref>      compare against another commit (default: main)
//
// "Before" is this checkout with app.js taken from the base commit; every
// other file is the same. The writer's own library is never opened.

'use strict';

const { app, BrowserWindow, screen } = require('electron');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const ROLE = opt('role', '');
const BASE = opt('base', 'main');
const SELFTEST = args.includes('--selftest');

/* ---------- no role: start one window of each ---------- */

if (!ROLE) {
  const pass = args.filter((a, i) => !['--role'].includes(a) && args[i - 1] !== '--role');
  let left = 2;
  for (const role of ['before', 'after']) {
    const child = spawn(process.execPath, [__filename, '--role', role, ...pass], { stdio: 'inherit' });
    child.on('exit', () => { if (--left === 0) app.exit(0); });
  }
  app.on('window-all-closed', () => {}); // this process has no window of its own
  return;
}

/* ---------- one window: before or after ---------- */

// Chromium writes to its profile until the process is gone, so a run can't
// remove its own folder; it removes those of earlier runs that have ended.
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-try-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-try-${process.pid}-`));

// Before: a folder of links to this checkout, but app.js as the base had it.
// The window loads index.html from that folder, so its <script src="app.js">
// is the old one; main.js, preload.js and the rest are the same files.
let ROOT = REPO;
let label = 'AFTER · this branch';
if (ROLE === 'before') {
  const base = execFileSync('git', ['merge-base', 'HEAD', BASE], { cwd: REPO }).toString().trim();
  ROOT = path.join(tmp, 'neo');
  fs.mkdirSync(ROOT);
  for (const name of fs.readdirSync(REPO)) {
    if (name === 'app.js' || name === '.git') continue;
    fs.symlinkSync(path.join(REPO, name), path.join(ROOT, name));
  }
  fs.writeFileSync(path.join(ROOT, 'app.js'), execFileSync('git', ['show', `${base}:app.js`], { cwd: REPO }));
  label = `BEFORE · ${BASE} (${base.slice(0, 7)})`;
}

app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Test Writer', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));

const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, o) { return loadFile.call(this, path.resolve(ROOT, file), o); };
require(path.join(REPO, 'main.js'));

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

// The same manuscript in both windows: sentences drawn from a seeded list,
// paragraphs of 40 to 70 words, so it reads less like one line repeated.
const SEED_TEXT = `(() => {
  const W = ('the rain had come back to the harbor by evening and nobody on the quay said a word about it '
    + 'she counted the boats twice before she trusted the number then walked the long way round to the light '
    + 'every winter the road north closed for a week and every winter someone tried it anyway '
    + 'her brother kept the letters in a tin under the stairs and never opened the last one').split(' ');
  let s = 11;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  const para = () => {
    const n = 40 + rnd(31);
    const out = [];
    for (let i = 0; i < n; i++) out.push(W[rnd(W.length)]);
    out[0] = out[0][0].toUpperCase() + out[0].slice(1);
    return out.join(' ') + '.';
  };
  return (count) => Array.from({ length: count }, () => ({ text: para() }));
})()`;

// The panel: NEO's own work per keystroke (first input listener to last),
// and key to screen (keydown to the frame after it). Outside #chapters, so
// it never reaches a chapter's HTML.
const HUD = (label) => `(() => {
  const hud = document.createElement('div');
  hud.id = 'neo-try-hud';
  hud.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;pointer-events:none;'
    + 'font:12px/1.45 ui-monospace,Menlo,monospace;color:#f3f3f3;background:rgba(20,20,20,.88);'
    + 'border:1px solid ${label.startsWith('BEFORE') ? '#d9822b' : '#3fb950'};border-radius:8px;padding:10px 12px;min-width:250px;white-space:pre';
  document.body.appendChild(hud);
  const code = typeof paragraphWords === 'function' ? 'paragraph counts: on' : 'paragraph counts: absent';
  const work = [];
  const screenMs = [];
  let lafs = 0;
  let t0 = 0;
  let k0 = 0;
  const fmt = (v) => v == null ? '–' : v.toFixed(1) + ' ms';
  const stat = (a) => {
    if (!a.length) return [null, null, null];
    const s = [...a].sort((x, y) => x - y);
    return [a[a.length - 1], s[s.length >> 1], s[s.length - 1]];
  };
  const draw = () => {
    const [wl, wm, wx] = stat(work);
    const [sl, sm, sx] = stat(screenMs);
    hud.textContent = ${JSON.stringify(label)} + '\\n'
      + code + '\\n\\n'
      + "NEO's work per keystroke\\n"
      + '  last ' + fmt(wl) + '   median ' + fmt(wm) + '   worst ' + fmt(wx) + '\\n'
      + 'key to screen\\n'
      + '  last ' + fmt(sl) + '   median ' + fmt(sm) + '   worst ' + fmt(sx) + '\\n'
      + 'frames over 50 ms: ' + lafs + '\\n'
      + '(last ' + work.length + ' keys · ⌥⌘R resets)';
  };
  const keep = (a, v) => { a.push(v); if (a.length > 60) a.shift(); };
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.metaKey && e.code === 'KeyR') { work.length = 0; screenMs.length = 0; lafs = 0; draw(); e.preventDefault(); return; }
    k0 = performance.now();
  }, true);
  window.addEventListener('input', () => { t0 = performance.now(); }, true);
  document.addEventListener('input', () => {
    keep(work, performance.now() - t0);
    const k = k0;
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { keep(screenMs, performance.now() - k); draw(); };
      ch.port2.postMessage(0);
    });
  });
  try {
    new PerformanceObserver((l) => { lafs += l.getEntries().length; draw(); }).observe({ type: 'long-animation-frame' });
  } catch { /* older Chromium */ }
  draw();
  window.__tryHud = { work, screenMs, code, get lafs() { return lafs; } };
})()`;

async function main() {
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
  await tick(500);

  // side by side: before on the left, after on the right
  const area = screen.getPrimaryDisplay().workArea;
  const w = Math.floor(area.width / 2);
  win.setBounds({ x: area.x + (ROLE === 'before' ? 0 : w), y: area.y, width: w, height: area.height });
  win.setTitle(label);
  win.on('page-title-updated', (e) => e.preventDefault());

  await js(`(async () => {
    document.getElementById('firstrun').hidden = true;
    const paras = ${SEED_TEXT};
    await addImportedBooks([{ name: 'Short Story (about 4,000 words)', chapters: [{ title: 'One', paras: paras(73) }] }], library.shelves[0]);
    await addImportedBooks([{ name: 'Long Manuscript (100,000 words, one chapter)', chapters: [{ title: 'One', paras: paras(1820) }] }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    await openBook(ids[ids.length - 1]);
  })()`);
  await tick(800);
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const p = body.children[body.children.length >> 1];
    p.scrollIntoView({ block: 'center' });
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await js(HUD(label));
  win.focus();

  if (SELFTEST) {
    for (const ch of ' and the light went out') {
      const keyCode = ch === ' ' ? 'Space' : ch;
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await tick(120);
    }
    await tick(1000);
    const r = await js(`({ code: __tryHud.code, work: __tryHud.work, screen: __tryHud.screenMs, words: document.getElementById('word-counter').textContent })`);
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    console.log(`${label}: ${r.code}; work median ${med(r.work).toFixed(1)} ms, key to screen median ${med(r.screen).toFixed(1)} ms; counter "${r.words}"`);
    app.exit(0);
  }
}
main().catch((err) => { console.error(err); app.exit(1); });
