/**
 * اختبارات السندات الدورية على المحاكي.
 *
 * The unit suite proves WHICH vouchers should exist. This proves the part
 * that only a real database can: that generating twice writes the same
 * documents rather than a second set, that a generated voucher is postable
 * like any other expense, and that a posted voucher is frozen.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDocs, setDoc, deleteDoc, terminate,
} from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let db, ledger, rec, ops, reports;

const RANGE = { from: '2026-01', through: '2026-03' };

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters', 'monthly_expenses', 'expense_vouchers']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

async function seedTemplates() {
  await setDoc(doc(db, 'monthly_expenses', 't1'), {
    expense_name: 'إيجار المحل', total_monthly_cost: 5000, payment_day: 5,
    recurrence: 'monthly', quantity: 1, unit_cost: 5000,
    is_tax_invoice: true, payment_status: 'pending',
  });
  await setDoc(doc(db, 'monthly_expenses', 't2'), {
    expense_name: 'إنترنت', total_monthly_cost: 345, payment_day: 31,
    recurrence: 'monthly', quantity: 1, unit_cost: 345,
    is_tax_invoice: true, payment_status: 'pending',
  });
  // A one-off row: already a document, so it must never generate vouchers.
  await setDoc(doc(db, 'monthly_expenses', 't3'), {
    expense_name: 'صيانة لمرة واحدة', total_monthly_cost: 900,
    recurrence: 'one_time', logged_date: '2026-02-14', payment_status: 'paid',
  });
}

d('السندات الدورية على Firestore الحقيقي', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    ledger  = await import('../firestoreLedger');
    rec     = await import('../firestoreRecurring');
    ops     = await import('../postOperations');
    reports = await import('../reports');
  }, 60_000);

  afterAll(async () => { if (db) await terminate(db); });

  beforeEach(async () => {
    await wipe();
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await seedTemplates();
  }, 60_000);

  it('يعاين قبل أن يُنشئ', async () => {
    const preview = await rec.previewGeneration(RANGE);
    expect(preview.toCreate).toHaveLength(6);        // 2 recurring × 3 months
    // Nothing was written by a preview.
    expect((await getDocs(collection(db, 'expense_vouchers'))).size).toBe(0);
  }, 60_000);

  it('ينشئ سنداً مؤرخاً لكل شهر ولا يكرره عند إعادة التشغيل', async () => {
    const first = await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    expect(first.created).toBe(6);
    expect(first.periods).toEqual(['2026-01', '2026-02', '2026-03']);

    const again = await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    expect(again.created).toBe(0);
    expect((await rec.fetchVouchers())).toHaveLength(6);
  }, 90_000);

  it('يقصر يوم الاستحقاق على آخر الشهر', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    const v = await rec.fetchVoucher('t2__2026-02');
    expect(v.dueDate).toBe('2026-02-28');       // not 2026-02-31
    expect((await rec.fetchVoucher('t2__2026-01')).dueDate).toBe('2026-01-31');
  }, 60_000);

  it('لا يولّد للقالب لمرة واحدة', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    const ids = (await rec.fetchVouchers()).map((v) => v.templateId);
    expect(ids).not.toContain('t3');
  }, 60_000);

  it('يكمل الفجوة وحدها بعد توسيع المدى', async () => {
    await rec.generateVouchers({ from: '2026-01', through: '2026-02', userId: 'u1' });
    const r = await rec.generateVouchers({ from: '2026-01', through: '2026-04', userId: 'u1' });
    expect(r.created).toBe(4);                  // March + April only
    expect((await rec.fetchVouchers())).toHaveLength(8);
  }, 90_000);

  it('السند يصبح قابلاً للترحيل، والقالب نفسه يبقى مستبعداً', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    const scan = await ops.collectUnposted();

    // Six vouchers plus the one-off row are ready; the two templates are not.
    expect(scan.ready.filter((r) => r.kind === 'voucher')).toHaveLength(6);
    const templateSkips = scan.skipped.filter((s) => /ولّد سنداً مؤرخاً/.test(s.reason));
    expect(templateSkips).toHaveLength(2);

    const posted = await ops.postUnposted({ userId: 'u1' });
    expect(posted.failed).toEqual([]);

    const { accounts, entries, lines } = await ledger.fetchLedgerBundle();
    expect(reports.trialBalance(accounts, entries, lines).balanced).toBe(true);

    // Three months of rent + internet, VAT split out of each.
    const voucherEntries = entries.filter((e) => String(e.sourceId).includes('__2026-'));
    expect(voucherEntries).toHaveLength(6);
    const rentJan = voucherEntries.find((e) => e.sourceId === 't1__2026-01');
    expect(rentJan.entryDate).toBe('2026-01-05');
    const rentLines = await ledger.fetchLinesOf(rentJan.id);
    // 5000 inclusive → 4347.83 net + 652.17 VAT, credited to the SUPPLIER
    // because the voucher is unpaid.
    expect(rentLines.find((l) => l.accountId === '5200').debit).toBe(4347.83);
    expect(rentLines.find((l) => l.accountId === '1200').debit).toBe(652.17);
    expect(rentLines.find((l) => l.accountId === '2000').credit).toBe(5000);
  }, 180_000);

  it('الترحيل مرتين لا يضاعف — نفس السند لا يُرحَّل إلا مرة', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    await ops.postUnposted({ userId: 'u1' });
    const before = (await ledger.fetchEntries()).length;
    const second = await ops.postUnposted({ userId: 'u1' });
    expect(second.posted).toHaveLength(0);
    expect((await ledger.fetchEntries())).toHaveLength(before);
  }, 180_000);

  it('السند المُرحَّل مُجمَّد', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    // Editable before posting.
    await rec.setVoucherPayment('t1__2026-01', { paymentStatus: 'paid', paidDate: '2026-01-05' });
    expect((await rec.fetchVoucher('t1__2026-01')).paymentStatus).toBe('paid');

    await ops.postUnposted({ userId: 'u1' });
    await expect(rec.setVoucherPayment('t1__2026-01', { paymentStatus: 'pending' }))
      .rejects.toThrow(/مُرحّل إلى الدفاتر/);
    await expect(rec.cancelVoucher('t1__2026-01', { reason: 'تراجع' }))
      .rejects.toThrow(/مُرحّل إلى الدفاتر/);
  }, 180_000);

  it('السند الملغى لا يُرحَّل ولا يختفي', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    await expect(rec.cancelVoucher('t1__2026-02', { reason: '' })).rejects.toThrow(/سبب/);
    await rec.cancelVoucher('t1__2026-02', { reason: 'المحل كان مغلقاً', userId: 'u1' });

    const scan = await ops.collectUnposted();
    expect(scan.ready.filter((r) => r.sourceId === 't1__2026-02')).toHaveLength(0);
    expect(scan.skipped.some((s) => s.reason === 'سند ملغى')).toBe(true);

    // Still there — the gap in a monthly series is itself information.
    const v = await rec.fetchVoucher('t1__2026-02');
    expect(v.status).toBe('cancelled');
    expect(v.cancelReason).toBe('المحل كان مغلقاً');

    await rec.restoreVoucher('t1__2026-02', { userId: 'u1' });
    expect((await rec.fetchVoucher('t1__2026-02')).status).toBe('active');
  }, 120_000);

  it('لا يُرحَّل سند في فترة مقفلة', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    await ledger.closePeriod('2026-01', { userId: 'u1' });
    const scan = await ops.collectUnposted();
    expect(scan.ready.filter((r) => String(r.sourceId).endsWith('2026-01'))).toHaveLength(0);
    expect(scan.skipped.some((s) => s.reason === 'الفترة 2026-01 مقفلة')).toBe(true);
  }, 120_000);
});
