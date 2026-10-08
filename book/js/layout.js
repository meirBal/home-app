// ===== LAYOUT — book pagination. Screen, measurer and Word export share geom() + fragHTML(), so they agree. =====
import { SIZES } from './config.js';
import { tokenize, stripMarks, esc, pageLabel } from './text.js';

const q05 = (pt) => Math.round(pt * 20) / 20;            // Word stores line heights in twips (0.05pt)

// Everything derived from settings (mm / pt). Exact line heights → same line count on screen and in Word.
export function geom(s, bodySz) {
  const [pw, ph] = SIZES[s.size], hpt = Math.round(s.bodyPt * 1.6) / 2, cw = pw - s.mi - s.mo;
  return {
    pw, ph, hpt, scale: s.bodyPt / bodySz,
    line: (pt) => q05(pt * s.lineRatio), half: q05(s.bodyPt * s.lineRatio / 2), hline: q05(hpt * 1.3),
    hdTop: +Math.max(3, s.mt - hpt * 1.3 * 0.3528 - 2).toFixed(1),       // header top edge, mm
    headMax: Math.max(8, Math.floor(cw * 2.835 * 0.78 / (hpt * 0.55))),  // header chars that fit one line (title cell)
  };
}

// Paragraph prep: final-size tokens; line height from the largest run; Word page/section breaks survive dropped empties.
export function prepare(doc, s, g) {
  const out = [];
  let brk = false;
  for (const p of doc.paras) {
    brk ||= s.breaks && p.brk;
    if (p.empty && !s.empties) continue;
    const tok = p.empty ? [] : tokenize(p.runs, s.marks, g.scale);
    const max = tok.reduce((m, t) => Math.max(m, t.sz), 0) || s.bodyPt;
    out.push({ tok, h: p.h, center: p.center, brk, empty: !tok.length, lh: g.line(max),
      text: p.h ? stripMarks(p.runs.map((r) => r.t).join(''), s.marks).replace(/\s+/g, ' ').trim() : '' });
    brk = false;
  }
  return out;
}

// One fragment [from,to) of a paragraph.
export function fragHTML(p, from, to) {
  if (p.empty) return '<p class="gap"></p>';
  let h = '', cur = null, buf = '';
  const flush = () => { if (buf) h += `<span style="font-size:${cur.sz}pt"${cur.b ? ' class="b"' : ''}>${esc(buf)}</span>`; buf = ''; };
  for (let i = from; i < to; i++) {
    const t = p.tok[i];
    if (t.br) { flush(); h += '<br>'; continue; }
    if (!cur || cur.sz !== t.sz || cur.b !== t.b) { flush(); cur = t; }
    buf += t.t;
  }
  flush();
  return `<p class="f${p.center ? ' c' : ''}${p.h ? ' h' : ''}" style="line-height:${p.lh}pt">${h}</p>`;
}

// CSS variables for page boxes. Apply ONLY via element.style.cssText (font name is user text).
export function pageVars(s, g) {
  return `--pw:${g.pw}mm;--ph:${g.ph}mm;--mt:${s.mt}mm;--mb:${s.mb}mm;--mi:${s.mi}mm;--mo:${s.mo}mm;--gap:${s.gapPt}pt;` +
    `--half:${g.half}pt;--hpt:${g.hpt}pt;--hline:${g.hline}pt;--hdtop:${g.hdTop}mm;--rule:${s.rule ? 0.5 : 0}pt;--font:"${s.fontFamily}",serif`;
}

const ABORT = Symbol('abort');
const tick = () => new Promise((r) => setTimeout(r, 0)); // not rAF: it stalls in background tabs

// Greedy fill; paragraph splits found by bounded binary search. Returns content pages [[{pi, from, to, cont}]] or null if aborted.
export async function paginate(paras, s, g, host, onProgress) {
  const box = Object.assign(document.createElement('div'), { className: 'book measure' }); // own box: concurrent runs never collide
  box.style.cssText = pageVars(s, g);
  box.innerHTML = '<div class="page"><div class="body"></div></div>';
  host.append(box);
  try { return await fill(paras, box.querySelector('.body'), onProgress); }
  catch (e) { if (e === ABORT) return null; throw e; }
  finally { box.remove(); }
}

