-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: partner_payments ledger + paid_amount sync trigger
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds the per-partner capital-receipts ledger and a trigger that keeps
-- `partners.paid_amount` equal to SUM(partner_payments.amount) for each
-- partner. The Partners page continues to read `partners.paid_amount`, so
-- it automatically reflects every new ledger entry with zero client
-- refactor.
--
--   partner_payments (
--     id              uuid PK
--     partner_id      uuid FK → partners.id (cascade)
--     amount          numeric(12,2) ≥ 0
--     payment_date    date (default today)
--     payment_method  enum text ('bank_transfer','cash','mada_pos')
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
create table if not exists public.partner_payments (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  amount          numeric(12,2) not null default 0,
  payment_date    date          not null default current_date,
  payment_method  text          not null default 'bank_transfer',
  notes           text,
  created_at      timestamptz   not null default now()
);

-- 2. Indexes ----------------------------------------------------------------
create index if not exists partner_payments_partner_id_idx on public.partner_payments(partner_id);
create index if not exists partner_payments_date_idx       on public.partner_payments(payment_date);

-- 3. Check constraints (drop + add for idempotency) -------------------------
alter table public.partner_payments
  drop constraint if exists partner_payments_amount_chk;
alter table public.partner_payments
  add  constraint partner_payments_amount_chk check (amount >= 0);

alter table public.partner_payments
  drop constraint if exists partner_payments_method_chk;
alter table public.partner_payments
  add  constraint partner_payments_method_chk
  check (payment_method in ('bank_transfer','cash','mada_pos'));

-- 4. RLS policy -------------------------------------------------------------
alter table public.partner_payments enable row level security;
drop policy if exists "rw_auth" on public.partner_payments;
create policy "rw_auth" on public.partner_payments
  for all to public using (true) with check (true);

-- 5. Sync trigger -----------------------------------------------------------
-- After every insert / update / delete on partner_payments, recompute the
-- affected partner's paid_amount = SUM(amount). This is what keeps the
-- legacy Partners page accurate without code changes.
create or replace function public.sync_partner_paid_amount() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    update public.partners
       set paid_amount = (
         select coalesce(sum(amount), 0)
           from public.partner_payments
          where partner_id = old.partner_id
       )
     where id = old.partner_id;
    return old;
  end if;
  update public.partners
     set paid_amount = (
       select coalesce(sum(amount), 0)
         from public.partner_payments
        where partner_id = new.partner_id
     )
   where id = new.partner_id;
  return new;
end;
$$;

drop trigger if exists partner_payments_sync on public.partner_payments;
create trigger partner_payments_sync
after insert or update or delete on public.partner_payments
for each row execute function public.sync_partner_paid_amount();

-- 6. Refresh PostgREST schema cache ----------------------------------------
notify pgrst, 'reload schema';
