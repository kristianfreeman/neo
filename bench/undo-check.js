// Does a change leave undo as it was? The same breaks, typing, ⌘Z and
// ⌘⇧Z run in NEO with app.js from the base commit and in this checkout, on
// a fresh book each time, and the page is compared after every step.
//
//   npm run undo-check                  against main
//   npm run undo-check -- --base <ref>  against another commit
//
// ⌘Z goes where it goes in the app: NEO's keydown handler takes it right
// after a break (the structural stack); otherwise it is the menu's Undo,
// webContents.undo().

'use strict';

require('./quiet'); // no window on screen unless --show
const { app, BrowserWindow } = require('electron');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const ROLE = opt('role', '');
const BASE = opt('base', 'main');

/* ---------- no role: run both, compare ---------- */

if (!ROLE) {
  const run = (role) => new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--role', role, '--base', BASE, ...(args.includes('--show') ? ['--show'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => {
      const line = out.split('\n').find((l) => l.startsWith('UNDOCHECK '));
      resolve(line ? JSON.parse(line.slice(10)) : null);
    });
  });
  (async () => {
    const before = await run('before');
    const after = await run('after');
    if (!before || !after) { console.log('a run failed'); app.exit(1); return; }
    let differ = 0;
    console.log(`\nundo, ${before.label} vs ${after.label}\n`);
    for (const name of Object.keys(before.flows)) {
      const a = before.flows[name], b = after.flows[name];
      const bad = a.findIndex((s, i) => s.page !== (b[i] && b[i].page));
      const changes = a.filter((s, i) => i > 0 && s.page !== a[i - 1].page).length;
      if (bad < 0) console.log(`  same   ${name}  (${a.length} steps, the page changed at ${changes} of them)`);
      else {
        differ++;
        console.log(`  DIFFER ${name}, at step ${bad} (${a[bad].step})\n    before: ${a[bad].page}\n    after:  ${b[bad] && b[bad].page}`);
      }
    }
    console.log(differ ? `\n${differ} flow(s) differ` : '\nevery flow the same');
    app.exit(differ ? 1 : 0);
  })();
  app.on('window-all-closed', () => {});
  return;
}

/* ---------- one run ---------- */

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-undo-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-undo-${process.pid}-`));
let ROOT = REPO;
let label = 'this checkout';
if (ROLE === 'before') {
  const base = execFileSync('git', ['merge-base', 'HEAD', BASE], { cwd: REPO }).toString().trim();
  ROOT = path.join(tmp, 'neo');
  fs.mkdirSync(ROOT);
  for (const name of fs.readdirSync(REPO)) {
    if (name === 'app.js' || name === '.git') continue;
    fs.symlinkSync(path.join(REPO, name), path.join(ROOT, name));
  }
  fs.writeFileSync(path.join(ROOT, 'app.js'), execFileSync('git', ['show', `${base}:app.js`], { cwd: REPO }));
  label = `${BASE} (${base.slice(0, 7)})`;
}
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, o) { return loadFile.call(this, path.resolve(ROOT, file), o); };
require(path.join(REPO, 'main.js'));

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  const js = (code) => wc.executeJavaScript(code, true);
  while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
  await tick(500);
  await js(`document.getElementById('firstrun').hidden = true`);
  win.focus();

  const press = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (!modifiers.includes('meta')) wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await tick(250);
  };
  const type = async (text) => {
    for (const ch of text) {
      const keyCode = ch === ' ' ? 'Space' : ch;
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await tick(40);
    }
    await tick(250);
  };
  const atEnd = (i) => js(`(() => { const b = document.querySelector('.chapter-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b.children[${i}]); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  const inside = (i, off) => js(`(() => { const b = document.querySelector('.chapter-body'); b.focus(); getSelection().collapse(b.children[${i}].firstChild, ${off}); })()`);
  await js(`window.__zTaken = false; document.addEventListener('keydown', (e) => { if (e.metaKey && e.code === 'KeyZ') __zTaken = e.defaultPrevented; })`);
  const undo = async () => {
    await js('__zTaken = false');
    await press('z', ['meta']);
    if (!(await js('__zTaken'))) { wc.undo(); await tick(250); }
  };
  const redo = async () => { wc.redo(); await tick(250); };
  const page = () => js(`book.chapterOrder.map((id) => {
    const b = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body');
    return [...b.children].map((p) => (p.className ? '[' + p.className.replace(/\\b(flush)\\b/, '').trim() + ']' : '') + p.textContent).join(' | ');
  }).join(' ### ').replace(/Rain fell on the harbor and the boats came in under a grey sky/g, '~')`);

  const flows = {
    'scene break at a paragraph\'s end, ⌘Z at once': async (step) => { await atEnd(10); await press('Enter'); await press('Enter'); await step('break'); await undo(); await step('⌘Z'); await undo(); await step('⌘Z'); },
    'scene break at a paragraph\'s end, typing, ⌘Z ×5, ⌘⇧Z ×2': async (step) => {
      await atEnd(10); await type(' aaa'); await press('Enter'); await press('Enter'); await type('ccc'); await step('typed');
      for (let i = 0; i < 5; i++) { await undo(); await step('⌘Z'); }
      for (let i = 0; i < 2; i++) { await redo(); await step('⌘⇧Z'); }
    },
    'scene break inside a paragraph, typing, ⌘Z ×5': async (step) => {
      await inside(10, 20); await type('aaa '); await inside(12, 30); await press('Enter'); await press('Enter'); await type('ccc'); await step('typed');
      for (let i = 0; i < 5; i++) { await undo(); await step('⌘Z'); }
    },
    'two scene breaks, typing between, ⌘Z ×6': async (step) => {
      await atEnd(5); await press('Enter'); await press('Enter'); await type('one'); await atEnd(20); await press('Enter'); await press('Enter'); await type('two'); await step('typed');
      for (let i = 0; i < 6; i++) { await undo(); await step('⌘Z'); }
    },
    'chapter split (Enter three times), typing, ⌘Z ×4': async (step) => {
      await atEnd(10); await type(' aaa'); await press('Enter'); await press('Enter'); await press('Enter'); await type('ccc'); await step('typed');
      for (let i = 0; i < 4; i++) { await undo(); await step('⌘Z'); }
    },
    'scene break, then Backspace twice': async (step) => {
      await atEnd(10); await press('Enter'); await press('Enter'); await step('break'); await press('Backspace'); await step('⌫'); await press('Backspace'); await step('⌫');
    },
  };

  const out = {};
  for (const [name, flow] of Object.entries(flows)) {
    await js(`(async () => {
      await addImportedBooks([{ name: 'Fresh', chapters: [{ title: 'One', paras: Array.from({ length: 30 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in under a grey sky ' + i + '.' })) }] }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds.at(-1));
      breakRun = 0; undoStack = [];
    })()`);
    await tick(600);
    const steps = [];
    await flow(async (stepName) => { steps.push({ step: stepName, page: await page() }); });
    out[name] = steps;
  }
  process.stdout.write('UNDOCHECK ' + JSON.stringify({ label, flows: out }) + '\n');
  app.exit(0);
}
main().catch((err) => { console.error(err); app.exit(1); });
