// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const state = vi.hoisted(() => ({ runs: [], items: [], review: null, preview: vi.fn(), preapproval: vi.fn(), approve: vi.fn(), pay: vi.fn(), refetch: vi.fn() }));
vi.mock('../../hooks/usePayroll', () => ({ usePayrollRuns: () => ({ ...state, loading: false }), usePayrollItems: () => ({ data: state.items, loading: false }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [], loading: false }) }));
import BikerPayroll from '../BikerPayroll';
const line = { bikerId: 'synthetic', name: 'Synthetic worker', monthlySalary: 900, basicDue: 900, netDue: 900, daysEntitled: 31, monthDays: 31, advanceOutstanding: 0, advanceDeduction: 0 };
beforeEach(() => {
  const date = new Date(), month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  state.runs = [{ runId: 'synthetic', periodKey: month, status: 'draft', totals: { net: 900 } }]; state.items = [line];
  state.review = { approvalBlocked: true, byBiker: [{ bikerId: 'synthetic', outstanding: 50, assigned: 0 }],
    missingEndDates: { count: 1, amount: 900, rows: [{ bikerId: 'synthetic', name: 'Synthetic worker', currentStatus: 'هرب', amount: 900 }] },
    noWashes: { count: 1, amount: 900, rows: [] }, pendingUnDeducted: { count: 1, amount: 50, rows: [] }, futureStarts: { count: 0, amount: 0, rows: [] }, unassignedAdvances: { count: 0, amount: 0 } };
  for (const key of ['preview', 'preapproval', 'approve', 'pay', 'refetch']) state[key].mockReset();
  state.preview.mockResolvedValue({ ...state.runs[0], lines: [line] }); state.preapproval.mockImplementation(async () => state.review);
  state.approve.mockResolvedValue({ status: 'approved' });
});
afterEach(cleanup);
it('blocks normal approval and requires a reason for admin override using existing endpoint', async () => {
  render(<BikerPayroll role="admin" />);
  await screen.findByText(/الاعتماد متوقف حتى/);
  expect(screen.getByRole('button', { name: /^اعتماد المسير$/ }).disabled).toBe(true);
  expect(state.approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'استثناء المدير للاعتماد' }));
  const dialog = screen.getByRole('dialog', { name: 'اعتماد مسير الرواتب' });
  expect(within(dialog).getByRole('button', { name: 'تأكيد' }).disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Verified owner exception' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد' }));
  await waitFor(() => expect(state.approve).toHaveBeenCalledWith('synthetic', 'Verified owner exception'));
});
it('does not expose admin override to accountant and fails closed on missing review', async () => {
  state.preapproval.mockRejectedValue(new Error('Synthetic read failure'));
  render(<BikerPayroll role="accountant" />); await screen.findByText('تعذّر تحميل فحص ما قبل الاعتماد.');
  expect(screen.queryByRole('button', { name: 'استثناء المدير للاعتماد' })).toBeNull();
  expect(screen.getByRole('button', { name: /^اعتماد المسير$/ }).disabled).toBe(true);
});
it('payment account has no default and confirmation is blocked until explicitly chosen', async () => {
  state.runs[0].status = 'approved'; state.runs[0].distributionDate = '2026-01-01';
  render(<BikerPayroll role="admin" />);
  fireEvent.click(await screen.findByRole('button', { name: 'صرف نقدي/بنكي' }));
  const dialog = screen.getByRole('dialog', { name: 'صرف مسير الرواتب' });
  expect(within(dialog).getByRole('combobox').value).toBe('');
  expect(within(dialog).getByRole('button', { name: 'تأكيد' }).disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'bank' } });
  expect(within(dialog).getByRole('button', { name: 'تأكيد' }).disabled).toBe(false);
  expect(state.pay).not.toHaveBeenCalled();
});
