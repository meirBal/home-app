// In-memory fake of the supabase-js surface the app uses (smoke testing only).
const U = { id: 'u1', email: 't@t' };
const H = { id: 'h1', name: 'הבית שלנו', invite_code: 'ABCDEFGHIJ', settings: {} };
const db = {
  members: [{ household_id: 'h1', user_id: 'u1', role: 'admin', display_name: 'מאיר' }, { household_id: 'h1', user_id: 'u2', role: 'member', display_name: 'שרה' }],
  records: [], feature_requests: [],
};
let n = 0; const id = () => 'r' + (++n);
const today = new Date().toLocaleDateString('sv');
const add = (module, data, extra = {}) => db.records.push({ id: id(), household_id: 'h1', module, data, due: null, amount: null, done: false, created_at: new Date(Date.now() - n * 1000).toISOString(), ...extra });
add('products', { name: 'ביצים', status: 'מלא', cycle: 'כל שבוע', bought: '2026-01-01', unit: 'יח׳' });
add('products', { name: 'עגבנייה', status: 'נמוך' }, { due: today });
add('products', { name: 'פסטה', status: 'מלא' });
add('products', { name: 'חלב 3%', status: 'מלא' }, { due: '2020-01-01' });
add('shopping', { name: 'לחם', when: 'עכשיו' });
add('routine', { title: 'הוצאת זבל', repeat: 'יומי', who: 'u1' }, { due: today });
window.__db = db; window.__calls = [];

const get = (o, path) => path.split('->>').reduce((a, k) => a?.[k], o);
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.ord = []; this.lim = Infinity; this.one = 0; }
  select(c, o) { if (o?.head) this.head = true; return this; }
  match(o) { for (const [k, v] of Object.entries(o)) this.f.push((r) => r[k] === v); return this; }
  eq(k, v) { this.f.push((r) => get(r, k) === v); return this; }
  in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
  lte(k, v) { this.f.push((r) => r[k] != null && r[k] <= v); return this; }
  gte(k, v) { this.f.push((r) => r[k] != null && r[k] >= v); return this; }
  lt(k, v) { this.f.push((r) => r[k] != null && r[k] < v); return this; }
  order(k, o = {}) { this.ord.push([k, o.ascending !== false]); return this; }
  limit(x) { this.lim = x; return this; }
  maybeSingle() { this.one = 1; return this; }
  single() { this.one = 2; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  upsert(r) { return this.insert(r); }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    window.__calls.push(`${this.op} ${this.t}`);
    const T = db[this.t];
    if (this.op === 'insert') {
      const out = this.rows.map((r) => { const x = { id: id(), done: false, due: null, amount: null, created_at: new Date().toISOString(), ...r }; T.push(x); return x; });
      return { data: this.one ? out[0] : out, error: null };
    }
    let rows = T.filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.patch)); return { data: rows, error: null }; }
    if (this.op === 'delete') { db[this.t] = T.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
    for (const [k, asc] of [...this.ord].reverse()) rows = [...rows].sort((a, b) => ((a[k] ?? '￿') > (b[k] ?? '￿') ? 1 : (a[k] ?? '￿') < (b[k] ?? '￿') ? -1 : 0) * (asc ? 1 : -1));
    if (this.head) return { data: null, count: rows.length, error: null };
    rows = rows.slice(0, this.lim);
    if (this.t === 'members' && this.one) rows = rows.map((m) => ({ ...m, households: { ...H, members: db.members } }));
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }
}
export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (fn, a) => {
      window.__calls.push('rpc ' + fn);
      if (fn === 'patch_record') { const r = db.records.find((x) => x.id === a.p_id); Object.assign(r.data, a.p); if (a.p_amount != null) r.amount = a.p_amount; }
      return { data: null, error: null };
    },
    auth: { getSession: async () => ({ data: { session: { user: U } } }), onAuthStateChange() {}, signOut: async () => ({}) },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel() {},
    storage: { from: () => ({ createSignedUrls: async (ps) => ({ data: ps.map((p) => ({ path: p, signedUrl: 'data:,' })), error: null }), upload: async () => ({ data: {}, error: null }), remove: async () => ({}) }) },
    functions: { invoke: async () => ({ data: { store: 'שופרסל', date: today, total: 192.5, items: [
      { name: 'חלב 3% תנובה', qty: 2, unit: 'ליטר', price: 13.8, category: 'מוצרי חלב' },
      { name: 'לחם אחיד', qty: 1, unit: 'יח׳', price: 8.7, category: 'מאפים' },
      { name: 'מרכך כביסה', qty: 1, unit: 'יח׳', price: 20, category: 'ניקיון' },
      { name: 'מיחם חשמלי', qty: 1, unit: 'יח׳', price: 150, category: 'כלי בית', durable: true, warranty_months: 12 }] }, error: null }) },
  };
}
