// ═══════════════════════════════════════════════════════════════════════════
// قواعد الترحيل على الخادم — source record → journal entry
// ═══════════════════════════════════════════════════════════════════════════
// The client used to build the entry and send it. That made "server
// authoritative" a slogan: the server validated the ARITHMETIC of whatever it
// was handed, but had no idea whether those lines described the wash they
// claimed to. A caller could send a balanced entry for 50,000 riyals citing a
// 115-riyal wash and the books would take it.
//
// Now the client sends `{ kind, sourceId }` and nothing else. The server reads
// the actual document and builds the entry from it. The payload cannot lie
// about the amount, the date, the payment method or the VAT treatment,
// because none of those come from the payload any more.
//
// This is a deliberate second copy of src/lib/accounting/postingRules.js. The
// client keeps its copy to PREVIEW what an entry will look like; this one
// decides what it is.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './invariants.js';

export const ACC = {
  CASH: '1010', BANK: '1020', RECEIVABLE: '1100', INPUT_VAT: '1200',
  EMPLOYEE_ADVANCE: '1300', FIXED_ASSETS: '1500', ACCUM_DEPRECIATION: '1510',
  PAYABLE: '2000', OUTPUT_VAT: '2100', PARTNER_CAPITAL: '3000',
  WASH_REVENUE: '4000',
  // مردودات وخصومات المبيعات — a CONTRA-revenue account. A credit note
  // reduces revenue, but netting it against 4000 would hide the return; a
  // separate debit-side account keeps gross sales and returns both visible.
  SALES_RETURNS: '4010',
  BIKER_COMMISSION: '5000', VARIABLE_COSTS: '5100',
  RENT_MONTHLY: '5200', ADMIN_EXPENSES: '5300', DEPRECIATION: '5400',
};

export const VAT_RATE = 0.15;

/**
 * Splits an amount into { gross, net, vat }.
 *
 * Rounding drift lands on NET, never on the tax: the tax figure is the one
 * that gets filed, and net + vat must equal gross to the halala.
 */
export function splitVat(amount, { mode = 'inclusive', taxable = true, rate = VAT_RATE } = {}) {
  const value = round2(amount);
  if (!taxable || value === 0) return { gross: value, net: value, vat: 0 };
  if (mode === 'exclusive') {
    const vat = round2(value * rate);
    return { gross: round2(value + vat), net: value, vat };
  }
  const vat = round2(value - value / (1 + rate));
  return { gross: value, net: round2(value - vat), vat };
}

/** The account cash lands in, on the SALES side. Exported for the notes. */
export function settlementForSale(method) {
  switch (method) {
    case 'cash': return ACC.CASH;
    case 'card': case 'transfer': return ACC.BANK;
    case 'credit': return ACC.RECEIVABLE;
    default: return ACC.CASH;
  }
}

/** The account money leaves from, on the PURCHASE side. */
function settlementForPurchase(method, paymentStatus) {
  if (paymentStatus === 'unpaid' || method === 'credit') return ACC.PAYABLE;
  switch (method) {
    case 'cash': return ACC.CASH;
    case 'card': case 'transfer': return ACC.BANK;
    default: return ACC.CASH;
  }
}

const EXPENSE_ACCOUNT = {
  monthly: ACC.RENT_MONTHLY,
  voucher: ACC.RENT_MONTHLY,
  variable: ACC.VARIABLE_COSTS,
  annual: ACC.ADMIN_EXPENSES,
  startup: ACC.FIXED_ASSETS,      // capitalised, not expensed
};

/** Per-partner capital sub-account: 3000 → 3000-<partnerId>. */
export function partnerCapitalCode(partnerId) {
  const id = String(partnerId || '').trim();
  return id ? `${ACC.PARTNER_CAPITAL}-${id}` : ACC.PARTNER_CAPITAL;
}

