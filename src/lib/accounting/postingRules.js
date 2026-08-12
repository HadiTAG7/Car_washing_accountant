// ═══════════════════════════════════════════════════════════════════════════
// قواعد الترحيل الآلي — operational record → balanced journal lines
// ═══════════════════════════════════════════════════════════════════════════
// Every builder here is PURE: it takes an operational record plus settings and
// returns { entry, lines }. Nothing reads or writes Firestore, so the whole
// posting policy is unit-testable, and the transaction layer stays a thin
// wrapper that validates and saves what these produce.
//
// Two rules run through all of them:
//   • VAT is only separated when the business is VAT-registered AND the
//     document qualifies. Otherwise the gross amount lands wholly on the
//     revenue or expense account — an input tax that cannot be reclaimed is
//     part of the cost, not a receivable. On the PURCHASE side that judgement,
//     and the tax figure itself, come from ./purchaseTax — the same module the
//     server posts with.
//   • The cash/bank/receivable side is chosen from the payment method, so an
//     unpaid invoice becomes a payable rather than a phantom cash movement.
// ═══════════════════════════════════════════════════════════════════════════

import { ACC, partnerCapitalCode } from './chartOfAccounts';
import { periodKeyOf, round2 } from './journal';
import { splitVatBalanced } from './vat';
// The purchase side is not split here: it is decided by the shared engine, so
// this preview and the server's posting cannot disagree about a reclaim.
import { resolvePurchaseTax } from './purchaseTax';
import { isRealCalendarDate } from '../vatFields';

/** طرق الدفع. `credit` = آجل (ذمم). */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'credit'];
export const PAYMENT_METHOD_LABELS = {
  cash:     'نقدي',
  card:     'مدى / شبكة',
  transfer: 'تحويل بنكي',
  credit:   'آجل',
};

/** The account money moves through for a given method, on the SALES side. */
export function settlementAccountForSale(method) {
  switch (method) {
    case 'cash':     return ACC.CASH;
    case 'card':
    case 'transfer': return ACC.BANK;
    case 'credit':   return ACC.RECEIVABLE;
    default:         return ACC.CASH;
  }
}

/** The account money moves through for a given method, on the PURCHASE side. */
export function settlementAccountForPurchase(method, paymentStatus) {
  // An unpaid purchase is a liability regardless of the intended method.
  if (paymentStatus === 'unpaid' || method === 'credit') return ACC.PAYABLE;
  switch (method) {
    case 'cash':     return ACC.CASH;
    case 'card':
    case 'transfer': return ACC.BANK;
    default:         return ACC.CASH;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// أ) الغسلات — wash revenue
// ─────────────────────────────────────────────────────────────────────────
/**
 * Revenue is recognised only for a COMPLETED wash: an in-progress job is not
 * yet an earned sale, and posting it would overstate income in the period.
 * The caller decides when to post; `canPostWash` states the rule.
 */
export function canPostWash(wash) {
  return wash?.status === 'مكتملة';
}

/**
 * غسلة → قيد إيراد.
 *   مدين  الصندوق/البنك/العملاء   بالإجمالي
 *   دائن  إيراد الغسيل            بالصافي
 *   دائن  ضريبة المخرجات          بمبلغ الضريبة   (عند التسجيل الضريبي فقط)
 */
export function buildWashEntry(wash, {
  vatRegistered = true,
  priceMode = 'inclusive',
  createdBy = null,
} = {}) {
  const qty   = Math.max(0, Number(wash.quantity) || 0);
  const price = Math.max(0, Number(wash.price) || 0);
  const raw   = round2(qty * price);
  const method = wash.paymentMethod || 'cash';

  const { gross, net, vat } = splitVatBalanced(raw, {
    mode: priceMode,
    taxable: vatRegistered,
  });

  const lines = [
    { accountId: settlementAccountForSale(method), debit: gross, credit: 0,
      description: `تحصيل غسلات — ${PAYMENT_METHOD_LABELS[method] || method}` },
    { accountId: ACC.WASH_REVENUE, debit: 0, credit: net, description: 'إيراد غسيل السيارات' },
  ];
  if (vat > 0) {
    lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: vat, description: 'ضريبة مخرجات 15%' });
  }

  const date = String(wash.washDate || '').slice(0, 10);
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'wash',
      sourceId:    wash.id ?? null,
      description: `غسلات ${wash.bikerName ? `— ${wash.bikerName}` : ''} (${qty} × ${price})`.trim(),
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ب) المصروفات — purchases
// ─────────────────────────────────────────────────────────────────────────
/**
 * مصروف → قيد.
 *   مدين  حساب المصروف/الأصل      بالصافي
 *   مدين  ضريبة المدخلات          بمبلغ الضريبة   (إن كانت مؤهلة للخصم)
 *   دائن  الصندوق/البنك/المورد    بالإجمالي
 *
 * ── الضريبة تأتي من الفاتورة، لا من نسبة افتراضية ──
 * Every figure comes from `resolvePurchaseTax`, the same engine the server
 * posts with: the amount the supplier wrote, then the rate stamped on the
 * document, then the policy in force on the INVOICE's date — and a refusal
 * rather than 15% when none of the three can answer.
 *
 * This preview and the server's entry are held identical by the drift battery
 * in functions/test/purchaseTax.test.js. A preview that promises a reclaim the
 * ledger will not book is worse than no preview.
 *
 * `vatDeductible` false → the tax is NOT split out: a non-deductible input tax
 * is part of the cost of the thing bought, and showing it as a recoverable
 * asset would overstate both the asset and the reclaim.
 */
