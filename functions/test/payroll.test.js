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
  previewPayroll,
  previewPayrollMonths,
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

  it('يخصم كامل السلفة افتراضياً: مستحق 523 وسلفة 200 ينتجان صافي 323', () => {
    const p = preview({
      bikers: [BIKER({ salary: 523 })],
      advances: [ADVANCE({ amount: 200 })],
    });
    expect(p.lines[0]).toMatchObject({
      basicDue: 523, advanceOutstanding: 200, advanceDeduction: 200,
      advanceDeductionMax: 200, advanceDeductionMode: 'default_full', netDue: 323,
    });
    expect(p.totals).toMatchObject({ basic: 523, advances: 200, net: 323 });
  });

  it('يخصم من الرصيد بعد مصروف عهدة مرحل ويحافظ على السجلات القديمة بلا حقل استهلاك', () => {
    const legacy = preview({ advances: [ADVANCE()] });
    expect(legacy.lines[0].advanceOutstanding).toBe(200);
    const consumed = preview({ advances: [ADVANCE({ custody_expense_used_halala: 10000, recovered_amount: 50 })] });
    expect(consumed.lines[0]).toMatchObject({ advanceOutstanding: 50, advanceDeduction: 50 });
    expect(() => preview({ advances: [ADVANCE({ custody_expense_used_halala: 18000, recovered_amount: 50 })] }))
      .toThrow(/استهلاك السلفة يتجاوز التمويل/);
  });

  it('22 عاملاً × سلفة 200: الأساسي 11,439 والسلف 4,400 والصافي 7,039', () => {
    const bikers = Array.from({ length: 22 }, (_, index) => ({
      id: `b${index + 1}`, name: `عامل ${index + 1}`,
      salary: index === 21 ? 519 : 520, start_date: '2026-08-01',
    }));
    const advances = bikers.map((biker, index) => ({
      id: `a${index + 1}`, biker_id: biker.id, amount: 200, recovered_amount: 0,
      status: 'pending', spent_date: '2026-08-01',
    }));
    const p = preview({ bikers, advances });
    expect(p.lines).toHaveLength(22);
    expect(p.totals).toMatchObject({ basic: 11439, advances: 4400, net: 7039 });
  });

  it('إذا تجاوز رصيد السلفة المستحق يخصم المستحق فقط ولا يصنع صافيًا سالبًا', () => {
    const p = preview({
      bikers: [BIKER({ salary: 100 })], advances: [ADVANCE({ amount: 200 })],
    });
    expect(p.lines[0]).toMatchObject({
      advanceOutstanding: 200, advanceDeductionMax: 100, advanceDeduction: 100, netDue: 0,
    });
  });

  it('تعدد السلف يوزع الخصم الافتراضي على الأقدم أولاً ويثبّت allocations', () => {
    const p = preview({
      bikers: [BIKER({ salary: 523 })],
      advances: [
        ADVANCE({ id: 'newer', amount: 150, spent_date: '2026-08-10' }),
        ADVANCE({ id: 'older', amount: 50, spent_date: '2026-08-01' }),
      ],
    });
    expect(p.lines[0].advanceDeduction).toBe(200);
    expect(p.lines[0].advanceAllocations.map(({ advanceId, amount }) => ({ advanceId, amount })))
      .toEqual([{ advanceId: 'older', amount: 50 }, { advanceId: 'newer', amount: 150 }]);
  });

  it('الصفر اليدوي يبقى صفراً، والبونص/الخصم يعيدان حساب الحد الافتراضي', () => {
    const manualZero = preview({
      bikers: [BIKER({ salary: 523 })], advances: [ADVANCE({ amount: 200 })],
      adjustments: [{ bikerId: 'b1', advanceDeduction: 0 }],
    });
    expect(manualZero.lines[0]).toMatchObject({
      advanceDeduction: 0, advanceDeductionMode: 'manual', netDue: 523,
    });

    const recalculated = preview({
      bikers: [BIKER({ salary: 300 })], advances: [ADVANCE({ amount: 400 })],
      adjustments: [{
        bikerId: 'b1', bonus: 100, bonusReason: 'مكافأة', deduction: 50, deductionReason: 'خصم',
      }],
    });
    expect(recalculated.lines[0]).toMatchObject({ advanceDeductionMax: 350, advanceDeduction: 350, netDue: 0 });
    expect(() => preview({
      bikers: [BIKER({ salary: 300 })], advances: [ADVANCE({ amount: 400 })],
      adjustments: [{
        bikerId: 'b1', bonus: 100, bonusReason: 'مكافأة', deduction: 50,
        deductionReason: 'خصم', advanceDeduction: 400,
      }],
    })).toThrow(/سالباً/);
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
    const saved = await savePayrollDraft(db, FieldValue, {
      periodKey: '2026-08', adjustments: [],
    }, { userId: 'acct', now: new Date('2026-09-01T08:00:00Z') });
    await approvePayroll(db, FieldValue, { runId: saved.runId }, {
      userId: 'admin', now: new Date('2026-09-01T08:00:00Z'),
    });
    const calls = await Promise.allSettled([1, 2].map(() => payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'cash', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') })));
    expect(calls.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(calls.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await db.collection('journal_entries').get()).size).toBe(1);
    expect((await db.collection('temporary_expenses').doc('a1').get()).data().recovered_amount).toBe(200);
  }, 120_000);

  it('الصرف يطبق allocations المتعددة الأقدم أولاً داخل المعاملة نفسها', async () => {
    await db.collection('temporary_expenses').doc('a0').set({
      biker_id: 'b1', title: 'سلفة أقدم', amount: 50, recovered_amount: 0,
      status: 'pending', spent_date: '2026-08-01', recovered_date: null, recovery_method: null,
    });
    const saved = await savePayrollDraft(db, FieldValue, {
      periodKey: '2026-08', adjustments: [],
    }, { userId: 'acct', now: new Date('2026-09-01T08:00:00Z') });
    await approvePayroll(db, FieldValue, { runId: saved.runId }, {
      userId: 'admin', now: new Date('2026-09-01T08:00:00Z'),
    });
    const itemBeforePay = (await db.collection('payroll_runs').doc(saved.runId)
      .collection('items').doc('b1').get()).data();
    expect(itemBeforePay.advanceAllocations.map((row) => row.advanceId)).toEqual(['a0', 'a1']);

    await payPayroll(db, FieldValue, {
      runId: saved.runId, paymentMethod: 'bank', payDate: '2026-09-01',
    }, { userId: 'admin', now: new Date('2026-09-01T08:00:00Z') });
    expect((await db.collection('temporary_expenses').doc('a0').get()).data())
      .toMatchObject({ recovered_amount: 50, status: 'recovered', payroll_lock_id: saved.runId });
    expect((await db.collection('temporary_expenses').doc('a1').get()).data())
      .toMatchObject({ recovered_amount: 200, status: 'recovered', payroll_lock_id: saved.runId });
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

d('معاينة الرواتب لعدة أشهر — قراءة شهرها فقط، بنفس النتيجة', () => {
  let monthsApp; let mdb;
  const now = new Date('2026-10-20T08:00:00Z');
  beforeAll(async () => {
    monthsApp = initializeApp({ projectId: 'demo-sweater-payroll-months' }, 'payroll-months-test');
    mdb = getFirestore(monthsApp);
    const rows = {
      bikers: { b1: { name: 'عامل أول', salary: 1000, start_date: '2026-08-01' }, b2: { name: 'عامل ثان', salary: 1500, start_date: '2026-09-10' } },
      washes: {
        // Ids out of date order: duplicates keep the first id, as a whole-collection read would.
        z9: { biker_id: 'b1', wash_date: '2026-10-03', status: 'مكتملة', quantity: 1, ssp_booking_id: 'S1' },
        a1: { biker_id: 'b2', wash_date: '2026-10-03', status: 'مكتملة', quantity: 1, ssp_booking_id: 'S1' },
        m5: { biker_id: 'b1', wash_date: '2026-10-05T09:00', status: 'مكتملة', quantity: 2 },
        m6: { biker_id: 'b2', wash_date: '2026-10', status: 'مكتملة', quantity: 1 },
        m7: { biker_name: 'عامل أول', wash_date: '2026-09-30', status: 'مكتملة', quantity: 3 },
        m8: { biker_id: 'b2', wash_date: '2026-09-12', status: 'قيد التنفيذ', quantity: 1 },
        m9: { biker_id: 'b1', wash_date: '2026-08-31', status: 'completed', quantity: 4 },
        old: { biker_id: 'b1', wash_date: '2026-07-31', status: 'مكتملة', quantity: 9 },
        next: { biker_id: 'b1', wash_date: '2026-11-01', status: 'مكتملة', quantity: 9 },
      },
      temporary_expenses: { t1: { biker_id: 'b1', title: 'سلفة', amount: 300, recovered_amount: 0, status: 'pending', spent_date: '2026-10-02', recovered_date: null } },
    };
    for (const [name, docs] of Object.entries(rows)) for (const [id, data] of Object.entries(docs)) await mdb.collection(name).doc(id).set(data);
  }, 60_000);
  afterAll(async () => { if (monthsApp) await deleteApp(monthsApp); });

  it('يطابق المعاينة من المجموعات كاملة لكل شهر', async () => {
    const whole = async name => (await mdb.collection(name).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const sourceData = { bikers: await whole('bikers'), washes: await whole('washes'), advances: await whole('temporary_expenses') };
    const months = ['2026-08', '2026-09', '2026-10'];
    const batched = await previewPayrollMonths(mdb, months, { now });
    // A refused month (here: one booking executed by two workers in October)
    // is refused the same way, reported per month instead of thrown.
    const settled = (periodKey, promise) => promise.catch(e => ({ periodKey, error: { message: e.message, code: e.code || 'internal' } }));
    for (const [i, periodKey] of months.entries()) {
      const expected = await settled(periodKey, previewPayroll(mdb, { periodKey, automaticAdvanceDeduction: true }, { now, sourceData }));
      expect(batched[i]).toEqual(expected);
      expect(await settled(periodKey, previewPayroll(mdb, { periodKey, automaticAdvanceDeduction: true }, { now }))).toEqual(expected);
    }
    expect(batched[2].error.message).toMatch(/مكررة/);
    expect(batched[0].lines.length).toBeGreaterThan(0);

    // Without the conflict, October previews (duplicates keep one execution).
    await mdb.collection('washes').doc('a1').update({ biker_id: 'b1' });
    const fixed = { ...sourceData, washes: await whole('washes') };
    const [october] = await previewPayrollMonths(mdb, ['2026-10'], { now });
    expect(october).toEqual(await previewPayroll(mdb, { periodKey: '2026-10', automaticAdvanceDeduction: true }, { now, sourceData: fixed }));
    expect(october.lines.find(l => l.bikerId === 'b1')).toBeTruthy();
  });

  it('شهرٌ غير صالح يرفض الطلب، وشهرٌ يفشل وحده لا يُسقط البقية', async () => {
    await expect(previewPayrollMonths(mdb, [], { now })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(previewPayrollMonths(mdb, ['2026-13'], { now })).rejects.toBeTruthy();
    await mdb.collection('payroll_periods').doc('2026-09').set({ currentRunId: 'missing-run' });
    const [aug, sep] = await previewPayrollMonths(mdb, ['2026-08', '2026-09'], { now });
    expect(aug.lines.length).toBeGreaterThan(0);
    expect(sep.periodKey).toBe('2026-09');
    await mdb.collection('payroll_periods').doc('2026-09').delete();
  });
});
