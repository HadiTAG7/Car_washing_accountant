// ═══════════════════════════════════════════════════════════════════════════
// الفوترة — invoices, credit/debit notes, and the ZATCA QR payload
// ═══════════════════════════════════════════════════════════════════════════
// Pure logic only. Numbering and persistence live in firestoreInvoicing.js,
// because a sequential number must be minted inside a transaction.
//
// ⚠️ ZATCA: this module produces the QR payload that a Phase-1 simplified
// invoice must carry, and nothing more. It does NOT sign, clear, or report
// anything to the authority. See `INTEGRATION_STATUS` at the bottom and
// `zatcaIntegration.js` for the boundary where a real integration attaches.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal';
import { splitVatBalanced, VAT_RATE } from './vat';

export const DOCUMENT_TYPES = ['invoice', 'credit_note', 'debit_note'];
export const DOCUMENT_STATUSES = ['draft', 'issued', 'cancelled'];

export const DOCUMENT_TYPE_LABELS = {
  invoice:     'فاتورة',
  credit_note: 'إشعار دائن',
  debit_note:  'إشعار مدين',
};
// Series prefixes keep the three sequences visually distinct on paper.
export const DOCUMENT_PREFIX = { invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' };

/** 'INV-2026-000042' — year-scoped so a sequence restarts cleanly each year. */
export function formatDocumentNumber(type, year, sequence) {
  const prefix = DOCUMENT_PREFIX[type] || 'DOC';
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Totals a set of lines into { net, vat, gross }.
 *
 * Rounding happens per LINE and the totals are the sum of rounded lines, so
 * the printed document adds up exactly as a reader would add it — a total
 * rounded independently of its lines is the classic "invoice is out by one
 * halala" complaint.
 */
export function invoiceTotals(lines, { priceMode = 'inclusive', taxable = true, rate = VAT_RATE } = {}) {
  let net = 0, vat = 0, gross = 0;
  const priced = (lines || []).map((l) => {
    const qty = Number(l.quantity) || 0;
    const amount = round2(qty * (Number(l.unitPrice) || 0));
    const s = splitVatBalanced(amount, { mode: priceMode, taxable, rate });
    net += s.net; vat += s.vat; gross += s.gross;
    return { ...l, lineNet: s.net, lineVat: s.vat, lineGross: s.gross };
  });
  return { lines: priced, net: round2(net), vat: round2(vat), gross: round2(gross) };
}

// ─── ZATCA Phase-1 QR (TLV, base64) ──────────────────────────────────────
// The simplified-invoice QR carries five mandatory tags, each encoded as
// Tag(1 byte) + Length(1 byte) + UTF-8 Value:
//   1 seller name · 2 VAT registration number · 3 timestamp (ISO-8601)
//   4 invoice total (VAT-inclusive) · 5 VAT amount
// Phase-2 adds signature tags 6–9; those are NOT produced here because they
// require a cryptographic stamp obtained from ZATCA onboarding.

function utf8Bytes(str) {
  return new TextEncoder().encode(String(str ?? ''));
}

/** One TLV triplet. Values longer than 255 bytes are rejected, not truncated. */
export function tlv(tag, value) {
  const bytes = utf8Bytes(value);
  if (bytes.length > 255) {
    throw new Error(`قيمة الوسم ${tag} أطول من 255 بايت — لا يمكن ترميزها في رمز QR.`);
  }
  const out = new Uint8Array(2 + bytes.length);
  out[0] = tag; out[1] = bytes.length; out.set(bytes, 2);
  return out;
}

// btoa/atob operate on Latin-1 "binary strings" — one char per byte — which
// is exactly the shape of a TLV buffer, and they exist in both the browser and
// Node, so no environment branching is needed here.
function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Builds the base64 TLV payload for a simplified invoice QR.
 *
 * `timestamp` must be a full ISO-8601 instant — ZATCA reads a date+time, and
 * a bare date would be rejected by a validating reader.
 */
export function buildZatcaQrPayload({ sellerName, vatNumber, timestamp, total, vatAmount }) {
  const problems = validateQrFields({ sellerName, vatNumber, timestamp, total, vatAmount });
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  const parts = [
    tlv(1, sellerName),
    tlv(2, vatNumber),
    tlv(3, timestamp),
    tlv(4, Number(total).toFixed(2)),
    tlv(5, Number(vatAmount).toFixed(2)),
  ];
  const size = parts.reduce((s, p) => s + p.length, 0);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) { merged.set(p, offset); offset += p.length; }
  return toBase64(merged);
}

/** Arabic problems with the QR inputs; empty array = ready to encode. */
export function validateQrFields({ sellerName, vatNumber, timestamp, total, vatAmount }) {
  const problems = [];
  if (!String(sellerName || '').trim()) problems.push('اسم المورّد مطلوب في رمز QR.');
  // KSA VAT numbers are 15 digits, starting and ending with 3.
  const vat = String(vatNumber || '').trim();
  if (!/^\d{15}$/.test(vat)) problems.push('الرقم الضريبي يجب أن يكون 15 رقماً.');
  else if (!vat.startsWith('3') || !vat.endsWith('3')) problems.push('الرقم الضريبي السعودي يبدأ وينتهي بالرقم 3.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(timestamp || ''))) {
    problems.push('الطابع الزمني يجب أن يكون بصيغة ISO-8601 كاملة (تاريخ ووقت).');
  }
  if (!Number.isFinite(Number(total)) || Number(total) < 0) problems.push('إجمالي الفاتورة غير صالح.');
  if (!Number.isFinite(Number(vatAmount)) || Number(vatAmount) < 0) problems.push('مبلغ الضريبة غير صالح.');
  return problems;
}

/** Decodes a payload back to { tag: value } — used by the tests and a viewer. */
export function decodeZatcaQrPayload(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const out = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    out[tag] = new TextDecoder().decode(bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

/**
 * Assembles a simplified B2C invoice document (not yet numbered — the
 * transaction assigns that).
 */
export function buildSimplifiedInvoice({
  type = 'invoice', issueDate, issueTime, lines, seller, customer = null,
  priceMode = 'inclusive', taxable = true, sourceType = null, sourceId = null,
  referenceNumber = null, reason = null,
}) {
  const totals = invoiceTotals(lines, { priceMode, taxable });
  const timestamp = `${issueDate}T${issueTime || '00:00:00'}`;
  return {
    type,
    status: 'draft',
    issueDate,
    issueTime: issueTime || '00:00:00',
    timestamp,
    seller: {
      name: seller?.name || '',
      vatNumber: seller?.vatNumber || '',
      address: seller?.address || '',
    },
    customer,
    priceMode,
    taxable,
    lines: totals.lines,
    net:   totals.net,
    vat:   totals.vat,
    gross: totals.gross,
    // A credit/debit note must point at the invoice it adjusts, and say why.
    referenceNumber,
    reason,
    sourceType,
    sourceId,
  };
}

/**
 * إشعار دائن — reverses part or all of an issued invoice (a return, a
 * discount, a cancellation). Amounts stay POSITIVE; the document type is what
 * carries the direction, which is how a tax authority expects to read it.
 */
export function buildCreditNote(invoice, { issueDate, issueTime, lines = null, reason }) {
  if (!reason || !String(reason).trim()) {
    throw new Error('سبب الإشعار الدائن مطلوب.');
  }
  return buildSimplifiedInvoice({
    type: 'credit_note',
    issueDate,
    issueTime,
    lines: lines || invoice.lines,
    seller: invoice.seller,
    customer: invoice.customer,
    priceMode: invoice.priceMode,
    taxable: invoice.taxable,
    referenceNumber: invoice.documentNumber,
    reason,
  });
}

/** إشعار مدين — increases an already-issued invoice (an undercharge). */
export function buildDebitNote(invoice, { issueDate, issueTime, lines, reason }) {
  if (!reason || !String(reason).trim()) {
    throw new Error('سبب الإشعار المدين مطلوب.');
  }
  return buildSimplifiedInvoice({
    type: 'debit_note',
    issueDate,
    issueTime,
    lines,
    seller: invoice.seller,
    customer: invoice.customer,
    priceMode: invoice.priceMode,
    taxable: invoice.taxable,
    referenceNumber: invoice.documentNumber,
    reason,
  });
}

/**
 * The sign a document contributes to a VAT return: a credit note reduces
 * output tax, a debit note increases it.
 */
export function documentSign(type) {
  return type === 'credit_note' ? -1 : 1;
}

/**
 * What this codebase actually does, stated plainly so no one mistakes the QR
 * for compliance. Surfaced in the UI.
 */
export const INTEGRATION_STATUS = {
  phase1QrPayload: 'implemented',   // TLV base64, tags 1–5
  invoiceNumbering: 'implemented',  // transactional, per type and year
  creditDebitNotes: 'implemented',
  cryptographicStamp: 'not_implemented',
  invoiceHashChain:  'not_implemented',
  clearanceApi:      'not_implemented',   // standard (B2B) invoices
  reportingApi:      'not_implemented',   // simplified (B2C) invoices
  onboarding:        'not_implemented',   // CSR / compliance certificate
  note: 'رمز QR للفاتورة المبسطة (المرحلة الأولى) مُنفّذ. لا يوجد أي اتصال '
      + 'بمنصة فاتورة: لا ختم تشفيري ولا تسلسل تجزئة ولا إرسال أو مطابقة. '
      + 'اعتبر المستندات هنا وثائق داخلية حتى يُنفَّذ التكامل.',
};
