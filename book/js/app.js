// ===== APP — state, settings, fonts, run pipeline, paragraph & page editors, save dialog, print preview =====
import { VERSION, DEFAULTS, FONTS } from './config.js';
import { readFile } from './docx-read.js';
import { geom, prepare, paginate, compose, remap, pageHTML, headHTML, pageVars } from './layout.js';
import { buildDocx, download, printPages } from './export.js';
import { units, makePdf, fontCss, testUnits } from './print.js';
import { stretchPage, stretchHTML } from './stretch.js';
import { splitPlan, esc } from './text.js';

const $ = (id) => document.getElementById(id);
const OVER = () => ({ r: {}, c: {}, l: {}, h: {} });
// s = live settings; L = snapshot of the last finished layout {s, g, paras, content} — drawing/export only ever use L.
const st = { s: load('book.settings', DEFAULTS), doc: null, name: 'ספר', L: null, pages: [], blanks: {}, over: OVER(), busy: 0, undo: null };
const fonts = load('book.fonts', {});                      // fonts the user added: { family: dataURL }
const say = (m, err) => { for (const id of ['status', 'pvStatus']) { $(id).textContent = m; $(id).classList.toggle('err', !!err); } };
const NUMERIC = ['padTo', 'headLvl', 'sig', 'numFrom', 'lineRatio'];
const HEADER_ONLY = ['midText', 'leftText', 'numFmt', 'numFrom', 'headMode', 'rule', 'autoHead', 'headLvl', 'padTo']; // no re-measuring
const pickHeader = (s) => Object.fromEntries(HEADER_ONLY.map((k) => [k, s[k]]));
if (st.s.numFmt === 'none') Object.assign(st.s, { numFmt: 'heb', numPos: 'none' }); // settings saved by v1.0.0
st.s.lineRatio = [1.2, 1.35, 1.5, 1.75].reduce((a, b) => (Math.abs(b - st.s.lineRatio) < Math.abs(a - st.s.lineRatio) ? b : a)); // v1.1 free values

// ----- [1] SETTINGS: persisted per browser. data-k = layout/header setting, data-o = output-only setting -----
function load(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; } }
const persist = () => save('book.settings', st.s) || say('ההגדרות לא נשמרו (אין מקום באחסון)', true);
const fields = (attr) => document.querySelectorAll(`[data-${attr}]`);
function syncVisibility() {
  $('customBox').hidden = st.s.font !== 'custom';
  $('leftBox').hidden = st.s.numPos === 'to' || st.s.numPos === 'tl';
  $('sigBox').hidden = st.s.imp !== 'sig';
  $('impHint').hidden = st.s.imp === 'none';
}

function initForm() {
  $('ver').textContent = 'v' + VERSION;
  fillFonts();
  for (const attr of ['k', 'o']) for (const el of fields(attr)) {
    const k = el.dataset[attr];
    if (el.type === 'checkbox') el.checked = !!st.s[k]; else el.value = st.s[k];
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || NUMERIC.includes(k) ? +el.value : el.value;
      if (el.type === 'number' && !(v >= +el.min && v <= +el.max)) { el.value = st.s[k]; return say(`ערך לא תקין (${el.min}–${el.max})`, true); }
      st.s[k] = v; persist(); syncVisibility();
      if (attr === 'o') return plan();
      if (!st.L) return;
      if (HEADER_ONLY.includes(k)) { st.L.s = { ...st.L.s, [k]: v }; draw(); }
      else schedule();
    });
  }
  syncVisibility();
  if (innerWidth < 820) $('settings').open = false;        // phone: the book first, settings on demand
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // own scope: keeps the home app's SW out
}
let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 400); };

