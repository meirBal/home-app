// ===== LAYOUT — book pagination. Screen, measurer and Word export share geom() + fragHTML(), so they agree. =====
import { SIZES } from './config.js';
import { tokenize, stripMarks, esc, pageLabel } from './text.js';

const q05 = (pt) => Math.round(pt * 20) / 20;            // Word stores line heights in twips (0.05pt)

// Everything derived from settings (mm / pt). Exact line heights → same line count on screen and in Word.
export function geom(s, bodySz) {
  const [pw, ph] = SIZES[s.size], hpt = Math.round(s.bodyPt * 1.6) / 2, cw = pw - s.mi - s.mo, hline = q05(hpt * 1.3);
  return {
    pw, ph, hpt, cw, hline, scale: s.bodyPt / bodySz, foot: /^b/.test(s.numPos),
    line: (pt) => q05(pt * s.lineRatio), half: q05(s.bodyPt * s.lineRatio / 2),
    hdTop: +Math.max(3, s.mt - hline * 0.3528 - 2).toFixed(1),            // header top edge, mm
    ftBot: 8, hlineMm: hline * 0.3528,                                    // footer (bottom page number): bottom edge, mm — clear of printer dead zone
    fit: (pct) => Math.max(4, Math.floor(cw * 2.835 * pct / 100 / (hpt * 0.55))), // chars that fit pct% of the line
  };
}

// Paragraph prep: final-size tokens; line height from the largest run; Word page/section breaks survive dropped empties.
// Options: firstWord = enlarged opening word (class fw: never stretched) after a
// chapter heading (line height ignores it, so lines stay even) · divider = ornament paragraph before each chapter.
export function prepare(doc, s, g) {
  const out = [];
  let brk = false, opening = false;
  for (const [src, p] of doc.paras.entries()) {
    brk ||= s.breaks && p.brk;
    if (p.empty && !s.empties) continue;
    const chapter = p.h && p.h <= s.headLvl;
    if (chapter && s.divider && out.some((q) => !q.h && !q.empty) && !brk) {
      const tok = [{ t: s.divider, sz: s.bodyPt, b: false }];
      out.push({ src, tok, h: 0, center: true, brk: false, empty: false, lh: g.line(s.bodyPt * 1.5), orn: true, text: '' });
    }
    const tok = p.empty ? [] : tokenize(p.runs, s.marks, g.scale);
    let max = tok.reduce((m, t) => Math.max(m, t.sz), 0) || s.bodyPt;
    if (s.firstWord && opening && !p.h && !p.center && tok.length) {
      tok[0] = { ...tok[0], sz: Math.round(tok[0].sz * 2.7) / 2, b: true, fw: true };
      max = tok.slice(1).reduce((m, t) => Math.max(m, t.sz), tok[0].sz / 1.35);
    }
    if (p.h) opening = chapter || opening; else if (!p.empty && !p.center) opening = false; // centered subtitles keep waiting
    out.push({ src, tok, h: p.h, center: p.center, brk, empty: !tok.length, lh: g.line(max),
      text: p.h ? stripMarks(p.runs.map((r) => r.t).join(''), s.marks).replace(/\s+/g, ' ').trim() : '' });
    brk = false;
  }
  return out;
}

// One fragment [from,to) of a paragraph. data-s = source paragraph (tap to edit). cont = continues on the next page
// → its last line is justified too (screen/print/PDF; Word keeps it ragged, it has no safe equivalent).
export function fragHTML(p, from, to, cont) {
  if (p.empty) return `<p class="gap" data-s="${p.src}"></p>`;
  let h = '', cur = null, buf = '';
  const flush = () => {
    if (buf) { const c = [cur.b && 'b', cur.fw && 'fw'].filter(Boolean).join(' '); h += `<span${c ? ` class="${c}"` : ''} style="font-size:${cur.sz}pt">${esc(buf)}</span>`; }
    buf = '';
  };
  for (let i = from; i < to; i++) {
    const t = p.tok[i];
    if (t.br) { flush(); h += '<br>'; continue; }
    if (!cur || cur.sz !== t.sz || cur.b !== t.b || cur.fw !== t.fw) { flush(); cur = t; }
    buf += t.t;
  }
  flush();
  return `<p class="f${p.center ? ' c' : ''}${p.h ? ' h' : ''}${cont ? ' k' : ''}${p.orn ? ' orn' : ''}"${p.orn ? '' : ` data-s="${p.src}"`} style="line-height:${p.lh}pt">${h}</p>`;
}

// CSS variables for page boxes. Apply ONLY via element.style.cssText (font name is user text).
export function pageVars(s, g) {
  return `--pw:${g.pw}mm;--ph:${g.ph}mm;--mt:${s.mt}mm;--mb:${s.mb}mm;--mi:${s.mi}mm;--mo:${s.mo}mm;--gap:${s.gapPt}pt;` +
    `--half:${g.half}pt;--hpt:${g.hpt}pt;--hline:${g.hline}pt;--hdtop:${g.hdTop}mm;--ftbot:${g.ftBot}mm;--rule:${s.rule ? 0.5 : 0}pt;--font:"${s.fontFamily}",serif`;
}

