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
  normalizeLines, validateEntry, totalsOf, postingLockId, MONEY_EPSILON,
} from './invariants.js';
import { splitVat, VAT_RATE, ACC, settlementForSale, ADAPTERS } from './posting.js';
import { taxPolicyAt } from './taxPolicy.js';

export const DOC_COL = {
  DOCUMENTS: 'sales_documents',
  SOURCES:   'sales_document_sources',
  COUNTERS:  'counters',
  AUDIT:     'audit_logs',
  SETTINGS:  'app_settings',
  ENTRIES:   'journal_entries',
  PERIODS:   'accounting_periods',
  LOCKS:     'posting_locks',
};
const JOURNAL_COUNTER = 'journal';

// ─── المسارات الثلاثة للإصدار ────────────────────────────────────────────
/**
 * Which of the three issuing paths a payload is asking for.
 *
 * The old code had one rule — "an invoice never posts, because the wash behind
 * it was already posted" — and that rule is only true for one of the three
 * things this function is asked to issue. The documents page issues invoices
 * from free-typed lines with no wash and no source record at all: under the
 * old rule those sales never reached the books, so a credit note against one
 * debited مردودات المبيعات and created NEGATIVE revenue out of nothing.
 *
 *   linked      فاتورة لغسلة مُرحّلة — the caller sends `washId` and the server
 *               reads the wash, its posting lock and its posted entry. The
 *               invoice DOCUMENTS that entry; it must not create a second one.
 *   standalone  فاتورة بيع مستقلة — no operational record behind it, so the
 *               invoice IS the source: document and sales entry are written in
 *               one transaction.
 *   note        إشعار دائن/مدين — always posts, and only against an invoice
 *               that has a real ledger effect to adjust.
 */
export const ISSUE_MODES = ['linked', 'standalone', 'note'];

export function issueModeFor(input = {}) {
  const type = String(input.type || 'invoice');
  if (type !== 'invoice') return 'note';
  return String(input.washId ?? '').trim() ? 'linked' : 'standalone';
}

/** How a standalone sale may be settled. */
export const SALE_PAYMENT_METHODS = ['cash', 'card', 'transfer', 'credit'];
export const SALE_PAYMENT_STATUSES = ['paid', 'unpaid'];

/**
 * The account the money of a sale lands in.
 *
 * An UNPAID sale is a receivable whatever instrument was named on it: "sold on
 * card, not yet collected" is still a balance the customer owes, and debiting
 * the bank for it would overstate cash.
 */
export function saleSettlementAccount(method, paymentStatus) {
  if (paymentStatus === 'unpaid') return ACC.RECEIVABLE;
  return settlementForSale(method);
}

/**
 * The journal entry a STANDALONE invoice produces.
 *
 *   مدين الصندوق/البنك/العميل   بالإجمالي
 *   دائن إيراد المبيعات          بالصافي
 *   دائن ضريبة المخرجات          بالضريبة
 */
export function buildSaleLines(totals, settlementAccount, rate = VAT_RATE) {
  const lines = [
    { accountId: settlementAccount, debit: totals.gross, credit: 0, description: 'قيمة الفاتورة' },
    { accountId: ACC.WASH_REVENUE, debit: 0, credit: totals.net, description: 'إيراد مبيعات' },
  ];
  if (totals.vat > 0) {
    // The rate is written on the line. `ضريبة مخرجات 15%` on a 5% entry is a
    // description that contradicts its own amount.
    lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: totals.vat, description: vatLineLabel(rate) });
  }
  return lines;
}

/**
 * Reads { net, vat, gross } and the settlement account back OUT of a posted
 * sales entry.
 *
 * The invoice for a wash must print the figures the books already hold, not a
 * second opinion computed from the same inputs. Anything that is neither
 * revenue nor output tax is the settlement side, which is what `gross` means
 * on a sale.
 */
/** `ضريبة مخرجات 15%` — the rate is stated, never assumed by the reader. */
export function vatLineLabel(rate, { side = 'output' } = {}) {
  const pct = Number(rate) * 100;
  const shown = Number.isFinite(pct)
    ? (Math.abs(pct - Math.round(pct)) < 0.005 ? String(Math.round(pct)) : pct.toFixed(2))
    : '—';
  return `${side === 'input' ? 'ضريبة مدخلات' : 'ضريبة مخرجات'} ${shown}%`;
}

/**
 * The tax treatment a posted SALES entry was made under.
 *
 * `postSource` freezes a `taxSnapshot` onto the entry, and that is the answer.
 * For entries written before the snapshot existed the treatment is DERIVED
 * from the lines — and derived exactly, or refused: a rate that cannot be
 * reproduced from the numbers is a rate nobody knows, and assuming 15% would
 * print a tax invoice claiming a figure the ledger never agreed to.
 */
export function saleTaxTreatmentOfEntry(entry) {
  const snap = entry?.taxSnapshot;
  // `snap.vatRate != null` first: `Number(null)` is 0, so a snapshot with an
  // unset rate would claim the sale was 0%-rated instead of falling through
  // to the lines. Same trap as the purchase-side one in vatFields.js.
  if (snap && snap.vatRate != null && Number.isFinite(Number(snap.vatRate))) {
    return {
      known: true, source: 'snapshot',
      taxable: Boolean(snap.vatRegistered) && Number(snap.vat) > 0,
      vatRate: Number(snap.vatRate),
      priceMode: snap.washPriceMode === 'exclusive' ? 'exclusive' : 'inclusive',
    };
  }
  const totals = saleTotalsOfEntry(entry?.lines);
  if (!(totals.gross > 0)) return { known: false, reason: 'قيد بلا قيمة' };
  if (totals.vat === 0) {
    // No output-tax line: the sale was not taxable. Unambiguous.
    return { known: true, source: 'lines', taxable: false, vatRate: 0, priceMode: 'inclusive' };
  }
  if (!(totals.net > 0)) return { known: false, reason: 'قيد بضريبة بلا صافي' };

  // vat / net is the rate, to four decimals. It is then CHECKED by rebuilding
  // the split both ways round: whichever pricing mode reproduces the entry to
  // the halala is the one the sale was quoted in, and if neither does the
  // treatment is not recoverable.
  const derived = Math.round((totals.vat / totals.net) * 10_000) / 10_000;
  if (!(derived > 0) || derived >= 1) return { known: false, reason: 'نسبة غير قابلة للاشتقاق' };
  for (const priceMode of ['inclusive', 'exclusive']) {
    const base = priceMode === 'inclusive' ? totals.gross : totals.net;
    const s = splitVat(base, { mode: priceMode, taxable: true, rate: derived });
    if (Math.abs(s.net - totals.net) < MONEY_EPSILON
      && Math.abs(s.vat - totals.vat) < MONEY_EPSILON
      && Math.abs(s.gross - totals.gross) < MONEY_EPSILON) {
      return { known: true, source: 'lines', taxable: true, vatRate: derived, priceMode };
    }
  }
  return { known: false, reason: 'المعالجة الضريبية غير قابلة للاشتقاق من سطور القيد' };
}

