import { describe, it, expect } from 'vitest';
import { subledgerReconciliation, reconciliationMonths } from '../subledgerReconciliation';
const accounts = [
  { code: '1010', accountType: 'asset', normalBalance: 'debit' },
  { code: '1300', accountType: 'asset', normalBalance: 'debit' },
  { code: '1500', accountType: 'asset', normalBalance: 'debit' },
  { code: '1200', accountType: 'asset', normalBalance: 'debit' },
  { code: '3000-a', accountType: 'equity', normalBalance: 'credit' },
  { code: '4000', accountType: 'revenue', normalBalance: 'credit' },
  { code: '5010', accountType: 'expense', normalBalance: 'debit' },
  { code: '5100', accountType: 'expense', normalBalance: 'debit' },
];
const input = {
  accounts, today: '2026-01-23', entries: [{ id: 'e', entryDate: '2026-01-01', status: 'posted' }],
  lines: [{ entryId: 'e', accountId: '1300', debit: 100 }, { entryId: 'e', accountId: '3000-a', credit: 100 }],
  temporaries: [{ amount: 140, status: 'pending' }, { amount: 30, status: 'recovered' }], partners: [{ paidAmount: 180 }],
  sources: { payrollPreviews: [{ periodKey: '2026-01', lines: [{ basicDue: 200, bonus: 0, deduction: 0 }] }],
    variables: [{ id: 'v', total_variable_cost: 50, logged_date: '2026-01-02' }] },
  policyAt: () => ({ known: true, vatRegistered: false, vatRate: 0.15, washPriceMode: 'inclusive' }),
};
describe('subledger page comparisons', () => {
  it('uses current page pending status and capital, and existing monthly cost bridge', () => {
    const r = subledgerReconciliation(input);
    expect(r.rows.find(a => a.key === 'advances')).toMatchObject({ ledger: 100, page: 140, difference: 40 });
    expect(r.rows.find(a => a.key === 'capital')).toMatchObject({ ledger: 100, page: 180, difference: 80 });
    expect(r.rows.find(a => a.key === 'expenses')).toMatchObject({ ledger: 0, page: 250, difference: 250 });
    expect(r.monthly[0].costs.unexplained).toBe(0);
    expect(r.monthly[0].costs.rows).toEqual(expect.arrayContaining([{ key: 'variable', amount: 50 }, { key: 'payroll', amount: 200, estimated: false }]));
    expect(r.differences).toBe(3);
  });
  it('a failed source never becomes zero or a completed comparison; independent rows survive', () => {
    const r = subledgerReconciliation({ ...input, status: { advances: { error: new Error('denied') }, vat: { loading: true }, income: { error: new Error('payroll unavailable') } } });
    expect(r.rows.find(a => a.key === 'advances').page).toBeNull();
    expect(r.rows.find(a => a.key === 'expenses').difference).toBeNull();
    expect(r.rows.find(a => a.key === 'revenue').difference).toBeNull();
    expect(r.unavailable).toBe(4);
    expect(r.differences).toBe(1);
  });
  it('fails closed if a monthly payroll preview is missing instead of summing partial costs', () => {
    const r = subledgerReconciliation({ ...input, today: '2026-02-23' });
    expect(r.rows.find(a => a.key === 'expenses').difference).toBeNull();
    expect(r.monthly.find(a => a.month === '2026-02').error).toBeTruthy();
    expect(reconciliationMonths('2026-12-31')).toHaveLength(12);
  });
});
