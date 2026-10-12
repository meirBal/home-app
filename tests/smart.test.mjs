// Unit tests for name matching & guessing (pure part of js/core/smart.js). usage: node tests/smart.test.mjs
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/core/smart.js', import.meta.url), 'utf8');
const pure = src.slice(src.indexOf('export const norm'), src.indexOf('// ---- [Product state] ----'));
const { similar, guess } = await import('data:text/javascript,' + encodeURIComponent(pure));
let bad = 0;
const eq = (got, want, label) => { if (got !== want) { bad++; console.log('✗', label, got, '≠', want); } };
for (const [a, b, e] of [['חלב', 'חלב 3% תנובה', true], ['חלב', 'שוקולד חלב', false], ['עגבנייה', 'רסק עגבניות', false],
  ['ביצה', 'ביצים L', true], ['חלב', 'חלבה', false], ['לחם', 'פירורי לחם', false], ['תפוחי אדמה', 'תפוח אדמה', true],
  ['גבינה', 'גבינה צהובה 28%', true], ['דג', 'דגני בוקר', false], ['עגבניות', 'עגבנייה', true]]) eq(similar(a, b), e, `${a}|${b}`);
for (const [n, cat] of [['מרכך כביסה', 'ניקיון'], ['מרכך שיער', 'טואלטיקה'], ['נוזל כלים לימון', 'ניקיון'], ['שמנת מתוקה', 'מוצרי חלב'],
  ['שמן קנולה', 'יבשים ושימורים'], ['פלפל שחור', 'יבשים ושימורים'], ['פלפל אדום', 'ירקות ופירות'], ['קרמבו', null],
  ['חמאת בוטנים', null], ['דגני בוקר', 'יבשים ושימורים'], ['קולה ללא סוכר', 'משקאות']]) eq(guess(n).category, cat, n);
// debt checks: stale after 10 days, unpaid debt keeps nagging until marked paid
const debtSrc = src.slice(src.indexOf('// ---- [Debt checks'));
const { latestByProvider, debtAttention, DEBT_PROVIDERS } = await import('data:text/javascript,' + encodeURIComponent(debtSrc));
const T = Date.parse('2026-10-12T12:00:00Z'), ago = (d) => new Date(T - d * 864e5).toISOString();
const att = (rows) => debtAttention(DEBT_PROVIDERS, latestByProvider(rows), T).length;
eq(att([]), 1, 'never checked');
eq(att([{ data: { provider: 'iec' }, amount: 0, created_at: ago(3) }]), 0, 'fresh, no debt');
eq(att([{ data: { provider: 'iec' }, amount: 0, created_at: ago(10) }]), 1, 'stale');
eq(att([{ data: { provider: 'iec' }, amount: 50, created_at: ago(1) }]), 1, 'unpaid');
eq(att([{ data: { provider: 'iec' }, amount: 50, done: true, created_at: ago(1) }, { data: { provider: 'iec' }, amount: 0, created_at: ago(30) }]), 0, 'paid; newest wins');
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
