/**
 * اختبارات الأصول والإهلاك على المحاكي.
 *
 * The unit suite proves the SCHEDULE. This proves the part that only a real
 * database can: that running the monthly charge twice does not depreciate the
 * month twice, that the backlog sweep is resumable, and that a disposal
 * closes the asset and its accumulated depreciation together.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, getDocs, deleteDoc, terminate,
} from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let db, ledger, assetsApi, dep, reports;

const WASHER = {
  name: 'ماكينة ضغط عالي', cost: 12000, salvageValue: 0,
  usefulLifeMonths: 60, inServiceDate: '2026-01-15',
};

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters', 'fixed_assets']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

d('سجل الأصول والإهلاك على Firestore الحقيقي', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    ledger   = await import('../firestoreLedger');
    assetsApi = await import('../firestoreAssets');
    dep      = await import('../depreciation');
    reports  = await import('../reports');
  }, 60_000);

  afterAll(async () => { if (db) await terminate(db); });

  beforeEach(async () => {
    await wipe();
    await ledger.seedChartOfAccounts({ userId: 'u1' });
  }, 60_000);

  it('يضيف أصلاً ويرفض أصلاً غير قابل للجدولة', async () => {
    const { id } = await assetsApi.createAsset(WASHER, { userId: 'u1' });
    expect(id).toBeTruthy();
    const saved = await assetsApi.fetchAsset(id);
    expect(saved.cost).toBe(12000);
    expect(saved.expenseAccount).toBe('5400');

    await expect(assetsApi.createAsset({ ...WASHER, usefulLifeMonths: 0 }))
      .rejects.toThrow(/شهراً واحداً/);
    await expect(assetsApi.createAsset({ ...WASHER, salvageValue: 20000 }))
      .rejects.toThrow(/تقل عن التكلفة/);
  }, 60_000);

  it('يرحّل إهلاك الشهر بقيد متوازن مؤرَّخ في آخر يوم منه', async () => {
    await assetsApi.createAsset(WASHER, { userId: 'u1' });
    const r = await assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' });
    expect(r.total).toBe(200);
    expect(r.assetCount).toBe(1);

    const lines = await ledger.fetchLinesOf(r.entryId);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === '5400').debit).toBe(200);
    expect(lines.find((l) => l.accountId === '1510').credit).toBe(200);

    const entries = await ledger.fetchEntries();
    const entry = entries.find((e) => e.id === r.entryId);
    expect(entry.entryDate).toBe('2026-01-31');
    expect(entry.sourceType).toBe('depreciation');
    expect(entry.sourceId).toBe('2026-01');
  }, 60_000);

  it('لا يُهلك الشهر مرتين', async () => {
    await assetsApi.createAsset(WASHER, { userId: 'u1' });
    await assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' });
    await expect(assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' }))
      .rejects.toThrow(/مُرحّل بالفعل/);

    const entries = await ledger.fetchEntries();
    expect(entries.filter((e) => e.sourceType === 'depreciation')).toHaveLength(1);
  }, 90_000);

  it('يرفض شهراً بلا استحقاق بدل ترحيل قيد فارغ', async () => {
    await assetsApi.createAsset(WASHER, { userId: 'u1' });
    await expect(assetsApi.postDepreciationForPeriod('2025-06', { userId: 'u1' }))
      .rejects.toThrow(/لا يوجد إهلاك مستحق/);
  }, 60_000);

  it('يرحّل المتأخر شهراً بشهر ويستأنف من حيث توقّف', async () => {
    await assetsApi.createAsset({ ...WASHER, usefulLifeMonths: 4 }, { userId: 'u1' });
    // One month posted by hand first — the sweep must skip it, not redo it.
    await assetsApi.postDepreciationForPeriod('2026-02', { userId: 'u1' });

    const r = await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-04' });
    expect(r.failed).toEqual([]);
    expect(r.posted.map((p) => p.periodKey).sort()).toEqual(['2026-01', '2026-03', '2026-04']);

    const posted = await assetsApi.postedDepreciationPeriods();
    expect([...posted].sort()).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);

    // Four months × 3000 = the whole asset, and running again does nothing.
    const again = await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-04' });
    expect(again.posted).toHaveLength(0);
  }, 120_000);

  it('مجمّع الإهلاك في الدفاتر يطابق الجدول', async () => {
    await assetsApi.createAsset({ ...WASHER, usefulLifeMonths: 3, cost: 10000 }, { userId: 'u1' });
    await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-03' });

    const { accounts, entries, lines } = await ledger.fetchLedgerBundle();
    const tb = reports.trialBalance(accounts, entries, lines);
    expect(tb.balanced).toBe(true);
    const accum = tb.rows.find((r) => r.code === '1510');
    // The schedule totals exactly the depreciable base — no rounding drift.
    expect(accum.balanceCredit).toBe(10000);
  }, 120_000);

  it('لا يُعاد تسعير أصل بعد ترحيل إهلاكه', async () => {
    const { id } = await assetsApi.createAsset(WASHER, { userId: 'u1' });
    // Editable while nothing is posted.
    await assetsApi.updateAsset(id, { cost: 15000 }, { userId: 'u1' });
    expect((await assetsApi.fetchAsset(id)).cost).toBe(15000);

    await assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' });
    await expect(assetsApi.updateAsset(id, { cost: 20000 }, { userId: 'u1' }))
      .rejects.toThrow(/بعد ترحيل قيود إهلاك/);
    // A non-structural edit still goes through.
    await assetsApi.updateAsset(id, { name: 'ماكينة ضغط — الفرع' }, { userId: 'u1' });
    expect((await assetsApi.fetchAsset(id)).name).toBe('ماكينة ضغط — الفرع');
  }, 120_000);

  it('الاستبعاد يقفل الأصل ومجمّعه ويسجّل الربح', async () => {
    const { id } = await assetsApi.createAsset(WASHER, { userId: 'u1' });
    await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-12' });

    const r = await assetsApi.disposeAsset(id, {
      disposalDate: '2027-01-10', proceeds: 11000, userId: 'u1',
    });
    expect(r.accumulated).toBe(2400);
    expect(r.bookValue).toBe(9600);
    expect(r.result).toBe(1400);

    const saved = await assetsApi.fetchAsset(id);
    expect(saved.disposalDate).toBe('2027-01-10');
    expect(saved.active).toBe(false);

    // Nothing of the asset is left on the books.
    const { accounts, entries, lines } = await ledger.fetchLedgerBundle();
    const tb = reports.trialBalance(accounts, entries, lines);
    expect(tb.balanced).toBe(true);
    const fixed = tb.rows.find((r2) => r2.code === '1500');
    const accum = tb.rows.find((r2) => r2.code === '1510');
    expect(fixed?.balanceDebit || 0).toBe(0);
    expect(accum?.balanceCredit || 0).toBe(0);
  }, 180_000);

  it('يرفض الاستبعاد قبل ترحيل إهلاك الأصل حتى تاريخه', async () => {
    const { id } = await assetsApi.createAsset(WASHER, { userId: 'u1' });
    // Jan and Feb are owed but unposted; disposing now would debit 1510 by
    // 400 that is not there.
    await expect(assetsApi.disposeAsset(id, { disposalDate: '2026-03-10', userId: 'u1' }))
      .rejects.toThrow(/يجب ترحيل إهلاك 2 شهر/);

    await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-02' });
    const r = await assetsApi.disposeAsset(id, {
      disposalDate: '2026-03-10', proceeds: 0, userId: 'u1',
    });
    expect(r.accumulated).toBe(400);

    // Accumulated depreciation in the BOOKS is what the disposal closed out.
    const { accounts, entries, lines } = await ledger.fetchLedgerBundle();
    const tb = reports.trialBalance(accounts, entries, lines);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((x) => x.code === '1510')?.balanceCredit || 0).toBe(0);
  }, 180_000);

  it('لا يُستبعد الأصل مرتين، ولا يُهلك بعد استبعاده', async () => {
    const { id } = await assetsApi.createAsset(WASHER, { userId: 'u1' });
    await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-02' });
    await assetsApi.disposeAsset(id, { disposalDate: '2026-03-10', proceeds: 0, userId: 'u1' });
    await expect(assetsApi.disposeAsset(id, { disposalDate: '2026-04-10', userId: 'u1' }))
      .rejects.toThrow(/مستبعد بالفعل/);

    // The disposed asset owes nothing from March on — it left in March.
    const assets = await assetsApi.fetchAssets();
    expect(dep.depreciationForPeriod(assets, '2026-03').total).toBe(0);
  }, 180_000);

  it('يرصد أصلاً أُضيف بأثر رجعي بعد ترحيل شهوره', async () => {
    await assetsApi.createAsset(WASHER, { userId: 'u1' });
    await assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' });

    // A second asset back-dated INTO the month that was just charged: the
    // sweep will never revisit that month, so the miss must be reported.
    await assetsApi.createAsset({
      name: 'مكنسة', cost: 3600, usefulLifeMonths: 36, inServiceDate: '2026-01-05',
    }, { userId: 'u1' });

    const { assets, entries } = await assetsApi.fetchAssetBundle();
    const lines = await ledger.fetchLines();
    const diffs = dep.reconcileDepreciation(assets, entries, lines);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ periodKey: '2026-01', posted: 200, expected: 300, difference: 100 });

    // And the backlog sweep does NOT quietly re-post the month.
    const r = await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-01' });
    expect(r.posted).toHaveLength(0);
  }, 120_000);

  it('لا يستورد الأصل من نفس المصدر مرتين', async () => {
    const first = await assetsApi.importAssetFromSource({
      sourceType: 'startup_cost', sourceId: 's1', name: 'مضخة',
      cost: 6000, inServiceDate: '2026-02-01', usefulLifeMonths: 60,
    });
    expect(first.created).toBe(true);
    const again = await assetsApi.importAssetFromSource({
      sourceType: 'startup_cost', sourceId: 's1', name: 'مضخة',
      cost: 6000, inServiceDate: '2026-02-01', usefulLifeMonths: 60,
    });
    expect(again.created).toBe(false);
    expect(again.id).toBe(first.id);
    expect(await assetsApi.fetchAssets()).toHaveLength(1);
  }, 90_000);

  it('لا يُرحَّل الإهلاك في فترة مقفلة، ويستأنف المتأخر بعد تخطّيها', async () => {
    await assetsApi.createAsset({ ...WASHER, usefulLifeMonths: 3 }, { userId: 'u1' });
    // Close January with nothing in it — the month is filed, so its charge
    // can no longer be recorded there.
    await ledger.closePeriod('2026-01', { userId: 'u1' });
    await expect(assetsApi.postDepreciationForPeriod('2026-01', { userId: 'u1' }))
      .rejects.toThrow(/مقفلة/);

    // The sweep reports January as a failure instead of stranding the rest.
    const r = await assetsApi.postDepreciationBacklog({ userId: 'u1', through: '2026-03' });
    expect(r.posted.map((p) => p.periodKey)).toEqual(['2026-02', '2026-03']);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].periodKey).toBe('2026-01');
    expect(r.failed[0].reason).toMatch(/مقفلة/);
  }, 120_000);
});
