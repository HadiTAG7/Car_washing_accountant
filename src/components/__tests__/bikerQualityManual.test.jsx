// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BikerQualityManual from '../BikerQualityManual';
import BikerQualitySection from '../BikerQualitySection';
import { LanguageContext } from '../../i18n/LanguageContext';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: api }));
beforeEach(() => { api.mockReset(); }); afterEach(cleanup);
const manual = () => ({ policy: 'manual-status-20261015-v1', bikerUID: 'demo-worker', periodKey: '2026-10',
  from: '2026-10-01', to: '2026-10-14', revision: 0, sourceAvailable: true, confirmed: false, pendingWashes: 1,
  eligible: [{ washId: 'demo-wash', serviceDate: '2026-10-12', sspBookingId: 'S-DEMO' }], cohortHash: 'a'.repeat(64), notes: [], history: [],
  component: { key: 'statusUpdates', points: null, weight: 10, n: null, affected: null, reason: 'awaiting-manual-status-review' } });
it('requires explicit stages and a real selected wash; mount never saves', async () => {
  const reload = vi.fn(); api.mockResolvedValue({ revision: 1 });
  render(<BikerQualityManual manual={manual()} language="ar" onReload={reload} />);
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'حفظ ملاحظة عدم التحديث' }).disabled).toBe(true);
  fireEvent.click(screen.getByText('تسجيل عدم تحديث'));
  fireEvent.change(screen.getByLabelText('الغسلة المرتبطة بالعامل والفترة'), { target: { value: 'demo-wash' } });
  fireEvent.click(screen.getByLabelText('الوصول')); fireEvent.click(screen.getByLabelText('بدء الغسيل'));
  fireEvent.click(screen.getByRole('button', { name: 'حفظ ملاحظة عدم التحديث' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith('manual-note', expect.objectContaining({ washId: 'demo-wash', bikerUID: 'demo-worker', stages: ['arrival', 'start'], revision: 0 }));
});
it('does not turn empty notes into a zero-case confirmation without an explicit choice', async () => {
  api.mockResolvedValue({ revision: 1 }); render(<BikerQualityManual manual={manual()} language="ar" onReload={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'تأكيد المراجعة اليدوية' });
  expect(button.disabled).toBe(true);
  expect(screen.getByText('بانتظار المراجعة اليدوية')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('راجعت النطاق وأؤكد عدم وجود حالات عدم تحديث')); fireEvent.click(button);
  await waitFor(() => expect(api).toHaveBeenCalledWith('manual-confirm', expect.objectContaining({ acknowledged: true, noCases: true, cohortHash: 'a'.repeat(64) })));
});
it('retains the exact request ID on an uncertain save retry and does not auto-retry', async () => {
  api.mockRejectedValue(new Error('Synthetic unavailable'));
  render(<BikerQualityManual manual={manual()} language="ar" onReload={vi.fn()} />);
  fireEvent.click(screen.getByText('تسجيل عدم تحديث'));
  fireEvent.change(screen.getByLabelText('الغسلة المرتبطة بالعامل والفترة'), { target: { value: 'demo-wash' } });
  fireEvent.click(screen.getByLabelText('الوصول'));
  const button = screen.getByRole('button', { name: 'حفظ ملاحظة عدم التحديث' });
  await act(async () => { fireEvent.click(button); });
  expect(screen.getByRole('alert').textContent).toBe('Synthetic unavailable'); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(button); });
  expect(api).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(api.mock.calls[0][1])).toBe(JSON.stringify(api.mock.calls[1][1]));
});
it('separates 59 washes from 16 ratings, preserves points, and explains missing lateness', () => {
  const report = { id: 'demo', bikerUID: 'demo-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14', sourceReadDate: '2026-10-15',
    rulesVersion: 'cqo-20261015-v3', duration: { n: 58, averageMinutes: 48, over50: 3 }, coverage: { canonicalCompleted: 59 },
    status: 'incomplete', finalScore: null, components: [
      { key: 'washQuality', points: 23.28, weight: 30, n: 16 }, { key: 'behavior', points: 18, weight: 20, n: 16 },
      { key: 'lateness', points: null, weight: 5, n: null }, { key: 'statusUpdates', points: 10, weight: 10, n: 59 },
    ] };
  render(<BikerQualitySection query={{ available: true, data: { reports: [report], manual: manual() }, refetch: vi.fn() }} />);
  const table = screen.getByRole('table', { name: 'تفصيل المعايير والأوزان المعتمدة' });
  for (const label of ['جودة الغسيل', 'السلوك']) {
    const row = within(table).getByRole('rowheader', { name: label }).closest('tr');
    expect(row.textContent).toContain('59 غسلة'); expect(row.textContent).toContain('تقييمات العملاء الفعلية: 16');
  }
  expect(within(table).getByText('23.28 / 30')).toBeTruthy();
  expect(within(table).getByText('18 / 20')).toBeTruthy();
  expect(screen.getByText(/بيانات التأخر للفترة غير مكتملة/)).toBeTruthy();
  expect(screen.getByText('41.28 / 50')).toBeTruthy();
  expect(within(table).queryByText('10 / 10')).toBeNull();
});
it('supports the manual form in English and does not render a form when the source is unavailable', () => {
  const view = render(<LanguageContext.Provider value={{ language: 'en' }}><BikerQualityManual manual={manual()} language="en" onReload={vi.fn()} /></LanguageContext.Provider>);
  expect(screen.getByText('Awaiting manual review')).toBeTruthy();
  view.rerender(<BikerQualityManual manual={{ available: false }} language="en" onReload={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Confirm manual review' })).toBeNull(); expect(api).not.toHaveBeenCalled();
});
