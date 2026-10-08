// ===== APP SHELL — boot, routing, navigation, realtime, updates =====
import { h, $, guard, toast } from './core/ui.js';
import { auth, house, live, unlive } from './core/api.js';
import { resolve } from './core/modules.js';
import { state } from './core/state.js';
import { renderModule } from './views/module.js';
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
  state.reload();
  live(state.house.id, (mod, delId) => { if (mod ? mod === current() : state.ids?.has(delId)) state.refresh(); });
}

// Phone woke up: realtime events were missed and admin may have changed settings/role.
document.addEventListener('visibilitychange', guard(async () => {
  if (document.hidden || !state.house) return;
  const m = await house.mine(state.user.id);
  if (!m) return boot();
  const changed = JSON.stringify(m.households.settings) !== JSON.stringify(state.house.settings) || m.role !== state.role;
  state.house = m.households; state.role = m.role;
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

function shell() {
  const isAdmin = state.role === 'admin';
  nav.replaceChildren(...state.modules.filter((m) => m.enabled !== false).map((m) =>
    h('a', { href: `#/${m.id}`, 'data-id': m.id }, h('i', {}, m.icon || '•'), h('span', {}, m.title))),
  h('a', { href: '#/more', 'data-id': 'more' }, h('i', {}, '☰'), h('span', {}, 'עוד')),
  isAdmin && h('a', { href: '#/admin', 'data-id': 'admin' }, h('i', {}, '⚙️'), h('span', {}, 'ניהול')));
  app.replaceChildren(main, nav);
}

// ---- [Router] ----
const current = () => location.hash.slice(2) || state.modules.find((m) => m.enabled !== false)?.id;
let seq = 0;                                     // drop stale renders when user taps fast

const route = guard(async () => {
  if (!state.house) return;
  const id = current(), my = ++seq;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
  const view = h('div');
  if (id === 'admin' && state.role === 'admin') await (await import('./views/admin.js')).renderAdmin(view);
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
  view.append(h('header', { class: 'bar' }, h('h1', {}, '☰ עוד')),
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
