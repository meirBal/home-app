// ===== STRETCH — Stam-style justification: each full line ends flush by widening ONE word-final ם / ת / ה (as a sofer
// extends the roof/base), the rest of the slack goes between words. Runs after layout and never moves a line break, so
// pages, numbering and Word are unaffected (Word keeps ordinary justification). Never touches a Divine Name, the enlarged
// opening word, letters carrying niqqud, lines ending in a manual line break, or lines with a word split across lines.
// Only the extended part is scaled: the letter's two halves keep their stroke thickness, a thin middle slice is widened. =====
const FINAL = 'םתה', MAX = 1.8;                                          // a letter grows to at most 1.8× its width
const MARK = /[֑-ׇֽֿׁׂׅׄ]/;      // niqqud/te'amim (not maqaf, paseq, sof pasuq)
const NAME = /^[והבלמשכ]{0,3}(יהוה|יה|אל|אלה(ים|י|יך|ינו|יכם|יהם|יו|יה|יכן|יהן)?|אלוה(ים|י)?|אדני|שדי|צבאות|אהיה)$/;
const letters = (t) => t.replace(/[^א-ת]/g, '');

export function stretchPage(page) {
  if (page.dataset.st) return;
  page.dataset.st = '1';
  for (const p of page.querySelectorAll('.f:not(.c):not(.h):not(.orn)')) stretchPara(p);
}

// Wrap each word of the paragraph's text in <span class="w"> (only on pages actually shown/printed — not during layout).
function wrapWords(p) {
  const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [], out = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  for (const n of nodes) {
    const f = document.createDocumentFragment(), fw = n.parentElement.classList.contains('fw');
    for (const t of n.data.match(/[^ \t\r\n]+[ \t\r\n]*|[ \t\r\n]+/g) || []) {
      if (!t.trim()) { f.append(t); continue; }
      const w = Object.assign(document.createElement('span'), { className: fw ? 'w fw' : 'w', textContent: t });
      f.append(w); out.push(w);
    }
    n.replaceWith(f);
  }
  for (const br of p.querySelectorAll('br')) {               // a line ending in <br> is a "last line": leave it natural
    const prev = out.filter((w) => w.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    if (prev) prev.dataset.br = '1';
  }
  return out;
}

function stretchPara(p) {
  const ws = wrapWords(p);
  if (!ws.length) return;
  p.style.textAlign = p.style.textAlignLast = 'right';     // natural spacing; the slack is filled below
  // --- reads: group words into lines by line index (sizes differ, so offsetTop alone is not enough)
  const lh = parseFloat(getComputedStyle(p).lineHeight), mid = (w) => w.offsetTop + w.offsetHeight / 2, m0 = mid(ws[0]);
  const lines = [], broken = new Set();
  for (const w of ws) {
    const k = Math.round((mid(w) - m0) / lh);
    (lines[k] ??= { k, ws: [] }).ws.push(w);
    if (w.getClientRects().length > 1) broken.add(k).add(k + 1);
  }
  const list = lines.filter(Boolean), edge = p.offsetLeft, n = p.classList.contains('k') ? list.length : list.length - 1;
  const jobs = [];
  for (const line of list.slice(0, n)) {
    if (broken.has(line.k) || line.ws.at(-1).dataset.br) continue;
    const slack = Math.min(...line.ws.map((w) => w.offsetLeft)) - edge - 1.5;   // RTL: the gap is at the line's left end
    if (slack >= 2) jobs.push({ ...line, slack, top: mid(line.ws.at(-1)), pick: pickLetter(line.ws) });
  }
  // --- writes: isolate the chosen letters; one read for their widths; then widen
  for (const j of jobs) if (j.pick) j.box = isolate(j.pick);
  for (const j of jobs) if (j.box) j.gw = j.box.firstChild.offsetWidth;
  for (const j of jobs) {
    const add = j.box ? Math.min(j.slack, j.gw * (MAX - 1)) : 0;
    if (j.box) widen(j.box, j.gw, add);
    space(j.ws, j.slack - add);
  }
  // --- one check: if rounding pushed a word to the next line, fall back to spacing only
  for (const j of jobs) if (Math.abs(mid(j.ws.at(-1)) - j.top) > lh / 2) {
    if (j.box) { j.box.replaceWith(j.box.firstChild.textContent); }
    space(j.ws, j.slack * 0.98);
  }
}

// One word-final ם/ת/ה per line, searching from the end of the line; never a Divine Name or the opening word.
function pickLetter(ws) {
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i], node = w.firstChild;
    if (w.classList.contains('fw') || node?.nodeType !== 3 || NAME.test(letters(node.data))) continue;
    const t = node.data.replace(/[\s־׀׃.,:;!?'"״׳)\]]+$/, '');   // trailing space / punctuation / maqaf
    const at = t.length - 1;
    if (at >= 0 && FINAL.includes(t[at]) && !MARK.test(node.data[at + 1] || '')) return { node, i: at };
  }
  return null;
}

function isolate({ node, i }) {
  const mid = node.splitText(i), rest = mid.splitText(1), box = document.createElement('span');
  box.className = 'x';
  box.append(Object.assign(document.createElement('i'), { className: 'x0', textContent: mid.data })); // in-flow copy: baseline + width
  mid.remove(); rest.before(box);
  return box;
}

// Right half and left half of the glyph stay as drawn; a 10% middle slice is stretched across the gap.
function widen(box, gw, add) {
  const ch = box.firstChild.textContent, W = gw + add, part = (cls, css) => `<i class="xp ${cls}" style="${css}">${ch}</i>`;
  box.style.width = W + 'px';
  box.insertAdjacentHTML('beforeend', part('xr', 'right:0') + part('xl', 'left:0') +
    part('xm', `left:${(W - gw) / 2}px;transform:scaleX(${((add + 1) / (gw * 0.1)).toFixed(3)})`));
}

function space(ws, gap) {
  if (gap <= 0.5 || ws.length < 2) return;
  const each = gap / (ws.length - 1) + 'px';
  for (const w of ws.slice(0, -1)) w.style.marginLeft = each;
}

// Print/PDF: stretch one unit's HTML by laying it out in a hidden box (the book's fonts are already loaded here).
export function stretchHTML(html, vars, host) {
  const box = Object.assign(document.createElement('div'), { className: 'book measure', innerHTML: html });
  box.style.cssText = vars;
  host.append(box);
  try { box.querySelectorAll('.page').forEach(stretchPage); return box.innerHTML; } finally { box.remove(); }
}
