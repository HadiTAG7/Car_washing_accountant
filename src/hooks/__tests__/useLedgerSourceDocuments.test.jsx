// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'admin', isPartnerView: false, isInvestorAccount: false, fetchRows: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => state }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: (...args) => state.fetchRows(...args), where: (field, op, ids) => ({ field, op, ids }) }));
import { useLedgerSourceDocuments } from '../useLedgerSourceDocuments';
import { __resetReadCache } from '../../lib/readCache';
afterEach(() => { cleanup(); __resetReadCache(); state.role = 'admin'; state.isPartnerView = false; state.fetchRows.mockReset(); });
it('only reads bounded document IDs and hides administrative data in partner view', async () => {
  state.fetchRows.mockResolvedValue([{ id: 'doc0', supplier: 'مورد' }]);
  const entries = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, sourceKind: 'variable', sourceId: `doc${i}` }));
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  const { result, rerender } = renderHook(() => useLedgerSourceDocuments(entries, index));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(state.fetchRows).toHaveBeenCalledTimes(2);
  expect(state.fetchRows.mock.calls.map(([, constraints]) => constraints[0].ids.length)).toEqual([10, 2]);
  expect(result.current.documents.get('variable_expenses/doc0').supplier).toBe('مورد');
  state.isPartnerView = true; rerender();
  expect(result.current.documents.size).toBe(0);
  expect(state.fetchRows).toHaveBeenCalledTimes(2);
});
it('makes no new reads without a resolved admin role', () => {
  state.role = null;
  const { result } = renderHook(() => useLedgerSourceDocuments([{ id: 'e', sourceKind: 'variable', sourceId: 'd' }], new Map()));
  expect(result.current.documents.size).toBe(0);
  expect(state.fetchRows).not.toHaveBeenCalled();
});
