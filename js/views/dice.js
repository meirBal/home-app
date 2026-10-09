// ===== RECIPE DICE 🎲🎲 — meal × hunger × what's at home → a recipe (shared catalogue + family recipes) =====
import { h, guard, modal, toast, DICE_SVG } from '../core/ui.js';
import { records } from '../core/api.js';
import { addToShopping, norm } from '../core/smart.js';
import { state } from '../core/state.js';
import { loadIndex, MEALS, HUNGER, fmtTime } from '../../recipes/lib.js';
import { stockMatcher, isStaple } from './library.js';

const seen = new Set();                                // avoid repeating within a session
let catalogue;                                         // mapped once per session

async function pool() {
  const [idx, fam] = await Promise.all([loadIndex().catch(() => []), records.list(state.house.id, 'recipes').catch(() => [])]);
  catalogue ||= idx.map((r) => ({ id: r.id, name: r.n, minutes: r.t, ing: r.i.filter((n) => !isStaple(n)), kosher: r.k,
    meals: [...r.m].map((c) => MEALS[c]), moods: [...r.h].map((c) => HUNGER[c]) }));
  return [...catalogue, ...fam.map((r) => ({
    name: r.data?.name, minutes: r.data?.minutes, steps: r.data?.steps || '', family: true,
    ing: String(r.data?.ing || '').split(/[\n,]/).map(norm).filter(Boolean),
    meals: r.data?.meal ? [r.data.meal] : ['בוקר', 'צהריים', 'ערב'], moods: r.data?.mood ? [r.data.mood] : ['קליל', 'רעב', 'רעב מאוד'],
  })).filter((r) => r.name && r.ing.length)];
}

function score(rec, have) {
  const need = rec.ing, got = need.filter(have);
  return { need, have: got, missing: need.filter((i) => !got.includes(i)), pct: need.length ? got.length / need.length : 1 };
}

function pick(all, meal, mood, have) {
  let cands = all.filter((r) => r.meals.includes(meal) && r.moods.includes(mood));
  if (!cands.length) cands = all.filter((r) => r.meals.includes(meal));            // relax hunger if nothing fits
  const scored = cands.map((r) => ({ r, ...score(r, have) })).sort((a, b) => b.pct - a.pct);
  const fresh = scored.filter((s) => !seen.has(s.r.name));
  const list = fresh.length ? fresh : (seen.clear(), scored);
  const top = list.filter((s) => s.pct >= list[0].pct - 0.2).slice(0, 4);          // best matches, some variety
  const s = top[Math.floor(Math.random() * top.length)];
  if (s) seen.add(s.r.name);
  return s;
}

const choice = (opts, val, set) => {
  const box = h('div', { class: 'seg wide', role: 'radiogroup' });
  const paint = () => box.replaceChildren(...opts.map((o) => h('button', { type: 'button', class: o === val ? 'on' : '',
    role: 'radio', 'aria-checked': String(o === val), onclick: () => { val = o; set(o); paint(); } }, o)));
  paint();
  return box;
};

export async function openDice() {
  const hr = +new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(new Date());
  let meal = hr < 11 ? 'בוקר' : hr < 16 ? 'צהריים' : 'ערב', mood = 'רעב';
  const [all, have] = await Promise.all([pool(), stockMatcher()]);

  const logo = DICE_SVG();
  const out = h('div', { class: 'recipe' }, h('p', { class: 'hint' }, `${all.length} מתכונים · מתאים למה שיש בבית`));
  const roll = () => {
    logo.classList.remove('roll'); void logo.getBoundingClientRect(); logo.classList.add('roll');
    const s = pick(all, meal, mood, have);
    setTimeout(() => out.replaceChildren(s ? card(s) : h('p', { class: 'empty' }, 'לא נמצא מתכון')), 450);
  };
  const card = (s) => h('div', {},
    h('h3', {}, `${s.r.name}${s.r.family ? ' ⭐' : ''}`),
    h('div', { class: 'chips' }, s.r.kosher && h('span', { class: 'chip' }, s.r.kosher), s.r.minutes && h('span', { class: 'chip' }, `⏱ ${fmtTime(s.r.minutes)}`),
      h('span', { class: `chip${s.pct === 1 ? ' ok' : ''}` }, `יש בבית ${s.have.length}/${s.need.length}`)),
    h('ul', { class: 'ing' }, ...s.need.map((i) => h('li', { class: s.have.includes(i) ? 'have' : 'miss' }, i))),
    s.r.id ? h('a', { class: 'btn ghost', href: `#/library/${s.r.id}`, onclick: () => dlg.close() }, '📖 למתכון המלא')
      : h('p', {}, s.r.steps),
    s.missing.length > 0 && h('button', { class: 'ghost', onclick: guard(async (e) => {
      e.target.disabled = true;
      const n = await addToShopping(s.missing, 'עכשיו');
      toast(n ? `נוספו ${n} פריטים לרשימת הקניות` : 'כבר ברשימת הקניות');
    }) }, `🛒 הוסף ${s.missing.length} חסרים לקניות`));

  const dlg = modal('מה מבשלים?', h('div', { class: 'form' },
    h('button', { type: 'button', class: 'dice-btn', 'aria-label': 'הטל קוביות', onclick: roll }, logo),
    h('span', { class: 'hint' }, 'ארוחה'), choice(['בוקר', 'צהריים', 'ערב'], meal, (v) => (meal = v)),
    h('span', { class: 'hint' }, 'כמה רעבים?'), choice(['קליל', 'רעב', 'רעב מאוד'], mood, (v) => (mood = v)),
    out), [h('button', { type: 'button', onclick: roll }, '🎲 הטל קוביות')]);
}
