// ===== HOME — today at a glance: tasks, expiry, restock suggestions, dice & receipt shortcuts =====
import { h, guard, toast, fmtDate, chipText, memberName, today, DICE_SVG } from '../core/ui.js';
import { records } from '../core/api.js';
import { TASK_MODULES } from '../core/modules.js';
import { completeTask, expiry, needsRestock, addToShopping, norm } from '../core/smart.js';
import { packs, packRows } from '../data/seeds.js';
import { state } from '../core/state.js';

const ui = { mine: false };
// disable the control while the action runs; re-enable on error (guard shows the toast)
const busy = (fn) => guard(async (e) => { const el = e.currentTarget || e.target; el.disabled = true; try { await fn(e); } finally { el.disabled = false; } });
const section = (title, ...kids) => h('section', { class: 'card' }, h('h2', {}, title), ...kids);

export async function renderHome(root) {
  const hid = state.house.id, now = today(), me = state.user.id;
  const mods = new Map(state.modules.filter((m) => m.enabled !== false).map((m) => [m.id, m]));
  const taskMods = TASK_MODULES.filter((id) => mods.has(id));
  const tmr = new Date(now + 'T12:00'); tmr.setDate(tmr.getDate() + 1);
  const until = tmr.toLocaleDateString('sv');

  const [tasks, prods, open, ...hasMods] = await Promise.all([
    records.dueTasks(hid, [...taskMods, ...(mods.has('calendar') ? ['calendar'] : [])], until),
    mods.has('products') ? records.all(hid, 'products') : [],
    mods.has('shopping') ? records.open(hid, 'shopping') : [],
    ...taskMods.map((m) => records.has(hid, m)),
  ]);
  const used = new Set(taskMods.filter((_, i) => hasMods[i]));
  prods.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
  state.ids = new Set(tasks.map((t) => t.id));

  // ---- [Today: tasks + events, optionally only mine/unassigned] ----
  const todo = tasks.filter((t) => t.module !== 'calendar' || t.due >= now)
    .filter((t) => !ui.mine || !t.data?.who || t.data.who === me);
  const taskRow = (t) => {
    const m = mods.get(t.module), isEvent = t.module === 'calendar';
    return h('div', { class: `item${!isEvent && t.due < now ? ' late' : ''}` },
      !isEvent && h('input', { type: 'checkbox', 'aria-label': 'בוצע', onchange: busy(async () => {
        const nd = await completeTask(t);
        toast(nd ? `כל הכבוד! הבא: ${fmtDate(nd)}` : 'כל הכבוד!');
        state.refresh();
      }) }),
      h('a', { class: 'body', href: `#/${t.module}` },
        h('strong', {}, `${m?.icon || ''} ${t.data?.title || ''}`),
        h('div', { class: 'chips' },
          h('span', { class: `chip${t.due < now ? ' expired' : ''}` }, t.due < now ? `באיחור · ${fmtDate(t.due)}` : t.due === now ? 'היום' : 'מחר'),
          t.data?.time && h('span', { class: 'chip' }, t.data.time),
          t.data?.who && h('span', { class: 'chip' }, chipText({ t: 'member' }, t.data.who)),
          (t.data?.pet || t.data?.area) && h('span', { class: 'chip' }, t.data.pet || t.data.area))));
  };

  // ---- [Stock: expiry + restock suggestions not already on the list] ----
  const onList = new Set(open.map((r) => norm(r.data?.name)));
  const exp = prods.filter((p) => expiry(p, now));
  const restock = prods.filter((p) => needsRestock(p, now) && !onList.has(norm(p.data?.name)));
  const picks = new Set(restock.map((p) => p.id));
  const why = { 'נגמר': 'נגמר', 'נמוך': 'נמוך', cycle: 'לפי קצב הצריכה' };

  const name = memberName(me);
  root.replaceChildren(...[
    h('header', { class: 'bar' }, h('h1', {}, `🏠 ${name ? 'שלום ' + name : state.house.name}`),
      h('span', { class: 'hint' }, fmtDate(now))),

    h('div', { class: 'hero' },
      h('button', { class: 'hero-btn', onclick: guard(async () => (await import('./dice.js')).openDice()) },
        DICE_SVG(), h('span', {}, 'מה מבשלים?')),
      h('button', { class: 'hero-btn', onclick: guard(async () => (await import('./receipt.js')).scanReceipt()) },
        h('span', { class: 'big' }, '🧾'), h('span', {}, 'סריקת קבלה'))),

    h('div', { class: 'stats' },
      h('a', { href: '#/shopping' }, h('b', {}, String(open.length)), h('span', {}, 'ברשימת קניות')),
      h('a', { href: '#/products' }, h('b', { class: exp.length ? 'bad' : '' }, String(exp.length)), h('span', {}, 'תוקף קרוב')),
      h('span', {}, h('b', {}, String(todo.length)), h('span', {}, 'להיום ומחר'))),

    section('📋 היום ומחר',
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: ui.mine,
        onchange: (e) => { ui.mine = e.target.checked; state.refresh(); } }), 'רק שלי (ולא משויכים)'),
      h('div', { class: 'list' }, ...(todo.length ? todo.map(taskRow) : [h('p', { class: 'empty' }, 'אין משימות פתוחות 🎉')]))),

    exp.length > 0 && section('⚠️ תוקף',
      h('div', { class: 'list' }, ...exp.map((p) => h('a', { class: 'item late', href: '#/products' },
        h('strong', { class: 'grow' }, p.data?.name),
        h('span', { class: `chip ${expiry(p, now)}` }, `${expiry(p, now) === 'expired' ? 'פג' : 'עד'} ${fmtDate(p.due)}`))))),

    restock.length > 0 && section('🛒 כדאי לקנות',
      h('div', { class: 'list' }, ...restock.map((p) => h('label', { class: 'item' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? picks.add(p.id) : picks.delete(p.id)) }),
        h('span', { class: 'grow' }, p.data?.name), h('span', { class: 'chip soon' }, why[needsRestock(p, now)])))),
      h('button', { onclick: busy(async () => {
        const n = await addToShopping(restock.filter((p) => picks.has(p.id)).map((p) => ({ name: p.data.name, unit: p.data.unit })));
        toast(`נוספו ${n} פריטים לרשימת הקניות`); state.refresh();
      }) }, 'הוסף מסומנים לרשימה')),

    ...packs.filter((p) => taskMods.includes(p.module) && !used.has(p.module)).map((p) => section(`✨ ${p.label} — רשימה מומלצת`,
      h('p', { class: 'hint' }, 'נטען רשימה התחלתית עם תדירויות הגיוניות. אפשר לערוך, למחוק ולשייך לבני המשפחה.'),
      h('button', { class: 'ghost', onclick: busy(async () => {
        let pet;
        if (p.ask && !(pet = prompt(p.ask)?.trim())) return;
        await records.insertMany(packRows(p.module, hid, now, pet));
        toast('נטען! אפשר לשייך כל משימה לבן משפחה'); state.refresh();
      }) }, 'טען רשימה'))),
  ].filter(Boolean));
}
