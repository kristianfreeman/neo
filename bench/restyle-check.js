// How much does NEO restyle when one paragraph is added to a long chapter?
// NEO runs with app.js and styles.css from the base commit and from this
// checkout, each on a throwaway library with one 2,000-paragraph chapter.
// One paragraph goes in the middle; the style update it needs is forced and
// timed, and Chromium's trace says how many elements it restyled.
//
//   npm run restyle-check                  against main
//   npm run restyle-check -- --base <ref>  against another commit

'use strict';

require('./quiet'); // no window on screen unless --show
const { app, BrowserWindow, contentTracing } = require('electron');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const ROLE = opt('role', '');
const BASE = opt('base', 'main');
const FROM_BASE = ['app.js', 'styles.css'];

/* ---------- no role: run both, compare ---------- */

if (!ROLE) {
  const run = (role) => new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--role', role, '--base', BASE, ...(args.includes('--show') ? ['--show'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => {
      const line = out.split('\n').find((l) => l.startsWith('RESTYLE '));
      resolve(line ? JSON.parse(line.slice(8)) : null);
    });
  });
  (async () => {
    const before = await run('before');
    const after = await run('after');
    if (!before || !after) { console.log('a run failed'); app.exit(1); return; }
    console.log('\none paragraph added to a 2,000-paragraph chapter');
    for (const r of [before, after]) {
      console.log(`  ${r.label.padEnd(24)} style update ${r.ms.toFixed(1).padStart(5)} ms   ${String(r.restyled).padStart(6)} elements restyled`);
    }
    app.exit(0);
  })();
  app.on('window-all-closed', () => {});
  return;
}

/* ---------- one run ---------- */

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-restyle-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-restyle-${process.pid}-`));
let ROOT = REPO;
let label = 'this checkout';
if (ROLE === 'before') {
  const base = execFileSync('git', ['merge-base', 'HEAD', BASE], { cwd: REPO }).toString().trim();
  ROOT = path.join(tmp, 'neo');
  fs.mkdirSync(ROOT);
  for (const name of fs.readdirSync(REPO)) {
    if (FROM_BASE.includes(name) || name === '.git') continue;
    fs.symlinkSync(path.join(REPO, name), path.join(ROOT, name));
  }
  for (const name of FROM_BASE) fs.writeFileSync(path.join(ROOT, name), execFileSync('git', ['show', `${base}:${name}`], { cwd: REPO }));
  label = `${BASE} (${base.slice(0, 7)})`;
}
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'),
  JSON.stringify({ firstRunDone: true, pageTheme: 'night', shelves: [{ id: 's', name: 'Shelf', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, o) { return loadFile.call(this, path.resolve(ROOT, file), o); };
require(path.join(REPO, 'main.js'));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await wait(50);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) await wait(50);
  await js(`(async () => {
    document.getElementById('firstrun').hidden = true;
    await addImportedBooks([{ name: 'Long', chapters: [{ title: 'One',
      paras: Array.from({ length: 2000 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in ' + i + '.' })) }] }], library.shelves[0]);
    await openBook(library.shelves[0].bookIds[0]);
  })()`);
  await wait(1000);
  const addOne = `(() => {
    const body = document.querySelector('.chapter-body');
    const p = document.createElement('p');
    p.textContent = 'x';
    document.body.offsetTop;
    const t = performance.now();
    body.children[1000].after(p);
    document.body.offsetTop;
    const ms = performance.now() - t;
    p.remove();
    document.body.offsetTop;
    return ms;
  })()`;
  const times = [];
  for (let i = 0; i < 9; i++) times.push(await js(addOne));
  await contentTracing.startRecording({ included_categories: ['devtools.timeline'] });
  await js(addOne);
  const file = await contentTracing.stopRecording(path.join(tmp, 'trace.json'));
  const restyled = JSON.parse(fs.readFileSync(file, 'utf8')).traceEvents
    .filter((e) => e.name === 'UpdateLayoutTree' && e.args && e.args.elementCount)
    .map((e) => e.args.elementCount);
  times.sort((a, b) => a - b);
  process.stdout.write('RESTYLE ' + JSON.stringify({ label, ms: times[4], restyled: Math.max(0, ...restyled) }) + '\n');
  app.exit(0);
});