// ----- [2] FONTS: bundled / web fonts, installed fonts by name, or font files added once and kept in the app -----
const cssLoaded = new Set();
const cleanName = (n) => String(n || '').replace(/["'\\<>;{}]/g, '').trim(); // goes into CSS and Word XML
const fontInfo = (name) => FONTS.find((f) => f.name === name);
function fillFonts() {
  const saved = Object.keys(fonts).map((n) => ({ name: n, label: '📁 ' + n }));
  $('font').innerHTML = [...saved, ...FONTS].map((f) => `<option value="${esc(f.name)}">${esc(f.label)}</option>`).join('');
  $('font').value = st.s.font;
}
async function loadSaved(name) {           // added fonts load only when used (they can be large)
  if (!fonts[name] || [...document.fonts].some((f) => f.family === name)) return;
  document.fonts.add(await new FontFace(name, `url(${fonts[name]})`).load());
}
async function useFont(s) {
  const f = fontInfo(s.font);
  s.fontFamily = s.font === 'custom' ? cleanName(s.fontName) : s.font;
  if (!s.fontFamily) throw new Error('יש להזין שם פונט או להוסיף קובץ פונט');
  await loadSaved(s.fontFamily).catch(() => {});
  if (f?.css && !cssLoaded.has(f.css)) {
    const ok = await new Promise((r) => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: f.css, onload: () => r(true), onerror: () => r(false) })));
    if (ok) cssLoaded.add(f.css);
  }
  await document.fonts.load(`${s.bodyPt}pt "${s.fontFamily}"`, 'אבג').catch(() => {});
  const found = available(s.fontFamily);
  $('fontWarn').hidden = found;
  $('fontWarn').textContent = found ? '' : `הפונט "${s.fontFamily}" לא נמצא — מוצג פונט חלופי. הוסיפו את קובץ הפונט (📁) או בחרו פונט אחר.`;
}
function available(name) {   // a missing font measures exactly like the fallback
  const c = document.createElement('canvas').getContext('2d'), t = 'אבגדהשת abc';
  return ['serif', 'monospace'].some((fb) => { c.font = `40px ${fb}`; const a = c.measureText(t).width; c.font = `40px "${name}", ${fb}`; return c.measureText(t).width !== a; });
}
let fontFile = null;
$('fontFile').addEventListener('change', (e) => {
  fontFile = e.target.files[0]; e.target.value = ''; if (!fontFile) return;
  $('fnName').value = fontFile.name.replace(/\.\w+$/, '');
  $('fn').returnValue = ''; $('fn').showModal();
});
$('fn').addEventListener('close', async () => {
  const name = cleanName($('fnName').value);
  if ($('fn').returnValue !== 'ok' || !name || !fontFile) return;
  if (FONTS.some((f) => f.name === name)) return say('השם תפוס — בחרו שם אחר', true);
  try {
    const url = await new Promise((r, j) => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = j; f.readAsDataURL(fontFile); });
    document.fonts.add(await new FontFace(name, `url(${url})`).load());
    fonts[name] = url; delete fontCache[name];
    const kept = save('book.fonts', fonts);
    if (!kept) delete fonts[name];
    st.s.font = name; persist(); fillFonts(); syncVisibility();
    say(kept ? `הפונט "${name}" נשמר באפליקציה` : `הפונט "${name}" נטען רק לעכשיו (אין מקום לשמור אותו)`, !kept);
    if (st.L) schedule();
  } catch { say('קובץ הפונט לא נטען', true); }
});

