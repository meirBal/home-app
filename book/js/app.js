// ===== APP — state, settings form, fonts, run pipeline, page editor, save dialog =====
import { VERSION, DEFAULTS, FONTS } from './config.js';
import { readFile } from './docx-read.js';
import { geom, prepare, paginate, compose, remap, pageHTML, headHTML, pageVars } from './layout.js';
import { buildDocx, download, printPages } from './export.js';
import { splitPlan, esc } from './text.js';

const $ = (id) => document.getElementById(id);
// s = live settings; L = snapshot of the last finished layout {s, g, paras, content} — drawing/export only ever use L.
const st = { s: load(), doc: null, name: 'ספר', L: null, pages: [], blanks: {}, over: {}, busy: 0 };
const say = (m) => { $('status').textContent = m; };
const NUMERIC = ['padTo', 'headLvl'];

// ----- [1] SETTINGS: persisted per browser; form fields carry data-k -----
function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('book.settings') || '{}') }; } catch { return { ...DEFAULTS }; } }
function persist() { try { localStorage.setItem('book.settings', JSON.stringify(st.s)); } catch { /* private mode */ } }
const fields = () => document.querySelectorAll('[data-k]');

function initForm() {
  $('ver').textContent = 'v' + VERSION;
  $('font').innerHTML = FONTS.map((f) => `<option value="${esc(f.name)}">${esc(f.label)}</option>`).join('');
  for (const el of fields()) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!st.s[k]; else el.value = st.s[k];
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || NUMERIC.includes(k) ? +el.value : el.value;
      if (el.type === 'number' && !(v >= +el.min && v <= +el.max)) { el.value = st.s[k]; return say(`ערך לא תקין (${el.min}–${el.max})`); }
      st.s[k] = v; persist();
      $('customBox').hidden = st.s.font !== 'custom';
      if (st.L) schedule();
    });
  }
  $('customBox').hidden = st.s.font !== 'custom';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // own scope: keeps the home app's SW out
}
let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 400); };

