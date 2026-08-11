/**
 * اختبارات الترحيل التلقائي على المحاكي.
 *
 * The unit suite proves WHEN it should fire. This proves what happens when it
 * does: that it never throws, that it cannot double-post against the manual
 * sweep, and that a closed period or a broken record produces a surfaced
 * result instead of a silent nothing.
 *
 * Run: npm run test:emulator
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectFirestoreEmulator, collection, doc, getDocs, setDoc, deleteDoc, terminate,
} from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let db, ledger, auto, ops;

// The manual sweep reads EVERY operational collection, so this suite must
// clear all of them — otherwise a record left behind by another suite gets
// posted here and the entry counts stop meaning anything.
async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters',
    'washes', 'monthly_expenses', 'variable_expenses', 'annual_expense_entries',
    'startup_cost_entries', 'partner_payments', 'partners', 'temporary_expenses',
    'expense_vouchers', 'fixed_assets']) {
    const snap = await getDocs(collection(db, c));
    await Promise.all(snap.docs.map((s) => deleteDoc(s.ref)));
  }
}

const wash = (over = {}) => ({
  biker_name: 'أحمد', quantity: 2, price: 57.5, status: 'مكتملة',
  wash_date: '2026-08-11', payment_method: 'cash', ...over,
});

d('الترحيل التلقائي على Firestore الحقيقي', () => {
  beforeAll(async () => {
    const client = await import('../../firebaseClient');
    db = client.db;
    const [host, port] = EMU.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    ledger = await import('../firestoreLedger');
    auto   = await import('../autoPost');
    ops    = await import('../postOperations');
  }, 60_000);

  afterAll(async () => { if (db) await terminate(db); });

  beforeEach(async () => {
    await wipe();
    await ledger.seedChartOfAccounts({ userId: 'u1' });
  }, 60_000);

  it('يرحّل الغسلة لحظة اكتمالها', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash());
    const r = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(r.status).toBe('posted');
    expect(r.entryNumber).toBe(1);

    const lines = await ledger.fetchLinesOf(r.entryId);
    expect(lines.find((l) => l.accountId === '1010').debit).toBe(115);
    expect(lines.find((l) => l.accountId === '4000').credit).toBe(100);
    expect(lines.find((l) => l.accountId === '2100').credit).toBe(15);
  }, 60_000);

  it('لا يرحّل غسلة غير مكتملة، ويقول لماذا', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash({ status: 'قيد التنفيذ' }));
    const r = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/غير مكتملة/);
    expect((await ledger.fetchEntries())).toHaveLength(0);
  }, 60_000);

  it('استدعاؤه مرتين لا يُنتج قيدين', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash());
    await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    const second = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(second.status).toBe('skipped');
    expect(second.reason).toMatch(/مُرحّل مسبقاً/);
    expect((await ledger.fetchEntries())).toHaveLength(1);
  }, 90_000);

  it('لا يزدوج مع الترحيل اليدوي — المساران يتفقان على نفس الهوية', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash());
    await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });

    const scan = await ops.collectUnposted();
    expect(scan.ready.filter((x) => x.sourceId === 'w1')).toHaveLength(0);
    expect(scan.skipped.some((s) => s.reason === 'مُرحّل مسبقاً')).toBe(true);

    const swept = await ops.postUnposted({ userId: 'u1' });
    expect(swept.posted).toHaveLength(0);
    expect((await ledger.fetchEntries())).toHaveLength(1);
  }, 120_000);

  it('والعكس: ما رحّله المسح اليدوي لا يعيده التلقائي', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash());
    await ops.postUnposted({ userId: 'u1' });
    const r = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect((await ledger.fetchEntries())).toHaveLength(1);
  }, 120_000);

  it('الفترة المقفلة توقفه بنتيجة ظاهرة لا بصمت', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash({ wash_date: '2026-07-15' }));
    await ledger.closePeriod('2026-07', { userId: 'u1' });
    const r = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect(r.blocking).toBe(true);
    expect(r.reason).toMatch(/مقفلة/);
    expect(auto.autoPostTone(r)).toBe('error');
    expect((await ledger.fetchEntries())).toHaveLength(0);
  }, 90_000);

  it('السجل بلا تاريخ يعطي نتيجة حاجبة لا استثناءً', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash({ wash_date: '' }));
    const r = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect(r.blocking).toBe(true);
    expect(r.reason).toMatch(/تاريخ/);
  }, 60_000);

  it('السجل المفقود لا يرمي — الحفظ التشغيلي نجح بالفعل', async () => {
    const r = await auto.autoPost({ kind: 'wash', id: 'ghost', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/غير موجود/);
  }, 60_000);

  it('النوع غير المعروف يعود كإخفاق مصاغ لا كانهيار', async () => {
    const r = await auto.autoPost({ kind: 'لا-شيء', id: 'x', userId: 'u1' });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/نوع سجل غير معروف/);
  }, 60_000);

  it('يرحّل عند الانتقال فقط', async () => {
    await setDoc(doc(db, 'washes', 'w1'), wash());
    // Already completed before the save → not a transition, nothing posts.
    const noop = await auto.autoPostOnApproval({
      kind: 'wash', id: 'w1',
      before: { status: 'مكتملة' }, after: { status: 'مكتملة' }, userId: 'u1',
    });
    expect(noop).toBeNull();
    expect((await ledger.fetchEntries())).toHaveLength(0);

    const fired = await auto.autoPostOnApproval({
      kind: 'wash', id: 'w1',
      before: { status: 'قيد التنفيذ' }, after: { status: 'مكتملة' }, userId: 'u1',
    });
    expect(fired.status).toBe('posted');
  }, 90_000);

  it('يرحّل المصروف الشهري المؤرَّخ عند سداده', async () => {
    await setDoc(doc(db, 'monthly_expenses', 'm1'), {
      expense_name: 'صيانة', total_monthly_cost: 230, logged_date: '2026-08-03',
      recurrence: 'one_time', payment_status: 'paid', is_tax_invoice: true,
    });
    const r = await auto.autoPost({ kind: 'monthly', id: 'm1', userId: 'u1' });
    expect(r.status).toBe('posted');
    const lines = await ledger.fetchLinesOf(r.entryId);
    expect(lines.find((l) => l.accountId === '5200').debit).toBe(200);
    expect(lines.find((l) => l.accountId === '1200').debit).toBe(30);
    expect(lines.find((l) => l.accountId === '1010').credit).toBe(230);
  }, 60_000);

  it('والقالب المتكرر بلا تاريخ لا يُرحَّل تلقائياً', async () => {
    await setDoc(doc(db, 'monthly_expenses', 'm2'), {
      expense_name: 'إيجار', total_monthly_cost: 5000, recurrence: 'monthly',
      payment_status: 'paid', payment_day: 5,
    });
    const r = await auto.autoPost({ kind: 'monthly', id: 'm2', userId: 'u1' });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/ولّد سنداً مؤرخاً/);
  }, 60_000);
});
