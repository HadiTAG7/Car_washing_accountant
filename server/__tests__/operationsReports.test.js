import { describe, expect, it, vi } from 'vitest';
import { operationsReports } from '../operationsReports.js';
import { createOperationsReportsHandler } from '../operationsReportsHttp.js';
import { operationsReportId, parseOperationsReport } from '../../src/lib/operationsReportContract.js';
import { operationsFixture } from './operationsFixture.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { operationsSubmission } from '../../src/lib/operationsReportPublication.js';

const now = new Date('2026-10-20T00:00:00Z'), auth = { uid: 'test-admin' };
const database = (role = 'admin') => memoryFinanceDb({ 'users/test-admin': { role } });
const save = (db, report, expectedRevision = report.revision - 1) => operationsReports(db, auth, { action: 'save', report, expectedRevision }, now);
const read = (db, reportId, revision) => operationsReports(db, auth, { action: 'read', reportId, ...(revision ? { revision } : {}) }, now);
const historical = () => operationsFixture({ archiveMode: 'historical_imported', sourceRole: 7, sourceLabel: 'وكيل المزامنة السابق', cutAtRiyadh: null, issuedAtRiyadh: null,
  historicalImported: { originalSourceRole: 7, originalSourceRef: 'OLD-SOURCE', originalReportDate: '2026-10-18', sourceSha256: 'a'.repeat(64), evidenceThroughDate: '2026-10-19', cutPrecision: 'date_only', timeNote: 'عنوان18 وإضافة موثقة19؛ الوقت الدقيق غير متاح.' },
  review: { completed: true, reviewerRole: 4, sourceRef: 'CURRENT-REVIEW', at: '2026-10-19T10:00:00+03:00' } });

