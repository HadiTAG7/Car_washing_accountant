import { describe, it, expect } from 'vitest';
import { trialBalancePeriod, trialBalancePeriodFromSums, addLineSums, previousDay, ledgerPeriodHref } from '../trialBalanceView';
import { postedLines } from '../accounting/reports';
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
  it('counts an entry dated on «إلى تاريخ» itself and on «من تاريخ», not the day after', () => {
    const edge = [...entries, { id: 'to-day', entryDate: '2026-10-30', status: 'posted' }, { id: 'next-day', entryDate: '2026-10-31', status: 'posted' }];
    const edgeLines = [...lines, { entryId: 'to-day', accountId: '1010', debit: 70 }, { entryId: 'to-day', accountId: '3000', credit: 70 },
      { entryId: 'next-day', accountId: '1010', debit: 5 }, { entryId: 'next-day', accountId: '3000', credit: 5 }];
    const r = trialBalancePeriod(accounts, edge, edgeLines, { from: '2026-10-02', to: '2026-10-30' });
    expect(r.rows.find(a => a.code === '1010')).toMatchObject({ openingSigned: 100, debit: 70, credit: 130, closingSigned: 40 });
    expect(r.balanced).toBe(true);
  });
  it('round trips account and exact dates to the ledger; rejects malformed URL values', () => {
    expect(ledgerLocationFilters(ledgerPeriodHref('1010', '2026-09-01', '2026-09-30'))).toEqual({ account: '1010', from: '2026-09-01', to: '2026-09-30' });
    expect(ledgerLocationFilters('?account=<bad>&from=2026-02-30&to=bad')).toEqual({ account: '', from: '', to: '' });
  });
  // What `posted_line_sums(from, to)` returns: Σ per account of posted and reversed lines in the window.
  const dbSums = (entryRows, lineRows, window) => {
    const by = new Map();
    for (const l of postedLines(entryRows, lineRows, window)) {
      const t = by.get(l.accountId) || { account_id: l.accountId, debit: 0, credit: 0 };
      t.debit = Math.round(t.debit * 100 + (l.debit || 0) * 100) / 100; t.credit = Math.round(t.credit * 100 + (l.credit || 0) * 100) / 100;
      by.set(l.accountId, t);
    }
    return [...by.values()].map(t => ({ ...t, debit: String(t.debit), credit: String(t.credit) }));
  };
  const fromSums = (entryRows, lineRows, { from, to, showAll }) => trialBalancePeriodFromSums(accounts, {
    opening: from ? dbSums(entryRows, lineRows, { to: previousDay(from) }) : [], movement: dbSums(entryRows, lineRows, { from, to }),
  }, { from, showAll });
  it('gives the same trial balance from the database sums as from the journal, for every window', () => {
    const many = [...entries, { id: 'r', entryDate: '2026-08-15', status: 'reversed' }, { id: 'm', entryDate: '2026-10-05', status: 'posted' },
      { id: 'd', entryDate: '2026-10-06', status: 'draft' }, { id: 'f', entryDate: '2026-11-02', status: 'posted' }, { id: 'u', entryDate: '2026-10-07', status: 'posted' }];
    const manyLines = [...lines, { entryId: 'r', accountId: '1010', debit: 0.07 }, { entryId: 'r', accountId: '4000', credit: 0.07 },
      { entryId: 'm', accountId: '1010', credit: 0.07 }, { entryId: 'm', accountId: '4000', debit: 0.07 },
      { entryId: 'd', accountId: '1010', debit: 999 }, { entryId: 'd', accountId: '4000', credit: 999 },
      { entryId: 'f', accountId: '5100', debit: 12.34 }, { entryId: 'f', accountId: '1010', credit: 12.34 },
      { entryId: 'u', accountId: '9999', debit: 0.55 }, { entryId: 'u', accountId: '1010', credit: 0.55 }];
    for (const window of [{ from: '2026-10-01', to: '2026-10-23' }, { from: '', to: '2026-10-23' }, { from: '2026-10-02', to: '2026-10-30' },
      { from: '2026-09-30', to: '2026-09-30' }, { from: '2026-01-01', to: '' }, { from: '2026-10-01', to: '2026-10-23', showAll: true }, { from: '2027-01-01', to: '2027-02-01' }]) {
      expect(fromSums(many, manyLines, window), JSON.stringify(window)).toEqual(trialBalancePeriod(accounts, many, manyLines, window));
    }
  });
  it('adds opening and movement sums in whole halalas', () => {
    expect(addLineSums([{ account_id: '1010', debit: '0.1', credit: '0' }], [{ account_id: '1010', debit: '0.2', credit: '0.07' }, { account_id: 5100, debit: 1, credit: null }]))
      .toEqual([{ account_id: '1010', debit: 0.3, credit: 0.07 }, { account_id: '5100', debit: 1, credit: 0 }]);
  });
});
