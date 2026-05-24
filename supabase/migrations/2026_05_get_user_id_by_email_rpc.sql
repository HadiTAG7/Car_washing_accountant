-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: get_user_id_by_email RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- Powers the email→UUID lookup the Partner modals use when an admin types
-- a partner's email instead of pasting a raw UUID. The function reads
-- auth.users, which client roles can't query directly, so it's marked
-- SECURITY DEFINER and runs with the postgres role's permissions.
--
-- Security model: EXECUTE is granted ONLY to `authenticated` — anon
-- callers can't enumerate emails. For an internal franchise tool that's
-- the right trade-off; tightening further (e.g. an explicit admin role)
-- can come later if abuse appears.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_user_id_by_email(email_search text)
returns uuid
language sql
security definer
stable
-- Pinned search_path so a hostile schema can't shadow auth.users.
set search_path = public, auth
as $$
  select id
    from auth.users
   where lower(email) = lower(trim(email_search))
   limit 1;
$$;

-- Tight permissions: revoke the default PUBLIC EXECUTE, grant only to
-- authenticated. Re-runs of the migration stay idempotent because both
-- statements are unconditional and the function's CREATE OR REPLACE
-- preserves the grants on the new revision.
revoke all on function public.get_user_id_by_email(text) from public, anon;
grant execute on function public.get_user_id_by_email(text) to authenticated;

notify pgrst, 'reload schema';
