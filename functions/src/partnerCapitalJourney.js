import { round2 } from '../../src/lib/accounting/journal.js';
import { normalizeExpenseDate } from '../../src/lib/expenseDates.js';
import { isRealCalendarDate } from '../../src/lib/vatFields.js';

// Presentation of the existing allocation, not a new funding policy or a bank
// reconciliation. Inputs are already scoped by the partnerView server guard.
export function partnerCapitalJourney({ statements, initialSpend, receipts, plans, startupEntries, factor, through, fundingAsOf }) {
  const latest = statements.at(-1).founding;
  const sum = (rows, key) => round2(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
  const operatingTotal = sum(statements, 'totalCosts');
  const reserveTotal = sum(statements, 'annualReserve');
  const allocatedInitial = round2(latest.recordedCost - operatingTotal - reserveTotal);
  // Cumulative cents keep the detail equal to the existing authoritative
  // balance, including the founding report's end-of-period rounding.
  let raw = 0;
  let allocated = 0;
  const initialItems = initialSpend.filter(row => row.month <= through)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map(row => {
      raw += row.amount;
      const target = round2(raw);
      const amount = round2(target - allocated);
      allocated = target;
      const date = normalizeExpenseDate(row.date);
      return { id: row.id, description: row.description, date: isRealCalendarDate(date) ? date : null,
        kind: row.kind, groupKey: row.groupKey || null, groupLabel: row.groupLabel || null,
        reversal: row.reversal, basis: row.basis, amount };
    });
  const initialTotal = allocated;
  const warnings = plans.flatMap(plan => {
    const documented = startupEntries.filter(row => row.startup_cost_id === plan.id)
      .reduce((total, row) => total + (Number(row.amount) || 0), 0);
    const gap = round2((Number(plan.actual_amount) || 0) - documented);
    return gap ? [{ description: plan.item_name || 'بند تأسيس', amount: round2(gap * factor),
      reason: 'تفصيل الصرف لا يطابق إجمالي البند المسجل' }] : [];
  });
  // Never change a document amount to make an incomplete allocation balance
  // look reconciled. Keep its documented amount and mark the balance unknown.
  const allocationGap = round2(initialTotal - allocatedInitial);
  if (allocationGap) warnings.push({ description: 'مطابقة صرف التأسيس مع رصيد التقرير',
    amount: allocationGap, reason: 'نطاق مستندات الصرف لا يطابق حسبة الرصيد؛ يلزم مراجعة الإدارة' });
  for (const item of initialItems.filter(item => !item.date)) {
    warnings.push({ description: item.description, reason: 'تاريخ مستند صرف التأسيس غير صحيح' });
  }
  const inFundingScope = row => fundingAsOf
    ? String(row.payment_date || '').slice(0, 10) <= fundingAsOf
    : String(row.payment_date || '').slice(0, 7) <= through;
  const safeReceipts = receipts.filter(row => isRealCalendarDate(row.payment_date) && inFundingScope(row))
    .map(row => ({ id: row.id, date: row.payment_date, amount: round2(Number(row.amount) || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (safeReceipts.length !== receipts.filter(inFundingScope).length) {
    warnings.push({ description: 'سند قبض بلا تاريخ صحيح', reason: 'يلزم التحقق من تاريخ سند رأس المال' });
  }
  return {
    version: 1, complete: warnings.length === 0, warnings, receipts: safeReceipts, fundingAsOf,
    received: sum(safeReceipts, 'amount'), funded: latest.funded, budget: latest.budget,
    initialTotal, operatingTotal, reserveTotal, remaining: latest.remaining,
    beyondBalance: round2(Math.max(0, latest.recordedCost - latest.funded)),
    initialItems,
    months: statements.map(statement => ({
      periodKey: statement.periodKey, operatingCost: statement.totalCosts,
      reserve: statement.annualReserve, remaining: statement.founding.remaining,
      covered: statement.founding.covered, uncovered: statement.founding.uncovered,
      groups: statement.expenseBreakdown.groups.map(group => ({
        key: group.key, label: group.label, amount: group.amount,
        items: group.items.map(item => ({ id: item.id, description: item.description,
          date: item.entryDate, amount: item.amount, basis: item.basis })),
      })),
    })),
  };
}
