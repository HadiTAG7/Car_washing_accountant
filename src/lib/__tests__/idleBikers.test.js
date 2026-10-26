import { describe, it, expect } from 'vitest';
import { idleBikers } from '../idleBikers';
const month = '2026-10', today = '2026-10-26';
const biker = (id, patch = {}) => ({ id, name: id, currentStatus: 'يشتغل', startDate: '2026-10-01', ...patch });
const line = (id, patch = {}) => ({ bikerId: id, basicDue: 900, daysEntitled: 31, eligibleStart: '2026-10-01', eligibleEnd: '2026-10-31', ...patch });
const wash = (id, date, patch = {}) => ({ id: `${id}-${date}`, bikerId: id, washDate: date, quantity: 1, status: 'مكتملة', ...patch });
const calculate = (patch = {}) => idleBikers({ bikers: [biker('zero'), biker('stopped'), biker('working')],
  payrollLines: ['zero', 'stopped', 'working'].map(id => line(id)),
  washes: [wash('stopped', '2026-10-22'), wash('working', '2026-10-25')], statement: { totalCosts: 30036.57 }, periodKey: month, today, ...patch });

describe('idle roster uses completed days and preserves payroll', () => {
  it('counts zero washes and exactly three complete wash-free days, excluding today', () => {
    const r = calculate(); expect(r.rows.map(row => row.bikerId).sort()).toEqual(['stopped', 'zero']);
    expect(r.rows.find(row => row.bikerId === 'stopped')).toMatchObject({ category: 'stopped', silentDays: 3 });
    expect(r.salaries).toBe(1800); expect(r.dailyRequired).toBeCloseTo(30036.57 / 20 / 31);
    expect(r.dailyWithout).toBeCloseTo((30036.57 - 1800) / 20 / 31);
    expect(calculate({ washes: [wash('zero', today), wash('stopped', '2026-10-23'), wash('working', '2026-10-25')] }).rows.map(row => row.bikerId)).toEqual(['zero']);
  });
  it('excludes departed variants, end dates, missing roster, and people not on payroll', () => {
    const bikers = [biker('zero'), biker('working', { endDate: '2026-10-30' }), biker('run', { currentStatus: 'هرب مع الشريحة' }), biker('left', { currentStatus: 'مشيناه' }), biker('not_paid')];
    const r = calculate({ bikers, payrollLines: ['zero', 'working', 'run', 'left', 'deleted'].map(id => line(id)), washes: [] });
    expect(r.rows.map(row => row.bikerId)).toEqual(['zero']); expect(r.excluded).toHaveLength(4);
    expect(r.legacyZero.count).toBe(5);
  });
  it('does not mistake duplicate, cancelled, unlinked or another biker washes for work', () => {
    const r = calculate({ washes: [wash('zero', '2026-10-24', { status: 'ملغاة' }), wash(null, '2026-10-24'),
      wash('stopped', '2026-10-22', { sspBookingId: 'A-1' }), wash('stopped', '2026-10-22', { sspBookingId: 'A-1' }), wash('working', '2026-10-25')] });
    expect(r.rows.find(row => row.bikerId === 'stopped').washes).toBe(1);
    const conflict = calculate({ washes: [wash('zero', '2026-10-24', { sspBookingId: 'A-1' }), wash('working', '2026-10-24', { sspBookingId: 'A-1' })] });
    expect(conflict.error).toBe('wash_conflict'); expect(conflict.rows).toEqual([]);
  });
  it('retains a prior-month last wash, and calculates no-history days from real joining date', () => {
    const r = calculate({ historyComplete: true, bikers: [biker('zero', { startDate: '2026-08-01' }), biker('stopped'), biker('working')],
      washes: [wash('zero', '2026-09-20'), wash('stopped', '2026-10-22'), wash('working', '2026-10-25')] });
    expect(r.rows.find(row => row.bikerId === 'zero')).toMatchObject({ category: 'no_washes', lastWash: '2026-09-20', silentDays: 35 });
    expect(calculate({ historyComplete: true, bikers: [biker('zero', { startDate: '2026-08-01' })] }).rows[0].silentDays).toBe(86);
  });
  it('uses prorated payroll and excludes future starters until a complete eligible day exists', () => {
    const r = calculate({ bikers: [biker('zero', { startDate: '2026-10-24' }), biker('future', { startDate: '2026-10-27' })],
      payrollLines: [line('zero', { basicDue: 232.26, daysEntitled: 8, eligibleStart: '2026-10-24' }), line('future', { basicDue: 145.16, daysEntitled: 5, eligibleStart: '2026-10-27' })], washes: [] });
    expect(r.count).toBe(1); expect(r.rows[0]).toMatchObject({ monthlyCost: 232.26, costToDate: 58.07, silentDays: 2 });
    expect(r.excluded[0].reason).toBe('not_started');
  });
  it('flags missing reason, missed expected start and more than fourteen complete days', () => {
    const r = calculate({ bikers: [biker('zero', { idleFollowup: { expectedStartDate: '2026-10-23' } }), biker('stopped', { idleFollowup: { reasonKey: 'training', expectedStartDate: '2026-10-22' } }), biker('working')] });
    expect(r.alerts).toEqual({ missingReason: 1, overdue: 1, over14Days: 1 });
    expect(calculate({ today: '2026-10-15', washes: [] }).alerts.over14Days).toBe(0);
  });
  it('forecasts only remaining scheduled days using working riders and marks unavailable when none worked', () => {
    const r = calculate(); const f = r.forecast;
    expect(f.workingCount).toBe(1); expect(f.average).toBeCloseTo(1 / (25 * 29 / 31));
    expect(f.additionalWashes).toBeCloseTo(f.average * 2 * 6 * 29 / 31);
    expect(f.additionalRevenue).toBeCloseTo(f.additionalWashes * 20);
    expect(calculate({ washes: [] }).forecast.additionalWashes).toBeNull();
  });
  it('does not invent zero salary or split duplicate payroll lines', () => {
    expect(calculate({ payrollLines: [line('zero', { basicDue: null })] }).error).toBe('payroll_incomplete');
    expect(calculate({ payrollLines: [line('zero'), line('zero')] }).error).toBe('duplicate_payroll');
  });
});
