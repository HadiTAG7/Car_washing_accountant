// ═══════════════════════════════════════════════════════════════════════════
// Row ↔ model mappers
// Keep DB column naming (snake_case) at the edge; internal app uses camelCase.
// ═══════════════════════════════════════════════════════════════════════════

// ── startup_costs ─────────────────────────────────────────────────────────
export function mapStartupCost(row) {
  const budgeted = Number(row.budgeted_amount) || 0;
  const actual   = Number(row.actual_amount)   || 0;
  return {
    id:        row.id,
    category:  row.category,
    itemName:  row.item_name,
    budgeted,
    actual,
    status:    row.status ||
      (budgeted > actual ? 'under' : budgeted < actual ? 'over' : 'on'),
  };
}
export function toStartupCostInsert({ category, itemName, budgeted, actual }) {
  return {
    category,
    item_name:       itemName,
    budgeted_amount: Number(budgeted) || 0,
    actual_amount:   Number(actual)   || 0,
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

// ── maintenance_logs (+ joined vehicle) ───────────────────────────────────
export function mapMaintenanceLog(row) {
  return {
    id:               row.id,
    vehicleId:        row.vehicle_id,
    assetName:        row.vehicles?.vehicle_name || row.vehicle_name || '—',
    maintenanceType:  row.maintenance_type,
    lastServiceDate:  row.last_service_date,
    nextServiceDate:  row.next_service_date,
    estimatedCost:    Number(row.estimated_cost) || 0,
  };
}
export function toMaintenanceInsert({
  vehicleId, maintenanceType, lastServiceDate, nextServiceDate, estimatedCost,
}) {
  return {
    vehicle_id:         vehicleId,
    maintenance_type:   maintenanceType,
    last_service_date:  lastServiceDate || null,
    next_service_date:  nextServiceDate || null,
    estimated_cost:     Number(estimatedCost) || 0,
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
export function toPartnerInsert({ partnerName, workersCount, contactNumber, status }) {
  return {
    partner_name:    partnerName,
    workers_count:   Number(workersCount) || 0,
    contact_number:  contactNumber || null,
    status:          status || 'active',
  };
}
export function toPartnerUpdate({ partnerName, workersCount, contactNumber, status }) {
  const payload = {};
  if (partnerName    !== undefined) payload.partner_name   = partnerName;
  if (workersCount   !== undefined) payload.workers_count  = Number(workersCount) || 0;
  if (contactNumber  !== undefined) payload.contact_number = contactNumber || null;
  if (status         !== undefined) payload.status         = status;
  return payload;
}