export function buildExpenseEntry(expense, {
  expenseAccount = ACC.ADMIN_EXPENSES,
  // The dated policy record. Passing it is what lets a 5%-era invoice keep its
  // 5%; without it the engine falls back on what the invoice itself states and
  // recognises no input VAT when it states nothing.
  policyAt = null,
  createdBy = null,
} = {}) {
  const method = expense.paymentMethod || 'cash';
  const status = expense.paymentStatus || 'paid';
  const date = String(expense.date || expense.invoiceDate || '').slice(0, 10);

  const tax = resolvePurchaseTax({
    amount: expense.amount,
    priceMode: expense.priceMode,
    isTaxInvoice: expense.isTaxInvoice === true,
    vatDeductible: expense.vatDeductible !== false,
    invoiceNumber: expense.invoiceNumber,
    invoiceDate: expense.invoiceDate,
    supplier: expense.supplier,
    vatAmount: expense.vatAmount ?? null,
    vatRate: expense.vatRate ?? null,
    recordDate: date,
  }, { policyAt });

  // ── إثبات الفاتورة ثم السداد ──
  // Same rule as the server: the input tax is claimed in the INVOICE's period
  // and the cash moves on the day it moved. When the two days differ, that is
  // two entries, and a preview that showed one would promise a period the
  // ledger will not use. See docs/AMOUNT_DEFINITION.md and `buildExpense` in
  // functions/src/posting.js.
  const accrualDate = isRealCalendarDate(expense.invoiceDate)
    ? String(expense.invoiceDate).slice(0, 10)
    : date;
  const split = status !== 'unpaid' && accrualDate !== date;
  const supplierLabel = expense.supplier ? `المورد: ${expense.supplier}` : 'سداد';

  const lines = [
    { accountId: expenseAccount, debit: tax.net, credit: 0, description: expense.description || 'مصروف' },
  ];
  if (tax.vat > 0) {
    lines.push({
      accountId: ACC.INPUT_VAT, debit: tax.vat, credit: 0,
      description: tax.lineDescription,
    });
  }
  lines.push({
    accountId: split ? ACC.PAYABLE : settlementAccountForPurchase(method, status),
    debit: 0, credit: tax.gross,
    description: supplierLabel,
  });

  const ref  = expense.invoiceNumber ? ` — فاتورة ${expense.invoiceNumber}` : '';
  const built = {
    entry: {
      entryDate:   accrualDate,
      periodKey:   periodKeyOf(accrualDate),
      sourceType:  'expense',
      sourceId:    expense.id ?? null,
      description: `${expense.description || 'مصروف'}${ref}`,
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines,
    purchaseTaxSnapshot: tax.snapshot,
  };
  if (!split) return built;

  built.settlement = {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'expense',
      sourceId:    expense.id ?? null,
      description: `سداد ${expense.description || 'مصروف'}${ref}`,
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines: [
      { accountId: ACC.PAYABLE, debit: tax.gross, credit: 0, description: supplierLabel },
      {
        accountId: settlementAccountForPurchase(method, 'paid'),
        debit: 0, credit: tax.gross,
        description: `سداد ${accrualDate}`,
      },
    ],
  };
  return built;
}

/** Maps an operational expense kind onto its expense account. */
export function expenseAccountFor(kind) {
  switch (kind) {
    case 'variable':   return ACC.VARIABLE_COSTS;
    case 'commission': return ACC.BIKER_COMMISSION;
    case 'monthly':    return ACC.RENT_MONTHLY;
    case 'annual':     return ACC.ADMIN_EXPENSES;
    case 'startup':    return ACC.FIXED_ASSETS;   // capitalised, not expensed
    case 'depreciation': return ACC.DEPRECIATION;
    default:           return ACC.ADMIN_EXPENSES;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ج) دفعات الشركاء — partner capital
// ─────────────────────────────────────────────────────────────────────────
/**
 * دفعة شريك → قيد رأس مال.
 *   مدين  الصندوق/البنك
 *   دائن  رأس مال الشريك (حساب فرعي) أو رأس مال الشركاء
 *
 * The partner's paid-to-date is then a DERIVED figure (the credit balance of
 * their capital account), not a stored number that can drift out of step with
 * the receipts.
 */
export function buildPartnerPaymentEntry(payment, {
  usePartnerSubAccount = true,
  createdBy = null,
} = {}) {
  const amount = round2(Number(payment.amount) || 0);
  const method = payment.paymentMethod || 'cash';
  const cashAccount = method === 'cash' ? ACC.CASH : ACC.BANK;
  const capitalAccount = usePartnerSubAccount && payment.partnerId
    ? partnerCapitalCode(payment.partnerId)
    : ACC.PARTNER_CAPITAL;

  const date = String(payment.paymentDate || '').slice(0, 10);
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'partner_payment',
      sourceId:    payment.id ?? null,
      description: `دفعة رأس مال — ${payment.partnerName || 'شريك'}`,
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines: [
      { accountId: cashAccount, debit: amount, credit: 0,
        description: `استلام ${PAYMENT_METHOD_LABELS[method] || method}` },
      { accountId: capitalAccount, debit: 0, credit: amount, description: 'رأس مال شريك' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// د) المصروفات المؤقتة والاسترداد — advances and their recovery
// ─────────────────────────────────────────────────────────────────────────
/**
 * صرف عهدة → أصل قابل للاسترداد، وليس مصروفاً.
 *   مدين  عهد ومصروفات قابلة للاسترداد
 *   دائن  الصندوق/البنك
 *
 * It only becomes an operating expense if and when it is explicitly converted
 * (see `buildAdvanceToExpenseEntry`) — until then it is money owed back.
 */
export function buildTemporaryExpenseEntry(temp, { createdBy = null } = {}) {
  const amount = round2(Number(temp.amount) || 0);
  const method = temp.paymentMethod || 'cash';
  const date   = String(temp.spentDate || '').slice(0, 10);
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'temporary_expense',
      sourceId:    temp.id ?? null,
      description: `عهدة / مصروف مؤقت — ${temp.title || ''}`.trim(),
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines: [
      { accountId: ACC.EMPLOYEE_ADVANCE, debit: amount, credit: 0, description: temp.title || 'عهدة' },
      { accountId: method === 'cash' ? ACC.CASH : ACC.BANK, debit: 0, credit: amount, description: 'صرف' },
    ],
  };
}

/**
 * استرداد العهدة → عكس الأصل.
 *   مدين  الصندوق/البنك
 *   دائن  عهد ومصروفات قابلة للاسترداد
 */
export function buildRecoveryEntry(temp, { createdBy = null } = {}) {
  const amount = round2(Number(temp.amount) || 0);
  const method = temp.recoveryMethod || temp.paymentMethod || 'cash';
  const date   = String(temp.recoveredDate || '').slice(0, 10);
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'recovery',
      sourceId:    temp.id ?? null,
      description: `استرداد عهدة — ${temp.title || ''}`.trim(),
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines: [
      { accountId: method === 'cash' ? ACC.CASH : ACC.BANK, debit: amount, credit: 0, description: 'استرداد' },
      { accountId: ACC.EMPLOYEE_ADVANCE, debit: 0, credit: amount, description: temp.title || 'عهدة' },
    ],
  };
}

/**
 * تحويل عهدة غير مستردة إلى مصروف تشغيلي — قرار صريح، لا يحدث تلقائياً.
 *   مدين  حساب المصروف
 *   دائن  عهد ومصروفات قابلة للاسترداد
 */
export function buildAdvanceToExpenseEntry(temp, {
  expenseAccount = ACC.ADMIN_EXPENSES, entryDate, createdBy = null,
} = {}) {
  const amount = round2(Number(temp.amount) || 0);
  const date   = String(entryDate || temp.spentDate || '').slice(0, 10);
  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'adjustment',
      sourceId:    temp.id ?? null,
      description: `تحويل عهدة إلى مصروف — ${temp.title || ''}`.trim(),
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines: [
      { accountId: expenseAccount, debit: amount, credit: 0, description: temp.title || 'مصروف' },
      { accountId: ACC.EMPLOYEE_ADVANCE, debit: 0, credit: amount, description: 'إقفال عهدة' },
    ],
  };
}
