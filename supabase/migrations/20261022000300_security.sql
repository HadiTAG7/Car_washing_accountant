-- ═══════════════════════════════════════════════════════════════════════════
-- الصلاحيات — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-security-sql.mjs
-- يطابق firestore.rules حرفياً. RLS مفعّل على كل جدول والأصل المنع.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── من المتصل؟ (role() في القواعد) ──
-- users/{uid} موجود وفيه مفتاح role → قيمته؛ وإلا app_admins/{uid} وحده → admin؛ وإلا unknown.
create or replace function app.caller() returns table (role text, user_doc boolean, admin_doc boolean)
language sql stable security definer set search_path = '' as $$
  select
    case
      when m.id is not null and (m.role is not null or coalesce(m.shape -> 'n', '[]'::jsonb) ? 'role' or coalesce(m.shape -> 'r', '{}'::jsonb) ? 'role')
        then coalesce(m.role, 'unknown')
      when m.id is null and a.id is not null then 'admin'
      else 'unknown'
    end,
    m.id is not null,
    a.id is not null
  from (select auth.uid()::text as uid) me
  left join public.members m on m.id = me.uid
  left join public.app_admins a on a.id = me.uid
  where me.uid is not null
$$;
create or replace function app.app_role() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from app.caller()), 'unknown') $$;
create or replace function app.known_role() returns boolean language sql stable security definer set search_path = '' as $$
  select app.app_role() in ('admin', 'accountant', 'operator', 'partner', 'supervisor') $$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.admin_doc or c.role = 'admin') from app.caller() c), false) $$;
create or replace function app.is_accountant() returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_admin() or app.app_role() = 'accountant' $$;
create or replace function app.is_operator() returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_accountant() or app.app_role() = 'operator' $$;
create or replace function app.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.user_doc or c.admin_doc) from app.caller() c), false) $$;
create or replace function app.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') and (c.user_doc or c.admin_doc)
    and (c.role <> 'partner' or c.admin_doc) from app.caller() c), false) $$;
create or replace function app.is_signed_in_known_non_supervisor() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.role in ('admin', 'accountant', 'operator', 'partner') from app.caller() c), false) $$;

