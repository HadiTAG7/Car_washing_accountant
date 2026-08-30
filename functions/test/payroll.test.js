import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  PAYROLL_ACCOUNTS,
  PAYROLL_POLICY,
  PAYROLL_STATUS,
  approvePayroll,
  calculatePayrollPreview,
  eligibleActualDays,
  payPayroll,
  payrollMonthBounds,
  reversePayroll,
  savePayrollDraft,
} from '../src/payroll.js';

const BIKER = (over = {}) => ({ id: 'b1', name: 'عامل أول', salary: 1000, start_date: '2026-08-01', ...over });
const ADVANCE = (over = {}) => ({
  id: 'a1', biker_id: 'b1', title: 'سلفة', amount: 200, recovered_amount: 0,
  status: 'pending', spent_date: '2026-08-05', recovered_date: null, ...over,
});

function preview(over = {}) {
  return calculatePayrollPreview({
    periodKey: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31',
    bikers: [BIKER()], washes: [], advances: [], adjustments: [],
    now: new Date('2026-09-01T00:00:00Z'), ...over,
  });
}

describe('احتساب مسير الرواتب — أيام الشهر الفعلية', () => {
  it('يثبت قرار المالك وتاريخ التوزيع في أول الشهر التالي', () => {
    const p = preview();
    expect(PAYROLL_POLICY.method).toBe('actual_month_days');
    expect(p.policySnapshot).toMatchObject({ method: 'actual_month_days', monthDays: 31, joinDayInclusive: true });
    expect(p.distributionDate).toBe('2026-09-01');
    expect(payrollMonthBounds('2026-12').distributionDate).toBe('2027-01-01');
  });

  it('من باشر أول الشهر يستحق الشهر كاملاً، ويوم المباشرة محسوب', () => {
    const p = preview();
    expect(p.lines[0]).toMatchObject({ daysEntitled: 31, monthDays: 31, basicDue: 1000 });
  });

  it('من باشر منتصف الشهر يُحسب من يوم المباشرة شاملاً', () => {
    const p = preview({ bikers: [BIKER({ start_date: '2026-08-16' })] });
    expect(p.lines[0]).toMatchObject({ daysEntitled: 16, basicDue: 516.13 });
  });

  it('الفترة القصيرة تستخدم أيامها الفعلية مع بقاء مقام الشهر الفعلي', () => {
    const p = preview({ periodStart: '2026-08-10', periodEnd: '2026-08-20' });
    expect(p.lines[0]).toMatchObject({ daysEntitled: 11, monthDays: 31, basicDue: 354.84 });
  });

  it('فبراير العادي والكبيس يدفعان راتب شهر كامل بدقة', () => {
    const ordinary = calculatePayrollPreview({
      periodKey: '2025-02', bikers: [BIKER({ start_date: '2025-02-01' })], washes: [], advances: [], adjustments: [],
    });
    const leap = calculatePayrollPreview({
      periodKey: '2024-02', bikers: [BIKER({ start_date: '2024-02-01' })], washes: [], advances: [], adjustments: [],
    });
    expect(ordinary.lines[0]).toMatchObject({ daysEntitled: 28, monthDays: 28, basicDue: 1000 });
    expect(leap.lines[0]).toMatchObject({ daysEntitled: 29, monthDays: 29, basicDue: 1000 });
  });

  it('نهاية الشهر تُحسم بتوقيت الرياض لا UTC', () => {
    const p = preview({ now: new Date('2026-08-31T21:30:00.000Z') });
    expect(p.estimated).toBe(false);
  });

  it('تاريخ نهاية الخدمة محسوب ضمن الأيام ولا يغير السجلات التي لا تحمله', () => {
    const ended = preview({ bikers: [BIKER({ end_date: '2026-08-20' })] });
    expect(ended.lines[0]).toMatchObject({ daysEntitled: 20, basicDue: 645.16, eligibleEnd: '2026-08-20' });
    expect(eligibleActualDays({ periodKey: '2026-08', startDate: '', endDate: '' }).daysEntitled).toBe(31);
  });

  it('عمولة وبونص وخصم وسلفة ينتجون الصافي الصحيح بالهللة', () => {
    const p = preview({
      washes: [{ id: 'w1', biker_id: 'b1', wash_date: '2026-08-12', status: 'مكتملة', quantity: 3 }],
      advances: [ADVANCE({ recovered_amount: 50 })],
      adjustments: [{ bikerId: 'b1', bonus: 25.55, bonusReason: 'تميز', deduction: 10.10, deductionReason: 'غياب', advanceDeduction: 120.22 }],
    });
    expect(p.lines[0]).toMatchObject({
      basicDue: 1000, commission: 6, bonus: 25.55, deduction: 10.1,
      advanceOutstanding: 150, advanceDeduction: 120.22, netDue: 901.23,
    });
    expect(p.totals.net).toBe(901.23);
  });

  it('السبب إلزامي للبونص والخصم، ولا تخصم السلفة أكثر من رصيدها', () => {
    expect(() => preview({ adjustments: [{ bikerId: 'b1', bonus: 1 }] })).toThrow(/سبب البونص/);
    expect(() => preview({ adjustments: [{ bikerId: 'b1', deduction: 1 }] })).toThrow(/سبب الخصم/);
    expect(() => preview({ advances: [ADVANCE()], adjustments: [{ bikerId: 'b1', advanceDeduction: 201 }] })).toThrow(/يتجاوز الرصيد/);
  });

  it('يسمح بصافي صفر ويمنع الصافي السالب أو تحويله إلى دين ضمني', () => {
    const zero = preview({ bikers: [BIKER({ salary: 100 })], advances: [ADVANCE({ amount: 100 })], adjustments: [{ bikerId: 'b1', advanceDeduction: 100 }] });
    expect(zero.lines[0].netDue).toBe(0);
    expect(() => preview({ bikers: [BIKER({ salary: 100 })], advances: [ADVANCE({ amount: 101 })], adjustments: [{ bikerId: 'b1', advanceDeduction: 101 }] })).toThrow(/سالباً/);
    expect(() => preview({ bikers: [BIKER({ salary: 100 })], adjustments: [{ bikerId: 'b1', deduction: 101, deductionReason: 'قرار' }] })).toThrow(/تتجاوز مستحقاته/);
  });
});

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
let app; let db;
const COLLECTIONS = [
  'bikers', 'washes', 'temporary_expenses', 'payroll_runs', 'payroll_periods',
  'payroll_payment_locks', 'journal_entries', 'accounting_periods', 'counters',
  'audit_logs', 'chart_of_accounts',
];

