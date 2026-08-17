/**
 * سجل مصاريف بند التأسيس — على الخادم، بمعاملة واحدة
 * ═══════════════════════════════════════════════════════════════════════════
 * `startup_cost_entries` was client-writable and `startup_costs` sat in the
 * permissive operational wildcard, so the accounting fix lived entirely in the
 * forms — and a form is not a boundary. One direct write put a parent-level
 * amount with an invoice back on the item, and such a row enters the VAT
 * return and can never reach `1200`.
 *
 * The rules now deny both, and these three functions are the only door. What
 * they have to do that a rule cannot:
 *
 *   • re-sum the siblings into `actual_amount` (rules have no fold);
 *   • re-derive `status` from that sum against the budget;
 *   • check the posting lock and recompute the parent in ONE atomic step.
 *
 * Every case below drives the real function against the emulator. The race
 * cases use `onBeforeCommit` — a seam that runs after the transaction's reads
 * and before its writes — to make the hazard happen at the only moment it can.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  addStartupEntry, deleteStartupEntry, assignStartupUnits,
  convertLegacyStartupSpend,
  updateStartupPlan, deleteStartupPlan, StartupCostError,
} from '../src/startupCosts.js';
import { postSource, seedChartOfAccounts, COL } from '../src/ledger.js';
import {
  startupEntryProblems as serverEntryProblems,
  startupConversionProblems as serverConversionProblems,
  startupRollup as serverRollup,
  startupParentHasLegacySpend as serverHasLegacy,
  startupPlanUpdateProblems as serverPlanProblems,
} from '../src/startupMigration.js';
import {
  startupEntryProblems as clientEntryProblems,
  startupConversionProblems as clientConversionProblems,
  startupRollup as clientRollup,
  startupParentHasLegacySpend as clientHasLegacy,
  startupPlanUpdateProblems as clientPlanProblems,
} from '../../src/lib/accounting/startupMigration.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let app, db;

const CHART = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1200', nameArabic: 'ضريبة مدخلات', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '1500', nameArabic: 'أصول ثابتة', accountType: 'asset', normalBalance: 'debit', active: true },
  { code: '2000', nameArabic: 'الموردون', accountType: 'liability', normalBalance: 'credit', active: true },
];
const HISTORY = [
  { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
  { effectiveFrom: '2020-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
];

const WIPE = [...Object.values(COL), 'startup_costs', 'startup_cost_entries', 'app_settings'];
async function wipe() {
  for (const c of WIPE) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((s) => s.ref.delete()));
  }
}

const PLAN = (over = {}) => ({
  category: 'equipment', item_name: 'ماكينة ضغط', quantity: 1,
  budgeted_amount: 1000, actual_amount: 0, status: 'in_progress',
  is_tax_invoice: false, ...over,
});
/** A legacy parent: an amount and an invoice typed straight onto the item. */
const LEGACY = (over = {}) => PLAN({
  actual_amount: 1150, status: 'completed', is_tax_invoice: true,
  invoice_number: 'S-77', invoice_date: '2026-03-10', supplier: 'مؤسسة النور',
  vat_amount: 150, vat_rate: null, price_mode: 'inclusive', vat_deductible: true,
  created_at: '2026-08-20T09:00:00.000Z', ...over,
});
const ENTRY = (over = {}) => ({
  description: 'دفعة أولى', amount: 400, spentDate: '2026-03-12',
  paymentMethod: 'cash', isTaxInvoice: false, ...over,
});
const FORM = (over = {}) => ({
  spentDate: '2026-03-12', paymentMethod: 'cash',
  isTaxInvoice: true, invoiceNumber: 'S-77', invoiceDate: '2026-03-10',
  supplier: 'مؤسسة النور', vatAmount: 150, vatRate: null,
  priceMode: 'inclusive', vatDeductible: true,
  ...over,
});

