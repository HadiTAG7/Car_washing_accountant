import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { callerRole } from '../functions/src/handlers.js';
import { financeHash, financeSourceHash, FINANCE_KINDS, FinanceReviewError } from '../functions/src/financeReview.js';
import { normalizeEntry, normalizeLines, validateEntry, totalsOf, journalCounterUpdate } from '../functions/src/invariants.js';
import { custodyHistoricalPlan, custodyReconciliationPreviewSchema } from './custodyHistoricalReconciliation.js';
import { periodKeyFor } from '../src/lib/accounting/vatReturn.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.string().trim().min(3).max(500);
const schema = custodyReconciliationPreviewSchema.omit({ action: true }).extend({
  action: z.literal('save'), previewHash: hash, ownerApprovalRef: ref,
  evidenceReviewRef: ref, ledgerReviewRef: ref,
  reviewedUnrelatedJournalIds: z.array(z.string().min(1).max(160)).max(1000),
  priorClaims: z.array(z.object({ kind: z.enum(['variable', 'monthly', 'annual', 'startup']),
    sourceId: z.string().min(1).max(160), submittedPeriod: z.string().regex(/^\d{4}-Q[1-4]$/),
    sourceTaxReviewRef: ref, evidenceRef: ref }).strict()).max(100).default([]),
  reason: ref, confirm: z.literal(true),
}).strict();
const fail = (message, code = 'failed-precondition') => { throw new FinanceReviewError(message, code); };
const authDb = (db, tx) => ({ collection: name => ({ doc: id => ({ get: () => tx.get(db.collection(name).doc(id)) }) }) });
const collectionOf = kind => FINANCE_KINDS[kind].collection;
const cents = amount => Math.round(Number(amount) * 100);
export function custodySettlementManifestHash(input) {
  const r = schema.parse(input);
  return financeHash(Object.fromEntries(Object.entries(r).filter(([key]) =>
    !['action', 'previewHash', 'confirm', 'reason'].includes(key))));
}

