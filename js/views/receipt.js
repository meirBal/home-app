// ===== RECEIPT SCAN 🧾 — photo/PDF/digital receipt (.mht/.html) → AI items → review → stock + shopping list + expense + warranty cards =====
import { h, guard, modal, toast, today, fmtMoney } from '../core/ui.js';
import { records, photos, fn, isPdf } from '../core/api.js';
import { restock, similar, warrantyEnd } from '../core/smart.js';
import { UNITS, WARRANTY_CATS } from '../core/modules.js';
import { state } from '../core/state.js';

const pickFile = () => new Promise((res) => {
  const inp = h('input', { type: 'file', accept: 'image/*,application/pdf,.mht,.mhtml,.html,.htm,multipart/related,text/html', onchange: () => res(inp.files[0] || null), oncancel: () => res(null) });
  inp.click();
});

export async function scanReceipt(file, text) {
  if (!text) file ||= await pickFile();
  if (!file && !text) return;
  const wait = modal('קורא את הקבלה…', h('p', { class: 'hint pulse' }, '🧾 זה לוקח כמה שניות'));
  let res;
  try {
    if (text || isWeb(file)) res = await fn('receipt', { text: text || await webText(file) });
    else { const { data, mime } = await photos.base64(file); res = await fn('receipt', { image: data, mime }); }
  } finally { wait.close(); }
  if (!res?.items?.length) throw new Error('לא נמצאו פריטים בקבלה');
  review(res, file);
}

// Shared into the app (see sw.js share()): a file → normal scan; shared text (e.g. a copied receipt) → AI as text.
// The parked share is cleared only once the scan worked; on failure the toast offers a retry.
export async function fromShare() {
  const c = await caches.open('share'), [f, t] = await Promise.all([c.match('file'), c.match('text')]);
  const text = (await t?.text())?.trim();
  if (!f && !text) return toast('לא התקבל קובץ (אולי גדול מדי — עד 15MB)', true);
  if (!f && text.replace(/https?:\/\/\S+/g, '').trim().length < 50) {
    await c.delete('text');
    return toast('קישור לבד לא מספיק — פתחו את הקבלה, שמרו/הורידו אותה ושתפו את הקובץ', true);
  }
  try {
    if (f) {
      const blob = await f.blob(), head = await blob.slice(0, 5).text();
      let name = decodeURIComponent(f.headers.get('x-name') || ''), type = f.headers.get('content-type');
      if (!/\.\w{2,5}$/.test(name)) name = head === '%PDF-' ? 'receipt.pdf' : /^\s*(<|from|mime|conte)/i.test(head) ? 'receipt.mht' : 'receipt';   // unnamed: sniff
      await scanReceipt(new File([blob], name, { type: head === '%PDF-' ? 'application/pdf' : type }));
    } else await scanReceipt(null, text.slice(0, 50000));
    await Promise.all([c.delete('file'), c.delete('text')]);
  } catch (e) { console.warn(e); toast(e.message || 'שגיאה', true, { label: 'נסו שוב', fn: fromShare }); }
}

