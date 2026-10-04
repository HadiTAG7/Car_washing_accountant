import { describe, it, expect } from 'vitest';
import { supervisorReport } from '../supervisorReport';
import { supervisorFixture } from '../../../functions/test/fixtures/supervisor';
const report = d => supervisorReport(d, '2026-08');
describe('supervisor read-only financial and performance view', () => {
  it('uses whole-company pre-fee profit and keeps final profit separate without creating entitlement', () => {
    const d = supervisorFixture(); const before = JSON.stringify(d); const r = report(d);
    expect(r.statement.netProfitBeforeFees).toBe(800);
    expect(r.statement.netProfit).toBe(680);
    expect(r.share).toMatchObject({ basisAmount: 800, referenceAmount: 40, entitlementAmount: null, decision: 'reference-only', basisStatus: 'owner-confirmed', managementRate: 0.1, combinedRate: 0.15 });
    expect(JSON.stringify(d)).toBe(before);
    expect(JSON.stringify(r)).not.toMatch(/private-phone|private-id|salary/);
    expect(r.workers[0]).toMatchObject({ completedQuantity: 10, target: null, achievement: null });
  });
  it.each([1000, 1200])('zero reference for breakeven/loss (expense %s)', expense => {
    const d = supervisorFixture(); d.journal_entries[1].lines[0].debit = expense; d.journal_entries[1].lines[1].credit = expense;
    expect(report(d).share.referenceAmount).toBe(0);
  });
  it('does not turn missing data or open months into zero', () => {
    for (const change of [d => { d.chart_of_accounts = []; }, d => { d.journal_entries = []; }, d => { d.accounting_periods = []; }]) {
      const d = supervisorFixture(); change(d); expect(report(d).share.referenceAmount).toBeNull();
    }
  });
  it('refuses a conflicting configured rate without changing it', () => {
    const d = supervisorFixture(); d.fee_rules = [{ key: 'supervisor', basis: 'profit', rate: 0.1 }];
    const r = report(d); expect(r.share.referenceAmount).toBeNull(); expect(r.coverage.issues.join(' ')).toContain('سياسة رسوم');
    expect(d.fee_rules[0].rate).toBe(0.1);
  });
  it.each(['2026-13', '', 'all'])('rejects invalid month %s', key => { expect(() => supervisorReport(supervisorFixture(), key)).toThrow(); });
  it('filters the full calendar month and isolates unknown dates', () => {
    const d = supervisorFixture(); d.washes.push({ ...d.washes[0], wash_date: '2026-09-01', quantity: 500 }, { ...d.washes[0], wash_date: 'invalid', quantity: 50 });
    const r = report(d); expect(r.from).toBe('2026-08-01'); expect(r.to).toBe('2026-08-31'); expect(r.kpis.completedQuantity).toBeNull(); expect(r.coverage.performance.unknownDateRows).toBe(1);
  });
  it('never double-counts duplicate names, and never replaces a stale id with a name match', () => {
    const d = supervisorFixture(); d.bikers.push({ id: 'b2', name: 'عامل تجريبي' });
    d.washes = [{ ...d.washes[0], biker_id: null, biker_name: 'عامل تجريبي' }, { ...d.washes[0], biker_id: 'missing', biker_name: 'عامل تجريبي', quantity: 3 }];
    const r = report(d); expect(r.coverage.performance.unassignedQuantity).toBe(13); expect(r.workers.every(w => w.completedQuantity === null)).toBe(true);
  });
  it('invalid quantities are separate and cannot become zero performance', () => {
    const d = supervisorFixture(); d.washes[0].quantity = null;
    expect(report(d).coverage.performance.invalidRows).toBe(1); expect(report(d).workers[0].invalidRows).toBe(1);
  });
  it('does not ignore unknown ledger accounts or missing money fields', () => {
    const d = supervisorFixture(); d.journal_entries[0].lines[0].debit = null;
    expect(report(d).statement).toBeNull(); expect(report(d).share.referenceAmount).toBeNull();
  });
  it('does not double-count embedded and legacy lines for the same entry', () => {
    const d = supervisorFixture(); d.journal_lines = d.journal_entries[0].lines.map((l, i) => ({ ...l, id: `old${i}`, entryId: 'sale' }));
    expect(report(d).share.referenceAmount).toBe(40);
  });
  it.each([NaN, Infinity, -Infinity, 1e308, true, {}, 'NaN'])('refuses invalid/overflow money without returning a zero reference: %s', amount => {
    const d = supervisorFixture(); d.journal_entries[0].lines[0].debit = amount; d.journal_entries[0].lines[1].credit = amount;
    const r = report(d); expect(r.statement).toBeNull(); expect(r.share.basisAmount).toBeNull(); expect(r.share.referenceAmount).toBeNull();
  });
  it('nulls incomplete performance and missing source arrays without inventing zero', () => {
    const d = supervisorFixture(); d.washes = [];
    expect(report(d).kpis.completedQuantity).toBeNull(); expect(report(d).workers[0].completedQuantity).toBeNull();
    delete d.bikers; expect(report(d).kpis.workers).toBeNull();
    delete d.fee_rules; expect(report(d).statement).toBeNull();
  });
  it('nulls quantity aggregation overflow', () => {
    const d = supervisorFixture(); d.washes = [d.washes[0], { ...d.washes[0], id: 'w2' }].map(w => ({ ...w, quantity: 1e308 }));
    const r = report(d); expect(r.kpis.completedQuantity).toBeNull(); expect(r.workers[0].completedQuantity).toBeNull();
  });
  it('documents source targets without implying synchronization, approval or measured progress', () => {
    const r = report(supervisorFixture());
    expect(r.goals).toMatchObject({ status: 'source-documented-period-unbound', synchronized: false, approval: 'unconfirmed', months: [null, null, null] });
    expect(r.goals.metrics.map(m => m.target)).toEqual([0.9, 5000]);
    expect(r.goals.metrics.every(m => m.period === 'monthly' && m.actual === null && m.progress === null)).toBe(true);
    expect(r.goals.source.url).toContain('gid=2100000004');
  });
  it('refuses additional fees rather than adding 5% on top of the confirmed 15%', () => {
    const d = supervisorFixture(); d.fee_rules = [{ key: 'management', basis: 'profit', rate: 0.15 }, { key: 'supervisor', basis: 'profit', rate: 0.05 }];
    expect(report(d).share.referenceAmount).toBeNull();
  });
});