/**
 * The tax treatment a NOTE must inherit from the invoice it corrects.
 *
 * Three sources, in order of authority, and no fourth: the invoice's own
 * frozen `taxSnapshot`; the entry's; the entry's lines, derived and verified.
 * `reference.vatRate` is deliberately NOT one of them on its own — a stored
 * rate that the entry does not reproduce is a rate that disagrees with the
 * books, and a correction has to follow the books.
 */
export function referenceTaxTreatment(reference, entry) {
  const snap = reference?.taxSnapshot;
  // `snap.vatRate != null` first: `Number(null)` is 0, so a snapshot with an
  // unset rate would claim the sale was 0%-rated instead of falling through
  // to the lines. Same trap as the purchase-side one in vatFields.js.
  if (snap && snap.vatRate != null && Number.isFinite(Number(snap.vatRate))) {
    return {
      known: true, source: 'reference-snapshot',
      taxable: Boolean(snap.vatRegistered) && Number(snap.vat) > 0,
      vatRate: Number(snap.vatRate),
      priceMode: snap.washPriceMode === 'exclusive' ? 'exclusive' : 'inclusive',
    };
  }
  const fromEntry = saleTaxTreatmentOfEntry(entry);
  if (fromEntry.known) {
    return { ...fromEntry, source: `reference-entry-${fromEntry.source}` };
  }
  return { known: false, reason: fromEntry.reason || 'لا لقطة ضريبية ولا قيد قابل للاشتقاق' };
}

export function saleTotalsOfEntry(lines) {
  let net = 0, vat = 0, gross = 0;
  let settlementAccount = null;
  for (const l of lines || []) {
    const code = String(l?.accountId ?? '');
    const movement = round2(l?.credit) - round2(l?.debit);
    if (code === ACC.WASH_REVENUE || code === ACC.SALES_RETURNS) net += movement;
    else if (code === ACC.OUTPUT_VAT) vat += movement;
    else {
      gross += -movement;
      if (settlementAccount == null) settlementAccount = code;
    }
  }
  return {
    net: round2(net), vat: round2(vat), gross: round2(gross), settlementAccount,
  };
}

/**
 * The journal entry a NOTE produces.
 *
 * A note has no source record — it IS the adjustment — so without an entry it
 * changes nothing at all, which is exactly the state this fixes.
 *
 *   إشعار دائن   مدين مردودات المبيعات (بالصافي)
 *                مدين ضريبة المخرجات   (بالضريبة المعكوسة)
 *                دائن الصندوق/البنك/العميل (بالإجمالي)
 *
 *   إشعار مدين   مدين الصندوق/البنك/العميل
 *                دائن الإيراد
 *                دائن ضريبة المخرجات
 */
