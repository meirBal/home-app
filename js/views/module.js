// ===== GENERIC MODULE VIEW — list / calendar / gallery for any module definition =====
import { h, guard, modal, buildForm, valueOf, fmtDate, fmtMoney, toast, today } from '../core/ui.js';
import { records, photos, thumbOf } from '../core/api.js';
import { nextDue } from '../core/modules.js';
import { state } from '../core/state.js';
import { PAGE } from '../config.js';

const ui = {};                                         // per-module UI memory (search text, past toggle) survives refreshes

export async function renderModule(root, mod) {
  const hid = state.house.id, now = today(), my = (ui[mod.id] ||= { q: '', past: false });
  const photoF = mod.fields.find((f) => f.t === 'photo');
  const doneF = mod.fields.find((f) => f.col === 'done');
  const [main, ...rest] = mod.fields.filter((f) => !['check', 'photo', 'textarea'].includes(f.t));
  const month = now.slice(0, 7), [y, m] = month.split('-').map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m % 12 + 1).padStart(2, '0')}-01`;

  const [rows, total] = await Promise.all([
    records.list(hid, mod.id, { order: mod.order, asc: !!mod.asc, hasDone: !!doneF,
      from: mod.view === 'calendar' && !my.past ? now : null }),
    mod.sum && records.sum(hid, mod.id, `${month}-01`, nextMonth),
  ]);
  state.ids = new Set(rows.map((r) => r.id));
  const thumbs = photoF ? await photos.urls(rows.map((r) => r.data?.[photoF.k]).filter(Boolean).map(thumbOf)) : {};
  const thumb = (r) => r.data?.[photoF?.k] && thumbs[thumbOf(r.data[photoF.k])];
  for (const r of rows) r._s = JSON.stringify(r.data);  // search index built once

  const list = h('div', { class: mod.view === 'gallery' ? 'gallery' : 'list' });
  let deb;
  const search = h('input', { type: 'search', placeholder: 'חיפוש…', class: 'search', value: my.q,
    oninput: () => { clearTimeout(deb); deb = setTimeout(() => { my.q = search.value.trim(); paint(); }, 200); } });

  function paint() {
    const shown = my.q ? rows.filter((r) => r._s.includes(my.q)) : rows;
    list.replaceChildren(...(!shown.length ? [h('p', { class: 'empty' }, 'אין עדיין פריטים')]
      : mod.view === 'gallery' ? shown.map(tile) : mod.view === 'calendar' ? grouped(shown) : shown.map(item)));
  }

  const tile = (r) => h('button', { class: 'tile', onclick: () => edit(r) },
    h('img', { src: thumb(r) || '', alt: r.data?.caption || '', loading: 'lazy', decoding: 'async' }),
    r.data?.caption && h('span', {}, r.data.caption));

  function grouped(rs) {
    const out = []; let last;
    for (const r of rs) { if (r.due !== last) out.push(h('h3', { class: 'day' }, fmtDate(r.due) || 'ללא תאריך')); last = r.due; out.push(item(r)); }
    return out;
  }

  function item(r) {
    const chips = rest.map((f) => {
      const v = valueOf(r, f);
      return v != null && v !== '' && h('span', { class: 'chip' }, f.t === 'money' ? fmtMoney(v) : f.t === 'date' ? fmtDate(v) : String(v));
    });
    const late = doneF && r.due && !r.done && r.due < now;
    return h('div', { class: `item${r.done ? ' done' : ''}${late ? ' late' : ''}` },
      doneF && h('input', { type: 'checkbox', checked: r.done, 'aria-label': doneF.l,
        onchange: guard(async (e) => { e.target.disabled = true; try { await toggle(r); } finally { e.target.disabled = false; } }) }),
      thumb(r) && h('img', { class: 'thumb', src: thumb(r), alt: '', loading: 'lazy' }),
      h('button', { class: 'body', onclick: () => edit(r) },
        h('strong', {}, String(valueOf(r, main) ?? '')), h('div', { class: 'chips' }, chips)));
  }

  // Repeating tasks roll their due date forward instead of being closed.
  async function toggle(r) {
    const nd = !r.done && nextDue(r.due, r.data?.repeat, now);
    await records.update(r.id, nd ? { due: nd, done: false } : { done: !r.done });
    if (nd) toast(`הועבר ל־${fmtDate(nd)}`);
    state.refresh();
  }

  async function edit(r = { data: {} }) {
    const form = buildForm(mod.fields, r);
    form.id = 'f' + Date.now();
    if (photoF && r.data?.[photoF.k]) {                // full-size image only when opened
      const p = r.data[photoF.k], u = (await photos.urls([p]))[p];
      if (u) form.prepend(h('img', { class: 'preview', src: u, alt: '' }));
    }
    const dlg = modal(r.id ? 'עריכה' : 'הוספה', form, [
      r.id && h('button', { class: 'danger', type: 'button', onclick: guard(async () => {
        if (!confirm('למחוק?')) return;
        await records.remove(r.id);
        if (photoF && r.data?.[photoF.k]) await photos.remove([r.data[photoF.k]]);
        dlg.close(); state.refresh();
      }) }, 'מחיקה'),
      h('button', { type: 'submit', form: form.id }, 'שמירה'),
    ]);
    form.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const btn = dlg.querySelector('[type=submit]'); btn.disabled = true;
      try { await save(r, form); dlg.close(); state.refresh(); } finally { btn.disabled = false; }
    }));
  }

  async function save(r, form) {
    const data = { ...r.data }, cols = {}, added = [], old = [];
    try {
      for (const f of mod.fields) {
        const el = form.elements[f.k];
        let v = f.t === 'check' ? el.checked : f.t === 'photo' ? el.files[0] : el.value.trim();
        if (f.t === 'photo') {
          if (!v) { if (f.req && !r.data?.[f.k]) throw new Error('חובה לבחור תמונה'); continue; }
          if (r.data?.[f.k]) old.push(r.data[f.k]);
          v = await photos.upload(hid, v); added.push(v);
        } else if (f.t === 'number' || f.t === 'money') v = v === '' ? null : Number(v);
        else if (v === '') v = null;
        if (f.col) cols[f.col] = f.col === 'done' ? !!v : v; else data[f.k] = v;
      }
      await (r.id ? records.update(r.id, { ...cols, data }) : records.insert({ household_id: hid, module: mod.id, ...cols, data }));
    } catch (e) { await photos.remove(added).catch(() => {}); throw e; }   // no orphan files on failure
    photos.remove(old).catch(() => {});                                    // replaced photos: only after save
  }

  // ---- header: monthly total, past toggle, search, add ----
  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, `${mod.icon || ''} ${mod.title}`),
      h('button', { class: 'fab', 'aria-label': 'הוספה', onclick: guard(() => edit({ data: {}, due: mod.sum ? now : null })) }, '+')),
    mod.sum && h('div', { class: 'stat' }, 'החודש: ', h('b', {}, fmtMoney(total))),
    h('div', { class: 'row' }, search, mod.view === 'calendar' && h('label', { class: 'inline' },
      h('input', { type: 'checkbox', checked: my.past, onchange: (e) => { my.past = e.target.checked; state.refresh(); } }), 'הצג עבר')),
    list,
    rows.length === PAGE && h('p', { class: 'hint' }, `מוצגים ${PAGE} הפריטים הראשונים`));
  paint();
}
