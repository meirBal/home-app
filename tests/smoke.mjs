// Smoke test: serve the app, swap supabase-js for the in-memory mock, click through key flows.
// usage: (npm i playwright) node tests/smoke.mjs .   [SHOTS=dir for screenshots]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2], MOCK = new URL('./mock-supabase.js', import.meta.url).pathname;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' }); s.end(b); });
}).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept('בוני'));
await page.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(MOCK) }));


// every step also fails if a stray JS value leaked into the UI as text
const STRAY = /(^|\s)(false|undefined|null|NaN|\[object Object\])(\s|$)/m;
const step = async (name, fn) => {
  try {
    await fn();
    const t = await page.locator('body').innerText().catch(() => '');
    if (STRAY.test(t)) throw new Error('stray value on screen: ' + t.match(STRAY)[2]);
    console.log('✓', name);
  } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log('✗', name); }
};
const OUT = process.env.SHOTS; const shot = (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const text = () => page.locator('#view').innerText();

await page.goto(url);
await step('home renders', async () => { await page.getByText('מה מבשלים?').first().waitFor({ timeout: 5000 }); });
await step('home shows overdue/expiry/restock', async () => {
  const t = await text();
  for (const s of ['הוצאת זבל', 'חלב 3%', 'כדאי לקנות', 'עגבנייה', 'ביצים']) if (!t.includes(s)) throw new Error('missing ' + s);
});
await shot('1-home');
await step('starter pack hidden for used module', async () => {
  if (await page.locator('section', { hasText: 'מטלות בית — רשימה מומלצת' }).count()) throw new Error('routine already has tasks');
});
await step('pets pack with prompt', async () => {
  await page.locator('section', { hasText: 'בעלי חיים' }).getByRole('button', { name: 'טען רשימה' }).click();
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => window.__db.records.filter((r) => r.module === 'pets' && r.data.pet === 'בוני').length);
  if (n !== 7) throw new Error('pets seeded ' + n);
});
await step('restock → shopping', async () => {
  await page.getByRole('button', { name: 'הוסף מסומנים לרשימה' }).click();
  await page.waitForTimeout(300);
  const names = await page.evaluate(() => window.__db.records.filter((r) => r.module === 'shopping').map((r) => r.data.name));
  if (!names.includes('עגבנייה') || !names.includes('ביצים')) throw new Error(names.join(','));
});
await step('complete daily task rolls forward', async () => {
  await page.goto(url + '#/home');
  await page.locator('.item', { hasText: 'הוצאת זבל' }).locator('input[type=checkbox]').click();
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => window.__db.records.find((r) => r.data.title === 'הוצאת זבל'));
  if (t.done || t.due <= new Date().toLocaleDateString('sv')) throw new Error(JSON.stringify(t));
});
await step('dice gives a recipe', async () => {
  await page.getByRole('button', { name: /מה מבשלים/ }).click();
  await page.getByRole('button', { name: '🎲 הטל קוביות' }).click();
  await page.locator('.recipe h3').waitFor({ timeout: 3000 });
  await shot('2-dice');
  const missBtn = page.getByRole('button', { name: /חסרים לקניות/ });
  if (await missBtn.count()) await missBtn.click();
  await page.keyboard.press('Escape');
});
await step('products: status bar → shopping', async () => {
  await page.goto(url + '#/products');
  await page.locator('.item', { hasText: 'פסטה' }).getByRole('button', { name: 'נגמר' }).click();
  await page.waitForTimeout(300);
  await shot('3-products');
  const has = await page.evaluate(() => window.__db.records.some((r) => r.module === 'shopping' && r.data.name === 'פסטה' && !r.done));
  if (!has) throw new Error('pasta not on list');
});
await step('add product guesses cycle', async () => {
  await page.locator('.fab').click();
  await page.locator('dialog input[name=name]').fill('מרכך כביסה');
  await page.locator('dialog button[type=submit]').click();
  await page.waitForTimeout(300);
  const p = await page.evaluate(() => window.__db.records.find((r) => r.data?.name === 'מרכך כביסה'));
  if (p?.data.cycle !== 'כל שבועיים' || p.data.category !== 'ניקיון') throw new Error(JSON.stringify(p?.data));
});
await step('shopping ✓ restocks product', async () => {
  await page.goto(url + '#/shopping');
  await page.locator('.item', { hasText: 'פסטה' }).locator('input[type=checkbox]').click();
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => window.__db.records.find((r) => r.module === 'products' && r.data.name === 'פסטה'));
  if (p.data.status !== 'מלא') throw new Error(p.data.status);
});
await step('routine edit shows member picker', async () => {
  await page.goto(url + '#/routine');
  await page.locator('.item .body').first().click();
  const opts = await page.locator('dialog select[name=who] option').allInnerTexts();
  if (!opts.includes('שרה')) throw new Error(opts.join(','));
  await page.keyboard.press('Escape');
});
await step('receipt review + apply', async () => {
  await page.goto(url + '#/home');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /סריקת קבלה/ }).click()]);
  // tiny valid PNG
  await chooser.setFiles({ name: 'r.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await page.getByRole('button', { name: 'אישור ועדכון' }).waitFor({ timeout: 4000 });
  await shot('4-receipt');
  await page.getByRole('button', { name: 'אישור ועדכון' }).click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    milk: window.__db.records.filter((x) => x.module === 'products' && x.data.name.startsWith('חלב')).map((x) => x.data.name),
    bread: window.__db.records.find((x) => x.module === 'shopping' && x.data.name === 'לחם')?.done,
    exp: window.__db.records.find((x) => x.module === 'expenses')?.amount,
    war: window.__db.records.filter((x) => x.module === 'warranty').map((x) => [x.data.months, !!x.due, !!x.data.receipt]),
    urn: window.__db.records.some((x) => x.module === 'products' && x.data.name.includes('מיחם')),
  }));
  if (r.milk.length !== 1 || !r.bread || r.exp !== 192.5 || JSON.stringify(r.war) !== '[[12,true,true]]' || r.urn) throw new Error(JSON.stringify(r));
});
await step('digital receipt (.mht, quoted-printable) → text to AI', async () => {
  await page.goto(url + '#/home');
  const qp = (t) => [...Buffer.from(t)].map((b) => (b > 126 || b === 61 ? '=' + b.toString(16).toUpperCase().padStart(2, '0') : String.fromCharCode(b))).join('');
  const html = '<html><head><style>.x{}</style><script>var junk=1</script></head><body><!-- <p>Other jacket 620</p> --><table>'
    + '<tr>\n  <td>\n    חלב 3% תנובה\n  </td>\n  <td>1</td><td>₪ 7.20</td></tr><tr><td>טחינה אחוה 1 ק"ג</td><td>2</td><td>₪ 36.00</td></tr></table><div>סכום לתשלום ₪ 43.20</div></body></html>';
  const mht = 'From: <Saved by Blink>\r\nContent-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----B--x"\r\n\r\n------B--x\r\n'
    + 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' + qp(html) + '\r\n------B--x\r\nContent-Type: text/css\r\n\r\n.a{}\r\n------B--x--\r\n';
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /סריקת קבלה/ }).click()]);
  await chooser.setFiles({ name: 'Receipt.mht', mimeType: '', buffer: Buffer.from(mht) });
  await page.getByRole('button', { name: 'אישור ועדכון' }).waitFor({ timeout: 4000 });
  const b = await page.evaluate(() => window.__fnBody);
  if (b.image || !b.text.includes('חלב 3% תנובה 1 ₪ 7.20') || !b.text.includes('טחינה אחוה 1 ק"ג') || /junk|jacket|\.x\{/.test(b.text)) throw new Error(JSON.stringify(b));
  await page.keyboard.press('Escape');
  // plain .html saved in windows-1255 (Hebrew letters 0xE0–0xFA), charset from <meta>
  const cp = (t) => Buffer.from([...t].map((c) => (c >= 'א' && c <= 'ת' ? c.charCodeAt(0) - 0x5D0 + 0xE0 : c.charCodeAt(0))));
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /סריקת קבלה/ }).click()]);
  await ch2.setFiles({ name: 'r.html', mimeType: 'text/html', buffer: cp('<html><head><meta charset="windows-1255"></head><body><p>שופרסל דיל</p><p>ביצים L 12 יח 1 21.90</p><p>סה"כ לתשלום 21.90 שקלים</p></body></html>') });
  await page.getByRole('button', { name: 'אישור ועדכון' }).waitFor({ timeout: 4000 });
  const b2 = await page.evaluate(() => window.__fnBody.text);
  if (!b2.includes('שופרסל דיל\nביצים L 12 יח 1 21.90')) throw new Error(b2);
  await page.keyboard.press('Escape');
});
await step('share target: shared file and shared text open the scan', async () => {
  await page.goto(url + '#/home');
  const sw = await browser.newPage({ serviceWorkers: 'allow' });           // main page blocks SWs; this one tests the parking
  await sw.goto(url + 'manifest.json');
  const parked = await sw.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js');
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    const fd = new FormData(); fd.append('file', new File(['x'.repeat(10)], 'r.mht', { type: 'multipart/related' }));
    const res = await fetch('./share', { method: 'POST', body: fd, redirect: 'manual' });
    const hit = await (await caches.open('share')).match('file');
    return [res.type, decodeURIComponent(hit?.headers.get('x-name')), await hit?.text()];
  });
  await sw.close();
  if (JSON.stringify(parked) !== '["opaqueredirect","r.mht","xxxxxxxxxx"]') throw new Error(JSON.stringify(parked));
  await page.evaluate(async () => {
    const c = await caches.open('share');
    await c.put('file', new Response('<html><body><p>רמי לוי</p><p>במבה אסם 80 גרם 1 4.90</p><p>סה"כ 4.90 תודה ולהתראות</p></body></html>', { headers: { 'content-type': 'application/octet-stream', 'x-name': encodeURIComponent('קבלה.mht') } }));
  });
  await page.goto(url + '#/share');
  await page.getByRole('button', { name: 'אישור ועדכון' }).waitFor({ timeout: 4000 });
  if (!(await page.evaluate(() => window.__fnBody.text)).includes('במבה אסם 80 גרם 1 4.90') || !page.url().endsWith('#/home')) throw new Error('file share');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => (await caches.open('share')).put('text', new Response('https://osher.pairzon.com/x.html')));
  await page.goto(url + '#/share');
  await page.getByText(/קישור לבד לא מספיק/).waitFor({ timeout: 3000 });
  if (await page.evaluate(async () => !!(await (await caches.open('share')).match('text')))) throw new Error('share not cleared');
});
await step('more grid + admin', async () => {
  await page.goto(url + '#/more'); await page.getByText('כל האזורים').waitFor();
  await page.goto(url + '#/admin'); await page.getByText('מודולים').waitFor();
  await page.goto(url + '#/calendar'); await page.goto(url + '#/expenses'); await page.goto(url + '#/recipes'); await page.goto(url + '#/photos');
  await page.waitForTimeout(400);
});
await step('shopping quick add parses qty/unit/aisle', async () => {
  await page.goto(url + '#/shopping');
  await page.locator('.quick input').fill('2 ק"ג מלפפונים');
  await page.locator('.quick button[type=submit]').click();
  await page.waitForTimeout(400);
  const it = await page.evaluate(() => window.__db.records.find((r) => r.module === 'shopping' && r.data.name === 'מלפפונים'));
  if (!it || it.data.qty !== 2 || it.data.unit !== 'ק״ג' || it.data.category !== 'ירקות ופירות') throw new Error(JSON.stringify(it?.data));
  if (!(await page.locator('h3.day', { hasText: 'ירקות ופירות' }).count())) throw new Error('no aisle header');
});
await step('quick add blocks near-duplicates', async () => {
  await page.locator('.quick input').fill('עגבניות');
  await page.locator('.quick button[type=submit]').click();
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => window.__db.records.filter((r) => r.module === 'shopping' && !r.done && /^עגבני/.test(r.data.name)).length);
  if (n !== 1) throw new Error('duplicates: ' + n);
});
await step('shopping whatsapp export', async () => {
  await page.evaluate(() => { window.open = (u) => { window.__wa = u; }; });
  await page.getByRole('button', { name: /שליחה בוואטסאפ/ }).click();
  const href = decodeURIComponent(await page.evaluate(() => window.__wa || ''));
  if (!href.includes('*ירקות ופירות*') || !href.includes('☐ מלפפונים (2 ק״ג)')) throw new Error(href.slice(0, 200));
  await shot('6-shopping');
});
await step('delete with undo restores row', async () => {
  await page.locator('.item', { hasText: 'מלפפונים' }).first().locator('.body').click();
  await page.locator('dialog .danger').click();
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => window.__db.records.some((r) => r.module === 'shopping' && r.data.name === 'מלפפונים'));
  if (!back) throw new Error('not restored');
});
await step('catalog: pick with qty, change existing, add new', async () => {
  await page.goto(url + '#/shopping');
  await page.getByRole('button', { name: 'קטלוג מוצרים' }).click();
  const row = (n) => page.locator('dialog .item.cat', { has: page.locator('strong', { hasText: new RegExp(`^${n}$`) }) });
  await row('מלפפונים').getByRole('button', { name: 'עוד' }).click();          // on list: 2 → 2.5 ק״ג
  await row('אורז').locator('.body').click();                                   // new: tap = one step (0.5 ק״ג)
  await page.locator('dialog input[type=search]').fill('קרמבו');
  await page.getByRole('button', { name: /הוספת "קרמבו"/ }).click();
  await shot('7-catalog');
  await page.getByRole('button', { name: /עדכון הרשימה \(3\)/ }).click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => Object.fromEntries(window.__db.records.filter((x) => x.module === 'shopping' && !x.done
    && ['מלפפונים', 'אורז', 'קרמבו'].includes(x.data.name)).map((x) => [x.data.name, [x.data.qty, x.data.unit, x.data.category]])));
  const want = { 'מלפפונים': [2.5, 'ק״ג', 'ירקות ופירות'], 'אורז': [0.5, 'ק״ג', 'יבשים ושימורים'], 'קרמבו': [1, 'יח׳', 'אחר'] };
  if (JSON.stringify(r, Object.keys(want)) !== JSON.stringify(want, Object.keys(want))) throw new Error(JSON.stringify(r));
});
await step('product with warranty → prefilled warranty card → end date', async () => {
  await page.goto(url + '#/products');
  await page.locator('.fab').click();
  await page.locator('dialog input[name=name]').fill('מקרר');
  await page.locator('dialog input[name=warranty]').check();
  await page.locator('dialog button[type=submit]').click();
  await page.locator('dialog input[name=months]').waitFor({ timeout: 3000 });
  if (await page.locator('dialog input[name=name]').inputValue() !== 'מקרר') throw new Error('not prefilled');
  await page.locator('dialog input[name=bought]').fill('2026-01-31');
  await page.locator('dialog input[name=months]').fill('24');
  await page.locator('dialog button[type=submit]').click();
  await page.waitForTimeout(400);
  const w = await page.evaluate(() => window.__db.records.find((r) => r.module === 'warranty' && r.data.name === 'מקרר'));
  if (w?.due !== '2028-01-31') throw new Error(JSON.stringify(w));
  await shot('7-warranty');
});
await step('recipe library: browse, scale, add missing', async () => {
  await page.goto(url + '#/library');
  await page.locator('.rcard').first().waitFor({ timeout: 5000 });
  await page.locator('input[type=search]').fill('שקשוקה קלאסית');                 // catalogue is paged (grows daily)
  await page.locator('.rcard', { hasText: 'שקשוקה קלאסית' }).first().click();
  await page.locator('.ing-list li').first().waitFor();
  const before = await page.locator('.ing-list li').first().innerText();
  await page.getByRole('button', { name: 'יותר מנות' }).click();
  await page.getByRole('button', { name: 'יותר מנות' }).click();
  const after = await page.locator('.ing-list li').first().innerText();
  if (before === after || !after.includes('9')) throw new Error(`${before} → ${after}`);
  await shot('8-recipe');
  await page.getByRole('button', { name: /חסרים לרשימת הקניות/ }).click();
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => window.__db.records.filter((r) => r.module === 'shopping' && r.data.name === 'פלפל אדום').length);
  if (n !== 1) throw new Error('missing items not added');
});
await step('home: skip + weekly score', async () => {
  await page.goto(url + '#/home');
  await page.locator('.item', { hasText: 'האכלה' }).getByRole('button', { name: 'דלג' }).click();
  await page.waitForTimeout(300);
  await page.locator('.item', { hasText: 'מים טריים' }).locator('input[type=checkbox]').click();
  await page.waitForTimeout(500);
  await page.goto(url + '#/more'); await page.goto(url + '#/home');
  await page.getByText('7 הימים האחרונים').waitFor({ timeout: 3000 });
});
await step('recipe site standalone', async () => {
  await page.goto(url + 'recipes/');
  await page.locator('.rcard').first().waitFor({ timeout: 5000 });
  await page.locator('input[type=search]').fill('חומוס');
  await page.waitForTimeout(200);
  if ((await page.locator('.rcard').count()) < 2) throw new Error('search');
  await shot('9-site');
});
await step('desktop layout', async () => { await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(url + '#/home'); await page.waitForTimeout(300); await shot('5-desktop'); });

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
await browser.close(); srv.close();
process.exit(errors.length ? 1 : 0);