export function buildNoteLines(type, totals, settlementAccount, rate = VAT_RATE) {
  const lines = [];
  if (type === 'credit_note') {
    lines.push({ accountId: ACC.SALES_RETURNS, debit: totals.net, credit: 0, description: 'مردودات مبيعات' });
    if (totals.vat > 0) {
      lines.push({
        accountId: ACC.OUTPUT_VAT, debit: totals.vat, credit: 0,
        description: `عكس ${vatLineLabel(rate)}`,
      });
    }
    lines.push({ accountId: settlementAccount, debit: 0, credit: totals.gross, description: 'رد للعميل' });
    return lines;
  }
  lines.push({ accountId: settlementAccount, debit: totals.gross, credit: 0, description: 'تحصيل فرق' });
  lines.push({ accountId: ACC.WASH_REVENUE, debit: 0, credit: totals.net, description: 'إيراد إضافي' });
  if (totals.vat > 0) {
    lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: totals.vat, description: vatLineLabel(rate) });
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
  const mode = issueModeFor(input);
  const washId = mode === 'linked' ? String(input.washId).trim() : '';

  // ── تاريخ الإصدار ≠ تاريخ التوريد ──
  // These are two different facts and only one of them is the document's own.
  // The linked path used to take its `issueDate` FROM the wash, which quietly
  // made every invoice for a July wash a July document: its number came out of
  // the 2026 counter for the month it was supplied in, its period followed, and
  // its QR carried a timestamp for a moment the invoice did not exist. A wash
  // on 31 July invoiced on 12 August is an AUGUST document for a JULY supply,
  // and both dates belong on it.
  //
  // So `issueDate` is always the caller's, on every path, and always validated.
  const issueDate = String(input.issueDate ?? '').slice(0, 10);
  if (!isRealDate(issueDate)) {
    throw new InvoicingError('تاريخ إصدار المستند مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).', { code: 'invalid-argument' });
  }
  // 25:70 used to sail through a `\d{2}:\d{2}` test and ride into the QR
  // timestamp as a value no reader can parse.
  const issueTime = normalizeTimeOfDay(input.issueTime);
  // On the linked path the lines are BUILT from the wash, so whatever the
  // caller sent is not merely unused — it never enters the calculation.
  if (mode !== 'linked') {
    const problems = lineProblems(input.lines);
    if (problems.length) throw new InvoicingError(problems[0], { code: 'invalid-argument' });
  }

  const reason = String(input.reason || '').trim();
  if (mode === 'note' && !reason) {
    throw new InvoicingError('سبب الإشعار مطلوب.', { code: 'invalid-argument' });
  }
  // A note names the DOCUMENT it adjusts, not a number. `referenceNumber` from
  // a caller is just a string: it could name an invoice that does not exist,
  // or someone else's. The id is read inside the transaction and the number is
  // derived from what was actually found.
  const referenceDocumentId = input.referenceDocumentId
    ? String(input.referenceDocumentId).trim() : '';
  if (mode === 'note' && !referenceDocumentId) {
    throw new InvoicingError('الإشعار يجب أن يشير إلى فاتورة قائمة.', { code: 'invalid-argument' });
  }

  // ── فاتورة بيع مستقلة: كيف تحرّكت النقود ──
  // A standalone invoice creates the sale in the books, so the settlement side
  // is a fact the caller has to state. Guessing "cash" would put money in a
  // drawer that never received it.
  let paymentMethod = null;
  let paymentStatus = null;
  if (mode === 'standalone') {
    paymentMethod = String(input.paymentMethod ?? '').trim();
    paymentStatus = String(input.paymentStatus ?? '').trim();
    if (!SALE_PAYMENT_METHODS.includes(paymentMethod)) {
      throw new InvoicingError(
        'طريقة السداد مطلوبة لفاتورة بيع مستقلة (نقد / شبكة / تحويل / آجل).',
        { code: 'invalid-argument' },
      );
    }
    if (!SALE_PAYMENT_STATUSES.includes(paymentStatus)) {
      throw new InvoicingError(
        'حالة السداد مطلوبة لفاتورة بيع مستقلة (مسددة أو غير مسددة).',
        { code: 'invalid-argument' },
      );
    }
    // A wash carries its own revenue into the books the moment it is posted.
    // Issuing it again down this path would post that revenue a SECOND time,
    // so the wash path is the only way to invoice one.
    if (String(input.sourceType ?? '') === 'wash') {
      throw new InvoicingError(
        'فاتورة الغسلة تُصدر بإرسال washId — لا تُصدر كفاتورة بيع مستقلة، وإلا تكرر الإيراد.',
        { code: 'invalid-argument' },
      );
    }
  }

  // Both a standalone invoice and a note write a journal entry, so their
  // accounts have to exist. Read before the transaction: a collection read
  // inside one would be a query, and the answer cannot change in a way that
  // matters here.
  const posts = mode !== 'linked';
  let knownAccountCodes = null;
  if (posts) {
    const chart = await db.collection('chart_of_accounts').get();
    knownAccountCodes = new Set(chart.docs.map((d) => d.id));
    if (knownAccountCodes.size === 0) {
      throw new InvoicingError('دليل الحسابات غير مُهيّأ — هيّئه قبل إصدار المستندات.');
    }
  }

  // Only an INVOICE claims a source record. A note is an adjustment to a
  // document, not a second document for the same wash, so it must not take
  // the claim — that would block the very note that corrects it.
  const claimType = mode === 'linked'
    ? 'wash'
    : (mode === 'standalone' && input.sourceType ? String(input.sourceType) : null);
  const claimId = mode === 'linked'
    ? washId
    : (mode === 'standalone' && input.sourceId ? String(input.sourceId) : null);

  return db.runTransaction(async (tx) => {
    // ══ reads, phase 1: the wash this invoice documents ══════════════════
    // Read FIRST, because the invoice's date — and therefore its year, its
    // counter and its period — all come out of it.
    let wash = null;
    let washEntry = null;
    let linkedEntryId = null;
    if (mode === 'linked') {
      // The collection and the lock key come from the SAME adapter the poster
      // used, so the two cannot drift apart behind a rename.
      const [washSnap, lockSnap] = await Promise.all([
        tx.get(db.collection(ADAPTERS.wash.collection).doc(washId)),
        tx.get(db.collection(DOC_COL.LOCKS).doc(postingLockId(ADAPTERS.wash.lockKind, washId))),
      ]);
      if (!washSnap.exists) {
        throw new InvoicingError('الغسلة غير موجودة.', { code: 'not-found' });
      }
      wash = washSnap.data();
      if (!ADAPTERS.wash.approved(wash)) {
        throw new InvoicingError('الغسلة غير مكتملة — لا تُصدر لها فاتورة قبل إتمامها.');
      }
      // The lock is the server-side truth about whether this wash is in the
      // books. Without it the invoice would document a sale the ledger has
      // never heard of, and a credit note against it would then invent
      // negative revenue.
      if (!lockSnap.exists) {
        throw new InvoicingError(
          'الغسلة غير مُرحّلة إلى الدفاتر — رحّلها أولاً ثم أصدر فاتورتها.',
        );
      }
      linkedEntryId = String(lockSnap.data().entryId || '');
      const entrySnap = linkedEntryId
        ? await tx.get(db.collection(DOC_COL.ENTRIES).doc(linkedEntryId)) : null;
      if (!entrySnap?.exists) {
        throw new InvoicingError('قيد الغسلة غير موجود — راجع الدفاتر قبل الإصدار.', { code: 'not-found' });
      }
      washEntry = entrySnap.data();
      if (washEntry.status !== 'posted') {
        throw new InvoicingError(
          'قيد الغسلة غير مُرحّل — لا تُصدر فاتورة لغسلة بلا أثر محاسبي قائم.',
        );
      }
    }

    // ── تاريخ التوريد ──
    // When the service was rendered. On the linked path it is the wash's own
    // date; on a standalone sale the caller may state one and it defaults to
    // the issue date; a note inherits its invoice's, because it corrects a
    // supply that happened then and not on the day the correction was typed.
    let supplyDate = issueDate;
    if (mode === 'linked') {
      supplyDate = String(wash.wash_date || '').slice(0, 10);
      if (!isRealDate(supplyDate)) {
        throw new InvoicingError('تاريخ الغسلة غير صالح — صحّحه قبل إصدار الفاتورة.');
      }
    } else if (mode === 'standalone' && input.supplyDate) {
      supplyDate = String(input.supplyDate).slice(0, 10);
      if (!isRealDate(supplyDate)) {
        throw new InvoicingError('تاريخ التوريد غير صالح.', { code: 'invalid-argument' });
      }
    }
    // ── السياسة: لا تُصدر فاتورة قبل توريدها ──
    // An invoice dated before the service it bills is not a late invoice, it is
    // a wrong one: it would file the sale in a period that closed before the
    // supply happened. Issuing LATER is normal and allowed without limit — the
    // two dates simply both appear on the document.
    //
    // A NOTE is exempt, and its supply date is set below from the invoice it
    // corrects: a correction naturally comes after the supply, and the rule
    // that matters there is the one already enforced — a note cannot exist
    // without a live invoice behind it.
    if (mode !== 'note' && issueDate < supplyDate) {
      throw new InvoicingError(
        `تاريخ الإصدار (${issueDate}) قبل تاريخ التوريد (${supplyDate}) — `
        + 'الفاتورة لا تسبق الخدمة التي توثّقها.',
        { code: 'invalid-argument' },
      );
    }

    const year = Number(issueDate.slice(0, 4));
    const periodKey = periodKeyOf(issueDate);
    if (!isValidPeriodKey(periodKey)) {
      throw new InvoicingError('تاريخ الإصدار لا ينتمي لفترة صالحة.', { code: 'invalid-argument' });
    }

    // ══ reads, phase 2 ══════════════════════════════════════════════════
    const settingsRef = db.collection(DOC_COL.SETTINGS).doc('company');
    const counterRef  = db.collection(DOC_COL.COUNTERS).doc(counterIdFor(type, year));
    const claimRef = claimType && claimId
      ? db.collection(DOC_COL.SOURCES).doc(sourceClaimId(claimType, claimId))
      : null;

    const referenceRef = referenceDocumentId
      ? db.collection(DOC_COL.DOCUMENTS).doc(referenceDocumentId) : null;

    const journalCounterRef = db.collection(DOC_COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef = db.collection(DOC_COL.PERIODS).doc(periodKey);

    // `app_settings/company` is the seller's IDENTITY; `app_settings/accounting`
    // is the tax POLICY. They are read separately because they answer different
    // questions and conflating them is how `company.vatRegistered` came to
    // decide whether a supply bore tax.
    const settingsAccountingRef = db.collection(DOC_COL.SETTINGS).doc('accounting');

    const [settingsSnap, settingsAccountingSnap, counterSnap, claimSnap, referenceSnap,
      journalCounterSnap, periodSnap] = await Promise.all([
      tx.get(settingsRef), tx.get(settingsAccountingRef), tx.get(counterRef),
      claimRef ? tx.get(claimRef) : Promise.resolve(null),
      referenceRef ? tx.get(referenceRef) : Promise.resolve(null),
      tx.get(journalCounterRef), tx.get(periodRef),
    ]);

    // Anything that posts into the books needs its month open. Checked here,
    // before a number is minted. A LINKED invoice posts nothing, so it may be
    // issued for a wash whose month is already filed — the paper follows the
    // entry rather than adding to it.
    if (posts && periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new InvoicingError(
        `الفترة ${periodKey} مقفلة — لا يمكن الترحيل فيها. اختر تاريخاً في فترة مفتوحة.`,
      );
    }

    // ── the reference, read rather than trusted ──
    let referenceNumber = null;
    let reference = null;
    let referenceEntry = null;
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
      // A note corrects a supply that happened on the invoice's date, not on
      // the day the correction was typed. Inherited, like the tax treatment,
      // from the document being adjusted.
      supplyDate = String(reference.supplyDate || reference.issueDate || issueDate).slice(0, 10);

      // ── أصل محاسبي حقيقي، لا مجرد ورقة ──
      // A credit note DEBITS مردودات المبيعات. Against an invoice that never
      // reached the books that is not a reduction of anything — it is revenue
      // manufactured with a minus sign, and output tax reclaimed on a sale
      // the authority was never told about. So the reference has to name an
      // entry, and that entry has to be live.
      const referenceEntryId = String(
        reference.journalEntryId || reference.linkedJournalEntryId || '',
      ).trim();
      if (!referenceEntryId) {
        throw new InvoicingError(
          `الفاتورة ${referenceNumber} بلا قيد في الدفاتر — لا يُصدر إشعار على فاتورة `
          + 'بلا أصل محاسبي. رحّل مصدرها أولاً.',
        );
      }
      const referenceEntrySnap = await tx.get(
        db.collection(DOC_COL.ENTRIES).doc(referenceEntryId),
      );
      if (!referenceEntrySnap.exists) {
        throw new InvoicingError(
          `قيد الفاتورة ${referenceNumber} غير موجود — راجع الدفاتر قبل إصدار الإشعار.`,
          { code: 'not-found' },
        );
      }
      if (referenceEntrySnap.data().status !== 'posted') {
        throw new InvoicingError(
          `قيد الفاتورة ${referenceNumber} معكوس — صحّح الأصل بدل إصدار إشعار عليه.`,
        );
      }
      referenceEntry = referenceEntrySnap.data();
    }

    // ── المطالبة بالسجل المصدر ──
    // A held claim means "this record already has its document". A RELEASED
    // claim means a correction has cancelled that document and reversed its
    // entry, so the record is waiting for a replacement — and the replacement
    // links back to what it replaces, in both directions, so the trail from the
    // cancelled number to the live one is walkable from either end.
    let replacesDocumentId = null;
    let replacedRef = null;
    let replacedNumber = null;
    if (claimSnap?.exists) {
      const prev = claimSnap.data();
      if (prev.status !== 'released') {
        throw new InvoicingError(
          `سبق إصدار مستند لهذا السجل: ${prev.documentNumber}. استخدم إشعاراً دائناً أو مديناً للتعديل.`,
          { code: 'already-exists' },
        );
      }
      replacesDocumentId = prev.previousDocumentId || prev.documentId || null;
      if (replacesDocumentId) {
        replacedRef = db.collection(DOC_COL.DOCUMENTS).doc(String(replacesDocumentId));
        const replacedSnap = await tx.get(replacedRef);
        if (!replacedSnap.exists) {
          // The claim names a document that is gone. Refusing beats issuing a
          // replacement whose predecessor cannot be shown to an auditor.
          throw new InvoicingError(
            'المستند السابق لهذا السجل غير موجود — راجع السجل قبل إصدار بديل.',
            { code: 'not-found' },
          );
        }
        if (replacedSnap.data().status !== 'cancelled') {
          throw new InvoicingError(
            `المستند السابق ${replacedSnap.data().documentNumber} ما زال سارياً — `
            + 'لا يُصدر بديل عن مستند لم يُلغَ.',
          );
        }
        replacedNumber = replacedSnap.data().documentNumber || null;
      }
    }

    // The seller block comes from settings, never from the payload: a client
    // that could name its own VAT number could sign a QR with someone else's.
    const company = settingsSnap.exists ? (settingsSnap.data().value || settingsSnap.data()) : {};
    const companySeller = {
      name: String(company.name || 'شركة هادي الغانم'),
      vatNumber: String(company.vatNumber || ''),
      address: String(company.address || ''),
    };

    // ── المعالجة الضريبية ──
    // Three sources, one per path, and NONE of them is "what the settings say
    // today". `app_settings/company` is deliberately not consulted either: it
    // holds the seller's IDENTITY — name, address, VAT number — and whether a
    // supply bears tax is an accounting policy, not a letterhead.
    //
    //   note        inherits from the invoice it corrects. A correction to a
    //               taxable invoice still carries that invoice's tax even if
    //               the business has de-registered since; reading today's
    //               setting would silently drop VAT already declared.
    //   linked      inherits from the ENTRY, which froze its own `taxSnapshot`
    //               at posting. A pre-snapshot entry has its treatment derived
    //               from its lines — exactly, or the invoice is refused.
    //   standalone  resolves the policy at the SUPPLY date.
    const entrySale = mode === 'linked' ? saleTotalsOfEntry(washEntry.lines) : null;
    let taxable;
    let vatRate;
    let entryTreatment = null;
    let referenceTreatment = null;
    let policyEffectiveFrom = null;
    if (reference) {
      // ── لا تُفترض 15% لإشعار على فاتورة قديمة ──
      // `reference.vatRate ?? VAT_RATE` was a 15% assumption wearing a
      // fallback: a legacy invoice carries no rate, so a note on a 5%-era sale
      // would have been raised at 15% — reclaiming output tax that was never
      // charged. The treatment is RECOVERED instead: the invoice's own frozen
      // snapshot first, then its entry's, then derived from the entry's lines
      // and verified. If none of the three can answer, the note is refused.
      const recovered = referenceTaxTreatment(reference, referenceEntry);
      if (!recovered.known) {
        throw new InvoicingError(
          `المعالجة الضريبية للفاتورة ${referenceNumber} غير معروفة (${recovered.reason}) — `
          + 'لا تُفترض نسبة. راجع الفاتورة وقيدها قبل إصدار الإشعار.',
        );
      }
      // …and the invoice has to agree with the entry it names. A document
      // whose printed tax differs from the entry behind it cannot be the basis
      // for a correction to either.
      const entrySaleOfRef = saleTotalsOfEntry(referenceEntry?.lines);
      if (Math.abs(entrySaleOfRef.gross - round2(reference.gross)) >= MONEY_EPSILON
        || Math.abs(entrySaleOfRef.vat - round2(reference.vat)) >= MONEY_EPSILON) {
        throw new InvoicingError(
          `الفاتورة ${referenceNumber} (${round2(reference.gross).toFixed(2)} منها ضريبة `
          + `${round2(reference.vat).toFixed(2)}) لا تطابق قيدها `
          + `(${entrySaleOfRef.gross.toFixed(2)} منها ضريبة ${entrySaleOfRef.vat.toFixed(2)}) — `
          + 'راجعها قبل إصدار الإشعار.',
        );
      }
      taxable = recovered.taxable;
      vatRate = recovered.vatRate;
      referenceTreatment = recovered;
      policyEffectiveFrom = reference.taxPolicyEffectiveFrom
        || reference.taxSnapshot?.effectiveFrom || null;
    } else if (mode === 'linked') {
      entryTreatment = saleTaxTreatmentOfEntry(washEntry);
      if (!entryTreatment.known) {
        throw new InvoicingError(
          `المعالجة الضريبية لقيد الغسلة غير معروفة (${entryTreatment.reason}) — `
          + 'لا تُفترض نسبة. راجع القيد أو اعكسه وأعد ترحيله قبل إصدار الفاتورة.',
        );
      }
      taxable = entryTreatment.taxable;
      vatRate = entryTreatment.vatRate;
    } else {
      const settings = settingsAccountingSnap.exists
        ? (settingsAccountingSnap.data().value || settingsAccountingSnap.data()) : {};
      const policy = taxPolicyAt(supplyDate, settings);
      if (!policy.known) {
        throw new InvoicingError(
          `السياسة الضريبية غير مهيأة لتاريخ التوريد ${supplyDate} `
          + `(السجل التاريخي يبدأ من ${policy.baselineFrom || '—'}) — `
          + 'هيّئ تاريخ بداية السياسة قبل إصدار فاتورة أقدم منه.',
        );
      }
      taxable = policy.vatRegistered;
      vatRate = policy.vatRate;
      policyEffectiveFrom = policy.effectiveFrom;
    }

    // ── the lines ──
    // On the linked path they are built from the wash and then CHECKED against
    // the entry to the halala. The pricing mode comes from the entry's own
    // snapshot, so an administrator who flips the default months later cannot
    // silently restate an invoice for a sale that was already filed.
    let documentLines = input.lines;
    let priceMode = reference
      ? (referenceTreatment.priceMode
        || (reference.priceMode === 'exclusive' ? 'exclusive' : 'inclusive'))
      : (input.priceMode === 'exclusive' ? 'exclusive' : 'inclusive');
    if (mode === 'linked') {
      const quantity = Math.max(0, Number(wash.quantity) || 0);
      const unitPrice = Math.max(0, Number(wash.price) || 0);
      const base = round2(quantity * unitPrice);
      priceMode = entryTreatment.priceMode;
      // The snapshot says how it was quoted; the arithmetic still has to agree
      // with the wash row, or the row has been edited under a posted entry.
      const expected = priceMode === 'inclusive' ? entrySale.gross : entrySale.net;
      if (Math.abs(base - expected) >= MONEY_EPSILON) {
        throw new InvoicingError(
          `قيمة الغسلة (${base.toFixed(2)}) لا تطابق قيدها المُرحّل `
          + `(${entrySale.gross.toFixed(2)}) — اعكس القيد وأعد ترحيله قبل إصدار الفاتورة.`,
        );
      }
      documentLines = [{
        description: `غسيل سيارات${wash.biker_name ? ` — ${wash.biker_name}` : ''}`,
        quantity, unitPrice,
      }];
      const builtProblems = lineProblems(documentLines);
      if (builtProblems.length) {
        throw new InvoicingError(`بيانات الغسلة غير صالحة للفوترة: ${builtProblems[0]}`);
      }
    }

    const seller = reference?.seller?.vatNumber ? reference.seller : companySeller;
    const customer = reference
      ? (reference.customer || null)
      : (input.customer?.name ? { name: String(input.customer.name).slice(0, 200) } : null);
    const sourceType = reference
      ? (reference.sourceType || null)
      : mode === 'linked'
        ? 'wash'
        : (input.sourceType ? String(input.sourceType) : null);
    const sourceId = reference
      ? null
      : mode === 'linked' ? washId : (input.sourceId ? String(input.sourceId) : null);

    const totals = totalsFromLines(documentLines, { priceMode, taxable, rate: vatRate });
    if (!Number.isFinite(totals.gross) || !(totals.gross > 0)) {
      throw new InvoicingError('إجمالي المستند يجب أن يكون أكبر من صفر.', { code: 'invalid-argument' });
    }
    // The invoice for a posted wash prints what the BOOKS say. If the two
    // disagree by so much as a halala the document is refused rather than
    // issued: a tax invoice that contradicts its own journal entry is the one
    // thing an audit cannot be told to overlook.
    if (mode === 'linked'
      && (Math.abs(totals.gross - entrySale.gross) >= MONEY_EPSILON
        || Math.abs(totals.vat - entrySale.vat) >= MONEY_EPSILON)) {
      throw new InvoicingError(
        `الفاتورة (${totals.gross.toFixed(2)} منها ضريبة ${totals.vat.toFixed(2)}) لا تطابق `
        + `قيد الغسلة (${entrySale.gross.toFixed(2)} منها ضريبة ${entrySale.vat.toFixed(2)}).`,
      );
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

    // ── the journal entry, built and validated BEFORE any write ──
    // A standalone invoice or a note that only writes `sales_documents`
    // changes nothing in the books: the sale never appears, or revenue and
    // output tax stay exactly where the invoice left them. Document and entry
    // are written in this one transaction, so neither can exist without the
    // other.
    const ref = db.collection(DOC_COL.DOCUMENTS).doc();
    // The account the money of THIS document lands in — stored, so a later
    // note refunds to where the sale was collected rather than guessing.
    const settlementAccount = mode === 'linked'
      ? (entrySale.settlementAccount || settlementForSale(wash.payment_method || 'cash'))
      : mode === 'standalone'
        ? saleSettlementAccount(paymentMethod, paymentStatus)
        : null;
    let entryRef = null;
    let entryNumber = null;
    if (posts) {
      let entryLines;
      let draftEntry;
      if (mode === 'standalone') {
        entryLines = normalizeLines(buildSaleLines(totals, settlementAccount, vatRate));
        draftEntry = {
          entryDate: issueDate,
          periodKey,
          // NOT `wash`: this sale has no wash behind it, and typing it as one
          // would make it indistinguishable from revenue already in the books.
          sourceType: 'sales_invoice',
          sourceId: ref.id,
          description: `فاتورة مبيعات ${documentNumber}`
            + `${customer?.name ? ` — ${customer.name}` : ''}`,
          status: 'posted',
          reversalOf: null,
        };
      } else {
        // The settlement account is a decision, not a guess: the caller states
        // how the money moved, and the invoice's own account is the default.
        const method = String(input.refundMethod || input.paymentMethod || '');
        const noteAccount = method
          ? settlementForSale(method)
          : (reference?.settlementAccount
            || settlementForSale(reference?.paymentMethod || 'cash'));
        entryLines = normalizeLines(buildNoteLines(type, totals, noteAccount, vatRate));
        draftEntry = {
          entryDate: issueDate,
          periodKey,
          sourceType: 'adjustment',
          sourceId: null,
          description: `${type === 'credit_note' ? 'إشعار دائن' : 'إشعار مدين'} ${documentNumber}`
            + `${referenceNumber ? ` على ${referenceNumber}` : ''} — ${reason}`,
          status: 'posted',
          reversalOf: null,
        };
      }
      const entryProblems = validateEntry(draftEntry, entryLines, { knownAccountCodes });
      if (entryProblems.length) {
        throw new InvoicingError(entryProblems[0], { code: 'invalid-argument' });
      }
      entryNumber = journalCounterSnap.exists
        ? (Number(journalCounterSnap.data().nextNumber) || 1) : 1;
      entryRef = db.collection(DOC_COL.ENTRIES).doc();
      const entryTotals = totalsOf(entryLines);

      // ══ writes ══
      tx.set(entryRef, {
        ...draftEntry,
        entryNumber,
        // The treatment this entry was made under, frozen — the same guarantee
        // a posted wash gets, for the same reason.
        taxSnapshot: {
          vatRegistered: taxable, washPriceMode: priceMode,
          vatRate: taxable ? vatRate : 0,
          net: totals.net, vat: totals.vat, gross: totals.gross,
          effectiveFrom: policyEffectiveFrom,
        },
        lines: entryLines,
        lineCount: entryLines.length,
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
      // Which of the three paths issued it. Stored because "does this document
      // carry its own entry?" is answered differently for each, and reading it
      // back off the document beats re-deriving it.
      issueMode: mode,
      documentNumber, sequence, year,
      issueDate, issueTime, timestamp,
      // When the service was rendered, kept apart from when the paper was
      // issued. The number, the year, the counter, the period and the QR
      // timestamp all follow `issueDate`; `supplyDate` is what the document
      // is FOR, and both are printed.
      supplyDate,
      seller, taxable, priceMode,
      customer,
      lines: totals.lines,
      net: totals.net, vat: totals.vat, gross: totals.gross,
      referenceNumber, referenceDocumentId: referenceDocumentId || null,
      reason: reason || null,
      sourceType, sourceId,
      washId: mode === 'linked' ? washId : null,
      paymentMethod: mode === 'linked'
        ? (wash.payment_method || null)
        : (paymentMethod || null),
      paymentStatus: mode === 'linked' ? 'paid' : (paymentStatus || null),
      settlementAccount,
      // Stored explicitly rather than assumed to be 15% forever: a rate change
      // must not restate what a filed document said.
      vatRate,
      // Which dated policy row governed it, and the split that row produced.
      // A reader never has to re-derive either.
      taxPolicyEffectiveFrom: policyEffectiveFrom,
      taxSnapshot: {
        vatRegistered: taxable, washPriceMode: priceMode,
        vatRate: taxable ? vatRate : 0,
        net: totals.net, vat: totals.vat, gross: totals.gross,
        source: reference ? referenceTreatment.source : mode === 'linked' ? entryTreatment.source : 'policy',
        effectiveFrom: policyEffectiveFrom,
      },
      qrPayload,
      zatcaReported: false,
      // The document's OWN entry — a standalone sale or a note. Null on the
      // linked path, which documents an entry it did not create.
      journalEntryId: entryRef ? entryRef.id : null,
      journalEntryNumber: entryNumber,
      // The wash's entry, which this invoice documents rather than owns. The
      // two are kept apart deliberately: voiding the invoice must never reverse
      // the wash's entry, and a note reads either one as proof that there is
      // something real to adjust.
      linkedJournalEntryId: linkedEntryId || null,
      linkedJournalEntryNumber: mode === 'linked' ? (washEntry.entryNumber ?? null) : null,
      // The cancelled document this one stands in for, when a correction
      // released the source claim. Its own number and date are untouched.
      replacesDocumentId: replacesDocumentId || null,
      replacesDocumentNumber: replacedNumber,
      replacedByDocumentId: null,
      issuedBy: userId,
      issuedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef, {
      nextNumber: sequence + 1, type, year, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // The other half of the replacement link — walkable from the cancelled
    // number as well as from the live one.
    if (replacedRef) {
      tx.update(replacedRef, {
        replacedByDocumentId: ref.id,
        replacedByDocumentNumber: documentNumber,
      });
    }
    if (claimRef) {
      tx.set(claimRef, {
        sourceType: claimType, sourceId: claimId, documentId: ref.id, documentNumber,
        status: 'held',
        previousDocumentId: replacesDocumentId || null,
        at: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'issue', collectionName: DOC_COL.DOCUMENTS, documentId: ref.id,
      userId, before: null,
      after: {
        documentNumber, gross: totals.gross, vat: totals.vat, mode,
        issueDate, supplyDate,
        journalEntryId: entryRef ? entryRef.id : null,
        linkedJournalEntryId: linkedEntryId || null,
        replacesDocumentId: replacesDocumentId || null,
      },
      note: `إصدار ${documentNumber} (${mode})`
        + (entryNumber ? ` — قيد رقم ${entryNumber}` : '')
        + (linkedEntryId ? ` — يوثّق قيد رقم ${washEntry.entryNumber ?? '—'}` : '')
        + (replacedNumber ? ` — بديل عن ${replacedNumber}` : ''),
    }, FieldValue));

    return {
      id: ref.id, documentNumber, sequence, year, qrPayload, vatRate,
      mode, issueDate, supplyDate,
      net: totals.net, vat: totals.vat, gross: totals.gross,
      journalEntryId: entryRef ? entryRef.id : null,
      journalEntryNumber: entryNumber,
      linkedJournalEntryId: linkedEntryId || null,
      replacesDocumentId: replacesDocumentId || null,
    };
  });
}

// ─── الإشعارات النشطة ────────────────────────────────────────────────────
/**
 * The live notes raised against one invoice.
 *
 * Read inside the transaction that wants to cancel it, because "does this
 * invoice have corrections outstanding?" must be answered on the same snapshot
 * as the cancellation itself.
 */
async function activeNotesFor(db, tx, documentId) {
  const snap = await tx.get(
    db.collection(DOC_COL.DOCUMENTS).where('referenceDocumentId', '==', String(documentId)),
  );
  return snap.docs
    .map((x) => ({ id: x.id, ...x.data() }))
    .filter((x) => x.type !== 'invoice' && x.status !== 'cancelled');
}

/**
 * Refuses to cancel an invoice while corrections against it are still live.
 *
 * Reversing the invoice in full while its credit note stays posted double-
 * counts the reduction: the sale comes out once through the reversal and again
 * through the note, and 4010 ends up carrying a return against revenue that is
 * no longer there. The notes are the outstanding decision, so they are named.
 */
function refuseIfNotesOutstanding(doc, notes) {
  if (doc.type !== 'invoice' || notes.length === 0) return;
  const listed = notes.map((n) => n.documentNumber).filter(Boolean).join('، ');
  throw new InvoicingError(
    `الفاتورة ${doc.documentNumber} عليها ${notes.length} إشعار نشط (${listed}) — `
    + 'ألغِ الإشعارات أولاً أو صحّح بإشعار جديد. إلغاء الفاتورة الآن يخصم الأثر مرتين.',
  );
}

/**
 * Voids an issued document.
 *
 * Voiding records the intent; the accounting effect still has to come from a
 * credit note. The document itself is never removed — its number stays spoken
 * for, because a gap in a tax series is what an audit asks about.
 *
 * `reversalDate` is the date the CORRECTION lands on, and it is required
 * whenever the document carries an entry of its own. It used to default to the
 * document's own date, which is exactly the case that has no way out: a July
 * note, July filed and closed, and the only date the server would accept is
 * the one inside the closed month. The caller names an open month instead —
 * and names it explicitly, because a reversal changes what a period says and
 * silently choosing "today" is how a correction lands in the wrong one.
 */
export async function voidDocument(db, FieldValue, { documentId, reason, reversalDate, entryDate }, { userId = null } = {}) {
  const why = String(reason || '').trim();
  if (!why) throw new InvoicingError('سبب الإلغاء مطلوب.', { code: 'invalid-argument' });
  const id = String(documentId || '').trim();
  if (!id) throw new InvoicingError('معرّف المستند مطلوب.', { code: 'invalid-argument' });
  // `entryDate` is the old parameter name, kept so an in-flight caller is not
  // broken; `reversalDate` is what the client sends now.
  const requestedReversal = String(reversalDate ?? entryDate ?? '').slice(0, 10);

  return db.runTransaction(async (tx) => {
    const ref = db.collection(DOC_COL.DOCUMENTS).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new InvoicingError('المستند غير موجود.', { code: 'not-found' });
    const doc = snap.data();
    if (doc.status === 'cancelled') {
      throw new InvoicingError('المستند ملغى بالفعل.', { code: 'already-exists' });
    }

    // ── لا تُلغى فاتورة عليها إشعارات نشطة ──
    // Read before any write, on the same snapshot as the cancellation.
    refuseIfNotesOutstanding(doc, await activeNotesFor(db, tx, id));

    // A wash-linked invoice is cancelled through the correction path, which
    // reverses the wash's entry in the same transaction. Voiding it here would
    // leave an issued-then-cancelled paper over a still-posted entry and a
    // claim nobody released — a wash with revenue in the books and no way to
    // invoice it again.
    if (doc.linkedJournalEntryId && !doc.journalEntryId) {
      throw new InvoicingError(
        `${doc.documentNumber} فاتورة لغسلة مُرحّلة — استخدم «التصحيح الذري» `
        + 'الذي يلغي المستند ويعكس قيد الغسلة ويحرّر السجل في عملية واحدة.',
      );
    }

    // The claim this document holds over its source record, if any. A note
    // never took one (`sourceId` is null on notes), so this is an invoice's
    // claim or nothing.
    const claimType = doc.type === 'invoice' && doc.sourceType ? String(doc.sourceType) : null;
    const claimId   = doc.type === 'invoice' && doc.sourceId   ? String(doc.sourceId)   : null;
    const claimRef = claimType && claimId
      ? db.collection(DOC_COL.SOURCES).doc(sourceClaimId(claimType, claimId)) : null;

    // ── a document with an accounting effect cannot just be marked void ──
    // Cancelling the paper while its entry stays posted would leave revenue
    // and output tax reduced by a note the register says never happened. The
    // entry is REVERSED in this same transaction, so the two move together.
    //
    // `journalEntryId` only — never `linkedJournalEntryId`. A wash-linked
    // invoice documents an entry it did not create; voiding the paper must not
    // reverse the wash's revenue, which is corrected by reversing that entry
    // through the ledger.
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
      // No fallback to `entry.entryDate`. That default is what made a note in
      // a closed month impossible to void: the server would insist on the very
      // date the closed period rejects, and no payload could say otherwise.
      const date = requestedReversal;
      if (!isRealDate(date)) {
        throw new InvoicingError(
          'تاريخ القيد العكسي مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD) — '
          + 'اختر تاريخاً في فترة مفتوحة.',
          { code: 'invalid-argument' },
        );
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
        // A mirror is an adjustment, never a posting of the source it cancels
        // — otherwise it would look like the source's live entry to every
        // reader that asks. What it reversed is recorded on its own fields.
        sourceType: 'adjustment',
        sourceId: null,
        sourceKind: null,
        reversedSourceKind: entry.sourceKind ?? null,
        reversedSourceType: entry.sourceType ?? null,
        reversedSourceId: entry.sourceId ?? null,
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

    // A cancelled document no longer holds its source record. The claim is
    // RELEASED rather than deleted, carrying the number it used to belong to,
    // so the replacement can link back to it and an auditor can see why a
    // second document exists for one record.
    if (claimRef) {
      tx.set(claimRef, {
        status: 'released',
        previousDocumentId: id,
        previousDocumentNumber: doc.documentNumber || null,
        releasedAt: FieldValue.serverTimestamp(),
        releasedBy: userId,
        releaseReason: why,
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
      after: {
        status: 'cancelled',
        reversalEntryId: reversalRef ? reversalRef.id : null,
        claimReleased: Boolean(claimRef),
      },
      note: `إلغاء ${doc.documentNumber} — ${why}`
        + (reversalNumber ? ` (عكس بقيد رقم ${reversalNumber})` : '')
        + (claimRef ? ' — حُرّرت مطالبة السجل المصدر' : ''),
    }, FieldValue));

    return {
      id, documentNumber: doc.documentNumber,
      reversalEntryId: reversalRef ? reversalRef.id : null,
      reversalEntryNumber: reversalNumber,
      claimReleased: Boolean(claimRef),
    };
  });
}

// ─── التصحيح الذري لفاتورة الغسلة ────────────────────────────────────────
/**
 * تصحيح فاتورة غسلة — one transaction, five moves, all or none.
 *
 * A wash-linked invoice documents an entry it does not own, and the two are
 * held together by a posting lock and a source claim. Unwinding that by hand
 * means four separate operations that can each half-succeed:
 *
 *   • cancel the paper but leave the entry posted → an `issued`-turned-void
 *     document over live revenue, and no way to invoice the wash again;
 *   • reverse the entry but leave the paper issued → an ISSUED invoice
 *     pointing at a REVERSED entry, which is the state `ledgerReverseEntry`
 *     now refuses outright to create;
 *   • release the lock but not the claim → the wash can be re-posted and never
 *     re-invoiced;
 *   • release the claim but not the lock → the reverse.
 *
 * So it is one call:
 *
 *   1. the document is cancelled (number and dates untouched, `replacedBy`
 *      filled in later by whatever replaces it);
 *   2. its linked entry is reversed with an EXPLICIT `reversalDate`, mirror
 *      posted, original marked;
 *   3. the wash's posting lock is deleted ONLY if it still names the entry
 *      being reversed — if a newer entry owns it, that entry is the live one
 *      and the lock stays;
 *   4. the source claim is RELEASED (not deleted), recording which document it
 *      used to belong to;
 *   5. an audit record ties all four together.
 *
 * Afterwards the wash can be corrected, re-posted, and invoiced again — and
 * the replacement invoice carries `replacesDocumentId` back to the cancelled
 * number.
 */
export async function correctLinkedInvoice(db, FieldValue, { documentId, reason, reversalDate }, { userId = null } = {}) {
  const why = String(reason || '').trim();
  if (!why) throw new InvoicingError('سبب التصحيح مطلوب.', { code: 'invalid-argument' });
  const id = String(documentId || '').trim();
  if (!id) throw new InvoicingError('معرّف المستند مطلوب.', { code: 'invalid-argument' });
  const date = String(reversalDate ?? '').slice(0, 10);
  if (!isRealDate(date)) {
    throw new InvoicingError(
      'تاريخ القيد العكسي مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD) — '
      + 'اختر تاريخاً في فترة مفتوحة.',
      { code: 'invalid-argument' },
    );
  }
  const revPeriod = periodKeyOf(date);
  if (!isValidPeriodKey(revPeriod)) {
    throw new InvoicingError('تاريخ العكس لا ينتمي لفترة صالحة.', { code: 'invalid-argument' });
  }

  return db.runTransaction(async (tx) => {
    // ══ reads ══════════════════════════════════════════════════════════
    const ref = db.collection(DOC_COL.DOCUMENTS).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new InvoicingError('المستند غير موجود.', { code: 'not-found' });
    const doc = snap.data();
    if (doc.status === 'cancelled') {
      throw new InvoicingError('المستند ملغى بالفعل.', { code: 'already-exists' });
    }
    if (doc.type !== 'invoice') {
      throw new InvoicingError('التصحيح الذري للفواتير فقط.', { code: 'invalid-argument' });
    }
    const linkedEntryId = String(doc.linkedJournalEntryId || '').trim();
    if (!linkedEntryId) {
      throw new InvoicingError(
        `${doc.documentNumber} ليست فاتورة غسلة مُرحّلة — استخدم الإلغاء العادي.`,
        { code: 'invalid-argument' },
      );
    }

    refuseIfNotesOutstanding(doc, await activeNotesFor(db, tx, id));

    const washId = String(doc.washId || doc.sourceId || '').trim();
    const entryRef   = db.collection(DOC_COL.ENTRIES).doc(linkedEntryId);
    const counterRef = db.collection(DOC_COL.COUNTERS).doc(JOURNAL_COUNTER);
    const periodRef  = db.collection(DOC_COL.PERIODS).doc(revPeriod);
    const lockRef  = washId
      ? db.collection(DOC_COL.LOCKS).doc(postingLockId(ADAPTERS.wash.lockKind, washId)) : null;
    const claimRef = washId
      ? db.collection(DOC_COL.SOURCES).doc(sourceClaimId('wash', washId)) : null;

    const [entrySnap, counterSnap, periodSnap, lockSnap] = await Promise.all([
      tx.get(entryRef), tx.get(counterRef), tx.get(periodRef),
      lockRef ? tx.get(lockRef) : Promise.resolve(null),
    ]);

    if (!entrySnap.exists) {
      throw new InvoicingError('قيد الغسلة غير موجود — راجع الدفاتر قبل التصحيح.', { code: 'not-found' });
    }
    const entry = entrySnap.data();
    if (entry.status !== 'posted') {
      throw new InvoicingError('قيد الغسلة غير مُرحّل — لا يمكن عكسه.');
    }
    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      throw new InvoicingError(`الفترة ${revPeriod} مقفلة — اختر تاريخاً في فترة مفتوحة.`);
    }
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    if (lines.length < 2) {
      throw new InvoicingError(
        'قيد الغسلة بصيغة قديمة لا تحمل سطوره داخله — سجّل قيد تسوية يدوياً بدل عكسه.',
      );
    }

    // ══ writes ═════════════════════════════════════════════════════════
    const mirror = lines.map((l) => ({
      accountId: l.accountId, debit: round2(l.credit), credit: round2(l.debit),
      description: l.description || '',
    }));
    const mirrorTotals = totalsOf(mirror);
    if (Math.abs(mirrorTotals.debit - mirrorTotals.credit) >= MONEY_EPSILON) {
      throw new InvoicingError('قيد الغسلة غير متوازن — لا يمكن بناء عكس صحيح له.');
    }
    const reversalNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const reversalRef = db.collection(DOC_COL.ENTRIES).doc();

    tx.set(reversalRef, {
      entryDate: date,
      periodKey: revPeriod,
      sourceType: 'adjustment',
      sourceId: null,
      sourceKind: null,
      reversedSourceKind: entry.sourceKind ?? null,
      reversedSourceType: entry.sourceType ?? null,
      reversedSourceId: entry.sourceId ?? null,
      description: `تصحيح فاتورة ${doc.documentNumber} — عكس قيد رقم ${entry.entryNumber ?? '—'} — ${why}`,
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
    if (!periodSnap.exists) {
      tx.set(periodRef, {
        periodKey: revPeriod, status: 'open', closedAt: null, closedBy: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(counterRef, {
      nextNumber: reversalNumber + 1, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // The lock is released only when it still belongs to the entry being
    // reversed. A wash corrected and re-posted already has a newer entry
    // holding it, and freeing it here would let the books hold that record
    // twice.
    const lockOwned = Boolean(lockSnap?.exists && lockSnap.data().entryId === entryRef.id);
    if (lockOwned) tx.delete(lockRef);

    if (claimRef) {
      tx.set(claimRef, {
        sourceType: 'wash', sourceId: washId,
        status: 'released',
        previousDocumentId: id,
        previousDocumentNumber: doc.documentNumber || null,
        releasedAt: FieldValue.serverTimestamp(),
        releasedBy: userId,
        releaseReason: why,
      }, { merge: true });
    }

    // The number and both dates stay exactly as filed. `cancelled` is the
    // status a tax series can carry; deleting the row is what it cannot.
    tx.update(ref, {
      status: 'cancelled',
      voidReason: why,
      correctedAt: FieldValue.serverTimestamp(),
      correctedBy: userId,
      voidedBy: userId,
      voidedAt: FieldValue.serverTimestamp(),
      reversalEntryId: reversalRef.id,
      reversalEntryNumber: reversalNumber,
    });

    tx.set(db.collection(DOC_COL.AUDIT).doc(), auditRecord({
      action: 'correct', collectionName: DOC_COL.DOCUMENTS, documentId: id, userId,
      before: {
        status: doc.status, linkedJournalEntryId: linkedEntryId,
        entryStatus: 'posted', lockHeld: Boolean(lockSnap?.exists),
      },
      after: {
        status: 'cancelled', reversalEntryId: reversalRef.id,
        lockReleased: lockOwned, claimReleased: Boolean(claimRef),
      },
      note: `تصحيح ${doc.documentNumber} — عكس قيد رقم ${entry.entryNumber ?? '—'} `
        + `بقيد رقم ${reversalNumber} بتاريخ ${date}`
        + (lockOwned ? ' — فُك قفل الغسلة' : ' — القفل يملكه قيد أحدث فبقي')
        + (claimRef ? ' — حُرّرت المطالبة لإصدار بديل' : ''),
    }, FieldValue));

    return {
      id,
      documentNumber: doc.documentNumber,
      washId: washId || null,
      reversedEntryId: linkedEntryId,
      reversalEntryId: reversalRef.id,
      reversalEntryNumber: reversalNumber,
      lockReleased: lockOwned,
      claimReleased: Boolean(claimRef),
    };
  });
}
