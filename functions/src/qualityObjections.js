import { createHash } from 'node:crypto';
import { LedgerError } from './ledger.js';
import { hashBody } from './sweater/record.js';
import { COMPENSATION_KEYS } from './sweater/metricsContract.js';
import { OBJECTION_STATUSES } from './sweater/compensationEvents.js';
import { composeSweaterMetricReadings } from '../../src/lib/sweaterMetricReadings.js';
const fail = (message, code = 'invalid-argument') => { throw new LedgerError(message, { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
export const qualityObjectionId = (period, key, source) => createHash('sha256').update(JSON.stringify([period, key, source])).digest('hex');
async function memberIn(tx, db, uid) {
  const [member, marker] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(db.collection('app_admins').doc(uid))]);
  const role = member.data()?.role;
  if (role !== 'admin' && !(marker.exists && (!member.exists || ['operator', 'partner'].includes(role)))) fail('متابعة الاعتراض للمدير فقط.', 'permission-denied');
  return member.data()?.displayName || member.data()?.email || uid;
}

// These actions write internal follow-up only. They never submit an SSP
// objection, alter a source reading, wash, settlement or accounting document.
export async function saveQualityObjection(db, FieldValue, input, { userId, now = new Date() } = {}) {
  if (!exact(input, ['periodKey', 'metricKey', 'sourceId', 'snapshotId', 'expectedRevision', 'status', 'note'])
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodKey) || !COMPENSATION_KEYS.includes(input.metricKey)
    || !id(input.sourceId) || !id(input.snapshotId) || !revision(input.expectedRevision)
    || !OBJECTION_STATUSES.some(([key]) => key === input.status) || typeof input.note !== 'string' || input.note.length > 1000) fail('بيانات متابعة الاعتراض غير صحيحة.');
  const documentId = qualityObjectionId(input.periodKey, input.metricKey, input.sourceId);
  const ref = db.collection('quality_objections').doc(documentId);
  const audit = db.collection('audit_logs').doc(`quality-objection-${documentId}__${input.expectedRevision + 1}`);
  return db.runTransaction(async tx => {
    const name = await memberIn(tx, db, userId);
    const [old, auditSnapshot, readings] = await Promise.all([tx.get(ref), tx.get(audit),
      tx.get(db.collection('sweater_metric_snapshots').where('periodKey', '==', input.periodKey))]);
    const snapshot = composeSweaterMetricReadings(readings.docs.map(d => ({ ...d.data(), id: d.id })), input.periodKey);
    const row = snapshot?.eventGroups[input.metricKey]?.rows.find(r => r.sourceId === input.sourceId);
    if (!row || snapshot.metricSources[input.metricKey].snapshotId !== input.snapshotId) fail('تغيّرت قراءة سويتر؛ أعد تحميلها وراجع الصف قبل الحفظ.', 'aborted');
    const before = old.exists ? old.data() : {};
    if ((before.revision || 0) !== input.expectedRevision || auditSnapshot.exists) fail('تغيّرت متابعة الاعتراض؛ أعد تحميلها قبل الحفظ.', 'aborted');
    const sourceHash = hashBody(row), note = input.note.trim();
    if (before.status === input.status && before.note === note && before.sourceHash === sourceHash && before.snapshotId === input.snapshotId) return { unchanged: true, objection: { ...before, id: documentId } };
    const atIso = now.toISOString(), after = { periodKey: input.periodKey, metricKey: input.metricKey, sourceId: input.sourceId,
      snapshotId: input.snapshotId, sourceHash, status: input.status, note, revision: input.expectedRevision + 1,
      updatedBy: userId, updatedByName: name, updatedAtIso: atIso };
    // Detailed before/after belongs to the admin-only record. The shared
    // accountant-readable audit must never copy the objection note/status.
    const beforeState = Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'history'));
    const history = [...(Array.isArray(before.history) ? before.history : []), { before: beforeState, after, userId, atIso }];
    tx.set(ref, { ...after, history });
    tx.set(audit, { action: 'quality-objection-followup', collectionName: 'quality_objections', documentId,
      userId, atIso, createdAt: FieldValue.serverTimestamp(), before: { revision: before.revision || 0 }, after: { revision: after.revision } });
    return { objection: { ...after, history, id: documentId } };
  });
}

export async function saveQualityObjectionSettings(db, FieldValue, input, { userId, now = new Date() } = {}) {
  if (!exact(input, ['deadlineDays', 'expectedRevision']) || !revision(input.expectedRevision)
    || (input.deadlineDays !== null && (!Number.isInteger(input.deadlineDays) || input.deadlineDays < 1 || input.deadlineDays > 365))) fail('المهلة من يوم إلى 365 يومًا، أو اتركها غير محددة.');
  const ref = db.collection('app_settings').doc('quality-objections');
  const audit = db.collection('audit_logs').doc(`quality-objection-settings__${input.expectedRevision + 1}`);
  return db.runTransaction(async tx => {
    const name = await memberIn(tx, db, userId);
    const [old, history] = await Promise.all([tx.get(ref), tx.get(audit)]);
    const before = old.exists ? old.data() : {};
    if ((before.revision || 0) !== input.expectedRevision || history.exists) fail('تغيّرت المهلة؛ أعد تحميلها قبل الحفظ.', 'aborted');
    if ((before.deadlineDays ?? null) === input.deadlineDays) return { unchanged: true, settings: before };
    const atIso = now.toISOString(), after = { deadlineDays: input.deadlineDays, revision: input.expectedRevision + 1,
      updatedBy: userId, updatedByName: name, updatedAtIso: atIso };
    tx.set(ref, after);
    tx.set(audit, { action: 'quality-objection-settings', collectionName: 'app_settings', documentId: 'quality-objections',
      userId, atIso, createdAt: FieldValue.serverTimestamp(), before, after });
    return { settings: after };
  });
}
