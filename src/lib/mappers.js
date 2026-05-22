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

// ── assets ────────────────────────────────────────────────────────────────
export function mapAsset(row) {
  return {
    id:            row.id,
    assetName:     row.asset_name,
    purchaseDate:  row.purchase_date,
    purchaseCost:  Number(row.cost)               || 0,
    salvageValue:  Number(row.salvage_value)      || 0,
    usefulLife:    Number(row.useful_life_years)  || 1,
  };
}
export function toAssetInsert({ assetName, purchaseDate, purchaseCost, salvageValue, usefulLife }) {
  return {
    asset_name:         assetName,
    purchase_date:      purchaseDate,
    cost:               Number(purchaseCost) || 0,
    salvage_value:      Number(salvageValue) || 0,
    useful_life_years:  Number(usefulLife)   || 1,
  };
}

// ── vehicles ──────────────────────────────────────────────────────────────
export function mapVehicle(row) {
  return {
    id:                   row.id,
    vehicleName:          row.vehicle_name,
    route:                row.route || '',
    assetCost:            Number(row.asset_cost)            || 0,
    allocatedFixedCosts:  Number(row.allocated_fixed_costs) || 0,
  };
}
export function toVehicleInsert({ vehicleName, route, assetCost, allocatedFixedCosts }) {
  return {
    vehicle_name:           vehicleName,
    route:                  route || null,
    asset_cost:             Number(assetCost) || 0,
    allocated_fixed_costs:  Number(allocatedFixedCosts) || 0,
  };
}

// ── transactions ──────────────────────────────────────────────────────────
export function mapTransaction(row) {
  return {
    id:          row.id,
    date:        row.occurred_on,
    description: row.description,
    type:        row.type,          // 'in' | 'out'
    amount:      Number(row.amount) || 0,
    vehicleId:   row.vehicle_id,
  };
}
export function toTransactionInsert({ date, description, type, amount, vehicleId }) {
  return {
    occurred_on:  date,
    description,
    type,
    amount:       Number(amount) || 0,
    vehicle_id:   vehicleId || null,
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
  };
}
export function toMonthlyExpenseInsert({
  expenseName, categoryId, quantity, unitCost, totalMonthlyCost,
  paymentDay, paymentStatus,
}) {
  const q  = clampExpenseQuantity(quantity);
  const uc = Math.max(0, Number(unitCost) || 0);
  return {
    expense_name:       expenseName,
    category_id:        categoryId || null,
    quantity:           q,
    unit_cost:          uc,
    total_monthly_cost: Math.max(0, Number(totalMonthlyCost) || q * uc),
    payment_day:        clampPaymentDay(paymentDay),
    payment_status:     clampStatus(paymentStatus),
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

// ── partners ──────────────────────────────────────────────────────────────
export function mapPartner(row) {
  return {
    id:             row.id,
    partnerName:    row.partner_name,
    workersCount:   Number(row.workers_count) || 0,
    contactNumber:  row.contact_number || '',
    status:         row.status || 'active',
  };
}
export function toPartnerInsert({ partnerName, workersCount }) {
  return {
    partner_name:   partnerName,
    workers_count:  Number(workersCount) || 0,
  };
}
export function toPartnerUpdate({ partnerName, workersCount }) {
  const payload = {};
  if (partnerName  !== undefined) payload.partner_name  = partnerName;
  if (workersCount !== undefined) payload.workers_count = Number(workersCount) || 0;
  return payload;
}
