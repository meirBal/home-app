-- ===== 002 — advisor fixes + smart features (atomic jsonb patch, AI quota log) =====
begin;

-- [advisor] auth.uid() once per query; covering indexes for created_by FKs
drop policy if exists mb_remove on public.members;
create policy mb_remove on public.members for delete to authenticated
  using (is_admin(household_id) or user_id = (select auth.uid()));
create index if not exists records_creator_idx on public.records (created_by);
create index if not exists fr_creator_idx on public.feature_requests (created_by);

-- [patch] merge keys into data server-side, so two phones never overwrite each other's fields.
-- security invoker → RLS (members only) still applies.
create or replace function public.patch_record(p_id uuid, p jsonb, p_amount numeric default null)
returns void language sql security invoker set search_path = public as $$
  update records set data = data || p, amount = coalesce(p_amount, amount) where id = p_id
$$;
revoke all on function public.patch_record from public, anon;
grant execute on function public.patch_record to authenticated;

-- [ai quota] one row per AI call; edge function refuses above a daily cap per household
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  user_id uuid default auth.uid() references auth.users on delete set null,
  at timestamptz not null default now()
);
create index if not exists ai_calls_idx on public.ai_calls (household_id, at desc);
create index if not exists ai_calls_user_idx on public.ai_calls (user_id);
alter table public.ai_calls enable row level security;
drop policy if exists ai_read on public.ai_calls;
create policy ai_read on public.ai_calls for select to authenticated using (is_member(household_id));
drop policy if exists ai_add on public.ai_calls;
create policy ai_add on public.ai_calls for insert to authenticated
  with check (is_member(household_id) and user_id = (select auth.uid()));

commit;
