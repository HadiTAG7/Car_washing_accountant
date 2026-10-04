// Explicit business projections. Never add identity/auth/key collections here.
// Operational names/labels identify workers, items and account categories.
// Free-form notes, descriptions, reasons and advance titles are excluded:
// accepting a string is not a privacy review of its contents.
const specs = [
  ['washes', 'الغسلات', 'biker_id biker_name quantity price status wash_date payment_method revenue_origin'],
  ['bikers', 'العمال', 'name name_ar name_en start_date end_date'],
  ['housing_units', 'السكن', 'name capacity'],
  ['monthly_expenses', 'المصاريف الشهرية', 'expense_name category_id quantity unit_cost total_monthly_cost payment_day payment_status recurrence logged_date'],
  ['variable_expenses', 'المصاريف المتغيرة', 'expense_name category_id quantity unit_cost total_variable_cost logged_date payment_method invoice_number invoice_date vat_amount vat_rate price_mode'],
  ['annual_expenses', 'المصاريف السنوية', 'expense_name category quantity annual_cost actual_amount payment_month payment_day payment_status'],
  ['annual_expense_entries', 'دفعات المصاريف السنوية', 'annual_expense_id amount spent_date spend_date date unit payment_method invoice_number invoice_date vat_amount'],
  ['startup_costs', 'خطط التأسيس', 'item_name category quantity budgeted_amount actual_amount status'],
  ['startup_cost_entries', 'مصروفات التأسيس', 'startup_cost_id amount spent_date spend_date payment_method unit invoice_number invoice_date vat_amount'],
  ['temporary_expenses', 'السلف والمصاريف المؤقتة', 'biker_id amount recovered_amount status spent_date recovered_date recovery_method'],
  ['partners', 'بيانات عمل الشركاء', 'partner_name workers_count paid_amount status'],
  ['partner_payments', 'مدفوعات الشركاء', 'partner_id amount payment_date payment_method'],
  ['transactions', 'المعاملات', 'type amount date status'],
  ['categories', 'التصنيفات', 'name name_ar category_name type'],
  ['category_budgets', 'الميزانيات', 'category_label budget_type amount'],
  ['monthly_expense_categories', 'تصنيفات الشهرية', 'label sort_order'],
  ['variable_expense_categories', 'تصنيفات المتغيرة', 'label sort_order is_dynamic'],
  ['annual_expense_categories', 'تصنيفات السنوية', 'name'],
  ['expense_vouchers', 'سندات المصاريف', 'templateId periodKey dueDate amount status paymentMethod'],
  ['fixed_assets', 'الأصول', 'name cost salvageValue usefulLifeMonths inServiceDate status'],
  ['chart_of_accounts', 'دليل الحسابات', 'code name nameArabic accountType normalBalance directCost active contra'],
  ['journal_entries', 'قيود اليومية', 'entryDate entryNumber periodKey status sourceType sourceKind sourceId lines'],
  ['journal_lines', 'سطور القيود القديمة', 'entryId accountId debit credit'],
  ['accounting_periods', 'الفترات المحاسبية', 'periodKey status closedAt'],
  ['sales_documents', 'المستندات المالية', 'documentNumber type issueDate supplyDate status'],
  ['fee_rules', 'قواعد الرسوم', 'key label basis rate effective_from active'],
  ['payroll_runs', 'مسيرات العمال', 'periodKey status distributionDate'],
  ['sweater_bookings', 'حجوزات سويتر', 'bookingId bikerId bikerName serviceDate completedAt quantity status amount netAmount vatAmount'],
  ['sweater_settlements', 'تسويات سويتر', 'periodKey status from to grossAmount netAmount vatAmount'],
  ['sweater_adjustments', 'تعديلات سويتر', 'settlementId kind type amount status date'],
  ['sweater_variances', 'فروق سويتر', 'settlementId type amount status'],
  ['sweater_price_list', 'أسعار سويتر', 'name serviceType price effectiveFrom active'],
  ['sweater_adjustment_types', 'أنواع تعديلات سويتر', 'key kind nameArabic active'],
  ['sweater_recognition_policy', 'سياسة الاعتراف', 'effectiveFrom mode status'],
];
export const SUPERVISOR_COLLECTIONS = Object.fromEntries(specs.map(([key, label, fields]) => [key, { label, fields: fields.split(' ') }]));
export const SUPERVISOR_READ_HANDLERS = ['supervisorOverview', 'supervisorRecords', 'authBootstrapStatus'];

// Only these nested fields have been reviewed. All other compound values
// are excluded; a map/array smuggled into a scalar field becomes null.
export const SUPERVISOR_JOURNAL_LINE_FIELDS = ['accountId', 'debit', 'credit'];
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean'
  ? value : typeof value === 'number' && Number.isFinite(value) ? value : null;
export function projectSupervisorRecord(collection, data, id) {
  const spec = Object.hasOwn(SUPERVISOR_COLLECTIONS, collection) ? SUPERVISOR_COLLECTIONS[collection] : null;
  if (!spec) throw new Error('Unsupported supervisor projection');
  const row = { id: String(id) };
  for (const field of spec.fields) {
    if (!Object.hasOwn(data, field)) continue;
    if (collection === 'journal_entries' && field === 'lines') {
      row.lines = Array.isArray(data.lines) ? data.lines.map(line => {
        const projected = {};
        for (const key of SUPERVISOR_JOURNAL_LINE_FIELDS) {
          if (line && Object.hasOwn(line, key)) projected[key] = scalar(line[key]);
        }
        return projected;
      }) : null;
    } else row[field] = scalar(data[field]);
  }
  return row;
}
