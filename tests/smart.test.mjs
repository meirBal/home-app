// Unit tests for name matching & guessing (pure part of js/core/smart.js). usage: node tests/smart.test.mjs
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/core/smart.js', import.meta.url), 'utf8');
const pure = src.slice(src.indexOf('export const norm'), src.indexOf('// ---- [Product state] ----'));
const { similar, guess, groupOf } = await import('data:text/javascript,' + encodeURIComponent(pure));
let bad = 0;
const eq = (got, want, label) => { if (got !== want) { bad++; console.log('✗', label, got, '≠', want); } };
for (const [a, b, e] of [['חלב', 'חלב 3% תנובה', true], ['חלב', 'שוקולד חלב', false], ['עגבנייה', 'רסק עגבניות', false],
  ['ביצה', 'ביצים L', true], ['חלב', 'חלבה', false], ['לחם', 'פירורי לחם', false], ['תפוחי אדמה', 'תפוח אדמה', true],
  ['גבינה', 'גבינה צהובה 28%', true], ['דג', 'דגני בוקר', false], ['עגבניות', 'עגבנייה', true]]) eq(similar(a, b), e, `${a}|${b}`);
for (const [n, cat] of [['מרכך כביסה', 'ניקיון'], ['מרכך שיער', 'טואלטיקה'], ['נוזל כלים לימון', 'ניקיון'], ['שמנת מתוקה', 'מוצרי חלב'],
  ['שמן קנולה', 'יבשים ושימורים'], ['פלפל שחור', 'יבשים ושימורים'], ['פלפל אדום', 'ירקות ופירות'], ['קרמבו', null],
  ['חמאת בוטנים', null], ['דגני בוקר', 'יבשים ושימורים'], ['קולה ללא סוכר', 'משקאות']]) eq(guess(n).category, cat, n);
// generic groups: brand lines collapse; look-alikes stay themselves
for (const [n, g] of [['במבה אסם 80 גרם', 'חטיפים'], ['ביסלי גריל', 'חטיפים'], ["צ'יפס תפוצ'יפס", 'חטיפים'], ['שוקולד פרה מריר 4*100', 'ממתקים ושוקולד'],
  ['קרמבו מוקה שטראוס 8', 'ממתקים ושוקולד'], ['קוקה קולה 1.5 ליטר', 'שתייה מתוקה'], ['פאנטה אקזוטיק 330', 'שתייה מתוקה'], ['אייס קפה', 'שתייה מתוקה'],
  ['מארז בירה גולדסטאר', 'אלכוהול'], ['יין אקסלנס שיראז', 'אלכוהול'],
  ['קולורבי', null], ['חסה אייסברג', null], ['חומץ יין', null], ['משקה סויה', null], ['כפפות גומי', null], ['חלב 3%', null], ['שוקולד לאפייה', null]])
  eq(groupOf(n)?.name ?? null, g, 'group: ' + n);
const { BASICS } = await import('../js/data/seeds.js');            // every catalog basic lands in a real aisle
for (const [n] of BASICS) eq(!!guess(n).category, true, 'aisle: ' + n);
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
