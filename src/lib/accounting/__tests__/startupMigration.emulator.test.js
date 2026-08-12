/**
 * رسوم التأسيس: مبلغ على البند → قيد له مستند
 * ═══════════════════════════════════════════════════════════════════════════
 * `startup_costs` carried an `actual_amount` and a tax-invoice flag, and
 * `useTaxInvoices` fed both into the VAT report. Nothing could ever post them:
 * `ADAPTERS.startup` reads `startup_cost_entries`, and there is deliberately
 * no adapter for the parent — it has no spend date, no payment method and no
 * per-document identity, which is three of the things a journal entry cannot
 * be built without. So the row was deducted in the return and could never
 * appear on `1200`, and `inputMismatch` for that item was permanent.
 *
 * Worse, the date it was reported under was `created_at` — the day the row was
 * TYPED. A quarter chosen by when someone opened a form is not the quarter the
 * invoice belongs to.
 *
 * These prove the whole path on a real Firestore: the parent is not claimable,
 * the conversion asks for what the record does not contain, it happens once,
 * and the resulting entry is an ordinary postable expense.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, deleteDoc, terminate,
} from 'firebase/firestore';

import { useServerTransport } from './_serverTransport';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let restoreTransport;
let db, ledger, migration, ops, vat, taxPolicy;

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1500', nameArabic: 'أصول ثابتة', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
  { code: '4000', nameArabic: 'إيرادات', accountType: 'revenue', normalBalance: 'credit', active: true },
];

/** 15% from July 2020, 5% before — the real KSA history. */
const HISTORY = [
  { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
  { effectiveFrom: '2020-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
];

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters', 'posting_locks',
    'startup_costs', 'startup_cost_entries', 'app_settings']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

/** A legacy parent: an amount and an invoice typed straight onto the item. */
const LEGACY = (over = {}) => ({
  category: 'equipment', item_name: 'ماكينة ضغط', quantity: 1,
  budgeted_amount: 1000, actual_amount: 1150, status: 'completed',
  is_tax_invoice: true, invoice_url: '', invoice_number: 'S-77',
  invoice_date: '2026-03-10', supplier: 'مؤسسة النور',
  vat_amount: 150, vat_rate: null, price_mode: 'inclusive', vat_deductible: true,
  // The only date the record has ever held — and the one that must never be
  // used as a spend date or an invoice date.
  created_at: '2026-08-20T09:00:00.000Z',
  ...over,
});

const FORM = (over = {}) => ({
  spentDate: '2026-03-12', paymentMethod: 'cash', description: 'ماكينة ضغط',
  isTaxInvoice: true, invoiceNumber: 'S-77', invoiceDate: '2026-03-10',
  supplier: 'مؤسسة النور', vatAmount: 150, vatRate: null,
  priceMode: 'inclusive', vatDeductible: true, invoiceUrl: '',
  ...over,
});

const entriesOf = async (parentId) => (await getDocs(collection(db, 'startup_cost_entries')))
  .docs.map((x) => ({ id: x.id, ...x.data() }))
  .filter((r) => r.startup_cost_id === parentId);

d('تحويل مبلغ بند التأسيس إلى قيد', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    restoreTransport = useServerTransport();
    ledger = await import('../firestoreLedger');
    migration = await import('../firestoreStartupMigration');
    ops = await import('../postOperations');
    vat = await import('../vatReturn');
    taxPolicy = await import('../taxPolicy');
  }, 90_000);

  afterAll(async () => {
    restoreTransport?.();
    if (db) await terminate(db);
  });

  beforeEach(async () => {
    await wipe();
    await ledger.seedChartOfAccounts(CHART, { userId: 'u1' });
    await setDoc(doc(db, 'app_settings', 'accounting'), {
      value: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: HISTORY },
    });
  }, 90_000);

  /** The report over the rows `useTaxInvoices` would build for this parent. */
  async function report(rows, period = '2026-Q1') {
    const entries = (await ledger.fetchEntries()).map((e) => ({ ...e }));
    const lines = entries.flatMap((e) => (e.lines || []).map((l, i) => ({ ...l, id: `${e.id}-${i}`, entryId: e.id })));
    return vat.buildVatReport({
      inputs: rows, entries, lines, period, filing: 'quarterly',
      policyAt: (date) => taxPolicy.taxPolicyAt(date, { taxPolicyHistory: HISTORY }),
    });
  }

  /** Exactly what `useTaxInvoices` emits for an unconverted parent. */
  const parentRow = (id, over = {}) => ({
    id, description: 'ماكينة ضغط', amount: 1150, isTaxInvoice: true,
    // Empty on purpose: the parent has no spend date, and `created_at` is not
    // one. See the `useTaxInvoices` startup branch.
    spentDate: '',
    invoiceNumber: 'S-77', invoiceDate: '2026-03-10', supplier: 'مؤسسة النور',
    vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
    source: 'startup', sourceKind: 'startup-parent', requiresConversion: true,
    parentId: id, ...over,
  });

  // ═══ ١ ═══════════════════════════════════════════════════════════════
  it('١ — بند بمبلغ وفاتورة بلا قيد: لا يدخل eligible ولا input.tax، ويظهر أنه يحتاج تحويلاً', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());

    const r = await report([parentRow('p1')]);
    expect(r.eligible).toHaveLength(0);
    expect(r.input.tax).toBe(0);
    expect(r.needsConversionCount).toBe(1);
    expect(r.needsConversionAmount).toBe(1150);
    // …ويقول كم ينتظر، دون أن يضيفه إلى المُطالَب به.
    expect(r.needsConversionTax).toBe(150);
    expect(r.needsConversion[0].reason).toMatch(/يحتاج تحويلاً/);
    // ولا شيء في الدفاتر بعد، فلا فارق مفتوح على شيء لا يُطالَب به.
    expect(r.ledgerInput.tax).toBe(0);
    expect(r.inputMismatch).toBe(0);
  }, 90_000);

  // ═══ ٢ ═══════════════════════════════════════════════════════════════
  it('٢ — بعد التحويل يُنشأ قيد فرعي واحد وتُرحَّل ضريبته إلى 1200', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());

    const res = await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });
    expect(res.created).toBe(true);
    const rows = await entriesOf('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: 1150, spent_date: '2026-03-12', invoice_date: '2026-03-10',
      invoice_number: 'S-77', supplier: 'مؤسسة النور', vat_amount: 150,
      is_tax_invoice: true, payment_method: 'cash',
    });

    // …ويُرحَّل كأي مصروف: المحرك على الخادم يبني قيده.
    const posted = await ops.postUnposted({ userId: 'u1' });
    expect(posted.failed).toEqual([]);
    const entries = await ledger.fetchEntries();
    const accrual = entries.find((e) => e.sourceId === rows[0].id && !e.settlementOf);
    const accrualLines = await ledger.fetchLinesOf(accrual.id);
    expect(accrual.entryDate).toBe('2026-03-10');          // تاريخ الفاتورة
    expect(accrualLines.find((l) => l.accountId === '1200').debit).toBe(150);
    expect(accrualLines.find((l) => l.accountId === '1500').debit).toBe(1000);

    // …والتقرير والدفاتر يقولان الرقم نفسه الآن، وهو ما كان مستحيلاً قبله.
    const entryRow = {
      id: rows[0].id, description: 'ماكينة ضغط', amount: 1150, isTaxInvoice: true,
      invoiceNumber: 'S-77', invoiceDate: '2026-03-10', supplier: 'مؤسسة النور',
      vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
      spentDate: '2026-03-12', source: 'startup', sourceKind: 'startup', parentId: 'p1',
    };
    const r = await report([entryRow]);
    expect(r.input.tax).toBe(150);
    expect(r.ledgerInput.tax).toBe(150);
    expect(r.inputMismatch).toBe(0);
    expect(r.needsConversionCount).toBe(0);
  }, 180_000);

  // ═══ ٣ ═══════════════════════════════════════════════════════════════
  it('٣ — إعادة التحويل لا تكرّر القيد', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());
    const first = await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });
    const second = await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });
    const third = await migration.convertStartupParentSpend('p1', FORM({ spentDate: '2026-04-01' }), { userId: 'u1' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(first.id).toBe(second.id);
    // The id is DERIVED from the parent, so a second write is the same
    // document — there is no flag to trust and no counter to race.
    expect(first.id).toBe('legacy__p1');
    expect(await entriesOf('p1')).toHaveLength(1);
  }, 120_000);

  // ═══ ٤ ═══════════════════════════════════════════════════════════════
  it('٤ — البند والقيد لا يُحتسبان مرتين', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());
    await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });

    // The parent's own tax claim is CLEARED by the conversion, so even a
    // reader that has not noticed the entry cannot claim the same VAT again.
    const parent = (await getDoc(doc(db, 'startup_costs', 'p1'))).data();
    expect(parent.is_tax_invoice).toBe(false);
    expect(parent.invoice_number).toBeNull();
    expect(parent.vat_amount).toBeNull();
    expect(parent.actual_amount).toBe(1150);          // roll-up of one entry

    // And the belt: even if BOTH rows reached the report, only the entry is
    // claimable — the parent row is held for conversion, never deducted.
    const rows = (await entriesOf('p1')).map((e) => ({
      id: e.id, description: 'ماكينة ضغط', amount: 1150, isTaxInvoice: true,
      invoiceNumber: 'S-77', invoiceDate: '2026-03-10', supplier: 'مؤسسة النور',
      vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
      spentDate: '2026-03-12', source: 'startup', sourceKind: 'startup', parentId: 'p1',
    }));
    const r = await report([...rows, parentRow('p1')]);
    expect(r.input.tax).toBe(150);                    // NOT 300
    expect(r.eligible).toHaveLength(1);
    expect(r.needsConversionCount).toBe(1);
  }, 120_000);

  // ═══ ٥ ═══════════════════════════════════════════════════════════════
  it('٥ — created_at لا يُستعمل تاريخ فاتورة ولا تاريخ دفع', async () => {
    // The parent was typed on 2026-08-20 and the invoice is dated 2026-03-10.
    // Reporting it under `created_at` would file a Q1 deduction in Q3.
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());
    await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });
    const [row] = await entriesOf('p1');
    expect(row.spent_date).toBe('2026-03-12');
    expect(row.invoice_date).toBe('2026-03-10');
    expect(String(row.spent_date)).not.toContain('2026-08');
    expect(String(row.invoice_date)).not.toContain('2026-08');

    // …ولا يُقبل تحويل بلا تاريخ صرف، فلا يوجد ما يملأ الفراغ ضمناً.
    await setDoc(doc(db, 'startup_costs', 'p2'), LEGACY({ item_name: 'رفّاعة' }));
    await expect(migration.convertStartupParentSpend('p2', FORM({ spentDate: '' })))
      .rejects.toThrow(/تاريخ الصرف/);
    await expect(migration.convertStartupParentSpend('p2', FORM({ spentDate: '2026-02-30' })))
      .rejects.toThrow(/تاريخ الصرف/);
    expect(await entriesOf('p2')).toHaveLength(0);
  }, 120_000);

  // ═══ ٦ ═══════════════════════════════════════════════════════════════
  it('٦ — التحويل يحترم الفترة المقفلة', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());
    await setDoc(doc(db, 'accounting_periods', '2026-03'), { periodKey: '2026-03', status: 'closed' });

    await expect(migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' }))
      .rejects.toThrow(/الفترة 2026-03 مقفلة/);
    expect(await entriesOf('p1')).toHaveLength(0);
    // …والبند لم يُمَس: لا نصف تحويل.
    expect((await getDoc(doc(db, 'startup_costs', 'p1'))).data().is_tax_invoice).toBe(true);
  }, 120_000);

  it('٦ب — والترحيل يحترم الفترة المقفلة والقفل بعد التحويل', async () => {
    await setDoc(doc(db, 'startup_costs', 'p1'), LEGACY());
    await migration.convertStartupParentSpend('p1', FORM(), { userId: 'u1' });
    const [row] = await entriesOf('p1');

    // القفل: الترحيل مرتين لا يضاعف.
    const first = await ops.postUnposted({ userId: 'u1' });
    expect(first.failed).toEqual([]);
    const before = (await ledger.fetchEntries()).length;
    const second = await ops.postUnposted({ userId: 'u1' });
    expect(second.posted).toHaveLength(0);
    expect((await ledger.fetchEntries())).toHaveLength(before);

    // والفترة المقفلة تمنع ترحيل تحويل آخر فيها.
    await setDoc(doc(db, 'startup_costs', 'p2'), LEGACY({ item_name: 'رفّاعة' }));
    await migration.convertStartupParentSpend('p2', FORM({
      spentDate: '2026-05-04', invoiceDate: '2026-05-02', invoiceNumber: 'S-78',
    }), { userId: 'u1' });
    await setDoc(doc(db, 'accounting_periods', '2026-05'), { periodKey: '2026-05', status: 'closed' });
    const blocked = await ops.postUnposted({ userId: 'u1' });
    expect(blocked.posted).toHaveLength(0);
    expect(blocked.failed).toEqual([]);
    // The sweep names the reason rather than silently passing over it — and
    // the server refuses the same posting independently, so the message is a
    // convenience and not the guard.
    expect(blocked.skipped.map((x) => x.reason).join(' ')).toMatch(/الفترة 2026-05 مقفلة/);
    expect(row.startup_cost_id).toBe('p1');
  }, 180_000);
});
