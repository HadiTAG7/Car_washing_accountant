// Read/display only. These facts never grant approval, unlock a source, or post.
const summary = entry => ({ id: entry.id, number: entry.entryNumber ?? null, date: entry.entryDate || null,
  status: entry.status, settlementOf: entry.settlementOf || null });
const ordered = entries => entries.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id));
function mirrorMatches(original, reversal) {
  if (!original.lines?.length || !reversal?.lines?.length || reversal.status !== 'posted') return false;
  const totals = new Map();
  for (const entry of [original, reversal]) for (const line of entry.lines) {
    if (!line.accountId || ![line.debit ?? 0, line.credit ?? 0].every(value => typeof value === 'number' && Number.isFinite(value))) return false;
    const amount = (line.debit ?? 0) - (line.credit ?? 0);
    totals.set(String(line.accountId), (totals.get(String(line.accountId)) || 0) + Math.round(amount * 100));
  }
  return [...totals.values()].every(value => value === 0);
}
export async function financePostingHistory(db, tx, documents, sourceId) {
  const entries = documents.filter(doc => doc.exists).map(doc => ({ ...doc.data(), id: doc.id }));
  const active = entries.filter(entry => entry.status === 'posted' && !entry.reversalOf && !entry.reversedBy);
  const originals = entries.filter(entry => entry.status === 'reversed' && !entry.reversalOf);
  const issues = [], reversed = [];
  for (const original of originals) {
    let reversal = null;
    if (original.reversedBy) {
      const snap = await tx.get(db.collection('journal_entries').doc(String(original.reversedBy)));
      if (snap.exists) reversal = { ...snap.data(), id: snap.id };
      else if (/^\d+$/.test(String(original.reversedBy))) {
        const matches = await tx.get(db.collection('journal_entries').where('entryNumber', '==', Number(original.reversedBy)).limit(2));
        if (matches.size === 1) reversal = { ...matches.docs[0].data(), id: matches.docs[0].id };
      }
    }
    // Older entries keep their lines in journal_lines; newer ones embed them.
    // Use one representation, never add both and double the amounts.
    const withLines = async entry => {
      if (!entry || entry.lines?.length) return entry;
      const lines = await tx.get(db.collection('journal_lines').where('entryId', '==', entry.id));
      return { ...entry, lines: lines.docs.map(doc => doc.data()) };
    };
    const mirrorMatched = mirrorMatches(await withLines(original), await withLines(reversal));
    if (!mirrorMatched) issues.push(`تعذر إثبات مطابقة عكس القيد ${original.entryNumber ?? 'غير المرقم'}؛ لا تعاد العملية.`);
    reversed.push({ ...summary(original), reversal: reversal ? summary(reversal) : null, mirrorMatched });
  }
  // The existing posted financing adjustment names its sources explicitly.
  // Showing that link is not proof of a bank statement or source completeness.
  const funding = entries.length ? await tx.get(db.collection('journal_entries').where('sourceKind', '==', 'owner_cash_bank_correction')) : { docs: [] };
  const fundingCorrections = funding.docs.map(doc => ({ ...doc.data(), id: doc.id }))
    .filter(entry => entry.status === 'posted' && !entry.reversalOf && !entry.reversedBy
      && entry.cashBankCorrection?.sources?.some(source => source.source === `expense:${sourceId}`));
  return { active: ordered(active.map(summary)), reversed: ordered(reversed),
    fundingCorrections: ordered(fundingCorrections.map(summary)), issues };
}
