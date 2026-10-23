// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ExecutiveDailySummary from '../ExecutiveDailySummary';
import { executiveFixture } from '../../../server/__tests__/executiveFixture';
import { overviewOperations } from '../../lib/overviewDashboard';
import { executiveOwnerDecisions, executiveProblems, readableExecutiveText } from '../../lib/executiveOwnerSummary';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
import { FINANCE_NUMBER_ROWS } from '../../lib/financeReportPresentation';

afterEach(cleanup);
const fixture = () => ({ today: '2026-10-23', cash: { balances: [{ code: '1010', name: 'الصندوق', balance: -123.45 }], loading: false }, overview: {
  finance: { statement: { netRevenue: 900, totalCosts: 1200, netProfit: -300, salaryAccrual: { estimated: true } } },
  washes: { loading: false, error: null }, operations: overviewOperations({ washes: [{ id: 'test', bikerId: 'b', washDate: '2026-10-22', quantity: 6, status: 'مكتملة' }], bikers: [{ id: 'b' }], periodKey: '2026-10', today: '2026-10-23' }),
} });
const metric = name => within(screen.getByRole('region', { name, exact: true }));
it('uses the saved finance source for the financial table, not CEO prose or current overview values', () => {
  const report = executiveFixture(); report.metrics[0].value = 99999;
  const saved = financeFixture(); saved.metrics = FINANCE_NUMBER_ROWS.map((row, index) => ({ id: row.id, label: row.label, value: [700, 500, 200, 300, -100, 50][index], unit: 'ريال', basis: row.basis, asOf: saved.cutAtRiyadh, coverage: 'لقطة اختبار من الموقع' }));
  render(<ExecutiveDailySummary report={report} data={fixture()} finance={{ data: { report: saved } }} />);
  expect(metric('غسلات أمس').getByText('6')).toBeTruthy();
  const finance = screen.getByRole('region', { name: 'الأرقام المالية المحفوظة' });
  expect(finance.textContent).toContain('700.00'); expect(finance.textContent).toContain('200.00');
  expect(finance.textContent).not.toContain('900.00'); expect(finance.textContent).not.toContain('1,200.00');
  expect(screen.getByRole('link', { name: 'فتح التقرير المالي الكامل' }).href).toContain('app.hadialghanim.com/?page=finance_reports&report=');
  for (const section of screen.getByRole('region', { name: 'خلاصة المشروع الحالية' }).querySelectorAll('section')) expect(section.querySelector('time[datetime]')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'خلاصة المشروع الحالية' }).textContent).not.toContain('99,999');
  expect(screen.getByText('التفاصيل التقنية والتقرير المحفوظ').closest('details').open).toBe(false);
});
it('surfaces current negative cash even with no archive, never the report’s old balance', () => {
  const data = fixture();
  const { rerender } = render(<ExecutiveDailySummary report={null} data={data} />);
  const row = screen.getByRole('region', { name: 'أهم المشاكل' }).querySelector('li');
  expect(row.dataset.severity).toBe('critical'); expect(row.textContent).toContain('-123.45');
  expect(row.textContent).not.toContain('422,957.12');
  data.cash.balances[0].balance = 0; rerender(<ExecutiveDailySummary report={null} data={data} />);
  expect(screen.queryByText('رصيد نقدي سالب يحتاج مراجعة:')).toBeNull();
});
it('caps issues at three, keeps all negative accounts, and moves tool failures into details', () => {
  const report = executiveFixture({ visibleWarnings: [
    { id: 'ops', severity: 'critical', text: 'تشغيل21 غير مقروء؛أيام21مفقودة.' },
    { id: 'tools', severity: 'critical', text: 'فشلت جولات الصباح بحد الاستخدام.' },
    { id: 'quality', severity: 'open', text: 'الجودة جزئية والنهائي غير مكتمل.' },
    { id: 'more', severity: 'open', text: 'ملاحظة إضافية للمراجعة.' },
  ] });
  const data = fixture(); data.cash.balances.push({ code: '1020', name: 'البنك', balance: -50 });
  render(<ExecutiveDailySummary report={report} data={data} />);
  const list = within(screen.getByRole('region', { name: 'أهم المشاكل' })).getAllByRole('listitem');
  expect(list).toHaveLength(3); expect(list[0].textContent).toContain('-50.00');
  expect(list.map(el => el.textContent).join(' ')).not.toContain('حد الاستخدام');
  expect(screen.getByText('فشلت جولات الصباح بحد الاستخدام.').closest('details').open).toBe(false);
});
it('renders individual owner questions without approval buttons or changing the archived payload', () => {
  const report = executiveFixture({ ownerAction: { requiredAtCut: true, text: 'طلبان' } });
  report.decisions = [
    { ...report.decisions[0], caseId: 'lines', status: 'awaiting_owner', decision: 'ثبت قصور تمثيل بنود الأصل.', next: 'هل تعتمد تطوير قدرة مستند/بند/مجموع لحالتي24و25؟ تبقى الضوابط محفوظة.' },
    { ...report.decisions[0], caseId: 'transfer', status: 'awaiting_owner', decision: 'أبقيت رفض إرسال التفاصيل المالية محفوظًا.', next: 'هل تعتمد إرسال ملخص المراجعة المالية والأرصدة والحالات وروابط أدلتها إلى مركز القيادة داخلsweater-hadi-alghanim.vercel.app؟' },
    { ...report.decisions[0], caseId: 'old', status: 'awaiting_owner', next: 'الإبقاء على القرار السابق دون إعادة طلبه.' },
  ];
  const before = JSON.stringify(report);
  render(<ExecutiveDailySummary report={report} data={fixture()} />);
  const owner = screen.getByRole('region', { name: 'المطلوب مني' });
  expect(within(owner).getAllByRole('article')).toHaveLength(2);
  expect(within(owner).queryByRole('button')).toBeNull();
  expect(owner.textContent).not.toMatch(/24|25|vercel\.app/);
  for (const row of executiveOwnerDecisions(report)) {
    expect(row.question.endsWith('؟')).toBe(true);
    expect(row.question.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(row.reason.split(/\s+/).length).toBeLessThanOrEqual(20);
  }
  expect(JSON.stringify(report)).toBe(before);
});
it('distinguishes missing readings from actual zero and explains an absent report without inventing a failure', () => {
  const data = fixture(); data.overview.finance = { statement: null, error: 'failed' }; data.overview.washes.error = 'failed'; data.cash.error = 'failed';
  render(<ExecutiveDailySummary report={executiveFixture()} data={data} finance={{ error: 'failed' }} />);
  expect(metric('غسلات أمس').getByText('غير متاح')).toBeTruthy();
  expect(screen.getByText('تعذرت قراءة تقرير المالية؛ لم تُستبدل أرقامه بأرقام اليوم.')).toBeTruthy();
  expect(screen.queryByText('900.00')).toBeNull();
  expect(screen.getByRole('note').textContent).toContain('سبب عدم صدوره غير مسجل');
  expect(screen.getByRole('note').textContent).not.toContain('حد الاستخدام');
  expect(executiveProblems(null, data.cash)[0].severity).toBe('open');
});
it('only normalizes presentation spacing/old hosts, preserving amounts, dates and signs', () => {
  const original = 'مستند14ب140؛البنك663,937.12 والصندوق−422,957.12. يوم2026-10-22 الساعة09:02:00.262 داخلsweater-hadi-alghanim.vercel.app';
  const formatted = readableExecutiveText(original);
  expect(formatted).toContain('مستند 14 ب 140؛ البنك 663,937.12');
  expect(formatted).toContain('الصندوق−422,957.12'); expect(formatted).toContain('2026-10-22');
  expect(formatted).toContain('app.hadialghanim.com'); expect(original).toContain('مستند14');
  expect(formatted).toContain('09:02:00.262'); expect(formatted).toContain('داخل app.hadialghanim.com');
});
it('does not claim today is absent merely because the selected archived report is older', () => {
  render(<ExecutiveDailySummary report={executiveFixture()} data={fixture()} latestReportDate="2026-10-23" />);
  expect(screen.queryByRole('note')).toBeNull();
});
