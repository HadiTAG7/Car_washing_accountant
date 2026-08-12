/**
 * سياسة الضريبة بتاريخ سريان — driven over BOTH copies.
 *
 * The server's copy decides what a posted entry says; the client's decides how
 * an unposted wash is read on screen. If they disagree, a month reconciles on
 * one side and not the other — so both are run over one battery here, exactly
 * as `invariants.test.js` does for entry validation.
 *
 * Run: npm run test:functions (no emulator needed)
 */
import { describe, it, expect } from 'vitest';
import * as server from '../src/taxPolicy.js';
import * as client from '../../src/lib/accounting/taxPolicy.js';

const IMPLEMENTATIONS = [['server', server], ['client', client]];

const HISTORY = [
  { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
  { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
];

describe.each(IMPLEMENTATIONS)('%s — taxPolicyAt', (_name, impl) => {
  it('بلا سجل، الإعدادات الحالية تسري على كل التواريخ', () => {
    const p = impl.taxPolicyAt('2020-05-05', { vatRegistered: false, washPriceMode: 'exclusive' });
    expect(p).toEqual({ vatRegistered: false, washPriceMode: 'exclusive', vatRate: 0.15 });
  });

  it('تختار آخر سطر ساري في التاريخ أو قبله', () => {
    const settings = { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: HISTORY };
    expect(impl.taxPolicyAt('2026-07-31', settings).washPriceMode).toBe('inclusive');
    expect(impl.taxPolicyAt('2026-08-01', settings).washPriceMode).toBe('exclusive');
    expect(impl.taxPolicyAt('2026-12-31', settings).washPriceMode).toBe('exclusive');
  });

  it('وتاريخ أقدم من كل السطور يعود للإعداد الحالي بدل اختراع سياسة', () => {
    const settings = { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: HISTORY };
    expect(impl.taxPolicyAt('2025-06-01', settings).washPriceMode).toBe('exclusive');
  });

  it('وتتجاهل السطور بلا تاريخ سريان — لا تُخمَّن', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive',
      taxPolicyHistory: [{ washPriceMode: 'exclusive' }, ...HISTORY],
    };
    expect(impl.normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings)).toHaveLength(2);
    expect(impl.taxPolicyAt('2026-03-01', settings).washPriceMode).toBe('inclusive');
  });

  it('وتاريخ غير صالح يعود للإعداد الحالي', () => {
    const settings = { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: HISTORY };
    expect(impl.taxPolicyAt('', settings).washPriceMode).toBe('exclusive');
    expect(impl.taxPolicyAt('2026-13-40', settings).washPriceMode).toBe('exclusive');
  });

  it('والتسجيل الضريبي يُقرأ بتاريخه', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive',
      taxPolicyHistory: [
        { effectiveFrom: '2026-01-01', vatRegistered: false, washPriceMode: 'inclusive' },
        { effectiveFrom: '2026-06-01', vatRegistered: true, washPriceMode: 'inclusive' },
      ],
    };
    expect(impl.taxPolicyAt('2026-05-31', settings).vatRegistered).toBe(false);
    expect(impl.taxPolicyAt('2026-06-01', settings).vatRegistered).toBe(true);
  });
});

describe.each(IMPLEMENTATIONS)('%s — withTaxPolicyChange', (_name, impl) => {
  const current = { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: [] };

  it('تُسجّل سطراً مؤرخاً عند تغيير وضع السعر', () => {
    const next = impl.withTaxPolicyChange(current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01');
    expect(next).toEqual([
      { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
    ]);
  });

  it('ولا تُسجّل شيئاً إذا لم تتغير حقول الضريبة والسجل غير فارغ', () => {
    const withHistory = { ...current, taxPolicyHistory: [{ effectiveFrom: '2026-01-01', ...current }] };
    const next = impl.withTaxPolicyChange(withHistory, { ...current, autoPost: true }, '2026-08-01');
    expect(next).toHaveLength(1);
    expect(next[0].effectiveFrom).toBe('2026-01-01');
  });

  it('وتغييران في اليوم نفسه يتركان سطراً واحداً', () => {
    const first = impl.withTaxPolicyChange(current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01');
    const second = impl.withTaxPolicyChange(
      { ...current, washPriceMode: 'exclusive', taxPolicyHistory: first },
      { ...current, vatRegistered: false, washPriceMode: 'exclusive' },
      '2026-08-01',
    );
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ effectiveFrom: '2026-08-01', vatRegistered: false });
  });

  it('والسطور تبقى مرتبة تصاعدياً', () => {
    const a = impl.withTaxPolicyChange(current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01');
    const b = impl.withTaxPolicyChange(
      { ...current, washPriceMode: 'exclusive', taxPolicyHistory: a },
      { ...current, washPriceMode: 'inclusive' },
      '2026-03-01',
    );
    expect(b.map((h) => h.effectiveFrom)).toEqual(['2026-03-01', '2026-08-01']);
  });
});

describe('النسختان متطابقتان', () => {
  const cases = [
    ['2026-07-31', { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: HISTORY }],
    ['2026-08-15', { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: HISTORY }],
    ['2020-01-01', { vatRegistered: false, washPriceMode: 'inclusive' }],
    ['', { taxPolicyHistory: HISTORY }],
  ];
  it.each(cases)('taxPolicyAt(%s) يعطي النتيجة نفسها', (date, settings) => {
    expect(server.taxPolicyAt(date, settings)).toEqual(client.taxPolicyAt(date, settings));
  });
});
