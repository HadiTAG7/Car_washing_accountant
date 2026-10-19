import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { callerRole } from '../functions/src/handlers.js';
import { ADAPTERS, legacyLockIdFor } from '../functions/src/posting.js';
import { postSource } from '../functions/src/ledger.js';
import { taxPolicyAt } from '../functions/src/taxPolicy.js';
import { startupRollup, startupParentHasLegacyTaxFields } from '../functions/src/startupMigration.js';
import { isRealDate, postingLockId, round2 } from '../functions/src/invariants.js';
import { FINANCE_KINDS, financeHash, financeSourceHash, financeReviewId, financeProblems, journalMatchesFinanceSource, assertFinanceDocumentUniqueness, FinanceReviewError } from '../functions/src/financeReview.js';

const kindSchema = z.enum(['variable', 'monthly', 'annual', 'startup']);
const id = z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().refine(isRealDate, 'التاريخ غير صالح.');
const nullableText = z.string().trim().max(500).nullable();
const patchSchema = z.object({
  description: z.string().trim().min(2).max(1000).optional(), amount: z.number().finite().positive().max(1e9).optional(),
  date: date.optional(), quantity: z.number().finite().positive().max(1e6).optional(), categoryId: id.optional(), parentId: id.optional(),
  supplier: nullableText.optional(), invoiceNumber: nullableText.optional(), invoiceDate: date.nullable().optional(),
  invoiceUrl: z.string().url().refine(v => v.startsWith('https://') && !/\/api\/mcp\//i.test(v)).nullable().optional(),
  isTaxInvoice: z.boolean().optional(), vatAmount: z.number().finite().nonnegative().nullable().optional(),
  vatRate: z.number().finite().min(0).max(1).nullable().optional(), vatDeductible: z.boolean().optional(),
  priceMode: z.enum(['inclusive', 'exclusive']).optional(), paymentMethod: z.enum(['unknown', 'cash', 'transfer', 'card', 'credit']).optional(),
  paymentStatus: z.enum(['unknown', 'paid', 'unpaid']).optional(), paidDate: date.nullable().optional(),
  fundingType: z.enum(['unknown', 'company_cash', 'company_bank', 'vendor_liability', 'partner', 'employee']).optional(),
  fundingReference: nullableText.optional(), purpose: nullableText.optional(), evidenceRefs: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  taxReviewRef: nullableText.optional(), taxBasis: z.enum(['document', 'verified_historical_policy']).optional(),
}).strict();
const common = { kind: kindSchema, sourceId: id };
const correction = { ...common, patch: patchSchema, sourceHash: hash };
const capture = { kind: kindSchema, requestId: id, patch: patchSchema };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), kind: kindSchema, after: id.optional() }).strict(),
  z.object({ action: z.literal('options'), kind: kindSchema }).strict(),
  z.object({ action: z.literal('read'), ...common }).strict(),
  z.object({ action: z.literal('preview'), ...correction }).strict(),
  z.object({ action: z.literal('save'), ...correction, previewHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('previewCapture'), ...capture }).strict(),
  z.object({ action: z.literal('capture'), ...capture, previewHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('approve'), ...common, sourceHash: hash, postingHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('post'), ...common, sourceHash: hash, confirm: z.literal(true) }).strict(),
]);
const fail = (message, code) => { throw new FinanceReviewError(message, code); };
async function adminOnly(db, auth) {
  if (await callerRole(db, auth) !== 'admin') fail('صندوق العمل المالي للإدارة فقط.', 'permission-denied');
}
const authTx = (db, tx) => ({ collection: name => ({ doc: key => ({ get: () => tx.get(db.collection(name).doc(key)) }) }) });
function applyPatch(kind, before, p) {
  const spec = FINANCE_KINDS[kind], row = { ...before };
  const map = { description: spec.title, amount: spec.amount, date: spec.date, categoryId: 'category_id', parentId: spec.fk,
    supplier: 'supplier', invoiceNumber: 'invoice_number', invoiceDate: 'invoice_date', invoiceUrl: 'invoice_url',
    isTaxInvoice: 'is_tax_invoice', vatAmount: 'vat_amount', vatRate: 'vat_rate', vatDeductible: 'vat_deductible',
    priceMode: 'price_mode', paymentMethod: 'payment_method', paymentStatus: 'payment_status', paidDate: 'paid_date', quantity: 'quantity' };
  for (const [key, value] of Object.entries(p)) if (map[key]) row[map[key]] = value;
  if (p.parentId && !spec.fk) fail('هذا النوع لا يقبل بندًا أبًا.', 'invalid-argument');
  if (p.categoryId && spec.fk) fail('هذا النوع يتبع بند التأسيس أو السنوي.', 'invalid-argument');
  const meta = { ...(row.finance_metadata || {}) };
  for (const key of ['fundingType', 'fundingReference', 'purpose', 'evidenceRefs', 'taxReviewRef', 'taxBasis']) if (Object.hasOwn(p, key)) meta[key] = p[key];
  row.finance_metadata = meta;
  if (row[spec.amount] !== undefined && (!Number.isFinite(row[spec.amount]) || row[spec.amount] <= 0
    || round2(row[spec.amount]) !== row[spec.amount])) fail('المبلغ يجب أن يكون موجبًا بالهللة.', 'invalid-argument');
  if (Number.isFinite(row.quantity) && Number.isFinite(row[spec.amount])) row.unit_cost = Number((row[spec.amount] / row.quantity).toFixed(8));
  row.finance_workflow_version = 1;
  const previousRevision = before.finance_revision ?? 0;
  if (!Number.isSafeInteger(previousRevision) || previousRevision < 0 || previousRevision >= Number.MAX_SAFE_INTEGER) fail('نسخة المصدر التقنية غير صالحة؛ لا تحفظ فوقها.');
  row.finance_revision = previousRevision + 1;
  row.approval_status = 'pending';
  return row;
}
async function readState(db, tx, kind, sourceId, row) {
  const lockIds = [...new Set([postingLockId(kind, sourceId), legacyLockIdFor(kind, sourceId)].filter(Boolean))];
  const locks = await Promise.all(lockIds.map(key => tx.get(db.collection('posting_locks').doc(key))));
  const journals = await tx.get(db.collection('journal_entries').where('sourceId', '==', sourceId));
  const review = await tx.get(db.collection('finance_reviews').doc(financeReviewId(kind, sourceId)));
  const spec = FINANCE_KINDS[kind], dates = [...new Set([row[spec.date], row.paid_date, row.invoice_date].filter(Boolean))];
  const periods = await Promise.all(dates.filter(isRealDate).map(day => tx.get(db.collection('accounting_periods').doc(day.slice(0, 7)))));
  const matchingJournals = journals.docs.filter(d => journalMatchesFinanceSource(kind, d.data()));
  const protectedSource = locks.some(l => l.exists) || matchingJournals.length > 0 || Boolean(row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted');
  const closed = periods.some(p => p.exists && p.data().status === 'closed');
  const reviewValue = review.exists ? review.data() : null, sourceHash = financeSourceHash(row);
  return { protectedSource, closed, sourceHash, review: reviewValue,
    approved: row.approval_status === 'approved' && reviewValue?.status === 'approved' && reviewValue?.sourceHash === sourceHash,
    journalIds: matchingJournals.map(d => d.id) };
}
async function validateClassification(db, tx, kind, row) {
  const spec = FINANCE_KINDS[kind];
  if (spec.fk && row[spec.fk]) {
    const ref = db.collection(spec.parent).doc(row[spec.fk]), snap = await tx.get(ref);
    if (!snap.exists) fail('بند التصنيف غير موجود.', 'not-found');
    const siblings = await tx.get(db.collection(spec.collection).where(spec.fk, '==', row[spec.fk]));
    if (siblings.docs.some(d => !Number.isFinite(d.data().amount) || d.data().amount <= 0)) fail('مبالغ السجلات التابعة غير مكتملة؛ لا يعاد تجميعها افتراضيًا.');
    const parent = snap.data();
    if (siblings.empty && (Number(parent.actual_amount) > 0 || startupParentHasLegacyTaxFields({
      isTaxInvoice: parent.is_tax_invoice, invoiceNumber: parent.invoice_number, invoiceDate: parent.invoice_date,
      supplier: parent.supplier, vatAmount: parent.vat_amount, vatRate: parent.vat_rate,
    }))) fail('البند يحمل بيانات إنفاق أو فاتورة تاريخية غير مفصلة؛ لا تستبدلها.');
    return { ref, raw: snap.data(), rows: siblings.docs.map(d => ({ ...d.data(), id: d.id })) };
  }
  if (!spec.fk && row.category_id) {
    if (!(await tx.get(db.collection(spec.category).doc(row.category_id))).exists) fail('التصنيف غير موجود.', 'not-found');
  }
  return null;
}
async function checkDuplicate(db, tx, kind, sourceId, row) {
  return assertFinanceDocumentUniqueness(db, tx, kind, sourceId, row);
}
async function postingPreview(db, tx, kind, sourceId, row) {
  const issues = financeProblems(kind, row);
  if (issues.length) return { ready: false, issues, entry: null, lines: [] };
  try {
    const settings = await tx.get(db.collection('app_settings').doc('accounting'));
    const policyAt = day => taxPolicyAt(day, settings.exists ? settings.data().value || {} : {});
    const policy = policyAt(ADAPTERS[kind].dateOf(row));
    if (!policy.known) return { ready: false, issues: ['السياسة التاريخية غير مهيأة لهذا التاريخ.'], entry: null, lines: [] };
    const built = ADAPTERS[kind].build(row, sourceId, { recordDate: ADAPTERS[kind].dateOf(row), policyAt });
    const accounts = await tx.get(db.collection('chart_of_accounts'));
    const known = new Set(accounts.docs.map(d => d.id));
    if ([...built.lines, ...(built.settlement?.lines || [])].some(l => !known.has(String(l.accountId)))) {
      return { ready: false, issues: ['حسابات القيد غير مكتملة في الدليل.'], entry: null, lines: [] };
    }
    return { ready: true, issues: [], ...built, postingHash: financeHash(built) };
  } catch (error) { return { ready: false, issues: [error.message], entry: null, lines: [] }; }
}
function publicRow(kind, sourceId, row, state, preview) {
  const approved = Boolean(state.approved && preview.ready && state.review?.postingHash === preview.postingHash);
  return { kind, sourceId, row, ...state, approved,
    issues: state.approved && !approved ? ['تغيرت معاينة الحسابات أو المعالجة الضريبية بعد الاعتماد؛ أعد المراجعة.', ...preview.issues] : preview.issues,
    postingPreview: preview, stage: state.protectedSource ? 'protected' : state.closed ? 'closed_period' : approved ? 'approved' : preview.ready ? 'review_ready' : 'incomplete' };
}
export async function financeWorkbench(db, auth, input) {
  await adminOnly(db, auth);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.issues.map(i => i.message).join(' '), 'invalid-argument');
  const r = parsed.data, spec = FINANCE_KINDS[r.kind];
  if (r.action === 'options') {
    const snap = await db.collection(spec.parent || spec.category).limit(101).get();
    return { items: snap.docs.slice(0, 100).map(doc => ({ id: doc.id,
      label: doc.data().label || doc.data().name || doc.data().item_name || doc.data().expense_name || doc.data().title || doc.data().description || doc.id })),
    limited: snap.size > 100, parent: Boolean(spec.parent) };
  }
  if (r.action === 'list') {
    let query = db.collection(spec.collection).orderBy('__name__');
    if (r.after) query = query.startAfter(r.after);
    const snap = await query.limit(31).get();
    return { kind: r.kind, items: snap.docs.slice(0, 30).map(doc => ({ sourceId: doc.id, title: doc.data()[spec.title] || 'بلا عنوان',
      amount: doc.data()[spec.amount] ?? null, date: doc.data()[spec.date] ?? null,
      review: doc.data().approval_status || 'unreviewed', paymentStatus: doc.data().payment_status || 'unknown' })),
    nextAfter: snap.size > 30 ? snap.docs[29].id : null, coverage: 'قائمة محدودة إلى 30 سجلًا؛ ليست إجمالي الذمم أو المؤهل.' };
  }
  const sourceId = r.sourceId || `finance_${financeHash({ uid: auth.uid, kind: r.kind, requestId: r.requestId }).slice(0, 40)}`;
  if (r.action === 'post') {
    const before = await financeWorkbench(db, auth, { action: 'read', kind: r.kind, sourceId });
    if (before.sourceHash !== r.sourceHash || !before.approved || !before.postingPreview.ready || before.protectedSource || before.closed) fail('تغيرت النسخة أو لم تكتمل أهلية الترحيل.');
    const result = await postSource(db, FieldValue, { kind: r.kind, sourceId }, { userId: auth.uid,
      expectedFinanceSourceHash: r.sourceHash, financeAuthorizer: tx => adminOnly(authTx(db, tx), auth) });
    const after = await financeWorkbench(db, auth, { action: 'read', kind: r.kind, sourceId });
    if (!after.protectedSource || !after.journalIds.length) fail('استجابة الترحيل لا تكفي؛ تعذر التحقق من الربط.');
    const expected = [before.postingPreview, ...(before.postingPreview.settlement ? [before.postingPreview.settlement] : [])];
    const actual = await Promise.all(after.journalIds.map(async entryId => {
      const entry = await db.collection('journal_entries').doc(entryId).get();
      return { entry: entry.data(), lines: entry.data()?.lines || [] };
    }));
    const normalize = lines => lines.map(l => ({ accountId: String(l.accountId), debit: round2(l.debit || 0), credit: round2(l.credit || 0) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (actual.length !== expected.length || expected.some(e => !actual.some(a => a.entry?.sourceId === sourceId
      && a.entry?.entryDate === e.entry.entryDate && a.entry?.status === 'posted'
      && financeHash(normalize(a.lines)) === financeHash(normalize(e.lines))))) fail('لم تتطابق أسطر القيد المحفوظ مع المعاينة؛ أوقف الإعادة وأبق الحالة للمطابقة.');
    return { result, verification: { sourceId, journalIds: after.journalIds, verified: true, linesMatched: true }, after };
  }
  return db.runTransaction(async tx => {
    await adminOnly(authTx(db, tx), auth);
    const sourceRef = db.collection(spec.collection).doc(sourceId), snap = await tx.get(sourceRef);
    const isCapture = ['capture', 'previewCapture'].includes(r.action);
    const receiptRef = db.collection('finance_workbench_receipts').doc(financeHash({ uid: auth.uid, kind: r.kind, action: r.action,
      key: r.action === 'approve' ? { sourceHash: r.sourceHash, postingHash: r.postingHash } : r.previewHash || r.sourceHash || r.requestId || sourceId }));
    const receipt = await tx.get(receiptRef);
    const requestHash = financeHash(r);
    if (receipt.exists && ['save', 'capture', 'approve'].includes(r.action)) {
      if (receipt.data().requestHash !== requestHash) fail('تغير الطلب بعد تنفيذه؛ لا تعاد ببصمة قديمة.');
      if (r.action === 'approve') {
        if (!snap.exists) fail('المصروف غير موجود.', 'not-found');
        const current = await readState(db, tx, r.kind, sourceId, snap.data());
        const preview = await postingPreview(db, tx, r.kind, sourceId, snap.data());
        if (!current.approved || current.protectedSource || current.closed || current.sourceHash !== r.sourceHash
          || !preview.ready || preview.postingHash !== r.postingHash) fail('تغيرت معاينة القيد؛ أعد القراءة قبل الاعتماد.');
        await checkDuplicate(db, tx, r.kind, sourceId, snap.data());
      }
      return { ...receipt.data().result, duplicate: true };
    }
    if (isCapture && snap.exists) fail('السجل لهذا الطلب موجود؛ اقرأ نتيجته ولا تكرره.', 'already-exists');
    if (!isCapture && !snap.exists) fail('المصروف غير موجود.', 'not-found');
    const before = snap.exists ? snap.data() : {};
    const state = await readState(db, tx, r.kind, sourceId, before);
    if (r.action === 'read') return publicRow(r.kind, sourceId, before, state, await postingPreview(db, tx, r.kind, sourceId, before));
    if (state.protectedSource) fail('مصدر له قيد أو قفل أو تاريخ ترحيل؛ التصحيح وإعادة الاعتماد مرفوضان.');
    if (state.closed) fail('الفترة مقفلة.');
    if (!isCapture && state.sourceHash !== r.sourceHash) fail('تغير السجل؛ أعد القراءة والمعاينة.');
    const after = r.action === 'approve' ? before : applyPatch(r.kind, before, r.patch);
    if (isCapture && (!after[spec.title] || !after[spec.date] || !after[spec.amount] || !after.quantity)) fail('التسجيل يحتاج وصفًا وتاريخًا ومبلغًا وكمية مثبتة.');
    if (isCapture && !after.invoice_url) fail('رابط المستند مطلوب لمنع التكرار.');
    // A same-record edit never relocates or deletes a source, nor moves a
    // booked date to an open month to evade the original period lock.
    const afterState = await readState(db, tx, r.kind, sourceId, after);
    if (afterState.closed) fail('أحد تواريخ المصدر أو الفاتورة أو السداد مقفل.');
    if (before[spec.fk] && r.patch?.parentId && r.patch.parentId !== before[spec.fk]) fail('نقل البند الأب ليس تصحيحًا لنفس السجل في هذا المسار.');
    const parent = await validateClassification(db, tx, r.kind, after);
    await checkDuplicate(db, tx, r.kind, sourceId, after);
    const preview = await postingPreview(db, tx, r.kind, sourceId, after);
    const previewHash = financeHash({ kind: r.kind, sourceId, before, after, parent: parent ? { value: parent.raw, rows: parent.rows } : null });
    if (['preview', 'previewCapture'].includes(r.action)) return { kind: r.kind, sourceId, sourceHash: state.sourceHash, previewHash, before, after,
      issues: preview.issues, postingPreview: preview, financialPosting: false };
    if (r.action === 'approve' && !preview.ready) fail(preview.issues.join(' '));
    if (r.action === 'approve' && r.postingHash !== preview.postingHash) fail('تغيرت معاينة القيد؛ أعد القراءة قبل الاعتماد.');
    if (r.action !== 'approve' && r.previewHash !== previewHash) fail('تغيرت المعاينة أو بيانات البند؛ أعد المعاينة.');
    const auditRef = db.collection('audit_logs').doc(), reviewRef = db.collection('finance_reviews').doc(financeReviewId(r.kind, sourceId));
    if (r.action !== 'approve') {
      tx.set(sourceRef, { ...after, updated_at: FieldValue.serverTimestamp(), updated_by: auth.uid });
      if (parent) {
        const total = round2(parent.rows.filter(row => row.id !== sourceId).reduce((sum, row) => sum + Number(row.amount || 0), 0) + after[spec.amount]);
        tx.update(parent.ref, { actual_amount: total,
          ...(r.kind === 'startup' ? { status: startupRollup([total], parent.raw.budgeted_amount).status } : {}),
          updated_at: FieldValue.serverTimestamp(), updated_by: auth.uid });
      }
    } else {
      tx.update(sourceRef, { approval_status: 'approved' });
    }
    tx.set(reviewRef, { kind: r.kind, sourceId, sourceHash: financeSourceHash(after), status: r.action === 'approve' ? 'approved' : 'pending',
      postingHash: r.action === 'approve' ? preview.postingHash : null,
      reviewedByUid: auth.uid, reviewedAt: FieldValue.serverTimestamp(), reason: r.reason,
      evidenceRefs: after.finance_metadata?.evidenceRefs || [], verificationKind: 'self' });
    tx.set(auditRef, { action: `finance-${r.action}`, userId: auth.uid, kind: r.kind, sourceId, before, after,
      reason: r.reason, sourceHash: financeSourceHash(after), at: FieldValue.serverTimestamp() });
    const result = { saved: true, action: r.action, kind: r.kind, sourceId, sourceHash: financeSourceHash(after), auditId: auditRef.id,
      approved: r.action === 'approve', financialPosting: false };
    tx.set(receiptRef, { requestHash, result, at: FieldValue.serverTimestamp(), userId: auth.uid });
    return result;
  });
}
