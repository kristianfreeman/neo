// Timings of what a writer feels: a keystroke, the menu following the caret,
// the save after a pause. NEO runs on a throwaway library in a temp folder;
// the writer's own library is never opened.
//
//   npm run bench                         every scenario, on this machine as it is
//   npm run bench -- --only typing        scenarios whose name holds "typing"
//   npm run bench -- --json after.json    keep the numbers
//   npm run bench -- --compare before.json
//
// Nothing in NEO depends on this folder. Deleting bench/ and the "bench"
// script in package.json removes it.

'use strict';

require('./quiet'); // no window on screen unless --show
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const ONLY = opt('only', '');
const FILLER_BOOKS = +opt('books', 80);
const JSON_OUT = opt('json', '');
const COMPARE = opt('compare', '');

/* ---------- a library of its own ---------- */

// Chromium writes to its profile until the process is gone, so a run can't
// remove its own folder; it removes those of earlier runs that have ended.
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-bench-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-bench-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// books that only have a book.json: what a big library costs the main process
for (let i = 0; i < FILLER_BOOKS; i++) {
  const dir = path.join(LIB, `book-filler-${i}`);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  const dailyCounts = {};
  for (let d = 0; d < 200; d++) dailyCounts[`2026-${String(d).padStart(3, '0')}`] = d * 37;
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify({
    id: `filler${i}`, title: `Filler Book ${i}`, author: 'Bench',
    chapterOrder: Array.from({ length: 30 }, (_, j) => `ch-${j}`),
    chapterTitles: {}, wordCount: 80000, dailyCounts
  }, null, 2));
}

/* ---------- counting what the main process does ---------- */

const io = { menus: 0, reads: 0, writes: 0 };
const setMenu = Menu.setApplicationMenu.bind(Menu);
Menu.setApplicationMenu = (m) => { io.menus++; setMenu(m); };
const readFileSync = fs.readFileSync;
fs.readFileSync = function (...a) { io.reads++; return readFileSync.apply(this, a); };
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (...a) { io.writes++; return writeFileSync.apply(this, a); };

// main.js loads index.html relative to the app it was started as
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, o) { return loadFile.call(this, path.resolve(ROOT, file), o); };
require(path.join(ROOT, 'main.js'));

/* ---------- helpers ---------- */

let win, wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => sorted(a)[Math.floor(a.length / 2)];
const p95 = (a) => sorted(a)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];

const results = {};
const record = (name, value, unit = 'ms') => { results[name] = { value: +value.toFixed(3), unit }; };

const WORDS = 'the rain fell on the harbor while she counted boats against grey light and wondered whether anyone would come back before winter closed every road north'.split(' ');

async function makeBook(name, paras) {
  return js(`(async () => {
    const W = ${JSON.stringify(WORDS)};
    await addImportedBooks([{ name: ${JSON.stringify(name)}, chapters: [{ title: 'One',
      paras: Array.from({ length: ${paras} }, (_, i) => ({ text: Array.from({ length: 50 }, (_, k) => W[(k * 7 + i) % W.length]).join(' ') + '.' }))
    }] }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    return ids[ids.length - 1];
  })()`);
}

async function open(bookId) {
  await js(`openBook(${JSON.stringify(bookId)})`);
  await tick(800);
}

async function caretAtEndOf(index) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${index}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(300);
}

// Time from the first input listener to the last: everything NEO does in
// answer to a keystroke before the browser paints.
let listening = false;
async function typeAndTime(text) {
  if (!listening) {
    await js(`(() => {
      window.__bench = { ks: [], lafs: [] };
      window.addEventListener('input', () => { window.__bench.t0 = performance.now(); }, true);
      document.addEventListener('input', () => { window.__bench.ks.push(performance.now() - window.__bench.t0); });
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bench.lafs.push(e.duration); })
          .observe({ type: 'long-animation-frame' });
      } catch { /* older Chromium */ }
    })()`);
    listening = true;
  }
  await js(`window.__bench.ks = []; window.__bench.lafs = [];`);
  for (const ch of text) {
    const keyCode = ch === ' ' ? 'Space' : ch;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(120); // about 100 words a minute
  }
  await tick(1500); // the debounced saves land
  return js('window.__bench');
}

