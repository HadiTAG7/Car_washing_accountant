import { FINANCE_KINDS, financeHash, financeSourceHash } from '../functions/src/financeReview.js';

export async function historicalSettlementProof(db, tx, kind, sourceId, row, sourceContext) {
  const groupId = row.finance_metadata?.custodyHistoricalSettlementId;
  if (!groupId || !/^[a-f0-9]{64}$/.test(groupId)) return null;
  const receipt = await tx.get(db.collection('finance_workbench_receipts').doc(`custody_h_${groupId.slice(0, 40)}`));
  if (!receipt.exists) return null;
  const { result, sourceHashes } = receipt.data();
  if (result?.groupId !== groupId || !Array.isArray(sourceHashes) || sourceHashes.length !== result.sourceCount
    || !sourceHashes.some(item => item.key === `${kind}:${sourceId}`
      && item.sourceContextHash === (sourceContext.contextHash || null)) || sourceContext.issues.length) return null;
  const [advance, groupLock, ...journals] = await Promise.all([
    result.advanceId ? tx.get(db.collection('temporary_expenses').doc(result.advanceId)) : Promise.resolve(null),
    tx.get(db.collection('posting_locks').doc(`custody_reconciliation__${groupId}`)),
    ...result.journalIds.map(id => tx.get(db.collection('journal_entries').doc(id))),
  ]);
  if ((result.advanceId && (!advance.exists || advance.data().custody_historical_partial_hold !== true)) || !groupLock.exists
    || journals.length !== result.sourceCount + 1 || journals.some(doc => !doc.exists
      || doc.data().status !== 'posted' || doc.data().custodyHistoricalSettlementId !== groupId)) return null;
  const consumed = journals.reduce((sum, doc) => sum + (doc.data().lines || [])
    .filter(line => String(line.accountId) === '1300')
    .reduce((n, line) => n + Math.round(Number(line.credit || 0) * 100) - Math.round(Number(line.debit || 0) * 100), 0), 0);
  if (consumed !== 0 || result.fundedHalala !== result.consumedHalala) return null;
  for (const deposit of result.fundingEvidence || []) {
    const lock = await tx.get(db.collection('posting_locks').doc(`custody_deposit__${financeHash(deposit.depositRowId).slice(0, 40)}`));
    if (!lock.exists || lock.data().depositRowId !== deposit.depositRowId
      || lock.data().evidenceRef !== deposit.evidenceRef
      || lock.data().deliveryDate !== deposit.deliveryDate
      || lock.data().depositAmountHalala !== Math.round(deposit.depositAmount * 100)
      || lock.data().consumedHalala < Math.round(deposit.allocatedAmount * 100)) return null;
  }
  for (const item of sourceHashes) {
    const [sourceKind, ...idParts] = item.key.split(':');
    const id = idParts.join(':');
    if (!FINANCE_KINDS[sourceKind]) return null;
    const [source, lock] = await Promise.all([
      tx.get(db.collection(FINANCE_KINDS[sourceKind].collection).doc(id)),
      tx.get(db.collection('posting_locks').doc(`${sourceKind}__${id}`)),
    ]);
    if (!source.exists || financeSourceHash(source.data()) !== item.after
      || source.data().finance_metadata?.custodyHistoricalSettlementId !== groupId
      || !lock.exists || lock.data().custodyHistoricalSettlementId !== groupId) return null;
    const posted = journals.find(doc => doc.id === lock.data().entryId);
    if (!posted || posted.data().sourceKind !== sourceKind || posted.data().sourceId !== id
      || posted.data().sourceSnapshotHash !== item.before) return null;
  }
  return { groupId, advanceId: result.advanceId, fundingJournalId: result.fundingJournalId,
    receiptVerified: true, ownerStatementIsBankReconciliation: false };
}
