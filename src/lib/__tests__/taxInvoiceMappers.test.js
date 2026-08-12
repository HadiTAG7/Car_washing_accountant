/**
 * حقول الفاتورة الضريبية — round trip through every expense source.
 *
 * `vatAmount`, `vatRate` and `priceMode` are what let a purchase keep its own
 * tax. Without them the report had to derive VAT from a rate, and the only
 * rate it had was TODAY's — so a 5%-era invoice was reclaimed at 15% the
 * moment the standard rate moved.
 *
 * All five sources share one mapper block, which is exactly why this suite
 * drives the block rather than five near-identical copies: if a field is
 * dropped it is dropped everywhere, and if it survives here it survives
 * everywhere. The per-source inserts are checked too, so a source that stops
 * spreading the block is caught.
 */
import { describe, it, expect } from 'vitest';
import {
  mapTaxInvoiceFields, toTaxInvoiceFields, toTaxInvoiceFieldsUpdate,
  mapStartupCostEntry, toStartupCostEntryInsert,
  mapAnnualExpenseEntry, toAnnualExpenseEntryInsert,
  mapMonthlyExpense, toMonthlyExpenseInsert,
  mapVariableExpense, toVariableExpenseInsert,
} from '../mappers';

/** Everything the tax block carries, filled in. */
const APP_SHAPE = {
  isTaxInvoice: true,
  invoiceUrl: 'https://x/invoice.pdf',
  invoiceNumber: 'S-4417',
  invoiceDate: '2020-03-01',
  supplier: 'مؤسسة النور',
  vatAmount: 5,
  vatRate: 0.05,
  priceMode: 'inclusive',
  vatDeductible: true,
  paymentMethod: 'cash',
};

describe('كتلة الفاتورة الضريبية ذهاباً وإياباً', () => {
  it('تحفظ مبلغ الضريبة والنسبة ووضع السعر وتقرأها كما هي', () => {
    const row = toTaxInvoiceFields(APP_SHAPE);
    expect(row).toMatchObject({
      vat_amount: 5, vat_rate: 0.05, price_mode: 'inclusive',
    });
    expect(mapTaxInvoiceFields(row)).toMatchObject({
      vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive', vatDeductible: true,
    });
  });

  // ── "غير مذكور" ليست صفراً ──────────────────────────────────────────
  it('والمبلغ غير المذكور يبقى null لا صفراً — null و"" وundefined', () => {
    for (const unstated of [null, '', '   ', undefined]) {
      expect(toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: unstated }).vat_amount).toBeNull();
      expect(toTaxInvoiceFields({ ...APP_SHAPE, vatRate: unstated }).vat_rate).toBeNull();
    }
    const row = toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: '', vatRate: '' });
    expect(row.vat_amount).toBeNull();
    expect(row.vat_rate).toBeNull();
    const back = mapTaxInvoiceFields(row);
    expect(back.vatAmount).toBeNull();
    expect(back.vatRate).toBeNull();
    // …but an explicit zero IS an answer: a zero-rated or exempt supply.
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatRate: 0 }).vat_rate).toBe(0);
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: 0 }).vat_amount).toBe(0);
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: '0' }).vat_amount).toBe(0);
    expect(mapTaxInvoiceFields({ vat_rate: 0 }).vatRate).toBe(0);
    expect(mapTaxInvoiceFields({ vat_amount: 0 }).vatAmount).toBe(0);
  });

  it('وترفض القيم خارج المدى بدل تخزينها', () => {
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: -1 }).vat_amount).toBeNull();
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatAmount: 'كثير' }).vat_amount).toBeNull();
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatRate: 1.5 }).vat_rate).toBeNull();
    expect(toTaxInvoiceFields({ ...APP_SHAPE, vatRate: -0.1 }).vat_rate).toBeNull();
  });

  it('ووضع السعر يقبل exclusive ويفترض inclusive فيما عداه', () => {
    expect(toTaxInvoiceFields({ ...APP_SHAPE, priceMode: 'exclusive' }).price_mode).toBe('exclusive');
    expect(toTaxInvoiceFields({ ...APP_SHAPE, priceMode: 'شيء' }).price_mode).toBe('inclusive');
    expect(mapTaxInvoiceFields({}).priceMode).toBe('inclusive');
  });

  it('والتعديل الجزئي لا يكتب إلا ما تغيّر فعلاً', () => {
    expect(toTaxInvoiceFieldsUpdate({})).toEqual({});
    expect(toTaxInvoiceFieldsUpdate({ vatAmount: 17.25 })).toEqual({ vat_amount: 17.25 });
    expect(toTaxInvoiceFieldsUpdate({ vatRate: 0.05 })).toEqual({ vat_rate: 0.05 });
    expect(toTaxInvoiceFieldsUpdate({ priceMode: 'exclusive' })).toEqual({ price_mode: 'exclusive' });
    // Clearing a stated amount is a real edit, and stores null.
    expect(toTaxInvoiceFieldsUpdate({ vatAmount: '' })).toEqual({ vat_amount: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// كل مصدر مصروف يحمل الحقول نفسها
// ═══════════════════════════════════════════════════════════════════════════
describe.each([
  ['رسوم التأسيس', toStartupCostEntryInsert, mapStartupCostEntry,
    { startupCostId: 'p1', amount: 105, spentDate: '2020-03-01', description: 'مواد' }],
  ['المصاريف السنوية', toAnnualExpenseEntryInsert, mapAnnualExpenseEntry,
    { annualExpenseId: 'p1', amount: 105, spentDate: '2020-03-01', description: 'رخصة' }],
  ['المصاريف الشهرية', toMonthlyExpenseInsert, mapMonthlyExpense,
    { expenseName: 'إيجار', categoryId: 'c1', quantity: 1, unitCost: 105, loggedDate: '2020-03-01' }],
  ['المصاريف المتغيرة', toVariableExpenseInsert, mapVariableExpense,
    { expenseName: 'مواد', categoryId: 'c1', quantity: 1, unitCost: 105, loggedDate: '2020-03-01' }],
])('%s تحمل حقول الضريبة كاملة', (_name, toInsert, mapRow, base) => {
  it('تُكتب وتُقرأ بلا فقد', () => {
    const row = toInsert({ ...base, ...APP_SHAPE });
    expect(row.vat_amount).toBe(5);
    expect(row.vat_rate).toBe(0.05);
    expect(row.price_mode).toBe('inclusive');
    expect(row.vat_deductible).toBe(true);

    const back = mapRow({ id: 'x', ...row });
    expect(back.vatAmount).toBe(5);
    expect(back.vatRate).toBe(0.05);
    expect(back.priceMode).toBe('inclusive');
    expect(back.vatDeductible).toBe(true);
    expect(back.invoiceNumber).toBe('S-4417');
    expect(back.invoiceDate).toBe('2020-03-01');
    expect(back.supplier).toBe('مؤسسة النور');
  });

  it('وبلا حقول ضريبية تعود null لا صفراً', () => {
    const row = toInsert({ ...base, isTaxInvoice: true });
    expect(row.vat_amount).toBeNull();
    expect(row.vat_rate).toBeNull();
    const back = mapRow({ id: 'x', ...row });
    expect(back.vatAmount).toBeNull();
    expect(back.vatRate).toBeNull();
  });
});