const ABORT = Symbol('abort');
const tick = () => new Promise((r) => setTimeout(r, 0)); // not rAF: it stalls in background tabs

// Greedy fill; paragraph splits found by bounded binary search. Returns content pages [[{pi, from, to, cont}]] or null if aborted.
export async function paginate(paras, s, g, host, onProgress) {
  const box = Object.assign(document.createElement('div'), { className: 'book measure' }); // own box: concurrent runs never collide
  box.style.cssText = pageVars(s, g);
  box.innerHTML = '<div class="page"><div class="body"></div></div>';
  host.append(box);
  try { return await fill(paras, s, box.querySelector('.body'), onProgress); }
  catch (e) { if (e === ABORT) return null; throw e; }
  finally { box.remove(); }
}

async function fill(paras, s, body, onProgress) {
  const top = body.getBoundingClientRect().top, H = body.getBoundingClientRect().height + 0.25; // sub-pixel exact
  const add = (p, a, b) => { body.insertAdjacentHTML('beforeend', fragHTML(p, a, b)); return body.lastElementChild; };
  const lines = (p, a, b) => { const e = add(p, a, b), n = Math.round(e.getBoundingClientRect().height / (p.lh * 4 / 3)); e.remove(); return n; };
  const fits = (el) => el.getBoundingClientRect().bottom - top <= H;
  const pages = [];
  let cur = [], est = 400, t0 = performance.now();          // est = tokens of one full page, refined as we go
  const flush = async (carryHeads) => {
    const carry = [];                                        // a heading never ends a page: move it to the next
    while (carryHeads && cur.length > 1 && (paras[cur.at(-1).pi].h || paras[cur.at(-1).pi].orn) && !cur.at(-1).cont) carry.unshift(cur.pop());
    while (carry.length && paras[carry[0].pi].orn) carry.shift();   // a divider never opens a page
    while (cur.length && paras[cur.at(-1).pi].empty) cur.pop(); // no trailing gaps
    if (cur.length) pages.push(cur);
    cur = []; body.textContent = '';
    for (const c of carry) { add(paras[c.pi], c.from, c.to); cur.push(c); }
    if (performance.now() - t0 > 40) { if (onProgress?.(pages.length) === false) throw ABORT; await tick(); t0 = performance.now(); }
  };
  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi], n = p.tok.length;
    if (p.brk && cur.length) await flush(false);
    if (p.orn && !cur.length) continue;                      // nor here
    if (p.empty) { if (cur.length) { const el = add(p, 0, 0); if (fits(el)) cur.push({ pi, from: 0, to: 0 }); else { el.remove(); await flush(true); } } continue; }
    for (let from = 0; from < n;) {
      const tryK = (k) => { const e = add(p, from, k), ok = fits(e); e.remove(); return ok; };
      let best = from;
      if (n - from <= est * 2 && tryK(n)) best = n;          // common case: the rest fits (headings too)
      else if (!p.h || !cur.length) {                        // split — but a heading only on an empty page
        let lo = from + 1, hi = Math.min(n, from + est * 2);
        while (hi < n && tryK(hi)) { best = hi; lo = hi + 1; hi = Math.min(n, from + (hi - from) * 2); } // probe up
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (tryK(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      }
      if (s.widows && best > from && best < n && !p.h) {    // no single line left alone at a page bottom or top
        const here = lines(p, from, best), rest = n - best > 64 ? 2 : lines(p, best, n);
        const solid = cur.some((c) => !paras[c.pi].h);      // only carried headings above → moving on would loop forever
        if (here < 2 && solid) best = from;
        else if (rest < 2 && here >= 3) {                    // give one line to the next page
          let lo = from + 1, hi = best - 1, k = from;
          while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines(p, from, mid) <= here - 1) { k = mid; lo = mid + 1; } else hi = mid - 1; }
          if (k > from) best = k;
        } else if (rest < 2 && solid) best = from;
      }
      if (best === from && !cur.length) best = from + 1;     // one giant word: place anyway (never loop)
      if (best > from) {
        if (best < n && !cur.length) est = Math.max(32, best - from);
        add(p, from, best); cur.push({ pi, from, to: best, cont: best < n });
      }
      if (best === n) break;
      from = best;
      await flush(true);
      if (p.orn && !cur.length) break;                       // a divider pushed to a new page is dropped
    }
  }
  await flush(false);
  return pages;
}

// ----- composition: blank pages, padding, headers, numbers. Page ids anchor to SOURCE text ("src.from"), so edits survive
// re-layout, dropped empty lines and paragraph edits. -----
const startOf = (items, paras) => `${paras[items[0].pi].src}.${items[0].from}`;
const cmp = (a, b) => { const [x, y] = a.split('.').map(Number), [u, v] = b.split('.').map(Number); return x - u || y - v; };