// ----- [3] FILE → original pane (tap a paragraph there to edit it too) -----
function renderOrig() {
  const { paras, info, bodySz } = st.doc;
  const words = paras.reduce((n, p) => n + p.runs.reduce((m, r) => m + (r.t.match(/\S+/g)?.length || 0), 0), 0);
  const lost = [info.notes && `${info.notes} הערות שוליים`, info.lists && `${info.lists} פסקאות ממוספרות (המספור לא נשמר)`, info.boxes && 'תיבות טקסט']
    .filter(Boolean).join(', ');
  $('origInfo').textContent = `${paras.length} פסקאות · ${words} מילים · גודל עיקרי ${bodySz}pt${lost ? ' · ⚠ לא מועבר: ' + lost : ''}`;
  $('orig').innerHTML = paras.map((p, i) => p.empty ? `<p data-s="${i}">&nbsp;</p>`
    : `<p data-s="${i}" class="${p.h ? 'h' : ''}" style="${p.center ? 'text-align:center' : ''}">${p.runs.map((r) =>
      `<span style="font-size:${r.sz}pt${r.b ? ';font-weight:700' : ''}">${esc(r.t).replace(/\n/g, '<br>')}</span>`).join('')}</p>`).join('');
}
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  st.busy++;                                               // a layout still running belongs to the old file
  say('קורא…');
  try {
    const doc = await readFile(file);
    if (!doc.paras.some((p) => !p.empty)) throw new Error('הקובץ ריק — אין בו טקסט');
    Object.assign(st, { doc, name: file.name.replace(/\.\w+$/, ''), blanks: {}, over: OVER(), L: null, pages: [], undo: null });
    $('exName').value = st.name; $('undo').hidden = true;
    renderOrig();
    $('result').innerHTML = '<p class="hint">לחצו "בצע".</p>';
    $('run').disabled = false; $('save').disabled = true;
    say(`נטען: ${file.name}`);
  } catch (err) { say(err.message || 'שגיאה בקריאת הקובץ', true); $('run').disabled = !st.doc; }
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
    if (g.foot && s.mb < g.ftBot + g.hlineMm + 1) throw new Error(`למספר בתחתית הדף צריך שוליים תחתונים של ${Math.ceil(g.ftBot + g.hlineMm + 1)} מ״מ לפחות`);
    const paras = prepare(doc, s, g);
    const content = await paginate(paras, s, g, $('measure'), (n) => id === st.busy && (say(`מעמד… ${n} עמודים`), true));
    if (!content || id !== st.busy) return;
    if (st.L) {
      for (const k of 'rclh') st.over[k] = remap(st.over[k], content, paras);
      st.blanks = remap(st.blanks, content, paras, true);
    }
    st.L = { s: { ...s, ...pickHeader(st.s) }, g, paras, content }; // header edits made during the run still count
    draw();
    say('');
  } catch (err) { if (id === st.busy) say(err.message || 'שגיאה בעימוד', true); console.error(err); }
  finally { if (id === st.busy) $('run').disabled = false; }
}
const render = (pg) => pageHTML(pg, st.L.paras, true);
// Letter stretching runs per page as it scrolls near the screen (800 pages at once would freeze a phone).
// One observer per container, dropped when the container is redrawn or closed.
function lazyStretch(root, L = st.L) {
  if (!('IntersectionObserver' in window) || !L?.s.stretch) return;
  root._io ??= new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { root._io.unobserve(e.target); stretchPage(e.target); }
  }, { rootMargin: '800px' });
  for (const p of root.querySelectorAll('.page:not([data-st])')) root._io.observe(p);
}
const unwatch = (root) => { root._io?.disconnect(); root._io = null; };
const prepFor = (L, vars) => (L.s.stretch ? (html) => stretchHTML(html, vars, $('measure')) : undefined);
async function printable(u, L, vars) {           // print needs every unit stretched first: do it in slices, with progress
  if (!L.s.stretch) return u.units;
  const out = [];
  for (const [i, h] of u.units.entries()) {
    out.push(stretchHTML(h, vars, $('measure')));
    if (i % 8 === 7) { say(`מכין להדפסה… ${i + 1}/${u.units.length}`); await new Promise((r) => setTimeout(r, 0)); }
  }
  say('');
  return out;
}
let zoomTouched = false;
function draw() {
  const { s, g, paras, content } = st.L;
  st.pages = compose(content, paras, s, g, st.blanks, st.over);
  const r = $('result');
  if (!zoomTouched) $('zoom').value = Math.max(0.25, Math.min(1.2, (r.clientWidth - 70) / (g.pw * 3.7795))).toFixed(2); // fit width
  r.style.cssText = pageVars(s, g) + `;--z:${$('zoom').value}`;
  unwatch(r);
  r.innerHTML = st.pages.map(render).join('');
  lazyStretch(r);
  const blanks = st.pages.filter((p) => p.blank).length;
  $('resInfo').textContent = `${st.pages.length} עמודים${blanks ? ` (${blanks} ריקים)` : ''} · ${s.size}`;
  $('save').disabled = false;
  tab(1);
}
const headKey = (p) => `${p.r}|${p.c}|${p.l}|${p.cols}|${p.foot}`;
function drawHeads() {         // header-only edits: patch headers/footers, keep the page bodies
  const { s, g, paras, content } = st.L, old = new Map(st.pages.map((p) => [p.id, headKey(p)]));
  st.pages = compose(content, paras, s, g, st.blanks, st.over);
  for (const pg of st.pages) if (old.get(pg.id) !== headKey(pg)) {
    const el = $('result').querySelector(`.page[data-id="${CSS.escape(pg.id)}"]`);
    if (el) el.closest('.pw').outerHTML = render(pg);
  }
  lazyStretch($('result'));
}
$('run').addEventListener('click', run);
$('zoom').addEventListener('input', (e) => { zoomTouched = true; $('result').style.setProperty('--z', e.target.value); });
function tab(i) {               // phone: one pane at a time
  $('panes').dataset.tab = i;
  for (const b of $('tabs').children) b.classList.toggle('on', +b.dataset.tab === i);
}
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) tab(+e.target.dataset.tab); });
tab(0);

