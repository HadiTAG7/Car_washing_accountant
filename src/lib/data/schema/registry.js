// ═══════════════════════════════════════════════════════════════════════════
// سجل الجداول — مصدر واحد لكل مجموعة Firestore وجدولها في Postgres
// ═══════════════════════════════════════════════════════════════════════════
// منه تُولَّد ملفات SQL (scripts/migration/generate-schema-sql.mjs)، ومنه يقرأ
// المحوِّل (codec.js) أي حقل في أي عمود، ومنه تعرف طبقة الخادم (pgstore)
// وطبقة المتصفح كيف تترجم where/orderBy. لا يُعرَّف جدول في مكان آخر.
//
// كل صف = مستند واحد:
//   id      نفس معرّف المستند (text COLLATE "C" — ترتيب Firestore بالبايت)
//   أعمدة   لكل حقل معروف، بنوعه: عليها القيود والفهارس والمفاتيح الأجنبية
//   extra   كل حقل لم يُعرَّف هنا، كما هو (لا يضيع شيء)
//   shape   الاستثناءات فقط: null صريح، قيمة أصلية لا يحفظها العمود حرفياً،
//           أو تاريخ إنشاء نصي حيث الغالب Timestamp (والعكس)
//
// أنواع الأعمدة:
//   id     معرّف/مرجع نصي            text COLLATE "C"
//   text   نص                         text COLLATE "C"   (المقارنة بالبايت كما في Firestore)
//   int    عدد صحيح                   integer
//   big    عدد صحيح كبير              bigint
//   money  مبلغ                       numeric(14,2)
//   num    رقم بلا تقريب              numeric           (كمية، سعر وحدة محسوب)
//   rate   نسبة 0..1                  numeric(9,6)
//   bool   منطقي                      boolean
//   day    تاريخ عمل 'YYYY-MM-DD'     text COLLATE "C" + CHECK تاريخ صحيح
//   month  شهر 'YYYY-MM'              text COLLATE "C" + CHECK
//   ts     لحظة، تُقرأ Timestamp      timestamptz
//   iso    لحظة، تُقرأ نصاً ISO       timestamptz
//   json   خريطة أو مصفوفة            jsonb
//
// لاحقة `!` = فهرس على العمود. التواريخ تبقى نصاً لا `date`: نتائج استعلامات
// النطاق بالبادئة ('2026-10' ≤ x < '2026-11') تبقى كما هي حرفياً، وترتيبها
// الزمني صحيح لأن الشكل موحّد بالـCHECK.
// ═══════════════════════════════════════════════════════════════════════════

const TAX_BLOCK = 'is_tax_invoice:bool! invoice_url invoice_number invoice_date:day! supplier vat_amount:money vat_rate:rate price_mode vat_deductible:bool payment_method';
const WORKBENCH = 'approval_status finance_metadata:json finance_revision:int finance_workflow_version:int updated_at:ts updated_by:id';
const CATEGORY = 'label sort_order:int created_at:iso';

/**
 * policy: who may do what from the browser (RLS). The trusted server role has
 * its own grants; see scripts/migration/sql/*.sql.
 *   read:  'staff' | 'accountant' | 'admin' | 'none' | 'members-self' | 'owner'
 *   write: 'operator' | 'accountant' | 'admin' | 'none' | special names handled in SQL
 *
 * migration: a table added after go-live names its own migration file
 * ('20261023000000_name'). It stays out of the baseline files (already applied
 * in production) and is generated into supabase/migrations/<migration>.sql.
 */
