import { describe, it, expect } from 'vitest';
import { validateMetricsSnapshot, COMPENSATION_KEYS } from '../src/sweater/metricsContract.js';
import { operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { composeSweaterMetricReadings } from '../../src/lib/sweaterMetricReadings.js';
import { objectionDeadline } from '../src/sweater/compensationEvents.js';
import { qualityBikerRows, previousQualityMonth } from '../../src/lib/qualityViolations.js';
export const event = (extra = {}) => ({ metricKey: 'cancelledByCustomer', sourceId: 'source-one', bookingId: '5572978', date: '2026-10-20', time: '19:10', driverExternalId: '2007', reason: 'Customer cancellation', quantity: 1, amount: null, sourceUrl: 'https://ssp-portal.sweater.sa/dashboard/compensations', ...extra });
export const payload = (extra = {}) => ({ contractVersion: 'sweater-metrics-v1', importRunId: 'quality-test-read', periodKey: '2026-10', extractedAt: '2026-10-26T19:00:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/dashboard/compensations', metrics: { cancelledByCustomer: 1 }, eventDetails: [event()], eventCoverage: [{ metricKey: 'cancelledByCustomer', totalRows: 1, complete: true }], ...extra });
const reading = (input = payload()) => ({ ...input, id: input.importRunId, extractedAtIso: input.extractedAt });
describe('Compensations detailed source contract', () => {
  it('accepts seven source tables and signs the complete evidence, including customer cancellation', () => {
    const p = payload({ metrics: Object.fromEntries(COMPENSATION_KEYS.map(key => [key, key === 'violations' ? 150 : 1])),
      eventDetails: COMPENSATION_KEYS.map(key => event({ metricKey: key, amount: ['violations', 'damages', 'compensations'].includes(key) ? key === 'violations' ? 150 : 1 : null })),
      eventCoverage: COMPENSATION_KEYS.map(metricKey => ({ metricKey, totalRows: 1, complete: true })) });
    expect(validateMetricsSnapshot(p)).toBe(p);
    const changed = structuredClone(p); changed.eventDetails[0].time = '19:11';
    expect(operationsSigningHash({ action: 'metrics', payload: p })).not.toBe(operationsSigningHash({ action: 'metrics', payload: changed }));
  });
  it.each([{ time: '24:00' }, { date: null }, { date: '2026-09-20' }, { date: '2026-10-32' }, { amount: -1 }, { amount: 0.001 }, { quantity: 2 }, { reason: '' }, { customerPhone: 'private' }, { sourceUrl: 'https://evil.test' }])('refuses invalid or private data %#', patch => {
    expect(() => validateMetricsSnapshot(payload({ eventDetails: [event(patch)] }))).toThrow();
  });
  it('allows unknown fields as null and partial table reads, without inventing amounts or zero', () => {
    const p = payload({ metrics: { violations: 100 }, eventDetails: [event({ metricKey: 'violations', bookingId: null, date: null, time: null, driverExternalId: null, reason: null, amount: null })], eventCoverage: [{ metricKey: 'violations', totalRows: null, complete: false }] });
    expect(() => validateMetricsSnapshot(p)).not.toThrow();
    p.eventCoverage[0] = { metricKey: 'violations', totalRows: 1, complete: true };
    expect(() => validateMetricsSnapshot(p)).toThrow();
  });
  it('rejects duplicate source identity, missing paired coverage and false completeness', () => {
    for (const p of [payload({ eventDetails: [event(), event()] }), payload({ eventCoverage: [] }), payload({ metrics: { cancelledByCustomer: 2 } })]) expect(() => validateMetricsSnapshot(p)).toThrow();
    const p = payload(); delete p.eventCoverage; expect(() => validateMetricsSnapshot(p)).toThrow();
  });
  it('allows multiple distinct incidents for the same booking', () => {
    expect(() => validateMetricsSnapshot(payload({ metrics: { cancelledByCustomer: 2 }, eventDetails: [event(), event({ sourceId: 'second' })], eventCoverage: [{ metricKey: 'cancelledByCustomer', totalRows: 2, complete: true }] }))).not.toThrow();
  });
  it('never borrows old details after a newer aggregate-only reading', () => {
    const old = reading(), newer = { ...reading(), id: 'new', extractedAtIso: '2026-10-26T20:00:00+03:00', metrics: { cancelledByCustomer: 2 } };
    delete newer.eventDetails; delete newer.eventCoverage;
    const result = composeSweaterMetricReadings([old, newer], '2026-10');
    expect(result.metrics.cancelledByCustomer).toBe(2); expect(result.eventGroups.cancelledByCustomer).toBeNull();
  });
  it('keeps legacy rows readable without pretending their missing time exists', () => {
    const result = composeSweaterMetricReadings([reading(payload({ metrics: { violations: 150 }, eventDetails: undefined, eventCoverage: undefined,
      deductionDetails: [{ metricKey: 'violations', sourceId: 'legacy', driverExternalId: '2007', date: '2026-10-20', amount: 150, category: 'Violation', sourceUrl: event().sourceUrl, bookingId: null }] }))], '2026-10');
    expect(result.eventGroups.violations).toMatchObject({ complete: true, legacy: true, rows: [{ time: null, amount: 150 }] });
  });
});
describe('Attribution and deadlines', () => {
  it('does not attribute duplicate links and never interprets incomplete or absent data as zero', () => {
    const snapshot = composeSweaterMetricReadings([reading()], '2026-10');
    const rows = qualityBikerRows(snapshot, [{ id: 'a', name: 'A', driverExternalId: '2007' }, { id: 'b', name: 'B', driverExternalId: '2007' }]);
    expect(rows.find(r => r.id === 'a').values.cancelledByCustomer.value).toBeNull();
    expect(rows.find(r => r.id === 'source:2007').events).toHaveLength(1);
    expect(rows.every(r => r.values.violations.value === null)).toBe(true);
  });
  it('knows zero only from a complete source table with available attribution', () => {
    const snapshot = composeSweaterMetricReadings([reading()], '2026-10');
    const rows = qualityBikerRows(snapshot, [{ id: 'a', name: 'A', driverExternalId: '2007' }, { id: 'b', name: 'B', driverExternalId: '2008' }]);
    expect(rows.find(r => r.id === 'b').values.cancelledByCustomer).toEqual({ value: 0, partial: false });
  });
  it('handles unset dates, month rollover and resolved objections without warning', () => {
    expect(objectionDeadline(event(), null, '2026-10-26')).toBeNull();
    expect(objectionDeadline({ date: null }, 7, '2026-10-26')).toBeNull();
    expect(objectionDeadline(event(), 7, '2026-10-26')).toMatchObject({ dueDate: '2026-10-27', days: 1, tone: 'yellow' });
    expect(objectionDeadline(event(), 3, '2026-10-26')).toMatchObject({ days: -3, tone: 'red' });
    expect(objectionDeadline(event(), 3, '2026-10-26', 'accepted').tone).toBe('');
    expect(previousQualityMonth('2026-01')).toBe('2025-12');
  });
});