// ----- [5] TAP ROUTING: text → paragraph editor; ⋯ chip or margins → page editor -----
$('result').addEventListener('click', (e) => {
  if (e.target.dataset.chip) return openPage(e.target.dataset.chip);
  const page = e.target.closest('.page'); if (!page) return;
  const p = e.target.closest('[data-s]');
  if (p) return openPara(+p.dataset.s, page.dataset.id);
  openPage(page.dataset.id);
});
$('orig').addEventListener('click', (e) => { const p = e.target.closest('[data-s]'); if (p) openPara(+p.dataset.s, null); });

// ----- [6] PAGE EDITOR: right / center / left header, hide, scope, blank pages, copy previous -----
let edId = null;
const ed = $('ed'), btn = (a) => ed.querySelector(`[data-a="${a}"]`), page = () => st.pages.find((p) => p.id === edId);
const sideIsNumber = () => st.L.s.numPos === 'to' || st.L.s.numPos === 'tl';
function openPage(id) {
  const pg = st.pages.find((p) => p.id === id); if (!pg) return;
  edId = id;
  $('edN').textContent = pg.n + (pg.blank ? ' (ריק)' : '');
  for (const k of 'RCL') { $('ed' + k).value = pg.raw[k.toLowerCase()]; $('ed' + k).disabled = !!pg.blank; }
  $('edHide').checked = !!st.over.h[id]; $('edHide').disabled = !!pg.blank;
  $('edLBox').hidden = sideIsNumber(); $('edScope').value = 'one';
  btn('unblank').disabled = !pg.blank || !!pg.pad;
  btn('blank').disabled = btn('auto').disabled = btn('prev').disabled = !!pg.blank;
  ed.returnValue = '';
  ed.showModal();
}
ed.addEventListener('click', (e) => {
  const a = e.target.dataset?.a, pg = page(); if (!a || !pg) return;
  if (a === 'prev') {
    const prev = st.pages.slice(0, st.pages.indexOf(pg)).reverse().find((p) => !p.blank);
    if (prev) for (const k of 'rcl') $('ed' + k.toUpperCase()).value = prev.raw[k];
    return;
  }
  ed.close(a);                                             // returnValue = action, so the close handler won't save
  if (a === 'auto') { for (const k of 'rclh') delete st.over[k][pg.id]; return drawHeads(); }
  const cid = a === 'blank' ? pg.id : pg.id.slice(1, pg.id.lastIndexOf('#'));
  st.blanks[cid] = Math.max(0, (st.blanks[cid] || 0) + (a === 'blank' ? 1 : -1));
  draw();
});
for (const k of 'RCL') $('ed' + k).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.close('ok'); } });
ed.addEventListener('close', () => {
  const pg = page();
  if (ed.returnValue !== 'ok' || !pg || pg.blank) return;
  const scope = $('edScope').value, after = st.pages.slice(st.pages.indexOf(pg) + 1).filter((p) => !p.blank);
  const targets = [pg, ...(scope === 'all' ? after : scope === 'section' ? after.slice(0, after.findIndex((p) => p.auto !== pg.auto) >>> 0) : [])];
  for (const k of 'rcl') {
    const v = $('ed' + k.toUpperCase()).value.trim();
    if (v === pg.raw[k] || (k === 'l' && sideIsNumber())) continue; // only slots the user changed
    for (const p of targets) st.over[k][p.id] = v;
  }
  for (const p of targets) if ($('edHide').checked) st.over.h[p.id] = 1; else delete st.over.h[p.id];
  drawHeads();
});