function buildExpense(kind, row, id, { vatRegistered }) {
  const raw = round2(
    kind === 'monthly' ? row.total_monthly_cost
      : kind === 'variable' ? row.total_variable_cost
        : kind === 'voucher' ? row.amount
          : row.amount,
  );
  const date = String(
    kind === 'monthly' ? row.logged_date
      : kind === 'variable' ? row.logged_date
        : kind === 'voucher' ? row.dueDate
          : row.spent_date,
  ).slice(0, 10);
  const description = kind === 'voucher'
    ? `${row.templateName || 'مصروف شهري'} — ${row.periodKey}`
    : (row.expense_name || row.description || 'مصروف');

  const method = (kind === 'voucher' ? row.paymentMethod : row.payment_method) || 'cash';
  const paid = kind === 'voucher'
    ? (row.paymentStatus === 'paid' ? 'paid' : 'unpaid')
    : kind === 'monthly'
      ? (row.payment_status === 'paid' ? 'paid' : 'unpaid')
      : 'paid';
  const isTaxInvoice = kind === 'voucher' ? row.isTaxInvoice : row.is_tax_invoice;
  const vatDeductible = (kind === 'voucher' ? row.vatDeductible : row.vat_deductible) !== false;
  // A non-deductible input tax is part of the cost, not a receivable.
  const deductible = Boolean(vatRegistered && isTaxInvoice && vatDeductible);
  const { gross, net, vat } = splitVat(raw, { taxable: deductible });

  const lines = [
    { accountId: EXPENSE_ACCOUNT[kind] || ACC.ADMIN_EXPENSES, debit: net, credit: 0, description },
  ];
  if (vat > 0) {
    lines.push({ accountId: ACC.INPUT_VAT, debit: vat, credit: 0, description: 'ضريبة مدخلات قابلة للاسترداد' });
  }
  const supplier = kind === 'voucher' ? row.supplier : row.supplier;
  lines.push({
    accountId: settlementForPurchase(method, paid),
    debit: 0, credit: gross,
    description: supplier ? `المورد: ${supplier}` : 'سداد',
  });
  const invoiceNo = kind === 'voucher' ? row.invoiceNumber : row.invoice_number;
  return {
    entry: {
      entryDate: date,
      sourceType: 'expense',
      sourceId: id,
      description: `${description}${invoiceNo ? ` — فاتورة ${invoiceNo}` : ''}`,
    },
    lines,
  };
}

/**
 * Every source the server knows how to post.
 *
 * `lockKind` is what makes a lock unambiguous. Five different collections all
 * post with `sourceType: 'expense'`, so locking on the source type alone put
 * a monthly expense and a variable expense in the same namespace — two
 * documents whose ids happen to match would have shadowed each other. The
 * lock is keyed on the KIND instead, which is one-to-one with a collection.
 */
