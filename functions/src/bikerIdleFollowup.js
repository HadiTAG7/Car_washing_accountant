import { LedgerError } from './ledger.js';
import { IDLE_REASONS } from '../../src/lib/idleBikers.js';
const fail = (message, code = 'invalid-argument') => { throw new LedgerError(message, { code }); };
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Only follow-up metadata and its audit entry. No wage, status, wash or date of
 * employment is writable through this action. Revision protects concurrent edits. */
export async function saveBikerIdleFollowup(db, FieldValue, input = {}, { userId, now = new Date() } = {}) {
  const allowed = ['bikerId', 'expectedRevision', 'reasonKey', 'expectedStartDate', 'note'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('حقول متابعة الخمول غير صحيحة.');
  if (typeof input.bikerId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input.bikerId)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('معرّف البايكر أو نسخة المتابعة غير صحيحة.');
  if (typeof input.reasonKey !== 'string' || (input.reasonKey && !IDLE_REASONS.some(([key]) => key === input.reasonKey))) fail('اختر سببًا من قائمة الخمول.');
  if (typeof input.note !== 'string' || input.note.length > 1000 || typeof input.expectedStartDate !== 'string'
    || (input.expectedStartDate && !day(input.expectedStartDate))) fail('الملاحظة أو تاريخ البدء المتوقع غير صالح.');
  const note = input.note.trim();
  if (input.reasonKey === 'other' && !note) fail('اكتب توضيحًا عند اختيار سبب أخرى.');
  const ref = db.collection('bikers').doc(input.bikerId);
  const audit = db.collection('audit_logs').doc(`biker-idle-${input.bikerId}__${input.expectedRevision + 1}`);
  return db.runTransaction(async tx => {
    const [member, marker, biker, auditSnapshot] = await Promise.all([
      tx.get(db.collection('users').doc(userId)), tx.get(db.collection('app_admins').doc(userId)), tx.get(ref), tx.get(audit),
    ]);
    const role = member.data()?.role;
    if (!['admin', 'accountant'].includes(role) && !(marker.exists && (!member.exists || ['operator', 'partner'].includes(role)))) fail('متابعة الخمول للمدير والمحاسب فقط.', 'permission-denied');
    if (!biker.exists) fail('البايكر غير موجود؛ أعد تحميل القائمة.', 'not-found');
    const before = biker.data().idle_follow_up || {};
    if ((before.revision || 0) !== input.expectedRevision || auditSnapshot.exists) fail('تغيّرت متابعة البايكر؛ أعد تحميلها قبل الحفظ.', 'aborted');
    const after = { reasonKey: input.reasonKey, expectedStartDate: input.expectedStartDate, note };
    if (['reasonKey', 'expectedStartDate', 'note'].every(key => (before[key] || '') === after[key])) return { unchanged: true, bikerId: input.bikerId, followup: before };
    const atIso = now.toISOString();
    const followup = { ...after, revision: input.expectedRevision + 1, updatedBy: userId,
      updatedByName: member.data()?.displayName || member.data()?.email || userId, updatedAtIso: atIso };
    tx.update(ref, { idle_follow_up: followup });
    tx.set(audit, { action: 'biker-idle-followup', collectionName: 'bikers', documentId: input.bikerId,
      userId, atIso, createdAt: FieldValue.serverTimestamp(), before, after: followup, note: 'متابعة سبب الخمول وتاريخ البدء المتوقع فقط' });
    return { bikerId: input.bikerId, followup };
  });
}
