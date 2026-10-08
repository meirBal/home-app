// End-to-end: real Hebrew .docx → app (headless Chromium) → checks → export Word (single + split zip).
// usage: node book/tests/smoke.mjs [outDir]   (needs playwright + the "docx" npm package; FONT env = installed font)
import { chromium } from 'playwright';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from 'docx';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(process.argv[2] || '/tmp/book-smoke'); fs.mkdirSync(OUT, { recursive: true });
const FONT = process.env.FONT || 'FreeSerif';

// ----- fixture: headings, niqqud + te'amim, mixed sizes, bold, centered line, page break, empty line -----
const verse = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ וְחֹ֖שֶׁךְ עַל־פְּנֵ֣י תְה֑וֹם ';
const P = (t, o = {}) => new Paragraph({ bidirectional: true, ...o, children: [new TextRun({ text: t, rightToLeft: true, size: 22, sizeComplexScript: 22, ...o.run })] });
const children = [];
for (let ch = 1; ch <= 6; ch++) {
  children.push(P(`פרשה ${ch}`, { heading: HeadingLevel.HEADING_1, run: { size: 32, sizeComplexScript: 32, bold: true, boldComplexScript: true } }));
  children.push(P('מאמר פתיחה', { alignment: AlignmentType.CENTER, run: { size: 26, sizeComplexScript: 26 } }));
  for (let i = 0; i < 6; i++) children.push(P(verse.repeat(3 + (i % 3))));
  children.push(P(''));
}
children.splice(10, 0, new Paragraph({ children: [new PageBreak()] }));
children.push(new Paragraph({ bidirectional: true, children: [new TextRun({ text: 'לפני השבירה', rightToLeft: true }), new PageBreak(), new TextRun({ text: 'אחרי השבירה', rightToLeft: true })] }));
children.push(P('כותרת אחרונה', { heading: HeadingLevel.HEADING_1, run: { size: 32, sizeComplexScript: 32, bold: true } }));
const docx = path.join(OUT, 'fixture.docx');
fs.writeFileSync(docx, await Packer.toBuffer(new Document({ sections: [{ children }] })));

// ----- serve app -----
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const srv = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'text/plain' }); s.end(b); });
}).listen(0);

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { errors.push(`${name}: ${e.message.split('\n')[0]}`); console.log('✗', name); } };
const pick = async (k, v) => page.locator(`[data-k="${k}"]`).selectOption(v);

