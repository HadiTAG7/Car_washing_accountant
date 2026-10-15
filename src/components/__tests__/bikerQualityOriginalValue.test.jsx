// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualitySection from '../BikerQualitySection';

afterEach(cleanup);
const proof = { reference: 'Isolated verified fixture', hash: 'a'.repeat(64), readDate: '2026-10-15' };
function fixture() {
  const components = [
    { key: 'washQuality', weight: 30, points: 23.28, n: 16, approximate: true, reason: 'partial-rounded-rating-sample' },
    { key: 'behavior', weight: 20, points: 18, n: 16, approximate: true, reason: 'partial-rounded-rating-sample' },
    { key: 'productivity', weight: 10, points: 6.04, n: 12, completed: 58, unit: 'wash-days', reason: 'wash-day-productivity' },
    { key: 'complaints', weight: 10, points: 8.19, n: 58, affected: 1, reason: 'approved-attributed-rate' },
    { key: 'cancellations', weight: 5, points: 4.17, n: 60, affected: 1, reason: 'approved-attributed-rate' },
    { key: 'lateness', weight: 5, points: null, n: null, reason: 'missing-attributed-denominator' },
    { key: 'duration', weight: 10, points: 8.73, n: 58, reason: 'partial-sample' },
    { key: 'statusUpdates', weight: 10, points: 10, n: 59, affected: 0, reason: 'timestamp-completeness' },
  ];
  return { id: 'demo-report', bikerUID: 'demo-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
    sourceReadDate: '2026-10-15', rulesVersion: 'cqo-20261015-v3', status: 'incomplete', finalScore: null,
    sourceIdentity: { externalId: 'demo-1984', sspId: 'demo-ssp' }, components,
    duration: { n: 58, averageMinutes: 52.43, over50: 32 },
    coverage: { canonicalCompleted: 59, durationMissing: 1, excludedSourceRecords: 0, criteria: { duration: false } },
    evidence: { ratings: [{ from: '2026-10-01', to: '2026-10-14', wash: { mean: 3.88, n: 16 }, behavior: { mean: 4.5, n: 16 }, source: proof }] },
    improvement: 'Isolated fixture only.' };
}
function show(report, language = 'ar', manual) {
  return render(<LanguageContext.Provider value={{ language }}><BikerQualitySection query={{ available: true,
    data: { reports: [report], manual }, refetch: () => {} }} /></LanguageContext.Provider>);
}
const row = label => screen.getByRole('rowheader', { name: label, exact: true }).closest('tr');

it.each(['ar', 'en'])('shows original values before unchanged points for all eight criteria (%s)', language => {
  show(fixture(), language);
  const wash = row(language === 'ar' ? 'جودة الغسيل' : 'Wash quality');
  expect(within(wash).getByText('3.88 / 5')).toBeTruthy();
  expect(within(wash).getByText('23.28 / 30')).toBeTruthy();
  expect(wash.textContent.indexOf('3.88 / 5')).toBeLessThan(wash.textContent.indexOf('23.28 / 30'));
  expect(within(row(language === 'ar' ? 'السلوك' : 'Behavior')).getByText('4.50 / 5')).toBeTruthy();
  const productivity = row(language === 'ar' ? 'الإنتاجية' : 'Productivity');
  expect(productivity.textContent).toContain('58 ÷ 12 = 4.83');
  expect(productivity.textContent).toContain(language === 'ar' ? 'محسوب من السجلات' : 'Calculated from records');
  expect(row(language === 'ar' ? 'الشكاوى' : 'Complaints').textContent).toContain('1 / 58 ≈ 1.72%');
  expect(row(language === 'ar' ? 'الإلغاء' : 'Cancellations').textContent).toContain('1 / 60 ≈ 1.67%');
  const duration = row(language === 'ar' ? 'مدة الغسلة' : 'Wash duration');
  expect(duration.textContent).toContain('52.43');
  expect(duration.textContent).toContain('8.73 / 10');
  expect(duration.textContent).toContain(language === 'ar' ? 'متوسط نقاط كل غسلة، وليس نقاط متوسط المدة' : 'Average of per-wash points, not points for the average duration');
  const late = row(language === 'ar' ? 'التأخر' : 'Lateness');
  expect(within(late).getByText(language === 'ar' ? 'غير متاح' : 'Unavailable')).toBeTruthy();
  const manual = row(language === 'ar' ? 'عدم تحديث الحالة — مراجعة يدوية' : 'Missing status updates — manual review');
  expect(manual.textContent).toContain(language === 'ar' ? 'مدخلات يدوية' : 'Manual input');
  expect(within(manual).getByText(language === 'ar' ? 'غير متاح' : 'Unavailable')).toBeTruthy();
  expect(manual.textContent).not.toContain('0 /');
  expect(manual.textContent).not.toContain('10 / 10');
});