// ----- [7] PARAGRAPH EDITOR: text, type, size, bold, center, new page, merge, delete. One-step undo (text + page edits). -----
let peIdx = -1, pePage = null, peInit = null;
const pe = $('pe'), plain = (p) => p.runs.map((r) => r.t).join('');
function openPara(i, pageId) {
  const p = st.doc.paras[i]; if (!p) return;
  peIdx = i; pePage = pageId;
  peInit = { type: String(Math.min(3, p.h)), bold: p.runs.length > 0 && p.runs.every((r) => r.b) };
  $('peText').value = plain(p);
  $('peType').value = peInit.type; $('peSize').value = '';
  $('peBold').checked = peInit.bold; $('peCenter').checked = p.center; $('peBrk').checked = p.brk;
  pe.querySelector('[data-a="page"]').disabled = !pageId;
  pe.querySelector('[data-a="merge"]').disabled = i >= st.doc.paras.length - 1;
  pe.returnValue = '';
  pe.showModal();
}
// Page-edit keys are "src.from" (b-prefix + "#k" for blanks). Deleting paragraph i shifts later sources down by one;
// merging i+1 into i moves "i+1.f" to "i.(len_i + f)" — its words now follow paragraph i's tokens.
const shift = (obj, i, mergeLen) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const m = k.match(/^(b?)(\d+)\.(\d+)(.*)$/);
    if (!m || +m[2] <= i) { out[k] ??= v; continue; }
    const key = +m[2] === i + 1 && mergeLen != null ? `${m[1]}${i}.${mergeLen + +m[3]}${m[4]}` : `${m[1]}${+m[2] - 1}.${m[3]}${m[4]}`;
    out[key] ??= v;
  }
  return out;
};
function edit(fn, removed, merged) {
  st.undo = { paras: structuredClone(st.doc.paras), over: structuredClone(st.over), blanks: { ...st.blanks } };
  const len = merged ? st.L?.paras.find((p) => p.src === removed)?.tok.length ?? 0 : null;
  fn(st.doc.paras);
  if (removed != null) { for (const k of 'rclh') st.over[k] = shift(st.over[k], removed, len); st.blanks = shift(st.blanks, removed, len); }
  for (const p of st.doc.paras) p.empty = !plain(p).trim();
  $('undo').hidden = false;
  renderOrig();
  if (st.L) run();
}
pe.addEventListener('click', (e) => {
  const a = e.target.dataset?.a; if (!a) return;
  pe.close(a);
  if (a === 'page') return openPage(pePage);
  if (a === 'del') return edit((ps) => ps.splice(peIdx, 1), peIdx);
  edit((ps) => {                                           // merge with next
    const [p, n] = [ps[peIdx], ps[peIdx + 1]], base = p.runs.at(-1) || n.runs[0] || { sz: st.doc.bodySz, b: false };
    p.runs.push({ ...base, t: ' ' }, ...n.runs); ps.splice(peIdx + 1, 1);
  }, peIdx, true);
});
pe.addEventListener('close', () => {
  if (pe.returnValue !== 'ok') return;
  edit((ps) => {
    const p = ps[peIdx], text = $('peText').value, size = +$('peSize').value, bold = $('peBold').checked;
    if (text !== plain(p)) p.runs = [{ t: text, sz: p.runs[0]?.sz ?? st.doc.bodySz, b: !!p.runs[0]?.b }];
    if (size) for (const r of p.runs) r.sz = Math.round(st.doc.bodySz * size * 2) / 2;
    if (bold !== peInit.bold) for (const r of p.runs) r.b = bold;
    if ($('peType').value !== peInit.type) p.h = +$('peType').value;
    Object.assign(p, { center: $('peCenter').checked, brk: $('peBrk').checked });
  });
});
$('undo').addEventListener('click', () => {
  if (!st.undo) return;
  Object.assign(st, { over: st.undo.over, blanks: st.undo.blanks }); st.doc.paras = st.undo.paras;
  st.undo = null; $('undo').hidden = true;
  renderOrig(); if (st.L) run();
});

