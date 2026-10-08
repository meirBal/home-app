// ===== UI primitives — DOM helper, toast, modal, schema-driven form =====
import { state } from './state.js';

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
  if (f.t === 'photo') return h('input', { name, type: 'file', accept: 'image/*' });
  if (f.t === 'member') return h('select', { name },
    h('option', { value: '' }, 'כולם / לא משויך'),
    val && !state.members?.some((m) => m.user_id === val) && h('option', { value: val, selected: true }, 'משתמש שהוסר'),
    ...(state.members || []).map((m) => h('option', { value: m.user_id, selected: m.user_id === val }, m.display_name || '—')));
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
export const memberName = (id) => state.members?.find((m) => m.user_id === id)?.display_name || '';

// One chip text per field type (shared by lists and the home screen)
export function chipText(f, v) {
  if (v == null || v === '') return null;
  if (f.t === 'money') return fmtMoney(v);
  if (f.t === 'date') return `${f.col === 'due' && f.l !== 'תאריך' ? f.l + ' ' : ''}${fmtDate(v)}`;
  if (f.t === 'member') return '👤 ' + (memberName(v) || '?');
  return String(v);
}

// Formatters built once (per-row construction is costly on weak phones; min=max digits avoids old-browser RangeError)
const DATE = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });
const MONEY = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const ISO = new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Jerusalem' });
export const fmtDate = (d) => (d ? DATE.format(new Date(d + 'T00:00')) : '');
export const fmtMoney = (n) => MONEY.format(+n || 0);
export const today = () => ISO.format(new Date());          // YYYY-MM-DD, Israel time

// Two-dice logo (recipe dice) — inline SVG, themed via currentColor / --pip
export const DICE_SVG = () => {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 40'); svg.setAttribute('class', 'dice-logo'); svg.setAttribute('aria-hidden', 'true');
  const die = (x, r, pips) => `<g transform="translate(${x} 4) rotate(${r} 16 16)"><rect width="32" height="32" rx="7" fill="currentColor"/>`
    + pips.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="3.2" fill="var(--pip, var(--card))"/>`).join('') + '</g>';
  svg.innerHTML = die(0, -10, [[9, 9], [16, 16], [23, 23]]) + die(30, 12, [[9, 9], [23, 9], [9, 23], [23, 23], [16, 16]]);
  return svg;
};
