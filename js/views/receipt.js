// ===== RECEIPT SCAN 🧾 — photo/PDF → AI items → review → stock + shopping list + expense + warranty cards =====
import { h, guard, modal, toast, today, fmtMoney } from '../core/ui.js';
import { records, photos, fn, isPdf } from '../core/api.js';
import { restock, similar, warrantyEnd } from '../core/smart.js';
import { UNITS, WARRANTY_CATS } from '../core/modules.js';
import { state } from '../core/state.js';

const pickFile = () => new Promise((res) => {
  const inp = h('input', { type: 'file', accept: 'image/*,application/pdf', onchange: () => res(inp.files[0] || null), oncancel: () => res(null) });
  inp.click();
});

export async function scanReceipt() {
  const file = await pickFile();
  if (!file) return;
  const wait = modal('קורא את הקבלה…', h('p', { class: 'hint pulse' }, '🧾 זה לוקח כמה שניות'));
  let res;
  try { const { data, mime } = await photos.base64(file); res = await fn('receipt', { image: data, mime }); } finally { wait.close(); }
  if (!res?.items?.length) throw new Error('לא נמצאו פריטים בקבלה');
  review(res, file);
}

const unitOf = (u) => {
  u = String(u || '').replace(/"/g, '״').replace(/'/g, '׳').replace(/^(יחידה|יחידות|קילו)$/, (w) => (w === 'קילו' ? 'ק״ג' : 'יח׳'));
  return UNITS.includes(u) ? u : 'יח׳';
};

function review(res, file) {
  const rows = res.items.map((it) => ({ on: true, name: it.name, qty: it.qty ?? null, unit: unitOf(it.unit),
    price: typeof it.price === 'number' && it.price >= 0 ? it.price : null, category: it.category,
    durable: !!it.durable, months: +it.warranty_months > 0 ? Math.round(+it.warranty_months) : 0 }));
  // the AI sometimes misreads the total (e.g. picks a sub-line): trust it only near the item sum
  const sum = Math.round(rows.reduce((s, r) => s + (r.price || 0), 0) * 100) / 100;
  const total = res.total > 0 && (!sum || Math.abs(res.total - sum) <= sum * 0.3) ? +res.total : sum;
  const nWar = rows.filter((r) => r.months).length;
  const opt = { stock: true, list: true, expense: total > 0, warranty: nWar > 0 };

  const row = (r) => h('div', { class: 'item rc' },
    h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'כלול', onchange: (e) => (r.on = e.target.checked) }),
    h('input', { class: 'grow', value: r.name, maxLength: 80, 'aria-label': 'שם', oninput: (e) => (r.name = e.target.value) }),
    h('input', { class: 'num', type: 'number', inputMode: 'decimal', step: 'any', value: r.qty ?? '', 'aria-label': 'כמות',
      oninput: (e) => (r.qty = e.target.value === '' ? null : +e.target.value) }),
    h('span', { class: 'chip' }, r.unit), r.price != null && h('span', { class: 'chip' }, fmtMoney(r.price)),
    r.months ? h('span', { class: 'chip', title: 'אחריות' }, `🛡️ ${r.months}ח׳`) : r.durable && h('span', { class: 'chip', title: 'לא מתכלה — לא נכנס למלאי' }, '🏠'));
  const check = (k, label) => h('label', { class: 'inline' },
    h('input', { type: 'checkbox', checked: opt[k], onchange: (e) => (opt[k] = e.target.checked) }), label);

  const dlg = modal(`קבלה${res.store ? ' · ' + res.store : ''}`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, `${rows.length} פריטים · סה״כ ${fmtMoney(total)} — בדקו ותקנו לפני אישור`),
    h('div', { class: 'list' }, ...rows.map(row)),
    check('stock', 'עדכן מלאי (מוצרים חדשים ייווצרו; 🏠 לא מתכלים מדולגים)'),
    check('list', 'סמן כנקנה ברשימת הקניות'),
    check('expense', `הוסף הוצאה של ${fmtMoney(total)}`),
    nWar > 0 && check('warranty', `🛡️ פתח כרטיסי אחריות (${nWar})`)), [
    h('button', { onclick: guard(async (e) => {
      e.target.disabled = true;
      try { await apply(rows.filter((r) => r.on && r.name.trim()), res, total, opt, file); dlg.close(); }
      finally { e.target.disabled = false; }
    }) }, 'אישור ועדכון')]);
}

// AI-read dates are trusted only within the last 60 days (a misread year would hide the expense)
function plausible(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const days = (new Date(today()) - new Date(d)) / 864e5;
  return days >= 0 && days <= 60;
}

async function apply(items, res, total, opt, file) {
  const hid = state.house.id, date = plausible(res.date) ? res.date : today(), on = (id) => state.modules.some((m) => m.id === id && m.enabled !== false);
  const stocked = opt.stock ? items.filter((it) => !it.durable && !it.months) : [];
  let n = 0;
  if (stocked.length) {
    const known = await records.all(hid, 'products');
    for (const it of stocked) if (await restock(it, known)) n++;       // sequential: same product may repeat
  }
  let marked = 0;
  if (opt.list) {
    const open = await records.open(hid, 'shopping');
    const hits = open.filter((o) => items.some((it) => similar(o.data?.name, it.name)));
    await Promise.all(hits.map((o) => records.update(o.id, { done: true })));
    marked = hits.length;
  }
  if (opt.expense) await records.insert({ household_id: hid, module: 'expenses', amount: total, due: date,
    data: { title: `קניות${res.store ? ' ב' + res.store : ''}`, category: 'קניות שבועיות' } });
  const war = opt.warranty && on('warranty') ? items.filter((it) => it.months) : [];
  if (war.length) {
    const receipt = isPdf(file) ? undefined : await photos.upload(hid, file);  // one shared receipt photo
    const cat = (c) => (WARRANTY_CATS.includes(c) ? c : 'מוצרי חשמל לבית');
    try {
      await records.insertMany(war.map((it) => ({ household_id: hid, module: 'warranty', amount: it.price, due: warrantyEnd(date, it.months),
        data: { name: it.name.trim(), category: cat(it.category), bought: date, months: it.months, ...(res.store && { store: res.store }), ...(receipt && { receipt }) } })));
    } catch (e) { if (receipt) await photos.remove([receipt]).catch(() => {}); throw e; }
  }
  toast(`עודכנו ${n} מוצרים · ${marked} סומנו ברשימה${opt.expense ? ' · הוצאה נרשמה' : ''}${war.length ? ` · ${war.length} כרטיסי אחריות` : ''}`);
  state.refresh();
}
