// ===== GENERIC MODULE VIEW — list / calendar / gallery / shopping (by aisle) / warranty for any module =====
import { h, guard, modal, buildForm, valueOf, fmtDate, fmtMoney, chipText, toast, today, groupBy } from '../core/ui.js';
import { records, photos, thumbOf, house } from '../core/api.js';
import { completeTask, afterToggle, setStatus, expiry, needsRestock, guess, addToShopping, norm,
  warrantyEnd, warrantyState } from '../core/smart.js';
import { CATEGORIES } from '../core/modules.js';
import { state } from '../core/state.js';
import { PAGE } from '../config.js';

const ui = {};                                         // per-module UI memory (search text, past toggle) survives refreshes
const buzz = () => navigator.vibrate?.(12);            // light haptic confirmation where supported

export async function renderModule(root, mod) {
  const hid = state.house.id, now = today(), my = (ui[mod.id] ||= { q: '', past: false });
  const photoFs = mod.fields.filter((f) => f.t === 'photo'), photoF = photoFs[0];
  const doneF = mod.fields.find((f) => f.col === 'done');
  const [main, ...rest] = mod.fields.filter((f) => !['check', 'photo', 'textarea'].includes(f.t));
  const month = now.slice(0, 7), [y, m] = month.split('-').map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m % 12 + 1).padStart(2, '0')}-01`;
  const isShop = mod.view === 'shopping', isProducts = mod.id === 'products', isWarranty = mod.view === 'warranty';

  const [rows, total, spent, prods] = await Promise.all([
    records.list(hid, mod.id, { order: mod.order, asc: !!mod.asc, hasDone: !!doneF,
      from: mod.view === 'calendar' && !my.past ? now : null }),
    mod.sum && records.sum(hid, mod.id, `${month}-01`, nextMonth),
    isShop && state.house.settings?.budget && records.sum(hid, 'expenses', `${month}-01`, nextMonth, 'קניות שבועיות'),
    isShop && records.all(hid, 'products'),             // quick-add suggestions
  ]);
  state.ids = new Set(rows.map((r) => r.id));
  const thumbs = photoF ? await photos.urls(rows.map((r) => r.data?.[photoF.k]).filter(Boolean).map(thumbOf)) : {};
  const thumb = (r) => r.data?.[photoF?.k] && thumbs[thumbOf(r.data[photoF.k])];
  for (const r of rows) r._s = JSON.stringify(r.data);  // search index built once
  if (rows.length <= 8) my.q = '';                      // search box is hidden on short lists

  const list = h('div', { class: mod.view === 'gallery' ? 'gallery' : 'list' });
  let deb;
  const search = h('input', { type: 'search', placeholder: 'חיפוש…', class: 'search', value: my.q,
    oninput: () => { clearTimeout(deb); deb = setTimeout(() => { my.q = search.value.trim(); paint(); }, 200); } });
  const empty = (t) => h('p', { class: 'empty' }, t || 'אין עדיין פריטים — לחצו + כדי להוסיף');

  function paint() {
    const shown = my.q ? rows.filter((r) => r._s.includes(my.q)) : rows;
    list.replaceChildren(...(!shown.length ? [empty(isShop && 'הרשימה ריקה — הוסיפו פריט בשורה למעלה')]
      : mod.view === 'gallery' ? shown.map(tile) : mod.view === 'calendar' ? byDay(shown)
        : isShop ? byAisle(shown) : isWarranty ? byWarranty(shown) : shown.map(item)).filter(Boolean));
  }

  const tile = (r) => h('button', { class: 'tile', onclick: () => edit(r) },
    h('img', { src: thumb(r) || '', alt: r.data?.caption || '', loading: 'lazy', decoding: 'async' }),
    r.data?.caption && h('span', {}, r.data.caption));

  function byDay(rs) {
    const out = []; let last;
    for (const r of rs) { if (r.due !== last) out.push(h('h3', { class: 'day' }, fmtDate(r.due) || 'ללא תאריך')); last = r.due; out.push(item(r)); }
    return out;
  }

  // ---- [Shopping: open items grouped in supermarket order; bought items folded at the bottom] ----
  function byAisle(rs) {
    const open = rs.filter((r) => !r.done), done = rs.filter((r) => r.done);
    const groups = groupBy(open, (r) => (CATEGORIES.includes(r.data?.category) ? r.data.category : 'אחר'));
    return [
      ...CATEGORIES.filter((c) => groups.has(c)).flatMap((c) => [h('h3', { class: 'day' }, `${c} · ${groups.get(c).length}`), ...groups.get(c).map(item)]),
      done.length > 0 && h('details', { class: 'bought', open: my.open, ontoggle: (e) => (my.open = e.target.open) },
        h('summary', {}, `✓ נקנו (${done.length})`), ...done.map(item)),
    ];
  }

  // ---- [Warranty: ending soon first, active, then expired (folded)] ----
  function byWarranty(rs) {
    const st = new Map(rs.map((r) => [r.id, warrantyState(r, now)]));
    const pick = (c) => rs.filter((r) => st.get(r.id)?.cls === c);
    const soon = pick('soon'), ok = pick('ok'), gone = pick('expired'), none = rs.filter((r) => !st.get(r.id));
    return [
      soon.length > 0 && h('h3', { class: 'day' }, `⚠️ נגמרת בחודש הקרוב · ${soon.length}`), ...soon.map(item),
      ok.length > 0 && h('h3', { class: 'day' }, `🛡️ בתוקף · ${ok.length}`), ...ok.map(item),
      none.length > 0 && h('h3', { class: 'day' }, 'ללא תאריך קנייה'), ...none.map(item),
      gone.length > 0 && h('details', { class: 'bought' }, h('summary', {}, `הסתיימה (${gone.length})`), ...gone.map(item)),
    ];
  }

  const SKIP = new Set(isProducts ? ['status', 'bought', 'cycle', 'warranty'] : isShop ? ['category'] : isWarranty ? ['bought', 'months', 'serial', 'store'] : []);

  function item(r) {
    const exp = isProducts && expiry(r, now), ws = isWarranty && warrantyState(r, now);
    const chips = rest.filter((f) => !SKIP.has(f.k) && f.k !== 'unit').map((f) => {
      let t = chipText(f, valueOf(r, f));
      if (t && f.k === 'qty' && r.data?.unit) t += ' ' + r.data.unit;      // "2 ק״ג" as one chip
      if (t && isShop && f.k === 'amount') t = '~' + t;
      return t && h('span', { class: `chip${f.col === 'due' && (exp || ws) ? ' ' + (exp || ws.cls) : ''}` }, t);
    });
    if (ws) chips.unshift(h('span', { class: `chip ${ws.cls}` }, ws.text));
    if (isProducts && needsRestock(r, now) === 'cycle') chips.push(h('span', { class: 'chip soon' }, 'כנראה נגמר'));
    if (isProducts && r.data?.warranty) chips.push(h('a', { class: 'chip', href: '#/warranty' }, '🛡️ אחריות'));
    const late = doneF && r.due && !r.done && r.due < now;
    return h('div', { class: `item${r.done ? ' done' : ''}${late || exp === 'expired' ? ' late' : ''}` },
      doneF && h('input', { type: 'checkbox', checked: r.done, 'aria-label': doneF.l,
        onchange: guard(async (e) => { e.target.disabled = true; try { await toggle(r); } finally { e.target.disabled = false; } }) }),
      thumb(r) && h('img', { class: 'thumb', src: thumb(r), alt: '', loading: 'lazy' }),
      h('button', { class: 'body', onclick: () => edit(r) },
        h('strong', {}, String(valueOf(r, main) ?? '')), h('div', { class: 'chips' }, chips)),
      isProducts && statusBar(r));
  }

  // Products: one-tap status; empty/low adds to the shopping list. Updates in place (no list reload).
  const statusBar = (r) => {
    const bar = h('div', { class: 'seg', role: 'group', 'aria-label': 'מצב' },
      ...['מלא', 'נמוך', 'נגמר'].map((st) => h('button', { type: 'button', class: r.data?.status === st ? 'on' : '',
        onclick: guard(async () => {
          bar.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try { const msg = await setStatus(r, st); buzz(); if (msg) toast(msg); }
          finally { bar.replaceWith(statusBar(r)); }
        }) }, st)));
    return bar;
  };

  async function toggle(r) {
    buzz();
    const msg = await afterToggle(mod, r);              // shopping ✓ → stock updated
    const nd = await completeTask(r, mod.id);           // repeating tasks roll forward
    if (nd) toast(`הועבר ל־${fmtDate(nd)}`); else if (msg) toast(msg);
    state.refresh();
  }

  async function edit(r = { data: {} }) {
    const form = buildForm(mod.fields, r);
    form.id = 'f' + Date.now();
    const shots = photoFs.map((f) => r.data?.[f.k]).filter(Boolean);           // full-size images only when opened
    if (shots.length) {
      const urls = await photos.urls(shots);
      form.prepend(h('div', { class: 'previews' }, ...shots.map((p) => urls[p] && h('a', { href: urls[p], target: '_blank', rel: 'noopener' },
        h('img', { class: 'preview', src: urls[p], alt: '' })))));
    }
    const dlg = modal(r.id ? 'עריכה' : 'הוספה', form, [
      r.id && h('button', { class: 'danger', type: 'button', onclick: guard(async () => { await remove(r); dlg.close(); }) }, 'מחיקה'),
      h('button', { type: 'submit', form: form.id }, 'שמירה'),
    ]);
    form.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const btn = dlg.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const next = await save(r, form);
        dlg.close();
        if (next) location.hash = next; else state.refresh();   // navigate only after this dialog is gone
      } finally { btn.disabled = false; }
    }));
  }

  // Delete with Undo: the row is restored as-is; its photos are deleted only after the undo window closes.
  async function remove(r) {
    await records.remove(r.id);
    const files = photoFs.map((f) => r.data?.[f.k]).filter(Boolean);
    state.refresh();
    toast('נמחק', false, { label: 'ביטול', fn: guard(async () => {
      await records.insert({ id: r.id, household_id: hid, module: mod.id, data: r.data, due: r.due ?? null, amount: r.amount ?? null,
        done: !!r.done, created_at: r.created_at });
      state.refresh();
    }), done: () => photos.remove(files).catch(() => {}) });
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
      if (isProducts && (!data.cycle || !data.category)) {   // smart defaults from the name
        const g = guess(data.name);
        data.cycle ||= g.cycle || 'ללא';
        data.category ||= g.category;
        data.bought ||= now;
      }
      if (isShop && !data.category) data.category = guess(data.name).category || 'אחר';
      if (isWarranty && (!cols.due || cols.due === r.due)) cols.due = warrantyEnd(data.bought, data.months) || cols.due;   // auto unless typed
      await (r.id ? records.update(r.id, { ...cols, data }) : records.insert({ household_id: hid, module: mod.id, ...cols, data }));
    } catch (e) { await photos.remove(added).catch(() => {}); throw e; }   // no orphan files on failure
    photos.remove(old).catch(() => {});                                    // replaced photos: only after save
    if (isProducts && data.warranty && !r.data?.warranty) {                // "has warranty" → open a prefilled warranty card
      state.prefill = { module: 'warranty', data: { name: data.name, bought: data.bought || now }, amount: cols.amount ?? null };
      return '#/warranty';
    }
  }

  // ---- [Shopping extras: quick add (text/voice), estimate & budget, WhatsApp, clear bought] ----
  function quickAdd() {
    const dl = h('datalist', { id: 'sugg-shop' });
    const fill = () => {                                 // suggestions built on first focus only
      if (dl.childElementCount) return;
      const names = [...new Set([...(prods || []).map((p) => p.data?.name), ...rows.map((r) => r.data?.name)].filter(Boolean))];
      dl.append(...names.slice(0, 300).map((n) => h('option', { value: n })));
    };
    const inp = h('input', { list: 'sugg-shop', placeholder: 'מה להוסיף? (למשל: 2 ק״ג עגבניות)', enterKeyHint: 'done', autocomplete: 'off', onfocus: fill });
    const add = guard(async (text) => {
      const items = String(text).split(SPLIT).map(parseLine).filter(Boolean);
      if (!items.length) return;
      const n = await addToShopping(items, 'עכשיו', prods);
      buzz(); inp.value = '';
      toast(n ? (n > 1 ? `נוספו ${n} פריטים` : 'נוסף') : 'כבר ברשימה');
      state.refresh();
    });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const VOICE_ERR = { 'not-allowed': 'אין הרשאה למיקרופון', 'no-speech': 'לא נשמע דיבור', network: 'אין חיבור לזיהוי דיבור' };
    const mic = SR && h('button', { type: 'button', class: 'ghost', 'aria-label': 'הוספה בקול', onclick: (e) => {
      const btn = e.currentTarget;
      try {
        const rec = new SR(); rec.lang = 'he-IL'; rec.interimResults = false;
        rec.onresult = (ev) => add(ev.results[0][0].transcript);
        rec.onerror = (ev) => toast(VOICE_ERR[ev.error] || 'לא הצלחתי לשמוע', true);
        rec.onend = () => (btn.disabled = false);
        btn.disabled = true; rec.start(); toast('🎤 מקשיב… אמרו למשל "חלב, ביצים ולחם"');
      } catch { btn.disabled = false; toast('הקלטה קולית לא זמינה כאן', true); }
    } }, '🎤');
    return h('form', { class: 'quick', onsubmit: (e) => { e.preventDefault(); add(inp.value); } }, inp, dl, mic,
      h('button', { type: 'submit', 'aria-label': 'הוספה' }, '+'));
  }

  function shopSummary() {
    const open = rows.filter((r) => !r.done), est = open.reduce((s, r) => s + (+r.amount || 0), 0);
    const unknown = open.filter((r) => r.amount == null).length, budget = +state.house.settings?.budget || 0;
    const left = budget - (+spent || 0);
    return h('section', { class: 'card shop-sum' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, `${open.length} פריטים · משוער ${fmtMoney(est)}`),
        unknown > 0 && h('span', { class: 'hint' }, `${unknown} ללא מחיר`)),
      budget > 0 && h('div', {},
        h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, ((+spent || 0) / budget) * 100)}%` })),
        h('p', { class: `hint${left - est < 0 ? ' bad-t' : ''}` }, `תקציב קניות החודש ${fmtMoney(budget)} · נוצל ${fmtMoney(spent)} · נותר ${fmtMoney(left)}`
          + (est ? ` · אחרי הקנייה הזו: ${fmtMoney(left - est)}` : ''))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'share-wa', onclick: () => share(waText(open, est)) }, '📤 שליחה בוואטסאפ'),
        rows.some((r) => r.done) && h('button', { class: 'ghost', onclick: guard(async () => {
          if (!confirm('למחוק מהרשימה את כל מה שנקנה?')) return;
          const files = rows.filter((r) => r.done).flatMap((r) => photoFs.map((f) => r.data?.[f.k])).filter(Boolean);
          await records.removeDone(hid, 'shopping'); photos.remove(files).catch(() => {}); state.refresh();
        }) }, '🧹 נקה נקנו'),
        state.role === 'admin' && h('button', { class: 'ghost', onclick: guard(async () => {
          const v = prompt('תקציב קניות חודשי (₪). ההוצאות נספרות מקטגוריית "קניות שבועיות"', budget || '');
          if (v === null) return;
          const settings = { ...state.house.settings, budget: Math.max(0, +v || 0) };
          await house.saveSettings(hid, settings); state.house.settings = settings; state.refresh();
        }) }, budget ? 'עריכת תקציב' : '💰 קביעת תקציב')));
  }

  const waText = (open, est) => {
    const g = groupBy(open, (r) => (CATEGORIES.includes(r.data?.category) ? r.data.category : 'אחר'));
    return `🛒 *רשימת קניות — ${state.house.name}*\n` + CATEGORIES.filter((c) => g.has(c)).map((c) => `\n*${c}*\n`
      + g.get(c).map((r) => `☐ ${r.data.name}${r.data.qty ? ` (${r.data.qty}${r.data.unit ? ' ' + r.data.unit : ''})` : ''}`).join('\n')).join('\n')
      + (est ? `\n\nסה״כ משוער: ${fmtMoney(est)}` : '');
  };

  // ---- header + layout ----
  root.replaceChildren(...[
    h('header', { class: 'bar' }, h('h1', {}, `${mod.icon || ''} ${mod.title}`),
      h('div', { class: 'row' },
        mod.id === 'recipes' && h('a', { class: 'btn ghost', href: '#/library' }, '📚 מאגר'),
        h('button', { class: 'fab', 'aria-label': 'הוספה', onclick: guard(() => edit({ data: {}, due: mod.sum ? now : null })) }, '+'))),
    isShop && quickAdd(),
    isShop && shopSummary(),
    mod.sum && h('div', { class: 'stat' }, 'החודש: ', h('b', {}, fmtMoney(total))),
    rows.length > 8 && h('div', { class: 'row' }, search, mod.view === 'calendar' && h('label', { class: 'inline' },
      h('input', { type: 'checkbox', checked: my.past, onchange: (e) => { my.past = e.target.checked; state.refresh(); } }), 'הצג עבר')),
    list,
    rows.length === PAGE && h('p', { class: 'hint' }, `מוצגים ${PAGE} הפריטים הראשונים`)].filter(Boolean));
  paint();

  if (state.prefill?.module === mod.id) { const pf = state.prefill; state.prefill = null; edit({ data: pf.data, amount: pf.amount }); }
}