it('never reverse-engineers source stars from points, free text, missing identity or mismatched samples', () => {
  const report = fixture();
  report.evidence.ratings = [];
  report.improvement = 'SSP mean 3.88 / 5';
  show(report);
  expect(within(row('جودة الغسيل')).getByText('غير متاح')).toBeTruthy();
  expect(within(row('جودة الغسيل')).queryByText('3.88 / 5')).toBeNull();
  cleanup();
  const mismatch = fixture(); mismatch.evidence.ratings[0].wash.n = 15;
  show(mismatch); expect(within(row('جودة الغسيل')).getByText('غير متاح')).toBeTruthy();
  cleanup();
  const unlinked = fixture(); unlinked.sourceIdentity.sspId = null;
  show(unlinked); expect(within(row('جودة الغسيل')).getByText('غير متاح')).toBeTruthy();
});

it('keeps n0 ratings unavailable while preserving an explicit measured zero', () => {
  const report = fixture(); report.evidence.ratings[0].wash = { mean: null, n: 0 };
  report.components[0] = { ...report.components[0], n: 0, points: null };
  show(report); expect(within(row('جودة الغسيل')).getByText('غير متاح')).toBeTruthy();
  cleanup();
  const zero = fixture(); zero.evidence.ratings[0].wash.mean = 0; zero.components[0].points = 0;
  show(zero); expect(within(row('جودة الغسيل')).getByText('0.00 / 5')).toBeTruthy();
  expect(within(row('جودة الغسيل')).getByText('0 / 30')).toBeTruthy();
});

it('weights non-overlapping source segments by their actual rating n, not points or scope', () => {
  const report = fixture();
  report.components[0].n = 4;
  report.evidence.ratings = [{ from: '2026-10-01', to: '2026-10-07', wash: { mean: 2, n: 1 }, behavior: { mean: null, n: 0 }, source: proof },
    { from: '2026-10-08', to: '2026-10-14', wash: { mean: 4, n: 3 }, behavior: { mean: null, n: 0 }, source: proof }];
  show(report); expect(within(row('جودة الغسيل')).getByText('3.50 / 5')).toBeTruthy();
  cleanup();
  report.evidence.ratings[1].from = '2026-10-07';
  show(report); expect(within(row('جودة الغسيل')).getByText('غير متاح')).toBeTruthy();
});

it('does not invent rates with missing denominators, but displays evidenced zero affected cases', () => {
  const report = fixture(); report.components[3].n = null; report.components[4].affected = 0;
  show(report);
  expect(within(row('الشكاوى')).getByText('غير متاح')).toBeTruthy();
  expect(row('الإلغاء').textContent).toContain('0 / 60 = 0.00%');
});

it('only displays manual count and rate after a matching confirmed manual review', () => {
  const report = fixture();
  const manual = { policy: 'manual-status-20261015-v1', bikerUID: report.bikerUID, periodKey: report.periodKey,
    from: report.from, to: report.to, confirmed: true,
    component: { key: 'statusUpdates', weight: 10, points: 10, n: 59, affected: 0, reason: 'manual-status-reviewed' } };
  show(report, 'ar', manual);
  const status = row('عدم تحديث الحالة — مراجعة يدوية');
  expect(status.textContent).toContain('0 / 59 = 0.00%');
  expect(status.textContent).toContain('10 / 10');
  expect(status.textContent).toContain('ليست قراءة من سويتر');
  expect(within(status).queryByText('سويتر · نجوم العينة')).toBeNull();
});

it('retains partial coverage and does not infer absent duration or productivity denominators', () => {
  const report = fixture(); report.duration.averageMinutes = null; report.components[2].n = 0;
  show(report);
  expect(within(row('مدة الغسلة')).getByText('غير متاح')).toBeTruthy();
  expect(within(row('الإنتاجية')).getByText('غير متاح')).toBeTruthy();
  expect(within(row('مدة الغسلة')).getByText('تغطية الدليل جزئية لهذا المعيار')).toBeTruthy();
  expect(screen.getByText(/غسلات لم تكتمل أدلة مدتها/).textContent).toContain('1');
});

