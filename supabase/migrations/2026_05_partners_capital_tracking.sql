-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: partners.paid_amount
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds the capital-tracking column the UI now reads + writes:
--
--   paid_amount  numeric(12,2) default 0    -- amount the partner has paid
--                                              against (workers_count × 20,000)
--
-- The partner's percentage share is derived on the client from
-- workers_count / total_workers × 100 — there is NO percentage column,
-- by design. If a previous build of this migration added one, you can
-- drop it safely with:
--
--   alter table public.partners drop column if exists percentage;
--
-- Safe to re-run: every statement uses IF NOT EXISTS / IF EXISTS guards.
-- After applying, PostgREST is forced to refresh its schema introspection
-- so the REST API stops returning "Could not find the 'paid_amount'
-- column ... in the schema cache".
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run. Takes < 1 second on an empty table.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Column -----------------------------------------------------------------
alter table public.partners
  add column if not exists paid_amount numeric(12,2) not null default 0;

-- 2. Check constraint -------------------------------------------------------
alter table public.partners
  drop constraint if exists partners_paid_amount_chk;
alter table public.partners
  add  constraint partners_paid_amount_chk
  check (paid_amount >= 0);

-- 3. (Optional) drop the stale percentage column ---------------------------
-- Uncomment if a previous build of this migration added it and you want
-- to clean the schema. Skipping this is harmless — the client never reads
-- or writes percentage.
-- alter table public.partners drop column if exists percentage;

-- 4. RLS policy — confirm UPDATE is permitted -------------------------------
-- The dashboard talks to PostgREST through the anon role (no auth wall),
-- so the partners table needs an explicit policy that allows the full set
-- of operations. This mirrors what the main schema.sql installs and is
-- a no-op if already in place.
alter table public.partners enable row level security;

drop policy if exists "rw_auth" on public.partners;
create policy "rw_auth" on public.partners
  for all to public using (true) with check (true);

-- 5. Refresh PostgREST schema cache ----------------------------------------
-- Without this, the REST API can keep responding with
-- "Could not find the 'paid_amount' column of 'partners' in the schema
-- cache" for up to ~10 minutes after the ALTER TABLE above lands.
notify pgrst, 'reload schema';
