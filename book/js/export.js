// ===== EXPORT — Word (.docx, one section per page = exact page breaks + per-page header/footer), download, browser print =====
import { esc as X } from './text.js';

const TW = 56.6929;                                     // twips per mm
const tw = (mm) => Math.round(mm * TW), hp = (pt) => Math.round(pt * 2), ln = (pt) => Math.round(pt * 20);
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// pPr children must follow OOXML schema order (spacing before jc).
// 'both' (not 'distribute': Word letter-spaces distributed lines). Screen does the same → last lines ragged in both.
function paraXml(p, from, to, s, g, sect) {
  const pPr = p.empty
    ? `<w:spacing w:before="0" w:after="0" w:line="${ln(g.half)}" w:lineRule="exact"/>`
    : `<w:widowControl w:val="0"/><w:spacing w:before="0" w:after="${ln(s.gapPt)}" w:line="${ln(p.lh)}" w:lineRule="exact"/><w:jc w:val="${p.center ? 'center' : 'both'}"/>`;
  let runs = '';
  for (let i = from; i < to; i++) {
    const t = p.tok[i];
    runs += t.br ? '<w:r><w:br/></w:r>'
      : `<w:r><w:rPr>${t.b ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${hp(t.sz)}"/><w:szCs w:val="${hp(t.sz)}"/></w:rPr><w:t xml:space="preserve">${X(t.t)}</w:t></w:r>`;
  }
  return `<w:p><w:pPr>${pPr}${sect || ''}</w:pPr>${runs}</w:p>`;
}

// Header: borderless table, cells right→left = right / center / left slot (zero-width slots omitted).
// Right cell RTL (starts right); center centered; left cell is an LTR paragraph aligned left — physical sides, no RTL guessing.
const run = (t, g) => (t ? `<w:r><w:rPr><w:sz w:val="${hp(g.hpt)}"/><w:szCs w:val="${hp(g.hpt)}"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r>` : '');
const sp = (g) => `<w:spacing w:before="0" w:after="0" w:line="${ln(g.hline)}" w:lineRule="exact"/>`; // fixed height: tall Stam glyphs can't push the body
const PPR = { r: (g) => `<w:bidi/>${sp(g)}`, c: (g) => `<w:bidi/>${sp(g)}<w:jc w:val="center"/>`,
  l: (g) => `<w:bidi w:val="0"/>${sp(g)}<w:jc w:val="left"/>`, rr: (g) => `<w:bidi w:val="0"/>${sp(g)}<w:jc w:val="right"/>` };
const EMPTY = (tag) => `${HEAD}<w:${tag} ${NS}><w:p/></w:${tag}>`;

function headerXml(pg, s, g, cw) {
  if (!pg.r && !pg.c && !pg.l) return EMPTY('hdr');
  const cells = ['r', 'c', 'l'].map((k, i) => [k, Math.round(cw * pg.cols[i] / 100)]).filter(([, w]) => w > 0);
  const rule = s.rule ? '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>' : '';
  return `${HEAD}<w:hdr ${NS}><w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${cw}" w:type="dxa"/><w:tblBorders>${rule}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${cells.map(([, w]) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>` +
    cells.map(([k, w]) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p><w:pPr>${PPR[k](g)}</w:pPr>${run(pg[k], g)}</w:p></w:tc>`).join('') +
    `</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:hdr>`;
}
function footerXml(pg, s, g) {
  if (!pg.foot) return EMPTY('ftr');
  const k = { left: 'l', center: 'c', right: 'rr' }[pg.footAlign];
  return `${HEAD}<w:ftr ${NS}><w:p><w:pPr>${PPR[k](g)}</w:pPr>${run(pg.foot, g)}</w:p></w:ftr>`;
}

// Word wraps a hair differently than the browser; its bottom margin is one line smaller than ours, so a stray
// extra line lands in that slack instead of spilling a whole new page (our section breaks fix where pages end).
export async function buildDocx(pages, paras, s, g) {
  const z = new JSZip();
  const W = tw(g.pw), H = tw(g.ph), cw = tw(g.cw), lineMm = s.bodyPt * s.lineRatio * 0.3528;
  const slack = g.foot ? Math.max(0, Math.min(lineMm, s.mb - g.ftBot - g.hlineMm - 0.5)) : lineMm; // footer must stay inside the margin
  const sect = (pg, k) => {
    const [r, l] = pg.n % 2 ? [s.mi, s.mo] : [s.mo, s.mi];    // odd page = recto; Hebrew binding on its right
    const fr = g.foot ? `<w:footerReference w:type="default" r:id="f${k}"/>` : '';
    return `<w:sectPr><w:headerReference w:type="default" r:id="h${k}"/>${fr}<w:type w:val="nextPage"/><w:pgSz w:w="${W}" w:h="${H}"/>` +
      `<w:pgMar w:top="${tw(s.mt)}" w:right="${tw(r)}" w:bottom="${tw(Math.max(4, s.mb - slack))}" w:left="${tw(l)}" ` +
      `w:header="${tw(g.hdTop)}" w:footer="${tw(g.ftBot)}" w:gutter="0"/><w:bidi/></w:sectPr>`;
  };
  let body = '', rels = '', types = '';
  pages.forEach((pg, k) => {
    const items = pg.blank ? [] : pg.items, last = k === pages.length - 1;
    const sx = last ? '' : sect(pg, k);
    if (!items.length) body += `<w:p><w:pPr>${sx}</w:pPr></w:p>`;
    else items.forEach((it, j) => { body += paraXml(paras[it.pi], it.from, it.to, s, g, j === items.length - 1 ? sx : ''); });
    if (last) body += sect(pg, k);
    z.file(`word/header${k}.xml`, headerXml(pg, s, g, cw));
    rels += `<Relationship Id="h${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header${k}.xml"/>`;
    types += `<Override PartName="/word/header${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`;
    if (!g.foot) return;                                   // every page has its own footer, else Word inherits the previous one
    z.file(`word/footer${k}.xml`, footerXml(pg, s, g));
    rels += `<Relationship Id="f${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer${k}.xml"/>`;
    types += `<Override PartName="/word/footer${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`;
  });
  const f = X(s.fontFamily);
  z.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${types}</Types>`);
  z.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels}</Relationships>`);
  z.file('word/styles.xml', `${HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/><w:sz w:val="${hp(s.bodyPt)}"/><w:szCs w:val="${hp(s.bodyPt)}"/><w:rtl/><w:lang w:val="he-IL" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  z.file('word/settings.xml', `${HEAD}<w:settings ${NS}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  z.file('word/document.xml', `${HEAD}<w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

export function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// Browser print (pages or imposed sheets of wMm × hMm) — vector text with the real font.
export function printPages(html, vars, wMm, hMm) {
  const box = document.getElementById('print'), book = Object.assign(document.createElement('div'), { className: 'book', innerHTML: html });
  book.style.cssText = vars;                               // never interpolate vars into markup (font name is user text)
  box.innerHTML = `<style>@page{size:${wMm}mm ${hMm}mm;margin:0}</style>`;
  box.append(book);
  const done = () => { box.textContent = ''; removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  print();
}
