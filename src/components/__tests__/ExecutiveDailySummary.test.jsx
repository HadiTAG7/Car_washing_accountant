// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ExecutiveDailySummary from '../ExecutiveDailySummary';
import { executiveFixture } from '../../../server/__tests__/executiveFixture';
import { overviewOperations } from '../../lib/overviewDashboard';
import { executiveOwnerDecisions, executiveProblems, readableExecutiveText } from '../../lib/executiveOwnerSummary';
import { operationsFixture } from '../../../server/__tests__/operationsFixture';
import { publishedQualityReview } from '../../lib/executiveQualityReview';

afterEach(cleanup);
const fixture = () => ({ today: '2026-10-23', cash: { balances: [{ code: '1010', name: 'الصندوق', balance: -123.45 }], loading: false }, overview: {
  finance: { statement: { netRevenue: 900, totalCosts: 1200, netProfit: -300, salaryAccrual: { estimated: true } } },
  washes: { loading: false, error: null }, operations: overviewOperations({ washes: [{ id: 'test', bikerId: 'b', washDate: '2026-10-22', quantity: 6, status: 'مكتملة' }], bikers: [{ id: 'b' }], periodKey: '2026-10', today: '2026-10-23' }),
} });
const metric = name => within(screen.getByRole('region', { name, exact: true }));
it('uses current overview values, not archived metrics, and gives each metric its date', () => {
  const report = executiveFixture(); report.metrics[0].value = 99999;
  render(<ExecutiveDailySummary report={report} data={fixture()} />);
  expect(metric('غسلات أمس').getByText('6')).toBeTruthy();
  expect(metric('إيراد الشهر حتى اليوم').getByRole('heading').textContent).toBe('إيراد الشهر حتى اليوم');
  expect(metric('إيراد الشهر حتى اليوم').getByText(/900\.00/)).toBeTruthy();
  expect(metric('مصروفات الشهر').getByText(/1,200\.00/)).toBeTruthy();
  expect(metric('صافي الربح').getByText(/-300\.00/)).toBeTruthy();
  expect(metric('مصروفات الشهر').getByText('تشمل رواتب تقديرية حتى اعتماد المسير.')).toBeTruthy();
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
  render(<ExecutiveDailySummary report={executiveFixture()} data={data} />);
  expect(metric('غسلات أمس').getByText('غير متاح')).toBeTruthy();
  expect(metric('صافي الربح').getByText('غير متاح')).toBeTruthy();
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

it('replaces only the old operational projection with newer broad coverage, preserving both snapshots and distinct metrics', () => {
  const report = executiveFixture({ cutAtRiyadh: '2026-10-17T23:00:00+03:00', visibleWarnings: [
    { id: 'ops', severity: 'open', text: 'تشغيل 16 غير مقروء؛ أيام مفقودة.' },
    { id: 'quality', severity: 'open', text: 'الجودة جزئية والنهائي غير مكتمل.' },
  ] });
  const operations = operationsFixture({ metrics: [
    { id: 'saved', label: 'المحفوظ للفترة', value: 285, unit: 'غسلة', basis: 'operational', coverage: 'هويات الفترة فقط', asOf: '2026-10-18T09:00:00+03:00' },
    { id: 'business', label: 'مكتمل سويتر', value: 575, unit: 'غسلة', basis: 'operational', coverage: 'تعريف مختلف عن المحفوظ الشهري 582', asOf: '2026-10-18T09:00:00+03:00' },
    { id: 'capacity', label: 'السعة الفعلية', value: null, unit: 'ساعات', basis: 'unavailable', coverage: 'لا ساعات موثقة', asOf: '2026-10-18T09:00:00+03:00' },
  ] });
  const original = JSON.stringify([report, operations]);
  render(<ExecutiveDailySummary report={report} data={fixture()} operationsReview={{ report: operations, loading: false }} />);
  const problems = screen.getByRole('region', { name: 'أهم المشاكل' });
  expect(problems.textContent).not.toContain('الأرقام التشغيلية في التقرير تحتاج تحديثًا');
  expect(problems.textContent).toContain('تغطية التشغيل جزئية');
  expect(problems.textContent).toContain('تقييم الجودة غير مكتمل');
  const scope = screen.getByRole('region', { name: 'نطاق مراجعة التشغيل' });
  expect(scope.textContent).toContain('خدمات الشركات: غير متاح');
  expect(scope.textContent).toContain('ليست مراجعة اليوم');
  expect(within(scope).getByRole('region', { name: 'السعة الفعلية' }).textContent).toContain('غير متاح');
  expect(within(scope).getByRole('region', { name: 'السعة الفعلية' }).textContent).not.toContain('0');
  expect(scope.textContent).toContain('285'); expect(scope.textContent).toContain('575'); expect(scope.textContent).toContain('582');
  expect(scope.textContent).toContain('حالة اختبار');
  expect(screen.getByText('تشغيل 16 غير مقروء؛ أيام مفقودة.').closest('details').open).toBe(false);
  expect(JSON.stringify([report, operations])).toBe(original);
});
it('keeps the dated historical warning on failed or older operations reads and never claims current coverage', () => {
  const report = executiveFixture({ visibleWarnings: [{ id: 'ops', severity: 'open', text: 'تشغيل غير مقروء' }] });
  for (const state of [{ error: 'تعذرت القراءة' }, { loading: true }, { report: operationsFixture() }]) {
    expect(executiveProblems(report, {}, state).some(p => p.id === 'operations' && !p.operations)).toBe(true);
  }
  render(<ExecutiveDailySummary report={report} data={fixture()} operationsReview={{ error: 'تعذرت القراءة' }} />);
  expect(screen.getByRole('alert').textContent).toBe('تعذرت القراءة');
});

it('replaces the quality warning with dated published profile evidence while retaining the CEO archive verbatim', () => {
  const report = executiveFixture({ visibleWarnings: [{ id: 'old-quality', text: 'الجودة من تقرير الرئيس القديم', severity: 'open' }] });
  const published = { id: 'SAVED-TEST', bikerUID: 'A', periodKey: '2026-10', rulesVersion: 'cqo-20261015-v3', from: '2026-10-01', to: '2026-10-19',
    sourceReadDate: '2026-10-20', snapshotAt: '2026-10-20T08:02:57Z', createdAt: '2026-10-20T08:08:13Z', contentHash: 'b'.repeat(64),
    status: 'incomplete', finalScore: null, components: [{ key: 'duration', weight: 10, points: 8, n: 5 }], coverage: { criteria: { duration: true } } };
  const source = [{ bikerUID: 'A', data: { reports: [published], source: { available: true } } }];
  const review = publishedQualityReview([{ id: 'A' }, { id: 'B' }], source, '2026-10', '2026-10-26');
  const before = JSON.stringify([report, source]);
  render(<ExecutiveDailySummary report={report} data={{ ...fixture(), today: '2026-10-26' }} qualityReview={{ review, loading: false }} />);
  const problems = screen.getByRole('region', { name: 'أهم المشاكل' });
  expect(problems.textContent).toContain('المصدر: تقارير الجودة المنشورة أدناه');
  expect(problems.textContent).not.toContain('الجودة من تقرير الرئيس القديم');
  const section = screen.getByRole('region', { name: 'حالة الجودة المنشورة' });
  expect(section.textContent).toContain('التقييم النهائي غير مكتمل');
  expect(section.textContent).toContain('جزئي: 1'); expect(section.textContent).toContain('تعذرت قراءتهم: 1');
  expect(section.querySelector('time[datetime="2026-10-20T08:08:13Z"]')).toBeTruthy();
  expect(section.querySelector('time[datetime="2026-10-19"]')).toBeTruthy();
  expect(within(section).getByRole('link').getAttribute('href')).toBe('/?page=bikers');
  expect(screen.getByText('الجودة من تقرير الرئيس القديم').closest('details').open).toBe(false);
  expect(section.textContent).not.toContain('/100'); expect(JSON.stringify([report, source])).toBe(before);
});

it.each([{ loading: true }, { error: 'قراءة الجودة مرفوضة' }])('labels unavailable quality without substituting an old or calculated report %#', state => {
  render(<ExecutiveDailySummary report={executiveFixture()} data={fixture()} qualityReview={state} />);
  const section = screen.getByRole('region', { name: 'حالة الجودة المنشورة' });
  expect(section.textContent).not.toContain('آخر حفظ'); expect(section.querySelector('time')).toBeNull();
  expect(section.textContent).toContain(state.loading ? 'جارٍ قراءة' : 'قراءة الجودة مرفوضة');
  expect(screen.getByRole('region', { name: 'أهم المشاكل' }).textContent).toContain(state.loading ? 'غير مؤكد' : 'لا يمكن تأكيد');
});
