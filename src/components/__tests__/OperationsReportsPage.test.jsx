// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OperationsReportsPage from '../OperationsReportsPage';
import OperationsReportPublisher from '../OperationsReportPublisher';
import { operationsFixture } from '../../../server/__tests__/operationsFixture.js';
import { LanguageContext } from '../../i18n/LanguageContext';
const mock = vi.hoisted(() => ({ read: vi.fn(), api: vi.fn() }));
vi.mock('../../hooks/useOperationsRead', () => ({ useOperationsRead: (...args) => mock.read(...args) }));
vi.mock('../../lib/operationsApi', () => ({ callOperationsApi: (...args) => mock.api(...args) }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
afterEach(cleanup); beforeEach(() => { mock.api.mockReset(); mock.read.mockReset(); });
const base = data => ({ allowed: true, loading: false, error: null, refresh: vi.fn(), data });
const file = report => fireEvent.change(screen.getByLabelText('ملف التقرير المراجع من فريق العمليات'), { target: { files: [{ size: 2000, text: async () => typeof report === 'string' ? report : JSON.stringify(report) }] } });
const publish = () => screen.getByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' });
function archive(report = operationsFixture()) {
  mock.read.mockImplementation((_e, r) => r.action === 'list' ? base({ items: [report] })
    : base({ report: r.revision === 1 ? report : { ...report, revision: 2, correctionReason: 'تصحيح معزول', summary: 'ملخص النسخة الثانية' }, currentRevision: 2,
      savedAt: '2026-10-19T07:00:00Z', history: [{ revision: 2, reason: 'تصحيح' }, { revision: 1, reason: 'أول' }] }));
}
it('preserves Arabic content, separate coverage/stages and historical revision warning', () => {
  archive(); render(<LanguageContext.Provider value={{ language: 'en' }}><OperationsReportsPage /></LanguageContext.Provider>);
  expect(screen.getByText('ملخص النسخة الثانية')).toBeTruthy(); expect(screen.getByText('معاينة لا تثبت الحفظ')).toBeTruthy(); expect(screen.getByText('تغطية الشركات غير متاحة في المصدر')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('نسخة التقرير'), { target: { value: '1' } });
  expect(screen.getByText(/نسخة تاريخية معروضة/)).toBeTruthy(); expect(screen.getByText(operationsFixture().summary)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'عرض أحدث نسخة' })); expect(screen.queryByText(/نسخة تاريخية معروضة/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'المتابعات' }));
  fireEvent.change(screen.getByLabelText('حالة المتابعة'), { target: { value: 'verified_closed' } });
  expect(screen.getByText(/لا حالات تطابق التصفية الحالية/)).toBeTruthy(); expect(screen.getByRole('status').textContent).toContain('0 / 1');
});
it('filters archive type/status without treating zero matches as no data anywhere', () => {
  archive(); render(<OperationsReportsPage />);
  fireEvent.change(screen.getByLabelText('نوع التقرير'), { target: { value: 'assets' } });
  expect(screen.getByText(/لا تقارير محفوظة في هذا النطاق/)).toBeTruthy(); expect(screen.getByText(/التصفية تخص الصفحة المعروضة/)).toBeTruthy();
});
it('denies non-admin and hides publisher and archive data', () => {
  mock.read.mockReturnValue({ allowed: false }); render(<OperationsReportsPage />);
  expect(screen.getByRole('alert').textContent).toContain('للإدارة فقط'); expect(screen.queryByText('إضافة تقرير مراجع')).toBeNull();
});
it('previews then verifies exact revision, with no operation writer request', async () => {
  const report = operationsFixture(), done = vi.fn(); render(<OperationsReportPublisher canPublish onPublished={done} />); file(report);
  await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' }); expect(mock.api).not.toHaveBeenCalled();
  mock.api.mockResolvedValueOnce({ reportId: report.reportId, revision: 1, duplicate: false }).mockResolvedValueOnce({ report });
  fireEvent.click(publish()); await waitFor(() => expect(done).toHaveBeenCalledWith(report.reportId));
  expect(mock.api.mock.calls.map(c => c[0])).toEqual(['operations-reports', 'operations-reports']); expect(screen.getByRole('status').textContent).toContain('تمت مطابقة');
});
it('requires explicit readback after an ambiguous failure and does not retry automatically', async () => {
  const report = operationsFixture(); render(<OperationsReportPublisher canPublish onPublished={vi.fn()} />); file(report);
  await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' }); mock.api.mockRejectedValueOnce(new Error('انقطاع اصطناعي'));
  fireEvent.click(publish()); await screen.findByRole('alert'); expect(publish().disabled).toBe(true); expect(mock.api).toHaveBeenCalledTimes(1);
  mock.api.mockResolvedValueOnce({ report: null, history: [] }); fireEvent.click(screen.getByRole('button', { name: 'قراءة النسخة قبل إعادة الحفظ' }));
  await waitFor(() => expect(publish().disabled).toBe(false)); expect(mock.api.mock.calls[1][1].action).toBe('read');
});
it('clears an earlier publication success when another file is selected or a later save fails', async () => {
  const report = operationsFixture(), done = vi.fn(); render(<OperationsReportPublisher canPublish onPublished={done} />); file(report);
  await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' });
  mock.api.mockResolvedValueOnce({ reportId: report.reportId, revision: 1, duplicate: false }).mockResolvedValueOnce({ report });
  fireEvent.click(publish()); await screen.findByRole('status');
  file({ ...report, summary: 'ملف متعارض' }); await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' });
  expect(screen.queryByRole('status')).toBeNull(); mock.api.mockRejectedValueOnce(new Error('تعارض النسخة'));
  fireEvent.click(publish()); await screen.findByRole('alert'); expect(screen.queryByRole('status')).toBeNull(); expect(done).toHaveBeenCalledTimes(1);
});
it('blocks publishing before archive readiness and rejects malformed/unreviewed files', async () => {
  render(<OperationsReportPublisher onPublished={vi.fn()} />); file(operationsFixture());
  await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' }); expect(publish().disabled).toBe(true);
  file('{'); await screen.findByRole('alert'); expect(mock.api).not.toHaveBeenCalled();
});
