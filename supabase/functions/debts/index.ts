// ===== EDGE FUNCTION debts — log in to a provider with the user's one-time code, read the open debt =====
// Stateless, 2 steps: {op:'start', provider, id} → code sent, returns {flow}; {op:'verify', provider, flow, code} → result saved.
// Nothing sensitive is stored or logged: no ID number, code or provider token. Only the result row (records, module 'debts').
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class UserError extends Error {}                       // message is safe to show the user

// per 24h [household, all households] — codes go to real phones; one shared server IP must not get blocked
const CAP = { debts_start: [5, 200], debts_verify: [15, 600] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try { return await handle(req); } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e instanceof Error ? e.message : (e as any)?.code ?? 'error');   // never URLs/bodies (see call())
    return json({ error: 'הספק לא ענה כרגע — נסו שוב בעוד כמה דקות' }, 502);
  }
});

// ---- [Request: household member, quota, dispatch to provider] ----
async function handle(req: Request) {
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, anon,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: 'יש להתחבר מחדש' }, 401);
  const { data: m } = await sb.from('members').select('household_id').eq('user_id', u.user.id).maybeSingle();   // one household per user
  const hid = m?.household_id;
  if (!hid) return json({ error: 'אין הרשאה' }, 403);

  const b = (await req.json().catch(() => null)) ?? {};
  const p = Object.hasOwn(PROVIDERS, b.provider) ? PROVIDERS[b.provider] : null;
  if (!p) throw new UserError('ספק לא מוכר');
  const kind = b.op === 'start' ? 'debts_start' : b.op === 'verify' ? 'debts_verify' : null;
  if (!kind) throw new UserError('פעולה לא מוכרת');
  const id = String(b.id ?? ''), code = String(b.code ?? '');
  if (kind === 'debts_start' && !validId(id)) throw new UserError('מספר הזהות לא תקין');
  if (kind === 'debts_verify' && (!/^\d{4,8}$/.test(code) || typeof b.flow !== 'object' || !b.flow)) throw new UserError('קוד לא תקין');

  const q = await sb.rpc('take_quota', { p_kind: kind, p_house_cap: CAP[kind][0], p_global_cap: CAP[kind][1] });
  if (q.error) throw q.error;                          // fail closed
  if (!q.data) throw new UserError('יותר מדי ניסיונות היום — נסו שוב מחר');

  const deadline = AbortSignal.timeout(25000);         // whole provider flow, below the client's patience
  if (kind === 'debts_start') return json(await p.start(id.padStart(9, '0'), deadline));

  const r = await p.verify(b.flow, code, deadline);
  const late = r.items.filter((i) => i.overdue > 0);
  const row = {
    household_id: hid, module: 'debts', amount: r.total, done: r.total <= 0,
    due: r.items.filter((i) => i.debt > 0).map((i) => i.due).filter(Boolean).sort()[0] ?? null,
    data: { provider: b.provider, title: p.title, overdue: money(late.reduce((s, i) => s + i.overdue, 0)), items: r.items },
  };
  const { error } = await sb.from('records').insert(row);
  if (error) throw error;
  return json(row);
}

// Israeli ID check digit (also checked on the phone; the server must not trust it)
const validId = (id: string) => /^\d{5,9}$/.test(id) && [...id.padStart(9, '0')]
  .reduce((s, d, i) => { const x = +d * (i % 2 + 1); return s + (x > 9 ? x - 9 : x); }, 0) % 10 === 0;

type Item = { name: string; debt: number; overdue: number; due: string | null };
type Provider = {
  title: string;
  start(id: string, sig: AbortSignal): Promise<{ flow: Record<string, string>; via: string }>;
  verify(flow: Record<string, string>, code: string, sig: AbortSignal): Promise<{ total: number; items: Item[] }>;
};

// ---- [HTTP to providers: errors never echo URLs (the authorize URL carries a session token)] ----
const OKTA_ERR: Record<string, string> = {
  E0000068: 'הקוד שגוי — נסו שוב', E0000011: 'פג תוקף הקוד — התחילו שוב', E0000004: 'לא נמצא חשבון למספר הזהות הזה',
  E0000047: 'יותר מדי ניסיונות אצל הספק — נסו שוב בעוד כמה דקות',
};
async function call(url: string, init: RequestInit, sig: AbortSignal, asText = false) {
  const where = new URL(url).pathname;
  let r: Response;
  try { r = await fetch(url, { ...init, signal: sig }); } catch { throw new Error(`${where} network`); }
  if (!r.ok) {
    const code = (await r.text()).match(/E00000\d\d/)?.[0];
    if (code && OKTA_ERR[code]) throw new UserError(OKTA_ERR[code]);
    throw new Error(`${where} ${r.status}`);
  }
  try { return asText ? await r.text() : await r.json(); } catch { throw new Error(`${where} bad body`); }   // parse errors quote the body
}
const postJson = (url: string, body: unknown, sig: AbortSignal) => call(url,
  { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) }, sig);
