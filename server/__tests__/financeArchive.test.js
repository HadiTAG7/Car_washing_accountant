import { describe, expect, it } from 'vitest';
import { financeFixture, memoryFinanceDb } from './financeFixtures';
import { financeReports } from '../financeReports';
import { financeReportId, parseFinanceReport } from '../../src/lib/financeReportContract';
const auth = { uid: 'test-admin' };
function makeReport(day, role = 1) {
  const date = `2026-10-${String(day).padStart(2, '0')}`, cut = `${date}T23:00:00+03:00`, report = financeFixture({ dateRiyadh: date, cutAtRiyadh: cut,
    sourceRole: role, period: { kind: 'daily', from: date, to: date } });
  report.reportId = financeReportId(report); report.review.at = cut; report.review.reviewerRole = role;
  report.sources[0].checkedAt = cut; report.metrics[0].asOf = cut;
  if (day === 1 && role === 3) report.sections[0].text = 'علامة بحث نادرة — المستند14';
  return parseFinanceReport(report);
}
function seed(role = 'admin') {
  const db = memoryFinanceDb({ 'users/test-admin': { role } });
  for (let team = 1; team <= 3; team++) for (let day = 1; day <= 22; day++) {
    const report = makeReport(day, team);
    db.rows.set(`finance_reports/${report.reportId}`, report);
    db.rows.set(`finance_reports/${report.reportId}/revisions/000001`, { reportJson: JSON.stringify(report), revision: 1 });
  }
  return db;
}
describe('read-only global finance archive', () => {
  it('numbers all 66 reports, with no first-30 truncation, and finds a full-text match outside the first pages', async () => {
    const db = seed(), before = JSON.stringify([...db.rows]);
    const first = await financeReports(db, auth, { action: 'archive' });
    expect(first).toMatchObject({ total: 66, page: 1, pages: 7 }); expect(first.items).toHaveLength(10);
    const last = await financeReports(db, auth, { action: 'archive', page: 7 }); expect(last.items).toHaveLength(6);
    const result = await financeReports(db, auth, { action: 'archive', search: 'علامة بحث نادرة' });
    expect(result.total).toBe(1); expect(result.items[0].dateRiyadh).toBe('2026-10-01');
    expect((await financeReports(db, auth, { action: 'archive', search: 'المستند 14' })).total).toBe(1);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('applies date and team filters before pagination and gives empty results without substituting another team', async () => {
    const db = seed(); const result = await financeReports(db, auth, { action: 'archive', from: '2026-10-01', to: '2026-10-03', sourceRole: 2, pageSize: 2, page: 2 });
    expect(result).toMatchObject({ total: 3, pages: 2, page: 2 }); expect(result.items[0]).toMatchObject({ dateRiyadh: '2026-10-01', sourceRole: 2 });
    expect((await financeReports(db, auth, { action: 'archive', search: 'لا يوجد هذا النص' })).total).toBe(0);
    await expect(financeReports(db, auth, { action: 'archive', from: '2026-10-03', to: '2026-10-01' })).rejects.toThrow();
  });
  it('selects the financial report and its predecessor within the executive cutoff, never a later report or current balances', async () => {
    const db = seed(); const result = await financeReports(db, auth, { action: 'forExecutive', at: '2026-10-15T23:30:00+03:00' });
    expect(result.report.dateRiyadh).toBe('2026-10-15'); expect(result.report.sourceRole).toBe(1);
    expect(result.previousReport.dateRiyadh).toBe('2026-10-14');
    expect((await financeReports(db, auth, { action: 'forExecutive', at: '2026-09-30T23:30:00+03:00' })).report).toBeNull();
    const read = await financeReports(db, auth, { action: 'read', reportId: makeReport(20, 2).reportId });
    expect(read.previousReport).toMatchObject({ sourceRole: 2, dateRiyadh: '2026-10-19' });
  });
  it.each(['partner', 'accountant', 'operator'])('denies %s both new read projections', async role => {
    const db = seed(role);
    for (const action of ['archive', 'forExecutive']) await expect(financeReports(db, auth, { action })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('does not silently show an empty archive if a stored revision cannot be read', async () => {
    const db = seed(); db.rows.delete(`finance_reports/${makeReport(22, 1).reportId}/revisions/000001`);
    await expect(financeReports(db, auth, { action: 'archive' })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
