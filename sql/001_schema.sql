-- =====================================================================
-- HomeApp schema v1.0.0  —  run once in Supabase SQL Editor
-- Model: households (family) → members (admin/member) → records (all modules)
-- =====================================================================

-- ===== [1] TABLES =====================================================
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 80),
  invite_code text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  settings    jsonb not null default '{}' check (pg_column_size(settings) < 65536), -- admin config
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('admin','member')),
  display_name text check (length(display_name) <= 40),
  primary key (household_id, user_id)
);
create unique index if not exists members_one_house on public.members (user_id); -- one household per user

-- One generic table for every module (built-in + admin-defined).
-- Frequently filtered/summed fields are real columns; the rest live in data.
create table if not exists public.records (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  module       text not null check (module ~ '^[a-z][a-z0-9_]{1,30}$'),
  data         jsonb not null default '{}' check (pg_column_size(data) < 8192),
  due          date,
  amount       numeric(12,2),
  done         boolean not null default false,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists records_list_idx on public.records (household_id, module, created_at desc);
create index if not exists records_due_idx  on public.records (household_id, module, due);

create table if not exists public.feature_requests (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  text         text not null check (length(text) between 3 and 2000),
  status       text not null default 'new' check (status in ('new','planned','done','rejected')),
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists fr_household_idx on public.feature_requests (household_id, created_at desc);

-- ===== [2] HELPERS ====================================================
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid())
$$;

create or replace function public.is_admin(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records
  for each row execute function public.touch_updated_at();

-- created_by cannot be spoofed.
create or replace function public.stamp_creator() returns trigger
language plpgsql set search_path = public as $$
begin new.created_by := auth.uid(); return new; end $$;

drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert on public.records for each row execute function public.stamp_creator();
drop trigger if exists fr_stamp on public.feature_requests;
create trigger fr_stamp before insert on public.feature_requests for each row execute function public.stamp_creator();

-- Never leave a household without an admin.
create or replace function public.guard_last_admin() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from members where household_id = old.household_id
                     and role = 'admin' and user_id <> old.user_id)
     and exists (select 1 from members where household_id = old.household_id and user_id <> old.user_id) then
    raise exception 'last admin cannot be removed or demoted';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists members_guard on public.members;
create trigger members_guard before update or delete on public.members
  for each row execute function public.guard_last_admin();

-- ===== [3] RPC: create / join household ===============================
create or replace function public.create_household(p_name text, p_display text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into households (name) values (trim(p_name)) returning * into h;
  insert into members values (h.id, auth.uid(), 'admin', left(trim(p_display), 40));
  return h;
end $$;

create or replace function public.join_household(p_code text, p_display text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  select id into hid from households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'invalid code'; end if;
  insert into members (household_id, user_id, display_name)
    values (hid, auth.uid(), left(trim(p_display), 40)) on conflict do nothing;
  return hid;
end $$;

create or replace function public.rotate_invite(h uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_admin(h) then raise exception 'admin only'; end if;
  update households set invite_code = upper(substr(md5(gen_random_uuid()::text), 1, 10))
    where id = h returning invite_code into c;
  return c;
end $$;

revoke all on function public.create_household, public.join_household, public.rotate_invite,
  public.is_member, public.is_admin from public, anon;
grant execute on function public.create_household, public.join_household, public.rotate_invite,
  public.is_member, public.is_admin to authenticated;

-- ===== [4] ROW LEVEL SECURITY =========================================
alter table public.households       enable row level security;
alter table public.members          enable row level security;
alter table public.records          enable row level security;
alter table public.feature_requests enable row level security;

drop policy if exists hh_read on public.households;
create policy hh_read on public.households for select to authenticated using (is_member(id));
drop policy if exists hh_admin on public.households;
create policy hh_admin on public.households for update to authenticated using (is_admin(id)) with check (is_admin(id));

drop policy if exists mb_read on public.members;
create policy mb_read on public.members for select to authenticated using (is_member(household_id));
drop policy if exists mb_admin on public.members;
create policy mb_admin on public.members for update to authenticated using (is_admin(household_id)) with check (is_admin(household_id));
drop policy if exists mb_remove on public.members;
create policy mb_remove on public.members for delete to authenticated using (is_admin(household_id) or user_id = auth.uid());

drop policy if exists rc_all on public.records;
create policy rc_all on public.records for all to authenticated
  using (is_member(household_id)) with check (is_member(household_id));

drop policy if exists fr_read on public.feature_requests;
create policy fr_read on public.feature_requests for select to authenticated using (is_member(household_id));
drop policy if exists fr_add on public.feature_requests;
create policy fr_add on public.feature_requests for insert to authenticated with check (is_member(household_id) and status = 'new');
drop policy if exists fr_admin on public.feature_requests;
create policy fr_admin on public.feature_requests for update to authenticated using (is_admin(household_id));
drop policy if exists fr_del on public.feature_requests;
create policy fr_del on public.feature_requests for delete to authenticated using (is_admin(household_id));

-- ===== [5] PHOTO STORAGE (private, 2MB, path = <household_id>/<file>) ==
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists ph_read on storage.objects;
create policy ph_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists ph_add on storage.objects;
create policy ph_add on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists ph_del on storage.objects;
create policy ph_del on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));

-- ===== [6] REALTIME (live sync between phones) ========================
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;
