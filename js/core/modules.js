// ===== MODULE REGISTRY — every screen is data, so admins can add/edit modules without code =====
// Field: k=key, l=label, t=type(text|number|money|date|time|select|textarea|check|photo|member),
//        o=options, req=required, col=stored in real column (due|amount|done)
// Module: id, title, icon, pin, fields, view(list|calendar|gallery|shopping|warranty), sum=show monthly total,
//         order=column to sort by, asc

const name = { k: 'name', l: 'שם', t: 'text', req: 1 };
const title = (l = 'משימה') => ({ k: 'title', l, t: 'text', req: 1 });
const notes = { k: 'notes', l: 'הערות', t: 'textarea' };
const due = (l = 'תאריך') => ({ k: 'due', l, t: 'date', col: 'due' });
const who = (l = 'אחראי') => ({ k: 'who', l, t: 'member' });
const done = (l = 'בוצע') => ({ k: 'done', l, t: 'check', col: 'done' });
const photo = { k: 'photo', l: 'תמונה', t: 'photo' };
export const REPEATS = ['יומי', 'שבועי', 'דו-שבועי', 'חודשי', 'דו-חודשי', 'רבעוני', 'חצי שנתי', 'שנתי'];
const repeat = { k: 'repeat', l: 'חזרה', t: 'select', o: REPEATS };
export const UNITS = ['יח׳', 'ק״ג', 'גרם', 'ליטר', 'מ״ל', 'אריזה'];
const qty = [{ k: 'qty', l: 'כמות', t: 'number' }, { k: 'unit', l: 'יחידה', t: 'select', o: UNITS }];
// supermarket walking order — the shopping list is grouped in this order
export const CATEGORIES = ['ירקות ופירות', 'מאפים', 'מוצרי חלב', 'בשר ודגים', 'יבשים ושימורים', 'קפואים',
  'משקאות', 'ניקיון', 'טואלטיקה', 'תינוקות', 'בעלי חיים', 'כלי בית', 'אחר'];
export const WARRANTY_CATS = ['אלקטרוניקה', 'מוצרי חשמל לבית', 'ריהוט', 'כלי עבודה', 'רכב', 'ביגוד והנעלה', 'אחר'];
export const CYCLES = ['ללא', 'כל 3 ימים', 'כל שבוע', 'כל שבועיים', 'כל חודש', 'כל חודשיים', 'כל 3 חודשים'];
export const TASK_MODULES = ['routine', 'periodic', 'maintenance', 'pets'];

