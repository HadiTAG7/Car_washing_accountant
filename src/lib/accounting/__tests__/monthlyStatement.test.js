/**
 * قائمة الدخل الشهرية — من دفتر الأستاذ.
 *
 * The statement used to be summed out of the raw operational tables, so a
 * credit note changed nothing on it: revenue, profit, the management fee and
 * the six-month trend all still reported a sale that had been given back in
 * full. These fix the numbers the page, the CSV and the chart all read.
 */
import { describe, it, expect } from 'vitest';
import { monthlyStatement, monthRange, reconcileOperational, DEFAULT_FEE_RULES } from '../monthlyStatement';

const ACCOUNTS = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit' },
  { code: '4000', nameArabic: 'إيرادات غسيل السيارات', accountType: 'revenue', normalBalance: 'credit' },
  { code: '4010', nameArabic: 'مردودات وخصومات المبيعات', accountType: 'revenue', normalBalance: 'debit', contra: true },
  { code: '4100', nameArabic: 'أرباح استبعاد أصول', accountType: 'revenue', normalBalance: 'credit' },
  { code: '5000', nameArabic: 'عمولات البايكرز', accountType: 'expense', normalBalance: 'debit', directCost: true },
  { code: '5100', nameArabic: 'مصروفات متغيرة', accountType: 'expense', normalBalance: 'debit', directCost: true },
  { code: '5200', nameArabic: 'الإيجار', accountType: 'expense', normalBalance: 'debit' },
];

let seq = 0;
/** An entry plus its lines, in the shape the reports read. */
function entryOf(entryDate, rows, over = {}) {
  seq += 1;
  const id = `e${seq}`;
  return {
    entry: {
      id, entryDate, periodKey: entryDate.slice(0, 7), entryNumber: seq,
      status: 'posted', sourceType: 'manual', ...over,
    },
    lines: rows.map((r, i) => ({
      id: `${id}-${i}`, entryId: id, accountId: r[0], debit: r[1] || 0, credit: r[2] || 0,
    })),
  };
}

function bundle(...built) {
  return {
    accounts: ACCOUNTS,
    entries: built.map((b) => b.entry),
    lines: built.flatMap((b) => b.lines),
  };
}

/** A 115 sale: Dr cash 115 · Cr revenue 100 · Cr output VAT 15. */
const SALE = (date = '2026-08-11') => entryOf(date, [['1010', 115, 0], ['4000', 0, 100], ['2100', 0, 15]]);
/** A full credit note against it: Dr returns 100 · Dr VAT 15 · Cr cash 115. */
const CREDIT = (date = '2026-08-20', net = 100, vat = 15) =>
  entryOf(date, [['4010', net, 0], ['2100', vat, 0], ['1010', 0, net + vat]], { sourceType: 'adjustment' });