await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await step('custom installed font', async () => {
  await pick('font', 'custom'); await page.locator('[data-k="fontName"]').fill(FONT); await page.locator('[data-k="fontName"]').dispatchEvent('change');
});
await step('load docx → original preview', async () => {
  await page.setInputFiles('#file', docx);
  await page.waitForFunction(() => document.querySelectorAll('#orig p').length > 20);
  const info = await page.textContent('#origInfo');
  if (!/גודל עיקרי 11pt/.test(info)) throw new Error('body size detection: ' + info);
});
let pages = 0;
await step('run → pages, nothing overflows, font found', async () => {
  await page.click('#run');
  await page.waitForFunction(() => document.querySelectorAll('#result .page').length > 3, null, { timeout: 20000 });
  pages = await page.locator('#result .page').count();
  const over = await page.$$eval('#result .body', (bs) => bs.filter((b) => b.lastElementChild && b.lastElementChild.offsetTop + b.lastElementChild.offsetHeight > b.clientHeight + 1).length);
  if (over) throw new Error(`${over} pages overflow`);
  if (pages % 4) throw new Error('padding to 4 failed: ' + pages);
  if (!(await page.locator('#fontWarn').isHidden())) throw new Error('font reported missing');
});
await step('running header + Hebrew page numbers', async () => {
  const hd = await page.locator('#result .page').nth(1).locator('.hd').textContent();
  if (!/פרשה 1/.test(hd) || !/ב/.test(hd)) throw new Error('header: ' + hd);
});
await step('Word page break respected', async () => {
  const t = await page.locator('#result .page').nth(0).textContent();
  if (/פרשה 2/.test(t)) throw new Error('page break ignored');
});
await step('page editor: copy-forward header + blank page', async () => {
  await page.locator('#result .page').nth(2).click();
  await page.fill('#edHead', 'פרק מיוחד'); await page.check('#edFwd');
  await page.click('#ed button[value="ok"]');
  const nx = page.locator('#result .page').nth(3);          // same section → inherits; new Word heading → stops
  if (!/פרק מיוחד/.test(await nx.locator('.hd').textContent()) && !(await nx.locator('.h').count())) throw new Error('forward apply');
  await page.locator('#result .page').nth(2).click(); await page.click('#ed [data-a="blank"]');
  if (!(await page.locator('#result .page').nth(3).evaluate((e) => e.classList.contains('blank')))) throw new Error('blank insert');
  await page.locator('#result .page').nth(1).click(); await page.click('#ed [data-a="prev"]');
  if (!/פרשה 1/.test(await page.inputValue('#edHead'))) throw new Error('copy prev');
  await page.click('#ed button[value="cancel"]');
});
await step('mid-paragraph page break + final heading kept', async () => {
  const pages = await page.$$eval('#result .page .body', (bs) => bs.map((b) => b.textContent));
  const a = pages.findIndex((x) => x.includes('לפני השבירה')), b = pages.findIndex((x) => x.includes('אחרי השבירה'));
  if (a < 0 || b !== a + 1) throw new Error(`break pages ${a},${b}`);
  if (!pages.some((x) => x.includes('כותרת אחרונה'))) throw new Error('final heading lost');
});
await step('auto header restore after an edit (dialog returnValue)', async () => {
  await page.locator('#result .page').nth(1).click(); await page.fill('#edHead', 'זמני'); await page.click('#ed button[value="ok"]');
  await page.locator('#result .page').nth(1).click(); await page.click('#ed [data-a="auto"]');
  if (/זמני/.test(await page.locator('#result .page').nth(1).locator('.hd').textContent())) throw new Error('auto not restored');
});
await step('header edit survives re-layout (anchored ids)', async () => {
  await page.locator('#result .page').nth(4).click(); await page.fill('#edHead', 'עוגן'); await page.click('#ed button[value="ok"]');
  await page.locator('[data-k="bodyPt"]').fill('15'); await page.locator('[data-k="bodyPt"]').dispatchEvent('change');
  await page.waitForFunction(() => [...document.querySelectorAll('#result .hd')].some((h) => h.textContent.includes('עוגן')), null, { timeout: 10000 });
  await page.locator('[data-k="bodyPt"]').fill('16'); await page.locator('[data-k="bodyPt"]').dispatchEvent('change');
  await page.waitForTimeout(1500);
});
await step('niqqud-off setting re-lays out', async () => {
  await pick('marks', 'none');
  await page.waitForFunction(() => !/[֑-ׇֽׁׂׅׄ]/.test(document.querySelector('#result .page .body').textContent), null, { timeout: 10000 });
  await pick('marks', 'all');
  await page.waitForFunction(() => /[ְ-ּ]/.test(document.querySelector('#result .page .body').textContent), null, { timeout: 10000 });
});
await step('export single Word file', async () => {
  pages = await page.locator('#result .page').count();
  await page.click('#save');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#exWord')]);
  await d.saveAs(path.join(OUT, 'out.docx'));
});
await step('export split → zip of 2 parts', async () => {
  await page.selectOption('#exMode', 'every'); await page.fill('#exSpec', String(Math.ceil(pages / 2)));
  if ((await page.locator('#exList li').count()) !== 2) throw new Error('plan');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#exWord')]);
  await d.saveAs(path.join(OUT, 'parts.zip'));
});
await page.click('#ex button[value="close"]');
await page.screenshot({ path: path.join(OUT, 'app.png') });
fs.writeFileSync(path.join(OUT, 'pages.txt'), String(pages));
await browser.close(); srv.close();
console.log(errors.length ? '\nFAIL\n' + errors.join('\n') : `\nOK — ${pages} pages`);
process.exitCode = errors.length ? 1 : 0;
