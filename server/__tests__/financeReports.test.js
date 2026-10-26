import { describe, expect, it, vi } from 'vitest';
import { financeReports } from '../financeReports.js';
import { reportSubmission } from '../../src/lib/reportPublication.js';
import { parseFinanceReport } from '../../src/lib/financeReportContract.js';
import { createFinanceReportsHandler } from '../financeReportsHttp.js';
import { financeFixture, memoryFinanceDb } from './financeFixtures';

const now = new Date('2026-10-20T00:00:00Z'), auth = { uid: 'test-admin' };
const database = role => memoryFinanceDb({ 'users/test-admin': { role } });
describe('finance administrative snapshots', () => {
  it('filters/searches the entire archive before pagination and never writes while browsing',async()=>{
    const db=database('admin');
    for(let i=1;i<=40;i++){
      const day=`2026-${i<=30?'09':'10'}-${String(i<=30?i:i-30).padStart(2,'0')}`;
      const report=financeFixture({dateRiyadh:day,cutAtRiyadh:`${day}T10:00:00+03:00`,sourceRole:i%2?1:3,
        period:{kind:'daily',from:day,to:day},title:`تقرير ${i}`,summary:i===1?'فاتورةقديمة14 تحتاج مراجعة':'تقرير محفوظ'});
      report.reportId=`finance-${day}-${report.sourceRole}-daily-${day}-${day}`;
      report.review.at=`${day}T09:00:00+03:00`;
      report.sources=report.sources.map(s=>({...s,checkedAt:report.review.at}));
      report.metrics=report.metrics.map(m=>({...m,asOf:report.review.at}));
      // Seed immutable snapshots directly in this unit fixture, never production.
      db.rows.set(`finance_reports/${report.reportId}`,{...report});
      db.rows.set(`finance_reports/${report.reportId}/revisions/000001`,{revision:1,reportJson:JSON.stringify(report)});
    }
    const before=JSON.stringify([...db.rows]);
    const page=await financeReports(db,auth,{action:'list',page:5,pageSize:8},now);
    expect(page.total).toBe(40);expect(page.items).toHaveLength(8);expect(page.pageCount).toBe(5);
    const search=await financeReports(db,auth,{action:'list',page:1,query:'فاتورة قديمة 14',sourceRole:1,from:'2026-09-01',to:'2026-09-02'},now);
    expect(search.total).toBe(1);expect(search.items[0].dateRiyadh).toBe('2026-09-01');
    expect((await financeReports(db,auth,{action:'list',page:1,sourceRole:3,from:'2026-10-01'},now)).total).toBe(5);
    expect(JSON.stringify([...db.rows])).toBe(before);
    await expect(financeReports(db,auth,{action:'list',page:1,from:'2026-10-20',to:'2026-09-01'},now)).rejects.toThrow(/نطاق/);
  });
  it('returns previous saved metric snapshots from the same team without recalculating or changing revisions',async()=>{
    const db=database('admin'),first=financeFixture();await financeReports(db,auth,{action:'save',report:first,expectedRevision:0},now);
    const second=financeFixture({dateRiyadh:'2026-10-20',cutAtRiyadh:'2026-10-20T01:00:00+03:00',period:{kind:'daily',from:'2026-10-20',to:'2026-10-20'},
      reportId:'finance-2026-10-20-1-daily-2026-10-20-2026-10-20'});
    await financeReports(db,auth,{action:'save',report:second,expectedRevision:0},now);
    const before=JSON.stringify([...db.rows]),read=await financeReports(db,auth,{action:'read',reportId:second.reportId},now);
    expect(read.previousMetrics.metrics).toEqual(first.metrics);expect(read.previousMetrics.sourceRole).toBe(1);expect(reportSubmission(read.report)).toEqual(second);
    expect(JSON.stringify([...db.rows])).toBe(before);
  });
  it('preserves unavailable instead of inventing zero and accepts reviewed source-period snapshots', () => {
    expect(parseFinanceReport(financeFixture()).metrics[0].value).toBeNull();
    const linked = financeFixture(); linked.sources[0].sourceRef = 'https://sweater-hadi-alghanim.vercel.app/?tab=ledger';
    expect(parseFinanceReport(linked).sources[0].sourceRef).toBe(linked.sources[0].sourceRef);
    const report = financeFixture(); report.sources[0].checkedAt = '2026-10-19T11:00:00+03:00';
    expect(() => parseFinanceReport(report)).toThrow(/أحدث/);
  });
  it.each(['partner', 'supervisor', 'operator', 'accountant'])('refuses %s for list/read/save before any snapshot disclosure', async role => {
    const db = database(role);
    await expect(financeReports(db, auth, { action: 'list' }, now)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(financeReports(db, auth, { action: 'save', report: financeFixture(), expectedRevision: 0 }, now)).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...db.rows.keys()]).toEqual(['users/test-admin']);
  });
  it('saves and rereads, deduplicates, appends corrections, and never changes a historical revision', async () => {
    const db = database('admin'), report = financeFixture();
    await financeReports(db, auth, { action: 'save', report, expectedRevision: 0 }, now);
    expect(await financeReports(db, auth, { action: 'save', report, expectedRevision: 0 }, now)).toMatchObject({ duplicate: true });
    await expect(financeReports(db, auth, { action: 'save', report: { ...report, summary: 'changed' }, expectedRevision: 0 }, now)).rejects.toMatchObject({ code: 'already-exists' });
    const next = { ...report, revision: 2, correctionReason: 'تصحيح موثق', summary: 'ملخص مصحح' };
    await financeReports(db, auth, { action: 'save', report: next, expectedRevision: 1 }, now);
    expect(reportSubmission((await financeReports(db, auth, { action: 'read', reportId: report.reportId, revision: 1 }, now)).report)).toEqual(report);
    expect(reportSubmission((await financeReports(db, auth, { action: 'read', reportId: report.reportId }, now)).report)).toEqual(next);
    expect(db.rows.get(`finance_reports/${report.reportId}/revisions/000001`).publishedByUid).toBe(auth.uid);
  });
  it('refuses stale revision/future cut/unreviewed input/local paths and forged independent closure', async () => {
    const db = database('admin'), report = financeFixture();
    await expect(financeReports(db, auth, { action: 'save', report, expectedRevision: 1 }, now)).rejects.toThrow(/نسخة/);
    expect(() => parseFinanceReport({ ...report, review: { ...report.review, completed: false } })).toThrow();
    expect(() => parseFinanceReport({ ...report, summary: 'C:/private/report.json' })).toThrow(/قرص/);
    const closed = { ...report, cases: [{ ...report.cases[0], status: 'verified_closed', verification: { kind: 'independent', reviewerRole: 1, at: report.review.at, sourceRef: 'TEST' } }] };
    expect(() => parseFinanceReport(closed)).toThrow(/مستقلة/);
    await expect(financeReports(db, auth, { action: 'save', report, expectedRevision: 0 }, new Date('2026-10-18T00:00:00Z'))).rejects.toThrow(/مستقبلي/);
  });
  it('bounds archive reads and keeps financial and CEO collections separate', async () => {
    const db = database('admin');
    await financeReports(db, auth, { action: 'save', report: financeFixture(), expectedRevision: 0 }, now);
    expect((await financeReports(db, auth, { action: 'list' }, now)).items).toHaveLength(1);
    expect([...db.rows.keys()].some(key => key.startsWith('executive_reports/'))).toBe(false);
  });
  it('rejects anonymous HTTP and verifies revocation without leaking internal errors', async () => {
    const runtime = { auth: { verifyIdToken: vi.fn().mockResolvedValue(auth) }, db: database('admin') };
    const res = () => ({ setHeader: vi.fn(), status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
    const anonymous = res(); await createFinanceReportsHandler(() => runtime)({ method: 'POST', headers: {}, body: { action: 'list' } }, anonymous);
    expect(anonymous.statusCode).toBe(401); expect(runtime.auth.verifyIdToken).not.toHaveBeenCalled();
    const signed = res(); await createFinanceReportsHandler(() => runtime)({ method: 'POST', headers: { authorization: 'Bearer unit-test' }, body: { action: 'list' } }, signed);
    expect(signed.statusCode).toBe(200); expect(runtime.auth.verifyIdToken).toHaveBeenCalledWith('unit-test', true);
  });
});
