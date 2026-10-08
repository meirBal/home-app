// ===== SMART ENGINE — stock ↔ shopping list sync, consumption cycles, expiry, task completion =====
import { records } from './api.js';
import { nextDue } from './modules.js';
import { state } from './state.js';
import { today } from './ui.js';

export const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const FINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const KEEP = new Set(['חלבה']);                                   // words whose ending is not a suffix
// Hebrew-tolerant word stem: ביצה≈ביצים, עגבנייה≈עגבניות, תפוחי≈תפוח
const stem = (w) => (KEEP.has(w) ? w : (w.replace(/(יים|ים|ות|יה|ה|י)$/, '') || w).replace(/[ךםןףץ]$/, (c) => FINAL[c]));
export const tokens = (s) => norm(s).split(' ').filter(Boolean).map(stem);
// a ≈ b: same first word and every word of the shorter name appears in the longer.
// "חלב" ≈ "חלב 3% תנובה" ✓ · "חלב" ≉ "שוקולד חלב" · "עגבנייה" ≉ "רסק עגבניות"
export function similar(a, b) {
  const [x, y] = [Array.isArray(a) ? a : tokens(a), Array.isArray(b) ? b : tokens(b)].sort((p, q) => p.length - q.length);
  return x.length > 0 && x[0].length > 1 && x[0] === y[0] && x.every((t) => y.includes(t));
}
const addDays = (d, n) => { const t = new Date(d + 'T12:00'); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv'); };

// ---- [Consumption cycles: label ↔ days, guessed from product name] ----
const CYCLE_DAYS = { 'כל 3 ימים': 3, 'כל שבוע': 7, 'כל שבועיים': 14, 'כל חודש': 30, 'כל חודשיים': 60, 'כל 3 חודשים': 90 };
const W = (w) => new RegExp(`(?:^|\\s)(?:${w})`);                // word starts with…
const Wf = (w) => new RegExp(`(?:^|\\s)(?:${w})(?![א-ת])`);       // whole word
const NOT_GUESSABLE = /שוקולד|פירורי|ממרח|חטיף|במבה|ביסלי|קפוא/;
// [pattern, cycle, category] — first match wins: multi-word household items before food words
const GUESS = [
  [W('שמפו|מרכך שיער|ג\'ל רחצה|קרם ידיים|קרם גוף') , 'כל חודשיים', 'טואלטיקה'],
  [W('משחת שיניים|מברשת שיניים|דאודורנט|סבון גוף|סבון ידיים'), 'כל חודש', 'טואלטיקה'],
  [W('מרכך|אבקת כביסה|ג\'ל כביסה|נוזל כלים|סבון כלים|טבליות|נייר טואלט|מגבות נייר|שקיות אשפה'), 'כל שבועיים', 'ניקיון'],
  [W('אקונומיקה|מסיר|ספריי|מנקה|נוזל רצפות'), 'כל חודש', 'ניקיון'],
  [W('מזון לכלב|מזון לחתול|חול לחתול|אוכל לכלב|אוכל לחתול'), 'כל חודש', 'בעלי חיים'],
  [W('חיתול|מגבונ|מטרנה|סימילאק'), 'כל שבועיים', 'תינוקות'],
  [W('קולה|ספרייט|סודה|מים מינרל|בירה|יין|מיץ|משקה'), 'כל שבוע', 'משקאות'],
  [Wf('חלב|לחם|פיתה|פיתות|לחמניה|לחמניות'), 'כל 3 ימים', null],
  [W('אורז|פסטה|ספגטי|קמח|סוכר|קפה|רסק|עדשים|חומוס|שעועית|תירס|טונה|פלפל שחור|פפריקה|תבלין|קורנפלקס|דגני') , 'כל חודש', 'יבשים ושימורים'],
  [Wf('שמן|תה'), 'כל חודש', 'יבשים ושימורים'],
  [W('ביצ|גבינ|יוגורט|קוטג|שמנת|לבנ'), 'כל שבוע', 'מוצרי חלב'],
  [Wf('חמאה'), 'כל שבוע', 'מוצרי חלב'],
  [W('עגבני|מלפפו|חסה|ירקות|פירות|תפוח|בננ|גזר|בצל|פלפל|אבוקדו|לימונ|קישוא|חציל|כרוב|תפוז|ענב|תות'), 'כל שבוע', 'ירקות ופירות'],
  [W('עוף|בשר|פילה|סלמון|נקניק|שניצל|כרעיים|חזה|קציצות|המבורגר'), 'כל שבוע', 'בשר ודגים'],
  [Wf('דג|דגים'), 'כל שבוע', 'בשר ודגים'],
];
export function guess(name) {
  const n = norm(name);
  const g = !NOT_GUESSABLE.test(n) && GUESS.find(([re]) => re.test(n));
  return { cycle: g?.[1] || null, category: g?.[2] || null };
}

// ---- [Product state] ----
export function expiry(p, now = today()) {
  if (!p.due) return null;
  if (p.due < now) return 'expired';
  return p.due <= addDays(now, 3) ? 'soon' : null;
}
export function needsRestock(p, now = today()) {
  const st = p.data?.status;
  if (st === 'נגמר' || st === 'נמוך') return st;
  const days = CYCLE_DAYS[p.data?.cycle], bought = p.data?.bought;
  return days && bought && addDays(bought, days) <= now ? 'cycle' : null;
}

// ---- [Shopping list: add missing names only (no duplicates of open items)] ----
export async function addToShopping(items, when = 'עכשיו') {
  const hid = state.house.id;
  const open = new Set((await records.open(hid, 'shopping')).map((r) => norm(r.data?.name)));
  const rows = [];
  for (const it of items) {
    const n = norm(typeof it === 'string' ? it : it.name);
    if (!n || open.has(n)) continue;
    open.add(n);
    rows.push({ household_id: hid, module: 'shopping', done: false,
      data: { name: n, when, qty: it.qty ?? null, unit: it.unit ?? null } });
  }
  await records.insertMany(rows);
  return rows.length;
}

// Quick status from the products list; empty/low → shopping list automatically.
export async function setStatus(p, status) {
  const patch = { status, ...(status === 'מלא' && { bought: today() }) };    // "full" restarts the cycle
  await records.patch(p.id, patch);
  Object.assign(p.data, patch);
  if (status === 'נגמר' || status === 'נמוך') {
    const n = await addToShopping([{ name: p.data.name, unit: p.data.unit }], status === 'נגמר' ? 'עכשיו' : 'השבוע');
    return n ? 'נוסף לרשימת הקניות' : 'כבר ברשימת הקניות';
  }
}

// Bought (shopping ✓ or receipt) → product restocked, or created with guessed cycle/category.
// `known` = full product list (fetched once per batch); fuzzy match "חלב 3% תנובה" → "חלב"; kept up to date.
export async function restock({ name, qty, unit, price, category }, known) {
  const hid = state.house.id, n = norm(name), now = today();
  if (!n || !state.modules.some((m) => m.id === 'products' && m.enabled !== false)) return;
  known ||= await records.all(hid, 'products');
  const t = tokens(n), p = known.find((x) => similar(x._t ||= tokens(x.data?.name), t));
  const num = Number(qty);
  const patch = { status: 'מלא', bought: now, ...(qty != null && qty !== '' && Number.isFinite(num) && { qty: num }), ...(unit && { unit }) };
  const amount = price != null && price !== '' && Number.isFinite(+price) ? +price : undefined;
  if (p) {
    Object.assign(p.data, patch);
    return records.patch(p.id, patch, amount);
  }
  const g = guess(n);
  const data = { name: n, category: category || g.category, cycle: g.cycle || 'ללא', ...patch };
  const row = await records.insert({ household_id: hid, module: 'products', amount: amount ?? null, data });
  known.push({ id: row.id, data, _t: t });
}

// Task ✓: repeating tasks roll forward (strictly after today), others close. Returns new due or null.
export async function completeTask(r) {
  const nd = !r.done && nextDue(r.due, r.data?.repeat, today());
  await records.update(r.id, nd ? { due: nd, done: false } : { done: !r.done });
  return nd || null;
}

// Hook used by the generic list: shopping item bought → restock product.
export async function afterToggle(mod, r) {
  if (mod.id === 'shopping' && !r.done) {
    await restock({ name: r.data?.name, qty: r.data?.qty, unit: r.data?.unit, price: r.amount });
    return 'המלאי עודכן';
  }
}
