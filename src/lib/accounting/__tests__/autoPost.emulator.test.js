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

import { useServerTransport } from './_serverTransport';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

let restoreTransport;
let db, ledger, auto, ops;

// The manual sweep reads EVERY operational collection, so this suite must
// clear all of them — otherwise a record left behind by another suite gets
// posted here and the entry counts stop meaning anything.
async function wipe() {
  for (const c of ['chart_of_accounts', 'journal_entries', 'journal_lines',
    'accounting_periods', 'audit_logs', 'counters', 'posting_locks',
    'washes', 'monthly_expenses', 'variable_expenses', 'annual_expense_entries',
    'startup_cost_entries', 'partner_payments', 'partners', 'temporary_expenses',
    'expense_vouchers', 'fixed_assets', 'app_settings']) {
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
    // Ledger writes go through the real server module — the app calls it
    // as a Cloud Function, which a test cannot.
    restoreTransport = useServerTransport();
    ledger = await import('../firestoreLedger');
    auto   = await import('../autoPost');
    ops    = await import('../postOperations');
  }, 60_000);

  afterAll(async () => {
    if (restoreTransport) await restoreTransport();
    if (db) await terminate(db);
  });

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

  // ═══════════════════════════════════════════════════════════════════════
  // الشهر السابق لا يتحرك بتغيير إعدادات الضريبة
  // ═══════════════════════════════════════════════════════════════════════
  describe('سياسة الضريبة بتاريخ سريان', () => {
    it('غسلة يوليو تُرحَّل بقواعد يوليو، وتغيير أغسطس لا يمسّها', async () => {
      await setDoc(doc(db, 'app_settings', 'accounting'), {
        value: { vatRegistered: true, washPriceMode: 'inclusive' },
      });
      await setDoc(doc(db, 'washes', 'july'), wash({ wash_date: '2026-07-20' }));
      const posted = await auto.autoPost({ kind: 'wash', id: 'july', userId: 'u1' });
      expect(posted.status).toBe('posted');

      const before = (await ledger.fetchEntries()).find((e) => e.id === posted.entryId);
      expect(before.taxSnapshot).toMatchObject({
        washPriceMode: 'inclusive', net: 100, vat: 15, gross: 115,
      });

      // The business re-quotes prices as VAT-exclusive from 1 August.
      await setDoc(doc(db, 'app_settings', 'accounting'), {
        value: {
          vatRegistered: true, washPriceMode: 'exclusive',
          taxPolicyHistory: [
            { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
            { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
          ],
        },
      });

      // July's entry is untouched, snapshot and lines alike.
      const after = (await ledger.fetchEntries()).find((e) => e.id === posted.entryId);
      expect(after.taxSnapshot).toEqual(before.taxSnapshot);
      expect(after.lines).toEqual(before.lines);

      // And a July wash posted NOW still files under July's rules.
      await setDoc(doc(db, 'washes', 'july2'), wash({ wash_date: '2026-07-25' }));
      const late = await auto.autoPost({ kind: 'wash', id: 'july2', userId: 'u1' });
      const lateLines = await ledger.fetchLinesOf(late.entryId);
      expect(lateLines.find((l) => l.accountId === '4000').credit).toBe(100);
      expect(lateLines.find((l) => l.accountId === '2100').credit).toBe(15);

      // While an August wash uses August's.
      await setDoc(doc(db, 'washes', 'august'), wash({ wash_date: '2026-08-20' }));
      const aug = await auto.autoPost({ kind: 'wash', id: 'august', userId: 'u1' });
      const augLines = await ledger.fetchLinesOf(aug.entryId);
      expect(augLines.find((l) => l.accountId === '4000').credit).toBe(115);
      expect(augLines.find((l) => l.accountId === '2100').credit).toBe(17.25);
    }, 150_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // صحّح وأعد الترحيل — من مسار العميل نفسه
  // ═══════════════════════════════════════════════════════════════════════
  // Not `postSource` directly. The whole failure lived in the CLIENT's reading
  // of the ledger: after a reversal the lock was gone, so the server would
  // have accepted a re-post — but `collectUnposted` and `autoPost` both found
  // the mirror entry (which carried the original's sourceType/sourceId) and
  // reported "مُرحّل مسبقاً", so nothing ever reached the server. The round
  // trip below is the only thing that proves the path is open.
  describe('عكس ثم تصحيح ثم إعادة ترحيل عبر مسار العميل', () => {
    it('الغسلة تعود قابلة للترحيل بعد العكس وتُرحَّل مرة واحدة', async () => {
      // ① posted through the client
      await setDoc(doc(db, 'washes', 'w1'), wash());
      const first = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
      expect(first.status).toBe('posted');

      // ...and the client agrees it is done.
      let collected = await ops.collectUnposted();
      expect(collected.ready.find((r) => r.sourceId === 'w1')).toBeUndefined();
      expect(collected.skipped.find((s) => s.kind === 'wash')?.reason).toBe('مُرحّل مسبقاً');
      expect(await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' }))
        .toMatchObject({ status: 'skipped', reason: expect.stringMatching(/مُرحّل مسبقاً/) });

      // ② reversed through the client
      await ledger.reverseEntry(first.entryId, { entryDate: '2026-08-15', userId: 'u1' });

      // ③ the CLIENT now sees it as unposted again — this is the assertion
      //    that used to fail, and the reason correcting a wash was impossible.
      const entries = await ledger.fetchEntries();
      expect(ledger.hasPostedEntryFor(entries, 'wash', 'w1', 'wash')).toBe(false);
      collected = await ops.collectUnposted();
      expect(collected.ready.find((r) => r.sourceId === 'w1')).toBeTruthy();

      // ④ corrected and re-posted
      await setDoc(doc(db, 'washes', 'w1'), wash({ price: 115 }));   // 2 × 115 = 230
      const second = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
      expect(second.status).toBe('posted');
      expect(second.entryId).not.toBe(first.entryId);

      // ⑤ exactly once — a third attempt is refused by the new lock
      expect(await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' }))
        .toMatchObject({ status: 'skipped', reason: expect.stringMatching(/مُرحّل مسبقاً/) });

      // ⑥ and the books show 200 of revenue: the first 100 and its mirror
      //    cancel, the correction stands.
      const all = await ledger.fetchEntries();
      expect(all).toHaveLength(3);
      const lines = await ledger.fetchLines();
      const byEntry = new Map(all.map((e) => [e.id, e]));
      const revenue = lines
        .filter((l) => l.accountId === '4000'
          && ['posted', 'reversed'].includes(byEntry.get(l.entryId)?.status))
        .reduce((s, l) => s + (l.credit || 0) - (l.debit || 0), 0);
      expect(Math.round(revenue * 100) / 100).toBe(200);
    }, 120_000);

    it('عكس قيد أقدم لا يفتح مصدراً يملكه قيد أحدث', async () => {
      await setDoc(doc(db, 'washes', 'w1'), wash());
      const first = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
      await ledger.reverseEntry(first.entryId, { entryDate: '2026-08-15', userId: 'u1' });
      const second = await auto.autoPost({ kind: 'wash', id: 'w1', userId: 'u1' });
      expect(second.status).toBe('posted');

      // The lock now belongs to the second entry. Reversing the FIRST one
      // again is refused outright (it is no longer posted), so there is no
      // path by which an old reversal frees a record the books still hold.
      await expect(ledger.reverseEntry(first.entryId, { entryDate: '2026-08-16', userId: 'u1' }))
        .rejects.toThrow(/غير مُرحّل/);
      const entries = await ledger.fetchEntries();
      expect(ledger.hasPostedEntryFor(entries, 'wash', 'w1', 'wash')).toBe(true);
    }, 120_000);
  });
});
