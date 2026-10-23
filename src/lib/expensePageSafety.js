import { OWNER_ADVANCE_MONTH_PLAN } from './advanceMonth.js';
export function paymentParentIds(entries, kind) {
  return new Set(entries.map(row => kind === 'startup' ? row.startupCostId ?? row.startup_cost_id : row.annualExpenseId ?? row.annual_expense_id).filter(Boolean));
}
export function paidWithoutEntries(items, parentIds, kind) {
  return items.filter(item => (kind === 'startup' ? item.status === 'completed' : item.paymentStatus === 'paid') && !parentIds.has(item.id));
}
export function planHasFinancialHistory(item, parentIds) {
  return parentIds.has(item.id) || Number(item.actualAmount) > 0 || Boolean(item.postedEntryId);
}
export function advanceBikerState(expense, bikers) {
  if (!expense.bikerId) return { label: 'غير مربوط ببايكر', risky: false };
  const biker = bikers.find(row => row.id === expense.bikerId);
  if (!biker) return { label: 'محذوف من سجل البايكرز', risky: true };
  const label = String(biker.currentStatus || '').trim();
  return { label: label || 'الحالة غير مسجلة', risky: /^(?:هرب|مشيناه|محذوف)/u.test(label) };
}
export function riskyAdvances(expenses, bikers) {
  const rows = expenses.filter(row => row.status === 'pending' && advanceBikerState(row, bikers).risky
    && Number(row.amount) > Number(row.recoveredAmount || 0));
  return { rows, count: rows.length, amount: Math.round(rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount) - Number(row.recoveredAmount || 0)), 0) * 100) / 100 };
}
export function ownerAdvanceTaskComplete(expenses) {
  return OWNER_ADVANCE_MONTH_PLAN.rows.every(([id]) => expenses.some(row => row.id === id && row.assignmentMonthExplicit && row.assignmentMonth === OWNER_ADVANCE_MONTH_PLAN.assignmentMonth));
}
