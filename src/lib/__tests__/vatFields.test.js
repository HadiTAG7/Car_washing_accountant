/**
 * «غير مذكور» ليست صفراً — التعريف الواحد.
 *
 * Three modules used to answer this separately: the mapper, the form field
 * component, and the VAT report. They disagreed, and the one that got it wrong
 * was the one that decides what gets deducted.
 */
import { describe, it, expect } from 'vitest';
import {
  isUnstated, statedVatAmount, statedVatRate, normalizedPriceMode, taxSourceFor,
  readStatedVatAmount, isRealCalendarDate, validateTaxInvoiceFields,
  blockingVatProblems, taxInvoiceFieldsAreValid, firstBlockingVatProblem,
  VAT_PROBLEM,
} from '../vatFields';
import { readTaxInvoiceFields } from '../taxInvoiceForm';

describe('isUnstated', () => {
  it('null وundefined والفراغ غير مذكورة', () => {
    for (const v of [null, undefined, '', '   ']) expect(isUnstated(v)).toBe(true);
  });
  it('والصفر مذكور', () => {
    for (const v of [0, '0', 0.0, '0.00']) expect(isUnstated(v)).toBe(false);
  });
});

describe('statedVatAmount', () => {
  it('يعيد null لغير المذكور — وهذا ما كان Number(null) يحوّله إلى صفر', () => {
    for (const v of [null, undefined, '', '  ']) expect(statedVatAmount(v)).toBeNull();
  });
  it('ويعيد صفراً للصفر الصريح', () => {
    expect(statedVatAmount(0)).toBe(0);
    expect(statedVatAmount('0')).toBe(0);
  });
  it('ويقرّب إلى الهللة ويرفض السالب وغير الرقمي', () => {
    expect(statedVatAmount('17.254')).toBe(17.25);
    expect(statedVatAmount(-1)).toBeNull();
    expect(statedVatAmount('كثير')).toBeNull();
  });
});

describe('statedVatRate', () => {
  it('يفرّق بين غير المذكورة والصفرية', () => {
    expect(statedVatRate(null)).toBeNull();
    expect(statedVatRate('')).toBeNull();
    expect(statedVatRate(0)).toBe(0);
    expect(statedVatRate('0')).toBe(0);
  });
  it('ويرفض ما خرج عن [0,1)', () => {
    expect(statedVatRate(1)).toBeNull();
    expect(statedVatRate(1.5)).toBeNull();
    expect(statedVatRate(-0.1)).toBeNull();
    expect(statedVatRate(0.05)).toBe(0.05);
  });
});

describe('normalizedPriceMode', () => {
  it('exclusive وحدها، وما عداها inclusive', () => {
    expect(normalizedPriceMode('exclusive')).toBe('exclusive');
    expect(normalizedPriceMode('inclusive')).toBe('inclusive');
    expect(normalizedPriceMode(undefined)).toBe('inclusive');
    expect(normalizedPriceMode('شيء')).toBe('inclusive');
  });
});

