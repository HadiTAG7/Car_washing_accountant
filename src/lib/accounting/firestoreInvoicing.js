// ═══════════════════════════════════════════════════════════════════════════
// إصدار المستندات الضريبية — transactional document numbering
// ═══════════════════════════════════════════════════════════════════════════
// An invoice number is not a display detail: it is the identity a tax
// authority audits against. Two devices issuing at the same second must not
// receive the same number, and a number must never be skipped by a write that
// then failed. So numbering happens inside a Firestore TRANSACTION, exactly
// like the journal counter, and the number, the document and the audit record
// land together or not at all.
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
  collection, doc, getDoc, getDocs, query, where,
  runTransaction, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebaseClient';
import { fetchRows } from '../firestoreCrud';
import {
  DOCUMENT_TYPES, formatDocumentNumber, buildSimplifiedInvoice,
  buildCreditNote, buildDebitNote, buildZatcaQrPayload, validateQrFields,
} from './invoicing';

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
 * Issues one document: mints its number, attaches the QR payload, and records
 * the source claim — all in a single transaction.
 *
 * The QR is built BEFORE the transaction opens. A transaction body can be
 * retried by the SDK, and an exception thrown from a retry is harder to read
 * than one thrown up front; more importantly, a malformed VAT number should
 * fail before a counter is touched.
 */
