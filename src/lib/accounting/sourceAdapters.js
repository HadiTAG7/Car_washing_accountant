// ═══════════════════════════════════════════════════════════════════════════
// محوّلات المصادر — one definition of "how does this record become an entry"
// ═══════════════════════════════════════════════════════════════════════════
// Both posting paths read from here: the manual sweep (postOperations.js) and
// the auto-post that fires the moment a record is approved (autoPost.js). Two
// separate definitions would drift, and a drift between them is precisely the
// bug that posts the same business twice or with different numbers.
//
// Every adapter answers the same four questions about a RAW Firestore row:
//   • is it approved yet (and if not, why not)?
//   • what date does it carry?
//   • what identity does the ledger know it by (sourceType + sourceId)?
//   • what entry does it build?
//
// Raw rows, not mapped app objects: the adapters are used server-side of the
// UI, and re-reading the stored row means posting what was actually saved.
// ═══════════════════════════════════════════════════════════════════════════

import { washPostabilityProblem } from '../sweater/revenueOriginClient.js';
import {
  buildWashEntry, buildExpenseEntry, buildPartnerPaymentEntry,
  buildTemporaryExpenseEntry, buildRecoveryEntry, canPostWash, expenseAccountFor,
} from './postingRules.js';

/**
 * The tax fields every purchase carries, read off a RAW row.
 *
 * Snake_case for the four client-written collections. Pulled out because the
 * per-source `toExpense` functions used to list the fields by hand and each
 * listed a different subset — `vat_amount`, `vat_rate`, `price_mode` and
 * `invoice_date` reached Firestore and stopped there, so the preview split
 * every invoice at 15% no matter what the supplier had written on it.
 */
export function taxFieldsOf(r) {
  return {
    isTaxInvoice: r.is_tax_invoice === true,
    invoiceUrl: r.invoice_url,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    supplier: r.supplier,
    // `?? null`, never `|| null`: an explicit 0 is a zero-rated supply, a real
    // answer, and `||` would erase it into "not stated".
    vatAmount: r.vat_amount ?? null,
    vatRate: r.vat_rate ?? null,
    priceMode: r.price_mode || 'inclusive',
    vatDeductible: r.vat_deductible !== false,
  };
}

/** Shared shape for the four expense-like sources. */
function expenseAdapter({ collection, kind, toExpense, isApproved, notApprovedReason, label }) {
  return {
    collection,
    kind,
    sourceType: 'expense',
    sourceId: (r) => r.id,
    dateOf: (r) => toExpense(r).date,
    isApproved: isApproved || (() => true),
    notApprovedReason,
    label,
    // `policyAt` carries the dated tax record through to the engine, so the
    // preview prices a 5%-era invoice at 5% exactly as the server will.
    build: (r, { policyAt = null } = {}) => buildExpenseEntry(
      toExpense(r), { expenseAccount: expenseAccountFor(kind), policyAt },
    ),
  };
}

const monthlyExpense = (r) => ({
  id: r.id, description: r.expense_name, amount: r.total_monthly_cost,
  date: r.logged_date,
  paymentMethod: r.payment_method, paymentStatus: r.payment_status === 'paid' ? 'paid' : 'unpaid',
  ...taxFieldsOf(r),
});

