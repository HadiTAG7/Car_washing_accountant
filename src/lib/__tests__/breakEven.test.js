import { describe, expect, it } from 'vitest';
import { bikerBreakEven, coverageTone, dailyBreakEven, dailyBreakEvenDays } from '../breakEven';
import { OVERVIEW_SETTINGS } from '../../config/overviewSettings';

const line = (bikerId, basicDue, daysEntitled = 31, extra = {}) => ({ bikerId, name: bikerId, basicDue, bonus: 0, deduction: 0, daysEntitled, monthDays: 31, ...extra });
const wash = (bikerId, washDate, quantity = 1) => ({ bikerId, washDate, quantity });

describe('daily break-even', () => {
  it('is the statement’s costs ÷ net wash price ÷ calendar days', () => {
    const d = dailyBreakEven({ statement: { totalCosts: 30036.57 }, periodKey: '2026-10', completeMonth: false });
    expect(d.required).toBeCloseTo(30036.57 / 20 / 31, 10);
    expect(d.required.toFixed(2)).toBe('48.45');
    expect(d).toMatchObject({ costs: 30036.57, monthDays: 31, price: OVERVIEW_SETTINGS.washNetPrice, basis: 'month_to_date' });
    expect(dailyBreakEven({ statement: { totalCosts: 600 }, periodKey: '2026-09', completeMonth: true })).toMatchObject({ required: 1, monthDays: 30, basis: 'month' });
  });
  it('has no line without confirmed costs', () => {
    expect(dailyBreakEven({ statement: null, periodKey: '2026-10' })).toBeNull();
    expect(dailyBreakEven({ statement: { totalCosts: -1 }, periodKey: '2026-10' })).toBeNull();
  });
  it('counts completed days at or above the line and the average gap; today is neither', () => {
    const days = dailyBreakEvenDays([{ quantity: 50 }, { quantity: 40 }, { quantity: 45 }, { quantity: 2, incomplete: true }], 45);
    expect(days.completed).toBe(3); expect(days.reached).toBe(2);
    expect(days.averageGap).toBeCloseTo((5 - 5 + 0) / 3, 10);
    expect(days.days.map(d => d.reached)).toEqual([true, false, true, null]);
    expect(dailyBreakEvenDays([], null)).toBeNull();
  });
});

describe('break-even per biker', () => {
  const statement = { totalCosts: 3000 };
  it('direct costs are each biker’s payroll line; the rest is shared equally per eligible day and adds up to the total', () => {
    const r = bikerBreakEven({ statement, payrollLines: [line('a', 900), line('b', 900), line('c', 900)], periodKey: '2026-10', today: '2026-11-01' });
    expect(r.directTotal).toBe(2700); expect(r.shared).toBe(300);
    expect(r.rows.map(x => x.share)).toEqual([100, 100, 100]);
    expect(r.allocatedTotal).toBe(3000); expect(r.difference).toBe(0);
    const a = r.rows[0];
    expect(a.requiredMonthly).toBeCloseTo(1000 / 20, 10);
    expect(a.workDays).toBe(29);
    expect(a.requiredDaily).toBeCloseTo(50 / 29, 10);
  });
  it('apportions in halalas so an awkward total still reconciles exactly', () => {
    const r = bikerBreakEven({ statement: { totalCosts: 100.01 }, payrollLines: [line('a', 0.01), line('b', 0.01), line('c', 0.01)], periodKey: '2026-10' });
    expect(r.rows.reduce((s, x) => s + Math.round(x.share * 100), 0)).toBe(9998);
    expect(r.allocatedTotal).toBe(100.01); expect(r.difference).toBe(0);
  });
  it('prorates the shared costs and the work days for a biker who starts mid-month', () => {
    const r = bikerBreakEven({ statement: { totalCosts: 900 + 232.26 + 390 }, payrollLines: [line('full', 900), line('late', 232.26, 8)], periodKey: '2026-10' });
    const [full, late] = r.rows;
    expect(late.share / full.share).toBeCloseTo(8 / 31, 2);
    expect(full.share + late.share).toBe(390);
    expect(late.workDays).toBeCloseTo(29 * 8 / 31, 10);
    expect(r.rows.every(x => x.approximate === false)).toBe(true);
  });
  it('a biker with no recorded direct cost uses the average per eligible day, marked approximate and kept out of the reconciliation', () => {
    const r = bikerBreakEven({ statement: { totalCosts: 1900 }, payrollLines: [line('paid', 900), line('none', 0)], periodKey: '2026-10' });
    const none = r.rows.find(x => x.bikerId === 'none');
    expect(none.approximate).toBe(true); expect(none.approxDirect).toBe(900);
    expect(none.cost).toBe(900 + none.share);
    expect(r.approximateTotal).toBe(900);
    expect(r.allocatedTotal).toBe(1900); expect(r.difference).toBe(0);
  });
  it('actual = washes on completed days ÷ the days the biker washed; coverage tone; over capacity', () => {
    const lines = [line('a', 900), line('b', 900), line('c', 60000)];
    const washes = [wash('a', '2026-10-01', 2), wash('a', '2026-10-02', 2), wash('a', '2026-10-05', 9), wash('b', '2026-10-01', 1), wash('', '2026-10-01', 3)];
    const r = bikerBreakEven({ statement: { totalCosts: 61800 }, payrollLines: lines, washes, periodKey: '2026-10', today: '2026-10-05' });
    const [a, b, c] = r.rows;
    expect([a.washes, a.washDays, a.actualDaily]).toEqual([4, 2, 2]);
    expect(a.coverage).toBeCloseTo(2 / a.requiredDaily, 10);
    expect([b.actualDaily, c.washes, c.actualDaily, c.coverage, c.tone]).toEqual([1, 0, null, 0, 'red']);
    expect(c.overCapacity).toBe(true); expect(a.overCapacity).toBe(false);
    expect(r.unlinkedWashes).toBe(3);
  });
  it('lists bikers who washed but have no eligible payroll days, with no cost', () => {
    const r = bikerBreakEven({ statement, payrollLines: [line('a', 900)], washes: [wash('x', '2026-10-01', 4)], periodKey: '2026-10' });
    expect(r.outside).toEqual([{ bikerId: 'x', biker: null, name: 'x', washes: 4, washDays: 1 }]);
  });
  it('refuses an unknown allocation method and an incomplete payroll line', () => {
    expect(() => bikerBreakEven({ statement, payrollLines: [line('a', 900)], periodKey: '2026-10', settings: { ...OVERVIEW_SETTINGS, fixedCostAllocation: 'revenue' } })).toThrow(/allocation/);
    expect(bikerBreakEven({ statement, payrollLines: [line('a', null)], periodKey: '2026-10' })).toEqual({ error: 'payroll_incomplete' });
    expect(bikerBreakEven({ statement: null, payrollLines: [], periodKey: '2026-10' })).toBeNull();
  });
  it('coverage tones: green from 100%, yellow 80–99%, red below 80%', () => {
    expect([coverageTone(1), coverageTone(1.5), coverageTone(0.99), coverageTone(0.8), coverageTone(0.79), coverageTone(null)])
      .toEqual(['green', 'green', 'yellow', 'yellow', 'red', null]);
  });
});
