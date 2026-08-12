// ═══════════════════════════════════════════════════════════════════════════
// رسوم التأسيس: من مبلغ على البند إلى قيد له مستند
// ═══════════════════════════════════════════════════════════════════════════
// `startup_costs` began as a PLAN — بند، كمية، مبلغ مخطط. Then an
// `actual_amount` column was added to it, and a `is_tax_invoice` flag beside
// that, and the VAT report started reading both. Which produced a record that
// nothing in the accounting layer could ever post:
//
//   • `ADAPTERS.startup` reads `startup_cost_entries`, not `startup_costs`.
//     There is no server-authoritative path for a parent-level amount, and
//     there must not be one: the parent has no spend date, no payment method
//     and no per-document identity — three things a journal entry cannot be
//     built without.
//   • So the row entered `input.tax` in the return and could never appear on
//     `1200` in the books. `inputMismatch` for that item was permanent.
//   • And the date it was reported under was `created_at` — the day the row
//     was TYPED. A deduction filed under the day someone opened a form is not
//     a deduction filed under the invoice's date; the two differ by however
//     long the paperwork took, and periods are quarters.
//
// The fix is not a posting path for the parent. It is to stop the parent
// being a document at all:
//
//   • A new item is a PLAN. `actual_amount` and the tax fields are not
//     writable on it — the mapper drops them, so no form can reintroduce them.
//   • Real spend is a `startup_cost_entries` row, which has a date, a payment
//     method and an invoice identity, and which the `startup` adapter already
//     posts.
//   • A legacy parent that still carries an amount is neither deducted nor
//     discarded: it is listed as REQUIRING CONVERSION, and converting it asks
//     the user for the facts nobody can infer — the spend date, the payment
//     method, and the invoice. Nothing is guessed, and `created_at` is never
//     used as either date.
//   • The converted entry's id is derived from the parent, so converting
//     twice writes the same document rather than a second one.
// ═══════════════════════════════════════════════════════════════════════════

import { blockingVatProblems, isRealCalendarDate } from '../vatFields';
import { periodKeyOf, round2 } from './journal';

/** `legacy__<parentId>` — the id IS the idempotency key, as with vouchers. */
export function legacyEntryIdFor(parentId) {
  return `legacy__${String(parentId ?? '').trim()}`;
}

/**
 * Does this parent still hold spend that has never become a document?
 *
 * `hasEntries` is the double-count guard: once a sub-ledger entry exists, the
 * parent's `actual_amount` is a ROLL-UP of those entries, not a figure of its
 * own, and counting it as well would claim the same money twice.
 */
export function startupParentNeedsConversion(item, { hasEntries = false } = {}) {
  if (!item || hasEntries) return false;
  return (Number(item.actualAmount) || 0) > 0;
}

/**
 * …and does it also carry a tax claim that the return would otherwise take?
 *
 * These are the rows that made the report and the ledger disagree, so they are
 * named separately from the merely-unconverted ones.
 */
export function startupParentClaimsVat(item, opts) {
  return startupParentNeedsConversion(item, opts) && item.isTaxInvoice === true;
}

/**
 * What the user must supply before a parent amount can become an entry.
 *
 * Every one of these is a fact only they have. The row records what was
 * budgeted and what was eventually spent; it does not record WHEN, HOW, or
 * against which document — and inventing any of the three is how a deduction
 * ends up in the wrong quarter or against no paper at all.
 */
