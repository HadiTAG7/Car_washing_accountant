import { hashBody } from './sweater/record.js';
import { advanceAssignmentMonth, isAssignmentMonth, OWNER_ADVANCE_MONTH_PLAN as PLAN } from '../../src/lib/advanceMonth.js';
const fail = message => { const error = new Error(message); error.code = 'failed-precondition'; throw error; };
function request(data, saving = false) {
  const allowed = saving ? ['mode', 'id', 'assignmentMonth', 'reason', 'previewHash'] : ['mode', 'id', 'assignmentMonth', 'reason'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) fail('طلب إسناد الشهر غير صالح.');
  if (saving && !/^[a-f0-9]{64}$/.test(data.previewHash || '')) fail('معاينة إسناد الشهر مطلوبة.');
  if (data.mode === PLAN.mode) {
    if (['id', 'assignmentMonth', 'reason'].some(key => data[key] !== undefined)) fail('نطاق تصحيح المالك ثابت للسلف العشر فقط.');
    return { mode: PLAN.mode, reason: PLAN.reason, changes: PLAN.rows.map(([id]) => ({ id, assignmentMonth: PLAN.assignmentMonth })) };
  }
  if (data.mode !== 'single' || typeof data.id !== 'string' || !data.id || data.id.includes('/')
    || !isAssignmentMonth(data.assignmentMonth) || typeof data.reason !== 'string' || !data.reason.trim()) fail('اختر شهر الإسناد واكتب سبب التصحيح.');
  return { mode: 'single', reason: data.reason.trim(), changes: [{ id: data.id, assignmentMonth: data.assignmentMonth }] };
}
async function review(db, read, input) {
  const runsSnap = await read(db.collection('payroll_runs')); const protectedRuns = [];
  for (const doc of runsSnap.docs) {
    const run = doc.data(); if (!['approved', 'paid'].includes(run.status)) continue;
    const items = await read(db.collection('payroll_runs').doc(doc.id).collection('items'));
    protectedRuns.push({ id: doc.id, ...run, items: items.docs.map(item => item.data()) });
  }
  const rows = [];
  for (const change of input.changes) {
    const ref = db.collection('temporary_expenses').doc(change.id); const snap = await read(ref);
    if (!snap.exists) fail('سجل السلفة غير موجود؛ لم يتغير شيء.');
    const row = snap.data(); const beforeMonth = advanceAssignmentMonth(row);
    if (!beforeMonth) fail('شهر السلفة الحالي غير صالح؛ راجع تاريخ الصرف أو إسنادها.');
    if (input.mode === PLAN.mode) {
      const expected = PLAN.rows.find(([id]) => id === change.id);
      if (row.amount !== expected[1] || row.spent_date !== expected[2] || row.status !== expected[3]
        || (change.id === PLAN.rows[0][0] && row.recovered_date !== '2026-10-03')
        || !['2026-10', PLAN.assignmentMonth].includes(beforeMonth)) fail('السلف العشر لا تطابق المعاينة المأذونة؛ لم يتغير شيء.');
    }
    const already = row.assignment_month === change.assignmentMonth;
    if (!already && (row.payroll_lock_id || protectedRuns.some(run => run.items.some(item =>
      (item.advanceAllocations || []).some(allocation => allocation.advanceId === change.id)
      || (row.biker_id && item.bikerId === row.biker_id && [beforeMonth, change.assignmentMonth].includes(run.periodKey)))))) {
      fail('السلفة مرتبطة بمسير معتمد أو مصروف؛ يلزم مراجعته قبل تعديل الإسناد.');
    }
    rows.push({ id: change.id, title: row.title || '', amount: row.amount, status: row.status,
      spentDate: row.spent_date, recoveredDate: row.recovered_date || null, beforeMonth,
      assignmentMonth: change.assignmentMonth, already, _row: row, _ref: ref });
  }
  return { input, rows, previewHash: hashBody({ input, rows: rows.map(row => row._row), protectedRuns }) };
}
const resultOf = value => ({ previewHash: value.previewHash, count: value.rows.length,
  amount: value.rows.reduce((sum, row) => sum + row.amount, 0),
  pendingAmount: value.rows.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.amount, 0),
  canSave: value.rows.some(row => !row.already), saved: false,
  rows: value.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')))) });
export async function previewAdvanceMonth(db, data) {
  return resultOf(await review(db, ref => ref.get(), request(data)));
}
export async function saveAdvanceMonth(db, FieldValue, data, actor) {
  const input = request(data, true);
  return db.runTransaction(async tx => {
    const auditRef = db.collection('advance_month_corrections').doc(data.previewHash); const audit = await tx.get(auditRef);
    if (audit.exists) {
      if (hashBody(audit.data().input) !== hashBody(input)) fail('طلب التصحيح لا يطابق سجل التدقيق.');
      for (const change of input.changes) {
        const current = await tx.get(db.collection('temporary_expenses').doc(change.id));
        if (!current.exists || current.data().assignment_month !== change.assignmentMonth) fail('تغير الإسناد بعد التصحيح السابق؛ راجع السلفة الحالية.');
      }
      return { ...audit.data().result, replay: true };
    }
    const value = await review(db, ref => tx.get(ref), input);
    if (value.previewHash !== data.previewHash) fail('تغيّرت السلفة أو حالة المسير منذ المعاينة؛ أعد المعاينة.');
    const now = new Date().toISOString(); const updated = value.rows.filter(row => !row.already);
    for (const row of updated) tx.set(row._ref, { assignment_month: row.assignmentMonth,
      assignment_month_reason: input.reason, assignment_month_updated_by: actor,
      assignment_month_updated_at: now, assignment_month_correction_id: data.previewHash }, { merge: true });
    const result = { ...resultOf(value), saved: true, updated: updated.length, replay: false };
    if (updated.length) tx.set(auditRef, { input, result, actor, recordedAt: FieldValue.serverTimestamp(), recordedAtIso: now,
      before: updated.map(row => ({ id: row.id, row: row._row })), after: updated.map(row => ({ id: row.id, assignmentMonth: row.assignmentMonth })) });
    return result;
  });
}
