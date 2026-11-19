// ===== SHABBAT PREP 🕯️ — the household's challah recipe: editable steps, timers that ring as push alarms, ingredients → list =====
import { h, guard, modal, toast } from '../core/ui.js';
import { records, alarms } from '../core/api.js';
import { addToShopping } from '../core/smart.js';
import { UNITS } from '../core/modules.js';
import { CHALLAH } from '../data/challah.js';
import { state } from '../core/state.js';

const clone = (x) => JSON.parse(JSON.stringify(x));   // structuredClone needs Chrome 98+; old phones too
const sid = () => Math.random().toString(36).slice(2, 8);   // stable step id: timers survive editing the steps
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let tick;

export async function renderShabbat(root) {
  const hid = state.house.id;
  let [rec] = await records.all(hid, 'shabbat');
  if (!rec) {                                          // one per household (unique index): another phone may seed first
    const data = clone(CHALLAH);
    data.steps.forEach((s) => (s.id = sid()));
    await records.insert({ household_id: hid, module: 'shabbat', data }).catch(() => {});
    [rec] = await records.all(hid, 'shabbat');
  }
  const timers = await alarms.mine(hid, state.user.id);
  const r = rec.data;
  r.steps.forEach((s, i) => (s.id ||= 'i' + i));

  // ---- [Timers: each step's ⏰ = server alarm + live countdown here; ringing in-app too while open] ----
  const running = (i) => timers.find((t) => t.data?.ref === `${rec.id}:${r.steps[i].id}` && Date.parse(t.data.at) > Date.now() - 60e3);
  async function start(i) {
    const s = r.steps[i], pushOk = await alarms.enable(hid, state.user.id).catch(() => false);
    const t = await alarms.set(hid, new Date(Date.now() + s.min * 60e3), `⏰ ${r.title}: שלב ${i + 1} הסתיים`, `${rec.id}:${s.id}`);
    timers.push(t);
    toast(pushOk ? `⏰ שעון מעורר בעוד ${s.min} דק׳ — יצלצל גם כשהאפליקציה סגורה` : `⏰ טיימר ${s.min} דק׳ — ההתראות כבויות, יצלצל רק כשהאפליקציה פתוחה`, !pushOk);
    paint();
  }
  async function stop(t) { await alarms.cancel(t.id); timers.splice(timers.indexOf(t), 1); paint(); }
  function ring(t) {                                  // the push arrives too; this is for an open screen
    if (!t || t.rang) return;
    t.rang = true;
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    try {
      const a = new AudioContext(), o = a.createOscillator();
      o.connect(a.destination); o.frequency.value = 880; o.onended = () => a.close(); o.start(); o.stop(a.currentTime + 1.2);
    } catch { /* no audio */ }
    toast(t.data.title);
  }

  // ---- [View] ----
  const body = h('div');
  function paint() {
    body.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, `🍞 ${r.title}`), r.note && h('p', { class: 'hint' }, r.note),
        h('div', { class: 'row' },
          h('button', { onclick: guard(toList) }, '🛒 מרכיבים לרשימת קניות'),
          h('button', { class: 'ghost', onclick: () => editor() }, '✏️ עריכה')),
        h('h3', {}, 'מרכיבים'),
        h('ul', { class: 'ing-list' }, ...r.ing.map((x) => h('li', {}, `${x.qty ?? ''} ${x.unit ?? ''} ${x.name}`.trim()))),
        h('h3', {}, 'שלבים'),
        h('ol', { class: 'steps shab' }, ...r.steps.map((s, i) => {
          const t = running(i);
          return h('li', {}, h('span', {}, s.text), s.min > 0 && h('div', { class: 'row' }, t
            ? [h('b', { class: 'cd', 'data-at': t.data.at, 'data-id': t.id }, mmss(Date.parse(t.data.at) - Date.now())),
              h('button', { class: 'ghost sm', onclick: guard(() => stop(t)) }, 'ביטול')]
            : h('button', { class: 'ghost sm', onclick: guard(() => start(i)) }, `⏰ ${s.min} דק׳`)));
        }))));
  }
  clearInterval(tick);
  tick = setInterval(() => {                          // one ticker for all countdowns; stops when the view is gone
    if (!body.isConnected) return clearInterval(tick);
    for (const el of body.querySelectorAll('.cd')) {
      const left = Date.parse(el.dataset.at) - Date.now();
      el.textContent = left > 0 ? mmss(left) : '⏰ הסתיים';
      if (left <= 0) ring(timers.find((t) => t.id === el.dataset.id));
    }
  }, 1000);

  // ---- [Ingredients → shopping list; "have it" pre-checked from stock, so nothing is bought twice] ----
  async function toList() {
    const { stockMatcher } = await import('./library.js');
    const have = await stockMatcher();
    const rows = r.ing.map((x) => ({ ...x, have: have(x.name) }));
    const dlg = modal('🛒 מה חסר?', h('div', { class: 'form' },
      h('p', { class: 'hint' }, 'סמנו מה כבר יש בבית — רק השאר ייכנס לרשימה'),
      ...rows.map((x) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: x.have, onchange: (e) => (x.have = e.target.checked) }),
        `יש: ${x.name}`))), [
      h('button', { onclick: guard(async () => {
        const n = await addToShopping(rows.filter((x) => !x.have).map(({ name, qty, unit }) => ({ name, qty, unit })));
        dlg.close(); toast(n ? `נוספו ${n} פריטים לרשימת הקניות` : 'הכול כבר ברשימה');
      }) }, 'הוסף חסרים')]);
  }

  // ---- [Editor: title, ingredients, steps (text + minutes); add / remove rows; restore the original] ----
  function editor() {
    const d = clone(r);
    const box = h('div', { class: 'form' });
    const draw = () => box.replaceChildren(
      h('input', { value: d.title, 'aria-label': 'שם המתכון', oninput: (e) => (d.title = e.target.value) }),
      h('h3', {}, 'מרכיבים'),
      ...d.ing.map((x, i) => h('div', { class: 'row' },
        h('input', { class: 'grow', value: x.name, 'aria-label': 'מרכיב', oninput: (e) => (x.name = e.target.value) }),
        h('input', { class: 'num', type: 'number', step: 'any', value: x.qty ?? '', 'aria-label': 'כמות', oninput: (e) => (x.qty = e.target.value === '' ? null : +e.target.value) }),
        h('select', { 'aria-label': 'יחידה', onchange: (e) => (x.unit = e.target.value) },
          ...[...new Set([...UNITS, 'כף', 'כפית', 'כוס', x.unit].filter(Boolean))].map((u) => h('option', { value: u, selected: u === x.unit }, u))),
        h('button', { type: 'button', class: 'ghost', 'aria-label': 'מחיקת מרכיב', onclick: () => { d.ing.splice(i, 1); draw(); } }, '✕'))),
      h('button', { type: 'button', class: 'ghost', onclick: () => { d.ing.push({ name: '', qty: null, unit: 'יח׳' }); draw(); } }, '➕ מרכיב'),
      h('h3', {}, 'שלבים (דקות = טיימר)'),
      ...d.steps.map((s, i) => h('div', { class: 'row' },
        h('textarea', { class: 'grow', rows: 2, value: s.text, 'aria-label': `שלב ${i + 1}`, oninput: (e) => (s.text = e.target.value) }),
        h('input', { class: 'num', type: 'number', min: 0, value: s.min || '', 'aria-label': 'דקות', oninput: (e) => (s.min = Math.max(0, +e.target.value || 0)) }),
        h('button', { type: 'button', class: 'ghost', 'aria-label': 'מחיקת שלב', onclick: () => { d.steps.splice(i, 1); draw(); } }, '✕'))),
      h('button', { type: 'button', class: 'ghost', onclick: () => { d.steps.push({ id: sid(), text: '', min: 0 }); draw(); } }, '➕ שלב'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { if (confirm('לחזור למתכון המקורי?')) { Object.assign(d, clone(CHALLAH)); d.steps.forEach((x) => (x.id = sid())); draw(); } } }, '↩️ מתכון מקורי'));
    draw();
    const dlg = modal('✏️ עריכת המתכון', box, [h('button', { onclick: guard(async () => {
      d.ing = d.ing.filter((x) => x.name.trim()); d.steps = d.steps.filter((s) => s.text.trim());
      await records.update(rec.id, { data: d });
      Object.assign(r, d); dlg.close(); paint();
    }) }, 'שמירה')]);
  }

  root.replaceChildren(h('header', { class: 'bar' }, h('h1', {}, '🕯️ הכנות לשבת')), body);
  paint();
}