async function wipe() {
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map(async (doc) => {
      if (name === 'payroll_runs') {
        const items = await doc.ref.collection('items').get();
        await Promise.all(items.docs.map((item) => item.ref.delete()));
      }
      await doc.ref.delete();
    }));
  }
}

async function seed() {
  await db.collection('bikers').doc('b1').set({ name: 'عامل أول', salary: 1000, start_date: '2026-08-01' });
  await db.collection('washes').doc('w1').set({ biker_id: 'b1', wash_date: '2026-08-10', status: 'مكتملة', quantity: 5 });
  await db.collection('temporary_expenses').doc('a1').set({
    biker_id: 'b1', title: 'سلفة', amount: 200, recovered_amount: 0, status: 'pending',
    spent_date: '2026-08-05', recovered_date: null, recovery_method: null,
  });
}

async function draftAndApprove({ advanceDeduction = 100, now = new Date('2026-09-01T08:00:00Z') } = {}) {
  const saved = await savePayrollDraft(db, FieldValue, {
    periodKey: '2026-08', adjustments: [{ bikerId: 'b1', advanceDeduction }],
  }, { userId: 'acct', now });
  const approved = await approvePayroll(db, FieldValue, { runId: saved.runId }, { userId: 'admin', now });
  return { saved, approved };
}

