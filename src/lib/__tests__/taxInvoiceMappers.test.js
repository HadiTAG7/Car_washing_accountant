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
  toStartupCostInsert,
  mapTaxInvoiceFields, toTaxInvoiceFields, toTaxInvoiceFieldsUpdate,
  mapStartupCostEntry, toStartupCostEntryInsert,
  mapAnnualExpenseEntry, toAnnualExpenseEntryInsert, toAnnualExpenseEntryUpdate,
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

// ═══════════════════════════════════════════════════════════════════════════
// بند التأسيس خطة — لا مبلغ فعلي ولا فاتورة عليه
// ═══════════════════════════════════════════════════════════════════════════
// `startup_costs` grew an `actual_amount` and a tax-invoice flag, and the VAT
// report read both — but nothing could post them: `ADAPTERS.startup` reads
// `startup_cost_entries`, and a parent-level figure has no spend date, no
// payment method and no per-document identity. The row entered the return and
// could never reach `1200`. Closing that hole means closing the write path,
// not adding a posting path for a record that cannot supply what one needs.
describe('بند رسوم التأسيس لا يقبل مبلغاً فعلياً ولا فاتورة', () => {
  const ATTEMPT = {
    category: 'equipment', itemName: 'ماكينة', quantity: 1, plannedAmount: 1000,
    // Everything below is the shape that used to be written straight onto the
    // parent, and none of it survives the mapper any more.
    actualAmount: 1150, isTaxInvoice: true, invoiceNumber: 'S-77',
    invoiceDate: '2026-03-10', supplier: 'مؤسسة النور', vatAmount: 150,
    vatRate: 0.15, priceMode: 'inclusive', vatDeductible: true,
  };

  it('الإضافة تكتب الخطة فقط', () => {
    const row = toStartupCostInsert(ATTEMPT);
    expect(row).toMatchObject({
      item_name: 'ماكينة', budgeted_amount: 1000, actual_amount: 0, is_tax_invoice: false,
    });
    expect(row.invoice_number).toBeNull();
    expect(row.supplier).toBeNull();
    expect(row.vat_amount).toBeNull();
    expect(row.vat_rate).toBeNull();
  });

  it('والحالة الابتدائية مشتقة لا مختارة', () => {
    // A plan with no spend is `in_progress` by derivation. A row created as
    // `completed` would be lying from its first moment, so the value is
    // forced here and required by the rules on create.
    expect(toStartupCostInsert({ ...ATTEMPT, status: 'completed' }).status).toBe('in_progress');
    expect(toStartupCostInsert({ ...ATTEMPT, status: 'anything' }).status).toBe('in_progress');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// تعديل القيد السنوي — الحمولة تُكتب مفتاحاً مفتاحاً، ولسببٍ أمني
// ═══════════════════════════════════════════════════════════════════════════
// قاعدة `annual_expense_entries` تسمح بتعديل قيدٍ **مُرحَّل** حين يكون `unit`
// هو المفتاح الوحيد الذي تغيّر — لأن وسم السكن تحليلٌ لا مال. فمفتاحٌ واحد
// زائد في الحمولة يقلب إسناداً صحيحاً إلى `permission-denied` لا يفهم أحد
// سببه. ومن الجهة الأخرى، إسقاط حقول الفاتورة كان سيجعل قلم سجلّ المصاريف
// يبتلع تعديل فاتورةٍ بصمت. فالادعاءان متقابلان ويُختبران معاً.
describe('toAnnualExpenseEntryUpdate', () => {
  it('وسمُ السكن وحده يُنتج مفتاحاً واحداً — لا حقل فاتورة يتسلّل معه', () => {
    expect(toAnnualExpenseEntryUpdate({ unit: '  سكن الشمال  ' }))
      .toEqual({ unit: 'سكن الشمال' });
  });

  it('وحمولةٌ فارغة لا تكتب شيئاً', () => {
    expect(toAnnualExpenseEntryUpdate({})).toEqual({});
    expect(toAnnualExpenseEntryUpdate()).toEqual({});
  });

  it('وحقول الفاتورة تمرّ حين تُذكر — القلم لا يبتلع تعديلاً', () => {
    const out = toAnnualExpenseEntryUpdate({
      description: ' إيجار ', amount: 24000, spentDate: '2026-01-05',
      invoiceNumber: 'INV-9', supplier: ' المؤجر ', isTaxInvoice: true,
    });
    expect(out).toMatchObject({
      description: 'إيجار',
      amount: 24000,
      spent_date: '2026-01-05',
      invoice_number: 'INV-9',
      supplier: 'المؤجر',
      is_tax_invoice: true,
    });
    // ولا `unit` بينها — ما لم يُذكر لا يُكتب.
    expect(out).not.toHaveProperty('unit');
  });
});
