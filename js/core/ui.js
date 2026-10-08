// ===== UI primitives — DOM helper, toast, modal, schema-driven form =====

// h('div', {class:'x', onclick: fn}, 'text', child) — text always via textContent (XSS-safe)
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;   // list/form are read-only props
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

export const $ = (s, root = document) => root.querySelector(s);

export function toast(msg, bad = false) {
  const t = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// Wrap async actions: shows error toast instead of silent failure.
export const guard = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) { console.error(e); toast(e.message || 'שגיאה', true); }
};

export function modal(title, body, actions = []) {
  const dlg = h('dialog', { class: 'modal' },
    h('h2', {}, title), body,
    h('div', { class: 'row end' }, ...actions,
      h('button', { class: 'ghost', type: 'button', onclick: () => dlg.close() }, 'סגור')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// ---- [Form from field schema] ----
// field: {k, l(label), t(type), o(options), req, col('due'|'amount'|'done')}
const INPUT = { text: 'text', number: 'number', money: 'number', date: 'date', time: 'time' };

export function fieldInput(f, val) {
  const name = f.k;
  if (f.t === 'select') return h('select', { name, required: f.req },
    h('option', { value: '' }, '—'), ...(f.o || []).map((o) => h('option', { value: o, selected: o === val }, o)));
  if (f.t === 'textarea') return h('textarea', { name, rows: 3, maxLength: 1000, value: val ?? '' });
  if (f.t === 'check') return h('input', { name, type: 'checkbox', checked: !!val });
  if (f.t === 'photo') return h('input', { name, type: 'file', accept: 'image/*', capture: 'environment' });
  return h('input', {
    name, type: INPUT[f.t] || 'text', required: f.req, value: val ?? '',
    step: f.t === 'money' ? '0.01' : f.t === 'number' ? 'any' : null,
    inputMode: f.t === 'money' || f.t === 'number' ? 'decimal' : null, maxLength: 200,
  });
}

export function buildForm(fields, rec = {}) {
  return h('form', { class: 'form', method: 'dialog' },
    ...fields.map((f) => h('label', { class: f.t === 'check' ? 'inline' : '' },
      h('span', {}, f.l + (f.req ? ' *' : '')), fieldInput(f, valueOf(rec, f)))));
}

// Read one field value from a record (column or jsonb)
export const valueOf = (rec, f) => (f.col ? rec[f.col] : rec.data?.[f.k]);

export const fmtDate = (d) => d ? new Date(d + 'T00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
export const fmtMoney = (n) => (+n || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
