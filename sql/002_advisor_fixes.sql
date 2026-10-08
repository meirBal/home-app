-- ===== 002 — Supabase advisor fixes (performance) =====
-- auth.uid() evaluated once per query, not per row
drop policy if exists mb_remove on public.members;
create policy mb_remove on public.members for delete to authenticated
  using (is_admin(household_id) or user_id = (select auth.uid()));

-- cover FKs used by ON DELETE SET NULL when a user is removed
create index if not exists records_creator_idx on public.records (created_by);
create index if not exists fr_creator_idx on public.feature_requests (created_by);
