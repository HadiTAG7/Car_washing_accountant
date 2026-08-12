// ═══════════════════════════════════════════════════════════════════════════
// محرك ضريبة المشتريات — the one place a purchase's VAT is decided
// ═══════════════════════════════════════════════════════════════════════════
// حساب 1200 «ضريبة مدخلات» كان يُبنى هكذا:
//
//     const deductible = Boolean(vatRegistered && isTaxInvoice && vatDeductible);
//     const { gross, net, vat } = splitVat(raw, { taxable: deductible });
//
// وهذا يتجاهل كل ما تحمله الفاتورة نفسها: `vat_amount` الذي كتبه المورّد،
// و`vat_rate` المثبت عليها، و`price_mode`، و`invoice_date` وسياسة ذلك
// التاريخ. النتيجة أن كل فاتورة تُقسَّم بنسبة 15% الافتراضية — فاتورة من
// عصر الـ5% تُستردّ بـ15%، وفاتورة معفاة تُستردّ بضريبة لم تُدفع، والتقرير
// الذي يقرأ الحقول الصحيحة يخالف الدفاتر التي لا تقرأها.
//
// ── الأولوية ──
//   (أ) مبلغ الضريبة المكتوب على الفاتورة. المستند هو سند الخصم، وتقريب
//       المورّد تقريبه هو — إعادة حسابه من نسبة تخمينٌ فوق مستند قاطع.
//   (ب) النسبة المثبتة على الفاتورة. فاتورة 2019 تبقى 5% مهما تحرّك
//       المعدّل القياسي بعدها.
//   (ج) سياسة تاريخ الفاتورة — `taxPolicyAt(invoice_date)`، لا سياسة اليوم.
//
// ── ما يرفضه المحرك بدل أن يخمّنه ──
// سياسة غير معروفة، وفاتورة لا تذكر مبلغاً ولا نسبة: لا يوجد رقم يمكن
// استنتاجه، و15% ليست إجابة — هي افتراض يُرحَّل إلى الدفاتر ويُقرأ لاحقاً
// كأنه واقعة. الترحيل يُرفض برسالة تقول ما ينقص.
//
// ── قواعد القيد ──
//   • 1200 = ضريبة الفاتورة الفعلية إلى الهللة، لا نتيجة قسمة تقريبية.
//   • حساب المصروف/الأصل يأخذ الصافي، وجهة السداد تأخذ الإجمالي.
//   • شامل → الصافي = الإجمالي − الضريبة.  غير شامل → الإجمالي = المبلغ + الضريبة.
//   • غير قابلة للخصم → لا سطر 1200 إطلاقاً، وكامل الإجمالي على المصروف/الأصل.
//   • هوية ناقصة (رقم/تاريخ/مورّد/مبلغ) → لا يُنشأ أصل ضريبة مدخلات.
//   • غير مسجّل ضريبياً بتاريخ الفاتورة → لا 1200 تلقائي.
//
// A twin of this file lives at src/lib/accounting/purchaseTax.js so the client
// PREVIEW of an entry and the entry the server actually writes cannot drift;
// functions/test/purchaseTax.test.js drives both over one battery.
// ═══════════════════════════════════════════════════════════════════════════

import {
  readStatedVatAmount, readStatedVatRate, normalizedPriceMode,
  isRealCalendarDate, validateTaxInvoiceFields, VAT_PROBLEM,
} from './vatFields.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Where the VAT figure came from — recorded on the entry, not inferred later. */
export const PURCHASE_TAX_SOURCE = {
  INVOICE_AMOUNT: 'invoice-amount',
  INVOICE_RATE:   'invoice-rate',
  POLICY:         'policy',
  // No VAT at all: not a tax invoice, or a genuinely zero-rated one.
  NONE:           'none',
};

/** Why no input-VAT asset was recognised. Null when one was. */
export const NO_INPUT_VAT = {
  NOT_TAX_INVOICE:    'not-tax-invoice',
  NOT_DEDUCTIBLE:     'not-deductible',
  NOT_REGISTERED:     'not-registered',
  INCOMPLETE_INVOICE: 'incomplete-invoice',
  ZERO_RATED:         'zero-rated',
};

/** Why a posting was refused outright. */
export const PURCHASE_TAX_REFUSAL = {
  BAD_AMOUNT:        'bad-amount',
  BAD_VAT_FIELD:     'bad-vat-field',
  VAT_EXCEEDS_TOTAL: 'vat-exceeds-total',
  UNKNOWN_POLICY:    'unknown-policy',
};

