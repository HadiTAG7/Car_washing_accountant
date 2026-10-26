// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ callSweaterOwnerWashTaxPreview: api.preview,
  callSweaterOwnerWashTaxSave: api.save, describeBackendError: error => error.message }));
import SweaterOwnerWashTaxCorrection from '../SweaterOwnerWashTaxCorrection';
const preview = { count: 12, totals: { net: 240, vat: 36, gross: 276 }, rows: [], canSave: true, previewHash: 'reviewed-hash' };
beforeEach(() => { api.preview.mockReset().mockResolvedValue(preview); api.save.mockReset(); });
afterEach(cleanup);
it('requires a reviewed preview, sends its hash once, and disables replay after success', async () => {
  api.save.mockResolvedValue({ ...preview, saved: true, updated: 12 });
  render(<SweaterOwnerWashTaxCorrection />);
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('معاينة تصحيح الضريبة'));
  const save = await screen.findByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة');
  expect(screen.getByText(/240/)).toBeTruthy();
  fireEvent.click(save);
  await screen.findByText('تم توثيق الفصل الضريبي للغسلات');
  expect(api.save).toHaveBeenCalledExactlyOnceWith('reviewed-hash');
  expect(screen.queryByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة')).toBeNull();
});
it('invalidates the preview on a conflict rather than silently retrying the write', async () => {
  api.save.mockRejectedValue(new Error('changed source'));
  render(<SweaterOwnerWashTaxCorrection />);
  fireEvent.click(screen.getByText('معاينة تصحيح الضريبة'));
  fireEvent.click(await screen.findByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('changed source'));
  expect(screen.queryByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة')).toBeNull();
  expect(api.save).toHaveBeenCalledTimes(1);
});

const result = already => ({ count: 12, totals: { net: 240, vat: 36, gross: 276 }, rows: Array.from({ length: 12 }, (_, i) => ({ sspBookingId: String(i), already, serviceDate: '2026-10-03' })), canSave: true });
it('folds a fully verified completed task into past tasks without saving', async () => {
  api.preview.mockResolvedValue(result(true)); render(<SweaterOwnerWashTaxCorrection />);
  await waitFor(() => expect(screen.getByText(/مهام سابقة/)).toBeTruthy());
  expect(screen.getByText(/مهام سابقة/).closest('details').open).toBe(false);
  expect(screen.queryByRole('button', { name: /تطبيق التصحيح/ })).toBeNull(); expect(api.save).not.toHaveBeenCalled();
});
it('keeps an incomplete task visible and never applies it automatically', async () => {
  api.preview.mockResolvedValue(result(false)); render(<SweaterOwnerWashTaxCorrection />);
  await screen.findByRole('button', { name: /تطبيق التصحيح/ });
  expect(screen.queryByText(/مهام سابقة/)).toBeNull(); expect(api.save).not.toHaveBeenCalled();
});
it('a late initial read cannot overwrite a newer completed result', async () => {
  let resolveInitial;
  api.preview.mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; })).mockResolvedValue(preview);
  api.save.mockResolvedValue({ ...preview, saved: true });
  render(<SweaterOwnerWashTaxCorrection />);
  fireEvent.click(screen.getByText('معاينة تصحيح الضريبة'));
  fireEvent.click(await screen.findByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة'));
  await screen.findByText(/مهام سابقة/);
  await act(async () => resolveInitial(preview));
  expect(screen.queryByText('تطبيق التصحيح المراجع على الاثنتي عشرة غسلة')).toBeNull();
  expect(api.save).toHaveBeenCalledExactlyOnceWith('reviewed-hash');
});
