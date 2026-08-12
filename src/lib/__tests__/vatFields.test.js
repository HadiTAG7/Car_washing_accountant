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
} from '../vatFields';

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
