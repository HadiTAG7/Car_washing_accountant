import { describe, expect, it, vi } from 'vitest';
import { validateMetricsSnapshot, validCountDetails } from '../src/sweater/metricsContract.js';
import { operationsSigningHash, operationsHandler } from '../src/sweater/operationsHttp.js';
import { makeOperationsTransport, syncMetricsSnapshot } from '../../scripts/lib/sweater-operations-client.mjs';
import { hashBody } from '../src/sweater/record.js';

const event = (extra = {}) => ({ metricKey: 'freeWashCompensation', sourceId: 'TEST-event', driverExternalId: 'TEST-A', date: '2026-10-20',
  quantity: 2, amount: null, reason: null, sourceUrl: 'https://ssp-portal.sweater.sa/tickets/TEST-event', bookingId: 'TEST-booking', ...extra });
const reading = (extra = {}) => ({ contractVersion: 'sweater-metrics-v1', importRunId: 'TEST-count-details', periodKey: '2026-10',
  extractedAt: '2026-10-26T09:00:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/dashboards/compensations',
  metrics: { freeWashCompensation: 9, cancelledByBiker: 16, cancelledMaintenance: 4 }, countDetails: [event()], ...extra });

describe('source event evidence for the three count deductions', () => {
  it('accepts partial evidence without inventing money, and accepts confirmed zero separately', () => {
    expect(validateMetricsSnapshot(reading())).toEqual(reading());
    expect(validateMetricsSnapshot(reading({ metrics: { freeWashCompensation: 0 }, countDetails: [] })).countDetails).toEqual([]);
    expect(validateMetricsSnapshot(reading({ countDetails: [event({ driverExternalId: null, bookingId: null, date: null, amount: 0 })] })).countDetails[0].amount).toBe(0);
  });
  it.each([
    { metricKey: 'violations' }, { metricKey: 'cancelledByCustomer' }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: 10 },
    { quantity: '2' }, { metricKey: 'cancelledByBiker', quantity: 2 }, { amount: -1 }, { amount: '0' }, { amount: 1.001 }, { amount: Infinity },
    { date: '2026-09-30' }, { date: '2026-10-32' }, { date: '' }, { sourceId: '' }, { bookingId: '' }, { driverExternalId: '' }, { reason: '' },
    { reason: 'x'.repeat(251) }, { sourceUrl: 'https://example.com/TEST-event' }, { sourceUrl: 'https://ssp-portal.sweater.sa/tickets/1?token=private' },
    { sourceUrl: 'https://ssp-portal.sweater.sa/tickets/1#private' }, { customerName: 'forbidden' }, { payrollDeduction: true }, { HasCompensation: true },
  ])('refuses invalid, duplicated or inferred event fields %#', extra => {
    expect(() => validateMetricsSnapshot(reading({ countDetails: [event(extra)] }))).toThrow();
  });
  it('requires exact nullable fields and a matching source count; duplicate source or booking is refused', () => {
    for (const countDetails of [[event(), event()], [event(), event({ sourceId: 'other' })], [null], null]) {
      expect(() => validateMetricsSnapshot(reading({ countDetails }))).toThrow();
    }
    const incomplete = event(); delete incomplete.amount;
    expect(() => validateMetricsSnapshot(reading({ countDetails: [incomplete] }))).toThrow();
    expect(validCountDetails([event()], { cancelledByBiker: 16 }, '2026-10')).toBe(false);
    expect(validCountDetails([event()], { freeWashCompensation: null }, '2026-10')).toBe(false);
    expect(validCountDetails([], { freeWashCompensation: Number.MAX_SAFE_INTEGER + 1 }, '2026-10')).toBe(false);
  });
  it('keeps old snapshots valid without this optional field and rejects unrelated metadata', () => {
    const legacy = reading(); delete legacy.countDetails;
    expect(validateMetricsSnapshot(legacy)).toEqual(legacy);
    expect(() => validateMetricsSnapshot({ ...legacy, events: [] })).toThrow();
  });
  it('binds every event field to the existing whole-body signature and verified receipt hash', async () => {
    const body = { action: 'metrics', payload: reading() };
    for (const extra of [{ driverExternalId: 'TEST-B' }, { amount: 20 }, { quantity: 3 }, { reason: 'Source reason' }, { sourceId: 'other' }]) {
      const changed = structuredClone(body); Object.assign(changed.payload.countDetails[0], extra);
      expect(operationsSigningHash(changed)).not.toBe(operationsSigningHash(body));
    }
    const receipt = { snapshotId: body.payload.importRunId, periodKey: '2026-10', payloadHash: hashBody(body.payload), stored: true };
    expect(await syncMetricsSnapshot(body.payload, { request: async () => receipt })).toEqual(receipt);
    await expect(syncMetricsSnapshot(body.payload, { request: async () => ({ ...receipt, payloadHash: 'f'.repeat(64) }) })).rejects.toThrow();
    const sign = vi.fn();
    await expect(makeOperationsTransport({ sign })({ action: 'metrics', payload: reading({ countDetails: [event({ quantity: 10 })] }) })).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects malformed evidence before authentication or database access', async () => {
    const verify = vi.fn(), getDb = vi.fn(), res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await operationsHandler({ verify, getDb })({ method: 'POST', body: { action: 'metrics', payload: reading({ countDetails: [event({ quantity: 10 })] }) } }, res);
    expect(res.code).toBe(400); expect(verify).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
  });
});