// ---- [Digital receipts: saved web page (.mht = MIME archive, or .html) → readable text; far cheaper for the AI than an image] ----
const isWeb = (f) => /\.(mht|mhtml|html?)$/i.test(f.name || '') || /html|multipart|rfc822/.test(f.type);
const MAX_HTML = 3e6;                                                   // the receipt page itself; images/fonts after it are skipped
async function webText(file) {
  const doc = new DOMParser().parseFromString(await webHtml(file), 'text/html');   // inert: no scripts run, no images load
  doc.querySelectorAll('script,style,noscript,svg,template,select,input,button').forEach((n) => n.remove());
  const w = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);   // source indentation is not a line break
  for (let n; (n = w.nextNode());) n.data = n.data.replace(/\s+/g, ' ');
  doc.querySelectorAll('br,p,div,tr,li,h1,h2,h3,h4,h5,h6,table').forEach((n) => n.after('\n'));
  doc.querySelectorAll('td,th').forEach((n) => n.after(' '));
  const text = (doc.title + '\n' + (doc.body?.textContent || '')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if (text.length < 50) throw new Error('לא נמצא טקסט של קבלה בקובץ');
  return text.slice(0, 50000);
}
// bytes as a 1-char-per-byte string (exact, unlike file.text()) → first text/html part of a MIME archive, or the whole .html;
// decoded by declared charset (part header or <meta>), so windows-1255 receipts survive
async function webHtml(file) {
  const u8 = new Uint8Array(await file.slice(0, 20e6).arrayBuffer());
  let raw = '';
  for (let i = 0; i < u8.length; i += 0x8000) raw += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  let body = raw, cs;
  const top = raw.slice(0, Math.max(0, raw.search(/\r?\n\r?\n/)));      // boundary only from the archive's own headers
  const b = /^(from|mime-version|content-type|subject|date|snapshot)/im.test(top) && top.match(/boundary="?([^"\r\n;]+)"?/i);
  if (b) {
    const sep = '--' + b[1];
    let at = raw.indexOf(sep), part;
    for (; at >= 0; at = raw.indexOf(sep, at + sep.length)) {
      const end = raw.indexOf(sep, at + sep.length);
      part = raw.slice(at + sep.length, end < 0 ? undefined : end);
      if (/^\s*content-type:\s*text\/html/im.test(part.slice(0, part.search(/\r?\n\r?\n/)))) break;
      part = null;
    }
    if (!part) throw new Error('לא נמצא דף קבלה בקובץ');
    const i = part.search(/\r?\n\r?\n/), head = part.slice(0, i);
    body = part.slice(i).trim();
    cs = head.match(/charset="?([\w-]+)/i)?.[1];
    const enc = head.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1].toLowerCase();
    if (enc === 'base64') body = atob(body.replace(/\s/g, ''));
    else if (enc === 'quoted-printable') body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
  }
  if (body.length > MAX_HTML) throw new Error('הקובץ גדול מדי');
  cs ||= body.slice(0, 4000).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  let dec;
  try { dec = new TextDecoder(cs); } catch { throw new Error(`קידוד לא נתמך: ${cs}`); }
  return dec.decode(Uint8Array.from(body, (c) => c.charCodeAt(0)));
}

