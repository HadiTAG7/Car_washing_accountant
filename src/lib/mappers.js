// ═══════════════════════════════════════════════════════════════════════════
// Row ↔ model mappers
// Keep DB column naming (snake_case) at the edge; internal app uses camelCase.
// ═══════════════════════════════════════════════════════════════════════════

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
  };
}
export function toStartupCostInsert({ category, itemName, quantity, plannedAmount, actualAmount, status }) {
  return {
    category,
    item_name:       itemName,
    quantity:        clampQuantity(quantity),
    budgeted_amount: Math.max(0, Number(plannedAmount) || 0),
    actual_amount:   Math.max(0, Number(actualAmount)  || 0),
    status:          status === 'completed' ? 'completed' : 'in_progress',
  };
}
export function toStartupCostUpdate(updates = {}) {
  const payload = {};
  if (updates.category      !== undefined) payload.category        = updates.category;
  if (updates.itemName      !== undefined) payload.item_name       = updates.itemName;
  if (updates.quantity      !== undefined) payload.quantity        = clampQuantity(updates.quantity);
  if (updates.plannedAmount !== undefined) payload.budgeted_amount = Math.max(0, Number(updates.plannedAmount) || 0);
  if (updates.actualAmount  !== undefined) payload.actual_amount   = Math.max(0, Number(updates.actualAmount)  || 0);
  if (updates.status        !== undefined) payload.status          = updates.status === 'completed' ? 'completed' : 'in_progress';
  return payload;
}

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
    notes:          row.notes || '',
    invoiceUrl:     row.invoice_url || '',
    isTaxInvoice:   Boolean(row.is_tax_invoice),
    createdAt:      row.created_at,
  };
}
export function toStartupCostEntryInsert({
  startupCostId, description, amount, spentDate, notes, invoiceUrl, isTaxInvoice,
}) {
  return {
    startup_cost_id: startupCostId,
    description:     String(description || '').trim(),
    amount:          Math.max(0, Number(amount) || 0),
    spent_date:      spentDate || null,
    notes:           notes && String(notes).trim() ? String(notes).trim() : null,
    invoice_url:     invoiceUrl && String(invoiceUrl).trim() ? String(invoiceUrl).trim() : null,
    is_tax_invoice:  Boolean(isTaxInvoice),
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
    notes:            row.notes || '',
    invoiceUrl:       row.invoice_url || '',
    isTaxInvoice:     Boolean(row.is_tax_invoice),
    createdAt:        row.created_at,
  };
}
export function toAnnualExpenseEntryInsert({
  annualExpenseId, description, amount, spentDate, notes, invoiceUrl, isTaxInvoice,
}) {
  return {
    annual_expense_id: annualExpenseId,
    description:       String(description || '').trim(),
    amount:            Math.max(0, Number(amount) || 0),
    spent_date:        spentDate || null,
    notes:             notes && String(notes).trim() ? String(notes).trim() : null,
    invoice_url:       invoiceUrl && String(invoiceUrl).trim() ? String(invoiceUrl).trim() : null,
    is_tax_invoice:    Boolean(isTaxInvoice),
  };
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
  };
}
export function toAnnualExpenseInsert({
  expenseName, category, quantity, annualCost,
  paymentMonth, paymentDay, paymentStatus,
}) {
  return {
    expense_name:   expenseName,
    category,
    quantity:       clampExpenseQuantity(quantity),
    annual_cost:    Math.max(0, Number(annualCost) || 0),
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
  };
}
export function toMonthlyExpenseInsert({
  expenseName, categoryId, quantity, unitCost, totalMonthlyCost,
  paymentDay, paymentStatus, recurrence, loggedDate,
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
  };
}
export function toVariableExpenseInsert({
  expenseName, categoryId, quantity, unitCost, totalVariableCost, loggedDate,
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
    quantity:   clampWashQuantity(row.quantity),
    price:      Number(row.price) || 0,
    status:     clampWashStatus(row.status),
    washDate:   row.wash_date || '',
  };
}
export function toWashInsert({ bikerName, quantity, price, status, washDate }) {
  const trimmed = String(bikerName || '').trim();
  return {
    biker_name: trimmed || null,
    quantity:   clampWashQuantity(quantity),
    price:      Math.max(0, Number(price) || 0),
    status:     clampWashStatus(status),
    wash_date:  washDate || null,
  };
}
export function toWashUpdate(updates = {}) {
  const payload = {};
  if (updates.bikerName !== undefined) {
    const trimmed = String(updates.bikerName || '').trim();
    payload.biker_name = trimmed || null;
  }
  if (updates.quantity  !== undefined) payload.quantity   = clampWashQuantity(updates.quantity);
  if (updates.price     !== undefined) payload.price      = Math.max(0, Number(updates.price) || 0);
  if (updates.status    !== undefined) payload.status     = clampWashStatus(updates.status);
  if (updates.washDate  !== undefined) payload.wash_date  = updates.washDate || null;
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
function clampPaidAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

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
export function toPartnerInsert({ partnerName, workersCount, paidAmount, userId }) {
  return {
    partner_name:   partnerName,
    workers_count:  Number(workersCount) || 0,
    paid_amount:    clampPaidAmount(paidAmount),
    user_id:        clampUserId(userId),
  };
}
export function toPartnerUpdate({ partnerName, workersCount, paidAmount, userId }) {
  const payload = {};
  if (partnerName  !== undefined) payload.partner_name  = partnerName;
  if (workersCount !== undefined) payload.workers_count = Number(workersCount) || 0;
  if (paidAmount   !== undefined) payload.paid_amount   = clampPaidAmount(paidAmount);
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

export function mapTemporaryExpense(row) {
  return {
    id:             row.id,
    title:          row.title || '',
    amount:         Number(row.amount) || 0,
    spentDate:      row.spent_date || '',
    status:         clampRecoveryStatus(row.status),
    recoveredDate:  row.recovered_date || '',
    notes:          row.notes || '',
  };
}
export function toTemporaryExpenseInsert({ title, amount, spentDate, status, recoveredDate, notes }) {
  const s = clampRecoveryStatus(status);
  return {
    title:          String(title || '').trim(),
    amount:         clampTemporaryAmount(amount),
    spent_date:     spentDate || null,
    status:         s,
    recovered_date: s === 'recovered' ? (recoveredDate || null) : null,
    notes:          notes && String(notes).trim() ? String(notes).trim() : null,
  };
}
export function toTemporaryExpenseUpdate(updates = {}) {
  const payload = {};
  if (updates.title         !== undefined) payload.title       = String(updates.title || '').trim();
  if (updates.amount        !== undefined) payload.amount      = clampTemporaryAmount(updates.amount);
  if (updates.spentDate     !== undefined) payload.spent_date  = updates.spentDate || null;
  if (updates.notes         !== undefined) payload.notes       = updates.notes && String(updates.notes).trim() ? String(updates.notes).trim() : null;
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
