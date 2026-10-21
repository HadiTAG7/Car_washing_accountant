// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'a' }, role: 'admin', data: {}, calls: [], fail: null }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: mocks.role }) }));
vi.mock('../../lib/firebaseClient', () => ({ db: {}, isFirebaseConfigured: true }));
// A Firestore in memory: string ranges, strict `in`, document-id order.
vi.mock('../../lib/accounting/firestoreScopeExecutor', () => {
  const rows = name => Object.entries(mocks.data[name] || {}).map(([id, doc]) => ({ ...doc, id })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const track = (op, name, fn) => async (...args) => {
    mocks.calls.push(`${op}:${name}`);
    if (mocks.fail?.(op, name)) throw new Error(`${name} unavailable`);
    return fn(...args);
  };
  return { firestoreScopeExecutor: {
    all: name => track('all', name, () => rows(name))(),
    range: (name, field, from, to) => track('range', name, () => rows(name).filter(r => typeof r[field] === 'string' && r[field] >= from && r[field] < to))(),
    equals: (name, field, value) => track('equals', name, () => rows(name).filter(r => r[field] === value))(),
    notNull: (name, field) => track('notNull', name, () => rows(name).filter(r => r[field] != null))(),
    inValues: (name, field, values) => track('in', name, () => rows(name).filter(r => values.includes(r[field])))(),
    byIds: (name, ids) => track('ids', name, () => rows(name).filter(r => ids.includes(r.id)))(),
    count: (name, field, values) => track('count', name, () => rows(name).filter(r => values.includes(r[field])).length)(),
    probe: name => track('probe', name, () => rows(name).length > 0)(),
  } };
});
import { useIncomeStatementSources } from '../useIncomeStatementSources';
import { useWashes } from '../useWashes';
beforeEach(() => {
  mocks.user = { id: 'a' }; mocks.role = 'admin'; mocks.calls = []; mocks.fail = null;
  mocks.data = {
    washes: { w9: { wash_date: '2026-09-30', status: 'مكتملة', quantity: 1, price: 23 }, w10: { wash_date: '2026-10-02', status: 'مكتملة', quantity: 1, price: 23 },
      w11: { wash_date: '2026-11-01', status: 'مكتملة', quantity: 1, price: 23 }, w0: { wash_date: '2025-01-01', status: 'مكتملة', quantity: 1, price: 23 } },
    journal_entries: { j10: { entryDate: '2026-10-05', status: 'posted', lines: [{ accountId: '4000', credit: 20 }] },
      j1: { entryDate: '2025-01-05', status: 'posted', lines: [{ accountId: '4000', credit: 99 }] },
      pay: { entryDate: '2026-11-03', status: 'posted', sourceType: 'payroll', sourceId: '2026-10__r1', lines: [{ accountId: '5010', debit: 900 }] } },
    variable_expenses: { v10: { logged_date: '2026-10-03', total_variable_cost: 50 }, v1: { logged_date: '2025-01-03', total_variable_cost: 70 } },
    bikers: { b: { name: 'عامل' } },
  };
});
afterEach(cleanup);
const october = { statementMonths: ['2026-10'], washMonths: ['2026-09', '2026-10'] };

it('reads only the months asked for, never the whole history, and builds the journal lines', async () => {
  const { result } = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sources.washes.map(w => w.id)).toEqual(['w10', 'w9']);
  expect(result.current.sources.variables.map(v => v.id)).toEqual(['v10']);
  // October's own entry and every payroll entry (its salary belongs to its earned month).
  expect(result.current.entries.map(e => e.id).sort()).toEqual(['j10', 'pay']);
  expect(result.current.lines.find(l => l.entryId === 'j10')).toMatchObject({ credit: 20, id: 'j10:0' });
  expect(mocks.calls).not.toContain('all:washes');
  expect(mocks.calls).not.toContain('all:journal_entries');
  expect(result.current.sources.bikers.map(b => b.id)).toEqual(['b']);
});

it('a page that comes back reads nothing again', async () => {
  const first = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  first.unmount();
  const reads = mocks.calls.length;
  const again = renderHook(() => useIncomeStatementSources(october));
  expect(again.result.current.loading).toBe(false);
  expect(again.result.current.sources.washes).toHaveLength(2);
  expect(mocks.calls).toHaveLength(reads);
});

it('keeps source errors separate so verified washes remain usable when a finance source fails', async () => {
  mocks.fail = (op, name) => name === 'journal_entries';
  const { result } = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await waitFor(() => expect(result.current.sourceStatus.washes).toEqual({ loading: false, error: null }));
  expect(result.current.sources.washes.map(w => w.id)).toEqual(['w10', 'w9']);
  expect(result.current.sourceStatus.journalEntries.error.message).toMatch(/unavailable/);
});

it('another account never sees the previous account\'s records', async () => {
  const { result, rerender } = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(result.current.sources.washes).toHaveLength(2));
  mocks.user = { id: 'b' }; mocks.data.washes = { wb: { wash_date: '2026-10-09', status: 'مكتملة', quantity: 1 } };
  rerender();
  expect(result.current.sources.washes.map(w => w.id)).not.toContain('w10');
  await waitFor(() => expect(result.current.sources.washes.map(w => w.id)).toEqual(['wb']));
});

it('reads nothing as a supervisor or without months, and no workers for a partner', async () => {
  mocks.role = 'supervisor';
  const supervisor = renderHook(() => useIncomeStatementSources(october));
  expect(supervisor.result.current.loading).toBe(false);
  supervisor.unmount();
  mocks.role = 'admin';
  const none = renderHook(() => useIncomeStatementSources({ statementMonths: [] }));
  expect(none.result.current.loading).toBe(false);
  none.unmount();
  expect(mocks.calls).toHaveLength(0);
  mocks.role = 'partner';
  const partner = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(partner.result.current.loading).toBe(false));
  expect(mocks.calls).not.toContain('all:bikers');
  expect(partner.result.current.sources.bikers).toBeUndefined();
});

it('the washes and bikers pages reuse the month the overview already read', async () => {
  const overview = renderHook(() => useIncomeStatementSources(october));
  await waitFor(() => expect(overview.result.current.loading).toBe(false));
  const reads = mocks.calls.length;
  const page = renderHook(() => useWashes({ months: ['2026-10'] }));
  await waitFor(() => expect(page.result.current.loading).toBe(false));
  expect(page.result.current.items.map(w => w.id)).toEqual(['w10']);
  expect(mocks.calls).toHaveLength(reads);
  // A month nobody read yet costs one range query, never the whole register.
  const november = renderHook(() => useWashes({ months: ['2026-11'] }));
  await waitFor(() => expect(november.result.current.items.map(w => w.id)).toEqual(['w11']));
  expect(mocks.calls.slice(reads)).toEqual(['range:washes']);
});
