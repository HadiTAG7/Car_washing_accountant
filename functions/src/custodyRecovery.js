// ═══════════════════════════════════════════════════════════════════════════
// عهدة الموظف — مصروف دُفع من عهدته أو دفعه بنفسه
// ═══════════════════════════════════════════════════════════════════════════
// The expense posts against 1300 (custody), and on the same transaction its
// amount is recorded as recovered from the employee's oldest open custody
// records («عهدة / مصروف مؤقت»), so payroll deducts only what is left. What
// exceeds his open custody stays owed to him: nothing is deducted for it.
//
// A custody record keeps its existing meaning — outstanding = amount −
// recovered_amount, or nothing once recovered — so payroll, the custody page
// and the employee profile need no change. The document part is listed on
// the record (`document_recoveries`); a cash recovery posts only the rest.
// ═══════════════════════════════════════════════════════════════════════════

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const halala = n => Math.round((Number(n) || 0) * 100);

/** Who paid / whose custody: «من عهدة شخص» and «دفع موظف». */
export const CUSTODY_FUNDINGS = Object.freeze(['custody', 'employee']);
export const DOCUMENT_RECOVERY = 'expense_document';

/** The employee named on an expense record as holding the custody, if any. */
export function custodyBikerOf(row) {
  const id = row?.finance_metadata?.custodyBikerId;
  return typeof id === 'string' && /^[\p{L}\p{N}_.:-]{1,160}$/u.test(id) ? id : null;
}

/** An expense that settles against an employee's custody when posted. */
export function settlesEmployeeCustody(row) {
  return CUSTODY_FUNDINGS.includes(row?.finance_metadata?.fundingType) && row?.payment_method === 'custody' && Boolean(custodyBikerOf(row));
}

/** What is still open on one custody record (same rule as payroll). */
export function outstandingCustody(advance) {
  const amount = Math.max(0, Number(advance?.amount) || 0);
  if (advance?.status === 'recovered') return 0;
  return round2(amount - Math.min(amount, Math.max(0, Number(advance?.recovered_amount) || 0)));
}

/** The part of a record settled by expense documents. */
export function documentRecoveredOf(advance) {
  const list = Array.isArray(advance?.document_recoveries) ? advance.document_recoveries : [];
  return round2(list.reduce((n, r) => n + Math.max(0, Number(r?.amount) || 0), 0));
}

/** What a cash recovery of this record posts: the whole record less what documents settled. */
export function cashRecoveryAmount(advance) {
  return round2(Math.max(0, (Number(advance?.amount) || 0) - documentRecoveredOf(advance)));
}

/** A recovered record whose cash part is due as an entry (not payroll, not settled wholly by documents). */
export function cashRecoveryDue(advance) {
  return advance?.status === 'recovered' && Boolean(advance?.recovered_date) && !advance?.payroll_lock_id && cashRecoveryAmount(advance) > 0;
}

/** One employee's open custody: the total, and his records oldest first. */
export function employeeCustody(advances, bikerId) {
  const open = (advances || []).filter(a => String(a.biker_id || '') === bikerId && outstandingCustody(a) > 0)
    .sort((a, b) => String(a.spent_date || '').localeCompare(String(b.spent_date || '')) || String(a.id).localeCompare(String(b.id)));
  return { open, outstanding: round2(open.reduce((n, a) => n + outstandingCustody(a), 0)) };
}

/** Settle `amount` against the oldest open records first; the excess is owed to the employee. */
export function allocateCustody(amount, advances, bikerId) {
  let left = halala(amount);
  const allocations = [];
  for (const advance of employeeCustody(advances, bikerId).open) {
    if (left <= 0) break;
    const take = Math.min(left, halala(outstandingCustody(advance)));
    allocations.push({ advanceId: advance.id, amount: take / 100 });
    left -= take;
  }
  return { allocations, excess: left / 100 };
}

/** The record after a document settles part of it: fully settled → recovered on the entry's date. */
export function applyDocumentRecovery(advance, allocation, { date, kind, sourceId, entryId }) {
  const recovered = round2(Math.max(0, Number(advance.recovered_amount) || 0) + allocation.amount);
  const full = halala(recovered) >= halala(advance.amount);
  return {
    recovered_amount: recovered,
    document_recoveries: [...(Array.isArray(advance.document_recoveries) ? advance.document_recoveries : []),
      { kind, sourceId, entryId, amount: allocation.amount, date }],
    ...(full ? { status: 'recovered', recovered_date: date, recovery_method: DOCUMENT_RECOVERY } : {}),
  };
}

/**
 * The record after the entry that settled it is reversed. A record that was
 * since recovered another way (payroll or cash) is not unwound here.
 */
export function revertDocumentRecovery(advance, entryId) {
  const list = Array.isArray(advance.document_recoveries) ? advance.document_recoveries : [];
  const mine = list.filter(r => r?.entryId === entryId);
  if (!mine.length) return null;
  if (advance.status === 'recovered' && advance.recovery_method !== DOCUMENT_RECOVERY) return { blocked: true };
  const amount = round2(mine.reduce((n, r) => n + (Number(r.amount) || 0), 0));
  return {
    recovered_amount: round2(Math.max(0, (Number(advance.recovered_amount) || 0) - amount)),
    document_recoveries: list.filter(r => r?.entryId !== entryId),
    ...(advance.status === 'recovered' ? { status: 'pending', recovered_date: null, recovery_method: null } : {}),
  };
}
