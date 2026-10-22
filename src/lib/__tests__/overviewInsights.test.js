import { describe, expect, it } from 'vitest';
import { overviewOperations } from '../overviewDashboard';
import { overviewBusinessMetrics, overviewSettlements, overviewAttention, parseMetabaseCount } from '../overviewInsights';
import { OVERVIEW_SETTINGS } from '../../config/overviewSettings';

const wash = (id, date, quantity = 1, bikerId = 'b1') => ({ id, washDate: date, status: 'مكتملة', quantity, bikerId });
const operations = (washes, today = '2026-10-21', periodKey = '2026-10', bikers = []) => overviewOperations({ washes, today, periodKey, bikers });
const statement = { totalCosts: 30036.57, netRevenue: 7640, salaryAccrual: { estimated: true } };
const biker = { id: 'b1', driverExternalId: '1984', name: 'Test', currentStatus: 'working', iqamaExpiry: '2026-11-20' };

describe('overview-only business metrics', () => {
  it('recomputes owner reference numbers from fixtures, never production defaults', () => {
    const rows = [wash('early', '2026-10-13', 166), ...[29, 33, 25, 44, 36, 20, 29].map((quantity, i) => wash(`d${i}`, `2026-10-${14 + i}`, quantity))];
    const ops = operations(rows);
    const m = overviewBusinessMetrics(ops, statement);
    expect(ops.quantity).toBe(382);
    expect(m.costPerWash).toBeCloseTo(78.629764, 5);
    expect(m.monthlyRequired).toBe(1502); expect(m.dailyRequired).toBeCloseTo(48.45161, 4);
    expect(m.remainingWashes).toBe(1120);
    expect(m.recentAverage).toBeCloseTo(30.857142, 5); expect(m.remainingDays).toBe(11);
    expect(m.forecastQuantity).toBeCloseTo(721.428571, 5);
    expect(m.forecastRevenue).toBeCloseTo(14428.5714, 3); expect(m.estimated).toBe(true);
  });
  it('excludes the incomplete day from every average and does not double-count it in a forecast', () => {
    const base = [wash('old', '2026-10-19', 20), wash('yesterday', '2026-10-20', 29)];
    const before = operations(base), after = operations([...base, wash('today', '2026-10-21', 2, 'b2')]);
    expect(after.average).toBe(before.average); expect(after.averagePerBikerDay).toBe(before.averagePerBikerDay);
    expect(after.working).toBe(2); expect(after.daily.at(-1).incomplete).toBe(true);
    expect(overviewBusinessMetrics(after, statement).forecastQuantity).toBe(overviewBusinessMetrics(before, statement).forecastQuantity);
    // Actuals never disappear if today's activity exceeds its forecast.
    expect(overviewBusinessMetrics(operations([...base, wash('today', '2026-10-21', 100)]), statement).forecastQuantity).toBeGreaterThanOrEqual(149);
  });
  it('closed months show actuals and do not include yesterday from a different month', () => {
    const ops = operations([wash('oct', '2026-10-31', 2), wash('nov', '2026-11-01', 9)], '2026-11-02');
    const m = overviewBusinessMetrics(ops, { ...statement, netRevenue: 40 });
    expect(m.forecastQuantity).toBe(2); expect(m.forecastRevenue).toBe(40);
    expect(ops.yesterdayQuantity).toBeNull(); expect(ops.yesterdayRows).toEqual([]);
    expect(m.lastDay).toBe('2026-10-31'); expect(m.statementDate).toBe('2026-11-05');
  });
  it('preserves no data, zero denominators and first-of-month uncertainty', () => {
    const ops = operations([], '2026-10-01');
    expect(ops.previousQuantity).toBeNull(); expect(ops.hasPreviousData).toBe(false);
    const m = overviewBusinessMetrics(ops, null);
    expect(m.forecastQuantity).toBeNull(); expect(m.monthlyRequired).toBeNull(); expect(m.costPerWash).toBeNull();
    expect(overviewBusinessMetrics(null, statement)).toBeNull();
    expect(overviewBusinessMetrics(ops, { totalCosts: 0 }).monthlyRequired).toBe(0);
  });
  it('reads assumptions from one settings object and respects leap months', () => {
    const ops = operations([wash('a', '2024-02-28', 2)], '2024-02-29', '2024-02');
    expect(overviewBusinessMetrics(ops, { totalCosts: 300 }, { ...OVERVIEW_SETTINGS, washNetPrice: 30 }).monthlyRequired).toBe(10);
    expect(overviewBusinessMetrics(ops, statement).monthDays).toBe(29);
  });
  it('uses exactly the existing daily biker average for approximate capacity, without capping or inventing missing averages', () => {
    const ops = operations([wash('a', '2026-10-20', 1)]);
    expect(overviewBusinessMetrics({ ...ops, averagePerBikerDay: 4.84 }, statement).capacityUtilization).toBeCloseTo(48.4);
    expect(overviewBusinessMetrics({ ...ops, averagePerBikerDay: null }, statement).capacityUtilization).toBeNull();
    expect(overviewBusinessMetrics({ ...ops, averagePerBikerDay: 12 }, statement).capacityUtilization).toBe(120);
    expect(overviewBusinessMetrics(ops, statement, { ...OVERVIEW_SETTINGS, dailyAppointmentsPerBiker: 0 }).capacityUtilization).toBeNull();
    expect(overviewBusinessMetrics({ ...ops, averagePerBikerDay: 4.84 }, statement, { ...OVERVIEW_SETTINGS, dailyAppointmentsPerBiker: 20 }).capacityUtilization).toBeCloseTo(24.2);
  });
  it('counts only real workers with washes, not registry activity', () => {
    const ops = operations([wash('actual', '2026-10-20', 1, 'inactive')], '2026-10-21', '2026-10', [biker]);
    expect(ops.working).toBe(1); expect(ops.workingIds).toEqual(['inactive']);
  });
});

