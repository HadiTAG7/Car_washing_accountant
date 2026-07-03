-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: partner_payments → single source of truth for paid_amount
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEM (found in the 2026-06 review): the live trigger was INCREMENTAL
-- (paid_amount = paid_amount ± delta), while every partner's paid_amount
-- had been entered DIRECTLY (partner_payments was empty). Adding any
-- receipt would double-count on top of the directly-entered figure.
--
-- FIX, non-destructive, in strict order:
--   1. Replace the trigger fn with a FULL RECOMPUTE
--      (paid_amount = SUM of that partner's payments).
--   2. Backfill: for every partner that has a paid_amount but no receipts,
--      create ONE dated "opening balance" receipt equal to that amount, so
--      the directly-entered figure becomes a proper ledger row. Totals are
--      unchanged; they're just now auditable.
--   3. Final recompute pass so paid_amount == SUM(receipts) everywhere.
--
-- After this the receipts ledger is authoritative: adding/deleting a
-- receipt recomputes correctly, and the partner statement shows dated
-- lines instead of one opaque number.
--
-- Idempotent: the backfill only fires for partners with zero receipts, so
-- a second run inserts nothing.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste CONTENT → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Full-recompute trigger function ---------------------------------------
create or replace function public.sync_partner_paid_amount()
returns trigger
language plpgsql
as $$
declare
  target uuid := coalesce(new.partner_id, old.partner_id);
begin
  update public.partners
     set paid_amount = coalesce((
       select sum(amount) from public.partner_payments where partner_id = target
     ), 0)
   where id = target;
  return null;
end;
$$;

-- Point the trigger at the corrected function (drop both possible legacy
-- names, then create one clean trigger).
drop trigger if exists sync_partner_paid_amount   on public.partner_payments;
drop trigger if exists partner_payments_sync       on public.partner_payments;
create trigger sync_partner_paid_amount
  after insert or update or delete on public.partner_payments
  for each row execute function public.sync_partner_paid_amount();

-- 2. Backfill opening-balance receipts for directly-entered amounts --------
insert into public.partner_payments (partner_id, amount, payment_date, payment_method, notes)
select p.id, p.paid_amount, current_date, 'bank_transfer', 'رصيد افتتاحي مُرحّل (تحويل تلقائي إلى سجل الدفعات)'
  from public.partners p
 where p.paid_amount > 0
   and not exists (select 1 from public.partner_payments pp where pp.partner_id = p.id);

-- 3. Final safety recompute for every partner ------------------------------
update public.partners pr
   set paid_amount = coalesce((
     select sum(amount) from public.partner_payments where partner_id = pr.id
   ), 0);

notify pgrst, 'reload schema';
