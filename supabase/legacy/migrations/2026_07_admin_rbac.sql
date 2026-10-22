-- ═══════════════════════════════════════════════════════════════════════════
-- RBAC hardening: admin allow-list + member-read / admin-write policies
-- ═══════════════════════════════════════════════════════════════════════════
-- BEFORE this migration every business table carried
--   `rw_auth: for all to authenticated using (true) with check (true)`
-- which had two consequences:
--   1. Partner accounts were "read-only" at the UI layer ONLY — any
--      signed-in partner could write every table straight through the API.
--   2. is_admin() classified ANY authenticated user without a partners
--      row as an admin. Combined with open self-signup, a stranger who
--      found the app URL could register and instantly hold full
--      admin-grade read/write over all financial data.
--
-- AFTER:
--   • public.app_admins is the explicit admin allow-list.
--   • is_admin()  = membership in app_admins.
--   • is_member() = admin OR a user linked to a partners row.
--   • Every business table: SELECT for members, ALL for admins only.
--     A stranger account reads zero rows and writes nothing.
--   • invoices storage bucket: public read stays (unguessable keys);
--     insert/update/delete now require admin.
--
-- ⚠️ SEEDING: run the insert below (or your own) BEFORE relying on the
-- app — with an empty app_admins nobody can write anything.
--
-- 100% idempotent — safe to re-run.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file's CONTENT → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Admin allow-list ─────────────────────────────────────────────────
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

-- Seed the primary admin account by email (idempotent; no-op if the
-- account doesn't exist in this environment).
insert into public.app_admins (user_id, note)
select id, 'الحساب الإداري الرئيسي'
  from auth.users
 where lower(email) = lower('haditag77+admin@gmail.com')
on conflict (user_id) do nothing;

-- ── 2. Role helpers ─────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public, auth
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Member = admin or a user linked to a partners row. SECURITY DEFINER so
-- the partners lookup bypasses partners' own RLS (no recursion).
create or replace function public.is_member()
returns boolean
language sql security definer stable
set search_path = public, auth
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
    or exists (select 1 from public.partners p where p.user_id = auth.uid())
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- ── 3. app_admins is admin-managed only ─────────────────────────────────
drop policy if exists "admin_all" on public.app_admins;
create policy "admin_all" on public.app_admins
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 4. Business tables: member read / admin write ───────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'categories','startup_costs','startup_cost_entries','transactions',
    'app_settings','partners','partner_payments',
    'annual_expense_categories','annual_expenses','annual_expense_entries',
    'monthly_expense_categories','monthly_expenses',
    'variable_expense_categories','variable_expenses',
    'washes','category_budgets','temporary_expenses'
  ] loop
    execute format('drop policy if exists "rw_auth" on public.%I', t);
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format('drop policy if exists "member_read" on public.%I', t);
    execute format(
      'create policy "admin_all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format(
      'create policy "member_read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- ── 5. Storage: public read stays, writes become admin-only ─────────────
drop policy if exists "invoices_auth_insert" on storage.objects;
create policy "invoices_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and public.is_admin());

drop policy if exists "invoices_auth_update" on storage.objects;
create policy "invoices_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

drop policy if exists "invoices_auth_delete" on storage.objects;
create policy "invoices_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

-- ── 6. Refresh PostgREST schema cache ───────────────────────────────────
notify pgrst, 'reload schema';
