// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
