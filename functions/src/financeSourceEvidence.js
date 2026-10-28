import { financeHash, financeSourceHash } from './financeHash.js';

// Bounded, reviewed source grants. These are not editable policy settings or a
// client assertion of owner authority. Adding another source requires review.
const quantityGrants = Object.freeze([
  { ref: 'OWNER-QUANTITY-10-20261026-KEYS', kind: 'startup', sourceId: 'I8tWV7ElQXRMW3AFMqBI', amount: 20,
    document: 'drive:1WH9-Z520CqraEKyRnh7zJ1iEYLwhGDVN' },
  { ref: 'OWNER-QUANTITY-10-20261026-COPPER', kind: 'startup', sourceId: 'kowTpQdTgaLUCfhtzRQ4', amount: 150,
    document: 'drive:1rDK0CUU83cIE5YW4N7XDaYRIt47Iwp55' },
].map(grant => Object.freeze({ ...grant, decisionRef: 'CFO-OWNER-BATCH-ANSWERS-20261026:10',
  decisionText: '10 مو مهم العدد', decisionAt: '2026-10-26T19:16:11.251Z' })));
const original99 = Object.freeze({ ref: 'ORIGINAL99-0579-20261028', document: 'drive:1kXBQUqAPostNYJ6c9myt3CqBwKKFRM_k', total: 280,
  evidenceRef: 'ORIGINAL99-READ-20261028',
  lines: [{ id: 'printed-1', amount: 30 }, { id: 'printed-2', amount: 30 }, { id: 'printed-3', amount: 20 }, { id: 'printed-4', amount: 200 }],
  members: [
    { kind: 'startup', sourceId: 'xm8IA2ypXnQvQ7LFLPTy', amount: 200, lineIds: ['printed-4'] },
    { kind: 'startup', sourceId: 'zk0wmq8nHTbsgs9CteWd', amount: 80, lineIds: ['printed-1', 'printed-2', 'printed-3'] },
  ] });
export function financeDocumentIdentity(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'drive.google.com') {
      const driveId = parsed.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || parsed.searchParams.get('id');
      if (driveId && /^[\w-]+$/.test(driveId)) return `drive:${driveId}`;
    }
    return parsed.href;
  } catch { return null; }
}
const evidenceShape = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => ['version', 'grantRef', 'sourceRef'].includes(key)) && value.version === 1
  && typeof value.grantRef === 'string' && typeof value.sourceRef === 'string' && value.sourceRef.trim().length > 0 && value.sourceRef.length <= 300;
export const sourceEvidenceShapeValid = value => value === null || Boolean(evidenceShape(value));
export function quantityExceptionGrant(kind, sourceId, row) {
  return quantityGrants.find(grant => grant.kind === kind && grant.sourceId === sourceId && grant.amount === row.amount
    && grant.document === financeDocumentIdentity(row.invoice_url)) || null;
}
export function quantityExceptionProblems(kind, sourceId, row) {
  const evidence = row.finance_metadata?.quantityException;
  const grant = quantityExceptionGrant(kind, sourceId, row);
  const issues = [];
  if (!evidenceShape(evidence) || !grant || evidence.grantRef !== grant.ref) issues.push('استثناء الكمية غير مطابق لقرار المالك ومصدره ومبلغه؛ لا يستثنى مستند آخر.');
  if (row.quantity != null || row.unit_cost != null || row.finance_metadata?.invoiceLines != null) issues.push('المبلغ الإجمالي المستثنى يبقى دون كمية أو سعر وحدة أو بنود مخترعة.');
  return issues;
}
export function allocationGrant(kind, sourceId) {
  return original99.members.some(member => member.kind === kind && member.sourceId === sourceId) ? original99 : null;
}
export function allowedAllocationSibling(grant, kind, sourceId) {
  return Boolean(grant?.members.some(member => member.kind === kind && member.sourceId === sourceId));
}
/** Every allocated peer is read in the caller's transaction, including legacy
 * posting. Pending setup may be saved, but never approved or posted. */
export async function financeSourceEvidence(db, tx, kind, sourceId, row) {
  const meta = row.finance_metadata || {}, issues = [], warnings = [];
  const quantityGrant = quantityExceptionGrant(kind, sourceId, row), grant = allocationGrant(kind, sourceId, row);
  if (meta.quantityException != null) {
    issues.push(...quantityExceptionProblems(kind, sourceId, row));
    if (!issues.length) warnings.push('الكمية وسعر الوحدة غير متاحين بقرار هادي الموثق؛ المبلغ فقط مثبت. بقية الضوابط والاعتماد المنفصل باقية.');
  }
  const allocation = meta.documentAllocation;
  const hasAllocation = allocation != null;
  let contextHash = null;
  if (grant && financeDocumentIdentity(row.invoice_url) !== grant.document) issues.push('لا يغيّر رابط أصل التوزيع لتجاوز التكرار؛ أعد رابط المستند المثبت.');
  if (grant && !hasAllocation) issues.push('هذا الأصل له توزيع مراجع؛ يلزم ربط السجل بالتوزيع قبل الاعتماد أو الترحيل.');
  if (hasAllocation && (!evidenceShape(allocation) || !grant || allocation.grantRef !== grant.ref)) issues.push('مجموعة توزيع الأصل غير معتمدة لهذا المصدر؛ لا يستثنى منع التكرار العام.');
  // A renamed URL for this original cannot create a third source or a new
  // allocation, even when an exact-URL duplicate query would not find it.
  if (financeDocumentIdentity(row.invoice_url) === original99.document && !grant) issues.push('هذا الأصل موزع على سجلين قائمين؛ لا يضاف مصدر ثالث أو تخصيص آخر.');
  if (grant && hasAllocation && evidenceShape(allocation) && allocation.grantRef === grant.ref) {
    const peers = [];
    for (const member of grant.members) {
      const snap = await tx.get(db.collection('startup_cost_entries').doc(member.sourceId));
      const value = member.kind === kind && member.sourceId === sourceId ? row : snap.exists ? snap.data() : null;
      if (!snap.exists || !value) { issues.push('أحد سجلي التوزيع القائمين غير موجود؛ لا ينشأ بدلًا منه.'); continue; }
      if (value.amount !== member.amount || financeDocumentIdentity(value.invoice_url) !== grant.document) issues.push('مبلغ أحد جزأي الأصل أو رابطه تغيّر؛ أعد مراجعة التوزيع قبل الاعتماد.');
      const peerEvidence = value.finance_metadata?.documentAllocation;
      if (!evidenceShape(peerEvidence) || peerEvidence.grantRef !== grant.ref) issues.push('ربط التوزيع غير مكتمل في السجل الآخر؛ يُحفظ التصحيح دون اعتماد حتى يكتمل.');
      peers.push({ kind: member.kind, sourceId: member.sourceId, sourceHash: financeSourceHash(value) });
    }
    contextHash = financeHash({ grant, peers });
    warnings.push('فاتورة واحدة موزعة دون تكرار: 200 ريال للدبابات و80 ريال للسكن؛ سقف الأصل 280 ريال.');
  }
  return { quantityGrant, allocationGrant: grant, issues: [...new Set(issues)], warnings, contextHash };
}
