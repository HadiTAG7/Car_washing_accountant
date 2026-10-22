-- ═══════════════════════════════════════════════════════════════════════════
-- Consolidated migration: startup_cost_entries (table + invoice URL + VAT flag)
-- ═══════════════════════════════════════════════════════════════════════════
-- One-shot setup for the per-item expense sub-ledger feature. Folds in
-- everything from the three previously-shipped migrations so you can run
-- a single paste in Supabase SQL Editor instead of three:
--
--   2026_06_startup_cost_entries.sql            (table + indexes + RLS)
--   2026_06_startup_cost_entries_invoice_url.sql (invoice_url column)
--   2026_06_startup_cost_entries_tax.sql        (is_tax_invoice column)
--
-- 100% idempotent — re-running this file is safe.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Table ----------------------------------------------------------------
create table if not exists public.startup_cost_entries (
  id               uuid          primary key default gen_random_uuid(),
  startup_cost_id  uuid          not null references public.startup_costs(id) on delete cascade,
  description      text          not null,
  amount           numeric(12,2) not null default 0,
  spent_date       date          not null default current_date,
  notes            text,
  created_at       timestamptz   not null default now()
);

-- 2. Optional columns added in later turns (ADD COLUMN IF NOT EXISTS is
--    safe to re-run; existing rows default to null/false). ---------------
alter table public.startup_cost_entries
  add column if not exists invoice_url    text;

alter table public.startup_cost_entries
  add column if not exists is_tax_invoice boolean not null default false;

-- 3. Indexes — the most common query is "all entries for one item ordered
--    by date desc", so cover the FK + date in a composite index. ---------
create index if not exists startup_cost_entries_parent_idx
  on public.startup_cost_entries(startup_cost_id);
create index if not exists startup_cost_entries_parent_date_idx
  on public.startup_cost_entries(startup_cost_id, spent_date desc);

-- 4. Check constraints (drop + add for idempotency) -----------------------
alter table public.startup_cost_entries
  drop constraint if exists startup_cost_entries_amount_chk;
alter table public.startup_cost_entries
  add  constraint startup_cost_entries_amount_chk check (amount >= 0);

-- 5. RLS policy -----------------------------------------------------------
alter table public.startup_cost_entries enable row level security;
drop policy if exists "rw_auth" on public.startup_cost_entries;
create policy "rw_auth" on public.startup_cost_entries
  for all to public using (true) with check (true);

-- 6. Refresh PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';