async function fill(paras, body, onProgress) {
  const top = body.getBoundingClientRect().top, H = body.getBoundingClientRect().height + 0.25; // sub-pixel exact
  const add = (p, a, b) => { body.insertAdjacentHTML('beforeend', fragHTML(p, a, b)); return body.lastElementChild; };
  const fits = (el) => el.getBoundingClientRect().bottom - top <= H;
  const pages = [];
  let cur = [], est = 400, t0 = performance.now();          // est = tokens of one full page, refined as we go
  const flush = async (carryHeads) => {
    const carry = [];                                        // a heading never ends a page: move it to the next
    while (carryHeads && cur.length > 1 && paras[cur.at(-1).pi].h && !cur.at(-1).cont) carry.unshift(cur.pop());
    while (cur.length && paras[cur.at(-1).pi].empty) cur.pop(); // no trailing gaps
    if (cur.length) pages.push(cur);
    cur = []; body.textContent = '';
    for (const c of carry) { add(paras[c.pi], c.from, c.to); cur.push(c); }
    if (performance.now() - t0 > 40) { if (onProgress?.(pages.length) === false) throw ABORT; await tick(); t0 = performance.now(); }
  };
  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi], n = p.tok.length;
    if (p.brk && cur.length) await flush(false);
    if (p.empty) { if (cur.length) { const el = add(p, 0, 0); if (fits(el)) cur.push({ pi, from: 0, to: 0 }); else { el.remove(); await flush(true); } } continue; }
    for (let from = 0; from < n;) {
      const tryK = (k) => { const e = add(p, from, k), ok = fits(e); e.remove(); return ok; };
      let best = from;
      if (!p.h || !cur.length) {                            // headings move whole unless the page is empty
        if (n - from <= est * 2 && tryK(n)) best = n;        // common case: the rest fits
        else {
          let lo = from + 1, hi = Math.min(n, from + est * 2);
          while (hi < n && tryK(hi)) { best = hi; lo = hi + 1; hi = Math.min(n, from + (hi - from) * 2); } // probe up
          while (lo <= hi) { const mid = (lo + hi) >> 1; if (tryK(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1; }
        }
      }
      if (best === from && !cur.length) best = from + 1;     // one giant word: place anyway (never loop)
      if (best > from) {
        if (best < n && !cur.length) est = Math.max(32, best - from);
        add(p, from, best); cur.push({ pi, from, to: best, cont: best < n });
      }
      if (best === n) break;
      from = best;
      await flush(true);
    }
  }
  await flush(false);
  return pages;
}

// ----- composition: blank pages, padding, headers, numbers. Page ids anchor to text ("pi.from"), so edits survive re-layout. -----
const startOf = (items) => `${items[0].pi}.${items[0].from}`;
const cmp = (a, b) => { const [x, y] = a.split('.').map(Number), [u, v] = b.split('.').map(Number); return x - u || y - v; };

// Move keys (anchors of an older layout) to the page that now contains that text.
export function remap(obj, content, sum) {   // sum: merge counts (blank pages) instead of last-wins
  const starts = content.map(startOf), out = {};
  for (const [k, v] of Object.entries(obj)) {
    let lo = 0, hi = starts.length - 1, at = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cmp(starts[m], k) <= 0) { at = m; lo = m + 1; } else hi = m - 1; }
    if (starts.length) out[starts[at]] = sum ? (out[starts[at]] || 0) + v : v;
  }
  return out;
}

export function compose(content, paras, s, g, blanks, overrides) {
  const out = [], cut = (t) => (t.length > g.headMax ? t.slice(0, g.headMax - 1) + '…' : t);
  let head = '';
  for (const items of content) {
    const id = startOf(items), first = items.find((it) => it.from === 0 && paras[it.pi].h && paras[it.pi].h <= s.headLvl);
    if (first) head = paras[first.pi].text;
    out.push({ id, items, auto: s.autoHead ? cut(head) : '' });
    for (let k = 0; k < (blanks[id] || 0); k++) out.push({ id: `b${id}#${k}`, blank: true });
  }
  while (s.padTo > 1 && out.length % s.padTo) out.push({ id: 'p' + out.length, blank: true, pad: true });
  out.forEach((pg, i) => {
    pg.n = i + 1;
    pg.head = pg.blank ? '' : cut(overrides[pg.id] ?? pg.auto);
    pg.num = pg.blank ? '' : pageLabel(pg.n, s.numFmt);
  });
  return out;
}

export const headHTML = (pg) => (pg.head || pg.num ? `<span>${esc(pg.head)}</span><span>${esc(pg.num)}</span>` : '');
export function pageHTML(pg, paras) {
  const body = pg.blank ? '' : pg.items.map((it) => fragHTML(paras[it.pi], it.from, it.to)).join('');
  return `<div class="pw"><div class="page ${pg.n % 2 ? 'odd' : 'even'}${pg.blank ? ' blank' : ''}" data-id="${pg.id}">` +
    `<div class="hd">${headHTML(pg)}</div><div class="body">${body}</div></div></div>`;
}