// ----- [8] SAVE: split plan → Word / PDF files (zip when several), preview per part -----
const SPEC = { every: 'עמודים בכל קובץ', parts: 'מספר קבצים', ranges: 'טווחים, לדוגמה: 1-48, 49-96' };
function plan() {
  const mode = $('exMode').value, imp = st.s.imp, unit = imp === 'sig' ? st.s.sig : 4;
  $('exSpecBox').hidden = mode === 'one'; $('exSpecLbl').textContent = SPEC[mode] || '';
  $('exErr').textContent = ''; $('exList').innerHTML = '';
  if (!st.pages.length) return null;
  try {
    const parts = splitPlan(st.pages.length, mode, $('exSpec').value);
    // A bound book cut into files: every file must start on a right-hand (odd) page and hold whole booklets/signatures.
    if (imp !== 'none' && parts.length > 1) parts.forEach(([a, b], i) => {
      if (a % 2 === 0 || (i < parts.length - 1 && (b - a + 1) % unit))
        throw new Error(`לחוברות: כל קובץ צריך להתחיל בעמוד אי-זוגי ולהכיל כפולה של ${unit} עמודים (קובץ ${i + 1}: ${a}–${b})`);
    });
    if (imp === 'book' && parts.some(([a, b]) => b - a + 1 > 64)) $('exErr').textContent = '⚠ חוברת אחת של יותר מ-64 עמודים לא תתקפל יפה — עדיף קונטרסים.';
    $('exList').innerHTML = parts.map(([a, b], i) => `<li>עמודים ${a}–${b}${a % 2 ? '' : ' <span class="warn">⚠ מתחיל בעמוד זוגי</span>'}` +
      `<button type="button" data-view="${i}">👁 תצוגת הדפסה</button></li>`).join('');
    return parts;
  } catch (err) { $('exErr').textContent = err.message; return null; }
}
$('save').addEventListener('click', () => {
  const f = fontInfo(st.L.s.font);
  $('exFontWarn').innerHTML = f?.url ? `ל-Word: הפונט "${esc(f.name)}" צריך להיות מותקן במחשב — <a href="${f.url}" target="_blank" rel="noopener">להורדה חינם</a>. ב-PDF ובהדפסה הוא תקין.` : '';
  plan(); $('ex').showModal();
});
$('exMode').addEventListener('change', plan);
$('exSpec').addEventListener('input', plan);
$('exList').addEventListener('click', (e) => {
  const i = e.target.dataset.view; if (i == null) return;
  const part = plan()?.[+i]; if (!part) return;
  $('ex').close(); openPreview(...part);
});
const baseName = () => ($('exName').value.trim() || st.name).replace(/[\\/:*?"<>|]/g, '_');
const outOpts = () => ({ imp: st.s.imp, sig: st.s.sig, dpi: st.s.dpi });
async function saveAll(kind) {
  const parts = plan(); if (!parts) return;
  const pages = st.pages, L = st.L, o = outOpts(), base = baseName(); // snapshot: nothing can change mid-export
  for (const b of ['exWord', 'exPdf']) $(b).disabled = true;
  try {
    const files = [];
    for (const [k, [a, b]] of parts.entries()) {
      const name = parts.length > 1 ? `${base} ${String(k + 1).padStart(2, '0')} (${a}-${b}).${kind}` : `${base}.${kind}`;
      say(`יוצר קובץ ${k + 1}/${parts.length}…`);
      const slice = pages.slice(a - 1, b);
      files.push([name, kind === 'docx' ? await buildDocx(slice, L.paras, L.s, L.g)
        : await pdf(units(slice, o.imp, o.sig, (pg) => pageHTML(pg, L.paras), L.g), L, o.dpi, k, parts.length)]);
    }
    if (files.length === 1) download(files[0][1], files[0][0]);
    else { const z = new JSZip(); for (const [n, f] of files) z.file(n, f); download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), `${base}.zip`); }
    say(`נשמרו ${files.length} קבצים`);
  } catch (err) { say('שגיאה בשמירה: ' + err.message, true); console.error(err); }
  finally { for (const b of ['exWord', 'exPdf']) $(b).disabled = false; }
}
$('exWord').addEventListener('click', () => saveAll('docx'));
$('exPdf').addEventListener('click', () => saveAll('pdf'));

