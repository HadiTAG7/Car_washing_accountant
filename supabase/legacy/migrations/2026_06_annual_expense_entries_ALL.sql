-- ═══════════════════════════════════════════════════════════════════════════
-- Consolidated migration: annual_expense_entries (sub-ledger for المصاريف السنوية)
-- ═══════════════════════════════════════════════════════════════════════════
-- Mirrors the startup_cost_entries feature for the Annual Expenses page:
-- each annual_expenses row gains a child ledger of individual payments
-- (description, date, amount, notes, invoice URL, VAT flag). The client
-- keeps two parent fields in sync after every entry add/delete:
--
--   actual_amount   = SUM(entries.amount)
--   payment_status  = 'paid' when SUM >= annual_cost, else 'pending'
--
-- `annual_expenses.actual_amount` is NEW — annual expenses previously
-- carried only the planned annual_cost.
--
-- 100% idempotent — re-running this file is safe.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file's CONTENT → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Roll-up target on the parent ------------------------------------------
alter table public.annual_expenses
  add column if not exists actual_amount numeric(12,2) not null default 0;

-- 2. Sub-ledger table -------------------------------------------------------
create table if not exists public.annual_expense_entries (
  id                 uuid          primary key default gen_random_uuid(),
  annual_expense_id  uuid          not null references public.annual_expenses(id) on delete cascade,
  description        text          not null,
  amount             numeric(12,2) not null default 0,
  spent_date         date          not null default current_date,
  notes              text,
  invoice_url        text,
  is_tax_invoice     boolean       not null default false,
  created_at         timestamptz   not null default now()
);

-- 3. Indexes — the hot query is "all entries for one expense ordered by
--    date desc", so cover the FK + date in a composite index. --------------
create index if not exists annual_expense_entries_parent_idx
  on public.annual_expense_entries(annual_expense_id);
create index if not exists annual_expense_entries_parent_date_idx
  on public.annual_expense_entries(annual_expense_id, spent_date desc);

-- 4. Check constraints (drop + add for idempotency) -------------------------
alter table public.annual_expense_entries
  drop constraint if exists annual_expense_entries_amount_chk;
alter table public.annual_expense_entries
  add  constraint annual_expense_entries_amount_chk check (amount >= 0);

-- 5. RLS policy --------------------------------------------------------------
alter table public.annual_expense_entries enable row level security;
drop policy if exists "rw_auth" on public.annual_expense_entries;
create policy "rw_auth" on public.annual_expense_entries
  for all to public using (true) with check (true);

-- 6. Refresh PostgREST schema cache ------------------------------------------
notify pgrst, 'reload schema';
