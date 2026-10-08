// ===== ADMIN PANEL — modules (no-code features), members, invite, feature requests =====
import { h, guard, toast, modal } from '../core/ui.js';
import { house, requests } from '../core/api.js';
import { DEFAULTS, validate } from '../core/modules.js';
import { state } from '../core/state.js';
import { VERSION } from '../config.js';

const STATUS = { new: 'חדש', planned: 'מתוכנן', done: 'בוצע', rejected: 'נדחה' };

// Persist only what differs from defaults (keeps settings small and future defaults flowing in).
async function saveModules(mods) {
  if (new Set(mods.map((m) => m.id)).size !== mods.length) throw new Error('מזהה מודול כבר קיים');
  const slim = mods.map((m) => {
    const d = DEFAULTS.find((x) => x.id === m.id);
    if (!d) return m;
    const o = { id: m.id };
    for (const k of ['enabled', 'title', 'icon', 'fields', 'view', 'sum', 'order', 'asc'])
      if (JSON.stringify(m[k]) !== JSON.stringify(k === 'enabled' ? true : d[k])) o[k] = m[k];
    return Object.keys(o).length > 1 ? o : null;
  }).filter(Boolean);
  const settings = { ...state.house.settings, modules: slim };
  await house.saveSettings(state.house.id, settings);
  state.house.settings = settings;
  state.reload();
  toast('נשמר — מתעדכן בכל הטלפונים בפתיחה הבאה');
}

function editJson(m, mods) {
  const ta = h('textarea', { rows: 16, dir: 'ltr', class: 'mono', value: JSON.stringify(m, null, 1) });
  const dlg = modal(`עריכת ${m.title}`, h('div', {}, h('p', { class: 'hint' },
    'סוגי שדות: text number money date time select textarea check photo · col: due/amount/done'), ta), [
    !DEFAULTS.some((d) => d.id === m.id) && h('button', { class: 'danger', onclick: guard(async () => {
      if (!confirm('למחוק את המודול? הנתונים נשארים במסד')) return;
      await saveModules(mods.filter((x) => x.id !== m.id)); dlg.close();
    }) }, 'מחיקה'),
    h('button', { onclick: guard(async () => {
      let next;
      try { next = validate(JSON.parse(ta.value)); } catch (e) { throw new Error('JSON: ' + e.message); }
      await saveModules(mods.map((x) => (x.id === m.id ? next : x))); dlg.close();
    }) }, 'שמירה')]);
}

export async function renderAdmin(root) {
  const hh = state.house, mods = state.modules;
  const [members, reqs] = await Promise.all([house.members(hh.id), requests.list(hh.id)]);
  const code = h('code', {}, hh.invite_code);
  const share = `https://wa.me/?text=${encodeURIComponent(`הצטרפו לניהול הבית: ${location.origin + location.pathname}\nקוד: ${hh.invite_code}`)}`;

  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, '⚙️ ניהול')),

    // ---- [Invite] ----
    h('section', { class: 'card' }, h('h2', {}, 'הזמנת בני משפחה'),
      h('div', { class: 'row' }, 'קוד: ', code,
        h('a', { class: 'btn', href: share, target: '_blank', rel: 'noopener' }, 'וואטסאפ'),
        h('button', { class: 'ghost', onclick: guard(async () => {
          if (!confirm('קוד חדש יבטל את הקודם. להמשיך?')) return;
          code.textContent = hh.invite_code = await house.rotateInvite(hh.id);
        }) }, 'קוד חדש'))),

    // ---- [Modules = features without code] ----
    h('section', { class: 'card' }, h('h2', {}, 'מודולים'),
      ...mods.map((m) => h('div', { class: 'row' },
        h('label', { class: 'inline grow' }, h('input', { type: 'checkbox', checked: m.enabled !== false,
          onchange: guard((e) => saveModules(state.modules.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)))) }),
          `${m.icon || ''} ${m.title}`),
        h('button', { class: 'ghost sm', onclick: () => editJson(m, mods) }, 'עריכה'))),
      h('button', { onclick: () => editJson({ id: 'new_list', title: 'רשימה חדשה', icon: '📝',
        fields: [{ k: 'name', l: 'שם', t: 'text', req: 1 }, { k: 'notes', l: 'הערות', t: 'textarea' }] }, [...mods, { id: 'new_list' }]) },
        '+ מודול חדש')),

    // ---- [Members] ----
    h('section', { class: 'card' }, h('h2', {}, 'בני משפחה'),
      ...members.map((u) => h('div', { class: 'row' }, h('span', { class: 'grow' }, u.display_name || '—'),
        h('select', { onchange: guard((e) => house.setRole(hh.id, u.user_id, e.target.value)) },
          ...['member', 'admin'].map((r) => h('option', { value: r, selected: u.role === r }, r === 'admin' ? 'מנהל' : 'חבר')))))),

    // ---- [Feature requests → improvement loop] ----
    h('section', { class: 'card' }, h('h2', {}, 'בקשות פיצ\'רים'),
      ...reqs.map((r) => h('div', { class: 'row' }, h('span', { class: 'grow' }, r.text),
        h('select', { onchange: guard((e) => requests.setStatus(r.id, e.target.value)) },
          ...Object.entries(STATUS).map(([v, l]) => h('option', { value: v, selected: r.status === v }, l)))))),

    h('p', { class: 'hint' }, `גרסה ${VERSION}`));
}

export function requestFeature() {
  const ta = h('textarea', { rows: 4, maxLength: 2000, placeholder: 'מה היית רוצה שהאפליקציה תדע לעשות?' });
  const dlg = modal('בקשת פיצ\'ר', ta, [h('button', { onclick: guard(async () => {
    if (ta.value.trim().length < 3) return;
    await requests.add(state.house.id, ta.value.trim()); dlg.close(); toast('הבקשה נשלחה למנהל');
  }) }, 'שליחה')]);
}