describe('نطاق الشهر', () => {
  it('يعطي أول الشهر وآخره — بما فيه فبراير الكبيسة', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('يرفض مفتاحاً غير صالح بدل اختراع شهر', () => {
    expect(monthRange('2026-13')).toEqual({ from: null, to: null });
    expect(monthRange('2026-00')).toEqual({ from: null, to: null });
    expect(monthRange('')).toEqual({ from: null, to: null });
  });
});

describe('قائمة الدخل الشهرية من القيود', () => {
  it('تقرأ الإيراد من 4000 وتخصم 4010 — الإشعار الدائن يخفض القائمة', () => {
    const s = monthlyStatement({ ...bundle(SALE(), CREDIT()), periodKey: '2026-08' });
    expect(s.grossRevenue).toBe(100);
    expect(s.salesReturns).toBe(100);
    expect(s.netRevenue).toBe(0);
    expect(s.grossProfit).toBe(0);
    expect(s.netProfitBeforeFees).toBe(0);
    // No profit, so no management fee and no supervisor's share.
    expect(s.totalFees).toBe(0);
    expect(s.netProfit).toBe(0);
  });

  it('الإشعار الجزئي يخفض القائمة والرسوم معاً', () => {
    const full = monthlyStatement({ ...bundle(SALE()), periodKey: '2026-08' });
    const partial = monthlyStatement({ ...bundle(SALE(), CREDIT('2026-08-20', 40, 6)), periodKey: '2026-08' });

    expect(full.netRevenue).toBe(100);
    expect(partial.netRevenue).toBe(60);
    expect(partial.salesReturns).toBe(40);
    // 10% + 5% of the profit, and the profit itself fell by 40.
    expect(full.totalFees).toBe(15);
    expect(partial.totalFees).toBe(9);
    expect(partial.netProfit).toBe(51);
    expect(partial.netProfit).toBeLessThan(full.netProfit);
  });

  it('الإشعار المدين يرفع القائمة والرسوم', () => {
    const debit = entryOf('2026-08-22', [['1010', 23, 0], ['4000', 0, 20], ['2100', 0, 3]]);
    const s = monthlyStatement({ ...bundle(SALE(), debit), periodKey: '2026-08' });
    expect(s.netRevenue).toBe(120);
    expect(s.totalFees).toBe(18);
    expect(s.netProfit).toBe(102);
  });

  it('القيد المعكوس ومرآته يلغيان بعضهما في القائمة', () => {
    const sale = SALE();
    const mirror = entryOf('2026-08-25',
      [['1010', 0, 115], ['4000', 100, 0], ['2100', 15, 0]],
      { sourceType: 'adjustment', reversalOf: sale.entry.id });
    sale.entry.status = 'reversed';

    const s = monthlyStatement({ ...bundle(sale, mirror), periodKey: '2026-08' });
    expect(s.netRevenue).toBe(0);
    expect(s.netProfit).toBe(0);
  });

  it('تفصل التكاليف المباشرة عن المصاريف التشغيلية', () => {
    const costs = entryOf('2026-08-05', [['5000', 30, 0], ['1010', 0, 30]]);
    const rent  = entryOf('2026-08-01', [['5200', 20, 0], ['1010', 0, 20]]);
    const s = monthlyStatement({ ...bundle(SALE(), costs, rent), periodKey: '2026-08' });

    expect(s.directCosts).toBe(30);
    expect(s.operatingExpenses).toBe(20);
    expect(s.totalCosts).toBe(50);
    expect(s.grossProfit).toBe(70);
    expect(s.netProfitBeforeFees).toBe(50);
    expect(s.totalFees).toBe(7.5);
    expect(s.netProfit).toBe(42.5);
  });

  it('لا تحتسب قيود شهر آخر', () => {
    const s = monthlyStatement({ ...bundle(SALE('2026-07-31'), SALE('2026-08-01')), periodKey: '2026-08' });
    expect(s.netRevenue).toBe(100);
  });

  it('الإيراد غير التشغيلي يظهر منفصلاً ولا يختلط بالمبيعات', () => {
    const disposal = entryOf('2026-08-09', [['1010', 50, 0], ['4100', 0, 50]]);
    const s = monthlyStatement({ ...bundle(SALE(), disposal), periodKey: '2026-08' });
    expect(s.grossRevenue).toBe(100);
    expect(s.otherRevenue).toBe(50);
    expect(s.netRevenue).toBe(150);
  });

  // ── الخسارة لا تُنتج رسوماً ──
  it('الشهر الخاسر لا يُحمَّل رسوم إدارة ولا راتب مشرف', () => {
    const rent = entryOf('2026-08-01', [['5200', 500, 0], ['1010', 0, 500]]);
    const s = monthlyStatement({ ...bundle(SALE(), rent), periodKey: '2026-08' });
    expect(s.netProfitBeforeFees).toBe(-400);
    expect(s.totalFees).toBe(0);
    expect(s.netProfit).toBe(-400);
  });

  it('قواعد الرسوم المُعرَّفة تحلّ محل الافتراضية، وتُحترم تواريخ سريانها', () => {
    const s = monthlyStatement({
      ...bundle(SALE()),
      periodKey: '2026-08',
      feeRules: [
        { key: 'mgmt', label: 'رسوم إدارة', basis: 'revenue', rate: 0.05, effectiveFrom: '2026-01-01' },
        { key: 'later', label: 'رسوم لاحقة', basis: 'revenue', rate: 0.5, effectiveFrom: '2027-01-01' },
      ],
    });
    expect(s.fees.map((f) => f.key)).toEqual(['mgmt']);
    expect(s.totalFees).toBe(5);
    expect(DEFAULT_FEE_RULES.map((f) => f.rate)).toEqual([0.10, 0.05]);
  });

  it('حصة الشريك تُقاس على كل سطر بنفس النسبة', () => {
    const full = monthlyStatement({ ...bundle(SALE()), periodKey: '2026-08' });
    const half = monthlyStatement({ ...bundle(SALE()), periodKey: '2026-08', scalingFactor: 0.5 });
    expect(half.netRevenue).toBe(full.netRevenue / 2);
    expect(half.totalFees).toBe(full.totalFees / 2);
    expect(half.netProfit).toBe(full.netProfit / 2);
  });

  it('شهر بلا قيود يعطي أصفاراً معلنة لا أرقاماً مخترعة', () => {
    const s = monthlyStatement({ accounts: ACCOUNTS, entries: [], lines: [], periodKey: '2026-08' });
    expect(s.netRevenue).toBe(0);
    expect(s.netProfit).toBe(0);
    expect(s.hasActivity).toBe(false);
  });
});

describe('مطابقة التشغيل بالدفاتر', () => {
  it('تُظهر الفرق حين تُسجَّل غسلة ولم تُرحَّل', () => {
    const s = monthlyStatement({ ...bundle(SALE()), periodKey: '2026-08' });
    const r = reconcileOperational({ operationalRevenue: 230, statement: s });
    expect(r.operational).toBe(230);
    expect(r.ledger).toBe(100);
    expect(r.difference).toBe(130);
    expect(r.matched).toBe(false);
  });

  it('وتُظهر أن الفرق قد يكون مردودات لا غسلات ناقصة', () => {
    const s = monthlyStatement({ ...bundle(SALE(), CREDIT()), periodKey: '2026-08' });
    const r = reconcileOperational({ operationalRevenue: 100, statement: s });
    expect(r.ledger).toBe(0);
    expect(r.difference).toBe(100);
    expect(r.salesReturns).toBe(100);
  });
});
