// Perf: one giant paragraph vs many paragraphs (~same text). usage: node book/tests/perf.mjs
import { chromium } from 'playwright';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), OUT = '/tmp/book-perf'; fs.mkdirSync(OUT, { recursive: true });
const v = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ ';
const mk = async (name, paras) => { const f = path.join(OUT, name); fs.writeFileSync(f, await Packer.toBuffer(new Document({ sections: [{ children: paras.map((t) => new Paragraph({ bidirectional: true, children: [new TextRun({ text: t, rightToLeft: true })] })) }] }))); return f; };
const big = await mk('one.docx', [v.repeat(6000)]), many = await mk('many.docx', Array(600).fill(v.repeat(10)));
const srv = http.createServer((q, s) => { const f = path.join(ROOT, q.url.split('?')[0].replace(/\/$/, '/index.html')); fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); s.end(b); }); }).listen(0);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const p = await br.newPage(); await p.route('**/fonts.googleapis.com/**', (r) => r.abort());
await p.goto(`http://127.0.0.1:${srv.address().port}/`);
await p.locator('[data-k="font"]').selectOption('custom'); await p.locator('[data-k="fontName"]').fill('FreeSerif'); await p.locator('[data-k="fontName"]').dispatchEvent('change');
for (const f of [many, big]) {
  await p.setInputFiles('#file', f); await p.waitForFunction(() => !document.querySelector('#run').disabled);
  const t = Date.now(); await p.click('#run');
  await p.waitForFunction(() => document.querySelectorAll('#result .page').length > 5 && !document.querySelector('#run').disabled, null, { timeout: 120000 });
  console.log(path.basename(f), await p.locator('#result .page').count(), 'pages', Date.now() - t, 'ms');
}
await br.close(); srv.close();
