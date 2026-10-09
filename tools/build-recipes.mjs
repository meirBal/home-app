// ===== RECIPE BUILDER — recipes/src/*.txt → validated JSON (recipes/data) =====
// usage: node tools/build-recipes.mjs          (fails with exit 1 on any error; nothing is written)
//
// Source format (one block per recipe, blank line between blocks):
//   # שם | קטגוריה | ארוחות(b/l/d) | רעב(L/H/V) | כשרות(פרווה/חלבי/בשרי) | קושי(1-3) | הכנה | בישול | מנות
//   ! תיאור קצר (אופציונלי)
//   - 2 כוס קמח            ← כמות (מספר / 1/2 / 1.5 / ~ ללא כמות), יחידה (אם מוכרת), שם, (הערה) בסוגריים
//   > שלב הכנה
//   @ תגית, תגית          (אופציונלי)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'recipes/src'), OUT = path.join(ROOT, 'recipes/data');
export const UNITS = ['כוס', 'כוסות', 'כף', 'כפות', 'כפית', 'כפיות', 'גרם', 'ק"ג', 'מ"ל', 'ליטר', "יח'", 'שן', 'שיני', 'קופסה',
  'קופסאות', 'חבילה', 'חבילות', 'קורט', 'צרור', 'פרוסות', 'פרוסה', 'מקל', 'עלים', 'גבעול', 'פחית', 'שקית', 'קוביות', 'קוביה'];
const CATS = ['ארוחת בוקר', 'מנה עיקרית', 'תוספת', 'סלט', 'מרק', 'מאפה', 'קינוח', 'נשנוש', 'רוטב וממרח'];

// ---- [Kashrut rules: recipe-level (ingredient certification is the buyer's responsibility)] ----
// Hebrew final letters (ן ם ף ץ ך) are written out explicitly: "סרטן" must match as well as "סרטנים"
const FORBIDDEN = /חזיר|בייקון|פרושוטו|קותלי|פנצ'טה|שינקן|לארד|שרימפ|חסילונ|סרט[נן]|לובסטר|קלמרי|קלמארי|תמנון|צד[פף]|פירות ים|מולים|סקאלופ|צלופח|שפמנון|כריש(?!ה)|קוויאר|ארנבת|ארנב|ג'לטין|גלטין/;
const MEAT = /בשר|עוף|הודו|פרגי|כבש|טלה|בקר|עגל|ברווז|אווז|שמאלץ|לשון|אנטריקוט|סטייק|נקניק|קבנוס|מרגז|פפרוני|צ'וריסו|שניצל|קבב|המבורגר|כבד|כרעיים|כנפיים|שוקיים|שוק עוף|צלעות|אסאדו|אוסובוקו|פסטרמה|סלמי|שווארמה|ציר עוף|ציר בקר|גולש/;
const DAIRY = /חלב|חמאה|חמאת|גבינ|שמנת|יוגורט|לבנה|מוצרל|פרמזן|פקורינו|קוטג|ריקוטה|מסקרפונה|פטה|צפתית|בולגרית|ברינזה|קשקבל|חלומי|צ'דר|קממבר|גבינת ברי|רוקפור|גאודה|אמנטל|בשמל|קרם פרש/;
const PAREVE_SUB = new RegExp(/חלב קוקוס|קרם קוקוס|חלב סויה|חלב שקדים|חלב שיבולת|חלב אורז|שמנת צמחית|שמנת קוקוס|חמאה צמחית|מרגרינה|חמאת בוטנים|חמאת שקדים|חמאת קוקוס|גבינה טבעונית|יוגורט סויה|קרם צמחי/.source, 'g');
const FISH = /דג|סלמון|טונה|אמנון|לברק|דניס|בורי|הליבוט|בקלה|מקרל|סרדינ|אנשובי|פילה מושט|קוד|פורל|טילאפיה|קרפיון|לוקוס|ברבוניה|הרינג|מטיאס|ווסטרשייר/;
const fishFP = /דגני|דגנים/g;   // "דגני בוקר" is cereal, not fish
// egg whites, halva, "meaty" tomatoes, fish steaks, and plant-based products named after meat/dairy
const FALSE_POS = /חלבו[נן]\S*|חלבה|בשרני\S*|ללא חלב|ללא גלוטן|סטייק(?= (טונה|סלמון|דג))|(שניצל|המבורגר|סטייק|קציצות|נקניק|שמנת|גבינה|חלב|יוגורט)(\s\S+)?\s(צמחי|צמחית|טבעוני|טבעונית|תירס|כרובית|סויה|קוקוס)\S*/g;

function kashrut(r) {
  const ing = [r.name, r.desc, ...r.ingredients.map((i) => `${i.name} ${i.note || ''}`)].join(' | ');
  const err = [];
  // forbidden foods: ingredient list only (steps are full of verbs like "מחזירים" that contain "חזיר")
  if (FORBIDDEN.test(ing)) err.push('מרכיב לא כשר');
  // meat/dairy: steps count too ("מטגנים בחמאה"); with a parve substitute in the list, "חלב" in a step means that substitute
  const hasSub = new RegExp(PAREVE_SUB.source).test(ing);
  const steps = r.steps.join(' | ').replace(hasSub ? /(ה|מה|ב|ל|ו)?(חלב|שמנת|חמאה|יוגורט)/g : /$^/, '');
  const plain = `${ing} | ${steps}`.replace(PAREVE_SUB, '').replace(FALSE_POS, '');
  const meat = MEAT.test(plain), dairy = DAIRY.test(plain), fish = FISH.test(plain.replace(fishFP, ''));
  if (meat && dairy) err.push('בשר וחלב יחד');
  if (meat && fish) err.push('בשר ודגים יחד (סכנה)');
  const want = meat ? 'בשרי' : dairy ? 'חלבי' : 'פרווה';
  if (r.kosher !== want) err.push(`כשרות מוצהרת "${r.kosher}" אבל לפי המרכיבים "${want}"`);
  if (fish) r.tags = [...new Set([...(r.tags || []), 'דגים', ...(dairy ? ['דג+חלב'] : [])])];   // some communities avoid fish with dairy
  return err;
}