// Split a typed/spoken list on commas and on the conjunction ו — but not inside words that start with ו
const SPLIT = /\s*[,،\n]\s*|\s+ו(?!(?:ניל|ופל|רד|יטמין|ודקה|אפל|ופלים|ורדים)(?:\s|$))(?=\S{2,})/;
// Native share sheet when available (WhatsApp is one tap away); wa.me link as fallback
export function share(text) {
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  window.open('https://wa.me/?text=' + encodeURIComponent(text.slice(0, 3500)), '_blank', 'noopener');
}

// "2 ק״ג עגבניות" / "עגבניות 2" / "חלב" → {name, qty, unit}
const UNIT_RE = '(יח׳|יח\'|ק״ג|ק"ג|קילו|גרם|ליטר|מ״ל|מ"ל|אריזה|אריזות)';
const UNIT_FIX = { "יח'": 'יח׳', 'ק"ג': 'ק״ג', 'קילו': 'ק״ג', 'מ"ל': 'מ״ל', 'אריזות': 'אריזה' };
function parseLine(s) {
  s = norm(s);
  if (!s) return null;
  let m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}?\\s+(.+)$`));
  if (m) return { qty: +m[1], unit: UNIT_FIX[m[2]] || m[2] || null, name: m[3] };
  m = s.match(new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}?$`));
  if (m) return { name: m[1], qty: +m[2], unit: UNIT_FIX[m[3]] || m[3] || null };
  return { name: s };
}
