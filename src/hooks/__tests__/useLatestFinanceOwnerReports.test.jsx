// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useLatestFinanceOwnerReports } from '../useLatestFinanceOwnerReports';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
const state = vi.hoisted(() => ({ reports: [], failed: false, calls: [], refresh: vi.fn() }));
vi.mock('../useFinanceRead', () => ({ useFinanceRead: (endpoint, request, enabled = true) => {
  state.calls.push({ endpoint, request, enabled });
  const report = request.action === 'list' ? state.reports.find(r => r.sourceRole === request.sourceRole) : state.reports.find(r => r.reportId === request.reportId);
  return { loading: false, error: state.failed && request.sourceRole === 3 ? 'offline' : null, refresh: state.refresh,
    data: !enabled ? null : request.action === 'list' ? { items: report ? [report] : [] } : { report } };
} }));
beforeEach(() => { state.failed = false; state.calls = []; state.refresh.mockClear(); state.reports = [1, 2, 3].map(sourceRole => financeFixture({ sourceRole,
  reportId: `finance-2026-10-19-${sourceRole}-daily-2026-10-19-2026-10-19`, review: { ...financeFixture().review, reviewerRole: sourceRole } })); });
afterEach(cleanup);
it('reads the latest report of each team through the existing protected list/read path only', () => {
  const { result } = renderHook(() => useLatestFinanceOwnerReports());
  expect(result.current.teams.map(t => t.report.sourceRole)).toEqual([1, 2, 3]);
  expect(state.calls.every(c => c.endpoint === 'finance-reports' && ['list', 'read'].includes(c.request.action))).toBe(true);
  expect(state.calls.filter(c => c.request.action === 'list').map(c => c.request.pageSize)).toEqual([1, 1, 1]);
  result.current.refresh(); expect(state.refresh).toHaveBeenCalledTimes(6);
});
it('keeps a failed team distinct from an empty archive and disables reads without a report id', () => {
  state.failed = true; state.reports = state.reports.filter(r => r.sourceRole === 1);
  const { result } = renderHook(() => useLatestFinanceOwnerReports());
  expect(result.current.error).toBe(true);
  expect(result.current.teams[1].report).toBeNull(); expect(result.current.teams[1].error).toBeFalsy();
  expect(state.calls.filter(c => c.request.action === 'read' && !c.enabled)).toHaveLength(2);
});
