// ===== RECIPE LIBRARY IN-APP — shared catalogue + what's in stock + add missing to shopping =====
import { h, toast, DICE_SVG } from '../core/ui.js';
import { records } from '../core/api.js';
import { addToShopping, tokens, similar } from '../core/smart.js';
import { state } from '../core/state.js';
import { renderBrowser, renderRecipe, loadRecipe } from '../../recipes/lib.js';

export const STAPLES = ['מלח', 'פלפל שחור', 'שמן', 'מים', 'סוכר', 'שמן זית', 'מלח ופלפל', 'מלח ופלפל שחור'].map(tokens);
export const isStaple = (name) => STAPLES.some((t) => similar(t, name)) || /^~?\s*(מלח|שמן לטיגון)/.test(name);

// stock token lists (not 'נגמר'), fetched once per screen render
export async function stockMatcher() {
  const prods = await records.all(state.house.id, 'products');
  const stock = prods.filter((p) => p.data?.name && p.data.status !== 'נגמר').map((p) => tokens(p.data.name));
  const memo = new Map();                              // ingredient vocabulary is small → O(vocabulary × stock), not O(recipes × …)
  return (name) => {
    if (!memo.has(name)) { const t = tokens(name); memo.set(name, isStaple(name) || stock.some((p) => similar(p, t))); }
    return memo.get(name);
  };
}

let cleanup;
export async function renderLibrary(root, id) {
  cleanup?.(); cleanup = null;
  const have = await stockMatcher();
  if (!id) {
    const box = h('div');
    await renderBrowser(box, {
      onOpen: (rid) => (location.hash = `#/library/${rid}`),
      score: (r) => { const need = r.i.filter((n) => !isStaple(n)); return { need: need.length, have: need.filter(have).length }; },
    });
    root.replaceChildren(
      h('header', { class: 'bar' }, h('h1', {}, '📚 מאגר המתכונים'),
        h('button', { class: 'ghost', 'aria-label': 'מתכון אקראי', onclick: async () => (await import('./dice.js')).openDice() }, DICE_SVG())),
      h('p', { class: 'hint' }, 'ממוין לפי מה שכבר יש בבית · ', h('a', { href: '#/recipes' }, 'המתכונים שלנו')), box);
    return;
  }
  const r = await loadRecipe(id);
  if (!r) { root.replaceChildren(h('p', { class: 'empty' }, 'המתכון לא נמצא')); return; }
  const box = h('article', { class: 'recipe-page' });
  cleanup = renderRecipe(box, r, {
    have,
    onAddMissing: async (items, f) => {
      const n = await addToShopping(items.map((i) => ({ name: i.name, qty: i.qty == null ? null : Math.round(i.qty * f * 100) / 100, unit: i.unit || null })));
      toast(n ? `נוספו ${n} פריטים לרשימת הקניות` : 'הכול כבר ברשימה');
    },
  });
  root.replaceChildren(h('a', { href: '#/library', class: 'hint' }, '→ כל המתכונים'), box);
}
