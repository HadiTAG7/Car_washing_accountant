/**
 * قائمة الدخل الشهرية — من دفتر الأستاذ.
 *
 * The statement used to be summed out of the raw operational tables, so a
 * credit note changed nothing on it: revenue, profit, the management fee and
 * the six-month trend all still reported a sale that had been given back in
 * full. These fix the numbers the page, the CSV and the chart all read.
 */
import { describe, it, expect } from 'vitest';
import {
  monthlyStatement, monthRange, operationalWashSales, postedWashSplit,
  reconcileOperational, DEFAULT_FEE_RULES,
} from '../monthlyStatement';
import { taxPolicyAt } from '../taxPolicy';

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

// ═══════════════════════════════════════════════════════════════════════════
// المطابقة: صافي بصافي، وكل بند مفسَّر باسمه
// ═══════════════════════════════════════════════════════════════════════════
// The old strip took `quantity × price` — a GROSS figure whenever wash prices
// are quoted VAT-inclusive — away from the statement's NET revenue and called
// the whole remainder "unposted washes". So a perfectly reconciled month
// reported a difference exactly equal to its output tax, and a credit note
// (which reduces the ledger and touches no wash) was reported as a missing
// posting. Both are fixed here.
describe('صافي المبيعات التشغيلية', () => {
  const wash = (over = {}) => ({
    id: 'w1', status: 'مكتملة', washDate: '2026-08-11', quantity: 1, price: 115, ...over,
  });

  it('السعر الشامل للضريبة يُقسَّم قبل المقارنة', () => {
    const r = operationalWashSales([wash()], { periodKey: '2026-08', washPriceMode: 'inclusive' });
    expect(r).toMatchObject({ gross: 115, net: 100, vat: 15, count: 1 });
  });

  it('والسعر غير الشامل يُضاف إليه', () => {
    const r = operationalWashSales([wash({ price: 100 })], {
      periodKey: '2026-08', washPriceMode: 'exclusive',
    });
    expect(r).toMatchObject({ gross: 115, net: 100, vat: 15 });
  });

  it('ومنشأة غير مسجّلة لا ضريبة عليها', () => {
    const r = operationalWashSales([wash()], { periodKey: '2026-08', vatRegistered: false });
    expect(r).toMatchObject({ gross: 115, net: 115, vat: 0 });
  });

  it('ويُستبعد غير المكتمل وغير الشهر', () => {
    const r = operationalWashSales([
      wash(),
      wash({ id: 'w2', status: 'قيد التنفيذ' }),
      wash({ id: 'w3', washDate: '2026-07-31' }),
    ], { periodKey: '2026-08' });
    expect(r.count).toBe(1);
    expect(r.net).toBe(100);
  });

  it('ويعزل غير المُرحّل بالصافي', () => {
    const posted = new Set(['w1']);
    const r = operationalWashSales([wash(), wash({ id: 'w2' })], {
      periodKey: '2026-08', isPosted: (w) => posted.has(w.id),
    });
    expect(r.net).toBe(200);
    expect(r.unpostedNet).toBe(100);      // ← 100, NOT 115
    expect(r.unpostedCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// الشهر السابق لا يتحرك بتغيير الإعدادات
// ═══════════════════════════════════════════════════════════════════════════
// A July wash posted at 115 VAT-inclusive is 100 of revenue and 15 of tax,
// filed and gone. Re-quote prices as exclusive in August and every screen that
// re-derived July from the raw wash rows reported 115 of revenue and a
// 15-riyal gap that no amount of posting could close — the gap was not in the
// data, it was in the question.
describe('ثبات الأشهر التاريخية', () => {
  const wash = (over = {}) => ({
    id: 'w1', status: 'مكتملة', washDate: '2026-07-20', quantity: 1, price: 115, ...over,
  });
  /** The entry a July posting left behind, with its frozen snapshot. */
  const julyEntry = {
    id: 'e1', status: 'posted', sourceKind: 'wash', sourceId: 'w1', entryDate: '2026-07-20',
    taxSnapshot: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, net: 100, vat: 15, gross: 115 },
    lines: [
      { accountId: '1010', debit: 115, credit: 0 },
      { accountId: '4000', debit: 0, credit: 100 },
      { accountId: '2100', debit: 0, credit: 15 },
    ],
  };
  // The switch moved to exclusive from August, and July's row is on record.
  const SETTINGS_AFTER_CHANGE = {
    vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
    taxPolicyHistory: [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
    ],
  };

  it('تقرأ الغسلة المُرحّلة من لقطة قيدها', () => {
    expect(postedWashSplit(julyEntry)).toEqual({ net: 100, vat: 15, gross: 115 });
  });

  it('وتشتقها من سطور القيد إن كانت من قبل اللقطة', () => {
    const { taxSnapshot, ...legacy } = julyEntry;   // eslint-disable-line no-unused-vars
    expect(postedWashSplit(legacy)).toEqual({ net: 100, vat: 15, gross: 115 });
  });

  it('غسلة يوليو المُرحّلة لا يحرّكها تغيير الإعداد في أغسطس', () => {
    const before = operationalWashSales([wash()], {
      periodKey: '2026-07',
      policyAt: (dt) => taxPolicyAt(dt, { vatRegistered: true, washPriceMode: 'inclusive' }),
      isPosted: () => true,
      postedEntryOf: () => julyEntry,
    });
    const after = operationalWashSales([wash()], {
      periodKey: '2026-07',
      policyAt: (dt) => taxPolicyAt(dt, SETTINGS_AFTER_CHANGE),
      isPosted: () => true,
      postedEntryOf: () => julyEntry,
    });
    expect(after).toEqual(before);
    expect(after.net).toBe(100);
    expect(after.fromLedger).toBe(1);
  });

  it('ومطابقة يوليو تبقى صفراً بعد تغيير الإعداد', () => {
    const b = bundle({ entry: julyEntry, lines: julyEntry.lines.map((l, i) => ({ ...l, id: `e1-${i}`, entryId: 'e1' })) });
    const s = monthlyStatement({ ...b, periodKey: '2026-07' });
    const measure = (settings) => reconcileOperational({
      operational: operationalWashSales([wash()], {
        periodKey: '2026-07',
        policyAt: (dt) => taxPolicyAt(dt, settings),
        isPosted: () => true,
        postedEntryOf: () => julyEntry,
      }),
      statement: s, ...b,
    });

    const before = measure({ vatRegistered: true, washPriceMode: 'inclusive' });
    const after = measure(SETTINGS_AFTER_CHANGE);
    expect(before.unexplained).toBe(0);
    expect(after.unexplained).toBe(0);
    expect(after.operationalNet).toBe(before.operationalNet);
    expect(after.postedWashNet).toBe(100);
  });

  it('والغسلة غير المُرحّلة تُقسَّم بإعداد تاريخها هي', () => {
    // Two unposted washes, one either side of the change.
    const r = operationalWashSales(
      [wash({ id: 'jul', washDate: '2026-07-20' }), wash({ id: 'aug', washDate: '2026-08-20' })],
      {
        periodKey: '2026-07',
        policyAt: (dt) => taxPolicyAt(dt, SETTINGS_AFTER_CHANGE),
        isPosted: () => false,
      },
    );
    // Only July is in the window, and July was inclusive: 115 → 100 net.
    expect(r.count).toBe(1);
    expect(r.net).toBe(100);
    expect(r.unpostedNet).toBe(100);

    const august = operationalWashSales(
      [wash({ id: 'aug', washDate: '2026-08-20' })],
      {
        periodKey: '2026-08',
        policyAt: (dt) => taxPolicyAt(dt, SETTINGS_AFTER_CHANGE),
        isPosted: () => false,
      },
    );
    // August was exclusive: 115 is the net and the tax sits on top.
    expect(august.net).toBe(115);
    expect(august.vat).toBe(17.25);
  });

  it('ومجموع المُرحّل وغير المُرحّل يطابق التشغيل بلا فرق ضريبة وهمي', () => {
    const posted = wash({ id: 'w1' });
    const pending = wash({ id: 'w2' });
    const b = bundle({ entry: julyEntry, lines: julyEntry.lines.map((l, i) => ({ ...l, id: `e1-${i}`, entryId: 'e1' })) });
    const s = monthlyStatement({ ...b, periodKey: '2026-07' });
    const operational = operationalWashSales([posted, pending], {
      periodKey: '2026-07',
      policyAt: (dt) => taxPolicyAt(dt, SETTINGS_AFTER_CHANGE),
      isPosted: (w) => w.id === 'w1',
      postedEntryOf: () => julyEntry,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.operationalNet).toBe(200);        // 100 posted + 100 pending
    expect(r.postedWashNet).toBe(100);
    expect(r.unpostedNet).toBe(100);
    expect(r.unexplained).toBe(0);
    expect(r.matched).toBe(true);
  });
});

describe('مطابقة التشغيل بالدفاتر', () => {
  const washRow = (over = {}) => ({
    id: 'w1', status: 'مكتملة', washDate: '2026-08-11', quantity: 1, price: 115, ...over,
  });
  /** A posted wash entry: the source kind is what the reconciliation reads. */
  const WASH_SALE = (date = '2026-08-11', net = 100, vat = 15) => entryOf(
    date,
    [['1010', net + vat, 0], ['4000', 0, net], ['2100', 0, vat]],
    { sourceType: 'wash', sourceKind: 'wash', sourceId: 'w1' },
  );

  it('غسلة 115 شاملة الضريبة مقابل قيد 100+15 تطابق بلا فرق', () => {
    const b = bundle(WASH_SALE());
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', washPriceMode: 'inclusive', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.operationalNet).toBe(100);
    expect(r.operationalVat).toBe(15);
    expect(r.postedWashNet).toBe(100);
    expect(r.unpostedNet).toBe(0);
    // The tax is NOT a posting gap.
    expect(r.unexplained).toBe(0);
    expect(r.matched).toBe(true);
    expect(r.clean).toBe(true);
  });

  it('وسعر 100 غير شامل الضريبة مقابل قيد 100+15 يطابق كذلك', () => {
    const b = bundle(WASH_SALE());
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales([washRow({ price: 100 })], {
      periodKey: '2026-08', washPriceMode: 'exclusive', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });
    expect(r.operationalNet).toBe(100);
    expect(r.unexplained).toBe(0);
    expect(r.matched).toBe(true);
  });

  it('والغسلة غير المُرحّلة تظهر 100 كفرق ترحيل لا 115', () => {
    const b = bundle(WASH_SALE());
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales(
      [washRow(), washRow({ id: 'w2' })],
      { periodKey: '2026-08', isPosted: (w) => w.id === 'w1' },
    );
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.operationalNet).toBe(200);
    expect(r.postedWashNet).toBe(100);
    expect(r.unpostedNet).toBe(100);      // ← 100, NOT 115
    expect(r.unpostedCount).toBe(1);
    // Fully explained: nothing is unaccounted for, it is just not posted yet.
    expect(r.unexplained).toBe(0);
    expect(r.matched).toBe(true);
    expect(r.clean).toBe(false);
  });

  it('والإشعار الدائن يظهر كمردودات ولا يُصنَّف غسلة ناقصة', () => {
    const b = bundle(WASH_SALE(), CREDIT());
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.salesReturns).toBe(100);
    expect(r.unpostedNet).toBe(0);
    expect(r.unpostedCount).toBe(0);
    expect(r.unexplained).toBe(0);
    expect(r.matched).toBe(true);
    // The ledger's net revenue is nil, and that is explained by (د), not by a
    // wash anyone forgot to post.
    expect(r.ledgerNetRevenue).toBe(0);
  });

  it('وفاتورة البيع المستقلة تظهر كإيراد آخر لا كفرق', () => {
    const standalone = entryOf('2026-08-14',
      [['1010', 57.5, 0], ['4000', 0, 50], ['2100', 0, 7.5]],
      { sourceType: 'sales_invoice', sourceId: 'doc1' });
    const b = bundle(WASH_SALE(), standalone);
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.postedWashNet).toBe(100);
    expect(r.otherRevenue).toBe(50);
    expect(r.unexplained).toBe(0);
    expect(s.netRevenue).toBe(150);
  });

  it('والقيد المعكوس ومرآته يلغيان بعضهما في جانب الغسلات', () => {
    const sale = WASH_SALE();
    const mirror = entryOf('2026-08-25',
      [['1010', 0, 115], ['4000', 100, 0], ['2100', 15, 0]],
      { sourceType: 'adjustment', sourceId: null, reversalOf: sale.entry.id, reversedSourceKind: 'wash' });
    sale.entry.status = 'reversed';
    const b = bundle(sale, mirror);
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    // The wash is no longer posted (its entry was reversed), so it shows as a
    // posting gap rather than as an unexplained difference.
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', isPosted: () => false,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });

    expect(r.postedWashNet).toBe(0);      // +100 then −100, attributed to 'wash'
    expect(r.unpostedNet).toBe(100);
    expect(r.otherRevenue).toBe(0);       // the mirror is NOT "other revenue"
    expect(r.unexplained).toBe(0);
  });

  it('والفرق الذي لا يفسّره شيء يظهر باسمه', () => {
    // A wash marked posted whose entry landed in another month.
    const b = bundle(WASH_SALE('2026-07-20'));
    const s = monthlyStatement({ ...b, periodKey: '2026-08' });
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b });
    expect(r.postedWashNet).toBe(0);
    expect(r.unpostedNet).toBe(0);
    expect(r.unexplained).toBe(100);
    expect(r.matched).toBe(false);
  });

  it('وحصة الشريك تقيس الجانبين معاً', () => {
    const b = bundle(WASH_SALE());
    const s = monthlyStatement({ ...b, periodKey: '2026-08', scalingFactor: 0.5 });
    const operational = operationalWashSales([washRow()], {
      periodKey: '2026-08', isPosted: () => true,
    });
    const r = reconcileOperational({ operational, statement: s, ...b, scalingFactor: 0.5 });
    expect(r.operationalNet).toBe(50);
    expect(r.postedWashNet).toBe(50);
    expect(r.unexplained).toBe(0);
  });
});
