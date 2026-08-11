// ═══════════════════════════════════════════════════════════════════════════
// إصدار المستندات الضريبية على الخادم
// ═══════════════════════════════════════════════════════════════════════════
// Issuing used to run in a client transaction that wrote `audit_logs`. When
// the rules closed audit_logs to clients, that whole transaction started
// failing — issuing an invoice was simply broken. It belongs here anyway:
//
//   • The totals are RECOMPUTED from the lines. A document whose printed
//     total disagrees with its own lines is worse than no document.
//   • `documentNumber`, `sequence` and `issuedBy` come from the server. A
//     client that could name its own invoice number could reuse one, and a
//     duplicate invoice number is the thing a tax audit looks for first.
//   • The document, the counter, the source claim and the audit record land
//     in ONE transaction, so a number is never consumed by a write that then
//     failed.
// ═══════════════════════════════════════════════════════════════════════════

import { round2, isRealDate } from './invariants.js';
import { splitVat, VAT_RATE } from './posting.js';

export const DOC_COL = {
  DOCUMENTS: 'sales_documents',
  SOURCES:   'sales_document_sources',
  COUNTERS:  'counters',
  AUDIT:     'audit_logs',
  SETTINGS:  'app_settings',
};

export const DOCUMENT_TYPES = ['invoice', 'credit_note', 'debit_note'];
const PREFIX = { invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' };

export class InvoicingError extends Error {
  constructor(message, { code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'InvoicingError';
    this.code = code;
  }
}

/** 'INV-2026-000042' — year-scoped so a sequence restarts cleanly each year. */
export function formatDocumentNumber(type, year, sequence) {
  return `${PREFIX[type] || 'DOC'}-${year}-${String(sequence).padStart(6, '0')}`;
}

export const counterIdFor = (type, year) => `documents-${type}-${year}`;
export const sourceClaimId = (sourceType, sourceId) => `${sourceType}__${sourceId}`;

/**
 * Validates the lines of a document. Returns Arabic problems; empty is good.
 *
 * `Number(x) || 0` silently turns Infinity into Infinity and NaN into 0, so a
 * quantity of `1e999` would have produced a document whose total is `Infinity`
 * and whose stored fields Firestore rejects halfway through a transaction.
 * Every figure is checked for finiteness and positivity BEFORE any arithmetic.
 */
export function lineProblems(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  if (rows.length === 0) return ['المستند بلا سطور.'];
  const problems = [];
  rows.forEach((l, i) => {
    const n = i + 1;
    if (!String(l?.description ?? '').trim()) problems.push(`السطر ${n}: الوصف مطلوب.`);
    const q = Number(l?.quantity);
    const p = Number(l?.unitPrice);
    if (!Number.isFinite(q) || q <= 0) problems.push(`السطر ${n}: الكمية يجب أن تكون رقماً موجباً.`);
    if (!Number.isFinite(p) || p <= 0) problems.push(`السطر ${n}: سعر الوحدة يجب أن يكون رقماً موجباً.`);
    if (Number.isFinite(q) && Number.isFinite(p) && !Number.isFinite(q * p)) {
      problems.push(`السطر ${n}: قيمة السطر خارج النطاق.`);
    }
  });
  return problems;
}

/**
 * Totals a document from its LINES, per line.
 *
 * The sum of rounded lines, not a total rounded on its own: a reader adds the
 * column up, and a total that disagrees with its own rows is the classic
 * "invoice is out by a halala" complaint.
 */
export function totalsFromLines(lines, { priceMode = 'inclusive', taxable = true, rate = VAT_RATE } = {}) {
  let net = 0, vat = 0, gross = 0;
  const priced = (Array.isArray(lines) ? lines : []).map((l) => {
    const quantity = Number(l?.quantity) || 0;
    const unitPrice = round2(l?.unitPrice);
    const amount = round2(quantity * unitPrice);
    const s = splitVat(amount, { mode: priceMode, taxable, rate });
    net += s.net; vat += s.vat; gross += s.gross;
    return {
      description: String(l?.description ?? '').slice(0, 300),
      quantity, unitPrice,
      lineNet: s.net, lineVat: s.vat, lineGross: s.gross,
    };
  });
  return { lines: priced, net: round2(net), vat: round2(vat), gross: round2(gross) };
}

// ─── رمز QR للفاتورة المبسطة (المرحلة الأولى) ────────────────────────────
function tlv(tag, value) {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  if (bytes.length > 255) throw new InvoicingError(`قيمة الوسم ${tag} أطول من 255 بايت.`);
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

export function buildQrPayload({ sellerName, vatNumber, timestamp, total, vatAmount }) {
  return Buffer.concat([
    tlv(1, sellerName), tlv(2, vatNumber), tlv(3, timestamp),
    tlv(4, Number(total).toFixed(2)), tlv(5, Number(vatAmount).toFixed(2)),
  ]).toString('base64');
}

export function qrProblems({ sellerName, vatNumber, timestamp }) {
  const problems = [];
  if (!String(sellerName || '').trim()) problems.push('اسم المورّد مطلوب في رمز QR.');
  const vat = String(vatNumber || '').trim();
  if (!/^\d{15}$/.test(vat)) problems.push('الرقم الضريبي يجب أن يكون 15 رقماً.');
  else if (!vat.startsWith('3') || !vat.endsWith('3')) problems.push('الرقم الضريبي السعودي يبدأ وينتهي بالرقم 3.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(timestamp || ''))) {
    problems.push('الطابع الزمني يجب أن يكون بصيغة ISO-8601 كاملة.');
  }
  return problems;
}

function auditRecord(fields, FieldValue) {
  return {
    ...fields,
    at: FieldValue.serverTimestamp(),
    atIso: new Date().toISOString(),
  };
}

// ─── الإصدار ─────────────────────────────────────────────────────────────
/**
 * Issues one document.
 *
 * The caller supplies the type, the date, the lines and (for a note) the
 * reason. Everything that could be forged — the number, the sequence, the
 * totals, the issuer, the seller identity — is produced here.
 */
export async function issueDocument(db, FieldValue, input = {}, { userId = null } = {}) {
  const type = String(input.type || 'invoice');
  if (!DOCUMENT_TYPES.includes(type)) {
    throw new InvoicingError(`نوع المستند غير معروف: ${type}`, { code: 'invalid-argument' });
  }
  const issueDate = String(input.issueDate ?? '').slice(0, 10);
  if (!isRealDate(issueDate)) {
    throw new InvoicingError('تاريخ إصدار المستند غير صالح.', { code: 'invalid-argument' });
  }
  const issueTime = /^\d{2}:\d{2}(:\d{2})?$/.test(String(input.issueTime || ''))
    ? String(input.issueTime).padEnd(8, ':00').slice(0, 8)
    : '00:00:00';
  const problems = lineProblems(input.lines);
  if (problems.length) throw new InvoicingError(problems[0], { code: 'invalid-argument' });

  const reason = String(input.reason || '').trim();
  if (type !== 'invoice' && !reason) {
    throw new InvoicingError('سبب الإشعار مطلوب.', { code: 'invalid-argument' });
  }
  // A note names the DOCUMENT it adjusts, not a number. `referenceNumber` from
  // a caller is just a string: it could name an invoice that does not exist,
  // or someone else's. The id is read inside the transaction and the number is
  // derived from what was actually found.
  const referenceDocumentId = input.referenceDocumentId
    ? String(input.referenceDocumentId).trim() : '';
  if (type !== 'invoice' && !referenceDocumentId) {
    throw new InvoicingError('الإشعار يجب أن يشير إلى فاتورة قائمة.', { code: 'invalid-argument' });
  }

  const priceMode = input.priceMode === 'exclusive' ? 'exclusive' : 'inclusive';
  const year = Number(issueDate.slice(0, 4));
  const sourceType = input.sourceType ? String(input.sourceType) : null;
  const sourceId = input.sourceId ? String(input.sourceId) : null;

  return db.runTransaction(async (tx) => {
    // ══ reads ══
    const settingsRef = db.collection(DOC_COL.SETTINGS).doc('company');
    const counterRef  = db.collection(DOC_COL.COUNTERS).doc(counterIdFor(type, year));
    const claimRef = sourceType && sourceId
      ? db.collection(DOC_COL.SOURCES).doc(sourceClaimId(sourceType, sourceId))
      : null;

    const referenceRef = referenceDocumentId
      ? db.collection(DOC_COL.DOCUMENTS).doc(referenceDocumentId) : null;

    const [settingsSnap, counterSnap, claimSnap, referenceSnap] = await Promise.all([
      tx.get(settingsRef), tx.get(counterRef),
      claimRef ? tx.get(claimRef) : Promise.resolve(null),
      referenceRef ? tx.get(referenceRef) : Promise.resolve(null),
    ]);

    // ── the reference, read rather than trusted ──
    let referenceNumber = null;
    let reference = null;
    if (referenceRef) {
      if (!referenceSnap.exists) {
        throw new InvoicingError('الفاتورة المرجعية غير موجودة.', { code: 'not-found' });
      }
      reference = referenceSnap.data();
      if (reference.type !== 'invoice') {
        throw new InvoicingError('الإشعار يصدر مقابل فاتورة فقط.', { code: 'invalid-argument' });
      }
      // Derived from the document that was found, so a forged
      // `referenceNumber` in the payload changes nothing.
      referenceNumber = reference.documentNumber;
    }

    if (claimSnap?.exists) {
      const prev = claimSnap.data();
      throw new InvoicingError(
        `سبق إصدار مستند لهذا السجل: ${prev.documentNumber}. استخدم إشعاراً دائناً أو مديناً للتعديل.`,
        { code: 'already-exists' },
      );
    }

    // The seller block comes from settings, never from the payload: a client
    // that could name its own VAT number could sign a QR with someone else's.
    const company = settingsSnap.exists ? (settingsSnap.data().value || settingsSnap.data()) : {};
    const seller = {
      name: String(company.name || 'شركة هادي الغانم'),
      vatNumber: String(company.vatNumber || ''),
      address: String(company.address || ''),
    };
    const taxable = Boolean(company.vatRegistered && company.vatNumber);

    const totals = totalsFromLines(input.lines, { priceMode, taxable });
    if (!Number.isFinite(totals.gross) || !(totals.gross > 0)) {
      throw new InvoicingError('إجمالي المستند يجب أن يكون أكبر من صفر.', { code: 'invalid-argument' });
    }

    // ── سياسة عدم تجاوز الأصل ──
    // A credit note reverses part or all of an invoice, so the credits
    // against one invoice cannot exceed it. Letting them would turn a
    // correction into a negative sale — output tax reclaimed on revenue that
    // was never earned. The check reads what has already been credited rather
    // than trusting a running total on the invoice.
    if (type === 'credit_note' && reference) {
      const priorSnap = await tx.get(
        db.collection(DOC_COL.DOCUMENTS)
          .where('type', '==', 'credit_note')
          .where('referenceNumber', '==', referenceNumber),
      );
      const alreadyCredited = priorSnap.docs
        .filter((x) => x.data().status !== 'cancelled')
        .reduce((sum, x) => sum + (Number(x.data().gross) || 0), 0);
      const invoiceGross = Number(reference.gross) || 0;
      const remaining = round2(invoiceGross - alreadyCredited);
      if (totals.gross > remaining + 0.005) {
        throw new InvoicingError(
          `الإشعار الدائن (${totals.gross.toFixed(2)}) يتجاوز المتبقي من الفاتورة `
          + `${referenceNumber} (${remaining.toFixed(2)} من ${invoiceGross.toFixed(2)}). `
          + 'الإشعار يعكس الفاتورة ولا يزيد عليها.',
          { code: 'failed-precondition' },
        );
      }
    }

    const timestamp = `${issueDate}T${issueTime}`;
    let qrPayload = null;
    if (taxable) {
      const problems = qrProblems({ ...seller, sellerName: seller.name, timestamp });
      if (problems.length) throw new InvoicingError(problems[0], { code: 'failed-precondition' });
      qrPayload = buildQrPayload({
        sellerName: seller.name, vatNumber: seller.vatNumber,
        timestamp, total: totals.gross, vatAmount: totals.vat,
      });
    }

    const sequence = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const documentNumber = formatDocumentNumber(type, year, sequence);

    // ══ writes ══
    const ref = db.collection(DOC_COL.DOCUMENTS).doc();
    tx.set(ref, {
      type, status: 'issued',
      documentNumber, sequence, year,
      issueDate, issueTime, timestamp,
      seller, taxable, priceMode,
      customer: input.customer?.name ? { name: String(input.customer.name).slice(0, 200) } : null,
      lines: totals.lines,
      net: totals.net, vat: totals.vat, gross: totals.gross,
      referenceNumber, reason: reason || null,
      sourceType, sourceId,
      qrPayload,
      zatcaReported: false,
      issuedBy: userId,
      issuedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef, {
      nextNumber: sequence + 1, type, year, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (claimRef) {
      tx.set(claimRef, {
        sourceType, sourceId, documentId: ref.id, documentNumber,
        at: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'issue', collectionName: DOC_COL.DOCUMENTS, documentId: ref.id,
      userId, before: null,
      after: { documentNumber, gross: totals.gross, vat: totals.vat },
      note: `إصدار ${documentNumber}`,
    }, FieldValue));

    return {
      id: ref.id, documentNumber, sequence, year, qrPayload,
      net: totals.net, vat: totals.vat, gross: totals.gross,
    };
  });
}

/**
 * Voids an issued document.
 *
 * Voiding records the intent; the accounting effect still has to come from a
 * credit note. The document itself is never removed — its number stays spoken
 * for, because a gap in a tax series is what an audit asks about.
 */
export async function voidDocument(db, FieldValue, { documentId, reason }, { userId = null } = {}) {
  const why = String(reason || '').trim();
  if (!why) throw new InvoicingError('سبب الإلغاء مطلوب.', { code: 'invalid-argument' });
  const id = String(documentId || '').trim();
  if (!id) throw new InvoicingError('معرّف المستند مطلوب.', { code: 'invalid-argument' });

  return db.runTransaction(async (tx) => {
    const ref = db.collection(DOC_COL.DOCUMENTS).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new InvoicingError('المستند غير موجود.', { code: 'not-found' });
    const doc = snap.data();
    if (doc.status === 'cancelled') {
      throw new InvoicingError('المستند ملغى بالفعل.', { code: 'already-exists' });
    }

    tx.update(ref, {
      status: 'cancelled', voidReason: why,
      voidedBy: userId, voidedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'void', collectionName: DOC_COL.DOCUMENTS, documentId: id, userId,
      before: { status: doc.status }, after: { status: 'cancelled' },
      note: `إلغاء ${doc.documentNumber} — ${why}`,
    }, FieldValue));

    return { id, documentNumber: doc.documentNumber };
  });
}
