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

import {
  round2, isRealDate, isValidPeriodKey, normalizeTimeOfDay, periodKeyOf,
  normalizeLines, validateEntry, totalsOf,
} from './invariants.js';
import { splitVat, VAT_RATE, ACC, settlementForSale } from './posting.js';

export const DOC_COL = {
  DOCUMENTS: 'sales_documents',
  SOURCES:   'sales_document_sources',
  COUNTERS:  'counters',
  AUDIT:     'audit_logs',
  SETTINGS:  'app_settings',
  ENTRIES:   'journal_entries',
  PERIODS:   'accounting_periods',
};
const JOURNAL_COUNTER = 'journal';

/**
 * The journal entry a NOTE produces.
 *
 * An invoice does not get one: the sale it documents was already posted from
 * its wash, and posting it again would double the revenue. A note has no other
 * source — it IS the adjustment — so without an entry it changes nothing at
 * all, which is exactly the state this fixes.
 *
 *   إشعار دائن   مدين مردودات المبيعات (بالصافي)
 *                مدين ضريبة المخرجات   (بالضريبة المعكوسة)
 *                دائن الصندوق/البنك/العميل (بالإجمالي)
 *
 *   إشعار مدين   مدين الصندوق/البنك/العميل
 *                دائن الإيراد
 *                دائن ضريبة المخرجات
 */
