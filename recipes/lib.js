// ===== RECIPE LIBRARY — shared by the public recipe site and the app (no dependencies) =====
// Data: ./data/index.json (compact, for search/filter/matching) + ./data/batch-*.json (full recipes, loaded on open)

const BASE = new URL('./data/', import.meta.url);
export const MEALS = { b: 'בוקר', l: 'צהריים', d: 'ערב' };
export const HUNGER = { L: 'קליל', H: 'רעב', V: 'רעב מאוד' };
export const DIFF = { 1: 'קל', 2: 'בינוני', 3: 'מאתגר' };
const KOSHER_CLS = { 'פרווה': 'k-p', 'חלבי': 'k-d', 'בשרי': 'k-m' };

// ---- [Data: index once per session, batches on demand] ----
let indexP;
const batches = new Map();
export const loadIndex = () => (indexP ||= fetch(new URL('index.json', BASE)).then((r) => {
  if (!r.ok) throw new Error('לא ניתן לטעון את מאגר המתכונים');
  return r.json();
}).catch((e) => { indexP = null; throw e; }));
export async function loadRecipe(id) {
  const meta = (await loadIndex()).find((r) => r.id === id);
  if (!meta) return null;
  if (!batches.has(meta.b)) batches.set(meta.b, fetch(new URL(`batch-${meta.b}.json`, BASE)).then((r) => {
    if (!r.ok) throw new Error('לא ניתן לטעון את המתכון');
    return r.json();
  }).catch((e) => { batches.delete(meta.b); throw e; }));   // a failed (offline) load can be retried
  return (await batches.get(meta.b)).find((r) => r.id === id) || null;
}

// ---- [Scaling: any number of servings, kitchen-friendly fractions] ----
const FR = [[0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];
export function fmtQty(q, unit) {
  if (q == null) return '';
  if (q > 0 && q < 0.2 && /כפית|כף|קורט/.test(unit)) return 'קורט';
  if (/גרם|מ"ל/.test(unit) && q >= 50) return String(Math.round(q / 10) * 10);
  const whole = Math.floor(q), rest = q - whole;
  const [f, sym] = FR.reduce((best, x) => (Math.abs(x[0] - rest) < Math.abs(best[0] - rest) ? x : best));
  if (Math.abs(f - rest) > 0.07) return String(Math.round(q * 10) / 10);
  const w = whole + (f === 1 ? 1 : 0);
  return (w ? String(w) : '') + sym || '0';
}

// ---- [Tiny DOM helper (own copy so the site has zero app dependencies)] ----
export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter((c) => c != null && c !== false));
  return e;
}

export const fmtTime = (t) => (t >= 120 ? `${Math.round(t / 30) / 2} שעות` : `${t} דק׳`);
const badge = (r) => el('span', { class: `chip ${KOSHER_CLS[r.k || r.kosher]}` }, r.k || r.kosher);
const dots = (d) => el('span', { class: 'chip', title: DIFF[d] }, '●'.repeat(d) + '○'.repeat(3 - d) + ' ' + DIFF[d]);

// ---- [Browser: search + filters + list] ----
// opts: { onOpen(id), score?(indexRow) → {have, need} for "what can I cook now" }
export async function renderBrowser(root, opts = {}) {
  const all = await loadIndex();
  const st = { q: '', meal: '', k: '', d: '', t: '', c: '', limit: 40, sort: opts.score ? 'have' : '' };
  const cats = [...new Set(all.map((r) => r.c))];
  const list = el('div', { class: 'list' });
  const scored = opts.score ? new Map(all.map((r) => [r.id, opts.score(r)])) : null;

  const chips = (key, options) => el('div', { class: 'seg wide' }, ...Object.entries(options).map(([v, label]) =>
    el('button', { type: 'button', class: st[key] === v ? 'on' : '', onclick: (e) => {
      st[key] = st[key] === v ? '' : v; st.limit = 40;
      e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      if (st[key]) e.currentTarget.classList.add('on');
      paint();
    } }, label)));

  function paint() {
    const q = st.q.trim();
    let rs = all.filter((r) => (!q || r.n.includes(q) || r.i.some((x) => x.includes(q)))
      && (!st.meal || r.m.includes(st.meal)) && (!st.k || r.k === st.k) && (!st.d || r.d === +st.d)
      && (!st.t || r.t <= +st.t) && (!st.c || r.c === st.c));
    if (scored && st.sort === 'have') rs = [...rs].sort((a, b) => ratio(b) - ratio(a));
    list.replaceChildren(...[...rs.slice(0, st.limit).map(card),
      rs.length > st.limit && el('button', { class: 'ghost', onclick: () => { st.limit += 40; paint(); } }, `הצג עוד (${rs.length - st.limit})`),
      !rs.length && el('p', { class: 'empty' }, 'לא נמצאו מתכונים — נסו לנקות סינון')].filter(Boolean));
    count.textContent = `${rs.length} מתכונים`;
  }
  const ratio = (r) => { const s = scored.get(r.id); return s.need ? s.have / s.need : 0; };
  const card = (r) => {
    const s = scored?.get(r.id);
    return el('button', { class: 'item rcard', onclick: () => opts.onOpen(r.id) },
      el('div', { class: 'body' }, el('strong', {}, r.n),
        el('div', { class: 'chips' }, badge(r), el('span', { class: 'chip' }, `⏱ ${fmtTime(r.t)}`), dots(r.d),
          s && el('span', { class: `chip${s.have === s.need ? ' ok' : ''}` }, `יש בבית ${s.have}/${s.need}`))));
  };
  const count = el('span', { class: 'hint' });

  root.replaceChildren(
    el('input', { type: 'search', class: 'search', placeholder: 'חיפוש לפי שם או מרכיב…', oninput: (e) => { st.q = e.target.value; st.limit = 40; paint(); } }),
    el('details', { class: 'filters' }, el('summary', {}, 'סינון'),
      chips('meal', MEALS), chips('k', { 'פרווה': 'פרווה', 'חלבי': 'חלבי', 'בשרי': 'בשרי' }),
      chips('d', { 1: 'קל', 2: 'בינוני', 3: 'מאתגר' }), chips('t', { 20: 'עד 20 דק׳', 45: 'עד 45 דק׳', 90: 'עד 90 דק׳' }),
      el('select', { onchange: (e) => { st.c = e.target.value; paint(); } }, el('option', { value: '' }, 'כל הקטגוריות'),
        ...cats.map((c) => el('option', { value: c }, c)))),
    count, list);
  paint();
}

