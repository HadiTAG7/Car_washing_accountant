import { describe, it, expect } from 'vitest';
import {
  generalLedger, trialBalance, incomeStatement, balanceSheet,
  partnerCapitalBalance, postedLines,
} from '../reports';
import { DEFAULT_CHART_OF_ACCOUNTS, ACC, partnerCapitalAccount } from '../chartOfAccounts';
import { buildWashEntry, buildExpenseEntry, buildPartnerPaymentEntry } from '../postingRules';
import { buildReversal } from '../journal';
import { closePreflight, isPeriodClosed, postingBlockedReason, indexPeriods } from '../periods';

const CHART = [...DEFAULT_CHART_OF_ACCOUNTS, partnerCapitalAccount('p1', 'هادي')];

// The dated tax policy these fixtures live under. Stated, never assumed: the
// purchase engine refuses to price an invoice it cannot resolve a policy for
// rather than falling back on 15%, so a test that wants a 15% deduction has
// to say so.
const POLICY = () => ({
  known: true, vatRegistered: true, washPriceMode: 'inclusive',
  vatRate: 0.15, effectiveFrom: '2020-07-01',
});

// ── Tiny in-memory ledger, mirroring the Firestore shapes ────────────────
function makeLedger() {
  const entries = [], lines = [];
  let n = 0;
  return {
    entries, lines,
    post({ entry, lines: rows }, { status = 'posted' } = {}) {
      n += 1;
      const id = `e${n}`;
      entries.push({ ...entry, id, entryNumber: n, status });
      rows.forEach((l, i) => lines.push({ ...l, id: `${id}-l${i}`, entryId: id }));
      return id;
    },
  };
}

function seedBusiness() {
  const led = makeLedger();
  // Capital in.
  led.post(buildPartnerPaymentEntry({
    id: 'pp1', partnerId: 'p1', partnerName: 'هادي',
    amount: 20000, paymentDate: '2026-07-03', paymentMethod: 'transfer',
  }));
  // Two completed washes, VAT-inclusive.
  led.post(buildWashEntry({
    id: 'w1', quantity: 2, price: 57.5, status: 'مكتملة',
    washDate: '2026-08-05', paymentMethod: 'cash',
  }));
  led.post(buildWashEntry({
    id: 'w2', quantity: 4, price: 57.5, status: 'مكتملة',
    washDate: '2026-08-20', paymentMethod: 'card',
  }));
  // One deductible purchase. A COMPLETE tax invoice — number, date, supplier
  // and amount — because an incomplete one recognises no input-VAT asset, by
  // the same rule the VAT report applies to it.
  led.post(buildExpenseEntry({
    id: 'ex1', description: 'مواد تنظيف', amount: 230, date: '2026-08-10',
    isTaxInvoice: true, paymentMethod: 'cash', paymentStatus: 'paid',
    invoiceNumber: 'INV-77', invoiceDate: '2026-08-10', supplier: 'مؤسسة النظافة',
    vatRate: 0.15,
  }, { expenseAccount: ACC.VARIABLE_COSTS, policyAt: POLICY }));
  return led;
}

