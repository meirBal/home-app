// ===== DOCX READ — .docx/.txt → { paras: [{runs:[{t,sz,b}], h, center, brk, empty}], bodySz } =====
// Resolves Word's style chain (defaults → paragraph style → char style → run) so every run carries its real size.
// Hebrew uses the complex-script props (szCs/bCs) — read those first.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kid = (el, n) => { for (let c = el?.firstElementChild; c; c = c.nextElementSibling) if (c.localName === n && c.namespaceURI === W) return c; return null; };
const val = (el) => el?.getAttributeNS(W, 'val') ?? el?.getAttribute('w:val') ?? null;
const on = (el) => !!el && !['0', 'false', 'off'].includes(val(el));
const undef = (o) => { for (const k in o) if (o[k] === undefined) delete o[k]; return o; };

function rProps(r) {
  if (!r) return {};
  const sz = val(kid(r, 'szCs')) ?? val(kid(r, 'sz'));
  const b = kid(r, 'bCs') || kid(r, 'b');
  return undef({ sz: sz ? sz / 2 : undefined, b: b ? on(b) : undefined });
}
function pProps(p) {
  if (!p) return {};
  const o = val(kid(p, 'outlineLvl'));
  return undef({ jc: val(kid(p, 'jc')) ?? undefined, outline: o != null && +o < 9 ? +o + 1 : undefined });
}

function parseStyles(doc) {
  const def = { sz: 11, b: false }, map = {};
  let defPara = null;
  if (doc) {
    Object.assign(def, rProps(kid(kid(kid(doc.documentElement, 'docDefaults'), 'rPrDefault'), 'rPr')));
    for (const s of doc.getElementsByTagNameNS(W, 'style')) {
      const id = s.getAttributeNS(W, 'styleId'), name = val(kid(s, 'name')) || '';
      if (s.getAttributeNS(W, 'type') === 'paragraph' && ['1', 'true'].includes(s.getAttributeNS(W, 'default'))) defPara = id;
      const head = name.match(/^heading\s*(\d)/i)?.[1] ?? (/^(title|כותרת)$/i.test(name) ? 1 : undefined);
      map[id] = { based: val(kid(s, 'basedOn')), ...rProps(kid(s, 'rPr')), ...pProps(kid(s, 'pPr')), ...undef({ outline: head && +head }) };
    }
  }
  const memo = {};
  const resolve = (id, seen = 0) => memo[id] ??= !map[id] || seen > 20 ? {} : { ...resolve(map[id].based, seen + 1), ...map[id], based: 0 };
  return { def, defPara, resolve };
}

// The paragraph a run belongs to; null = skip (mc:Fallback copies, moved-away text).
function ownerP(r) {
  for (let n = r.parentNode; n; n = n.parentNode) {
    if (n.localName === 'Fallback' || n.localName === 'moveFrom') return null;
    if (n.localName === 'p' && n.namespaceURI === W) return n;
  }
  return null;
}

// One Word paragraph → 1+ paragraphs (a page break inside it starts a new one). Returns brkAfter for section breaks.
function readPara(p, S, out, info) {
  const at = out.length, pPr = kid(p, 'pPr'), ps = S.resolve(val(kid(pPr, 'pStyle')) ?? S.defPara);
  const pr = { ...ps, ...pProps(pPr) }, pRun = { ...S.def, ...undef({ sz: ps.sz, b: ps.b }) }; // pPr/rPr styles only the ¶ mark
  if (kid(pPr, 'numPr')) info.lists++;
  const make = (brk) => ({ runs: [], h: pr.outline || 0, center: pr.jc === 'center', brk, empty: true });
  let cur = make(on(kid(pPr, 'pageBreakBefore')));
  const push = (t, a) => {
    const last = cur.runs.at(-1);
    if (last && last.sz === a.sz && last.b === !!a.b) last.t += t; else cur.runs.push({ t, sz: a.sz, b: !!a.b });
  };
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    if (ownerP(r) !== p) { if (ownerP(r)) info.boxes++; continue; }
    const rPr = kid(r, 'rPr'), cs = S.resolve(val(kid(rPr, 'rStyle')));
    if (on(kid(rPr, 'vanish'))) continue;                    // hidden text
    const a = { ...pRun, ...undef({ sz: cs.sz, b: cs.b }), ...rProps(rPr) };
    for (let c = r.firstElementChild; c; c = c.nextElementSibling) {
      const n = c.localName;
      if (n === 't') push(c.textContent, a);
      else if (n === 'tab') push(' ', a);
      else if (n === 'noBreakHyphen') push('-', a);
      else if (n === 'cr') push('\n', a);
      else if (n === 'footnoteReference' || n === 'endnoteReference') info.notes++;
      else if (n === 'br') {
        if (c.getAttributeNS(W, 'type') !== 'page') push('\n', a);
        else if (cur.runs.length) { out.push(cur); cur = make(true); } else cur.brk = true;
      }
    }
  }
  out.push(cur);
  for (const x of out.slice(at)) x.empty = !x.runs.some((r) => r.t.trim());
  const sp = kid(pPr, 'sectPr');                             // section break → next paragraph starts a page (not 'continuous')
  return !!sp && val(kid(sp, 'type')) !== 'continuous';
}

function walk(el, S, out, info) {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === 'p') {
      const at = out.length, brk = info.brkNext;
      info.brkNext = readPara(c, S, out, info);
      if (brk) out[at].brk = true;
    } else if (['tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'customXml', 'ins'].includes(c.localName)) walk(c, S, out, info);
  }
  return out;
}

// Most common size by character count among body (non-heading) text = "main text" size.
function bodySize(paras) {
  const n = {};
  for (const p of paras) if (!p.h) for (const r of p.runs) n[r.sz] = (n[r.sz] || 0) + r.t.length;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : 11;
}

// info: counts of things not carried over (shown to the user): notes, lists, boxes.
export async function readFile(file) {
  const info = { notes: 0, lists: 0, boxes: 0 };
  if (/\.txt$/i.test(file.name)) {
    const paras = (await file.text()).split(/\r?\n/).map((t) => ({ runs: [{ t, sz: 12, b: false }], h: 0, center: false, brk: false, empty: !t.trim() }));
    return { paras, bodySz: 12, info };
  }
  if (!/\.(docx|docm|dotx)$/i.test(file.name)) throw new Error('יש לבחור קובץ ‎.docx‎ (קובץ ‎.doc‎ ישן — לשמור בוורד בשם כ־docx)');
  const zip = await JSZip.loadAsync(file);
  const xml = async (path) => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const doc = await xml('word/document.xml');
  const body = doc?.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('הקובץ אינו מסמך Word תקין');
  const paras = walk(body, parseStyles(await xml('word/styles.xml')), [], info);
  return { paras, bodySz: bodySize(paras), info };
}
