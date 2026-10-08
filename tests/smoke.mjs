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

const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log('✗', name); } };
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
  }));
  if (r.milk.length !== 1 || !r.bread || r.exp !== 42.5) throw new Error(JSON.stringify(r));
});
await step('more grid + admin', async () => {
  await page.goto(url + '#/more'); await page.getByText('כל האזורים').waitFor();
  await page.goto(url + '#/admin'); await page.getByText('מודולים').waitFor();
  await page.goto(url + '#/calendar'); await page.goto(url + '#/expenses'); await page.goto(url + '#/recipes'); await page.goto(url + '#/photos');
  await page.waitForTimeout(400);
});
await step('desktop layout', async () => { await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(url + '#/home'); await page.waitForTimeout(300); await shot('5-desktop'); });

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
await browser.close(); srv.close();
process.exit(errors.length ? 1 : 0);
