// ═══════════════════════════════════════════════════════════════════════════
// معالجات سويتر للمستخدم — كلها خلف باب الدفاتر، لا باب الوكيل
// ═══════════════════════════════════════════════════════════════════════════
// الوكيل ينقل بيانات ولا شيء غير ذلك. أما الاحتساب والاعتماد والترحيل
// والاعتراض والإقفال والتحصيل فقراراتٌ بشرية تمرّ بهوية Firebase وأدوارها،
// وتُسجَّل في التدقيق باسم من اتخذها.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from '../invariants.js';
import { COL as LEDGER_COL, postSource } from '../ledger.js';
import {
  computeSettlement, transitionProblem, closeProblems, varianceOf,
  SweaterSettlementError, SETTLEMENTS_COL, ADJUSTMENTS_COL, VARIANCES_COL,
} from './settlement.js';
import { resolveDatedRow } from './datedConfig.js';
import { COL as INGEST_COL } from './ingest.js';
import { LINKS_COL } from './revenueOrigin.js';
import { adjustmentTypeProblems } from './adjustmentTypes.js';

const PRICES = 'sweater_price_list';
const POLICIES = 'sweater_recognition_policy';
const TYPES = 'sweater_adjustment_types';
const COLLECTIONS = 'sweater_collections';

