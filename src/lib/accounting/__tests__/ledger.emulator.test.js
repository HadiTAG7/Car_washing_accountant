/**
 * اختبارات تكامل على محاكي Firestore — the real transaction layer.
 *
 * The unit suites prove the accounting POLICY. These prove the parts that
 * only a real database can: that a transaction is actually atomic, that two
 * concurrent posts cannot mint the same entry number, that a closed period
 * is rejected by the code path the app uses, and that a reversal marks the
 * original without touching its lines.
 *
 * Requires the emulator:
 *   npx firebase emulators:exec --only firestore --project demo-sweater "npm run test:emulator"
 *
 * Skipped automatically when FIRESTORE_EMULATOR_HOST is unset, so `npm test`
 * stays runnable without one.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDoc, getDocs,
  query, where, setDoc, deleteDoc, terminate,
} from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

// The production module owns the Firestore instance. Rather than substitute
// it — ES module bindings are read-only — we import it first and point ITS
// instance at the emulator, so these tests exercise the real code path.
let db, ledger, rules, postingRules;

async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

d('طبقة الترحيل على Firestore الحقيقي', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    // Must happen before any other operation on this instance.
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    ledger = await import('../firestoreLedger');
    postingRules = await import('../postingRules');
    rules = await import('../journal');
  }, 60_000);

  afterAll(async () => {
    if (db) await terminate(db);
  });

  beforeEach(async () => { await wipe(); }, 30_000);

  it('يهيّئ دليل الحسابات ولا يكرّره عند إعادة التشغيل', async () => {
    const first = await ledger.seedChartOfAccounts({ userId: 'u1' });
    expect(first.created).toBeGreaterThan(10);
    const again = await ledger.seedChartOfAccounts({ userId: 'u1' });
    expect(again.created).toBe(0);           // idempotent
    const accounts = await ledger.fetchAccounts();
    const codes = accounts.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);   // no duplicates
    expect(codes).toContain('1010');
    expect(codes).toContain('2100');
  }, 60_000);

  it('يكتب القيد وسطوره والفترة والتدقيق في معاملة واحدة', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    const built = postingRules.buildWashEntry({
      id: 'w1', quantity: 2, price: 57.5, status: 'مكتملة',
      washDate: '2026-08-11', paymentMethod: 'cash',
    });
    const res = await ledger.postEntry(built, { userId: 'u1' });
    expect(res.entryNumber).toBe(1);

    const entry = await getDoc(doc(db, 'journal_entries', res.entryId));
    expect(entry.data().status).toBe('posted');
    expect(entry.data().periodKey).toBe('2026-08');

    const lines = await ledger.fetchLinesOf(res.entryId);
    expect(lines).toHaveLength(3);
    expect(rules.isBalanced(lines)).toBe(true);

    // The period was created lazily by the same transaction.
    const period = await getDoc(doc(db, 'accounting_periods', '2026-08'));
    expect(period.exists()).toBe(true);
    expect(period.data().status).toBe('open');

    const audit = await getDocs(query(collection(db, 'audit_logs'), where('action', '==', 'post')));
    expect(audit.size).toBe(1);
  }, 60_000);

  it('يرفض قيداً غير متوازن ولا يترك أي أثر', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await expect(ledger.postEntry({
      entry: { entryDate: '2026-08-11', sourceType: 'manual', description: 'مختل' },
      lines: [
        { accountId: '1010', debit: 100, credit: 0 },
        { accountId: '4000', debit: 0, credit: 90 },
      ],
    }, { userId: 'u1' })).rejects.toThrow(/غير متوازن/);

    // Nothing partial was written.
    expect((await getDocs(collection(db, 'journal_entries'))).size).toBe(0);
    expect((await getDocs(collection(db, 'journal_lines'))).size).toBe(0);
  }, 60_000);

  it('أرقام القيود متسلسلة وفريدة تحت التزامن', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    const make = (i) => postingRules.buildWashEntry({
      id: `w${i}`, quantity: 1, price: 115, status: 'مكتملة',
      washDate: '2026-08-11', paymentMethod: 'cash',
    });
    // Fired together: without a transaction these would collide on the
    // counter and produce duplicate numbers.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => ledger.postEntry(make(i), { userId: 'u1' })),
    );
    const numbers = results.map((r) => r.entryNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);              // all unique
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);  // and contiguous
  }, 120_000);

  it('يمنع الترحيل في فترة مقفلة', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await setDoc(doc(db, 'accounting_periods', '2026-07'), {
      periodKey: '2026-07', status: 'closed', closedAt: null, closedBy: 'u1',
    });
    const built = postingRules.buildWashEntry({
      id: 'w9', quantity: 1, price: 115, status: 'مكتملة', washDate: '2026-07-15',
    });
    await expect(ledger.postEntry(built, { userId: 'u1' })).rejects.toThrow(/مقفلة/);
    expect((await getDocs(collection(db, 'journal_entries'))).size).toBe(0);
  }, 60_000);

  it('العكس يضيف قيداً مرآة ويؤشّر الأصل دون المساس بسطوره', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    const built = postingRules.buildWashEntry({
      id: 'w1', quantity: 2, price: 57.5, status: 'مكتملة', washDate: '2026-08-11',
    });
    const orig = await ledger.postEntry(built, { userId: 'u1' });
    const origLinesBefore = await ledger.fetchLinesOf(orig.entryId);

    const rev = await ledger.reverseEntry(orig.entryId, {
      entryDate: '2026-09-01', userId: 'u1',
    });

    const origAfter = await getDoc(doc(db, 'journal_entries', orig.entryId));
    expect(origAfter.data().status).toBe('reversed');
    expect(origAfter.data().reversedBy).toBe(rev.entryId);

    // The original's lines are untouched — the trail must show what was filed.
    const origLinesAfter = await ledger.fetchLinesOf(orig.entryId);
    expect(origLinesAfter.map((l) => [l.accountId, l.debit, l.credit]).sort())
      .toEqual(origLinesBefore.map((l) => [l.accountId, l.debit, l.credit]).sort());

    // Net effect across both entries is zero on every account.
    const revLines = await ledger.fetchLinesOf(rev.entryId);
    const net = new Map();
    for (const l of [...origLinesAfter, ...revLines]) {
      net.set(l.accountId, (net.get(l.accountId) || 0) + l.debit - l.credit);
    }
    for (const v of net.values()) expect(rules.round2(v)).toBe(0);
  }, 60_000);

  it('لا يُعكس قيد مرحّل مرتين', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    const orig = await ledger.postEntry(postingRules.buildWashEntry({
      id: 'w1', quantity: 1, price: 115, status: 'مكتملة', washDate: '2026-08-11',
    }), { userId: 'u1' });
    await ledger.reverseEntry(orig.entryId, { entryDate: '2026-09-01', userId: 'u1' });
    await expect(ledger.reverseEntry(orig.entryId, { entryDate: '2026-09-02', userId: 'u1' }))
      .rejects.toThrow(/غير مُرحّل|مُرحّل/);
  }, 60_000);

  it('الإقفال يفشل مع قيد غير متوازن وينجح بعد تصحيحه', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await ledger.postEntry(postingRules.buildWashEntry({
      id: 'w1', quantity: 1, price: 115, status: 'مكتملة', washDate: '2026-08-11',
    }), { userId: 'u1' });

    // Inject a broken entry the way a bad client would, bypassing postEntry.
    const badRef = doc(collection(db, 'journal_entries'));
    await setDoc(badRef, {
      entryDate: '2026-08-20', periodKey: '2026-08', status: 'posted',
      entryNumber: 999, sourceType: 'manual', description: 'مختل',
    });
    await setDoc(doc(collection(db, 'journal_lines')), { entryId: badRef.id, accountId: '1010', debit: 50, credit: 0 });
    await setDoc(doc(collection(db, 'journal_lines')), { entryId: badRef.id, accountId: '4000', debit: 0, credit: 40 });

    await expect(ledger.closePeriod('2026-08', { userId: 'u1' })).rejects.toThrow(/غير متوازن/);

    // Fix it, then the close succeeds.
    await setDoc(doc(collection(db, 'journal_lines')), { entryId: badRef.id, accountId: '4000', debit: 0, credit: 10 });
    const closed = await ledger.closePeriod('2026-08', { userId: 'u1' });
    expect(closed.periodKey).toBe('2026-08');
    const period = await getDoc(doc(db, 'accounting_periods', '2026-08'));
    expect(period.data().status).toBe('closed');
  }, 90_000);

  it('التقارير مبنية على القاعدة الحقيقية تتوازن', async () => {
    await ledger.seedChartOfAccounts({ userId: 'u1' });
    await ledger.postEntry(postingRules.buildPartnerPaymentEntry({
      id: 'pp1', partnerId: null, amount: 20000, paymentDate: '2026-07-03', paymentMethod: 'transfer',
    }, { usePartnerSubAccount: false }), { userId: 'u1' });
    await ledger.postEntry(postingRules.buildWashEntry({
      id: 'w1', quantity: 4, price: 57.5, status: 'مكتملة', washDate: '2026-08-05',
    }), { userId: 'u1' });
    await ledger.postEntry(postingRules.buildExpenseEntry({
      id: 'e1', description: 'مواد', amount: 230, date: '2026-08-10', isTaxInvoice: true,
    }, { expenseAccount: '5100' }), { userId: 'u1' });

    const { accounts, entries, lines } = await ledger.fetchLedgerBundle();
    const reports = await import('../reports');
    const tb = reports.trialBalance(accounts, entries, lines);
    expect(tb.balanced).toBe(true);
    expect(tb.unknownAccounts).toEqual([]);
    const bs = reports.balanceSheet(accounts, entries, lines);
    expect(bs.balanced).toBe(true);
  }, 90_000);
});
