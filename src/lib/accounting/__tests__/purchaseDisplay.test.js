/**
 * تعريف `amount` — رقم واحد لا يعني شيئين
 * ═══════════════════════════════════════════════════════════════════════════
 * `total_monthly_cost`, `total_variable_cost` and `amount` are names that say
 * nothing about whether the figure contains the tax, and every screen used to
 * decide for itself. The expense lists rendered `extractVat(total)` — the
 * amount as a GROSS, at 15% — while a record saved `price_mode: 'exclusive'`
 * means the amount is the NET and the tax sits on top of it. One number, two
 * meanings, and the gap between them is the whole tax.
 *
 * The definition, and the only one (docs/AMOUNT_DEFINITION.md):
 *
 *     inclusive →  gross = amount        net = gross − VAT
 *     exclusive →  net   = amount        gross = amount + VAT
 *
 * These tests hold the DISPLAY to it, against the same engine the ledger
 * posts with — so a list, a modal, a CSV column and a journal entry cannot
 * disagree about what a purchase cost.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { purchaseAmounts, purchaseTotals, amountRoleOf, AMOUNT_ROLE } from '../purchaseDisplay';

const AT_15 = () => ({
  known: true, vatRegistered: true, washPriceMode: 'inclusive',
  vatRate: 0.15, effectiveFrom: '2020-07-01',
});
const UNKNOWN = () => ({ known: false, baselineFrom: '2026-01-01' });

/** A complete tax invoice — the identity the deduction rests on. */
const ROW = (over = {}) => ({
  amount: 115, isTaxInvoice: true, vatDeductible: true,
  invoiceNumber: 'INV-1', invoiceDate: '2026-03-10', supplier: 'مورّد',
  vatAmount: null, vatRate: null, priceMode: 'inclusive', ...over,
});

describe('تعريف المبلغ بين شامل وغير شامل', () => {
  it('شامل: المبلغ هو الإجمالي، والصافي = الإجمالي − الضريبة', () => {
    const a = purchaseAmounts(ROW(), { policyAt: AT_15 });
    expect(a).toMatchObject({ known: true, gross: 115, net: 100, vat: 15 });
    expect(amountRoleOf(ROW())).toBe(AMOUNT_ROLE.inclusive);
  });

  it('غير شامل: المبلغ هو الصافي، والإجمالي = المبلغ + الضريبة', () => {
    const a = purchaseAmounts(ROW({ amount: 100, priceMode: 'exclusive' }), { policyAt: AT_15 });
    expect(a).toMatchObject({ known: true, net: 100, vat: 15, gross: 115 });
    expect(amountRoleOf({ priceMode: 'exclusive' })).toBe(AMOUNT_ROLE.exclusive);
  });

  it('وسجل بلا price_mode يُقرأ شاملاً — كما كان يُقرأ دائماً', () => {
    const a = purchaseAmounts(ROW({ priceMode: undefined }), { policyAt: AT_15 });
    expect(a.gross).toBe(115);
    expect(a.net).toBe(100);
  });

  it('والصافي + الضريبة = الإجمالي في كل الحالات', () => {
    for (const amount of [0.01, 7.77, 115, 333.33, 99999.99]) {
      for (const priceMode of ['inclusive', 'exclusive']) {
        const a = purchaseAmounts(ROW({ amount, priceMode }), { policyAt: AT_15 });
        expect(Math.round((a.net + a.vat) * 100) / 100).toBe(a.gross);
      }
    }
  });
});