// ----- [2] FONTS: free web fonts on demand, installed fonts by name, or a font file the user picks -----
const webLoaded = new Set();
const cleanName = (n) => String(n || '').replace(/["'\\<>;{}]/g, '').trim(); // goes into CSS and Word XML
async function useFont(s) {
  const f = FONTS.find((x) => x.name === s.font);
  s.fontFamily = s.font === 'custom' ? cleanName(s.fontName) : s.font;
  if (!s.fontFamily) throw new Error('יש להזין שם פונט או לבחור קובץ פונט');
  if (f?.web && !webLoaded.has(f.name)) {
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.name)}:wght@400;700&display=block`;
    const ok = await new Promise((r) => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: () => r(true), onerror: () => r(false) })));
    if (ok) webLoaded.add(f.name);
  }
  await document.fonts.load(`${s.bodyPt}pt "${s.fontFamily}"`, 'אבג').catch(() => {});
  const found = available(s.fontFamily);
  $('fontWarn').hidden = found;
  $('fontWarn').textContent = found ? '' : `הפונט "${s.fontFamily}" לא נמצא בדפדפן — מוצג פונט חלופי והעימוד לא יתאים לוורד. ` +
    'התקינו את הפונט במחשב (או העלו קובץ פונט), או בחרו פונט חינמי.';
}
function available(name) {   // a missing font measures exactly like the fallback
  const c = document.createElement('canvas').getContext('2d'), t = 'אבגדהשת abc';
  return ['serif', 'monospace'].some((fb) => { c.font = `40px ${fb}`; const a = c.measureText(t).width; c.font = `40px "${name}", ${fb}`; return c.measureText(t).width !== a; });
}
$('fontFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const name = cleanName(st.s.fontName) || cleanName(file.name.replace(/\.\w+$/, ''));
  try {
    document.fonts.add(await new FontFace(name, await file.arrayBuffer()).load());
    Object.assign(st.s, { font: 'custom', fontName: name }); persist();
    for (const el of fields()) if (el.dataset.k === 'fontName') el.value = name;
    say(`הפונט "${name}" נטען לתצוגה (לשמירה ב-Word הוא צריך להיות מותקן במחשב באותו שם)`);
    if (st.L) schedule();
  } catch { say('קובץ הפונט לא נטען'); }
  e.target.value = '';
});

// ----- [3] FILE → original preview -----
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  st.busy++;                                               // a layout still running belongs to the old file
  say('קורא…');
  try {
    st.doc = await readFile(file);
    Object.assign(st, { name: file.name.replace(/\.\w+$/, ''), blanks: {}, over: {}, L: null, pages: [] });
    $('exName').value = st.name;
    const { paras, info, bodySz } = st.doc;
    const words = paras.reduce((n, p) => n + p.runs.reduce((m, r) => m + (r.t.match(/\S+/g)?.length || 0), 0), 0);
    const lost = [info.notes && `${info.notes} הערות שוליים`, info.lists && `${info.lists} פסקאות ממוספרות (המספור לא נשמר)`, info.boxes && 'תיבות טקסט']
      .filter(Boolean).join(', ');
    $('origInfo').textContent = `${paras.length} פסקאות · ${words} מילים · גודל עיקרי ${bodySz}pt${lost ? ' · ⚠ לא מועבר: ' + lost : ''}`;
    $('orig').innerHTML = paras.map((p) => p.empty ? '<p>&nbsp;</p>'
      : `<p class="${p.h ? 'h' : ''}" style="${p.center ? 'text-align:center' : ''}">${p.runs.map((r) =>
        `<span style="font-size:${r.sz}pt${r.b ? ';font-weight:700' : ''}">${esc(r.t).replace(/\n/g, '<br>')}</span>`).join('')}</p>`).join('');
    $('result').innerHTML = '<p class="hint">לחצו "בצע".</p>';
    $('run').disabled = false; $('save').disabled = true;
    say(`נטען: ${file.name}`);
  } catch (err) { say(err.message || 'שגיאה בקריאת הקובץ'); $('run').disabled = !st.doc; }
  e.target.value = '';
});

// ----- [4] RUN: snapshot settings → prepare → paginate (measured) → remap edits → draw. Stale runs are dropped. -----
async function run() {
  if (!st.doc) return;
  const id = ++st.busy, s = { ...st.s }, doc = st.doc;
  $('run').disabled = true;
  try {
    await useFont(s);
    const g = geom(s, doc.bodySz);
    if (s.mi + s.mo > g.pw - 30 || s.mt + s.mb > g.ph - 40) throw new Error('השוליים גדולים מדי לגודל הדף');
    const paras = prepare(doc, s, g);
    const content = await paginate(paras, s, g, $('measure'), (n) => id === st.busy && (say(`מעמד… ${n} עמודים`), true));
    if (!content || id !== st.busy) return;
    if (st.L) { st.over = remap(st.over, content); st.blanks = remap(st.blanks, content, true); }
    st.L = { s, g, paras, content };
    draw();
    say('');
  } catch (err) { if (id === st.busy) say(err.message || 'שגיאה בעימוד'); console.error(err); }
  finally { if (id === st.busy) $('run').disabled = false; }
}
function draw() {
  const { s, g, paras, content } = st.L;
  st.pages = compose(content, paras, s, g, st.blanks, st.over);
  const r = $('result');
  r.style.cssText = pageVars(s, g) + `;--z:${$('zoom').value}`;
  r.innerHTML = st.pages.map((pg) => pageHTML(pg, paras)).join('');
  const blanks = st.pages.filter((p) => p.blank).length;
  $('resInfo').textContent = `${st.pages.length} עמודים${blanks ? ` (${blanks} ריקים)` : ''} · ${s.size}`;
  $('save').disabled = false;
}
function drawHeads() {         // header-only edits: patch the headers, keep the page bodies
  const { s, g, paras, content } = st.L, old = new Map(st.pages.map((p) => [p.id, p.head]));
  st.pages = compose(content, paras, s, g, st.blanks, st.over);
  for (const pg of st.pages) if (old.get(pg.id) !== pg.head) $('result').querySelector(`.page[data-id="${pg.id}"] .hd`).innerHTML = headHTML(pg);
}
$('run').addEventListener('click', run);
$('zoom').addEventListener('input', (e) => $('result').style.setProperty('--z', e.target.value));

// ----- [5] PAGE EDITOR: header text, copy from previous, apply forward, blank pages. Only "save" saves. -----
let edPage = null;
const ed = $('ed'), btn = (a) => ed.querySelector(`[data-a="${a}"]`);
$('result').addEventListener('click', (e) => {
  const el = e.target.closest('.page'); if (!el) return;
  edPage = st.pages.find((p) => p.id === el.dataset.id); if (!edPage) return;
  $('edN').textContent = edPage.n + (edPage.blank ? ' (ריק)' : '');
  $('edHead').value = edPage.head; $('edHead').disabled = !!edPage.blank; $('edFwd').checked = false;
  btn('unblank').disabled = !edPage.blank || !!edPage.pad;
  btn('blank').disabled = btn('auto').disabled = btn('prev').disabled = !!edPage.blank;
  ed.returnValue = '';
  ed.showModal();
});
ed.addEventListener('click', (e) => {
  const a = e.target.dataset?.a; if (!a) return;
  const pg = edPage;
  if (a === 'prev') return void ($('edHead').value = st.pages.slice(0, st.pages.indexOf(pg)).reverse().find((p) => !p.blank)?.head ?? '');
  ed.close(a);                                             // returnValue = action, so the close handler won't save
  if (a === 'auto') { delete st.over[pg.id]; return drawHeads(); }
  const cid = a === 'blank' ? pg.id : pg.id.slice(1, pg.id.lastIndexOf('#'));
  st.blanks[cid] = Math.max(0, (st.blanks[cid] || 0) + (a === 'blank' ? 1 : -1));
  draw();
});
$('edHead').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.close('ok'); } });
ed.addEventListener('close', () => {
  const pg = edPage;
  if (ed.returnValue !== 'ok' || pg.blank) return;
  const v = $('edHead').value.trim();
  st.over[pg.id] = v;
  if ($('edFwd').checked) for (const p of st.pages.slice(st.pages.indexOf(pg) + 1)) {
    if (p.blank) continue;
    if (p.id in st.over || p.auto !== pg.auto) break;   // stop at an edited page or where a new Word heading starts
    st.over[p.id] = v;
  }
  drawHeads();
});

// ----- [6] SAVE: split plan → Word files (zip when several) or print/PDF per part -----
const SPEC = { every: 'עמודים בכל קובץ', parts: 'מספר קבצים', ranges: 'טווחים, לדוגמה: 1-48, 49-96' };
function plan() {
  const mode = $('exMode').value;
  $('exSpecBox').hidden = mode === 'one'; $('exSpecLbl').textContent = SPEC[mode] || '';
  $('exErr').textContent = ''; $('exList').innerHTML = '';
  try {
    const parts = splitPlan(st.pages.length, mode, $('exSpec').value);
    $('exList').innerHTML = parts.map(([a, b], i) => `<li>עמודים ${a}–${b}${a % 2 ? '' : ' <span class="warn">⚠ מתחיל בעמוד זוגי</span>'}` +
      `<button type="button" data-print="${i}">הדפסה / PDF</button></li>`).join('');
    return parts;
  } catch (err) { $('exErr').textContent = err.message; return null; }
}
$('save').addEventListener('click', () => {
  const f = FONTS.find((x) => x.name === st.L.s.font);
  $('exFontWarn').innerHTML = f?.web ? `הפונט "${esc(f.name)}" בדרך כלל לא מותקן בוורד — <a href="${f.url}" target="_blank" rel="noopener">להורדה חינם</a> והתקנה, אחרת Word יחליף פונט והעימוד ישתנה. בהדפסה/PDF מכאן הוא תקין.` : '';
  plan(); $('ex').showModal();
});
$('exMode').addEventListener('change', plan);
$('exSpec').addEventListener('input', plan);
$('exList').addEventListener('click', (e) => {
  const i = e.target.dataset.print; if (i == null) return;
  const [a, b] = plan()[+i], { s, g, paras } = st.L;
  $('ex').close();
  printPages(st.pages.slice(a - 1, b).map((pg) => pageHTML(pg, paras)).join(''), pageVars(s, g), g);
});
$('exWord').addEventListener('click', async () => {
  const parts = plan(); if (!parts) return;
  const pages = st.pages, { s, g, paras } = st.L;          // snapshot: a re-layout mid-export can't mix books
  const base = ($('exName').value.trim() || st.name).replace(/[\\/:*?"<>|]/g, '_');
  $('exWord').disabled = true;
  try {
    const files = [];
    for (const [k, [a, b]] of parts.entries()) {
      say(`יוצר קובץ ${k + 1}/${parts.length}…`);
      const name = parts.length > 1 ? `${base} ${String(k + 1).padStart(2, '0')} (${a}-${b}).docx` : `${base}.docx`;
      files.push([name, await buildDocx(pages.slice(a - 1, b), paras, s, g)]);
    }
    if (files.length === 1) download(files[0][1], files[0][0]);
    else { const z = new JSZip(); for (const [n, f] of files) z.file(n, f); download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), `${base}.zip`); }
    say(`נשמרו ${files.length} קבצים`);
  } catch (err) { say('שגיאה בשמירה: ' + err.message); }
  finally { $('exWord').disabled = false; }
});

initForm();
