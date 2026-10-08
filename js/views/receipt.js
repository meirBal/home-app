// ===== RECEIPT SCAN 🧾 — photo → AI items → review → stock + shopping list + expense =====
import { h, guard, modal, toast, today, fmtMoney } from '../core/ui.js';
import { records, photos, fn } from '../core/api.js';
import { restock, similar } from '../core/smart.js';
import { UNITS } from '../core/modules.js';
import { state } from '../core/state.js';

const pickFile = () => new Promise((res) => {
  const inp = h('input', { type: 'file', accept: 'image/*', onchange: () => res(inp.files[0] || null), oncancel: () => res(null) });
  inp.click();
});

export async function scanReceipt() {
  const file = await pickFile();
  if (!file) return;
  const wait = modal('קורא את הקבלה…', h('p', { class: 'hint pulse' }, '🧾 זה לוקח כמה שניות'));
  let res;
  try { res = await fn('receipt', { image: await photos.base64(file) }); } finally { wait.close(); }
  if (!res?.items?.length) throw new Error('לא נמצאו פריטים בקבלה');
  review(res);
}

function review(res) {
  const unitOf = (u) => { u = String(u || '').replace(/"/g, '״').replace(/'/g, '׳'); return UNITS.includes(u) ? u : 'יח׳'; };
  const rows = res.items.map((it) => ({ on: true, name: it.name, qty: it.qty ?? null,
    unit: unitOf(it.unit), price: it.price ?? null, category: it.category }));
  const total = res.total || rows.reduce((s, r) => s + (+r.price || 0), 0);
  const opt = { stock: true, list: true, expense: total > 0 };

  const row = (r) => h('div', { class: 'item rc' },
    h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'כלול', onchange: (e) => (r.on = e.target.checked) }),
    h('input', { class: 'grow', value: r.name, maxLength: 80, 'aria-label': 'שם', oninput: (e) => (r.name = e.target.value) }),
    h('input', { class: 'num', type: 'number', inputMode: 'decimal', step: 'any', value: r.qty ?? '', 'aria-label': 'כמות',
      oninput: (e) => (r.qty = e.target.value === '' ? null : +e.target.value) }),
    h('span', { class: 'chip' }, r.unit), r.price != null && h('span', { class: 'chip' }, fmtMoney(r.price)));
  const check = (k, label) => h('label', { class: 'inline' },
    h('input', { type: 'checkbox', checked: opt[k], onchange: (e) => (opt[k] = e.target.checked) }), label);

  const dlg = modal(`קבלה${res.store ? ' · ' + res.store : ''}`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, `${rows.length} פריטים · סה״כ ${fmtMoney(total)} — בדקו ותקנו לפני אישור`),
    h('div', { class: 'list' }, ...rows.map(row)),
    check('stock', 'עדכן מלאי (מוצרים חדשים ייווצרו)'),
    check('list', 'סמן כנקנה ברשימת הקניות'),
    check('expense', `הוסף הוצאה של ${fmtMoney(total)}`)), [
    h('button', { onclick: guard(async (e) => {
      e.target.disabled = true;
      try { await apply(rows.filter((r) => r.on && r.name.trim()), res, total, opt); dlg.close(); }
      finally { e.target.disabled = false; }
    }) }, 'אישור ועדכון')]);
}

// AI-read dates are trusted only within the last 60 days (a misread year would hide the expense)
function plausible(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const days = (new Date(today()) - new Date(d)) / 864e5;
  return days >= 0 && days <= 60;
}

async function apply(items, res, total, opt) {
  const hid = state.house.id;
  if (opt.stock) {
    const known = await records.all(hid, 'products');
    for (const it of items) await restock(it, known);                 // sequential: same product may repeat
  }
  let marked = 0;
  if (opt.list) {
    const open = await records.open(hid, 'shopping');
    const hits = open.filter((o) => items.some((it) => similar(o.data?.name, it.name)));
    await Promise.all(hits.map((o) => records.update(o.id, { done: true })));
    marked = hits.length;
  }
  if (opt.expense) await records.insert({ household_id: hid, module: 'expenses', amount: total,
    due: plausible(res.date) ? res.date : today(),
    data: { title: `קניות${res.store ? ' ב' + res.store : ''}`, category: 'קניות שבועיות' } });
  toast(`עודכנו ${opt.stock ? items.length : 0} מוצרים · ${marked} סומנו ברשימה${opt.expense ? ' · הוצאה נרשמה' : ''}`);
  state.refresh();
}
