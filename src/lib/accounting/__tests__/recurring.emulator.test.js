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

import { useServerTransport } from './_serverTransport';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let restoreTransport;
let db, ledger, rec, ops, reports;

const RANGE = { from: '2026-01', through: '2026-03' };

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters', 'posting_locks',
    'monthly_expenses', 'variable_expenses', 'expense_vouchers']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

async function seedTemplates() {
  await setDoc(doc(db, 'monthly_expenses', 't1'), {
    expense_name: 'إيجار المحل', total_monthly_cost: 5000, payment_day: 5,
    recurrence: 'monthly', quantity: 1, unit_cost: 5000,
    // The supplier is a property of the ARRANGEMENT and travels to every
    // voucher. The invoice number and date are properties of one document and
    // cannot be known when the voucher is generated.
    is_tax_invoice: true, payment_status: 'pending', supplier: 'مالك العقار',
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
    // Ledger writes go through the real server module — the app calls it
    // as a Cloud Function, which a test cannot.
    restoreTransport = useServerTransport();
    ledger  = await import('../firestoreLedger');
    rec     = await import('../firestoreRecurring');
    ops     = await import('../postOperations');
    reports = await import('../reports');
  }, 60_000);

  afterAll(async () => {
    if (restoreTransport) await restoreTransport();
    if (db) await terminate(db);
  });

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
    // ── سند بلا فاتورة بعد: لا أصل ضريبة مدخلات ──
    // The voucher exists on the due date; the supplier's invoice arrives
    // later. Until its number and date are recorded, the 1200 line is
    // withheld and the whole 5,000 is the cost — which is exactly what the
    // VAT report says about the same voucher. The two used to disagree: the
    // ledger reclaimed 652.17 and the return refused it, so the reclaim
    // existed only in the books.
    expect(rentLines.find((l) => l.accountId === '1200')).toBeUndefined();
    expect(rentLines.find((l) => l.accountId === '5200').debit).toBe(5000);
    expect(rentLines.find((l) => l.accountId === '2000').credit).toBe(5000);
  }, 180_000);

  it('وبعد تسجيل فاتورة السند تُفصل ضريبة المدخلات', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    // The supplier travelled from the template; the number and date arrive
    // with the paper, and this is the door they come through.
    const before = await rec.fetchVoucher('t1__2026-01');
    expect(before.supplier).toBe('مالك العقار');
    expect(before.invoiceNumber).toBe('');

    await rec.setVoucherInvoice('t1__2026-01', {
      invoiceNumber: 'R-2026-01', invoiceDate: '2026-01-05',
      supplier: 'مالك العقار', vatRate: 0.15, userId: 'u1',
    });

    const posted = await ops.postUnposted({ userId: 'u1' });
    expect(posted.failed).toEqual([]);
    const entries = await ledger.fetchEntries();
    const rentJan = entries.find((e) => e.sourceId === 't1__2026-01');
    const lines = await ledger.fetchLinesOf(rentJan.id);
    // 5000 شامل → 4347.83 صافي + 652.17 ضريبة، دائناً للمورّد لأن السند غير مسدَّد.
    expect(lines.find((l) => l.accountId === '5200').debit).toBe(4347.83);
    expect(lines.find((l) => l.accountId === '1200').debit).toBe(652.17);
    expect(lines.find((l) => l.accountId === '1200').description)
      .toBe('ضريبة مدخلات 15% — نسبة مثبتة على الفاتورة');
    expect(lines.find((l) => l.accountId === '2000').credit).toBe(5000);
  }, 180_000);

  it('ويُرفض مبلغ ضريبة غير صالح على السند بدل تحويله إلى null', async () => {
    await rec.generateVouchers({ ...RANGE, userId: 'u1' });
    await expect(rec.setVoucherInvoice('t1__2026-01', {
      invoiceNumber: 'R-1', invoiceDate: '2026-01-05', supplier: 'م', vatAmount: -5,
    })).rejects.toThrow(/سالب/);
    await expect(rec.setVoucherInvoice('t1__2026-01', {
      invoiceNumber: 'R-1', invoiceDate: '2026-02-30', supplier: 'م',
    })).rejects.toThrow(/التقويم/);
    // ولم يُكتب شيء.
    expect((await rec.fetchVoucher('t1__2026-01')).invoiceNumber).toBe('');
  }, 120_000);

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

  // Five collections post with `sourceType: 'expense'`. Before the kind was
  // recorded on the entry, whichever posted first made the other look
  // already-done — and it would never have reached the books.
  it('مصروف شهري ومتغيّر بنفس المعرّف: كلاهما غير مُرحّل، ثم كلٌّ مرة واحدة', async () => {
    await setDoc(doc(db, 'monthly_expenses', 'same-id'), {
      expense_name: 'إيجار', total_monthly_cost: 1150,
      logged_date: '2026-01-05', payment_status: 'paid',
    });
    await setDoc(doc(db, 'variable_expenses', 'same-id'), {
      expense_name: 'مواد', total_variable_cost: 230, logged_date: '2026-01-06',
    });

    const before = await ops.collectUnposted();
    const ready = before.ready.filter((r) => r.sourceId === 'same-id');
    expect(ready.map((r) => r.kind).sort()).toEqual(['monthly', 'variable']);

    const posted = await ops.postUnposted();
    expect(posted.failed).toEqual([]);
    const entries = await ledger.fetchEntries();
    const forId = entries.filter((e) => e.sourceId === 'same-id');
    expect(forId).toHaveLength(2);
    expect(forId.map((e) => e.sourceKind).sort()).toEqual(['monthly', 'variable']);
    // 1150 inclusive → 1000 net on 5200; 230 → 200 net on 5100.
    expect(forId.find((e) => e.sourceKind === 'monthly').totalDebit).toBe(1150);
    expect(forId.find((e) => e.sourceKind === 'variable').totalDebit).toBe(230);

    // And a second sweep adds nothing: each is now individually locked.
    const again = await ops.postUnposted();
    expect(again.posted).toHaveLength(0);
    expect((await ledger.fetchEntries()).filter((e) => e.sourceId === 'same-id')).toHaveLength(2);
  }, 180_000);
});