describe('operations administrative snapshots — isolated unit storage only', () => {
  it('keeps unavailable values and separate stages/coverage without inventing exact historical times', async () => {
    const report = parseOperationsReport(historical());
    expect(report.cutAtRiyadh).toBeNull(); expect(report.metrics[0].value).toBeNull();
    expect(report.coverage.b2b.status).toBe('unavailable'); expect(report.activity.saved.count).toBe(0);
    const db = database(); await save(db, report);
    expect(operationsSubmission((await read(db, report.reportId)).report)).toEqual(report);
    expect((await read(db, report.reportId)).savedAt).toBe(now.toISOString());
  });
  it('uses distinct stable identities for 09/22, kinds and original authors', () => {
    const report = operationsFixture();
    const keys = [report, { ...report, round: '2200' }, { ...report, kind: 'sync' }, { ...report, sourceRole: 7 }].map(operationsReportId);
    expect(new Set(keys).size).toBe(4);
  });
  it('allows unknown service ranges only for documented historical imports, without invented dates', async () => {
    const report = historical(); report.period = { from: null, to: null }; report.serviceDateRiyadh = null; report.reportId = operationsReportId(report);
    expect(report.reportId).toMatch(/unknown-unknown$/); const db = database(); await save(db, report);
    expect((await read(db, report.reportId)).report.period).toEqual({ from: null, to: null });
    expect(() => parseOperationsReport(operationsFixture({ period: { from: null, to: null } }))).toThrow();
  });
  it('requires exact current times and partial evening snapshots, and preserves historical provenance', () => {
    for (const override of [{ cutAtRiyadh: null }, { issuedAtRiyadh: null }, { review: { completed: false } }, { sourceRole: 7 }, { round: '2200', reportId: '' }]) {
      expect(() => parseOperationsReport(operationsFixture(override))).toThrow();
    }
    expect(parseOperationsReport(operationsFixture({ reportId: '', round: '2200', snapshot: 'partial' })).snapshot).toBe('partial');
    expect(() => parseOperationsReport({ ...historical(), cutAtRiyadh: '2026-10-19T00:00:00+03:00' })).toThrow(/تاريخ فقط/);
  });
  it('rejects later evidence, unsupported zero values, forged independent closure and secrets', () => {
    const report = operationsFixture();
    expect(() => parseOperationsReport({ ...report, sources: [{ ...report.sources[0], checkedAt: '2026-10-19T08:00:00+03:00' }] })).toThrow(/أحدث/);
    expect(() => parseOperationsReport({ ...historical(), sources: [{ ...report.sources[0], checkedAt: '2026-10-20T08:00:00+03:00' }] })).toThrow(/أحدث/);
    expect(() => parseOperationsReport({ ...report, metrics: [{ ...report.metrics[0], value: 0 }] })).toThrow(/null/);
    expect(() => parseOperationsReport({ ...report, cases: [{ ...report.cases[0], status: 'verified_closed' }] })).toThrow(/دليل/);
    expect(() => parseOperationsReport({ ...report, cases: [{ ...report.cases[0], status: 'verified_closed', verification: { kind: 'independent', reviewerRole: 4, at: report.cutAtRiyadh, sourceRef: 'SELF' } }] })).toThrow(/مستقل/);
    for (const summary of ['C:/private/secret.json', 'https://x.example/api/partner-mcp/SECRET', 'Bearer ABCDEFGHIJKLMNOP']) expect(() => parseOperationsReport({ ...report, summary })).toThrow(/سرًا/);
  });
  it.each(['partner', 'supervisor', 'operator', 'accountant', undefined])('denies %s before disclosing or saving snapshots', async role => {
    const db = database(role); if (role === undefined) db.rows.delete('users/test-admin');
    for (const input of [{ action: 'list' }, { action: 'read', reportId: operationsFixture().reportId }, { action: 'save', report: operationsFixture(), expectedRevision: 0 }])
      await expect(operationsReports(db, auth, input, now)).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...db.rows.keys()].some(key => key.startsWith('operations_reports/'))).toBe(false);
  });
  it('revalidates actual current admin membership inside the transaction', async () => {
    const db = database(), transaction = db.runTransaction;
    db.runTransaction = fn => { db.rows.set('users/test-admin', { role: 'partner' }); return transaction(fn); };
    await expect(save(db, operationsFixture())).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('deduplicates replay, keeps old revisions and fails closed on conflicts or gaps', async () => {
    const db = database(), report = operationsFixture();
    expect(await save(db, report)).toMatchObject({ duplicate: false }); expect(await save(db, report)).toMatchObject({ duplicate: true });
    await expect(save(db, { ...report, summary: 'تعارض' })).rejects.toMatchObject({ code: 'already-exists' });
    const next = { ...report, revision: 2, summary: 'تصحيح عربي موثق', correctionReason: 'تصحيح الدليل' };
    await save(db, next); expect(operationsSubmission((await read(db, report.reportId, 1)).report)).toEqual(report); expect(operationsSubmission((await read(db, report.reportId)).report)).toEqual(next);
    await expect(save(db, { ...next, revision: 4 })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...db.rows.keys()].every(key => key.startsWith('users/') || key.startsWith('operations_reports/'))).toBe(true);
    expect(db.rows.get(`operations_reports/${report.reportId}/revisions/000001`).publishedByUid).toBe(auth.uid);
  });
  it('bounds archive pages, has no duplicates across cursors and rejects future reviews', async () => {
    const db = database(), report = operationsFixture();
    for (let n = 0; n < 32; n++) await save(db, operationsFixture({ round: `test-${n}` }));
    const first = await operationsReports(db, auth, { action: 'list' }, now);
    const next = await operationsReports(db, auth, { action: 'list', before: first.nextBefore }, now);
    expect(first.items).toHaveLength(30); expect(next.items).toHaveLength(2);
    expect(next.items.some(x => first.items.some(y => y.reportId === x.reportId))).toBe(false);
    await expect(save(db, { ...report, review: { ...report.review, at: '2026-10-21T00:00:00+03:00' } })).rejects.toThrow(/مستقبلي/);
  });
  it('authenticates revoked tokens, limits payloads, and redacts internal HTTP errors', async () => {
    const runtime = { db: database(), auth: { verifyIdToken: vi.fn().mockResolvedValue(auth) } };
    const invoke = async (body, headers = { authorization: 'Bearer SYNTHETIC' }) => {
      const res = { setHeader: vi.fn(), status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
      await createOperationsReportsHandler(() => runtime)({ method: 'POST', headers, body }, res); return res;
    };
    expect((await invoke({}, {})).statusCode).toBe(401);
    expect((await invoke({ action: 'list' })).statusCode).toBe(200); expect(runtime.auth.verifyIdToken).toHaveBeenCalledWith('SYNTHETIC', true);
    expect((await invoke('x'.repeat(102401))).statusCode).toBe(413);
    runtime.db.collection = () => { throw new Error('PRIVATE-DO-NOT-LEAK'); };
    const failed = await invoke({ action: 'list' }); expect(failed.statusCode).toBe(500); expect(JSON.stringify(failed.body)).not.toContain('PRIVATE');
  });
});
