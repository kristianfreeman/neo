// Does a change leave the page looking as it did? NEO runs with app.js and
// styles.css from the base commit and from this checkout, on the same book:
// story chapters with every kind of paragraph (breaks, dialogue after a break,
// poetry, flush, centered, justified, a darling's anchor), the copyright,
// acknowledgments and about pages, and the page sheets. The same edits run in
// both, and after each one every paragraph's computed style is compared.
//
//   npm run style-check                  against main
//   npm run style-check -- --base <ref>  against another commit

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
const FROM_BASE = ['app.js', 'styles.css'];

/* ---------- no role: run both, compare ---------- */

if (!ROLE) {
  // each run writes its styles to a file: tens of megabytes, more than a
  // pipe takes before the process exits
  const run = (role) => new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `neo-style-out-${process.pid}-${role}.json`);
    const child = spawn(process.execPath, [__filename, '--role', role, '--base', BASE, '--out', out, ...(args.includes('--show') ? ['--show'] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', () => {
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); } catch { resolve(null); }
      fs.rmSync(out, { force: true });
    });
  });
  (async () => {
    const before = await run('before');
    const after = await run('after');
    if (!before || !after) { console.log('a run failed'); app.exit(1); return; }
    console.log(`\ncomputed styles, ${before.label} vs ${after.label}\n`);
    let differ = 0;
    for (let s = 0; s < before.steps.length; s++) {
      const a = before.steps[s], b = after.steps[s];
      const diffs = [];
      if (a.els.length !== b.els.length) diffs.push(`${a.els.length} elements before, ${b.els.length} after`);
      for (let i = 0; i < Math.min(a.els.length, b.els.length); i++) {
        const x = a.els[i], y = b.els[i];
        if (x.key !== y.key) { diffs.push(`element ${i}: ${x.key} before, ${y.key} after`); continue; }
        for (const prop of Object.keys(x.style)) {
          if (x.style[prop] !== y.style[prop]) diffs.push(`${x.key}: ${prop} ${x.style[prop]} → ${y.style[prop]}`);
        }
      }
      if (diffs.length) differ++;
      console.log(`  ${diffs.length ? 'DIFFER' : 'same  '} ${a.step} (${a.els.length} elements)`);
      for (const d of diffs.slice(0, 6)) console.log('         ' + d);
    }
    console.log(differ ? `\n${differ} step(s) differ` : '\nevery step the same');
    app.exit(differ ? 1 : 0);
  })();
  app.on('window-all-closed', () => {});
  return;
}