export const TABLES = [
  // ── الدفاتر (الخادم وحده يكتب) ──
  { collection: 'journal_entries', columns: `entryDate:day! periodKey:month! sourceType:text! sourceKind:text! sourceId:id!
      description status:text! entryNumber:int lineCount:int totalDebit:money totalCredit:money createdBy:id createdAt:ts postedAt:ts
      taxSnapshot:json purchaseTaxSnapshot:json settlementEntryId:id settlementOf:id reversalOf:id! reversesEntryId:id!
      reversedSourceKind:text! reversedSourceType:text! reversedSourceId:id reversedBy:id reversedAt:ts reversalReason
      payrollSnapshot:json documentId:id documentNumber`, lines: 'journal_entry_lines', policy: { read: 'staff', write: 'none' } },
  { collection: 'journal_lines', table: 'journal_lines_legacy', columns: 'entryId:id! accountId:id! debit:money credit:money description',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'posting_locks', columns: 'kind sourceType sourceId:id! entryId:id! entryNumber:int settlementEntryId:id lockedBy:id lockedAt:ts',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'accounting_periods', columns: 'periodKey:month status closedAt:ts closedBy:id createdAt:ts reopenReason reopenedAt:ts reopenedBy:id',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'counters', columns: 'nextNumber:big earliestEntryDate:day type year:int updatedAt:ts', policy: { read: 'accountant', write: 'none' } },
  { collection: 'chart_of_accounts', columns: 'code:id nameArabic name accountType normalBalance parentId:id contra:bool active:bool directCost:bool createdAt:ts updatedAt:ts',
    policy: { read: 'staff', write: 'accountant-no-delete' } },
  { collection: 'audit_logs', columns: `action collectionName documentId:id userId:id note before:json after:json at:ts atIso kind sourceId:id reason createdAt:ts`,
    policy: { read: 'accountant', write: 'none' } },
  { collection: 'sales_documents', columns: `type status issueMode documentNumber:text! sequence:int year:int issueDate:day issueTime supplyDate:day
      net:money vat:money gross:money vatRate:rate washId:id! journalEntryId:id! linkedJournalEntryId:id! referenceDocumentId:id! referenceNumber:text!
      sourceType sourceId:id! createdAt:ts issuedAt:ts`, policy: { read: 'staff', write: 'none' } },
  { collection: 'sales_document_sources', columns: 'sourceType sourceId:id documentId:id documentNumber status at:ts releasedAt:ts',
    policy: { read: 'accountant', write: 'none' } },

  // ── الإعدادات والهوية ──
  { collection: 'app_settings', columns: 'value:json updatedBy:id updatedAt:ts', policy: { read: 'staff', write: 'app-settings' } },
  { collection: 'users', table: 'members', columns: 'email:text! role displayName created_at:ts bootstrappedAt:ts bootstrappedBy:id',
    policy: { read: 'members-self', write: 'members' } },
  { collection: 'app_admins', columns: 'email bootstrappedAt:ts note created_at:iso', policy: { read: 'admin', write: 'none' } },

  // ── التشغيل ──
  { collection: 'washes', columns: `biker_name biker_id:id! quantity:int price:money status:text! wash_date:day! payment_method revenue_origin
      ssp_booking_id:id! created_at:iso driver_external_id:text! price_basis price_mode net_amount:money vat_amount:money gross_amount:money
      vat_rate:rate owner_tax_snapshot:json collection_status worker_commission_per_wash:money worker_commission_payment_timing
      worker_commission_paid:bool import_run_id:id created_by:id ssp_booking_number ssp_raw_status notes updated_at:iso`,
    policy: { read: 'staff', write: 'operator', lock: ['wash'] } },
  { collection: 'bikers', columns: `name name_ar name_en driver_external_id:text! contact_number residence sponsor nationality current_status
      salary:money start_date:day end_date:day iqama_number iqama_expiry:day created_at:iso`, policy: { read: 'staff', write: 'operator' } },
  { collection: 'housing_units', columns: 'name capacity:int notes created_at:iso', policy: { read: 'staff', write: 'operator' } },
  { collection: 'temporary_expenses', columns: `title amount:money spent_date:day assignment_month:month status:text! recovered_date:day notes
      biker_id:id! payment_method recovery_method recovered_amount:money payroll_lock_id:id payroll_recovered_at:ts payroll_reconciled_at:ts
      payroll_reconciliation:json created_at:iso created_by:id`, policy: { read: 'staff', write: 'temporary-expenses' } },

  // ── المصاريف ──
  { collection: 'monthly_expenses', columns: `expense_name category_id:id quantity:num unit_cost:num total_monthly_cost:money payment_day:int
      payment_status recurrence logged_date:day! spent_date:day ${TAX_BLOCK} paid_date:day start_period:month end_period:month active:bool
      biker_id:id payroll_period salary_month:month payrollSnapshot:json ${WORKBENCH} created_at:iso`,
    policy: { read: 'staff', write: 'operator', expenseLock: 'monthly' } },
  // logged_date is text, not day: production holds unpadded dates ('2026-8-22')
  // that a month query must compare as Firestore does, byte by byte.
  { collection: 'variable_expenses', columns: `expense_name category_id:id quantity:num unit_cost:num total_variable_cost:money payment_status
      logged_date:text! spent_date:day! ${TAX_BLOCK} paid_date:day ${WORKBENCH} created_at:iso`,
    policy: { read: 'staff', write: 'operator', expenseLock: 'variable' } },
  { collection: 'annual_expenses', columns: `expense_name category:id quantity:num annual_cost:money actual_amount:money units:json
      payment_month:int payment_day:int payment_status created_at:iso`, policy: { read: 'staff', write: 'operator' } },
  { collection: 'annual_expense_entries', columns: `annual_expense_id:id! description amount:money spent_date:day! logged_date:day! unit notes
      ${TAX_BLOCK} paid_date:day ${WORKBENCH} created_at:iso`, policy: { read: 'staff', write: 'annual-entries' } },
  { collection: 'startup_costs', columns: `category:id item_name quantity:num budgeted_amount:money units:json actual_amount:money status
      ${TAX_BLOCK} converted_at:ts converted_by:id updated_at:ts updated_by:id created_at:iso`,
    policy: { read: 'staff', write: 'startup-plan' } },
  { collection: 'startup_cost_entries', columns: `startup_cost_id:id! description amount:money spent_date:day! notes unit ${TAX_BLOCK}
      paid_date:day created_at:ts created_by:id converted_from_parent:bool ${WORKBENCH}`, policy: { read: 'staff', write: 'none' },
    fks: [['startup_cost_id', 'startup_costs']] },
  { collection: 'expense_vouchers', columns: `templateId:id! templateName categoryId:id periodKey:month! dueDate:day! quantity:num unitCost:num
      amount:money isTaxInvoice:bool invoiceUrl supplier invoiceNumber invoiceDate:day! vatAmount:money vatRate:rate priceMode
      vatDeductible:bool paymentStatus:text! paidDate:day status:text! generatedBy:id generatedAt:ts generatedAtIso updatedBy:id updatedAt:ts
      cancelReason cancelledBy:id cancelledAt:ts`, policy: { read: 'staff', write: 'vouchers' } },
  { collection: 'fixed_assets', columns: `name cost:money salvageValue:money usefulLifeMonths:int inServiceDate:day method assetAccount:id
      accumulatedAccount:id expenseAccount:id active:bool disposalDate:day disposalProceeds:money disposalEntryId:id sourceType sourceId:id
      createdBy:id createdAt:ts createdAtIso updatedBy:id updatedAt:ts`, policy: { read: 'staff', write: 'accountant-no-delete' } },
  { collection: 'fee_rules', columns: 'key label basis rate:rate effective_from:day active:bool', policy: { read: 'staff', write: 'admin' } },
  { collection: 'categories', columns: CATEGORY, policy: { read: 'staff', write: 'operator' } },
  { collection: 'category_budgets', columns: 'category_label budget_type amount:money', policy: { read: 'staff', write: 'operator' } },
  { collection: 'monthly_expense_categories', columns: CATEGORY, policy: { read: 'staff', write: 'operator' } },
  { collection: 'variable_expense_categories', columns: `${CATEGORY} is_dynamic:bool`, policy: { read: 'staff', write: 'operator' } },
  { collection: 'annual_expense_categories', columns: CATEGORY, policy: { read: 'staff', write: 'operator' } },
  { collection: 'transactions', columns: 'occurred_on:day description type amount:money vehicle_id:id', policy: { read: 'staff', write: 'operator' } },

  // ── الشركاء ──
  { collection: 'partners', columns: 'partner_name:text! workers_count:int paid_amount:money contact_number status user_id:id! created_at:iso',
    policy: { read: 'staff', write: 'admin' } },
  { collection: 'partner_payments', columns: 'partner_id:id! amount:money payment_date:day! payment_method notes created_at:iso',
    policy: { read: 'staff', write: 'operator', lock: ['partner_payment'] } },
  { collection: 'partner_worker_eligibility', columns: 'revision:int changes:json updatedAt:ts updatedBy:id', policy: { read: 'none', write: 'none' } },
  { collection: 'partner_worker_eligibility/*/audit', table: 'partner_worker_eligibility_audit', parent: 'partner_worker_eligibility',
    columns: 'periodKey:month revision:int actorUid:id createdAt:ts reason before:json after:json', policy: { read: 'none', write: 'none' } },
  { collection: 'partner_mcp_keys', columns: 'keyId:id partnerId:id! ownerUid:id! status label createdAt:ts createdAtIso createdBy:id lastUsedAt:ts revokedAt:ts',
    policy: { read: 'owner', write: 'none' } },
  { collection: 'partner_mcp_key_hashes', columns: 'keyId:id partnerId:id ownerUid:id createdAtIso', policy: { read: 'none', write: 'none' } },
  { collection: 'partner_mcp_rate_limits', columns: 'keyId:id count:int updatedAt:ts', policy: { read: 'none', write: 'none' } },

  // ── الرواتب (الخادم وحده) ──
  { collection: 'payroll_periods', columns: 'periodKey:month revision:int currentRunId:id updatedAt:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'payroll_runs', columns: `runId:id revision:int periodKey:month! periodStart:day periodEnd:day distributionDate:day status:text!
      estimated:bool lineCount:int totals:json journalEntryId:id journalEntryNumber:int reversalEntryId:id payDate:day paymentMethod
      createdAt:ts createdBy:id updatedAt:ts updatedBy:id approvedAt:ts approvedBy:id paidAt:ts paidBy:id`,
    policy: { read: 'accountant', write: 'none' } },
  { collection: 'payroll_runs/*/items', table: 'payroll_run_items', parent: 'payroll_runs', columns: `bikerId:id! name monthlySalary:money
      basicDue:money commission:money bonus:money deduction:money advanceDeduction:money netDue:money status runId:id periodKey:month revision:int
      journalEntryId:id paidAt:ts paidBy:id payDate:day paymentMethod`, policy: { read: 'accountant', write: 'none' } },
  { collection: 'payroll_runs/*/payments', table: 'payroll_run_payments', parent: 'payroll_runs', columns: 'previewHash createdBy:id createdAt:ts',
    policy: { read: 'none', write: 'none' } },
  { collection: 'payroll_payment_locks', columns: 'periodKey:month bikerId:id runId:id journalEntryId:id entryNumber:int lockedAt:ts lockedBy:id',
    policy: { read: 'none', write: 'none' } },
  { collection: 'advance_month_corrections', columns: 'actor:id recordedAt:ts recordedAtIso', policy: { read: 'none', write: 'none' } },

  // ── المراجعة المالية وإيصالات العمليات (الخادم وحده) ──
  { collection: 'finance_reviews', columns: 'kind sourceId:id! sourceHash status postingHash reviewedByUid:id reviewedAt:ts reason',
    policy: { read: 'none', write: 'none' } },
  { collection: 'finance_reviews/*/revisions', table: 'finance_review_revisions', parent: 'finance_reviews', columns: 'revision:int',
    policy: { read: 'none', write: 'none' } },
  { collection: 'finance_workbench_receipts', columns: 'requestHash userId:id at:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'mcp_mutation_receipts', columns: 'requestHash userId:id at:ts', policy: { read: 'none', write: 'none' } },

  // ── سويتر ──
  { collection: 'sweater_raw_payloads', columns: 'importRunId:id! sspBookingId:id! sourceHash schemaVersion:int processingStatus fetchedAt:ts fetchedAtIso',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_bookings', columns: `sspBookingId:id! serviceDate:day! periodKey:month! normalizedStatus:text! processingStatus:text!
      postedEntryId:id! postedAt:ts settlementId:id sourceHash schemaVersion:int source lastImportRunId:id reviewReasonCode recognitionEligibility
      recognitionReason bookingNumber:text! operationalWorkerId:id! record:json updatedAt:ts updatedAtIso`, policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_import_runs', columns: 'status source actor recordCount:int startedAt:ts startedAtIso finishedAt:ts finishedAtIso', policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_integration_state', columns: '', policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_variances', columns: 'kind sspBookingId:id! periodKey:month! resolution:text! difference:money detectedAt:ts', policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_settlements', columns: 'periodKey:month status journalEntryId:id invoiceDocumentId:id figures:json collectedTotal:money',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_adjustments', columns: 'typeKey kind amount:money effectiveDate:day periodKey:month! approvalStatus journalEntryId:id sspBookingId:id',
    policy: { read: 'staff', write: 'none' } },
  { collection: 'sweater_collections', columns: 'periodKey:month! amount:money receivedDate:day', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_price_list', columns: 'key serviceType effectiveFrom:day effectiveTo:day status createdAt:ts', policy: { read: 'staff', write: 'accountant' } },
  { collection: 'sweater_adjustment_types', columns: 'key effectiveFrom:day effectiveTo:day status createdAt:ts', policy: { read: 'staff', write: 'accountant' } },
  { collection: 'sweater_recognition_policy', columns: 'key effectiveFrom:day effectiveTo:day status createdAt:ts', policy: { read: 'staff', write: 'accountant' } },
  { collection: 'sweater_owner_booking_claims', columns: 'bookingNumber sspBookingId:id washId:id', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_owner_collection_confirmations', columns: 'sspBookingId:id', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_operational_wash_links', columns: 'washId:id! sspBookingId:id! side:text!', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_booking_links', columns: 'washId:id! sspBookingId:id! side:text!', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_owner_tax_clarifications', columns: '', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_integration_keys', columns: 'keyId:id status scope principal createdAt:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'sweater_rate_limits', columns: 'keyId:id count:int updatedAt:ts', policy: { read: 'none', write: 'none' } },
  // Readings of Sweater's Metabase dashboards, signed by the operations agent: one row per reading, never rewritten.
  { collection: 'sweater_metric_snapshots', columns: 'periodKey:month! extractedAtIso sourceUrl payloadHash keyId:id metrics:json receivedAt:ts receivedAtIso',
    policy: { read: 'staff', write: 'none' }, migration: '20261023000000_sweater_metric_snapshots' },
  { collection: 'quality_objections', columns: 'periodKey:month! metricKey sourceId:id snapshotId:id sourceHash status note revision:int updatedBy:id updatedByName updatedAtIso',
    policy: { read: 'admin', write: 'none' }, migration: '20261026203950_quality_objections' },

  // ── مركز قيادة الوكلاء ──
  { collection: 'agent_command_agents', columns: '', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_reports', columns: 'reportedAt:ts! reportId:id!', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_alerts', columns: 'active:bool!', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_approvals', columns: 'status:text!', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_activity', columns: 'occurredAt:ts!', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_tasks', columns: 'caseId:id!', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_sources', columns: '', policy: { read: 'accountant', write: 'none' }, realtime: true },
  { collection: 'agent_command_ingestion', columns: 'eventId:id payloadHash expiresAt:ts!', policy: { read: 'none', write: 'none' } },

  // ── التقارير ──
  { collection: 'executive_reports', columns: 'dateRiyadh:day! revision:int reportId:id! updatedAt:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'executive_reports/*/revisions', table: 'executive_report_revisions', parent: 'executive_reports', columns: 'revision:int! savedAt:ts contentHash',
    policy: { read: 'none', write: 'none' } },
  { collection: 'finance_reports', columns: 'revision:int reportId:id! updatedAt:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'finance_reports/*/revisions', table: 'finance_report_revisions', parent: 'finance_reports', columns: 'revision:int! savedAt:ts contentHash',
    policy: { read: 'none', write: 'none' } },
  { collection: 'operations_reports', columns: 'revision:int reportId:id! updatedAt:ts', policy: { read: 'none', write: 'none' } },
  { collection: 'operations_reports/*/revisions', table: 'operations_report_revisions', parent: 'operations_reports', columns: 'revision:int! savedAt:ts contentHash',
    policy: { read: 'none', write: 'none' } },
  { collection: 'biker_quality_reports', columns: 'bikerUID:id! periodKey:month! rulesVersion', policy: { read: 'none', write: 'none' } },
  { collection: 'password_reset_throttle', columns: 'count:int windowStartedAt:ts lastSentAt:ts expiresAt:ts! updatedAt:ts', policy: { read: 'none', write: 'none' } },
];

// Collections deliberately left in Firebase, with the reason shown in the count table.
export const NOT_MIGRATED = {
  auth_users_backup: 'نسخة قديمة من حسابات Supabase الأولى؛ لا يقرؤها شيء والقواعد تمنعها عن الجميع',
};

// ── Parsed form ──
export const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
const TYPES = new Set(['id', 'text', 'int', 'big', 'money', 'num', 'rate', 'bool', 'day', 'month', 'ts', 'iso', 'json']);
const RESERVED = new Set(['id', 'extra', 'shape', 'parent_ref']);

function parseColumns(spec, table) {
  const out = [];
  for (const token of spec.split(/\s+/).filter(Boolean)) {
    const indexed = token.endsWith('!');
    const [field, type = 'text'] = token.replace(/!$/, '').split(':');
    if (!TYPES.has(type)) throw new Error(`${table}.${field}: unknown type ${type}`);
    const column = snake(field);
    if (RESERVED.has(column) || RESERVED.has(field)) throw new Error(`${table}.${field}: reserved column name`);
    out.push({ field, column, type, indexed });
  }
  const seen = new Set();
  for (const c of out) {
    if (seen.has(c.column)) throw new Error(`${table}: two fields map to column ${c.column}`);
    seen.add(c.column);
  }
  return out;
}

export const SCHEMA = TABLES.map((t) => {
  const table = t.table || t.collection;
  const parentTable = t.parent ? (TABLES.find(p => p.collection === t.parent)?.table || t.parent) : null;
  return {
    ...t, table, parentTable, parentColumn: parentTable ? 'parent_ref' : null,
    columns: parseColumns(t.columns, table),
    fks: t.fks || [],
  };
});

const byCollection = new Map(SCHEMA.map(t => [t.collection, t]));
const byTable = new Map(SCHEMA.map(t => [t.table, t]));

/**
 * The table for a Firestore collection path: 'washes', or a subcollection
 * 'payroll_runs/2026-10__r1/items' → payroll_run_items with parent id.
 * An unknown collection throws: nothing is written to a table nobody declared.
 */
export function tableFor(collectionPath) {
  const parts = String(collectionPath).split('/');
  if (parts.length === 1) {
    const t = byCollection.get(parts[0]);
    if (!t) throw new Error(`لا جدول معرَّف للمجموعة ${collectionPath}`);
    return { table: t, parentId: null };
  }
  if (parts.length === 3) {
    const t = byCollection.get(`${parts[0]}/*/${parts[2]}`);
    if (!t) throw new Error(`لا جدول معرَّف للمجموعة الفرعية ${collectionPath}`);
    return { table: t, parentId: parts[1] };
  }
  throw new Error(`مسار غير مدعوم: ${collectionPath}`);
}
/** Whether documents of this collection path can exist at all (a table is defined for it). */
export function hasTableFor(collectionPath) {
  const parts = String(collectionPath).split('/');
  if (parts.length === 1) return byCollection.has(parts[0]);
  if (parts.length === 3) return byCollection.has(`${parts[0]}/*/${parts[2]}`);
  return false;
}
export const tableByName = name => byTable.get(name);
/** Subcollection tables for a collection-group name ('items' → payroll_run_items). */
export const groupTables = name => SCHEMA.filter(t => t.collection.endsWith(`/*/${name}`));
