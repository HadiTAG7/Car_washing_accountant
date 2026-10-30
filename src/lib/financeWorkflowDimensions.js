// Read/display projection only. Never use these labels or categories to allow
// save, approval, posting, payment or VAT. Existing server gates remain primary.
export const FINANCE_BLOCKER_LABELS = {
  source: 'بيانات المصدر', funding: 'التمويل والحساب المقابل', payment: 'إثبات السداد', tax: 'البوابة الضريبية',
  policy: 'السياسة التاريخية والحسابات', allocation: 'ربط الأصل ومنع التكرار', review: 'المراجعة والربط',
};
export function financeBlockerCategory(message) {
  if (/التمويل|الحساب المقابل|ذمة المورد|الموظف الذي دفع|صاحب العهدة/.test(message)) return 'funding';
  if (/السداد|طريقة الدفع/.test(message)) return 'payment';
  if (/السياسة التاريخية|حسابات القيد|معاينة الحسابات/.test(message)) return 'policy';
  if (/الضريب|المدخلات/.test(message)) return 'tax';
  if (/التكرار|مصروف آخر|توزيع الأصل|توزيع مراجع|هوية.*المستند|سجلي التوزيع|جزأي الأصل|ربط التوزيع/.test(message)) return 'allocation';
  if (/وصف المصروف|المبلغ غير مثبت|تاريخ المصروف|الكمية|سعر الوحدة|بنود الفاتورة|بند الفاتورة|المورد غير|رابط المستند|الغرض ودليل/.test(message)) return 'source';
  return 'review';
}
export const PAYMENT_PROOF_LABELS = Object.freeze({ evidence: 'مثبت بكشف أو إيصال', founding_rule: 'مثبت بإقرار المدير — قاعدة فترة التأسيس' });
export function financeWorkflowDimensions(detail, { recorded = false } = {}) {
  const row = detail.row || {}, review = detail.review;
  const reviewSaved = Boolean(review), comparable = typeof detail.sourceHash === 'string' && detail.sourceHash.length > 0 && typeof review?.sourceHash === 'string';
  const matchesSource = reviewSaved && comparable && review.sourceHash === detail.sourceHash;
  const contextMatches = reviewSaved && detail.sourceContext && Object.hasOwn(detail.sourceContext, 'contextHash')
    ? (review.sourceContextHash || null) === (detail.sourceContext.contextHash || null) : null;
  const revision = Number.isSafeInteger(row.finance_revision) && row.finance_revision > 0 ? row.finance_revision : null;
  const detailsSaved = Boolean(revision || reviewSaved);
  const blockers = [...new Set(detail.issues || [])].map(text => ({ category: financeBlockerCategory(text), text }));
  // Settled by the founding-period rule: listed apart, never counted as blockers.
  const ruleResolved = [...new Set(detail.resolvedByRule || [])].map(text => ({ category: financeBlockerCategory(text), text }));
  const sourceGaps = blockers.filter(item => item.category === 'source');
  const active = Array.isArray(detail.postingHistory?.active) ? detail.postingHistory.active.length : 0;
  const reversed = Array.isArray(detail.postingHistory?.reversed) ? detail.postingHistory.reversed.length : 0;
  const reviewStatus = !reviewSaved ? 'not_saved' : !comparable ? 'saved_unknown' : !matchesSource ? 'saved_stale' : review.status === 'pending' ? 'saved_pending'
    : review.status === 'approved' ? 'saved_approved' : 'saved_unknown';
  const reviewLabel = { not_saved: 'لا توجد مراجعة محفوظة', saved_stale: 'مراجعة محفوظة لنسخة سابقة',
    saved_pending: 'مراجعة محفوظة — معلّقة', saved_approved: 'مراجعة محفوظة — الاعتماد موضح منفصلًا', saved_unknown: 'مراجعة محفوظة — حالتها تحتاج تحققًا' }[reviewStatus];
  return {
    registration: { status: recorded ? 'recorded' : 'draft', label: recorded ? 'مسجل بالفعل' : 'لم يُسجل بعد' },
    details: { saved: detailsSaved, revision, sourceGapCount: sourceGaps.length,
      label: detailsSaved ? sourceGaps.length ? 'تفاصيل محفوظة — بها نواقص مصدر' : 'تفاصيل محفوظة' : 'مصدر مسجل — دون نسخة مراجعة محفوظة' },
    review: { recordSaved: reviewSaved, status: reviewStatus, matchesSource, verificationKind: review?.verificationKind || null, label: reviewLabel },
    approval: { current: Boolean(detail.approved), contextMatches, label: detail.approved ? 'اعتماد النسخة الحالية'
      : detail.approvalContextChanged ? 'اعتماد سابق — تغيّر سياق المستند'
      : detail.approvalBeforeCompletion ? 'اعتُمد قبل الترحيل — استُكملت بعده حقول غير مالية'
      : row.approval_status === 'approved' || review?.status === 'approved' ? 'اعتماد سابق يحتاج مراجعة' : 'غير معتمد' },
    posting: { status: active ? 'posted' : reversed ? 'reversed' : detail.protectedSource ? 'protected' : 'unposted',
      label: active ? 'مرحل بقيد سارٍ' : reversed ? 'قيده معكوس — المصدر ما زال مسجلًا' : detail.protectedSource ? 'محمي وله أثر يحتاج مراجعة' : 'غير مرحل',
      ready: Boolean(detail.postingReady) },
    // Proven by a statement or a receipt, or — a founding-period record Hadi paid, posted on 2300 — by the manager's rule.
    payment: { proven: Boolean(detail.paymentProven), basis: detail.paymentProven ? detail.paymentProof || 'evidence' : null, rule: detail.paymentRule || null,
      ruleEntry: detail.paymentRuleEntry ?? null,
      recordedStatus: row.payment_status || 'unknown', method: row.payment_method || null, paidDate: row.paid_date || null,
      label: detail.paymentProof === 'founding_rule' ? PAYMENT_PROOF_LABELS.founding_rule : detail.paymentProven ? PAYMENT_PROOF_LABELS.evidence
        : row.payment_status === 'paid' ? 'مسجل مدفوع — تحقق المسار غير مكتمل'
        : row.payment_status === 'unpaid' ? 'مسجل غير مسدد' : 'حالة السداد غير مثبتة' },
    sourceGaps, postingBlockers: blockers, ruleResolved,
    sourceFacts: { invoiceNumber: typeof row.invoice_number === 'string' || Number.isFinite(row.invoice_number) ? row.invoice_number : null,
      isTaxInvoice: typeof row.is_tax_invoice === 'boolean' ? row.is_tax_invoice : null,
      vatDeductible: typeof row.vat_deductible === 'boolean' ? row.vat_deductible : null,
      taxReviewRef: typeof row.finance_metadata?.taxReviewRef === 'string' ? row.finance_metadata.taxReviewRef : null },
    constraints: { closed: Boolean(detail.closed), protectedSource: Boolean(detail.protectedSource) },
    compatibilityStage: detail.workflowStage,
  };
}
