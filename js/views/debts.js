// ===== DEBTS 💰 — check open debt at providers with a one-time code (server: functions/debts) =====
import { h, guard, modal, toast, fmtDate, fmtMoney } from '../core/ui.js';
import { records, fn } from '../core/api.js';
import { DEBT_PROVIDERS, DEBT_CHECK_DAYS, latestByProvider } from '../core/smart.js';
import { state } from '../core/state.js';

const ID_KEY = 'debts.id';                                              // opt-in, this device only
const store = { get: () => { try { return localStorage.getItem(ID_KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(ID_KEY, v) : localStorage.removeItem(ID_KEY); } catch { /* private mode */ } } };
// Israeli ID check digit — catches typos before a code is sent (server checks too)
const validId = (id) => /^\d{5,9}$/.test(id) && [...id.padStart(9, '0')]
  .reduce((s, d, i) => { const x = +d * (i % 2 + 1); return s + (x > 9 ? x - 9 : x); }, 0) % 10 === 0;
const digits = (props) => h('input', { inputMode: 'numeric', pattern: '\\d*', dir: 'ltr', ...props });
const icon = (r) => DEBT_PROVIDERS.find((p) => p.id === r.data?.provider)?.icon || '';

export async function renderDebts(root, mod) {
  const rows = await records.list(state.house.id, mod.id);
  const latest = latestByProvider(rows);
  // red only when past due; a bill that isn't due yet is shown as "to pay by"
  const status = (r) => (!(r.amount > 0) ? 'אין חוב ✓' : r.done ? 'שולם ✓'
    : r.data?.overdue > 0 ? `באיחור ${fmtMoney(r.data.overdue)}` : `${fmtMoney(r.amount)} עד ${fmtDate(r.due)}`);
  const paid = (r) => h('button', { class: 'ghost sm', onclick: guard(async () => {
    await records.update(r.id, { done: true }); toast('סומן כשולם'); state.refresh();
  }) }, 'שילמתי');

  root.replaceChildren(
    h('header', { class: 'bar' }, h('h1', {}, `${mod.icon} ${mod.title}`)),
    h('p', { class: 'hint' }, `מומלץ לבדוק כל ${DEBT_CHECK_DAYS} ימים. הקוד נשלח אליך מהספק; מספר הזהות והקוד לא נשמרים בשרת.`),
    h('div', { class: 'list' }, ...DEBT_PROVIDERS.map((p) => {
      const r = latest.get(p.id), open = r && r.amount > 0 && !r.done;
      return h('div', { class: `item${open && r.data?.overdue > 0 ? ' late' : ''}` },
        h('strong', { class: 'grow' }, `${p.icon} ${p.title}`),
        r && h('span', { class: `chip${open && r.data?.overdue > 0 ? ' expired' : open ? ' soon' : ''}` }, status(r)),
        r && h('span', { class: 'chip' }, `נבדק ${fmtDate(r.created_at.slice(0, 10))}`),
        open && paid(r),
        h('button', { class: 'sm', 'aria-label': `בדוק ${p.title}`, onclick: guard(() => check(p)) }, 'בדוק'));
    })),
    h('section', { class: 'card' }, h('h2', {}, 'היסטוריה'),
      h('div', { class: 'list' }, ...(rows.length ? rows.map((r) => h('div', { class: 'item' },
        h('span', { class: 'grow' }, `${icon(r)} ${r.data?.title || ''} · ${fmtDate(r.created_at.slice(0, 10))}`),
        h('span', { class: `chip${!r.done && r.data?.overdue > 0 ? ' expired' : ''}` }, status(r))))
        : [h('p', { class: 'empty' }, 'עוד לא נבדק')]))));
}

// ---- [Check flow: ID → code sent → code (retry on typo) → result] ----
function check(p) {
  const saved = store.get();
  const id = digits({ autocomplete: 'off', maxLength: 9, value: saved, placeholder: '9 ספרות' });
  const keep = h('input', { type: 'checkbox', checked: !!saved });
  const dlg = modal(`${p.icon} בדיקת ${p.title}`, h('div', { class: 'form' },
    h('label', {}, h('span', {}, 'מספר זהות של בעל החשבון'), id),
    h('label', { class: 'inline' }, keep, 'זכור בטלפון הזה (גלוי לכל מי שמשתמש בו)')), [
    h('button', { onclick: guard(async (e) => {
      const v = id.value.trim();
      if (!validId(v)) throw new Error('מספר הזהות לא תקין');
      e.target.disabled = true;
      try {
        const r = await fn('debts', { op: 'start', provider: p.id, id: v });
        store.set(keep.checked ? v : '');
        dlg.close();
        askCode(p, r);
      } finally { e.target.disabled = false; }
    }) }, 'שלח לי קוד')]);
}

function askCode(p, { flow, via }) {
  const code = digits({ autocomplete: 'one-time-code', maxLength: 8 });
  const dlg = modal(`${p.icon} קוד אימות`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, via === 'sms' ? 'נשלח אליך SMS מהספק' : 'נשלח אליך מייל מהספק'),
    h('label', {}, h('span', {}, 'הקוד שקיבלת'), code)), [
    h('button', { onclick: guard(async (e) => {
      e.target.disabled = true;
      try {
        const r = await fn('debts', { op: 'verify', provider: p.id, flow, code: code.value.trim() });
        dlg.close();
        toast(r.amount > 0 ? `${p.title}: לתשלום ${fmtMoney(r.amount)}${r.due ? ' עד ' + fmtDate(r.due) : ''}` : `${p.title}: אין חוב ✓`, r.data?.overdue > 0);
        state.refresh();
      } finally { e.target.disabled = false; }               // wrong code: dialog stays open for another try
    }) }, 'בדוק')]);
  setTimeout(() => code.focus(), 50);
}
