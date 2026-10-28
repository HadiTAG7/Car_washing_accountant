// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import BikerDeductionFollowup from '../BikerDeductionFollowup';
afterEach(cleanup);
const proposed = { bikerName: 'Synthetic worker', unit: 'count', quantity: 1, amountSAR: null, matchedToCompensations: false,
  event: { date: '2026-10-20', bookingId: 'C-990001', reason: 'Synthetic reason' } };
it('mounts read-only and gates explicit save behind preview and confirmation', async () => {
  const preview = vi.fn().mockResolvedValue({ proposed, canSave: true, warning: 'Not payroll', reviewedPayloadHash: 'hash', previewStateHash: 'state' });
  const save = vi.fn().mockResolvedValue({ record: { revision: 1 }, readbackVerified: true });
  render(<BikerDeductionFollowup records={[]} preview={preview} save={save} />);
  expect(preview).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('ملف واقعة الخصم'), { target: { value: '{"sourceKind":"booking"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'معاينة فقط' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'تسجيل الواقعة المراجعة' }).disabled).toBe(true));
  expect(screen.getByText(/المطابقة مع Compensations لم تكتمل/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'تسجيل الواقعة المراجعة' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ payload: { sourceKind: 'booking' }, reviewedPayloadHash: 'hash', previewStateHash: 'state' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'تسجيل الواقعة المراجعة' })).toBeNull());
});
it('does not offer saving for duplicates or a protected period', async () => {
  const preview = vi.fn().mockResolvedValue({ proposed, canSave: false, duplicate: true, warning: 'Already recorded' });
  const save = vi.fn(); render(<BikerDeductionFollowup preview={preview} save={save} />);
  fireEvent.change(screen.getByLabelText('ملف واقعة الخصم'), { target: { value: '{}' } }); fireEvent.click(screen.getByRole('button', { name: 'معاينة فقط' }));
  await waitFor(() => expect(screen.getByText('Already recorded')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'تسجيل الواقعة المراجعة' })).toBeNull(); expect(save).not.toHaveBeenCalled();
});
