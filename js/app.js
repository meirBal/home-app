// ===== APP SHELL — boot, routing, navigation, realtime, updates =====
import { h, $, guard, toast } from './core/ui.js';
import { auth, house, live, sb } from './core/api.js';
import { resolve } from './core/modules.js';
import { state } from './core/state.js';
import { renderModule } from './views/module.js';
import { renderLogin, renderOnboard } from './views/auth.js';
import { LITE, VERSION } from './config.js';

const app = $('#app');
if (LITE) document.documentElement.classList.add('lite');   // CSS drops animations/shadows

// ---- [Boot: session → household → shell] ----
async function boot() {
  state.user = await auth.user();
  if (!state.user) return renderLogin(app, boot);
  const m = await house.mine(state.user.id);
  if (!m) return renderOnboard(app, boot);
  state.house = m.households;
  state.role = m.role;
  state.reload();
  live(state.house.id, (mod) => { if (!mod || mod === current()) state.refresh(); });
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
      h('button', { onclick: async () => (await import('./views/admin.js')).requestFeature() }, '💡 בקשת פיצ\'ר'),
      h('button', { class: 'ghost', onclick: guard(async () => { await auth.signOut(); location.hash = ''; boot(); }) }, 'יציאה')));
}

// ---- [PWA: service worker + "new version" prompt] ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          const t = h('button', { class: 'toast', onclick: () => location.reload() }, 'גרסה חדשה זמינה — לחץ לרענון');
          document.body.append(t);
        }
      });
    });
  });
}

sb.auth.onAuthStateChange((e) => { if (e === 'SIGNED_OUT') state.user = null; });
boot().catch((e) => { console.error(e); toast('אין חיבור לשרת', true); });