-- ── الأقفال: سجل مرحّل لا يُعدّل (notLocked / notPostedExpense) ──
create or replace function app.not_locked(p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.posting_locks where id = p_kind || '__' || p_id) $$;
create or replace function app.not_posted_expense(p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.not_locked(p_kind, p_id) and app.not_locked('expense', p_id) $$;

-- ── diff().affectedKeys(): مفاتيح تغيّرت أو ظهرت أو اختفت ──
create or replace function app.changed_keys(o jsonb, n jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(k order by k), '{}') from (
    select key as k from jsonb_each(o) union select key from jsonb_each(n)
  ) keys where (o -> k) is distinct from (n -> k) $$;

create or replace function app."doc_journal_entries"(r public."journal_entries") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('entryDate', to_jsonb(r."entry_date"), 'periodKey', to_jsonb(r."period_key"), 'sourceType', to_jsonb(r."source_type"), 'sourceKind', to_jsonb(r."source_kind"), 'sourceId', to_jsonb(r."source_id"), 'description', to_jsonb(r."description"), 'status', to_jsonb(r."status"), 'entryNumber', to_jsonb(r."entry_number"), 'lineCount', to_jsonb(r."line_count"), 'totalDebit', to_jsonb(r."total_debit"), 'totalCredit', to_jsonb(r."total_credit"), 'createdBy', to_jsonb(r."created_by"), 'createdAt', to_jsonb(r."created_at"), 'postedAt', to_jsonb(r."posted_at"), 'taxSnapshot', to_jsonb(r."tax_snapshot"), 'purchaseTaxSnapshot', to_jsonb(r."purchase_tax_snapshot"), 'settlementEntryId', to_jsonb(r."settlement_entry_id"), 'settlementOf', to_jsonb(r."settlement_of"), 'reversalOf', to_jsonb(r."reversal_of"), 'reversesEntryId', to_jsonb(r."reverses_entry_id"), 'reversedSourceKind', to_jsonb(r."reversed_source_kind"), 'reversedSourceType', to_jsonb(r."reversed_source_type"), 'reversedSourceId', to_jsonb(r."reversed_source_id"), 'reversedBy', to_jsonb(r."reversed_by"), 'reversedAt', to_jsonb(r."reversed_at"), 'reversalReason', to_jsonb(r."reversal_reason"), 'payrollSnapshot', to_jsonb(r."payroll_snapshot"), 'documentId', to_jsonb(r."document_id"), 'documentNumber', to_jsonb(r."document_number"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_journal_lines_legacy"(r public."journal_lines_legacy") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('entryId', to_jsonb(r."entry_id"), 'accountId', to_jsonb(r."account_id"), 'debit', to_jsonb(r."debit"), 'credit', to_jsonb(r."credit"), 'description', to_jsonb(r."description"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_posting_locks"(r public."posting_locks") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('kind', to_jsonb(r."kind"), 'sourceType', to_jsonb(r."source_type"), 'sourceId', to_jsonb(r."source_id"), 'entryId', to_jsonb(r."entry_id"), 'entryNumber', to_jsonb(r."entry_number"), 'settlementEntryId', to_jsonb(r."settlement_entry_id"), 'lockedBy', to_jsonb(r."locked_by"), 'lockedAt', to_jsonb(r."locked_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_accounting_periods"(r public."accounting_periods") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'status', to_jsonb(r."status"), 'closedAt', to_jsonb(r."closed_at"), 'closedBy', to_jsonb(r."closed_by"), 'createdAt', to_jsonb(r."created_at"), 'reopenReason', to_jsonb(r."reopen_reason"), 'reopenedAt', to_jsonb(r."reopened_at"), 'reopenedBy', to_jsonb(r."reopened_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_counters"(r public."counters") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('nextNumber', to_jsonb(r."next_number"), 'earliestEntryDate', to_jsonb(r."earliest_entry_date"), 'type', to_jsonb(r."type"), 'year', to_jsonb(r."year"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_chart_of_accounts"(r public."chart_of_accounts") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('code', to_jsonb(r."code"), 'nameArabic', to_jsonb(r."name_arabic"), 'name', to_jsonb(r."name"), 'accountType', to_jsonb(r."account_type"), 'normalBalance', to_jsonb(r."normal_balance"), 'parentId', to_jsonb(r."parent_id"), 'contra', to_jsonb(r."contra"), 'active', to_jsonb(r."active"), 'directCost', to_jsonb(r."direct_cost"), 'createdAt', to_jsonb(r."created_at"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_audit_logs"(r public."audit_logs") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('action', to_jsonb(r."action"), 'collectionName', to_jsonb(r."collection_name"), 'documentId', to_jsonb(r."document_id"), 'userId', to_jsonb(r."user_id"), 'note', to_jsonb(r."note"), 'before', to_jsonb(r."before"), 'after', to_jsonb(r."after"), 'at', to_jsonb(r."at"), 'atIso', to_jsonb(r."at_iso"), 'kind', to_jsonb(r."kind"), 'sourceId', to_jsonb(r."source_id"), 'reason', to_jsonb(r."reason"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sales_documents"(r public."sales_documents") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('type', to_jsonb(r."type"), 'status', to_jsonb(r."status"), 'issueMode', to_jsonb(r."issue_mode"), 'documentNumber', to_jsonb(r."document_number"), 'sequence', to_jsonb(r."sequence"), 'year', to_jsonb(r."year"), 'issueDate', to_jsonb(r."issue_date"), 'issueTime', to_jsonb(r."issue_time"), 'supplyDate', to_jsonb(r."supply_date"), 'net', to_jsonb(r."net"), 'vat', to_jsonb(r."vat"), 'gross', to_jsonb(r."gross"), 'vatRate', to_jsonb(r."vat_rate"), 'washId', to_jsonb(r."wash_id"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'linkedJournalEntryId', to_jsonb(r."linked_journal_entry_id"), 'referenceDocumentId', to_jsonb(r."reference_document_id"), 'referenceNumber', to_jsonb(r."reference_number"), 'sourceType', to_jsonb(r."source_type"), 'sourceId', to_jsonb(r."source_id"), 'createdAt', to_jsonb(r."created_at"), 'issuedAt', to_jsonb(r."issued_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sales_document_sources"(r public."sales_document_sources") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('sourceType', to_jsonb(r."source_type"), 'sourceId', to_jsonb(r."source_id"), 'documentId', to_jsonb(r."document_id"), 'documentNumber', to_jsonb(r."document_number"), 'status', to_jsonb(r."status"), 'at', to_jsonb(r."at"), 'releasedAt', to_jsonb(r."released_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_app_settings"(r public."app_settings") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('value', to_jsonb(r."value"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_members"(r public."members") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('email', to_jsonb(r."email"), 'role', to_jsonb(r."role"), 'displayName', to_jsonb(r."display_name"), 'created_at', to_jsonb(r."created_at"), 'bootstrappedAt', to_jsonb(r."bootstrapped_at"), 'bootstrappedBy', to_jsonb(r."bootstrapped_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_app_admins"(r public."app_admins") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('email', to_jsonb(r."email"), 'bootstrappedAt', to_jsonb(r."bootstrapped_at"), 'note', to_jsonb(r."note"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_washes"(r public."washes") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('biker_name', to_jsonb(r."biker_name"), 'biker_id', to_jsonb(r."biker_id"), 'quantity', to_jsonb(r."quantity"), 'price', to_jsonb(r."price"), 'status', to_jsonb(r."status"), 'wash_date', to_jsonb(r."wash_date"), 'payment_method', to_jsonb(r."payment_method"), 'revenue_origin', to_jsonb(r."revenue_origin"), 'ssp_booking_id', to_jsonb(r."ssp_booking_id"), 'created_at', to_jsonb(r."created_at"), 'driver_external_id', to_jsonb(r."driver_external_id"), 'price_basis', to_jsonb(r."price_basis"), 'price_mode', to_jsonb(r."price_mode"), 'net_amount', to_jsonb(r."net_amount"), 'vat_amount', to_jsonb(r."vat_amount"), 'gross_amount', to_jsonb(r."gross_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'owner_tax_snapshot', to_jsonb(r."owner_tax_snapshot"), 'collection_status', to_jsonb(r."collection_status"), 'worker_commission_per_wash', to_jsonb(r."worker_commission_per_wash"), 'worker_commission_payment_timing', to_jsonb(r."worker_commission_payment_timing"), 'worker_commission_paid', to_jsonb(r."worker_commission_paid"), 'import_run_id', to_jsonb(r."import_run_id"), 'created_by', to_jsonb(r."created_by"), 'ssp_booking_number', to_jsonb(r."ssp_booking_number"), 'ssp_raw_status', to_jsonb(r."ssp_raw_status"), 'notes', to_jsonb(r."notes"), 'updated_at', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_bikers"(r public."bikers") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('name', to_jsonb(r."name"), 'name_ar', to_jsonb(r."name_ar"), 'name_en', to_jsonb(r."name_en"), 'driver_external_id', to_jsonb(r."driver_external_id"), 'contact_number', to_jsonb(r."contact_number"), 'residence', to_jsonb(r."residence"), 'sponsor', to_jsonb(r."sponsor"), 'nationality', to_jsonb(r."nationality"), 'current_status', to_jsonb(r."current_status"), 'salary', to_jsonb(r."salary"), 'start_date', to_jsonb(r."start_date"), 'end_date', to_jsonb(r."end_date"), 'iqama_number', to_jsonb(r."iqama_number"), 'iqama_expiry', to_jsonb(r."iqama_expiry"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_housing_units"(r public."housing_units") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('name', to_jsonb(r."name"), 'capacity', to_jsonb(r."capacity"), 'notes', to_jsonb(r."notes"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_temporary_expenses"(r public."temporary_expenses") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('title', to_jsonb(r."title"), 'amount', to_jsonb(r."amount"), 'spent_date', to_jsonb(r."spent_date"), 'assignment_month', to_jsonb(r."assignment_month"), 'status', to_jsonb(r."status"), 'recovered_date', to_jsonb(r."recovered_date"), 'notes', to_jsonb(r."notes"), 'biker_id', to_jsonb(r."biker_id"), 'payment_method', to_jsonb(r."payment_method"), 'recovery_method', to_jsonb(r."recovery_method"), 'recovered_amount', to_jsonb(r."recovered_amount"), 'payroll_lock_id', to_jsonb(r."payroll_lock_id"), 'payroll_recovered_at', to_jsonb(r."payroll_recovered_at"), 'payroll_reconciled_at', to_jsonb(r."payroll_reconciled_at"), 'payroll_reconciliation', to_jsonb(r."payroll_reconciliation"), 'created_at', to_jsonb(r."created_at"), 'created_by', to_jsonb(r."created_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_monthly_expenses"(r public."monthly_expenses") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('expense_name', to_jsonb(r."expense_name"), 'category_id', to_jsonb(r."category_id"), 'quantity', to_jsonb(r."quantity"), 'unit_cost', to_jsonb(r."unit_cost"), 'total_monthly_cost', to_jsonb(r."total_monthly_cost"), 'payment_day', to_jsonb(r."payment_day"), 'payment_status', to_jsonb(r."payment_status"), 'recurrence', to_jsonb(r."recurrence"), 'logged_date', to_jsonb(r."logged_date"), 'spent_date', to_jsonb(r."spent_date"), 'is_tax_invoice', to_jsonb(r."is_tax_invoice"), 'invoice_url', to_jsonb(r."invoice_url"), 'invoice_number', to_jsonb(r."invoice_number"), 'invoice_date', to_jsonb(r."invoice_date"), 'supplier', to_jsonb(r."supplier"), 'vat_amount', to_jsonb(r."vat_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'price_mode', to_jsonb(r."price_mode"), 'vat_deductible', to_jsonb(r."vat_deductible"), 'payment_method', to_jsonb(r."payment_method"), 'paid_date', to_jsonb(r."paid_date"), 'start_period', to_jsonb(r."start_period"), 'end_period', to_jsonb(r."end_period"), 'active', to_jsonb(r."active"), 'biker_id', to_jsonb(r."biker_id"), 'payroll_period', to_jsonb(r."payroll_period"), 'salary_month', to_jsonb(r."salary_month"), 'payrollSnapshot', to_jsonb(r."payroll_snapshot"), 'approval_status', to_jsonb(r."approval_status"), 'finance_metadata', to_jsonb(r."finance_metadata"), 'finance_revision', to_jsonb(r."finance_revision"), 'finance_workflow_version', to_jsonb(r."finance_workflow_version"), 'updated_at', to_jsonb(r."updated_at"), 'updated_by', to_jsonb(r."updated_by"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_variable_expenses"(r public."variable_expenses") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('expense_name', to_jsonb(r."expense_name"), 'category_id', to_jsonb(r."category_id"), 'quantity', to_jsonb(r."quantity"), 'unit_cost', to_jsonb(r."unit_cost"), 'total_variable_cost', to_jsonb(r."total_variable_cost"), 'payment_status', to_jsonb(r."payment_status"), 'logged_date', to_jsonb(r."logged_date"), 'spent_date', to_jsonb(r."spent_date"), 'is_tax_invoice', to_jsonb(r."is_tax_invoice"), 'invoice_url', to_jsonb(r."invoice_url"), 'invoice_number', to_jsonb(r."invoice_number"), 'invoice_date', to_jsonb(r."invoice_date"), 'supplier', to_jsonb(r."supplier"), 'vat_amount', to_jsonb(r."vat_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'price_mode', to_jsonb(r."price_mode"), 'vat_deductible', to_jsonb(r."vat_deductible"), 'payment_method', to_jsonb(r."payment_method"), 'paid_date', to_jsonb(r."paid_date"), 'approval_status', to_jsonb(r."approval_status"), 'finance_metadata', to_jsonb(r."finance_metadata"), 'finance_revision', to_jsonb(r."finance_revision"), 'finance_workflow_version', to_jsonb(r."finance_workflow_version"), 'updated_at', to_jsonb(r."updated_at"), 'updated_by', to_jsonb(r."updated_by"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_annual_expenses"(r public."annual_expenses") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('expense_name', to_jsonb(r."expense_name"), 'category', to_jsonb(r."category"), 'quantity', to_jsonb(r."quantity"), 'annual_cost', to_jsonb(r."annual_cost"), 'actual_amount', to_jsonb(r."actual_amount"), 'units', to_jsonb(r."units"), 'payment_month', to_jsonb(r."payment_month"), 'payment_day', to_jsonb(r."payment_day"), 'payment_status', to_jsonb(r."payment_status"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_annual_expense_entries"(r public."annual_expense_entries") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('annual_expense_id', to_jsonb(r."annual_expense_id"), 'description', to_jsonb(r."description"), 'amount', to_jsonb(r."amount"), 'spent_date', to_jsonb(r."spent_date"), 'logged_date', to_jsonb(r."logged_date"), 'unit', to_jsonb(r."unit"), 'notes', to_jsonb(r."notes"), 'is_tax_invoice', to_jsonb(r."is_tax_invoice"), 'invoice_url', to_jsonb(r."invoice_url"), 'invoice_number', to_jsonb(r."invoice_number"), 'invoice_date', to_jsonb(r."invoice_date"), 'supplier', to_jsonb(r."supplier"), 'vat_amount', to_jsonb(r."vat_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'price_mode', to_jsonb(r."price_mode"), 'vat_deductible', to_jsonb(r."vat_deductible"), 'payment_method', to_jsonb(r."payment_method"), 'paid_date', to_jsonb(r."paid_date"), 'approval_status', to_jsonb(r."approval_status"), 'finance_metadata', to_jsonb(r."finance_metadata"), 'finance_revision', to_jsonb(r."finance_revision"), 'finance_workflow_version', to_jsonb(r."finance_workflow_version"), 'updated_at', to_jsonb(r."updated_at"), 'updated_by', to_jsonb(r."updated_by"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_startup_costs"(r public."startup_costs") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('category', to_jsonb(r."category"), 'item_name', to_jsonb(r."item_name"), 'quantity', to_jsonb(r."quantity"), 'budgeted_amount', to_jsonb(r."budgeted_amount"), 'units', to_jsonb(r."units"), 'actual_amount', to_jsonb(r."actual_amount"), 'status', to_jsonb(r."status"), 'is_tax_invoice', to_jsonb(r."is_tax_invoice"), 'invoice_url', to_jsonb(r."invoice_url"), 'invoice_number', to_jsonb(r."invoice_number"), 'invoice_date', to_jsonb(r."invoice_date"), 'supplier', to_jsonb(r."supplier"), 'vat_amount', to_jsonb(r."vat_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'price_mode', to_jsonb(r."price_mode"), 'vat_deductible', to_jsonb(r."vat_deductible"), 'payment_method', to_jsonb(r."payment_method"), 'converted_at', to_jsonb(r."converted_at"), 'converted_by', to_jsonb(r."converted_by"), 'updated_at', to_jsonb(r."updated_at"), 'updated_by', to_jsonb(r."updated_by"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_startup_cost_entries"(r public."startup_cost_entries") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('startup_cost_id', to_jsonb(r."startup_cost_id"), 'description', to_jsonb(r."description"), 'amount', to_jsonb(r."amount"), 'spent_date', to_jsonb(r."spent_date"), 'notes', to_jsonb(r."notes"), 'unit', to_jsonb(r."unit"), 'is_tax_invoice', to_jsonb(r."is_tax_invoice"), 'invoice_url', to_jsonb(r."invoice_url"), 'invoice_number', to_jsonb(r."invoice_number"), 'invoice_date', to_jsonb(r."invoice_date"), 'supplier', to_jsonb(r."supplier"), 'vat_amount', to_jsonb(r."vat_amount"), 'vat_rate', to_jsonb(r."vat_rate"), 'price_mode', to_jsonb(r."price_mode"), 'vat_deductible', to_jsonb(r."vat_deductible"), 'payment_method', to_jsonb(r."payment_method"), 'paid_date', to_jsonb(r."paid_date"), 'created_at', to_jsonb(r."created_at"), 'created_by', to_jsonb(r."created_by"), 'converted_from_parent', to_jsonb(r."converted_from_parent"), 'approval_status', to_jsonb(r."approval_status"), 'finance_metadata', to_jsonb(r."finance_metadata"), 'finance_revision', to_jsonb(r."finance_revision"), 'finance_workflow_version', to_jsonb(r."finance_workflow_version"), 'updated_at', to_jsonb(r."updated_at"), 'updated_by', to_jsonb(r."updated_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_expense_vouchers"(r public."expense_vouchers") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('templateId', to_jsonb(r."template_id"), 'templateName', to_jsonb(r."template_name"), 'categoryId', to_jsonb(r."category_id"), 'periodKey', to_jsonb(r."period_key"), 'dueDate', to_jsonb(r."due_date"), 'quantity', to_jsonb(r."quantity"), 'unitCost', to_jsonb(r."unit_cost"), 'amount', to_jsonb(r."amount"), 'isTaxInvoice', to_jsonb(r."is_tax_invoice"), 'invoiceUrl', to_jsonb(r."invoice_url"), 'supplier', to_jsonb(r."supplier"), 'invoiceNumber', to_jsonb(r."invoice_number"), 'invoiceDate', to_jsonb(r."invoice_date"), 'vatAmount', to_jsonb(r."vat_amount"), 'vatRate', to_jsonb(r."vat_rate"), 'priceMode', to_jsonb(r."price_mode"), 'vatDeductible', to_jsonb(r."vat_deductible"), 'paymentStatus', to_jsonb(r."payment_status"), 'paidDate', to_jsonb(r."paid_date"), 'status', to_jsonb(r."status"), 'generatedBy', to_jsonb(r."generated_by"), 'generatedAt', to_jsonb(r."generated_at"), 'generatedAtIso', to_jsonb(r."generated_at_iso"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedAt', to_jsonb(r."updated_at"), 'cancelReason', to_jsonb(r."cancel_reason"), 'cancelledBy', to_jsonb(r."cancelled_by"), 'cancelledAt', to_jsonb(r."cancelled_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_fixed_assets"(r public."fixed_assets") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('name', to_jsonb(r."name"), 'cost', to_jsonb(r."cost"), 'salvageValue', to_jsonb(r."salvage_value"), 'usefulLifeMonths', to_jsonb(r."useful_life_months"), 'inServiceDate', to_jsonb(r."in_service_date"), 'method', to_jsonb(r."method"), 'assetAccount', to_jsonb(r."asset_account"), 'accumulatedAccount', to_jsonb(r."accumulated_account"), 'expenseAccount', to_jsonb(r."expense_account"), 'active', to_jsonb(r."active"), 'disposalDate', to_jsonb(r."disposal_date"), 'disposalProceeds', to_jsonb(r."disposal_proceeds"), 'disposalEntryId', to_jsonb(r."disposal_entry_id"), 'sourceType', to_jsonb(r."source_type"), 'sourceId', to_jsonb(r."source_id"), 'createdBy', to_jsonb(r."created_by"), 'createdAt', to_jsonb(r."created_at"), 'createdAtIso', to_jsonb(r."created_at_iso"), 'updatedBy', to_jsonb(r."updated_by"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_fee_rules"(r public."fee_rules") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('key', to_jsonb(r."key"), 'label', to_jsonb(r."label"), 'basis', to_jsonb(r."basis"), 'rate', to_jsonb(r."rate"), 'effective_from', to_jsonb(r."effective_from"), 'active', to_jsonb(r."active"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_categories"(r public."categories") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('label', to_jsonb(r."label"), 'sort_order', to_jsonb(r."sort_order"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_category_budgets"(r public."category_budgets") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('category_label', to_jsonb(r."category_label"), 'budget_type', to_jsonb(r."budget_type"), 'amount', to_jsonb(r."amount"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_monthly_expense_categories"(r public."monthly_expense_categories") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('label', to_jsonb(r."label"), 'sort_order', to_jsonb(r."sort_order"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_variable_expense_categories"(r public."variable_expense_categories") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('label', to_jsonb(r."label"), 'sort_order', to_jsonb(r."sort_order"), 'created_at', to_jsonb(r."created_at"), 'is_dynamic', to_jsonb(r."is_dynamic"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_annual_expense_categories"(r public."annual_expense_categories") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('label', to_jsonb(r."label"), 'sort_order', to_jsonb(r."sort_order"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_transactions"(r public."transactions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('occurred_on', to_jsonb(r."occurred_on"), 'description', to_jsonb(r."description"), 'type', to_jsonb(r."type"), 'amount', to_jsonb(r."amount"), 'vehicle_id', to_jsonb(r."vehicle_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partners"(r public."partners") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('partner_name', to_jsonb(r."partner_name"), 'workers_count', to_jsonb(r."workers_count"), 'paid_amount', to_jsonb(r."paid_amount"), 'contact_number', to_jsonb(r."contact_number"), 'status', to_jsonb(r."status"), 'user_id', to_jsonb(r."user_id"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_payments"(r public."partner_payments") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('partner_id', to_jsonb(r."partner_id"), 'amount', to_jsonb(r."amount"), 'payment_date', to_jsonb(r."payment_date"), 'payment_method', to_jsonb(r."payment_method"), 'notes', to_jsonb(r."notes"), 'created_at', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_worker_eligibility"(r public."partner_worker_eligibility") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'changes', to_jsonb(r."changes"), 'updatedAt', to_jsonb(r."updated_at"), 'updatedBy', to_jsonb(r."updated_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_worker_eligibility_audit"(r public."partner_worker_eligibility_audit") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'revision', to_jsonb(r."revision"), 'actorUid', to_jsonb(r."actor_uid"), 'createdAt', to_jsonb(r."created_at"), 'reason', to_jsonb(r."reason"), 'before', to_jsonb(r."before"), 'after', to_jsonb(r."after"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_mcp_keys"(r public."partner_mcp_keys") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('keyId', to_jsonb(r."key_id"), 'partnerId', to_jsonb(r."partner_id"), 'ownerUid', to_jsonb(r."owner_uid"), 'status', to_jsonb(r."status"), 'label', to_jsonb(r."label"), 'createdAt', to_jsonb(r."created_at"), 'createdAtIso', to_jsonb(r."created_at_iso"), 'createdBy', to_jsonb(r."created_by"), 'lastUsedAt', to_jsonb(r."last_used_at"), 'revokedAt', to_jsonb(r."revoked_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_mcp_key_hashes"(r public."partner_mcp_key_hashes") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('keyId', to_jsonb(r."key_id"), 'partnerId', to_jsonb(r."partner_id"), 'ownerUid', to_jsonb(r."owner_uid"), 'createdAtIso', to_jsonb(r."created_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_partner_mcp_rate_limits"(r public."partner_mcp_rate_limits") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('keyId', to_jsonb(r."key_id"), 'count', to_jsonb(r."count"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_payroll_periods"(r public."payroll_periods") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'revision', to_jsonb(r."revision"), 'currentRunId', to_jsonb(r."current_run_id"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_payroll_runs"(r public."payroll_runs") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('runId', to_jsonb(r."run_id"), 'revision', to_jsonb(r."revision"), 'periodKey', to_jsonb(r."period_key"), 'periodStart', to_jsonb(r."period_start"), 'periodEnd', to_jsonb(r."period_end"), 'distributionDate', to_jsonb(r."distribution_date"), 'status', to_jsonb(r."status"), 'estimated', to_jsonb(r."estimated"), 'lineCount', to_jsonb(r."line_count"), 'totals', to_jsonb(r."totals"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'journalEntryNumber', to_jsonb(r."journal_entry_number"), 'reversalEntryId', to_jsonb(r."reversal_entry_id"), 'payDate', to_jsonb(r."pay_date"), 'paymentMethod', to_jsonb(r."payment_method"), 'createdAt', to_jsonb(r."created_at"), 'createdBy', to_jsonb(r."created_by"), 'updatedAt', to_jsonb(r."updated_at"), 'updatedBy', to_jsonb(r."updated_by"), 'approvedAt', to_jsonb(r."approved_at"), 'approvedBy', to_jsonb(r."approved_by"), 'paidAt', to_jsonb(r."paid_at"), 'paidBy', to_jsonb(r."paid_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_payroll_run_items"(r public."payroll_run_items") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bikerId', to_jsonb(r."biker_id"), 'name', to_jsonb(r."name"), 'monthlySalary', to_jsonb(r."monthly_salary"), 'basicDue', to_jsonb(r."basic_due"), 'commission', to_jsonb(r."commission"), 'bonus', to_jsonb(r."bonus"), 'deduction', to_jsonb(r."deduction"), 'advanceDeduction', to_jsonb(r."advance_deduction"), 'netDue', to_jsonb(r."net_due"), 'status', to_jsonb(r."status"), 'runId', to_jsonb(r."run_id"), 'periodKey', to_jsonb(r."period_key"), 'revision', to_jsonb(r."revision"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'paidAt', to_jsonb(r."paid_at"), 'paidBy', to_jsonb(r."paid_by"), 'payDate', to_jsonb(r."pay_date"), 'paymentMethod', to_jsonb(r."payment_method"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_payroll_run_payments"(r public."payroll_run_payments") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('previewHash', to_jsonb(r."preview_hash"), 'createdBy', to_jsonb(r."created_by"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_payroll_payment_locks"(r public."payroll_payment_locks") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'bikerId', to_jsonb(r."biker_id"), 'runId', to_jsonb(r."run_id"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'entryNumber', to_jsonb(r."entry_number"), 'lockedAt', to_jsonb(r."locked_at"), 'lockedBy', to_jsonb(r."locked_by"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_advance_month_corrections"(r public."advance_month_corrections") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('actor', to_jsonb(r."actor"), 'recordedAt', to_jsonb(r."recorded_at"), 'recordedAtIso', to_jsonb(r."recorded_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_finance_reviews"(r public."finance_reviews") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('kind', to_jsonb(r."kind"), 'sourceId', to_jsonb(r."source_id"), 'sourceHash', to_jsonb(r."source_hash"), 'status', to_jsonb(r."status"), 'postingHash', to_jsonb(r."posting_hash"), 'reviewedByUid', to_jsonb(r."reviewed_by_uid"), 'reviewedAt', to_jsonb(r."reviewed_at"), 'reason', to_jsonb(r."reason"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_finance_review_revisions"(r public."finance_review_revisions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_finance_workbench_receipts"(r public."finance_workbench_receipts") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('requestHash', to_jsonb(r."request_hash"), 'userId', to_jsonb(r."user_id"), 'at', to_jsonb(r."at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_mcp_mutation_receipts"(r public."mcp_mutation_receipts") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('requestHash', to_jsonb(r."request_hash"), 'userId', to_jsonb(r."user_id"), 'at', to_jsonb(r."at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_raw_payloads"(r public."sweater_raw_payloads") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('importRunId', to_jsonb(r."import_run_id"), 'sspBookingId', to_jsonb(r."ssp_booking_id"), 'sourceHash', to_jsonb(r."source_hash"), 'schemaVersion', to_jsonb(r."schema_version"), 'processingStatus', to_jsonb(r."processing_status"), 'fetchedAt', to_jsonb(r."fetched_at"), 'fetchedAtIso', to_jsonb(r."fetched_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_bookings"(r public."sweater_bookings") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('sspBookingId', to_jsonb(r."ssp_booking_id"), 'serviceDate', to_jsonb(r."service_date"), 'periodKey', to_jsonb(r."period_key"), 'normalizedStatus', to_jsonb(r."normalized_status"), 'processingStatus', to_jsonb(r."processing_status"), 'postedEntryId', to_jsonb(r."posted_entry_id"), 'postedAt', to_jsonb(r."posted_at"), 'settlementId', to_jsonb(r."settlement_id"), 'sourceHash', to_jsonb(r."source_hash"), 'schemaVersion', to_jsonb(r."schema_version"), 'source', to_jsonb(r."source"), 'lastImportRunId', to_jsonb(r."last_import_run_id"), 'reviewReasonCode', to_jsonb(r."review_reason_code"), 'recognitionEligibility', to_jsonb(r."recognition_eligibility"), 'recognitionReason', to_jsonb(r."recognition_reason"), 'bookingNumber', to_jsonb(r."booking_number"), 'operationalWorkerId', to_jsonb(r."operational_worker_id"), 'record', to_jsonb(r."record"), 'updatedAt', to_jsonb(r."updated_at"), 'updatedAtIso', to_jsonb(r."updated_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_import_runs"(r public."sweater_import_runs") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('status', to_jsonb(r."status"), 'source', to_jsonb(r."source"), 'actor', to_jsonb(r."actor"), 'recordCount', to_jsonb(r."record_count"), 'startedAt', to_jsonb(r."started_at"), 'startedAtIso', to_jsonb(r."started_at_iso"), 'finishedAt', to_jsonb(r."finished_at"), 'finishedAtIso', to_jsonb(r."finished_at_iso"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_integration_state"(r public."sweater_integration_state") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each('{}'::jsonb) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_variances"(r public."sweater_variances") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('kind', to_jsonb(r."kind"), 'sspBookingId', to_jsonb(r."ssp_booking_id"), 'periodKey', to_jsonb(r."period_key"), 'resolution', to_jsonb(r."resolution"), 'difference', to_jsonb(r."difference"), 'detectedAt', to_jsonb(r."detected_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_settlements"(r public."sweater_settlements") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'status', to_jsonb(r."status"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'invoiceDocumentId', to_jsonb(r."invoice_document_id"), 'figures', to_jsonb(r."figures"), 'collectedTotal', to_jsonb(r."collected_total"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_adjustments"(r public."sweater_adjustments") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('typeKey', to_jsonb(r."type_key"), 'kind', to_jsonb(r."kind"), 'amount', to_jsonb(r."amount"), 'effectiveDate', to_jsonb(r."effective_date"), 'periodKey', to_jsonb(r."period_key"), 'approvalStatus', to_jsonb(r."approval_status"), 'journalEntryId', to_jsonb(r."journal_entry_id"), 'sspBookingId', to_jsonb(r."ssp_booking_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_collections"(r public."sweater_collections") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('periodKey', to_jsonb(r."period_key"), 'amount', to_jsonb(r."amount"), 'receivedDate', to_jsonb(r."received_date"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_price_list"(r public."sweater_price_list") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('key', to_jsonb(r."key"), 'serviceType', to_jsonb(r."service_type"), 'effectiveFrom', to_jsonb(r."effective_from"), 'effectiveTo', to_jsonb(r."effective_to"), 'status', to_jsonb(r."status"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_adjustment_types"(r public."sweater_adjustment_types") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('key', to_jsonb(r."key"), 'effectiveFrom', to_jsonb(r."effective_from"), 'effectiveTo', to_jsonb(r."effective_to"), 'status', to_jsonb(r."status"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_recognition_policy"(r public."sweater_recognition_policy") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('key', to_jsonb(r."key"), 'effectiveFrom', to_jsonb(r."effective_from"), 'effectiveTo', to_jsonb(r."effective_to"), 'status', to_jsonb(r."status"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_owner_booking_claims"(r public."sweater_owner_booking_claims") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bookingNumber', to_jsonb(r."booking_number"), 'sspBookingId', to_jsonb(r."ssp_booking_id"), 'washId', to_jsonb(r."wash_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_owner_collection_confirmations"(r public."sweater_owner_collection_confirmations") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('sspBookingId', to_jsonb(r."ssp_booking_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_operational_wash_links"(r public."sweater_operational_wash_links") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('washId', to_jsonb(r."wash_id"), 'sspBookingId', to_jsonb(r."ssp_booking_id"), 'side', to_jsonb(r."side"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_booking_links"(r public."sweater_booking_links") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('washId', to_jsonb(r."wash_id"), 'sspBookingId', to_jsonb(r."ssp_booking_id"), 'side', to_jsonb(r."side"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_owner_tax_clarifications"(r public."sweater_owner_tax_clarifications") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each('{}'::jsonb) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_integration_keys"(r public."sweater_integration_keys") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('keyId', to_jsonb(r."key_id"), 'status', to_jsonb(r."status"), 'scope', to_jsonb(r."scope"), 'principal', to_jsonb(r."principal"), 'createdAt', to_jsonb(r."created_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_sweater_rate_limits"(r public."sweater_rate_limits") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('keyId', to_jsonb(r."key_id"), 'count', to_jsonb(r."count"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_agents"(r public."agent_command_agents") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each('{}'::jsonb) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_reports"(r public."agent_command_reports") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('reportedAt', to_jsonb(r."reported_at"), 'reportId', to_jsonb(r."report_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_alerts"(r public."agent_command_alerts") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('active', to_jsonb(r."active"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_approvals"(r public."agent_command_approvals") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('status', to_jsonb(r."status"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_activity"(r public."agent_command_activity") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('occurredAt', to_jsonb(r."occurred_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_tasks"(r public."agent_command_tasks") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('caseId', to_jsonb(r."case_id"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_sources"(r public."agent_command_sources") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each('{}'::jsonb) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_agent_command_ingestion"(r public."agent_command_ingestion") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('eventId', to_jsonb(r."event_id"), 'payloadHash', to_jsonb(r."payload_hash"), 'expiresAt', to_jsonb(r."expires_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_executive_reports"(r public."executive_reports") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('dateRiyadh', to_jsonb(r."date_riyadh"), 'revision', to_jsonb(r."revision"), 'reportId', to_jsonb(r."report_id"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_executive_report_revisions"(r public."executive_report_revisions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'savedAt', to_jsonb(r."saved_at"), 'contentHash', to_jsonb(r."content_hash"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_finance_reports"(r public."finance_reports") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'reportId', to_jsonb(r."report_id"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_finance_report_revisions"(r public."finance_report_revisions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'savedAt', to_jsonb(r."saved_at"), 'contentHash', to_jsonb(r."content_hash"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_operations_reports"(r public."operations_reports") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'reportId', to_jsonb(r."report_id"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_operations_report_revisions"(r public."operations_report_revisions") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('revision', to_jsonb(r."revision"), 'savedAt', to_jsonb(r."saved_at"), 'contentHash', to_jsonb(r."content_hash"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_biker_quality_reports"(r public."biker_quality_reports") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('bikerUID', to_jsonb(r."biker_uid"), 'periodKey', to_jsonb(r."period_key"), 'rulesVersion', to_jsonb(r."rules_version"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;
create or replace function app."doc_password_reset_throttle"(r public."password_reset_throttle") returns jsonb
language sql immutable set search_path = '' as $$
  -- Same precedence as codec.js: the exact original (shape.r), then the column, then an explicit null.
  select r.extra
    || coalesce((select jsonb_object_agg(k, 'null'::jsonb) from jsonb_array_elements_text(coalesce(r.shape -> 'n', '[]'::jsonb)) k), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(jsonb_build_object('count', to_jsonb(r."count"), 'windowStartedAt', to_jsonb(r."window_started_at"), 'lastSentAt', to_jsonb(r."last_sent_at"), 'expiresAt', to_jsonb(r."expires_at"), 'updatedAt', to_jsonb(r."updated_at"))) e where e.value <> 'null'::jsonb), '{}'::jsonb)
    || coalesce(r.shape -> 'r', '{}'::jsonb)
$$;

-- ── بند تأسيس جديد = خطة فقط (startupCreateIsPlanOnly) ──
create or replace function app.startup_plan_only(d jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(d -> 'actual_amount', '0'::jsonb) = '0'::jsonb
    and coalesce(d -> 'is_tax_invoice', 'false'::jsonb) = 'false'::jsonb
    and coalesce(d -> 'invoice_number', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'invoice_date', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'supplier', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'vat_amount', 'null'::jsonb) = 'null'::jsonb
    and coalesce(d -> 'vat_rate', 'null'::jsonb) = 'null'::jsonb
    and not (d ? 'converted_at' or d ? 'converted_by')
    and coalesce(d -> 'status', '"in_progress"'::jsonb) = '"in_progress"'::jsonb $$;

-- ── قيود الحقول على المستخدم (الخادم ledger_server مستثنى) ──
create or replace function app.trg_members_fields() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if not (app.changed_keys(app.doc_members(old), app.doc_members(new)) <@ array['email', 'displayName']) then
    raise exception 'لا يتغيّر في حساب المستخدم إلا الإيميل والاسم' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger members_fields before update on public.members for each row execute function app.trg_members_fields();

create or replace function app.trg_annual_entry_fields() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if app.not_posted_expense('annual', old.id)
     or app.changed_keys(app.doc_annual_expense_entries(old), app.doc_annual_expense_entries(new)) <@ array['unit'] then
    return new;
  end if;
  raise exception 'دفعة مرحّلة: لا يتغيّر فيها إلا الوحدة' using errcode = '42501';
end $$;
create trigger annual_expense_entries_fields before update on public.annual_expense_entries for each row execute function app.trg_annual_entry_fields();

create or replace function app.trg_temporary_expense_fields() returns trigger language plpgsql set search_path = '' as $$
declare d jsonb;
begin
  if current_user <> 'authenticated' then return new; end if;
  if app.not_locked('temporary_expense', old.id) then return new; end if;
  d := app.doc_temporary_expenses(new);
  if app.changed_keys(app.doc_temporary_expenses(old), d) <@ array['status', 'recovered_date', 'recovery_method']
     and ((d -> 'status' = '"recovered"'::jsonb and jsonb_typeof(d -> 'recovered_date') = 'string')
       or (d -> 'status' = '"pending"'::jsonb and d ? 'recovered_date' and d -> 'recovered_date' = 'null'::jsonb)) then
    return new;
  end if;
  raise exception 'سلفة مرحّلة: يُسمح بقلب الاسترداد فقط' using errcode = '42501';
end $$;
create trigger temporary_expenses_fields before update on public.temporary_expenses for each row execute function app.trg_temporary_expense_fields();

-- ── RLS لكل جدول، والأصل المنع ──

alter table public."journal_entries" enable row level security;
revoke all on public."journal_entries" from anon, authenticated;
alter table public."journal_lines_legacy" enable row level security;
revoke all on public."journal_lines_legacy" from anon, authenticated;
alter table public."posting_locks" enable row level security;
revoke all on public."posting_locks" from anon, authenticated;
alter table public."accounting_periods" enable row level security;
revoke all on public."accounting_periods" from anon, authenticated;
alter table public."counters" enable row level security;
revoke all on public."counters" from anon, authenticated;
alter table public."chart_of_accounts" enable row level security;
revoke all on public."chart_of_accounts" from anon, authenticated;
alter table public."audit_logs" enable row level security;
revoke all on public."audit_logs" from anon, authenticated;
alter table public."sales_documents" enable row level security;
revoke all on public."sales_documents" from anon, authenticated;
alter table public."sales_document_sources" enable row level security;
revoke all on public."sales_document_sources" from anon, authenticated;
alter table public."app_settings" enable row level security;
revoke all on public."app_settings" from anon, authenticated;
alter table public."members" enable row level security;
revoke all on public."members" from anon, authenticated;
alter table public."app_admins" enable row level security;
revoke all on public."app_admins" from anon, authenticated;
alter table public."washes" enable row level security;
revoke all on public."washes" from anon, authenticated;
alter table public."bikers" enable row level security;
revoke all on public."bikers" from anon, authenticated;
alter table public."housing_units" enable row level security;
revoke all on public."housing_units" from anon, authenticated;
alter table public."temporary_expenses" enable row level security;
revoke all on public."temporary_expenses" from anon, authenticated;
alter table public."monthly_expenses" enable row level security;
revoke all on public."monthly_expenses" from anon, authenticated;
alter table public."variable_expenses" enable row level security;
revoke all on public."variable_expenses" from anon, authenticated;
alter table public."annual_expenses" enable row level security;
revoke all on public."annual_expenses" from anon, authenticated;
alter table public."annual_expense_entries" enable row level security;
revoke all on public."annual_expense_entries" from anon, authenticated;
alter table public."startup_costs" enable row level security;
revoke all on public."startup_costs" from anon, authenticated;
alter table public."startup_cost_entries" enable row level security;
revoke all on public."startup_cost_entries" from anon, authenticated;
alter table public."expense_vouchers" enable row level security;
revoke all on public."expense_vouchers" from anon, authenticated;
alter table public."fixed_assets" enable row level security;
revoke all on public."fixed_assets" from anon, authenticated;
alter table public."fee_rules" enable row level security;
revoke all on public."fee_rules" from anon, authenticated;
alter table public."categories" enable row level security;
revoke all on public."categories" from anon, authenticated;
alter table public."category_budgets" enable row level security;
revoke all on public."category_budgets" from anon, authenticated;
alter table public."monthly_expense_categories" enable row level security;
revoke all on public."monthly_expense_categories" from anon, authenticated;
alter table public."variable_expense_categories" enable row level security;
revoke all on public."variable_expense_categories" from anon, authenticated;
alter table public."annual_expense_categories" enable row level security;
revoke all on public."annual_expense_categories" from anon, authenticated;
alter table public."transactions" enable row level security;
revoke all on public."transactions" from anon, authenticated;
alter table public."partners" enable row level security;
revoke all on public."partners" from anon, authenticated;
alter table public."partner_payments" enable row level security;
revoke all on public."partner_payments" from anon, authenticated;
alter table public."partner_worker_eligibility" enable row level security;
revoke all on public."partner_worker_eligibility" from anon, authenticated;
alter table public."partner_worker_eligibility_audit" enable row level security;
revoke all on public."partner_worker_eligibility_audit" from anon, authenticated;
alter table public."partner_mcp_keys" enable row level security;
revoke all on public."partner_mcp_keys" from anon, authenticated;
alter table public."partner_mcp_key_hashes" enable row level security;
revoke all on public."partner_mcp_key_hashes" from anon, authenticated;
alter table public."partner_mcp_rate_limits" enable row level security;
revoke all on public."partner_mcp_rate_limits" from anon, authenticated;
alter table public."payroll_periods" enable row level security;
revoke all on public."payroll_periods" from anon, authenticated;
alter table public."payroll_runs" enable row level security;
revoke all on public."payroll_runs" from anon, authenticated;
alter table public."payroll_run_items" enable row level security;
revoke all on public."payroll_run_items" from anon, authenticated;
alter table public."payroll_run_payments" enable row level security;
revoke all on public."payroll_run_payments" from anon, authenticated;
alter table public."payroll_payment_locks" enable row level security;
revoke all on public."payroll_payment_locks" from anon, authenticated;
alter table public."advance_month_corrections" enable row level security;
revoke all on public."advance_month_corrections" from anon, authenticated;
alter table public."finance_reviews" enable row level security;
revoke all on public."finance_reviews" from anon, authenticated;
alter table public."finance_review_revisions" enable row level security;
revoke all on public."finance_review_revisions" from anon, authenticated;
alter table public."finance_workbench_receipts" enable row level security;
revoke all on public."finance_workbench_receipts" from anon, authenticated;
alter table public."mcp_mutation_receipts" enable row level security;
revoke all on public."mcp_mutation_receipts" from anon, authenticated;
alter table public."sweater_raw_payloads" enable row level security;
revoke all on public."sweater_raw_payloads" from anon, authenticated;
alter table public."sweater_bookings" enable row level security;
revoke all on public."sweater_bookings" from anon, authenticated;
alter table public."sweater_import_runs" enable row level security;
revoke all on public."sweater_import_runs" from anon, authenticated;
alter table public."sweater_integration_state" enable row level security;
revoke all on public."sweater_integration_state" from anon, authenticated;
alter table public."sweater_variances" enable row level security;
revoke all on public."sweater_variances" from anon, authenticated;
alter table public."sweater_settlements" enable row level security;
revoke all on public."sweater_settlements" from anon, authenticated;
alter table public."sweater_adjustments" enable row level security;
revoke all on public."sweater_adjustments" from anon, authenticated;
alter table public."sweater_collections" enable row level security;
revoke all on public."sweater_collections" from anon, authenticated;
alter table public."sweater_price_list" enable row level security;
revoke all on public."sweater_price_list" from anon, authenticated;
alter table public."sweater_adjustment_types" enable row level security;
revoke all on public."sweater_adjustment_types" from anon, authenticated;
alter table public."sweater_recognition_policy" enable row level security;
revoke all on public."sweater_recognition_policy" from anon, authenticated;
alter table public."sweater_owner_booking_claims" enable row level security;
revoke all on public."sweater_owner_booking_claims" from anon, authenticated;
alter table public."sweater_owner_collection_confirmations" enable row level security;
revoke all on public."sweater_owner_collection_confirmations" from anon, authenticated;
alter table public."sweater_operational_wash_links" enable row level security;
revoke all on public."sweater_operational_wash_links" from anon, authenticated;
alter table public."sweater_booking_links" enable row level security;
revoke all on public."sweater_booking_links" from anon, authenticated;
alter table public."sweater_owner_tax_clarifications" enable row level security;
revoke all on public."sweater_owner_tax_clarifications" from anon, authenticated;
alter table public."sweater_integration_keys" enable row level security;
revoke all on public."sweater_integration_keys" from anon, authenticated;
alter table public."sweater_rate_limits" enable row level security;
revoke all on public."sweater_rate_limits" from anon, authenticated;
alter table public."agent_command_agents" enable row level security;
revoke all on public."agent_command_agents" from anon, authenticated;
alter table public."agent_command_reports" enable row level security;
revoke all on public."agent_command_reports" from anon, authenticated;
alter table public."agent_command_alerts" enable row level security;
revoke all on public."agent_command_alerts" from anon, authenticated;
alter table public."agent_command_approvals" enable row level security;
revoke all on public."agent_command_approvals" from anon, authenticated;
alter table public."agent_command_activity" enable row level security;
revoke all on public."agent_command_activity" from anon, authenticated;
alter table public."agent_command_tasks" enable row level security;
revoke all on public."agent_command_tasks" from anon, authenticated;
alter table public."agent_command_sources" enable row level security;
revoke all on public."agent_command_sources" from anon, authenticated;
alter table public."agent_command_ingestion" enable row level security;
revoke all on public."agent_command_ingestion" from anon, authenticated;
alter table public."executive_reports" enable row level security;
revoke all on public."executive_reports" from anon, authenticated;
alter table public."executive_report_revisions" enable row level security;
revoke all on public."executive_report_revisions" from anon, authenticated;
alter table public."finance_reports" enable row level security;
revoke all on public."finance_reports" from anon, authenticated;
alter table public."finance_report_revisions" enable row level security;
revoke all on public."finance_report_revisions" from anon, authenticated;
alter table public."operations_reports" enable row level security;
revoke all on public."operations_reports" from anon, authenticated;
alter table public."operations_report_revisions" enable row level security;
revoke all on public."operations_report_revisions" from anon, authenticated;
alter table public."biker_quality_reports" enable row level security;
revoke all on public."biker_quality_reports" from anon, authenticated;
alter table public."password_reset_throttle" enable row level security;
revoke all on public."password_reset_throttle" from anon, authenticated;
alter table public."journal_entry_lines" enable row level security;
revoke all on public."journal_entry_lines" from anon, authenticated;
alter table public."firebase_uid_map" enable row level security;
revoke all on public."firebase_uid_map" from anon, authenticated;

-- journal_entries: read staff, write none
create policy "journal_entries_read" on public."journal_entries" for select to authenticated using ((select app.is_staff()));
grant select on public."journal_entries" to authenticated;
-- journal_lines: read staff, write none
create policy "journal_lines_legacy_read" on public."journal_lines_legacy" for select to authenticated using ((select app.is_staff()));
grant select on public."journal_lines_legacy" to authenticated;
-- posting_locks: read staff, write none
create policy "posting_locks_read" on public."posting_locks" for select to authenticated using ((select app.is_staff()));
grant select on public."posting_locks" to authenticated;
-- accounting_periods: read staff, write none
create policy "accounting_periods_read" on public."accounting_periods" for select to authenticated using ((select app.is_staff()));
grant select on public."accounting_periods" to authenticated;
-- counters: read accountant, write none
create policy "counters_read" on public."counters" for select to authenticated using ((select app.is_accountant()));
grant select on public."counters" to authenticated;
-- chart_of_accounts: read staff, write accountant-no-delete
create policy "chart_of_accounts_read" on public."chart_of_accounts" for select to authenticated using ((select app.is_staff()));
create policy "chart_of_accounts_insert" on public."chart_of_accounts" for insert to authenticated with check ((select app.is_accountant()));
create policy "chart_of_accounts_update" on public."chart_of_accounts" for update to authenticated using ((select app.is_accountant())) with check ((select app.is_accountant()));
grant select, insert, update on public."chart_of_accounts" to authenticated;
-- audit_logs: read accountant, write none
create policy "audit_logs_read" on public."audit_logs" for select to authenticated using ((select app.is_accountant()));
grant select on public."audit_logs" to authenticated;
-- sales_documents: read staff, write none
create policy "sales_documents_read" on public."sales_documents" for select to authenticated using ((select app.is_staff()));
grant select on public."sales_documents" to authenticated;
-- sales_document_sources: read accountant, write none
create policy "sales_document_sources_read" on public."sales_document_sources" for select to authenticated using ((select app.is_accountant()));
grant select on public."sales_document_sources" to authenticated;
-- app_settings: read staff, write app-settings
create policy "app_settings_read" on public."app_settings" for select to authenticated using ((select app.is_staff()));
create policy "app_settings_write" on public."app_settings" for all to authenticated using ((select app.is_accountant()) and id <> 'accounting') with check ((select app.is_accountant()) and id <> 'accounting');
grant select, insert, update, delete on public."app_settings" to authenticated;
-- users: read members-self, write members
create policy "members_read" on public."members" for select to authenticated using ((id = (select auth.uid())::text or (select app.is_admin())));
create policy "members_insert" on public."members" for insert to authenticated with check ((select app.is_admin()));
create policy "members_update" on public."members" for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update on public."members" to authenticated;
-- app_admins: read admin, write none
create policy "app_admins_read" on public."app_admins" for select to authenticated using ((select app.is_admin()));
grant select on public."app_admins" to authenticated;
-- washes: read staff, write operator
create policy "washes_read" on public."washes" for select to authenticated using ((select app.is_staff()));
create policy "washes_insert" on public."washes" for insert to authenticated with check ((select app.is_operator()));
create policy "washes_update" on public."washes" for update to authenticated using ((select app.is_operator()) and app.not_locked('wash', id)) with check ((select app.is_operator()));
create policy "washes_delete" on public."washes" for delete to authenticated using ((select app.is_operator()) and app.not_locked('wash', id));
grant select, insert, update, delete on public."washes" to authenticated;
-- bikers: read staff, write operator
create policy "bikers_read" on public."bikers" for select to authenticated using ((select app.is_staff()));
create policy "bikers_insert" on public."bikers" for insert to authenticated with check ((select app.is_operator()));
create policy "bikers_update" on public."bikers" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "bikers_delete" on public."bikers" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."bikers" to authenticated;
-- housing_units: read staff, write operator
create policy "housing_units_read" on public."housing_units" for select to authenticated using ((select app.is_staff()));
create policy "housing_units_insert" on public."housing_units" for insert to authenticated with check ((select app.is_operator()));
create policy "housing_units_update" on public."housing_units" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "housing_units_delete" on public."housing_units" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."housing_units" to authenticated;
-- temporary_expenses: read staff, write temporary-expenses
create policy "temporary_expenses_read" on public."temporary_expenses" for select to authenticated using ((select app.is_staff()));
create policy "temporary_expenses_insert" on public."temporary_expenses" for insert to authenticated with check ((select app.is_operator()));
create policy "temporary_expenses_update" on public."temporary_expenses" for update to authenticated using ((select app.is_operator()) and app.not_locked('recovery', id) and not (app."doc_temporary_expenses"(temporary_expenses) ? 'payroll_lock_id')) with check ((select app.is_operator()));
create policy "temporary_expenses_delete" on public."temporary_expenses" for delete to authenticated using ((select app.is_operator()) and not (app."doc_temporary_expenses"(temporary_expenses) ? 'payroll_lock_id') and app.not_locked('temporary_expense', id) and app.not_locked('recovery', id));
grant select, insert, update, delete on public."temporary_expenses" to authenticated;
-- monthly_expenses: read staff, write operator
create policy "monthly_expenses_read" on public."monthly_expenses" for select to authenticated using ((select app.is_staff()));
create policy "monthly_expenses_insert" on public."monthly_expenses" for insert to authenticated with check ((select app.is_operator()));
create policy "monthly_expenses_update" on public."monthly_expenses" for update to authenticated using ((select app.is_operator()) and app.not_posted_expense('monthly', id)) with check ((select app.is_operator()));
create policy "monthly_expenses_delete" on public."monthly_expenses" for delete to authenticated using ((select app.is_operator()) and app.not_posted_expense('monthly', id));
grant select, insert, update, delete on public."monthly_expenses" to authenticated;
-- variable_expenses: read staff, write operator
create policy "variable_expenses_read" on public."variable_expenses" for select to authenticated using ((select app.is_staff()));
create policy "variable_expenses_insert" on public."variable_expenses" for insert to authenticated with check ((select app.is_operator()));
create policy "variable_expenses_update" on public."variable_expenses" for update to authenticated using ((select app.is_operator()) and app.not_posted_expense('variable', id)) with check ((select app.is_operator()));
create policy "variable_expenses_delete" on public."variable_expenses" for delete to authenticated using ((select app.is_operator()) and app.not_posted_expense('variable', id));
grant select, insert, update, delete on public."variable_expenses" to authenticated;
-- annual_expenses: read staff, write operator
create policy "annual_expenses_read" on public."annual_expenses" for select to authenticated using ((select app.is_staff()));
create policy "annual_expenses_insert" on public."annual_expenses" for insert to authenticated with check ((select app.is_operator()));
create policy "annual_expenses_update" on public."annual_expenses" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "annual_expenses_delete" on public."annual_expenses" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."annual_expenses" to authenticated;
-- annual_expense_entries: read staff, write annual-entries
create policy "annual_expense_entries_read" on public."annual_expense_entries" for select to authenticated using ((select app.is_staff()));
create policy "annual_expense_entries_insert" on public."annual_expense_entries" for insert to authenticated with check ((select app.is_operator()));
create policy "annual_expense_entries_update" on public."annual_expense_entries" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "annual_expense_entries_delete" on public."annual_expense_entries" for delete to authenticated using ((select app.is_operator()) and app.not_posted_expense('annual', id));
grant select, insert, update, delete on public."annual_expense_entries" to authenticated;
-- startup_costs: read staff, write startup-plan
create policy "startup_costs_read" on public."startup_costs" for select to authenticated using ((select app.is_staff()));
create policy "startup_costs_insert" on public."startup_costs" for insert to authenticated with check ((select app.is_operator()) and app.startup_plan_only(app."doc_startup_costs"(startup_costs)));
grant select, insert on public."startup_costs" to authenticated;
-- startup_cost_entries: read staff, write none
create policy "startup_cost_entries_read" on public."startup_cost_entries" for select to authenticated using ((select app.is_staff()));
grant select on public."startup_cost_entries" to authenticated;
-- expense_vouchers: read staff, write vouchers
create policy "expense_vouchers_read" on public."expense_vouchers" for select to authenticated using ((select app.is_staff()));
create policy "expense_vouchers_insert" on public."expense_vouchers" for insert to authenticated with check ((select app.is_accountant()));
create policy "expense_vouchers_update" on public."expense_vouchers" for update to authenticated using ((select app.is_accountant()) and app.not_posted_expense('voucher', id)) with check ((select app.is_accountant()));
grant select, insert, update on public."expense_vouchers" to authenticated;
-- fixed_assets: read staff, write accountant-no-delete
create policy "fixed_assets_read" on public."fixed_assets" for select to authenticated using ((select app.is_staff()));
create policy "fixed_assets_insert" on public."fixed_assets" for insert to authenticated with check ((select app.is_accountant()));
create policy "fixed_assets_update" on public."fixed_assets" for update to authenticated using ((select app.is_accountant())) with check ((select app.is_accountant()));
grant select, insert, update on public."fixed_assets" to authenticated;
-- fee_rules: read staff, write admin
create policy "fee_rules_read" on public."fee_rules" for select to authenticated using ((select app.is_staff()));
create policy "fee_rules_write" on public."fee_rules" for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public."fee_rules" to authenticated;
-- categories: read staff, write operator
create policy "categories_read" on public."categories" for select to authenticated using ((select app.is_staff()));
create policy "categories_insert" on public."categories" for insert to authenticated with check ((select app.is_operator()));
create policy "categories_update" on public."categories" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "categories_delete" on public."categories" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."categories" to authenticated;
-- category_budgets: read staff, write operator
create policy "category_budgets_read" on public."category_budgets" for select to authenticated using ((select app.is_staff()));
create policy "category_budgets_insert" on public."category_budgets" for insert to authenticated with check ((select app.is_operator()));
create policy "category_budgets_update" on public."category_budgets" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "category_budgets_delete" on public."category_budgets" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."category_budgets" to authenticated;
-- monthly_expense_categories: read staff, write operator
create policy "monthly_expense_categories_read" on public."monthly_expense_categories" for select to authenticated using ((select app.is_staff()));
create policy "monthly_expense_categories_insert" on public."monthly_expense_categories" for insert to authenticated with check ((select app.is_operator()));
create policy "monthly_expense_categories_update" on public."monthly_expense_categories" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "monthly_expense_categories_delete" on public."monthly_expense_categories" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."monthly_expense_categories" to authenticated;
-- variable_expense_categories: read staff, write operator
create policy "variable_expense_categories_read" on public."variable_expense_categories" for select to authenticated using ((select app.is_staff()));
create policy "variable_expense_categories_insert" on public."variable_expense_categories" for insert to authenticated with check ((select app.is_operator()));
create policy "variable_expense_categories_update" on public."variable_expense_categories" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "variable_expense_categories_delete" on public."variable_expense_categories" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."variable_expense_categories" to authenticated;
-- annual_expense_categories: read staff, write operator
create policy "annual_expense_categories_read" on public."annual_expense_categories" for select to authenticated using ((select app.is_staff()));
create policy "annual_expense_categories_insert" on public."annual_expense_categories" for insert to authenticated with check ((select app.is_operator()));
create policy "annual_expense_categories_update" on public."annual_expense_categories" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "annual_expense_categories_delete" on public."annual_expense_categories" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."annual_expense_categories" to authenticated;
-- transactions: read staff, write operator
create policy "transactions_read" on public."transactions" for select to authenticated using ((select app.is_staff()));
create policy "transactions_insert" on public."transactions" for insert to authenticated with check ((select app.is_operator()));
create policy "transactions_update" on public."transactions" for update to authenticated using ((select app.is_operator())) with check ((select app.is_operator()));
create policy "transactions_delete" on public."transactions" for delete to authenticated using ((select app.is_operator()));
grant select, insert, update, delete on public."transactions" to authenticated;
-- partners: read staff, write admin
create policy "partners_read" on public."partners" for select to authenticated using ((select app.is_staff()));
create policy "partners_write" on public."partners" for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public."partners" to authenticated;
-- partner_payments: read staff, write operator
create policy "partner_payments_read" on public."partner_payments" for select to authenticated using ((select app.is_staff()));
create policy "partner_payments_insert" on public."partner_payments" for insert to authenticated with check ((select app.is_operator()));
create policy "partner_payments_update" on public."partner_payments" for update to authenticated using ((select app.is_operator()) and app.not_locked('partner_payment', id)) with check ((select app.is_operator()));
create policy "partner_payments_delete" on public."partner_payments" for delete to authenticated using ((select app.is_operator()) and app.not_locked('partner_payment', id));
grant select, insert, update, delete on public."partner_payments" to authenticated;
-- partner_mcp_keys: read owner, write none
create policy "partner_mcp_keys_read" on public."partner_mcp_keys" for select to authenticated using (((select app.is_admin()) or ((select app.is_signed_in_known_non_supervisor()) and owner_uid = (select auth.uid())::text)));
grant select on public."partner_mcp_keys" to authenticated;
-- payroll_runs: read accountant, write none
create policy "payroll_runs_read" on public."payroll_runs" for select to authenticated using ((select app.is_accountant()));
grant select on public."payroll_runs" to authenticated;
-- payroll_runs/*/items: read accountant, write none
create policy "payroll_run_items_read" on public."payroll_run_items" for select to authenticated using ((select app.is_accountant()));
grant select on public."payroll_run_items" to authenticated;
-- sweater_raw_payloads: read staff, write none
create policy "sweater_raw_payloads_read" on public."sweater_raw_payloads" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_raw_payloads" to authenticated;
-- sweater_bookings: read staff, write none
create policy "sweater_bookings_read" on public."sweater_bookings" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_bookings" to authenticated;
-- sweater_import_runs: read staff, write none
create policy "sweater_import_runs_read" on public."sweater_import_runs" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_import_runs" to authenticated;
-- sweater_integration_state: read staff, write none
create policy "sweater_integration_state_read" on public."sweater_integration_state" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_integration_state" to authenticated;
-- sweater_variances: read staff, write none
create policy "sweater_variances_read" on public."sweater_variances" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_variances" to authenticated;
-- sweater_settlements: read staff, write none
create policy "sweater_settlements_read" on public."sweater_settlements" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_settlements" to authenticated;
-- sweater_adjustments: read staff, write none
create policy "sweater_adjustments_read" on public."sweater_adjustments" for select to authenticated using ((select app.is_staff()));
grant select on public."sweater_adjustments" to authenticated;
-- sweater_price_list: read staff, write accountant
create policy "sweater_price_list_read" on public."sweater_price_list" for select to authenticated using ((select app.is_staff()));
create policy "sweater_price_list_write" on public."sweater_price_list" for all to authenticated using ((select app.is_accountant())) with check ((select app.is_accountant()));
grant select, insert, update, delete on public."sweater_price_list" to authenticated;
-- sweater_adjustment_types: read staff, write accountant
create policy "sweater_adjustment_types_read" on public."sweater_adjustment_types" for select to authenticated using ((select app.is_staff()));
create policy "sweater_adjustment_types_write" on public."sweater_adjustment_types" for all to authenticated using ((select app.is_accountant())) with check ((select app.is_accountant()));
grant select, insert, update, delete on public."sweater_adjustment_types" to authenticated;
-- sweater_recognition_policy: read staff, write accountant
create policy "sweater_recognition_policy_read" on public."sweater_recognition_policy" for select to authenticated using ((select app.is_staff()));
create policy "sweater_recognition_policy_write" on public."sweater_recognition_policy" for all to authenticated using ((select app.is_accountant())) with check ((select app.is_accountant()));
grant select, insert, update, delete on public."sweater_recognition_policy" to authenticated;
-- agent_command_agents: read accountant, write none
create policy "agent_command_agents_read" on public."agent_command_agents" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_agents" to authenticated;
-- agent_command_reports: read accountant, write none
create policy "agent_command_reports_read" on public."agent_command_reports" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_reports" to authenticated;
-- agent_command_alerts: read accountant, write none
create policy "agent_command_alerts_read" on public."agent_command_alerts" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_alerts" to authenticated;
-- agent_command_approvals: read accountant, write none
create policy "agent_command_approvals_read" on public."agent_command_approvals" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_approvals" to authenticated;
-- agent_command_activity: read accountant, write none
create policy "agent_command_activity_read" on public."agent_command_activity" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_activity" to authenticated;
-- agent_command_tasks: read accountant, write none
create policy "agent_command_tasks_read" on public."agent_command_tasks" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_tasks" to authenticated;
-- agent_command_sources: read accountant, write none
create policy "agent_command_sources_read" on public."agent_command_sources" for select to authenticated using ((select app.is_accountant()));
grant select on public."agent_command_sources" to authenticated;
-- journal entry lines follow their entries; the uid map is for the admin
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated using ((select app.is_staff()));
grant select on public.journal_entry_lines to authenticated;
create policy firebase_uid_map_read on public.firebase_uid_map for select to authenticated using ((select app.is_admin()));
grant select on public.firebase_uid_map to authenticated;

-- ── الخادم الموثوق (ledger_server): بلا تجاوز للـRLS، بسياسة صريحة لكل جدول ──
-- The ledger tables cannot be deleted from by anyone (triggers), the audit log
-- is append-only for the server too.
create policy "journal_entries_server" on public."journal_entries" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."journal_entries" to ledger_server;
create policy "journal_lines_legacy_server" on public."journal_lines_legacy" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."journal_lines_legacy" to ledger_server;
create policy "posting_locks_server" on public."posting_locks" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."posting_locks" to ledger_server;
create policy "accounting_periods_server" on public."accounting_periods" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."accounting_periods" to ledger_server;
create policy "counters_server" on public."counters" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."counters" to ledger_server;
create policy "chart_of_accounts_server" on public."chart_of_accounts" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."chart_of_accounts" to ledger_server;
create policy "audit_logs_server" on public."audit_logs" for all to ledger_server using (true) with check (true);
grant select, insert on public."audit_logs" to ledger_server;
create policy "sales_documents_server" on public."sales_documents" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sales_documents" to ledger_server;
create policy "sales_document_sources_server" on public."sales_document_sources" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sales_document_sources" to ledger_server;
create policy "app_settings_server" on public."app_settings" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."app_settings" to ledger_server;
create policy "members_server" on public."members" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."members" to ledger_server;
create policy "app_admins_server" on public."app_admins" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."app_admins" to ledger_server;
create policy "washes_server" on public."washes" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."washes" to ledger_server;
create policy "bikers_server" on public."bikers" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."bikers" to ledger_server;
create policy "housing_units_server" on public."housing_units" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."housing_units" to ledger_server;
create policy "temporary_expenses_server" on public."temporary_expenses" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."temporary_expenses" to ledger_server;
create policy "monthly_expenses_server" on public."monthly_expenses" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."monthly_expenses" to ledger_server;
create policy "variable_expenses_server" on public."variable_expenses" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."variable_expenses" to ledger_server;
create policy "annual_expenses_server" on public."annual_expenses" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."annual_expenses" to ledger_server;
create policy "annual_expense_entries_server" on public."annual_expense_entries" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."annual_expense_entries" to ledger_server;
create policy "startup_costs_server" on public."startup_costs" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."startup_costs" to ledger_server;
create policy "startup_cost_entries_server" on public."startup_cost_entries" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."startup_cost_entries" to ledger_server;
create policy "expense_vouchers_server" on public."expense_vouchers" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."expense_vouchers" to ledger_server;
create policy "fixed_assets_server" on public."fixed_assets" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fixed_assets" to ledger_server;
create policy "fee_rules_server" on public."fee_rules" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."fee_rules" to ledger_server;
create policy "categories_server" on public."categories" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."categories" to ledger_server;
create policy "category_budgets_server" on public."category_budgets" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."category_budgets" to ledger_server;
create policy "monthly_expense_categories_server" on public."monthly_expense_categories" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."monthly_expense_categories" to ledger_server;
create policy "variable_expense_categories_server" on public."variable_expense_categories" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."variable_expense_categories" to ledger_server;
create policy "annual_expense_categories_server" on public."annual_expense_categories" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."annual_expense_categories" to ledger_server;
create policy "transactions_server" on public."transactions" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."transactions" to ledger_server;
create policy "partners_server" on public."partners" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partners" to ledger_server;
create policy "partner_payments_server" on public."partner_payments" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partner_payments" to ledger_server;
create policy "partner_worker_eligibility_server" on public."partner_worker_eligibility" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partner_worker_eligibility" to ledger_server;
create policy "partner_worker_eligibility_audit_server" on public."partner_worker_eligibility_audit" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."partner_worker_eligibility_audit" to ledger_server;
create policy "partner_mcp_keys_server" on public."partner_mcp_keys" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partner_mcp_keys" to ledger_server;
create policy "partner_mcp_key_hashes_server" on public."partner_mcp_key_hashes" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partner_mcp_key_hashes" to ledger_server;
create policy "partner_mcp_rate_limits_server" on public."partner_mcp_rate_limits" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."partner_mcp_rate_limits" to ledger_server;
create policy "payroll_periods_server" on public."payroll_periods" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."payroll_periods" to ledger_server;
create policy "payroll_runs_server" on public."payroll_runs" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."payroll_runs" to ledger_server;
create policy "payroll_run_items_server" on public."payroll_run_items" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."payroll_run_items" to ledger_server;
create policy "payroll_run_payments_server" on public."payroll_run_payments" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."payroll_run_payments" to ledger_server;
create policy "payroll_payment_locks_server" on public."payroll_payment_locks" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."payroll_payment_locks" to ledger_server;
create policy "advance_month_corrections_server" on public."advance_month_corrections" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."advance_month_corrections" to ledger_server;
create policy "finance_reviews_server" on public."finance_reviews" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."finance_reviews" to ledger_server;
create policy "finance_review_revisions_server" on public."finance_review_revisions" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."finance_review_revisions" to ledger_server;
create policy "finance_workbench_receipts_server" on public."finance_workbench_receipts" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."finance_workbench_receipts" to ledger_server;
create policy "mcp_mutation_receipts_server" on public."mcp_mutation_receipts" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."mcp_mutation_receipts" to ledger_server;
create policy "sweater_raw_payloads_server" on public."sweater_raw_payloads" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."sweater_raw_payloads" to ledger_server;
create policy "sweater_bookings_server" on public."sweater_bookings" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_bookings" to ledger_server;
create policy "sweater_import_runs_server" on public."sweater_import_runs" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_import_runs" to ledger_server;
create policy "sweater_integration_state_server" on public."sweater_integration_state" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_integration_state" to ledger_server;
create policy "sweater_variances_server" on public."sweater_variances" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_variances" to ledger_server;
create policy "sweater_settlements_server" on public."sweater_settlements" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_settlements" to ledger_server;
create policy "sweater_adjustments_server" on public."sweater_adjustments" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_adjustments" to ledger_server;
create policy "sweater_collections_server" on public."sweater_collections" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_collections" to ledger_server;
create policy "sweater_price_list_server" on public."sweater_price_list" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_price_list" to ledger_server;
create policy "sweater_adjustment_types_server" on public."sweater_adjustment_types" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_adjustment_types" to ledger_server;
create policy "sweater_recognition_policy_server" on public."sweater_recognition_policy" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_recognition_policy" to ledger_server;
create policy "sweater_owner_booking_claims_server" on public."sweater_owner_booking_claims" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_owner_booking_claims" to ledger_server;
create policy "sweater_owner_collection_confirmations_server" on public."sweater_owner_collection_confirmations" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_owner_collection_confirmations" to ledger_server;
create policy "sweater_operational_wash_links_server" on public."sweater_operational_wash_links" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_operational_wash_links" to ledger_server;
create policy "sweater_booking_links_server" on public."sweater_booking_links" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_booking_links" to ledger_server;
create policy "sweater_owner_tax_clarifications_server" on public."sweater_owner_tax_clarifications" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_owner_tax_clarifications" to ledger_server;
create policy "sweater_integration_keys_server" on public."sweater_integration_keys" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_integration_keys" to ledger_server;
create policy "sweater_rate_limits_server" on public."sweater_rate_limits" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."sweater_rate_limits" to ledger_server;
create policy "agent_command_agents_server" on public."agent_command_agents" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_agents" to ledger_server;
create policy "agent_command_reports_server" on public."agent_command_reports" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_reports" to ledger_server;
create policy "agent_command_alerts_server" on public."agent_command_alerts" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_alerts" to ledger_server;
create policy "agent_command_approvals_server" on public."agent_command_approvals" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_approvals" to ledger_server;
create policy "agent_command_activity_server" on public."agent_command_activity" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_activity" to ledger_server;
create policy "agent_command_tasks_server" on public."agent_command_tasks" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_tasks" to ledger_server;
create policy "agent_command_sources_server" on public."agent_command_sources" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_sources" to ledger_server;
create policy "agent_command_ingestion_server" on public."agent_command_ingestion" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."agent_command_ingestion" to ledger_server;
create policy "executive_reports_server" on public."executive_reports" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."executive_reports" to ledger_server;
create policy "executive_report_revisions_server" on public."executive_report_revisions" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."executive_report_revisions" to ledger_server;
create policy "finance_reports_server" on public."finance_reports" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."finance_reports" to ledger_server;
create policy "finance_report_revisions_server" on public."finance_report_revisions" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."finance_report_revisions" to ledger_server;
create policy "operations_reports_server" on public."operations_reports" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."operations_reports" to ledger_server;
create policy "operations_report_revisions_server" on public."operations_report_revisions" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."operations_report_revisions" to ledger_server;
create policy "biker_quality_reports_server" on public."biker_quality_reports" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."biker_quality_reports" to ledger_server;
create policy "password_reset_throttle_server" on public."password_reset_throttle" for all to ledger_server using (true) with check (true);
grant select, insert, update, delete on public."password_reset_throttle" to ledger_server;
create policy "journal_entry_lines_server" on public."journal_entry_lines" for all to ledger_server using (true) with check (true);
grant select, insert, update on public."journal_entry_lines" to ledger_server;
grant select on public.firebase_uid_map to ledger_server;
create policy firebase_uid_map_server on public.firebase_uid_map for select to ledger_server using (true);
grant execute on all functions in schema app to ledger_server, authenticated;

