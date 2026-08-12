// ═══════════════════════════════════════════════════════════════════════════
// السندات الدورية — turning a recurring template into dated documents
// ═══════════════════════════════════════════════════════════════════════════
// A row in `monthly_expenses` with `recurrence: 'monthly'` is a TEMPLATE, not
// a document: "the rent is 5,000 a month, due on the 5th". It has no date, so
// there is nothing to post, nothing to date a VAT claim to, and nothing an
// audit can point at.
//
// This module turns that template into one dated voucher per month. Once the
// voucher exists, everything downstream stops special-casing recurrence:
//   • the ledger posts it like any other expense;
//   • the VAT report claims it in the quarter it falls in, not ×3 by estimate;
//   • the income statement charges it to the month it belongs to.
//
// Idempotency is STRUCTURAL: the voucher's document id is derived from the
// template and the period, so generating twice writes the same document
// rather than a second one. There is no counter to race and no flag to trust.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal';
// The same gate the expense forms use — a template that would generate a
// voucher nobody can post is refused before it generates twelve of them.
import { blockingVatProblems } from '../vatFields';
import { addMonths, periodEndDate } from './depreciation';

export const VOUCHER_STATUSES = ['active', 'cancelled'];

/** `<templateId>__2026-08` — the id IS the idempotency key. */
export function voucherId(templateId, periodKey) {
  return `${templateId}__${periodKey}`;
}

/**
 * The due date for a period, clamped to the month.
 *
 * A template due "on the 31st" must not produce 2026-02-31. February gets the
 * 28th (29th in a leap year), which is what a supplier means by "end of
 * month" anyway.
 */
export function dueDateFor(periodKey, paymentDay) {
  const end = periodEndDate(periodKey);
  if (!end) return '';
  const lastDay = Number(end.slice(8, 10));
  const day = Math.min(Math.max(Math.trunc(Number(paymentDay) || lastDay), 1), lastDay);
  return `${periodKey}-${String(day).padStart(2, '0')}`;
}

/** Only a `monthly` template generates vouchers; a one-off row is already a document. */
export function isRecurringTemplate(template) {
  return String(template?.recurrence || 'monthly') === 'monthly';
}

/**
 * Is the template in force for this period?
 *
 * `startPeriod` / `endPeriod` are optional — a template without them is
 * open-ended, which is how every existing row behaves. A rent that ended in
 * June should stop generating in July, and saying so is the only way to stop
 * it without deleting the template's history.
 */
export function templateActiveIn(template, periodKey) {
  if (!isRecurringTemplate(template)) return false;
  if (template.active === false) return false;
  if (template.startPeriod && periodKey < String(template.startPeriod)) return false;
  if (template.endPeriod && periodKey > String(template.endPeriod)) return false;
  return true;
}

/** Arabic problems with a template, from the point of view of generating. */
export function validateTemplate(template) {
  const problems = [];
  if (!String(template?.expenseName || '').trim()) problems.push('اسم المصروف مطلوب.');
  if (!(Number(template?.totalMonthlyCost) > 0)) {
    problems.push('قيمة المصروف الشهري يجب أن تكون أكبر من صفر.');
  }
  if (template?.startPeriod && !/^\d{4}-\d{2}$/.test(String(template.startPeriod))) {
    problems.push('فترة البداية غير صالحة (المطلوب YYYY-MM).');
  }
  if (template?.endPeriod && !/^\d{4}-\d{2}$/.test(String(template.endPeriod))) {
    problems.push('فترة النهاية غير صالحة (المطلوب YYYY-MM).');
  }
  if (template?.startPeriod && template?.endPeriod
      && String(template.endPeriod) < String(template.startPeriod)) {
    problems.push('فترة النهاية قبل فترة البداية.');
  }
  // ── حقول الضريبة تُفحص قبل التوليد، لا بعد اثني عشر سنداً ──
  // A template's `vatRate`, `priceMode` and `vatDeductible` are COPIED onto
  // every voucher it generates, so a broken value is not one bad record — it
  // is a year of them, each of which then refuses to post. The same function
  // the expense forms gate on, applied one step earlier.
  for (const p of blockingVatProblems(template || {}, {
    amount: Number(template?.totalMonthlyCost) || 0,
  })) problems.push(p.message);
  return problems;
}

/**
 * Builds one voucher. The AMOUNT is copied, not referenced: raising the rent
 * next year must not silently restate last year's vouchers, and a document
 * whose figure moves is not a document.
 */
