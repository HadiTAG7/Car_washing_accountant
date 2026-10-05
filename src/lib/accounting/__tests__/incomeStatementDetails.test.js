import { describe, expect, it } from 'vitest';
import { liveIncomeStatement } from '../liveIncomeStatement';
import { monthlyStatement } from '../monthlyStatement';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../chartOfAccounts';
import { balanceSheet, generalLedger, incomeStatement, trialBalance } from '../reports';
import { incomeStatementDetails } from '../incomeStatementDetails';

const accounts = DEFAULT_CHART_OF_ACCOUNTS;
const entry = (id, date, movements, extra = {}) => ({ id, entryDate: date, status: 'posted', sourceType: 'manual',
  lines: movements.map(([accountId, debit, credit]) => ({ accountId, debit, credit })), ...extra });
const linesOf = entries => entries.flatMap(e => e.lines.map((row, i) => ({ ...row, id: `${e.id}:${i}`, entryId: e.id })));
const payroll = () => [
  entry('synthetic-163', '2026-10-04', [['5010', 6960, 0], ['2010', 0, 6960], ['2010', 6960, 0], ['1300', 0, 650], ['1010', 0, 6310]], { sourceType: 'payroll', sourceId: '2026-09__r1', entryNumber: 163, payrollSnapshot: { periodKey: '2026-09' } }),
  entry('synthetic-164', '2026-10-03', [['5010', 4500, 0], ['2010', 0, 4500], ['2010', 4500, 0], ['1300', 0, 1000], ['1010', 0, 3500]], { sourceType: 'payroll', sourceId: '2026-09__r1', entryNumber: 164, payrollSnapshot: { periodKey: '2026-09' } }),
];
const washes = () => Array.from({ length: 16 }, (_, index) => ({ id: `synthetic-w${index}`, wash_date: '2026-10-04', status: 'مكتملة', price: 20, quantity: 1,
  revenue_origin: 'sweater', collection_status: 'confirmed_by_owner', owner_tax_snapshot: { source: 'owner_statement', clarificationId: 'synthetic-tax', currency: 'SAR', quantity: 1, priceMode: 'exclusive', net: 20, vat: 3, gross: 23 } }));
// Synthetic aggregate fixture, not an assertion about production invoice VAT.
const expense = { id: 'synthetic-purchase', expense_name: 'Synthetic operating purchase', logged_date: '2026-10-03',
  total_variable_cost: 3441.4, is_tax_invoice: true, vat_amount: 188.82, invoice_number: 'synthetic-invoice',
  invoice_date: '2026-10-03', supplier: 'Synthetic supplier', price_mode: 'inclusive' };
const options = (entries = [], extra = {}) => ({ accounts, entries, lines: linesOf(entries), periodKey: '2026-10', ...extra });
const checkAll = statement => {
  for (const detail of Object.values(statement.details)) {
    expect(detail.reconciledTotal).toBe(detail.amount);
    expect(Math.round((detail.itemsTotal + detail.adjustments.reduce((sum, row) => sum + row.amount, 0)) * 100) / 100).toBe(detail.amount);
  }
};

