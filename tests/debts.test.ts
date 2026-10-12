// Offline test of supabase/functions/debts against a simulated IEC/Okta + Supabase.
// usage: deno run -A --node-modules-dir=none tests/debts.test.ts ../supabase/functions/debts/index.ts
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; };
Deno.env.set('SUPABASE_URL', 'http://sb.local'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
const saved: any[] = []; let quota = 0, quotaErr = false, netFail = false, contractsBody: any;
const J = (o: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });
globalThis.fetch = async (u: any, init: any = {}) => {
  const url = new URL(typeof u === 'string' ? u : u.url), m = (init.method || u.method || 'GET');
  const body = init.body ?? (u instanceof Request ? await u.clone().text() : undefined);
  if (url.host === 'sb.local') {
    if (url.pathname === '/auth/v1/user') return J({ id: 'u1' });
    if (url.pathname.endsWith('/members')) return J({ household_id: 'h1' });
    if (url.pathname.endsWith('/rpc/take_quota')) return quotaErr ? J({ code: '42883', message: 'no function' }, 404) : J(quota++ < 50);
    if (url.pathname.endsWith('/records')) { saved.push(JSON.parse(body)); return J([], 201); }
  }
  if (url.pathname === '/api/v1/authn') return J({ stateToken: '00abcdefghijklmnop', _embedded: { factors: [{ id: 'push1', factorType: 'push' }, { id: 'emf1234', factorType: 'email', profile: { email: 'x@sns.iec.co.il' } }] } });
  if (url.pathname.endsWith('/verify')) { const b = JSON.parse(body); if (!b.passCode) return J({ status: 'MFA_CHALLENGE' }); return b.passCode === '111111' ? J({ status: 'SUCCESS', sessionToken: 'sess' }) : J({ errorCode: b.passCode === '333333' ? 'E0000011' : 'E0000068' }, 403); }
  if (url.pathname.endsWith('/authorize')) { if (netFail) throw new TypeError('error sending request for url (' + url + ')'); if (url.searchParams.get('sessionToken') !== 'sess') throw new Error('bad'); return new Response('<input type="hidden" name="code" value="ab\\x2Dcd"/>'); }
  if (url.pathname.endsWith('/token')) { if (new URLSearchParams(body).get('code') !== 'ab-cd') return J({}, 400); return J({ id_token: 'idt' }); }
  if (url.pathname === '/api/customer') return J({ bpNumber: '42' });
  if (url.pathname === '/api/customer/contract/42') return J(contractsBody);
  throw new Error('net fail ' + url);
};
await import(Deno.args[0]);
const call = async (b: any) => { const r = await handler(new Request('http://x/', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(b) })); return [r.status, await r.json()]; };
const assert = (c: unknown, msg: string) => { if (!c) { console.error('FAIL', msg); Deno.exit(1); } console.log('ok', msg); };

let [s, r] = await call({ op: 'start', provider: 'iec', id: '123456789' });
assert(s === 400 && /זהות/.test(r.error), 'bad check digit rejected on server');
[s, r] = await call({ op: 'start', provider: 'toString', id: '123456782' });
assert(s === 400, 'prototype key provider rejected');
[s, r] = await call({ op: 'start', provider: 'iec', id: '123456782' });
assert(s === 200 && r.via === 'sms' && r.flow.fid === 'emf1234', 'start skips push factor, picks sms-email');
const flow = r.flow;
[s, r] = await call({ op: 'verify', provider: 'iec', flow, code: '222222' });
assert(s === 400 && r.error === 'הקוד שגוי — נסו שוב', 'wrong code → retry message');
[s, r] = await call({ op: 'verify', provider: 'iec', flow, code: '333333' });
assert(s === 400 && /התחילו שוב/.test(r.error), 'expired code → start over');
contractsBody = { data: { contracts: [
  { contractId: '9991234', address: 'הרצל 1 אשקלון', totalDebt: 300.456, debtForInvoicesDueDateNotPassed: 100, dueDate: '2026-10-20T00:00:00', status: 1 },
  { contractId: '9995678', totalDebt: 0, debtForInvoicesDueDateNotPassed: 0, dueDate: '1900-01-01T00:00:00', status: 0 }] }, reponseDescriptor: { isSuccess: true } };
[s, r] = await call({ op: 'verify', provider: 'iec', flow, code: '111111' });
assert(s === 200 && r.amount === 300.46 && r.data.overdue === 200.46 && r.due === '2026-10-20' && r.data.items.length === 1, 'debt parsed: total, overdue, due, inactive contract dropped');
contractsBody = { data: null, reponseDescriptor: { isSuccess: false } };
[s, r] = await call({ op: 'verify', provider: 'iec', flow, code: '111111' });
assert(s === 502 && saved.length === 1, 'failed IEC answer is an error, never saved as "no debt"');
const logs: string[] = []; const ce = console.error; console.error = (...a: unknown[]) => logs.push(a.join(' '));
netFail = true;
[s, r] = await call({ op: 'verify', provider: 'iec', flow, code: '111111' });
netFail = false; console.error = ce;
assert(s === 502 && !logs.join().includes('sess'), 'network error never logs the session token');
quotaErr = true;
[s, r] = await call({ op: 'start', provider: 'iec', id: '123456782' });
assert(s === 502, 'quota unknown → fail closed');
quotaErr = false; quota = 99;
[s, r] = await call({ op: 'start', provider: 'iec', id: '123456782' });
assert(s === 400 && /מחר/.test(r.error), 'daily quota enforced');
console.log('ALL PASSED');