export async function issueDocument(document, { userId = null, allowUnregistered = false } = {}) {
  requireDb();
  if (!DOCUMENT_TYPES.includes(document.type)) {
    throw new Error(`نوع المستند غير معروف: ${document.type}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(document.issueDate || ''))) {
    throw new Error('تاريخ إصدار المستند غير صالح.');
  }

  const taxable = Boolean(document.taxable);
  // A zero-VAT document carries no QR — the QR is a tax-invoice artefact, and
  // emitting one for a non-taxable receipt would misrepresent it.
  let qrPayload = null;
  if (taxable) {
    const qrFields = {
      sellerName: document.seller?.name,
      vatNumber:  document.seller?.vatNumber,
      timestamp:  document.timestamp,
      total:      document.gross,
      vatAmount:  document.vat,
    };
    const problems = validateQrFields(qrFields);
    if (problems.length && !allowUnregistered) {
      const err = new Error(problems[0]);
      err.problems = problems;
      throw err;
    }
    if (!problems.length) qrPayload = buildZatcaQrPayload(qrFields);
  }

  const year = Number(String(document.issueDate).slice(0, 4));
  const claim = document.sourceType && document.sourceId
    ? sourceClaimId(document.sourceType, document.sourceId)
    : null;

  return runTransaction(db, async (tx) => {
    // ── reads first, always ──
    const counterRef = doc(db, DOC_COL.COUNTERS, counterIdFor(document.type, year));
    const counterSnap = await tx.get(counterRef);
    const claimRef = claim ? doc(db, DOC_COL.SOURCES, claim) : null;
    const claimSnap = claimRef ? await tx.get(claimRef) : null;

    if (claimSnap && claimSnap.exists()) {
      const prev = claimSnap.data();
      const err = new Error(
        `سبق إصدار مستند لهذا السجل: ${prev.documentNumber}. استخدم إشعاراً دائناً أو مديناً للتعديل.`,
      );
      err.code = 'already_issued';
      err.documentId = prev.documentId;
      err.documentNumber = prev.documentNumber;
      throw err;
    }

    const sequence = counterSnap.exists() ? Number(counterSnap.data().nextNumber) || 1 : 1;
    const documentNumber = formatDocumentNumber(document.type, year, sequence);

    // ── writes ──
    const ref = doc(collection(db, DOC_COL.DOCUMENTS));
    tx.set(ref, {
      ...document,
      documentNumber,
      sequence,
      year,
      status: 'issued',
      qrPayload,
      // Stated on the document itself so a reader is never left guessing.
      zatcaReported: false,
      issuedBy: userId,
      issuedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    tx.set(counterRef, {
      nextNumber: sequence + 1, type: document.type, year, updatedAt: serverTimestamp(),
    }, { merge: true });
    if (claimRef) {
      tx.set(claimRef, {
        sourceType: document.sourceType, sourceId: document.sourceId,
        documentId: ref.id, documentNumber, at: serverTimestamp(),
      });
    }
    tx.set(doc(collection(db, 'audit_logs')), {
      action: 'issue',
      collectionName: DOC_COL.DOCUMENTS,
      documentId: ref.id,
      userId,
      before: null,
      after: { documentNumber, gross: document.gross, vat: document.vat },
      note: `إصدار ${documentNumber}`,
      at: serverTimestamp(),
      atIso: new Date().toISOString(),
    });

    return { id: ref.id, documentNumber, sequence, year, qrPayload };
  });
}

/** Convenience: build a simplified invoice from lines, then issue it. */
export async function issueSimplifiedInvoice({
  issueDate, issueTime, lines, customer = null, priceMode = 'inclusive',
  sourceType = null, sourceId = null, seller = null, taxable = null,
}, options = {}) {
  const profile = seller || await fetchSellerProfile();
  const isTaxable = taxable == null ? profile.vatRegistered : Boolean(taxable);
  const document = buildSimplifiedInvoice({
    type: 'invoice', issueDate, issueTime, lines, seller: profile, customer,
    priceMode, taxable: isTaxable, sourceType, sourceId,
  });
  return issueDocument(document, options);
}

/**
 * إشعار دائن — the ONLY way to reduce or cancel an issued invoice. Deleting
 * a document would break the sequence a tax audit walks.
 */
export async function issueCreditNoteFor(invoiceId, { issueDate, issueTime, lines = null, reason }, options = {}) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار الدائن يصدر مقابل فاتورة فقط.');
  const note = buildCreditNote(invoice, { issueDate, issueTime, lines, reason });
  // A note is its own document with its own sequence; it must not inherit the
  // invoice's source claim or the claim would block the note.
  return issueDocument({ ...note, sourceType: null, sourceId: null }, options);
}

/** إشعار مدين — raises an already-issued invoice (an undercharge). */
export async function issueDebitNoteFor(invoiceId, { issueDate, issueTime, lines, reason }, options = {}) {
  requireDb();
  const invoice = await fetchDocument(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  if (invoice.type !== 'invoice') throw new Error('الإشعار المدين يصدر مقابل فاتورة فقط.');
  const note = buildDebitNote(invoice, { issueDate, issueTime, lines, reason });
  return issueDocument({ ...note, sourceType: null, sourceId: null }, options);
}

/**
 * Marks a document void. An ISSUED document is never removed and never
 * silently altered — voiding records the intent and the reason, and the
 * accounting effect still has to come from a credit note.
 */
export async function voidDocument(id, { reason, userId = null } = {}) {
  requireDb();
  if (!String(reason || '').trim()) throw new Error('سبب الإلغاء مطلوب.');
  return runTransaction(db, async (tx) => {
    const ref = doc(db, DOC_COL.DOCUMENTS, id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('المستند غير موجود.');
    if (snap.data().status === 'cancelled') throw new Error('المستند ملغى بالفعل.');
    tx.update(ref, {
      status: 'cancelled', voidReason: String(reason).trim(),
      voidedBy: userId, voidedAt: serverTimestamp(),
    });
    tx.set(doc(collection(db, 'audit_logs')), {
      action: 'void', collectionName: DOC_COL.DOCUMENTS, documentId: id, userId,
      before: { status: snap.data().status }, after: { status: 'cancelled' },
      note: `إلغاء ${snap.data().documentNumber} — ${reason}`,
      at: serverTimestamp(), atIso: new Date().toISOString(),
    });
    return { id, documentNumber: snap.data().documentNumber };
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