// The save route is intentionally disabled in production until an exact
// reviewed manifest is approved. Tests opt in against disposable databases.
export async function saveCustodyHistoricalSettlement(db, auth, input) {
  if (process.env.ENABLE_CUSTODY_HISTORICAL_SETTLEMENT !== '1') fail('حفظ التسوية التاريخية غير مفعل لهذا المصدر.', 'permission-denied');
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail('طلب حفظ التسوية التاريخية غير صالح.', 'invalid-argument');
  const r = parsed.data;
  if (process.env.CUSTODY_HISTORICAL_APPROVED_MANIFEST_HASH !== custodySettlementManifestHash(r))
    fail('بيان التسوية المحدد لم يُعتمد في إعدادات الخادم.', 'permission-denied');
  const core = Object.fromEntries(Object.entries(r).filter(([key]) => custodyReconciliationPreviewSchema.shape[key]));
  core.action = 'preview';
  const groupId = financeHash({ advanceId: r.advanceId, allocations: r.allocations });
  const receiptRef = db.collection('finance_workbench_receipts').doc(`custody_h_${groupId.slice(0, 40)}`);
  const requestHash = financeHash(r);
  return db.runTransaction(async tx => {
    if (await callerRole(authDb(db, tx), auth) !== 'admin') fail('التسوية التاريخية للإدارة فقط.', 'permission-denied');
    const prior = await tx.get(receiptRef);
    if (prior.exists) {
      if (prior.data().requestHash !== requestHash) fail('إيصال التسوية محفوظ بطلب مختلف؛ لا يُعاد الحفظ.', 'already-exists');
      const { result, sourceHashes } = prior.data();
      const entries = await Promise.all(result.journalIds.map(id => tx.get(db.collection('journal_entries').doc(id))));
      const [advance, groupLock] = await Promise.all([
        tx.get(db.collection('temporary_expenses').doc(result.advanceId)),
        tx.get(db.collection('posting_locks').doc(`custody_reconciliation__${groupId}`)),
      ]);
      if (!advance.exists || advance.data().custody_historical_partial_hold !== true || !groupLock.exists
        || !Array.isArray(sourceHashes) || sourceHashes.length !== result.sourceCount
        || entries.length !== result.sourceCount + 1
        || entries.some(snap => !snap.exists || snap.data().status !== 'posted'
          || snap.data().custodyHistoricalSettlementId !== groupId))
        fail('إيصال التسوية لا يطابق قيودها؛ يلزم فحصه.');
      for (const item of sourceHashes) {
        const [kind, ...idParts] = item.key.split(':');
        const sourceId = idParts.join(':');
        if (!FINANCE_KINDS[kind]) fail('إيصال التسوية يحمل نوع مصدر غير معروف.');
        const [source, lock] = await Promise.all([
          tx.get(db.collection(collectionOf(kind)).doc(sourceId)),
          tx.get(db.collection('posting_locks').doc(`${kind}__${sourceId}`)),
        ]);
        if (!source.exists || financeSourceHash(source.data()) !== item.after || !lock.exists
          || lock.data().custodyHistoricalSettlementId !== groupId
          || !entries.some(entry => entry.id === lock.data().entryId
            && entry.data().sourceSnapshotHash === item.before))
          fail('إيصال التسوية لا يطابق المصدر أو قفله؛ يلزم فحصه.');
      }
      const netAdvance = entries.reduce((sum, entry) => sum + (entry.data().lines || [])
        .filter(line => String(line.accountId) === '1300')
        .reduce((n, line) => n + cents(line.debit || 0) - cents(line.credit || 0), 0), 0);
      if (netAdvance !== 0 || result.fundedHalala !== result.consumedHalala)
        fail('إيصال التسوية لا يطابق رصيد العهدة الصفري.');
      return { ...result, replay: true };
    }
    const plan = await custodyHistoricalPlan(db, tx, core);
    if (plan.snapshotHash !== r.previewHash) fail('تغيرت مصادر التسوية أو دفترها أو الحسابات بعد المعاينة.');
    if (plan.blockingIssues.length || plan.proposedExpenseEntries.length !== r.allocations.length)
      fail(plan.blockingIssues.join(' ') || 'خطة قيد المستندات غير مكتملة.');
    const priorClaims = new Map(r.priorClaims.map(claim => [`${claim.kind}:${claim.sourceId}`, claim]));
    if (priorClaims.size !== r.priorClaims.length) fail('مرجع مطالبة ضريبية تاريخية مكرر.');
    for (const item of plan.proposedExpenseEntries) {
      const claim = priorClaims.get(item.key);
      if (item.vatHalala === 0 && claim) fail('مرجع مطالبة سابقة لمصدر دون مدخلات مؤهلة.');
      if (item.vatHalala > 0 && (!claim || !item.taxReviewRef
        || claim.sourceTaxReviewRef !== item.taxReviewRef
        || claim.submittedPeriod !== periodKeyFor(item.originalInvoiceDate)))
        fail('مدخلات ضريبة تاريخية تحتاج مرجع مطالبة مقدمة مطابقًا لفترة الفاتورة ورأيها.');
    }
    if (priorClaims.size !== plan.proposedExpenseEntries.filter(item => item.vatHalala > 0).length)
      fail('مراجع المطالبة السابقة لا تطابق المستندات المخصصة.');
    const reviewed = [...r.reviewedUnrelatedJournalIds].sort();
    if (new Set(reviewed).size !== reviewed.length
      || financeHash(reviewed) !== financeHash(plan.unassignedAdvanceMovementIds))
      fail('حركات حساب العهدة غير المرتبطة لم تُراجع كاملةً؛ لا يُضاف تمويل مكرر.');
    const globalLock = db.collection('posting_locks').doc(`custody_reconciliation__${groupId}`);
    const evidenceLocks = [...new Set(r.evidenceRefs)].map(value => db.collection('posting_locks').doc(`custody_evidence__${financeHash(value).slice(0, 40)}`));
    const fundingLock = db.collection('posting_locks').doc(`temporary_expense__${r.advanceId}`);
    const [globalSnap, fundingSnap, ...evidenceSnaps] = await Promise.all([
      tx.get(globalLock), tx.get(fundingLock), ...evidenceLocks.map(lock => tx.get(lock)),
    ]);
    if (globalSnap.exists || evidenceSnaps.some(snap => snap.exists)) fail('الشريحة أو دليل الإيداع مرتبط بتسوية سابقة.');
    if (fundingSnap.exists && (!plan.existingFundingJournalId
      || fundingSnap.data().entryId !== plan.existingFundingJournalId))
      fail('سجل العهدة له قفل تمويل سابق مختلف؛ افحصه قبل تصحيح جديد.');
    if (plan.existingFundingJournalId && !fundingSnap.exists)
      fail('قيد التمويل التاريخي بلا قفل مصدر موثوق؛ يلزم مراجعته قبل استخدامه.');
    const sources = await Promise.all(plan.proposedExpenseEntries.map(async item => {
      const [kind, ...idParts] = item.key.split(':');
      const sourceId = idParts.join(':');
      const sourceRef = db.collection(collectionOf(kind)).doc(sourceId);
      const source = await tx.get(sourceRef);
      if (!source.exists || financeSourceHash(source.data()) !== item.sourceHash) fail('تغير المصدر داخل التسوية.');
      const after = { ...source.data(), finance_metadata: { ...(source.data().finance_metadata || {}),
        custodyHistoricalSettlementId: groupId } };
      return { ref: sourceRef, item, afterHash: financeSourceHash(after), metadata: after.finance_metadata };
    }));
    const chart = await tx.get(db.collection('chart_of_accounts'));
    const knownAccountCodes = new Set(chart.docs.map(doc => doc.id));
    const counterRef = db.collection('counters').doc('journal'), counter = await tx.get(counterRef);
    const next = counter.data().nextNumber;
    const fundingId = plan.existingFundingJournalId || `custody_h_${groupId.slice(0, 40)}_fund`;
    const journalIds = plan.existingFundingJournalId ? [fundingId] : [];
    const journalData = [];
    if (!plan.existingFundingJournalId) {
      const entry = normalizeEntry({ entryDate: r.correctionDate, sourceType: 'adjustment',
        sourceId: r.advanceId, description: 'تسوية تمويل عهدة تاريخية مخصصة بالكامل' });
      const lines = normalizeLines([
        { accountId: '1300', debit: r.amount, credit: 0, description: 'تمويل عهدة تاريخي مخصص' },
        { accountId: '1020', debit: 0, credit: r.amount, description: 'تمويل من بنك الشركة' },
      ]);
      const issues = validateEntry(entry, lines, { knownAccountCodes });
      if (issues.length) fail(issues.join(' '));
      const totals = totalsOf(lines);
      journalData.push({ id: fundingId, entry: { ...entry, lines, lineCount: lines.length,
        totalDebit: totals.debit, totalCredit: totals.credit, entryNumber: next,
        sourceKind: 'custody_reconciliation', custodyHistoricalSettlementId: groupId,
        historicalFundingDate: r.historicalFundingDate, ownerStatementRef: r.ownerStatementRef,
        evidenceRefs: r.evidenceRefs, evidenceReviewRef: r.evidenceReviewRef,
        ledgerReviewRef: r.ledgerReviewRef, ownerApprovalRef: r.ownerApprovalRef,
        createdBy: auth.uid, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp() } });
      journalIds.push(fundingId);
    }
    let number = next + (plan.existingFundingJournalId ? 0 : 1);
    for (const item of plan.proposedExpenseEntries) {
      const [kind, ...idParts] = item.key.split(':');
      const sourceId = idParts.join(':');
      const id = `custody_h_${groupId.slice(0, 40)}_${journalData.length}`;
      const entry = normalizeEntry({ entryDate: r.correctionDate, sourceType: 'expense', sourceId,
        description: 'تسوية مصروف من عهدة تاريخية' });
      const lines = normalizeLines(item.lines);
      const issues = validateEntry(entry, lines, { knownAccountCodes });
      if (issues.length) fail(issues.join(' '));
      const totals = totalsOf(lines);
      const claim = priorClaims.get(item.key);
      journalData.push({ id, entry: { ...entry, lines, lineCount: lines.length,
        totalDebit: totals.debit, totalCredit: totals.credit, entryNumber: number++, sourceKind: kind,
        purchaseTaxSnapshot: claim ? { ...item.purchaseTaxSnapshot,
          claimDisposition: 'previously_claimed', submittedPeriod: claim.submittedPeriod,
          priorClaimEvidenceRef: claim.evidenceRef } : item.purchaseTaxSnapshot,
        custodyHistoricalSettlementId: groupId,
        originalInvoiceDate: item.originalInvoiceDate, originalPaidDate: item.originalPaidDate,
        fundingJournalId: fundingId, sourceSnapshotHash: item.sourceHash,
        createdBy: auth.uid, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp() } });
      journalIds.push(id);
    }
    const consumed = plan.proposedExpenseEntries.reduce((sum, item) => sum + cents(item.lines
      .filter(line => String(line.accountId) === '1300').reduce((n, line) => n + Number(line.credit || 0) - Number(line.debit || 0), 0)), 0);
    if (consumed !== cents(r.amount)) fail('استهلاك الشريحة لا يساوي تمويلها؛ لا يُفتح رصيد حر.');
    const lockData = { kind: 'custody_reconciliation', sourceId: groupId,
      entryId: fundingId, lockedBy: auth.uid, lockedAt: FieldValue.serverTimestamp() };
    for (const journal of journalData) tx.create(db.collection('journal_entries').doc(journal.id), journal.entry);
    if (plan.existingFundingJournalId) tx.update(db.collection('journal_entries').doc(fundingId), {
      custodyHistoricalSettlementId: groupId, custodyHistoricalFundingReused: true });
    tx.create(globalLock, lockData);
    for (const evidenceLock of evidenceLocks) tx.create(evidenceLock, lockData);
    if (!plan.existingFundingJournalId) tx.create(fundingLock, lockData);
    for (const [index, source] of sources.entries()) {
      const [kind, ...idParts] = source.item.key.split(':');
      const sourceId = idParts.join(':');
      tx.update(source.ref, { finance_metadata: source.metadata });
      tx.create(db.collection('posting_locks').doc(`${kind}__${sourceId}`), {
        kind, sourceType: 'expense', sourceId, entryId: journalData[plan.existingFundingJournalId ? index : index + 1].id,
        entryNumber: journalData[plan.existingFundingJournalId ? index : index + 1].entry.entryNumber,
        lockedBy: auth.uid, lockedAt: FieldValue.serverTimestamp(), custodyHistoricalSettlementId: groupId,
      });
    }
    tx.update(db.collection('temporary_expenses').doc(r.advanceId), { custody_historical_partial_hold: true });
    tx.set(counterRef, journalCounterUpdate(counter, number - 1, r.correctionDate, FieldValue), { merge: true });
    const result = { saved: true, financialPosting: true, groupId, advanceId: r.advanceId,
      sourceHash: plan.snapshotHash,
      journalIds, fundingJournalId: fundingId, sourceCount: r.allocations.length,
      fundedHalala: cents(r.amount), consumedHalala: consumed, freeAdvanceBalanceHalala: 0,
      entryDate: r.correctionDate, historicalFundingDate: r.historicalFundingDate };
    tx.create(receiptRef, { requestHash, result, ownerStatementRef: r.ownerStatementRef,
      ownerApprovalRef: r.ownerApprovalRef, evidenceReviewRef: r.evidenceReviewRef,
      ledgerReviewRef: r.ledgerReviewRef, reviewedUnrelatedJournalIds: reviewed,
      sourceHashes: sources.map(source => ({ key: source.item.key, before: source.item.sourceHash,
        after: source.afterHash, sourceContextHash: source.item.sourceContextHash })),
      priorClaims: r.priorClaims,
      at: FieldValue.serverTimestamp(), userId: auth.uid });
    tx.create(db.collection('audit_logs').doc(), { action: 'custody-historical-settlement',
      collectionName: 'journal_entries', documentId: fundingId, userId: auth.uid,
      sourceHash: plan.snapshotHash, reason: r.reason, groupId, result, at: FieldValue.serverTimestamp() });
    return result;
  });
}