const rowsOf = async (db, col) =>
  (await db.collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

const monthEnd = (periodKey) => {
  const [y, m] = String(periodKey).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function auditRow(fields, FieldValue) {
  return { ...fields, at: FieldValue.serverTimestamp(), atIso: new Date().toISOString() };
}

/**
 * احتساب الشهر — يُنشئ المسودة أو يُحدّثها، ولا يُنشئ قيداً أبداً.
 *
 * يُعاد استدعاؤه بحرية: الاحتساب اشتقاقٌ من مصادر لم تتغيّر، فالنتيجة نفسها.
 * ويُرفض بعد الاعتماد — وإلا تغيّر رقمٌ اعتُمد بلا أن يعيد أحدٌ اعتماده.
 */
export async function sweaterCalculateSettlement(db, FieldValue, { periodKey, dryRun = false }, { userId = null } = {}) {
  const pk = String(periodKey ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(pk)) {
    throw new SweaterSettlementError('مفتاح الفترة مطلوب بصيغة YYYY-MM.');
  }

  const ref = db.collection(SETTLEMENTS_COL).doc(pk);
  const existing = (await ref.get()).data() ?? null;
  if (existing && ['approved', 'invoiced', 'partially_collected', 'collected', 'closed'].includes(existing.status)) {
    throw new SweaterSettlementError(
      `تسوية ${pk} حالتها «${existing.status}» — لا يُعاد احتسابها. `
      + 'أعِدها إلى المراجعة أولاً إن تغيّر شيء.',
      { code: 'failed-precondition' },
    );
  }

  const [bookingDocs, priceRows, policyRows, adjustments, linkDocs] = await Promise.all([
    db.collection(INGEST_COL.BOOKINGS).where('periodKey', '==', pk).get(),
    rowsOf(db, PRICES), rowsOf(db, POLICIES),
    db.collection(ADJUSTMENTS_COL).where('periodKey', '==', pk).get()
      .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    db.collection(LINKS_COL).where('side', '==', 'booking').get(),
  ]);

  const figures = computeSettlement({
    bookings: bookingDocs.docs.map((d) => d.data()),
    priceRows, policyRows, adjustments,
    linkedBookingIds: new Set(linkDocs.docs.map((d) => d.data().sspBookingId)),
  });

  if (dryRun) return { periodKey: pk, dryRun: true, figures };

  const payload = {
    periodKey: pk,
    status: 'calculated',
    figures,
    periodEndDate: monthEnd(pk),
    recognitionDate: existing?.recognitionDate ?? monthEnd(pk),
    calculatedAt: FieldValue.serverTimestamp(),
    calculatedAtIso: new Date().toISOString(),
    calculatedBy: userId,
    ...(existing ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: userId }),
  };
  await ref.set(payload, { merge: true });
  return { periodKey: pk, dryRun: false, figures, status: 'calculated' };
}

/** تسجيل كشف سويتر ومقارنته بالمتوقع — كل فرقٍ يصير سجلاً. */
export async function sweaterRecordStatement(db, FieldValue, {
  periodKey, statedNetDue, documentUrl = null, note = null,
}, { userId = null } = {}) {
  const pk = String(periodKey ?? '').trim();
  const ref = db.collection(SETTLEMENTS_COL).doc(pk);
  const snap = await ref.get();
  if (!snap.exists) throw new SweaterSettlementError('لا تسوية بهذا الشهر — احتسبها أولاً.', { code: 'not-found' });
  const s = snap.data();

  const problem = transitionProblem(s.status, 'statement_received');
  if (problem) throw new SweaterSettlementError(problem, { code: 'failed-precondition' });

  const v = varianceOf(s.figures?.netDue, statedNetDue);
  const batch = db.batch();
  batch.set(ref, {
    status: 'statement_received',
    statement: {
      statedNetDue: v.stated, documentUrl, note,
      receivedAt: FieldValue.serverTimestamp(), receivedAtIso: new Date().toISOString(), receivedBy: userId,
    },
    statementVariance: v,
  }, { merge: true });

  if (!v.matches) {
    // الفرق سجلٌّ مستقل لا حقلٌ في التسوية: له سببٌ ومستندٌ وحالة اعتراض،
    // ويُقفل الشهر أو لا يُقفل بحسبه.
    batch.set(db.collection(VARIANCES_COL).doc(`statement__${pk}`), {
      kind: 'statement_vs_expected',
      periodKey: pk,
      expected: v.expected, stated: v.stated, difference: v.difference,
      reasonCode: null, reasonAr: null, documentUrl,
      resolution: 'unresolved', disputeStatus: 'none',
      reviewerNote: null, reviewedBy: null,
      detectedAt: FieldValue.serverTimestamp(), detectedAtIso: new Date().toISOString(),
    }, { merge: true });
  }
  await batch.commit();
  return { periodKey: pk, variance: v };
}

/**
 * اعتماد الشهر ثم ترحيله — قرارٌ واحد شهرياً.
 *
 * الترحيل يمرّ بـ`postSource` لا بكتابةٍ مباشرة: فيرث فحص الفترة المقفلة،
 * وترقيم القيد عبر `journalCounterUpdate`، وقفل عدم التكرار، وسجل التدقيق —
 * كلها مبنيةٌ ومختبرة، ونسخُها هنا يعني نسختين تنجرفان.
 */
export async function sweaterApproveSettlement(db, FieldValue, { periodKey, note = null }, { userId = null } = {}) {
  const pk = String(periodKey ?? '').trim();
  const ref = db.collection(SETTLEMENTS_COL).doc(pk);
  const snap = await ref.get();
  if (!snap.exists) throw new SweaterSettlementError('لا تسوية بهذا الشهر.', { code: 'not-found' });
  const s = snap.data();

  const problem = transitionProblem(s.status, 'approved');
  if (problem) throw new SweaterSettlementError(problem, { code: 'failed-precondition' });
  if (!(Number(s.figures?.services?.gross) > 0)) {
    throw new SweaterSettlementError('لا خدمات مؤهّلة — لا شيء يُعتمد.');
  }

  await ref.set({
    status: 'approved',
    approvedAt: FieldValue.serverTimestamp(),
    approvedAtIso: new Date().toISOString(),
    approvedBy: userId,
    approvalNote: note,
  }, { merge: true });

  const posted = await postSource(db, FieldValue, { kind: 'sweater_settlement', sourceId: pk }, { userId });

  await ref.set({ journalEntryId: posted.entryId, journalEntryNumber: posted.entryNumber }, { merge: true });
  await db.collection(LEDGER_COL.AUDIT).doc().set(auditRow({
    action: 'sweater.approveSettlement',
    collectionName: SETTLEMENTS_COL,
    documentId: pk,
    userId,
    note: `اعتماد وترحيل تسوية ${pk} — قيد رقم ${posted.entryNumber}`,
    before: { status: s.status },
    after: { status: 'approved', entryNumber: posted.entryNumber },
  }, FieldValue));

  return { periodKey: pk, status: 'approved', ...posted };
}

/** اعتماد تسويةٍ واحدة (خصم/حافز/تعويض) ثم ترحيلها بقفلها المستقل. */
export async function sweaterApproveAdjustment(db, FieldValue, { adjustmentId, note = null }, { userId = null } = {}) {
  const id = String(adjustmentId ?? '').trim();
  const ref = db.collection(ADJUSTMENTS_COL).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new SweaterSettlementError('لا تسوية بهذا المعرّف.', { code: 'not-found' });
  const a = snap.data();

  if (a.approvalStatus === 'approved') {
    throw new SweaterSettlementError('معتمدة بالفعل.', { code: 'already-exists' });
  }

  const typeRows = await rowsOf(db, TYPES);
  const hit = resolveDatedRow(typeRows, a.typeKey, a.effectiveDate);
  if (!hit.known) {
    throw new SweaterSettlementError(
      `لا إعداد ساري لنوع «${a.typeKey}» بتاريخ ${a.effectiveDate} — لا يُرحَّل بقاعدةٍ لم تكن سارية.`,
      { code: 'failed-precondition' },
    );
  }
  const type = hit.row;
  if (type.requiresDocument && !String(a.documentUrl ?? '').trim()) {
    throw new SweaterSettlementError(
      `«${type.nameArabic}» يتطلّب مستنداً — رقمٌ يُعترض عليه بلا مستند لا يُدافَع عنه.`,
      { code: 'failed-precondition' },
    );
  }

  await ref.set({
    approvalStatus: 'approved',
    accountCode: type.accountCode,
    nameArabic: type.nameArabic,
    typeSnapshot: { ...type, resolvedFrom: hit.effectiveFrom },
    approvedAt: FieldValue.serverTimestamp(),
    approvedAtIso: new Date().toISOString(),
    approvedBy: userId,
    approvalNote: note,
  }, { merge: true });

  const posted = await postSource(db, FieldValue, { kind: 'sweater_adjustment', sourceId: id }, { userId });
  await ref.set({ journalEntryId: posted.entryId, journalEntryNumber: posted.entryNumber }, { merge: true });
  return { adjustmentId: id, ...posted };
}

/** تسجيل تحصيلٍ بنكي وترحيله. */
export async function sweaterRecordCollection(db, FieldValue, {
  periodKey, amount, receivedDate, bankAccountId = null, reference = null,
}, { userId = null } = {}) {
  const amt = round2(Number(amount) || 0);
  if (amt <= 0) throw new SweaterSettlementError('مبلغ التحصيل يجب أن يكون موجباً.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receivedDate ?? ''))) {
    throw new SweaterSettlementError('تاريخ الاستلام مطلوب بصيغة YYYY-MM-DD.');
  }

  const id = `${periodKey}__${receivedDate}__${String(amt).replace('.', '_')}`;
  await db.collection(COLLECTIONS).doc(id).set({
    id, periodKey: String(periodKey ?? ''), amount: amt, receivedDate,
    bankAccountId: bankAccountId || null, reference,
    createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(), createdBy: userId,
  }, { merge: true });

  const posted = await postSource(db, FieldValue, { kind: 'sweater_collection', sourceId: id }, { userId });

  // حالة التسوية تتبع المحصَّل مقابل المستحق — جزئيٌّ أو كامل.
  const sRef = db.collection(SETTLEMENTS_COL).doc(String(periodKey ?? ''));
  const sSnap = await sRef.get();
  if (sSnap.exists) {
    const s = sSnap.data();
    const collected = round2((Number(s.collectedTotal) || 0) + amt);
    const due = round2(Number(s.figures?.netDue) || 0);
    const next = collected + 0.01 >= due ? 'collected' : 'partially_collected';
    if (!transitionProblem(s.status, next)) {
      await sRef.set({ collectedTotal: collected, status: next }, { merge: true });
    } else {
      await sRef.set({ collectedTotal: collected }, { merge: true });
    }
  }
  return { collectionId: id, ...posted };
}

/** إقفال التسوية — يمنعه فرقٌ غير محلول إلا للمدير بسببٍ مكتوب. */
export async function sweaterCloseSettlement(db, FieldValue, { periodKey, reason = null }, { userId = null, role = 'accountant' } = {}) {
  const pk = String(periodKey ?? '').trim();
  const ref = db.collection(SETTLEMENTS_COL).doc(pk);
  const snap = await ref.get();
  if (!snap.exists) throw new SweaterSettlementError('لا تسوية بهذا الشهر.', { code: 'not-found' });
  const s = snap.data();

  const variances = (await db.collection(VARIANCES_COL).where('periodKey', '==', pk).get())
    .docs.map((d) => d.data());
  const problems = closeProblems(s, variances, { role, reason });
  if (problems.length) throw new SweaterSettlementError(problems[0], { code: 'failed-precondition' });

  const unresolved = variances.filter((v) => v.resolution === 'unresolved').length;
  await ref.set({
    status: 'closed',
    closedAt: FieldValue.serverTimestamp(),
    closedAtIso: new Date().toISOString(),
    closedBy: userId,
    closedWithUnresolvedVariances: unresolved,
    closeReason: reason ?? null,
  }, { merge: true });

  await db.collection(LEDGER_COL.AUDIT).doc().set(auditRow({
    action: 'sweater.closeSettlement',
    collectionName: SETTLEMENTS_COL,
    documentId: pk,
    userId,
    note: unresolved
      ? `إقفال ${pk} بقرار المدير مع ${unresolved} فرقٍ غير محلول — ${reason}`
      : `إقفال ${pk} بلا فروق معلّقة`,
    before: { status: s.status },
    after: { status: 'closed' },
  }, FieldValue));

  return { periodKey: pk, status: 'closed', closedWithUnresolvedVariances: unresolved };
}

/** حسم فرق — بسببٍ ومراجع، وإلا بقي مانعاً للإقفال. */
export async function sweaterResolveVariance(db, FieldValue, {
  varianceId, resolution, reasonCode = null, reasonAr = null, documentUrl = null, reviewerNote = null,
}, { userId = null } = {}) {
  if (!['resolved', 'accepted', 'written_off', 'unresolved'].includes(resolution)) {
    throw new SweaterSettlementError(`حالة حسم غير معروفة: ${resolution}`);
  }
  if (resolution !== 'unresolved' && !String(reasonAr ?? reviewerNote ?? '').trim()) {
    throw new SweaterSettlementError('حسمُ فرقٍ بلا سبب مكتوب لا يُدافَع عنه بعد سنة.');
  }
  const ref = db.collection(VARIANCES_COL).doc(String(varianceId));
  const snap = await ref.get();
  if (!snap.exists) throw new SweaterSettlementError('لا فرق بهذا المعرّف.', { code: 'not-found' });

  await ref.set({
    resolution, reasonCode, reasonAr, documentUrl, reviewerNote,
    reviewedBy: userId,
    reviewedAt: FieldValue.serverTimestamp(), reviewedAtIso: new Date().toISOString(),
  }, { merge: true });
  return { varianceId: String(varianceId), resolution };
}

/** تسجيل تسويةٍ يدوية (خصم/حافز/تعويض) — تولد بانتظار المراجعة دائماً. */
export async function sweaterCreateAdjustment(db, FieldValue, { adjustment }, { userId = null } = {}) {
  const a = adjustment ?? {};
  const typeRows = await rowsOf(db, TYPES);
  const hit = resolveDatedRow(typeRows, a.typeKey, a.effectiveDate);
  if (!hit.known) {
    throw new SweaterSettlementError(`لا إعداد ساري لنوع «${a.typeKey}» بتاريخ ${a.effectiveDate}.`);
  }
  const problems = adjustmentTypeProblems({ ...hit.row, effectiveFrom: hit.effectiveFrom });
  if (problems.length) throw new SweaterSettlementError(`إعداد النوع غير صالح: ${problems[0]}`);

  const amount = round2(Math.abs(Number(a.amount) || 0));
  if (amount <= 0) throw new SweaterSettlementError('المبلغ مطلوب وموجب — والاتجاه من النوع لا من الإشارة.');

  const ref = db.collection(ADJUSTMENTS_COL).doc();
  await ref.set({
    id: ref.id,
    typeKey: a.typeKey,
    kind: hit.row.kind,
    nameArabic: hit.row.nameArabic,
    accountCode: hit.row.accountCode,
    bearer: hit.row.bearer ?? 'partner',
    amount,
    effectiveDate: a.effectiveDate,
    periodKey: String(a.effectiveDate ?? '').slice(0, 7),
    sspBookingId: a.sspBookingId ?? null,
    driverName: a.driverName ?? null,
    reasonAr: a.reasonAr ?? null,
    documentUrl: a.documentUrl ?? null,
    // لا ترحيل بمجرد التسجيل — الاعتماد قرارٌ منفصل بمستنده.
    approvalStatus: 'pending_review',
    disputeStatus: 'none',
    createdAt: FieldValue.serverTimestamp(), createdAtIso: new Date().toISOString(), createdBy: userId,
  });
  return { adjustmentId: ref.id, approvalStatus: 'pending_review' };
}