// ---- [Recipe detail: servings, ingredient checkoff, steps, cook mode, share] ----
// opts: { have?(name) → bool, onAddMissing?(items) , appLink? }
export function renderRecipe(root, r, opts = {}) {
  let servings = r.servings, lock = null;
  const ingBox = el('ul', { class: 'ing-list' });
  const paintIng = () => {
    const f = servings / r.servings;
    ingBox.replaceChildren(...r.ingredients.map((i) => {
      const has = opts.have?.(i.name);
      return el('li', { class: has ? 'have' : '' }, el('label', { class: 'inline' }, el('input', { type: 'checkbox' }),
        el('span', {}, el('b', {}, [fmtQty(i.qty == null ? null : i.qty * f, i.unit), i.unit].filter(Boolean).join(' ')), ' ', i.name,
          i.note ? el('small', {}, ` (${i.note})`) : null, has ? el('small', { class: 'ok-t' }, ' ✓ יש בבית') : null)));
    }));
    sv.textContent = `${servings} מנות`;
  };
  const sv = el('b', {});
  const stepper = el('div', { class: 'stepper' },
    el('button', { type: 'button', 'aria-label': 'פחות מנות', onclick: () => { if (servings > 1) { servings--; paintIng(); } } }, '−'), sv,
    el('button', { type: 'button', 'aria-label': 'יותר מנות', onclick: () => { servings++; paintIng(); } }, '+'));

  const mark = (e) => { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.classList.toggle('done'); } };
  const steps = el('ol', { class: 'steps' }, ...r.steps.map((s) => el('li', { tabIndex: 0, role: 'button', onclick: mark, onkeydown: mark }, s)));
  // cook mode keeps the screen on; the OS drops the lock when the app is hidden, so re-acquire on return
  const acquire = async () => { try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch { /* unsupported */ } };
  const onVis = () => { if (!document.hidden && root.classList.contains('cook')) acquire(); };
  document.addEventListener('visibilitychange', onVis);
  const cook = async (e) => {
    const on = root.classList.toggle('cook');
    e.currentTarget.textContent = on ? '✓ מצב בישול פעיל' : '👨‍🍳 מצב בישול';
    if (on) await acquire(); else { await lock?.release().catch(() => {}); lock = null; }
  };
  const shareText = () => `*${r.name}* (${servings} מנות)\n` + r.ingredients.map((i) =>
    `• ${[fmtQty(i.qty == null ? null : i.qty * servings / r.servings, i.unit), i.unit, i.name].filter(Boolean).join(' ')}`).join('\n')
    + (opts.appLink ? `\n${opts.appLink}` : '');
  const missing = () => r.ingredients.filter((i) => !opts.have?.(i.name));

  root.replaceChildren(...[
    el('h1', {}, r.name),
    r.desc && el('p', { class: 'hint' }, r.desc),
    el('div', { class: 'chips' }, badge(r), el('span', { class: 'chip' }, r.cat), dots(r.difficulty),
      el('span', { class: 'chip' }, `הכנה ${fmtTime(r.prep)} · בישול ${fmtTime(r.cook)}`), ...(r.tags || []).map((t) => el('span', { class: 'chip' }, t))),
    el('div', { class: 'row' }, stepper,
      el('button', { type: 'button', class: 'ghost', onclick: cook }, '👨‍🍳 מצב בישול'),
      el('button', { type: 'button', class: 'ghost', onclick: () => (navigator.share ? navigator.share({ text: shareText() }).catch(() => {})
        : window.open('https://wa.me/?text=' + encodeURIComponent(shareText()), '_blank', 'noopener')) }, 'שיתוף')),
    el('h2', {}, 'מצרכים'), ingBox,
    opts.onAddMissing && el('button', { onclick: async (e) => { e.currentTarget.disabled = true; await opts.onAddMissing(missing(), servings / r.servings); e.currentTarget.disabled = false; } },
      opts.have ? '🛒 הוסף חסרים לרשימת הקניות' : '🛒 הוסף מצרכים לרשימת הקניות'),
    el('h2', {}, 'אופן הכנה'), steps,
    el('p', { class: 'hint' }, 'כשרות ברמת המתכון. יש לוודא הכשר על כל המוצרים.')].filter(Boolean));
  paintIng();
  return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
}
