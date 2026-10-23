import { describe, it, expect } from 'vitest';
import { trialBalancePeriod, ledgerPeriodHref } from '../trialBalanceView';
import { ledgerLocationFilters } from '../ledgerPresentation';
const accounts = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '1510', nameArabic: 'مجمع الإهلاك', accountType: 'asset', normalBalance: 'credit' },
  { code: '1100', nameArabic: 'الذمم', accountType: 'asset', normalBalance: 'debit' },
  { code: '3000', accountType: 'equity', normalBalance: 'credit' },
  { code: '4000', accountType: 'revenue', normalBalance: 'credit' },
  { code: '5100', accountType: 'expense', normalBalance: 'debit' },
];
const entries = [{ id: 'a', entryDate: '2026-09-30', status: 'posted' }, { id: 'b', entryDate: '2026-10-02', status: 'posted' }];
const lines = [
  { entryId: 'a', accountId: '1010', debit: 100 }, { entryId: 'a', accountId: '3000', credit: 100 },
  { entryId: 'b', accountId: '1010', credit: 130 }, { entryId: 'b', accountId: '5100', debit: 150 },
  { entryId: 'b', accountId: '1510', credit: 20 },
];
describe('trial balance period presentation', () => {
  it('preserves opening + movement = closing, totals by type, result and abnormal balances', () => {
    const r = trialBalancePeriod(accounts, entries, lines, { from: '2026-10-01', to: '2026-10-23' });
    expect(r.balanced).toBe(true);
    expect(r.rows.find(a => a.code === '1010')).toMatchObject({ openingSigned: 100, debit: 0, credit: 130, closingSigned: -30, abnormal: true });
    expect(r.rows.find(a => a.code === '1510').abnormal).toBe(false);
    expect(r.groups.find(a => a.type === 'asset')).toMatchObject({ openingSigned: 100, debit: 0, credit: 150, closingSigned: -50 });
    expect(r.groups.reduce((s, g) => s + g.debit, 0)).toBe(r.totalDebit);
    expect(r.groups.reduce((s, g) => s + g.credit, 0)).toBe(r.totalCredit);
    expect(r.result).toBe(-150);
    expect(r.closingDebit).toBe(r.closingCredit);
    expect(r.rows.some(a => a.code === '1100')).toBe(false);
    expect(trialBalancePeriod(accounts, entries, lines, { showAll: true }).rows.find(a => a.code === '1100')).toMatchObject({ hasMovement: false, closingSigned: 0 });
  });
  it('includes original plus mirror, not the mirror alone; excludes drafts and future entries', () => {
    const r = trialBalancePeriod(accounts, [{ ...entries[0], status: 'reversed' }, { id: 'mirror', entryDate: '2026-10-01', status: 'posted' }, { id: 'draft', entryDate: '2026-10-01', status: 'draft' }],
      [...lines.filter(l => l.entryId === 'a'), { entryId: 'mirror', accountId: '1010', credit: 100 }, { entryId: 'mirror', accountId: '3000', debit: 100 }, { entryId: 'draft', accountId: '1010', debit: 900 }], { from: '2026-10-01', to: '2026-10-23' });
    expect(r.rows.find(a => a.code === '1010').closingSigned).toBe(0);
    expect(r.totalCredit).toBe(100);
  });
  it('round trips account and exact dates to the ledger; rejects malformed URL values', () => {
    expect(ledgerLocationFilters(ledgerPeriodHref('1010', '2026-09-01', '2026-09-30'))).toEqual({ account: '1010', from: '2026-09-01', to: '2026-09-30' });
    expect(ledgerLocationFilters('?account=<bad>&from=2026-02-30&to=bad')).toEqual({ account: '', from: '', to: '' });
  });
});