export const ADAPTERS = {
  // ── الغسلات ─────────────────────────────────────────────────────────
  wash: {
    collection: 'washes',
    kind: 'wash',
    sourceType: 'wash',
    sourceId: (r) => r.id,
    dateOf: (r) => r.wash_date,
    // Revenue belongs to a COMPLETED wash. An in-progress job is not an
    // earned sale, and posting it would overstate income in the period.
    // نفس شرطَي الخادم — معاينةٌ تَعِد بما يرفضه الخادم أسوأ من غياب المعاينة.
    isApproved: (r) => canPostWash({ status: r.status }) && !washPostabilityProblem(r),
    notApprovedReason: (r) => washPostabilityProblem(r) || 'غير مكتملة — لا يُعترف بالإيراد بعد',
    label: (r) => `غسلات ${r.biker_name || ''} ${r.wash_date || ''}`.trim(),
    build: (r, { vatRegistered = true, washPriceMode = 'inclusive' } = {}) => buildWashEntry({
      id: r.id, bikerName: r.biker_name, quantity: r.quantity, price: r.price,
      status: r.status, washDate: r.wash_date, paymentMethod: r.payment_method || 'cash',
    }, { vatRegistered, priceMode: r.price_mode || washPriceMode }),
  },

  // ── المصروفات ───────────────────────────────────────────────────────
  monthly: expenseAdapter({
    collection: 'monthly_expenses',
    kind: 'monthly',
    toExpense: monthlyExpense,
    // A recurring template has no single spend date — it is not a document.
    // Its per-period vouchers are, and they come through the `voucher`
    // adapter below.
    isApproved: (r) => Boolean(r.logged_date),
    notApprovedReason: 'مصروف متكرر بلا تاريخ — ولّد سنداً مؤرخاً لكل فترة',
    label: (r) => [r.expense_name || 'مصروف', r.logged_date].filter(Boolean).join(' — '),
  }),

  variable: expenseAdapter({
    collection: 'variable_expenses',
    kind: 'variable',
    toExpense: (r) => ({
      id: r.id, description: r.expense_name, amount: r.total_variable_cost,
      date: r.logged_date,
      paymentMethod: r.payment_method, paymentStatus: 'paid',
      ...taxFieldsOf(r),
    }),
    label: (r) => [r.expense_name || 'مصروف', r.logged_date].filter(Boolean).join(' — '),
  }),

  annual: expenseAdapter({
    collection: 'annual_expense_entries',
    kind: 'annual',
    toExpense: (r) => ({
      id: r.id, description: r.description, amount: r.amount,
      date: r.paid_date || r.spent_date,
      paymentMethod: r.payment_method || 'cash', paymentStatus: 'paid',
      ...taxFieldsOf(r),
    }),
    label: (r) => [r.description || 'مصروف', r.spent_date].filter(Boolean).join(' — '),
  }),

  startup: expenseAdapter({
    collection: 'startup_cost_entries',
    kind: 'startup',
    toExpense: (r) => ({
      id: r.id, description: r.description, amount: r.amount,
      date: r.paid_date || r.spent_date,
      paymentMethod: r.payment_method || 'cash', paymentStatus: 'paid',
      ...taxFieldsOf(r),
    }),
    label: (r) => [r.description || 'مصروف', r.spent_date].filter(Boolean).join(' — '),
  }),

  // ── سندات المصاريف المتكررة ─────────────────────────────────────────
  voucher: expenseAdapter({
    collection: 'expense_vouchers',
    kind: 'monthly',       // the expense account is the monthly one
    // A voucher is written by `buildVoucher`, in camelCase — it never passes
    // through the snake_case client mappers, so it needs its own reading.
    toExpense: (v) => ({
      id: v.id, description: `${v.templateName || 'مصروف شهري'} — ${v.periodKey}`,
      amount: v.amount, date: v.dueDate,
      paymentMethod: v.paymentMethod || 'cash',
      // Unpaid credits the SUPPLIER, not cash: the liability exists from the
      // due date whether or not it has been settled.
      paymentStatus: v.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      isTaxInvoice: v.isTaxInvoice === true,
      invoiceUrl: v.invoiceUrl,
      invoiceNumber: v.invoiceNumber,
      invoiceDate: v.invoiceDate,
      supplier: v.supplier,
      vatAmount: v.vatAmount ?? null,
      vatRate: v.vatRate ?? null,
      priceMode: v.priceMode || 'inclusive',
      vatDeductible: v.vatDeductible !== false,
    }),
    isApproved: (v) => v.status !== 'cancelled',
    notApprovedReason: 'سند ملغى',
    label: (v) => [v.templateName || 'مصروف شهري', v.periodKey].filter(Boolean).join(' — '),
  }),

  // ── دفعات الشركاء ───────────────────────────────────────────────────
  partner_payment: {
    collection: 'partner_payments',
    kind: 'partner_payment',
    sourceType: 'partner_payment',
    sourceId: (r) => r.id,
    dateOf: (r) => r.payment_date,
    isApproved: () => true,
    label: (r, ctx = {}) => `دفعة ${ctx.partnerName || ''} ${r.payment_date || ''}`.trim(),
    build: (r, { partnerName = null } = {}) => buildPartnerPaymentEntry({
      id: r.id, partnerId: r.partner_id, partnerName,
      amount: r.amount, paymentDate: r.payment_date, paymentMethod: r.payment_method || 'transfer',
    }),
  },

  // ── العهد ───────────────────────────────────────────────────────────
  temporary_expense: {
    collection: 'temporary_expenses',
    kind: 'temporary_expense',
    sourceType: 'temporary_expense',
    sourceId: (r) => r.id,
    dateOf: (r) => r.spent_date,
    isApproved: () => true,
    label: (r) => `عهدة ${r.title || ''}`.trim(),
    build: (r) => buildTemporaryExpenseEntry({
      id: r.id, title: r.title, amount: r.amount, spentDate: r.spent_date,
      paymentMethod: r.payment_method || 'cash',
    }),
  },

  recovery: {
    collection: 'temporary_expenses',
    kind: 'recovery',
    sourceType: 'recovery',
    sourceId: (r) => r.id,
    dateOf: (r) => r.recovered_date,
    isApproved: (r) => r.status === 'recovered' && Boolean(r.recovered_date),
    notApprovedReason: 'لم تُسترد بعد',
    label: (r) => `استرداد ${r.title || ''}`.trim(),
    build: (r) => buildRecoveryEntry({
      id: r.id, title: r.title, amount: r.amount, recoveredDate: r.recovered_date,
      paymentMethod: r.payment_method || 'cash',
    }),
  },
};

/** Kinds that a UI action can approve, and therefore auto-post. */
export const AUTO_POSTABLE_KINDS = ['wash', 'monthly', 'variable', 'annual', 'startup'];

export function adapterFor(kind) {
  const a = ADAPTERS[kind];
  if (!a) throw new Error(`نوع سجل غير معروف: ${kind}`);
  return a;
}