// ---- [Parser] ----
const num = (s) => {
  if (s === '~') return null;
  if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split('/'); return +a / +b; }
  if (/^\d+-\d+$/.test(s)) return +s.split('-')[0];
  return /^\d+(\.\d+)?$/.test(s) ? +s : undefined;
};

function parseIngredient(line, where) {
  const m = line.match(/^(\S+)\s+(.*)$/);
  if (!m) throw new Error(`${where}: מרכיב לא תקין "${line}"`);
  const qty = num(m[1]);
  if (qty === undefined) throw new Error(`${where}: כמות לא תקינה "${m[1]}" (מספר, שבר או ~)`);
  let rest = m[2].trim(), unit = '';
  const u = UNITS.find((x) => rest.startsWith(x + ' '));
  if (u) { unit = u; rest = rest.slice(u.length).trim(); }
  const note = rest.match(/\(([^)]*)\)\s*$/);
  const name = (note ? rest.slice(0, note.index) : rest).trim();
  if (!name) throw new Error(`${where}: חסר שם מרכיב`);
  return { qty, unit, name, ...(note && { note: note[1] }) };
}

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.startsWith('#'));
  const out = [], errs = [];
  blocks.forEach((b, bi) => { try { out.push(parseBlock(b, bi, file)); } catch (e) { errs.push(e.message); } });
  return { out, errs };
}

function parseBlock(b, bi, file) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const head = lines[0].slice(1).split('|').map((s) => s.trim());
    const where = `${path.basename(file)} #${bi + 1} (${head[0]})`;
    if (head.length !== 9) throw new Error(`${where}: כותרת צריכה 9 שדות`);
    const [name, cat, meals, hunger, kosher, diff, prep, cook, servings] = head;
    const r = { name, cat, meals: [...meals], hunger: [...hunger], kosher, difficulty: +diff, prep: +prep, cook: +cook,
      servings: +servings, desc: '', ingredients: [], steps: [], tags: [] };
    for (const l of lines.slice(1)) {
      if (l.startsWith('- ')) r.ingredients.push(parseIngredient(l.slice(2), where));
      else if (l.startsWith('> ')) r.steps.push(l.slice(2));
      else if (l.startsWith('! ')) r.desc = l.slice(2);
      else if (l.startsWith('@ ')) r.tags = l.slice(2).split(',').map((t) => t.trim()).filter(Boolean);
      else throw new Error(`${where}: שורה לא מזוהה "${l}"`);
    }
    const errs = [];
    if (!CATS.includes(cat)) errs.push(`קטגוריה "${cat}" (מותר: ${CATS.join('/')})`);
    if (!r.meals.every((x) => 'bld'.includes(x)) || !r.meals.length) errs.push('ארוחות b/l/d');
    if (!r.hunger.every((x) => 'LHV'.includes(x)) || !r.hunger.length) errs.push('רעב L/H/V');
    if (![1, 2, 3].includes(r.difficulty)) errs.push('קושי 1-3');
    if (![r.prep, r.cook, r.servings].every((x) => Number.isFinite(x) && x >= 0) || r.servings < 1) errs.push('זמנים/מנות');
    if (r.ingredients.length < 2) errs.push('פחות מ-2 מרכיבים');
    if (!r.steps.length) errs.push('אין שלבי הכנה');
    errs.push(...kashrut(r));
    if (errs.length) throw new Error(`${where}: ${errs.join('; ')}`);
    return r;
}

// ---- [Build] ----
const slug = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort();
const all = [], errors = [], seen = new Map(), ids = new Map();
for (const f of files) {
  try {
    const { out: rs, errs } = parseFile(path.join(SRC, f));
    errors.push(...errs);
    for (const r of rs) {
      const k = r.name.replace(/\s+/g, ' ');
      if (seen.has(k)) { errors.push(`כפילות: "${r.name}" (${seen.get(k)} + ${f})`); continue; }
      seen.set(k, f);
      r.id = slug(k);
      if (ids.has(r.id)) { errors.push(`התנגשות מזהה: "${r.name}" ו-"${ids.get(r.id)}" — לשנות מעט את השם`); continue; }
      ids.set(r.id, r.name);
      r.batch = path.basename(f, '.txt');
      all.push(r);
    }
  } catch (e) { errors.push(e.message); }
}
if (errors.length) { console.error('✗ ' + errors.join('\n✗ ')); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.startsWith('batch-')) fs.rmSync(path.join(OUT, f));   // LOG.md is kept
const byBatch = Map.groupBy(all, (r) => r.batch);
for (const [b, rs] of byBatch) fs.writeFileSync(path.join(OUT, `batch-${b}.json`), JSON.stringify(rs.map(({ batch, ...r }) => r)));
// compact index: enough for search, filters and stock matching; full recipe loads on open
const index = all.map((r) => ({ id: r.id, n: r.name, c: r.cat, m: r.meals.join(''), h: r.hunger.join(''), k: r.kosher,
  d: r.difficulty, t: r.prep + r.cook, s: r.servings, i: r.ingredients.map((x) => x.name), b: r.batch }));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
const cnt = (k) => Object.entries(Object.groupBy(all, (r) => r[k])).map(([a, b]) => `${a}:${b.length}`).join(' ');
console.log(`✓ ${all.length} מתכונים ב-${byBatch.size} קבצים · ${cnt('kosher')} · ${cnt('cat')}`);
