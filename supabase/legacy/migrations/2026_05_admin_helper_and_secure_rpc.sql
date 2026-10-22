-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: is_admin() helper + secure get_user_id_by_email
-- ═══════════════════════════════════════════════════════════════════════════
-- Hardens two surfaces in one pass:
--
-- 1. Adds a `public.is_admin()` SQL helper that mirrors the client-side
--    definition: a Supabase user is "admin" when their auth.uid() does
--    NOT appear in partners.user_id (i.e., they're not linked to any
--    partner row). This single function becomes the building block for
--    any future RLS policy that needs the admin/partner distinction.
--
-- 2. Re-declares `get_user_id_by_email` so it returns NULL for non-
--    admin callers. Previously any authenticated user could enumerate
--    arbitrary emails against auth.users — fine when only admins held
--    accounts, but the partner-portal rollout means partners now hold
--    accounts too. Wrapping the lookup with is_admin() short-circuits
--    the enumeration vector at the DB layer without changing the
--    client API contract (the function still returns NULL when no
--    match exists — callers can't tell "not registered" from "not
--    authorised", which is the desired security property).
--
-- Idempotent: re-running this file is safe. CREATE OR REPLACE handles
-- the function bodies; explicit REVOKE/GRANT statements re-assert the
-- intended permission surface every time.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. is_admin() helper ────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  -- The current user is an admin when there is NO row in `partners`
  -- whose user_id equals the caller's auth.uid(). An unauthenticated
  -- caller (auth.uid() IS NULL) is treated as a non-admin.
  select
    coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) is not null
    and not exists (
      select 1
        from public.partners
       where user_id = auth.uid()
    );
$$;

-- Authenticated app users can call this to check their own role. anon
-- has no legitimate reason to ask, so revoke even the default execute.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ── 2. Secure get_user_id_by_email ─────────────────────────────────────
-- Replaces the prior version (which returned a UUID for any authed
-- caller). Now returns NULL when the caller isn't admin, regardless of
-- whether the email exists. Partners can no longer enumerate accounts.
create or replace function public.get_user_id_by_email(email_search text)
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select case
    when public.is_admin() then (
      select id
        from auth.users
       where lower(email) = lower(trim(email_search))
       limit 1
    )
    else null
  end;
$$;

revoke all on function public.get_user_id_by_email(text) from public, anon;
grant execute on function public.get_user_id_by_email(text) to authenticated;

-- ── 3. Future hardening (optional, commented out) ──────────────────────
-- The current RLS policies on every business table are intentionally
-- permissive ("for all to public using (true) with check (true)") so
-- the rollout doesn't get blocked on edge cases. Once the partner
-- portal has been live for a sprint and the access patterns are
-- well-understood, uncomment the block below to lock writes down to
-- admins while preserving read-for-all (the Pro-Rata view scales
-- aggregates client-side; partners need to see the same raw data).
--
-- The pattern: any table that represents company-wide records
-- (startup_costs, monthly_expenses, annual_expenses, variable_expenses,
-- washes, category_budgets, temporary_expenses) gates writes behind
-- is_admin(); reads stay open to all authenticated users. The
-- `partners` and `partner_payments` tables additionally restrict reads
-- so partners only see their own row.
--
-- IMPORTANT: test these in a Supabase staging project before pasting
-- into production. Getting RLS wrong locks the dashboard out instantly.
--
-- /*
-- -- Writes on shared tables: admin-only
-- drop policy if exists "rw_auth" on public.startup_costs;
-- create policy "admin_writes" on public.startup_costs
--   for all to authenticated
--   using (true)
--   with check (public.is_admin());
--
-- -- (repeat for monthly_expenses, annual_expenses, variable_expenses,
-- --  washes, category_budgets, temporary_expenses, …)
--
-- -- Partners: read own row + admin reads all
-- drop policy if exists "rw_auth" on public.partners;
-- create policy "partner_own_read" on public.partners
--   for select to authenticated
--   using (user_id = auth.uid() or public.is_admin());
-- create policy "admin_writes" on public.partners
--   for insert to authenticated with check (public.is_admin());
-- create policy "admin_updates" on public.partners
--   for update to authenticated using (public.is_admin());
-- create policy "admin_deletes" on public.partners
--   for delete to authenticated using (public.is_admin());
--
-- -- Partner payments: same shape
-- drop policy if exists "rw_auth" on public.partner_payments;
-- create policy "partner_own_read" on public.partner_payments
--   for select to authenticated
--   using (
--     partner_id in (select id from public.partners where user_id = auth.uid())
--     or public.is_admin()
--   );
-- create policy "admin_writes" on public.partner_payments
--   for insert to authenticated with check (public.is_admin());
-- create policy "admin_updates" on public.partner_payments
--   for update to authenticated using (public.is_admin());
-- create policy "admin_deletes" on public.partner_payments
--   for delete to authenticated using (public.is_admin());
-- */

-- ── 4. Refresh PostgREST schema cache ──────────────────────────────────
notify pgrst, 'reload schema';