describe('العرض يقرأ الفاتورة، لا نسبة افتراضية', () => {
  it('فاتورة 5% تُعرض بـ5% حتى وسياسة اليوم 15%', () => {
    const a = purchaseAmounts(ROW({ amount: 105, vatRate: 0.05 }), { policyAt: AT_15 });
    expect(a.documentVat).toBe(5);
    expect(a.net).toBe(100);
  });

  it('والمبلغ المكتوب على الفاتورة يسبق كل شيء', () => {
    const a = purchaseAmounts(ROW({ vatAmount: 14.97 }), { policyAt: AT_15 });
    expect(a.documentVat).toBe(14.97);
    expect(a.net).toBe(100.03);
  });

  it('وضريبة غير قابلة للخصم تُعرض ولا تُخصم', () => {
    const a = purchaseAmounts(ROW({ vatDeductible: false }), { policyAt: AT_15 });
    // The document bore 15 — it was paid, and it is buried in the cost.
    expect(a.documentVat).toBe(15);
    // …but nothing is reclaimable, so the expense takes the whole gross.
    expect(a.vat).toBe(0);
    expect(a.net).toBe(115);
    expect(a.deductible).toBe(false);
  });

  it('وفاتورة ناقصة الهوية تُعرض بلا خصم', () => {
    const a = purchaseAmounts(ROW({ invoiceNumber: '' }), { policyAt: AT_15 });
    expect(a.vat).toBe(0);
    expect(a.net).toBe(115);
    expect(a.noInputVatReason).toBe('incomplete-invoice');
  });
});

describe('ما لا يمكن تحديده يُقال، ولا يُخترع', () => {
  it('سياسة غير مهيأة بلا مبلغ ولا نسبة: known=false ولا أرقام', () => {
    const a = purchaseAmounts(ROW(), { policyAt: UNKNOWN });
    expect(a.known).toBe(false);
    expect(a.gross).toBeNull();
    expect(a.net).toBeNull();
    // …والسبب يُنقل كما قاله المحرك، فتشرح الواجهة بدل أن تُفرغ الخانة.
    expect(a.reason).toMatch(/تعذّر تحديد ضريبة الفاتورة/);
  });

  // ── ومبلغ مكتوب لا يكفي وحده حين يكون التسجيل نفسه مجهولاً ──
  // The amount answers "how much tax was on the paper". It does not answer
  // "were we registered that month", and only a registered business may
  // reclaim. With the policy record not reaching that date, both answers are
  // unavailable — so the split is refused rather than guessed in one
  // direction or the other.
  it('ومبلغ مكتوب لا يرفع الجهل بالتسجيل — يبقى غير محدَّد', () => {
    const a = purchaseAmounts(ROW({ vatAmount: 5 }), { policyAt: UNKNOWN });
    expect(a.known).toBe(false);
    expect(a.reason).toMatch(/التسجيل الضريبي/);
  });

  it('…ويُحلّ بمجرد أن تغطّي السياسة تاريخ الفاتورة', () => {
    const a = purchaseAmounts(ROW({ amount: 105, vatAmount: 5 }), { policyAt: AT_15 });
    expect(a.known).toBe(true);
    expect(a.vat).toBe(5);
    expect(a.net).toBe(100);
  });

  it('وضريبة صفرية تمرّ رغم جهل التسجيل — لا رقم يتوقف عليه', () => {
    const a = purchaseAmounts(ROW({ vatAmount: 0 }), { policyAt: UNKNOWN });
    expect(a.known).toBe(true);
    expect(a).toMatchObject({ vat: 0, net: 115, gross: 115 });
  });
});

describe('المجاميع التشغيلية تجمع ما خرج فعلاً', () => {
  it('تجمع الإجمالي لا المبلغ الخام — وإلا نقصت بمقدار ضريبة الصفوف غير الشاملة', () => {
    const rows = [
      ROW({ amount: 115 }),                              // شامل → 115
      ROW({ amount: 100, priceMode: 'exclusive' }),      // غير شامل → 115
    ];
    const t = purchaseTotals(rows, { policyAt: AT_15 });
    expect(t.gross).toBe(230);
    expect(t.net).toBe(200);
    expect(t.vat).toBe(30);
    // جمع `amount` الخام كان سيعطي 215 — أي أقل بـ15 من النقد الذي خرج.
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(215);
  });

  it('والصفوف غير المحدَّدة تُعدّ ولا تُبتلع', () => {
    const t = purchaseTotals([
      ROW({ amount: 115 }),
      ROW({ amount: 200, invoiceDate: '2017-01-01' }),
    ], { policyAt: (d) => (d < '2020-01-01' ? UNKNOWN() : AT_15()) });
    expect(t.gross).toBe(115);
    expect(t.undetermined).toBe(1);
    expect(t.undeterminedAmount).toBe(200);
  });
});
