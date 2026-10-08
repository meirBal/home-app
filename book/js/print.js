// ===== PRINT — booklet imposition (Hebrew, right binding), print units, ready PDF (rendered pages → PDF) =====

// Sheet sides for duplex printing, 2 pages per side. mode: none | book (one booklet) | sig (booklets of `sig` pages).
// Returns [[leftIdx, rightIdx], ...] in print order (front, back, front, …); null = blank. Hebrew: spine on the right of
// page 1, so a 4-page booklet prints front [1 | 4], back [3 | 2]: page 1 with the last, 2 with the one before last…
export function impose(n, mode, sig) {
  const size = mode === 'book' ? Math.ceil(n / 4) * 4 : Math.max(4, Math.round(sig / 4) * 4), sides = [];
  for (let o = 0; o < n; o += size) {
    const m = Math.min(size, Math.ceil((n - o) / 4) * 4), at = (i) => (o + i < n ? o + i : null);
    for (let i = 0; i < m / 4; i++) sides.push([at(2 * i), at(m - 1 - 2 * i)], [at(m - 2 - 2 * i), at(2 * i + 1)]);
  }
  return sides;
}

// Printable units for a run of pages: single pages, or sheets of two pages. Returns { units: [html], w, h } (mm).
export function units(pages, mode, sig, render, g) {
  if (mode === 'none') return { units: pages.map(render), w: g.pw, h: g.ph };
  const blank = '<div class="pw"><div class="page blank"></div></div>';
  return { w: g.pw * 2, h: g.ph, units: impose(pages.length, mode, sig).map(([l, r]) =>
    `<div class="sheet">${l == null ? blank : render(pages[l])}${r == null ? blank : render(pages[r])}</div>`) };
}

// Duplex test sheet: 2 pages (or one imposed sheet front+back) with big numbers, arrows and a frame 5 mm inside the edge.
export function testUnits(mode, g) {
  const note = mode === 'none' ? 'בגב של 1 צריך להופיע 2, והחץ באותו כיוון.' : 'בגב: 2 מאחורי 1 ו-3 מאחורי 4, והחצים באותו כיוון. אם לא — לשנות "היפוך בצד הקצר/הארוך".';
  const page = (n) => `<div class="pw"><div class="page blank" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5mm;text-align:center;font-family:sans-serif;outline:.3mm dashed #000;outline-offset:-5mm">` +
    `<div style="font-size:30mm;line-height:1">↑</div><div style="font-size:28mm;line-height:1">${n}</div>` +
    `<div style="font-size:3.5mm;max-width:75%">${note}<br>המסגרת המקווקוות צריכה להיות 5 מ״מ מהקצה — אחרת ההדפסה לא בגודל 100%.</div></div></div>`;
  return units(mode === 'none' ? [1, 2] : [1, 2, 3, 4], mode === 'none' ? 'none' : 'book', 4, page, g);
}

// ----- ready PDF: each unit drawn by the browser itself (SVG foreignObject → canvas), so text, niqqud and font are
// exactly what the preview shows. Drawn in horizontal bands (small canvas: phones, iOS limits) and streamed into
// Flate as it goes. dpi '600b' = 1-bit black/white at 600 dpi (crisp, small: for print shops); numbers = 8-bit gray. -----
let css;
async function bookCss() {
  css ??= (await (await fetch('css/book.css')).text()) +
    '.book{--z:1;display:block;padding:0}.page{content-visibility:visible!important;box-shadow:none!important;transform:none!important;cursor:auto}.page.blank{background:#fff}';
  return css;
}

// Embedded fonts finish loading inside the image after decode(), and text stays invisible until then. Each SVG carries a
// marker strip below the page, written in the book font; we wait until that strip shows ink (cap 4 s, then fail loudly).
const STRIP = 40;                                          // css px under the page, never drawn into the PDF
async function settle(img, W, H, Hs) {
  const t = Object.assign(document.createElement('canvas'), { width: 64, height: 8 }), c = t.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < 45; i++) {                           // < 3 s: after that font-display:block would show a fallback
    c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 8); c.drawImage(img, 0, H, W, Hs - H, 0, 0, 64, 8);
    if (c.getImageData(0, 0, 64, 8).data.some((v, j) => j % 4 === 0 && v < 235)) return; // any ink (thumbnail averages it to gray)
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('הפונט לא נטען בזמן ליצירת ה-PDF — נסו שוב');
}