describe('source-based Sweater deductions and payments', () => {
  const adjustment = { id: 'a', kind: 'deduction', typeKey: 'customer_compensation', amount: 25, approvalStatus: 'approved', effectiveDate: '2026-10-10', periodKey: '2026-10' };
  it('counts approved customer compensation once, not platform compensation credits or settlement summary duplicates', () => {
    const result = overviewSettlements({ periodKey: '2026-10', to: '2026-10-21', adjustments: [adjustment, adjustment,
      { ...adjustment, id: 'pending', amount: 50, approvalStatus: 'pending_review' },
      { ...adjustment, id: 'credit', amount: 90, kind: 'compensation' },
      { ...adjustment, id: 'future', effectiveDate: '2026-10-22' },
      { ...adjustment, id: 'prior', effectiveDate: '2026-09-30', periodKey: '2026-09' }],
    settlements: [{ periodKey: '2026-10', figures: { deductions: 25, netDue: 500 }, collectedTotal: 100 }] });
    expect(result.deductionTotal).toBe(25); expect(result.pendingTotal).toBe(50);
    expect(result.expected).toBe(500); expect(result.remaining).toBe(400);
  });
  it('does not infer missing financial fields as zero', () => {
    const result = overviewSettlements({ periodKey: '2026-10', to: '2026-10-21' });
    expect(result.expected).toBeNull(); expect(result.collected).toBeNull(); expect(result.remaining).toBeNull();
    expect(result.deductionTotal).toBeNull(); expect(result.deductionRecordCount).toBe(0);
    expect(overviewSettlements({ periodKey: '2026-10', to: '2026-10-21', adjustments: [{ ...adjustment, amount: 0 }] }).deductionTotal).toBe(0);
    expect(overviewSettlements({ periodKey: '2026-10', to: '2026-10-21', adjustments: [{ ...adjustment, amount: null }] }).deductionTotal).toBeNull();
    expect(overviewSettlements({ periodKey: '2026-10', to: '2026-10-21', settlements: [{ periodKey: '2026-10' }, { periodKey: '2026-10' }] }).ambiguous).toBe(true);
    expect(overviewSettlements({ periodKey: '2026-10', to: '2026-10-21', adjustments: [adjustment, { ...adjustment, amount: 30 }] }).deductionTotal).toBeNull();
  });
});