describe('income statement source details and salary accrual periods', () => {
  it('explains the old14712.58 and moves only11460 of salary into September, preserving320 net revenue and all cash/advance movements', () => {
    const entries = payroll(); const input = options(entries, { sources: { washes: washes(), variables: [expense] } });
    const untouched = structuredClone(input);
    const legacy = entries.map(e => ({ ...e, sourceType: 'manual', sourceId: null, payrollSnapshot: null }));
    const before = liveIncomeStatement({ ...input, entries: legacy });
    expect(before.directCosts).toBe(14712.58); expect(before.netProfit).toBe(-14392.58); checkAll(before);
    const october = liveIncomeStatement(input);
    const september = liveIncomeStatement({ ...input, periodKey: '2026-09' });
    expect(october).toMatchObject({ netRevenue: 320, directCosts: 3252.58, netProfit: -2932.58 });
    expect(september.directCosts).toBe(11460);
    expect(september.directCosts + october.directCosts).toBe(before.directCosts);
    expect(september.details.directCosts.items).toHaveLength(2);
    expect(september.details.directCosts.items.map(row => row.date)).toEqual(['2026-10-04', '2026-10-03']);
    expect(september.details.directCosts.items.every(row => row.accountingPeriod === '2026-09' && row.periodBasis === 'payroll_snapshot')).toBe(true);
    expect(october.details.directCosts.items[0]).toMatchObject({ status: 'unposted', amount: 3252.58, source: { id: expense.id, documentNumber: expense.invoice_number, tax: { gross: 3441.4, vat: 188.82, net: 3252.58 } } });
    expect(october.details.directCosts.periodTransfers.map(row => row.amount)).toEqual([6960, 4500]);
    expect(october.details.grossRevenue.items.every(row => row.amount === 20 && row.source.tax.gross === 23)).toBe(true);
    checkAll(october); checkAll(september);
    const window = { from: '2026-10-01', to: '2026-10-31' };
    expect(generalLedger('1010', entries, input.lines, window).totalCredit).toBe(9810);
    expect(generalLedger('1300', entries, input.lines, window).totalCredit).toBe(1650);
    expect(trialBalance(accounts, entries, input.lines, window).balanced).toBe(true);
    expect(incomeStatement(accounts, entries, input.lines, window).totalCost).toBe(11460);
    expect(balanceSheet(accounts, entries, input.lines, { asOf: '2026-09-30' }).balanced).toBe(true);
    expect(input).toEqual(untouched);
  });
  it('uses the structured run ID if the old snapshot is missing, without guessing from a description or journal period', () => {
    const entries = payroll(); entries[0].payrollSnapshot = null; entries[1].payrollSnapshot = null;
    expect(liveIncomeStatement(options(entries, { periodKey: '2026-09' })).directCosts).toBe(11460);
    entries[0].sourceId = 'bad-run'; entries[0].description = 'رواتب سبتمبر 2026';
    entries[1].sourceId = '2026-13__r1';
    expect(liveIncomeStatement(options(entries, { periodKey: '2026-09' })).directCosts).toBe(0);
    expect(liveIncomeStatement(options(entries)).directCosts).toBe(11460);
  });
  it('keeps partial payment entries from the same run, ignores drafts, and does not recreate accrual at settlement', () => {
    const accrued = entry('accrued', '2026-09-30', [['5010', 11460, 0], ['2010', 0, 11460]]);
    const paid = entry('paid', '2026-10-04', [['2010', 11460, 0], ['1300', 0, 1650], ['1010', 0, 9810]], { sourceType: 'payroll', sourceId: '2026-09__r1' });
    const draft = entry('draft', '2026-10-01', [['5010', 9999, 0]], { status: 'draft', sourceType: 'payroll', sourceId: '2026-09__r1' });
    expect(liveIncomeStatement(options([accrued, paid, draft], { periodKey: '2026-09' })).directCosts).toBe(11460);
    expect(liveIncomeStatement(options([accrued, paid, draft])).directCosts).toBe(0);
  });
  it.each(['reversesEntryId', 'reversalOf'])('nets a salary reversal against its earned month using %s while the refund keeps its actual date', key => {
    const original = payroll()[0]; original.status = 'reversed';
    const reversed = entry('reversal', '2026-11-01', original.lines.map(row => [row.accountId, row.credit, row.debit]), { sourceType: 'payroll_reversal', [key]: original.id });
    const input = options([original, reversed], { periodKey: '2026-09' });
    const result = liveIncomeStatement(input);
    expect(result.directCosts).toBe(0); expect(result.details.directCosts.items.map(row => row.amount)).toEqual([6960, -6960]); checkAll(result);
    expect(generalLedger('1010', input.entries, input.lines, { from: '2026-11-01', to: '2026-11-30' }).totalDebit).toBe(6310);
  });
  it('replaces operations with exact posted sources, honours returns and reversals, and excludes plans, advances and invalid/out-of-period rows', () => {
    const sale = entry('sale', '2026-10-04', [['4000', 0, 20]], { sourceKind: 'wash', sourceId: 'synthetic-w0' });
    const purchase = entry('purchase', '2026-10-03', [['5100', 3252.58, 0]], { sourceKind: 'variable', sourceId: expense.id });
    const credit = entry('credit', '2026-10-05', [['4010', 20, 0]], { sourceType: 'credit_note' });
    const input = options([sale, purchase, credit], { sources: { washes: [...washes(), { ...washes()[0], id: 'duplicate', ssp_booking_id: 'shared' }, { ...washes()[0], id: 'dup2', ssp_booking_id: 'shared' }], variables: [expense],
      monthlies: [{ id: 'plan', recurrence: 'monthly', total_monthly_cost: 10000 }], temporaryExpenses: [{ amount: 20000 }] } });
    const result = liveIncomeStatement(input);
    expect(result.details.directCosts.items).toHaveLength(1); expect(result.details.directCosts.items[0].status).toBe('posted');
    expect(result.details.grossRevenue.items.filter(row => row.source.id === sale.sourceId)).toHaveLength(1);
    expect(result.netRevenue).toBe(320); expect(result.details.salesReturns.items[0].amount).toBe(20); checkAll(result);
  });
  it('reports rounding explicitly and exposes a material unexplained remainder instead of assigning it to a source', () => {
    const entries = [entry('tiny', '2026-10-01', [['5100', 0.01, 0], ['5100', 0.01, 0], ['5100', 0.01, 0]])];
    const result = monthlyStatement(options(entries, { scalingFactor: 0.5, includeExpenseBreakdown: true }));
    expect(result.details.directCosts.adjustments).toEqual([{ kind: 'rounding', amount: -0.01 }]); checkAll(result);
    const missing = incomeStatementDetails({ statement: { ...result, directCosts: 100 }, accounts, entries: [], lines: [], operationalItems: [], factor: 1 });
    expect(missing.directCosts.adjustments).toEqual([{ kind: 'unexplained', amount: 100 }]);
    expect(missing.directCosts.items).toEqual([]); expect(missing.directCosts.reconciledTotal).toBe(100);
  });
  it('excludes unresolved tax without claiming a zero-valued source and keeps fee formulas tied to the same statement', () => {
    const result = liveIncomeStatement(options([], { sources: { washes: washes(), variables: [{ ...expense, vat_amount: -1 }] } }));
    expect(result.issues).toHaveLength(1); expect(result.details.directCosts.items).toHaveLength(0);
    expect(result.details['fee:management'].items[0].fee).toMatchObject({ base: 320, rate: 0.1 }); checkAll(result);
  });
});