describe('دفتر الأستاذ', () => {
  const led = seedBusiness();
  const cashAccount = CHART.find((a) => a.code === ACC.CASH);

  it('يعرض الحركات بالترتيب مع رصيد تراكمي', () => {
    const gl = generalLedger(ACC.CASH, led.entries, led.lines, { account: cashAccount });
    expect(gl.rows.map((r) => r.entryDate)).toEqual(['2026-08-05', '2026-08-10']);
    // 115 in, then 230 out → −115.
    expect(gl.rows[0].balance).toBe(115);
    expect(gl.rows[1].balance).toBe(-115);
    expect(gl.closing).toBe(-115);
  });

  it('الرصيد الافتتاحي يحمل ما قبل الفترة', () => {
    const bank = CHART.find((a) => a.code === ACC.BANK);
    const gl = generalLedger(ACC.BANK, led.entries, led.lines, {
      from: '2026-08-01', account: bank,
    });
    // July's 20,000 capital receipt is before the window → opening balance.
    expect(gl.opening).toBe(20000);
    expect(gl.rows).toHaveLength(1);          // only the August card wash
    expect(gl.closing).toBe(20230);           // 20000 + 230
  });

  it('الختامي = الافتتاحي + مجموع حركات الفترة', () => {
    const gl = generalLedger(ACC.CASH, led.entries, led.lines, {
      from: '2026-08-01', to: '2026-08-31', account: cashAccount,
    });
    const movement = gl.rows.reduce((s, r) => s + r.debit - r.credit, 0);
    expect(gl.closing).toBe(gl.opening + movement);
  });

  it('يتجاهل قيود المسودة', () => {
    const led2 = makeLedger();
    led2.post(buildWashEntry({ id: 'w', quantity: 1, price: 115, status: 'مكتملة', washDate: '2026-08-01' }),
      { status: 'draft' });
    const gl = generalLedger(ACC.CASH, led2.entries, led2.lines, { account: cashAccount });
    expect(gl.rows).toHaveLength(0);
    expect(postedLines(led2.entries, led2.lines)).toHaveLength(0);
  });
});

