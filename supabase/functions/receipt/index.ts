// ===== EDGE FUNCTION receipt — receipt photo or digital PDF → structured items (Gemini free tier) =====
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-flash-latest)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT = `זו קבלה מסופרמרקט/חנות בישראל (צילום או PDF ממוחשב, ייתכן כמה עמודים). חלץ את כל הפריטים שנקנו.
כללים:
- name: שם מוצר קצר וברור בעברית כמו ברשימת קניות ("חלב 3%", "כרוב אדום", "שמפו"). בלי ברקוד/מק"ט. השלם קיצורים חתוכים כשהמשמעות ברורה.
- שם שנחתך בין עמודים או בין שורות שייך לשורה שהמחיר שלה מופיע לידו או אחריו — אחד אותם לפריט אחד.
- qty: כמות. מוצר בשקילה (ק"ג) → המשקל. unit: אחד מ: יח׳, ק״ג, גרם, ליטר, מ״ל, אריזה.
- price: הסכום ששולם על השורה. שורות מבצע/הנחה ("2 ב 36", "3 ב 50", "מוגבל 3", "הנחה", מספר שלילי) אינן פריטים — אל תוסיף אותן כפריט.
- התעלם: פיקדון/מיחזור אריזה, שקית, עיגול, אמצעי תשלום, מע"מ, סיכומי ביניים.
- category: אחת מ: ירקות ופירות, מוצרי חלב, בשר ודגים, מאפים, יבשים ושימורים, קפואים, משקאות, ניקיון, טואלטיקה, תינוקות, בעלי חיים, כלי בית, אחר
- durable: true למוצר שאינו מתכלה (כלים, מכשירי חשמל, כלי מטבח, תאורה, טקסטיל, כלי עבודה); false למזון ומתכלים.
- warranty_months: רק למכשירי חשמל/אלקטרוניקה (מיחם, פלטה, מנורה חשמלית, מכשיר מטבח) — 12 אם לא ידוע אחרת; אחרת 0.
store = שם החנות/הרשת, date = תאריך הקנייה YYYY-MM-DD, total = הסכום הסופי ששולם (אחרי הנחות) אם מופיע.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    store: { type: 'STRING' }, date: { type: 'STRING' }, total: { type: 'NUMBER' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, price: { type: 'NUMBER' },
      category: { type: 'STRING' }, durable: { type: 'BOOLEAN' }, warranty_months: { type: 'NUMBER' } }, required: ['name'] } },
  },
  required: ['items'],
};
const MIMES = ['image/jpeg', 'application/pdf'];

const DAILY_CAP = 30;                                           // AI scans per household per 24h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try { return await handle(req); } catch (e) { console.error(e); return json({ error: 'שגיאת שרת' }, 500); }
});

async function handle(req: Request) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'סריקת קבלות עדיין לא הופעלה (חסר מפתח Gemini אצל המנהל)' }, 503);

  // Acts as the calling user (RLS applies): only household members, with a daily cap per household.
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, anon,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: 'יש להתחבר מחדש' }, 401);
  const { data: m } = await sb.from('members').select('household_id').eq('user_id', u.user.id).limit(1);
  const hid = m?.[0]?.household_id;
  if (!hid) return json({ error: 'אין הרשאה' }, 403);
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await sb.from('ai_calls').select('id', { count: 'exact', head: true }).eq('household_id', hid).gte('at', since);
  if ((count ?? 0) >= DAILY_CAP) return json({ error: `הגעתם ל־${DAILY_CAP} סריקות היום — נסו מחר` }, 429);

  let image: string, mime: string;
  try { ({ image, mime = 'image/jpeg' } = await req.json()); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  if (!MIMES.includes(mime)) return json({ error: 'סוג קובץ לא נתמך (תמונה או PDF)' }, 400);
  if (typeof image !== 'string' || image.length < 1000 || image.length > 4_500_000) return json({ error: 'הקובץ לא תקין או גדול מדי' }, 400);

  // primary model, then the lighter one when Google reports overload/quota (free tier spikes are common)
  const models = [Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  await sb.from('ai_calls').insert({ household_id: hid, user_id: u.user.id });
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  });
  let r: Response | undefined;
  for (const model of models) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    }).catch(() => undefined);
    if (r?.ok || (r && ![429, 500, 503].includes(r.status))) break;
    console.error('gemini', model, r?.status ?? 'timeout');
  }
  if (!r?.ok) {
    if (r) console.error('gemini', r.status, (await r.text()).slice(0, 300));
    return json({ error: r?.status === 429 ? 'עברנו את המכסה החינמית להיום — נסו מחר' : 'שירות ה-AI עמוס כרגע — נסו שוב בעוד דקה' }, 502);
  }
  try {
    const out = await r.json();
    const parsed = JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
    parsed.items = (parsed.items ?? []).filter((i: { name?: string }) => i?.name?.trim()).slice(0, 150);
    return json(parsed);
  } catch {
    return json({ error: 'לא הצלחתי לקרוא את הקבלה — נסו צילום חד וישר יותר' }, 422);
  }
}
