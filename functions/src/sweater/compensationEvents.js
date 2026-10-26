import { SWEATER_METRICS, validEventDetails, validDeductionDetails, validCountDetails } from './metricsContract.js';

// Normalize only this reading. Never attach old details to newer aggregates.
export function compensationGroup(reading, key) {
  const total = reading.metrics?.[key];
  if (validEventDetails(reading.eventDetails, reading.eventCoverage, reading.metrics, reading.periodKey)) {
    const coverage = reading.eventCoverage.find(c => c.metricKey === key);
    if (coverage) return { ...coverage, rows: reading.eventDetails.filter(r => r.metricKey === key), legacy: false };
  }
  if (['violations', 'damages', 'compensations'].includes(key)
    && validDeductionDetails(reading.deductionDetails, reading.metrics, reading.periodKey)) {
    const rows = reading.deductionDetails.filter(r => r.metricKey === key).map(({ category, ...r }) => ({ ...r, reason: category, time: null, quantity: 1 }));
    return { metricKey: key, rows, complete: true, totalRows: rows.length, legacy: true };
  }
  if (validCountDetails(reading.countDetails, reading.metrics, reading.periodKey)
    && ['freeWashCompensation', 'cancelledByBiker', 'cancelledMaintenance'].includes(key)) {
    const rows = reading.countDetails.filter(r => r.metricKey === key).map(r => ({ ...r, time: null }));
    const complete = rows.reduce((s, r) => s + r.quantity, 0) === total;
    return { metricKey: key, rows, complete, totalRows: complete ? rows.length : null, legacy: true };
  }
  return null;
}

export const OBJECTION_STATUSES = Object.freeze([
  ['unseen', 'ما انعرض عليه'], ['submitted', 'اعترضنا'], ['accepted', 'قُبل'], ['rejected', 'رُفض'],
]);
export const COMPENSATION_LABELS = Object.freeze({ violations: 'المخالفات', damages: 'الأضرار والحوادث المسجلة',
  compensations: 'التعويضات', freeWashCompensation: 'الغسلات المجانية', cancelledByBiker: 'إلغاء البايكر',
  cancelledMaintenance: 'إلغاء الصيانة', cancelledByCustomer: 'إلغاء العميل (إضافة)' });

export function objectionDeadline(row, deadlineDays, today, status = 'unseen') {
  if (!row.date || !Number.isInteger(deadlineDays) || deadlineDays < 1 || deadlineDays > 365) return null;
  const due = new Date(`${row.date}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + deadlineDays);
  const dueDate = due.toISOString().slice(0, 10), days = Math.round((due - new Date(`${today}T00:00:00Z`)) / 86400000);
  return { dueDate, days, tone: ['accepted', 'rejected'].includes(status) ? '' : days < 0 ? 'red' : days <= Math.min(2, deadlineDays) ? 'yellow' : '' };
}

export function groupAmount(group, total, key) {
  if (SWEATER_METRICS[key].unit === 'sar') return total ?? null;
  return group?.complete && group.rows.every(r => r.amount !== null)
    ? Math.round(group.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100 : null;
}