describe('evidenced, month-scoped attention items', () => {
  const booking = { record: { sspBookingId: 'SSP', serviceDate: '2026-10-20', driverExternalId: '1984', startedAt: '2026-10-20T06:00:00Z', completedAt: '2026-10-20T06:09:00Z' } };
  const ops = () => operations([{ ...wash('local', '2026-10-20'), sspBookingId: 'SSP' }]);
  it('links persisted timestamps to a real completed wash; does not infer them from owner completion', () => {
    const a = overviewAttention({ ops: ops(), bikers: [biker], bookings: [booking, booking], today: '2026-10-21' });
    expect(a.shortWashes).toHaveLength(1); expect(a.shortWashes[0]).toMatchObject({ duration: 9, biker });
    expect(a.iqamas).toHaveLength(1); expect(a.iqamas[0].daysLeft).toBe(30);
    // b1 washed yesterday (the last completed day); today is still running.
    expect(a.idle).toEqual([]);
    expect(overviewAttention({ ops: ops(), bookings: [{ record: { ...booking.record, startedAt: null } }], today: '2026-10-21' }).shortWashes).toEqual([]);
  });
  it('omits unlinked, invalid, negative, date-only and conflicting timestamps', () => {
    for (const completedAt of [null, 'bad', '2026-10-20', '2026-10-20T05:59:00Z']) {
      expect(overviewAttention({ ops: ops(), bookings: [{ record: { ...booking.record, completedAt } }], today: '2026-10-21' }).shortWashes).toEqual([]);
    }
    const a = overviewAttention({ ops: ops(), bookings: [booking, { record: { ...booking.record, completedAt: '2026-10-20T06:05:00Z' } }], today: '2026-10-21' });
    expect(a.shortWashes).toEqual([]); expect(a.conflictingBookings).toBe(1);
    expect(overviewAttention({ ops: operations([]), bookings: [booking], today: '2026-10-21' }).shortWashes).toEqual([]);
    expect(overviewAttention({ ops: ops(), bookings: [{ record: { ...booking.record, serviceDate: '2026-10-19' } }], today: '2026-10-21' }).shortWashes).toEqual([]);
    expect(overviewAttention({ ops: ops(), bookings: [{ record: { ...booking.record, serviceDate: null } }], today: '2026-10-21' }).shortWashes).toEqual([]);
  });
  it('does not invent expiry or idle history from today’s roster', () => {
    expect(overviewAttention({ ops: operations([], '2026-11-21'), today: '2026-11-21', bikers: [biker] }).idle).toEqual([]);
    const a = overviewAttention({ ops: ops(), today: '2026-10-21', bikers: [{ ...biker, iqamaExpiry: '2026-99-99' }, { ...biker, id: 'b2', iqamaExpiry: '' }] });
    expect(a.iqamas).toEqual([]); expect(a.missingIqama).toBe(2);
  });
  it('does not call a worker idle when wash identities cannot establish absence', () => {
    const a = overviewAttention({ ops: operations([wash('unlinked', '2026-10-20', 1, null)]), today: '2026-10-21', bikers: [biker] });
    expect(a.idle).toEqual([]);
  });
  it('checks yesterday only — the last completed day, never the running one', () => {
    const today = '2026-10-21'; const yesterday = '2026-10-20';
    const idle = (washes, bikers = [biker], day = today) => overviewAttention({ ops: operations(washes, day), today: day, bikers }).idle;
    // No wash yesterday: flagged, dated yesterday.
    expect(idle([])).toEqual([{ biker, dates: [yesterday] }]);
    // Washed yesterday, nothing yet today: not flagged.
    expect(idle([wash('y', yesterday)])).toEqual([]);
    // Washed today only: flagged for yesterday, and today never appears.
    expect(idle([wash('t', today)])).toEqual([{ biker, dates: [yesterday] }]);
    // The first of the month: yesterday is outside the selected month.
    expect(idle([], [biker], '2026-10-01')).toEqual([]);
    // Not on the roster yesterday: started today, or ended before yesterday.
    expect(idle([], [{ ...biker, startDate: today }])).toEqual([]);
    expect(idle([], [{ ...biker, endDate: '2026-10-19' }])).toEqual([]);
    // Another biker's wash yesterday does not cover this one.
    expect(idle([wash('other', yesterday, 3, 'b2')])).toEqual([{ biker, dates: [yesterday] }]);
  });
});

it.each([['', null], ['0', 0], ['٣٨٢', 382], ['۳۸۲', 382], [' 382 ', 382], ['-1', null], ['1.5', null], ['abc', null], ['9007199254740992', null]])('validates manual Metabase input %s', (value, expected) => {
  expect(parseMetabaseCount(value)).toBe(expected);
});
