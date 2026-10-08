// ===== API — all server access lives here (auth, households, records, photos, realtime) =====
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PAGE, IMG_MAX } from '../config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const ok = ({ data, error }) => { if (error) throw error; return data; };
let lastWrite = 0;                                   // used to ignore realtime echo of our own writes
const wrote = (p) => { lastWrite = Date.now(); return p; };

// ---- [Auth] ----
export const auth = {
  user: async () => (await sb.auth.getSession()).data.session?.user ?? null,
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
  signUp: (email, password) => sb.auth.signUp({ email, password }).then(ok),
  signOut: () => sb.auth.signOut(),
};

// ---- [Household & members] ----
export const house = {
  mine: async (uid) => ok(await sb.from('members')
    .select('role, display_name, households(*)').eq('user_id', uid).maybeSingle()),
  create: (name, display) => sb.rpc('create_household', { p_name: name, p_display: display }).then(ok),
  join: (code, display) => sb.rpc('join_household', { p_code: code, p_display: display }).then(ok),
  rotateInvite: (h) => sb.rpc('rotate_invite', { h }).then(ok),
  saveSettings: (h, settings) => sb.from('households').update({ settings }).eq('id', h).then(ok),
  members: (h) => sb.from('members').select('user_id, role, display_name').eq('household_id', h).then(ok),
  setRole: (h, user_id, role) => sb.from('members').update({ role }).match({ household_id: h, user_id }).then(ok),
};

// ---- [Records: one generic table for every module] ----
// opts: {order, asc, hasDone, from(date)} — sorting/filtering on the server so PAGE never hides relevant rows
export const records = {
  list: (h, module, { order = 'created_at', asc = false, hasDone, from } = {}) => {
    let q = sb.from('records').select('id, data, due, amount, done, created_at').match({ household_id: h, module });
    if (from) q = q.gte('due', from);
    if (hasDone) q = q.order('done');
    return q.order(order, { ascending: asc, nullsFirst: false }).limit(PAGE).then(ok);
  },
  sum: async (h, module, from, to) => ok(await sb.from('records').select('amount')
    .match({ household_id: h, module }).gte('due', from).lt('due', to))
    .reduce((s, r) => s + (+r.amount || 0), 0),
  insert: (row) => wrote(sb.from('records').insert(row).then(ok)),
  update: (id, patch) => wrote(sb.from('records').update(patch).eq('id', id).select('id').then(ok))
    .then((r) => { if (!r.length) throw new Error('הפריט נמחק במכשיר אחר'); }),
  remove: (id) => wrote(sb.from('records').delete().eq('id', id).then(ok)),
};

// ---- [Feature requests → feed for the improvement loop] ----
export const requests = {
  list: (h) => sb.from('feature_requests').select('id, text, status, created_at')
    .eq('household_id', h).order('created_at', { ascending: false }).limit(100).then(ok),
  add: (h, text) => sb.from('feature_requests').insert({ household_id: h, text }).then(ok),
  setStatus: (id, status) => sb.from('feature_requests').update({ status }).eq('id', id).then(ok),
};

// ---- [Photos: full + 256px thumb, resized on device, private bucket, cached signed URLs] ----
const bucket = () => sb.storage.from('photos');
export const thumbOf = (p) => p.replace(/\.jpg$/, '_t.jpg');

async function shrink(bmp, max, quality) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hgt = Math.round(bmp.height * k);
  const c = self.OffscreenCanvas ? new OffscreenCanvas(w, hgt)
    : Object.assign(document.createElement('canvas'), { width: w, height: hgt });
  c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  return c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality })
    : new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
}

const urlCache = new Map();                          // path → {url, exp} — stable URLs = browser cache hits
const TTL = 3600;

export const photos = {
  upload: async (h, file) => {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error('לא ניתן לקרוא את התמונה'); }
    const path = `${h}/${crypto.randomUUID()}.jpg`;
    try {
      const [full, thumb] = await Promise.all([shrink(bmp, IMG_MAX, 0.72), shrink(bmp, 256, 0.6)]);
      ok(await bucket().upload(path, full, { contentType: 'image/jpeg' }));
      ok(await bucket().upload(thumbOf(path), thumb, { contentType: 'image/jpeg' }));
    } finally { bmp.close(); }                         // free decoded pixels immediately
    return path;
  },
  urls: async (paths) => {
    const now = Date.now() / 1000, miss = [...new Set(paths)].filter((p) => !(urlCache.get(p)?.exp > now));
    if (miss.length) for (const u of ok(await bucket().createSignedUrls(miss, TTL)))
      if (u.signedUrl) urlCache.set(u.path, { url: u.signedUrl, exp: now + TTL - 300 });
    return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url]));
  },
  remove: async (paths) => { if (paths.length) await bucket().remove(paths.flatMap((p) => [p, thumbOf(p)])); },
};

// ---- [Realtime: one channel per household; skips our own echo; deletes only if row is on screen] ----
let chan;
export function unlive() { if (chan) sb.removeChannel(chan); chan = null; }
export function live(h, onChange) {
  unlive();
  let t;
  chan = sb.channel(`hh-${h}`).on('postgres_changes',
    { event: '*', schema: 'public', table: 'records', filter: `household_id=eq.${h}` },
    (p) => {
      if (Date.now() - lastWrite < 1500) return;
      clearTimeout(t); t = setTimeout(() => onChange(p.new?.module, p.old?.id), 300);
    }).subscribe();
}