/** A refusal the user is meant to read, not a bug. */
export class PurchaseTaxError extends Error {
  constructor(message, { reason = PURCHASE_TAX_REFUSAL.BAD_AMOUNT, code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'PurchaseTaxError';
    this.reason = reason;
    this.code = code;
  }
}

function hasText(v) { return String(v ?? '').trim().length > 0; }

/** '15%' / '5%' / '7.5%' — a rate a human reads, not 0.075. */
export function formatVatRate(rate) {
  const pct = Math.round(Number(rate) * 10000) / 100;
  return `${String(pct)}%`;
}

/**
 * The description of the 1200 line, which SAYS where its figure came from.
 *
 * It used to read «ضريبة مدخلات قابلة للاسترداد» on every entry regardless —
 * so a 5% invoice, a 15% invoice and an amount copied straight off the paper
 * were indistinguishable in the ledger, and reconciling a reclaim against the
 * documents meant opening each one.
 */
export function inputVatLineDescription({ source, rate, policyEffectiveFrom } = {}) {
  switch (source) {
    case PURCHASE_TAX_SOURCE.INVOICE_AMOUNT:
      return 'ضريبة مدخلات — مبلغ مثبت على الفاتورة';
    case PURCHASE_TAX_SOURCE.INVOICE_RATE:
      return `ضريبة مدخلات ${formatVatRate(rate)} — نسبة مثبتة على الفاتورة`;
    case PURCHASE_TAX_SOURCE.POLICY:
      return `ضريبة مدخلات ${formatVatRate(rate)} — سياسة${policyEffectiveFrom ? ` ${policyEffectiveFrom}` : ' تاريخ الفاتورة'}`;
    default:
      return 'ضريبة مدخلات';
  }
}

/** The identity a tax invoice must carry before its VAT may be deducted. */
export function purchaseIdentityGaps({ invoiceDate, invoiceNumber, supplier, amount }) {
  const missing = [];
  if (!isRealCalendarDate(invoiceDate)) missing.push('تاريخ الفاتورة');
  if (!hasText(invoiceNumber)) missing.push('رقم الفاتورة');
  if (!hasText(supplier)) missing.push('اسم المورّد');
  if (!(Number(amount) > 0)) missing.push('مبلغ الفاتورة');
  return missing;
}

/**
 * Prices one purchase. Throws `PurchaseTaxError` rather than guessing.
 *
 * `input`:
 *   amount        — the figure ON the record. GROSS when priceMode is
 *                   inclusive, NET when it is exclusive. One definition,
 *                   documented in docs/AMOUNT_DEFINITION.md.
 *   priceMode     — 'inclusive' | 'exclusive'
 *   isTaxInvoice  — is there a tax invoice behind this at all
 *   vatDeductible — false for hospitality, private cars, etc.
 *   invoiceDate / invoiceNumber / supplier — the document's identity
 *   vatAmount     — what the supplier wrote, or null for "not stated"
 *   vatRate       — the rate stamped on the document, or null
 *   recordDate    — the record's own date, used ONLY to resolve a policy when
 *                   the invoice carries no date of its own (in which case its
 *                   identity is incomplete and nothing is deducted anyway).
 *
 * `policyAt(date)` returns the dated tax policy — `{ known, vatRegistered,
 * vatRate, effectiveFrom }`.
 */
export function resolvePurchaseTax(input = {}, { policyAt = null } = {}) {
  const priceMode = normalizedPriceMode(input.priceMode);

  const amountN = Number(input.amount);
  if (!Number.isFinite(amountN) || amountN < 0) {
    throw new PurchaseTaxError(
      `مبلغ المشتريات غير صالح (${input.amount ?? '—'}) — لا يُرحَّل قيد بمبلغ غير رقمي أو سالب.`,
      { reason: PURCHASE_TAX_REFUSAL.BAD_AMOUNT, code: 'invalid-argument' },
    );
  }
  const amount = round2(amountN);

  const isTaxInvoice = input.isTaxInvoice === true;
  const vatDeductible = input.vatDeductible !== false;
  const invoiceNumber = String(input.invoiceNumber ?? '').trim();
  const supplier = String(input.supplier ?? '').trim();
  const invoiceDate = String(input.invoiceDate ?? '').slice(0, 10);

  // ── نفس فحص النموذج، على الخادم ──
  // The form runs `validateTaxInvoiceFields` before it will save; so does
  // this, because a record can reach Firestore without ever passing through
  // that form. A blocking problem is a refusal on both sides, by construction
  // rather than by two lists that agree today.
  const problems = validateTaxInvoiceFields(
    { ...input, priceMode, isTaxInvoice, invoiceNumber, supplier, invoiceDate },
    { amount },
  ).filter((p) => p.severity === VAT_PROBLEM.BLOCKING);
  if (problems.length) {
    throw new PurchaseTaxError(
      `${problems[0].message} — صحّح بيانات الفاتورة قبل الترحيل.`,
      {
        reason: problems[0].field === 'vatAmount' && /أكبر من إجمالي/.test(problems[0].message)
          ? PURCHASE_TAX_REFUSAL.VAT_EXCEEDS_TOTAL
          : PURCHASE_TAX_REFUSAL.BAD_VAT_FIELD,
        code: 'invalid-argument',
      },
    );
  }

  const stated = readStatedVatAmount(input.vatAmount);
  const rated = readStatedVatRate(input.vatRate);

  // ── لا مستند، لا تقسيم ──
  // `price_mode` describes how a TAXED supply was quoted. Without a tax
  // invoice there is no tax to quote either way, so the amount is the whole
  // cost and the mode is not consulted.
  if (!isTaxInvoice) {
    return finalize({
      amount, priceMode, isTaxInvoice, vatDeductible,
      invoiceDate, invoiceNumber, supplier,
      statedVatAmount: stated.value, statedVatRate: rated.value,
      documentVat: 0, rate: null, source: PURCHASE_TAX_SOURCE.NONE,
      deductible: false, noInputVatReason: NO_INPUT_VAT.NOT_TAX_INVOICE,
      policy: null, policyDate: null, missing: [],
    });
  }

  // ── سياسة تاريخ الفاتورة ──
  // The invoice's own date, never today's, and never the payment's. A purchase
  // paid in April against a March invoice is a March document under March's
  // rules. Falls back to the record's date only when the invoice carries no
  // date at all — and such an invoice has an incomplete identity, so nothing
  // is deducted against it regardless; the policy is then used solely to know
  // what was actually paid.
  const policyDate = isRealCalendarDate(invoiceDate)
    ? invoiceDate
    : String(input.recordDate ?? '').slice(0, 10);
  const policy = policyAt ? policyAt(policyDate) : null;
  const policyKnown = Boolean(policy && policy.known);

  // ── ما تحمله الفاتورة من ضريبة ──
  let documentVat = null;
  let rate = null;
  let source = null;
  if (stated.value !== null) {
    documentVat = stated.value;
    source = PURCHASE_TAX_SOURCE.INVOICE_AMOUNT;
    // In inclusive mode the stated tax is PART of the amount, so it cannot
    // exceed it. (Blocked above; asserted here because the arithmetic below
    // would otherwise produce a negative net.)
    if (priceMode === 'inclusive' && documentVat > amount + 0.005) {
      throw new PurchaseTaxError(
        `مبلغ الضريبة (${documentVat.toFixed(2)}) أكبر من إجمالي الفاتورة (${amount.toFixed(2)}).`,
        { reason: PURCHASE_TAX_REFUSAL.VAT_EXCEEDS_TOTAL, code: 'invalid-argument' },
      );
    }
    if (priceMode === 'inclusive') documentVat = Math.min(documentVat, amount);
  } else if (rated.value !== null) {
    rate = rated.value;
    source = PURCHASE_TAX_SOURCE.INVOICE_RATE;
    documentVat = vatFromRate(amount, rate, priceMode);
  } else if (policyKnown) {
    // The STANDARD rate in force on the invoice's date. `vatRegistered`
    // describes this business, not the supplier: a registered supplier charges
    // VAT whether or not the buyer can reclaim it, so registration gates the
    // DEDUCTION below and never the rate here.
    rate = Number(policy.vatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) rate = null;
    if (rate !== null) {
      source = PURCHASE_TAX_SOURCE.POLICY;
      documentVat = vatFromRate(amount, rate, priceMode);
    }
  }

  // ── هل يُعترف بأصل ضريبة مدخلات ──
  // Tri-state on purpose: `null` means the answer is unknowable because the
  // policy record does not reach this date, and that is not the same as "no".
  const missing = purchaseIdentityGaps({ invoiceDate, invoiceNumber, supplier, amount });
  let deductible = null;
  let noInputVatReason = null;
  if (!vatDeductible) {
    deductible = false; noInputVatReason = NO_INPUT_VAT.NOT_DEDUCTIBLE;
  } else if (missing.length) {
    deductible = false; noInputVatReason = NO_INPUT_VAT.INCOMPLETE_INVOICE;
  } else if (policyKnown && policy.vatRegistered === false) {
    deductible = false; noInputVatReason = NO_INPUT_VAT.NOT_REGISTERED;
  } else if (policyKnown) {
    deductible = true;
  }

  // ── الرفض بدل الافتراض ──
  if (documentVat === null) {
    // The figure is needed whenever it would change a number: always in
    // exclusive mode (it decides what was paid), and in inclusive mode
    // whenever the tax might be reclaimable.
    const needed = priceMode === 'exclusive' || deductible !== false;
    if (needed) {
      throw new PurchaseTaxError(
        `تعذّر تحديد ضريبة الفاتورة${invoiceNumber ? ` ${invoiceNumber}` : ''}: `
        + `لا مبلغ ضريبة مكتوب عليها، ولا نسبة مثبتة، والسياسة الضريبية غير مهيأة `
        + `لتاريخ ${policyDate || '—'}`
        + `${policy?.baselineFrom ? ` (السجل التاريخي يبدأ من ${policy.baselineFrom})` : ''}. `
        + 'اكتب مبلغ الضريبة أو نسبتها على الفاتورة، أو هيّئ السياسة لتغطي تاريخها — '
        + 'ولا تُفترض 15%.',
        { reason: PURCHASE_TAX_REFUSAL.UNKNOWN_POLICY },
      );
    }
    documentVat = 0;
    source = PURCHASE_TAX_SOURCE.NONE;
  }

  if (deductible === null) {
    // Registration unknowable. It only changes a figure when there IS tax.
    if (documentVat > 0) {
      throw new PurchaseTaxError(
        `التسجيل الضريبي بتاريخ ${policyDate || '—'} غير معروف، فلا يمكن تقرير خصم ضريبة `
        + `الفاتورة${invoiceNumber ? ` ${invoiceNumber}` : ''}. `
        + 'هيّئ السياسة الضريبية لتغطي تاريخ الفاتورة قبل الترحيل.',
        { reason: PURCHASE_TAX_REFUSAL.UNKNOWN_POLICY },
      );
    }
    deductible = false;
    noInputVatReason = NO_INPUT_VAT.ZERO_RATED;
  }

  if (deductible && documentVat === 0) {
    // Eligible in every respect, and the supply simply bears no tax. There is
    // no asset to recognise, and saying "zero-rated" is more use than an empty
    // 1200 line.
    deductible = false;
    noInputVatReason = NO_INPUT_VAT.ZERO_RATED;
  }

  return finalize({
    amount, priceMode, isTaxInvoice, vatDeductible,
    invoiceDate, invoiceNumber, supplier,
    statedVatAmount: stated.value, statedVatRate: rated.value,
    documentVat, rate, source, deductible, noInputVatReason,
    policy, policyDate, missing,
  });
}

/** inclusive → the tax already inside the amount; exclusive → on top of it. */
function vatFromRate(amount, rate, priceMode) {
  if (rate <= 0) return 0;
  return priceMode === 'exclusive'
    ? round2(amount * rate)
    : round2(amount - amount / (1 + rate));
}

/**
 * Turns the decision into money.
 *
 * Rounding drift lands on the NET, never on the tax: the tax is the figure
 * that gets filed and must equal the document to the halala, and net + vat
 * must still equal gross.
 */
function finalize(d) {
  const gross = d.priceMode === 'exclusive' ? round2(d.amount + d.documentVat) : d.amount;
  const vat = d.deductible ? round2(d.documentVat) : 0;
  const net = round2(gross - vat);
  return {
    gross, net, vat,
    // What the DOCUMENT bears, deductible or not. In inclusive mode a
    // non-deductible tax is buried in the cost — this is the only record that
    // it was ever there.
    documentVat: round2(d.documentVat),
    source: d.source,
    rate: d.rate,
    deductible: Boolean(d.deductible),
    noInputVatReason: d.noInputVatReason || null,
    missing: d.missing,
    lineDescription: inputVatLineDescription({
      source: d.source, rate: d.rate, policyEffectiveFrom: d.policy?.effectiveFrom || null,
    }),
    // ── ما كانت عليه الفاتورة والقواعد لحظة الترحيل ──
    // Frozen onto the entry. Without it, "why was 1200 debited 5.00 on this
    // purchase?" is answered by re-running today's switches over the raw row,
    // and a policy edited next year silently restates last year's reclaim.
    snapshot: {
      isTaxInvoice: d.isTaxInvoice,
      vatDeductible: d.vatDeductible,
      invoiceDate: d.invoiceDate || null,
      invoiceNumber: d.invoiceNumber || null,
      supplier: d.supplier || null,
      priceMode: d.priceMode,
      // The rate APPLIED (null when the figure was copied off the document),
      // and the amount the supplier STATED (null when they did not).
      vatRate: d.rate,
      vatAmount: d.statedVatAmount,
      net, vat, gross,
      documentVat: round2(d.documentVat),
      source: d.source,
      deductible: Boolean(d.deductible),
      noInputVatReason: d.noInputVatReason || null,
      policyDate: d.policyDate || null,
      policyEffectiveFrom: d.policy?.effectiveFrom || null,
    },
  };
}