export function buildNoteLines(type, totals, settlementAccount) {
  const lines = [];
  if (type === 'credit_note') {
    lines.push({ accountId: ACC.SALES_RETURNS, debit: totals.net, credit: 0, description: 'مردودات مبيعات' });
    if (totals.vat > 0) {
      lines.push({ accountId: ACC.OUTPUT_VAT, debit: totals.vat, credit: 0, description: 'عكس ضريبة مخرجات' });
    }
    lines.push({ accountId: settlementAccount, debit: 0, credit: totals.gross, description: 'رد للعميل' });
    return lines;
  }
  lines.push({ accountId: settlementAccount, debit: totals.gross, credit: 0, description: 'تحصيل فرق' });
  lines.push({ accountId: ACC.WASH_REVENUE, debit: 0, credit: totals.net, description: 'إيراد إضافي' });
  if (totals.vat > 0) {
    lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: totals.vat, description: 'ضريبة مخرجات 15%' });
  }
  return lines;
}

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
  // 25:70 used to sail through a `\d{2}:\d{2}` test and ride into the QR
  // timestamp as a value no reader can parse.
  const issueTime = normalizeTimeOfDay(input.issueTime);
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

  const year = Number(issueDate.slice(0, 4));
  const periodKey = periodKeyOf(issueDate);
  if (!isValidPeriodKey(periodKey)) {
    throw new InvoicingError('تاريخ الإصدار لا ينتمي لفترة صالحة.', { code: 'invalid-argument' });
  }

  // A note posts a journal entry, so its accounts have to exist. Read before
  // the transaction: a collection read inside one would be a query, and the
  // answer cannot change in a way that matters here.
  let knownAccountCodes = null;
  if (type !== 'invoice') {
    const chart = await db.collection('chart_of_accounts').get();
    knownAccountCodes = new Set(chart.docs.map((d) => d.id));
    if (knownAccountCodes.size === 0) {
      throw new InvoicingError('دليل الحسابات غير مُهيّأ — هيّئه قبل إصدار الإشعارات.');
    }
  }

  // Only an INVOICE claims a source record. A note is an adjustment to a
  // document, not a second document for the same wash, so it must not take
  // the claim — that would block the very note that corrects it.
  const claimType = type === 'invoice' && input.sourceType ? String(input.sourceType) : null;
  const claimId = type === 'invoice' && input.sourceId ? String(input.sourceId) : null;

  return db.runTransaction(async (tx) => {
    // ══ reads ══
    const settingsRef = db.collection(DOC_COL.SETTINGS).doc('company');
    const counterRef  = db.collection(DOC_COL.COUNTERS).doc(counterIdFor(type, year));
    const claimRef = claimType && claimId
      ? db.collection(DOC_COL.SOURCES).doc(sourceClaimId(claimType, claimId))
      : null;

    const referenceRef = referenceDocumentId
      ? db.collection(DOC_COL.DOCUMENTS).doc(referenceDocumentId) : null;

    const journalCounterRef = db.collection(DOC_COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef = db.collection(DOC_COL.PERIODS).doc(periodKey);

    const [settingsSnap, counterSnap, claimSnap, referenceSnap,
      journalCounterSnap, periodSnap] = await Promise.all([
      tx.get(settingsRef), tx.get(counterRef),
      claimRef ? tx.get(claimRef) : Promise.resolve(null),
      referenceRef ? tx.get(referenceRef) : Promise.resolve(null),
      tx.get(journalCounterRef), tx.get(periodRef),
    ]);

    // A note posts into the books, so its month must be open. Checked here,
    // before a number is minted.
    const posts = type !== 'invoice';
    if (posts && periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new InvoicingError(
        `الفترة ${periodKey} مقفلة — لا يمكن إصدار إشعار فيها. اختر تاريخاً في فترة مفتوحة.`,
      );
    }

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
    const companySeller = {
      name: String(company.name || 'شركة هادي الغانم'),
      vatNumber: String(company.vatNumber || ''),
      address: String(company.address || ''),
    };

    // ── the tax treatment of a NOTE comes from its invoice ──
    // A note corrects a document that was issued under the rules of its own
    // day. If the business de-registered since, a correction to a taxable
    // invoice still carries that invoice's tax — reading today's setting
    // would silently drop VAT the authority was already told about. So the
    // rate, the taxability and the pricing mode are inherited, and any value
    // the caller sent for them is ignored.
    const taxable = reference ? Boolean(reference.taxable) : Boolean(company.vatRegistered && company.vatNumber);
    const vatRate = reference
      ? (Number.isFinite(Number(reference.vatRate)) ? Number(reference.vatRate) : VAT_RATE)
      : VAT_RATE;
    const priceMode = reference
      ? (reference.priceMode === 'exclusive' ? 'exclusive' : 'inclusive')
      : (input.priceMode === 'exclusive' ? 'exclusive' : 'inclusive');
    const seller = reference?.seller?.vatNumber ? reference.seller : companySeller;
    const customer = reference
      ? (reference.customer || null)
      : (input.customer?.name ? { name: String(input.customer.name).slice(0, 200) } : null);
    const sourceType = reference ? (reference.sourceType || null) : (input.sourceType ? String(input.sourceType) : null);
    const sourceId = reference ? null : (input.sourceId ? String(input.sourceId) : null);

    const totals = totalsFromLines(input.lines, { priceMode, taxable, rate: vatRate });
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

    // ── the note's journal entry, built and validated BEFORE any write ──
    // A note that only writes `sales_documents` changes nothing: revenue and
    // output tax stay exactly where the invoice left them, and the VAT report
    // keeps showing the original sale in full. Document and entry are written
    // in this one transaction, so neither can exist without the other.
    const ref = db.collection(DOC_COL.DOCUMENTS).doc();
    let entryRef = null;
    let entryNumber = null;
    let noteLines = null;
    if (posts) {
      // The settlement account is a decision, not a guess: the caller states
      // how the money moved, and the invoice's own method is the default.
      const method = String(input.refundMethod || input.paymentMethod
        || reference?.paymentMethod || 'cash');
      noteLines = normalizeLines(buildNoteLines(type, totals, settlementForSale(method)));
      const noteEntry = {
        entryDate: issueDate,
        periodKey,
        sourceType: 'adjustment',
        sourceId: null,
        description: `${type === 'credit_note' ? 'إشعار دائن' : 'إشعار مدين'} ${documentNumber}`
          + `${referenceNumber ? ` على ${referenceNumber}` : ''} — ${reason}`,
        status: 'posted',
        reversalOf: null,
      };
      const entryProblems = validateEntry(noteEntry, noteLines, { knownAccountCodes });
      if (entryProblems.length) {
        throw new InvoicingError(entryProblems[0], { code: 'invalid-argument' });
      }
      entryNumber = journalCounterSnap.exists
        ? (Number(journalCounterSnap.data().nextNumber) || 1) : 1;
      entryRef = db.collection(DOC_COL.ENTRIES).doc();
      const entryTotals = totalsOf(noteLines);

      // ══ writes ══
      tx.set(entryRef, {
        ...noteEntry,
        entryNumber,
        lines: noteLines,
        lineCount: noteLines.length,
        totalDebit: entryTotals.debit,
        totalCredit: entryTotals.credit,
        // The two point at each other, so neither is an orphan.
        documentId: ref.id,
        documentNumber,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
        postedAt: FieldValue.serverTimestamp(),
      });
      if (!periodSnap.exists) {
        tx.set(periodRef, {
          periodKey, status: 'open', closedAt: null, closedBy: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(journalCounterRef, {
        nextNumber: entryNumber + 1, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.set(ref, {
      type, status: 'issued',
      documentNumber, sequence, year,
      issueDate, issueTime, timestamp,
      seller, taxable, priceMode,
      customer,
      lines: totals.lines,
      net: totals.net, vat: totals.vat, gross: totals.gross,
      referenceNumber, referenceDocumentId: referenceDocumentId || null,
      reason: reason || null,
      sourceType, sourceId,
      // Stored explicitly rather than assumed to be 15% forever: a rate change
      // must not restate what a filed document said.
      vatRate,
      qrPayload,
      zatcaReported: false,
      // Null for an invoice, which documents an already-posted wash.
      journalEntryId: entryRef ? entryRef.id : null,
      journalEntryNumber: entryNumber,
      issuedBy: userId,
      issuedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef, {
      nextNumber: sequence + 1, type, year, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (claimRef) {
      tx.set(claimRef, {
        sourceType: claimType, sourceId: claimId, documentId: ref.id, documentNumber,
        at: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'issue', collectionName: DOC_COL.DOCUMENTS, documentId: ref.id,
      userId, before: null,
      after: {
        documentNumber, gross: totals.gross, vat: totals.vat,
        journalEntryId: entryRef ? entryRef.id : null,
      },
      note: `إصدار ${documentNumber}${entryNumber ? ` — قيد رقم ${entryNumber}` : ''}`,
    }, FieldValue));

    return {
      id: ref.id, documentNumber, sequence, year, qrPayload, vatRate,
      net: totals.net, vat: totals.vat, gross: totals.gross,
      journalEntryId: entryRef ? entryRef.id : null,
      journalEntryNumber: entryNumber,
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
export async function voidDocument(db, FieldValue, { documentId, reason, entryDate }, { userId = null } = {}) {
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

    // ── a document with an accounting effect cannot just be marked void ──
    // Cancelling the paper while its entry stays posted would leave revenue
    // and output tax reduced by a note the register says never happened. The
    // entry is REVERSED in this same transaction, so the two move together.
    let reversalRef = null;
    let reversalNumber = null;
    if (doc.journalEntryId) {
      const entryRef = db.collection(DOC_COL.ENTRIES).doc(doc.journalEntryId);
      const counterRef = db.collection(DOC_COL.COUNTERS).doc(JOURNAL_COUNTER);
      const [entrySnap, counterSnap] = await Promise.all([tx.get(entryRef), tx.get(counterRef)]);
      if (!entrySnap.exists) {
        throw new InvoicingError('قيد المستند غير موجود — راجعه قبل الإلغاء.', { code: 'not-found' });
      }
      const entry = entrySnap.data();
      if (entry.status !== 'posted') {
        throw new InvoicingError('قيد المستند غير مُرحّل — لا يمكن عكسه.');
      }
      const date = String(entryDate || '').slice(0, 10) || entry.entryDate;
      if (!isRealDate(date)) {
        throw new InvoicingError('تاريخ العكس غير صالح.', { code: 'invalid-argument' });
      }
      const revPeriod = periodKeyOf(date);
      const revPeriodRef = db.collection(DOC_COL.PERIODS).doc(revPeriod);
      const revPeriodSnap = await tx.get(revPeriodRef);
      if (revPeriodSnap.exists && revPeriodSnap.data().status === 'closed') {
        throw new InvoicingError(`الفترة ${revPeriod} مقفلة — اختر تاريخاً في فترة مفتوحة.`);
      }

      const mirror = (entry.lines || []).map((l) => ({
        accountId: l.accountId, debit: round2(l.credit), credit: round2(l.debit),
        description: l.description || '',
      }));
      const mirrorTotals = totalsOf(mirror);
      reversalNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
      reversalRef = db.collection(DOC_COL.ENTRIES).doc();

      tx.set(reversalRef, {
        entryDate: date,
        periodKey: revPeriod,
        sourceType: 'adjustment',
        sourceId: null,
        description: `عكس ${doc.documentNumber} — ${why}`,
        status: 'posted',
        reversalOf: entryRef.id,
        entryNumber: reversalNumber,
        lines: mirror,
        lineCount: mirror.length,
        totalDebit: mirrorTotals.debit,
        totalCredit: mirrorTotals.credit,
        documentId: id,
        documentNumber: doc.documentNumber,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
        postedAt: FieldValue.serverTimestamp(),
      });
      tx.update(entryRef, {
        status: 'reversed', reversedBy: reversalRef.id, reversedAt: FieldValue.serverTimestamp(),
      });
      if (!revPeriodSnap.exists) {
        tx.set(revPeriodRef, {
          periodKey: revPeriod, status: 'open', closedAt: null, closedBy: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(counterRef, {
        nextNumber: reversalNumber + 1, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.update(ref, {
      status: 'cancelled', voidReason: why,
      voidedBy: userId, voidedAt: FieldValue.serverTimestamp(),
      reversalEntryId: reversalRef ? reversalRef.id : null,
    });
    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'void', collectionName: DOC_COL.DOCUMENTS, documentId: id, userId,
      before: { status: doc.status, journalEntryId: doc.journalEntryId || null },
      after: { status: 'cancelled', reversalEntryId: reversalRef ? reversalRef.id : null },
      note: `إلغاء ${doc.documentNumber} — ${why}`
        + (reversalNumber ? ` (عكس بقيد رقم ${reversalNumber})` : ''),
    }, FieldValue));

    return {
      id, documentNumber: doc.documentNumber,
      reversalEntryId: reversalRef ? reversalRef.id : null,
      reversalEntryNumber: reversalNumber,
    };
  });
}
