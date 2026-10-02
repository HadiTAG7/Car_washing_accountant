// Private administrative settings. This collection is deliberately NOT in
// Firestore's client allowlist; only guarded server handlers may access it.
// Ownership, capital, journal entries and the shared partner row never change.
import { LedgerError } from './ledger.js';

export const ELIGIBILITY_COL = 'partner_worker_eligibility';
const validMonth = key => typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
const fail = (message, code = 'failed-precondition') => { throw new LedgerError(message, { code }); };
const partnerKey = value => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.includes('/') || value.length > 200) fail('معرّف الشريك غير صحيح.', 'invalid-argument');
  return value;
};
export function currentEligibilityMonth(today = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit' }).formatToParts(today).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

export function eligibilityFor(partner, state, periodKey) {
  if (!validMonth(periodKey)) fail('شهر الأهلية غير صحيح.', 'invalid-argument');
  const originalWorkers = Number(partner.workers_count) || 0;
  if (!Number.isInteger(originalWorkers) || originalWorkers < 0) fail('عدد البايكرز الأصلي يحتاج مراجعة.');
  const effectiveFrom = Object.keys(state?.changes || {}).filter(key => validMonth(key) && key <= periodKey).sort().at(-1) || null;
  const eligibleWorkers = effectiveFrom ? state.changes[effectiveFrom].eligibleWorkers : originalWorkers;
  if (!Number.isInteger(eligibleWorkers) || eligibleWorkers < 0 || eligibleWorkers > originalWorkers) fail('عدد البايكرز المؤهلين يحتاج مراجعة من الأدمن.');
  return { originalWorkers, eligibleWorkers, suspendedWorkers: originalWorkers - eligibleWorkers, effectiveFrom };
}

export function operatingParticipation(partners, states, partnerId, periodKey) {
  const index = new Map(states.map(state => [state.id, state]));
  const selected = partners.find(p => p.id === partnerId);
  if (!selected) fail('لا شريك بهذا المعرّف.', 'not-found');
  const own = eligibilityFor(selected, index.get(partnerId), periodKey);
  const total = partners.reduce((sum, p) => sum + eligibilityFor(p, index.get(p.id), periodKey).eligibleWorkers, 0);
  if (!total && partners.some(p => Number(p.workers_count) > 0)) fail('لا يوجد بايكر مؤهل للتوزيع؛ يلزم مراجعة الأدمن.');
  // No aggregate eligible headcount, another partner's identity, reason or
  // audit metadata leaves this boundary. Only the caller's own participation.
  return { ...own, factor: total ? own.eligibleWorkers / total : 0 };
}

export async function readEligibilityStates(db) {
  const snap = await db.collection(ELIGIBILITY_COL).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

export async function getPartnerEligibility(db, { partnerId } = {}, { today = new Date() } = {}) {
  const id = partnerKey(partnerId);
  const [partner, state] = await Promise.all([db.collection('partners').doc(id).get(), db.collection(ELIGIBILITY_COL).doc(id).get()]);
  if (!partner.exists) fail('لا شريك بهذا المعرّف.', 'not-found');
  const stored = state.exists ? state.data() : {};
  const currentMonth = currentEligibilityMonth(today);
  return { partnerId: id, revision: stored.revision || 0, currentMonth,
    current: eligibilityFor(partner.data(), stored, currentMonth),
    changes: Object.entries(stored.changes || {}).sort(([a], [b]) => b.localeCompare(a)).map(([periodKey, row]) => ({ periodKey, eligibleWorkers: row.eligibleWorkers, reason: row.reason || '' })) };
}

export async function setPartnerEligibility(db, FieldValue, data = {}, { userId, today = new Date() } = {}) {
  const id = partnerKey(data.partnerId);
  const { periodKey, eligibleWorkers, expectedRevision } = data;
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (!validMonth(periodKey) || periodKey < currentEligibilityMonth(today)) fail('اختر الشهر الحالي أو شهراً لاحقاً؛ لا نعيد كتابة الأشهر السابقة.', 'invalid-argument');
  if (!Number.isInteger(eligibleWorkers) || eligibleWorkers < 0) fail('عدد البايكرز المؤهلين يجب أن يكون عدداً صحيحاً غير سالب.', 'invalid-argument');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail('نسخة الإعدادات غير صحيحة؛ أعد تحميلها.', 'invalid-argument');
  if (!reason || reason.length > 500) fail('اكتب سبب التغيير بحد أقصى ٥٠٠ حرف.', 'invalid-argument');
  const ref = db.collection(ELIGIBILITY_COL).doc(id);
  const auditRef = ref.collection('audit').doc();
  return db.runTransaction(async tx => {
    const [partner, state, partnerRows, stateRows, periodRows] = await Promise.all([
      tx.get(db.collection('partners').doc(id)), tx.get(ref),
      tx.get(db.collection('partners')), tx.get(db.collection(ELIGIBILITY_COL)), tx.get(db.collection('accounting_periods')),
    ]);
    if (!partner.exists) fail('لا شريك بهذا المعرّف.', 'not-found');
    const stored = state.exists ? state.data() : {};
    if ((stored.revision || 0) !== expectedRevision) fail('تغيّر الإعداد بواسطة أدمن آخر؛ أعد تحميله قبل الحفظ.');
    const before = eligibilityFor(partner.data(), stored, periodKey);
    if (eligibleWorkers > before.originalWorkers) fail('العدد المؤهل لا يتجاوز العدد الأصلي.', 'invalid-argument');
    const nextChange = Object.keys(stored.changes || {}).filter(key => key > periodKey).sort()[0];
    if (periodRows.docs.some(d => d.data().status === 'closed' && d.id >= periodKey && (!nextChange || d.id < nextChange))) fail('التغيير يؤثر في شهر مقفل؛ لا يمكن الحفظ.');
    const stamp = FieldValue.serverTimestamp();
    const changes = { ...stored.changes, [periodKey]: { eligibleWorkers, reason, updatedBy: userId, updatedAt: stamp } };
    const allPartners = partnerRows.docs.map(d => ({ ...d.data(), id: d.id }));
    const allStates = stateRows.docs.filter(d => d.id !== id).map(d => ({ ...d.data(), id: d.id })).concat({ id, changes });
    // Transaction query reads prevent two concurrent changes from leaving
    // the company without an eligible participant, even in a future month.
    const boundaries = new Set([periodKey, ...allStates.flatMap(s => Object.keys(s.changes || {}).filter(key => key >= periodKey))]);
    for (const month of boundaries) operatingParticipation(allPartners, allStates, id, month);
    tx.set(ref, { revision: expectedRevision + 1, changes, updatedAt: stamp, updatedBy: userId });
    tx.set(auditRef, { periodKey, before: before.eligibleWorkers, after: eligibleWorkers, reason, actorUid: userId, createdAt: stamp, revision: expectedRevision + 1 });
    return { partnerId: id, periodKey, eligibleWorkers, revision: expectedRevision + 1 };
  });
}
