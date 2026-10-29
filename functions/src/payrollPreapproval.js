import { advanceAssignmentMonth } from '../../src/lib/advanceMonth.js';
import { round2 } from './invariants.js';
import { uniqueCompletedCommissionWashes } from './washCommission.js';
import { custodyExpenseUsedCents } from './financeEmployeeAdvance.js';

export const departedWithoutEndDate = biker => /هرب|مشيناه/.test(String(biker.current_status ?? biker.currentStatus ?? ''))
  && !String(biker.end_date ?? biker.endDate ?? '').trim();
export const pendingAdvance = row => row.status === 'recovered' ? 0
  : round2(Math.max(0, Number(row.amount || 0) - Math.max(0, Number(row.recovered_amount ?? row.recoveredAmount ?? 0))
    - custodyExpenseUsedCents(row) / 100));
const total = rows => round2(rows.reduce((sum, row) => sum + row.amount, 0));

// This is evidence for review, never a new entitlement/deduction rule.
export function payrollPreapproval({ bikers = [], washes = [], advances = [], lines = [], periodKey, today }) {
  const lineById = new Map(lines.map(line => [String(line.bikerId), line]));
  const washesById = new Map();
  for (const wash of uniqueCompletedCommissionWashes(washes, `${periodKey}-01`, `${periodKey}-31`)) {
    const match = wash.biker_id ? bikers.find(b => String(b.id) === String(wash.biker_id))
      : bikers.find(b => String(b.name || '').trim() === String(wash.biker_name || '').trim());
    if (match) washesById.set(String(match.id), (washesById.get(String(match.id)) || 0) + Math.max(0, Number(wash.quantity) || 0));
  }
  const byBiker = bikers.map(biker => {
    const line = lineById.get(String(biker.id));
    const pending = advances.filter(a => String(a.biker_id ?? a.bikerId ?? '') === String(biker.id) && pendingAdvance(a) > 0);
    const outstanding = round2(pending.reduce((s, a) => s + pendingAdvance(a), 0));
    const assigned = round2(pending.filter(a => advanceAssignmentMonth(a) === periodKey).reduce((s, a) => s + pendingAdvance(a), 0));
    return { bikerId: String(biker.id), name: biker.name_ar || biker.nameArabic || biker.name || '',
      currentStatus: biker.current_status ?? biker.currentStatus ?? '', startDate: biker.start_date ?? biker.startDate ?? '',
      endDate: biker.end_date ?? biker.endDate ?? '', amount: round2(Number(line?.netDue || 0)),
      outstanding, assigned, deduction: round2(Number(line?.advanceDeduction || 0)),
      washCount: washesById.get(String(biker.id)) || 0, missingEndDate: departedWithoutEndDate(biker),
      pendingAdvances: pending.map(a => ({ id: a.id, amount: pendingAdvance(a), assignmentMonth: advanceAssignmentMonth(a), date: a.spent_date || null,
        remainingAfterPreview: round2(Math.max(0, pendingAdvance(a) - (line?.advanceAllocations || []).filter(x => x.advanceId === a.id).reduce((s, x) => s + Number(x.amount || 0), 0))) })) };
  });
  const missingEndDates = byBiker.filter(b => b.missingEndDate && lineById.has(b.bikerId));
  const noWashes = byBiker.filter(b => lineById.has(b.bikerId) && b.washCount === 0);
  const futureStarts = byBiker.filter(b => b.startDate && b.startDate > today);
  const pendingUnDeducted = byBiker.filter(b => b.outstanding > b.deduction).map(b => ({ ...b, amount: round2(b.outstanding - b.deduction) }));
  const unassigned = advances.filter(a => !a.biker_id && !a.bikerId && pendingAdvance(a) > 0);
  return { periodKey, today, approvalBlocked: missingEndDates.length > 0, byBiker,
    missingEndDates: { count: missingEndDates.length, amount: total(missingEndDates), rows: missingEndDates },
    noWashes: { count: noWashes.length, amount: total(noWashes), rows: noWashes },
    futureStarts: { count: futureStarts.length, amount: total(futureStarts), rows: futureStarts },
    pendingUnDeducted: { count: pendingUnDeducted.reduce((s, b) => s + b.pendingAdvances.filter(a => a.remainingAfterPreview > 0).length, 0), amount: total(pendingUnDeducted), rows: pendingUnDeducted },
    unassignedAdvances: { count: unassigned.length, amount: round2(unassigned.reduce((s, a) => s + pendingAdvance(a), 0)) } };
}

export const payrollApprovalAllowed = ({ loading, error, review, override = false, role, reason = '' }) => !loading && !error
  && Boolean(review) && (!review.approvalBlocked || (override && role === 'admin' && String(reason).trim().length > 0));
