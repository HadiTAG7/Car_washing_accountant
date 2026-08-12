import { describe, it, expect } from 'vitest';
import {
  buildWashEntry, buildExpenseEntry, buildPartnerPaymentEntry,
  buildTemporaryExpenseEntry, buildRecoveryEntry, buildAdvanceToExpenseEntry,
  canPostWash, settlementAccountForSale, settlementAccountForPurchase,
  expenseAccountFor,
} from '../postingRules';
import { isBalanced, validateEntry, round2 } from '../journal';
import { ACC } from '../chartOfAccounts';

const CHART = new Set([
  ...Object.values(ACC), '3000-p1',
]);
/** Every builder's output must survive the same validation the DB enforces. */
function expectPostable({ entry, lines }) {
  expect(isBalanced(lines)).toBe(true);
  expect(validateEntry(entry, lines, { knownAccountCodes: CHART })).toEqual([]);
}
const amountOn = (lines, acc, side) =>
  round2(lines.filter((l) => l.accountId === acc).reduce((s, l) => s + (l[side] || 0), 0));

// The dated policy these fixtures live under. Stated, never assumed: the
// purchase engine refuses to price an invoice whose policy it cannot resolve
// rather than falling back on 15%, so a 15% deduction has to be asked for.
const POLICY = () => ({
  known: true, vatRegistered: true, washPriceMode: 'inclusive',
  vatRate: 0.15, effectiveFrom: '2020-07-01',
});

describe('ترحيل الغسلات', () => {
  const wash = {
    id: 'w1', bikerName: 'أحمد', quantity: 2, price: 57.5,
    status: 'مكتملة', washDate: '2026-08-11', paymentMethod: 'cash',
  };

  it('لا يُرحّل إلا الغسلة المكتملة', () => {
    expect(canPostWash(wash)).toBe(true);
    expect(canPostWash({ ...wash, status: 'قيد التنفيذ' })).toBe(false);
  });

  it('سعر شامل الضريبة: يفصل الصافي والضريبة', () => {
    const out = buildWashEntry(wash, { vatRegistered: true, priceMode: 'inclusive' });
    expectPostable(out);
    expect(amountOn(out.lines, ACC.CASH, 'debit')).toBe(115);
    expect(amountOn(out.lines, ACC.WASH_REVENUE, 'credit')).toBe(100);
    expect(amountOn(out.lines, ACC.OUTPUT_VAT, 'credit')).toBe(15);
  });

  it('سعر غير شامل: الضريبة تُضاف فوق السعر', () => {
    const out = buildWashEntry({ ...wash, price: 50 }, { vatRegistered: true, priceMode: 'exclusive' });
    expectPostable(out);
    expect(amountOn(out.lines, ACC.CASH, 'debit')).toBe(115);
    expect(amountOn(out.lines, ACC.WASH_REVENUE, 'credit')).toBe(100);
    expect(amountOn(out.lines, ACC.OUTPUT_VAT, 'credit')).toBe(15);
  });

  it('غير مسجّل في الضريبة: كامل المبلغ إيراد ولا سطر ضريبة', () => {
    const out = buildWashEntry(wash, { vatRegistered: false });
    expectPostable(out);
    expect(amountOn(out.lines, ACC.WASH_REVENUE, 'credit')).toBe(115);
    expect(out.lines.some((l) => l.accountId === ACC.OUTPUT_VAT)).toBe(false);
  });

  it('طريقة الدفع تحدد الحساب المقابل', () => {
    expect(settlementAccountForSale('cash')).toBe(ACC.CASH);
    expect(settlementAccountForSale('card')).toBe(ACC.BANK);
    expect(settlementAccountForSale('transfer')).toBe(ACC.BANK);
    expect(settlementAccountForSale('credit')).toBe(ACC.RECEIVABLE);
    const onCredit = buildWashEntry({ ...wash, paymentMethod: 'credit' });
    expect(amountOn(onCredit.lines, ACC.RECEIVABLE, 'debit')).toBe(115);
  });

  it('يحمل الفترة والمصدر الصحيحين', () => {
    const { entry } = buildWashEntry(wash);
    expect(entry.periodKey).toBe('2026-08');
    expect(entry.sourceType).toBe('wash');
    expect(entry.sourceId).toBe('w1');
  });
});

