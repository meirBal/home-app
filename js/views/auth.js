// ===== AUTH & ONBOARDING — sign in/up, then create or join a household =====
import { h, guard, toast } from '../core/ui.js';
import { auth, house } from '../core/api.js';

const ERR = { 'Invalid login credentials': 'מייל או סיסמה שגויים', 'invalid code': 'קוד הצטרפות שגוי' };
const he = (fn) => guard(async (e) => {
  e.preventDefault();
  try { await fn(e.target); } catch (err) { throw new Error(ERR[err.message] || err.message); }
});

export function renderLogin(root, done) {
  let signup = false;
  const form = h('form', { class: 'form card', onsubmit: he(async (f) => {
    const email = f.email.value.trim(), pw = f.pw.value;
    if (signup) {
      const r = await auth.signUp(email, pw);
      if (!r.session) return toast('נשלח מייל אימות — יש לאשר ואז להתחבר');
    } else await auth.signIn(email, pw);
    done();
  }) },
    h('h1', {}, '🏠 ניהול הבית'),
    h('label', {}, h('span', {}, 'מייל'), h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
    h('label', {}, h('span', {}, 'סיסמה'), h('input', { name: 'pw', type: 'password', required: true, minLength: 8, autocomplete: 'current-password' })),
    h('button', { type: 'submit' }, 'כניסה'),
    h('button', { type: 'button', class: 'ghost', onclick: (e) => {
      signup = !signup;
      form.querySelector('[type=submit]').textContent = signup ? 'הרשמה' : 'כניסה';
      e.target.textContent = signup ? 'יש לי חשבון' : 'משתמש חדש? הרשמה';
    } }, 'משתמש חדש? הרשמה'));
  root.replaceChildren(h('main', { class: 'center' }, form));
}

export function renderOnboard(root, done) {
  const display = h('input', { name: 'display', required: true, maxLength: 40, placeholder: 'השם שלך' });
  const nameIn = h('input', { maxLength: 80, placeholder: 'שם משק הבית' });
  const codeIn = h('input', { maxLength: 10, placeholder: 'קוד הצטרפות', autocapitalize: 'characters' });
  const need = () => { if (!display.value.trim()) throw new Error('נא להזין שם'); return display.value; };
  root.replaceChildren(h('main', { class: 'center' }, h('div', { class: 'form card' },
    h('h1', {}, 'ברוכים הבאים'), display,
    h('h3', {}, 'משק בית חדש (תהיה מנהל)'), nameIn,
    h('button', { onclick: guard(async (e) => {
      e.target.disabled = true;
      try { await house.create(nameIn.value || 'הבית שלנו', need()); done(); } finally { e.target.disabled = false; }
    }) }, 'יצירה'),
    h('h3', {}, 'או הצטרפות למשפחה'), codeIn,
    h('button', { class: 'ghost', onclick: guard(async () => {
      await house.join(codeIn.value, need()).catch((e) => { throw new Error(ERR[e.message] || e.message); });
      done();
    }) }, 'הצטרפות'))));
}
