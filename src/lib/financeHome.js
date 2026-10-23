import { balanceSheet, incomeStatement } from './accounting/reports';
import { ACC } from './accounting/chartOfAccounts';
import { round2 } from './accounting/journal';
import { buildVatReport } from './accounting/vatReturn';
import { taxPolicyAt } from './accounting/taxPolicy';
import { indexPeriods, isPeriodClosed } from './accounting/periods';

// Display aggregation only: the same report engines as the original pages.
export function financeLedgerSnapshot(ledger, month, cashBalances) {
  const posted = incomeStatement(ledger.accounts, ledger.entries, ledger.lines,
    { from: `${month}-01`, to: `${month}-31`, salaryAccrual: false });
  const sheet = balanceSheet(ledger.accounts, ledger.entries, ledger.lines);
  const capital = sheet.equity.filter(row => row.code === ACC.PARTNER_CAPITAL || String(row.code).startsWith(`${ACC.PARTNER_CAPITAL}-`));
  const cash = cashBalances.find(row => row.code === ACC.CASH)?.balance;
  const bank = cashBalances.find(row => row.code === ACC.BANK)?.balance;
  return { postedRevenue: posted.totalRevenue, postedCosts: round2(posted.totalCost + posted.totalExpenses),
    cash, bank, availableCash: Number.isFinite(cash) && Number.isFinite(bank) ? round2(cash + bank) : null,
    capital: round2(capital.reduce((sum, row) => sum + row.amount, 0)),
    negativeAccounts: cashBalances.filter(row => row.balance < 0) };
}

export function financeVatSnapshot({ invoices, washes, entries, lines, settings, month }) {
  const washEntryBySource = new Map();
  for (const entry of entries) {
    if (entry.status !== 'posted' || entry.reversalOf || (entry.sourceKind || entry.sourceType) !== 'wash') continue;
    washEntryBySource.set(String(entry.sourceId ?? ''), entry);
  }
  return buildVatReport({ inputs: invoices, washes, entries, lines, period: month, filing: 'monthly',
    policyAt: date => taxPolicyAt(date, settings), postedEntryOf: wash => washEntryBySource.get(String(wash.id)),
    vatRegistered: settings.vatRegistered, washPriceMode: settings.washPriceMode });
}

// Same four original document sources and fields as finance-workbench/list.
// This queue includes all dates, not just its first 30 records. It grants no
// approval/posting permission and does not claim a stored approval is current.
export const FINANCE_DOCUMENT_SOURCES = [
  ['variable', 'variable_expenses', 'total_variable_cost', 'logged_date'],
  ['monthly', 'monthly_expenses', 'total_monthly_cost', 'logged_date'],
  ['annual', 'annual_expense_entries', 'amount', 'spent_date'],
  ['startup', 'startup_cost_entries', 'amount', 'spent_date'],
];
export function financeWorkbenchCounts({ sources, locks, entries, periods }) {
  const lockIds = new Set(locks.map(row => String(row.id)));
  const periodIndex = indexPeriods(periods);
  const documents = FINANCE_DOCUMENT_SOURCES.flatMap(([kind, collection, amountField, dateField]) =>
    (sources[collection] || []).map(row => ({ kind, row, amount: row[amountField], date: row[dateField] })));
  const unknownPayment = documents.filter(({ row }) => !['paid', 'unpaid'].includes(row.payment_status));
  const pending = documents.filter(({ kind, row, date }) => {
    // Mirrors the existing workbench's protection/closed-period exclusion.
    const protectedSource = Boolean(row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted')
      || lockIds.has(`${kind}__${row.id}`) || lockIds.has(`expense__${row.id}`)
      || entries.some(entry => String(entry.sourceId) === String(row.id)
        && (entry.sourceKind ? entry.sourceKind === kind : !entry.sourceType || entry.sourceType === 'expense'));
    const closed = [date, row.paid_date, row.invoice_date].filter(Boolean)
      .some(day => isPeriodClosed(String(day).slice(0, 7), periodIndex));
    return !protectedSource && !closed;
  });
  const summarize = rows => ({ count: rows.length,
    amount: rows.every(doc => Number.isFinite(doc.amount)) ? round2(rows.reduce((sum, doc) => sum + doc.amount, 0)) : null });
  return { unknownPayment: summarize(unknownPayment), pending: summarize(pending) };
}

export const APPROVED_SETTLEMENT_STATUSES = new Set(['approved', 'invoiced', 'partially_collected', 'collected', 'closed']);
