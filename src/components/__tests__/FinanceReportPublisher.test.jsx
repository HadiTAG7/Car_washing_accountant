// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceReportPublisher from '../FinanceReportPublisher';
import { financeFixture } from '../../../server/__tests__/financeFixtures';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
afterEach(cleanup); beforeEach(() => mock.api.mockReset());
const selectFile = content => fireEvent.change(screen.getByLabelText('ملف التقرير المراجع من فريق المالية'), { target: { files: [{ size: content.length, text: async () => content }] } });
describe('reviewed finance report publishing UI', () => {
  it('previews without saving then verifies the exact saved revision; never calls financial workbench', async () => {
    const report = financeFixture(), done = vi.fn(); render(<FinanceReportPublisher onPublished={done} />);
    selectFile(JSON.stringify(report)); await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' });
    expect(mock.api).not.toHaveBeenCalled(); mock.api.mockResolvedValueOnce({ reportId: report.reportId }).mockResolvedValueOnce({ report });
    fireEvent.click(screen.getByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith(report.reportId)); expect(mock.api.mock.calls.map(c => c[0])).toEqual(['finance-reports', 'finance-reports']);
  });
  it('does not declare publication on HTTP failure or changed saved content and never retries automatically', async () => {
    const report = financeFixture(), done = vi.fn(); render(<FinanceReportPublisher onPublished={done} />); selectFile(JSON.stringify(report));
    await screen.findByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' });
    mock.api.mockResolvedValueOnce({ reportId: report.reportId }).mockResolvedValueOnce({ report: { ...report, summary: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'نشر التقرير المراجع والتحقق من حفظه' }));
    await screen.findByRole('alert'); expect(done).not.toHaveBeenCalled(); expect(mock.api).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed and unreviewed report files without a request', async () => {
    render(<FinanceReportPublisher onPublished={vi.fn()} />); selectFile('{');
    await screen.findByRole('alert'); expect(screen.queryByRole('button')).toBeNull();
    selectFile(JSON.stringify({ ...financeFixture(), review: { completed: false } })); await screen.findByRole('alert'); expect(mock.api).not.toHaveBeenCalled();
  });
});
