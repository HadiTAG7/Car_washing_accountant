-- ═══════════════════════════════════════════════════════════════════════════
-- ملفات الفواتير، ومجاميع الدفتر في القاعدة
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حاوية الفواتير: خاصة، مطابقة لـ storage.rules ──
-- قراءة: الموظفون. رفع: من له مستند app_admins فقط (لا users.role وحدها).
-- لا تعديل ولا حذف من المتصفح. الروابط تُفتح برابط موقّع قصير العمر.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy invoices_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (select app.is_staff()));
create policy invoices_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and exists (select 1 from public.app_admins a where a.id = (select auth.uid())::text));

-- ── مجاميع الدفتر — جمعٌ فقط، بلا تقريب ──
-- كل سطر مقيّد بخانتين، فالمجموع الدقيق هنا يساوي ما يجمعه الكود ثم يقرّبه.
-- الصيغ التي فيها تقريب (الرسوم، النسب) تبقى في JavaScript فوق هذه المجاميع،
-- لأن تقريب Postgres يختلف عن تقريب الكود في أنصاف الهللات.
-- «مرحّل» = posted أو reversed: العكس لا يحذف الأصل بل يضيف مرآته.
create or replace view public.posted_ledger_lines with (security_invoker = true) as
  select e.id as entry_id, e.entry_number, e.entry_date, e.period_key, e.source_type, e.status,
         l.line_no, l.account_id, coalesce(l.debit, 0) as debit, coalesce(l.credit, 0) as credit, l.description
  from public.journal_entries e
  join public.journal_entry_lines l on l.entry_id = e.id
  where e.status in ('posted', 'reversed')
  union all
  -- Frozen legacy lines, only for entries that carry no lines of their own.
  select e.id, e.entry_number, e.entry_date, e.period_key, e.source_type, e.status,
         null, j.account_id, coalesce(j.debit, 0), coalesce(j.credit, 0), j.description
  from public.journal_lines_legacy j
  join public.journal_entries e on e.id = j.entry_id
  where e.status in ('posted', 'reversed')
    and not exists (select 1 from public.journal_entry_lines l where l.entry_id = e.id);
grant select on public.posted_ledger_lines to authenticated, ledger_server;

-- Σ debit / Σ credit per account over an optional date window ('YYYY-MM-DD' text, inclusive).
create or replace function public.posted_line_sums(p_from text default null, p_to text default null)
returns table (account_id text, debit numeric, credit numeric)
language sql stable security invoker set search_path = '' as $$
  select account_id, sum(debit), sum(credit)
  from public.posted_ledger_lines
  where (p_from is null or entry_date >= p_from) and (p_to is null or entry_date <= p_to)
  group by account_id
  order by account_id collate "C"
$$;

-- The same, per month.
create or replace function public.ledger_month_sums(p_from_period text default null, p_to_period text default null)
returns table (period_key text, account_id text, debit numeric, credit numeric)
language sql stable security invoker set search_path = '' as $$
  select period_key, account_id, sum(debit), sum(credit)
  from public.posted_ledger_lines
  where (p_from_period is null or period_key >= p_from_period) and (p_to_period is null or period_key <= p_to_period)
  group by period_key, account_id
  order by period_key collate "C", account_id collate "C"
$$;

grant execute on function public.posted_line_sums(text, text) to authenticated, ledger_server;
grant execute on function public.ledger_month_sums(text, text) to authenticated, ledger_server;
revoke execute on function public.posted_line_sums(text, text) from anon, public;
revoke execute on function public.ledger_month_sums(text, text) from anon, public;
