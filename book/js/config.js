// ===== CONFIG — version, page sizes, defaults, font catalog =====
export const VERSION = '1.2.0';
export const SIZES = { A5: [148, 210], A4: [210, 297] }; // mm (width, height)

export const DEFAULTS = {
  size: 'A5', bodyPt: 16, lineRatio: 1.35, gapPt: 3,      // main text size, line height ×, paragraph gap
  mt: 20, mb: 15, mi: 18, mo: 13,                          // margins mm: top, bottom, inner (binding), outer
  font: 'Frank Ruhl Libre', fontName: '', marks: 'all',    // marks: all | niqqud (drop te'amim) | none
  autoHead: true, headLvl: 1, rule: true,                  // right header from Word headings ≤ level; line under header
  numPos: 'to', numFmt: 'heb', numFrom: 1, headMode: 'last', // number: to (top outer) | tl | bo (bottom outer) | bc | bl | br | none
  midText: '', leftText: '', widows: true,                 // header center / side text; no lone line at a page top/bottom
  imp: 'none', sig: 16, dpi: 300,                          // output only: imposition none | book | sig, pages per signature, PDF dpi
  padTo: 4, breaks: true, empties: true,                   // pad to multiple of N pages; keep Word page breaks / empty lines
  stretch: false, firstWord: false, divider: '',           // Stam letter stretching · enlarged first word · ornament before each chapter
};

// css = stylesheet that provides the font (bundled = works offline/APK; Google = needs internet). url = free download for Word.
// Fonts without css must be installed on the device, or added by the user as a font file (kept inside the app).
const G = (n) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n)}:wght@400;700&display=block`;
export const FONTS = [
  { name: 'Frank Ruhl Libre', css: 'css/fonts.css', url: 'https://fonts.google.com/specimen/Frank+Ruhl+Libre', label: 'פרנק רוהל — מרובע (חינמי, מובנה)' },
  { name: 'David Libre', css: G('David Libre'), url: 'https://fonts.google.com/specimen/David+Libre', label: 'דוד (חינמי, דורש אינטרנט)' },
  { name: 'Noto Serif Hebrew', css: G('Noto Serif Hebrew'), url: 'https://fonts.google.com/noto/specimen/Noto+Serif+Hebrew', label: 'Noto Serif (חינמי, דורש אינטרנט)' },
  { name: 'Guttman Stam', label: 'גוטמן סת"ם (מגיע עם Office)' },
  { name: 'Guttman Stam1', label: 'גוטמן סת"ם 1 (Office)' },
  { name: 'Stam Ashkenaz CLM', url: 'https://culmus.sourceforge.io/', label: 'סת"ם אשכנז CLM (Culmus, חינמי)' },
  { name: 'Stam Sefarad CLM', url: 'https://culmus.sourceforge.io/', label: 'סת"ם ספרד CLM (Culmus, חינמי)' },
  { name: 'custom', label: 'אחר — שם פונט / קובץ פונט…' },
];