describe('taxSourceFor — النموذج والتقرير يقولان الشيء نفسه', () => {
  it('المبلغ يسبق النسبة، والنسبة تسبق السياسة', () => {
    expect(taxSourceFor({ vatAmount: 5, vatRate: 0.15 })).toBe('invoice');
    expect(taxSourceFor({ vatAmount: 0, vatRate: 0.15 })).toBe('invoice');
    expect(taxSourceFor({ vatAmount: null, vatRate: 0.05 })).toBe('invoice-rate');
    expect(taxSourceFor({ vatAmount: null, vatRate: null })).toBe('policy');
    expect(taxSourceFor({})).toBe('policy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateTaxInvoiceFields — الخطأ يُقال، لا يُمحى
// ═══════════════════════════════════════════════════════════════════════════
// The tolerant readers answer "what figure should I use", so anything they
// cannot use comes back `null` — the same answer they give for "not stated".
// That is right for reading and disastrous for saving: −5 was stored as
// `null`, the record read back as though the field had been left empty, and
// the typo left nothing behind to find.
//
// These are the strict readers' job. `blocking` stops a save; `incomplete`
// does not — a purchase may legitimately be recorded before its invoice
// number arrives, and the VAT report already lists such a row as غير مؤهلة
// rather than pretending it does not exist.
describe('validateTaxInvoiceFields', () => {
  const blocking = (form, amount = 115) => blockingVatProblems(form, { amount });
  const fields = (form, amount = 115) => blocking(form, amount).map((p) => p.field);

  it('القيمة السالبة خطأ مانع، ولا تُحوَّل إلى null', () => {
    expect(fields({ vatAmount: -5 })).toEqual(['vatAmount']);
    expect(fields({ vatAmount: '-0.01' })).toEqual(['vatAmount']);
    // …وهذا هو الفرق بالضبط عن القارئ المتسامح، الذي يعطي null نفسها لـ«غير مذكور».
    expect(statedVatAmount(-5)).toBeNull();
    expect(statedVatAmount(null)).toBeNull();
    expect(readStatedVatAmount(-5)).toMatchObject({ stated: true, value: null });
    expect(readStatedVatAmount(null)).toMatchObject({ stated: false, value: null });
  });

  it('وNaN وInfinity يمنعان الحفظ', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'كثير', {}]) {
      expect(fields({ vatAmount: bad })).toEqual(['vatAmount']);
    }
    for (const bad of [NaN, Infinity, 'نصف']) {
      expect(fields({ vatRate: bad })).toEqual(['vatRate']);
    }
  });

  it('والنسبة يجب أن تقع في [0,1)', () => {
    expect(fields({ vatRate: 1 })).toEqual(['vatRate']);
    expect(fields({ vatRate: 1.5 })).toEqual(['vatRate']);
    expect(fields({ vatRate: -0.1 })).toEqual(['vatRate']);
    expect(fields({ vatRate: 0.9999 })).toEqual([]);
  });

  it('وضريبة أكبر من الإجمالي الشامل تمنع الحفظ', () => {
    expect(fields({ vatAmount: 200, priceMode: 'inclusive' }, 115)).toEqual(['vatAmount']);
    // بالضبط على الحد: ليست أكبر، فتمرّ (توريد ضريبته كامل قيمته لا يوجد،
    // لكن الرفض هنا يجب أن يكون على «أكبر» لا على «يساوي»).
    expect(fields({ vatAmount: 115, priceMode: 'inclusive' }, 115)).toEqual([]);
  });

  it('وفي وضع «غير شامل» تُقاس الضريبة على الصافي لا على الإجمالي', () => {
    // 15 فوق صافي 115 مقبول تماماً — وكانت القاعدة الشاملة سترفضه لو طُبِّقت.
    expect(fields({ vatAmount: 15, priceMode: 'exclusive' }, 115)).toEqual([]);
    // …لكن ضريبة تساوي الصافي أو تتجاوزه تعني نسبة 100% فأكثر.
    expect(fields({ vatAmount: 115, priceMode: 'exclusive' }, 115)).toEqual(['vatAmount']);
    expect(fields({ vatAmount: 200, priceMode: 'exclusive' }, 115)).toEqual(['vatAmount']);
  });

  it('والمبلغ الذي يناقض النسبة المكتوبة معه يُرفض بدل أن يُحسم بصمت', () => {
    // 115 شامل عند 15% = 15.00 — والمبلغ يقول 5.
    expect(fields({ vatAmount: 5, vatRate: 0.15 }, 115)).toEqual(['vatAmount']);
    // وتقريب المورّد بالهللة يمرّ.
    expect(fields({ vatAmount: 15.01, vatRate: 0.15 }, 115)).toEqual([]);
    expect(fields({ vatAmount: 14.99, vatRate: 0.15 }, 115)).toEqual([]);
  });

  it('والصفر الصريح صالح — توريد صفري أو معفى', () => {
    expect(fields({ vatAmount: 0 })).toEqual([]);
    expect(fields({ vatAmount: '0' })).toEqual([]);
    expect(fields({ vatRate: 0 })).toEqual([]);
  });

  it('و«غير مذكور» ليست خطأً — null و"" وundefined', () => {
    for (const unstated of [null, undefined, '', '   ']) {
      expect(fields({ vatAmount: unstated, vatRate: unstated })).toEqual([]);
    }
    expect(fields({})).toEqual([]);
  });

  it('وتاريخ الفاتورة تقويمي حقيقي لا مجرد شكل تاريخ', () => {
    expect(fields({ invoiceDate: '2026-02-30' })).toEqual(['invoiceDate']);
    expect(fields({ invoiceDate: '2026-13-01' })).toEqual(['invoiceDate']);
    expect(fields({ invoiceDate: '2026-02-29' })).toEqual(['invoiceDate']);  // ليست كبيسة
    expect(fields({ invoiceDate: '2024-02-29' })).toEqual([]);               // كبيسة
    expect(fields({ invoiceDate: '2026-02-28' })).toEqual([]);
    expect(isRealCalendarDate('2026-02-30')).toBe(false);
    expect(isRealCalendarDate('2026-02-28')).toBe(true);
  });

  it('وهوية الفاتورة الناقصة تُبلَّغ ولا تمنع الحفظ', () => {
    const all = validateTaxInvoiceFields({ isTaxInvoice: true }, { amount: 115 });
    expect(all.map((p) => p.field).sort())
      .toEqual(['invoiceDate', 'invoiceNumber', 'supplier']);
    expect(all.every((p) => p.severity === VAT_PROBLEM.INCOMPLETE)).toBe(true);
    // …لأن الشراء قد يُسجَّل قبل وصول ورقته؛ ما يُمنع حينها هو الخصم، لا الحفظ.
    expect(blocking({ isTaxInvoice: true })).toEqual([]);
    expect(taxInvoiceFieldsAreValid({ isTaxInvoice: true }, { amount: 115 })).toBe(true);
  });

  it('ولا هوية مطلوبة إن لم تكن فاتورة ضريبية', () => {
    expect(validateTaxInvoiceFields({ isTaxInvoice: false }, { amount: 115 })).toEqual([]);
  });

  it('وكل مشكلة تحمل الحقل والرسالة والشدّة — لا مجرد صواب/خطأ', () => {
    const [p] = blocking({ vatAmount: -5 });
    expect(p).toMatchObject({ field: 'vatAmount', severity: VAT_PROBLEM.BLOCKING });
    expect(typeof p.message).toBe('string');
    expect(p.message.length).toBeGreaterThan(0);
    expect(firstBlockingVatProblem({ vatAmount: -5 }, { amount: 115 })).toBe(p.message);
    expect(firstBlockingVatProblem({}, { amount: 115 })).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// النموذج يعرض القيمة الفاسدة بدل أن يبتلعها
// ═══════════════════════════════════════════════════════════════════════════
describe('readTaxInvoiceFields — القيمة المخزَّنة الفاسدة تبقى ظاهرة', () => {
  it('تُعاد كما هي لا null، فيجد المدقّق ما يشتكي منه', () => {
    expect(readTaxInvoiceFields({ vatAmount: -5 }).vatAmount).toBe(-5);
    expect(readTaxInvoiceFields({ vatRate: 1.5 }).vatRate).toBe(1.5);
    // والقيم السليمة تُقرأ كما كانت دائماً.
    expect(readTaxInvoiceFields({ vatAmount: 0 }).vatAmount).toBe(0);
    expect(readTaxInvoiceFields({ vatAmount: 15 }).vatAmount).toBe(15);
    expect(readTaxInvoiceFields({}).vatAmount).toBeNull();
    expect(readTaxInvoiceFields({ vatAmount: '' }).vatAmount).toBeNull();
  });

  it('والحفظ يبقى ممنوعاً حتى تُصحَّح', () => {
    const form = readTaxInvoiceFields({ vatAmount: -5, isTaxInvoice: true });
    expect(blockingVatProblems(form, { amount: 115 })).toHaveLength(1);
  });
});