// The counter's own cost after a one-letter edit in the middle of the chapter,
// timed in a loop since the page's clock is coarse.
function counterAfterEdit(rounds = 30) {
  return js(`(() => {
    const id = currentChapterId || book.chapterOrder[0];
    const body = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body');
    const p = body.children[body.children.length >> 1];
    let t = 0;
    for (let i = 0; i < ${rounds}; i++) {
      p.firstChild.appendData('x');
      const a = performance.now();
      wordCache[id] = null;
      chapterWords(id);
      t += performance.now() - a;
    }
    for (let i = 0; i < ${rounds}; i++) p.firstChild.deleteData(p.firstChild.length - 1, 1);
    wordCache[id] = null;
    return t / ${rounds};
  })()`);
}

/* ---------- scenarios ---------- */

const books = {};
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

async function typingScenario(label, bookKey, paras, posMode) {
  await js(`library.posMode = ${JSON.stringify(posMode)}`);
  await open(books[bookKey]);
  await caretAtEndOf(paras >> 1);
  const before = { ...io };
  const run = await typeAndTime(' and then the rain stopped for good');
  record(`${label}: keystroke median`, median(run.ks));
  record(`${label}: keystroke p95`, p95(run.ks));
  record(`${label}: frames over 50 ms`, run.lafs.length, 'frames');
  record(`${label}: counter after an edit`, await counterAfterEdit());
  record(`${label}: main-process file reads`, io.reads - before.reads, 'reads');
  await js(`library.posMode = 'chapter'`);
}

scenario('typing: 4k-word chapter', () => typingScenario('typing 4k', 'short', 80, 'chapter'));
scenario('typing: 100k-word chapter', () => typingScenario('typing 100k', 'long', 2000, 'chapter'));
scenario('typing: 100k-word chapter, page of pages', () => typingScenario('typing 100k page-mode', 'long', 2000, 'page'));

