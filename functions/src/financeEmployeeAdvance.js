// An owner's statement records a claim; only a posted, employee-specific
// advance can justify crediting 1300 for a purchase made from that advance.
const COLLECTIONS = ['variable_expenses', 'monthly_expenses', 'annual_expense_entries', 'startup_cost_entries'];
const id = value => typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,160}$/u.test(value);
const cents = value => Math.round(Number(value) * 100);
const halala = value => Number.isFinite(value) && value > 0 && Math.abs(value * 100 - cents(value)) < 1e-6;
async function linesOf(db, tx, journalId, journal) {
  if (Array.isArray(journal?.lines) && journal.lines.length) return journal.lines;
  const lines = await tx.get(db.collection('journal_lines').where('entryId', '==', journalId).limit(101));
  if (lines.size > 100) return [];
  return lines.docs.map(doc => doc.data());
}

export function employeeAdvanceLinkProblems(meta) {
  if (meta?.fundingType !== 'employee') return [];
  const link = meta.employeeAdvanceLink;
  if (!link || link.version !== 1 || !id(link.advanceId) || !id(link.employeeId)
    || !id(link.fundingJournalId) || !halala(link.allocatedAmount)) {
    return ['ربط عهدة الموظف غير مكتمل؛ يلزم رقم العهدة والموظف وقيد تمويل مرحل ومبلغ التخصيص.'];
  }
  return [];
}

export async function verifyEmployeeAdvanceLink(db, tx, kind, sourceId, row, gross) {
  const meta = row.finance_metadata || {};
  if (meta.fundingType !== 'employee') return { issues: [], proof: null };
  const shape = employeeAdvanceLinkProblems(meta);
  if (shape.length) return { issues: shape, proof: null };
  const link = meta.employeeAdvanceLink;
  if (cents(link.allocatedAmount) !== cents(gross)) {
    return { issues: ['مبلغ ربط العهدة لا يطابق إجمالي المستند المراد ترحيله.'], proof: null };
  }
  const [advanceSnap, journalSnap] = await Promise.all([
    tx.get(db.collection('temporary_expenses').doc(link.advanceId)),
    tx.get(db.collection('journal_entries').doc(link.fundingJournalId)),
  ]);
  const advance = advanceSnap.exists ? advanceSnap.data() : null;
  const journal = journalSnap.exists ? journalSnap.data() : null;
  const fundingLines = journal ? await linesOf(db, tx, link.fundingJournalId, journal) : [];
  const funded = fundingLines.filter(line => String(line.accountId) === '1300')
    .reduce((sum, line) => sum + cents(line.debit || 0) - cents(line.credit || 0), 0);
  if (!advance || String(advance.biker_id || '') !== link.employeeId
    || advance.status === 'recovered' || Number(advance.recovered_amount || 0) !== 0 || advance.payroll_lock_id
    || !journal || journal.status !== 'posted' || journal.reversalOf || journal.reversedBy || journal.sourceType !== 'temporary_expense'
    || journal.sourceId !== link.advanceId || funded <= 0 || funded !== cents(advance.amount)
    || typeof journal.entryDate !== 'string' || journal.entryDate > row.paid_date) {
    return { issues: ['قيد تمويل عهدة الموظف غير مطابق للموظف والعهدة وتاريخ السداد أو لم يعد ساريًا.'], proof: null };
  }
  const relatedJournals = await tx.get(db.collection('journal_entries').where('sourceId', '==', link.advanceId).limit(101));
  if (relatedJournals.size > 100) return { issues: ['حركات العهدة كثيرة؛ يلزم فحصها قبل الاعتماد.'], proof: null };
  let available = 0;
  for (const doc of relatedJournals.docs) {
    if (doc.data().status !== 'posted' || doc.data().reversalOf || doc.data().reversedBy || doc.data().sourceType === 'expense') continue;
    const lines = await linesOf(db, tx, doc.id, doc.data());
    available += lines.filter(line => String(line.accountId) === '1300')
      .reduce((sum, line) => sum + cents(line.debit || 0) - cents(line.credit || 0), 0);
  }
  if (available <= 0 || available > funded) {
    return { issues: ['رصيد العهدة المرتبط بالقيد المحدد غير متاح أو يحتاج مطابقة.'], proof: null };
  }
  let allocated = 0;
  for (const collection of COLLECTIONS) {
    const matches = await tx.get(db.collection(collection).where('finance_metadata.employeeAdvanceLink.advanceId', '==', link.advanceId).limit(101));
    if (matches.size > 100) return { issues: ['تخصيصات العهدة كثيرة؛ يلزم فحصها قبل الاعتماد.'], proof: null };
    for (const doc of matches.docs) {
      const candidate = doc.data().finance_metadata?.employeeAdvanceLink;
      if (candidate?.fundingJournalId !== link.fundingJournalId || candidate?.employeeId !== link.employeeId
        || !halala(candidate?.allocatedAmount)) {
        return { issues: ['تخصيصات عهدة الموظف متعارضة وتحتاج مراجعة.'], proof: null };
      }
      allocated += cents(candidate.allocatedAmount);
    }
  }
  // Previewing a new or unsaved correction must include its proposed amount.
  const collection = { variable: COLLECTIONS[0], monthly: COLLECTIONS[1], annual: COLLECTIONS[2], startup: COLLECTIONS[3] }[kind];
  const saved = await tx.get(db.collection(collection).doc(sourceId));
  if (!saved.exists || saved.data().finance_metadata?.employeeAdvanceLink?.advanceId !== link.advanceId) allocated += cents(link.allocatedAmount);
  else allocated += cents(link.allocatedAmount) - cents(saved.data().finance_metadata.employeeAdvanceLink.allocatedAmount || 0);
  if (allocated > available) return { issues: ['تخصيصات عهدة الموظف تتجاوز التمويل المرحل المتاح.'], proof: null };
  return { issues: [], proof: { advanceId: link.advanceId, employeeId: link.employeeId,
    fundingJournalId: link.fundingJournalId, fundedAmount: funded / 100, availableAmount: available / 100, allocatedAmount: allocated / 100 } };
}
