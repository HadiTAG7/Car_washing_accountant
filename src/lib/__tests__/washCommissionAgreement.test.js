import { expect, it } from 'vitest';
import { washStatsFor } from '../bikerStats';
import { variableItemsForMonth, sumCompletedWashQuantityInMonth } from '../variableExpenseTotals';
import { summarizeOwnerWashes } from '../sweater/washSummary';
import { calculatePayrollPreview } from '../../../functions/src/payroll.js';
const month = '2026-10';
const bikers = ['Ajith', 'Mahin', 'Safi'].map(name => ({ id: name, name, salary: 1000, start_date: '2026-10-01' }));
const wash = (name, i, extra = {}) => ({ id: `${name}-${i}`, bikerId: name, bikerName: name, quantity: 1,
  washDate: '2026-10-03', status: 'مكتملة', sspBookingId: `${name}-${i}`, revenueOrigin: 'sweater',
  collectionStatus: 'confirmed_by_owner', workerCommissionPerWash: 4, price: 23, ...extra });
const raw = rows => rows.map(w => ({ ...w, biker_id: w.bikerId, biker_name: w.bikerName, wash_date: w.washDate, ssp_booking_id: w.sspBookingId }));
it('roster, wash summary, automatic expenses and draft agree on10/1/1→45/4.5/4.5, independent of VAT', () => {
  const rows = [...Array.from({ length: 10 }, (_, i) => wash('Ajith', i)), wash('Mahin', 0), wash('Safi', 0)];
  const polluted = [...rows, { ...rows[0], id: 'duplicate' }, wash('Ajith', 11, { status: 'ملغاة' }),
    wash('Ajith', 12, { status: 'قيد التنفيذ' }), wash('Ajith', 13, { washDate: '2026-09-30' })];
  const roster = bikers.map(b => washStatsFor(b.name, polluted, month, undefined, b.id).commission);
  expect(roster).toEqual([45, 4.5, 4.5]);
  const summary = summarizeOwnerWashes(polluted.filter(w => w.washDate.startsWith(month)));
  expect(summary.map(g => g.commission)).toEqual(roster);
  const p = calculatePayrollPreview({ periodKey: month, bikers, washes: raw(polluted), automaticAdvanceDeduction: true });
  expect(p.lines.map(g => g.commission)).toEqual(roster); expect(p.totals.commissions).toBe(54);
  expect(sumCompletedWashQuantityInMonth(polluted, month)).toBe(12);
  const expense = variableItemsForMonth({ categories: [{ id: 'commission', isDynamic: true }], selectedMonth: month, washes: polluted });
  expect(expense.reduce((s, x) => s + x.totalVariableCost, 0)).toBe(54);
  expect(calculatePayrollPreview({ periodKey: month, bikers, washes: raw(rows.map(w => ({ ...w, price: 0 }))) }).totals.commissions).toBe(54);
  rows.push(wash('Ajith', 10));
  expect(washStatsFor('Ajith', rows, month, undefined, 'Ajith').commission).toBe(49.5);
  expect(calculatePayrollPreview({ periodKey: month, bikers, washes: raw(rows) }).lines[0].commission).toBe(49.5);
});
it('a linked renamed worker uses the registry ID while legacy names remain supported', () => {
  const rows = [wash('Ajith', 0, { bikerName: 'Old spelling' }), wash('Ajith', 1, { bikerId: null })];
  expect(washStatsFor('Ajith', rows, month, undefined, 'Ajith')).toEqual({ washCount: 2, commission: 9 });
});