export function buildVoucher(template, periodKey, { generatedBy = null } = {}) {
  const amount = round2(Number(template.totalMonthlyCost) || 0);
  return {
    id: voucherId(template.id, periodKey),
    templateId: template.id,
    templateName: template.expenseName || 'مصروف شهري',
    categoryId: template.categoryId || '',
    periodKey,
    dueDate: dueDateFor(periodKey, template.paymentDay),
    quantity: Number(template.quantity) || 1,
    unitCost: round2(Number(template.unitCost) || amount),
    amount,
    // Copied at generation time for the same reason as the amount: a template
    // that stops being a tax invoice must not un-claim what was already filed.
    isTaxInvoice: Boolean(template.isTaxInvoice),
    invoiceUrl: template.invoiceUrl || '',
    // ── هوية الفاتورة: ما يثبت وما يتغيّر كل شهر ──
    // The SUPPLIER is a property of the arrangement, so it is copied: the
    // landlord in March is the landlord in April. The invoice NUMBER and DATE
    // are properties of one document and are unknowable at generation time —
    // they arrive with the paper. They stay empty until someone records them,
    // and until then this voucher recognises no input-VAT asset, exactly as
    // the VAT report refuses to deduct it. The two must not disagree.
    supplier: template.supplier || '',
    invoiceNumber: '',
    invoiceDate: '',
    // The tax treatment travels with the amount, for the same reason: a
    // template re-rated next year must not restate what a filed voucher
    // claimed. `vatAmount` stays null until the actual invoice arrives — the
    // supplier writes it, not the template.
    vatAmount: null,
    vatRate: template.vatRate ?? null,
    priceMode: template.priceMode || 'inclusive',
    vatDeductible: template.vatDeductible !== false,
    paymentStatus: 'pending',
    paidDate: null,
    status: 'active',
    generatedBy,
  };
}

/**
 * Which (template, period) pairs have no voucher yet, within a range.
 *
 * Returns them oldest-first so a backlog is generated in the order it
 * happened, which is also the order the ledger wants to post them in.
 */
export function missingVouchers(templates, existingIds, { from, through, generatedBy = null } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}$/.test(String(through || ''))) {
    return [];
  }
  if (String(through) < String(from)) return [];
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const out = [];
  for (let p = String(from); p <= String(through); p = addMonths(p, 1)) {
    for (const t of templates || []) {
      if (!templateActiveIn(t, p)) continue;
      if (validateTemplate(t).length) continue;
      if (have.has(voucherId(t.id, p))) continue;
      out.push(buildVoucher(t, p, { generatedBy }));
    }
  }
  return out;
}

/**
 * Templates that could not generate, with the reason — a silent skip in an
 * accounting tool is worse than no feature at all.
 */
export function ungeneratableTemplates(templates, { from, through } = {}) {
  const out = [];
  for (const t of templates || []) {
    if (!isRecurringTemplate(t)) continue;
    const problems = validateTemplate(t);
    if (problems.length) {
      out.push({ id: t.id, name: t.expenseName || '—', reason: problems[0] });
      continue;
    }
    if (t.active === false) {
      out.push({ id: t.id, name: t.expenseName, reason: 'موقوف' });
      continue;
    }
    if (from && through && !rangeOverlapsTemplate(t, from, through)) {
      out.push({
        id: t.id, name: t.expenseName,
        reason: t.endPeriod && String(t.endPeriod) < String(from)
          ? `انتهى في ${t.endPeriod}` : `يبدأ في ${t.startPeriod}`,
      });
    }
  }
  return out;
}

function rangeOverlapsTemplate(t, from, through) {
  if (t.startPeriod && String(t.startPeriod) > String(through)) return false;
  if (t.endPeriod && String(t.endPeriod) < String(from)) return false;
  return true;
}

/** Groups vouchers by period for the summary table. */
export function summariseVouchers(vouchers) {
  const byPeriod = new Map();
  for (const v of vouchers || []) {
    if (v.status === 'cancelled') continue;
    const cur = byPeriod.get(v.periodKey) || { periodKey: v.periodKey, count: 0, total: 0, unpaid: 0 };
    cur.count += 1;
    cur.total = round2(cur.total + (Number(v.amount) || 0));
    if (v.paymentStatus !== 'paid') cur.unpaid = round2(cur.unpaid + (Number(v.amount) || 0));
    byPeriod.set(v.periodKey, cur);
  }
  return [...byPeriod.values()].sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

/** Template ids that already have at least one live voucher. */
export function generatedTemplateIds(vouchers) {
  const ids = new Set();
  for (const v of vouchers || []) {
    if (v.status !== 'cancelled' && v.templateId) ids.add(String(v.templateId));
  }
  return ids;
}
