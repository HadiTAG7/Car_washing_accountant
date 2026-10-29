import { z } from 'zod';
import { financeHash, FinanceReviewError } from '../functions/src/financeReview.js';
import { isRealDate } from '../functions/src/invariants.js';

const identifier = z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u);
const day = z.string().refine(isRealDate);
const money = z.number().finite().positive().max(1e9).refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6);
const request = z.object({ action: z.literal('preview'), kind: z.literal('custody_reconciliation'),
  advanceId: identifier, employeeId: identifier, amount: money,
  historicalFundingDate: day.nullable(), correctionDate: day,
  ownerStatementRef: z.string().trim().min(3).max(500),
  evidenceRefs: z.array(z.string().trim().min(3).max(500)).max(30),
  allocations: z.array(z.object({ kind: z.enum(['variable', 'monthly', 'annual', 'startup']),
    sourceId: identifier, amount: money }).strict()).min(1).max(100),
}).strict();

const collectionOf = { variable: 'variable_expenses', monthly: 'monthly_expenses',
  annual: 'annual_expense_entries', startup: 'startup_cost_entries' };
const halala = n => Math.round(Number(n) * 100);
const linesOf = journal => Array.isArray(journal.lines) ? journal.lines : [];

// This endpoint is deliberately read-only. A current-dated correction cannot
// prove an earlier cash transfer merely because the owner remembers it.
export async function previewCustodyHistoricalReconciliation(db, input) {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new FinanceReviewError('طلب معاينة مطابقة العهدة غير صالح.', 'invalid-argument');
  const r = parsed.data;
  return db.runTransaction(async tx => {
    const problems = [];
    const [advanceSnap, related, accountAdvance, accountBank, ledger, legacyLines, period] = await Promise.all([
      tx.get(db.collection('temporary_expenses').doc(r.advanceId)),
      tx.get(db.collection('journal_entries').where('sourceId', '==', r.advanceId).limit(101)),
      tx.get(db.collection('chart_of_accounts').doc('1300')),
      tx.get(db.collection('chart_of_accounts').doc('1020')),
      tx.get(db.collection('journal_entries').limit(1001)),
      tx.get(db.collection('journal_lines').limit(1001)),
      tx.get(db.collection('accounting_periods').doc(r.correctionDate.slice(0, 7))),
    ]);
    const advance = advanceSnap.exists ? advanceSnap.data() : null;
    if (!advance) problems.push('سجل العهدة غير موجود؛ لا يمكن اقتراح ربط دفتر.');
    else {
      if (String(advance.biker_id || '') !== r.employeeId) problems.push('الموظف لا يطابق سجل العهدة.');
      if (halala(advance.amount) < halala(r.amount)) problems.push('مبلغ الشريحة المقترحة يتجاوز سجل العهدة.');
      if (advance.custody_balance_opened_journal_id != null || advance.custody_expense_used_halala != null)
        problems.push('العهدة لها رصيد مشترك مفتوح أو سجل استهلاك؛ يلزم فحصه قبل تسوية تاريخية.');
      if (Number(advance.recovered_amount || 0) !== 0 || advance.payroll_lock_id || advance.status === 'recovered')
        problems.push('يوجد استرداد أو خصم راتب يحتاج مطابقة قبل فتح الرصيد.');
    }
    if (related.size > 100) problems.push('حركات العهدة أكثر من حد المعاينة؛ يلزم فحصها يدويًا.');
    const existing = related.docs.filter(d => d.data().status === 'posted' && !d.data().reversedBy);
    if (existing.length) problems.push('توجد قيود مرحّلة مرتبطة بالعهدة؛ افحصها لمنع تكرار التمويل.');
    if (ledger.size > 1000 || legacyLines.size > 1000) problems.push('حركات الدفتر أكثر من حد المعاينة؛ يلزم استخراج كامل للمطابقة.');
    const separateLines = new Map();
    for (const doc of legacyLines.docs) {
      const entryId = doc.data().entryId;
      if (!separateLines.has(entryId)) separateLines.set(entryId, []);
      separateLines.get(entryId).push(doc.data());
    }
    const unassigned1300 = ledger.docs.filter(doc => {
      const entry = doc.data();
      if (entry.status !== 'posted' || entry.reversedBy || entry.sourceId === r.advanceId) return false;
      const lines = linesOf(entry).length ? linesOf(entry) : (separateLines.get(doc.id) || []);
      return lines.some(line => String(line.accountId) === '1300' && Number(line.debit || 0) > 0);
    }).length;
    if (unassigned1300) problems.push('توجد حركات مدينة على حساب العهدة بلا ربط مثبت بهذا السجل؛ افحصها قبل اقتراح تمويل جديد.');
    if (!accountAdvance.exists || !accountBank.exists || accountAdvance.data().active === false || accountBank.data().active === false)
      problems.push('حساب العهدة أو البنك غير متاح في الدليل.');
    if (accountAdvance.exists && accountAdvance.data().accountType !== 'asset'
      || accountBank.exists && accountBank.data().accountType !== 'asset')
      problems.push('نوع حساب العهدة أو البنك لا يطابق أصلًا ماليًا.');
    if (!period.exists || period.data().status !== 'open')
      problems.push('فترة القيد التصحيحي غير مثبتة مفتوحة؛ لا تُفتح تلقائيًا.');
    if (r.historicalFundingDate == null) problems.push('تاريخ تسليم التمويل الفعلي غير مثبت.');
    if (r.historicalFundingDate && r.historicalFundingDate > r.correctionDate)
      problems.push('تاريخ التمويل الفعلي يأتي بعد تاريخ التصحيح.');
    if (!r.evidenceRefs.length) problems.push('مراجع مستندات التمويل التاريخي غير محددة؛ إفادة المالك وحدها ليست مطابقة دفترية.');
    else problems.push('مراجع الأدلة مقدمة للفحص ولم تُطابق بعد مع تحويل البنك وتسليم العهدة.');
    if (r.correctionDate > new Date().toISOString().slice(0, 10)) problems.push('تاريخ القيد المقترح مستقبلي.');
    const keys = new Set(), records = [];
    for (const allocation of r.allocations) {
      const key = `${allocation.kind}:${allocation.sourceId}`;
      if (keys.has(key)) problems.push('المصدر مكرر في قائمة التخصيصات.');
      keys.add(key);
      const [snap, lock] = await Promise.all([
        tx.get(db.collection(collectionOf[allocation.kind]).doc(allocation.sourceId)),
        tx.get(db.collection('posting_locks').doc(`${allocation.kind}__${allocation.sourceId}`)),
      ]);
      const row = snap.exists ? snap.data() : null;
      if (lock.exists) problems.push('المستند له قيد ترحيل سابق؛ يلزم فحصه قبل تخصيص العهدة.');
      if (!row) problems.push('مستند تخصيص غير موجود.');
      else {
        if (row.finance_metadata?.fundingType !== 'employee') problems.push('مصدر التخصيص غير مصنف تمويل موظف.');
        if (row.payment_status !== 'paid' || !isRealDate(row.paid_date)) problems.push('سداد مستند التخصيص غير مثبت بتاريخ صالح.');
        if (r.historicalFundingDate && row.paid_date < r.historicalFundingDate)
          problems.push('تاريخ التمويل الفعلي يأتي بعد دفع مستند مخصص.');
        if (row.finance_metadata?.employeeAdvanceLink)
          problems.push('المستند مرتبط بعهدة مسبقًا؛ يلزم فحص الربط قبل تسوية تاريخية.');
        if (halala(row.amount) !== halala(allocation.amount)) problems.push('مبلغ التخصيص لا يطابق إجمالي المستند.');
      }
      records.push({ key, amountHalala: halala(allocation.amount), sourceHash: financeHash(row) });
    }
    const allocatedHalala = r.allocations.reduce((sum, a) => sum + halala(a.amount), 0);
    if (allocatedHalala !== halala(r.amount))
      problems.push('مبلغ الشريحة المقترحة يجب أن يساوي التخصيصات بالضبط؛ لا يُفتح رصيد غير مخصص.');
    const historicalLedgerProof = existing.some(d => d.data().sourceType === 'temporary_expense'
      && d.data().entryDate <= r.historicalFundingDate
      && (linesOf(d.data()).length ? linesOf(d.data()) : (separateLines.get(d.id) || []))
        .some(l => String(l.accountId) === '1300' && halala(l.debit) >= halala(r.amount))
      && (linesOf(d.data()).length ? linesOf(d.data()) : (separateLines.get(d.id) || []))
        .some(l => String(l.accountId) === '1020' && halala(l.credit) >= halala(r.amount)));
    if (!historicalLedgerProof) problems.push('لا يوجد قيد تمويل تاريخي مطابق؛ القيد الحالي المقترح لا يثبت السداد السابق.');
    const snapshotHash = financeHash({ advance, journals: ledger.docs.map(d => ({ id: d.id, ...d.data() })),
      legacyLines: legacyLines.docs.map(d => ({ id: d.id, ...d.data() })),
      records, accounts: [accountAdvance.data(), accountBank.data()], period: period.data(), request: r });
    return { preview: true, financialPosting: false, readyForPosting: false,
      ownerAttestation: { reference: r.ownerStatementRef, establishesHistoricalLedgerProof: false },
      proposedCorrection: { entryDate: r.correctionDate, historicalFundingDate: r.historicalFundingDate,
        debitAccount: '1300', creditAccount: '1020', amountHalala: halala(r.amount),
        entryDateIsHistoricalFundingDate: false },
      allocatedHalala, remainingHalala: halala(r.amount) - allocatedHalala,
      opensUnallocatedBalance: false,
      unassignedAdvanceMovementCount: unassigned1300,
      evidenceRefs: r.evidenceRefs, evidenceVerification: 'unverified', snapshotHash, issues: [...new Set(problems)] };
  });
}
