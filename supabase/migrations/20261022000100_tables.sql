-- ═══════════════════════════════════════════════════════════════════════════
-- الجداول — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
--
-- كل جدول = مجموعة Firestore، وكل صف = مستند:
--   id     معرّف المستند كما هو (COLLATE "C": ترتيب البايت كما في Firestore)
--   أعمدة  الحقول المعروفة بأنواعها
--   extra  الحقول غير المعروفة كما هي، فلا يضيع شيء
--   shape  الاستثناءات (null صريح، قيمة أصلية لا يحفظها العمود حرفياً)
-- التواريخ نصوص 'YYYY-MM-DD' بقيد يضمن أنها تواريخ حقيقية: تاريخ عمل محلي
-- (الرياض) لا لحظة، فلا يتحوّل بمنطقة زمنية أبداً.
-- ═══════════════════════════════════════════════════════════════════════════

-- journal_entries
create table public."journal_entries" (
  id text collate "C" not null,
  "entry_date" text collate "C",
  "period_key" text collate "C",
  "source_type" text collate "C",
  "source_kind" text collate "C",
  "source_id" text collate "C",
  "description" text collate "C",
  "status" text collate "C",
  "entry_number" integer,
  "line_count" integer,
  "total_debit" numeric(14,2),
  "total_credit" numeric(14,2),
  "created_by" text collate "C",
  "created_at" timestamptz,
  "posted_at" timestamptz,
  "tax_snapshot" jsonb,
  "purchase_tax_snapshot" jsonb,
  "settlement_entry_id" text collate "C",
  "settlement_of" text collate "C",
  "reversal_of" text collate "C",
  "reverses_entry_id" text collate "C",
  "reversed_source_kind" text collate "C",
  "reversed_source_type" text collate "C",
  "reversed_source_id" text collate "C",
  "reversed_by" text collate "C",
  "reversed_at" timestamptz,
  "reversal_reason" text collate "C",
  "payroll_snapshot" jsonb,
  "document_id" text collate "C",
  "document_number" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "journal_entries_pk" primary key (id),
  constraint "journal_entries_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "journal_entries_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "journal_entries_entry_date_day" check (app.is_day("entry_date")),
  constraint "journal_entries_period_key_month" check (app.is_month("period_key"))
);
create index "journal_entries_entry_date_idx" on public."journal_entries" ("entry_date", id);
create index "journal_entries_period_key_idx" on public."journal_entries" ("period_key", id);
create index "journal_entries_source_type_idx" on public."journal_entries" ("source_type", id);
create index "journal_entries_source_kind_idx" on public."journal_entries" ("source_kind", id);
create index "journal_entries_source_id_idx" on public."journal_entries" ("source_id", id);
create index "journal_entries_status_idx" on public."journal_entries" ("status", id);
create index "journal_entries_reversal_of_idx" on public."journal_entries" ("reversal_of", id);
create index "journal_entries_reverses_entry_id_idx" on public."journal_entries" ("reverses_entry_id", id);
create index "journal_entries_reversed_source_kind_idx" on public."journal_entries" ("reversed_source_kind", id);
create index "journal_entries_reversed_source_type_idx" on public."journal_entries" ("reversed_source_type", id);
-- journal_entries.lines — سطور القيد في جدولها، بترتيبها في المصفوفة
create table public."journal_entry_lines" (
  entry_id text collate "C" not null,
  line_no integer not null,
  account_id text collate "C",
  debit numeric(14,2),
  credit numeric(14,2),
  description text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "journal_entry_lines_pk" primary key (entry_id, line_no),
  constraint "journal_entry_lines_entry_fk" foreign key (entry_id) references public."journal_entries"(id) deferrable initially deferred,
  constraint "journal_entry_lines_line_no" check (line_no >= 0),
  constraint "journal_entry_lines_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "journal_entry_lines_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "journal_entry_lines_account_idx" on public."journal_entry_lines" (account_id, entry_id);

-- journal_lines
create table public."journal_lines_legacy" (
  id text collate "C" not null,
  "entry_id" text collate "C",
  "account_id" text collate "C",
  "debit" numeric(14,2),
  "credit" numeric(14,2),
  "description" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "journal_lines_legacy_pk" primary key (id),
  constraint "journal_lines_legacy_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "journal_lines_legacy_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "journal_lines_legacy_entry_id_idx" on public."journal_lines_legacy" ("entry_id", id);
create index "journal_lines_legacy_account_id_idx" on public."journal_lines_legacy" ("account_id", id);

-- posting_locks
create table public."posting_locks" (
  id text collate "C" not null,
  "kind" text collate "C",
  "source_type" text collate "C",
  "source_id" text collate "C",
  "entry_id" text collate "C",
  "entry_number" integer,
  "settlement_entry_id" text collate "C",
  "locked_by" text collate "C",
  "locked_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "posting_locks_pk" primary key (id),
  constraint "posting_locks_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "posting_locks_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "posting_locks_source_id_idx" on public."posting_locks" ("source_id", id);
create index "posting_locks_entry_id_idx" on public."posting_locks" ("entry_id", id);

-- accounting_periods
create table public."accounting_periods" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "status" text collate "C",
  "closed_at" timestamptz,
  "closed_by" text collate "C",
  "created_at" timestamptz,
  "reopen_reason" text collate "C",
  "reopened_at" timestamptz,
  "reopened_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "accounting_periods_pk" primary key (id),
  constraint "accounting_periods_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "accounting_periods_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "accounting_periods_period_key_month" check (app.is_month("period_key"))
);

-- counters
create table public."counters" (
  id text collate "C" not null,
  "next_number" bigint,
  "earliest_entry_date" text collate "C",
  "type" text collate "C",
  "year" integer,
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "counters_pk" primary key (id),
  constraint "counters_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "counters_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "counters_earliest_entry_date_day" check (app.is_day("earliest_entry_date"))
);

-- chart_of_accounts
create table public."chart_of_accounts" (
  id text collate "C" not null,
  "code" text collate "C",
  "name_arabic" text collate "C",
  "name" text collate "C",
  "account_type" text collate "C",
  "normal_balance" text collate "C",
  "parent_id" text collate "C",
  "contra" boolean,
  "active" boolean,
  "direct_cost" boolean,
  "created_at" timestamptz,
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "chart_of_accounts_pk" primary key (id),
  constraint "chart_of_accounts_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "chart_of_accounts_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- audit_logs
create table public."audit_logs" (
  id text collate "C" not null,
  "action" text collate "C",
  "collection_name" text collate "C",
  "document_id" text collate "C",
  "user_id" text collate "C",
  "note" text collate "C",
  "before" jsonb,
  "after" jsonb,
  "at" timestamptz,
  "at_iso" text collate "C",
  "kind" text collate "C",
  "source_id" text collate "C",
  "reason" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "audit_logs_pk" primary key (id),
  constraint "audit_logs_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "audit_logs_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sales_documents
create table public."sales_documents" (
  id text collate "C" not null,
  "type" text collate "C",
  "status" text collate "C",
  "issue_mode" text collate "C",
  "document_number" text collate "C",
  "sequence" integer,
  "year" integer,
  "issue_date" text collate "C",
  "issue_time" text collate "C",
  "supply_date" text collate "C",
  "net" numeric(14,2),
  "vat" numeric(14,2),
  "gross" numeric(14,2),
  "vat_rate" numeric(9,6),
  "wash_id" text collate "C",
  "journal_entry_id" text collate "C",
  "linked_journal_entry_id" text collate "C",
  "reference_document_id" text collate "C",
  "reference_number" text collate "C",
  "source_type" text collate "C",
  "source_id" text collate "C",
  "created_at" timestamptz,
  "issued_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sales_documents_pk" primary key (id),
  constraint "sales_documents_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sales_documents_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sales_documents_issue_date_day" check (app.is_day("issue_date")),
  constraint "sales_documents_supply_date_day" check (app.is_day("supply_date")),
  constraint "sales_documents_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1)
);
create index "sales_documents_document_number_idx" on public."sales_documents" ("document_number", id);
create index "sales_documents_wash_id_idx" on public."sales_documents" ("wash_id", id);
create index "sales_documents_journal_entry_id_idx" on public."sales_documents" ("journal_entry_id", id);
create index "sales_documents_linked_journal_entry_id_idx" on public."sales_documents" ("linked_journal_entry_id", id);
create index "sales_documents_reference_document_id_idx" on public."sales_documents" ("reference_document_id", id);
create index "sales_documents_reference_number_idx" on public."sales_documents" ("reference_number", id);
create index "sales_documents_source_id_idx" on public."sales_documents" ("source_id", id);

-- sales_document_sources
create table public."sales_document_sources" (
  id text collate "C" not null,
  "source_type" text collate "C",
  "source_id" text collate "C",
  "document_id" text collate "C",
  "document_number" text collate "C",
  "status" text collate "C",
  "at" timestamptz,
  "released_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sales_document_sources_pk" primary key (id),
  constraint "sales_document_sources_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sales_document_sources_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- app_settings
create table public."app_settings" (
  id text collate "C" not null,
  "value" jsonb,
  "updated_by" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "app_settings_pk" primary key (id),
  constraint "app_settings_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "app_settings_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- users
create table public."members" (
  id text collate "C" not null,
  "email" text collate "C",
  "role" text collate "C",
  "display_name" text collate "C",
  "created_at" timestamptz,
  "bootstrapped_at" timestamptz,
  "bootstrapped_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "members_pk" primary key (id),
  constraint "members_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "members_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "members_email_idx" on public."members" ("email", id);

-- app_admins
create table public."app_admins" (
  id text collate "C" not null,
  "email" text collate "C",
  "bootstrapped_at" timestamptz,
  "note" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "app_admins_pk" primary key (id),
  constraint "app_admins_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "app_admins_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- washes
create table public."washes" (
  id text collate "C" not null,
  "biker_name" text collate "C",
  "biker_id" text collate "C",
  "quantity" integer,
  "price" numeric(14,2),
  "status" text collate "C",
  "wash_date" text collate "C",
  "payment_method" text collate "C",
  "revenue_origin" text collate "C",
  "ssp_booking_id" text collate "C",
  "created_at" timestamptz,
  "driver_external_id" text collate "C",
  "price_basis" text collate "C",
  "price_mode" text collate "C",
  "net_amount" numeric(14,2),
  "vat_amount" numeric(14,2),
  "gross_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "owner_tax_snapshot" jsonb,
  "collection_status" text collate "C",
  "worker_commission_per_wash" numeric(14,2),
  "worker_commission_payment_timing" text collate "C",
  "worker_commission_paid" boolean,
  "import_run_id" text collate "C",
  "created_by" text collate "C",
  "ssp_booking_number" text collate "C",
  "ssp_raw_status" text collate "C",
  "notes" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "washes_pk" primary key (id),
  constraint "washes_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "washes_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "washes_wash_date_day" check (app.is_day("wash_date")),
  constraint "washes_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1)
);
create index "washes_biker_id_idx" on public."washes" ("biker_id", id);
create index "washes_status_idx" on public."washes" ("status", id);
create index "washes_wash_date_idx" on public."washes" ("wash_date", id);
create index "washes_ssp_booking_id_idx" on public."washes" ("ssp_booking_id", id);
create index "washes_driver_external_id_idx" on public."washes" ("driver_external_id", id);

-- bikers
create table public."bikers" (
  id text collate "C" not null,
  "name" text collate "C",
  "name_ar" text collate "C",
  "name_en" text collate "C",
  "driver_external_id" text collate "C",
  "contact_number" text collate "C",
  "residence" text collate "C",
  "sponsor" text collate "C",
  "nationality" text collate "C",
  "current_status" text collate "C",
  "salary" numeric(14,2),
  "start_date" text collate "C",
  "end_date" text collate "C",
  "iqama_number" text collate "C",
  "iqama_expiry" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "bikers_pk" primary key (id),
  constraint "bikers_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "bikers_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "bikers_start_date_day" check (app.is_day("start_date")),
  constraint "bikers_end_date_day" check (app.is_day("end_date")),
  constraint "bikers_iqama_expiry_day" check (app.is_day("iqama_expiry"))
);
create index "bikers_driver_external_id_idx" on public."bikers" ("driver_external_id", id);

-- housing_units
create table public."housing_units" (
  id text collate "C" not null,
  "name" text collate "C",
  "capacity" integer,
  "notes" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "housing_units_pk" primary key (id),
  constraint "housing_units_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "housing_units_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- temporary_expenses
create table public."temporary_expenses" (
  id text collate "C" not null,
  "title" text collate "C",
  "amount" numeric(14,2),
  "spent_date" text collate "C",
  "assignment_month" text collate "C",
  "status" text collate "C",
  "recovered_date" text collate "C",
  "notes" text collate "C",
  "biker_id" text collate "C",
  "payment_method" text collate "C",
  "recovery_method" text collate "C",
  "recovered_amount" numeric(14,2),
  "payroll_lock_id" text collate "C",
  "payroll_recovered_at" timestamptz,
  "payroll_reconciled_at" timestamptz,
  "payroll_reconciliation" jsonb,
  "created_at" timestamptz,
  "created_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "temporary_expenses_pk" primary key (id),
  constraint "temporary_expenses_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "temporary_expenses_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "temporary_expenses_spent_date_day" check (app.is_day("spent_date")),
  constraint "temporary_expenses_assignment_month_month" check (app.is_month("assignment_month")),
  constraint "temporary_expenses_recovered_date_day" check (app.is_day("recovered_date"))
);
create index "temporary_expenses_status_idx" on public."temporary_expenses" ("status", id);
create index "temporary_expenses_biker_id_idx" on public."temporary_expenses" ("biker_id", id);

-- monthly_expenses
create table public."monthly_expenses" (
  id text collate "C" not null,
  "expense_name" text collate "C",
  "category_id" text collate "C",
  "quantity" numeric,
  "unit_cost" numeric,
  "total_monthly_cost" numeric(14,2),
  "payment_day" integer,
  "payment_status" text collate "C",
  "recurrence" text collate "C",
  "logged_date" text collate "C",
  "spent_date" text collate "C",
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "supplier" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_method" text collate "C",
  "paid_date" text collate "C",
  "start_period" text collate "C",
  "end_period" text collate "C",
  "active" boolean,
  "biker_id" text collate "C",
  "payroll_period" text collate "C",
  "salary_month" text collate "C",
  "payroll_snapshot" jsonb,
  "approval_status" text collate "C",
  "finance_metadata" jsonb,
  "finance_revision" integer,
  "finance_workflow_version" integer,
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "monthly_expenses_pk" primary key (id),
  constraint "monthly_expenses_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "monthly_expenses_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "monthly_expenses_logged_date_day" check (app.is_day("logged_date")),
  constraint "monthly_expenses_spent_date_day" check (app.is_day("spent_date")),
  constraint "monthly_expenses_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "monthly_expenses_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1),
  constraint "monthly_expenses_paid_date_day" check (app.is_day("paid_date")),
  constraint "monthly_expenses_start_period_month" check (app.is_month("start_period")),
  constraint "monthly_expenses_end_period_month" check (app.is_month("end_period")),
  constraint "monthly_expenses_salary_month_month" check (app.is_month("salary_month"))
);
create index "monthly_expenses_logged_date_idx" on public."monthly_expenses" ("logged_date", id);
create index "monthly_expenses_is_tax_invoice_idx" on public."monthly_expenses" ("is_tax_invoice", id);
create index "monthly_expenses_invoice_date_idx" on public."monthly_expenses" ("invoice_date", id);

-- variable_expenses
create table public."variable_expenses" (
  id text collate "C" not null,
  "expense_name" text collate "C",
  "category_id" text collate "C",
  "quantity" numeric,
  "unit_cost" numeric,
  "total_variable_cost" numeric(14,2),
  "payment_status" text collate "C",
  "logged_date" text collate "C",
  "spent_date" text collate "C",
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "supplier" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_method" text collate "C",
  "paid_date" text collate "C",
  "approval_status" text collate "C",
  "finance_metadata" jsonb,
  "finance_revision" integer,
  "finance_workflow_version" integer,
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "variable_expenses_pk" primary key (id),
  constraint "variable_expenses_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "variable_expenses_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "variable_expenses_logged_date_day" check (app.is_day("logged_date")),
  constraint "variable_expenses_spent_date_day" check (app.is_day("spent_date")),
  constraint "variable_expenses_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "variable_expenses_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1),
  constraint "variable_expenses_paid_date_day" check (app.is_day("paid_date"))
);
create index "variable_expenses_logged_date_idx" on public."variable_expenses" ("logged_date", id);
create index "variable_expenses_spent_date_idx" on public."variable_expenses" ("spent_date", id);
create index "variable_expenses_is_tax_invoice_idx" on public."variable_expenses" ("is_tax_invoice", id);
create index "variable_expenses_invoice_date_idx" on public."variable_expenses" ("invoice_date", id);

-- annual_expenses
create table public."annual_expenses" (
  id text collate "C" not null,
  "expense_name" text collate "C",
  "category" text collate "C",
  "quantity" numeric,
  "annual_cost" numeric(14,2),
  "actual_amount" numeric(14,2),
  "units" jsonb,
  "payment_month" integer,
  "payment_day" integer,
  "payment_status" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "annual_expenses_pk" primary key (id),
  constraint "annual_expenses_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "annual_expenses_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- annual_expense_entries
create table public."annual_expense_entries" (
  id text collate "C" not null,
  "annual_expense_id" text collate "C",
  "description" text collate "C",
  "amount" numeric(14,2),
  "spent_date" text collate "C",
  "logged_date" text collate "C",
  "unit" text collate "C",
  "notes" text collate "C",
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "supplier" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_method" text collate "C",
  "paid_date" text collate "C",
  "approval_status" text collate "C",
  "finance_metadata" jsonb,
  "finance_revision" integer,
  "finance_workflow_version" integer,
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "annual_expense_entries_pk" primary key (id),
  constraint "annual_expense_entries_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "annual_expense_entries_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "annual_expense_entries_spent_date_day" check (app.is_day("spent_date")),
  constraint "annual_expense_entries_logged_date_day" check (app.is_day("logged_date")),
  constraint "annual_expense_entries_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "annual_expense_entries_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1),
  constraint "annual_expense_entries_paid_date_day" check (app.is_day("paid_date"))
);
create index "annual_expense_entries_annual_expense_id_idx" on public."annual_expense_entries" ("annual_expense_id", id);
create index "annual_expense_entries_spent_date_idx" on public."annual_expense_entries" ("spent_date", id);
create index "annual_expense_entries_logged_date_idx" on public."annual_expense_entries" ("logged_date", id);
create index "annual_expense_entries_is_tax_invoice_idx" on public."annual_expense_entries" ("is_tax_invoice", id);
create index "annual_expense_entries_invoice_date_idx" on public."annual_expense_entries" ("invoice_date", id);

-- startup_costs
create table public."startup_costs" (
  id text collate "C" not null,
  "category" text collate "C",
  "item_name" text collate "C",
  "quantity" numeric,
  "budgeted_amount" numeric(14,2),
  "units" jsonb,
  "actual_amount" numeric(14,2),
  "status" text collate "C",
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "supplier" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_method" text collate "C",
  "converted_at" timestamptz,
  "converted_by" text collate "C",
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "startup_costs_pk" primary key (id),
  constraint "startup_costs_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "startup_costs_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "startup_costs_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "startup_costs_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1)
);
create index "startup_costs_is_tax_invoice_idx" on public."startup_costs" ("is_tax_invoice", id);
create index "startup_costs_invoice_date_idx" on public."startup_costs" ("invoice_date", id);

-- startup_cost_entries
create table public."startup_cost_entries" (
  id text collate "C" not null,
  "startup_cost_id" text collate "C",
  "description" text collate "C",
  "amount" numeric(14,2),
  "spent_date" text collate "C",
  "notes" text collate "C",
  "unit" text collate "C",
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "supplier" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_method" text collate "C",
  "paid_date" text collate "C",
  "created_at" timestamptz,
  "created_by" text collate "C",
  "converted_from_parent" boolean,
  "approval_status" text collate "C",
  "finance_metadata" jsonb,
  "finance_revision" integer,
  "finance_workflow_version" integer,
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "startup_cost_entries_pk" primary key (id),
  constraint "startup_cost_entries_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "startup_cost_entries_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "startup_cost_entries_spent_date_day" check (app.is_day("spent_date")),
  constraint "startup_cost_entries_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "startup_cost_entries_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1),
  constraint "startup_cost_entries_paid_date_day" check (app.is_day("paid_date"))
);
create index "startup_cost_entries_startup_cost_id_idx" on public."startup_cost_entries" ("startup_cost_id", id);
create index "startup_cost_entries_spent_date_idx" on public."startup_cost_entries" ("spent_date", id);
create index "startup_cost_entries_is_tax_invoice_idx" on public."startup_cost_entries" ("is_tax_invoice", id);
create index "startup_cost_entries_invoice_date_idx" on public."startup_cost_entries" ("invoice_date", id);

-- expense_vouchers
create table public."expense_vouchers" (
  id text collate "C" not null,
  "template_id" text collate "C",
  "template_name" text collate "C",
  "category_id" text collate "C",
  "period_key" text collate "C",
  "due_date" text collate "C",
  "quantity" numeric,
  "unit_cost" numeric,
  "amount" numeric(14,2),
  "is_tax_invoice" boolean,
  "invoice_url" text collate "C",
  "supplier" text collate "C",
  "invoice_number" text collate "C",
  "invoice_date" text collate "C",
  "vat_amount" numeric(14,2),
  "vat_rate" numeric(9,6),
  "price_mode" text collate "C",
  "vat_deductible" boolean,
  "payment_status" text collate "C",
  "paid_date" text collate "C",
  "status" text collate "C",
  "generated_by" text collate "C",
  "generated_at" timestamptz,
  "generated_at_iso" text collate "C",
  "updated_by" text collate "C",
  "updated_at" timestamptz,
  "cancel_reason" text collate "C",
  "cancelled_by" text collate "C",
  "cancelled_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "expense_vouchers_pk" primary key (id),
  constraint "expense_vouchers_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "expense_vouchers_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "expense_vouchers_period_key_month" check (app.is_month("period_key")),
  constraint "expense_vouchers_due_date_day" check (app.is_day("due_date")),
  constraint "expense_vouchers_invoice_date_day" check (app.is_day("invoice_date")),
  constraint "expense_vouchers_vat_rate_rate" check ("vat_rate" is null or "vat_rate" between 0 and 1),
  constraint "expense_vouchers_paid_date_day" check (app.is_day("paid_date"))
);
create index "expense_vouchers_template_id_idx" on public."expense_vouchers" ("template_id", id);
create index "expense_vouchers_period_key_idx" on public."expense_vouchers" ("period_key", id);
create index "expense_vouchers_due_date_idx" on public."expense_vouchers" ("due_date", id);
create index "expense_vouchers_invoice_date_idx" on public."expense_vouchers" ("invoice_date", id);
create index "expense_vouchers_payment_status_idx" on public."expense_vouchers" ("payment_status", id);
create index "expense_vouchers_status_idx" on public."expense_vouchers" ("status", id);

-- fixed_assets
create table public."fixed_assets" (
  id text collate "C" not null,
  "name" text collate "C",
  "cost" numeric(14,2),
  "salvage_value" numeric(14,2),
  "useful_life_months" integer,
  "in_service_date" text collate "C",
  "method" text collate "C",
  "asset_account" text collate "C",
  "accumulated_account" text collate "C",
  "expense_account" text collate "C",
  "active" boolean,
  "disposal_date" text collate "C",
  "disposal_proceeds" numeric(14,2),
  "disposal_entry_id" text collate "C",
  "source_type" text collate "C",
  "source_id" text collate "C",
  "created_by" text collate "C",
  "created_at" timestamptz,
  "created_at_iso" text collate "C",
  "updated_by" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fixed_assets_pk" primary key (id),
  constraint "fixed_assets_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fixed_assets_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fixed_assets_in_service_date_day" check (app.is_day("in_service_date")),
  constraint "fixed_assets_disposal_date_day" check (app.is_day("disposal_date"))
);

-- fee_rules
create table public."fee_rules" (
  id text collate "C" not null,
  "key" text collate "C",
  "label" text collate "C",
  "basis" text collate "C",
  "rate" numeric(9,6),
  "effective_from" text collate "C",
  "active" boolean,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "fee_rules_pk" primary key (id),
  constraint "fee_rules_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "fee_rules_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "fee_rules_rate_rate" check ("rate" is null or "rate" between 0 and 1),
  constraint "fee_rules_effective_from_day" check (app.is_day("effective_from"))
);

-- categories
create table public."categories" (
  id text collate "C" not null,
  "label" text collate "C",
  "sort_order" integer,
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "categories_pk" primary key (id),
  constraint "categories_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "categories_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- category_budgets
create table public."category_budgets" (
  id text collate "C" not null,
  "category_label" text collate "C",
  "budget_type" text collate "C",
  "amount" numeric(14,2),
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "category_budgets_pk" primary key (id),
  constraint "category_budgets_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "category_budgets_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- monthly_expense_categories
create table public."monthly_expense_categories" (
  id text collate "C" not null,
  "label" text collate "C",
  "sort_order" integer,
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "monthly_expense_categories_pk" primary key (id),
  constraint "monthly_expense_categories_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "monthly_expense_categories_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- variable_expense_categories
create table public."variable_expense_categories" (
  id text collate "C" not null,
  "label" text collate "C",
  "sort_order" integer,
  "created_at" timestamptz,
  "is_dynamic" boolean,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "variable_expense_categories_pk" primary key (id),
  constraint "variable_expense_categories_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "variable_expense_categories_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- annual_expense_categories
create table public."annual_expense_categories" (
  id text collate "C" not null,
  "label" text collate "C",
  "sort_order" integer,
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "annual_expense_categories_pk" primary key (id),
  constraint "annual_expense_categories_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "annual_expense_categories_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- transactions
create table public."transactions" (
  id text collate "C" not null,
  "occurred_on" text collate "C",
  "description" text collate "C",
  "type" text collate "C",
  "amount" numeric(14,2),
  "vehicle_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "transactions_pk" primary key (id),
  constraint "transactions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "transactions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "transactions_occurred_on_day" check (app.is_day("occurred_on"))
);

-- partners
create table public."partners" (
  id text collate "C" not null,
  "partner_name" text collate "C",
  "workers_count" integer,
  "paid_amount" numeric(14,2),
  "contact_number" text collate "C",
  "status" text collate "C",
  "user_id" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partners_pk" primary key (id),
  constraint "partners_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partners_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "partners_partner_name_idx" on public."partners" ("partner_name", id);
create index "partners_user_id_idx" on public."partners" ("user_id", id);

-- partner_payments
create table public."partner_payments" (
  id text collate "C" not null,
  "partner_id" text collate "C",
  "amount" numeric(14,2),
  "payment_date" text collate "C",
  "payment_method" text collate "C",
  "notes" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_payments_pk" primary key (id),
  constraint "partner_payments_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_payments_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "partner_payments_payment_date_day" check (app.is_day("payment_date"))
);
create index "partner_payments_partner_id_idx" on public."partner_payments" ("partner_id", id);
create index "partner_payments_payment_date_idx" on public."partner_payments" ("payment_date", id);

-- partner_worker_eligibility
create table public."partner_worker_eligibility" (
  id text collate "C" not null,
  "revision" integer,
  "changes" jsonb,
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_worker_eligibility_pk" primary key (id),
  constraint "partner_worker_eligibility_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_worker_eligibility_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- partner_worker_eligibility/*/audit
create table public."partner_worker_eligibility_audit" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "period_key" text collate "C",
  "revision" integer,
  "actor_uid" text collate "C",
  "created_at" timestamptz,
  "reason" text collate "C",
  "before" jsonb,
  "after" jsonb,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_worker_eligibility_audit_pk" primary key (parent_id, id),
  constraint "partner_worker_eligibility_audit_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_worker_eligibility_audit_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "partner_worker_eligibility_audit_period_key_month" check (app.is_month("period_key"))
);
alter table public."partner_worker_eligibility_audit" add constraint "partner_worker_eligibility_audit_parent_fk" foreign key (parent_id) references public."partner_worker_eligibility"(id) deferrable initially deferred;

-- partner_mcp_keys
create table public."partner_mcp_keys" (
  id text collate "C" not null,
  "key_id" text collate "C",
  "partner_id" text collate "C",
  "owner_uid" text collate "C",
  "status" text collate "C",
  "label" text collate "C",
  "created_at" timestamptz,
  "created_at_iso" text collate "C",
  "created_by" text collate "C",
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_mcp_keys_pk" primary key (id),
  constraint "partner_mcp_keys_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_mcp_keys_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "partner_mcp_keys_partner_id_idx" on public."partner_mcp_keys" ("partner_id", id);
create index "partner_mcp_keys_owner_uid_idx" on public."partner_mcp_keys" ("owner_uid", id);

-- partner_mcp_key_hashes
create table public."partner_mcp_key_hashes" (
  id text collate "C" not null,
  "key_id" text collate "C",
  "partner_id" text collate "C",
  "owner_uid" text collate "C",
  "created_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_mcp_key_hashes_pk" primary key (id),
  constraint "partner_mcp_key_hashes_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_mcp_key_hashes_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- partner_mcp_rate_limits
create table public."partner_mcp_rate_limits" (
  id text collate "C" not null,
  "key_id" text collate "C",
  "count" integer,
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "partner_mcp_rate_limits_pk" primary key (id),
  constraint "partner_mcp_rate_limits_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "partner_mcp_rate_limits_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- payroll_periods
create table public."payroll_periods" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "revision" integer,
  "current_run_id" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "payroll_periods_pk" primary key (id),
  constraint "payroll_periods_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "payroll_periods_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "payroll_periods_period_key_month" check (app.is_month("period_key"))
);

-- payroll_runs
create table public."payroll_runs" (
  id text collate "C" not null,
  "run_id" text collate "C",
  "revision" integer,
  "period_key" text collate "C",
  "period_start" text collate "C",
  "period_end" text collate "C",
  "distribution_date" text collate "C",
  "status" text collate "C",
  "estimated" boolean,
  "line_count" integer,
  "totals" jsonb,
  "journal_entry_id" text collate "C",
  "journal_entry_number" integer,
  "reversal_entry_id" text collate "C",
  "pay_date" text collate "C",
  "payment_method" text collate "C",
  "created_at" timestamptz,
  "created_by" text collate "C",
  "updated_at" timestamptz,
  "updated_by" text collate "C",
  "approved_at" timestamptz,
  "approved_by" text collate "C",
  "paid_at" timestamptz,
  "paid_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "payroll_runs_pk" primary key (id),
  constraint "payroll_runs_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "payroll_runs_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "payroll_runs_period_key_month" check (app.is_month("period_key")),
  constraint "payroll_runs_period_start_day" check (app.is_day("period_start")),
  constraint "payroll_runs_period_end_day" check (app.is_day("period_end")),
  constraint "payroll_runs_distribution_date_day" check (app.is_day("distribution_date")),
  constraint "payroll_runs_pay_date_day" check (app.is_day("pay_date"))
);
create index "payroll_runs_period_key_idx" on public."payroll_runs" ("period_key", id);
create index "payroll_runs_status_idx" on public."payroll_runs" ("status", id);

-- payroll_runs/*/items
create table public."payroll_run_items" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "biker_id" text collate "C",
  "name" text collate "C",
  "monthly_salary" numeric(14,2),
  "basic_due" numeric(14,2),
  "commission" numeric(14,2),
  "bonus" numeric(14,2),
  "deduction" numeric(14,2),
  "advance_deduction" numeric(14,2),
  "net_due" numeric(14,2),
  "status" text collate "C",
  "run_id" text collate "C",
  "period_key" text collate "C",
  "revision" integer,
  "journal_entry_id" text collate "C",
  "paid_at" timestamptz,
  "paid_by" text collate "C",
  "pay_date" text collate "C",
  "payment_method" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "payroll_run_items_pk" primary key (parent_id, id),
  constraint "payroll_run_items_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "payroll_run_items_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "payroll_run_items_period_key_month" check (app.is_month("period_key")),
  constraint "payroll_run_items_pay_date_day" check (app.is_day("pay_date"))
);
alter table public."payroll_run_items" add constraint "payroll_run_items_parent_fk" foreign key (parent_id) references public."payroll_runs"(id) deferrable initially deferred;
create index "payroll_run_items_biker_id_idx" on public."payroll_run_items" ("biker_id", id);

-- payroll_runs/*/payments
create table public."payroll_run_payments" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "preview_hash" text collate "C",
  "created_by" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "payroll_run_payments_pk" primary key (parent_id, id),
  constraint "payroll_run_payments_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "payroll_run_payments_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
alter table public."payroll_run_payments" add constraint "payroll_run_payments_parent_fk" foreign key (parent_id) references public."payroll_runs"(id) deferrable initially deferred;

-- payroll_payment_locks
create table public."payroll_payment_locks" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "biker_id" text collate "C",
  "run_id" text collate "C",
  "journal_entry_id" text collate "C",
  "entry_number" integer,
  "locked_at" timestamptz,
  "locked_by" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "payroll_payment_locks_pk" primary key (id),
  constraint "payroll_payment_locks_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "payroll_payment_locks_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "payroll_payment_locks_period_key_month" check (app.is_month("period_key"))
);

-- advance_month_corrections
create table public."advance_month_corrections" (
  id text collate "C" not null,
  "actor" text collate "C",
  "recorded_at" timestamptz,
  "recorded_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "advance_month_corrections_pk" primary key (id),
  constraint "advance_month_corrections_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "advance_month_corrections_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- finance_reviews
create table public."finance_reviews" (
  id text collate "C" not null,
  "kind" text collate "C",
  "source_id" text collate "C",
  "source_hash" text collate "C",
  "status" text collate "C",
  "posting_hash" text collate "C",
  "reviewed_by_uid" text collate "C",
  "reviewed_at" timestamptz,
  "reason" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "finance_reviews_pk" primary key (id),
  constraint "finance_reviews_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "finance_reviews_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "finance_reviews_source_id_idx" on public."finance_reviews" ("source_id", id);

-- finance_reviews/*/revisions
create table public."finance_review_revisions" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "revision" integer,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "finance_review_revisions_pk" primary key (parent_id, id),
  constraint "finance_review_revisions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "finance_review_revisions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
alter table public."finance_review_revisions" add constraint "finance_review_revisions_parent_fk" foreign key (parent_id) references public."finance_reviews"(id) deferrable initially deferred;

-- finance_workbench_receipts
create table public."finance_workbench_receipts" (
  id text collate "C" not null,
  "request_hash" text collate "C",
  "user_id" text collate "C",
  "at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "finance_workbench_receipts_pk" primary key (id),
  constraint "finance_workbench_receipts_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "finance_workbench_receipts_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- mcp_mutation_receipts
create table public."mcp_mutation_receipts" (
  id text collate "C" not null,
  "request_hash" text collate "C",
  "user_id" text collate "C",
  "at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "mcp_mutation_receipts_pk" primary key (id),
  constraint "mcp_mutation_receipts_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "mcp_mutation_receipts_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_raw_payloads
create table public."sweater_raw_payloads" (
  id text collate "C" not null,
  "import_run_id" text collate "C",
  "ssp_booking_id" text collate "C",
  "source_hash" text collate "C",
  "schema_version" integer,
  "processing_status" text collate "C",
  "fetched_at" timestamptz,
  "fetched_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_raw_payloads_pk" primary key (id),
  constraint "sweater_raw_payloads_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_raw_payloads_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "sweater_raw_payloads_import_run_id_idx" on public."sweater_raw_payloads" ("import_run_id", id);
create index "sweater_raw_payloads_ssp_booking_id_idx" on public."sweater_raw_payloads" ("ssp_booking_id", id);

-- sweater_bookings
create table public."sweater_bookings" (
  id text collate "C" not null,
  "ssp_booking_id" text collate "C",
  "service_date" text collate "C",
  "period_key" text collate "C",
  "normalized_status" text collate "C",
  "processing_status" text collate "C",
  "posted_entry_id" text collate "C",
  "posted_at" timestamptz,
  "settlement_id" text collate "C",
  "source_hash" text collate "C",
  "schema_version" integer,
  "source" text collate "C",
  "last_import_run_id" text collate "C",
  "review_reason_code" text collate "C",
  "recognition_eligibility" text collate "C",
  "recognition_reason" text collate "C",
  "booking_number" text collate "C",
  "operational_worker_id" text collate "C",
  "record" jsonb,
  "updated_at" timestamptz,
  "updated_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_bookings_pk" primary key (id),
  constraint "sweater_bookings_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_bookings_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_bookings_service_date_day" check (app.is_day("service_date")),
  constraint "sweater_bookings_period_key_month" check (app.is_month("period_key"))
);
create index "sweater_bookings_ssp_booking_id_idx" on public."sweater_bookings" ("ssp_booking_id", id);
create index "sweater_bookings_service_date_idx" on public."sweater_bookings" ("service_date", id);
create index "sweater_bookings_period_key_idx" on public."sweater_bookings" ("period_key", id);
create index "sweater_bookings_normalized_status_idx" on public."sweater_bookings" ("normalized_status", id);
create index "sweater_bookings_processing_status_idx" on public."sweater_bookings" ("processing_status", id);
create index "sweater_bookings_posted_entry_id_idx" on public."sweater_bookings" ("posted_entry_id", id);
create index "sweater_bookings_booking_number_idx" on public."sweater_bookings" ("booking_number", id);
create index "sweater_bookings_operational_worker_id_idx" on public."sweater_bookings" ("operational_worker_id", id);

-- sweater_import_runs
create table public."sweater_import_runs" (
  id text collate "C" not null,
  "status" text collate "C",
  "source" text collate "C",
  "actor" text collate "C",
  "record_count" integer,
  "started_at" timestamptz,
  "started_at_iso" text collate "C",
  "finished_at" timestamptz,
  "finished_at_iso" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_import_runs_pk" primary key (id),
  constraint "sweater_import_runs_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_import_runs_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_integration_state
create table public."sweater_integration_state" (
  id text collate "C" not null,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_integration_state_pk" primary key (id),
  constraint "sweater_integration_state_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_integration_state_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_variances
create table public."sweater_variances" (
  id text collate "C" not null,
  "kind" text collate "C",
  "ssp_booking_id" text collate "C",
  "period_key" text collate "C",
  "resolution" text collate "C",
  "difference" numeric(14,2),
  "detected_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_variances_pk" primary key (id),
  constraint "sweater_variances_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_variances_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_variances_period_key_month" check (app.is_month("period_key"))
);
create index "sweater_variances_ssp_booking_id_idx" on public."sweater_variances" ("ssp_booking_id", id);
create index "sweater_variances_period_key_idx" on public."sweater_variances" ("period_key", id);
create index "sweater_variances_resolution_idx" on public."sweater_variances" ("resolution", id);

-- sweater_settlements
create table public."sweater_settlements" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "status" text collate "C",
  "journal_entry_id" text collate "C",
  "invoice_document_id" text collate "C",
  "figures" jsonb,
  "collected_total" numeric(14,2),
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_settlements_pk" primary key (id),
  constraint "sweater_settlements_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_settlements_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_settlements_period_key_month" check (app.is_month("period_key"))
);

-- sweater_adjustments
create table public."sweater_adjustments" (
  id text collate "C" not null,
  "type_key" text collate "C",
  "kind" text collate "C",
  "amount" numeric(14,2),
  "effective_date" text collate "C",
  "period_key" text collate "C",
  "approval_status" text collate "C",
  "journal_entry_id" text collate "C",
  "ssp_booking_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_adjustments_pk" primary key (id),
  constraint "sweater_adjustments_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_adjustments_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_adjustments_effective_date_day" check (app.is_day("effective_date")),
  constraint "sweater_adjustments_period_key_month" check (app.is_month("period_key"))
);
create index "sweater_adjustments_period_key_idx" on public."sweater_adjustments" ("period_key", id);

-- sweater_collections
create table public."sweater_collections" (
  id text collate "C" not null,
  "period_key" text collate "C",
  "amount" numeric(14,2),
  "received_date" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_collections_pk" primary key (id),
  constraint "sweater_collections_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_collections_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_collections_period_key_month" check (app.is_month("period_key")),
  constraint "sweater_collections_received_date_day" check (app.is_day("received_date"))
);
create index "sweater_collections_period_key_idx" on public."sweater_collections" ("period_key", id);

-- sweater_price_list
create table public."sweater_price_list" (
  id text collate "C" not null,
  "key" text collate "C",
  "service_type" text collate "C",
  "effective_from" text collate "C",
  "effective_to" text collate "C",
  "status" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_price_list_pk" primary key (id),
  constraint "sweater_price_list_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_price_list_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_price_list_effective_from_day" check (app.is_day("effective_from")),
  constraint "sweater_price_list_effective_to_day" check (app.is_day("effective_to"))
);

-- sweater_adjustment_types
create table public."sweater_adjustment_types" (
  id text collate "C" not null,
  "key" text collate "C",
  "effective_from" text collate "C",
  "effective_to" text collate "C",
  "status" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_adjustment_types_pk" primary key (id),
  constraint "sweater_adjustment_types_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_adjustment_types_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_adjustment_types_effective_from_day" check (app.is_day("effective_from")),
  constraint "sweater_adjustment_types_effective_to_day" check (app.is_day("effective_to"))
);

-- sweater_recognition_policy
create table public."sweater_recognition_policy" (
  id text collate "C" not null,
  "key" text collate "C",
  "effective_from" text collate "C",
  "effective_to" text collate "C",
  "status" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_recognition_policy_pk" primary key (id),
  constraint "sweater_recognition_policy_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_recognition_policy_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "sweater_recognition_policy_effective_from_day" check (app.is_day("effective_from")),
  constraint "sweater_recognition_policy_effective_to_day" check (app.is_day("effective_to"))
);

-- sweater_owner_booking_claims
create table public."sweater_owner_booking_claims" (
  id text collate "C" not null,
  "booking_number" text collate "C",
  "ssp_booking_id" text collate "C",
  "wash_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_owner_booking_claims_pk" primary key (id),
  constraint "sweater_owner_booking_claims_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_owner_booking_claims_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_owner_collection_confirmations
create table public."sweater_owner_collection_confirmations" (
  id text collate "C" not null,
  "ssp_booking_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_owner_collection_confirmations_pk" primary key (id),
  constraint "sweater_owner_collection_confirmations_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_owner_collection_confirmations_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_operational_wash_links
create table public."sweater_operational_wash_links" (
  id text collate "C" not null,
  "wash_id" text collate "C",
  "ssp_booking_id" text collate "C",
  "side" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_operational_wash_links_pk" primary key (id),
  constraint "sweater_operational_wash_links_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_operational_wash_links_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "sweater_operational_wash_links_wash_id_idx" on public."sweater_operational_wash_links" ("wash_id", id);
create index "sweater_operational_wash_links_ssp_booking_id_idx" on public."sweater_operational_wash_links" ("ssp_booking_id", id);
create index "sweater_operational_wash_links_side_idx" on public."sweater_operational_wash_links" ("side", id);

-- sweater_booking_links
create table public."sweater_booking_links" (
  id text collate "C" not null,
  "wash_id" text collate "C",
  "ssp_booking_id" text collate "C",
  "side" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_booking_links_pk" primary key (id),
  constraint "sweater_booking_links_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_booking_links_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "sweater_booking_links_wash_id_idx" on public."sweater_booking_links" ("wash_id", id);
create index "sweater_booking_links_ssp_booking_id_idx" on public."sweater_booking_links" ("ssp_booking_id", id);
create index "sweater_booking_links_side_idx" on public."sweater_booking_links" ("side", id);

-- sweater_owner_tax_clarifications
create table public."sweater_owner_tax_clarifications" (
  id text collate "C" not null,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_owner_tax_clarifications_pk" primary key (id),
  constraint "sweater_owner_tax_clarifications_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_owner_tax_clarifications_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_integration_keys
create table public."sweater_integration_keys" (
  id text collate "C" not null,
  "key_id" text collate "C",
  "status" text collate "C",
  "scope" text collate "C",
  "principal" text collate "C",
  "created_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_integration_keys_pk" primary key (id),
  constraint "sweater_integration_keys_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_integration_keys_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- sweater_rate_limits
create table public."sweater_rate_limits" (
  id text collate "C" not null,
  "key_id" text collate "C",
  "count" integer,
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "sweater_rate_limits_pk" primary key (id),
  constraint "sweater_rate_limits_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "sweater_rate_limits_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- agent_command_agents
create table public."agent_command_agents" (
  id text collate "C" not null,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_agents_pk" primary key (id),
  constraint "agent_command_agents_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_agents_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- agent_command_reports
create table public."agent_command_reports" (
  id text collate "C" not null,
  "reported_at" timestamptz,
  "report_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_reports_pk" primary key (id),
  constraint "agent_command_reports_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_reports_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_reports_reported_at_idx" on public."agent_command_reports" ("reported_at", id);
create index "agent_command_reports_report_id_idx" on public."agent_command_reports" ("report_id", id);

-- agent_command_alerts
create table public."agent_command_alerts" (
  id text collate "C" not null,
  "active" boolean,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_alerts_pk" primary key (id),
  constraint "agent_command_alerts_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_alerts_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_alerts_active_idx" on public."agent_command_alerts" ("active", id);

-- agent_command_approvals
create table public."agent_command_approvals" (
  id text collate "C" not null,
  "status" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_approvals_pk" primary key (id),
  constraint "agent_command_approvals_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_approvals_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_approvals_status_idx" on public."agent_command_approvals" ("status", id);

-- agent_command_activity
create table public."agent_command_activity" (
  id text collate "C" not null,
  "occurred_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_activity_pk" primary key (id),
  constraint "agent_command_activity_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_activity_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_activity_occurred_at_idx" on public."agent_command_activity" ("occurred_at", id);

-- agent_command_tasks
create table public."agent_command_tasks" (
  id text collate "C" not null,
  "case_id" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_tasks_pk" primary key (id),
  constraint "agent_command_tasks_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_tasks_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_tasks_case_id_idx" on public."agent_command_tasks" ("case_id", id);

-- agent_command_sources
create table public."agent_command_sources" (
  id text collate "C" not null,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_sources_pk" primary key (id),
  constraint "agent_command_sources_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_sources_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);

-- agent_command_ingestion
create table public."agent_command_ingestion" (
  id text collate "C" not null,
  "event_id" text collate "C",
  "payload_hash" text collate "C",
  "expires_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "agent_command_ingestion_pk" primary key (id),
  constraint "agent_command_ingestion_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "agent_command_ingestion_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "agent_command_ingestion_expires_at_idx" on public."agent_command_ingestion" ("expires_at", id);

-- executive_reports
create table public."executive_reports" (
  id text collate "C" not null,
  "date_riyadh" text collate "C",
  "revision" integer,
  "report_id" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "executive_reports_pk" primary key (id),
  constraint "executive_reports_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "executive_reports_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "executive_reports_date_riyadh_day" check (app.is_day("date_riyadh"))
);
create index "executive_reports_date_riyadh_idx" on public."executive_reports" ("date_riyadh", id);
create index "executive_reports_report_id_idx" on public."executive_reports" ("report_id", id);

-- executive_reports/*/revisions
create table public."executive_report_revisions" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "revision" integer,
  "saved_at" timestamptz,
  "content_hash" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "executive_report_revisions_pk" primary key (parent_id, id),
  constraint "executive_report_revisions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "executive_report_revisions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
alter table public."executive_report_revisions" add constraint "executive_report_revisions_parent_fk" foreign key (parent_id) references public."executive_reports"(id) deferrable initially deferred;
create index "executive_report_revisions_revision_idx" on public."executive_report_revisions" ("revision", id);

-- finance_reports
create table public."finance_reports" (
  id text collate "C" not null,
  "revision" integer,
  "report_id" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "finance_reports_pk" primary key (id),
  constraint "finance_reports_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "finance_reports_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "finance_reports_report_id_idx" on public."finance_reports" ("report_id", id);

-- finance_reports/*/revisions
create table public."finance_report_revisions" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "revision" integer,
  "saved_at" timestamptz,
  "content_hash" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "finance_report_revisions_pk" primary key (parent_id, id),
  constraint "finance_report_revisions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "finance_report_revisions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
alter table public."finance_report_revisions" add constraint "finance_report_revisions_parent_fk" foreign key (parent_id) references public."finance_reports"(id) deferrable initially deferred;
create index "finance_report_revisions_revision_idx" on public."finance_report_revisions" ("revision", id);

-- operations_reports
create table public."operations_reports" (
  id text collate "C" not null,
  "revision" integer,
  "report_id" text collate "C",
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "operations_reports_pk" primary key (id),
  constraint "operations_reports_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "operations_reports_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "operations_reports_report_id_idx" on public."operations_reports" ("report_id", id);

-- operations_reports/*/revisions
create table public."operations_report_revisions" (
  id text collate "C" not null,
  parent_id text collate "C" not null,
  "revision" integer,
  "saved_at" timestamptz,
  "content_hash" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "operations_report_revisions_pk" primary key (parent_id, id),
  constraint "operations_report_revisions_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "operations_report_revisions_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
alter table public."operations_report_revisions" add constraint "operations_report_revisions_parent_fk" foreign key (parent_id) references public."operations_reports"(id) deferrable initially deferred;
create index "operations_report_revisions_revision_idx" on public."operations_report_revisions" ("revision", id);

-- biker_quality_reports
create table public."biker_quality_reports" (
  id text collate "C" not null,
  "biker_uid" text collate "C",
  "period_key" text collate "C",
  "rules_version" text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "biker_quality_reports_pk" primary key (id),
  constraint "biker_quality_reports_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "biker_quality_reports_shape_object" check (shape is null or jsonb_typeof(shape) = 'object'),
  constraint "biker_quality_reports_period_key_month" check (app.is_month("period_key"))
);
create index "biker_quality_reports_biker_uid_idx" on public."biker_quality_reports" ("biker_uid", id);
create index "biker_quality_reports_period_key_idx" on public."biker_quality_reports" ("period_key", id);

-- password_reset_throttle
create table public."password_reset_throttle" (
  id text collate "C" not null,
  "count" integer,
  "window_started_at" timestamptz,
  "last_sent_at" timestamptz,
  "expires_at" timestamptz,
  "updated_at" timestamptz,
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint "password_reset_throttle_pk" primary key (id),
  constraint "password_reset_throttle_extra_object" check (jsonb_typeof(extra) = 'object'),
  constraint "password_reset_throttle_shape_object" check (shape is null or jsonb_typeof(shape) = 'object')
);
create index "password_reset_throttle_expires_at_idx" on public."password_reset_throttle" ("expires_at", id);

