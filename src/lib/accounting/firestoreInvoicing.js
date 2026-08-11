// ═══════════════════════════════════════════════════════════════════════════
// المستندات الضريبية — reads here, writes through Cloud Functions
// ═══════════════════════════════════════════════════════════════════════════
// An invoice number is the identity a tax authority audits against, so it is
// minted on the SERVER, inside one transaction with the document, the counter,
// the source claim and the audit record. The totals are recomputed there from
// the lines too: a document whose printed total disagrees with its own rows is
// worse than no document.
//
// Collections
//   sales_documents         — invoices, credit notes and debit notes
//   sales_document_sources  — one claim doc per source record (idempotency)
//   counters/documents-<type>-<year>  — { nextNumber }
//   app_settings/company    — seller identity that goes on every document
//
// ⚠️ Issuing here does NOT report anything to ZATCA. See zatcaIntegration.js.
// ═══════════════════════════════════════════════════════════════════════════

import {
  collection, doc, getDoc, getDocs, query, where, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { callServer as callLedger } from '../ledgerTransport';
import { fetchRows } from '../firestoreCrud';
import { buildCreditNote, buildDebitNote } from './invoicing';

export const DOC_COL = {
  DOCUMENTS: 'sales_documents',
  SOURCES:   'sales_document_sources',
  COUNTERS:  'counters',
  SETTINGS:  'app_settings',
};
const COMPANY_SETTINGS_ID = 'company';

function requireDb() {
  if (!isFirebaseConfigured) throw new Error('Firebase غير مُهيّأ — لا يمكن إصدار المستندات.');
}

/** `counters/documents-invoice-2026` — a separate sequence per type and year. */
export function counterIdFor(type, year) {
  return `documents-${type}-${year}`;
}

/**
 * Claim key for idempotency. A source record (a wash, an expense) may produce
 * exactly one document; the claim doc is read inside the transaction, so two
 * simultaneous attempts cannot both win.
 */
export function sourceClaimId(sourceType, sourceId) {
  return `${sourceType}__${sourceId}`;
}

// ─── هوية المنشأة ────────────────────────────────────────────────────────
/**
 * The seller block printed on every document. Kept in one place because a
 * wrong VAT number invalidates every QR code issued after it.
 */
export async function fetchSellerProfile() {
  requireDb();
  const snap = await getDoc(doc(db, DOC_COL.SETTINGS, COMPANY_SETTINGS_ID));
  const v = snap.exists() ? (snap.data().value || snap.data()) : {};
  return {
    name:       v.name || 'شركة هادي الغانم',
    vatNumber:  v.vatNumber || '',
    address:    v.address || '',
    // Until a real VAT registration is entered, documents are internal papers
    // and must not pretend to be tax invoices.
    vatRegistered: Boolean(v.vatRegistered && v.vatNumber),
  };
}

export async function saveSellerProfile(profile, { userId = null } = {}) {
  requireDb();
  await setDoc(doc(db, DOC_COL.SETTINGS, COMPANY_SETTINGS_ID), {
    value: {
      name: String(profile.name || '').trim(),
      vatNumber: String(profile.vatNumber || '').trim(),
      address: String(profile.address || '').trim(),
      vatRegistered: Boolean(profile.vatRegistered),
    },
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  }, { merge: true });
  return fetchSellerProfile();
}

// ─── القراءة ─────────────────────────────────────────────────────────────
export const fetchDocuments = () => fetchRows(DOC_COL.DOCUMENTS);

export async function fetchDocument(id) {
  const snap = await getDoc(doc(db, DOC_COL.DOCUMENTS, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Notes raised against one invoice — what the document viewer shows below it. */
export async function fetchNotesFor(documentNumber) {
  const snap = await getDocs(query(
    collection(db, DOC_COL.DOCUMENTS), where('referenceNumber', '==', documentNumber),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── الإصدار ─────────────────────────────────────────────────────────────
/**
 * Issues one document through the trusted server.
 *
 * The client used to do this in a Firestore transaction that also wrote
 * `audit_logs` — which the rules now deny, so the whole transaction failed and
 * issuing was simply broken. It belongs on the server anyway: the totals are
 * recomputed from the lines there, and the number, sequence, seller identity
 * and issuer are all produced there, so none of them can be forged.
 */
export async function issueDocument(document, _options = {}) {
  requireDb();
  return callLedger('salesIssueDocument', {
    type: document.type,
    issueDate: document.issueDate,
    issueTime: document.issueTime,
    priceMode: document.priceMode,
    customer: document.customer,
    // Only the description/quantity/unitPrice of each line survive; the
    // server prices them.
    lines: (document.lines || []).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    // The note names the DOCUMENT, not a number: the server reads it and
    // derives the reference number from what it actually found.
    referenceDocumentId: document.referenceDocumentId || null,
    reason: document.reason || null,
    sourceType: document.sourceType || null,
    sourceId: document.sourceId || null,
  });
}

/** Convenience: issue a simplified invoice straight from its lines. */
export async function issueSimplifiedInvoice({
  issueDate, issueTime, lines, customer = null, priceMode = 'inclusive',
  sourceType = null, sourceId = null,
}) {
  // The seller identity and the VAT treatment come from the server's copy of
  // app_settings/company, so nothing about them is passed here.
  return issueDocument({
    type: 'invoice', issueDate, issueTime, lines, customer, priceMode,
    sourceType, sourceId,
  });
}

/**
 * إشعار دائن — the only way to reduce or cancel an issued invoice. Deleting a
 * document would break the sequence a tax audit walks.
 */
export async function issueCreditNoteFor(invoiceId, { issueDate, issueTime, lines = null, reason }) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار الدائن يصدر مقابل فاتورة فقط.');
  const note = buildCreditNote(invoice, { issueDate, issueTime, lines, reason });
  // A note is its own document with its own sequence; it must not inherit the
  // invoice's source claim or the claim would block the note.
  return issueDocument({
    ...note, referenceDocumentId: invoiceId, sourceType: null, sourceId: null,
  });
}

/** إشعار مدين — raises an already-issued invoice (an undercharge). */
export async function issueDebitNoteFor(invoiceId, { issueDate, issueTime, lines, reason }) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار المدين يصدر مقابل فاتورة فقط.');
  const note = buildDebitNote(invoice, { issueDate, issueTime, lines, reason });
  return issueDocument({
    ...note, referenceDocumentId: invoiceId, sourceType: null, sourceId: null,
  });
}

/**
 * Marks a document void. An ISSUED document is never removed and never
 * silently altered — voiding records the intent and the reason, and the
 * accounting effect still has to come from a credit note.
 */
export async function voidDocument(id, { reason } = {}) {
  requireDb();
  if (!String(reason || '').trim()) throw new Error('سبب الإلغاء مطلوب.');
  return callLedger('salesVoidDocument', { documentId: id, reason: String(reason).trim() });
}

/**
 * Gaps in a numbering sequence are the first thing an auditor looks for.
 * This walks the issued documents per type+year and reports any missing
 * sequence number, so a failed write is noticed rather than discovered later.
 */
export function sequenceGaps(documents) {
  const bySeries = new Map();
  for (const d of documents || []) {
    if (!d.documentNumber || d.sequence == null) continue;
    const key = `${d.type}-${d.year}`;
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key).push(Number(d.sequence));
  }
  const report = [];
  for (const [key, seqs] of bySeries) {
    const sorted = [...new Set(seqs)].sort((a, b) => a - b);
    const missing = [];
    for (let n = 1; n <= (sorted[sorted.length - 1] || 0); n += 1) {
      if (!sorted.includes(n)) missing.push(n);
    }
    const duplicates = seqs.filter((s, i) => seqs.indexOf(s) !== i);
    report.push({ series: key, count: sorted.length, missing, duplicates: [...new Set(duplicates)] });
  }
  return report;
}
