// ═══════════════════════════════════════════════════════════════════════════
// حقول الضريبة على فاتورة المشتريات — «غير مذكور» ليست صفراً
// ═══════════════════════════════════════════════════════════════════════════
// One definition, in one place, because three places were each deciding it
// separately and they disagreed — which is how a purchase saved without a
// stated VAT amount came to read as an explicit zero-VAT purchase in the
// return.
//
// The trap is `Number(null) === 0`. It is finite, it is non-negative, and it
// passes every plausible-looking guard — so `{ vatAmount: null }`, which is
// exactly what the mapper writes for "the supplier did not state one", was
// being deducted as a VAT of zero and labelled `source: 'invoice'` as though
// the supplier had written it. The fallback to the invoice's own rate, and
// then to the policy in force on its date, never ran.
//
// So the three states are named rather than inferred:
//
//   null / undefined / '' / whitespace   →  NOT STATED  (fall through)
//   0 / '0'                              →  an explicit zero (a zero-rated
//                                           or exempt supply, and a real
//                                           answer the report must honour)
//   any other finite non-negative number →  the stated figure
//
// `undefined` behaved correctly by accident (`Number(undefined)` is NaN);
// `null` did not. Accidentally-correct is not a property to rely on.
//
// ── قارئان لكل حقل، لا واحد ──
// `statedVatAmount` is the TOLERANT reader: it answers "what figure should I
// use", and a value it cannot use comes back as `null` — indistinguishable
// from "not stated". That is right for reading and wrong for saving, because
// it turns a typo into silence: −5 was stored as null and the invoice was
// then priced off the policy as though the user had never typed anything.
//
// So each field also has a STRICT reader — `readStatedVatAmount` — which
// separates the three outcomes: not stated, stated and usable, stated and
// broken. `validateTaxInvoiceFields` is built on the strict ones and is what
// both the form and the server posting engine gate on.
//
// A twin of this file runs on the server at functions/src/vatFields.js. The
// two are driven over one battery by functions/test/purchaseTax.test.js — the
// UI is not a security boundary, so the same rules must hold on both sides.
// ═══════════════════════════════════════════════════════════════════════════

/** True when a field carries no answer at all — as opposed to the answer 0. */
export function isUnstated(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * The VAT amount a supplier wrote on the document, or `null` for "not stated".
 *
 * Rounded to the halala, because it is money and it will be summed.
 */
export function statedVatAmount(value) {
  return readStatedVatAmount(value).value;
}

/**
 * The rate a document was raised at, as a fraction, or `null` for "not
 * stated". Zero is a real rate — a zero-rated supply — and survives.
 */
export function statedVatRate(value) {
  return readStatedVatRate(value).value;
}

/**
 * The strict reader: `{ stated, value, problem }`.
 *
 *   • `stated: false`            — the field is empty. Not an error.
 *   • `stated: true, value: n`   — a usable figure (0 included).
 *   • `stated: true, value: null` — something WAS typed and it is not a
 *     usable figure. `problem` says what is wrong, in Arabic, and the caller
 *     must refuse rather than silently treat it as "not stated".
 */
export function readStatedVatAmount(value) {
  if (isUnstated(value)) return { stated: false, value: null, problem: null };
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { stated: true, value: null, problem: 'مبلغ الضريبة يجب أن يكون رقماً.' };
  }
  if (n < 0) {
    return { stated: true, value: null, problem: 'مبلغ الضريبة لا يكون سالباً.' };
  }
  return { stated: true, value: Math.round(n * 100) / 100, problem: null };
}

/** The same three-way reading for the rate. A rate of 1 or more is not a rate. */
export function readStatedVatRate(value) {
  if (isUnstated(value)) return { stated: false, value: null, problem: null };
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { stated: true, value: null, problem: 'نسبة الضريبة يجب أن تكون رقماً.' };
  }
  if (n < 0 || n >= 1) {
    return { stated: true, value: null, problem: 'نسبة الضريبة يجب أن تكون بين 0% و100%.' };
  }
  return { stated: true, value: n, problem: null };
}

/** Whether the recorded amount already contains the tax. */
export function normalizedPriceMode(value) {
  return value === 'exclusive' ? 'exclusive' : 'inclusive';
}

/**
 * A date that EXISTS, not merely one shaped like a date.
 *
 * `Date.parse` rolls over: '2026-02-30' becomes 2 March without complaint, and
 * a regex is happy with it too. A deduction filed on a day that never happened
 * is filed in the wrong period, so the parsed date is compared back to its own
 * parts.
 */