// `dateOf` is the date the record BELONGS to — which is also the date whose
// tax policy governs it. Posting a July wash in September must file it under
// July's rules, so the poster resolves the policy from this before building.
export const ADAPTERS = {
  wash: {
    collection: 'washes',
    lockKind: 'wash',
    dateOf: (r) => String(r.wash_date || '').slice(0, 10),
    approved: (r) => r.status === 'مكتملة',
    notApproved: 'الغسلة غير مكتملة — لا يُعترف بالإيراد قبل إتمامها.',
    build: (row, id, { vatRegistered, washPriceMode, vatRate = VAT_RATE }) => {
      const qty = Math.max(0, Number(row.quantity) || 0);
      const price = Math.max(0, Number(row.price) || 0);
      const mode = row.price_mode || washPriceMode;
      const { gross, net, vat } = splitVat(round2(qty * price), {
        mode, taxable: vatRegistered, rate: vatRate,
      });
      const lines = [
        { accountId: settlementForSale(row.payment_method || 'cash'), debit: gross, credit: 0, description: 'تحصيل غسلات' },
        { accountId: ACC.WASH_REVENUE, debit: 0, credit: net, description: 'إيراد غسيل السيارات' },
      ];
      if (vat > 0) lines.push({ accountId: ACC.OUTPUT_VAT, debit: 0, credit: vat, description: 'ضريبة مخرجات 15%' });
      return {
        entry: {
          entryDate: String(row.wash_date || '').slice(0, 10),
          sourceType: 'wash', sourceId: id,
          description: `غسلات ${row.biker_name ? `— ${row.biker_name}` : ''} (${qty} × ${price})`.trim(),
        },
        lines,
        // ── ما كانت عليه القواعد لحظة الترحيل ──
        // Stored on the entry so a later settings change cannot restate this
        // wash. Without it, "what was this wash's net revenue?" is answered by
        // re-running today's switches over the raw row — and flipping
        // `washPriceMode` in August moves July.
        taxSnapshot: {
          vatRegistered: Boolean(vatRegistered),
          washPriceMode: mode === 'exclusive' ? 'exclusive' : 'inclusive',
          vatRate: vatRegistered ? vatRate : 0,
          net, vat, gross,
        },
      };
    },
  },

  monthly: {
    collection: 'monthly_expenses',
    lockKind: 'monthly',
    dateOf: (r) => String(r.logged_date || '').slice(0, 10),
    // A recurring template has no date: it is not a document, and its dated
    // vouchers are what get posted.
    approved: (r) => Boolean(r.logged_date),
    notApproved: 'مصروف متكرر بلا تاريخ — ولّد سنداً مؤرخاً لكل فترة.',
    build: (row, id, opts) => buildExpense('monthly', row, id, opts),
  },
  variable: {
    collection: 'variable_expenses',
    lockKind: 'variable',
    dateOf: (r) => String(r.logged_date || '').slice(0, 10),
    approved: () => true,
    build: (row, id, opts) => buildExpense('variable', row, id, opts),
  },
  annual: {
    collection: 'annual_expense_entries',
    lockKind: 'annual',
    dateOf: (r) => String(r.paid_date || r.logged_date || '').slice(0, 10),
    approved: () => true,
    build: (row, id, opts) => buildExpense('annual', row, id, opts),
  },
  startup: {
    collection: 'startup_cost_entries',
    lockKind: 'startup',
    dateOf: (r) => String(r.paid_date || r.logged_date || '').slice(0, 10),
    approved: () => true,
    build: (row, id, opts) => buildExpense('startup', row, id, opts),
  },
  voucher: {
    collection: 'expense_vouchers',
    lockKind: 'voucher',
    dateOf: (r) => String(r.due_date || r.logged_date || '').slice(0, 10),
    approved: (r) => r.status !== 'cancelled',
    notApproved: 'السند ملغى.',
    build: (row, id, opts) => buildExpense('voucher', row, id, opts),
  },

  partner_payment: {
    collection: 'partner_payments',
    lockKind: 'partner_payment',
    dateOf: (r) => String(r.payment_date || '').slice(0, 10),
    approved: () => true,
    build: (row, id) => {
      const amount = round2(row.amount);
      const method = row.payment_method || 'transfer';
      return {
        entry: {
          entryDate: String(row.payment_date || '').slice(0, 10),
          sourceType: 'partner_payment', sourceId: id,
          description: 'دفعة رأس مال شريك',
        },
        lines: [
          { accountId: method === 'cash' ? ACC.CASH : ACC.BANK, debit: amount, credit: 0, description: 'استلام دفعة' },
          { accountId: partnerCapitalCode(row.partner_id), debit: 0, credit: amount, description: 'رأس مال شريك' },
        ],
      };
    },
  },

  temporary_expense: {
    collection: 'temporary_expenses',
    lockKind: 'temporary_expense',
    dateOf: (r) => String(r.spent_date || '').slice(0, 10),
    approved: () => true,
    build: (row, id) => {
      const amount = round2(row.amount);
      return {
        entry: {
          entryDate: String(row.spent_date || '').slice(0, 10),
          sourceType: 'temporary_expense', sourceId: id,
          description: `عهدة / مصروف مؤقت — ${row.title || ''}`.trim(),
        },
        lines: [
          { accountId: ACC.EMPLOYEE_ADVANCE, debit: amount, credit: 0, description: row.title || 'عهدة' },
          { accountId: (row.payment_method || 'cash') === 'cash' ? ACC.CASH : ACC.BANK, debit: 0, credit: amount, description: 'صرف' },
        ],
      };
    },
  },
  recovery: {
    collection: 'temporary_expenses',
    lockKind: 'recovery',
    dateOf: (r) => String(r.recovered_date || '').slice(0, 10),
    approved: (r) => r.status === 'recovered' && Boolean(r.recovered_date),
    notApproved: 'العهدة لم تُسترد بعد.',
    build: (row, id) => {
      const amount = round2(row.amount);
      const method = row.recovery_method || row.payment_method || 'cash';
      return {
        entry: {
          entryDate: String(row.recovered_date || '').slice(0, 10),
          sourceType: 'recovery', sourceId: id,
          description: `استرداد عهدة — ${row.title || ''}`.trim(),
        },
        lines: [
          { accountId: method === 'cash' ? ACC.CASH : ACC.BANK, debit: amount, credit: 0, description: 'استرداد' },
          { accountId: ACC.EMPLOYEE_ADVANCE, debit: 0, credit: amount, description: row.title || 'عهدة' },
        ],
      };
    },
  },
};

export const POSTABLE_KINDS = Object.keys(ADAPTERS);

/**
 * Kinds an OPERATOR may post.
 *
 * The decision, stated plainly: an operator already decides when a wash is
 * complete, and auto-posting is meant to fire at that moment. Denying them
 * would mean either disabling auto-posting for the people who actually use
 * the app, or granting them the accountant role — a far wider grant. So they
 * may post a wash, and nothing else: no manual entries, no expenses, no
 * period close. Every other kind needs an accountant.
 */
export const OPERATOR_POSTABLE_KINDS = ['wash'];

/**
 * May this role post this kind? The one place the decision lives, so it can
 * be tested rather than inferred from the callable wiring.
 *
 * `null` kind means a MANUAL entry, whose lines come from the caller — that is
 * an accountant's act, never an operator's.
 */
export function canPost(role, kind) {
  if (role === 'admin' || role === 'accountant') return true;
  if (role !== 'operator') return false;
  return kind != null && OPERATOR_POSTABLE_KINDS.includes(String(kind));
}

/** Legacy lock ids, written before locks were keyed on the kind. */
export function legacyLockIdFor(kind, sourceId) {
  const a = ADAPTERS[kind];
  if (!a) return null;
  const legacyType = ['monthly', 'variable', 'annual', 'startup', 'voucher'].includes(kind)
    ? 'expense' : a.lockKind;
  return legacyType === a.lockKind ? null : `${legacyType}__${sourceId}`;
}