const unitOf = (u) => {
  u = String(u || '').replace(/"/g, '״').replace(/'/g, '׳').replace(/^(יחידה|יחידות|קילו)$/, (w) => (w === 'קילו' ? 'ק״ג' : 'יח׳'));
  return UNITS.includes(u) ? u : 'יח׳';
};

function review(res, file) {
  const rows = res.items.map((it) => ({ on: true, name: it.name, qty: it.qty ?? null, unit: unitOf(it.unit),
    price: typeof it.price === 'number' && it.price >= 0 ? it.price : null, category: it.category,
    durable: !!it.durable, months: +it.warranty_months > 0 ? Math.round(+it.warranty_months) : 0 }));
  // the AI sometimes misreads the total (e.g. picks a sub-line): trust it only near the item sum
  const sum = Math.round(rows.reduce((s, r) => s + (r.price || 0), 0) * 100) / 100;
  const total = res.total > 0 && (!sum || Math.abs(res.total - sum) <= sum * 0.3) ? +res.total : sum;
  const nWar = rows.filter((r) => r.months).length;
  const opt = { stock: true, list: true, expense: total > 0, warranty: nWar > 0 };

  const row = (r) => h('div', { class: 'item rc' },
    h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'כלול', onchange: (e) => (r.on = e.target.checked) }),
    h('input', { class: 'grow', value: r.name, maxLength: 80, 'aria-label': 'שם', oninput: (e) => (r.name = e.target.value) }),
    h('input', { class: 'num', type: 'number', inputMode: 'decimal', step: 'any', value: r.qty ?? '', 'aria-label': 'כמות',
      oninput: (e) => (r.qty = e.target.value === '' ? null : +e.target.value) }),
    h('span', { class: 'chip' }, r.unit), r.price != null && h('span', { class: 'chip' }, fmtMoney(r.price)),
    r.months ? h('span', { class: 'chip', title: 'אחריות' }, `🛡️ ${r.months}ח׳`) : r.durable && h('span', { class: 'chip', title: 'לא מתכלה — לא נכנס למלאי' }, '🏠'));
  const check = (k, label) => h('label', { class: 'inline' },
    h('input', { type: 'checkbox', checked: opt[k], onchange: (e) => (opt[k] = e.target.checked) }), label);

  const dlg = modal(`קבלה${res.store ? ' · ' + res.store : ''}`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, `${rows.length} פריטים · סה״כ ${fmtMoney(total)} — בדקו ותקנו לפני אישור`),
    h('div', { class: 'list' }, ...rows.map(row)),
    check('stock', 'עדכן מלאי (מוצרים חדשים ייווצרו; 🏠 לא מתכלים מדולגים)'),
    check('list', 'סמן כנקנה ברשימת הקניות'),
    check('expense', `הוסף הוצאה של ${fmtMoney(total)}`),
    nWar > 0 && check('warranty', `🛡️ פתח כרטיסי אחריות (${nWar})`)), [
    h('button', { onclick: guard(async (e) => {
      e.target.disabled = true;
      try { await apply(rows.filter((r) => r.on && r.name.trim()), res, total, opt, file); dlg.close(); }
      finally { e.target.disabled = false; }
    }) }, 'אישור ועדכון')]);
}

// AI-read dates are trusted only within the last 60 days (a misread year would hide the expense)
function plausible(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const days = (new Date(today()) - new Date(d)) / 864e5;
  return days >= 0 && days <= 60;
}

async function apply(items, res, total, opt, file) {
  const hid = state.house.id, date = plausible(res.date) ? res.date : today(), on = (id) => state.modules.some((m) => m.id === id && m.enabled !== false);
  const stocked = opt.stock ? items.filter((it) => !it.durable && !it.months) : [];
  let n = 0;
  if (stocked.length) {
    const known = await records.all(hid, 'products');
    for (const it of stocked) if (await restock(it, known)) n++;       // sequential: same product may repeat
  }
  let marked = 0;
  if (opt.list) {
    const open = await records.open(hid, 'shopping');
    const hits = open.filter((o) => items.some((it) => similar(o.data?.name, it.name)));
    await Promise.all(hits.map((o) => records.update(o.id, { done: true })));
    marked = hits.length;
  }
  if (opt.expense) await records.insert({ household_id: hid, module: 'expenses', amount: total, due: date,
    data: { title: `קניות${res.store ? ' ב' + res.store : ''}`, category: 'קניות שבועיות' } });
  const war = opt.warranty && on('warranty') ? items.filter((it) => it.months) : [];
  if (war.length) {
    const receipt = !file || isPdf(file) || isWeb(file) ? undefined : await photos.upload(hid, file);  // one shared receipt photo
    const cat = (c) => (WARRANTY_CATS.includes(c) ? c : 'מוצרי חשמל לבית');
    try {
      await records.insertMany(war.map((it) => ({ household_id: hid, module: 'warranty', amount: it.price, due: warrantyEnd(date, it.months),
        data: { name: it.name.trim(), category: cat(it.category), bought: date, months: it.months, ...(res.store && { store: res.store }), ...(receipt && { receipt }) } })));
    } catch (e) { if (receipt) await photos.remove([receipt]).catch(() => {}); throw e; }
  }
  toast(`עודכנו ${n} מוצרים · ${marked} סומנו ברשימה${opt.expense ? ' · הוצאה נרשמה' : ''}${war.length ? ` · ${war.length} כרטיסי אחריות` : ''}`);
  state.refresh();
}
