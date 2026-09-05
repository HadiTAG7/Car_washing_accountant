import { describe, expect, it } from 'vitest';
import { monthOf, listAvailableMonths, variableItemsForMonth } from '../variableExpenseTotals';
import { reconciliationRows } from '../sweater/dashboard';
import { formatCurrency } from '../../data/initialData';

describe('financial display regressions', () => {
  it('combines valid padded and legacy dates without losing rows or duplicating August', () => {
    const manualItems = [
      { id: 'a', loggedDate: '2026-8-2', totalVariableCost: 965 },
      { id: 'b', loggedDate: '2026-08-03', totalVariableCost: 5259 },
    ];
    expect(listAvailableMonths([], manualItems).filter((month) => month === '2026-08')).toHaveLength(1);
    const rows = variableItemsForMonth({ manualItems, selectedMonth: '2026-08' });
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(rows.reduce((sum, row) => sum + row.totalVariableCost, 0)).toBe(6224);
  });
  it('keeps missing and impossible dates in an explicit review group', () => {
    const invalidDates = ['', '2026-02-30', '2026-13-1', '2026-8-', 'garbage'];
    invalidDates.forEach((date) => expect(monthOf(date)).toBe(''));
    expect(monthOf('2024-2-29')).toBe('2024-02');
    const manualItems = invalidDates.map((loggedDate, id) => ({ id, loggedDate }));
    expect(variableItemsForMonth({ manualItems, selectedMonth: '__invalid__' })).toHaveLength(5);
    expect(variableItemsForMonth({ manualItems: [{ id: 'invalid-dynamic', categoryId: 'dynamic', loggedDate: '' }], categories: [{ id: 'dynamic', isDynamic: true }], selectedMonth: '__invalid__' })).toHaveLength(1);
  });
  it('does not claim matching before calculation even if a zero statement exists', () => {
    const rows = reconciliationRows({ statement: { statedNetDue: 0 }, invoiceGross: null });
    expect(rows[0].value).toBeNull();
    expect(rows.every((row) => row.matches === null)).toBe(true);
    expect(rows[1].value).toBe(0);
    expect(rows[2].value).toBeNull();
  });
  it('matches genuine zero values only when their sources exist', () => {
    const rows = reconciliationRows({ figures: { netDue: 0 }, statement: { statedNetDue: 0 }, invoiceGross: 0, collectedTotal: 0, status: 'collected' });
    expect(rows.slice(1).every((row) => row.matches === true)).toBe(true);
    expect(rows[0].matches).toBeNull();
  });
  it('preserves cents and the sign of large balances', () => {
    expect(formatCurrency(120.87)).toContain('120.87');
    expect(formatCurrency(-2095997.13)).toContain('2,095,997.13');
    expect(formatCurrency(-2095997.13)).toContain('-');
  });
});
