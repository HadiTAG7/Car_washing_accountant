// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchRows: vi.fn(async () => []), runBatch: vi.fn(async () => {}) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({
  fetchRows: mocks.fetchRows, runBatch: mocks.runBatch, sortBy: rows => rows,
}));
import { usePartnerPayments } from '../usePartnerPayments';

afterEach(() => { cleanup(); mocks.fetchRows.mockClear(); mocks.runBatch.mockClear(); });

describe('سندات الشركاء تلمس partner_payments وحدها', () => {
  it('تسجيل سند لا يكتب partners.paid_amount ولا يقرأ سندات الشريك ليجمعها', async () => {
    const { result } = renderHook(() => usePartnerPayments());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mocks.fetchRows.mockClear();
    await act(() => result.current.addPayment({ partnerId: 'p1', amount: 500, paymentDate: '2026-10-01' }));
    const ops = mocks.runBatch.mock.calls.flatMap(([batch]) => batch);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'set', path: 'partner_payments', data: { partner_id: 'p1', amount: 500 } });
    // Only the list refresh reads; no read-then-sum of that partner's receipts.
    expect(mocks.fetchRows.mock.calls.every(([, constraints]) => !constraints)).toBe(true);
  });

  it('حذف سند يحذفه وحده', async () => {
    const { result } = renderHook(() => usePartnerPayments());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.deletePayment('r1'));
    const ops = mocks.runBatch.mock.calls.flatMap(([batch]) => batch);
    expect(ops).toEqual([{ type: 'delete', path: 'partner_payments', id: 'r1' }]);
  });
});
