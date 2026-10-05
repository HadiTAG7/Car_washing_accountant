import { WASH_COMMISSION_RATE, WASH_COMMISSION_EFFECTIVE_MONTH } from '../../../functions/src/washCommission.js';
export function summarizeOwnerWashes(washes) {
  const groups = new Map();
  const seen = new Set();
  for (const wash of washes) {
    if (wash.revenueOrigin !== 'sweater' || wash.collectionStatus !== 'confirmed_by_owner'
      || wash.status !== 'مكتملة' || !wash.sspBookingId || seen.has(wash.sspBookingId)) continue;
    seen.add(wash.sspBookingId);
    const key = wash.bikerId || wash.bikerName;
    const group = groups.get(key) || { bikerId: wash.bikerId, bikerName: wash.bikerName,
      quantity: 0, totalAmount: 0, commission: 0, washes: [] };
    group.quantity += wash.quantity;
    group.totalAmount += wash.quantity * wash.price;
    group.commission += wash.quantity * (String(wash.washDate || '').slice(0, 7) >= WASH_COMMISSION_EFFECTIVE_MONTH ? WASH_COMMISSION_RATE : (wash.workerCommissionPerWash ?? 0));
    group.washes.push(wash);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group,
    totalAmount: Math.round(group.totalAmount * 100) / 100,
    commission: Math.round(group.commission * 100) / 100 }));
}