// Move keys (anchors of an older layout) to the page that now contains that text.
export function remap(obj, content, paras, sum) {   // sum: merge counts (blank pages) instead of last-wins
  const starts = content.map((it) => startOf(it, paras)), out = {};
  for (const [k, v] of Object.entries(obj)) {
    let lo = 0, hi = starts.length - 1, at = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cmp(starts[m], k) <= 0) { at = m; lo = m + 1; } else hi = m - 1; }
    if (starts.length) out[starts[at]] = sum ? (out[starts[at]] || 0) + v : v;
  }
  return out;
}

// Header = 3 physical slots right / center / left. Logical: running head (auto from Word headings), center text, side text.
// Page number: 'to' top outer (mirrored: left on odd/recto pages, right on even) · 'tl' top left · 'bo' bottom outer ·
// 'bc' / 'bl' / 'br' bottom · 'none'. Numbering starts at page s.numFrom. over.{r,c,l,h}[pageId] = per-page edits (h = hide all).
export function compose(content, paras, s, g, blanks, over) {
  const out = [], first = s.headMode === 'first';
  let head = '';
  for (const items of content) {
    const id = startOf(items, paras), heads = items.filter((it) => it.from === 0 && paras[it.pi].h && paras[it.pi].h <= s.headLvl);
    const lead = items.find((it) => !paras[it.pi].orn);
    const top = lead && lead.from === 0 && heads[0] === lead ? paras[lead.pi].text : head;  // section in effect at the page top
    if (heads.length) head = paras[heads.at(-1).pi].text;
    out.push({ id, items, auto: s.autoHead ? (first ? top : head) : '' });
    for (let k = 0; k < (blanks[id] || 0); k++) out.push({ id: `b${id}#${k}`, blank: true });
  }
  while (s.padTo > 1 && out.length % s.padTo) out.push({ id: 'p' + out.length, blank: true, pad: true });
  const cut = (t, w) => (t.length > g.fit(w) ? t.slice(0, g.fit(w) - 1) + '…' : t);
  out.forEach((pg, i) => {
    pg.n = i + 1;
    Object.assign(pg, { r: '', c: '', l: '', foot: '', num: '', raw: { r: '', c: '', l: '' } });
    if (pg.blank) return;
    const odd = pg.n % 2, numbered = pg.n >= s.numFrom && s.numPos !== 'none';
    pg.num = numbered ? pageLabel(pg.n - s.numFrom + 1, s.numFmt) : '';
    pg.raw = { r: over.r[pg.id] ?? pg.auto, c: over.c[pg.id] ?? s.midText, l: over.l[pg.id] ?? s.leftText };
    if (over.h[pg.id]) return void (pg.hidden = true);
    const topNum = s.numPos === 'to' || s.numPos === 'tl';
    let r = pg.raw.r, l = topNum ? pg.num : pg.raw.l;
    let wl = !l ? 0 : topNum ? 15 : 35;
    const c = pg.raw.c, wc = c ? 30 : 0;
    let wr = 100 - wc - wl;
    if (s.numPos === 'to' && !odd) [r, l, wr, wl] = [l, r, wl, wr];     // mirror: number always on the outer edge
    pg.cols = [wr, wc, wl];
    Object.assign(pg, { r: cut(r, wr), c: cut(c, wc), l: cut(l, wl) });
    if (/^b/.test(s.numPos)) {
      pg.foot = pg.num;
      pg.footAlign = s.numPos === 'bc' ? 'center' : s.numPos === 'bl' || (s.numPos === 'bo' && odd) ? 'left' : 'right';
    }
  });
  return out;
}

export const headHTML = (pg) => (pg.r || pg.c || pg.l
  ? `<span>${esc(pg.r)}</span><span class="m">${esc(pg.c)}</span><span class="l">${esc(pg.l)}</span>` : '');
// chip = on-screen "page settings" button (never printed: it sits outside the page box).
export function pageHTML(pg, paras, chip) {
  const body = pg.blank ? '' : pg.items.map((it) => fragHTML(paras[it.pi], it.from, it.to, it.cont)).join('');
  const cols = pg.cols ? ` style="grid-template-columns:${pg.cols.join('% ')}%"` : '';
  const ft = pg.foot ? `<div class="ft" style="text-align:${pg.footAlign}">${esc(pg.foot)}</div>` : '';
  return `<div class="pw">${chip ? `<button class="chip" data-chip="${pg.id}" aria-label="הגדרות עמוד ${pg.n}">⋯</button>` : ''}` +
    `<div class="page ${pg.n % 2 ? 'odd' : 'even'}${pg.blank ? ' blank' : ''}" data-id="${pg.id}">` +
    `<div class="hd"${cols}>${headHTML(pg)}</div><div class="body">${body}</div>${ft}</div></div>`;
}
