-- ═══════════════════════════════════════════════════════════════════════════
-- Security hardening: RLS → authenticated-only + is_admin() logic fix
-- ═══════════════════════════════════════════════════════════════════════════
-- BEFORE this migration every table's policy was
--   `for all to public using (true) with check (true)`
-- which let ANYONE holding the public anon key (it ships inside the
-- deployed JS bundle) read AND write every business table with no login.
--
-- AFTER: the same permissive policy but scoped `to authenticated` — a
-- valid signed-in session is required for any API access. UI-level
-- gating (Pro-Rata read-only mode) continues to handle admin-vs-partner
-- differences; DB-level per-role policies remain a future step (see the
-- commented block in 2026_05_admin_helper_and_secure_rpc.sql).
--
-- ⚠️ DEPLOYMENT ORDER: the frontend must require login BEFORE this runs,
-- otherwise anonymous visitors see a dashboard whose every query fails.
-- The app now defaults VITE_REQUIRE_AUTH to true (only an explicit
-- "false" disables it) — deploy that build first, then run this file.
--
-- Also fixes is_admin(): the previous body's guard
--   coalesce(auth.uid(), '00000000-…'::uuid) is not null
-- is ALWAYS true (coalesce substitutes a non-null sentinel), so an
-- anonymous caller — auth.uid() IS NULL, matching no partner row —
-- evaluated as ADMIN, the exact opposite of the stated intent. Execute
-- grants (anon revoked) were the only thing containing it. The guard is
-- now a bare `auth.uid() is not null`.
--
-- 100% idempotent — safe to re-run.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file's CONTENT → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Re-scope every table policy to authenticated ────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories',
    'startup_costs',
    'startup_cost_entries',
    'assets',
    'vehicles',
    'maintenance_logs',
    'transactions',
    'app_settings',
    'partners',
    'partner_payments',
    'annual_expense_categories',
    'annual_expenses',
    'annual_expense_entries',
    'monthly_expense_categories',
    'monthly_expenses',
    'variable_expense_categories',
    'variable_expenses',
    'washes',
    'category_budgets',
    'temporary_expenses'
  ] loop
    execute format('drop policy if exists "rw_auth" on public.%I', t);
    execute format(
      'create policy "rw_auth" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ── 2. Fix is_admin() — anon must be non-admin ─────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  -- Admin = a real signed-in user whose id is NOT linked to any partner
  -- row. Anonymous callers (auth.uid() IS NULL) are never admin.
  select
    auth.uid() is not null
    and not exists (
      select 1
        from public.partners
       where user_id = auth.uid()
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- get_user_id_by_email already delegates to is_admin(), so re-declaring
-- it is unnecessary — the fixed is_admin() takes effect immediately.

-- ── 3. Refresh PostgREST schema cache ──────────────────────────────────
notify pgrst, 'reload schema';