describe('ترحيل المصروفات', () => {
  // A COMPLETE tax invoice: number, date, supplier and amount. Anything less
  // recognises no input-VAT asset — the same test the VAT report applies, so
  // the ledger and the return cannot disagree.
  const expense = {
    id: 'e1', description: 'زيت محرك', amount: 230, date: '2026-08-11',
    isTaxInvoice: true, paymentMethod: 'cash', paymentStatus: 'paid',
    supplier: 'مؤسسة الزيت', invoiceNumber: 'INV-9', invoiceDate: '2026-08-11',
  };
  const opts = { expenseAccount: ACC.VARIABLE_COSTS, policyAt: POLICY };

  it('فاتورة ضريبية مؤهلة: يفصل ضريبة المدخلات', () => {
    const out = buildExpenseEntry(expense, opts);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.VARIABLE_COSTS, 'debit')).toBe(200);
    expect(amountOn(out.lines, ACC.INPUT_VAT, 'debit')).toBe(30);
    expect(amountOn(out.lines, ACC.CASH, 'credit')).toBe(230);
  });

  it('غير مؤهلة للخصم: كامل المبلغ على المصروف ولا ضريبة مدخلات', () => {
    const out = buildExpenseEntry({ ...expense, vatDeductible: false }, opts);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.VARIABLE_COSTS, 'debit')).toBe(230);
    expect(out.lines.some((l) => l.accountId === ACC.INPUT_VAT)).toBe(false);
  });

  it('ليست فاتورة ضريبية: لا فصل للضريبة', () => {
    const out = buildExpenseEntry({ ...expense, isTaxInvoice: false }, opts);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.VARIABLE_COSTS, 'debit')).toBe(230);
  });

  // ── هوية ناقصة لا تُنشئ أصلاً ضريبياً ──────────────────────────────
  it('فاتورة بلا تاريخ أو رقم أو مورّد: لا سطر 1200 مهما كانت السياسة', () => {
    for (const gap of [{ invoiceDate: '' }, { invoiceNumber: '' }, { supplier: '' }]) {
      const out = buildExpenseEntry({ ...expense, ...gap }, opts);
      expectPostable(out);
      expect(out.lines.some((l) => l.accountId === ACC.INPUT_VAT)).toBe(false);
      // …and the money that actually moved is still 230.
      expect(amountOn(out.lines, ACC.CASH, 'credit')).toBe(230);
      expect(amountOn(out.lines, ACC.VARIABLE_COSTS, 'debit')).toBe(230);
      expect(out.purchaseTaxSnapshot.noInputVatReason).toBe('incomplete-invoice');
    }
  });

  it('فاتورة غير مسددة تُقيَّد على الموردين لا على الصندوق', () => {
    const out = buildExpenseEntry({ ...expense, paymentStatus: 'unpaid' }, opts);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.PAYABLE, 'credit')).toBe(230);
    expect(out.lines.some((l) => l.accountId === ACC.CASH)).toBe(false);
    expect(settlementAccountForPurchase('cash', 'unpaid')).toBe(ACC.PAYABLE);
  });

  it('رسوم التأسيس تُرسمَل كأصل ثابت لا كمصروف', () => {
    expect(expenseAccountFor('startup')).toBe(ACC.FIXED_ASSETS);
    expect(expenseAccountFor('variable')).toBe(ACC.VARIABLE_COSTS);
    expect(expenseAccountFor('monthly')).toBe(ACC.RENT_MONTHLY);
    expect(expenseAccountFor('commission')).toBe(ACC.BIKER_COMMISSION);
  });

  it('ضريبة المدخلات أصل وليست مصروفاً', () => {
    const out = buildExpenseEntry(expense, opts);
    const vatLine = out.lines.find((l) => l.accountId === ACC.INPUT_VAT);
    // It sits on the debit side of an ASSET account, so the income statement
    // — which only reads expense accounts — never sees it.
    expect(vatLine.debit).toBeGreaterThan(0);
    expect(ACC.INPUT_VAT.startsWith('1')).toBe(true);
  });
});

