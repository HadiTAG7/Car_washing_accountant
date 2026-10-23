import { round2 } from './accounting/journal';
import { ledgerSourceIdentity } from './ledgerPresentation';

// Display accepted P&L details and the existing workbench's read result.
// These figures are neither journals nor a new payable recognition rule.
export function balanceUnposted({ statement, entries, asOf, workbench }) {
  const revenueRows = statement.details.netRevenue.items.filter(row => row.status === 'unposted');
  const taxKnown = revenueRows.every(row => Number.isFinite(row.source.tax?.vat));
  const revenue = round2(revenueRows.reduce((total, row) => total + row.amount, 0));
  const vat = taxKnown ? round2(revenueRows.reduce((total, row) => total + row.source.tax.vat, 0)) : null;
  const entryIndex = new Map(entries.map(row => [row.id, row]));
  const postedSources = new Set(entries.filter(row => ['posted', 'reversed'].includes(row.status) && row.entryDate <= asOf)
    .map(row => ledgerSourceIdentity(row, entryIndex)).filter(Boolean).map(row => `${row.kind}:${row.id}`));
  const pending = workbench?.complete ? workbench.items.filter(row => row.date && row.date <= asOf
    && !postedSources.has(`${row.kind}:${row.sourceId}`) && !row.workflowNote
    && !['complete', 'posted_unproven'].includes(row.workflowStage)) : null;
  const validAmounts = pending?.every(row => Number.isFinite(row.amount));
  return { payroll: statement.salaryAccrual?.unposted ?? null, estimated: statement.salaryAccrual?.estimated === true,
    revenue, vat, issues: statement.issues || [],
    documents: validAmounts ? { count: pending.length, amount: round2(pending.reduce((total, row) => total + row.amount, 0)),
      approvedCount: pending.filter(row => row.workflowStage === 'approved').length,
      approvedAmount: round2(pending.filter(row => row.workflowStage === 'approved').reduce((total, row) => total + row.amount, 0)) } : null };
}
