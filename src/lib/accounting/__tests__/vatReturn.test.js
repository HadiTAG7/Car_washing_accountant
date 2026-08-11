import { describe, it, expect } from 'vitest';
import {
  periodKeyFor, periodLabel, periodRange, currentPeriodKey,
  inputInvoiceEligibility, claimDateOf, outputTaxFromWashes, outputTaxFromLedger,
  buildVatReport, availablePeriods,
} from '../vatReturn';

/** A complete, deductible purchase invoice. */
const INVOICE = {
  id: 'i1', description: 'مواد تنظيف', amount: 1150, isTaxInvoice: true,
  invoiceNumber: 'S-4417', invoiceDate: '2026-08-03', supplier: 'مؤسسة النور',
  source: 'variable', parentId: 'p1',
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
    expect(inputInvoiceEligibility({ ...INVOICE, invoiceDate: '', spentDate: '' }).missing)
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

  it('تاريخ الصرف يقوم مقام تاريخ الفاتورة عند غيابه', () => {
    const r = { ...INVOICE, invoiceDate: '', spentDate: '2026-08-04' };
    expect(inputInvoiceEligibility(r).eligible).toBe(true);
    expect(claimDateOf(r)).toBe('2026-08-04');
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
    source: 'monthly', parentId: 'm1',
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
