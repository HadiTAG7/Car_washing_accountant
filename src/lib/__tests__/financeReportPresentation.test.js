import { expect, it } from 'vitest';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
import { financeArchiveSearch, financeOwnerView, financePriority, financeReportUrl, mentionedMoney, readableFinanceText, savedFinanceNumbers, FINANCE_NUMBER_ROWS } from '../financeReportPresentation';
const snapshot = (overrides = {}) => {
  const report = financeFixture(overrides);
  report.metrics = FINANCE_NUMBER_ROWS.map((row, index) => ({ ...row, label: row.label, id: row.id, value: [800, 1000, -200, 60000, -2000, 90][index], unit: 'ريال', basis: row.basis, coverage: 'لقطة اختبار من صفحات الموقع، 2026-10', asOf: report.cutAtRiyadh }));
  return report;
};
it('uses only saved machine-labelled metrics, never prose, other metrics or live financial values', () => {
  const report = financeFixture({ summary: 'الإيراد 99999 ريال والضريبة 88888 ريال' });
  report.metrics = [{ id: 'cash-ledger', label: 'الصندوق', value: -12.34, unit: 'ريال', basis: 'ledger', coverage: 'محفوظ', asOf: report.cutAtRiyadh }];
  const before = JSON.stringify(report), view = financeOwnerView(report);
  expect(view.savedCount).toBe(1); expect(view.numbers.map(row => row.value)).toEqual([null, null, null, null, -12.34, null]);
  expect(JSON.stringify(report)).toBe(before);
});
it('compares only previous compatible saved snapshots; monthly numbers never compare across months or producers', () => {
  const report = snapshot(), previous = snapshot({ dateRiyadh: '2026-10-18', cutAtRiyadh: '2026-10-18T10:00:00+03:00' });
  previous.metrics[0].value = 700; previous.metrics[4].value = -3000;
  expect(savedFinanceNumbers(report, previous).map(row => row.change)).toEqual([100, 0, 0, 0, 1000, 0]);
  previous.dateRiyadh = '2026-09-18'; previous.cutAtRiyadh = '2026-09-18T10:00:00+03:00'; previous.metrics.forEach(row => { row.asOf = previous.cutAtRiyadh; });
  expect(savedFinanceNumbers(report, previous).map(row => row.change)).toEqual([null, null, null, 0, 1000, null]);
  previous.sourceRole = 2; expect(savedFinanceNumbers(report, previous).every(row => row.change === null)).toBe(true);
  report.metrics[0].basis = 'ledger'; expect(savedFinanceNumbers(report)[0].value).toBeNull();
});
it('puts cash/capital and larger money first, caps notes at three, excludes small documents from the two-line summary', () => {
  const report = snapshot(); report.visibleWarnings = [
    { id: 'small', severity: 'open', text: 'تصحيح المستند14 بمبلغ140ريال لم يكتمل.' },
    { id: 'medium', severity: 'open', text: 'فاتورة المورد بمبلغ5000ريال تحتاج مراجعة.' },
    { id: 'capital', severity: 'open', text: 'فرق رأس المال بمبلغ20000ريال يحتاج مطابقة.' },
    { id: 'tools', severity: 'limitation', text: 'حد الاستخدام منع أداة4 من إكمال الجولة.' },
  ];
  const before = JSON.stringify(report), view = financeOwnerView(report);
  expect(view.notes.map(note => note.id)).toEqual(['capital', 'saved-negative-cash', 'medium']);
  expect(view.notes.every(note => note.critical)).toBe(true); expect(view.summary.length).toBeLessThanOrEqual(2);
  expect(view.summary.join(' ')).not.toMatch(/140|المستند|CFO|Q4|أداة/);
  expect(view.summary.every(text => text.split(/\s+/).length <= 20)).toBe(true);
  expect(JSON.stringify(report)).toBe(before);
});
it('does not interpret dates, account codes or invoice IDs as amounts, and the 1000 threshold is strict', () => {
  expect(mentionedMoney('فاتورة2026226440 بتاريخ2026-10-22 وحساب1010')).toBeNull();
  expect(mentionedMoney('فاتورة بمبلغ2,000.50ريال')).toBe(2000.5);
  expect(financePriority('فاتورة بمبلغ1000ريال').critical).toBe(false);
  expect(financePriority('فاتورة بمبلغ1000.01ريال').critical).toBe(true);
  expect(financePriority('رصيد الصندوق غير مطابق').critical).toBe(true);
});
it('normalizes display spacing and official host without rewriting archived text; deep links preserve exact version', () => {
  const original = 'المستند14ب140ريال؛Bank20يوم2026-10-22 فيsweater-hadi-alghanim.vercel.app';
  const text = readableFinanceText(original); expect(text).toContain('المستند 14 ب 140 ريال'); expect(text).toContain('2026-10-22');
  expect(text).toContain('app.hadialghanim.com'); expect(original).toContain('المستند14');
  expect(financeArchiveSearch({ summary: 'المستند14ب140' }, 'المستند 14')).toBe(true);
  const report = financeFixture(); expect(new URL(financeReportUrl(report)).searchParams.get('report')).toBe(report.reportId);
  expect(new URL(financeReportUrl(report)).searchParams.get('revision')).toBe('1');
});
it('shows every owner decision separately without inventing an approval or changing the cases', () => {
  const report = snapshot(); report.cases = [{ ...report.cases[0], status: 'awaiting_owner', next: 'هل توافق على خطة مطابقة البنك؟' },
    { ...report.cases[0], caseId: 'other', status: 'awaiting_owner', next: 'هل تعتمد استكمال مستند المورد؟' }];
  expect(financeOwnerView(report).decisions.map(item => item.text)).toHaveLength(2);
  expect(report.cases.every(item => item.status === 'awaiting_owner')).toBe(true);
});