it('does not show manual zero from an unconfirmed or differently scoped review', () => {
  const report = fixture();
  show(report, 'ar', { policy: 'manual-status-20261015-v1', bikerUID: 'another-worker', periodKey: report.periodKey,
    from: report.from, to: report.to, confirmed: true, component: { key: 'statusUpdates', n: 59, affected: 0, points: 10, weight: 10, reason: 'manual-status-reviewed' } });
  expect(within(row('عدم تحديث الحالة — مراجعة يدوية')).getByText('غير متاح')).toBeTruthy();
});

it.each(['ar', 'en'])('keeps the selected rows compact and moves their methodology into source details (%s)', language => {
  const report = fixture(); report.coverage.criteria.productivity = false; report.coverage.criteria.complaints = false;
  show(report, language);
  const ar = language === 'ar';
  const wash = row(ar ? 'جودة الغسيل' : 'Wash quality');
  const behavior = row(ar ? 'السلوك' : 'Behavior');
  for (const ratingRow of [wash, behavior]) {
    expect(ratingRow.textContent).not.toContain(ar ? 'النطاق لا يعني فحص' : 'Scope does not mean');
    expect(ratingRow.textContent).not.toContain(ar ? 'متوسط النجوم المحفوظ' : 'Saved source star mean');
    expect(ratingRow.textContent).not.toContain(ar ? 'عينة نجوم مدوّرة' : 'Rounded rating sample');
    expect(ratingRow.textContent).toContain(ar ? '59 غسلة' : '59 washes');
    expect(ratingRow.textContent).toContain('16');
  }
  expect(within(wash).getByText('3.88 / 5')).toBeTruthy();
  expect(within(wash).getByText('23.28 / 30')).toBeTruthy();
  const productivity = row(ar ? 'الإنتاجية' : 'Productivity');
  expect(productivity.textContent).toContain('58 ÷ 12 = 4.83');
  expect(productivity.textContent).toContain('6.04 / 10');
  expect(productivity.textContent).not.toContain(ar ? 'ليست أيام دوام' : 'not attendance');
  expect(productivity.textContent).not.toContain(ar ? 'الغسلات ÷ أيام' : 'Washes ÷ days');
  expect(productivity.textContent).not.toContain(ar ? 'تغطية الدليل جزئية' : 'Evidence coverage');
  const complaints = row(ar ? 'الشكاوى' : 'Complaints');
  expect(complaints.textContent).toContain('1 / 58 ≈ 1.72%');
  expect(complaints.textContent.match(/1 \/ 58/g)).toHaveLength(1);
  expect(complaints.textContent).toContain('8.19 / 10');
  expect(complaints.textContent).not.toContain(ar ? 'الحالات المؤهلة' : 'Eligible attributed');
  expect(complaints.textContent).not.toContain(ar ? 'نسبة مؤهلة' : 'Eligible attributed rate');
  expect(complaints.textContent).not.toContain(ar ? 'تغطية الدليل جزئية' : 'Evidence coverage');
  const details = screen.getByText(ar ? 'تفاصيل مصدر التقييم' : 'Assessment source details').closest('details');
  expect(details.open).toBe(false);
  fireEvent.click(within(details).getByText(ar ? 'تفاصيل مصدر التقييم' : 'Assessment source details'));
  expect(details.open).toBe(true);
  expect(details.textContent).toContain(ar ? 'النطاق لا يعني فحص' : 'Scope does not mean');
  expect(details.textContent).toContain(ar ? 'متوسط النجوم المحفوظ' : 'Saved source star mean');
  expect(details.textContent).toContain(ar ? 'الغسلات ÷ أيام' : 'Washes ÷ days');
  expect(details.textContent).toContain(ar ? 'نسبة مؤهلة' : 'Eligible attributed rate');
  expect(details.textContent).toContain(ar ? 'تغطية الدليل جزئية' : 'Evidence coverage');
  // Other rows and the general incomplete warning are deliberately outside this cleanup.
  expect(row(ar ? 'الإلغاء' : 'Cancellations').textContent).toContain(ar ? 'الحالات المؤهلة' : 'Eligible attributed');
  expect(row(ar ? 'التأخر' : 'Lateness').textContent).toContain(ar ? 'بيانات التأخر للفترة غير مكتملة' : 'Source lateness data for this period is incomplete');
  expect(row(ar ? 'مدة الغسلة' : 'Wash duration').textContent).toContain(ar ? 'متوسط نقاط كل غسلة' : 'Average of per-wash points');
  expect(screen.getByText(ar ? 'التقييم النهائي غير مكتمل' : 'Final assessment incomplete')).toBeTruthy();
});
