/**
 * الرحلة الكاملة — من وكيلٍ وهمي إلى ذمّةٍ رصيدها صفر
 * ═══════════════════════════════════════════════════════════════════════════
 * كل قطعةٍ اختُبرت وحدها. وهذا يختبر أنها **تُركَّب**: وكيلٌ وهمي ⇐ توقيعٌ
 * يُتحقَّق منه ⇐ خامٌ append-only ⇐ تطبيع ⇐ منع تكرار ⇐ حجزٌ مؤهل ⇐ مسودة
 * تسوية ⇐ اعتمادٌ شهري ⇐ **قيدٌ متوازن** ⇐ فاتورةٌ مرتبطة **بلا قيد إيرادٍ
 * ثانٍ** ⇐ خصمٌ معتمد ⇐ تحصيلٌ بنكي ⇐ **رصيد ذمم سويتر = صفر**.
 *
 * والادعاء الأخير هو المحكّ: صفرٌ يعني أن كل ريالٍ أُثبت قد سُوّي، وأن لا
 * ريالاً أُثبت مرتين. رقمٌ غيره يعني خللاً في مكانٍ ما من السلسلة.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

import { seedChartOfAccounts, COL } from '../src/ledger.js';
import { ACC } from '../src/posting.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';
import { issueDocument, DOC_COL } from '../src/invoicing.js';
import {
  createIntegrationKey, computeSignature, verifyIngestRequest,
} from '../src/sweater/integrationKeys.js';
import { ingestSweaterOperations, COL as SW } from '../src/sweater/ingest.js';
import { hashBody } from '../src/sweater/record.js';
import { SWEATER_PRICE_SEED } from '../src/sweater/pricing.js';
import { RECOGNITION_POLICY_SEED } from '../src/sweater/recognition.js';
import { ADJUSTMENT_TYPE_SEED } from '../src/sweater/adjustmentTypes.js';
import {
  sweaterCalculateSettlement, sweaterRecordStatement, sweaterApproveSettlement,
  sweaterCreateAdjustment, sweaterApproveAdjustment, sweaterRecordCollection,
  sweaterCloseSettlement, sweaterResolveVariance,
} from '../src/sweater/handlers.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-journey';
const PERIOD = '2026-05';

let app, db;

const COMPANY = {
  name: 'شركة هادي الغانم', vatNumber: '300000000000003',
  address: 'الرياض', vatRegistered: true,
};

/** رصيد حسابٍ عبر كل القيود: مدين − دائن. */
async function balanceOf(accountId) {
  const snap = await db.collection(COL.ENTRIES).get();
  let bal = 0;
  for (const doc of snap.docs) {
    for (const l of doc.data().lines || []) {
      if (String(l.accountId) === accountId) bal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
  }
  return Math.round(bal * 100) / 100;
}

/** هل كل قيدٍ متوازن؟ */
async function allEntriesBalanced() {
  const snap = await db.collection(COL.ENTRIES).get();
  return snap.docs.every((doc) => {
    const lines = doc.data().lines || [];
    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return Math.abs(dr - cr) < 0.01;
  });
}

const booking = (id, over = {}) => ({
  sspBookingId: id,
  serviceType: 'interior_exterior_wash',
  serviceDate: '2026-05-12',
  rawStatus: 'payment_collection',
  rawPaymentStatus: 'recorded',
  driverName: 'أحمد', region: 'الرياض',
  platformAmount: 23,
  ...over,
});

d('الرحلة الكاملة لتكامل سويتر', () => {
  beforeAll(async () => {
    process.env.SWEATER_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    app = initializeApp({ projectId: PROJECT }, 'sweater-journey');
    db = getFirestore(app);

    for (const c of [COL.ENTRIES, COL.LOCKS, COL.PERIODS, COL.AUDIT, COL.ACCOUNTS, 'counters',
      DOC_COL.DOCUMENTS, 'sales_document_sources', 'sweater_collections',
      ...Object.values(SW), 'sweater_price_list', 'sweater_recognition_policy',
      'sweater_adjustment_types', 'sweater_settlements', 'sweater_adjustments',
      'sweater_integration_keys']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }

    await seedChartOfAccounts(db, FieldValue, DEFAULT_CHART_OF_ACCOUNTS, { userId: 'acct1' });
    await db.collection('app_settings').doc('accounting').set({
      value: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: [] },
    });
    await db.collection(DOC_COL.SETTINGS).doc('company').set({ value: COMPANY });

    // الإعدادات المؤرخة تُزرع كما تُزرع في الإنتاج.
    for (const row of SWEATER_PRICE_SEED) {
      await db.collection('sweater_price_list').doc(row.serviceType).set({
        ...row, effectiveFrom: '2026-01-01', status: 'active', createdAt: '2026-01-01',
      });
    }
    await db.collection('sweater_recognition_policy').doc('default').set({
      ...RECOGNITION_POLICY_SEED, effectiveFrom: '2026-01-01', status: 'active',
    });
    for (const t of ADJUSTMENT_TYPE_SEED) {
      await db.collection('sweater_adjustment_types').doc(t.key).set({
        ...t, effectiveFrom: '2026-01-01', status: 'active',
      });
    }
  }, 120_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  it('الرحلة كاملةً، خطوةً خطوة', async () => {
    // ══ ١) وكيلٌ وهمي يوقّع دفعته ══════════════════════════════════════
    const key = await createIntegrationKey(db, FieldValue, { label: 'وكيل الاختبار', actor: 'admin1' });
    const records = [
      booking('B-1'), booking('B-2'),
      booking('B-3', { serviceType: 'polish' }),
      booking('B-4', { rawStatus: 'admin_cancelled' }),      // ملغى ⇒ مستبعد
      booking('B-5', { rawStatus: 'washing_started' }),      // غير نهائي ⇒ مراجعة
    ];
    const runId = 'run-journey-1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash = hashBody(records);

    const auth = await verifyIngestRequest(db, FieldValue, {
      keyId: key.keyId, timestamp, importRunId: runId, bodyHash,
      signature: computeSignature(key.secret, timestamp, runId, bodyHash),
    });
    expect(auth.scope).toBe('integration_ingest');

    // ══ ٢) الاستلام: خامٌ وتطبيع ومنع تكرار ═══════════════════════════
    const ingest = await ingestSweaterOperations(db, FieldValue, {
      importRunId: runId, agentStatus: 'ok',
      coverage: { rangeFrom: '2026-05-01', rangeTo: '2026-05-31', pageCount: 1,
        pagesFetched: 1, recordCount: records.length, isComplete: true },
      records,
    }, { actor: auth.principal });
    expect(ingest.counts.new).toBe(5);
    expect((await db.collection(SW.RAW).get()).size).toBe(5);

    // إعادة الدفعة نفسها: بلا أثر.
    const replay = await ingestSweaterOperations(db, FieldValue, {
      importRunId: runId, records,
      coverage: { rangeFrom: '2026-05-01', rangeTo: '2026-05-31', isComplete: true },
    });
    expect(replay.replay).toBe(true);
    expect((await db.collection(SW.RAW).get()).size).toBe(5);

    // ══ ٣) الاحتساب: مسودة تسوية ═════════════════════════════════════
    const calc = await sweaterCalculateSettlement(db, FieldValue, { periodKey: PERIOD }, { userId: 'acct1' });
    // غسلتان بـ٢٣ + تلميعة بـ٢٢٠ = ٢٦٦ إجمالاً؛ الصافي ٢٠+٢٠+١٩١٫٣ = ٢٣١٫٣
    expect(calc.figures.counts).toMatchObject({ eligible: 3, cancelled: 1, needsReview: 1 });
    expect(calc.figures.services).toMatchObject({ net: 231.3, vat: 34.7, gross: 266 });
    expect(calc.figures.netDue).toBe(266);
    // ولا قيد بعد — الاحتساب اشتقاق لا ترحيل.
    expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);

    // ══ ٤) خصمٌ معتمد بمستنده ═══════════════════════════════════════
    const adj = await sweaterCreateAdjustment(db, FieldValue, {
      adjustment: {
        typeKey: 'wrong_vehicle_documentation', amount: 50, effectiveDate: '2026-05-20',
        sspBookingId: 'B-1', documentUrl: 'https://example.test/doc.pdf',
        reasonAr: 'توثيق مركبة خاطئ',
      },
    }, { userId: 'acct1' });
    expect(adj.approvalStatus).toBe('pending_review');

    // قبل الاعتماد لا يدخل الحساب.
    const calc2 = await sweaterCalculateSettlement(db, FieldValue, { periodKey: PERIOD }, { userId: 'acct1' });
    expect(calc2.figures.netDue).toBe(266);
    expect(calc2.figures.pendingAdjustments).toBe(1);

    await sweaterApproveAdjustment(db, FieldValue, { adjustmentId: adj.adjustmentId }, { userId: 'acct1' });
    const calc3 = await sweaterCalculateSettlement(db, FieldValue, { periodKey: PERIOD }, { userId: 'acct1' });
    expect(calc3.figures.deductions).toBe(50);
    expect(calc3.figures.netDue).toBe(216);          // ٢٦٦ − ٥٠

    // ══ ٥) كشف سويتر والفرق ══════════════════════════════════════════
    const stmt = await sweaterRecordStatement(db, FieldValue, {
      periodKey: PERIOD, statedNetDue: 216,
    }, { userId: 'acct1' });
    expect(stmt.variance.matches).toBe(true);

    // ══ ٦) الاعتماد الشهري ⇒ قيدٌ متوازن ══════════════════════════════
    const approved = await sweaterApproveSettlement(db, FieldValue, { periodKey: PERIOD }, { userId: 'admin1' });
    expect(approved.entryNumber).toBeGreaterThan(0);
    expect(await allEntriesBalanced()).toBe(true);

    expect(await balanceOf(ACC.SWEATER_REVENUE)).toBe(-231.3);   // دائن
    expect(await balanceOf(ACC.OUTPUT_VAT)).toBe(-34.7);
    // الذمّة: ٢٦٦ من الخدمات − ٥٠ من الخصم = ٢١٦
    expect(await balanceOf(ACC.SWEATER_RECEIVABLE)).toBe(216);
    expect(await balanceOf(ACC.SWEATER_DEDUCTIONS)).toBe(50);    // مدين (مقابل)

    // واعتمادٌ ثانٍ للشهر نفسه مستحيل.
    await expect(sweaterApproveSettlement(db, FieldValue, { periodKey: PERIOD }, { userId: 'admin1' }))
      .rejects.toThrow();

    // ══ ٧) الفاتورة: توثّق ولا تُرحِّل ════════════════════════════════
    const entriesBefore = (await db.collection(COL.ENTRIES).get()).size;
    const revenueBefore = await balanceOf(ACC.SWEATER_REVENUE);

    const doc = await issueDocument(db, FieldValue, {
      type: 'invoice',
      settlementPeriodKey: PERIOD,
      issueDate: '2026-06-01', issueTime: '10:00:00',
      lines: [{ description: `خدمات سويتر — ${PERIOD}`, quantity: 1, unitPrice: 266 }],
      customer: { name: 'منصة سويتر' },
    }, { userId: 'acct1' });
    expect(doc.documentNumber).toMatch(/^INV-2026-/);

    // الادعاء: لا قيدَ جديد ولا ريالَ إيرادٍ ثانٍ.
    expect((await db.collection(COL.ENTRIES).get()).size).toBe(entriesBefore);
    expect(await balanceOf(ACC.SWEATER_REVENUE)).toBe(revenueBefore);
    const docRow = (await db.collection(DOC_COL.DOCUMENTS).doc(doc.id).get()).data();
    expect(docRow.journalEntryId).toBeNull();
    expect(docRow.linkedJournalEntryId).toBe(approved.entryId);

    // وفاتورةٌ ثانية للشهر نفسه تُرفض — المطالبة واحدة.
    await expect(issueDocument(db, FieldValue, {
      type: 'invoice', settlementPeriodKey: PERIOD,
      issueDate: '2026-06-02', issueTime: '10:00:00',
      lines: [{ description: 'مكرر', quantity: 1, unitPrice: 266 }],
    }, { userId: 'acct1' })).rejects.toThrow();

    // ══ ٨) التحصيل البنكي ⇒ الذمّة تصفر ══════════════════════════════
    await sweaterRecordCollection(db, FieldValue, {
      periodKey: PERIOD, amount: 216, receivedDate: '2026-06-10',
      bankAccountId: ACC.BANK, reference: 'TRF-9911',
    }, { userId: 'acct1' });

    expect(await balanceOf(ACC.BANK)).toBe(216);
    // ══ الادعاء الأخير ══
    expect(await balanceOf(ACC.SWEATER_RECEIVABLE)).toBe(0);
    expect(await allEntriesBalanced()).toBe(true);

    // ══ ٩) الإقفال ═══════════════════════════════════════════════════
    const closed = await sweaterCloseSettlement(db, FieldValue,
      { periodKey: PERIOD }, { userId: 'admin1', role: 'admin' });
    expect(closed.status).toBe('closed');

    // ══ ١٠) والحصيلة: إيراد الشهر أُثبت مرة واحدة ═════════════════════
    const revenueEntries = (await db.collection(COL.ENTRIES).get()).docs
      .flatMap((x) => (x.data().lines || []))
      .filter((l) => String(l.accountId) === ACC.SWEATER_REVENUE);
    expect(revenueEntries).toHaveLength(1);
    expect(revenueEntries[0].credit).toBe(231.3);
  }, 300_000);
});

