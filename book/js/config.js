// ===== CONFIG — version, page sizes, defaults, font catalog =====
export const VERSION = '1.0.0';
export const SIZES = { A5: [148, 210], A4: [210, 297] }; // mm (width, height)

export const DEFAULTS = {
  size: 'A5', bodyPt: 16, lineRatio: 1.35, gapPt: 3,      // main text size, line height ×, paragraph gap
  mt: 20, mb: 15, mi: 18, mo: 13,                          // margins mm: top, bottom, inner (binding), outer
  font: 'Frank Ruhl Libre', fontName: '', marks: 'all',    // marks: all | niqqud (drop te'amim) | none
  autoHead: true, headLvl: 1, rule: true, numFmt: 'heb',   // running header from Word headings ≤ level; underline; heb|num|none
  padTo: 4, breaks: true, empties: true,                   // pad to multiple of N pages; keep Word page breaks / empty lines
};

// web = free Google font, loaded on demand. Others must be installed on this computer (Word's fonts are).
export const FONTS = [
  { name: 'Frank Ruhl Libre', web: true, url: 'https://fonts.google.com/specimen/Frank+Ruhl+Libre', label: 'פרנק רוהל — מרובע (חינמי)' },
  { name: 'David Libre', web: true, url: 'https://fonts.google.com/specimen/David+Libre', label: 'דוד (חינמי)' },
  { name: 'Noto Serif Hebrew', web: true, url: 'https://fonts.google.com/noto/specimen/Noto+Serif+Hebrew', label: 'Noto Serif (חינמי)' },
  { name: 'Guttman Stam', label: 'גוטמן סת"ם (מגיע עם Office)' },
  { name: 'Guttman Stam1', label: 'גוטמן סת"ם 1 (Office)' },
  { name: 'Stam Ashkenaz CLM', url: 'https://culmus.sourceforge.io/', label: 'סת"ם אשכנז CLM (Culmus, חינמי)' },
  { name: 'Stam Sefarad CLM', url: 'https://culmus.sourceforge.io/', label: 'סת"ם ספרד CLM (Culmus, חינמי)' },
  { name: 'custom', label: 'אחר — שם פונט / קובץ פונט…' },
];
