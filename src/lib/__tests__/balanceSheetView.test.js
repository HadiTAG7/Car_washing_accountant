import { describe, it, expect } from 'vitest';
import { balanceSheetPresentation, comparisonRows, fixedAssetPresentation, previousMonthEnd } from '../balanceSheetView';
const accounts = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '1500', nameArabic: 'الأصول', accountType: 'asset', normalBalance: 'debit' },
  { code: '1510', nameArabic: 'مجمع الإهلاك', accountType: 'asset', normalBalance: 'credit' },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit' },
  { code: '3000-a', nameArabic: 'رأس مال — شريك تجريبي', accountType: 'equity', normalBalance: 'credit' },
  { code: '3100', accountType: 'equity', normalBalance: 'credit' },
  { code: '4000', accountType: 'revenue', normalBalance: 'credit' },
  { code: '5100', accountType: 'expense', normalBalance: 'debit' },
];
const entries = [
  { id: 'capital', entryDate: '2025-01-01', status: 'posted' },
  { id: 'priorExpense', entryDate: '2025-03-01', status: 'posted' },
  { id: 'bike', entryDate: '2026-05-01', entryNumber: 41, status: 'reversed', sourceKind: 'startup', sourceId: 'bike-doc' },
  { id: 'undo', entryDate: '2026-05-02', status: 'posted', reversalOf: '41' },
  { id: 'franchise', entryDate: '2026-05-03', status: 'posted', sourceKind: 'startup', sourceId: 'franchise-doc' },
  { id: 'phone', entryDate: '2026-05-04', status: 'posted', sourceKind: 'startup', sourceId: 'phone-doc' },
  { id: 'expense', entryDate: '2026-06-01', status: 'posted' },
];
const lines = [
  ['capital', '1010', 200, 0], ['capital', '3000-a', 0, 200],
  ['priorExpense', '5100', 20, 0], ['priorExpense', '1010', 0, 20],
  ['bike', '1500', 50, 0], ['bike', '1010', 0, 50], ['undo', '1500', 0, 50], ['undo', '1010', 50, 0],
  ['franchise', '1500', 100, 0], ['franchise', '1010', 0, 100], ['phone', '1500', 30, 0], ['phone', '1010', 0, 30],
  ['expense', '5100', 80, 0], ['expense', '1010', 0, 80],
].map(([entryId, accountId, debit, credit]) => ({ entryId, accountId, debit, credit }));
const sources = { startupEntries: [{ id: 'bike-doc', startup_cost_id: 'b' }, { id: 'franchise-doc', startup_cost_id: 'f' }, { id: 'phone-doc', startup_cost_id: 'p' }],
  startupItems: [{ id: 'b', item_name: 'الدباب' }, { id: 'f', item_name: 'رسوم الفرنشايز' }, { id: 'p', item_name: 'جوالات' }], assetSourcesReady: true };
const input = { accounts, entries, lines, ...sources, asOf: '2026-10-23' };
describe('balance sheet presentation, unchanged journal totals', () => {
  it('groups current/noncurrent, splits intangibles, rolls back reversals, preserves the equation and separates year results', () => {
    const r = balanceSheetPresentation(input);
    expect(r.balanced).toBe(true);
    expect(r.totalAssets).toBe(100);
    expect(r.sections.currentAssets.total).toBe(-30);
    expect(r.rows.find(row => row.key === 'fixed').amount).toBe(30);
    expect(r.rows.find(row => row.key === 'intangible').amount).toBe(100);
    expect(r.fixedGroups.find(row => row.key === 'bikes').amount).toBe(0);
    expect(r.retainedAmount).toBe(-20);
    expect(r.currentResult).toBe(-80);
    expect(r.sections.equity.total).toBe(r.totalEquity);
    expect(r.abnormalRows.map(row => row.key)).toEqual(['1010']);
    expect(r.rows.find(row => row.key === 'capital').children[0].label).toBe('شريك تجريبي');
    expect(r.rows.find(row => row.key === 'depreciation').note).toBe('ما انسجل إهلاك');
  });
  it('missing detail sources keep the entire 1500 balance rather than an invented zero split', () => {
    const r = balanceSheetPresentation({ ...input, assetSourcesReady: false });
    expect(r.rows.find(row => row.key === 'fixed').amount).toBe(130);
    expect(r.rows.some(row => row.key === 'intangible')).toBe(false);
    expect(r.totalAssets).toBe(100);
  });
  it('keeps comparison-only accounts, dates and equity closed to retained earnings without double counting', () => {
    const current = balanceSheetPresentation(input);
    const previous = balanceSheetPresentation({ ...input, asOf: '2026-05-31' });
    const cash = comparisonRows(current, previous, 'currentAssets').find(row => row.key === '1010');
    expect(cash).toMatchObject({ amount: -30, comparison: 50, abnormal: true, comparisonAbnormal: false });
    expect(previousMonthEnd('2026-01-23')).toBe('2025-12-31');
    expect(previousMonthEnd('2024-03-01')).toBe('2024-02-29');
    const close = { id: 'close', status: 'posted', entryDate: '2025-12-31' };
    const closed = balanceSheetPresentation({ ...input, entries: [...entries, close], lines: [...lines,
      { entryId: 'close', accountId: '5100', credit: 20 }, { entryId: 'close', accountId: '3100', debit: 20 }] });
    expect(closed.retainedAmount).toBe(-20);
    expect(closed.currentResult).toBe(-80);
    expect(closed.totalEquity).toBe(current.totalEquity);
  });
  it('does not classify unlinked manual purchases by a guessed asset type or lose them', () => {
    const r = fixedAssetPresentation([{ id: 'manual', status: 'posted', entryDate: '2026-01-01', description: 'انضمام' }],
      [{ entryId: 'manual', accountId: '1500', debit: 20, credit: 0 }], '2026-10-23', [], []);
    expect(r.find(row => row.key === 'other').amount).toBe(20);
    expect(r.find(row => row.key === 'intangible').amount).toBe(0);
  });
});