d('الإقفال مع فرقٍ غير محلول', () => {
  let app2, db2;
  beforeAll(async () => {
    app2 = initializeApp({ projectId: `${PROJECT}-var` }, 'sweater-journey-var');
    db2 = getFirestore(app2);
    for (const c of ['sweater_settlements', 'sweater_variances', COL.AUDIT]) {
      const snap = await db2.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
    await db2.collection('sweater_settlements').doc('2026-07').set({
      periodKey: '2026-07', status: 'collected', figures: { netDue: 100 },
    });
    await db2.collection('sweater_variances').doc('v1').set({
      periodKey: '2026-07', kind: 'statement_vs_expected', difference: -12, resolution: 'unresolved',
    });
  }, 60_000);
  afterAll(async () => { if (app2) await deleteApp(app2); });

  it('المحاسب لا يُقفل على فرقٍ غير محلول', async () => {
    await expect(sweaterCloseSettlement(db2, FieldValue, { periodKey: '2026-07' },
      { userId: 'acct1', role: 'accountant' })).rejects.toThrow(/قرار المدير/);
  }, 60_000);

  it('والمدير لا يُقفل بلا سببٍ مكتوب', async () => {
    await expect(sweaterCloseSettlement(db2, FieldValue, { periodKey: '2026-07' },
      { userId: 'admin1', role: 'admin' })).rejects.toThrow(/سبباً مكتوباً/);
  }, 60_000);

  it('ويُقفل بالسبب — ويبقى العدد والسبب في التدقيق', async () => {
    const r = await sweaterCloseSettlement(db2, FieldValue,
      { periodKey: '2026-07', reason: 'فرقٌ بـ١٢ ريالاً قيد التفاوض مع سويتر' },
      { userId: 'admin1', role: 'admin' });
    expect(r.closedWithUnresolvedVariances).toBe(1);

    const audits = (await db2.collection(COL.AUDIT).get()).docs.map((x) => x.data())
      .filter((a) => a.action === 'sweater.closeSettlement');
    expect(audits).toHaveLength(1);
    expect(audits[0].note).toContain('قيد التفاوض');
  }, 60_000);

  it('وحسمُ فرقٍ بلا سبب يُرفض', async () => {
    await expect(sweaterResolveVariance(db2, FieldValue,
      { varianceId: 'v1', resolution: 'accepted' }, { userId: 'acct1' }))
      .rejects.toThrow(/بلا سبب/);
  }, 60_000);
});
