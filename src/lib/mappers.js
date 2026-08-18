// ═══════════════════════════════════════════════════════════════════════════
// Row ↔ model mappers
// Keep DB column naming (snake_case) at the edge; internal app uses camelCase.
// ═══════════════════════════════════════════════════════════════════════════

// "Not stated" vs "stated zero" is decided in ONE place — see vatFields.js for
// why. Three modules used to answer it separately and disagreed.
import { statedVatAmount, statedVatRate, normalizedPriceMode } from './vatFields';

// ── startup_costs ─────────────────────────────────────────────────────────
// App-side shape: { id, category, itemName, quantity, plannedAmount, actualAmount, status }
// DB column `budgeted_amount` is aliased to `plannedAmount` for the new UI.
// Status is persisted ('in_progress' | 'completed'), defaulting to 'in_progress'.
function clampQuantity(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
export function mapStartupCost(row) {
  return {
    id:            row.id,
    category:      row.category,
    itemName:      row.item_name,
    quantity:      clampQuantity(row.quantity),
    plannedAmount: Number(row.budgeted_amount) || 0,
    actualAmount:  Number(row.actual_amount)   || 0,
    status:        row.status === 'completed' ? 'completed' : 'in_progress',
    // أسماء التقسيمات داخل البند — السكنات مثلاً — تحت ميزانيته الواحدة.
    // Lives on the PLAN rather than being derived from the entries, so the
    // list is visible before a single expense has been filed under it.
    units:         Array.isArray(row.units) ? row.units : [],
    // VAT recovery for items whose spend is entered INLINE. Items managed
    // by the sub-ledger record VAT per entry instead — counting both would
    // double the reclaim, so the report ignores the parent flag for them.
    ...mapTaxInvoiceFields(row),
    createdAt:     row.created_at || '',
  };
}
// ── البند خطة، والصرف مستند ──────────────────────────────────────────────
// `actual_amount` and the tax-invoice block are NOT writable here, and that
// is the whole fix rather than a style preference. A parent-level amount has
// no spend date, no payment method and no invoice identity, so nothing can
// build a journal entry from it — `ADAPTERS.startup` reads
// `startup_cost_entries`, and there is deliberately no adapter for the
// parent. A row that could enter the VAT return and could never reach `1200`
// left `inputMismatch` permanently open for that item.
//
// So a new item is a PLAN: name, category, quantity, budget. Real spend is a
// `startup_cost_entries` row, which carries all three missing facts, and the
// parent's `actual_amount` becomes the roll-up of those entries — written by
// `syncParentTotal`, not by a form. Legacy rows that still hold their own
// amount are converted through `convertStartupParentSpend`, which asks for
// what the record does not contain. See src/lib/accounting/startupMigration.js.
/**
 * قائمة التقسيمات كما تُحفَظ — نصوصٌ مُشذَّبة بلا فراغات.
 *
 * Shared by the startup plan and the annual expense so one list can never be
 * cleaned two ways. Not `Set`-deduplicated here: the FORM says «مكرّر» to the
 * user's face (unitListProblems), and silently swallowing a duplicate would
 * save a list the user did not write.
 */
export function normalizeUnitList(units) {
  return Array.isArray(units)
    ? units.map((u) => String(u || '').trim()).filter(Boolean) : [];
}

export function toStartupCostInsert({
  category, itemName, quantity, plannedAmount, units,
}) {
  return {
    category,
    item_name:       itemName,
    quantity:        clampQuantity(quantity),
    budgeted_amount: Math.max(0, Number(plannedAmount) || 0),
    // Trimmed and emptied of blanks here; the server de-duplicates on the
    // normalised key when the list is later edited.
    units:           normalizeUnitList(units),
    // Always zero on insert. The sub-ledger owns this column from here on.
    actual_amount:   0,
    // A plan with no spend is `in_progress` by derivation — see
    // `startupStatusOf`. It is not a choice the caller gets to make, and the
    // rules require exactly this value on create.
    status:          'in_progress',
    // A plan is not a document, so it carries no invoice and no tax claim.
    ...toTaxInvoiceFields({ isTaxInvoice: false }),
  };
}
// `toStartupCostUpdate` is gone: `startup_costs` refuses client updates
// outright now. Editing a plan changes what `status` is derived FROM, so it
// has to re-derive in the same transaction — which is `startupUpdatePlan` on
// the server, not a payload shaped here.

// ── startup_cost_entries (sub-ledger per startup item) ────────────────────
// App-side shape: { id, startupCostId, description, amount, spentDate, notes, createdAt }.
// One row per receipt/transaction that contributes to the parent's
// actual_amount. The parent roll-up is kept in sync client-side by the
// useStartupCostEntries hook (every add/delete also writes startup_costs.actual_amount = SUM).
export function mapStartupCostEntry(row) {
  return {
    id:             row.id,
    startupCostId:  row.startup_cost_id,
    description:    row.description || '',
    amount:         Number(row.amount) || 0,
    spentDate:      row.spent_date || '',
    // '' means «غير محدد» — a real answer for spend that belongs to the item
    // as a whole, not a missing one.
    unit:           row.unit || '',
    notes:          row.notes || '',
    ...mapTaxInvoiceFields(row),
    createdAt:      row.created_at,
  };
}
export function toStartupCostEntryInsert({
  startupCostId, description, amount, spentDate, notes, ...taxInvoice
}) {
  return {
    startup_cost_id: startupCostId,
    description:     String(description || '').trim(),
    amount:          Math.max(0, Number(amount) || 0),
    spent_date:      spentDate || null,
    notes:           notes && String(notes).trim() ? String(notes).trim() : null,
    ...toTaxInvoiceFields(taxInvoice),
  };
}

// ── annual_expense_entries (sub-ledger per annual expense) ────────────────
// Exact mirror of the startup entry mappers with annual_expense_id as the
// FK. App-side shape matches mapStartupCostEntry so the shared
// ExpenseLedgerModal renders both without branching.
export function mapAnnualExpenseEntry(row) {
  return {
    id:               row.id,
    annualExpenseId:  row.annual_expense_id,
    description:      row.description || '',
    amount:           Number(row.amount) || 0,
    spentDate:        row.spent_date || '',
    // '' means «غير محدد» — the same real-answer-not-missing-one convention
    // mapStartupCostEntry uses, and what lets the housing tab read annual
    // rent per unit without a second grouping vocabulary.
    unit:             row.unit || '',
    notes:            row.notes || '',
    ...mapTaxInvoiceFields(row),
    createdAt:        row.created_at,
  };
}
export function toAnnualExpenseEntryInsert({
  annualExpenseId, description, amount, spentDate, unit, notes, ...taxInvoice
}) {
  return {
    annual_expense_id: annualExpenseId,
    description:       String(description || '').trim(),
    amount:            Math.max(0, Number(amount) || 0),
    spent_date:        spentDate || null,
    unit:              String(unit || '').trim(),
    notes:             notes && String(notes).trim() ? String(notes).trim() : null,
    ...toTaxInvoiceFields(taxInvoice),
  };
}
/**
 * تعديل قيدٍ سنوي — والحقول المسموحة تُذكر بالاسم.
 *
 * `unit` is the one field the security rules let through even on a POSTED
 * entry (`affectedKeys().hasOnly(['unit'])`), because tagging which housing
 * unit a rent payment belongs to moves no money and touches no journal line.
 * Everything else here still dies at the rule if the entry is posted — this
 * function shapes the write, it does not authorize it.
 */
export function toAnnualExpenseEntryUpdate(updates = {}) {
  const payload = {};
  if (updates.description !== undefined) payload.description = String(updates.description || '').trim();
  if (updates.amount      !== undefined) payload.amount      = Math.max(0, Number(updates.amount) || 0);
  if (updates.spentDate   !== undefined) payload.spent_date  = updates.spentDate || null;
  if (updates.unit        !== undefined) payload.unit        = String(updates.unit || '').trim();
  if (updates.notes       !== undefined) {
    payload.notes = updates.notes && String(updates.notes).trim() ? String(updates.notes).trim() : null;
  }
  // حقول الفاتورة الضريبية — بالشرط نفسه، مفتاحاً مفتاحاً.
  // Key-conditional matters twice over here. Dropping them would make the
  // ledger's pencil silently discard an invoice edit; emitting them ALWAYS
  // would put unrelated keys in `affectedKeys()` and turn a unit-only tag on
  // a posted entry into a permission-denied. `assignUnits` passes `{ unit }`
  // alone, so this adds nothing to that write.
  Object.assign(payload, toTaxInvoiceFieldsUpdate(updates));
  return payload;
}

// ── annual_expenses (Module 2) ────────────────────────────────────────────
// App-side shape: { id, expenseName, category, quantity, annualCost,
// paymentMonth, paymentDay, paymentStatus }. The recurring payment date is
// stored as (payment_month, payment_day). The legacy `due_date` column is
// no longer read or written by the app.
function clampStatus(value) {
  return value === 'paid' ? 'paid' : 'pending';
}
function clampExpenseQuantity(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function clampPaymentDay(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(31, Math.max(1, n));
}
function clampPaymentMonth(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(12, Math.max(1, n));
}
export function mapAnnualExpense(row) {
  return {
    id:            row.id,
    expenseName:   row.expense_name,
    category:      row.category,
    quantity:      clampExpenseQuantity(row.quantity),
    annualCost:    Number(row.annual_cost) || 0,
    // Ledger roll-up — SUM(annual_expense_entries.amount), maintained by
    // useAnnualExpenseEntries after every entry mutation.
    actualAmount:  Number(row.actual_amount) || 0,
    paymentMonth:  row.payment_month != null ? Number(row.payment_month) : null,
    paymentDay:    row.payment_day   != null ? Number(row.payment_day)   : null,
    paymentStatus: clampStatus(row.payment_status),
    // أسماء التقسيمات داخل البند — السكنات مثلاً — تحت تكلفته السنوية
    // الواحدة. On the PLAN, exactly as on the startup item, so the list is
    // visible before a single payment has been filed under it.
    units:         Array.isArray(row.units) ? row.units : [],
  };
}
export function toAnnualExpenseInsert({
  expenseName, category, quantity, annualCost,
  paymentMonth, paymentDay, paymentStatus, units,
}) {
  return {
    expense_name:   expenseName,
    category,
    quantity:       clampExpenseQuantity(quantity),
    annual_cost:    Math.max(0, Number(annualCost) || 0),
    units:          normalizeUnitList(units),
    payment_month:  clampPaymentMonth(paymentMonth),
    payment_day:    clampPaymentDay(paymentDay),
    payment_status: clampStatus(paymentStatus),
  };
}
export function toAnnualExpenseUpdate(updates = {}) {
  const payload = {};
  if (updates.expenseName   !== undefined) payload.expense_name   = updates.expenseName;
  if (updates.category      !== undefined) payload.category       = updates.category;
  if (updates.quantity      !== undefined) payload.quantity       = clampExpenseQuantity(updates.quantity);
  if (updates.annualCost    !== undefined) payload.annual_cost    = Math.max(0, Number(updates.annualCost) || 0);
  if (updates.paymentMonth  !== undefined) payload.payment_month  = clampPaymentMonth(updates.paymentMonth);
  if (updates.paymentDay    !== undefined) payload.payment_day    = clampPaymentDay(updates.paymentDay);
  if (updates.paymentStatus !== undefined) payload.payment_status = clampStatus(updates.paymentStatus);
  if (updates.units         !== undefined) payload.units          = normalizeUnitList(updates.units);
  return payload;
}

// ── حقول الفاتورة الضريبية — shared by every purchase source ─────────────
// Input VAT may only be deducted against a REAL tax invoice, so every
// purchase record carries the fields that prove one exists: supplier,
// invoice number and invoice date. A recurring cost is not evidence of an
// invoice — these fields are, and the VAT report checks them.
export const EXPENSE_PAYMENT_METHODS = ['cash', 'card', 'transfer', 'credit'];
export function clampExpensePaymentMethod(value) {
  return EXPENSE_PAYMENT_METHODS.includes(value) ? value : 'cash';
}
function trimOrNull(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}
function normalizeIsoDate(value) {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
/**
 * Reads the tax-invoice block off a raw row.
 *
 * `vatAmount`, `vatRate` and `priceMode` are what let a purchase keep its own
 * tax. Without them the report had to derive VAT from a rate — and the only
 * rate it had was today's, so a 5%-era invoice was reclaimed at 15% the moment
 * the standard rate moved. A tax invoice states its own VAT; that figure is
 * the deduction, and second-guessing it from a percentage is how a reclaim
 * stops matching the paper it rests on.
 */
export function mapTaxInvoiceFields(row) {
  return {
    isTaxInvoice:  Boolean(row.is_tax_invoice),
    invoiceUrl:    row.invoice_url || '',
    invoiceNumber: row.invoice_number || '',
    invoiceDate:   row.invoice_date || '',
    supplier:      row.supplier || '',
    // The VAT the SUPPLIER wrote on the document. Null means "not stated",
    // which is a different fact from "zero".
    vatAmount:     statedVatAmount(row.vat_amount),
    // The rate the document was raised at, when it is known but the amount is
    // not — a 2019 invoice keeps its 5% however many times the rate moves.
    vatRate:       statedVatRate(row.vat_rate),
    // Whether `amount` already contains the tax.
    priceMode:     normalizedPriceMode(row.price_mode),
    // Absent means "deductible if everything else checks out"; only an
    // explicit false excludes the tax from the claim.
    vatDeductible: row.vat_deductible === false ? false : true,
    paymentMethod: clampExpensePaymentMethod(row.payment_method),
  };
}
/** Writes the same block back, for an insert. */
export function toTaxInvoiceFields({
  isTaxInvoice, invoiceUrl, invoiceNumber, invoiceDate, supplier,
  vatAmount, vatRate, priceMode, vatDeductible, paymentMethod,
} = {}) {
  return {
    is_tax_invoice: Boolean(isTaxInvoice),
    invoice_url:    trimOrNull(invoiceUrl),
    invoice_number: trimOrNull(invoiceNumber),
    invoice_date:   normalizeIsoDate(invoiceDate),
    supplier:       trimOrNull(supplier),
    vat_amount:     statedVatAmount(vatAmount),
    vat_rate:       statedVatRate(vatRate),
    price_mode:     normalizedPriceMode(priceMode),
    vat_deductible: vatDeductible === false ? false : true,
    payment_method: clampExpensePaymentMethod(paymentMethod),
  };
}
/** And for a patch — only the keys actually edited. */
export function toTaxInvoiceFieldsUpdate(updates = {}) {
  const payload = {};
  if (updates.isTaxInvoice  !== undefined) payload.is_tax_invoice = Boolean(updates.isTaxInvoice);
  if (updates.invoiceUrl    !== undefined) payload.invoice_url    = trimOrNull(updates.invoiceUrl);
  if (updates.invoiceNumber !== undefined) payload.invoice_number = trimOrNull(updates.invoiceNumber);
  if (updates.invoiceDate   !== undefined) payload.invoice_date   = normalizeIsoDate(updates.invoiceDate);
  if (updates.supplier      !== undefined) payload.supplier       = trimOrNull(updates.supplier);
  if (updates.vatAmount     !== undefined) payload.vat_amount     = statedVatAmount(updates.vatAmount);
  if (updates.vatRate       !== undefined) payload.vat_rate       = statedVatRate(updates.vatRate);
  if (updates.priceMode     !== undefined) payload.price_mode     = normalizedPriceMode(updates.priceMode);
  if (updates.vatDeductible !== undefined) payload.vat_deductible = updates.vatDeductible === false ? false : true;
  if (updates.paymentMethod !== undefined) payload.payment_method = clampExpensePaymentMethod(updates.paymentMethod);
  return payload;
}

// ── monthly_expenses (Module 3) ───────────────────────────────────────────
// App-side shape: { id, expenseName, categoryId, quantity, unitCost,
// totalMonthlyCost, paymentDay, paymentStatus }. The recurring `payment_day`
// column replaces the legacy `billing_date` — no longer read or written.
export function mapMonthlyExpenseCategory(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
  };
}
function clampRecurrence(value) {
  return value === 'one_time' ? 'one_time' : 'monthly';
}
function normalizeLoggedDate(value) {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function mapMonthlyExpense(row) {
  return {
    id:               row.id,
    expenseName:      row.expense_name,
    categoryId:       row.category_id || '',
    quantity:         clampExpenseQuantity(row.quantity),
    unitCost:         Number(row.unit_cost) || 0,
    totalMonthlyCost: Number(row.total_monthly_cost) || 0,
    paymentDay:       row.payment_day != null ? Number(row.payment_day) : null,
    paymentStatus:    clampStatus(row.payment_status),
    recurrence:       clampRecurrence(row.recurrence),
    loggedDate:       row.logged_date || null,
    // VAT recovery: when the supplier issued a tax invoice, the stored
    // cost is VAT-INCLUSIVE and the 15% portion is reclaimable — but only
    // against a real document, so the invoice block travels with the row.
    ...mapTaxInvoiceFields(row),
  };
}
export function toMonthlyExpenseInsert({
  expenseName, categoryId, quantity, unitCost, totalMonthlyCost,
  paymentDay, paymentStatus, recurrence, loggedDate, ...taxInvoice
}) {
  const q   = clampExpenseQuantity(quantity);
  const uc  = Math.max(0, Number(unitCost) || 0);
  const rec = clampRecurrence(recurrence);
  return {
    expense_name:       expenseName,
    category_id:        categoryId || null,
    quantity:           q,
    unit_cost:          uc,
    total_monthly_cost: Math.max(0, Number(totalMonthlyCost) || q * uc),
    // For one_time rows we don't need a recurring payment_day reminder.
    payment_day:        rec === 'one_time' ? null : clampPaymentDay(paymentDay),
    payment_status:     clampStatus(paymentStatus),
    recurrence:         rec,
    logged_date:        rec === 'one_time' ? normalizeLoggedDate(loggedDate) : null,
    ...toTaxInvoiceFields(taxInvoice),
  };
}
export function toMonthlyExpenseUpdate(updates = {}) {
  const payload = {};
  if (updates.expenseName      !== undefined) payload.expense_name       = updates.expenseName;
  if (updates.categoryId       !== undefined) payload.category_id        = updates.categoryId || null;
  if (updates.quantity         !== undefined) payload.quantity           = clampExpenseQuantity(updates.quantity);
  if (updates.unitCost         !== undefined) payload.unit_cost          = Math.max(0, Number(updates.unitCost) || 0);
  if (updates.totalMonthlyCost !== undefined) payload.total_monthly_cost = Math.max(0, Number(updates.totalMonthlyCost) || 0);
  if (updates.paymentDay       !== undefined) payload.payment_day        = clampPaymentDay(updates.paymentDay);
  if (updates.paymentStatus    !== undefined) payload.payment_status     = clampStatus(updates.paymentStatus);
  if (updates.recurrence       !== undefined) payload.recurrence         = clampRecurrence(updates.recurrence);
  if (updates.loggedDate       !== undefined) payload.logged_date        = normalizeLoggedDate(updates.loggedDate);
  Object.assign(payload, toTaxInvoiceFieldsUpdate(updates));
  // Keep the two recurrence-dependent columns consistent when recurrence
  // flips: a switch to monthly clears logged_date; a switch to one_time
  // clears payment_day. Skip when only one of the pair was edited.
  if (updates.recurrence === 'one_time')  payload.payment_day = null;
  if (updates.recurrence === 'monthly')   payload.logged_date = null;
  return payload;
}

// ── variable_expenses (Module 4) ──────────────────────────────────────────
// App-side shape: { id, expenseName, categoryId, quantity, unitCost,
// totalVariableCost, loggedDate }. One-off logged events (no recurring
// payment day, no payment status).
export function mapVariableExpenseCategory(row) {
  return {
    id:        row.id,
    label:     row.label,
    sortOrder: row.sort_order ?? 0,
    isDynamic: Boolean(row.is_dynamic),
  };
}
export function mapVariableExpense(row) {
  return {
    id:                row.id,
    expenseName:       row.expense_name,
    categoryId:        row.category_id || '',
    quantity:          clampExpenseQuantity(row.quantity),
    unitCost:          Number(row.unit_cost) || 0,
    totalVariableCost: Number(row.total_variable_cost) || 0,
    loggedDate:        row.logged_date || '',
    // VAT recovery — same contract as the monthly/startup/annual records:
    // a flagged cost is VAT-INCLUSIVE and its 15% share is reclaimable,
    // provided the invoice block below actually identifies an invoice.
    ...mapTaxInvoiceFields(row),
  };
}
export function toVariableExpenseInsert({
  expenseName, categoryId, quantity, unitCost, totalVariableCost, loggedDate,
  ...taxInvoice
}) {
  const q  = clampExpenseQuantity(quantity);
  const uc = Math.max(0, Number(unitCost) || 0);
  return {
    expense_name:        expenseName,
    category_id:         categoryId || null,
    quantity:            q,
    unit_cost:           uc,
    total_variable_cost: Math.max(0, Number(totalVariableCost) || q * uc),
    logged_date:         loggedDate || null,
    ...toTaxInvoiceFields(taxInvoice),
  };
}
export function toVariableExpenseUpdate(updates = {}) {
  const payload = {};
  if (updates.expenseName       !== undefined) payload.expense_name        = updates.expenseName;
  if (updates.categoryId        !== undefined) payload.category_id         = updates.categoryId || null;
  if (updates.quantity          !== undefined) payload.quantity            = clampExpenseQuantity(updates.quantity);
  if (updates.unitCost          !== undefined) payload.unit_cost           = Math.max(0, Number(updates.unitCost) || 0);
  if (updates.totalVariableCost !== undefined) payload.total_variable_cost = Math.max(0, Number(updates.totalVariableCost) || 0);
  if (updates.loggedDate        !== undefined) payload.logged_date         = updates.loggedDate || null;
  Object.assign(payload, toTaxInvoiceFieldsUpdate(updates));
  return payload;
}

// ── washes (Module 5 — bulk-quantity log) ─────────────────────────────────
// App-side shape: { id, bikerName, quantity, price, status, washDate }.
// Each row represents a batch: `quantity` washes at `price` each. The
// Variable Expenses biker-commissions rule sums quantity across rows
// where status = 'مكتملة' to auto-scale.
function clampWashStatus(value) {
  return value === 'قيد التنفيذ' ? 'قيد التنفيذ' : 'مكتملة';
}
function clampWashQuantity(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
export function mapWash(row) {
  return {
    id:         row.id,
    bikerName:  row.biker_name || '',
    // Registry link, written alongside the name for NEW washes. Display and
    // aggregation still key on the NAME (legacy rows have only that), so this
    // is forward provisioning, not the join key.
    bikerId:    row.biker_id || null,
    quantity:   clampWashQuantity(row.quantity),
    price:      Number(row.price) || 0,
    status:     clampWashStatus(row.status),
    washDate:   row.wash_date || '',
    // Which account the money landed in decides the debit side of the entry:
    // cash, bank, or a receivable when the sale is on credit.
    paymentMethod: clampExpensePaymentMethod(row.payment_method),
  };
}
export function toWashInsert({ bikerName, bikerId, quantity, price, status, washDate, paymentMethod }) {
  const trimmed = String(bikerName || '').trim();
  return {
    biker_name: trimmed || null,
    biker_id:   bikerId || null,
    quantity:   clampWashQuantity(quantity),
    price:      Math.max(0, Number(price) || 0),
    status:     clampWashStatus(status),
    wash_date:  washDate || null,
    payment_method: clampExpensePaymentMethod(paymentMethod),
  };
}
export function toWashUpdate(updates = {}) {
  const payload = {};
  if (updates.bikerName !== undefined) {
    const trimmed = String(updates.bikerName || '').trim();
    payload.biker_name = trimmed || null;
  }
  if (updates.bikerId   !== undefined) payload.biker_id   = updates.bikerId || null;
  if (updates.quantity  !== undefined) payload.quantity   = clampWashQuantity(updates.quantity);
  if (updates.price     !== undefined) payload.price      = Math.max(0, Number(updates.price) || 0);
  if (updates.status    !== undefined) payload.status     = clampWashStatus(updates.status);
  if (updates.washDate  !== undefined) payload.wash_date  = updates.washDate || null;
  if (updates.paymentMethod !== undefined) payload.payment_method = clampExpensePaymentMethod(updates.paymentMethod);
  return payload;
}

// ── category_budgets (Module 7) ───────────────────────────────────────────
// App-side shape: { id, categoryLabel, budgetType, amount }.
function clampBudgetType(value) {
  return value === 'annual' ? 'annual' : 'monthly';
}
export function mapBudget(row) {
  return {
    id:            row.id,
    categoryLabel: row.category_label || '',
    budgetType:    clampBudgetType(row.budget_type),
    amount:        Number(row.amount) || 0,
  };
}
export function toBudgetInsert({ categoryLabel, budgetType, amount }) {
  return {
    category_label: String(categoryLabel || '').trim(),
    budget_type:    clampBudgetType(budgetType),
    amount:         Math.max(0, Number(amount) || 0),
  };
}
export function toBudgetUpdate(updates = {}) {
  const payload = {};
  if (updates.categoryLabel !== undefined) payload.category_label = String(updates.categoryLabel || '').trim();
  if (updates.budgetType    !== undefined) payload.budget_type    = clampBudgetType(updates.budgetType);
  if (updates.amount        !== undefined) payload.amount         = Math.max(0, Number(updates.amount) || 0);
  return payload;
}

// ── partners ──────────────────────────────────────────────────────────────
// NOTE: percentage is purely a client-derived display value
// (workersCount / totalWorkers * 100). It is intentionally NOT mapped /
// inserted / updated — the DB table doesn't carry that column.
// NOTE: paid_amount is a CACHE, not the source of truth. The app derives a
// partner's paid-to-date by summing `partner_payments` (see
// lib/accounting/partnerTotals.js), because this aggregate is maintained by a
// client-side read-then-sum and two devices recording receipts at once can
// write totals that disagree with the receipts themselves. It is still
// written so exports and backups stay populated; nothing reads it for display.
// The original note follows: paid_amount is read-only from the app's perspective — the DB
// trigger on partner_payments keeps it equal to SUM(receipts), so the
// insert/update mappers deliberately never write it (a direct write
// would drift from the receipts ledger until the next receipt).

// Loose UUID validator: 8-4-4-4-12 hex with dashes. Used by the Add /
// Edit partner modals to gate the "link to Supabase user" field. Returns
// the trimmed UUID if valid, null otherwise.
function clampUserId(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

export function mapPartner(row) {
  return {
    id:             row.id,
    partnerName:    row.partner_name,
    workersCount:   Number(row.workers_count) || 0,
    paidAmount:     Number(row.paid_amount) || 0,
    contactNumber:  row.contact_number || '',
    status:         row.status || 'active',
    userId:         row.user_id || null,
  };
}
export function toPartnerInsert({ partnerName, workersCount, userId }) {
  return {
    partner_name:   partnerName,
    workers_count:  Number(workersCount) || 0,
    user_id:        clampUserId(userId),
  };
}
export function toPartnerUpdate({ partnerName, workersCount, userId }) {
  const payload = {};
  if (partnerName  !== undefined) payload.partner_name  = partnerName;
  if (workersCount !== undefined) payload.workers_count = Number(workersCount) || 0;
  if (userId       !== undefined) payload.user_id       = clampUserId(userId);
  return payload;
}

// ── partner_payments ──────────────────────────────────────────────────────
// One row per receipt against a partner's capital fee. The DB trigger
// `partner_payments_sync` keeps `partners.paid_amount` equal to
// SUM(amount) per partner, so reading the cached aggregate stays valid.
const PAYMENT_METHODS = new Set(['bank_transfer', 'cash', 'mada_pos']);
function clampPaymentMethod(value) {
  return PAYMENT_METHODS.has(value) ? value : 'bank_transfer';
}
function clampPaymentAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

export function mapPartnerPayment(row) {
  return {
    id:             row.id,
    partnerId:      row.partner_id,
    amount:         Number(row.amount) || 0,
    paymentDate:    row.payment_date || '',
    paymentMethod:  clampPaymentMethod(row.payment_method),
    notes:          row.notes || '',
    createdAt:      row.created_at,
  };
}
export function toPartnerPaymentInsert({ partnerId, amount, paymentDate, paymentMethod, notes }) {
  return {
    partner_id:     partnerId,
    amount:         clampPaymentAmount(amount),
    payment_date:   paymentDate || null,
    payment_method: clampPaymentMethod(paymentMethod),
    notes:          notes && String(notes).trim() ? String(notes).trim() : null,
  };
}

// ── temporary_expenses (Module 9 — reimbursable outlays ledger) ───────────
// Temporary outlays the business pays now and recovers later. The
// status/recovered_date pair travels together: clearing one without the
// other would violate the CHECK constraint on the DB side, so the helpers
// below enforce that invariant client-side too.
function clampRecoveryStatus(value) {
  return value === 'recovered' ? 'recovered' : 'pending';
}
function clampTemporaryAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

// The posting adapters read `payment_method` on the outlay entry and
// `recovery_method` on the recovery entry, defaulting anything missing to
// cash. Until the biker advances arrived, the UI never wrote either — every
// advance silently posted against 1010. Two values only, because the two
// entries only ever choose between the two money accounts.
function clampAdvanceMethod(value) {
  return value === 'bank' ? 'bank' : 'cash';
}

export function mapTemporaryExpense(row) {
  return {
    id:             row.id,
    title:          row.title || '',
    amount:         Number(row.amount) || 0,
    spentDate:      row.spent_date || '',
    status:         clampRecoveryStatus(row.status),
    recoveredDate:  row.recovered_date || '',
    notes:          row.notes || '',
    // Who took the advance — a registry link, null for the general
    // (non-biker) outlays the page has always recorded.
    bikerId:        row.biker_id || null,
    paymentMethod:  clampAdvanceMethod(row.payment_method),
  };
}
export function toTemporaryExpenseInsert({ title, amount, spentDate, status, recoveredDate, notes, bikerId, paymentMethod }) {
  const s = clampRecoveryStatus(status);
  return {
    title:          String(title || '').trim(),
    amount:         clampTemporaryAmount(amount),
    spent_date:     spentDate || null,
    status:         s,
    recovered_date: s === 'recovered' ? (recoveredDate || null) : null,
    notes:          notes && String(notes).trim() ? String(notes).trim() : null,
    biker_id:       bikerId || null,
    payment_method: clampAdvanceMethod(paymentMethod),
  };
}
export function toTemporaryExpenseUpdate(updates = {}) {
  const payload = {};
  if (updates.title         !== undefined) payload.title       = String(updates.title || '').trim();
  if (updates.amount        !== undefined) payload.amount      = clampTemporaryAmount(updates.amount);
  if (updates.spentDate     !== undefined) payload.spent_date  = updates.spentDate || null;
  if (updates.notes         !== undefined) payload.notes       = updates.notes && String(updates.notes).trim() ? String(updates.notes).trim() : null;
  // How the money CAME BACK. Deducted from a bank-paid salary → 'bank', so
  // the recovery entry debits the same account the salary credited.
  if (updates.recoveryMethod !== undefined) payload.recovery_method = clampAdvanceMethod(updates.recoveryMethod);
  // status + recovered_date are coupled by the DB CHECK constraint: keep
  // them in lock-step so callers can't accidentally violate it.
  if (updates.status !== undefined) {
    const s = clampRecoveryStatus(updates.status);
    payload.status         = s;
    payload.recovered_date = s === 'recovered'
      ? (updates.recoveredDate || null)
      : null;
  } else if (updates.recoveredDate !== undefined) {
    payload.recovered_date = updates.recoveredDate || null;
  }
  return payload;
}

// ── housing_units (سعة السكن وملاحظاته) ──────────────────────────────────
// The unit LIST lives on the startup item and the RESIDENTS live on the
// bikers; this collection carries only what neither knows — the planned
// capacity and free notes. Doc ids are deterministic (housingUnitDocId) so
// one unit can never grow two meta documents.
export function mapHousingUnit(row) {
  return {
    id:       row.id,
    name:     row.name || '',
    // Null is «لم تُذكر السعة», a different fact from an explicit number —
    // the same not-stated-vs-zero line the tax fields draw.
    capacity: row.capacity == null ? null : Math.max(0, Math.trunc(Number(row.capacity)) || 0),
    notes:    row.notes || '',
  };
}
export function toHousingUnitInsert({ id, name, capacity, notes }) {
  return {
    id,
    name:     String(name || '').trim(),
    capacity: capacity == null || capacity === '' ? null : Math.max(0, Math.trunc(Number(capacity)) || 0),
    notes:    String(notes || '').trim() || null,
  };
}
export function toHousingUnitUpdate(updates = {}) {
  const payload = {};
  if (updates.name     !== undefined) payload.name     = String(updates.name || '').trim();
  if (updates.capacity !== undefined) {
    payload.capacity = updates.capacity == null || updates.capacity === ''
      ? null : Math.max(0, Math.trunc(Number(updates.capacity)) || 0);
  }
  if (updates.notes    !== undefined) payload.notes    = String(updates.notes || '').trim() || null;
  return payload;
}

// ── bikers (سجل البايكرات) ────────────────────────────────────────────────
// The people who wash the cars. Until this registry existed a biker was a
// free-text `biker_name` typed onto each wash — so the NAME stays the join
// key for washes and commissions (legacy rows carry only that), and this
// collection carries what a name cannot: phone, residence, sponsor,
// nationality, salary, iqama.
// Salary here is INFORMATION; the actual payment is a monthly_expenses row
// created the day it is paid, so the books only ever say what happened.
export function mapBiker(row) {
  return {
    id:            row.id,
    name:          row.name || '',
    contactNumber: row.contact_number || '',
    residence:     row.residence || '',
    sponsor:       row.sponsor || '',
    nationality:   row.nationality || '',
    salary:        Math.max(0, Number(row.salary) || 0),
    startDate:     row.start_date || '',
    iqamaNumber:   row.iqama_number || '',
    iqamaExpiry:   row.iqama_expiry || '',
  };
}
export function toBikerInsert({
  name, contactNumber, residence, sponsor, nationality, salary, startDate, iqamaNumber, iqamaExpiry,
}) {
  return {
    name:           String(name || '').trim(),
    contact_number: String(contactNumber || '').trim() || null,
    residence:      String(residence || '').trim() || null,
    sponsor:        String(sponsor || '').trim() || null,
    nationality:    String(nationality || '').trim() || null,
    salary:         Math.max(0, Number(salary) || 0),
    start_date:     startDate || null,
    iqama_number:   String(iqamaNumber || '').trim() || null,
    iqama_expiry:   iqamaExpiry || null,
  };
}
export function toBikerUpdate(updates = {}) {
  const payload = {};
  if (updates.name          !== undefined) payload.name           = String(updates.name || '').trim();
  if (updates.contactNumber !== undefined) payload.contact_number = String(updates.contactNumber || '').trim() || null;
  if (updates.residence     !== undefined) payload.residence      = String(updates.residence || '').trim() || null;
  if (updates.sponsor       !== undefined) payload.sponsor        = String(updates.sponsor || '').trim() || null;
  if (updates.nationality   !== undefined) payload.nationality    = String(updates.nationality || '').trim() || null;
  if (updates.salary        !== undefined) payload.salary         = Math.max(0, Number(updates.salary) || 0);
  if (updates.startDate     !== undefined) payload.start_date     = updates.startDate || null;
  if (updates.iqamaNumber   !== undefined) payload.iqama_number   = String(updates.iqamaNumber || '').trim() || null;
  if (updates.iqamaExpiry   !== undefined) payload.iqama_expiry   = updates.iqamaExpiry || null;
  return payload;
}
