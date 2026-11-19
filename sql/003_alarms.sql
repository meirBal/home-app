-- 003 · Alarms: every minute, if a timer is due, call the 'alarm' edge function (it sends the web push).
-- Timers/subscriptions live in records (modules 'alarm' / 'push'); the cron secret is the one already in Vault.
create or replace function public.home_alarm_sweep() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.records where module = 'alarm' and not done and data->>'at' <= to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then
    perform net.http_post(
      url := 'https://enhqzgjqqyubgfysnjib.supabase.co/functions/v1/alarm',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-home-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'pow_cron_secret')),
      body := '{}'::jsonb);
  end if;
end $$;
revoke execute on function public.home_alarm_sweep() from public, anon, authenticated;
select cron.schedule('home-alarms', '* * * * *', 'select public.home_alarm_sweep()');
create index if not exists records_alarm_due on public.records ((data->>'at')) where module = 'alarm' and not done;
-- review hardening
create unique index if not exists records_one_shabbat on public.records (household_id) where module = 'shabbat';   -- one recipe per household
create or replace function public.records_keep_creator() returns trigger language plpgsql set search_path = '' as $$
begin new.created_by := old.created_by; return new; end $$;                     -- nobody re-assigns a row (or an alarm) to someone else
create trigger records_keep_creator before update of created_by on public.records for each row execute function public.records_keep_creator();
create policy push_own on public.records as restrictive for all to authenticated
  using (module <> 'push' or created_by = auth.uid()) with check (module <> 'push' or created_by = auth.uid());   -- push subscriptions: owner only
select cron.schedule('cron-log-purge', '23 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