d('مسير الرواتب — المعاملات الذرية', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-sweater-payroll' }, 'payroll-test');
    db = getFirestore(app);
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => { await wipe(); await seed(); }, 60_000);

  it('الاعتماد يثبت اللقطات ولا ينشئ قيداً', async () => {
    const { saved } = await draftAndApprove();
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
    const run = (await db.collection('payroll_runs').doc(saved.runId).get()).data();
    const item = (await db.collection('payroll_runs').doc(saved.runId).collection('items').doc('b1').get()).data();
    expect(run).toMatchObject({ status: PAYROLL_STATUS.APPROVED, distributionDate: '2026-09-01' });
    expect(run.policySnapshot).toMatchObject({ method: 'actual_month_days', monthDays: 31 });
    expect(run.distributionSnapshot).toEqual({
      rule: 'first_day_of_following_month', date: '2026-09-01', sourcePeriodKey: '2026-08',
    });
    expect(item).toMatchObject({ monthlySalary: 1000, basicDue: 1000, commission: 10, advanceDeduction: 100 });
  }, 90_000);

  it('الصرف ينشئ قيداً واحداً متوازناً ويخصم السلفة مرة واحدة', async () => {
    const { saved } = await draftAndApprove();
    const paid = await payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'bank', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') });
    const entry = (await db.collection('journal_entries').doc(paid.entryId).get()).data();
    expect(entry.totalDebit).toBe(entry.totalCredit);
    expect(entry.payrollSnapshot.accounts).toMatchObject({
      SALARY_EXPENSE: PAYROLL_ACCOUNTS.SALARY_EXPENSE,
      PAYROLL_PAYABLE: PAYROLL_ACCOUNTS.PAYROLL_PAYABLE,
      payment: PAYROLL_ACCOUNTS.BANK,
    });
    const advance = (await db.collection('temporary_expenses').doc('a1').get()).data();
    expect(advance).toMatchObject({ recovered_amount: 100, status: 'pending', payroll_lock_id: saved.runId });
    await expect(payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'bank', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') })).rejects.toThrow(/معتمداً/);
  }, 90_000);

  it('التزامن لا يصرف العامل أو السلفة مرتين', async () => {
    const { saved } = await draftAndApprove();
    const calls = await Promise.allSettled([1, 2].map(() => payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'cash', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') })));
    expect(calls.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(calls.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('journal_entries').get()).size).toBe(1);
    expect((await db.collection('temporary_expenses').doc('a1').get()).data().recovered_amount).toBe(100);
  }, 120_000);

  it('الفترة المقفلة ترفض الصرف بلا نصف حالة', async () => {
    const { saved } = await draftAndApprove();
    await db.collection('accounting_periods').doc('2026-09').set({ periodKey: '2026-09', status: 'closed' });
    await expect(payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'cash', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') })).rejects.toThrow(/مقفلة/);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
    expect((await db.collection('temporary_expenses').doc('a1').get()).data()).toMatchObject({ recovered_amount: 0, status: 'pending' });
  }, 90_000);

  it('بعد حلول الموعد يبقى تاريخ القيد ثابتاً يوم 1 ولا يقبل تاريخاً اختيارياً', async () => {
    const { saved } = await draftAndApprove();
    await expect(payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'bank', payDate: '2026-09-02',
    }, { userId: 'admin', now: new Date('2026-09-02T08:00:00Z') })).rejects.toThrow(/تاريخ الصرف الثابت/);
    expect((await db.collection('journal_entries').get()).empty).toBe(true);
  }, 90_000);

  it('الصرف قبل يوم 1 يحتاج سبب مدير صريح', async () => {
    const earlyNow = new Date('2026-08-30T08:00:00Z');
    const { saved } = await draftAndApprove({ now: earlyNow });
    await expect(payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'cash', payDate: '2026-08-30',
    }, { userId: 'admin', now: earlyNow })).rejects.toThrow(/سبب تدقيق/);
    const paid = await payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'cash', payDate: '2026-08-30', earlyReason: 'حالة تشغيلية استثنائية معتمدة',
    }, { userId: 'admin', now: earlyNow });
    expect(paid.status).toBe(PAYROLL_STATUS.PAID);
    expect((await db.collection('payroll_runs').doc(saved.runId).get()).data()).toMatchObject({ earlyPayment: true });
  }, 90_000);

  it('العكس يعيد السلفة والسطور وينشئ قيداً عكسياً متوازناً', async () => {
    const { saved } = await draftAndApprove();
    await payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'bank', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') });
    const reversed = await reversePayroll(db, FieldValue, {
      runId: saved.runId, reversalDate: '2026-09-02', reason: 'تصحيح موثق',
    }, { userId: 'admin', now: new Date('2026-09-02T08:00:00Z') });
    const advance = (await db.collection('temporary_expenses').doc('a1').get()).data();
    const reversalEntry = (await db.collection('journal_entries').doc(reversed.reversalEntryId).get()).data();
    expect(advance).toMatchObject({ recovered_amount: 0, status: 'pending', recovered_date: null });
    expect(advance.payroll_lock_id).toBeUndefined();
    expect(reversalEntry.totalDebit).toBe(reversalEntry.totalCredit);
    expect((await db.collection('payroll_runs').doc(saved.runId).get()).data().status).toBe(PAYROLL_STATUS.REVERSED);
    expect((await db.collection('payroll_payment_locks').get()).empty).toBe(true);
  }, 120_000);
});
