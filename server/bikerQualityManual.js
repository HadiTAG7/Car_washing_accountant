import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { readCanonicalQualitySource } from './bikerQualityV3.js';
import { qualityIdentitySchema as identity, qualityDaySchema as day } from './bikerQualityV2.js';

export const MANUAL_STATUS_POLICY = 'manual-status-20261015-v1';
const collection = 'biker_quality_reports';
const scopeSchema = z.object({ bikerUID: identity, periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), from: day, to: day });
const base = scopeSchema.extend({ revision: z.number().int().min(0), requestId: identity });
const noteSchema = base.extend({ washId: identity, stages: z.array(z.enum(['arrival', 'start', 'end'])).max(3),
  note: z.string().trim().max(1000).default(''), correctionReason: z.string().trim().max(500).optional() }).strict();
const confirmSchema = base.extend({ cohortHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledged: z.literal(true), noCases: z.boolean() }).strict();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, code = 'invalid-argument') => { throw new AuthError(message, { code }); };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
export const manualReviewId = (uid, month) => `${uid}__${month}__${MANUAL_STATUS_POLICY}`;
export function validateManualScope(scope) {
  if (!scopeSchema.safeParse(scope).success || scope.from > scope.to || scope.from.slice(0, 7) !== scope.periodKey
    || scope.to.slice(0, 7) !== scope.periodKey || scope.to > today()) fail('فترة المراجعة اليدوية غير صالحة.');
  return scope;
}
export function manualReviewProjection(source, record, scope) {
  validateManualScope(scope);
  const eligible = source?.available ? source.eligible.filter(r => r.serviceDate >= scope.from && r.serviceDate <= scope.to) : [];
  const cohortHash = source?.available ? hash(eligible) : null;
  const notes = (record?.notes || []).filter(n => n.serviceDate >= scope.from && n.serviceDate <= scope.to);
  const active = notes.filter(n => n.stages.length && eligible.some(w => w.washId === n.washId && w.sspBookingId === n.appointmentId));
  const unresolvedNotes = notes.filter(n => n.stages.length && !active.includes(n)).length;
  const affected = new Set(active.map(n => n.appointmentId)).size;
  const confirmation = record?.confirmation || null;
  const matched = Boolean(source?.available && !unresolvedNotes && confirmation && confirmation.from === scope.from && confirmation.to === scope.to
    && confirmation.cohortHash === cohortHash && confirmation.revision === (record?.revision || 0));
  const unreviewed = source?.available ? (source.eligible || []).filter(w => !confirmation?.washIds?.includes(w.washId)).length : null;
  const points = matched && eligible.length ? Math.round(Math.max(0, 10 - 100 * affected / eligible.length) * 100) / 100 : null;
  return { policy: MANUAL_STATUS_POLICY, ...scope, revision: record?.revision || 0, sourceAvailable: Boolean(source?.available),
    eligible, cohortHash, notes, confirmation, confirmed: matched, pendingWashes: unreviewed, unresolvedNotes,
    history: (record?.history || []).filter(e => e.from === scope.from && e.to === scope.to),
    component: { key: 'statusUpdates', weight: 10, points, n: matched ? eligible.length : null, affected: matched ? affected : null,
      reason: matched ? 'manual-status-reviewed' : 'awaiting-manual-status-review', unit: 'manually-reviewed-washes',
      coverageComplete: matched && eligible.length > 0 } };
}
async function adminOnly(db, auth) {
  if (await callerRole(db, auth) !== 'admin') fail('مراجعة الجودة مقصورة على الأدمن.', 'permission-denied');
}
export async function readManualReview(db, auth, source, scope) {
  await adminOnly(db, auth);
  const doc = await db.collection(collection).doc(manualReviewId(scope.bikerUID, scope.periodKey)).get();
  return manualReviewProjection(source, doc.exists ? doc.data() : null, scope);
}
export async function saveManualReview(db, auth, input, operation) {
  await adminOnly(db, auth); // Before identities, existence or source access.
  if (!['manual-note', 'manual-correct', 'manual-confirm'].includes(operation)) fail('عملية مراجعة غير صالحة.');
  const parsed = (operation === 'manual-confirm' ? confirmSchema : noteSchema).safeParse(input);
  if (!parsed.success) fail('مدخلات المراجعة اليدوية غير صالحة.');
  const data = parsed.data;
  validateManualScope(data);
  if (operation !== 'manual-confirm' && new Set(data.stages).size !== data.stages.length) fail('مرحلة التحديث مكررة.');
  const contentHash = hash({ operation, ...data });
  return db.runTransaction(async tx => {
    const roleDb = { collection: name => ({ doc: id => ({ get: () => tx.get(db.collection(name).doc(id)) }) }) };
    await adminOnly(roleDb, auth);
    const worker = await tx.get(db.collection('bikers').doc(data.bikerUID));
    if (!worker.exists) fail('العامل غير موجود.', 'failed-precondition');
    const ref = db.collection(collection).doc(manualReviewId(data.bikerUID, data.periodKey));
    const snapshot = await tx.get(ref);
    const record = snapshot.exists ? snapshot.data() : { kind: 'manual-status-review', bikerUID: data.bikerUID,
      periodKey: data.periodKey, policy: MANUAL_STATUS_POLICY, revision: 0, notes: [], history: [], confirmation: null };
    const retry = record.history.find(e => e.requestId === data.requestId);
    if (retry) {
      if (retry.contentHash !== contentHash) fail('معرّف الطلب مستخدم بمحتوى آخر.', 'already-exists');
      return { unchanged: true, revision: record.revision };
    }
    if (record.revision !== data.revision) fail('تغيّرت المراجعة؛ أعد تحميل البيانات قبل الحفظ.', 'already-exists');
    if (record.history.length >= 250) fail('بلغ سجل التدقيق حدّه؛ يلزم أرشفته بمراجعة منفصلة.', 'failed-precondition');
    const source = await readCanonicalQualitySource(db, data.bikerUID, data.periodKey, { transaction: tx, worker: worker.data() });
    if (!source.available) fail('تعذّر تأكيد الغسلات المؤهلة؛ لم يُحفظ شيء.', 'failed-precondition');
    const scope = { bikerUID: data.bikerUID, periodKey: data.periodKey, from: data.from, to: data.to };
    const projection = manualReviewProjection(source, record, scope);
    const timestamp = new Date().toISOString();
    const revision = record.revision + 1;
    const event = { operation, requestId: data.requestId, contentHash, from: data.from, to: data.to, at: timestamp, by: auth.uid, revision };
    if (operation === 'manual-confirm') {
      if (!projection.eligible.length || data.cohortHash !== projection.cohortHash) fail('تغيّر نطاق الغسلات؛ راجعه من جديد.', 'failed-precondition');
      if (projection.unresolvedNotes) fail('تغيّر نطاق الغسلات؛ راجعه من جديد.', 'failed-precondition');
      const hasCases = projection.notes.some(n => n.stages.length);
      if (data.noCases === hasCases) fail('تأكيد عدم وجود حالات لا يطابق الملاحظات المسجلة.');
      record.confirmation = { ...scope, cohortHash: projection.cohortHash, washIds: projection.eligible.map(w => w.washId),
        revision, noCases: data.noCases, at: timestamp, by: auth.uid };
      event.confirmation = record.confirmation;
    } else {
      const wash = projection.eligible.find(w => w.washId === data.washId);
      if (!wash || !wash.sspBookingId) fail('اختر غسلة فعلية مرتبطة بالعامل والفترة ولها معرّف موعد.', 'failed-precondition');
      const index = record.notes.findIndex(n => n.washId === data.washId);
      if (operation === 'manual-note' && (index >= 0 || record.notes.some(n => n.appointmentId === wash.sspBookingId))) fail('الموعد مسجل مسبقًا؛ استخدم التصحيح المدقق.', 'already-exists');
      if (operation === 'manual-correct' && (index < 0 || !data.correctionReason)) fail('يلزم وجود الملاحظة وسبب التصحيح.');
      if (operation === 'manual-note' && !data.stages.length) fail('حدد مرحلة واحدة على الأقل.');
      const note = { washId: wash.washId, appointmentId: wash.sspBookingId, serviceDate: wash.serviceDate,
        stages: [...data.stages].sort(), note: data.note, at: timestamp, by: auth.uid, source: 'admin-manual' };
      event.before = index >= 0 ? record.notes[index] : null;
      event.after = note;
      event.correctionReason = data.correctionReason || null;
      if (index >= 0) record.notes[index] = note; else record.notes.push(note);
      // Prior confirmation remains as history but is stale until explicitly reviewed again.
    }
    record.revision = revision;
    record.history.push(event);
    if (Buffer.byteLength(JSON.stringify(record), 'utf8') > 800000) fail('بلغ سجل التدقيق حدّه؛ يلزم أرشفته بمراجعة منفصلة.', 'failed-precondition');
    tx.set(ref, record);
    return { unchanged: false, revision };
  });
}
