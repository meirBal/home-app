// ===== SHOPPING CATALOG 📋 — every product the house knows (+ basics) by aisle → pick what's needed now, with quantity =====
import { h, guard, modal, toast, groupBy } from '../core/ui.js';
import { records } from '../core/api.js';
import { addToShopping, tokens, similar, guess, norm, needsRestock } from '../core/smart.js';
import { CATEGORIES, UNITS } from '../core/modules.js';
import { BASICS } from '../data/seeds.js';
import { state } from '../core/state.js';

const aisle = (c) => (CATEGORIES.includes(c) ? c : 'אחר');
const STEP = { 'ק״ג': 0.5, 'ליטר': 0.5, 'גרם': 100, 'מ״ל': 100 };            // others: 1
const step = (e) => STEP[e.unit] || 1;

// rows = shopping rows on screen (their open items are the list), prods = products module rows
export async function openCatalog(rows, prods = []) {
  const hid = state.house.id, history = await records.all(hid, 'shopping');   // full history, not just the screen page
  // ---- [Entries: open list items first (one entry per item), then own products, history, basics — no near-duplicates] ----
  const entries = [];
  const add = (name, unit, category, extra) => {
    name = norm(name);
    if (!name) return;
    const t = tokens(name);
    if (entries.some((e) => similar(e.t, t))) return;
    const e = { name, t, unit: UNITS.includes(unit) ? unit : 'יח׳', category: aisle(category || guess(name).category), qty: 0, ...extra };
    e.was = e.qty; e.unit0 = e.unit;                                   // baseline → only real edits count as changes
    entries.push(e);
    return e;
  };
  for (const r of rows) if (!r.done) add(r.data?.name, r.data?.unit, r.data?.category, { row: r, qty: +r.data?.qty || 1 });
  for (const p of prods) add(p.data?.name, p.data?.unit, p.data?.category, { need: needsRestock(p) });
  for (const r of history) add(r.data?.name, r.data?.unit, r.data?.category);
  for (const [n, u] of BASICS) add(n, u);

  // ---- [Row: tap name = toggle, − / qty / + stepper, unit picker; built once, re-used by search] ----
  const changed = () => entries.filter((e) => e.qty !== e.was || (e.row && e.qty && e.unit !== e.unit0));
  const sync = () => { const n = changed().length; save.textContent = n ? `עדכון הרשימה (${n})` : 'עדכון הרשימה'; save.disabled = !n; };
  function row(e) {
    const q = h('input', { class: 'num', type: 'number', inputMode: 'decimal', min: 0, step: 'any', 'aria-label': `כמות ${e.name}`,
      oninput: () => set(Math.max(0, +q.value || 0), false) });
    const tap = h('button', { type: 'button', class: 'body', onclick: () => set(e.qty ? 0 : e.was || step(e)) },
      h('strong', {}, e.name), e.row ? h('span', { class: 'chip ok' }, 'ברשימה') : e.need && h('span', { class: 'chip soon' }, 'כדאי לקנות'));
    const el = h('div', { class: 'item cat' }, tap,
      h('div', { class: 'stepper' },
        h('button', { type: 'button', class: 'ghost', 'aria-label': `פחות ${e.name}`, onclick: () => set(Math.max(0, e.qty - step(e))) }, '−'), q,
        h('button', { type: 'button', class: 'ghost', 'aria-label': `עוד ${e.name}`, onclick: () => set(e.qty + step(e)) }, '+')),
      h('select', { 'aria-label': `יחידה ${e.name}`, onchange: (ev) => { e.unit = ev.target.value; sync(); } },
        ...UNITS.map((u) => h('option', { value: u, selected: u === e.unit }, u))));
    function set(v, write = true, quiet) {
      e.qty = Math.round(v * 100) / 100;
      if (write) q.value = e.qty || '';
      el.classList.toggle('sel', e.qty > 0); tap.setAttribute('aria-pressed', e.qty > 0);
      if (!quiet) sync();
    }
    set(e.qty, true, true);
    return el;
  }

  // ---- [List: search (debounced, stem-aware) filters cached rows; unknown name → "add new" row] ----
  const list = h('div', { class: 'list' });
  const els = new Map();
  let deb;
  const search = h('input', { type: 'search', placeholder: 'חיפוש או מוצר חדש…', class: 'search',
    oninput: () => { clearTimeout(deb); deb = setTimeout(paint, 200); } });
  function paint() {
    const q = norm(search.value), qt = tokens(q);
    const shown = q ? entries.filter((e) => e.name.includes(q) || similar(e.t, qt)) : entries;
    const g = groupBy(shown, (e) => e.category);
    const fresh = q && !shown.some((e) => similar(e.t, qt));
    list.replaceChildren(...[
      fresh && h('button', { type: 'button', class: 'ghost', onclick: () => {
        const e = add(q); e.qty = 1; search.value = ''; paint(); els.get(e)?.scrollIntoView({ block: 'center' });
      } }, `➕ הוספת "${q}" לקטלוג`),
      ...CATEGORIES.filter((c) => g.has(c)).flatMap((c) => [h('h3', { class: 'day' }, c),
        ...g.get(c).map((e) => els.get(e) || els.set(e, row(e)).get(e))])].filter(Boolean));
    sync();
  }

  // ---- [Apply: new picks → list (aisle/price filled by addToShopping); changed qty → patch; 0 → removed, with undo] ----
  const save = h('button', { type: 'button', onclick: guard(async () => {
    save.disabled = true;
    try {
      const ch = changed(), fresh = ch.filter((e) => !e.row && e.qty), upd = ch.filter((e) => e.row && e.qty), gone = ch.filter((e) => e.row && !e.qty);
      const n = fresh.length ? await addToShopping(fresh.map(({ name, qty, unit, category }) => ({ name, qty, unit, category })), 'עכשיו', prods) : 0;
      await Promise.all([...upd.map((e) => records.patch(e.row.id, { qty: e.qty, unit: e.unit })), ...gone.map((e) => records.remove(e.row.id))]);
      dlg.close();
      const msg = [n && `נוספו ${n}`, upd.length && `עודכנו ${upd.length}`, gone.length && `הוסרו ${gone.length}`].filter(Boolean).join(' · ') || 'כבר ברשימה';
      toast(msg, false, gone.length && { label: 'ביטול הסרה', fn: guard(async () => {
        await records.insertMany(gone.map(({ row: r }) => ({ id: r.id, household_id: hid, module: 'shopping', data: r.data, amount: r.amount ?? null,
          due: r.due ?? null, done: false, created_at: r.created_at })));
        state.refresh();
      }) });
      state.refresh();
    } finally { save.disabled = false; }
  }) });

  const dlg = modal('📋 קטלוג מוצרים', h('div', { class: 'form' },
    h('p', { class: 'hint' }, 'סמנו מה צריך עכשיו ובחרו כמות. מה שכבר ברשימה מסומן — אפשר לשנות כמות או לאפס כדי להסיר.'),
    search, list), [save]);
  dlg.classList.add('catalog');
  paint();
}