describe('ترحيل دفعات الشركاء', () => {
  const payment = {
    id: 'pp1', partnerId: 'p1', partnerName: 'هادي', amount: 20000,
    paymentDate: '2026-07-03', paymentMethod: 'transfer',
  };

  it('مدين البنك ودائن رأس مال الشريك', () => {
    const out = buildPartnerPaymentEntry(payment);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.BANK, 'debit')).toBe(20000);
    expect(amountOn(out.lines, '3000-p1', 'credit')).toBe(20000);
  });

  it('يستخدم الحساب العام عند تعطيل الحسابات الفرعية', () => {
    const out = buildPartnerPaymentEntry(payment, { usePartnerSubAccount: false });
    expectPostable(out);
    expect(amountOn(out.lines, ACC.PARTNER_CAPITAL, 'credit')).toBe(20000);
  });

  it('الدفع نقداً يذهب للصندوق', () => {
    const out = buildPartnerPaymentEntry({ ...payment, paymentMethod: 'cash' });
    expect(amountOn(out.lines, ACC.CASH, 'debit')).toBe(20000);
  });

  it('رصيد الشريك يُشتق من مجموع القيود لا من رقم مخزّن', () => {
    const entries = [20000, 15000, 5000].map((amount, i) =>
      buildPartnerPaymentEntry({ ...payment, id: `pp${i}`, amount }));
    const balance = entries
      .flatMap((e) => e.lines)
      .filter((l) => l.accountId === '3000-p1')
      .reduce((s, l) => s + l.credit - l.debit, 0);
    expect(round2(balance)).toBe(40000);
  });
});

describe('العهد والاسترداد', () => {
  const temp = {
    id: 't1', title: 'سلفة وقود', amount: 500,
    spentDate: '2026-06-01', recoveredDate: '2026-06-20', paymentMethod: 'cash',
  };

  it('الصرف يُقيَّد كأصل قابل للاسترداد لا كمصروف', () => {
    const out = buildTemporaryExpenseEntry(temp);
    expectPostable(out);
    expect(amountOn(out.lines, ACC.EMPLOYEE_ADVANCE, 'debit')).toBe(500);
    expect(amountOn(out.lines, ACC.CASH, 'credit')).toBe(500);
    // No expense account is touched.
    expect(out.lines.every((l) => !l.accountId.startsWith('5'))).toBe(true);
  });

  it('الاسترداد يعكس الأصل ويُصفّي العهدة', () => {
    const spend  = buildTemporaryExpenseEntry(temp);
    const recover = buildRecoveryEntry(temp);
    expectPostable(recover);
    const net = [...spend.lines, ...recover.lines]
      .filter((l) => l.accountId === ACC.EMPLOYEE_ADVANCE)
      .reduce((s, l) => s + l.debit - l.credit, 0);
    expect(round2(net)).toBe(0);
  });

  it('التحويل إلى مصروف قرار صريح ويُصفّي العهدة', () => {
    const spend = buildTemporaryExpenseEntry(temp);
    const conv  = buildAdvanceToExpenseEntry(temp, {
      expenseAccount: ACC.ADMIN_EXPENSES, entryDate: '2026-07-01',
    });
    expectPostable(conv);
    expect(amountOn(conv.lines, ACC.ADMIN_EXPENSES, 'debit')).toBe(500);
    const net = [...spend.lines, ...conv.lines]
      .filter((l) => l.accountId === ACC.EMPLOYEE_ADVANCE)
      .reduce((s, l) => s + l.debit - l.credit, 0);
    expect(round2(net)).toBe(0);
    expect(conv.entry.periodKey).toBe('2026-07');
  });
});

describe('كل المولّدات تنتج قيوداً صالحة', () => {
  it('لا يوجد سطر يحمل الجانبين، والمجاميع متساوية', () => {
    const built = [
      buildWashEntry({ id: 'w', quantity: 3, price: 33.33, status: 'مكتملة', washDate: '2026-08-01' }),
      buildExpenseEntry({
        id: 'e', amount: 777.77, date: '2026-08-02', isTaxInvoice: true, description: 'x',
        invoiceNumber: 'A-1', invoiceDate: '2026-08-02', supplier: 'مورّد',
      }, { policyAt: POLICY }),
      buildPartnerPaymentEntry({ id: 'p', partnerId: 'p1', amount: 1234.56, paymentDate: '2026-08-03' }),
      buildTemporaryExpenseEntry({ id: 't', amount: 99.99, spentDate: '2026-08-04', title: 'y' }),
      buildRecoveryEntry({ id: 't', amount: 99.99, recoveredDate: '2026-08-05', title: 'y' }),
    ];
    for (const out of built) {
      expectPostable(out);
      for (const l of out.lines) {
        expect(l.debit > 0 && l.credit > 0).toBe(false);
        expect(l.debit === 0 && l.credit === 0).toBe(false);
      }
    }
  });
});
