-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: add is_tax_invoice flag to startup_cost_entries
-- ═══════════════════════════════════════════════════════════════════════════
-- Marks a sub-ledger entry as a VAT (ضريبة القيمة المضافة) invoice. When
-- true, the `amount` already entered is VAT-INCLUSIVE — the recoverable
-- VAT portion is derived on the client as amount × 0.15 / 1.15 (KSA 15%).
-- We store only the boolean, not the computed tax, so the figure can't
-- drift from the amount and a future rate change recomputes cleanly.
--
-- Optional column, defaults false — existing entries are treated as
-- non-taxable and contribute 0 to the recoverable-VAT total.
--
-- Idempotent. HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.startup_cost_entries
  add column if not exists is_tax_invoice boolean not null default false;

notify pgrst, 'reload schema';