async function rasterize(html, wMm, hMm, mode, vars, style) {
  const bits = mode === '600b' ? 1 : 8, dpi = parseInt(mode, 10);
  const div = document.createElement('div');
  div.className = 'book';
  div.style.cssText = vars + ';position:relative';
  div.innerHTML = `<style>${style}</style>${html}`;
  const fonts = style.includes('@font-face');
  if (fonts) div.insertAdjacentHTML('beforeend', `<div style="position:absolute;top:${hMm}mm;right:0;font:30px var(--font);color:#000">אבג</div>`);
  const cw = wMm * 96 / 25.4, ch = hMm * 96 / 25.4 + (fonts ? STRIP : 0), W = Math.round(wMm / 25.4 * dpi), H = Math.round(hMm / 25.4 * dpi);
  const Hs = Math.round(ch / 96 * dpi);                    // image height incl. the marker strip
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hs}" viewBox="0 0 ${cw} ${ch}">` +
    `<foreignObject width="${cw}" height="${ch}">${new XMLSerializer().serializeToString(div)}</foreignObject></svg>`;
  const img = new Image();                                  // data: URL — a blob: URL would taint the canvas in Chrome
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  if (fonts) await settle(img, W, H, Hs);
  const band = Math.max(8, Math.floor(4e6 / W)), cv = Object.assign(document.createElement('canvas'), { width: W, height: band });
  const ctx = cv.getContext('2d', { willReadFrequently: true }), rowB = bits === 1 ? Math.ceil(W / 8) : W;
  const cs = new CompressionStream('deflate'), out = new Response(cs.readable).blob(), wr = cs.writable.getWriter();
  for (let y = 0; y < H; y += band) {
    const h = Math.min(band, H - y);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, band); ctx.drawImage(img, 0, y, W, h, 0, 0, W, h);
    let px;
    try { px = ctx.getImageData(0, 0, W, h).data; } catch { throw new Error('הדפדפן חוסם יצירת PDF כאן — השתמשו ב"הדפסה" ← שמירה כ-PDF'); }
    const buf = new Uint8Array(rowB * h).fill(bits === 1 ? 255 : 0);
    for (let r = 0, i = 0; r < h; r++) for (let x = 0; x < W; x++, i += 4) {
      const v = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      if (bits === 8) buf[r * W + x] = v; else if (v < 128) buf[r * rowB + (x >> 3)] &= ~(128 >> (x & 7)); // 0 = black
    }
    await wr.write(buf);
  }
  await wr.close();
  cv.width = cv.height = 0;                                // free canvas memory now, not at GC
  return { W, H, bits, z: await out };                     // z: Blob — pages never pile up as JS arrays
}

// Minimal PDF 1.4: one full-page image per page (gray 8-bit or 1-bit). Parts are strings and Blobs → no big copies.
function pdfFile(imgs, wMm, hMm) {
  const enc = new TextEncoder(), parts = [], offs = [], wp = (wMm * 72 / 25.4).toFixed(2), hp = (hMm * 72 / 25.4).toFixed(2);
  let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.size ?? b.length; };
  const obj = (id, body) => { offs[id] = len; put(`${id} 0 obj\n`); for (const b of [].concat(body)) put(b); put('\nendobj\n'); };
  put(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])); // %PDF-1.4 + binary marker
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${imgs.map((_, k) => `${3 + k * 3} 0 R`).join(' ')}] /Count ${imgs.length} >>`);
  imgs.forEach(({ W, H, bits, z }, k) => {
    const p = 3 + k * 3, draw = `q ${wp} 0 0 ${hp} 0 0 cm /I Do Q`;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wp} ${hp}] /TrimBox [0 0 ${wp} ${hp}] /Resources << /XObject << /I ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(p + 2, [`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent ${bits} /Filter /FlateDecode /Length ${z.size} >>\nstream\n`, z, '\nendstream']);
  });
  const xref = len, n = imgs.length * 3 + 3;
  put(`xref\n0 ${n}\n0000000000 65535 f \n${offs.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`);
  put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// prep(html) → html: last-moment per-unit step (letter stretching), so nothing is prepared for all pages at once.
export async function makePdf({ units: list, w, h }, vars, mode, fontCss, onProgress, prep = (x) => x) {
  if (typeof CompressionStream === 'undefined') throw new Error('הדפדפן לא תומך ביצירת PDF — השתמשו בהדפסה ← שמירה כ-PDF');
  const style = (await bookCss()) + fontCss, imgs = [];
  for (const [i, html] of list.entries()) {
    onProgress?.(i + 1, list.length);
    imgs.push(await rasterize(prep(html), w, h, String(mode), vars, style));
  }
  return pdfFile(imgs, w, h);
}

// Fonts must travel inside the SVG as data: URLs (an SVG image cannot load anything). Installed fonts need nothing.
// cssUrl: a stylesheet with @font-face rules (Google Fonts or the app's own css/fonts.css); only Hebrew/Latin-basic kept.
const toData = async (url) => { const b = await (await fetch(url)).blob(); return new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
export async function fontCss(family, cssUrl, uploaded) {
  if (uploaded) return `@font-face{font-family:"${family}";font-display:block;src:url(${uploaded})}`;
  if (!cssUrl) return '';
  const base = new URL(cssUrl, location.href), res = await fetch(base);
  if (!res.ok) throw new Error('font css');
  let txt = (await res.text()).split('@font-face').filter((b) => b.includes(family) && (!/unicode-range/i.test(b) || /unicode-range:[^;]*U\+(05|0000)/i.test(b)))
    .map((b) => '@font-face' + b).join('');
  for (const u of new Set([...txt.matchAll(/url\(["']?([^)"']+)["']?\)/g)].map((m) => m[1]))) txt = txt.split(u).join(await toData(new URL(u, base)));
  if (!txt) throw new Error('font css');
  return txt;
}
