// ===== APP SHELL — boot, routing, navigation, realtime, updates =====
import { h, $, guard, toast } from './core/ui.js';
import { auth, house, live, unlive } from './core/api.js';
import { resolve } from './core/modules.js';
import { state } from './core/state.js';
import { renderModule } from './views/module.js';
import { renderHome } from './views/home.js';
import { renderLogin, renderOnboard } from './views/auth.js';
import { LITE, VERSION } from './config.js';

const app = $('#app');
if (LITE) document.documentElement.classList.add('lite');   // weak device: lighter CSS

// ---- [Boot: session → household → shell] ----
async function boot() {
  state.user = await auth.user();
  if (!state.user) return renderLogin(app, boot);
  const m = await house.mine(state.user.id);
  if (!m) return renderOnboard(app, boot);
  state.house = m.households;
  state.role = m.role;
  state.members = m.households.members || [];
  state.reload();
  let t;
  live(state.house.id, (mod, delId) => {
    const cur = current();
    if (cur === 'home') { clearTimeout(t); t = setTimeout(state.refresh, 1500); }   // many writes → one refresh
    else if (mod ? mod === cur : state.ids?.has(delId)) state.refresh();
  });
}

// Phone woke up: realtime events were missed and admin may have changed settings/role.
document.addEventListener('visibilitychange', guard(async () => {
  if (document.hidden || !state.house) return;
  const m = await house.mine(state.user.id);
  if (!m) return boot();
  const changed = JSON.stringify(m.households.settings) !== JSON.stringify(state.house.settings) || m.role !== state.role;
  state.house = m.households; state.role = m.role;
  state.members = m.households.members || [];
  changed ? state.reload() : route();
}));

async function signOut() {
  unlive(); state.house = null; state.ids = null;
  await auth.signOut();
  history.replaceState(null, '', location.pathname);
  boot();
}

state.reload = () => {
  state.modules = resolve(state.house.settings);
  shell();
  route();
};

// ---- [Shell: nav (bottom on phones, side on wide screens)] ----
const main = h('main', { id: 'view', tabIndex: -1 });
const nav = h('nav', { class: 'nav' });

const link = (id, icon, title, extra = '') => h('a', { href: `#/${id}`, 'data-id': id, class: extra },
  h('i', {}, icon || '•'), h('span', {}, title));

// Phones: home + pinned modules + "more" (class 'x' = only in the wide side rail). Wide screens: everything.
function shell() {
  const mods = state.modules.filter((m) => m.enabled !== false);
  nav.replaceChildren(link('home', '🏠', 'בית'),
    ...mods.map((m) => link(m.id, m.icon, m.title, m.pin ? '' : 'x')),
    link('more', '☰', 'עוד', 'm'),
    state.role === 'admin' && link('admin', '⚙️', 'ניהול', 'x'));
  app.replaceChildren(main, nav);
}

// ---- [Router] ----
const current = () => location.hash.slice(2) || 'home';
let seq = 0;                                     // drop stale renders when user taps fast

const route = guard(async () => {
  if (!state.house) return;
  const id = current(), my = ++seq;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
  const view = h('div');
  if (id === 'admin' && state.role === 'admin') await (await import('./views/admin.js')).renderAdmin(view);
  else if (id === 'home') await renderHome(view);
  else if (id === 'more') more(view);
  else {
    const mod = state.modules.find((m) => m.id === id && m.enabled !== false);
    if (!mod) return (location.hash = '');
    await renderModule(view, mod);
  }
  if (my === seq) main.replaceChildren(view);
});
state.refresh = route;
addEventListener('hashchange', route);

function more(view) {
  const mods = state.modules.filter((m) => m.enabled !== false);
  view.append(h('header', { class: 'bar' }, h('h1', {}, '☰ כל האזורים')),
    h('div', { class: 'grid' }, ...mods.map((m) => h('a', { href: `#/${m.id}` }, h('i', {}, m.icon || '•'), h('span', {}, m.title))),
      state.role === 'admin' && h('a', { href: '#/admin' }, h('i', {}, '⚙️'), h('span', {}, 'ניהול'))),
    h('section', { class: 'card' },
      h('p', {}, `${state.house.name} · גרסה ${VERSION}`),
      h('button', { onclick: guard(async () => (await import('./views/admin.js')).requestFeature()) }, '💡 בקשת פיצ\'ר'),
      h('button', { class: 'ghost', onclick: guard(signOut) }, 'יציאה')));
}

// ---- [PWA: service worker; new version applies on tap, checked whenever the app is reopened] ----
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (!reg) return;
    const offer = (w) => document.body.append(h('button', { class: 'toast', onclick: () => w.postMessage('skip') }, 'גרסה חדשה זמינה — לחץ לעדכון'));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  });
}

boot().catch((e) => { console.error(e); toast('אין חיבור לשרת', true); });
