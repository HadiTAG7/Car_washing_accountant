import { StartupCostError } from './startupCosts.js';
import { postingLockId } from './invariants.js';

const fail = (message, code = 'failed-precondition') => { throw new StartupCostError(message, { code }); };
const allowed = new Set(['expense_name', 'category', 'quantity', 'annual_cost', 'payment_month', 'payment_day', 'payment_status', 'units']);
// Plan metadata only. Payments, actual_amount, tax and journals are never edited here.
export async function annualPlanAction(db, FieldValue, input, { userId, role } = {}) {
  if (!['admin', 'accountant', 'operator'].includes(role)) fail('تعديل خطة المصروف السنوي للإدارة المختصة فقط.', 'permission-denied');
  const id = String(input?.parentId || '').trim(), action = input?.action;
  if (!id || !['update', 'delete'].includes(action)) fail('طلب تعديل الخطة غير صالح.', 'invalid-argument');
  if (input.confirmed !== true) fail('يلزم تأكيد التغيير قبل الحفظ.', 'invalid-argument');
  const reason = String(input.reason || '').trim();
  if (action === 'update' && (reason.length < 3 || reason.length > 1000)) fail('اكتب سبب التعديل بوضوح.', 'invalid-argument');
  const patch = input.patch || {};
  if (action === 'update') {
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.has(key))) fail('هذه الحقول لا تعدّل من خطة المصروف.', 'invalid-argument');
    for (const key of ['annual_cost', 'quantity', 'payment_month', 'payment_day']) if (key in patch && (!Number.isFinite(patch[key]) || patch[key] < 0)) fail('قيمة الخطة غير صالحة.', 'invalid-argument');
    if ('quantity' in patch && (!Number.isInteger(patch.quantity) || patch.quantity < 1)) fail('الكمية غير صالحة.', 'invalid-argument');
    if ('payment_status' in patch && !['paid', 'pending'].includes(patch.payment_status)) fail('حالة السداد غير صالحة.', 'invalid-argument');
    if ('payment_month' in patch && (!Number.isInteger(patch.payment_month) || patch.payment_month < 1 || patch.payment_month > 12)) fail('الشهر غير صالح.', 'invalid-argument');
    if ('payment_day' in patch && (!Number.isInteger(patch.payment_day) || patch.payment_day < 1 || patch.payment_day > 31)) fail('اليوم غير صالح.', 'invalid-argument');
    if ('units' in patch && (!Array.isArray(patch.units) || patch.units.length > 200 || patch.units.some(unit => typeof unit !== 'string' || !unit.trim() || unit.length > 200))) fail('التقسيمات غير صالحة.', 'invalid-argument');
    for (const key of ['expense_name', 'category']) if (key in patch && (typeof patch[key] !== 'string' || !patch[key].trim() || patch[key].length > 500)) fail('اسم الخطة أو تصنيفها غير صالح.', 'invalid-argument');
  }
  return db.runTransaction(async tx => {
    const ref = db.collection('annual_expenses').doc(id);
    const [parent, payments, journals, lock, legacyLock] = await Promise.all([tx.get(ref),
      tx.get(db.collection('annual_expense_entries').where('annual_expense_id', '==', id)),
      tx.get(db.collection('journal_entries').where('sourceId', '==', id)),
      tx.get(db.collection('posting_locks').doc(postingLockId('annual', id))),
      tx.get(db.collection('posting_locks').doc(postingLockId('expense', id)))]);
    if (!parent.exists) fail('بند المصروف السنوي غير موجود.', 'not-found');
    const before = parent.data();
    if (input.expected && Object.entries(input.expected).some(([key, value]) => !allowed.has(key) || (before[key] ?? null) !== value)) fail('تغيرت الخطة منذ فتح التأكيد؛ حدّث الصفحة وراجعها.');
    const posted = lock.exists || legacyLock.exists || journals.docs.some(doc => ['posted', 'reversed'].includes(doc.data().status));
    if (action === 'delete' && (payments.size || posted || Number(before.actual_amount) > 0)) fail('الحذف ممنوع: البند له دفعات أو مبلغ فعلي أو قيد محاسبي.');
    if (action === 'delete') tx.delete(ref); else tx.update(ref, patch);
    tx.set(db.collection('audit_logs').doc(), { action: `annual-plan-${action}`, collectionName: 'annual_expenses', documentId: id,
      userId: userId || null, reason: reason || 'تأكيد حذف خطة بلا دفعات أو قيود', note: reason || 'حذف خطة غير مستخدمة',
      before, after: action === 'delete' ? null : { ...before, ...patch }, at: FieldValue.serverTimestamp(), atIso: new Date().toISOString() });
    return { id, deleted: action === 'delete', saved: true };
  });
}
