// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const ledger = vi.hoisted(() => {
  const entries = []; const lines = [];
  for (let i = 1; i <= 230; i += 1) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    entries.push({ id: `e${i}`, entryNumber: i, entryDate: `2026-10-${day}`, status: 'posted' });
    lines.push({ id: `l${i}`, entryId: `e${i}`, accountId: '1000', debit: 10, credit: 0 });
  }
  const accounts = [{ code: '1000', name: 'النقدية', normalBalance: 'debit' }];
  return { accounts, entries, lines, accountIndex: new Map([['1000', accounts[0]]]), needsSeeding: false, loading: false, error: null, refetch: () => {} };
});
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ledger }));
vi.mock('../TopBar', () => ({ default: () => null }));
import GeneralLedgerPage from '../GeneralLedgerPage';
afterEach(cleanup);

it('shows the ledger a hundred rows at a time while the balances cover every row', () => {
  const { container } = render(<GeneralLedgerPage />);
  const rows = () => container.querySelectorAll('tbody tr').length - 1; // minus the opening row
  expect(rows()).toBe(100);
  // The closing total is the whole account, not the rows on screen.
  expect(container.querySelector('tfoot').textContent).toMatch(/2,300/);
  fireEvent.click(screen.getByRole('button', { name: 'عرض المزيد' }));
  expect(rows()).toBe(200);
  fireEvent.click(screen.getByRole('button', { name: 'عرض المزيد' }));
  expect(rows()).toBe(230);
  expect(screen.queryByRole('button', { name: 'عرض المزيد' })).toBeNull();
});
