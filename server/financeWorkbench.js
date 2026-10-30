import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { callerRole } from '../functions/src/handlers.js';
import { ADAPTERS, legacyLockIdFor } from '../functions/src/posting.js';
import { postSource } from '../functions/src/ledger.js';
import { taxPolicyAt } from '../functions/src/taxPolicy.js';
import { startupRollup, startupParentHasLegacyTaxFields } from '../functions/src/startupMigration.js';
import { isRealDate, postingLockId, round2 } from '../functions/src/invariants.js';
import { FINANCE_KINDS, financeHash, financeSourceHash, financeReviewId, financeProblems, journalMatchesFinanceSource, assertFinanceDocumentUniqueness, FinanceReviewError,
  managerAttestationOf, statementLineRefOf } from '../functions/src/financeReview.js';
import { financeReadSnapshot } from './financeReadSnapshot.js';
import { filterWorkbenchItems, hasPaymentConflict, documentDay } from '../src/lib/financeWorkbenchView.js';
import { cashBankCorrection } from './cashBankCorrection.js';
import {cashResidualCorrection} from './cashResidualCorrection.js';
import { payrollCashFunding } from './payrollCashFunding.js';
import { invoiceLinesShapeIssues } from '../functions/src/financeInvoiceLines.js';
import { financeSourceEvidence, sourceEvidenceShapeValid } from '../functions/src/financeSourceEvidence.js';
import { financePostingHistory } from './financePostingHistory.js';
import { financeBlockerCategory, financeWorkflowDimensions } from '../src/lib/financeWorkflowDimensions.js';
import { foundingSettlement, foundingEntryId } from './foundingSettlement.js';
import { ACC } from '../src/lib/accounting/chartOfAccounts.js';
import { employeeCustody } from '../functions/src/custodyRecovery.js';
import { applyCompletion, approvedBeforeCompletion, completionBaseHash, completionHistoryOf, completionSchema, onlyCompletionFieldsChanged } from './financePostedCompletion.js';
import { FOUNDING_DEFAULTS, FILED_VAT_QUARTERS, dayBefore, quarterOf } from '../src/lib/founding/foundingPlan.js';

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
  priceMode: z.enum(['inclusive', 'exclusive']).optional(), paymentMethod: z.enum(['unknown', 'cash', 'transfer', 'card', 'credit', 'owner_current', 'founding_personal', 'custody', 'partner_paid']).optional(),
  paymentStatus: z.enum(['unknown', 'paid', 'unpaid']).optional(), paidDate: date.nullable().optional(),
  fundingType: z.enum(['unknown', 'company_cash', 'company_bank', 'vendor_liability', 'partner', 'employee', 'owner_current', 'custody']).optional(),
  fundingPartnerId: id.nullable().optional(), custodian: z.string().trim().min(1).max(80).nullable().optional(), custodyBikerId: id.nullable().optional(),
  statementLineRef: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).nullable().optional(),
  managerAttestation: z.object({ by: id, byName: z.string().trim().min(1).max(200), atIso: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
    approxDate: date, note: z.string().trim().min(1).max(500).optional() }).strict().nullable().optional(),
  fundingReference: nullableText.optional(), purpose: nullableText.optional(), evidenceRefs: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  taxReviewRef: nullableText.optional(), taxBasis: z.enum(['document', 'verified_historical_policy']).optional(),
  invoiceLines: z.unknown().refine(value => value === null || invoiceLinesShapeIssues(value).length === 0, 'بنود الفاتورة غير صالحة.').optional(),
  quantityException: z.unknown().refine(sourceEvidenceShapeValid, 'دليل استثناء الكمية غير مكتمل.').optional(),
  documentAllocation: z.unknown().refine(sourceEvidenceShapeValid, 'دليل توزيع الأصل غير مكتمل.').optional(),
  reviewedDocumentIdentity: z.unknown().refine(sourceEvidenceShapeValid, 'دليل هوية المستند المراجعة غير مكتمل.').optional(),
}).strict();
const common = { kind: kindSchema, sourceId: id };
const correction = { ...common, patch: patchSchema, sourceHash: hash };
const capture = { kind: kindSchema, requestId: id, patch: patchSchema };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('browse') }).strict(),
  z.object({ action: z.literal('list'), kind: kindSchema, after: id.optional() }).strict(),
  z.object({ action: z.literal('options'), kind: kindSchema }).strict(),
  z.object({ action: z.literal('read'), ...common }).strict(),
  z.object({ action: z.literal('preview'), ...correction }).strict(),
  z.object({ action: z.literal('save'), ...correction, previewHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('previewCapture'), ...capture }).strict(),
  z.object({ action: z.literal('capture'), ...capture, previewHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('approve'), ...common, sourceHash: hash, postingHash: hash, reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('post'), ...common, sourceHash: hash, confirm: z.literal(true) }).strict(),
  // A posted record: its non-financial fields only, see completePosted.
  z.object({ action: z.literal('previewCompletion'), ...common, sourceHash: hash, completion: completionSchema }).strict(),
  z.object({ action: z.literal('complete'), ...common, sourceHash: hash, completion: completionSchema, previewHash: hash,
    reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) }).strict(),
]);
const fail = (message, code) => { throw new FinanceReviewError(message, code); };
const PURPOSE_AND_EVIDENCE = 'الغرض ودليل المراجعة غير مكتملين.';
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
  for (const key of ['statementLineRef', 'fundingPartnerId', 'custodian', 'managerAttestation']) if (Object.hasOwn(p, key)) {
    if (p[key] === null) delete meta[key]; else meta[key] = p[key];
  }
  // The employee whose custody pays; his name is written by the server from the registry.
  if (Object.hasOwn(p, 'custodyBikerId')) {
    if (p.custodyBikerId === null) { if (meta.custodyBikerId) delete meta.custodian; delete meta.custodyBikerId; } else meta.custodyBikerId = p.custodyBikerId;
  }
  if (Object.hasOwn(p, 'invoiceLines')) {
    if (p.invoiceLines === null) delete meta.invoiceLines;
    else meta.invoiceLines = p.invoiceLines;
  }
  for (const key of ['quantityException', 'documentAllocation', 'reviewedDocumentIdentity']) if (Object.hasOwn(p, key)) {
    if (p[key] === null) delete meta[key]; else meta[key] = p[key];
  }
  row.finance_metadata = meta;
  if (row[spec.amount] !== undefined && (!Number.isFinite(row[spec.amount]) || row[spec.amount] <= 0
    || round2(row[spec.amount]) !== row[spec.amount])) fail('المبلغ يجب أن يكون موجبًا بالهللة.', 'invalid-argument');
  if (Object.hasOwn(meta, 'quantityException')) {
    if (p.quantity != null || meta.invoiceLines != null) fail('استثناء العدد لا يقبل كمية مفترضة أو بنودًا مختلفة.', 'invalid-argument');
    row.quantity = null; row.unit_cost = null;
  } else if (Object.hasOwn(meta, 'invoiceLines')) {
    if (p.quantity != null) fail('لا تجمع كمية واحدة مع بنود مختلفة؛ اختر تمثيل المستند من مصدره.', 'invalid-argument');
    row.quantity = null; row.unit_cost = null;
  } else if (Number.isFinite(row.quantity) && Number.isFinite(row[spec.amount])) row.unit_cost = Number((row[spec.amount] / row.quantity).toFixed(8));
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
  const { closed, postingDate } = await foundingPosting(db, tx, kind, row);
  const matchingJournals = journals.docs.filter(d => journalMatchesFinanceSource(kind, d.data()));
  const protectedSource = locks.some(l => l.exists) || matchingJournals.length > 0 || Boolean(row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted');
  const reviewValue = review.exists ? review.data() : null, sourceHash = financeSourceHash(row);
  const sourceContext = await financeSourceEvidence(db, tx, kind, sourceId, row);
  return { protectedSource, closed, postingDate, sourceHash, review: reviewValue, sourceContext,
    approved: row.approval_status === 'approved' && reviewValue?.status === 'approved' && reviewValue?.sourceHash === sourceHash
      && !sourceContext.issues.length && (reviewValue?.sourceContextHash || null) === sourceContext.contextHash,
    journalIds: matchingJournals.map(d => d.id) };
}
/**
 * الشهر المقفل يبقى مقفلًا. مستند فترة التأسيس (قبل تاريخ القطع) كل تواريخه
 * المقفلة قبل القطع يُعدَّل ويُعتمد ويُرحَّل بقيد مؤرخ بآخر يوم فيها — مثل قيود
 * التصحيح — ما دام شهر ذلك اليوم مفتوحًا. غير ذلك: مقفل كما كان.
 */
