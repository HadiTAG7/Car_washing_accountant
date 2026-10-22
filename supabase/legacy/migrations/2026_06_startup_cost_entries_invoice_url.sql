-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: add invoice_url to startup_cost_entries
-- ═══════════════════════════════════════════════════════════════════════════
-- Lets each sub-ledger entry carry a link to its source receipt /
-- invoice (Google Drive PDF, scanned image URL, vendor portal page, …).
-- Optional column — existing rows keep working unchanged.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + the notify pgrst at the
-- bottom can be re-run any number of times.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file → Run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.startup_cost_entries
  add column if not exists invoice_url text;

notify pgrst, 'reload schema';
