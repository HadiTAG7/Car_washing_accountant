import { advanceAssignmentMonth } from '../../src/lib/advanceMonth.js';
const fail = message => { const error = new Error(message); error.code = 'failed-precondition'; throw error; };
const round = n => Math.round(n * 100) / 100;
export async function payrollRecoveryReconciliation(tx, db, run, allItems, request) {
  const [advanceSnap, journalSnap] = await Promise.all([tx.get(db.collection('temporary_expenses')), tx.get(db.collection('journal_entries'))]);
  const advances = advanceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row => row.status === 'recovered' && advanceAssignmentMonth(row) === run.periodKey);
  const recoveryLocks = await Promise.all(advances.map(row => tx.get(db.collection('posting_locks').doc(`recovery__${row.id}`))));
  const candidates = advances.map((row, index) => {
    const snapshot = { advanceId: row.id, title: row.title || '', amount: Number(row.amount) || 0, bikerId: row.biker_id || null,
      spentDate: row.spent_date || null, assignmentMonth: advanceAssignmentMonth(row), status: row.status,
      recoveredAmount: Number(row.recovered_amount) || 0, recoveredDate: row.recovered_date || null, recoveryMethod: row.recovery_method || null,
      payrollLockId: row.payroll_lock_id || null };
    const postedRecovery = recoveryLocks[index].exists || journalSnap.docs.some(doc => { const entry = doc.data(); return entry.status === 'posted'
      && entry.sourceType === 'recovery' && entry.sourceId === row.id; });
    const blocked = snapshot.payrollLockId || snapshot.recoveredAmount !== 0 || postedRecovery || !Number.isFinite(snapshot.amount) || snapshot.amount <= 0
      || (snapshot.bikerId && !request.bikerIds.includes(snapshot.bikerId));
    return { ...snapshot, eligible: !blocked, postedRecovery, needsWorkerConfirmation: !snapshot.bikerId };
  });
  const allocations = (request.reconciledAdvances || []).map(mapping => {
    const candidate = candidates.find(row => row.advanceId === mapping.advanceId);
    if (!candidate?.eligible) fail('السلفة المستردة غير مؤهلة للمطابقة؛ تحقق من الربط والترحيل والسداد السابق.');
    if (candidate.bikerId && candidate.bikerId !== mapping.bikerId) fail('السلفة مربوطة بعامل مختلف عن العامل المحدد.');
    return { bikerId: mapping.bikerId, advanceId: candidate.advanceId, amount: candidate.amount,
      originalAmount: candidate.amount, expectedOutstanding: 0, assignmentMonth: candidate.assignmentMonth,
      recoveryReconciliation: true, sourceSnapshot: candidate };
  });
  const items = allItems.map(item => {
    const selected = allocations.filter(row => row.bikerId === item.bikerId);
    if (!selected.length) return item;
    if (!['draft', 'approved'].includes(item.status)) fail('لا تُعدّل لقطة عامل مصروف أو مقفل أثناء المطابقة.');
    const extra = round(selected.reduce((sum, row) => sum + row.amount, 0));
    if (extra > Number(item.netDue)) fail('مطابقة السلف تتجاوز صافي العامل المحفوظ.');
    const existing = item.advanceAllocations || [];
    if (selected.some(row => existing.some(old => old.advanceId === row.advanceId))) fail('السلفة مخصصة في السطر بالفعل.');
    return { ...item, advanceDeduction: round(Number(item.advanceDeduction || 0) + extra), netDue: round(Number(item.netDue) - extra),
      advanceAllocations: [...existing, ...selected], originalSavedAdvanceDeduction: Number(item.advanceDeduction || 0),
      originalSavedNetDue: Number(item.netDue), recoveryReconciled: true };
  });
  return { items, allocations, candidates };
}