/* ---------- one run ---------- */

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-style-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-style-${process.pid}-`));
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
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, o) { return loadFile.call(this, path.resolve(ROOT, file), o); };
require(path.join(REPO, 'main.js'));

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const STORY = [
  '<p>The opening line of the story.</p>', '<p>Second paragraph here.</p>', '<p class="scene-break">***</p>',
  '<p>After a break, plain prose.</p>', '<p>The next paragraph in the scene.</p>', '<p class="scene-break">***</p>',
  '<p>— Dialogue right after a break.</p>', '<p>A reply in prose.</p>', '<p class="scene-break">***</p>',
  '<p class="poetry">A line of verse</p>', '<p class="poetry">and another</p>', '<p>Prose after the poem.</p>',
  '<p class="scene-break">***</p>', '<p class="flush">Flush after a break.</p>', '<p style="text-align: center;">Centered.</p>',
  '<p class="scene-break">***</p>', '<p style="text-align: justify;">Justified after a break.</p>',
  '<p class="scene-break">***</p>', '<p style="text-align: center;">Centered after a break.</p>',
  '<p class="scene-break">***</p>', '<p class="scene-break">***</p>', '<p>After two breaks.</p>',
  '<span class="darling-anchor" data-did="d1"></span>', '<p>After a darling\'s anchor.</p>',
  '<p><br></p>', '<p>The last paragraph.</p>'
].join('');
const OPENS_WITH_DIALOGUE = '<p>— Who goes there?</p><p>Nobody answered.</p><p class="scene-break">***</p><p>— Again, who?</p><p>Still nothing.</p>';
const PAGE = '<p>First line of the page.</p><p>Second line.</p><p style="text-align: center;">Centered line.</p><p>Cut <span class="darling-anchor" data-did="d2"></span>here.</p><p>After an anchor.</p><p class="scene-break">***</p><p>After a break.</p><p>Last line.</p>';

async function main() {
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  const js = async (code) => {
    const r = await wc.executeJavaScript(`(async () => { try { return { ok: await (${code}) }; } catch (e) { return { err: String(e && e.stack || e) }; } })()`, true);
    if (r && r.err) throw new Error(r.err + '\n  in: ' + code.slice(0, 160));
    return r && r.ok;
  };
  while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
  await tick(500);
  await js(`(async () => {
    document.getElementById('firstrun').hidden = true;
    await addImportedBooks([{ name: 'Styles', chapters: ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => ({ title: t, paras: [{ text: t }] })) }], library.shelves[0]);
    await openBook(library.shelves[0].bookIds.at(-1));
    const [cr, s1, s2, ack, about, pro] = book.chapterOrder;
    book.chapterKinds = { [cr]: 'copyright', [ack]: 'acknowledgments', [about]: 'about', [pro]: 'chapter' };
    chapterHTML[cr] = ${JSON.stringify(PAGE)};
    chapterHTML[s1] = ${JSON.stringify(STORY)};
    chapterHTML[s2] = ${JSON.stringify(OPENS_WITH_DIALOGUE)};
    chapterHTML[ack] = ${JSON.stringify(PAGE)};
    chapterHTML[about] = ${JSON.stringify(PAGE)};
    chapterHTML[pro] = ${JSON.stringify(STORY)};
    renderChapters();
    // the page sheets, as the shelf opens them
    for (const kind of ['copyright', 'acknowledgments', 'about']) {
      const d = document.createElement('div');
      d.className = 'ps-paper kind-' + kind;
      d.innerHTML = '<div class="ps-body">' + ${JSON.stringify(PAGE)} + '</div>';
      document.body.appendChild(d);
    }
  })()`);
  await tick(800);
  win.focus();

  const steps = [];
  const snap = async (step) => {
    await tick(150);
    const els = await js(`(() => {
      const out = [];
      const pick = (root, tag) => [...root.children].forEach((el, i) => {
        const cs = getComputedStyle(el);
        const style = {};
        for (const k of cs) style[k] = cs.getPropertyValue(k);
        out.push({ key: tag + '/' + i + ' ' + el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : '') + ' "' + el.textContent.slice(0, 18) + '"', style });
      });
      document.querySelectorAll('#chapters .chapter').forEach((c, ci) => pick(c.querySelector('.chapter-body'), 'ch' + ci));
      document.querySelectorAll('.ps-paper > .ps-body').forEach((b, bi) => pick(b, 'sheet' + bi));
      return out;
    })()`);
    steps.push({ step, els });
  };
  const press = async (keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(200);
  };
  const type = async (text) => { for (const ch of text) await press(ch === ' ' ? 'Space' : ch); };
  // the caret in the paragraph that holds this text: at its end (-1) or at an offset
  const caret = (chapter, text, offset) => js(`(() => {
    const b = document.querySelectorAll('#chapters .chapter-body')[${chapter}];
    b.focus();
    const p = [...b.children].find((q) => q.textContent.includes(${JSON.stringify(text)}));
    const r = document.createRange();
    if (${offset} < 0) { r.selectNodeContents(p); r.collapse(false); } else r.setStart(p.firstChild, ${offset});
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  const dom = (code) => js(`(() => { const b = document.querySelectorAll('#chapters .chapter-body')[1]; ${code}; })()`);

  if (args.includes('--list')) {
    console.log(JSON.stringify(await js(`[...document.querySelectorAll('#chapters .chapter')].map((c) => c.className + ' :: ' + [...c.querySelector('.chapter-body').children].slice(0, 6).map((el) => el.tagName + (el.className ? '.' + el.className : '') + ' mt=' + getComputedStyle(el).marginTop + ' ti=' + getComputedStyle(el).textIndent).join(' | '))`), null, 1));
  }
  await snap('the book as opened');
  await caret(1, 'Second paragraph', -1); await press('Enter'); await press('Enter'); await snap('Enter twice at the end of a paragraph: a break');
  await type('Hello there'); await snap('typing after the new break');
  await caret(1, 'The next paragraph', 8); await press('Enter'); await press('Enter'); await snap('Enter twice inside a paragraph: a break');
  await caret(1, 'After a break, plain', 0); await press('Backspace'); await snap('Backspace at the start of the line after a break');
  wc.undo(); await tick(250); await snap('Edit → Undo');
  await caret(1, 'A reply in prose', -1); await js(`document.execCommand('insertHTML', false, '<p>Pasted one.</p><p class="scene-break">***</p><p>Pasted two.</p>')`); await snap('pasting paragraphs with a break');
  await dom(`b.querySelector('p.scene-break').remove()`); await snap('a break removed by hand');
  await dom(`const q = document.createElement('p'); q.className = 'scene-break'; q.textContent = '***'; b.children[10].before(q)`); await snap('a break put in by hand');
  await dom(`b.children[12].className = 'scene-break'`); await snap('a paragraph turned into a break');
  await dom(`b.querySelectorAll('p.scene-break')[1].className = ''`); await snap('a break turned back into prose');
  await dom(`b.children[2].after(b.children[20])`); await snap('a paragraph moved under a break');
  await js(`renderChapters()`); await tick(500); await snap('the chapters drawn again');

  fs.writeFileSync(opt('out', path.join(tmp, 'styles.json')), JSON.stringify({ label, steps }));
  app.exit(0);
}
main().catch((err) => { console.error(err); app.exit(1); });
