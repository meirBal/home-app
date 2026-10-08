// ===== API — all server access lives here (auth, households, records, photos, realtime) =====
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PAGE, IMG_MAX } from '../config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const ok = ({ data, error }) => { if (error) throw error; return data; };

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
    .select('role, display_name, households(*)').eq('user_id', uid).limit(1).maybeSingle()),
  create: (name, display) => sb.rpc('create_household', { p_name: name, p_display: display }).then(ok),
  join: (code, display) => sb.rpc('join_household', { p_code: code, p_display: display }).then(ok),
  rotateInvite: (h) => sb.rpc('rotate_invite', { h }).then(ok),
  saveSettings: (h, settings) => sb.from('households').update({ settings }).eq('id', h).then(ok),
  members: (h) => sb.from('members').select('user_id, role, display_name').eq('household_id', h).then(ok),
  setRole: (h, user_id, role) => sb.from('members').update({ role }).match({ household_id: h, user_id }).then(ok),
};

// ---- [Records: one generic table for every module] ----
export const records = {
  list: (h, module, orderCol = 'created_at', asc = false) => sb.from('records')
    .select('id, data, due, amount, done, created_at').match({ household_id: h, module })
    .order(orderCol, { ascending: asc, nullsFirst: false }).limit(PAGE).then(ok),
  upsert: (row) => sb.from('records').upsert(row).select('id').single().then(ok),
  remove: (id) => sb.from('records').delete().eq('id', id).then(ok),
};

// ---- [Feature requests → feed for the improvement loop] ----
export const requests = {
  list: (h) => sb.from('feature_requests').select('id, text, status, created_at')
    .eq('household_id', h).order('created_at', { ascending: false }).limit(100).then(ok),
  add: (h, text) => sb.from('feature_requests').insert({ household_id: h, text }).then(ok),
  setStatus: (id, status) => sb.from('feature_requests').update({ status }).eq('id', id).then(ok),
};

// ---- [Photos: resize on device, private bucket, batched signed URLs] ----
const bucket = () => sb.storage.from('photos');

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();                                   // free decoded pixels immediately
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
}

export const photos = {
  upload: async (h, file) => {
    const path = `${h}/${crypto.randomUUID()}.jpg`;
    ok(await bucket().upload(path, await shrink(file), { contentType: 'image/jpeg' }));
    return path;
  },
  urls: async (paths) => paths.length
    ? Object.fromEntries(ok(await bucket().createSignedUrls(paths, 3600)).map((u) => [u.path, u.signedUrl]))
    : {},
  remove: (paths) => paths.length ? bucket().remove(paths) : null,
};

// ---- [Realtime: one channel per household, debounced callback] ----
let chan;
export function live(h, onChange) {
  chan?.unsubscribe();
  let t;
  chan = sb.channel(`hh-${h}`).on('postgres_changes',
    { event: '*', schema: 'public', table: 'records', filter: `household_id=eq.${h}` },
    (p) => { clearTimeout(t); t = setTimeout(() => onChange(p.new?.module || p.old?.module), 300); })
    .subscribe();
}