// ----- [9] PRINT PREVIEW + PDF: the preview's own snapshot feeds screen, printer and PDF alike -----
const fontCache = {};
async function pdf(u, L, dpi, k = 0, of = 1) {
  const fam = L.s.fontFamily;
  if (!fontCache[fam]) {                                   // a failure is never cached; a missing font must not pass silently
    try { fontCache[fam] = await fontCss(fam, fontInfo(fam)?.css, fonts[fam]); }
    catch { throw new Error(`לא הצלחתי להטמיע את הפונט "${fam}" ב-PDF (אין אינטרנט?) — נסו שוב, או השתמשו בהדפסה ← שמירה כ-PDF`); }
  }
  const vars = pageVars(L.s, L.g);
  return makePdf(u, vars, dpi, fontCache[fam], (i, n) => say(`PDF ${of > 1 ? `${k + 1}/${of} · ` : ''}עמוד ${i}/${n}…`), prepFor(L, vars));
}
let pv = null;
function openPreview(a, b) {
  const L = st.L, o = outOpts(), u = units(st.pages.slice(a - 1, b), o.imp, o.sig, (pg) => pageHTML(pg, L.paras), L.g);
  showPreview({ name: `${baseName()} (${a}-${b})`, u, L },
    `עמודים ${a}–${b} · ${o.imp === 'none' ? `${u.units.length} עמודים` : `${u.units.length / 2} גיליונות דו-צדדיים`}`);
}
function showPreview(p, info) {
  unwatch($('pvBook'));
  pv = { ...p, vars: pageVars(p.L.s, p.L.g) };
  const z = Math.min(1, (innerWidth - 32) / (p.u.w * 3.7795));
  $('pvBook').style.cssText = pv.vars + `;--z:${z.toFixed(3)}`;
  $('pvBook').innerHTML = p.u.units.join('');
  if (!p.test) lazyStretch($('pvBook'), p.L);
  $('pvInfo').textContent = info;
  $('pv').hidden = false;
}
$('exTest').addEventListener('click', () => {
  $('ex').close();
  showPreview({ name: 'דף בדיקה', u: testUnits(st.s.imp, st.L.g), L: st.L, test: true }, 'דף בדיקה — להדפיס דו-צדדי ולהשוות לפני הדפסת הספר');
});
$('pvClose').addEventListener('click', () => { unwatch($('pvBook')); $('pv').hidden = true; $('pvBook').textContent = ''; pv = null; });
$('pvPrint').addEventListener('click', async () => {
  const p = pv, html = p.test ? p.u.units : await printable(p.u, p.L, p.vars);
  printPages(html.join(''), p.vars, p.u.w, p.u.h);
});
$('pvPdf').addEventListener('click', async () => {
  const p = pv; $('pvPdf').disabled = true;
  try { download(await pdf(p.u, p.test ? { ...p.L, s: { ...p.L.s, stretch: false } } : p.L, st.s.dpi), `${p.name}.pdf`); say('PDF נשמר'); }
  catch (err) { say('שגיאה ב-PDF: ' + err.message, true); console.error(err); }
  finally { $('pvPdf').disabled = false; }
});

initForm();