// Enter twice at the end of a paragraph: the second press turns the empty
// line into a *** scene break. Timed against a plain Enter, from keydown to
// the frame after it, with where the time went: NEO's functions, and the
// browser's style and layout in the frames that ran long.
const BREAK_PARTS = ['snapshotStructure', 'resetNativeUndo', 'syncChapter', 'captureCaret', 'restoreCaret', 'updateCounters', 'markDialogueOpening', 'captureBody'];
async function sceneBreakScenario(label, bookKey, paras) {
  await open(books[bookKey]);
  await js(`(() => {
    window.__brk = { parts: {}, frames: [] };
    for (const name of ${JSON.stringify(BREAK_PARTS)}) {
      const f = window[name];
      if (typeof f !== 'function' || f.__timed) continue;
      window[name] = function (...a) {
        const t = performance.now();
        try { return f.apply(this, a); } finally { window.__brk.parts[name] = (window.__brk.parts[name] || 0) + performance.now() - t; }
      };
      window[name].__timed = true;
    }
    window.addEventListener('keydown', () => { window.__brk.k0 = performance.now(); }, true);
    window.__brk.next = () => new Promise((resolve) => {
      const give = () => resolve(performance.now() - window.__brk.k0);
      const late = setTimeout(give, 2000); // a window the system stopped painting
      requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { clearTimeout(late); give(); };
        ch.port2.postMessage(0);
      });
    });
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__brk.frames.push({ duration: e.duration, script: e.scripts.reduce((s, x) => s + x.duration, 0),
            styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0 });
        }
      }).observe({ type: 'long-animation-frame' });
    } catch { /* older Chromium */ }
  })()`);
  const enter = async () => {
    const wait = js('window.__brk.next()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    return wait;
  };
  const plain = [];
  const brk = [];
  await js('window.__brk.parts = {}; window.__brk.frames = []');
  for (let i = 0; i < 8; i++) {
    await caretAtEndOf(Math.floor(paras * 0.3) + i * 3);
    plain.push(await enter()); // a new, empty paragraph
    await tick(400);
    brk.push(await enter()); // the empty one becomes ***
    await tick(600);
  }
  const d = await js('({ parts: window.__brk.parts, frames: window.__brk.frames })');
  record(`${label}: plain Enter, key to screen`, median(plain));
  record(`${label}: scene break, key to screen`, median(brk));
  record(`${label}: frames over 50 ms`, d.frames.length, 'frames');
  const per = (ms) => (ms / 8).toFixed(2) + ' ms';
  console.log(`  where the time went, per press pair (inclusive): ` +
    Object.entries(d.parts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${per(v)}`).join(', '));
  if (d.frames.length) {
    const f = d.frames.reduce((s, x) => ({ duration: s.duration + x.duration, script: s.script + x.script, styleLayout: s.styleLayout + x.styleLayout }), { duration: 0, script: 0, styleLayout: 0 });
    const n = d.frames.length;
    console.log(`  long frames: ${n}, average ${(f.duration / n).toFixed(1)} ms (script ${(f.script / n).toFixed(1)}, style and layout ${(f.styleLayout / n).toFixed(1)})`);
  }
}
scenario('enter: scene break in a 4k-word chapter', () => sceneBreakScenario('scene break 4k', 'short', 80));
scenario('enter: scene break in a 100k-word chapter', () => sceneBreakScenario('scene break 100k', 'long', 2000));

// opening draws every chapter and counts it from nothing
scenario('open: a 100k-word book', async () => {
  const times = [];
  for (let i = 0; i < 6; i++) {
    times.push(await js(`(async () => {
      const t = performance.now();
      await openBook(${JSON.stringify(books.long)});
      updateCounters();
      return performance.now() - t;
    })()`));
    await tick(300);
  }
  record('open 100k: openBook and first count', median(times));
});

scenario('menu: rebuild when the caret changes alignment', async () => {
  await open(books.short);
  const vs = await js('JSON.parse(viewStateSent)');
  const times = [];
  const before = { ...io };
  for (let i = 0; i < 40; i++) {
    const t = performance.now();
    ipcMain.emit('view:state', { sender: wc }, { ...vs, align: i % 2 ? 'center' : 'left' });
    times.push(performance.now() - t);
    await tick(20);
  }
  record('menu rebuild: main thread blocked', median(times));
  record('menu rebuild: file reads each', (io.reads - before.reads) / 40, 'reads');
});

scenario('save: book.json after a pause', async () => {
  await open(books.short);
  const times = [];
  const before = { ...io };
  for (let i = 0; i < 15; i++) {
    times.push(await js(`(async () => { const t = performance.now(); await window.neo.writeBookMeta(book.id, book); return performance.now() - t; })()`));
  }
  record('book.json save: round trip', median(times));
  record('book.json save: file reads each', (io.reads - before.reads) / 15, 'reads');
});

/* ---------- report ---------- */

function report(env) {
  const base = COMPARE ? JSON.parse(readFileSync(COMPARE, 'utf8')) : null;
  const rows = Object.entries(results).map(([name, { value, unit }]) => {
    const was = base && base.results[name];
    const change = was && was.value ? `${value <= was.value ? '' : '+'}${Math.round((value / was.value - 1) * 100)}%` : '';
    const fmt = (v) => unit === 'ms' ? `${v.toFixed(2)} ms` : `${v} ${unit}`;
    return [name, was ? fmt(was.value) : '', fmt(value), change];
  });
  const head = base ? ['', 'before', 'now', 'change'] : ['', 'now'];
  const table = [head, ...rows.map((r) => base ? r : [r[0], r[2]])];
  const widths = head.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  console.log(`\n${env.electron} · ${env.cpu} · ${env.fillerBooks} filler books`);
  for (const r of table) console.log(r.map((c, i) => i ? c.padStart(widths[i]) : c.padEnd(widths[i])).join('   '));
}

async function main() {
  await app.whenReady();
  let failed = false;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    wc.setBackgroundThrottling(false); // frames keep coming behind other windows
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(3000); // the day's backup runs at launch
    await js(`document.getElementById('firstrun').hidden = true`);
    books.short = await makeBook('Four Thousand', 80);
    books.long = await makeBook('One Hundred Thousand', 2000);
    win.focus();
    for (const s of scenarios) {
      if (ONLY && !s.name.includes(ONLY)) continue;
      process.stdout.write(`${s.name} …\n`);
      await s.fn();
    }
    const env = {
      electron: `Electron ${process.versions.electron}`, cpu: os.cpus()[0].model,
      fillerBooks: FILLER_BOOKS, date: new Date().toISOString()
    };
    report(env);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ env, results }, null, 2) + '\n');
  } catch (err) {
    failed = true;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
