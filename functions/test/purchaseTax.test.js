/**
 * محرك ضريبة المشتريات — الحساب 1200 كما ترويه الفاتورة نفسها
 * ═══════════════════════════════════════════════════════════════════════════
 * الكود الذي حلّ محلّه هذا الملف كان سطرين:
 *
 *     const deductible = Boolean(vatRegistered && isTaxInvoice && vatDeductible);
 *     const { gross, net, vat } = splitVat(raw, { taxable: deductible });
 *
 * فيتجاهل `vat_amount` المكتوب على الفاتورة، و`vat_rate` المثبت عليها،
 * و`price_mode`، و`invoice_date` وسياسة ذلك التاريخ — ويقسّم كل شيء بـ15%.
 * فاتورة من عصر الـ5% كانت تُستردّ بـ15%، وفاتورة معفاة تُستردّ بضريبة لم
 * تُدفع، وتقرير الضريبة الذي يقرأ الحقول الصحيحة يخالف الدفاتر التي لا
 * تقرأها.
 *
 * الحالات أ–ح تجري عبر `postSource` الحقيقي على محاكي Firestore: السجل
 * يُكتب كما يكتبه العميل، والخادم يقرؤه ويبني القيد. لا استدعاء مباشر
 * للباني، لأن الثغرة كانت في الطريق بين الاثنين.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { postSource, seedChartOfAccounts, COL } from '../src/ledger.js';
import { ADAPTERS } from '../src/posting.js';
import {
  resolvePurchaseTax, PurchaseTaxError, PURCHASE_TAX_SOURCE, NO_INPUT_VAT,
  formatVatRate, inputVatLineDescription,
} from '../src/purchaseTax.js';
import { validateTaxInvoiceFields as serverValidate } from '../src/vatFields.js';
import { resolvePurchaseTax as clientResolve } from '../../src/lib/accounting/purchaseTax.js';
import { validateTaxInvoiceFields as clientValidate } from '../../src/lib/vatFields.js';
import { buildExpenseEntry } from '../../src/lib/accounting/postingRules.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1020', nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1500', nameArabic: 'أصول ثابتة', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '5100', nameArabic: 'مصروفات متغيرة', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '5200', nameArabic: 'مصروفات شهرية', accountType: 'expense', normalBalance: 'debit', active: true },
  { code: '5300', nameArabic: 'مصروفات إدارية', accountType: 'expense', normalBalance: 'debit', active: true },
];

const WIPE = [...Object.values(COL), 'monthly_expenses', 'variable_expenses',
  'annual_expense_entries', 'startup_cost_entries', 'expense_vouchers', 'app_settings'];

async function wipe() {
  for (const c of WIPE) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

/**
 * The dated policy record, written the way `setTaxPolicy` writes it.
 *
 * Every case states its own: the engine refuses to price an invoice whose
 * policy it cannot resolve rather than falling back on 15%, so a test that
 * wants a rate has to say which rate and from when.
 */
