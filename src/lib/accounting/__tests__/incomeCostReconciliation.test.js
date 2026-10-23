import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_OF_ACCOUNTS as accounts } from '../chartOfAccounts';
import { liveIncomeStatement } from '../liveIncomeStatement';
import { incomeCostReconciliation } from '../incomeCostReconciliation';

const entry = (id, date, amount, extra = {}) => ({ id, entryDate: date, status: 'posted', sourceKind: 'payroll',
  payrollSnapshot: { periodKey: '2026-09' }, lines: [{ accountId: '5010', debit: amount, credit: 0 }], ...extra });
const fixture = (extra = {}) => {
  const entries = [entry('salary', '2026-10-04', 20280), entry('purchase', '2026-10-05', 559.83,
    { sourceKind: 'variable', sourceId: 'posted-purchase', lines: [{ accountId: '5100', debit: 559.83, credit: 0 }] })];
  const input = { accounts, periodKey: '2026-10', entries, lines: entries.flatMap(e => e.lines.map((line, i) => ({ ...line, entryId: e.id, id: `${e.id}:${i}` }))),
    sources: { payrollPreviews: [{ periodKey: '2026-10', estimated: true, lines: [{ basicDue: 25432.26, commission: 1908, bonus: 0, deduction: 0 }] }],
      variables: [
        { id: 'posted-purchase', total_variable_cost: 559.83, logged_date: '2026-10-05' },
        { id: 'unposted-purchase', total_variable_cost: 4243.98, vat_amount: 243.08, is_tax_invoice: true,
          invoice_number: 'synthetic', supplier: 'Synthetic', invoice_date: '2026-10-06' },
      ], monthlies: [{ id: 'monthly', recurrence: 'one_time', total_monthly_cost: 43.58, logged_date: '2026-10-05' }] }, ...extra };
  return { input, statement: liveIncomeStatement(input) };
};
const reconcile = ({ input, statement }) => incomeCostReconciliation({ ...input, statement });

describe('read-only income cost reconciliation', () => {
  it('explains October using accepted net costs, prior-period salaries, and unpaid accrual without commission or VAT double counting', () => {
    const f = fixture(); const untouched = structuredClone(f);
    const result = reconcile(f);
    expect(result).toMatchObject({ statementTotal: 30036.57, posted: 20839.83, difference: 9196.74, unexplained: 0, matched: true });
    expect(result.rows).toEqual([
      { key: 'transferred-out', amount: -20280 },
      { key: 'payroll', amount: 25432.26, estimated: true },
      { key: 'variable', amount: 4000.9 },
      { key: 'monthly', amount: 43.58 },
    ]);
    expect(f).toEqual(untouched);
  });
  it('explains the opposite salary timing in September instead of inventing an unposted document', () => {
    const f = fixture({ periodKey: '2026-09' });
    expect(reconcile(f)).toMatchObject({ posted: 0, statementTotal: 20280, rows: [{ key: 'transferred-in', amount: 20280 }], unexplained: 0 });
  });
  it('nets reversals and ignores draft journals on both sides', () => {
    const f = fixture(); const original = f.input.entries[0]; original.status = 'reversed';
    f.input.entries.push(entry('undo', '2026-10-07', 0, { sourceKind: 'payroll_reversal', reversalOf: original.id,
      payrollSnapshot: null, lines: [{ accountId: '5010', debit: 0, credit: 20280 }] }), entry('draft', '2026-10-02', 999, { status: 'draft' }));
    f.input.lines = f.input.entries.flatMap(e => e.lines.map((line, i) => ({ ...line, entryId: e.id, id: `${e.id}:${i}` })));
    f.statement = liveIncomeStatement(f.input);
    expect(reconcile(f)).toMatchObject({ posted: 559.83, unexplained: 0, matched: true });
    expect(reconcile(f).rows.some(row => row.key.startsWith('transferred'))).toBe(false);
  });
  it('scales every bridge row once for a partner, including rounding', () => {
    const f = fixture({ scalingFactor: 0.36 });
    expect(reconcile(f)).toMatchObject({ statementTotal: 10813.17, posted: 7502.34, unexplained: 0, matched: true });
  });
  it('never forces an unexplained difference to zero and does not call absent details a match', () => {
    const f = fixture(); f.statement.totalCosts += 7;
    expect(reconcile(f)).toMatchObject({ unexplained: 7, matched: false });
    f.statement.details = null; expect(reconcile(f)).toBeNull();
  });
  it('uses annual source contributions, not annual budgets or parent payment status', () => {
    const f = fixture({ sources: { annualEntries: [{ id: 'annual', amount: 88500, spent_date: '2026-10-01' }],
      annuals: [{ annual_cost: 266048.25, payment_status: 'paid' }] } });
    expect(reconcile(f)).toMatchObject({ annualTotal: 88500, unexplained: 0 });
    expect(reconcile(f).rows.find(row => row.key === 'annual').amount).toBe(88500);
  });
});
