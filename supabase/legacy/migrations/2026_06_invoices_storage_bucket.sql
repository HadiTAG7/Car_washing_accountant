-- ═══════════════════════════════════════════════════════════════════════════
-- Storage: public 'invoices' bucket + access policies
-- ═══════════════════════════════════════════════════════════════════════════
-- Repo-parity record of what was applied to the live project when the
-- invoice/receipt file-upload feature shipped (uploadInvoiceFile in
-- src/lib/supabaseClient.js stores files here and saves the public URL
-- into startup_cost_entries.invoice_url / annual_expense_entries.invoice_url).
--
-- Design:
--   • Bucket is PUBLIC-read — invoice URLs are pasted into ledgers and
--     CSV exports and must open without a signed session. Object keys
--     carry a timestamp + random UUID slice, so they are unguessable.
--   • Writes (insert/update/delete) require an authenticated session,
--     mirroring the table-level rw_auth policies.
--   • 10MB cap + image/PDF mime allow-list enforced server-side; the
--     client pre-checks the same limits for a friendlier error.
--
-- 100% idempotent — safe to re-run.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this entire
--   file's CONTENT → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bucket ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  true,
  10485760, -- 10MB
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Object policies ───────────────────────────────────────────────────
drop policy if exists "invoices_public_read" on storage.objects;
create policy "invoices_public_read" on storage.objects
  for select to public
  using (bucket_id = 'invoices');

drop policy if exists "invoices_auth_insert" on storage.objects;
create policy "invoices_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices');

drop policy if exists "invoices_auth_update" on storage.objects;
create policy "invoices_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoices');

drop policy if exists "invoices_auth_delete" on storage.objects;
create policy "invoices_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices');