export function startupConversionProblems(parent, form = {}, {
  hasEntries = false, closedPeriods = null,
} = {}) {
  const problems = [];
  const amount = round2(Number(parent?.actualAmount) || 0);

  if (!parent) return ['البند غير موجود.'];
  if (hasEntries) {
    problems.push('لهذا البند سجل مصاريف بالفعل — المبلغ الفعلي مجموع قيوده، ولا يُحوَّل مرة أخرى.');
  }
  if (!(amount > 0)) {
    problems.push('لا يوجد مبلغ فعلي على البند ليُحوَّل.');
  }
  // The spend date is REQUIRED and never defaulted. `created_at` is the day
  // the row was typed, which is not the day the money moved and not the day
  // the invoice was raised.
  if (!isRealCalendarDate(form.spentDate)) {
    problems.push('تاريخ الصرف/السداد مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }
  if (!['cash', 'card', 'transfer', 'credit'].includes(String(form.paymentMethod || ''))) {
    problems.push('طريقة الدفع مطلوبة.');
  }
  if (form.isTaxInvoice) {
    if (!isRealCalendarDate(form.invoiceDate)) {
      problems.push('تاريخ الفاتورة مطلوب — وهو ما يحدّد فترة الخصم، لا تاريخ الصرف.');
    }
    if (!String(form.invoiceNumber || '').trim()) problems.push('رقم الفاتورة مطلوب.');
    if (!String(form.supplier || '').trim()) problems.push('اسم المورّد مطلوب.');
  }
  // The same gate every expense form runs, so a value this door would not
  // accept cannot arrive through it either.
  for (const p of blockingVatProblems(form, { amount })) problems.push(p.message);

  // A converted entry lands in the ledger on its invoice date and settles on
  // its spend date. Both months have to be open, or the entry becomes one
  // nobody can post — a conversion that produces an unpostable record has
  // only moved the problem.
  if (closedPeriods) {
    const months = new Set([
      isRealCalendarDate(form.spentDate) ? periodKeyOf(form.spentDate) : null,
      form.isTaxInvoice && isRealCalendarDate(form.invoiceDate) ? periodKeyOf(form.invoiceDate) : null,
    ].filter(Boolean));
    for (const m of months) {
      if (closedPeriods.has(m)) {
        problems.push(`الفترة ${m} مقفلة — لا يمكن إنشاء قيد فيها. اختر تاريخاً في فترة مفتوحة أو أعد فتحها.`);
      }
    }
  }
  return problems;
}

/**
 * The `startup_cost_entries` row a conversion produces, in app shape.
 *
 * The AMOUNT is the parent's own `actual_amount` — the one figure the legacy
 * record does hold and the only one not being asked for again.
 */
export function buildStartupConversionEntry(parent, form = {}) {
  return {
    id: legacyEntryIdFor(parent.id),
    startupCostId: parent.id,
    description: String(form.description || parent.itemName || 'رسوم تأسيس').trim(),
    amount: round2(Number(parent.actualAmount) || 0),
    spentDate: String(form.spentDate || '').slice(0, 10),
    notes: 'مُحوَّل من مبلغ فعلي كان مسجَّلاً على البند مباشرة',
    isTaxInvoice: form.isTaxInvoice === true,
    invoiceUrl: String(form.invoiceUrl ?? parent.invoiceUrl ?? '').trim(),
    invoiceNumber: String(form.invoiceNumber || '').trim(),
    invoiceDate: String(form.invoiceDate || '').slice(0, 10),
    supplier: String(form.supplier || '').trim(),
    vatAmount: form.vatAmount ?? null,
    vatRate: form.vatRate ?? null,
    priceMode: form.priceMode === 'exclusive' ? 'exclusive' : 'inclusive',
    vatDeductible: form.vatDeductible !== false,
    paymentMethod: form.paymentMethod,
  };
}

/**
 * Every legacy parent still awaiting conversion, oldest budget first.
 *
 * `ledgerParentIds` is the set of items that already have entries; they are
 * done and are excluded, which is the same guard the VAT report applies.
 */
export function pendingStartupConversions(items = [], ledgerParentIds = new Set()) {
  const has = ledgerParentIds instanceof Set ? ledgerParentIds : new Set(ledgerParentIds || []);
  return (items || [])
    .filter((i) => startupParentNeedsConversion(i, { hasEntries: has.has(i.id) }))
    .map((i) => ({
      id: i.id,
      itemName: i.itemName,
      amount: round2(Number(i.actualAmount) || 0),
      claimsVat: i.isTaxInvoice === true,
      invoiceUrl: i.invoiceUrl || '',
    }));
}

/**
 * What a sub-ledger entry must carry before the server will write it.
 *
 * The same three facts the parent lacks, plus the tax-field gate every expense
 * form runs. Checked on the SERVER as well as in the form, because a form is a
 * convenience and `startup_cost_entries` is now closed to direct client
 * writes precisely so this is the only door.
 */
export function startupEntryProblems(entry = {}) {
  const problems = [];
  if (!String(entry.description || '').trim()) problems.push('وصف المصروف مطلوب.');
  const amount = Number(entry.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    problems.push('مبلغ المصروف يجب أن يكون أكبر من صفر.');
  }
  if (!isRealCalendarDate(entry.spentDate)) {
    problems.push('تاريخ الصرف مطلوب ويجب أن يكون تاريخاً حقيقياً (YYYY-MM-DD).');
  }
  for (const p of blockingVatProblems(entry, { amount: Math.max(0, amount || 0) })) {
    problems.push(p.message);
  }
  return problems;
}

/**
 * The parent's roll-up — the ONE place `actual_amount` and `status` are
 * derived, and the only place either is allowed to come from.
 *
 * `status` is a FUNCTION of the total and the budget, not a value anyone gets
 * to choose. It used to be both: `startupRollup` derived it on every entry
 * change while the client could also set it by hand and could edit
 * `budgeted_amount` directly. So raising a budget from 1,000 to 2,000 against
 * 1,500 of spend left the row saying `completed` — the number it was derived
 * from had moved and the derivation had not been re-run.
 *
 * Every caller — add, delete, convert, update-plan — goes through here, so
 * the formula exists once and cannot drift between them.
 */
export function startupRollup(entryAmounts = [], plannedAmount = 0) {
  const total = round2(entryAmounts.reduce((s, a) => s + (Number(a) || 0), 0));
  const planned = Math.max(0, Number(plannedAmount) || 0);
  return { actualAmount: total, status: startupStatusOf(total, planned) };
}

/** `completed` once the spend has met the budget — and only if there IS spend. */
export function startupStatusOf(actualAmount, plannedAmount) {
  const total = Number(actualAmount) || 0;
  const planned = Math.max(0, Number(plannedAmount) || 0);
  return total >= planned && total > 0 ? 'completed' : 'in_progress';
}

/** The only fields of a plan a caller may change. `status` is NOT one. */
export const STARTUP_PLAN_FIELDS = ['category', 'itemName', 'quantity', 'plannedAmount'];

/**
 * What a plan edit may say, and what it may not.
 *
 * `status`, `actualAmount` and the tax block are refused OUT LOUD rather than
 * dropped: a caller that sent them believes they took effect, and silently
 * ignoring a field is how a UI comes to show something the database does not
 * hold.
 */
export function startupPlanUpdateProblems(patch = {}) {
  const problems = [];
  const forbidden = Object.keys(patch).filter((k) => [
    'status', 'actualAmount', 'actual_amount', 'isTaxInvoice', 'invoiceNumber',
    'invoiceDate', 'supplier', 'vatAmount', 'vatRate', 'priceMode',
    'vatDeductible', 'convertedAt', 'convertedBy',
  ].includes(k));
  if (forbidden.length) {
    problems.push(
      `هذه الحقول يملكها الخادم ولا تُرسل مع تعديل الخطة: ${forbidden.join('، ')}. `
      + 'الحالة مشتقة من المصروفات والميزانية، والمبلغ الفعلي مجموع سجل المصاريف.',
    );
  }
  if ('itemName' in patch && !String(patch.itemName || '').trim()) {
    problems.push('اسم البند مطلوب.');
  }
  if ('plannedAmount' in patch) {
    const planned = Number(patch.plannedAmount);
    if (!Number.isFinite(planned) || planned < 0) {
      problems.push('الميزانية المخططة يجب أن تكون رقماً غير سالب.');
    }
  }
  if ('quantity' in patch) {
    const q = Number(patch.quantity);
    if (!Number.isFinite(q) || q < 1) problems.push('الكمية يجب أن تكون واحداً فأكثر.');
  }
  if (!Object.keys(patch).some((k) => STARTUP_PLAN_FIELDS.includes(k))) {
    problems.push('لا يوجد حقل خطة صالح للتعديل.');
  }
  return problems;
}

/**
 * ── هل يحمل هذا البند صرفاً قديماً لم يصر مستنداً بعد؟ ──
 *
 * The detector both sides use, so the form and the server cannot disagree
 * about which rows are frozen. It is TRUE while the parent holds either half
 * of a legacy record and has no sub-ledger yet:
 *
 *   • an `actual_amount` of its own, or
 *   • invoice/tax fields of its own — even at a zero amount, because those
 *     fields are a claim the VAT report reads, and adding a child would make
 *     the report stop reading the parent, so the claim would vanish without
 *     anyone deciding it should.
 *
 * Adding an ordinary entry to such a row is refused. It used to be allowed,
 * and it destroyed the record twice over: `actual_amount` was recomputed as
 * SUM(children) — 1,150 became 100 — and the appearance of a child took the
 * parent out of the VAT report's parent pass, so its invoice stopped being
 * counted at all. Both losses were silent.
 */
export function startupParentHasLegacySpend(parent = {}, { hasEntries = false } = {}) {
  if (hasEntries) return false;
  if ((Number(parent.actualAmount) || 0) > 0) return true;
  return startupParentHasLegacyTaxFields(parent);
}

/** The invoice half of a legacy record, on its own. */
export function startupParentHasLegacyTaxFields(parent = {}) {
  return parent.isTaxInvoice === true
    || Boolean(String(parent.invoiceNumber || '').trim())
    || Boolean(String(parent.invoiceDate || '').trim())
    || Boolean(String(parent.supplier || '').trim())
    || parent.vatAmount != null
    || parent.vatRate != null;
}

/** Said once, so the refusal reads the same wherever it is raised. */
export const LEGACY_BLOCKS_ENTRY =
  'هذا البند يحمل مبلغاً فعلياً أو بيانات فاتورة مسجَّلة عليه مباشرة من قبل. '
  + 'لا يُضاف إليه مصروف حتى يُحوّل المحاسب ذلك المبلغ القديم إلى مستند مؤرَّخ '
  + '(«تحويل مبلغ البند إلى قيد») — وإلا فُقد المبلغ القديم وسقطت فاتورته من '
  + 'تقرير الضريبة بلا قرار من أحد.';
