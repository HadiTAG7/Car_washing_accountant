import { reviewLines } from '../../../functions/src/sweater/settlementReadiness.js';
export function reviewGroups(figures) {
  const groups = new Map();
  for (const row of reviewLines(figures)) {
    const key = row.reasonCode || 'other';
    if (!groups.has(key)) groups.set(key, { key, rows: [], reason: row.reasonAr, href: '#settlement-bookings' });
    groups.get(key).rows.push(row);
  }
  for (const group of groups.values()) if (['no_recognition_policy', 'unknown_service_type', 'no_price_for_date', 'unknown_status', 'incomplete_coverage'].includes(group.key)) group.href = 'https://app.hadialghanim.com/?page=sweater_integration';
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}
export function dataPeriods(firstPeriod, periods, current) {
  const valid = x => /^\d{4}-(0[1-9]|1[0-2])$/.test(x || '');
  const known = [firstPeriod, ...periods].filter(valid).sort();
  if (!known.length) return [current];
  const last = [current, ...known].filter(valid).sort().at(-1);
  const result = [];
  for (let date = new Date(`${known[0]}-01T00:00:00Z`); date.toISOString().slice(0, 7) <= last; date.setUTCMonth(date.getUTCMonth() + 1)) result.push(date.toISOString().slice(0, 7));
  return result.reverse();
}
export const METRIC_ADJUSTMENT_KEYS = {
  violations: ['operational_or_traffic_violation'], damages: ['proven_damage'], compensations: ['customer_compensation'],
  freeWashCompensation: ['free_wash_compensation'], cancelledByCustomer: ['cancelled_by_customer'],
  cancelledByBiker: ['cancelled_by_biker'], cancelledMaintenance: ['cancelled_maintenance'],
};
export function registeredMetric(adjustments, key, unit) {
  const rows = adjustments.filter(a => METRIC_ADJUSTMENT_KEYS[key]?.includes(a.typeKey));
  const amount = Math.round(rows.reduce((sum, a) => sum + (Number(a.amount) || 0), 0) * 100) / 100;
  if (unit === 'sar') return { value: amount, records: rows.length, amount };
  const counted = rows.every(a => typeof a.quantity === 'number' && Number.isInteger(a.quantity) && a.quantity >= 0);
  return { value: counted ? rows.reduce((sum, a) => sum + a.quantity, 0) : null, records: rows.length, amount };
}
