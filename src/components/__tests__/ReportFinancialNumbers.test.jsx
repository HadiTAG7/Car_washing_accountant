// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import FinanceReportOverview from '../FinanceReportOverview';
import ExecutiveDailySummary from '../ExecutiveDailySummary';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
import { executiveFixture } from '../../../server/__tests__/executiveFixture';
import { financialPreviewSnapshot } from '../../../tests/executive-preview/financialFixture';
afterEach(cleanup);
it('shows the saved six figures instead of caller prose or the old supplied metric, keeping input immutable', () => {
 const report = financeFixture({ financialSnapshot: financialPreviewSnapshot, visibleWarnings: [{ id:'wording', severity:'open', text:'policyUnconfigured=true' }] });
 const before = JSON.stringify(report);
 render(<FinanceReportOverview report={report}/>);
 const table = screen.getByRole('table');
 expect(within(table).getAllByRole('row')).toHaveLength(7);
 expect(table.textContent).toContain('175.00'); expect(table.textContent).toContain('9.00');
 expect(screen.getByText('تحتاج صياغة')).toBeTruthy();
 expect(JSON.stringify(report)).toBe(before);
});
it('shows a separately dated saved snapshot on the executive page without replacing current metrics', () => {
 const report = executiveFixture({ financialSnapshot: financialPreviewSnapshot });
 render(<ExecutiveDailySummary report={report}/>);
 const snapshot = screen.getByRole('region',{name:'أرقام التقرير المحفوظة'});
 expect(within(snapshot).getAllByRole('row')).toHaveLength(7);
 expect(snapshot.textContent).toContain('2026-10-26 19:30:00');
 expect(snapshot.textContent).toContain('975.00');
});
it('leaves old reports missing, and distinguishes failed captures from historic missing numbers', () => {
 const {rerender} = render(<FinanceReportOverview report={financeFixture()}/>);
 expect(screen.getByText('ما انحفظت أرقام مع هذا التقرير')).toBeTruthy();
 const financialSnapshot = {...financialPreviewSnapshot,metrics:financialPreviewSnapshot.metrics.map(m=>({...m,value:null,basis:'unavailable'}))};
 rerender(<FinanceReportOverview report={financeFixture({financialSnapshot})}/>);
 expect(screen.getAllByText('تعذرت القراءة وقت الحفظ')).toHaveLength(6);
});
