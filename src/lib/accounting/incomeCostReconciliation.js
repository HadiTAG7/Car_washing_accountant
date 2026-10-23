import { incomeStatement, incomeStatementLines } from './reports.js';
import { round2 } from './journal.js';

/** A read-only bridge between the existing ledger and accepted P&L details.
 * Does not calculate a new expense, change recognition, or force a match.
 */
export function incomeCostReconciliation({ statement, accounts, entries, lines, scalingFactor = 1 }) {
  const detail = statement?.details?.totalCosts;
  if (!detail) return null;
  const ledger = incomeStatement(accounts, entries, lines, { from: statement.from, to: statement.to });
  const posted = round2((ledger.totalCost + ledger.totalExpenses) * scalingFactor);
  const expenseCodes = new Set(accounts.filter(row => row.accountType === 'expense').map(row => String(row.code)));
  const sum = rows => round2(rows.reduce((total, row) => total + row.amount, 0));
  const transfers = incomeStatementLines(entries, lines).filter(row => expenseCodes.has(String(row.accountId)))
    .flatMap(row => {
      const journalMonth = String(row.entryDate || '').slice(0, 7);
      const earnedMonth = row.accountingPeriod;
      if (journalMonth === earnedMonth) return [];
      const amount = round2(((Number(row.debit) || 0) - (Number(row.credit) || 0)) * scalingFactor);
      if (earnedMonth === statement.periodKey) return [{ amount, direction: 'in' }];
      if (journalMonth === statement.periodKey) return [{ amount: -amount, direction: 'out' }];
      return [];
    });
  const unposted = detail.items.filter(row => row.status === 'unposted');
  const payroll = unposted.filter(row => row.source.kind === 'payroll_accrual');
  const documents = unposted.filter(row => row.source.kind !== 'payroll_accrual');
  const rows = [
    { key: 'transferred-out', amount: sum(transfers.filter(row => row.direction === 'out')) },
    { key: 'transferred-in', amount: sum(transfers.filter(row => row.direction === 'in')) },
    { key: 'payroll', amount: sum(payroll), estimated: statement.salaryAccrual?.estimated === true },
    ...['variable', 'monthly', 'voucher', 'annual'].map(kind => ({ key: kind,
      amount: sum(documents.filter(row => row.source.kind === kind)) })),
    { key: 'other', amount: sum(documents.filter(row => !['variable', 'monthly', 'voucher', 'annual'].includes(row.source.kind))) },
    { key: 'rounding', amount: sum(detail.adjustments.filter(row => row.kind === 'rounding')) },
  ].filter(row => row.amount !== 0);
  const explained = sum(rows);
  const unexplained = round2(statement.totalCosts - posted - explained) || 0;
  return { statementTotal: statement.totalCosts, posted, difference: round2(statement.totalCosts - posted),
    rows, unexplained, matched: unexplained === 0,
    annualTotal: statement.expenseBreakdown?.groups.find(row => row.key === 'annual')?.amount || 0 };
}
