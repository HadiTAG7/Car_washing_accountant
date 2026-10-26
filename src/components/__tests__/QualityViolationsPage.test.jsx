// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ view: { role: 'admin', isPartnerView: false }, read: vi.fn(), save: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mocks.view }));
vi.mock('../../hooks/useQualityViolations', () => ({ useQualityViolations: (...args) => mocks.read(...args) }));
vi.mock('../../hooks/useOverviewBikerQuality', () => ({ useOverviewBikerQuality: () => ({ available: false }) }));
vi.mock('../../lib/bikerProfile', () => ({ riyadhToday: () => '2026-10-26' }));
vi.mock('../TopBar', () => ({ default: () => null }));
import QualityViolationsPage from '../QualityViolationsPage';
const row = { metricKey: 'cancelledByCustomer', sourceId: 'source-a', bookingId: '5572978', date: '2026-10-20', time: '19:10', driverExternalId: '2007', reason: 'إلغاء من العميل', quantity: 1, amount: null, sourceUrl: 'https://ssp-portal.sweater.sa/test' };
const state = () => ({ current: { snapshot: { metrics: { cancelledByCustomer: 1 }, metricSources: { cancelledByCustomer: { snapshotId: 'reading', extractedAtIso: '2026-10-26T19:00:00+03:00' } }, eventGroups: { cancelledByCustomer: { rows: [row], totalRows: 1, complete: true } } } },
  previous: {}, workers: { bikers: [{ id: 'worker', name: 'بايكر اختبار', driverExternalId: '2007' }] }, objections: { data: [] }, settings: { data: null }, save: mocks.save, saveSettings: vi.fn(), refresh: vi.fn() });
beforeEach(() => { mocks.view = { role: 'admin', isPartnerView: false }; mocks.read.mockReturnValue(state()); mocks.save.mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('does not mount protected reads for partners or accountants', () => {
  mocks.view.role = 'accountant'; const result = render(<QualityViolationsPage />); expect(mocks.read).not.toHaveBeenCalled();
  mocks.view = { role: 'admin', isPartnerView: true }; result.rerender(<QualityViolationsPage />); expect(mocks.read).not.toHaveBeenCalled();
});
it('shows missing details and no assumed deadline, with no write on mount', () => {
  render(<QualityViolationsPage />); expect(screen.getAllByText('ما وصلت تفاصيل سويتر').length).toBe(6);
  expect(screen.getByText(/المهلة غير محددة/)).toBeTruthy(); expect(mocks.save).not.toHaveBeenCalled();
});
it('opens all dated source rows, and saves only an explicit metadata edit', async () => {
  render(<QualityViolationsPage />); fireEvent.click(screen.getByRole('button', { name: 'عرض الصفوف (1)' }));
  expect(screen.getByText('5572978')).toBeTruthy(); expect(screen.getByText('19:10')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('حالة الاعتراض'), { target: { value: 'submitted' } });
  fireEvent.change(screen.getByLabelText('ملاحظة'), { target: { value: 'أرسلنا الدليل' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ المتابعة' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ periodKey: '2026-10', metricKey: row.metricKey, sourceId: row.sourceId, snapshotId: 'reading', expectedRevision: 0, status: 'submitted', note: 'أرسلنا الدليل' }));
});
it('disables saving when the current objection state cannot be read', () => {
  const value = state(); value.objections.error = Error('unavailable'); mocks.read.mockReturnValue(value);
  render(<QualityViolationsPage />); fireEvent.click(screen.getByRole('button', { name: 'عرض الصفوف (1)' }));
  expect(screen.getByRole('button', { name: 'حفظ المتابعة' }).disabled).toBe(true);
});
