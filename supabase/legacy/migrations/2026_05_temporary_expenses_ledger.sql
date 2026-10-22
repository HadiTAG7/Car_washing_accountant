-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: temporary_expenses ledger (المصروفات المؤقتة والمستردة)
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds the reimbursable-expenses ledger — temporary outlays the business
-- pays now and recovers later (refunds, deposits, advances, etc).
--
--   temporary_expenses (
--     id              uuid PK
--     title           text  — اسم البند
--     amount          numeric(12,2) ≥ 0
--     spent_date      date  — تاريخ الصرف (default today)
--     status          text  — 'pending' | 'recovered'
--     recovered_date  date  — تاريخ الاسترداد (NULL while pending)
--     notes           text
--     created_at      timestamptz
--   )
--
-- Safe to re-run: every statement uses IF NOT EXISTS / IF EXISTS guards.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run. Takes < 1 second on an empty table.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Table ------------------------------------------------------------------
create table if not exists public.temporary_expenses (
  id              uuid primary key default gen_random_uuid(),
  title           text          not null,
  amount          numeric(12,2) not null default 0,
  spent_date      date          not null default current_date,
  status          text          not null default 'pending',
  recovered_date  date,
  notes           text,
  created_at      timestamptz   not null default now()
);

-- 2. Indexes ----------------------------------------------------------------
create index if not exists temporary_expenses_status_idx     on public.temporary_expenses(status);
create index if not exists temporary_expenses_spent_date_idx on public.temporary_expenses(spent_date);

-- 3. Check constraints (drop + add for idempotency) -------------------------
alter table public.temporary_expenses
  drop constraint if exists temporary_expenses_amount_chk;
alter table public.temporary_expenses
  add  constraint temporary_expenses_amount_chk check (amount >= 0);

alter table public.temporary_expenses
  drop constraint if exists temporary_expenses_status_chk;
alter table public.temporary_expenses
  add  constraint temporary_expenses_status_chk
  check (status in ('pending','recovered'));

-- A recovered row must carry a recovered_date; a pending row must not.
alter table public.temporary_expenses
  drop constraint if exists temporary_expenses_recovery_consistency_chk;
alter table public.temporary_expenses
  add  constraint temporary_expenses_recovery_consistency_chk
  check (
    (status = 'recovered' and recovered_date is not null)
    or
    (status = 'pending'   and recovered_date is null)
  );

-- 4. RLS policy -------------------------------------------------------------
alter table public.temporary_expenses enable row level security;
drop policy if exists "rw_auth" on public.temporary_expenses;
create policy "rw_auth" on public.temporary_expenses
  for all to public using (true) with check (true);

-- 5. Refresh PostgREST schema cache ----------------------------------------
notify pgrst, 'reload schema';
