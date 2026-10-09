// ===== EDGE FUNCTION receipt — photo of a grocery receipt → structured items (Gemini free tier) =====
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-flash-latest)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT = `זו תמונה של קבלה מסופרמרקט/חנות בישראל. חלץ את כל הפריטים שנקנו.
- name: שם מוצר קצר וכללי בעברית כפי שאדם היה כותב ברשימת קניות (למשל "חלב 3%" ולא קוד או מק"ט). תקן קיצורים.
- qty: כמות (מספר). למוצרים בשקילה — המשקל בק"ג.
- unit: אחד מ: יח׳, ק״ג, גרם, ליטר, מ״ל, אריזה
- price: המחיר הכולל ששולם על השורה (אחרי הנחות), מספר.
- category: אחת מ: ירקות ופירות, מוצרי חלב, בשר ודגים, מאפים, יבשים ושימורים, קפואים, משקאות, ניקיון, טואלטיקה, תינוקות, בעלי חיים, אחר
התעלם משורות שאינן מוצרים (שקית, עיגול, אמצעי תשלום, מע"מ). אחד שורות כפולות של אותו מוצר.
store = שם החנות, date = תאריך הקנייה בפורמט YYYY-MM-DD (או ריק), total = סכום לתשלום.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    store: { type: 'STRING' }, date: { type: 'STRING' }, total: { type: 'NUMBER' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' },
      price: { type: 'NUMBER' }, category: { type: 'STRING' } }, required: ['name'] } },
  },
  required: ['items'],
};

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

  let image: string;
  try { ({ image } = await req.json()); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  if (typeof image !== 'string' || image.length < 1000 || image.length > 4_500_000) return json({ error: 'תמונה לא תקינה או גדולה מדי' }, 400);

  // primary model, then the lighter one when Google reports overload/quota (free tier spikes are common)
  const models = [Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  await sb.from('ai_calls').insert({ household_id: hid, user_id: u.user.id });
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }],
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
