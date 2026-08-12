import { describe, it, expect } from 'vitest';
import {
  periodKeyFor, periodLabel, periodRange, currentPeriodKey,
  inputInvoiceEligibility, claimDateOf, outputTaxFromWashes, outputTaxFromLedger,
  inputTaxFromLedger, postedSourceKeys, sourceKeyOf, buildVatReport, availablePeriods,
  inputInvoiceTax, washEntryTax, purchaseEntryTax,
} from '../vatReturn';
import { taxPolicyAt } from '../taxPolicy';

/**
 * A complete, deductible purchase invoice — WITH its own rate stated.
 *
 * It used to state neither an amount nor a rate and rely on the report
 * defaulting to 15%. That default is gone: the engine refuses to price a
 * document nothing can price rather than assuming the current standard rate,
 * so a fixture that wants 15% now says 15% — which is also what every record
 * saved through the form carries.
 */
const INVOICE = {
  id: 'i1', description: 'مواد تنظيف', amount: 1150, isTaxInvoice: true,
  invoiceNumber: 'S-4417', invoiceDate: '2026-08-03', supplier: 'مؤسسة النور',
  vatAmount: null, vatRate: 0.15, priceMode: 'inclusive',
  source: 'variable', sourceKind: 'variable', parentId: 'p1',
};

const WASH = (over = {}) => ({
  id: 'w1', quantity: 4, price: 57.5, status: 'مكتملة', washDate: '2026-08-05', ...over,
});

