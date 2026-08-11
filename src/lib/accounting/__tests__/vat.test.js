import { describe, it, expect } from 'vitest';
import { splitVat, splitVatBalanced, vatReturnFrom, VAT_RATE } from '../vat';
import { round2 } from '../journal';

describe('احتساب الضريبة — سعر شامل', () => {
  it('يستخرج الضريبة من مبلغ شامل', () => {
    // 115 inclusive at 15% → 100 net + 15 tax.
    expect(splitVat(115, { mode: 'inclusive' })).toEqual({ gross: 115, net: 100, vat: 15 });
  });

  it('يطابق الأرقام الحقيقية من التطبيق', () => {
    expect(splitVat(63,  { mode: 'inclusive' }).vat).toBe(8.22);
    expect(splitVat(63,  { mode: 'inclusive' }).net).toBe(54.78);
    expect(splitVat(230, { mode: 'inclusive' }).vat).toBe(30);
    expect(splitVat(1150, { mode: 'inclusive' }).vat).toBe(150);
    expect(splitVat(194000, { mode: 'inclusive' }).vat).toBe(25304.35);
  });
});

describe('احتساب الضريبة — سعر غير شامل', () => {
  it('يضيف الضريبة فوق المبلغ', () => {
    expect(splitVat(100, { mode: 'exclusive' })).toEqual({ gross: 115, net: 100, vat: 15 });
  });

  it('الوضعان يلتقيان: شامل 115 = غير شامل 100', () => {
    const inc = splitVat(115, { mode: 'inclusive' });
    const exc = splitVat(100, { mode: 'exclusive' });
    expect(inc).toEqual(exc);
  });

  it('يحترم نسبة مخصصة', () => {
    expect(splitVat(100, { mode: 'exclusive', rate: 0.05 })).toEqual({ gross: 105, net: 100, vat: 5 });
  });
});

describe('الحالات غير الخاضعة', () => {
  it('غير خاضع للضريبة يعيد المبلغ كما هو', () => {
    expect(splitVat(500, { taxable: false })).toEqual({ gross: 500, net: 500, vat: 0 });
  });

  it('صفر يبقى صفراً', () => {
    expect(splitVat(0, { mode: 'inclusive' })).toEqual({ gross: 0, net: 0, vat: 0 });
  });
});

describe('اتزان التقريب', () => {
  it('الصافي + الضريبة = الإجمالي دائماً', () => {
    // Sweep values where independent rounding can drift by a halala.
    for (let cents = 1; cents <= 2000; cents += 1) {
      const gross = cents / 100;
      const { net, vat } = splitVatBalanced(gross, { mode: 'inclusive' });
      expect(round2(net + vat)).toBe(round2(gross));
    }
  });

  it('يصحّح الانحراف على الصافي لا على الضريبة', () => {
    const raw = splitVat(0.07, { mode: 'inclusive' });
    const fixed = splitVatBalanced(0.07, { mode: 'inclusive' });
    expect(fixed.vat).toBe(raw.vat);              // tax figure is untouched
    expect(round2(fixed.net + fixed.vat)).toBe(0.07);
  });
});

describe('إقرار الضريبة للفترة', () => {
  const OUT = '2100', IN = '1200';

  it('يحسب المخرجات والمدخلات والصافي', () => {
    const lines = [
      { accountId: OUT, debit: 0,  credit: 150 },   // sales tax charged
      { accountId: OUT, debit: 0,  credit: 45 },
      { accountId: IN,  debit: 60, credit: 0 },     // purchase tax paid
      { accountId: '4000', debit: 0, credit: 1000 }, // ignored
    ];
    expect(vatReturnFrom(lines, { outputAccount: OUT, inputAccount: IN })).toEqual({
      outputTax: 195, inputTax: 60, netTax: 135, direction: 'payable',
    });
  });

  it('يعطي اتجاه استرداد عندما تفوق المدخلات المخرجات', () => {
    const lines = [
      { accountId: OUT, debit: 0,   credit: 20 },
      { accountId: IN,  debit: 300, credit: 0 },
    ];
    const r = vatReturnFrom(lines, { outputAccount: OUT, inputAccount: IN });
    expect(r.netTax).toBe(-280);
    expect(r.direction).toBe('refundable');
  });

  it('يخصم القيود العكسية من الطرفين', () => {
    const lines = [
      { accountId: OUT, debit: 0,  credit: 150 },
      { accountId: OUT, debit: 150, credit: 0 },   // reversal
      { accountId: IN,  debit: 60, credit: 0 },
      { accountId: IN,  debit: 0,  credit: 60 },   // reversal
    ];
    const r = vatReturnFrom(lines, { outputAccount: OUT, inputAccount: IN });
    expect(r).toEqual({ outputTax: 0, inputTax: 0, netTax: 0, direction: 'nil' });
  });
});

describe('النسبة', () => {
  it('النسبة القياسية 15%', () => {
    expect(VAT_RATE).toBe(0.15);
  });
});
