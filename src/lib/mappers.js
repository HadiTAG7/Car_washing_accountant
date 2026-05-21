// ═══════════════════════════════════════════════════════════════════════════
// Row ↔ model mappers
// Keep DB column naming (snake_case) at the edge; internal app uses camelCase.
// ═══════════════════════════════════════════════════════════════════════════

// ── startup_costs ─────────────────────────────────────────────────────────
// App-side shape: { id, category, itemName, plannedAmount, actualAmount, status }
// DB column `budgeted_amount` is aliased to `plannedAmount` for the new UI.
// Status is persisted ('in_progress' | 'completed'), defaulting to 'in_progress'.
export function mapStartupCost(row) {
  return {
    id:            row.id,
    category:      row.category,
    itemName:      row.item_name,
    plannedAmount: Number(row.budgeted_amount) || 0,
    actualAmount:  Number(row.actual_amount)   || 0,
    status:        row.status === 'completed' ? 'completed' : 'in_progress',
  };
}
export function toStartupCostInsert({ category, itemName, plannedAmount, status }) {
  return {
    category,
    item_name:       itemName,
    budgeted_amount: Number(plannedAmount) || 0,
    actual_amount:   0,
    status:          status === 'completed' ? 'completed' : 'in_progress',
  };
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
