// ===== EDGE FUNCTION alarm — pg_cron (every minute, sql/003_alarms.sql) → due timers become web-push notifications =====
// Timers are rows in `records` (module 'alarm', data.at ISO time); phones register in module 'push' (data.sub).
// Reuses the VAPID pair and cron secret already in Vault (read through public.pow_secret, service role only).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = 'BGqmEpQHwvDEXD9X5wpcbmuLUFe_0lGojHmijB4ky-ajBYdW87J7qhz-h0cEdiuuFpdQB2sveAbRcvrmLJKZowo';

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: secret } = await db.rpc('pow_secret', { p_name: 'pow_cron_secret' });
  if (!secret || req.headers.get('x-home-cron') !== secret) return new Response('unauthorized', { status: 401 });

  // claim due timers in one update (done=true), so an overlapping run can't send twice
  const { data: due, error } = await db.from('records').update({ done: true })
    .eq('module', 'alarm').eq('done', false).lte('data->>at', new Date().toISOString()).select('id, household_id, created_by, data');
  if (error) return new Response(error.message, { status: 500 });
  await db.from('records').delete().eq('module', 'alarm').lt('created_at', new Date(Date.now() - 2 * 864e5).toISOString());
  if (!due?.length) return Response.json({ sent: 0 });

  const { data: priv } = await db.rpc('pow_secret', { p_name: 'pow_vapid_private' });
  webpush.setVapidDetails('https://meirbal.github.io/home-app/', VAPID_PUBLIC, priv as string);
  let sent = 0;
  for (const a of due) {
    const { data: subs } = await db.from('records').select('id, data').match({ module: 'push', household_id: a.household_id, created_by: a.created_by });
    const msg = JSON.stringify({ title: String(a.data?.title || '⏰ הטיימר הסתיים').slice(0, 120), body: 'לחצו לפתיחת המתכון', tag: a.id, url: './#/shabbat' });
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.data.sub, msg, { TTL: 900, urgency: 'high' }); sent++; }
      catch (e) {   // phone unsubscribed / app removed: forget it
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('records').delete().eq('id', s.id);
        else console.error('push', code, e);
      }
    }
  }
  return Response.json({ sent });
});
