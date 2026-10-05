// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ runs: [], items: [], preview: vi.fn(), saveDraft: vi.fn(), refetch: vi.fn() }));
vi.mock('../../hooks/usePayroll', () => ({ usePayrollRuns: () => ({ runs: state.runs, loading: false, preview: state.preview,
  saveDraft: state.saveDraft, refetch: state.refetch }), usePayrollItems: () => ({ data: [...state.items], loading: false }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [], loading: false }) }));
import BikerPayroll from '../BikerPayroll';
import { automaticPayrollAdjustments } from '../../lib/payrollUi';
const result = (month, extra = {}) => ({ periodKey: month, periodStart: `${month}-01`, periodEnd: `${month}-31`,
  totals: { commissions: 45, advances: 200, net: 865 }, lines: [{ bikerId: 'a', name: 'Synthetic worker', basicDue: 1000,
    monthlySalary: 1000, commission: 45, bonus: 20, bonusReason: 'Real bonus', deduction: 0, daysEntitled: 31,
    advanceOutstanding: 200, advanceDeduction: 200, advanceDeductionMode: 'default_full', netDue: 865 }], ...extra });
beforeEach(() => { state.runs = []; state.items = []; state.preview.mockReset(); state.saveDraft.mockReset(); state.refetch.mockReset();
  state.preview.mockImplementation(async p => result(p.periodKey)); });
afterEach(cleanup);
it('automatically previews without saving and does not loop on fresh empty item arrays', async () => {
  render(<BikerPayroll role="admin" />);
  await screen.findAllByText('Synthetic worker');
  expect(state.preview).toHaveBeenCalledTimes(1);
  expect(state.preview.mock.calls[0][0]).toMatchObject({ automaticAdvanceDeduction: true });
  expect(state.saveDraft).not.toHaveBeenCalled(); expect(state.refetch).not.toHaveBeenCalled();
  expect(screen.getAllByLabelText(/خصم السلفة/).every(input => input.disabled && input.value === '200')).toBe(true);
});
it('keeps real manual bonus but drops stale zero advance override; preview does not refetch old saved totals', async () => {
  const month = new Date().toISOString().slice(0, 7);
  state.runs = [{ runId: 'old', periodKey: month, status: 'draft', inputAdjustments: [{ bikerId: 'a', bonus: 20, bonusReason: 'Real bonus', advanceDeduction: 0 }] }];
  state.items = result(month).lines.map(row => ({ ...row, commission: 0, advanceDeduction: 0 }));
  render(<BikerPayroll role="admin" />); await screen.findAllByText('Synthetic worker');
  expect(state.preview.mock.calls[0][0].adjustments[0]).toMatchObject({ bonus: 20, bonusReason: 'Real bonus' });
  expect(state.preview.mock.calls[0][0].adjustments[0]).not.toHaveProperty('advanceDeduction');
  fireEvent.click(screen.getByRole('button', { name: /^معاينة$/ }));
  await waitFor(() => expect(state.preview).toHaveBeenCalledTimes(2));
  expect(state.refetch).not.toHaveBeenCalled(); expect(state.saveDraft).not.toHaveBeenCalled();
});
it.each(['approved', 'paid'])('does not recalculate a %s snapshot', async status => {
  const month = new Date().toISOString().slice(0, 7);
  state.runs = [{ runId: 'locked', periodKey: month, status, totals: { commissions: 40 } }];
  state.items = result(month).lines;
  render(<BikerPayroll role="admin" />); await screen.findAllByText('Synthetic worker');
  expect(state.preview).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: /^معاينة$/ }).disabled).toBe(true);
});
it('ignores a late previous-month preview after switching month', async () => {
  let resolveOld; state.preview.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const { container } = render(<BikerPayroll role="admin" />);
  fireEvent.change(container.querySelector('input[type="month"]'), { target: { value: '2026-11' } });
  await screen.findAllByText('Synthetic worker');
  resolveOld(result('2026-09', { lines: [{ ...result('2026-09').lines[0], name: 'Stale worker' }] }));
  await waitFor(() => expect(screen.queryByText('Stale worker')).toBeNull());
  expect(container.querySelector('input[type="month"]').value).toBe('2026-11');
});
it('item fallback preserves bonus/deduction reasons without a manual advance', () => {
  expect(automaticPayrollAdjustments(null, [{ bikerId: 'a', bonus: 20, bonusReason: 'Real bonus', deduction: 10,
    deductionReason: 'Real deduction', advanceDeduction: 0, advanceDeductionMode: 'manual' }])).toEqual([
    { bikerId: 'a', bonus: 20, bonusReason: 'Real bonus', deduction: 10, deductionReason: 'Real deduction' }]);
});
