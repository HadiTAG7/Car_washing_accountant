import { describe, expect, it } from 'vitest';
import { publishedQualityReview } from '../executiveQualityReview';
import { executiveProblems } from '../executiveOwnerSummary';

export const published = (extra = {}) => ({ id: 'synthetic-published', bikerUID: 'TEST-A', periodKey: '2026-10',
  rulesVersion: 'cqo-20261015-v3', from: '2026-10-01', to: '2026-10-19', sourceReadDate: '2026-10-20',
  snapshotAt: '2026-10-20T08:02:57.000Z', createdAt: '2026-10-20T08:08:13.047Z', contentHash: 'a'.repeat(64),
  status: 'incomplete', finalScore: null, coverage: { sourceAvailable: true, criteria: { duration: true } },
  components: [{ key: 'duration', weight: 10, points: 8, n: 20 }, { key: 'statusUpdates', weight: 10, points: null, n: null }], ...extra });
const row = (report = published(), extra = {}) => ({ bikerUID: report.bikerUID, data: { reports: [report], source: { available: true }, manual: null }, ...extra });
const workers = [{ id: 'TEST-A' }];
const read = results => publishedQualityReview(workers, results, '2026-10', '2026-10-26');

describe('executive quality projection of existing published profile reads', () => {
  it('dates the actual publication and cut, retains partial coverage, and never creates a score', () => {
    const source = [row()]; const before = JSON.stringify(source); const review = read(source);
    expect(review).toMatchObject({ published: 1, partial: 1, complete: 0, missing: 0, latestPublishedAt: '2026-10-20T08:08:13.047Z', oldestCut: '2026-10-20T08:02:57.000Z', hasIssues: true });
    expect(review.windows).toEqual([{ from: '2026-10-01', to: '2026-10-19', count: 1 }]);
    expect(review.criteria.find(c => c.key === 'duration')).toMatchObject({ available: 1, covered: 1 });
    expect(review.criteria.find(c => c.key === 'statusUpdates')).toMatchObject({ available: 0, covered: 0 });
    expect(review.finalScore).toBeUndefined(); expect(JSON.stringify(source)).toBe(before);
  });
  it('selects the newer saved snapshot by the existing profile rule and retains older cuts of other bikers', () => {
    const newer = published({ id: 'new', to: '2026-10-25', sourceReadDate: '2026-10-26', snapshotAt: '2026-10-26T06:00:00Z', createdAt: '2026-10-26T07:00:00Z' });
    const source = row(); source.data.reports.push(newer);
    const other = row(published({ bikerUID: 'TEST-B' }));
    const review = publishedQualityReview([...workers, { id: 'TEST-B' }], [source, other], '2026-10', '2026-10-26');
    expect(review.published).toBe(2); expect(review.partial).toBe(2);
    expect(review.windows.map(w => w.to)).toEqual(['2026-10-19', '2026-10-25']);
    expect(review.oldestCut).toBe('2026-10-20T08:02:57.000Z'); expect(review.latestCut).toBe(newer.snapshotAt);
  });
  it.each([{ createdAt: null }, { contentHash: null }, { id: null }, { createdAt: '2026-10-27T00:00:00+03:00' },
    { sourceReadDate: '2026-10-32' }, { snapshotAt: '2026-10-27T00:00:00+03:00' }, { status: 'calculated' },
    { components: [{ key: 'duration', weight: 10, points: 20, n: 1 }] }])('does not treat an unsaved, future or malformed candidate as published %#', extra => {
    expect(read([row(published(extra))])).toMatchObject({ published: 0, invalid: 1, hasIssues: true });
  });
  it('keeps absent reports, failed readers, outside-period reports and invalid data distinct', () => {
    expect(read([{ bikerUID: 'TEST-A', data: { reports: [], source: { available: true } } }])).toMatchObject({ missing: 1, failed: 0 });
    expect(read([row(published(), { failed: true })])).toMatchObject({ missing: 0, failed: 1 });
    expect(read([row(published({ status: 'outside-period', components: [] }))])).toMatchObject({ outside: 1, partial: 0, hasIssues: true });
    expect(read([row(), row()])).toMatchObject({ failed: 1, published: 0 });
    expect(read([{ bikerUID: 'TEST-A', data: { reports: [published({ periodKey: '2026-09' })] } }])).toMatchObject({ published: 0, missing: 1 });
    expect(read([row(published(), { data: { reports: [published()], source: { available: false } } })])).toMatchObject({ published: 1, sourceUnavailable: 1, hasIssues: true });
  });
  it('uses direct published evidence even when older than the CEO warning, and preserves the archived report', () => {
    const archive = { cutAtRiyadh: '2026-10-22T23:00:00+03:00', visibleWarnings: [{ id: 'old', text: 'الجودة غير مكتملة', severity: 'open' }] };
    const before = JSON.stringify(archive), review = read([row()]);
    expect(executiveProblems(archive, {}, null, { review })[0]).toMatchObject({ quality: review });
    expect(executiveProblems(archive, {}, null, { error: 'denied' })[0]).toMatchObject({ id: 'quality-read', qualityRead: true });
    expect(executiveProblems(archive, {}, null, { loading: true })[0]).toMatchObject({ id: 'quality-read', severity: 'limitation' });
    expect(JSON.stringify(archive)).toBe(before);
  });
  it('clears only the quality warning when all existing policy conditions and all readers are complete', () => {
    const weights = { washQuality: 30, behavior: 20, productivity: 10, complaints: 10, cancellations: 5, lateness: 5, duration: 10, statusUpdates: 10 };
    const report = published({ status: 'complete', finalScore: 100,
      coverage: { sourceAvailable: true, cohortHash: 'synthetic', excludedSourceRecords: 0, criteria: Object.fromEntries(Object.keys(weights).map(k => [k, true])) },
      components: Object.entries(weights).map(([key, weight]) => ({ key, weight, points: weight, n: 1 })), evidence: { gaps: [] } });
    const response = row(report); response.data.manual = { policy: 'manual-status-20261015-v1', bikerUID: 'TEST-A', periodKey: report.periodKey,
      from: report.from, to: report.to, confirmed: true, cohortHash: 'synthetic', component: { key: 'statusUpdates', weight: 10, points: 10, n: 1, coverageComplete: true } };
    const review = read([response]); expect(review).toMatchObject({ complete: 1, partial: 0, hasIssues: false });
    const archive = { visibleWarnings: [{ id: 'old-quality', text: 'الجودة ناقصة', severity: 'open' }] };
    expect(executiveProblems(archive, { balances: [{ code: '1010', balance: -1 }] }, null, { review }).map(p => p.id)).toEqual(['negative-cash']);
    expect(read([row(report)]).hasIssues).toBe(true); // No manual confirmation is not complete.
  });
});
