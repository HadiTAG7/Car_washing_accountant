import { describe, it, expect } from 'vitest';
import { operationsToday, operationFreshness, riyadhDayAt } from '../operationsToday.js';
import { dailyBreakEven, bikerBreakEven } from '../breakEven.js';
const biker = (id, extra = {}) => ({ id, name: id, startDate: '2026-10-01', endDate: '', driverExternalId: id, currentStatus: 'يشتغل', ...extra });
const wash = (id, day, b = 'a', quantity = 1) => ({ id, sspBookingId: id, washDate: day, bikerId: b, quantity, status: 'completed' });
const pay = id => ({ bikerId: id, basicDue: 900, daysEntitled: 31, eligibleStart: '2026-10-01', eligibleEnd: '2026-10-31' });
const base = () => ({ day: '2026-10-26', today: '2026-10-26', now: Date.parse('2026-10-26T18:00:00Z'), bikers: [biker('a'), biker('b')],
  payrollLines: [pay('a'), pay('b')], statement: { totalCosts: 30036.57 }, washes: [wash('w1', '2026-10-24'), wash('w2', '2026-10-25'), wash('w3', '2026-10-26')] });
describe('daily operations from stored records', () => {
  it('uses exact Riyadh calendar dates at midnight', () => {
    expect(riyadhDayAt('2026-10-25T21:00:00Z')).toBe('2026-10-26');
    expect(operationsToday({ ...base(), day: '2026-10-27' }).error).toBe('invalid_day');
  });
  it('counts current and prior day, keeps zero days in seven-day mean, deduplicates execution and excludes unfinished status', () => {
    const input = base(); input.washes.push(input.washes[0], { ...wash('draft', '2026-10-25'), status: 'pending' }, wash('future', '2026-10-27'));
    const r = operationsToday(input);
    expect(r.quantity).toBe(1); expect(r.yesterdayQuantity).toBe(1); expect(r.week).toHaveLength(7);
    expect(r.weeklyAverage).toBe(2 / 7); expect(r.weekFrom).toBe('2026-10-19'); expect(r.lastCompleted).toBe('2026-10-25');
    expect(r.monthQuantity).toBe(3);
  });
  it('reuses daily and biker break-even, never counts current day in available-day actual or coverage', () => {
    const input = base(), r = operationsToday(input);
    const daily = dailyBreakEven({ statement: input.statement, periodKey: '2026-10', completeMonth: false });
    const per = bikerBreakEven({ ...input, periodKey: '2026-10', today: input.today });
    expect(r.dailyRequired).toBe(daily.required);
    expect(r.rows.find(x => x.biker.id === 'a').actualDaily).toBe(per.rows[0].actualDaily);
    expect(r.rows.find(x => x.biker.id === 'a').coverage).toBe(per.rows[0].coverage);
    expect(r.remainingWashes).toBe(Math.ceil(30036.57 / 20) - 3);
    expect(r.remainingDays).toBe(6); expect(r.neededPerRemainingDay).toBe(r.remainingWashes / 6);
    expect(r.rows.find(x => x.biker.id === 'b').coverage).toBeNull();
  });
  it('selecting a completed day includes it, ignores later washes, and handles a cross-month seven-day window', () => {
    const r = operationsToday({ ...base(), day: '2026-10-01', washes: [wash('sep', '2026-09-30'), wash('oct', '2026-10-01'), wash('later', '2026-10-02')] });
    expect(r.quantity).toBe(1); expect(r.yesterdayQuantity).toBe(1); expect(r.weeklyAverage).toBe(2 / 7);
    expect(r.monthQuantity).toBe(1); expect(r.weekFrom).toBe('2026-09-25'); expect(r.lastCompleted).toBe('2026-10-01');
    expect(r.remainingDays).toBe(30);
  });
  it('marks two silent completed days, excludes departed/ended/future workers and does not penalize a new starter', () => {
    const r = operationsToday({ ...base(), bikers: [biker('a'), biker('b'), biker('left', { currentStatus: 'هرب' }), biker('ended', { endDate: '2026-10-20' }), biker('new', { startDate: '2026-10-25' }), biker('future', { startDate: '2026-10-27' })] });
    expect(r.rows.map(x => x.biker.id).sort()).toEqual(['a', 'b', 'new']);
    expect(r.rows.find(x => x.biker.id === 'a').silentTwo).toBe(false);
    expect(r.rows.find(x => x.biker.id === 'b').silentTwo).toBe(true);
    expect(r.rows.find(x => x.biker.id === 'new').silentTwo).toBe(false);
    expect(r.silentCount).toBe(1);
  });
  it('uses natural booking identity for regions, does not turn raw bookings into execution, flags unknown workers', () => {
    const r = operationsToday({ ...base(), washes: [wash('S-123', '2026-10-26', 'missing'), wash('S-124', '2026-10-25')], bookings: [
      { id: 'C-123', record: { sspBookingId: 'C-123', serviceDate: '2026-10-26', region: 'شرق' } },
      { id: 'raw-only', record: { sspBookingId: '999', serviceDate: '2026-10-26', region: 'غرب', rawStatus: 'Washing Started' } },
    ] });
    expect(r.quantity).toBe(1); expect(r.unlinkedCount).toBe(1);
    expect(r.regions).toEqual([{ region: 'شرق', today: 1, week: 0 }, { region: 'غير محددة', today: 0, week: 1 }]);
  });
  it('keeps absent cancellation attribution unavailable, partial positives labelled, and admin cancellation unrelated', () => {
    const input = base(); input.bookings = [{ record: { sspBookingId: '22', serviceDate: '2026-10-25', driverExternalId: 'a', rawStatus: 'Cancelled by Admin' } }];
    expect(operationsToday(input).rows.find(r => r.biker.id === 'a').cancellationCount).toBeNull();
    input.bookings.push({ record: { sspBookingId: '23', serviceDate: '2026-10-24', driverExternalId: 'a', rawStatus: 'Biker Refused Wash' } });
    const r = operationsToday(input).rows.find(r => r.biker.id === 'a'); expect(r.cancellationCount).toBe(1); expect(r.cancellationPartial).toBe(true);
  });
  it('compares an appropriate monthly snapshot through its dated scope, never a later snapshot to an older selected day', () => {
    const input = { ...base(), bookings: [{record:{sspBookingId:'w2',serviceDate:'2026-10-25',completedAt:'2026-10-25T12:00:00+03:00'}}], snapshot: { metrics: { completedWashes: 10 }, metricSources: { completedWashes: { extractedAtIso: '2026-10-25T15:00:00Z' } } } };
    const r = operationsToday(input); expect(r.reconciliation.registered).toBe(2); expect(r.reconciliation.difference).toBe(8);
    expect(operationsToday({ ...input, day: '2026-10-24' }).reconciliation).toBeNull();
    const unknown = operationsToday({...input,bookings:[]}).reconciliation;
    expect(unknown.unknownAtCutoff).toBe(1); expect(unknown.difference).toBeNull();
    const earlier = operationsToday({...input,snapshot:{...input.snapshot,metricSources:{completedWashes:{extractedAtIso:'2026-10-25T08:00:00Z'}}}}).reconciliation;
    expect(earlier.registered).toBe(1);
  });
  it('blocks conflicting executions rather than displaying an invented count; unavailable finance does not hide verified washes', () => {
    expect(operationsToday({ ...base(), washes: [wash('same', '2026-10-25'), wash('same', '2026-10-25', 'b')] }).error).toBe('wash_conflict');
    const r = operationsToday({ ...base(), statement: null, payrollLines: null });
    expect(r.quantity).toBe(1); expect(r.dailyRequired).toBeNull(); expect(r.rows[0].status).toBe('unknown');
  });
});
describe('freshness based on actual successful import and observation', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const state = hours => ({ lastOperationalSuccessAtIso: new Date(now - hours * 36e5).toISOString() });
  it('is yellow after three hours and red after twelve, with exact boundaries', () => {
    expect(operationFreshness(state(3), now).tone).toBe('green');
    expect(operationFreshness(state(3.01), now).tone).toBe('yellow');
    expect(operationFreshness(state(12), now).tone).toBe('yellow');
    expect(operationFreshness(state(12.01), now).tone).toBe('red');
  });
  it('a fresh save/heartbeat never rejuvenates old or unknown source evidence', () => {
    const s = { ...state(1), lastOperationalCoverage: { extractedAt: '2026-10-25T00:00:00Z', isComplete: false }, lastHeartbeatAtIso: '2026-10-26T12:00:00Z' };
    expect(operationFreshness(s, now).tone).toBe('red'); expect(operationFreshness({}, now).savedAt).toBeNull();
    expect(operationFreshness({ lastSuccessAtIso: '2099-01-01T00:00:00Z' }, now).tone).toBe('red');
  });
});
