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
import { db, isFirebaseConfigured } from '../firebaseClient.js';
import { callServer as callLedger } from '../ledgerTransport.js';
import { fetchRows } from '../firestoreCrud.js';
import { buildCreditNote, buildDebitNote } from './invoicing.js';

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
    // When the service was rendered, as opposed to when the paper was issued.
    // On the linked path the server takes it from the wash and ignores this.
    supplyDate: document.supplyDate || null,
    // ── the wash-linked path ──
    // When this is set the server ignores every money field below: it reads
    // the wash, its posting lock and its posted entry, and builds the invoice
    // from those. Nothing sent from here can change what the invoice says.
    washId: document.washId || null,
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
    // How the money moved. The server picks the settlement account from this
    // rather than guessing — cash, bank, or the customer's balance.
    refundMethod: document.refundMethod || null,
    paymentMethod: document.paymentMethod || null,
    paymentStatus: document.paymentStatus || null,
    sourceType: document.sourceType || null,
    sourceId: document.sourceId || null,
  });
}

/**
 * فاتورة بيع مستقلة — a sale that exists only as this invoice.
 *
 * There is no wash behind it, so the invoice IS the source: the server writes
 * the document and its sales entry in one transaction. That is why the
 * settlement is required — an entry has to debit something real, and a sale
 * whose money the system had to guess at is a cash balance nobody can tie out.
 */
export async function issueSimplifiedInvoice({
  issueDate, issueTime, lines, customer = null, priceMode = 'inclusive',
  paymentMethod = 'cash', paymentStatus = 'paid', supplyDate = null,
  sourceType = null, sourceId = null,
}) {
  // The seller identity and the VAT treatment come from the server's copy of
  // app_settings/company, so nothing about them is passed here.
  return issueDocument({
    type: 'invoice', issueDate, issueTime, lines, customer, priceMode,
    paymentMethod, paymentStatus, supplyDate, sourceType, sourceId,
  });
}

/**
 * فاتورة لغسلة مُرحّلة — the invoice for a wash whose revenue is already in
 * the books.
 *
 * The wash id and the ISSUE DATE travel; nothing else. The quantity, the
 * price, the VAT treatment, the settlement account and the SUPPLY date are all
 * read server-side from the wash and its posted entry, and the document is
 * refused if the two disagree. No second sales entry is created: the wash's
 * entry already holds that revenue, and posting it again would double it.
 *
 * `issueDate` is the document's own date and must be stated. It used to be
 * taken from the wash, which filed every late invoice in the month of supply
 * rather than the month it was issued in.
 */
export async function issueInvoiceForWash(washId, {
  issueDate, issueTime = null, customer = null,
} = {}) {
  requireDb();
  if (!String(washId || '').trim()) throw new Error('معرّف الغسلة مطلوب.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(issueDate || ''))) {
    throw new Error('تاريخ إصدار الفاتورة مطلوب.');
  }
  return issueDocument({
    type: 'invoice', washId: String(washId).trim(), issueDate, issueTime, customer,
  });
}

/**
 * التصحيح الذري لفاتورة غسلة.
 *
 * One server call that cancels the document, reverses the wash's entry on the
 * date given, frees the posting lock when that entry still owns it, and
 * releases the source claim so a replacement can be issued after the wash is
 * corrected and re-posted. Doing those four by hand is what leaves an issued
 * invoice pointing at a reversed entry — a state the ledger now refuses to
 * create, which is why this path exists at all.
 */
export async function correctWashInvoice(id, { reason, reversalDate } = {}) {
  requireDb();
  if (!String(reason || '').trim()) throw new Error('سبب التصحيح مطلوب.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reversalDate || ''))) {
    throw new Error('تاريخ القيد العكسي مطلوب.');
  }
  return callLedger('salesCorrectWashInvoice', {
    documentId: id,
    reason: String(reason).trim(),
    reversalDate: String(reversalDate).slice(0, 10),
  });
}

/**
 * ربط الفواتير القديمة بقيودها — dry-run unless `apply` is set.
 *
 * Returns `{ scanned, linkable, review, applied }`. Only links the document
 * itself declares are adopted, and only when the lock, the entry and the total
 * all confirm them; everything else is listed for a human.
 */
export async function linkLegacyInvoices({ apply = false } = {}) {
  requireDb();
  return callLedger('salesLinkLegacyInvoices', { apply: apply === true });
}

/**
 * إشعار دائن — the only way to reduce or cancel an issued invoice. Deleting a
 * document would break the sequence a tax audit walks.
 */
export async function issueCreditNoteFor(invoiceId, {
  issueDate, issueTime, lines = null, reason, refundMethod = 'cash',
}) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار الدائن يصدر مقابل فاتورة فقط.');
  const note = buildCreditNote(invoice, { issueDate, issueTime, lines, reason });
  // A note is its own document with its own sequence; it must not inherit the
  // invoice's source claim or the claim would block the note.
  return issueDocument({
    ...note, referenceDocumentId: invoiceId, refundMethod,
    sourceType: null, sourceId: null,
  });
}

/** إشعار مدين — raises an already-issued invoice (an undercharge). */
export async function issueDebitNoteFor(invoiceId, {
  issueDate, issueTime, lines, reason, paymentMethod = 'cash',
}) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار المدين يصدر مقابل فاتورة فقط.');
  const note = buildDebitNote(invoice, { issueDate, issueTime, lines, reason });
  return issueDocument({
    ...note, referenceDocumentId: invoiceId, paymentMethod,
    sourceType: null, sourceId: null,
  });
}

/**
 * Marks a document void. An ISSUED document is never removed and never
 * silently altered — voiding records the intent and the reason, and the
 * accounting effect still has to come from a credit note.
 *
 * `reversalDate` is the date the reversing entry lands on, and it travels
 * explicitly because a document with an entry cannot be voided without one.
 * It is NOT the document's own date: a note raised in July, with July closed,
 * has to be reversed in an open month, and the old behaviour — falling back to
 * the note's date server-side — made that impossible to express.
 */
export async function voidDocument(id, { reason, reversalDate = null } = {}) {
  requireDb();
  if (!String(reason || '').trim()) throw new Error('سبب الإلغاء مطلوب.');
  return callLedger('salesVoidDocument', {
    documentId: id,
    reason: String(reason).trim(),
    reversalDate: reversalDate ? String(reversalDate).slice(0, 10) : null,
  });
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