const parentOf = async (id) => (await db.collection('startup_costs').doc(id).get()).data();
const entriesOf = async (id) => (await db.collection('startup_cost_entries')
  .where('startup_cost_id', '==', id).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
const audits = async (action) => (await db.collection(COL.AUDIT)
  .where('action', '==', action).get()).docs.map((x) => x.data());

/** Fires its body once, however many times the transaction retries. */
function once(fn) {
  let done = false; let runs = 0;
  const wrapped = async () => {
    runs += 1;
    if (done) return;
    done = true;
    await fn();
  };
  wrapped.runs = () => runs;
  return wrapped;
}

const AS = (role) => ({ userId: `${role}-uid`, role });

d('سجل مصاريف بند التأسيس على الخادم', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-startup' }, 'startup-test');
    db = getFirestore(app);
  }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    await wipe();
    await seedChartOfAccounts(db, FieldValue, CHART, { userId: 'u1' });
    await db.collection('app_settings').doc('accounting').set({
      value: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: HISTORY },
    });
  }, 60_000);

  // ═══ ٥ — الإضافة والحذف يحدّثان الـroll-up ذرياً ═════════════════════
  describe('٥ — الإضافة والحذف عبر الخادم يحدّثان roll-up ذرياً', () => {
    it('المجموع والحالة يُشتقّان على الخادم، لا من حمولة العميل', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());

      const a = await addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 400 }),
      }, AS('operator'));
      expect(a).toMatchObject({ actualAmount: 400, status: 'in_progress' });
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 400, status: 'in_progress' });

      const b = await addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 700, description: 'دفعة ثانية' }),
      }, AS('operator'));
      // 1100 < 1000؟ لا — تجاوز الميزانية فصارت مكتملة.
      expect(b).toMatchObject({ actualAmount: 1100, status: 'completed' });
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 1100, status: 'completed' });

      const [first] = (await entriesOf('p1')).filter((e) => e.amount === 400);
      const del = await deleteStartupEntry(db, FieldValue, { entryId: first.id }, AS('operator'));
      expect(del).toMatchObject({ actualAmount: 700, status: 'in_progress' });
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 700, status: 'in_progress' });
      expect(await entriesOf('p1')).toHaveLength(1);
    }, 90_000);

    it('ولا يُصدَّق مجموع مُرسَل من العميل', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      // The payload claims a total and a status; both are ignored — the
      // server sums what it can actually see.
      await addStartupEntry(db, FieldValue, {
        parentId: 'p1',
        entry: ENTRY({ amount: 400, actualAmount: 999999, status: 'completed' }),
      }, AS('operator'));
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 400, status: 'in_progress' });
    }, 60_000);

    it('ويُرفض مصروف بلا تاريخ أو بمبلغ صفري أو بضريبة فاسدة', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ spentDate: '' }),
      }, AS('operator'))).rejects.toThrow(/تاريخ الصرف/);
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ spentDate: '2026-02-30' }),
      }, AS('operator'))).rejects.toThrow(/تاريخ الصرف/);
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 0 }),
      }, AS('operator'))).rejects.toThrow(/أكبر من صفر/);
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ isTaxInvoice: true, vatAmount: -5 }),
      }, AS('operator'))).rejects.toThrow(/سالب/);
      expect(await entriesOf('p1')).toHaveLength(0);
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 0 });
    }, 90_000);

    it('والإضافة المتزامنة تُجهض المعاملة فلا يضيع مجموع', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY({ amount: 400 }) }, AS('operator'));

      // A sibling appears after the reads and before the writes. The
      // transactional QUERY is what sees it: it is in the read set, so the
      // commit aborts and the retry sums three entries, not two.
      const race = once(() => db.collection('startup_cost_entries').doc('raced').set({
        startup_cost_id: 'p1', description: 'دفعة موازية', amount: 250,
        spent_date: '2026-03-13', is_tax_invoice: false,
      }));
      await addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 100, description: 'ثالثة' }),
      }, { ...AS('operator'), onBeforeCommit: race });

      expect(race.runs()).toBeGreaterThan(1);
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 750 });   // 400+250+100
    }, 90_000);
  });

  // ═══ ٦ — القفل يمنع حذف مصروف مُرحّل ════════════════════════════════
  it('٦ — حذف مصروف مُرحّل يفشل بسبب القفل، والمجموع لا يتحرك', async () => {
    await db.collection('startup_costs').doc('p1').set(PLAN());
    const added = await addStartupEntry(db, FieldValue, {
      parentId: 'p1',
      entry: ENTRY({
        amount: 1150, isTaxInvoice: true, invoiceNumber: 'S-1',
        invoiceDate: '2026-03-10', supplier: 'مورّد', vatAmount: 150,
      }),
    }, AS('accountant'));

    await postSource(db, FieldValue, { kind: 'startup', sourceId: added.id }, { userId: 'u1' });
    await expect(deleteStartupEntry(db, FieldValue, { entryId: added.id }, AS('accountant')))
      .rejects.toThrow(/مُرحّل بالقيد رقم/);
    expect(await entriesOf('p1')).toHaveLength(1);
    expect(await parentOf('p1')).toMatchObject({ actual_amount: 1150 });
  }, 120_000);

  // ═══ ٧ — تحويل وإضافة متزامنان ══════════════════════════════════════
  it('٧ — إضافة عادية أثناء التحويل: لا يبقى legacy entry بجانبها لنفس المبلغ', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());

    // An ordinary entry arrives after the conversion's reads and before its
    // writes. The parent's `actual_amount` is then a roll-up, not a figure to
    // move — and the retry sees the sibling because the query is in the read
    // set. Without that, both would exist and the same money would be booked
    // twice.
    const race = once(() => db.collection('startup_cost_entries').doc('manual').set({
      startup_cost_id: 'p1', description: 'دفعة يدوية', amount: 1150,
      spent_date: '2026-03-12', is_tax_invoice: false,
    }));
    await expect(convertLegacyStartupSpend(db, FieldValue, {
      parentId: 'p1', form: FORM(),
    }, { ...AS('accountant'), onBeforeCommit: race })).rejects.toThrow(/سجل مصاريف بالفعل/);

    expect(race.runs()).toBeGreaterThan(1);
    const rows = await entriesOf('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('manual');
    expect(rows.some((r) => r.id === 'legacy__p1')).toBe(false);
    // ولم يُمَس البند: لا نصف تحويل.
    expect(await parentOf('p1')).toMatchObject({ is_tax_invoice: true, invoice_number: 'S-77' });
  }, 120_000);

  // ═══ ٨ — إقفال فترة أثناء التحويل ════════════════════════════════════
  it('٨ — إقفال الفترة أثناء التحويل يعيد المعاملة ثم يرفضها، بلا نصف تحويل', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());

    const race = once(() => db.collection(COL.PERIODS).doc('2026-03')
      .set({ periodKey: '2026-03', status: 'closed' }));
    await expect(convertLegacyStartupSpend(db, FieldValue, {
      parentId: 'p1', form: FORM(),
    }, { ...AS('accountant'), onBeforeCommit: race })).rejects.toThrow(/الفترة 2026-03 مقفلة/);

    expect(race.runs()).toBeGreaterThan(1);
    expect(await entriesOf('p1')).toHaveLength(0);
    expect(await parentOf('p1')).toMatchObject({
      is_tax_invoice: true, actual_amount: 1150, invoice_number: 'S-77',
    });
    expect(await audits('startup-convert-legacy')).toHaveLength(0);
  }, 120_000);

  // ═══ ٩ — idempotency ════════════════════════════════════════════════
  it('٩ — استدعاء التحويل مرتين يبقى بلا أثر ثانٍ', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());
    const first = await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('accountant'));
    const second = await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('accountant'));
    const third = await convertLegacyStartupSpend(db, FieldValue, {
      parentId: 'p1', form: FORM({ spentDate: '2026-04-01', invoiceNumber: 'OTHER' }),
    }, AS('admin'));

    expect(first).toMatchObject({ id: 'legacy__p1', created: true });
    expect(second).toMatchObject({ id: 'legacy__p1', created: false });
    expect(third.created).toBe(false);
    expect(await entriesOf('p1')).toHaveLength(1);
    expect((await entriesOf('p1'))[0].invoice_number).toBe('S-77');
    expect(await audits('startup-convert-legacy')).toHaveLength(1);
  }, 120_000);

  // ═══ ١٠ — الأدوار ═══════════════════════════════════════════════════
  it('١٠ — الدور غير المسموح مرفوض، والترحيل التاريخي مقصور على المحاسب والمدير', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());

    // A partner is read-only everywhere.
    await expect(addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('partner')))
      .rejects.toThrow(/مقصور على/);
    await expect(deleteStartupEntry(db, FieldValue, { entryId: 'x' }, AS('partner')))
      .rejects.toThrow(/مقصور على/);
    // …and migrating history decides which quarter a deduction is claimed in,
    // which is not an operator's call.
    await expect(convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('operator')))
      .rejects.toThrow(/مقصور على المدير أو المحاسب/);
    await expect(convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('partner')))
      .rejects.toThrow(/مقصور على/);
    expect(await entriesOf('p1')).toHaveLength(0);

    // …ويُقبل من المحاسب.
    const ok = await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('accountant'));
    expect(ok.created).toBe(true);

    // ولا يُقبل بند غير موجود بأي دور.
    await expect(addStartupEntry(db, FieldValue, { parentId: 'nope', entry: ENTRY() }, AS('admin')))
      .rejects.toThrow(/غير موجود/);
    await expect(addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('nobody')))
      .rejects.toThrow(/مقصور على/);
  }, 120_000);

  // ═══ ١١ — سجل التدقيق ═══════════════════════════════════════════════
  it('١١ — سجل التدقيق يحمل before/after وهوية التوكن لا هوية الحمولة', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());
    // The payload carries a userId of its own; it is never read. The identity
    // written is the one the callable took from the verified token.
    await convertLegacyStartupSpend(db, FieldValue, {
      parentId: 'p1', form: FORM(), userId: 'attacker', role: 'admin',
    }, { userId: 'acct-uid', role: 'accountant' });

    const [rec] = await audits('startup-convert-legacy');
    expect(rec.userId).toBe('acct-uid');
    expect(rec.userId).not.toBe('attacker');
    expect(rec.before).toMatchObject({
      actualAmount: 1150, isTaxInvoice: true, invoiceNumber: 'S-77', entryCount: 0,
    });
    expect(rec.after).toMatchObject({
      actualAmount: 1150, status: 'completed', entryCount: 1,
      spentDate: '2026-03-12', invoiceDate: '2026-03-10',
      periodKey: '2026-03', role: 'accountant',
    });
    expect(rec.documentId).toBe('legacy__p1');
    expect(rec.atIso).toBeTruthy();

    // …والإضافة والحذف كذلك.
    const added = await addStartupEntry(db, FieldValue, {
      parentId: 'p1', entry: ENTRY({ amount: 50, userId: 'attacker' }),
    }, { userId: 'op-uid', role: 'operator' });
    const [addRec] = await audits('startup-entry-add');
    expect(addRec.userId).toBe('op-uid');
    expect(addRec.before).toMatchObject({ actualAmount: 1150, entryCount: 1 });
    expect(addRec.after).toMatchObject({ actualAmount: 1200, entryCount: 2, amount: 50 });

    await deleteStartupEntry(db, FieldValue, { entryId: added.id }, { userId: 'adm-uid', role: 'admin' });
    const [delRec] = await audits('startup-entry-delete');
    expect(delRec.userId).toBe('adm-uid');
    expect(delRec.before).toMatchObject({ actualAmount: 1200, entryCount: 2, amount: 50 });
    expect(delRec.after).toMatchObject({ actualAmount: 1150, entryCount: 1 });
  }, 150_000);

  // ═══ ١٢ — الرحلة كاملة ══════════════════════════════════════════════
  it('١٢ — بند قديم ← تحويل ← قيد واحد ← postSource ← 1200 يطابق التقرير ← المصدر مقفول', async () => {
    await db.collection('startup_costs').doc('p1').set(LEGACY());

    // ① التحويل
    const conv = await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('accountant'));
    expect(conv).toMatchObject({ id: 'legacy__p1', created: true, actualAmount: 1150 });
    const rows = await entriesOf('p1');
    expect(rows).toHaveLength(1);

    // ② الترحيل — عبر المسار الحقيقي
    const res = await postSource(db, FieldValue, { kind: 'startup', sourceId: rows[0].id }, { userId: 'u1' });
    const accrual = (await db.collection(COL.ENTRIES).doc(res.entryId).get()).data();
    expect(accrual.entryDate).toBe('2026-03-10');       // تاريخ الفاتورة، لا تاريخ الصرف
    const on = (code, side) => accrual.lines
      .filter((l) => String(l.accountId) === code)
      .reduce((s, l) => s + (Number(l[side]) || 0), 0);
    expect(on('1200', 'debit')).toBe(150);
    expect(on('1500', 'debit')).toBe(1000);

    // ③ التقرير يقرأ اللقطة المُثبَّتة، والرقمان يتطابقان
    const { buildVatReport } = await import('../../src/lib/accounting/vatReturn.js');
    const { taxPolicyAt } = await import('../../src/lib/accounting/taxPolicy.js');
    const entries = (await db.collection(COL.ENTRIES).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
    const lines = entries.flatMap((e) => (e.lines || []).map((l, i) => ({ ...l, id: `${e.id}-${i}`, entryId: e.id })));
    const report = buildVatReport({
      inputs: [{
        id: rows[0].id, description: 'ماكينة ضغط', amount: 1150, isTaxInvoice: true,
        invoiceNumber: 'S-77', invoiceDate: '2026-03-10', supplier: 'مؤسسة النور',
        vatAmount: 150, vatRate: null, priceMode: 'inclusive', vatDeductible: true,
        spentDate: '2026-03-12', source: 'startup', sourceKind: 'startup', parentId: 'p1',
      }],
      entries, lines, period: '2026-Q1', filing: 'quarterly',
      policyAt: (date) => taxPolicyAt(date, { taxPolicyHistory: HISTORY }),
    });
    expect(report.input.tax).toBe(150);
    expect(report.ledgerInput.tax).toBe(150);
    expect(report.inputMismatch).toBe(0);
    expect(report.needsConversionCount).toBe(0);

    // ④ المصدر مقفول — لا يُرحَّل مرتين ولا يُحذف
    const lock = await db.collection(COL.LOCKS).doc(`startup__${rows[0].id}`).get();
    expect(lock.exists).toBe(true);
    await expect(postSource(db, FieldValue, { kind: 'startup', sourceId: rows[0].id }, { userId: 'u1' }))
      .rejects.toThrow(/لا يُرحّل مرتين/);
    await expect(deleteStartupEntry(db, FieldValue, { entryId: rows[0].id }, AS('accountant')))
      .rejects.toThrow(/مُرحّل بالقيد رقم/);
  }, 180_000);

  // ═══════════════════════════════════════════════════════════════════
  // حذف الخطة — رفض، لا cascade
  // ═══════════════════════════════════════════════════════════════════
  // `allow delete: if isOperator()` used to sit on `startup_costs`, so a plan
  // could be removed while its `startup_cost_entries`, their journal entries
  // and their posting locks stayed behind pointing at a parent that no longer
  // existed. Nothing detected it afterwards.
  describe('حذف الخطة', () => {
    it('يحذف خطة فارغة ويكتب سجل تدقيق', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      const res = await deleteStartupPlan(db, FieldValue, { parentId: 'p1' }, AS('operator'));
      expect(res).toMatchObject({ id: 'p1', deleted: true });
      expect((await db.collection('startup_costs').doc('p1').get()).exists).toBe(false);
      const [rec] = await audits('startup-plan-delete');
      expect(rec.userId).toBe('operator-uid');
      expect(rec.before).toMatchObject({ itemName: 'ماكينة ضغط', actualAmount: 0, entryCount: 0 });
    }, 60_000);

    it('ويرفض خطة لها مصروف غير مُرحّل — بلا cascade', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('operator'));

      await expect(deleteStartupPlan(db, FieldValue, { parentId: 'p1' }, AS('admin')))
        .rejects.toThrow(/احذف المصاريف غير المُرحّلة أولاً/);
      // Nothing touched: not the plan, not the entry, not the audit trail.
      expect((await db.collection('startup_costs').doc('p1').get()).exists).toBe(true);
      expect(await entriesOf('p1')).toHaveLength(1);
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 400 });
      expect(await audits('startup-plan-delete')).toHaveLength(0);
    }, 90_000);

    it('ويرفض خطة لها مصروف مُرحّل — يُعكس قيده أولاً', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      const added = await addStartupEntry(db, FieldValue, {
        parentId: 'p1',
        entry: ENTRY({
          amount: 1150, isTaxInvoice: true, invoiceNumber: 'S-1',
          invoiceDate: '2026-03-10', supplier: 'مورّد', vatAmount: 150,
        }),
      }, AS('accountant'));
      await postSource(db, FieldValue, { kind: 'startup', sourceId: added.id }, { userId: 'u1' });

      // The entry cannot go while it is in the books…
      await expect(deleteStartupEntry(db, FieldValue, { entryId: added.id }, AS('accountant')))
        .rejects.toThrow(/مُرحّل بالقيد رقم/);
      // …so the plan cannot either.
      await expect(deleteStartupPlan(db, FieldValue, { parentId: 'p1' }, AS('accountant')))
        .rejects.toThrow(/احذف المصاريف غير المُرحّلة أولاً/);
      expect((await db.collection('startup_costs').doc('p1').get()).exists).toBe(true);
      expect((await db.collection(COL.LOCKS).doc(`startup__${added.id}`).get()).exists).toBe(true);
    }, 120_000);

    it('ويرفض خطة تحمل مبلغاً فعلياً قديماً بلا مصاريف', async () => {
      await db.collection('startup_costs').doc('p1').set(LEGACY());
      await expect(deleteStartupPlan(db, FieldValue, { parentId: 'p1' }, AS('admin')))
        .rejects.toThrow(/يحمل مبلغاً فعلياً/);
      expect((await db.collection('startup_costs').doc('p1').get()).exists).toBe(true);
    }, 60_000);

    it('وسباق الإضافة مع الحذف لا يترك مصروفاً يتيماً', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      // An entry appears after the delete's reads and before its writes. The
      // transactional query is in the read set, so the commit aborts and the
      // retry sees the child — either the add wins and the delete is refused,
      // or the delete wins and the add finds no parent. Never both.
      const race = once(() => db.collection('startup_cost_entries').doc('raced').set({
        startup_cost_id: 'p1', description: 'موازية', amount: 250,
        spent_date: '2026-03-13', is_tax_invoice: false,
      }));
      await expect(deleteStartupPlan(db, FieldValue, { parentId: 'p1' }, {
        ...AS('operator'), onBeforeCommit: race,
      })).rejects.toThrow(/احذف المصاريف غير المُرحّلة أولاً/);

      expect(race.runs()).toBeGreaterThan(1);
      expect((await db.collection('startup_costs').doc('p1').get()).exists).toBe(true);
      expect(await entriesOf('p1')).toHaveLength(1);
    }, 120_000);

    it('والعكس: إضافة إلى خطة حُذفت أثناء المعاملة تُرفض', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      const race = once(() => db.collection('startup_costs').doc('p1').delete());
      await expect(addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, {
        ...AS('operator'), onBeforeCommit: race,
      })).rejects.toThrow(/غير موجود/);
      expect(await entriesOf('p1')).toHaveLength(0);
    }, 120_000);
  });

  // ═══════════════════════════════════════════════════════════════════
  // الحالة مشتقة، لا مختارة
  // ═══════════════════════════════════════════════════════════════════
  describe('تعديل الخطة والحالة المشتقة', () => {
    it('actual=1500 والميزانية 1000→2000 تعيد الحالة إلى in_progress', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN({ budgeted_amount: 1000 }));
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY({ amount: 1500 }) }, AS('operator'));
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 1500, status: 'completed' });

      const res = await updateStartupPlan(db, FieldValue, {
        parentId: 'p1', patch: { plannedAmount: 2000 },
      }, AS('operator'));
      expect(res).toMatchObject({ actualAmount: 1500, status: 'in_progress' });
      expect(await parentOf('p1')).toMatchObject({
        budgeted_amount: 2000, actual_amount: 1500, status: 'in_progress',
      });
    }, 90_000);

    it('والميزانية 2000→1000 تعيدها completed', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN({ budgeted_amount: 2000 }));
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY({ amount: 1500 }) }, AS('operator'));
      expect(await parentOf('p1')).toMatchObject({ status: 'in_progress' });

      await updateStartupPlan(db, FieldValue, {
        parentId: 'p1', patch: { plannedAmount: 1000 },
      }, AS('operator'));
      expect(await parentOf('p1')).toMatchObject({
        budgeted_amount: 1000, actual_amount: 1500, status: 'completed',
      });
    }, 90_000);

    it('وتغيير الاسم وحده لا يمسّ المبلغ الفعلي', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY({ amount: 400 }) }, AS('operator'));
      await updateStartupPlan(db, FieldValue, {
        parentId: 'p1', patch: { itemName: 'ماكينة أخرى' },
      }, AS('operator'));
      expect(await parentOf('p1')).toMatchObject({
        item_name: 'ماكينة أخرى', actual_amount: 400, budgeted_amount: 1000, status: 'in_progress',
      });
    }, 90_000);

    it('وإرسال status أو actual_amount أو حقول الضريبة يُرفض بوضوح', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      for (const patch of [
        { status: 'completed' },
        { actualAmount: 9999 },
        { isTaxInvoice: true },
        { vatAmount: 150 },
        { itemName: 'اسم', status: 'completed' },
      ]) {
        await expect(updateStartupPlan(db, FieldValue, { parentId: 'p1', patch }, AS('admin')))
          .rejects.toThrow(/يملكها الخادم/);
      }
      expect(await parentOf('p1')).toMatchObject({ status: 'in_progress', actual_amount: 0 });
      expect(await audits('startup-plan-update')).toHaveLength(0);
    }, 90_000);

    it('وسباق تعديل الميزانية مع إضافة مصروف ينتهي بإجمالي وحالة متوافقين', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN({ budgeted_amount: 2000 }));
      await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY({ amount: 900 }) }, AS('operator'));

      // A second entry lands after the plan edit's reads. The transactional
      // query aborts the edit, and the retry sums BOTH — no lost update.
      const race = once(() => db.collection('startup_cost_entries').doc('raced').set({
        startup_cost_id: 'p1', description: 'موازية', amount: 200,
        spent_date: '2026-03-13', is_tax_invoice: false,
      }));
      await updateStartupPlan(db, FieldValue, {
        parentId: 'p1', patch: { plannedAmount: 1000 },
      }, { ...AS('operator'), onBeforeCommit: race });

      expect(race.runs()).toBeGreaterThan(1);
      expect(await parentOf('p1')).toMatchObject({
        budgeted_amount: 1000, actual_amount: 1100, status: 'completed',
      });
    }, 120_000);
  });

  // ═══════════════════════════════════════════════════════════════════
  // الصرف القديم لا يُدفن تحت مصروف جديد
  // ═══════════════════════════════════════════════════════════════════
  // The reproduction, before the fix: parent `actual_amount = 1150`, no
  // children, legacy invoice fields. An operator adds 100. The roll-up summed
  // `children + 100` and wrote 100 — 1,150 gone — and the child's appearance
  // took the parent out of the VAT report's parent pass, so its invoice
  // stopped being counted too. Both losses silent.
  describe('بند يحمل صرفاً قديماً', () => {
    it('١ — 1150 + إضافة 100 تُرفض، ويبقى كل شيء كما هو', async () => {
      await db.collection('startup_costs').doc('p1').set(LEGACY());
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 100 }),
      }, AS('operator'))).rejects.toThrow(/يُحوّل المحاسب ذلك المبلغ القديم/);

      const parent = await parentOf('p1');
      expect(parent.actual_amount).toBe(1150);          // كان يصير 100
      expect(parent.is_tax_invoice).toBe(true);
      expect(parent.invoice_number).toBe('S-77');
      expect(parent.vat_amount).toBe(150);
      expect(await entriesOf('p1')).toHaveLength(0);
      expect(await audits('startup-entry-add')).toHaveLength(0);
    }, 60_000);

    it('٢ — والمشغّل لا يستطيع إجراء التحويل بنفسه', async () => {
      await db.collection('startup_costs').doc('p1').set(LEGACY());
      await expect(convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('operator')))
        .rejects.toThrow(/مقصور على المدير أو المحاسب/);
      expect(await entriesOf('p1')).toHaveLength(0);
    }, 60_000);

    it('٣ — المحاسب يحوّل 1150 ثم تُقبل إضافة 100 فيصير الإجمالي 1250', async () => {
      await db.collection('startup_costs').doc('p1').set(LEGACY());
      await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, AS('accountant'));
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 1150, is_tax_invoice: false });

      const add = await addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 100 }),
      }, AS('operator'));
      expect(add.actualAmount).toBe(1250);
      expect(await parentOf('p1')).toMatchObject({ actual_amount: 1250 });
      expect(await entriesOf('p1')).toHaveLength(2);
    }, 120_000);

    it('٤ — سباق التحويل مع الإضافة لا يكرّر 1150 ولا يفقده', async () => {
      await db.collection('startup_costs').doc('p1').set(LEGACY());
      // The add arrives after the conversion's reads. Whichever way the
      // emulator orders them, the total is 1150 exactly once: the conversion
      // sees the sibling and refuses, or the add sees the legacy parent and
      // refuses.
      const race = once(() => addStartupEntry(db, FieldValue, {
        parentId: 'p1', entry: ENTRY({ amount: 100 }),
      }, AS('operator')).catch(() => {}));
      await convertLegacyStartupSpend(db, FieldValue, { parentId: 'p1', form: FORM() }, {
        ...AS('accountant'), onBeforeCommit: race,
      }).catch(() => {});

      const rows = await entriesOf('p1');
      const total = rows.reduce((s2, r) => s2 + r.amount, 0);
      const parent = await parentOf('p1');
      // 1150 appears once, or not at all — never twice, and never lost.
      expect(rows.filter((r) => r.amount === 1150).length).toBeLessThanOrEqual(1);
      expect(parent.actual_amount).toBe(rows.length ? total : 1150);
      if (!rows.length) expect(parent.is_tax_invoice).toBe(true);
    }, 120_000);

    it('٥ — صفر فعلي بلا بيانات قديمة يقبل أول مصروف طبيعياً', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN());
      const add = await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('operator'));
      expect(add.actualAmount).toBe(400);
    }, 60_000);

    it('٦ — وحقول فاتورة قديمة بصفر تمنع الإضافة، وتُمسح بقرار محاسب لا بصمت', async () => {
      await db.collection('startup_costs').doc('p1').set(PLAN({
        actual_amount: 0, is_tax_invoice: true, invoice_number: 'S-9',
        supplier: 'مورّد قديم', vat_amount: 30,
      }));
      // Not silently overwritten by the first entry: those fields are a claim
      // the VAT report reads, and a child would take the parent out of its
      // parent pass, so the claim would vanish with nobody deciding it should.
      await expect(addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('operator')))
        .rejects.toThrow(/يُحوّل المحاسب/);
      expect(await parentOf('p1')).toMatchObject({ is_tax_invoice: true, invoice_number: 'S-9' });

      // The accountant clears them EXPLICITLY, and it is audited as its own act.
      const cleared = await convertLegacyStartupSpend(db, FieldValue, {
        parentId: 'p1', form: FORM(),
      }, AS('accountant'));
      expect(cleared).toMatchObject({ created: false, cleared: true });
      expect(await parentOf('p1')).toMatchObject({ is_tax_invoice: false, invoice_number: null });
      const [rec] = await audits('startup-clear-legacy-tax');
      expect(rec.before).toMatchObject({ actualAmount: 0, invoiceNumber: 'S-9' });
      expect(await entriesOf('p1')).toHaveLength(0);

      // …ثم تُقبل الإضافة.
      const add = await addStartupEntry(db, FieldValue, { parentId: 'p1', entry: ENTRY() }, AS('operator'));
      expect(add.actualAmount).toBe(400);
    }, 120_000);
  });

  // ═══ إسناد المصاريف إلى تقسيمات البند ═══════════════════════════════
  // «لما أفتح تجهيز السكن يظهر لي أنواع السكن اللي عندنا، وبعدين نسجّل مصروف
  // كل سكن» — one budget, several places under it. The claim to prove is that
  // filing a row under a place moves no money and touches no book.
  describe('إسناد المصاريف إلى السكنات', () => {
    const UNITS = ['سكن النزهة', 'سكن الشمال'];
    beforeEach(async () => {
      await db.collection('startup_costs').doc('h1').set(PLAN({
        item_name: 'تجهيز السكن', budgeted_amount: 15000, units: UNITS,
      }));
    });

    it('يُسند دفعةً واحدة — ومجموع البند لا يتغيّر', async () => {
      const a = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY({ amount: 139, description: 'مروحة لسكن النزهه' }) }, AS('operator'));
      const b = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY({ amount: 200, description: 'دهان' }) }, AS('operator'));
      const before = (await parentOf('h1')).actual_amount;
      expect(before).toBe(339);

      const res = await assignStartupUnits(db, FieldValue, {
        parentId: 'h1',
        assignments: [
          { entryId: a.id, unit: 'سكن النزهة' },
          { entryId: b.id, unit: 'سكن الشمال' },
        ],
      }, AS('operator'));

      expect(res.count).toBe(2);
      const rows = await entriesOf('h1');
      expect(rows.find((r) => r.id === a.id).unit).toBe('سكن النزهة');
      expect(rows.find((r) => r.id === b.id).unit).toBe('سكن الشمال');
      // الإسناد ليس نقل مال: نفس المصاريف تحت نفس الأب.
      expect((await parentOf('h1')).actual_amount).toBe(before);

      const [rec] = await audits('startup-units-assign');
      expect(rec.after.count).toBe(2);
      expect(rec.after.byUnit).toEqual({ 'سكن النزهة': 1, 'سكن الشمال': 1 });
    }, 60_000);

    it('ومصروف مُرحَّل يُسنَد وقيده وقفله لا يتغيّران', async () => {
      const a = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY({ amount: 139 }) }, AS('operator'));
      const posted = await postSource(db, FieldValue, { kind: 'startup', sourceId: a.id }, { userId: 'u1' });
      const entryBefore = (await db.collection(COL.ENTRIES).doc(posted.entryId).get()).data();
      const lockBefore = (await db.collection(COL.LOCKS).doc(`startup__${a.id}`).get()).data();

      await assignStartupUnits(db, FieldValue, {
        parentId: 'h1', assignments: [{ entryId: a.id, unit: 'سكن الشمال' }],
      }, AS('operator'));

      expect((await db.collection(COL.ENTRIES).doc(posted.entryId).get()).data()).toEqual(entryBefore);
      expect((await db.collection(COL.LOCKS).doc(`startup__${a.id}`).get()).data()).toEqual(lockBefore);
      expect((await db.collection(COL.ENTRIES).get()).size).toBe(1);
    }, 90_000);

    it('و«غير محدد» إسنادٌ صالح — يُعيد المصروف بلا سكن', async () => {
      const a = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY() }, AS('operator'));
      await assignStartupUnits(db, FieldValue, { parentId: 'h1', assignments: [{ entryId: a.id, unit: 'سكن النزهة' }] }, AS('operator'));
      await assignStartupUnits(db, FieldValue, { parentId: 'h1', assignments: [{ entryId: a.id, unit: null }] }, AS('operator'));
      expect((await entriesOf('h1'))[0].unit).toBeNull();
    }, 60_000);

    it('وسكنٌ ليس في قائمة البند يُرفض — ولا يُكتب شيء من الدفعة', async () => {
      const a = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY() }, AS('operator'));
      const b = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY({ description: 'ثانٍ' }) }, AS('operator'));
      // الأول صالح والثاني لا — ويجب ألا يُطبَّق نصف الدفعة.
      await expect(assignStartupUnits(db, FieldValue, {
        parentId: 'h1',
        assignments: [{ entryId: a.id, unit: 'سكن النزهة' }, { entryId: b.id, unit: 'سكن الوهم' }],
      }, AS('operator'))).rejects.toThrow(/ليس من سكنات هذا البند/);
      expect((await entriesOf('h1')).every((r) => !r.unit)).toBe(true);
      expect(await audits('startup-units-assign')).toHaveLength(0);
    }, 60_000);

    it('ومصروف تحت أبٍ آخر أو قائمة فارغة يُرفضان', async () => {
      await db.collection('startup_costs').doc('other').set(PLAN({ item_name: 'آخر' }));
      const foreign = await addStartupEntry(db, FieldValue, { parentId: 'other', entry: ENTRY() }, AS('operator'));
      await expect(assignStartupUnits(db, FieldValue, {
        parentId: 'h1', assignments: [{ entryId: foreign.id, unit: 'سكن النزهة' }],
      }, AS('operator'))).rejects.toThrow(/ليس ضمن مصاريف هذا البند/);
      await expect(assignStartupUnits(db, FieldValue, { parentId: 'h1', assignments: [] }, AS('operator')))
        .rejects.toThrow(/لا توجد إسنادات/);
      expect(await audits('startup-units-assign')).toHaveLength(0);
    }, 60_000);

    it('والشريك لا يُسند', async () => {
      const a = await addStartupEntry(db, FieldValue, { parentId: 'h1', entry: ENTRY() }, AS('operator'));
      await expect(assignStartupUnits(db, FieldValue, {
        parentId: 'h1', assignments: [{ entryId: a.id, unit: 'سكن النزهة' }],
      }, AS('partner'))).rejects.toThrow();
    }, 60_000);

    it('وإضافة مصروف بسكنٍ غير مُدرَج تُرفض عند الكتابة', async () => {
      await expect(addStartupEntry(db, FieldValue, {
        parentId: 'h1', entry: ENTRY({ unit: 'سكن الوهم' }),
      }, AS('operator'))).rejects.toThrow(/ليس من سكنات هذا البند/);
      expect(await entriesOf('h1')).toHaveLength(0);
    }, 60_000);

    it('وتعديل قائمة السكنات: يُقبل الصالح ويُرفض الفاسد', async () => {
      await updateStartupPlan(db, FieldValue, {
        parentId: 'h1', patch: { units: ['سكن النزهة', ' سكن الروضة '] },
      }, AS('operator'));
      expect((await parentOf('h1')).units).toEqual(['سكن النزهة', 'سكن الروضة']);

      await expect(updateStartupPlan(db, FieldValue, { parentId: 'h1', patch: { units: 'ليست قائمة' } }, AS('operator')))
        .rejects.toThrow(/قائمة أسماء/);
      await expect(updateStartupPlan(db, FieldValue, { parentId: 'h1', patch: { units: ['سكن', '  '] } }, AS('operator')))
        .rejects.toThrow(/فارغ/);
      // ── التكرار يُرفض ولا يُحذف صامتاً ──
      // «النزهة» و«النزهه» مكانٌ واحد بإملاءين. حذف أحدهما بلا قول يترك
      // المستخدم يظن أنه حفظ سكنين. والقائمة القديمة تبقى كما هي.
      await expect(updateStartupPlan(db, FieldValue, {
        parentId: 'h1', patch: { units: ['سكن النزهة', 'سكن النزهه'] },
      }, AS('operator'))).rejects.toThrow(/مكرر/);
      expect((await parentOf('h1')).units).toEqual(['سكن النزهة', 'سكن الروضة']);
    }, 60_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// نسختا القواعد — العميل والخادم — على بطارية واحدة
// ═══════════════════════════════════════════════════════════════════════════
// The client copy lets a form say what is missing before it sends; the server
// copy DECIDES. A form that accepts what the server refuses is a dead end the
// user has to discover by failing.
describe('انحراف قواعد التأسيس بين العميل والخادم', () => {
  const PARENT = { id: 'p1', itemName: 'ماكينة', actualAmount: 1150, invoiceUrl: '' };
  const CASES = [
    ['كامل', FORM()],
    ['بلا تاريخ صرف', FORM({ spentDate: '' })],
    ['تاريخ غير تقويمي', FORM({ spentDate: '2026-02-30' })],
    ['بلا طريقة دفع', FORM({ paymentMethod: '' })],
    ['بلا رقم فاتورة', FORM({ invoiceNumber: '' })],
    ['بلا مورّد', FORM({ supplier: '' })],
    ['ضريبة سالبة', FORM({ vatAmount: -5 })],
    ['ضريبة تتجاوز الإجمالي', FORM({ vatAmount: 5000 })],
    ['ليست فاتورة ضريبية', FORM({ isTaxInvoice: false, vatAmount: null, invoiceNumber: '', supplier: '' })],
  ];

  it.each(CASES)('التحويل — %s', (_name, form) => {
    expect(clientConversionProblems(PARENT, form)).toEqual(serverConversionProblems(PARENT, form));
  });

  it.each([
    ['كامل', ENTRY()],
    ['بلا وصف', ENTRY({ description: '' })],
    ['بمبلغ صفري', ENTRY({ amount: 0 })],
    ['بلا تاريخ', ENTRY({ spentDate: '' })],
    ['بضريبة فاسدة', ENTRY({ isTaxInvoice: true, vatAmount: -1 })],
  ])('المصروف — %s', (_name, entry) => {
    expect(clientEntryProblems(entry)).toEqual(serverEntryProblems(entry));
  });

  it('وكشف الصرف القديم واحد', () => {
    const rows = [
      { actualAmount: 1150, isTaxInvoice: true },
      { actualAmount: 0, isTaxInvoice: true },
      { actualAmount: 0, invoiceNumber: 'S-9' },
      { actualAmount: 0, supplier: 'مورّد' },
      { actualAmount: 0, vatAmount: 150 },
      { actualAmount: 0 },
      { actualAmount: 1150 },
    ];
    for (const r of rows) {
      expect(clientHasLegacy(r)).toBe(serverHasLegacy(r));
      expect(clientHasLegacy(r, { hasEntries: true })).toBe(serverHasLegacy(r, { hasEntries: true }));
      // A parent with entries is never «legacy» — its amount is a roll-up.
      expect(serverHasLegacy(r, { hasEntries: true })).toBe(false);
    }
    expect(serverHasLegacy({ actualAmount: 0 })).toBe(false);
    expect(serverHasLegacy({ actualAmount: 0, isTaxInvoice: true })).toBe(true);
  });

  it('وفحص تعديل الخطة واحد', () => {
    for (const patch of [
      { itemName: 'x' }, { plannedAmount: 500 }, { status: 'completed' },
      { actualAmount: 1 }, { vatAmount: 5 }, { quantity: 0 }, { itemName: '  ' },
      { plannedAmount: -1 }, {},
      { units: ['سكن أ'] }, { units: 'نص' }, { units: ['', 'سكن'] },
      { units: ['سكن النزهة', 'سكن النزهه'] },
    ]) {
      expect(clientPlanProblems(patch)).toEqual(serverPlanProblems(patch));
    }
  });

  it('والمجموع المشتق واحد', () => {
    for (const [amounts, planned] of [[[400, 700], 1000], [[], 1000], [[50], 0], [[999.995], 1000]]) {
      expect(clientRollup(amounts, planned)).toEqual(serverRollup(amounts, planned));
    }
    expect(serverRollup([400, 700], 1000)).toEqual({ actualAmount: 1100, status: 'completed' });
    expect(serverRollup([], 1000)).toEqual({ actualAmount: 0, status: 'in_progress' });
  });

  it('والرفض من نوع يقرأه المستدعي', () => {
    expect(new StartupCostError('x').code).toBe('failed-precondition');
    expect(new StartupCostError('x', { code: 'permission-denied' }).code).toBe('permission-denied');
  });

});
