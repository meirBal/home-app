-- ===== 003 — debt checks: atomic quota for provider logins (codes go to real phones from a shared server IP) =====
begin;
alter table public.ai_calls add column if not exists kind text not null default 'receipt'
  check (kind in ('receipt', 'debts_start', 'debts_verify'));
create index if not exists ai_calls_kind_idx on public.ai_calls (household_id, kind, at desc);
create index if not exists ai_calls_kind_at_idx on public.ai_calls (kind, at desc);   -- global cap
drop index if exists public.ai_calls_idx;                                               -- covered by ai_calls_kind_idx

-- Locks per kind, counts (household + all households, last 24h), logs the call. false = over quota.
create or replace function public.take_quota(p_kind text, p_house_cap int, p_global_cap int)
returns boolean language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  select household_id into hid from members where user_id = auth.uid();
  if hid is null or p_kind not in ('debts_start', 'debts_verify') then return false; end if;
  perform pg_advisory_xact_lock(hashtext('quota:' || p_kind));
  if (select count(*) from ai_calls where household_id = hid and kind = p_kind and at > now() - interval '1 day') >= p_house_cap
     or (select count(*) from ai_calls where kind = p_kind and at > now() - interval '1 day') >= p_global_cap then
    return false;
  end if;
  insert into ai_calls (household_id, user_id, kind) values (hid, auth.uid(), p_kind);
  return true;
end $$;
revoke all on function public.take_quota from public, anon;
grant execute on function public.take_quota to authenticated;
commit;
