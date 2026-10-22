-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: startup_cost_entries — sub-ledger for each startup fee item
-- ═══════════════════════════════════════════════════════════════════════════
-- Today every row in `startup_costs` carries a single `actual_amount` that
-- the admin types as one number. This adds a child table so the admin can
-- break that number down into individual expenses: one row per receipt /
-- transaction with its own date, description, amount, and notes.
--
-- The roll-up (parent's actual_amount = SUM of its entries) is kept in
-- sync by the client — every add/delete call also updates the parent —
-- so this migration adds no triggers. That mirrors how the rest of the
-- codebase handles parent/child sums (variable expenses, etc.).
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS /
-- IF EXISTS so a second run is a no-op.
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

-- 2. Indexes — the most common query is "all entries for one item ordered
--    by date desc", so cover the FK + date in a composite index.
create index if not exists startup_cost_entries_parent_idx
  on public.startup_cost_entries(startup_cost_id);
create index if not exists startup_cost_entries_parent_date_idx
  on public.startup_cost_entries(startup_cost_id, spent_date desc);

-- 3. Check constraints (drop + add for idempotency) -----------------------
alter table public.startup_cost_entries
  drop constraint if exists startup_cost_entries_amount_chk;
alter table public.startup_cost_entries
  add  constraint startup_cost_entries_amount_chk check (amount >= 0);

-- 4. RLS policy -----------------------------------------------------------
alter table public.startup_cost_entries enable row level security;
drop policy if exists "rw_auth" on public.startup_cost_entries;
create policy "rw_auth" on public.startup_cost_entries
  for all to public using (true) with check (true);

-- 5. Refresh PostgREST schema cache --------------------------------------
notify pgrst, 'reload schema';
