// ===== MODULE REGISTRY — every screen is data, so admins can add/edit modules without code =====
// Field: k=key, l=label, t=type(text|number|money|date|time|select|textarea|check|photo),
//        o=options, req=required, col=stored in real column (due|amount|done)
// Module: id, title, icon, fields, view(list|calendar|gallery), sum=show monthly total,
//         order=column to sort by, asc

const name = { k: 'name', l: 'שם', t: 'text', req: 1 };
const notes = { k: 'notes', l: 'הערות', t: 'textarea' };
const due = (l = 'תאריך') => ({ k: 'due', l, t: 'date', col: 'due' });
const repeat = { k: 'repeat', l: 'חזרה', t: 'select', o: ['יומי', 'שבועי', 'חודשי', 'שנתי'] };

export const DEFAULTS = [
  { id: 'shopping', title: 'רשימת קניות', icon: '🛒', fields: [name,
    { k: 'qty', l: 'כמות', t: 'text' },
    { k: 'when', l: 'מתי', t: 'select', o: ['עכשיו', 'השבוע', 'החודש'] },
    { k: 'done', l: 'נקנה', t: 'check', col: 'done' }] },
  { id: 'products', title: 'מוצרים בבית', icon: '📦', fields: [name,
    { k: 'category', l: 'קטגוריה', t: 'select', o: ['מזון', 'ניקיון', 'טואלטיקה', 'חשמל', 'אחר'] },
    { k: 'qty', l: 'כמות', t: 'number' },
    { k: 'status', l: 'מצב', t: 'select', o: ['מלא', 'נמוך', 'נגמר'] },
    { k: 'photo', l: 'תמונה', t: 'photo' }] },
  { id: 'expenses', title: 'הוצאות', icon: '💳', sum: true, order: 'due', fields: [
    { k: 'title', l: 'על מה', t: 'text', req: 1 },
    { k: 'amount', l: 'סכום', t: 'money', col: 'amount', req: 1 },
    { ...due(), req: 1 },
    { k: 'category', l: 'קטגוריה', t: 'select', o: ['קניות שבועיות', 'חשבונות', 'בית', 'רכב', 'אחר'] }] },
  { id: 'routine', title: 'משימות שגרה', icon: '🔁', order: 'due', asc: true, fields: [
    { k: 'title', l: 'משימה', t: 'text', req: 1 }, { k: 'who', l: 'אחראי', t: 'text' },
    repeat, due('הבא בתור'), { k: 'done', l: 'בוצע', t: 'check', col: 'done' }] },
  { id: 'periodic', title: 'משימות תקופתיות', icon: '🗓️', order: 'due', asc: true, fields: [
    { k: 'title', l: 'משימה', t: 'text', req: 1 }, due('מועד'),
    { ...repeat, o: ['חודשי', 'שנתי'] }, notes, { k: 'done', l: 'בוצע', t: 'check', col: 'done' }] },
  { id: 'calendar', title: 'יומן משותף', icon: '📅', view: 'calendar', order: 'due', asc: true, fields: [
    { k: 'title', l: 'אירוע', t: 'text', req: 1 }, { ...due(), req: 1 },
    { k: 'time', l: 'שעה', t: 'time' }, { k: 'who', l: 'מי', t: 'text' }, notes] },
  { id: 'photos', title: 'תמונות', icon: '🖼️', view: 'gallery', fields: [
    { k: 'photo', l: 'תמונה', t: 'photo', req: 1 }, { k: 'caption', l: 'כיתוב', t: 'text' }] },
  { id: 'plans', title: 'תכנון עתידי', icon: '🎯', order: 'due', asc: true, fields: [
    { k: 'title', l: 'יעד', t: 'text', req: 1 }, due('יעד עד'),
    { k: 'amount', l: 'תקציב', t: 'money', col: 'amount' }, notes,
    { k: 'done', l: 'הושג', t: 'check', col: 'done' }] },
];

// settings.modules = [{id, enabled, title, icon, fields, ...}] — overrides by id + custom modules
export function resolve(settings = {}) {
  const ov = new Map((settings.modules || []).map((m) => [m.id, m]));
  const merged = DEFAULTS.map((d) => ({ ...d, enabled: true, ...ov.get(d.id) }));
  for (const m of ov.values()) if (!DEFAULTS.some((d) => d.id === m.id)) merged.push({ enabled: true, ...m });
  return merged;
}

// Validate admin-edited module JSON before saving (prevents a bad edit from breaking every phone).
const TYPES = new Set(['text', 'number', 'money', 'date', 'time', 'select', 'textarea', 'check', 'photo']);
const LISTABLE = new Set(['text', 'number', 'money', 'date', 'time', 'select']);
const COLS = new Set(['due', 'amount', 'done']);
const ORDERS = new Set(['created_at', 'due', 'amount']);
const RESERVED = new Set(['length', 'item', 'namedItem']);
export function validate(m) {
  const err = (t) => { throw new Error(t); };
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(m.id)) err('מזהה מודול: אותיות אנגלית קטנות בלבד');
  if (!m.title) err('חסרה כותרת');
  if (m.order && !ORDERS.has(m.order)) err('order: created_at / due / amount');
  if (!Array.isArray(m.fields) || !m.fields.some((f) => LISTABLE.has(f.t) && !f.col)) err('חייב שדה טקסט/מספר/בחירה אחד לפחות');
  const keys = new Set();
  for (const f of m.fields) {
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(f.k) || RESERVED.has(f.k) || !f.l || !TYPES.has(f.t)) err(`שדה לא תקין: ${JSON.stringify(f)}`);
    if (keys.has(f.k)) err(`שדה כפול: ${f.k}`);
    if (f.col && !COLS.has(f.col)) err(`עמודה לא קיימת: ${f.col}`);
    keys.add(f.k);
  }
  return m;
}

// Repeat → next due date strictly after today; month math clamps (Jan 31 → Feb 28/29).
const STEP = { 'יומי': [0, 1], 'שבועי': [0, 7], 'חודשי': [1, 0], 'שנתי': [12, 0] };
export function nextDue(dateStr, rep, todayStr) {
  const s = STEP[rep];
  if (!s) return null;
  const [y, m, d] = (dateStr || todayStr).split('-').map(Number);
  let n = 0, out;
  do {
    n++;
    const t = new Date(y, m - 1 + s[0] * n, 1);
    const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(d, dim) + s[1] * n);
    out = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  } while (out <= todayStr && n < 1000);
  return out;
}
