/**
 * رحلة حقول الضريبة من النموذج إلى الحمولة الخام.
 *
 * The mapper round-trip suite passed while the journey was broken, and that is
 * the point of this file. `taxInvoiceForm.js` is the choke point every expense
 * form funnels through on its way to a payload — `readTaxInvoiceFields` on
 * open, `submitTaxInvoiceFields` on save — and it carried only four fields.
 * `vatAmount`, `vatRate` and `priceMode` were added to the UI and to the
 * mapper and not to it, so they were dropped at the FIRST hop and every test
 * that started at the mapper was testing a stretch of road the data never
 * reached.
 *
 * So these start where the user starts: a form state, through the helper,
 * through the source's own insert mapper, to the snake_case object that is
 * handed to Firestore.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_TAX_INVOICE_FIELDS, readTaxInvoiceFields, submitTaxInvoiceFields,
} from '../taxInvoiceForm';
import {
  toStartupCostEntryInsert, mapStartupCostEntry,
  toAnnualExpenseEntryInsert, mapAnnualExpenseEntry,
  toMonthlyExpenseInsert, mapMonthlyExpense,
  toVariableExpenseInsert, mapVariableExpense,
} from '../mappers';
import { buildVoucher } from '../accounting/recurring';

/** The three fields the journey used to lose. */
const VAT_FIELDS = { vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive' };

const STORED = {
  invoiceNumber: 'S-4417',
  invoiceDate: '2020-03-01',
  supplier: 'مؤسسة النور',
  vatDeductible: true,
  ...VAT_FIELDS,
};

describe('taxInvoiceForm يحمل حقول الضريبة الثلاثة', () => {
  it('الحقول الفارغة تعرّف الثلاثة، وnull ليست صفراً', () => {
    expect(EMPTY_TAX_INVOICE_FIELDS).toMatchObject({
      vatAmount: null, vatRate: null, priceMode: 'inclusive',
    });
  });

  // ── حالة إعادة الإنتاج المطلوبة حرفياً ──────────────────────────────
  it('read ← record ثم submit يُبقي vatAmount وvatRate وpriceMode', () => {
    const record = { vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive' };
    const form = readTaxInvoiceFields(record);
    expect(form).toMatchObject({ vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive' });

    const payload = submitTaxInvoiceFields(form);
    expect(payload).toMatchObject({ vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive' });
  });

  it('و«غير مذكور» يعبر كـnull لا كصفر', () => {
    const form = readTaxInvoiceFields({ vatAmount: null, vatRate: null });
    expect(form.vatAmount).toBeNull();
    expect(form.vatRate).toBeNull();
    expect(submitTaxInvoiceFields(form).vatAmount).toBeNull();
    expect(submitTaxInvoiceFields({ ...form, vatAmount: '' }).vatAmount).toBeNull();
  });

  it('وصفر صريح ينجو من كل من read وsubmit', () => {
    // `0 || null` would have thrown a zero-rated supply away.
    expect(readTaxInvoiceFields({ vatAmount: 0, vatRate: 0 })).toMatchObject({
      vatAmount: 0, vatRate: 0,
    });
    expect(submitTaxInvoiceFields({ vatAmount: '0', vatRate: '0' })).toMatchObject({
      vatAmount: 0, vatRate: 0,
    });
  });

  it('ووضع السعر يُطبَّع في الاتجاهين', () => {
    expect(readTaxInvoiceFields({ priceMode: 'exclusive' }).priceMode).toBe('exclusive');
    expect(readTaxInvoiceFields({ priceMode: 'شيء' }).priceMode).toBe('inclusive');
    expect(submitTaxInvoiceFields({ priceMode: 'exclusive' }).priceMode).toBe('exclusive');
    expect(submitTaxInvoiceFields({}).priceMode).toBe('inclusive');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// من حالة النموذج إلى الحمولة الخام — لكل مصدر
// ═══════════════════════════════════════════════════════════════════════════
describe.each([
  ['المصاريف الشهرية', toMonthlyExpenseInsert, mapMonthlyExpense,
    { expenseName: 'إيجار', categoryId: 'c1', quantity: 1, unitCost: 105,
      totalMonthlyCost: 105, recurrence: 'one_time', loggedDate: '2020-03-01' }],
  ['المصاريف المتغيرة', toVariableExpenseInsert, mapVariableExpense,
    { expenseName: 'مواد', categoryId: 'c1', quantity: 1, unitCost: 105,
      totalVariableCost: 105, loggedDate: '2020-03-01' }],
  ['سطر رسوم التأسيس', toStartupCostEntryInsert, mapStartupCostEntry,
    { startupCostId: 'p1', description: 'مواد', amount: 105, spentDate: '2020-03-01' }],
  ['سطر المصاريف السنوية', toAnnualExpenseEntryInsert, mapAnnualExpenseEntry,
    { annualExpenseId: 'p1', description: 'رخصة', amount: 105, spentDate: '2020-03-01' }],
])('%s: نموذج ← حمولة خام', (_name, toInsert, mapRow, base) => {
  it('يصل مبلغ الضريبة والنسبة ووضع السعر إلى الأعمدة', () => {
    // Exactly what a modal does: form state → helper → payload → mapper.
    const form = { ...EMPTY_TAX_INVOICE_FIELDS, ...STORED, isTaxInvoice: true };
    const payload = { ...base, isTaxInvoice: true, ...submitTaxInvoiceFields(form) };
    const raw = toInsert(payload);

    expect(raw.vat_amount).toBe(5);
    expect(raw.vat_rate).toBe(0.05);
    expect(raw.price_mode).toBe('inclusive');
    expect(raw.vat_deductible).toBe(true);
    expect(raw.invoice_number).toBe('S-4417');

    // …and back out again, which is what the VAT report reads.
    expect(mapRow({ id: 'x', ...raw })).toMatchObject({
      vatAmount: 5, vatRate: 0.05, priceMode: 'inclusive',
    });
  });

  // ── فتح سجل موجود وحفظه بلا لمس حقول الضريبة ──────────────────────
  it('وفتح سجل موجود ثم حفظه بلا لمس حقول الضريبة لا يمحوها', () => {
    const existing = mapRow({ id: 'x', ...toInsert({ ...base, isTaxInvoice: true, ...STORED }) });

    // The modal opens on the stored record and the user edits something else.
    const form = { ...EMPTY_TAX_INVOICE_FIELDS, ...readTaxInvoiceFields(existing) };
    const resaved = toInsert({
      ...base, description: 'وصف معدَّل', expenseName: 'اسم معدَّل',
      isTaxInvoice: true, ...submitTaxInvoiceFields(form),
    });

    expect(resaved.vat_amount).toBe(5);
    expect(resaved.vat_rate).toBe(0.05);
    expect(resaved.price_mode).toBe('inclusive');
    expect(resaved.supplier).toBe('مؤسسة النور');
    expect(resaved.invoice_date).toBe('2020-03-01');
  });

  it('وسجل بلا حقول ضريبية يُحفظ null لا صفراً', () => {
    const form = { ...EMPTY_TAX_INVOICE_FIELDS, isTaxInvoice: true, invoiceNumber: 'X' };
    const raw = toInsert({ ...base, isTaxInvoice: true, ...submitTaxInvoiceFields(form) });
    expect(raw.vat_amount).toBeNull();
    expect(raw.vat_rate).toBeNull();
  });
});

describe('السند الدوري يرث معالجة قالبه', () => {
  it('من نموذج شهري ← قالب ← سند', () => {
    const form = {
      ...EMPTY_TAX_INVOICE_FIELDS, ...STORED,
      vatAmount: null,       // a template has no supplier invoice yet
      isTaxInvoice: true,
    };
    const raw = toMonthlyExpenseInsert({
      expenseName: 'إيجار', categoryId: 'c1', quantity: 1, unitCost: 5000,
      totalMonthlyCost: 5000, recurrence: 'monthly', paymentDay: 5,
      isTaxInvoice: true, ...submitTaxInvoiceFields(form),
    });
    const template = mapMonthlyExpense({ id: 't1', ...raw });
    expect(template).toMatchObject({ vatRate: 0.05, priceMode: 'inclusive' });

    const voucher = buildVoucher(template, '2026-08');
    // The rate and pricing mode travel with the amount, for the same reason:
    // a template re-rated next year must not restate a filed voucher.
    expect(voucher.vatRate).toBe(0.05);
    expect(voucher.priceMode).toBe('inclusive');
    expect(voucher.vatDeductible).toBe(true);
    // The supplier's own VAT figure arrives with the invoice, not before it.
    expect(voucher.vatAmount).toBeNull();
  });
});