// IEC wraps answers as {data, reponseDescriptor:{isSuccess}} — a failed/empty answer must never read as "no debt"
const unwrap = (j: any, where: string) => {
  if (j?.reponseDescriptor?.isSuccess === false || !(j?.data ?? j)) throw new Error(`${where} unsuccessful`);
  return j.data ?? j;
};

const b64url = (a: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
// Okta's form_post page escapes values (\x2D, &#x2d;)
const deEscape = (s: string) => s.replace(/\\x([0-9a-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)))
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
const date = (d: unknown) => (typeof d === 'string' && /^2\d{3}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);   // IEC sends 1900-01-01 for "none"
const money = (n: unknown) => Math.round((+(n as number) || 0) * 100) / 100;

// ---- [Provider: IEC electricity — Okta OTP → PKCE → id_token → contracts.totalDebt] ----
// Port of github.com/GuyKh/py-iec-api (login.py, data.py, const.py).
const IEC = {
  okta: 'https://iec-ext.okta.com',
  api: 'https://iecapi.iec.co.il/api/',
  client: '0oaqf6zr7yEcQZqqt2p7',
  redirect: 'com.iecrn:/',
  headers: {
    accept: 'application/json, text/plain, */*', origin: 'https://www.iec.co.il', referer: 'https://www.iec.co.il/',
    'x-iec-idt': '1', 'x-iec-webview': '1',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  },
};
const isSms = (f: any) => f.factorType === 'sms' || (f.factorType === 'email' && /@sns\.iec\.co\.il/.test(f.profile?.email ?? ''));

const iec: Provider = {
  title: 'חשמל',
  async start(id, sig) {
    const a = await postJson(`${IEC.okta}/api/v1/authn`, { username: `${id}@iec.co.il` }, sig);
    const factors: any[] = (a?._embedded?.factors ?? []).filter((f: any) => f.factorType === 'sms' || f.factorType === 'email');
    const f = factors.find(isSms) ?? factors[0];
    if (!a?.stateToken || !f) throw new UserError('לא נמצא חשבון בחברת החשמל למספר הזהות הזה');
    await postJson(`${IEC.okta}/api/v1/authn/factors/${f.id}/verify`, { stateToken: a.stateToken }, sig);   // sends the code
    return { flow: { st: a.stateToken, fid: f.id }, via: isSms(f) ? 'sms' : 'email' };
  },
  async verify(flow, code, sig) {
    if (!/^[\w-]{10,100}$/.test(flow.st ?? '') || !/^\w{5,40}$/.test(flow.fid ?? '')) throw new UserError('התחילו שוב');
    const v = await postJson(`${IEC.okta}/api/v1/authn/factors/${flow.fid}/verify`, { stateToken: flow.st, passCode: code }, sig);
    if (!v?.sessionToken) throw new UserError('הקוד שגוי — נסו שוב');

    const verifier = rand(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({ client_id: IEC.client, response_type: 'id_token code', response_mode: 'form_post',
      scope: 'openid email profile offline_access', redirect_uri: IEC.redirect, state: rand(9), nonce: rand(9),
      code_challenge_method: 'S256', code_challenge: challenge, sessionToken: v.sessionToken });
    const html = await call(`${IEC.okta}/oauth2/default/v1/authorize?${q}`, {}, sig, true) as string;
    const authCode = html.match(/name="code"\s+value="([^"]+)"/)?.[1];
    if (!authCode) throw new Error('authorize: no code');

    const tok = await call(`${IEC.okta}/oauth2/default/v1/token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: IEC.client, code_verifier: verifier, grant_type: 'authorization_code',
        redirect_uri: IEC.redirect, code: deEscape(authCode) }) }, sig);
    if (!tok?.id_token) throw new Error('token: no id_token');
    const auth = { headers: { ...IEC.headers, authorization: `Bearer ${tok.id_token}` } };

    const bp = unwrap(await call(`${IEC.api}customer`, auth, sig), 'customer').bpNumber;
    if (!bp) throw new Error('customer: no bpNumber');
    const cs = unwrap(await call(`${IEC.api}customer/contract/${encodeURIComponent(bp)}`, auth, sig), 'contracts');
    if (!Array.isArray(cs.contracts)) throw new Error('contracts: missing');
    const items = cs.contracts.filter((c: any) => c.status === 1 || +c.totalDebt > 0).map((c: any) => {
      const debt = money(c.totalDebt);
      return {
        name: c.address || [c.streetName, c.houseNumber, c.cityName].filter(Boolean).join(' ') || `חוזה …${String(c.contractId).slice(-4)}`,
        debt, overdue: Math.max(0, money(debt - money(c.debtForInvoicesDueDateNotPassed))), due: date(c.dueDate),
      };
    });
    return { total: money(items.reduce((s: number, i: Item) => s + i.debt, 0)), items };
  },
};

const PROVIDERS: Record<string, Provider> = { iec };
