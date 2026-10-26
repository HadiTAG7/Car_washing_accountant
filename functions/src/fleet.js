import { createHash } from 'node:crypto';
import { LedgerError } from './ledger.js';
import { FLEET_STATUSES, CLAIM_STATUSES, fleetDay, fleetIdentity, fleetPlate } from '../../src/lib/fleet.js';
const fail = (message, code = 'invalid-argument') => { throw new LedgerError(message, { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const text = (value, max = 250) => typeof value === 'string' && value.length <= max;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const optionalId = value => value === '' || id(value);
const day = value => value === '' || fleetDay(value);
const amount = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 && Number(value.toFixed(2)) === value;
const clean = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
const historyState = before => Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'history'));
export const fleetBikeId = internalNumber => 'bike-' + createHash('sha256').update(fleetIdentity(internalNumber)).digest('hex');
const kinds = { bike: ['fleet_bikes', ['internalNumber', 'plate', 'model', 'purchasedOn', 'startupItemId', 'status', 'statusSince', 'policyId']],
  policy: ['fleet_policies', ['number', 'company', 'startsOn', 'expiresOn', 'wholeFleet']],
  receive: ['fleet_assignments', ['bikeId', 'bikerId', 'receivedOn', 'note']],
  return: ['fleet_assignments', ['returnedOn', 'note']],
  maintenance: ['fleet_maintenance', ['bikeId', 'startedOn', 'endedOn', 'description', 'cost', 'expenseUrl']],
  incident: ['fleet_incidents', ['bikeId', 'bikerId', 'happenedOn', 'bookingId', 'description', 'cost', 'claimStatus', 'claimNote']] };
function validate(kind, d, today) {
  if (kind === 'bike' && (!text(d.internalNumber, 60) || !d.internalNumber.trim() || !text(d.plate, 60) || !text(d.model, 120)
    || !day(d.purchasedOn) || d.purchasedOn > today || !optionalId(d.startupItemId) || !optionalId(d.policyId)
    || !FLEET_STATUSES.some(([key]) => key === d.status) || !day(d.statusSince) || d.statusSince > today
    || d.status === 'maintenance' && !d.statusSince)) fail('راجع رقم الدباب وحالته وتواريخه وروابطه.');
  if (kind === 'policy' && (!text(d.number, 100) || !d.number.trim() || !text(d.company, 200) || !d.company.trim()
    || !day(d.startsOn) || !fleetDay(d.expiresOn) || d.startsOn && d.startsOn > d.expiresOn || typeof d.wholeFleet !== 'boolean')) fail('راجع رقم وثيقة التأمين وشركتها وتاريخ انتهائها.');
  if (kind === 'receive' && (!id(d.bikeId) || !id(d.bikerId) || !fleetDay(d.receivedOn) || d.receivedOn > today || !text(d.note, 1000))) fail('راجع الدباب والبايكر وتاريخ التسليم.');
  if (kind === 'return' && (!fleetDay(d.returnedOn) || d.returnedOn > today || !text(d.note, 1000))) fail('راجع تاريخ إرجاع الدباب.');
  if (kind === 'maintenance') {
    let safeUrl = d.expenseUrl === '';
    try { const u = new URL(d.expenseUrl); safeUrl = u.origin === 'https://app.hadialghanim.com' && !u.username && !u.password && ![...u.searchParams.keys()].some(k => /token|auth|secret|session/i.test(k)); } catch { /* empty or invalid */ }
    if (!id(d.bikeId) || !fleetDay(d.startedOn) || d.startedOn > today || !day(d.endedOn) || d.endedOn > today
      || d.endedOn && d.endedOn < d.startedOn || !text(d.description, 1000) || !d.description.trim() || !amount(d.cost) || !text(d.expenseUrl, 2000) || !safeUrl) fail('راجع تاريخ الصيانة ووصفها وتكلفتها ورابط المستند.');
  }
  if (kind === 'incident' && (!id(d.bikeId) || !optionalId(d.bikerId) || !fleetDay(d.happenedOn) || d.happenedOn > today
    || !text(d.bookingId, 160) || !text(d.description, 1000) || !d.description.trim() || !amount(d.cost)
    || !CLAIM_STATUSES.some(([key]) => key === d.claimStatus) || !text(d.claimNote, 1000))) fail('راجع تاريخ الحادث والبايكر والتكلفة وحالة المطالبة.');
}

/** Operational metadata only. Every mutation shares a registry revision to
 * serialize uniqueness and bike/biker handovers, including absent-row races.
 * Existing assets, journals, expenses, workers and washes are read-only here. */
export async function saveFleet(db, FieldValue, input, { userId, now = new Date() } = {}) {
  if (!exact(input, ['kind', 'id', 'expectedRevision', 'data']) || !Object.hasOwn(kinds, input.kind) || !id(input.id)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !exact(input.data, kinds[input.kind][1])) fail('طلب الأسطول غير صالح.');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(now), data = clean(input.data), kind = input.kind;
  validate(kind, data, today);
  if (kind === 'bike' && input.expectedRevision === 0 && input.id !== fleetBikeId(data.internalNumber)) fail('معرّف الدباب لا يطابق رقمه الداخلي.');
  const collection = kinds[kind][0], ref = db.collection(collection).doc(input.id), control = db.collection('fleet_control').doc('registry');
  return db.runTransaction(async tx => {
    const [member, marker, lock] = await Promise.all([tx.get(db.collection('users').doc(userId)), tx.get(db.collection('app_admins').doc(userId)), tx.get(control)]);
    const role = member.data()?.role;
    if (role !== 'admin' && !(marker.exists && (!member.exists || ['operator', 'partner'].includes(role)))) fail('تعديل الأسطول للمدير فقط.', 'permission-denied');
    const [old, bikesSnapshot, assignmentsSnapshot, policiesSnapshot, maintenanceSnapshot] = await Promise.all([tx.get(ref),
      tx.get(db.collection('fleet_bikes')), tx.get(db.collection('fleet_assignments')), tx.get(db.collection('fleet_policies')), tx.get(db.collection('fleet_maintenance'))]);
    const rows = snapshot => snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    const bikes = rows(bikesSnapshot), assignments = rows(assignmentsSnapshot), policies = rows(policiesSnapshot), maintenance = rows(maintenanceSnapshot);
    const before = old.exists ? old.data() : {};
    if (kind !== 'return' && old.exists && input.expectedRevision === 0 && Object.keys(data).every(key => before[key] === data[key])) return { id: input.id, record: before, unchanged: true };
    if ((before.revision || 0) !== input.expectedRevision || kind === 'receive' && old.exists || kind === 'return' && !old.exists) fail('تغيّر السجل؛ أعد تحميل الأسطول قبل الحفظ.', 'aborted');
    let after = { ...historyState(before), ...data }, bikeChange = null;
    if (kind === 'bike') {
      if (bikes.some(b => b.id !== input.id && (fleetIdentity(b.internalNumber) === fleetIdentity(data.internalNumber) || data.plate && fleetPlate(b.plate) === fleetPlate(data.plate)))) fail('الرقم الداخلي أو اللوحة مسجل لدباب آخر.', 'already-exists');
      if (old.exists && fleetIdentity(before.internalNumber) !== fleetIdentity(data.internalNumber)) fail('الرقم الداخلي ثابت؛ عدّل باقي بيانات الدباب.');
      if (data.policyId && !policies.some(p => p.id === data.policyId)) fail('وثيقة التأمين غير موجودة.');
      if (data.startupItemId && !(await tx.get(db.collection('startup_costs').doc(data.startupItemId))).exists) fail('بند التأسيس غير موجود.');
      if (!old.exists) after = { ...after, currentBikerId: '', activeAssignmentId: '' };
    }
    if (kind === 'policy' && policies.some(p => p.id !== input.id && fleetIdentity(p.number) === fleetIdentity(data.number) && fleetIdentity(p.company) === fleetIdentity(data.company))) fail('وثيقة التأمين مسجلة مسبقًا.', 'already-exists');
    if (['receive', 'maintenance', 'incident'].includes(kind)) {
      const bike = bikes.find(b => b.id === data.bikeId); if (!bike) fail('الدباب غير موجود.');
      if (old.exists && before.bikeId !== data.bikeId) fail('لا تنقل سجلًا تاريخيًا إلى دباب آخر.');
      if (kind === 'receive') {
        const biker = await tx.get(db.collection('bikers').doc(data.bikerId));
        if (!biker.exists || biker.data().end_date || /هرب|مشيناه/.test(biker.data().current_status || '')) fail('اختر بايكر موجودًا لم تنته خدمته.');
        if (bike.status !== 'working' || bike.currentBikerId || bike.activeAssignmentId || maintenance.some(m => m.bikeId === bike.id && !m.endedOn)) fail('الدباب غير متاح للتسليم.');
        if (assignments.some(a => (a.bikeId === bike.id || a.bikerId === data.bikerId) && (!a.returnedOn || a.returnedOn > data.receivedOn))) fail('يوجد تسليم متداخل للدباب أو البايكر؛ سجّل الإرجاع أولًا.');
        after = { ...after, returnedOn: '', bikerName: biker.data().name_ar || biker.data().name || biker.data().name_en || data.bikerId };
        bikeChange = { ...bike, currentBikerId: data.bikerId, activeAssignmentId: input.id };
      }
      if (kind === 'maintenance' && !data.endedOn && maintenance.some(m => m.id !== input.id && m.bikeId === bike.id && !m.endedOn)) fail('يوجد سجل صيانة مفتوح لهذا الدباب.');
      if (kind === 'incident') {
        if (data.bikerId) {
          const biker = await tx.get(db.collection('bikers').doc(data.bikerId)); if (!biker.exists) fail('بايكر الحادث غير موجود.');
          after.bikerName = biker.data().name_ar || biker.data().name || biker.data().name_en || data.bikerId;
        } else after.bikerName = '';
      }
    }
    if (kind === 'return') {
      const bike = bikes.find(b => b.id === before.bikeId);
      if (before.returnedOn || data.returnedOn < before.receivedOn || !bike || bike.activeAssignmentId !== input.id || bike.currentBikerId !== before.bikerId) fail('سجل التسليم غير مفتوح أو تاريخ الإرجاع غير صحيح.', 'failed-precondition');
      bikeChange = { ...bike, currentBikerId: '', activeAssignmentId: '' };
    }
    const atIso = now.toISOString(), name = member.data()?.displayName || member.data()?.email || userId;
    const stamp = row => ({ ...row, revision: (row.revision || 0) + 1, updatedBy: userId, updatedByName: name, updatedAtIso: atIso });
    const record = stamp(after);
    record.history = [...(Array.isArray(before.history) ? before.history : []), { before: historyState(before), after: { ...record }, userId, atIso }];
    tx.set(ref, record);
    if (bikeChange) { const { id: bikeId, ...bikeData } = bikeChange; tx.set(db.collection('fleet_bikes').doc(bikeId), stamp(bikeData)); }
    tx.set(control, { revision: (lock.data()?.revision || 0) + 1 });
    const auditId = createHash('sha256').update(`${collection}:${input.id}:${record.revision}`).digest('hex');
    tx.set(db.collection('audit_logs').doc(`fleet-${auditId}`), { action: `fleet-${kind}`, collectionName: collection, documentId: input.id,
      userId, atIso, createdAt: FieldValue.serverTimestamp(), before: historyState(before), after: historyState(record) });
    return { id: input.id, record };
  });
}
