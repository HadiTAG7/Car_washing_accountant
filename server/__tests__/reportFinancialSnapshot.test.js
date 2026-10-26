import { describe, expect, it } from 'vitest';
import { captureReportFinancials } from '../reportFinancialSnapshot.js';
import { financeReports } from '../financeReports.js';
import { executiveReports } from '../executiveReports.js';
import { parseFinanceReport } from '../../src/lib/financeReportContract.js';
import { parseExecutiveReport } from '../../src/lib/executiveReportContract.js';
import { financeFixture, memoryFinanceDb } from './financeFixtures.js';
import { executiveFixture } from './executiveFixture.js';
import { financialSnapshotSchema, needsReportWording, reportSubmission } from '../../src/lib/reportPublication.js';

import { snapshotNow, snapshotSeed } from './reportSnapshotFixture.js';
const values = s => Object.fromEntries(s.metrics.map(m => [m.id, m.value]));
describe('financial report capture from canonical site engines', () => {
  it('captures six actual figures including frozen payroll and cumulative cash, without financial writes', async () => {
    const db = memoryFinanceDb(snapshotSeed()), before = JSON.stringify([...db.rows]);
    const result = await captureReportFinancials(db, '2026-10-24T10:00:00+03:00', snapshotNow);
    expect(values(result)).toEqual({ revenue: 60, expenses: 175, 'net-profit': -115, 'bank-ledger': 975, 'cash-ledger': -12, 'vat-due': 9 });
    expect(result.capturedAt).toBe('2026-10-26T19:30:00.000+03:00'); expect(result.month).toBe('2026-10');
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('does not turn a failed tax source into zero, or suppress independent cash and income', async () => {
    const db = memoryFinanceDb(snapshotSeed()), collection = db.collection;
    db.collection = name => name === 'startup_costs' ? { get: async () => { throw new Error('private failed query'); } } : collection(name);
    const result = await captureReportFinancials(db, '2026-10-26T10:00:00+03:00', snapshotNow);
    expect(values(result)).toMatchObject({ revenue: 60, expenses: 175, 'bank-ledger': 975, 'vat-due': null });
    expect(JSON.stringify(result)).not.toContain('private failed query');
  });
  it.each([1, 2, 3])('captures on the role %s save, ignores supplied figures, preserves replay and old revisions', async sourceRole => {
    const db = memoryFinanceDb(snapshotSeed());
    const report = financeFixture({ sourceRole, reportId: `finance-2026-10-19-${sourceRole}-daily-2026-10-19-2026-10-19`, visibleWarnings: [{ id: 'wording', severity: 'open', text: 'policyUnconfigured=true' }] });
    const request = { action: 'save', report: { ...report, financialSnapshot: { spoof: true } }, expectedRevision: 0 };
    const a = await financeReports(db, { uid: 'test-admin' }, request, snapshotNow);
    expect(a.wordingWarnings).toEqual([{ id: 'wording', message: 'تحتاج صياغة' }]);
    expect(values(a.financialSnapshot)['bank-ledger']).toBe(975);
    const path = `finance_reports/${report.reportId}/revisions/000001`, original = JSON.stringify(db.rows.get(path));
    db.rows.set('variable_expenses/new', { total_variable_cost: 99, logged_date: '2026-10-06' });
    expect(await financeReports(db, { uid: 'test-admin' }, request, snapshotNow)).toMatchObject({ duplicate: true });
    expect(JSON.stringify(db.rows.get(path))).toBe(original);
    const saved = await financeReports(db, { uid: 'test-admin' }, { action: 'read', reportId: report.reportId }, snapshotNow);
    expect(reportSubmission(saved.report)).toEqual(report); expect(saved.report.visibleWarnings).toEqual(report.visibleWarnings);
    expect(values(saved.report.financialSnapshot).expenses).toBe(175);
    await financeReports(db, { uid: 'test-admin' }, { ...request, report: { ...report, revision: 2, correctionReason: 'تصحيح النص', summary: 'تقرير مصحح' }, expectedRevision: 1 }, snapshotNow);
    expect(JSON.stringify(db.rows.get(path))).toBe(original);
  });
  it('captures for CEO too and serialises concurrent identical publications once', async () => {
    const db = memoryFinanceDb(snapshotSeed()), report = executiveFixture();
    const args = { action: 'save', report, expectedRevision: 0 };
    const result = await Promise.all([executiveReports(db, { uid: 'test-admin' }, args, snapshotNow), executiveReports(db, { uid: 'test-admin' }, args, snapshotNow)]);
    expect(result.filter(r => r.duplicate)).toHaveLength(1);
    const saved = db.rows.get(`executive_reports/${report.reportId}/revisions/000001`).report;
    expect(values(saved.financialSnapshot)).toMatchObject({ revenue: 60, expenses: 175, 'vat-due': 9 });
    expect(reportSubmission(saved)).toEqual(report);
  });
  it('does not backfill on read or disclose financial sources to a partner', async () => {
    const db = memoryFinanceDb(snapshotSeed()), report = financeFixture();
    db.rows.set(`finance_reports/${report.reportId}`, report);
    db.rows.set(`finance_reports/${report.reportId}/revisions/000001`, { revision: 1, reportJson: JSON.stringify(report) });
    const before = JSON.stringify([...db.rows]);
    expect((await financeReports(db, { uid: 'test-admin' }, { action: 'read', reportId: report.reportId }, snapshotNow)).report).toEqual(report);
    expect(JSON.stringify([...db.rows])).toBe(before);
    db.rows.set('users/test-admin', { role: 'partner' });
    await expect(financeReports(db, { uid: 'test-admin' }, { action: 'save', report, expectedRevision: 0 }, snapshotNow)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('validates shape and flags wording without rejecting plain Arabic or links', async () => {
    for (const text of ['policyUnconfigured=true', 'ledgerInput/Output', 'Q4 حزمة', 'CFO-HISTORY-123', 'source_ref']) expect(needsReportWording(text)).toBe(true);
    for (const text of ['الصندوق يحتاج مطابقة.', 'ضريبة 54.26 ريال', 'https://app.hadialghanim.com/?page=finance']) expect(needsReportWording(text)).toBe(false);
    const result = await captureReportFinancials(memoryFinanceDb(snapshotSeed()), '2026-10-26T10:00:00+03:00', snapshotNow);
    expect(() => financialSnapshotSchema.parse({ ...result, metrics: result.metrics.slice(1) })).toThrow();
  });
});

it('keeps partially excluded source coverage visible rather than claiming a complete total', async () => {
  const db = memoryFinanceDb(snapshotSeed());
  db.rows.set('washes/unresolved', { wash_date: '2026-04-01', quantity: 7, price: 20, status: 'مكتملة' });
  db.rows.set('variable_expenses/bad-tax', { logged_date: '2026-10-04', total_variable_cost: 80, is_tax_invoice: true, vat_amount: 999 });
  const result = await captureReportFinancials(db, '2026-10-26T10:00:00+03:00', snapshotNow);
  expect(result.metrics.find(m => m.id === 'expenses').coverage).toContain('استُبعدت');
});
it('takes the clock again for a successful transaction retry crossing the month boundary', async () => {
  const db = memoryFinanceDb(snapshotSeed()), transact = db.runTransaction;
  let attempts = 0;
  db.runTransaction = async fn => {
    try { await transact(async tx => { await fn(tx); throw new Error('synthetic conflict'); }); } catch { /* rolled back attempt */ }
    return transact(fn);
  };
  const clock = () => new Date(++attempts === 1 ? '2026-10-31T20:59:59Z' : '2026-10-31T21:00:01Z');
  const result = await financeReports(db, { uid: 'test-admin' }, { action: 'save', report: financeFixture(), expectedRevision: 0 }, snapshotNow, clock);
  expect(attempts).toBe(2); expect(result.financialSnapshot.month).toBe('2026-11');
  expect(result.financialSnapshot.capturedAt).toContain('2026-11-01T00:00:01');
});
it('preserves the existing author byte budgets when a bounded server snapshot is appended', async () => {
  const snapshot = await captureReportFinancials(memoryFinanceDb(snapshotSeed()), '2026-10-19T10:00:00+03:00', snapshotNow);
  for (const [parse, report, limit] of [[parseFinanceReport, financeFixture(), 96000], [parseExecutiveReport, executiveFixture(), 64000]]) {
    // Fill real narrative fields close to the existing author budget.
    if (report.sourceRole) report.sections = Array.from({ length: 16 }, (_, i) => ({ id: `section-${i}`, title: 'Detail', text: 'x'.repeat(5800) }));
    else report.details = Array.from({ length: 15 }, (_, i) => ({ title: `Detail ${i}`, text: 'x'.repeat(3950) }));
    const authorSize = new TextEncoder().encode(JSON.stringify(report)).length;
    expect(authorSize).toBeLessThan(limit); expect(authorSize).toBeGreaterThan(limit - 5000);
    expect(parse({ ...report, financialSnapshot: snapshot }).financialSnapshot.metrics).toHaveLength(6);
  }
});