// pin = shown in the bottom bar on phones (everything is always reachable via "עוד")
export const DEFAULTS = [
  { id: 'shopping', title: 'רשימת קניות', icon: '🛒', pin: true, view: 'shopping', fields: [name, ...qty,
    { k: 'category', l: 'מחלקה', t: 'select', o: CATEGORIES },
    { k: 'when', l: 'מתי', t: 'select', o: ['עכשיו', 'השבוע', 'החודש'] },
    { k: 'amount', l: 'מחיר משוער', t: 'money', col: 'amount' }, photo, done('נקנה')] },
  { id: 'products', title: 'מוצרים בבית', icon: '📦', pin: true, order: 'due', asc: true, fields: [name,
    { k: 'category', l: 'קטגוריה', t: 'select', o: CATEGORIES }, ...qty,
    { k: 'status', l: 'מצב', t: 'select', o: ['מלא', 'נמוך', 'נגמר'] },
    due('תוקף'), { k: 'cycle', l: 'נגמר בדרך כלל', t: 'select', o: CYCLES },
    { k: 'bought', l: 'נקנה לאחרונה', t: 'date' },
    { k: 'amount', l: 'מחיר', t: 'money', col: 'amount' }, photo,
    { k: 'warranty', l: 'יש אחריות (יפתח כרטיס אחריות)', t: 'check' }] },
  { id: 'routine', title: 'משימות שגרה', icon: '🔁', pin: true, order: 'due', asc: true, fields: [
    title(), who(), repeat, due('הבא בתור'), done()] },
  { id: 'calendar', title: 'יומן משותף', icon: '📅', view: 'calendar', order: 'due', asc: true, fields: [
    title('אירוע'), { ...due(), req: 1 }, { k: 'time', l: 'שעה', t: 'time' }, who('מי'), notes] },
  { id: 'warranty', title: 'אחריות', icon: '🛡️', view: 'warranty', order: 'due', asc: true, fields: [name,
    { k: 'category', l: 'סוג', t: 'select', o: WARRANTY_CATS }, { k: 'model', l: 'מותג / דגם', t: 'text' },
    { k: 'store', l: 'נקנה ב', t: 'text' }, { k: 'bought', l: 'תאריך קנייה', t: 'date', req: 1 },
    { k: 'months', l: 'אחריות (חודשים)', t: 'number', req: 1 }, due('אחריות עד'),
    { k: 'amount', l: 'מחיר', t: 'money', col: 'amount' }, { k: 'serial', l: 'מספר סידורי', t: 'text' },
    { ...photo, l: 'תמונת המוצר' }, { k: 'receipt', l: 'תמונת הקבלה', t: 'photo' }, notes] },
  { id: 'expenses', title: 'הוצאות', icon: '💳', sum: true, order: 'due', fields: [
    title('על מה'), { k: 'amount', l: 'סכום', t: 'money', col: 'amount', req: 1 }, { ...due(), req: 1 },
    { k: 'category', l: 'קטגוריה', t: 'select', o: ['קניות שבועיות', 'חשבונות', 'בית', 'רכב', 'בעלי חיים', 'אחר'] }] },
  { id: 'periodic', title: 'משימות תקופתיות', icon: '🗓️', order: 'due', asc: true, fields: [
    title(), who(), due('מועד'), repeat, notes, done()] },
  { id: 'maintenance', title: 'תחזוקת הבית', icon: '🔧', order: 'due', asc: true, fields: [
    title(), { k: 'area', l: 'מכשיר / אזור', t: 'text' }, who(), repeat, due('מועד'), notes, done()] },
  { id: 'pets', title: 'בעלי חיים', icon: '🐾', order: 'due', asc: true, fields: [
    title(), { k: 'pet', l: 'שם החיה', t: 'text' }, who(), repeat, due('מועד'), notes, done()] },
  { id: 'recipes', title: 'המתכונים שלנו', icon: '🍳', fields: [name,
    { k: 'meal', l: 'ארוחה', t: 'select', o: ['בוקר', 'צהריים', 'ערב'] },
    { k: 'mood', l: 'מצב רעב', t: 'select', o: ['קליל', 'רעב', 'רעב מאוד'] },
    { k: 'minutes', l: 'דקות הכנה', t: 'number' },
    { k: 'ing', l: 'מצרכים (שורה לכל מצרך)', t: 'textarea' }, { k: 'steps', l: 'אופן הכנה', t: 'textarea' }, photo] },
  { id: 'photos', title: 'תמונות', icon: '🖼️', view: 'gallery', fields: [
    { ...photo, req: 1 }, { k: 'caption', l: 'כיתוב', t: 'text' }] },
  { id: 'plans', title: 'תכנון עתידי', icon: '🎯', order: 'due', asc: true, fields: [
    title('יעד'), due('יעד עד'), { k: 'amount', l: 'תקציב', t: 'money', col: 'amount' }, notes, done('הושג')] },
];

// settings.modules = [{id, enabled, title, icon, fields, ...}] — overrides by id + custom modules
export function resolve(settings = {}) {
  const ov = new Map((settings.modules || []).map((m) => [m.id, m]));
  // overrides saved by older versions keep their fields, and gain fields added to the default since
  const merged = DEFAULTS.map((d) => {
    const o = ov.get(d.id), m = { ...d, enabled: true, ...o };
    if (o?.fields) m.fields = [...o.fields, ...d.fields.filter((f) => !o.fields.some((x) => x.k === f.k))];
    return m;
  });
  for (const m of ov.values()) if (!DEFAULTS.some((d) => d.id === m.id)) merged.push({ enabled: true, ...m });
  return merged;
}

// Validate admin-edited module JSON before saving (prevents a bad edit from breaking every phone).
const TYPES = new Set(['text', 'number', 'money', 'date', 'time', 'select', 'textarea', 'check', 'photo', 'member']);
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
const STEP = { 'יומי': [0, 1], 'שבועי': [0, 7], 'דו-שבועי': [0, 14], 'חודשי': [1, 0], 'דו-חודשי': [2, 0],
  'רבעוני': [3, 0], 'חצי שנתי': [6, 0], 'שנתי': [12, 0] };
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