async function policy(rows) {
  await db.collection('app_settings').doc('accounting').set({
    value: {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: rows,
    },
  });
}
const KSA_HISTORY = [
  { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
  { effectiveFrom: '2020-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
];

// ── السجل المصدر، بالأسماء التي تُكتب بها فعلاً ──────────────────────────
// snake_case for the four client-written collections, camelCase for a voucher
// (which `buildVoucher` writes on the server). Reading them wrong is exactly
// how a field reached Firestore and never reached the ledger, so the fixtures
// use the real shapes rather than one convenient one.
const TAX_FIELDS = (o = {}) => ({
  is_tax_invoice: o.isTaxInvoice !== false,
  invoice_number: 'invoiceNumber' in o ? o.invoiceNumber : 'INV-100',
  invoice_date: 'invoiceDate' in o ? o.invoiceDate : '2026-03-10',
  supplier: 'supplier' in o ? o.supplier : 'مؤسسة النور',
  vat_amount: 'vatAmount' in o ? o.vatAmount : null,
  vat_rate: 'vatRate' in o ? o.vatRate : null,
  price_mode: o.priceMode || 'inclusive',
  vat_deductible: o.vatDeductible !== false,
  payment_method: o.paymentMethod || 'cash',
});

const SOURCES = {
  monthly: (amount, o = {}) => ['monthly_expenses', {
    expense_name: 'إيجار', category_id: null, quantity: 1, unit_cost: amount,
    total_monthly_cost: amount, recurrence: 'one_time',
    logged_date: o.recordDate || '2026-03-15', payment_status: 'paid',
    ...TAX_FIELDS(o),
  }],
  variable: (amount, o = {}) => ['variable_expenses', {
    expense_name: 'مواد', category_id: null, quantity: 1, unit_cost: amount,
    total_variable_cost: amount, logged_date: o.recordDate || '2026-03-15',
    ...TAX_FIELDS(o),
  }],
  annual: (amount, o = {}) => ['annual_expense_entries', {
    annual_expense_id: 'a1', description: 'رخصة', amount,
    spent_date: o.recordDate || '2026-03-15', notes: null,
    ...TAX_FIELDS(o),
  }],
  startup: (amount, o = {}) => ['startup_cost_entries', {
    startup_cost_id: 's1', description: 'معدات', amount,
    spent_date: o.recordDate || '2026-03-15', notes: null,
    ...TAX_FIELDS(o),
  }],
  voucher: (amount, o = {}) => ['expense_vouchers', {
    templateId: 't1', templateName: 'إيجار', periodKey: '2026-03',
    dueDate: o.recordDate || '2026-03-15', quantity: 1, unitCost: amount, amount,
    status: 'active', paymentStatus: 'paid',
    isTaxInvoice: o.isTaxInvoice !== false,
    invoiceNumber: 'invoiceNumber' in o ? o.invoiceNumber : 'INV-100',
    invoiceDate: 'invoiceDate' in o ? o.invoiceDate : '2026-03-10',
    supplier: 'supplier' in o ? o.supplier : 'مؤسسة النور',
    vatAmount: 'vatAmount' in o ? o.vatAmount : null,
    vatRate: 'vatRate' in o ? o.vatRate : null,
    priceMode: o.priceMode || 'inclusive',
    vatDeductible: o.vatDeductible !== false,
    paymentMethod: o.paymentMethod || 'cash',
  }],
};
const EXPENSE_ACCOUNT = {
  monthly: '5200', voucher: '5200', variable: '5100', annual: '5300', startup: '1500',
};
const KINDS = Object.keys(SOURCES);

let seq = 0;
/** Writes the source record and posts it through the REAL server path. */
async function post(kind, amount, o = {}) {
  seq += 1;
  const id = `${kind}-${seq}`;
  const [col, row] = SOURCES[kind](amount, o);
  await db.collection(col).doc(id).set(row);
  const res = await postSource(db, FieldValue, { kind, sourceId: id }, { userId: 'u1' });
  const snap = await db.collection(COL.ENTRIES).doc(res.entryId).get();
  const entry = snap.data();
  const on = (code, side) => Math.round(entry.lines
    .filter((l) => String(l.accountId) === code)
    .reduce((s, l) => s + (Number(l[side]) || 0), 0) * 100) / 100;
  return {
    entry,
    lines: entry.lines,
    snapshot: entry.purchaseTaxSnapshot,
    inputVat: on('1200', 'debit'),
    expense: on(EXPENSE_ACCOUNT[kind], 'debit'),
    settlement: on('1010', 'credit') + on('2000', 'credit') + on('1020', 'credit'),
    vatLine: entry.lines.find((l) => String(l.accountId) === '1200') || null,
  };
}

d('محرك ضريبة المشتريات عبر postSource الحقيقي', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-purchase-tax' }, 'purchase-tax-test');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    await wipe();
    await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
  }, 60_000);

  // ═══ (أ) المبلغ المكتوب على الفاتورة يسبق كل شيء ═════════════════════
  describe.each(KINDS)('(أ) مبلغ الضريبة المثبت — %s', (kind) => {
    it('يُرحَّل إلى 1200 بالهللة كما كتبه المورّد، لا كما تحسبه نسبة', async () => {
      await policy(KSA_HISTORY);
      // 115.00 شامل، والمورّد كتب 14.97 (تقريبه هو، لا تقريبنا).
      // النسبة كانت ستعطي 15.00 — والفرق 0.03 هو بالضبط ما لا يجوز اختراعه.
      const r = await post(kind, 115, { vatAmount: 14.97, vatRate: 0.15 });
      expect(r.inputVat).toBe(14.97);
      expect(r.expense).toBe(100.03);
      expect(r.settlement).toBe(115);
      expect(r.snapshot.source).toBe(PURCHASE_TAX_SOURCE.INVOICE_AMOUNT);
      expect(r.snapshot.vatAmount).toBe(14.97);
      // …ووصف السطر يقول من أين جاء الرقم.
      expect(r.vatLine.description).toBe('ضريبة مدخلات — مبلغ مثبت على الفاتورة');
    });
  });

  // ═══ (ب) النسبة المثبتة على الفاتورة ═════════════════════════════════
  describe.each(KINDS)('(ب) نسبة الفاتورة — %s', (kind) => {
    it('فاتورة 5% تبقى 5% مهما تحرّك المعدّل القياسي بعدها', async () => {
      await policy(KSA_HISTORY);   // اليوم 15%
      const r = await post(kind, 105, { vatRate: 0.05 });
      expect(r.inputVat).toBe(5);
      expect(r.expense).toBe(100);
      expect(r.snapshot.source).toBe(PURCHASE_TAX_SOURCE.INVOICE_RATE);
      expect(r.vatLine.description).toBe('ضريبة مدخلات 5% — نسبة مثبتة على الفاتورة');
    });
  });

  // ═══ (ج) سياسة تاريخ الفاتورة — لا تاريخ السجل ولا اليوم ═════════════
  describe.each(KINDS)('(ج) سياسة تاريخ الفاتورة — %s', (kind) => {
    it('فاتورة 2019 مدفوعة 2026 تُخصم بـ5% لا بـ15%', async () => {
      await policy(KSA_HISTORY);
      // الفاتورة من عصر الـ5%، والدفع اليوم. سياسة الفاتورة هي الحاكمة.
      const r = await post(kind, 105, { invoiceDate: '2019-05-01', recordDate: '2026-03-15' });
      expect(r.inputVat).toBe(5);
      expect(r.expense).toBe(100);
      expect(r.snapshot.source).toBe(PURCHASE_TAX_SOURCE.POLICY);
      expect(r.snapshot.vatRate).toBe(0.05);
      expect(r.snapshot.policyEffectiveFrom).toBe('2018-01-01');
      expect(r.vatLine.description).toBe('ضريبة مدخلات 5% — سياسة 2018-01-01');
    });

    it('والفاتورة بعد يوليو 2020 تُخصم بـ15%', async () => {
      await policy(KSA_HISTORY);
      const r = await post(kind, 115, { invoiceDate: '2026-03-10' });
      expect(r.inputVat).toBe(15);
      expect(r.expense).toBe(100);
      expect(r.snapshot.policyEffectiveFrom).toBe('2020-07-01');
    });
  });

  // ═══ (د) غير قابلة للخصم ═════════════════════════════════════════════
  describe.each(KINDS)('(د) ضريبة غير قابلة للخصم — %s', (kind) => {
    it('لا سطر 1200 إطلاقاً، وكامل الإجمالي على المصروف/الأصل', async () => {
      await policy(KSA_HISTORY);
      const r = await post(kind, 115, { vatDeductible: false, vatAmount: 15 });
      expect(r.lines.some((l) => String(l.accountId) === '1200')).toBe(false);
      expect(r.expense).toBe(115);
      expect(r.settlement).toBe(115);
      expect(r.snapshot.noInputVatReason).toBe(NO_INPUT_VAT.NOT_DEDUCTIBLE);
      // …ومع ذلك يبقى مسجَّلاً أن الفاتورة حملت 15 ضريبة، وأنها دُفنت في التكلفة.
      expect(r.snapshot.documentVat).toBe(15);
    });
  });

  // ═══ (هـ) هوية ناقصة ═════════════════════════════════════════════════
  describe.each([
    ['بلا رقم فاتورة', { invoiceNumber: '' }],
    ['بلا تاريخ فاتورة', { invoiceDate: '' }],
    ['بلا مورّد', { supplier: '' }],
  ])('(هـ) فاتورة %s', (_name, gap) => {
    it('لا تُنشئ أصل ضريبة مدخلات، والمبلغ كاملاً على المصروف', async () => {
      await policy(KSA_HISTORY);
      const r = await post('variable', 115, { ...gap, vatAmount: 15 });
      expect(r.lines.some((l) => String(l.accountId) === '1200')).toBe(false);
      expect(r.expense).toBe(115);
      expect(r.settlement).toBe(115);
      expect(r.snapshot.noInputVatReason).toBe(NO_INPUT_VAT.INCOMPLETE_INVOICE);
    });
  });

  // ═══ (و) سياسة مجهولة بلا مبلغ ولا نسبة → رفض، لا 15% ════════════════
  describe.each(KINDS)('(و) سياسة غير مهيأة — %s', (kind) => {
    it('يرفض الترحيل ولا يفترض 15%', async () => {
      // السجل التاريخي يبدأ 2026-01، والفاتورة قبله.
      await policy([{
        effectiveFrom: '2026-01-01', vatRegistered: true,
        washPriceMode: 'inclusive', vatRate: 0.15, baseline: true,
      }]);
      await expect(post(kind, 115, { invoiceDate: '2019-05-01', recordDate: '2026-03-15' }))
        .rejects.toThrow(/تعذّر تحديد ضريبة الفاتورة/);
      // ولا قيد، ولا قفل ترحيل — الرفض لا يترك أثراً يمنع إعادة المحاولة
      // بعد تصحيح البيانات.
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
      expect((await db.collection(COL.LOCKS).get()).size).toBe(0);
    });

    it('…ويقبلها إذا كتب المورّد المبلغ على الفاتورة', async () => {
      await policy([{
        effectiveFrom: '2019-01-01', vatRegistered: true,
        washPriceMode: 'inclusive', vatRate: 0.05, baseline: true,
      }]);
      const r = await post(kind, 105, { invoiceDate: '2019-05-01', vatAmount: 5 });
      expect(r.inputVat).toBe(5);
    });
  });

  // ═══ (ز) غير مسجّل ضريبياً بتاريخ الفاتورة ═══════════════════════════
  describe.each(KINDS)('(ز) غير مسجّل بتاريخ الفاتورة — %s', (kind) => {
    it('لا 1200 تلقائي، حتى لو كتب المورّد المبلغ', async () => {
      await policy([
        { effectiveFrom: '2018-01-01', vatRegistered: false, washPriceMode: 'inclusive', vatRate: 0, baseline: true },
        { effectiveFrom: '2026-06-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      ]);
      // الفاتورة في مارس — قبل التسجيل. الضريبة دُفعت للمورّد وهي تكلفة.
      const r = await post(kind, 115, { invoiceDate: '2026-03-10', vatAmount: 15 });
      expect(r.lines.some((l) => String(l.accountId) === '1200')).toBe(false);
      expect(r.expense).toBe(115);
      expect(r.snapshot.noInputVatReason).toBe(NO_INPUT_VAT.NOT_REGISTERED);
      expect(r.snapshot.documentVat).toBe(15);
    });
  });

  // ═══ (ح) الدفاتر والتقرير يرويان الرقم نفسه ══════════════════════════
  it('(ح) حركة 1200 المُرحّلة تطابق ضريبة المدخلات في التقرير بالهللة', async () => {
    await policy(KSA_HISTORY);
    const posted = [
      await post('monthly', 115, { vatAmount: 14.97 }),
      await post('variable', 105, { vatRate: 0.05 }),
      await post('annual', 230, {}),
      await post('startup', 1150, { invoiceDate: '2019-05-01' }),
      await post('voucher', 500, { vatDeductible: false }),
      await post('variable', 300, { invoiceNumber: '' }),   // هوية ناقصة
    ];
    const ledger1200 = Math.round(posted.reduce((s, r) => s + r.inputVat, 0) * 100) / 100;

    // نفس السجلات كما يقرؤها التقرير: مبلغ الفاتورة وحقولها.
    const { buildVatReport } = await import('../../src/lib/accounting/vatReturn.js');
    const { taxPolicyAt } = await import('../../src/lib/accounting/taxPolicy.js');
    const settings = { taxPolicyHistory: KSA_HISTORY };
    const rows = [
      { id: 'r1', isTaxInvoice: true, amount: 115, invoiceNumber: 'INV-100', invoiceDate: '2026-03-10', supplier: 'م', vatAmount: 14.97, vatRate: null, priceMode: 'inclusive', vatDeductible: true },
      { id: 'r2', isTaxInvoice: true, amount: 105, invoiceNumber: 'INV-100', invoiceDate: '2026-03-10', supplier: 'م', vatAmount: null, vatRate: 0.05, priceMode: 'inclusive', vatDeductible: true },
      { id: 'r3', isTaxInvoice: true, amount: 230, invoiceNumber: 'INV-100', invoiceDate: '2026-03-10', supplier: 'م', vatAmount: null, vatRate: null, priceMode: 'inclusive', vatDeductible: true },
      { id: 'r4', isTaxInvoice: true, amount: 1150, invoiceNumber: 'INV-100', invoiceDate: '2019-05-01', supplier: 'م', vatAmount: null, vatRate: null, priceMode: 'inclusive', vatDeductible: true },
      { id: 'r5', isTaxInvoice: true, amount: 500, invoiceNumber: 'INV-100', invoiceDate: '2026-03-10', supplier: 'م', vatAmount: null, vatRate: null, priceMode: 'inclusive', vatDeductible: false },
      { id: 'r6', isTaxInvoice: true, amount: 300, invoiceNumber: '', invoiceDate: '2026-03-10', supplier: 'م', vatAmount: null, vatRate: null, priceMode: 'inclusive', vatDeductible: true },
    ];
    const report = buildVatReport({
      inputs: rows, period: '', policyAt: (date) => taxPolicyAt(date, settings),
    });
    expect(report.input.tax).toBe(ledger1200);
    // …وهو رقم غير صفري، حتى لا تمرّ المطابقة بصفرين.
    expect(ledger1200).toBeGreaterThan(0);
  });

  // ═══ وضع «غير شامل الضريبة» ══════════════════════════════════════════
  describe.each(KINDS)('exclusive — %s', (kind) => {
    it('amount=100 غير شامل وvatAmount=15 → مصروف 100، و1200=15، وتسوية 115', async () => {
      await policy(KSA_HISTORY);
      const r = await post(kind, 100, { priceMode: 'exclusive', vatAmount: 15 });
      expect(r.expense).toBe(100);
      expect(r.inputVat).toBe(15);
      expect(r.settlement).toBe(115);
      expect(r.snapshot).toMatchObject({ net: 100, vat: 15, gross: 115, priceMode: 'exclusive' });
    });
  });

  it('exclusive بلا مبلغ مذكور: الضريبة من السياسة والإجمالي = المبلغ + الضريبة', async () => {
    await policy(KSA_HISTORY);
    const r = await post('variable', 100, { priceMode: 'exclusive' });
    expect(r.expense).toBe(100);
    expect(r.inputVat).toBe(15);
    expect(r.settlement).toBe(115);
  });

  it('exclusive وغير قابلة للخصم: كامل 115 على المصروف والسداد', async () => {
    await policy(KSA_HISTORY);
    const r = await post('variable', 100, { priceMode: 'exclusive', vatDeductible: false });
    expect(r.expense).toBe(115);
    expect(r.settlement).toBe(115);
    expect(r.lines.some((l) => String(l.accountId) === '1200')).toBe(false);
  });

  // ═══ صفر صريح مقابل «غير مذكور» ══════════════════════════════════════
  it('صفر صريح توريد صفري — لا سطر 1200 ولا افتراض نسبة', async () => {
    await policy(KSA_HISTORY);
    const r = await post('variable', 115, { vatAmount: 0 });
    expect(r.lines.some((l) => String(l.accountId) === '1200')).toBe(false);
    expect(r.expense).toBe(115);
    expect(r.snapshot.noInputVatReason).toBe(NO_INPUT_VAT.ZERO_RATED);
    expect(r.snapshot.vatAmount).toBe(0);
  });

  it('null ليست صفراً — تسقط إلى النسبة ثم إلى السياسة', async () => {
    await policy(KSA_HISTORY);
    const r = await post('variable', 115, { vatAmount: null });
    expect(r.inputVat).toBe(15);
    expect(r.snapshot.source).toBe(PURCHASE_TAX_SOURCE.POLICY);
  });

  // ═══ الرفض على الخادم، لا في الواجهة وحدها ═══════════════════════════
  it('ضريبة أكبر من إجمالي فاتورة شاملة تُرفض على الخادم', async () => {
    await policy(KSA_HISTORY);
    await expect(post('variable', 115, { vatAmount: 200 }))
      .rejects.toThrow(/أكبر من إجمالي الفاتورة/);
    expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
  });

  it('مبلغ ضريبة سالب مخزَّن مباشرة في Firestore يُرفض عند الترحيل', async () => {
    await policy(KSA_HISTORY);
    // الواجهة لن تحفظه — لكن الواجهة ليست حدّ أمان. الكتابة المباشرة تصل.
    await expect(post('variable', 115, { vatAmount: -5 }))
      .rejects.toThrow(/سالب/);
  });

  it('تاريخ فاتورة غير موجود في التقويم يُرفض', async () => {
    await policy(KSA_HISTORY);
    await expect(post('variable', 115, { invoiceDate: '2026-02-30' }))
      .rejects.toThrow(/التقويم/);
  });

  // ═══ اللقطة تُحفظ على القيد ══════════════════════════════════════════
  it('purchaseTaxSnapshot يُثبَّت على القيد بكل ما يفسّر الرقم', async () => {
    await policy(KSA_HISTORY);
    const r = await post('variable', 105, { vatRate: 0.05, invoiceDate: '2019-05-01' });
    expect(r.snapshot).toMatchObject({
      isTaxInvoice: true, vatDeductible: true,
      invoiceDate: '2019-05-01', invoiceNumber: 'INV-100', supplier: 'مؤسسة النور',
      priceMode: 'inclusive', vatRate: 0.05, vatAmount: null,
      net: 100, vat: 5, gross: 105,
      source: PURCHASE_TAX_SOURCE.INVOICE_RATE,
      deductible: true, policyDate: '2019-05-01', policyEffectiveFrom: '2018-01-01',
    });
  });

  // ═══ السند يُؤرَّخ بـ dueDate، لا بحقل غير موجود ═════════════════════
  it('السند المتكرر يُقرأ تاريخه من dueDate فيُحلّ سياسته', async () => {
    await policy(KSA_HISTORY);
    const r = await post('voucher', 115, { recordDate: '2026-03-20' });
    expect(r.entry.entryDate).toBe('2026-03-20');
    expect(ADAPTERS.voucher.dateOf({ dueDate: '2026-03-20' })).toBe('2026-03-20');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// نسختا المحرك — العميل والخادم — على بطارية واحدة
// ═══════════════════════════════════════════════════════════════════════════
// The client copy previews what an entry will look like; the server copy
// decides what it is. A preview that promises a reclaim the ledger will not
// book is worse than no preview, so the two are driven over the same battery
// and compared field by field.
describe('انحراف العميل عن الخادم', () => {
  const POLICY_AT = (date) => {
    if (!date || date < '2018-01-01') return { known: false, baselineFrom: '2018-01-01' };
    return date < '2020-07-01'
      ? { known: true, vatRegistered: true, vatRate: 0.05, washPriceMode: 'inclusive', effectiveFrom: '2018-01-01' }
      : { known: true, vatRegistered: true, vatRate: 0.15, washPriceMode: 'inclusive', effectiveFrom: '2020-07-01' };
  };
  const BASE = {
    amount: 115, priceMode: 'inclusive', isTaxInvoice: true, vatDeductible: true,
    invoiceNumber: 'INV-1', invoiceDate: '2026-03-10', supplier: 'مورّد',
    vatAmount: null, vatRate: null, recordDate: '2026-03-15',
  };
  const CASES = [
    ['مبلغ مثبت', { vatAmount: 14.97 }],
    ['نسبة مثبتة', { vatRate: 0.05 }],
    ['سياسة اليوم', {}],
    ['سياسة تاريخ قديم', { invoiceDate: '2019-05-01' }],
    ['غير قابلة للخصم', { vatDeductible: false }],
    ['ليست فاتورة ضريبية', { isTaxInvoice: false }],
    ['هوية ناقصة', { invoiceNumber: '' }],
    ['غير شامل', { amount: 100, priceMode: 'exclusive' }],
    ['غير شامل وغير قابلة للخصم', { amount: 100, priceMode: 'exclusive', vatDeductible: false }],
    ['صفر صريح', { vatAmount: 0 }],
    ['نسبة صفر صريحة', { vatRate: 0 }],
    ['مبلغ صفر', { amount: 0 }],
  ];

  it.each(CASES)('تعطيان النتيجة نفسها — %s', (_name, over) => {
    const input = { ...BASE, ...over };
    const server = resolvePurchaseTax(input, { policyAt: POLICY_AT });
    const client = clientResolve(input, { policyAt: POLICY_AT });
    expect(client).toEqual(server);
  });

  const REFUSALS = [
    ['مبلغ سالب', { vatAmount: -1 }],
    ['نسبة ≥ 100%', { vatRate: 1 }],
    ['ضريبة أكبر من الإجمالي', { vatAmount: 200 }],
    ['تاريخ غير تقويمي', { invoiceDate: '2026-02-30' }],
    ['سياسة مجهولة', { invoiceDate: '2017-01-01' }],
    ['مبلغ غير رقمي', { amount: 'كثير' }],
  ];
  it.each(REFUSALS)('وترفضان الشيء نفسه بالرسالة نفسها — %s', (_name, over) => {
    const input = { ...BASE, ...over };
    let serverMsg = null, clientMsg = null;
    try { resolvePurchaseTax(input, { policyAt: POLICY_AT }); } catch (e) { serverMsg = e.message; }
    try { clientResolve(input, { policyAt: POLICY_AT }); } catch (e) { clientMsg = e.message; }
    expect(serverMsg).not.toBeNull();
    expect(clientMsg).toBe(serverMsg);
  });

  it('ومعاينة العميل تنتج سطور الخادم نفسها', () => {
    const preview = buildExpenseEntry({
      id: 'x', description: 'مواد', date: '2026-03-15', amount: 105,
      isTaxInvoice: true, invoiceNumber: 'INV-1', invoiceDate: '2019-05-01',
      supplier: 'مورّد', vatRate: null, vatAmount: null, priceMode: 'inclusive',
      paymentMethod: 'cash', paymentStatus: 'paid',
    }, { expenseAccount: '5100', policyAt: POLICY_AT });
    const vat = preview.lines.find((l) => l.accountId === '1200');
    // 5% لأن الفاتورة من 2019 — لا 15% لأن اليوم كذلك.
    expect(vat.debit).toBe(5);
    expect(vat.description).toBe('ضريبة مدخلات 5% — سياسة 2018-01-01');
    expect(preview.purchaseTaxSnapshot.source).toBe(PURCHASE_TAX_SOURCE.INVOICE_RATE === 'x' ? '' : 'policy');
  });

  it('ونسختا التحقق من الحقول تتفقان', () => {
    const forms = [
      { vatAmount: -5 }, { vatAmount: 'abc' }, { vatRate: 1.5 }, { vatRate: -0.1 },
      { vatAmount: 200 }, { vatAmount: 0 }, { vatAmount: null }, { vatRate: 0 },
      { invoiceDate: '2026-02-30' }, { invoiceDate: '2026-02-28' },
      { isTaxInvoice: true, invoiceNumber: '', invoiceDate: '', supplier: '' },
      { priceMode: 'exclusive', vatAmount: 150 },
      { priceMode: 'exclusive', vatAmount: 15, vatRate: 0.15 },
      { vatAmount: 15, vatRate: 0.05 },
    ];
    for (const f of forms) {
      expect(clientValidate(f, { amount: 115 })).toEqual(serverValidate(f, { amount: 115 }));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// قواعد المحرك، وحدةً
// ═══════════════════════════════════════════════════════════════════════════
describe('resolvePurchaseTax — القواعد بذاتها', () => {
  const AT_15 = () => ({ known: true, vatRegistered: true, vatRate: 0.15, effectiveFrom: '2020-07-01' });
  const UNKNOWN = () => ({ known: false, baselineFrom: '2026-01-01' });
  const base = {
    amount: 115, priceMode: 'inclusive', isTaxInvoice: true, vatDeductible: true,
    invoiceNumber: 'A', invoiceDate: '2026-03-01', supplier: 'م',
  };

  it('الأولوية: المبلغ ثم النسبة ثم السياسة', () => {
    // 115 شامل عند 5% = 5.48. المبلغ والنسبة متسقان، والسياسة تقول 15%
    // (أي 15.00) — فالفرق بين 5.48 و15.00 هو ما يثبت أيّهما حكم.
    const stated = resolvePurchaseTax({ ...base, vatAmount: 5.48, vatRate: 0.05 }, { policyAt: AT_15 });
    expect(stated.source).toBe(PURCHASE_TAX_SOURCE.INVOICE_AMOUNT);
    expect(stated.vat).toBe(5.48);

    const rated = resolvePurchaseTax({ ...base, vatRate: 0.05 }, { policyAt: AT_15 });
    expect(rated.source).toBe(PURCHASE_TAX_SOURCE.INVOICE_RATE);
    expect(rated.vat).toBe(5.48);

    const policied = resolvePurchaseTax(base, { policyAt: AT_15 });
    expect(policied.source).toBe(PURCHASE_TAX_SOURCE.POLICY);
    expect(policied.vat).toBe(15);
  });

  it('ومبلغ يناقض النسبة المكتوبة معه يُرفض بدل أن يُحسم بصمت', () => {
    // The amount wins by priority, so a contradiction would silently discard
    // the rate the user chose. It is a data error, and it is said out loud.
    expect(() => resolvePurchaseTax({ ...base, vatAmount: 10, vatRate: 0.05 }, { policyAt: AT_15 }))
      .toThrow(/لا يوافق النسبة/);
    // …وتقريب المورّد بالهللة يمرّ.
    expect(resolvePurchaseTax({ ...base, vatAmount: 5.47, vatRate: 0.05 }, { policyAt: AT_15 }).vat)
      .toBe(5.47);
  });

  it('net + vat = gross دائماً، والفرق يقع على الصافي لا على الضريبة', () => {
    for (const amount of [0.01, 7.77, 115, 333.33, 99999.99]) {
      for (const mode of ['inclusive', 'exclusive']) {
        const r = resolvePurchaseTax({ ...base, amount, priceMode: mode }, { policyAt: AT_15 });
        expect(Math.round((r.net + r.vat) * 100) / 100).toBe(r.gross);
      }
    }
  });

  it('سياسة مجهولة + غير قابلة للخصم + شامل: لا رفض، لأن لا رقم يتوقف عليها', () => {
    const r = resolvePurchaseTax({ ...base, vatDeductible: false }, { policyAt: UNKNOWN });
    expect(r.vat).toBe(0);
    expect(r.gross).toBe(115);
    expect(r.net).toBe(115);
  });

  it('…لكن سياسة مجهولة + غير شامل ترفض، لأن الإجمالي نفسه غير معروف', () => {
    expect(() => resolvePurchaseTax(
      { ...base, amount: 100, priceMode: 'exclusive', vatDeductible: false },
      { policyAt: UNKNOWN },
    )).toThrow(PurchaseTaxError);
  });

  it('ليست فاتورة ضريبية: المبلغ كله تكلفة ولا يُستشار وضع السعر', () => {
    for (const mode of ['inclusive', 'exclusive']) {
      const r = resolvePurchaseTax({ ...base, isTaxInvoice: false, priceMode: mode }, { policyAt: AT_15 });
      expect(r).toMatchObject({ gross: 115, net: 115, vat: 0 });
      expect(r.noInputVatReason).toBe(NO_INPUT_VAT.NOT_TAX_INVOICE);
    }
  });

  it('التسجيل مجهول مع ضريبة موجبة: رفض، لا خصم ولا إهدار صامت', () => {
    expect(() => resolvePurchaseTax({ ...base, vatAmount: 15 }, { policyAt: UNKNOWN }))
      .toThrow(/التسجيل الضريبي/);
  });

  it('وصف سطر 1200 يتغيّر بتغيّر المصدر', () => {
    expect(formatVatRate(0.15)).toBe('15%');
    expect(formatVatRate(0.05)).toBe('5%');
    expect(formatVatRate(0.075)).toBe('7.5%');
    expect(inputVatLineDescription({ source: 'invoice-amount' }))
      .toBe('ضريبة مدخلات — مبلغ مثبت على الفاتورة');
    expect(inputVatLineDescription({ source: 'invoice-rate', rate: 0.05 }))
      .toBe('ضريبة مدخلات 5% — نسبة مثبتة على الفاتورة');
    expect(inputVatLineDescription({ source: 'policy', rate: 0.15, policyEffectiveFrom: '2020-07-01' }))
      .toBe('ضريبة مدخلات 15% — سياسة 2020-07-01');
  });
});
