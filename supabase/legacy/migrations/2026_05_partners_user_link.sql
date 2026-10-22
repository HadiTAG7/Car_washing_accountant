-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: partners.user_id — link Supabase users to partner rows
-- ═══════════════════════════════════════════════════════════════════════════
-- Foundation for the Pro-Rata Partner Portal View. When a Supabase user
-- logs in whose id matches partners.user_id, the dashboard switches to
-- that partner's scaled view. Column is nullable; existing partner rows
-- stay unlinked until an admin opens the Edit Partner modal and pastes
-- the user's UUID (or sets it via SQL).
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS /
-- IF EXISTS so a second run is a no-op.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Column ----------------------------------------------------------------
alter table public.partners
  add column if not exists user_id uuid;

-- 2. FK to auth.users (drop + add for idempotency). on delete set null so
--    removing a Supabase user doesn't cascade-delete their partner row.
alter table public.partners
  drop constraint if exists partners_user_id_fkey;
alter table public.partners
  add  constraint partners_user_id_fkey
       foreign key (user_id) references auth.users(id) on delete set null;

-- 3. Lookup index — the partner-view context queries partners by user_id
--    on every render via usePartners (cached client-side anyway, but the
--    index is free insurance).
create index if not exists partners_user_id_idx on public.partners(user_id);

-- 4. Refresh PostgREST schema cache ----------------------------------------
notify pgrst, 'reload schema';
