import { describe, it, expect, vi } from 'vitest';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { SWEATER_METRICS, validateMetricsSnapshot } from '../src/sweater/metricsContract.js';
import { makeOperationsTransport, syncMetricsSnapshot, OperationsClientError } from '../../scripts/lib/sweater-operations-client.mjs';
import { hashBody } from '../src/sweater/record.js';

const reading = (extra = {}) => ({ contractVersion: 'sweater-metrics-v1', importRunId: 'metrics-2026-10-23-0800', periodKey: '2026-10',
  extractedAt: '2026-10-23T08:00:00+03:00', sourceUrl: 'https://ssp-portal.sweater.sa/dashboard/business',
  metrics: { completedWashes: 480, tipsNet: 68, violations: 530, damages: 0, compensations: 0, freeWashCompensation: 8,
    cancelledByCustomer: 10, cancelledByBiker: 13, cancelledMaintenance: 4 }, ...extra });
const response = () => ({ setHeader: vi.fn(), status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });

describe('Sweater metrics contract', () => {
  it('accepts optional source-precision biker tips only with the same reading and a reconciled net total', () => {
    const tipsByBiker = [{ driverExternalId: '1984', netAmount: 73.125 }];
    expect(validateMetricsSnapshot(reading({ metrics: { tipsNet: 73.13 }, tipsByBiker })).tipsByBiker).toEqual(tipsByBiker);
    expect(() => validateMetricsSnapshot(reading({ metrics: { tipsNet: 0 }, tipsByBiker: [] }))).not.toThrow();
  });
  it.each([
    { tipsByBiker: [{ driverExternalId: '1984', netAmount: 1 }] },
    { metrics: { completedWashes: 1 }, tipsByBiker: [] },
    { metrics: { tipsNet: 2 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 1 }, { driverExternalId: '1984', netAmount: 1 }] },
    { metrics: { tipsNet: 1 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: '1' }] },
    { metrics: { tipsNet: 1 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 1, customerName: 'not allowed' }] },
    { metrics: { tipsNet: 1 }, tipsByBiker: [{ driverExternalId: '', netAmount: 1 }] },
  ])('refuses partial, mismatched, duplicated or identifying customer data in tips details %#', extra => {
    expect(() => validateMetricsSnapshot(reading(extra))).toThrow();
  });
  it('knows each number’s unit and whether Sweater deducts or adds it', () => {
    expect(Object.entries(SWEATER_METRICS).filter(([, m]) => m.unit === 'sar').map(([k]) => k)).toEqual(['tipsNet', 'violations', 'damages', 'compensations']);
    expect(Object.entries(SWEATER_METRICS).filter(([, m]) => m.direction === 'addition').map(([k]) => k)).toEqual(['cancelledByCustomer']);
    expect(Object.entries(SWEATER_METRICS).filter(([, m]) => !m.direction).map(([k]) => k)).toEqual(['completedWashes', 'tipsNet']);
  });
  it('accepts a full or partial month reading', () => {
    expect(validateMetricsSnapshot(reading())).toEqual(reading());
    expect(() => validateMetricsSnapshot(reading({ metrics: { tipsNet: -2.5 } }))).not.toThrow();
  });
  it.each([
    ['an unknown metric', reading({ metrics: { tips: 68 } })],
    ['no metric', reading({ metrics: {} })],
    ['a fractional count', reading({ metrics: { completedWashes: 480.5 } })],
    ['a negative count', reading({ metrics: { cancelledByBiker: -1 } })],
    ['money beyond halalas', reading({ metrics: { violations: 530.555 } })],
    ['a negative deduction', reading({ metrics: { violations: -1 } })],
    ['a number as text', reading({ metrics: { completedWashes: '480' } })],
    ['another site', reading({ sourceUrl: 'https://example.com/dashboard' })],
    ['a credential in the link', reading({ sourceUrl: 'https://ssp-portal.sweater.sa/dashboard?token=x' })],
    ['a time without zone', reading({ extractedAt: '2026-10-23T08:00:00' })],
    ['a reading before its month', reading({ extractedAt: '2026-09-30T23:00:00+03:00' })],
    ['a bad month', reading({ periodKey: '2026-13' })],
    ['an extra field', { ...reading(), note: 'x' }],
    ['another contract', reading({ contractVersion: 'sweater-metrics-v2' })],
  ])('refuses %s', (_, payload) => {
    expect(() => validateMetricsSnapshot(payload)).toThrow();
  });
});

describe('metrics through the operations endpoint and client', () => {
  it('refuses a malformed reading with 400 before authentication or database access', async () => {
    const getDb = vi.fn(), verify = vi.fn(), res = response();
    await operationsHandler({ getDb, verify })({ method: 'POST', body: { action: 'metrics', payload: reading({ metrics: { tips: 1 } }) } }, res);
    expect(res.code).toBe(400); expect(getDb).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it('signs the whole request: a metrics signature is not a preview or status signature', () => {
    const req = { action: 'metrics', payload: reading() };
    expect(operationsSigningHash({ ...req, action: 'status' })).not.toBe(operationsSigningHash(req));
  });
  it('the client validates before signing and verifies the stored reading by hash', async () => {
    const sign = vi.fn();
    await expect(makeOperationsTransport({ sign })({ action: 'metrics', payload: reading({ metrics: {} }) })).rejects.toBeInstanceOf(OperationsClientError);
    expect(sign).not.toHaveBeenCalled();
    const stored = { snapshotId: reading().importRunId, periodKey: '2026-10', extractedAtIso: '2026-10-23T05:00:00.000Z', payloadHash: hashBody(reading()), stored: true };
    expect(await syncMetricsSnapshot(reading(), { request: async () => stored })).toEqual(stored);
    await expect(syncMetricsSnapshot(reading(), { request: async () => ({ ...stored, payloadHash: 'f'.repeat(64) }) })).rejects.toThrow(/cannot be verified/);
  });
  it('retries only transport/5xx/429, at most three times; a refusal is final', async () => {
    const stored = { snapshotId: reading().importRunId, periodKey: '2026-10', payloadHash: hashBody(reading()), stored: false };
    let n = 0;
    const flaky = async () => { n += 1; if (n < 3) throw new OperationsClientError('temporary', 503); return stored; };
    expect(await syncMetricsSnapshot(reading(), { request: flaky, sleep: vi.fn() })).toEqual(stored); expect(n).toBe(3);
    let refused = 0;
    await expect(syncMetricsSnapshot(reading(), { request: async () => { refused += 1; throw new OperationsClientError('refused', 409); }, sleep: vi.fn() })).rejects.toThrow();
    expect(refused).toBe(1);
  });
});