export function isRealCalendarDate(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Which of the three sources will price this invoice, decided once so the
 * form, the report and the export all say the same thing.
 *
 * Returns 'invoice' | 'invoice-rate' | 'policy'.
 */
export function taxSourceFor(row = {}) {
  if (statedVatAmount(row.vatAmount) !== null) return 'invoice';
  if (statedVatRate(row.vatRate) !== null) return 'invoice-rate';
  return 'policy';
}

// ═══════════════════════════════════════════════════════════════════════════
// التحقق قبل الحفظ
// ═══════════════════════════════════════════════════════════════════════════
/** Two kinds of problem, and they are not interchangeable. */
export const VAT_PROBLEM = {
  // The value itself is wrong: negative, not a number, larger than the invoice
  // it sits on, a date that does not exist. Saving it stores a falsehood, so
  // it BLOCKS — on the form and again on the server.
  BLOCKING: 'blocking',
  // The value is fine; the document is simply not complete enough to deduct
  // against yet. A purchase may legitimately be recorded before its invoice
  // number arrives, so this does NOT block: it withholds the input-VAT asset
  // and says so, which is exactly what the VAT report already does with the
  // same fields (see inputInvoiceEligibility).
  INCOMPLETE: 'incomplete',
};

function hasText(v) { return String(v ?? '').trim().length > 0; }

/**
 * Every problem with the tax fields of one purchase, as explicit objects.
 *
 * `{ field, severity, message }` — never a bare boolean, because the caller
 * needs to know WHICH field to point at and whether it may proceed.
 *
 * The tolerant readers erase a bad value into `null`; this is what stops that
 * from happening quietly. `−5` is not "not stated", and `2026-02-30` is not a
 * date; both used to be swallowed and the record saved as though the user had
 * left the field alone.
 *
 * `amount` is the figure on the record: the GROSS when `priceMode` is
 * inclusive, the NET when it is exclusive. See docs/AMOUNT_DEFINITION.md —
 * every check below depends on which of the two it is.
 */
export function validateTaxInvoiceFields(form = {}, { amount = 0 } = {}) {
  const problems = [];
  const add = (field, message, severity = VAT_PROBLEM.BLOCKING) => {
    problems.push({ field, severity, message });
  };

  const mode = normalizedPriceMode(form.priceMode);
  const amountN = Number(amount);
  const hasAmount = Number.isFinite(amountN) && amountN > 0;

  const vatAmount = readStatedVatAmount(form.vatAmount);
  if (vatAmount.problem) add('vatAmount', vatAmount.problem);
  const vatRate = readStatedVatRate(form.vatRate);
  if (vatRate.problem) add('vatRate', vatRate.problem);

  // ── المبلغ لا يتجاوز ما هو مكتوب عليه ──
  if (vatAmount.value !== null && hasAmount) {
    if (mode === 'inclusive' && vatAmount.value > amountN + 0.005) {
      add('vatAmount',
        `مبلغ الضريبة (${vatAmount.value.toFixed(2)}) أكبر من إجمالي الفاتورة `
        + `(${amountN.toFixed(2)}) — والمبلغ المسجَّل شامل للضريبة.`);
    }
    // In exclusive mode the VAT sits ON TOP of the amount, so it may not be
    // compared against it — but it still cannot equal or exceed the net,
    // because that is a rate of 100% or more, which no rate is.
    if (mode === 'exclusive' && vatAmount.value >= amountN) {
      add('vatAmount',
        `مبلغ الضريبة (${vatAmount.value.toFixed(2)}) لا يقل عن الصافي `
        + `(${amountN.toFixed(2)}) — النسبة الضمنية 100% أو أكثر.`);
    }
  }

  // ── المبلغ والنسبة يجب أن يرويا القصة نفسها ──
  // The amount wins when they disagree (it is what the supplier wrote), so a
  // contradiction would be resolved silently and the rate the user chose would
  // vanish. Tolerance covers a supplier's own rounding, not a wrong figure.
  if (vatAmount.value !== null && vatRate.value !== null && hasAmount) {
    const expected = mode === 'exclusive'
      ? amountN * vatRate.value
      : amountN - amountN / (1 + vatRate.value);
    const tolerance = Math.max(0.02, Math.abs(expected) * 0.005);
    if (Math.abs(expected - vatAmount.value) > tolerance) {
      add('vatAmount',
        `مبلغ الضريبة (${vatAmount.value.toFixed(2)}) لا يوافق النسبة المختارة `
        + `(${(vatRate.value * 100).toFixed(2).replace(/\.?0+$/, '')}% ← ${expected.toFixed(2)}).`);
    }
  }

  // ── التاريخ تقويمي، لا مجرد شكل تاريخ ──
  if (!isUnstated(form.invoiceDate) && !isRealCalendarDate(form.invoiceDate)) {
    add('invoiceDate', 'تاريخ الفاتورة غير موجود في التقويم (YYYY-MM-DD).');
  }

  // ── هوية المستند ──
  if (form.isTaxInvoice) {
    if (isUnstated(form.invoiceDate)) {
      add('invoiceDate', 'تاريخ الفاتورة مطلوب للخصم.', VAT_PROBLEM.INCOMPLETE);
    }
    if (!hasText(form.invoiceNumber)) {
      add('invoiceNumber', 'رقم الفاتورة مطلوب للخصم.', VAT_PROBLEM.INCOMPLETE);
    }
    if (!hasText(form.supplier)) {
      add('supplier', 'اسم المورّد مطلوب للخصم.', VAT_PROBLEM.INCOMPLETE);
    }
  }

  return problems;
}

/** Only the problems that must stop a save. */
export function blockingVatProblems(form, opts) {
  return validateTaxInvoiceFields(form, opts).filter((p) => p.severity === VAT_PROBLEM.BLOCKING);
}

/** True when the tax fields are safe to store. */
export function taxInvoiceFieldsAreValid(form, opts) {
  return blockingVatProblems(form, opts).length === 0;
}

/** The first blocking message, for a form that shows one line. */
export function firstBlockingVatProblem(form, opts) {
  return blockingVatProblems(form, opts)[0]?.message || '';
}
