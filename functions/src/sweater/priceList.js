// ═══════════════════════════════════════════════════════════════════════════
// إدخال «أسعار الخدمات» — صفٌّ مؤرخ في `sweater_price_list`، لا تعديلٌ لصفٍّ قائم
// ═══════════════════════════════════════════════════════════════════════════
// السعر يُقرأ بتاريخ الخدمة (`resolveServicePrice`)، فسعرٌ جديد يبدأ من
// تاريخ سريانه ولا يحرّك شهراً مضى. والصفّ يُشتقّ صافيه وضريبته وإجماليه من
// المُدخل (`servicePriceRow`) فلا يُحفظ ثلاثيٌّ غير متسق. صفّان لنفس الخدمة بنفس
// التاريخ: الأحدث كتابةً هو الساري (تصحيحٌ لسابقه)، والمطابق تماماً مرفوض.
// ═══════════════════════════════════════════════════════════════════════════

import { LedgerError } from '../ledger.js';
import { isoDay } from './datedConfig.js';
import { PRICES_COL, servicePriceRow } from './priceRow.js';

export { PRICES_COL, servicePriceRow };
const fail = message => { throw new LedgerError(message, { code: 'invalid-argument' }); };

/** «أسعار الخدمات»: يحفظ صفًّا مؤرخًا باسم من أدخله ووقته، مع سجل تدقيق. */
export async function saveServicePrice(db, FieldValue, input, { userId }) {
  const { problems, row } = servicePriceRow(input);
  if (problems.length) fail(problems.join(' '));
  return db.runTransaction(async (tx) => {
    const same = await tx.get(db.collection(PRICES_COL).where('serviceType', '==', row.serviceType));
    if (same.docs.some(d => {
      const v = d.data();
      return (v.status ?? 'active') === 'active' && isoDay(v.effectiveFrom) === row.effectiveFrom && v.priceMode === row.priceMode
        && Number(v.grossRate) === row.grossRate && Number(v.vatRate) === row.vatRate;
    })) fail(`هذا السعر مسجّل أصلًا لـ«${row.serviceType}» من ${row.effectiveFrom}.`);
    const user = await tx.get(db.collection('users').doc(String(userId)));
    const ref = db.collection(PRICES_COL).doc(), at = new Date().toISOString();
    const saved = { ...row, createdAt: FieldValue.serverTimestamp(), createdAtIso: at, createdBy: userId,
      createdByName: (user.exists && (user.data().displayName || user.data().email)) || userId,
      note: input?.note ? String(input.note).trim().slice(0, 300) || null : null };
    tx.set(ref, saved);
    tx.set(db.collection('audit_logs').doc(), { action: 'sweater-price-saved', collectionName: PRICES_COL, documentId: ref.id, userId,
      after: { ...saved, createdAt: null }, at: FieldValue.serverTimestamp() });
    return { id: ref.id, ...saved, createdAt: null };
  });
}

/** The services the bookings carry, and how many — what needs a price. */
export async function listServiceTypes(db) {
  const snap = await db.collection('sweater_bookings').get(), byType = new Map();
  for (const doc of snap.docs) {
    const v = doc.data(), type = String(v.record?.serviceType ?? v.serviceType ?? '').trim(), day = isoDay(v.serviceDate ?? v.record?.serviceDate);
    const t = byType.get(type) || { serviceType: type, bookings: 0, firstDate: null, lastDate: null };
    t.bookings += 1;
    if (day && (!t.firstDate || day < t.firstDate)) t.firstDate = day;
    if (day && (!t.lastDate || day > t.lastDate)) t.lastDate = day;
    byType.set(type, t);
  }
  return [...byType.values()].sort((a, b) => b.bookings - a.bookings || a.serviceType.localeCompare(b.serviceType));
}