describe('فترات الإقرار', () => {
  it('ربع سنوي أو شهري — لا افتراض بأحدهما', () => {
    expect(periodKeyFor('2026-08-11', 'quarterly')).toBe('2026-Q3');
    expect(periodKeyFor('2026-08-11', 'monthly')).toBe('2026-08');
    expect(periodKeyFor('2026-01-01', 'quarterly')).toBe('2026-Q1');
    expect(periodKeyFor('2026-12-31', 'quarterly')).toBe('2026-Q4');
  });

  it('تاريخ غير صالح لا يُنسب إلى فترة', () => {
    expect(periodKeyFor('', 'quarterly')).toBe('');
    expect(periodKeyFor('2026', 'quarterly')).toBe('');
    expect(periodKeyFor('2026-13-01', 'quarterly')).toBe('');
  });

  it('يسمّي الفترة بالعربية', () => {
    expect(periodLabel('2026-Q3')).toBe('الربع الثالث 2026 · يوليو – سبتمبر');
    expect(periodLabel('2026-08')).toBe('أغسطس 2026');
  });

  it('يحسب مدى الفترة بالتاريخين', () => {
    expect(periodRange('2026-Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRange('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('الفترة الحالية تتبع الدورية المختارة', () => {
    const d = new Date('2026-08-11T09:00:00Z');
    expect(currentPeriodKey('quarterly', d)).toBe('2026-Q3');
    expect(currentPeriodKey('monthly', d)).toBe('2026-08');
  });
});

describe('أهلية فاتورة المدخلات', () => {
  it('الفاتورة المكتملة مؤهلة', () => {
    expect(inputInvoiceEligibility(INVOICE)).toEqual({ eligible: true, missing: [] });
  });

  it('تُرفض بلا تاريخ أو رقم أو مورّد أو مبلغ — ويُسمّى الناقص', () => {
    expect(inputInvoiceEligibility({ ...INVOICE, invoiceDate: '' }).missing)
      .toEqual(['تاريخ الفاتورة']);
    expect(inputInvoiceEligibility({ ...INVOICE, invoiceNumber: '  ' }).missing)
      .toEqual(['رقم الفاتورة']);
    expect(inputInvoiceEligibility({ ...INVOICE, supplier: '' }).missing)
      .toEqual(['اسم المورّد']);
    expect(inputInvoiceEligibility({ ...INVOICE, amount: 0 }).missing)
      .toEqual(['مبلغ الفاتورة']);
  });

  it('تجمع كل النواقص لا أولها فقط', () => {
    const r = inputInvoiceEligibility({ isTaxInvoice: true });
    expect(r.eligible).toBe(false);
    expect(r.missing).toEqual(['تاريخ الفاتورة', 'رقم الفاتورة', 'اسم المورّد', 'مبلغ الفاتورة']);
  });

  it('غير المُعلَّمة كفاتورة ضريبية خارج الحساب أصلاً', () => {
    expect(inputInvoiceEligibility({ ...INVOICE, isTaxInvoice: false }))
      .toEqual({ eligible: false, missing: ['غير مُعلَّمة كفاتورة ضريبية'] });
  });

  it('الاستبعاد الصريح من الخصم يغلب كل شيء', () => {
    expect(inputInvoiceEligibility({ ...INVOICE, vatDeductible: false }).eligible).toBe(false);
  });

  // تاريخ الصرف ليس تاريخ فاتورة: المورّد يصدر الفاتورة في تاريخ، والسداد
  // قد يقع في فترة أخرى، والخصم يتبع تاريخ الفاتورة لا تاريخ الدفع.
  it('تاريخ الصرف لا يقوم مقام تاريخ الفاتورة', () => {
    const r = { ...INVOICE, invoiceDate: '', spentDate: '2026-08-04' };
    expect(inputInvoiceEligibility(r).eligible).toBe(false);
    expect(inputInvoiceEligibility(r).missing).toEqual(['تاريخ الفاتورة']);
    expect(claimDateOf(r)).toBe('');
  });

  it('تاريخ الفاتورة وحده يحدّد فترة الخصم', () => {
    // Invoiced in March, paid in April → deducted in Q1, not Q2.
    const r = { ...INVOICE, invoiceDate: '2026-03-28', spentDate: '2026-04-05' };
    expect(claimDateOf(r)).toBe('2026-03-28');
    expect(buildVatReport({ inputs: [r], period: '2026-Q1' }).input.count).toBe(1);
    expect(buildVatReport({ inputs: [r], period: '2026-Q2' }).eligible).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The regression this whole module exists for.
// ─────────────────────────────────────────────────────────────────────────
describe('المصروف المتكرر لا يُضرب في عدد أشهر الفترة', () => {
  // Exactly the shape the old report multiplied: recurring, no date, no
  // invoice number, no supplier.
  const RECURRING = {
    id: 'm1', description: 'إيجار المحل', amount: 5000, isTaxInvoice: true,
    spentDate: '', invoiceNumber: '', supplier: '', recurring: true,
    vatAmount: null, vatRate: 0.15, priceMode: 'inclusive',
    source: 'monthly', sourceKind: 'monthly', parentId: 'm1',
  };

  it('لا يُخصم شيء من مصروف متكرر بلا فاتورة', () => {
    const r = buildVatReport({ inputs: [RECURRING], period: '2026-Q3', filing: 'quarterly' });
    expect(r.input.tax).toBe(0);
    expect(r.input.count).toBe(0);
    expect(r.eligible).toEqual([]);
  });

  it('ويظهر مع سبب الرفض بدل أن يختفي', () => {
    const r = buildVatReport({ inputs: [RECURRING], period: '2026-Q3', filing: 'quarterly' });
    expect(r.ineligible).toHaveLength(1);
    expect(r.ineligible[0].missing).toEqual(['تاريخ الفاتورة', 'رقم الفاتورة', 'اسم المورّد']);
    // And the report says what is being given up for want of a document.
    expect(r.forfeitedTax).toBe(652.17);
  });

  it('الفاتورة الواحدة تُحتسب مرة واحدة مهما طالت الفترة', () => {
    const quarterly = buildVatReport({ inputs: [INVOICE], period: '2026-Q3', filing: 'quarterly' });
    const monthly   = buildVatReport({ inputs: [INVOICE], period: '2026-08', filing: 'monthly' });
    expect(quarterly.input.tax).toBe(150);
    expect(monthly.input.tax).toBe(150);      // NOT 450 in the quarter
    expect(quarterly.input.count).toBe(1);
  });

  it('ثلاث فواتير فعلية تُحتسب ثلاثاً — الفرق أن لها مستندات', () => {
    const three = ['2026-07-05', '2026-08-05', '2026-09-05'].map((d, i) => ({
      ...INVOICE, id: `i${i}`, invoiceDate: d, invoiceNumber: `S-${i}`,
    }));
    const r = buildVatReport({ inputs: three, period: '2026-Q3', filing: 'quarterly' });
    expect(r.input.count).toBe(3);
    expect(r.input.tax).toBe(450);
  });
});

describe('ضريبة المخرجات من الغسلات', () => {
  it('من الغسلات المكتملة داخل الفترة فقط', () => {
    const r = outputTaxFromWashes([
      WASH(),                                          // 230 inclusive → 30
      WASH({ id: 'w2', status: 'قيد التنفيذ' }),        // not earned yet
      WASH({ id: 'w3', washDate: '2026-04-01' }),       // another quarter
    ], { period: '2026-Q3', filing: 'quarterly' });
    expect(r.count).toBe(1);
    expect(r.gross).toBe(230);
    expect(r.net).toBe(200);
    expect(r.tax).toBe(30);
  });

  it('سعر غير شامل يضيف الضريبة فوق المبلغ', () => {
    const r = outputTaxFromWashes([WASH({ quantity: 1, price: 100 })],
      { period: '2026-Q3', priceMode: 'exclusive' });
    expect(r).toMatchObject({ net: 100, tax: 15, gross: 115 });
  });

  it('منشأة غير مسجّلة: كامل المبلغ إيراد ولا ضريبة مخرجات', () => {
    const r = outputTaxFromWashes([WASH()], { period: '2026-Q3', vatRegistered: false });
    expect(r.tax).toBe(0);
    expect(r.net).toBe(230);
  });

  it('الغسلة بلا تاريخ صالح تُستبعد وتُعدّ', () => {
    const r = outputTaxFromWashes([WASH({ washDate: '' })], { period: '' });
    expect(r.count).toBe(0);
    expect(r.excluded).toBe(1);
  });
});

describe('ضريبة المخرجات من الدفاتر — تحقّق مستقل', () => {
  const entries = [
    { id: 'e1', status: 'posted', entryDate: '2026-08-05' },
    { id: 'e2', status: 'draft',  entryDate: '2026-08-06' },
  ];
  const lines = [
    { entryId: 'e1', accountId: '2100', debit: 0, credit: 30 },
    { entryId: 'e2', accountId: '2100', debit: 0, credit: 99 },   // not posted
    { entryId: 'e1', accountId: '4000', debit: 0, credit: 200 },  // not tax
  ];

  it('يجمع من القيود المرحّلة فقط', () => {
    expect(outputTaxFromLedger(entries, lines, { period: '2026-Q3' }))
      .toEqual({ tax: 30, available: true });
  });

  it('يعلن أنه غير متاح عندما لا يوجد ترحيل — فلا يُقارَن بصفر مضلّل', () => {
    expect(outputTaxFromLedger([], [], { period: '2026-Q3' }))
      .toEqual({ tax: 0, available: false });
  });

  it('التقرير يرصد الفارق بين الغسلات والدفاتر', () => {
    const r = buildVatReport({
      washes: [WASH()], entries, lines, period: '2026-Q3', filing: 'quarterly',
    });
    expect(r.outputMismatch).toBe(0);            // 30 = 30

    const behind = buildVatReport({
      washes: [WASH(), WASH({ id: 'w9' })], entries, lines, period: '2026-Q3',
    });
    expect(behind.outputMismatch).toBe(30);      // one wash not posted yet
  });
});

describe('مطابقة ضريبة المدخلات مع حساب 1200', () => {
  const INV = { ...INVOICE, id: 'i1', amount: 1150 };   // 150 tax
  const entries = [
    // `sourceKind` is what `postSource` writes, and it is what identifies the
    // COLLECTION the record came from. Without it a variable expense and a
    // monthly one with the same id are the same record to every reader.
    {
      id: 'e1', status: 'posted', entryDate: '2026-08-03',
      sourceType: 'expense', sourceKind: 'variable', sourceId: 'i1',
    },
  ];
  const lines = [
    // Input VAT is an ASSET: it grows on the DEBIT side.
    { entryId: 'e1', accountId: '1200', debit: 150, credit: 0 },
    { entryId: 'e1', accountId: '5100', debit: 1000, credit: 0 },
  ];

  it('يقرأ الحركة المدينة على 1200 كضريبة موجبة', () => {
    expect(inputTaxFromLedger(entries, lines, { period: '2026-Q3' }))
      .toEqual({ tax: 150, available: true });
  });

  it('يعلن عدم التوفر حين لا حركة — لا يُقرأ صفره كحقيقة', () => {
    expect(inputTaxFromLedger([], [], { period: '2026-Q3' }))
      .toEqual({ tax: 0, available: false });
  });

  it('لا فرق حين يطابق المُطالَب به ما في الدفاتر', () => {
    const r = buildVatReport({ inputs: [INV], entries, lines, period: '2026-Q3' });
    expect(r.inputMismatch).toBe(0);
    expect(r.unpostedEligible).toEqual([]);
  });

  it('يرصد الفارق ويسمّي الفواتير المؤهلة غير المُرحّلة', () => {
    const extra = { ...INVOICE, id: 'i2', invoiceNumber: 'S-9', amount: 230 };  // 30 tax
    const r = buildVatReport({ inputs: [INV, extra], entries, lines, period: '2026-Q3' });
    expect(r.input.tax).toBe(180);
    expect(r.ledgerInput.tax).toBe(150);
    expect(r.inputMismatch).toBe(30);
    expect(r.unpostedEligible.map((x) => x.id)).toEqual(['i2']);
    expect(r.unpostedInputTax).toBe(30);
  });

  it('القيد غير المرحّل لا يُحتسب في رصيد الدفاتر', () => {
    const draft = [{ id: 'e2', status: 'draft', entryDate: '2026-08-04' }];
    const draftLines = [{ entryId: 'e2', accountId: '1200', debit: 999, credit: 0 }];
    expect(inputTaxFromLedger(draft, draftLines, { period: '2026-Q3' }))
      .toEqual({ tax: 0, available: false });
  });

  it('يعرف أي المصادر مُرحّلة', () => {
    // The KEY is `kind__id`, never the bare id — five collections post with
    // `sourceType: 'expense'` and their ids are independent.
    expect([...postedSourceKeys(entries)]).toEqual(['variable__i1']);
    expect(postedSourceKeys([{ id: 'x', status: 'reversed', sourceId: 'z' }]).size).toBe(0);
    expect(sourceKeyOf('voucher', 't1__2026-01')).toBe('voucher__t1__2026-01');
  });
});

describe('الصافي واتجاهه', () => {
  it('المخرجات أكبر ← مستحق للهيئة', () => {
    const r = buildVatReport({
      inputs: [{ ...INVOICE, amount: 230 }], washes: [WASH()], period: '2026-Q3',
    });
    expect(r.output.tax).toBe(30);
    expect(r.input.tax).toBe(30);
    expect(r.netTax).toBe(0);
    expect(r.direction).toBe('nil');
  });

  it('المدخلات أكبر ← مسترد', () => {
    const r = buildVatReport({ inputs: [INVOICE], washes: [WASH()], period: '2026-Q3' });
    expect(r.netTax).toBe(-120);                 // 30 output − 150 input
    expect(r.direction).toBe('refundable');
  });

  it('بلا مدخلات ← كل المخرجات مستحقة', () => {
    const r = buildVatReport({ washes: [WASH()], period: '2026-Q3' });
    expect(r.netTax).toBe(30);
    expect(r.direction).toBe('payable');
  });

  it('الصافي دائماً = المخرجات − المدخلات', () => {
    const r = buildVatReport({
      inputs: [INVOICE, { ...INVOICE, id: 'i2', invoiceNumber: 'S-2', amount: 460 }],
      washes: [WASH(), WASH({ id: 'w2', quantity: 10, price: 57.5 })],
      period: '2026-Q3',
    });
    expect(r.netTax).toBe(Math.round((r.output.tax - r.input.tax) * 100) / 100);
  });
});

describe('الفلترة بالفترة', () => {
  const rows = [
    { ...INVOICE, id: 'a', invoiceDate: '2026-05-10', invoiceNumber: 'A' },
    { ...INVOICE, id: 'b', invoiceDate: '2026-08-10', invoiceNumber: 'B' },
  ];

  it('تحصر المؤهلة في فترتها', () => {
    expect(buildVatReport({ inputs: rows, period: '2026-Q2' }).eligible.map((e) => e.id)).toEqual(['a']);
    expect(buildVatReport({ inputs: rows, period: '2026-Q3' }).eligible.map((e) => e.id)).toEqual(['b']);
  });

  it('بلا فترة تظهر الكل', () => {
    expect(buildVatReport({ inputs: rows, period: '' }).input.count).toBe(2);
  });

  it('المرفوضة بلا تاريخ تظهر في كل فترة — لأنها لا تنتمي لأيّها', () => {
    const undated = { ...INVOICE, id: 'x', invoiceDate: '', spentDate: '', invoiceNumber: '' };
    for (const p of ['2026-Q1', '2026-Q2', '2026-Q3']) {
      expect(buildVatReport({ inputs: [undated], period: p }).ineligible).toHaveLength(1);
    }
  });

  it('تسرد الفترات الموجودة في البيانات مع الفترة الحالية', () => {
    const ps = availablePeriods(rows, 'quarterly', ['2025-11-02']);
    expect(ps).toContain('2026-Q2');
    expect(ps).toContain('2026-Q3');
    expect(ps).toContain('2025-Q4');
    expect(ps).toContain(currentPeriodKey('quarterly'));
    expect([...ps]).toEqual([...ps].sort().reverse());   // newest first
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// السياسة التاريخية — لا يُعاد احتساب شهر سابق بقواعد اليوم
// ═══════════════════════════════════════════════════════════════════════════
// The output figure the return FILES is the movement on 2100 and has always
// been. What moved was the operational CHECK beside it: every completed wash
// was re-split under today's switches, so flipping `washPriceMode` in August
// changed the July check and manufactured a mismatch out of a setting change.
describe('فحص المخرجات التشغيلي يتبع تاريخه', () => {
  const SETTINGS = {
    vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15,
    taxPolicyHistory: [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
      { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
    ],
  };
  const policyAt = (settings) => (date) => taxPolicyAt(date, settings);
  const julyWash = WASH({ id: 'jw', quantity: 1, price: 115, washDate: '2026-07-20' });
  /** The entry July's wash actually left, with its frozen split. */
  const julyEntry = {
    id: 'e1', status: 'posted', sourceKind: 'wash', sourceId: 'jw', entryDate: '2026-07-20',
    taxSnapshot: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, net: 100, vat: 15, gross: 115 },
    lines: [
      { accountId: '1010', debit: 115, credit: 0 },
      { accountId: '4000', debit: 0, credit: 100 },
      { accountId: '2100', debit: 0, credit: 15 },
    ],
  };

  it('تقرأ الغسلة المُرحّلة من لقطة قيدها، ومن سطوره إن غابت', () => {
    expect(washEntryTax(julyEntry)).toEqual({ net: 100, vat: 15, gross: 115 });
    const { taxSnapshot, ...legacy } = julyEntry;   // eslint-disable-line no-unused-vars
    expect(washEntryTax(legacy)).toEqual({ net: 100, vat: 15, gross: 115 });
    expect(washEntryTax(null)).toBeNull();
  });

  it('تغيير أغسطس لا يغيّر فحص يوليو', () => {
    const before = outputTaxFromWashes([julyWash], {
      period: '2026-07', filing: 'monthly',
      policyAt: policyAt({ vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }),
      postedEntryOf: () => julyEntry,
    });
    const after = outputTaxFromWashes([julyWash], {
      period: '2026-07', filing: 'monthly',
      policyAt: policyAt(SETTINGS), postedEntryOf: () => julyEntry,
    });
    expect(after).toEqual(before);
    expect(after.tax).toBe(15);
    expect(after.net).toBe(100);
  });

  it('وغسلة يوليو غير المُرحّلة تستخدم baseline يوليو لا سياسة أغسطس', () => {
    const r = outputTaxFromWashes([julyWash], {
      period: '2026-07', filing: 'monthly', policyAt: policyAt(SETTINGS),
    });
    // July was inclusive: 115 → 100 + 15. Under August's exclusive rule it
    // would have been 115 + 17.25, which is the number that used to appear.
    expect(r.net).toBe(100);
    expect(r.tax).toBe(15);
  });

  it('وغسلة أغسطس غير المُرحّلة تستخدم سياسة أغسطس', () => {
    const r = outputTaxFromWashes(
      [WASH({ id: 'aw', quantity: 1, price: 115, washDate: '2026-08-20' })],
      { period: '2026-08', filing: 'monthly', policyAt: policyAt(SETTINGS) },
    );
    expect(r.net).toBe(115);
    expect(r.tax).toBe(17.25);
  });

  it('وفترة قبل الـbaseline تُعلَن غير مهيأة ولا تُحسب بسياسة اليوم', () => {
    const old = WASH({ id: 'ow', quantity: 1, price: 115, washDate: '2025-11-20' });
    const r = outputTaxFromWashes([old], {
      period: '2025-11', filing: 'monthly', policyAt: policyAt(SETTINGS),
    });
    expect(r.count).toBe(0);
    expect(r.tax).toBe(0);
    expect(r.unknownPolicy).toBe(1);

    const report = buildVatReport({
      washes: [old], period: '2025-11', filing: 'monthly', policyAt: policyAt(SETTINGS),
    });
    expect(report.policyUnconfigured).toBe(true);
    expect(report.unknownPolicyWashes).toBe(1);
    expect(report.output.source).toBe('unknown-policy');
    expect(report.output.tax).toBe(0);
  });

  it('وفترة بلا قيود لا تستخدم سياسة اليوم لشهر لا يغطيه السجل', () => {
    const report = buildVatReport({
      washes: [WASH({ id: 'ow', quantity: 1, price: 115, washDate: '2025-11-20' })],
      entries: [], lines: [],
      period: '2025-11', filing: 'monthly', policyAt: policyAt(SETTINGS),
    });
    expect(report.output.tax).toBe(0);
    expect(report.output.source).not.toBe('operations');
  });
});

describe('ضريبة المدخلات من الفاتورة نفسها', () => {
  it('المبلغ الصريح على الفاتورة يسبق كل نسبة', () => {
    const r = inputInvoiceTax({ ...INVOICE, amount: 1150, vatAmount: 143.75, vatRate: null });
    expect(r).toMatchObject({ gross: 1150, net: 1006.25, vat: 143.75, source: 'invoice-amount' });
  });

  it('ثم النسبة المثبتة على الفاتورة — 5% تبقى 5%', () => {
    const r = inputInvoiceTax({ ...INVOICE, amount: 105, vatRate: 0.05, vatAmount: null });
    expect(r).toMatchObject({ net: 100, vat: 5, source: 'invoice-rate' });
  });

  it('ثم نسبة تاريخ الفاتورة، لا نسبة اليوم', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: [
        { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
        { effectiveFrom: '2020-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      ],
    };
    const r = inputInvoiceTax(
      { ...INVOICE, amount: 105, invoiceDate: '2020-03-01', vatRate: null },
      { policyAt: (d) => taxPolicyAt(d, settings) },
    );
    expect(r).toMatchObject({ net: 100, vat: 5, source: 'policy' });
  });

  it('وفاتورة قبل الـbaseline لا تُحتسب لها ضريبة مخترعة', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: [{ effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true }],
    };
    const r = inputInvoiceTax(
      { ...INVOICE, amount: 115, invoiceDate: '2025-06-01', vatRate: null },
      { policyAt: (d) => taxPolicyAt(d, settings) },
    );
    // Not «a zero-VAT purchase»: a REFUSAL, carrying the engine's own reason.
    expect(r).toMatchObject({ vat: 0, gross: null, source: 'unresolved' });
    expect(r.refused).toMatch(/تعذّر تحديد ضريبة الفاتورة/);
  });

  it('والتقرير يحافظ على مبلغ ضريبة فاتورة بنسبة تاريخية مختلفة', () => {
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'old', amount: 105, vatRate: 0.05, invoiceDate: '2026-08-03' }],
      period: '2026-Q3',
    });
    expect(report.input.tax).toBe(5);
    expect(report.eligible[0].taxSource).toBe('invoice-rate');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// لا تختفي ضريبة قابلة للخصم بصفر صامت
// ═══════════════════════════════════════════════════════════════════════════
describe('الفواتير التي لا يمكن تسعير ضريبتها', () => {
  const SETTINGS = {
    vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
    taxPolicyHistory: [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
    ],
  };
  const policyAt = (d) => taxPolicyAt(d, SETTINGS);

  it('فاتورة قبل الـbaseline بلا حقول ضريبية تظهر unresolved لا eligible', () => {
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'old', amount: 115, vatRate: null, invoiceDate: '2025-06-01' }],
      period: '2025-Q2', filing: 'quarterly', policyAt,
    });
    expect(report.eligible).toHaveLength(0);
    expect(report.unresolvedCount).toBe(1);
    expect(report.unresolvedGross).toBe(115);
    // The engine's own words, carried through verbatim — the report does not
    // paraphrase a refusal it did not make.
    expect(report.unresolved[0].reason).toMatch(/تعذّر تحديد ضريبة الفاتورة/);
    expect(report.unresolved[0].reason).toMatch(/ولا تُفترض 15%/);
    // Not deducted, and not silently deducted as zero either.
    expect(report.input.tax).toBe(0);
    expect(report.input.count).toBe(0);
    expect(report.policyUnconfigured).toBe(true);
  });

  // ── المبلغ المكتوب لا يرفع الجهل بالتسجيل ──
  // The stated amount answers "how much tax is on the paper". It does not
  // answer "were we registered that month", and only a registered business
  // may reclaim. With the record not reaching that date BOTH the ledger and
  // the report must refuse — deducting 5 on one side while the server refuses
  // to open 1200 on the other is the disagreement this whole module exists to
  // remove.
  it('ومبلغ ضريبة صريح قبل الـbaseline لا يُخصم — التسجيل نفسه مجهول', () => {
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'old', amount: 115, vatAmount: 5, vatRate: null, invoiceDate: '2025-06-01' }],
      period: '2025-Q2', filing: 'quarterly', policyAt,
    });
    expect(report.eligible).toHaveLength(0);
    expect(report.input.tax).toBe(0);
    expect(report.unresolvedCount).toBe(1);
    expect(report.unresolved[0].reason).toMatch(/التسجيل الضريبي/);
  });

  it('ونسبة مثبتة قبل الـbaseline كذلك', () => {
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'old', amount: 105, vatRate: 0.05, vatAmount: null, invoiceDate: '2025-06-01' }],
      period: '2025-Q2', filing: 'quarterly', policyAt,
    });
    expect(report.input.tax).toBe(0);
    expect(report.unresolvedCount).toBe(1);
  });

  it('…وكلاهما يُخصم فور أن تغطّي السياسة تاريخ الفاتورة', () => {
    const inside = { ...INVOICE, id: 'new', amount: 115, vatAmount: 5, vatRate: null, invoiceDate: '2026-08-03' };
    const report = buildVatReport({
      inputs: [inside], period: '2026-Q3', filing: 'quarterly', policyAt,
    });
    expect(report.unresolvedCount).toBe(0);
    expect(report.input.tax).toBe(5);
    expect(report.eligible[0].taxSource).toBe('invoice-amount');
    expect(report.policyUnconfigured).toBe(false);
  });

  it('والمبلغ الصريح يتغلب على النسبة المثبتة', () => {
    // 115 at 15% would be 15; the supplier wrote 5, and the supplier is right.
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'x', amount: 115, vatAmount: 5, vatRate: null, invoiceDate: '2026-08-03' }],
      period: '2026-Q3', filing: 'quarterly', policyAt,
    });
    expect(report.input.tax).toBe(5);
    expect(report.eligible[0].taxSource).toBe('invoice-amount');
  });

  it('وفاتورة 5% تبقى 5% بعد تغيير السياسة إلى 15%', () => {
    const row = { ...INVOICE, id: 'r', amount: 105, vatRate: 0.05, invoiceDate: '2026-08-03' };
    const before = buildVatReport({ inputs: [row], period: '2026-Q3', policyAt });
    const changed = {
      ...SETTINGS,
      taxPolicyHistory: [
        ...SETTINGS.taxPolicyHistory,
        { effectiveFrom: '2026-09-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      ],
    };
    const after = buildVatReport({
      inputs: [row], period: '2026-Q3', policyAt: (d) => taxPolicyAt(d, changed),
    });
    expect(after.input.tax).toBe(before.input.tax);
    expect(after.input.tax).toBe(5);
  });

  it('وpolicyUnconfigured يشمل فجوة المدخلات وحدها', () => {
    // No washes at all, so the output side has nothing to say — the gap is
    // entirely on the purchase side, and the flag still has to raise it.
    const report = buildVatReport({
      inputs: [{ ...INVOICE, id: 'old', amount: 115, vatRate: null, invoiceDate: '2025-06-01' }],
      washes: [], period: '2025-Q2', filing: 'quarterly', policyAt,
    });
    expect(report.unknownPolicyWashes).toBe(0);
    expect(report.policyUnconfigured).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// «غير مذكور» ليست صفراً — الحالة التي كان Number(null) يبتلعها
// ═══════════════════════════════════════════════════════════════════════════
// `Number(null) === 0`: finite, non-negative, and past every plausible guard.
// So a purchase saved with `vatAmount: null` — which is exactly what the
// mapper writes for "the supplier did not state one" — was deducted as a VAT
// of ZERO and labelled `source: 'invoice'` as though the supplier had written
// it, and the fallbacks to the invoice's rate and then to the dated policy
// never ran. `undefined` was right only by accident (`Number(undefined)` is
// NaN), which is not a property to rely on.
describe('مبلغ الضريبة: null مقابل صفر صريح', () => {
  const ROW = {
    isTaxInvoice: true,
    invoiceDate: '2026-08-01',
    invoiceNumber: 'INV-1',
    supplier: 'S',
    amount: 105,
    vatAmount: null,
    vatRate: 0.05,
    priceMode: 'inclusive',
  };

  it('vatAmount: null ينتقل إلى نسبة الفاتورة — 5 لا صفر', () => {
    expect(inputInvoiceTax(ROW)).toMatchObject({ vat: 5, source: 'invoice-rate' });
  });

  it('و"" وundefined مثلها تماماً', () => {
    expect(inputInvoiceTax({ ...ROW, vatAmount: '' })).toMatchObject({ vat: 5, source: 'invoice-rate' });
    expect(inputInvoiceTax({ ...ROW, vatAmount: '   ' })).toMatchObject({ vat: 5, source: 'invoice-rate' });
    expect(inputInvoiceTax({ ...ROW, vatAmount: undefined })).toMatchObject({ vat: 5, source: 'invoice-rate' });
  });

  it('وصفر صريح — 0 أو "0" — يبقى صفراً من الفاتورة', () => {
    // A zero-rated or exempt supply. The supplier DID answer, and the answer
    // was nil; that is not the same as declining to answer.
    // Zero-rated: eligible in every respect, and simply bearing no tax — so
    // no input-VAT asset is opened and the source says why.
    expect(inputInvoiceTax({ ...ROW, vatAmount: 0, vatRate: null }))
      .toMatchObject({ vat: 0, gross: 105, net: 105, noInputVatReason: 'zero-rated' });
    expect(inputInvoiceTax({ ...ROW, vatAmount: '0', vatRate: null }))
      .toMatchObject({ vat: 0, noInputVatReason: 'zero-rated' });
  });

  it('وبلا نسبة على الفاتورة ينتقل إلى سياسة تاريخها', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: [
        { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
        { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      ],
    };
    const r = inputInvoiceTax(
      { ...ROW, vatAmount: null, vatRate: null },
      { policyAt: (d) => taxPolicyAt(d, settings) },
    );
    expect(r).toMatchObject({ source: 'policy' });
    expect(r.vat).toBeCloseTo(13.7, 1);   // 105 inclusive at 15%
  });

  // ── القيمة الفاسدة تُرفض، ولا يُسقَط عنها إلى النسبة ──
  // Falling through to the rate looked forgiving and was not: it deducted a
  // figure the document does not state while the supplier's own — wrong —
  // number sat in the record unexamined. It is a data error, and it is said.
  it('ومبلغ صريح أكبر من إجمالي فاتورة شاملة يُرفض ولا يُتجاهل', () => {
    const r = inputInvoiceTax({ ...ROW, vatAmount: 500 });
    expect(r).toMatchObject({ vat: 0, source: 'unresolved' });
    expect(r.refused).toMatch(/أكبر من إجمالي الفاتورة/);
  });

  // ── نفس الحالة عبر شكل صف useTaxInvoices إلى التقرير ────────────────
  it('والصف كما يبنيه useTaxInvoices يُخصم 5 في التقرير لا صفراً', () => {
    // `useTaxInvoices` normalises every source to `vatAmount: x ?? null`, so
    // null is the value the report actually receives in production.
    const row = { ...ROW, id: 'i1', description: 'مواد', source: 'variable', parentId: 'p1' };
    const report = buildVatReport({ inputs: [row], period: '2026-Q3', filing: 'quarterly' });

    expect(report.input.tax).toBe(5);
    expect(report.input.count).toBe(1);
    expect(report.eligible[0].taxSource).toBe('invoice-rate');
    expect(report.unresolvedCount).toBe(0);
    // And the net tax the return files moves with it.
    expect(report.netTax).toBe(-5);
  });

  it('وصف بصفر صريح يُخصم صفراً من مبلغ الفاتورة', () => {
    const row = {
      ...ROW, id: 'i1', vatAmount: 0, vatRate: null, description: 'معفاة',
      source: 'variable', sourceKind: 'variable', parentId: 'p1',
    };
    const report = buildVatReport({ inputs: [row], period: '2026-Q3', filing: 'quarterly' });
    expect(report.input.tax).toBe(0);
    // Eligible in every respect and simply bearing no tax — deducted, at zero,
    // rather than rejected for a fault it does not have.
    expect(report.eligible).toHaveLength(1);
    expect(report.eligible[0].gross).toBe(105);
    expect(report.unresolvedCount).toBe(0);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// هوية المصدر: kind__id، لا id وحده
// ═══════════════════════════════════════════════════════════════════════════
// Five collections post with `sourceType: 'expense'` and their ids are
// generated independently, so two records in different collections can share
// one. `postedSourceIds` keyed on the bare id, which meant posting EITHER of
// them marked BOTH as posted — the unposted one dropped out of
// `unpostedEligible`, and the very list whose job is to explain the gap
// between the claim and the ledger hid the row causing it.
describe('تصادم المعرّفات بين المجموعات', () => {
  const AT = (over = {}) => ({
    isTaxInvoice: true, amount: 115, invoiceNumber: 'INV-1',
    invoiceDate: '2026-08-03', supplier: 'مورّد',
    vatAmount: 15, vatRate: null, priceMode: 'inclusive', ...over,
  });
  /** A live posted entry for one source, as `postSource` writes it. */
  const entryFor = (kind, id) => ({
    id: `e-${kind}`, status: 'posted', entryDate: '2026-08-03',
    sourceType: 'expense', sourceKind: kind, sourceId: id,
    purchaseTaxSnapshot: {
      isTaxInvoice: true, vatDeductible: true, invoiceDate: '2026-08-03',
      priceMode: 'inclusive', vatRate: null, vatAmount: 15,
      net: 100, vat: 15, gross: 115, documentVat: 15,
      source: 'invoice-amount', deductible: true, noInputVatReason: null,
    },
  });

  it('شهري ومتغيّر بنفس المعرّف: ترحيل المتغيّر وحده لا يُخفي الشهري', () => {
    const rows = [
      { ...AT(), id: 'x1', source: 'monthly', sourceKind: 'monthly', parentId: 'x1' },
      { ...AT(), id: 'x1', source: 'variable', sourceKind: 'variable', parentId: 'x1' },
    ];
    const entries = [entryFor('variable', 'x1')];
    const r = buildVatReport({ inputs: rows, entries, lines: [], period: '2026-Q3' });

    expect(r.eligible).toHaveLength(2);
    // The monthly one is still waiting for the books, and the report says so.
    expect(r.unpostedEligible.map((x) => x.sourceKey)).toEqual(['monthly__x1']);
    expect(r.unpostedInputTax).toBe(15);
    expect([...postedSourceKeys(entries)]).toEqual(['variable__x1']);
  });

  it('وسند دوري وقالبه بنفس المعرّف: السند voucher لا monthly', () => {
    // `buildVoucher` derives the voucher id from the template's, so a template
    // id CAN appear as a voucher id in another collection. Tagging the voucher
    // `monthly` — the badge it wears — made the two one record.
    const rows = [
      { ...AT(), id: 't1', source: 'monthly', sourceKind: 'monthly', parentId: 't1' },
      { ...AT(), id: 't1', source: 'voucher', sourceKind: 'voucher', parentId: 't1' },
    ];
    const entries = [entryFor('voucher', 't1')];
    const r = buildVatReport({ inputs: rows, entries, lines: [], period: '2026-Q3' });
    expect(r.unpostedEligible.map((x) => x.sourceKey)).toEqual(['monthly__t1']);
    expect(sourceKeyOf('voucher', 't1')).not.toBe(sourceKeyOf('monthly', 't1'));
  });

  it('واللقطة تُقرأ للمصدر الصحيح وحده', () => {
    // The monthly row claims 5% and has no entry; the variable row is posted
    // at 15% and frozen. Keying on the bare id would hand the monthly row the
    // variable row's snapshot and report 15 for both.
    const rows = [
      { ...AT({ amount: 105, vatAmount: 5 }), id: 'x1', source: 'monthly', sourceKind: 'monthly', parentId: 'x1' },
      { ...AT(), id: 'x1', source: 'variable', sourceKind: 'variable', parentId: 'x1' },
    ];
    const r = buildVatReport({
      inputs: rows, entries: [entryFor('variable', 'x1')], lines: [], period: '2026-Q3',
    });
    const byKey = Object.fromEntries(r.eligible.map((x) => [x.sourceKey, x]));
    expect(byKey['monthly__x1'].tax).toBe(5);
    expect(byKey['monthly__x1'].posted).toBe(false);
    expect(byKey['variable__x1'].tax).toBe(15);
    expect(byKey['variable__x1'].posted).toBe(true);
  });

  it('وقيد السداد لا يحمل لقطة، فلا يُحتسب الخصم مرتين', () => {
    // The payment half of a split purchase carries `settlementOf` and a null
    // snapshot precisely so a reader summing snapshots cannot count it.
    const entries = [
      entryFor('variable', 'x1'),
      {
        id: 'e-pay', status: 'posted', entryDate: '2026-09-02',
        sourceType: 'expense', sourceKind: 'variable', sourceId: 'x1',
        settlementOf: 'e-variable', purchaseTaxSnapshot: null,
      },
    ];
    const rows = [{ ...AT(), id: 'x1', source: 'variable', sourceKind: 'variable', parentId: 'x1' }];
    const r = buildVatReport({ inputs: rows, entries, lines: [], period: '2026-Q3' });
    expect(r.eligible).toHaveLength(1);
    expect(r.input.tax).toBe(15);
    expect(purchaseEntryTax(entries[1])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// سجل لا يستطيع أحد ترحيله لا يدخل الإقرار
// ═══════════════════════════════════════════════════════════════════════════
// A `startup_costs` parent carrying its own `actual_amount` is the only shape
// of this. No adapter reads that collection — the parent has no spend date, no
// payment method and no per-document identity — so the row could enter
// `input.tax` and could never appear on `1200`. `inputMismatch` for it was
// permanent, and the date it was filed under was `created_at`: the day the row
// was typed.
describe('بنود التأسيس التي تحتاج تحويلاً', () => {
  const PARENT = (over = {}) => ({
    id: 'p1', description: 'ماكينة', amount: 1150, isTaxInvoice: true,
    invoiceNumber: 'S-77', invoiceDate: '2026-08-03', supplier: 'مورّد',
    vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
    spentDate: '', source: 'startup', sourceKind: 'startup-parent',
    requiresConversion: true, parentId: 'p1', ...over,
  });

  it('لا يدخل eligible ولا input.tax، ويُعرض في قائمة التحويل بسببه', () => {
    const r = buildVatReport({ inputs: [PARENT()], period: '2026-Q3' });
    expect(r.eligible).toEqual([]);
    expect(r.input.tax).toBe(0);
    expect(r.ineligible).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.needsConversionCount).toBe(1);
    expect(r.needsConversionAmount).toBe(1150);
    expect(r.needsConversionTax).toBe(150);
    expect(r.needsConversion[0].reason).toMatch(/يحتاج تحويلاً/);
  });

  it('ولا يدخل unpostedEligible — فهو ليس مؤهلاً بعد أصلاً', () => {
    const r = buildVatReport({ inputs: [PARENT()], period: '2026-Q3' });
    expect(r.unpostedEligible).toEqual([]);
    expect(r.unpostedInputTax).toBe(0);
    expect(r.inputMismatch).toBe(0);
  });

  it('والقيد الفرعي المقابل يُخصم عادياً — الفرق أن له تاريخاً ومستنداً', () => {
    const entry = {
      ...PARENT({ id: 'e1', sourceKind: 'startup', spentDate: '2026-08-05' }),
      requiresConversion: false,
    };
    const r = buildVatReport({ inputs: [entry], period: '2026-Q3' });
    expect(r.input.tax).toBe(150);
    expect(r.needsConversionCount).toBe(0);
  });

  it('ولا يُحتسبان معاً حتى لو وصل الاثنان', () => {
    const entry = {
      ...PARENT({ id: 'e1', sourceKind: 'startup', spentDate: '2026-08-05' }),
      requiresConversion: false,
    };
    const r = buildVatReport({ inputs: [entry, PARENT()], period: '2026-Q3' });
    expect(r.input.tax).toBe(150);            // NOT 300
    expect(r.eligible).toHaveLength(1);
    expect(r.needsConversionCount).toBe(1);
  });
});
