import { useMemo } from 'react';
import { useFinanceRead } from './useFinanceRead';
import { parseFinanceReport } from '../lib/financeReportContract';

function useLatestTeamReport(sourceRole) {
  const archive = useFinanceRead('finance-reports', { action: 'list', sourceRole, page: 1, pageSize: 1 });
  const head = archive.data?.items?.[0];
  const read = useFinanceRead('finance-reports', { action: 'read', reportId: head?.reportId }, Boolean(head));
  const parsed = useMemo(() => {
    if (!read.data?.report) return { report: null, error: null };
    try {
      const report = parseFinanceReport(read.data.report);
      if (report.sourceRole !== sourceRole || report.reportId !== head?.reportId) throw new Error('identity');
      return { report, error: null };
    } catch { return { report: null, error: 'تعذر التحقق من التقرير المحفوظ.' }; }
  }, [read.data, head?.reportId, sourceRole]);
  return { sourceRole, report: parsed.report,
    loading: archive.loading || Boolean(head && read.loading),
    error: archive.error || (head && read.error) || parsed.error || (head && !read.loading && !read.data?.report ? 'تعذر التحقق من التقرير المحفوظ.' : null),
    refresh: () => { archive.refresh(); read.refresh(); } };
}

// Same protected archive/read endpoints and saved-report projections; no publish or decision write.
export function useLatestFinanceOwnerReports() {
  const cfo = useLatestTeamReport(1), intake = useLatestTeamReport(2), tax = useLatestTeamReport(3);
  const teams = [cfo, intake, tax];
  return { teams, loading: teams.some(team => team.loading), error: teams.some(team => team.error),
    refresh: () => teams.forEach(team => team.refresh()) };
}