async function foundingPosting(db, tx, kind, row) {
  const spec = FINANCE_KINDS[kind], dates = [...new Set([row[spec.date], row.paid_date, row.invoice_date].filter(isRealDate))];
  const periods = await Promise.all(dates.map(day => tx.get(db.collection('accounting_periods').doc(day.slice(0, 7)))));
  const closedDays = dates.filter((_, i) => periods[i].exists && periods[i].data().status === 'closed');
  if (!closedDays.length) return { closed: false, postingDate: null };
  const cutoff = await foundingCutoffOf(db, tx);
  if (!isRealDate(row[spec.date]) || row[spec.date] >= cutoff || closedDays.some(day => day >= cutoff)) return { closed: true, postingDate: null };
  const end = dayBefore(cutoff), endPeriod = await tx.get(db.collection('accounting_periods').doc(end.slice(0, 7)));
  if (endPeriod.exists && endPeriod.data().status === 'closed') return { closed: true, postingDate: null };
  return { closed: false, postingDate: end };
}

/** The day the company bank account started: a record dated before it belongs to the founding period. */
async function foundingCutoffOf(db, tx) {
  const review = await tx.get(db.collection('founding_review').doc('current'));
  const saved = review.exists ? review.data().cutoffDate : null;
  return isRealDate(saved) ? saved : FOUNDING_DEFAULTS.cutoffDate;
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
async function checkDuplicate(db, tx, kind, sourceId, row, options) {
  return assertFinanceDocumentUniqueness(db, tx, kind, sourceId, row, options);
}
async function postingPreview(db, tx, kind, sourceId, row, context = null) {
  const sourceContext = context || await financeSourceEvidence(db, tx, kind, sourceId, row);
  const issues = [...financeProblems(kind, row, sourceId), ...sourceContext.issues];
  if (issues.length) return { ready: false, issues, entry: null, lines: [] };
  try {
    const settings = await tx.get(db.collection('app_settings').doc('accounting'));
    const policyAt = day => taxPolicyAt(day, settings.exists ? settings.data().value || {} : {});
    const policy = policyAt(ADAPTERS[kind].dateOf(row));
    if (!policy.known) return { ready: false, issues: ['السياسة التاريخية غير مهيأة لهذا التاريخ.'], entry: null, lines: [] };
    const { postingDate } = await foundingPosting(db, tx, kind, row);
    const built = ADAPTERS[kind].build(row, sourceId, { recordDate: ADAPTERS[kind].dateOf(row), policyAt, postingDate });
    // Input VAT in a filed return stays held until Hadi marks it reviewed in the founding settlement.
    const vatDay = isRealDate(row.invoice_date) ? row.invoice_date : ADAPTERS[kind].dateOf(row);
    if (postingDate && built.lines.some(l => String(l.accountId) === ACC.INPUT_VAT && Number(l.debit) > 0) && FILED_VAT_QUARTERS.includes(quarterOf(vatDay))) {
      const decision = await tx.get(db.collection('founding_decisions').doc(financeHash(`${kind}:${sourceId}`).slice(0, 40)));
      if (!(decision.exists && decision.data().vatReviewed === true)) {
        return { ready: false, issues: [`ضريبة مدخلاته في إقرار مقدّم (${quarterOf(vatDay)}): علّمه «راجعته» في تسوية فترة التأسيس قبل ترحيله بتاريخ ${postingDate}.`], entry: null, lines: [] };
      }
    }
    const accounts = await tx.get(db.collection('chart_of_accounts'));
    const known = new Set(accounts.docs.map(d => d.id));
    if ([...built.lines, ...(built.settlement?.lines || [])].some(l => !known.has(String(l.accountId)))) {
      return { ready: false, issues: ['حسابات القيد غير مكتملة في الدليل.'], entry: null, lines: [] };
    }
    return { ready: true, issues: [], ...built, postingHash: sourceContext.contextHash
      ? financeHash({ built, sourceContextHash: sourceContext.contextHash }) : financeHash(built) };
  } catch (error) { return { ready: false, issues: [error.message], entry: null, lines: [] }; }
}
function publicRow(kind, sourceId, row, state, preview) {
  const approved = Boolean(state.approved && preview.ready && state.review?.postingHash === preview.postingHash);
  return { kind, sourceId, row, ...state, approved,
    issues: state.approved && !approved ? ['تغيرت معاينة الحسابات أو المعالجة الضريبية بعد الاعتماد؛ أعد المراجعة.', ...preview.issues] : preview.issues,
    postingPreview: preview, stage: state.protectedSource ? 'protected' : state.closed ? 'closed_period' : approved ? 'approved' : preview.ready ? 'review_ready' : 'incomplete' };
}
async function workflowDocument(db, tx, kind, sourceId, row, currentState = null) {
  const state = currentState || await readState(db, tx, kind, sourceId, row);
  const preview = await postingPreview(db, tx, kind, sourceId, row, state.sourceContext);
  const detail = publicRow(kind, sourceId, row, state, preview);
  // Reporting the current checks, not replacing or relaxing any write gate.
  const additionalIssues = [];
  if (!state.protectedSource && !state.closed && preview.ready) {
    try { await validateClassification(db, tx, kind, row); await checkDuplicate(db, tx, kind, sourceId, row); }
    catch (error) { if (!(error instanceof FinanceReviewError)) throw error; additionalIssues.push(error.message); }
  }
  const journals = await Promise.all(state.journalIds.map(id => tx.get(db.collection('journal_entries').doc(id))));
  const postingHistory = await financePostingHistory(db, tx, journals, sourceId);
  const reversed = postingHistory.reversed.length > 0;
  const posted = postingHistory.active.length > 0;
  const evidence = row.finance_metadata || {};
  const paymentEvidence = row.payment_status === 'paid' && isRealDate(row.paid_date)
    && typeof evidence.fundingReference === 'string' && Boolean(evidence.fundingReference.trim())
    && Array.isArray(evidence.evidenceRefs) && evidence.evidenceRefs.length > 0 && evidence.evidenceRefs.every(ref => typeof ref === 'string' && ref.trim())
    && ((evidence.fundingType === 'company_cash' && row.payment_method === 'cash')
      || (evidence.fundingType === 'company_bank' && ['transfer', 'card'].includes(row.payment_method))
      || (evidence.fundingType === 'owner_current' && row.payment_method === 'owner_current'));
  // «مثبت بإقرار المدير — قاعدة فترة التأسيس»: a posted founding-period record that Hadi paid, on 2300 —
  // by its own entry (paid «دفع شخصي - فترة التأسيس») or by a posted «تصحيح جهة دفع» from the founding
  // settlement. Kept apart from proof by a statement or a receipt; read only, nothing is written.
  const cutoffDate = await foundingCutoffOf(db, tx), day = documentDay(row[FINANCE_KINDS[kind].date]), attestation = managerAttestationOf(row);
  const foundingRule = posted && !paymentEvidence && day && day < cutoffDate ? await foundingPaymentRule(db, tx, kind, sourceId, row, journals) : null;
  const paymentProof = paymentEvidence ? 'evidence' : foundingRule ? 'founding_rule' : null, paymentProven = Boolean(paymentProof);
  // The rule settles who paid and from which account: its payment, funding and counter-account blockers are
  // resolved, listed apart, and its entry is the review evidence once the purpose is written. Read only.
  const resolvedByRule = foundingRule ? detail.issues.filter(issue => ['payment', 'funding'].includes(financeBlockerCategory(issue))
    || (issue === PURPOSE_AND_EVIDENCE && typeof evidence.purpose === 'string' && evidence.purpose.trim())) : [];
  const openIssues = detail.issues.filter(issue => !resolvedByRule.includes(issue));
  const safeUnposted = !state.protectedSource && !state.closed && preview.ready && !additionalIssues.length && !detail.issues.length;
  const correctedNeedsReview = reversed && (openIssues.length > 0 || postingHistory.issues.length > 0 || !paymentProven);
  // Read/display only: a peer may change after this source was posted. Keep
  // the strict approval/context hashes and the existing journal untouched.
  const approvalContextChanged = Boolean(state.review?.status === 'approved' && state.review.sourceHash === state.sourceHash
    && (state.review.sourceContextHash || null) !== state.sourceContext.contextHash);
  // «بلا إيصال، بإقرار المدير»: offered on a founding-period record not yet posted; the founding endpoint re-checks on save.
  const founding = { cutoffDate, attestation: attestation ? { byName: attestation.byName || null, atIso: attestation.atIso, approxDate: attestation.approxDate, note: attestation.note || null } : null,
    attestable: Boolean(day && day < cutoffDate && !state.protectedSource && !state.closed && !attestation && !statementLineRefOf(row)) };
  // «ملغى — مكرر»: a posted cancellation from the founding settlement reverses all its live effects.
  const cancelled = await duplicateCancellationOf(db, tx, kind, sourceId);
  const workflowStage = cancelled ? 'cancelled' : posted ? correctedNeedsReview || approvalContextChanged ? 'posted_review' : paymentProven ? 'complete' : 'posted_unproven'
    : safeUnposted ? detail.approved ? 'approved' : 'ready' : 'incomplete';
  const result = { ...detail, issues: [...openIssues, ...additionalIssues, ...postingHistory.issues], resolvedByRule, workflowStage, postingHistory,
    approvalReady: safeUnposted && !detail.approved && !detail.issues.length,
    postingReady: safeUnposted && detail.approved && !detail.issues.length,
    paymentProven, paymentProof, paymentRule: foundingRule?.rule || null, paymentRuleEntry: foundingRule?.entryNumber ?? null,
    paymentConflict: hasPaymentConflict(row), founding,
    // «استكمال مستند مرحّل»: offered on a record with a live entry; an approval given before it stays shown as such.
    completion: { available: posted && !cancelled, history: completionHistoryOf(row) }, cancelled,
    approvalBeforeCompletion: posted && !detail.approved && approvedBeforeCompletion(row, state.review),
    approvalContextChanged,
    workflowNote: cancelled ? `ملغى — مكرر لـ«${cancelled.originalTitle || cancelled.originalKey || 'الأصلي'}»: قيد الإلغاء ${cancelled.entryNumber != null ? `#${cancelled.entryNumber} ` : ''}عكس كل أثره، ولا يدخل ملخص فترة التأسيس ولا حساب 2300.`
      : posted && approvalContextChanged ? state.sourceContext.allocationGrant
      ? 'تغيّرت نسخة أحد جزأي المستند بعد الاعتماد؛ القيد محفوظ، والاعتماد الحالي يحتاج مراجعة.'
      : 'تغيّر سياق مراجعة المستند بعد الاعتماد؛ القيد محفوظ، والاعتماد الحالي يحتاج مراجعة.'
      : reversed && posted ? 'له قيود مرحلة سارية بعد عكس الأصل؛ لا يعاد ترحيله. اكتمال الدليل والسداد منفصل عن وجود القيود.'
      : reversed ? 'له قيد معكوس دون بديل مرحل مثبت؛ المصدر محمي ويحتاج مراجعة.' : state.closed ? 'الفترة مقفلة؛ العرض فقط.'
      : state.protectedSource && !posted ? 'المصدر محمي؛ لم يثبت قيد مرحّل صالح في القراءة الحالية.' : null,
    journalNumbers: journals.map(j => j.data()?.entryNumber).filter(Number.isFinite) };
  return { ...result, workflowDimensions: financeWorkflowDimensions(result, { recorded: true }) };
}
const creditsHadi = entry => (entry?.lines || []).some(line => String(line.accountId) === ACC.HADI_CURRENT && Number(line.credit) > 0);
const liveEntry = entry => entry?.status === 'posted' && !entry.reversalOf && !entry.reversedBy;
/** Which founding rule proves the payment, and its entry: the record's own entry on 2300, or the founding «تصحيح جهة دفع» entry moving it there. */
/** The posted «إلغاء مستند مكرر» entry of this record, and the original it duplicates. */
async function duplicateCancellationOf(db, tx, kind, sourceId) {
  const entry = await tx.get(db.collection('journal_entries').doc(foundingEntryId(`duplicate:${kind}:${sourceId}`)));
  if (!entry.exists || !liveEntry(entry.data()) || entry.data().foundingEntry?.sourceKey !== `${kind}:${sourceId}`) return null;
  const originalKey = entry.data().foundingEntry.originalKey || null, [originalKind, ...rest] = String(originalKey || '').split(':');
  const original = FINANCE_KINDS[originalKind] && rest.length ? await tx.get(db.collection(FINANCE_KINDS[originalKind].collection).doc(rest.join(':'))) : null;
  return { originalKey, originalTitle: original?.exists ? original.data()[FINANCE_KINDS[originalKind].title] || null : null,
    entryNumber: entry.data().entryNumber ?? null, entryId: entry.id };
}
async function foundingPaymentRule(db, tx, kind, sourceId, row, journals) {
  const own = row.payment_method === 'founding_personal' ? journals.find(j => liveEntry(j.data()) && creditsHadi(j.data())) : null;
  if (own) return { rule: 'own_entry', entryNumber: own.data().entryNumber ?? null };
  const correction = await tx.get(db.collection('journal_entries').doc(foundingEntryId(`doc:${kind}:${sourceId}`)));
  return correction.exists && liveEntry(correction.data()) && correction.data().foundingEntry?.sourceKey === `${kind}:${sourceId}`
    && creditsHadi(correction.data()) ? { rule: 'payment_correction', entryNumber: correction.data().entryNumber ?? null } : null;
}
/**
 * «استكمال مستند مرحّل»: the purpose, the quantity and how it is represented, and the tax review reference
 * of a record with a live entry. The record's posting is rebuilt before and after and must be identical — no
 * amount, account, date or tax moves — nothing else on the record may change, no new gap may appear, and no
 * entry, lock or review is written. Who completed which fields, when and why, is kept on the record and in the audit log.
 */
async function completePosted(db, tx, auth, r, { sourceRef, before, state, receiptRef, requestHash }) {
  const { kind, sourceId } = r;
  const journals = await Promise.all(state.journalIds.map(key => tx.get(db.collection('journal_entries').doc(key))));
  const history = await financePostingHistory(db, tx, journals, sourceId);
  if (!history.active.length) fail('الاستكمال للمستند المرحّل فقط؛ غير المرحّل يُعدَّل ويُحفظ من النموذج.');
  if (state.sourceHash !== r.sourceHash) fail('تغير السجل؛ أعد القراءة والمعاينة.');
  const { after, fields } = applyCompletion(kind, before, r.completion);
  if (!onlyCompletionFieldsChanged(before, after)) fail('الاستكمال يمس حقولًا مالية؛ مرفوض.');
  const settings = await tx.get(db.collection('app_settings').doc('accounting'));
  const policyAt = day => taxPolicyAt(day, settings.exists ? settings.data().value || {} : {});
  const { postingDate } = await foundingPosting(db, tx, kind, before);
  const treatment = row => {
    try { return financeHash(ADAPTERS[kind].build(row, sourceId, { recordDate: ADAPTERS[kind].dateOf(row), policyAt, postingDate })); }
    catch (error) { return `error:${error.message}`; }
  };
  if (treatment(before) !== treatment(after)) fail('هذا الاستكمال يغيّر معالجة القيد (الحسابات أو المبالغ أو الضريبة)؛ مرفوض. المستند المرحّل يُستكمل بحقول غير مالية فقط.');
  const known = new Set(financeProblems(kind, before, sourceId)), added = financeProblems(kind, after, sourceId).filter(issue => !known.has(issue));
  if (added.length) fail(added.join(' '), 'invalid-argument');
  const previewHash = financeHash({ kind, sourceId, sourceHash: state.sourceHash, completion: r.completion, after });
  if (r.action === 'previewCompletion') return { kind, sourceId, sourceHash: state.sourceHash, previewHash, fields, treatmentUnchanged: true, financialPosting: false };
  if (r.previewHash !== previewHash) fail('تغيرت المعاينة؛ أعد المعاينة قبل الحفظ.');
  const user = await tx.get(db.collection('users').doc(auth.uid));
  const byName = (user.exists && (user.data().displayName || user.data().email)) || auth.email || auth.uid;
  const entry = { byUid: auth.uid, byName, atIso: new Date().toISOString(), reason: r.reason, fields,
    beforeHash: completionBaseHash(before), afterHash: completionBaseHash(after) };
  const saved = { ...after, finance_metadata: { ...after.finance_metadata,
    postedCompletion: [...(Array.isArray(before.finance_metadata?.postedCompletion) ? before.finance_metadata.postedCompletion : []), entry] } };
  const auditRef = db.collection('audit_logs').doc();
  tx.set(sourceRef, { ...saved, updated_at: FieldValue.serverTimestamp(), updated_by: auth.uid });
  tx.set(auditRef, { action: 'finance-complete-posted', userId: auth.uid, kind, sourceId, before, after: saved, fields, reason: r.reason,
    sourceHash: financeSourceHash(saved), journalIds: state.journalIds, at: FieldValue.serverTimestamp() });
  const result = { saved: true, action: r.action, kind, sourceId, sourceHash: financeSourceHash(saved), auditId: auditRef.id, fields, financialPosting: false };
  tx.set(receiptRef, { requestHash, result, at: FieldValue.serverTimestamp(), userId: auth.uid });
  return result;
}
async function browseDocuments(db) {
  const names = [...Object.values(FINANCE_KINDS).flatMap(spec => [spec.collection, spec.parent || spec.category]),
    'journal_entries', 'journal_lines', 'posting_locks', 'finance_reviews', 'accounting_periods', 'app_settings', 'chart_of_accounts',
    // A record whose document is a bank-statement line is verified against it;
    // a founding-period one in a closed month reads the cutoff and its decision.
    'bank_statement_lines', 'founding_review', 'founding_decisions'];
  const snapshot = await financeReadSnapshot(db, names);
  const tx = { get: reference => reference.get() };
  const items = [];
  // The snapshot is request-local and read-only. Reuse the exact read/preview,
  // classification and duplicate checks without one network query per record.
  for (const [kind, spec] of Object.entries(FINANCE_KINDS)) {
    const records = await snapshot.collection(spec.collection).get();
    for (const doc of records.docs) {
      const row = doc.data(), detail = await workflowDocument(snapshot, tx, kind, doc.id, row);
      items.push({ kind, sourceId: doc.id, title: row[spec.title] || 'بلا عنوان', amount: row[spec.amount] ?? null,
        date: documentDay(row[spec.date]) || row[spec.date] || null, supplier: row.supplier || '', documentNumber: row.invoice_number || row.receipt_number || '',
        paymentStatus: row.payment_status || 'unknown', workflowStage: detail.workflowStage, paymentConflict: detail.paymentConflict,
        approvalReady: detail.approvalReady, sourceHash: detail.sourceHash, postingHash: detail.postingPreview.postingHash || null,
        issueCount: detail.issues.length, workflowNote: detail.workflowNote, workflowDimensions: detail.workflowDimensions });
    }
  }
  return { items: filterWorkbenchItems(items), readAt: new Date().toISOString(), complete: true };
}
export async function financeWorkbench(db, auth, input) {
  await adminOnly(db, auth);
  if(input?.kind==='cash_bank_correction')return cashBankCorrection(db,auth,input);
  if(input?.kind==='cash_residual_correction')return cashResidualCorrection(db,auth,input);
  if(input?.kind==='payroll_cash_funding')return payrollCashFunding(db,auth,input);
  // Hadi's current account, statements and the founding period: its document
  // changes come back here through preview/save, with every control below.
  if (input?.kind === 'founding') return foundingSettlement(db, auth, input, { workbench: financeWorkbench });
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.issues.map(i => i.message).join(' '), 'invalid-argument');
  const r = parsed.data, spec = FINANCE_KINDS[r.kind];
  if (r.action === 'browse') {
    const result = await browseDocuments(db);
    await adminOnly(db, auth);
    return result;
  }
  if (r.action === 'options') {
    const [snap, bikers, advances] = await Promise.all([db.collection(spec.parent || spec.category).limit(101).get(),
      db.collection('bikers').get(), db.collection('temporary_expenses').get()]);
    // «من عهدة شخص» / «دفع موظف»: every employee, with what is still open on his custody (posted documents already settled theirs).
    const open = advances.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const custodyHolders = bikers.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.data().name_ar || doc.id,
      left: Boolean(doc.data().end_date), outstanding: employeeCustody(open, doc.id).outstanding }))
      .sort((a, b) => (b.outstanding - a.outstanding) || a.name.localeCompare(b.name, 'ar'));
    return { items: snap.docs.slice(0, 100).map(doc => ({ id: doc.id,
      label: doc.data().label || doc.data().name || doc.data().item_name || doc.data().expense_name || doc.data().title || doc.data().description || 'تصنيف بدون اسم' })),
    limited: snap.size > 100, parent: Boolean(spec.parent), custodyHolders };
  }
  if (r.action === 'list') {
    let query = db.collection(spec.collection).orderBy('__name__');
    if (r.after) query = query.startAfter(r.after);
    const snap = await query.limit(31).get();
    return { kind: r.kind, items: snap.docs.slice(0, 30).map(doc => ({ sourceId: doc.id, title: doc.data()[spec.title] || 'بلا عنوان',
      registration: { status: 'recorded', label: 'مسجل بالفعل' },
      amount: doc.data()[spec.amount] ?? null, date: doc.data()[spec.date] ?? null,
      review: doc.data().approval_status || 'unreviewed', paymentStatus: doc.data().payment_status || 'unknown' })),
    nextAfter: snap.size > 30 ? snap.docs[29].id : null, coverage: 'قائمة محدودة إلى 30 سجلًا؛ ليست إجمالي الذمم أو المؤهل.' };
  }
  const sourceId = r.sourceId || `finance_${financeHash({ uid: auth.uid, kind: r.kind, requestId: r.requestId }).slice(0, 40)}`;
  if (r.action === 'post') {
    const before = await financeWorkbench(db, auth, { action: 'read', kind: r.kind, sourceId });
    if (before.sourceHash !== r.sourceHash || !before.approved || !before.postingPreview.ready || before.protectedSource || before.closed) fail('تغيرت النسخة أو لم تكتمل أهلية الترحيل.');
    const result = await postSource(db, FieldValue, { kind: r.kind, sourceId }, { userId: auth.uid,
      expectedFinanceSourceHash: r.sourceHash, financeAuthorizer: tx => adminOnly(authTx(db, tx), auth), postingDate: before.postingDate || null });
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
    if (receipt.exists && ['save', 'capture', 'approve', 'complete'].includes(r.action)) {
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
    if (r.action === 'read') return workflowDocument(db, tx, r.kind, sourceId, before, state);
    if (['previewCompletion', 'complete'].includes(r.action)) return completePosted(db, tx, auth, r, { sourceRef, before, state, receiptRef, requestHash });
    if (state.protectedSource) fail('مصدر له قيد أو قفل أو تاريخ ترحيل؛ التصحيح وإعادة الاعتماد مرفوضان.');
    if (state.closed) fail('الفترة مقفلة.');
    if (!isCapture && state.sourceHash !== r.sourceHash) fail('تغير السجل؛ أعد القراءة والمعاينة.');
    const after = r.action === 'approve' ? before : applyPatch(r.kind, before, r.patch);
    if (isCapture && (after.finance_metadata?.quantityException || after.finance_metadata?.documentAllocation)) fail('هذه الأدلة تخص سجلات قائمة؛ لا تستخدم لإنشاء مصروف جديد.');
    if (isCapture && (!after[spec.title] || !after[spec.date] || !after[spec.amount]
      || (!after.quantity && !after.finance_metadata?.invoiceLines))) fail('التسجيل يحتاج وصفًا وتاريخًا ومبلغًا وكمية أو بنودًا مثبتة.');
    // A statement line is unique by itself (one line, one record — checked in
    // assertFinanceDocumentUniqueness), so it stands in for the document link.
    if (isCapture && !after.invoice_url && !after.finance_metadata?.statementLineRef && !after.finance_metadata?.managerAttestation) fail('رابط المستند مطلوب لمنع التكرار.');
    // A manager's attestation is the saver's own, never written in another's name.
    const attestation = after.finance_metadata?.managerAttestation;
    if (attestation && JSON.stringify(attestation) !== JSON.stringify(before.finance_metadata?.managerAttestation ?? null)) {
      if (attestation.by !== auth.uid) fail('إقرار المدير يُسجّل باسم من يحفظه فقط.', 'permission-denied');
      const attestedDay = documentDay(after[spec.date]), cutoff = await foundingCutoffOf(db, tx);
      if (!attestedDay || attestedDay >= cutoff) fail(`إقرار المدير لمستندات فترة التأسيس فقط (قبل ${cutoff}).`, 'invalid-argument');
    }
    // «من عهدة شخص» / «دفع موظف»: an employee from the registry, named by the server.
    const custodyBiker = r.action === 'approve' ? null : after.finance_metadata?.custodyBikerId;
    if (custodyBiker) {
      if (!['custody', 'employee'].includes(after.finance_metadata.fundingType)) fail('صاحب العهدة يُحدد مع «من عهدة شخص» أو «دفع موظف» فقط.', 'invalid-argument');
      const biker = await tx.get(db.collection('bikers').doc(custodyBiker));
      if (!biker.exists) fail('الموظف غير موجود في قائمة البايكرز.', 'not-found');
      after.finance_metadata = { ...after.finance_metadata, custodian: biker.data().name || biker.data().name_ar || custodyBiker };
    }
    // A same-record edit never relocates or deletes a source, nor moves a
    // booked date to an open month to evade the original period lock.
    const afterState = await readState(db, tx, r.kind, sourceId, after);
    if (afterState.closed) fail('أحد تواريخ المصدر أو الفاتورة أو السداد مقفل.');
    if (state.postingDate && !afterState.postingDate) fail('مستند فترة التأسيس في شهر مقفل يبقى بتاريخه؛ لا يُنقل إلى شهر مفتوح.');
    // Existing founding documents only: a new record is not written into a closed month.
    if (isCapture && afterState.postingDate) fail('شهر المستند مقفل: لا يُسجّل فيه مستند جديد.');
    if (before[spec.fk] && r.patch?.parentId && r.patch.parentId !== before[spec.fk]) fail('نقل البند الأب ليس تصحيحًا لنفس السجل في هذا المسار.');
    const parent = await validateClassification(db, tx, r.kind, after);
    const sourceContext = await checkDuplicate(db, tx, r.kind, sourceId, after, { allowIncompleteAllocation: r.action !== 'approve' });
    const preview = await postingPreview(db, tx, r.kind, sourceId, after, sourceContext);
    const previewHash = financeHash({ kind: r.kind, sourceId, before, after, parent: parent ? { value: parent.raw, rows: parent.rows } : null,
      ...(sourceContext.contextHash ? { sourceContextHash: sourceContext.contextHash } : {}) });
    if (['preview', 'previewCapture'].includes(r.action)) return { kind: r.kind, sourceId, sourceHash: state.sourceHash, previewHash, before, after,
      issues: preview.issues, postingPreview: preview, sourceContext, financialPosting: false };
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
      postingHash: r.action === 'approve' ? preview.postingHash : null, sourceContextHash: sourceContext.contextHash,
      reviewedByUid: auth.uid, reviewedAt: FieldValue.serverTimestamp(), reason: r.reason,
      evidenceRefs: after.finance_metadata?.evidenceRefs || [], verificationKind: 'self' });
    tx.set(auditRef, { action: `finance-${r.action}`, userId: auth.uid, kind: r.kind, sourceId, before, after,
      reason: r.reason, sourceHash: financeSourceHash(after),
      sourceEvidence: { quantityDecision: after.finance_metadata?.quantityException ? sourceContext.quantityGrant : null,
        originalAllocation: after.finance_metadata?.documentAllocation ? sourceContext.allocationGrant : null,
        reviewedPartialVat: sourceContext.partialVatGrant || null,
        reviewedDocumentIdentity: sourceContext.verifiedIdentity || null,
        printedDiscount: sourceContext.printedDiscountGrant || null }, at: FieldValue.serverTimestamp() });
    const result = { saved: true, action: r.action, kind: r.kind, sourceId, sourceHash: financeSourceHash(after), auditId: auditRef.id,
      approved: r.action === 'approve', financialPosting: false };
    tx.set(receiptRef, { requestHash, result, at: FieldValue.serverTimestamp(), userId: auth.uid });
    return result;
  });
}
