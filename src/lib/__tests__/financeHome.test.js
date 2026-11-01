import { describe, expect, it } from 'vitest';
import { FINANCE_DOCUMENT_SOURCES, financeLedgerSnapshot, financeVatSnapshot, financeWorkbenchCounts } from '../financeHome';
import { FINANCE_KINDS } from '../../../functions/src/financeReview';
import { balanceSheet, generalLedger, incomeStatement } from '../accounting/reports';
import { buildVatReport } from '../accounting/vatReturn';
import { taxPolicyAt } from '../accounting/taxPolicy';

const accounts = [
  { code: '1010', accountType: 'asset' }, { code: '1020', accountType: 'asset' },
  { code: '3000', accountType: 'equity' }, { code: '3000-A', parentId: '3000', accountType: 'equity' },
  { code: '3100', accountType: 'equity' }, { code: '4000', accountType: 'revenue' }, { code: '5100', accountType: 'expense' },
];
const ledger = { accounts,
  entries: [{ id: 'SEP', entryDate: '2026-09-01', status: 'posted' }, { id: 'OCT', entryDate: '2026-10-10', status: 'reversed' },
    { id: 'REV', entryDate: '2026-10-11', status: 'posted', reversalOf: 'OCT' }, { id: 'DRAFT', entryDate: '2026-10-20', status: 'draft' }],
  lines: [
    { entryId: 'SEP', accountId: '1010', debit: 0, credit: 10 }, { entryId: 'SEP', accountId: '1020', debit: 100, credit: 0 },
    { entryId: 'SEP', accountId: '3000-A', debit: 0, credit: 80 }, { entryId: 'SEP', accountId: '3000', debit: 0, credit: 10 },
    { entryId: 'SEP', accountId: '3100', debit: 0, credit: 500 },
    { entryId: 'OCT', accountId: '4000', debit: 0, credit: 50 }, { entryId: 'REV', accountId: '4000', debit: 50, credit: 0 },
    { entryId: 'OCT', accountId: '5100', debit: 40, credit: 0 }, { entryId: 'DRAFT', accountId: '1010', debit: 999, credit: 0 },
  ] };
describe('finance home is a read-only projection of the existing pages', () => {
  it('reuses ledger and balance sheet engines, including prior months and reversing entries, without mutating inputs', () => {
    const frozen = JSON.stringify(ledger);
    const cash = ['1010', '1020'].map(code => ({ code, balance: generalLedger(code, ledger.entries, ledger.lines).closing }));
    const snapshot = financeLedgerSnapshot(ledger, '2026-10', cash);
    const income = incomeStatement(accounts, ledger.entries, ledger.lines, { from: '2026-10-01', to: '2026-10-31', salaryAccrual: false });
    const sheet = balanceSheet(accounts, ledger.entries, ledger.lines);
    expect(snapshot.postedRevenue).toBe(income.totalRevenue);
    expect(snapshot.postedCosts).toBe(income.totalCost + income.totalExpenses);
    expect(snapshot.capital).toBe(sheet.equity.filter(r => r.code === '3000' || r.code.startsWith('3000-')).reduce((sum, r) => sum + r.amount, 0));
    expect(snapshot.position).toEqual({ totalAssets: sheet.totalAssets, totalLiabilities: sheet.totalLiabilities, totalEquity: sheet.totalEquity });
    expect(snapshot.capital).toBe(90); expect(snapshot.availableCash).toBe(90);
    expect(snapshot.negativeAccounts).toEqual([{ code: '1010', balance: -10 }]);
    expect(financeLedgerSnapshot(ledger, '2026-09', cash).postedCosts).toBe(0);
    expect(financeLedgerSnapshot(ledger, '2026-10', []).availableCash).toBeNull();
    expect(JSON.stringify(ledger)).toBe(frozen);
  });
  it('uses the exact VAT report contract and keeps monthly scope separate from quarterly filing', () => {
    const invoices = [{ id: 'I', amount: 115, isTaxInvoice: true, invoiceNumber: 'TEST', invoiceDate: '2026-10-02', supplier: 'Test', vatRate: .15, priceMode: 'inclusive', sourceKind: 'variable' },
      { id: 'NOV', amount: 115, isTaxInvoice: true, invoiceNumber: 'NOV', invoiceDate: '2026-11-02', supplier: 'Test', vatRate: .15, priceMode: 'inclusive', sourceKind: 'variable' }];
    const washes = [{ id: 'W', quantity: 10, price: 23, washDate: '2026-10-03', status: 'مكتملة' }];
    const settings = { vatRegistered: true, washPriceMode: 'inclusive', taxPolicyHistory: [{ effectiveFrom: '2026-01-01', vatRegistered: true, vatRate: .15, washPriceMode: 'inclusive' }] };
    const actual = financeVatSnapshot({ invoices, washes, entries: [], lines: [], settings, month: '2026-10' });
    const expected = buildVatReport({ inputs: invoices, washes, entries: [], lines: [], period: '2026-10', filing: 'monthly',
      policyAt: date => taxPolicyAt(date, settings), postedEntryOf: () => undefined, vatRegistered: true, washPriceMode: 'inclusive' });
    expect(actual).toEqual(expected); expect(actual.unpostedEligible).toHaveLength(1);
    expect(actual.unpostedInputTax).toBe(15);
  });
  it('keeps document fields identical to the existing workbench rather than inventing a new source', () => {
    for (const [kind, collection, amount, date] of FINANCE_DOCUMENT_SOURCES) expect(FINANCE_KINDS[kind]).toMatchObject({ collection, amount, date });
  });
  it('counts beyond the first 30 documents, preserves missing amounts and excludes protected/closed sources from pending', () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({ id: `D${index}`, total_variable_cost: index === 64 ? null : 1, payment_status: 'unknown', logged_date: '2026-10-01' }));
    Object.assign(rows[0], { journal_entry_id: 'J' }); Object.assign(rows[1], { posted_entry_id: 'J2' }); Object.assign(rows[2], { posting_status: 'posted' });
    Object.assign(rows[6], { invoice_date: '2026-09-01' }); Object.assign(rows[7], { paid_date: '2026-09-01' });
    const result = financeWorkbenchCounts({ sources: { variable_expenses: rows }, locks: [{ id: 'variable__D3' }, { id: 'expense__D4' }],
      entries: [{ sourceId: 'D5', sourceKind: 'variable', status: 'reversed' }], periods: [{ periodKey: '2026-09', status: 'closed' }] });
    expect(result.unknownPayment).toEqual({ count: 65, amount: null });
    expect(result.pending).toEqual({ count: 57, amount: null });
  });
  it('separates kind collisions, accepts explicit paid/unpaid, and never mistakes approval for payment or posting', () => {
    expect(financeWorkbenchCounts({ sources: { variable_expenses: [{ id: 'same', total_variable_cost: 3, approval_status: 'approved', payment_status: 'paid' }],
      annual_expense_entries: [{ id: 'same', amount: 7, payment_status: 'unpaid' }] }, locks: [{ id: 'annual__same' }],
    entries: [], periods: [] })).toEqual({ unknownPayment: { count: 0, amount: 0 }, pending: { count: 1, amount: 3 } });
  });
});