describe('ميزان المراجعة', () => {
  const led = seedBusiness();

  it('متوازن: إجمالي المدين = إجمالي الدائن', () => {
    const tb = trialBalance(CHART, led.entries, led.lines);
    expect(tb.balanced).toBe(true);
    expect(tb.difference).toBe(0);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('يجمع الحركات لكل حساب', () => {
    const tb = trialBalance(CHART, led.entries, led.lines);
    const revenue = tb.rows.find((r) => r.code === ACC.WASH_REVENUE);
    // (2 + 4) × 57.5 = 345 gross → 300 net.
    expect(revenue.credit).toBe(300);
    const outVat = tb.rows.find((r) => r.code === ACC.OUTPUT_VAT);
    expect(outVat.credit).toBe(45);
  });

  it('يكشف قيداً غير متوازن', () => {
    const led2 = makeLedger();
    led2.entries.push({ id: 'bad', entryDate: '2026-08-01', periodKey: '2026-08', status: 'posted', entryNumber: 1 });
    led2.lines.push({ entryId: 'bad', accountId: ACC.CASH, debit: 100, credit: 0 });
    led2.lines.push({ entryId: 'bad', accountId: ACC.WASH_REVENUE, debit: 0, credit: 90 });
    const tb = trialBalance(CHART, led2.entries, led2.lines);
    expect(tb.balanced).toBe(false);
    expect(tb.difference).toBe(10);
  });

  it('يبلّغ عن حساب خارج الدليل', () => {
    const led2 = makeLedger();
    led2.entries.push({ id: 'x', entryDate: '2026-08-01', status: 'posted', entryNumber: 1 });
    led2.lines.push({ entryId: 'x', accountId: '9999', debit: 10, credit: 0 });
    led2.lines.push({ entryId: 'x', accountId: ACC.CASH, debit: 0, credit: 10 });
    expect(trialBalance(CHART, led2.entries, led2.lines).unknownAccounts).toEqual(['9999']);
  });

  it('يظل متوازناً بعد قيد عكسي', () => {
    const led2 = seedBusiness();
    const target = led2.entries.find((e) => e.sourceType === 'wash');
    const targetLines = led2.lines.filter((l) => l.entryId === target.id);
    led2.post(buildReversal(target, targetLines, { entryDate: '2026-09-01' }));
    const tb = trialBalance(CHART, led2.entries, led2.lines);
    expect(tb.balanced).toBe(true);
    // The reversed wash's revenue is cancelled: 300 − 100 = 200.
    expect(tb.rows.find((r) => r.code === ACC.WASH_REVENUE).balance).toBe(200);
  });
});

describe('قائمة الدخل', () => {
  const led = seedBusiness();

  it('تُبنى من القيود المرحّلة فقط', () => {
    const is = incomeStatement(CHART, led.entries, led.lines);
    expect(is.totalRevenue).toBe(300);          // net of VAT
    expect(is.totalCost).toBe(200);             // cleaning materials, net
    expect(is.grossProfit).toBe(100);
  });

  it('لا تُدرج ضريبة المدخلات كمصروف', () => {
    const is = incomeStatement(CHART, led.entries, led.lines);
    const all = [...is.costOfServices, ...is.expenses].map((r) => r.code);
    expect(all).not.toContain(ACC.INPUT_VAT);
  });

  it('رسوم الإدارة قابلة للتهيئة ولها تاريخ سريان', () => {
    const rules = [
      { key: 'mgmt', label: 'رسوم إدارة', basis: 'revenue', rate: 0.05, effectiveFrom: '2026-01-01' },
      { key: 'future', label: 'رسوم لاحقة', basis: 'revenue', rate: 0.10, effectiveFrom: '2027-01-01' },
    ];
    const is = incomeStatement(CHART, led.entries, led.lines, { to: '2026-12-31', feeRules: rules });
    expect(is.appliedFees.map((f) => f.key)).toEqual(['mgmt']);   // future rule excluded
    expect(is.totalFees).toBe(15);                                // 5% of 300
    expect(is.netProfit).toBe(is.operatingProfit - 15);
  });

  it('بلا قواعد رسوم لا تُخصم أي نسبة', () => {
    const is = incomeStatement(CHART, led.entries, led.lines);
    expect(is.totalFees).toBe(0);
    expect(is.netProfit).toBe(is.operatingProfit);
  });
});

describe('المركز المالي', () => {
  it('الأصول = الالتزامات + حقوق الملكية', () => {
    const led = seedBusiness();
    const bs = balanceSheet(CHART, led.entries, led.lines);
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
  });

  it('يبقى متوازناً بعد قيد عكسي', () => {
    const led = seedBusiness();
    const target = led.entries.find((e) => e.sourceType === 'expense');
    const targetLines = led.lines.filter((l) => l.entryId === target.id);
    led.post(buildReversal(target, targetLines, { entryDate: '2026-09-01' }));
    expect(balanceSheet(CHART, led.entries, led.lines).balanced).toBe(true);
  });
});

describe('رصيد الشريك مشتق من القيود', () => {
  it('يساوي مجموع دفعاته', () => {
    const led = makeLedger();
    for (const [amount, date] of [[20000, '2026-07-03'], [15000, '2026-07-20']]) {
      led.post(buildPartnerPaymentEntry({
        partnerId: 'p1', partnerName: 'هادي', amount, paymentDate: date,
      }));
    }
    expect(partnerCapitalBalance('3000-p1', led.entries, led.lines)).toBe(35000);
  });

  it('ينقص بعد عكس دفعة', () => {
    const led = makeLedger();
    led.post(buildPartnerPaymentEntry({ partnerId: 'p1', amount: 20000, paymentDate: '2026-07-03' }));
    const e = led.entries[0];
    led.post(buildReversal(e, led.lines.filter((l) => l.entryId === e.id), { entryDate: '2026-08-01' }));
    expect(partnerCapitalBalance('3000-p1', led.entries, led.lines)).toBe(0);
  });
});

describe('الفترات المقفلة', () => {
  const closed = indexPeriods([{ periodKey: '2026-07', status: 'closed' }]);

  it('يمنع الترحيل في فترة مقفلة', () => {
    expect(postingBlockedReason('2026-07-15', closed)).toContain('مقفلة');
    expect(isPeriodClosed('2026-07', closed)).toBe(true);
  });

  it('يسمح بالترحيل في فترة مفتوحة أو غير معرّفة', () => {
    expect(postingBlockedReason('2026-08-01', closed)).toBeNull();
    expect(isPeriodClosed('2026-08', closed)).toBe(false);
  });

  it('يرفض تاريخاً غير صالح', () => {
    expect(postingBlockedReason('nope', closed)).toContain('غير صالح');
  });

  it('فحص ما قبل الإقفال يمنع الإقفال مع وجود مسودة', () => {
    const led = seedBusiness();
    led.post(buildWashEntry({ id: 'w9', quantity: 1, price: 100, status: 'مكتملة', washDate: '2026-08-25' }),
      { status: 'draft' });
    const linesByEntry = new Map();
    for (const l of led.lines) {
      if (!linesByEntry.has(l.entryId)) linesByEntry.set(l.entryId, []);
      linesByEntry.get(l.entryId).push(l);
    }
    const pre = closePreflight('2026-08', { entries: led.entries, linesByEntry });
    expect(pre.ok).toBe(false);
    expect(pre.problems.join(' ')).toContain('مسودة');
  });

  it('فحص ما قبل الإقفال ينجح لفترة سليمة', () => {
    const led = seedBusiness();
    const linesByEntry = new Map();
    for (const l of led.lines) {
      if (!linesByEntry.has(l.entryId)) linesByEntry.set(l.entryId, []);
      linesByEntry.get(l.entryId).push(l);
    }
    const pre = closePreflight('2026-08', { entries: led.entries, linesByEntry });
    expect(pre.ok).toBe(true);
    expect(pre.totals.debit).toBe(pre.totals.credit);
  });

  it('فحص ما قبل الإقفال يكشف قيداً غير متوازن', () => {
    const entries = [{ id: 'b', periodKey: '2026-08', status: 'posted' }];
    const linesByEntry = new Map([['b', [
      { accountId: ACC.CASH, debit: 100, credit: 0 },
      { accountId: ACC.WASH_REVENUE, debit: 0, credit: 90 },
    ]]]);
    const pre = closePreflight('2026-08', { entries, linesByEntry });
    expect(pre.ok).toBe(false);
    expect(pre.problems.join(' ')).toContain('غير متوازن');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// A REVERSED entry still counts.
//
// `postedLines` used to keep only `status === 'posted'`, which dropped the
// original of a reversal while keeping its mirror — so a reversed 100 left
// the account at −100 instead of zero. Caught by the credit-note tests, and
// pinned here so it cannot come back.
// ─────────────────────────────────────────────────────────────────────────
describe('القيد المعكوس يبقى في الحساب مع مرآته', () => {
  const accounts = [
    { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
    { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit' },
  ];
  const entries = [
    { id: 'e1', status: 'reversed', entryDate: '2026-08-11', reversedBy: 'e2' },
    { id: 'e2', status: 'posted', entryDate: '2026-08-20', reversalOf: 'e1' },
    { id: 'e3', status: 'draft', entryDate: '2026-08-21' },
  ];
  const lines = [
    { entryId: 'e1', accountId: '1010', debit: 115, credit: 0 },
    { entryId: 'e1', accountId: '4000', debit: 0, credit: 115 },
    { entryId: 'e2', accountId: '1010', debit: 0, credit: 115 },
    { entryId: 'e2', accountId: '4000', debit: 115, credit: 0 },
    { entryId: 'e3', accountId: '1010', debit: 999, credit: 0 },
  ];

  it('الأثر الصافي صفر على كل حساب — لا سالب ولا مضاعف', () => {
    const tb = trialBalance(accounts, entries, lines);
    expect(tb.balanced).toBe(true);
    for (const row of tb.rows) {
      expect(row.balanceDebit).toBe(0);
      expect(row.balanceCredit).toBe(0);
    }
  });

  it('وكلا القيدين يظهران في دفتر الأستاذ', () => {
    const led = generalLedger('1010', entries, lines, { account: accounts[0] });
    expect(led.rows).toHaveLength(2);
    expect(led.closing).toBe(0);
  });

  it('والمسودة تبقى خارج التقرير', () => {
    const led = generalLedger('1010', entries, lines, { account: accounts[0] });
    expect(led.rows.some((r) => r.entryId === 'e3')).toBe(false);
  });
});
