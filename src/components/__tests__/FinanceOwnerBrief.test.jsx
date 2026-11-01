// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import FinanceOwnerBrief from '../FinanceOwnerBrief';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
afterEach(cleanup);
const team = report => ({ sourceRole: report.sourceRole, report, loading: false, error: null });
it('keeps saved dates and priorities visible, and only asks Hadi about explicitly awaiting-owner cases', () => {
  const report = financeFixture({ visibleWarnings: [{ id: 'cash', severity: 'critical', text: 'الصندوق يحتاج مطابقة.' }],
    cases: [{ caseId: 'owner', status: 'awaiting_owner', next: 'هل تؤكد تاريخ التسجيل؟', evidence: 'التاريخ غير موثق.' },
      { caseId: 'staff', status: 'open', next: 'عمل الفريق الداخلي لا يعرض كقرار.' }] });
  render(<FinanceOwnerBrief state={{ teams: [team(report)], loading: false, error: false }} />);
  expect(screen.getAllByText(/2026-10-19/).length).toBeGreaterThan(0);
  expect(screen.getByText('هل تؤكد تاريخ التسجيل')).toBeTruthy();
  expect(screen.queryByText(/عمل الفريق الداخلي/)).toBeNull();
  expect(within(screen.getByRole('region', { name: 'تنبيهات التقارير المحفوظة' })).getByText(/الصندوق يحتاج مطابقة/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
});
it('does not claim there are no owner requests when part of the read is unavailable', () => {
  render(<FinanceOwnerBrief state={{ teams: [], loading: false, error: true }} />);
  expect(screen.getByRole('alert').textContent).toContain('قد توجد تنبيهات أو قرارات لم تظهر');
  expect(screen.queryByText('لا قرار مسجل بانتظار هادي في آخر تقارير الفرق.')).toBeNull();
});
