// ===== GENERIC MODULE VIEW — list / calendar / gallery for any module definition =====
import { h, guard, modal, buildForm, valueOf, fmtDate, fmtMoney, toast } from '../core/ui.js';
import { records, photos } from '../core/api.js';
import { nextDue } from '../core/modules.js';
import { state } from '../core/state.js';

const today = () => new Date().toLocaleDateString('sv');

export async function renderModule(root, mod) {
  const rows = await records.list(state.house.id, mod.id, mod.order || 'created_at', !!mod.asc);
  const photoF = mod.fields.find((f) => f.t === 'photo');
  const urls = photoF ? await photos.urls(rows.map((r) => r.data?.[photoF.k]).filter(Boolean)) : {};
  const doneF = mod.fields.find((f) => f.col === 'done');
  if (doneF) rows.sort((a, b) => a.done - b.done);       // stable: open items first

  const list = h('div', { class: mod.view === 'gallery' ? 'gallery' : 'list' });
  const search = h('input', { type: 'search', placeholder: 'חיפוש…', class: 'search',
    oninput: () => paint(search.value.trim()) });
  let showPast = false;

  function paint(q = '') {
    let shown = q ? rows.filter((r) => JSON.stringify(r.data).includes(q)) : rows;
    if (mod.view === 'calendar' && !showPast) shown = shown.filter((r) => !r.due || r.due >= today());
    list.replaceChildren(...(shown.length ? (mod.view === 'gallery' ? shown.map(tile)
      : mod.view === 'calendar' ? grouped(shown) : shown.map(item)) : [h('p', { class: 'empty' }, 'אין עדיין פריטים')]));
  }

  const tile = (r) => h('button', { class: 'tile', onclick: () => edit(r) },
    h('img', { src: urls[r.data?.[photoF.k]] || '', alt: r.data?.caption || '', loading: 'lazy', decoding: 'async' }),
    r.data?.caption && h('span', {}, r.data.caption));

  function grouped(rs) {
    const out = []; let last;
    for (const r of rs) { if (r.due !== last) out.push(h('h3', { class: 'day' }, fmtDate(r.due) || 'ללא תאריך')); last = r.due; out.push(item(r)); }
    return out;
  }

  function item(r) {
    const [main, ...rest] = mod.fields.filter((f) => f.t !== 'check' && f.t !== 'photo' && f.t !== 'textarea');
    const chips = rest.map((f) => {
      const v = valueOf(r, f);
      return v != null && v !== '' && h('span', { class: 'chip' },
        f.t === 'money' ? fmtMoney(v) : f.t === 'date' ? fmtDate(v) : String(v));
    });
    const late = r.due && !r.done && r.due < today() && doneF;
    return h('div', { class: `item${r.done ? ' done' : ''}${late ? ' late' : ''}` },
      doneF && h('input', { type: 'checkbox', checked: r.done, 'aria-label': doneF.l, onchange: guard(() => toggle(r)) }),
      photoF && urls[r.data?.[photoF.k]] && h('img', { class: 'thumb', src: urls[r.data[photoF.k]], alt: '', loading: 'lazy' }),
      h('button', { class: 'body', onclick: () => edit(r) },
        h('strong', {}, String(valueOf(r, main) ?? '')), h('div', { class: 'chips' }, chips)));
  }

  // Repeating tasks roll their due date forward instead of being closed.
  async function toggle(r) {
    const nd = !r.done && nextDue(r.due, r.data?.repeat);
    await records.upsert(nd ? { id: r.id, household_id: state.house.id, module: mod.id, due: nd, done: false }
      : { id: r.id, household_id: state.house.id, module: mod.id, done: !r.done });
    if (nd) toast(`הועבר ל־${fmtDate(nd)}`);
    state.refresh();
  }

  function edit(r = { data: {} }) {
    const form = buildForm(mod.fields, r);
    const dlg = modal(r.id ? 'עריכה' : 'הוספה', form, [
      r.id && h('button', { class: 'danger', type: 'button', onclick: guard(async () => {
        if (!confirm('למחוק?')) return;
        await records.remove(r.id);
        if (photoF && r.data?.[photoF.k]) photos.remove([r.data[photoF.k]]);
        dlg.close(); state.refresh();
      }) }, 'מחיקה'),
      h('button', { type: 'submit', form: (form.id = 'f' + Date.now()) }, 'שמירה'),
    ]);
    form.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const btn = dlg.querySelector('[type=submit]'); btn.disabled = true;
      try { await save(r, form); dlg.close(); state.refresh(); } finally { btn.disabled = false; }
    }));
  }

  async function save(r, form) {
    const row = { household_id: state.house.id, module: mod.id, data: { ...r.data } };
    if (r.id) row.id = r.id;
    const old = [];
    for (const f of mod.fields) {
      const el = form.elements[f.k];
      let v = f.t === 'check' ? el.checked : f.t === 'photo' ? el.files[0] : el.value.trim();
      if (f.t === 'photo') {
        if (!v) { if (f.req && !r.data?.[f.k]) throw new Error('חובה לבחור תמונה'); continue; }
        if (r.data?.[f.k]) old.push(r.data[f.k]);
        v = await photos.upload(state.house.id, v);
      } else if (f.t === 'number' || f.t === 'money') v = v === '' ? null : Number(v);
      else if (v === '') v = null;
      if (f.col) row[f.col] = f.col === 'done' ? !!v : v; else row.data[f.k] = v;
    }
    await records.upsert(row);
    photos.remove(old);                                  // only after the new row is saved
  }

  // ---- header: monthly total, past toggle, search, add ----
  const month = today().slice(0, 7);
  const total = mod.sum && rows.filter((r) => (r.due || r.created_at).startsWith(month)).reduce((s, r) => s + (+r.amount || 0), 0);
  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, `${mod.icon || ''} ${mod.title}`),
      h('button', { class: 'fab', 'aria-label': 'הוספה', onclick: () => edit() }, '+')),
    mod.sum && h('div', { class: 'stat' }, 'החודש: ', h('b', {}, fmtMoney(total))),
    h('div', { class: 'row' }, search, mod.view === 'calendar' && h('label', { class: 'inline' },
      h('input', { type: 'checkbox', onchange: (e) => { showPast = e.target.checked; paint(search.value.trim()); } }), 'הצג עבר')),
    list);
  paint();
}
