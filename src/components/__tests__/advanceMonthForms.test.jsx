// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ callAdvanceMonthPreview: api.preview, callAdvanceMonthSave: api.save, describeBackendError: error => error.message }));
import { todayISO } from '../../data/initialData';
import AddBikerAdvanceModal from '../AddBikerAdvanceModal';
import AddTemporaryExpenseModal from '../AddTemporaryExpenseModal';
import AdvanceMonthEditor from '../AdvanceMonthEditor';
afterEach(cleanup);
beforeEach(() => { api.preview.mockReset(); api.save.mockReset(); });
it('registers a biker advance for a chosen month without changing its real date or paying a debt', async () => {
  const add = vi.fn().mockResolvedValue(undefined);
  render(<AddBikerAdvanceModal isOpen biker={{ id: 'b', name: 'Worker' }} onClose={vi.fn()} onAdd={add} />);
  const date = todayISO();
  fireEvent.change(screen.getByLabelText('مبلغ السلفة (ر.س)'), { target: { value: '33' } });
  fireEvent.change(screen.getByLabelText('شهر إسناد السلفة'), { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'تسجيل السلفة' }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  expect(add.mock.calls[0][0]).toMatchObject({ assignmentMonth: '2026-09', spentDate: date, amount: 33, status: 'pending', recoveredDate: null, bikerId: 'b' });
});
it('registers a general advance with an independently selected assignment month', async () => {
  const add = vi.fn().mockResolvedValue(undefined);
  render(<AddTemporaryExpenseModal isOpen onClose={vi.fn()} onAdd={add} />);
  const date = todayISO();
  fireEvent.change(screen.getByLabelText('اسم البند'), { target: { value: 'Advance' } });
  fireEvent.change(screen.getByLabelText('المبلغ (ر.س)'), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('شهر إسناد السلفة'), { target: { value: '2026-09' } });
  fireEvent.submit(screen.getByLabelText('اسم البند').closest('form'));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  expect(add.mock.calls[0][0]).toMatchObject({ assignmentMonth: '2026-09', spentDate: date, amount: 50, status: 'pending' });
});
it('requires a reviewed hash to save and invalidates the preview when the chosen month changes', async () => {
  const result = { previewHash: 'hash', count: 1, amount: 33, pendingAmount: 33, canSave: true, rows: [] };
  api.preview.mockResolvedValue(result); api.save.mockResolvedValue({ ...result, saved: true }); const saved = vi.fn();
  render(<AdvanceMonthEditor expense={{ id: 'a', title: 'Advance', assignmentMonth: '2026-10' }} onClose={vi.fn()} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText('شهر إسناد السلفة'), { target: { value: '2026-09' } });
  fireEvent.change(screen.getByLabelText('سبب تعديل الإسناد'), { target: { value: 'owner correction' } });
  fireEvent.click(screen.getByText('معاينة إسناد الشهر'));
  await screen.findByText('حفظ إسناد الشهر المراجع'); expect(api.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('شهر إسناد السلفة'), { target: { value: '2026-08' } });
  expect(screen.queryByText('حفظ إسناد الشهر المراجع')).toBeNull();
  fireEvent.click(screen.getByText('معاينة إسناد الشهر')); fireEvent.click(await screen.findByText('حفظ إسناد الشهر المراجع'));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.save).toHaveBeenCalledExactlyOnceWith({ mode: 'single', id: 'a', assignmentMonth: '2026-08', reason: 'owner correction', previewHash: 'hash' });
  expect(screen.queryByText('حفظ إسناد الشهر المراجع')).toBeNull();
});
it('uses the fixed owner correction scope without client amounts or date edits', async () => {
  api.preview.mockResolvedValue({ previewHash: 'hash', count: 10, amount: 599, pendingAmount: 399, canSave: true, rows: [] });
  render(<AdvanceMonthEditor ownerCorrection onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByText('معاينة إسناد الشهر')); await screen.findByText('حفظ إسناد الشهر المراجع');
  expect(api.preview).toHaveBeenCalledExactlyOnceWith({ mode: 'owner_october_to_september' });
});
