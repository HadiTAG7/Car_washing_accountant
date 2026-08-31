import {
  buildReversalLines,
  isRealDate,
  journalCounterUpdate,
  normalizeLines,
  periodKeyOf,
  round2,
  totalsOf,
} from './invariants.js';

export const PAYROLL_POLICY = Object.freeze({
  method: 'actual_month_days',
  label: 'أيام الشهر الفعلية',
  joinDayInclusive: true,
  distributionRule: 'first_day_of_following_month',
  decidedByOwnerAt: '2026-08-30',
});

export const PAYROLL_STATUS = Object.freeze({
  DRAFT: 'draft',
  APPROVED: 'approved',
  PAID: 'paid',
  REVERSED: 'reversed',
  CANCELLED: 'cancelled',
});

export const PAYROLL_ACCOUNTS = Object.freeze({
  CASH: '1010',
  BANK: '1020',
  EMPLOYEE_ADVANCE: '1300',
  PAYROLL_PAYABLE: '2010',
  BIKER_COMMISSION: '5000',
  SALARY_EXPENSE: '5010',
});

const COMMISSION_PER_WASH = 2;
const JOURNAL_COUNTER = 'journal';
const BUSINESS_TIME_ZONE = 'Asia/Riyadh';

const ACCOUNT_SEED = Object.freeze({
  [PAYROLL_ACCOUNTS.CASH]: {
    nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit', parentId: null,
  },
  [PAYROLL_ACCOUNTS.BANK]: {
    nameArabic: 'البنك', accountType: 'asset', normalBalance: 'debit', parentId: null,
  },
  [PAYROLL_ACCOUNTS.EMPLOYEE_ADVANCE]: {
    nameArabic: 'عهد وسلف العاملين', accountType: 'asset', normalBalance: 'debit', parentId: null,
  },
  [PAYROLL_ACCOUNTS.PAYROLL_PAYABLE]: {
    nameArabic: 'رواتب مستحقة', accountType: 'liability', normalBalance: 'credit', parentId: null,
  },
  [PAYROLL_ACCOUNTS.BIKER_COMMISSION]: {
    nameArabic: 'عمولات البايكرز', accountType: 'expense', normalBalance: 'debit', parentId: null,
  },
  [PAYROLL_ACCOUNTS.SALARY_EXPENSE]: {
    nameArabic: 'رواتب وأجور البايكرز', accountType: 'expense', normalBalance: 'debit', parentId: null,
  },
});

export class PayrollError extends Error {
  constructor(message, { code = 'failed-precondition', details = null } = {}) {
    super(message);
    this.name = 'PayrollError';
    this.code = code;
    if (details) this.details = details;
  }
}

function fail(message, options) {
  throw new PayrollError(message, options);
}

function isoToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function cleanText(value, label, { required = false, max = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) fail(`${label} مطلوب.`, { code: 'invalid-argument' });
  if (text.length > max) fail(`${label} أطول من المسموح.`, { code: 'invalid-argument' });
  return text;
}

function money(value, label, { max = 10_000_000 } = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > max) {
    fail(`${label} غير صالح.`, { code: 'invalid-argument' });
  }
  return round2(number);
}

function validPeriodKey(value) {
  const key = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    fail('الشهر يجب أن يكون بصيغة YYYY-MM.', { code: 'invalid-argument' });
  }
  return key;
}

function utcDate(iso) {
  if (!isRealDate(iso)) fail(`التاريخ ${iso || '—'} غير صالح.`, { code: 'invalid-argument' });
  return new Date(`${iso}T00:00:00.000Z`);
}

function addUtcDays(iso, days) {
  const date = utcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function payrollMonthBounds(periodKey) {
  const key = validPeriodKey(periodKey);
  const [year, month] = key.split('-').map(Number);
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodStart = `${key}-01`;
  const periodEnd = `${key}-${String(monthDays).padStart(2, '0')}`;
  const next = new Date(Date.UTC(year, month, 1));
  const distributionDate = next.toISOString().slice(0, 10);
  return { periodKey: key, periodStart, periodEnd, monthDays, distributionDate };
}

function daysInclusive(start, end) {
  return Math.floor((utcDate(end) - utcDate(start)) / 86_400_000) + 1;
}

export function eligibleActualDays({ periodKey, periodStart, periodEnd, startDate, endDate }) {
  const bounds = payrollMonthBounds(periodKey);
  const from = periodStart || bounds.periodStart;
  const to = periodEnd || bounds.periodEnd;
  if (!isRealDate(from) || !isRealDate(to) || from > to
    || periodKeyOf(from) !== bounds.periodKey || periodKeyOf(to) !== bounds.periodKey) {
    fail('فترة المسير يجب أن تكون تواريخ صحيحة داخل الشهر المختار.', { code: 'invalid-argument' });
  }
  const joined = startDate && isRealDate(startDate) ? startDate : from;
  const ended = endDate && isRealDate(endDate) ? endDate : to;
  const eligibleStart = [from, joined].sort().at(-1);
  const eligibleEnd = [to, ended].sort()[0];
  if (eligibleStart > eligibleEnd) {
    return { daysEntitled: 0, eligibleStart, eligibleEnd, monthDays: bounds.monthDays };
  }
  return {
    daysEntitled: daysInclusive(eligibleStart, eligibleEnd),
    eligibleStart,
    eligibleEnd,
    monthDays: bounds.monthDays,
  };
}

export function basicSalaryDue({ monthlySalary, daysEntitled, monthDays }) {
  const salary = money(monthlySalary, 'الراتب الشهري');
  const days = Number(daysEntitled);
  const divisor = Number(monthDays);
  if (!Number.isInteger(days) || days < 0 || !Number.isInteger(divisor) || divisor < 28 || divisor > 31) {
    fail('أيام استحقاق الراتب غير صالحة.', { code: 'invalid-argument' });
  }
  return round2((salary * days) / divisor);
}

function normalizeAdjustment(raw = {}) {
  const bikerId = cleanText(raw.bikerId, 'معرّف العامل', { required: true, max: 180 });
  const bonus = money(raw.bonus, 'البونص');
  const deduction = money(raw.deduction, 'الخصم');
  const hasAdvanceDeduction = Object.prototype.hasOwnProperty.call(raw, 'advanceDeduction')
    && raw.advanceDeduction !== null && raw.advanceDeduction !== undefined;
  const requestedAdvanceDeduction = hasAdvanceDeduction
    ? money(raw.advanceDeduction, 'السلفة المراد خصمها') : null;
  const bonusReason = cleanText(raw.bonusReason, 'سبب البونص');
  const deductionReason = cleanText(raw.deductionReason, 'سبب الخصم');
  if (bonus > 0 && !bonusReason) fail(`سبب البونص مطلوب للعامل ${bikerId}.`, { code: 'invalid-argument' });
  if (deduction > 0 && !deductionReason) fail(`سبب الخصم مطلوب للعامل ${bikerId}.`, { code: 'invalid-argument' });
  return {
    bikerId, bonus, bonusReason, deduction, deductionReason,
    hasAdvanceDeduction, requestedAdvanceDeduction,
  };
}

function completedWash(row) {
  const status = String(row.status ?? '').trim().toLowerCase();
  return status === 'مكتملة' || status === 'completed' || status === 'complete';
}

function outstandingOfAdvance(row) {
  const amount = money(row.amount, 'قيمة السلفة');
  if (row.status === 'recovered') return 0;
  const recovered = Math.min(amount, money(row.recovered_amount, 'المسترد من السلفة'));
  return round2(amount - recovered);
}

function commissionFor(biker, washes, periodStart, periodEnd) {
  return round2(washes.reduce((sum, row) => {
    const date = String(row.wash_date || '').slice(0, 10);
    if (date < periodStart || date > periodEnd || !completedWash(row)) return sum;
    const linked = row.biker_id
      ? String(row.biker_id) === biker.id
      : String(row.biker_name || '').trim() === String(biker.name || '').trim();
    return linked ? sum + (Math.max(0, Number(row.quantity) || 0) * COMMISSION_PER_WASH) : sum;
  }, 0));
}

function allocationsFor(requested, advances) {
  let remaining = requested;
  const allocations = [];
  for (const advance of advances) {
    if (remaining <= 0) break;
    const outstanding = outstandingOfAdvance(advance);
    if (outstanding <= 0) continue;
    const amount = round2(Math.min(outstanding, remaining));
    allocations.push({
      advanceId: advance.id,
      amount,
      originalAmount: money(advance.amount, 'قيمة السلفة'),
      priorRecoveredAmount: round2(Math.max(0, Number(advance.recovered_amount) || 0)),
      priorStatus: advance.status === 'recovered' ? 'recovered' : 'pending',
      priorRecoveredDate: advance.recovered_date || null,
      priorRecoveryMethod: advance.recovery_method || null,
      expectedOutstanding: outstanding,
    });
    remaining = round2(remaining - amount);
  }
  if (remaining > 0) fail('السلفة المراد خصمها تتجاوز الرصيد القائم.', { code: 'invalid-argument' });
  return allocations;
}

export function calculatePayrollPreview({
  periodKey,
  periodStart,
  periodEnd,
  adjustments = [],
  bikers = [],
  washes = [],
  advances = [],
  now = new Date(),
}) {
  const bounds = payrollMonthBounds(periodKey);
  const from = periodStart || bounds.periodStart;
  const to = periodEnd || bounds.periodEnd;
  eligibleActualDays({ periodKey: bounds.periodKey, periodStart: from, periodEnd: to });

  const adjustmentMap = new Map();
  for (const raw of adjustments || []) {
    const adjustment = normalizeAdjustment(raw);
    if (adjustmentMap.has(adjustment.bikerId)) {
      fail(`تعديل العامل ${adjustment.bikerId} مكرر.`, { code: 'invalid-argument' });
    }
    adjustmentMap.set(adjustment.bikerId, adjustment);
  }

  const advanceMap = new Map();
  for (const row of advances || []) {
    const bikerId = String(row.biker_id || '').trim();
    if (!bikerId || outstandingOfAdvance(row) <= 0) continue;
    const list = advanceMap.get(bikerId) || [];
    list.push(row);
    advanceMap.set(bikerId, list);
  }
  for (const list of advanceMap.values()) {
    list.sort((a, b) => String(a.spent_date || '').localeCompare(String(b.spent_date || ''))
      || String(a.id).localeCompare(String(b.id)));
  }

  const lines = [];
  for (const source of bikers || []) {
    const biker = { ...source, id: String(source.id || '').trim() };
    if (!biker.id) continue;
    const startDate = String(biker.start_date || biker.startDate || '').slice(0, 10) || null;
    const endDate = String(biker.end_date || biker.endDate || '').slice(0, 10) || null;
    const eligibility = eligibleActualDays({
      periodKey: bounds.periodKey, periodStart: from, periodEnd: to, startDate, endDate,
    });
    if (eligibility.daysEntitled === 0) continue;

    const adj = adjustmentMap.get(biker.id) || normalizeAdjustment({ bikerId: biker.id });
    const basicDue = basicSalaryDue({
      monthlySalary: biker.salary, daysEntitled: eligibility.daysEntitled, monthDays: bounds.monthDays,
    });
    const commission = commissionFor(biker, washes, from, to);
    const beforeAdvance = round2(basicDue + commission + adj.bonus - adj.deduction);
    if (beforeAdvance < 0) {
      fail(`خصومات ${biker.name || biker.id} تتجاوز مستحقاته؛ لا يتحول الفرق إلى دين تلقائياً.`, {
        code: 'invalid-argument',
      });
    }
    const bikerAdvances = advanceMap.get(biker.id) || [];
    const advanceOutstanding = round2(bikerAdvances.reduce((sum, row) => sum + outstandingOfAdvance(row), 0));
    const advanceDeductionMax = round2(Math.min(advanceOutstanding, Math.max(0, beforeAdvance)));
    const advanceDeduction = adj.hasAdvanceDeduction
      ? adj.requestedAdvanceDeduction : advanceDeductionMax;
    if (advanceDeduction > advanceOutstanding) {
      fail(`خصم سلفة ${biker.name || biker.id} يتجاوز الرصيد القائم.`, { code: 'invalid-argument' });
    }
    if (advanceDeduction > beforeAdvance) {
      fail(`خصم سلفة ${biker.name || biker.id} يجعل صافي المستحق سالباً.`, { code: 'invalid-argument' });
    }
    const advanceAllocations = allocationsFor(advanceDeduction, bikerAdvances);
    const netDue = round2(beforeAdvance - advanceDeduction);
    lines.push({
      bikerId: biker.id,
      name: String(biker.name || 'عامل بلا اسم'),
      monthlySalary: money(biker.salary, 'الراتب الشهري'),
      startDate,
      endDate,
      eligibleStart: eligibility.eligibleStart,
      eligibleEnd: eligibility.eligibleEnd,
      daysEntitled: eligibility.daysEntitled,
      monthDays: bounds.monthDays,
      basicDue,
      commission,
      bonus: adj.bonus,
      bonusReason: adj.bonusReason || null,
      deduction: adj.deduction,
      deductionReason: adj.deductionReason || null,
      advanceOutstanding,
      advanceDeduction,
      advanceDeductionMax,
      advanceDeductionMode: adj.hasAdvanceDeduction ? 'manual' : 'default_full',
      advanceAllocations,
      netDue,
      status: PAYROLL_STATUS.DRAFT,
      formula: {
        text: 'صافي المستحق = الراتب المستحق + العمولة + البونص − الخصومات − السلفة المخصومة',
        values: {
          basicDue, commission, bonus: adj.bonus, deduction: adj.deduction,
          advanceDeduction, netDue,
        },
      },
    });
  }

  for (const bikerId of adjustmentMap.keys()) {
    if (!lines.some((line) => line.bikerId === bikerId)) {
      fail(`العامل ${bikerId} غير موجود أو غير مستحق ضمن الفترة.`, { code: 'not-found' });
    }
  }

  lines.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const totals = lines.reduce((sum, line) => ({
    basic: round2(sum.basic + line.basicDue),
    commissions: round2(sum.commissions + line.commission),
    bonuses: round2(sum.bonuses + line.bonus),
    deductions: round2(sum.deductions + line.deduction),
    advances: round2(sum.advances + line.advanceDeduction),
    net: round2(sum.net + line.netDue),
  }), { basic: 0, commissions: 0, bonuses: 0, deductions: 0, advances: 0, net: 0 });

  return {
    periodKey: bounds.periodKey,
    periodStart: from,
    periodEnd: to,
    distributionDate: bounds.distributionDate,
    distributionSnapshot: {
      rule: PAYROLL_POLICY.distributionRule,
      date: bounds.distributionDate,
      sourcePeriodKey: bounds.periodKey,
    },
    policySnapshot: { ...PAYROLL_POLICY, monthDays: bounds.monthDays },
    estimated: isoToday(now) <= to,
    generatedAtIso: new Date(now).toISOString(),
    lineCount: lines.length,
    totals,
    lines,
    inputAdjustments: [...adjustmentMap.values()],
  };
}

async function sourceRows(reader, db) {
  const read = (ref) => (reader === db ? ref.get() : reader.get(ref));
  const [bikersSnap, washesSnap, advancesSnap] = await Promise.all([
    read(db.collection('bikers')),
    read(db.collection('washes')),
    read(db.collection('temporary_expenses')),
  ]);
  const rows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return { bikers: rows(bikersSnap), washes: rows(washesSnap), advances: rows(advancesSnap) };
}

export async function previewPayroll(db, payload, { now = new Date() } = {}) {
  const sources = await sourceRows(db, db);
  return calculatePayrollPreview({ ...payload, ...sources, now });
}

function auditRecord(action, runId, userId, before, after, reason, FieldValue) {
  return {
    action,
    collectionName: 'payroll_runs',
    documentId: runId,
    userId: userId || null,
    before: before || null,
    after: after || null,
    note: reason || '',
    at: FieldValue.serverTimestamp(),
    atIso: new Date().toISOString(),
  };
}

function runIdFor(periodKey, revision) {
  return `${periodKey}__r${revision}`;
}

function adjustmentPayload(preview) {
  return preview.inputAdjustments.map((row) => ({
    bikerId: row.bikerId,
    bonus: row.bonus,
    bonusReason: row.bonusReason,
    deduction: row.deduction,
    deductionReason: row.deductionReason,
    ...(row.hasAdvanceDeduction ? { advanceDeduction: row.requestedAdvanceDeduction } : {}),
  }));
}

function runDocument(preview, { runId, revision, status, userId, FieldValue, previous = null }) {
  return {
    runId,
    revision,
    periodKey: preview.periodKey,
    periodStart: preview.periodStart,
    periodEnd: preview.periodEnd,
    distributionDate: preview.distributionDate,
    distributionSnapshot: preview.distributionSnapshot,
    policySnapshot: preview.policySnapshot,
    estimated: preview.estimated,
    lineCount: preview.lineCount,
    totals: preview.totals,
    inputAdjustments: adjustmentPayload(preview),
    status,
    createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
    createdBy: previous?.createdBy || userId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: userId,
  };
}

export async function savePayrollDraft(db, FieldValue, payload, {
  userId = null, now = new Date(), onBeforeCommit = null,
} = {}) {
  const periodKey = validPeriodKey(payload?.periodKey);
  const metaRef = db.collection('payroll_periods').doc(periodKey);

  return db.runTransaction(async (tx) => {
    const metaSnap = await tx.get(metaRef);
    let revision = Number(metaSnap.data()?.revision) || 0;
    let currentRef = metaSnap.exists && metaSnap.data().currentRunId
      ? db.collection('payroll_runs').doc(metaSnap.data().currentRunId)
      : null;
    let currentSnap = currentRef ? await tx.get(currentRef) : null;
    let current = currentSnap?.exists ? currentSnap.data() : null;

    if (current && current.status === PAYROLL_STATUS.PAID) {
      fail('المسير مصروف؛ التصحيح يكون بعكس ذري ثم مسير تصحيحي.', { code: 'failed-precondition' });
    }
    if (current && current.status === PAYROLL_STATUS.APPROVED) {
      fail('ألغِ اعتماد المسير بسبب مكتوب قبل تعديل المسودة.', { code: 'failed-precondition' });
    }
    if (!current || [PAYROLL_STATUS.REVERSED, PAYROLL_STATUS.CANCELLED].includes(current.status)) {
      revision += 1;
      currentRef = db.collection('payroll_runs').doc(runIdFor(periodKey, revision));
      currentSnap = await tx.get(currentRef);
      current = currentSnap.exists ? currentSnap.data() : null;
      if (current) fail('تعذر إنشاء مراجعة جديدة للمسير.', { code: 'already-exists' });
    }

    const itemQuery = current
      ? db.collection('payroll_runs').doc(current.runId).collection('items')
      : null;
    const [sources, oldItems] = await Promise.all([
      sourceRows(tx, db),
      itemQuery ? tx.get(itemQuery) : Promise.resolve(null),
    ]);
    const preview = calculatePayrollPreview({ ...payload, ...sources, periodKey, now });
    if (!preview.lineCount) fail('لا يوجد عامل مستحق ضمن الفترة المختارة.', { code: 'failed-precondition' });
    const runId = current?.runId || runIdFor(periodKey, revision);
    const runRef = db.collection('payroll_runs').doc(runId);
    const doc = runDocument(preview, {
      runId, revision, status: PAYROLL_STATUS.DRAFT, userId, FieldValue, previous: current,
    });

    if (onBeforeCommit) await onBeforeCommit();
    tx.set(runRef, doc, { merge: true });
    tx.set(metaRef, {
      periodKey, revision, currentRunId: runId, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const keep = new Set(preview.lines.map((line) => line.bikerId));
    for (const snap of oldItems?.docs || []) if (!keep.has(snap.id)) tx.delete(snap.ref);
    for (const line of preview.lines) {
      tx.set(runRef.collection('items').doc(line.bikerId), {
        ...line, runId, periodKey, revision, status: PAYROLL_STATUS.DRAFT,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { runId, revision, status: PAYROLL_STATUS.DRAFT, ...preview };
  });
}

async function refreshedPreviewInTransaction(tx, db, run, now) {
  const sources = await sourceRows(tx, db);
  return calculatePayrollPreview({
    periodKey: run.periodKey,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    adjustments: run.inputAdjustments,
    ...sources,
    now,
  });
}

export async function approvePayroll(db, FieldValue, { runId }, {
  userId = null, now = new Date(), onBeforeCommit = null,
} = {}) {
  const id = cleanText(runId, 'معرّف المسير', { required: true, max: 180 });
  const runRef = db.collection('payroll_runs').doc(id);
  return db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) fail('المسير غير موجود.', { code: 'not-found' });
    const run = runSnap.data();
    if (run.status !== PAYROLL_STATUS.DRAFT) fail('لا يُعتمد إلا مسير بحالة مسودة.');
    const oldItems = await tx.get(runRef.collection('items'));
    const preview = await refreshedPreviewInTransaction(tx, db, run, now);
    if (!preview.lineCount) fail('لا يوجد عامل مستحق ضمن المسير.');

    if (onBeforeCommit) await onBeforeCommit();
    tx.set(runRef, {
      ...runDocument(preview, {
        runId: id, revision: run.revision, status: PAYROLL_STATUS.APPROVED,
        userId, FieldValue, previous: run,
      }),
      approvedAt: FieldValue.serverTimestamp(), approvedBy: userId,
    }, { merge: true });
    const keep = new Set(preview.lines.map((line) => line.bikerId));
    for (const snap of oldItems.docs) if (!keep.has(snap.id)) tx.delete(snap.ref);
    for (const line of preview.lines) {
      tx.set(runRef.collection('items').doc(line.bikerId), {
        ...line, runId: id, periodKey: run.periodKey, revision: run.revision,
        status: PAYROLL_STATUS.APPROVED, approvedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection('audit_logs').doc(), auditRecord(
      'payroll-approve', id, userId,
      { status: run.status, totals: run.totals },
      { status: PAYROLL_STATUS.APPROVED, totals: preview.totals, policySnapshot: preview.policySnapshot },
      'اعتماد مسير الرواتب دون إنشاء قيد', FieldValue,
    ));
    return { runId: id, status: PAYROLL_STATUS.APPROVED, totals: preview.totals };
  });
}

export async function unapprovePayroll(db, FieldValue, { runId, reason }, { userId = null } = {}) {
  const id = cleanText(runId, 'معرّف المسير', { required: true });
  const why = cleanText(reason, 'سبب إلغاء الاعتماد', { required: true });
  const runRef = db.collection('payroll_runs').doc(id);
  return db.runTransaction(async (tx) => {
    const [runSnap, itemsSnap] = await Promise.all([tx.get(runRef), tx.get(runRef.collection('items'))]);
    if (!runSnap.exists) fail('المسير غير موجود.', { code: 'not-found' });
    const run = runSnap.data();
    if (run.status !== PAYROLL_STATUS.APPROVED) fail('لا يمكن إلغاء اعتماد هذه الحالة.');
    tx.update(runRef, {
      status: PAYROLL_STATUS.DRAFT, approvedAt: null, approvedBy: null,
      unapprovedAt: FieldValue.serverTimestamp(), unapprovedBy: userId,
      unapprovalReason: why, updatedAt: FieldValue.serverTimestamp(), updatedBy: userId,
    });
    for (const item of itemsSnap.docs) tx.update(item.ref, { status: PAYROLL_STATUS.DRAFT });
    tx.set(db.collection('audit_logs').doc(), auditRecord(
      'payroll-unapprove', id, userId, { status: run.status }, { status: PAYROLL_STATUS.DRAFT }, why, FieldValue,
    ));
    return { runId: id, status: PAYROLL_STATUS.DRAFT };
  });
}

function payrollJournalLines(totals, paymentMethod) {
  const salaryExpense = round2(totals.basic + totals.bonuses - totals.deductions);
  if (salaryExpense < 0) fail('إجمالي خصومات الرواتب يتجاوز الأساسي والبونص.');
  const grossPayable = round2(salaryExpense + totals.commissions);
  const net = round2(grossPayable - totals.advances);
  if (net < 0) fail('إجمالي السلف يجعل صافي المسير سالباً.');
  if (grossPayable <= 0) fail('المسير بلا مبلغ مستحق يمكن صرفه.');

  const lines = [];
  if (salaryExpense > 0) lines.push({
    accountId: PAYROLL_ACCOUNTS.SALARY_EXPENSE, debit: salaryExpense, credit: 0,
    description: 'الراتب الأساسي والبونص بعد الخصومات العادية',
  });
  if (totals.commissions > 0) lines.push({
    accountId: PAYROLL_ACCOUNTS.BIKER_COMMISSION, debit: totals.commissions, credit: 0,
    description: 'عمولات الغسلات',
  });
  lines.push({
    accountId: PAYROLL_ACCOUNTS.PAYROLL_PAYABLE, debit: 0, credit: grossPayable,
    description: 'إثبات استحقاق الرواتب',
  });
  lines.push({
    accountId: PAYROLL_ACCOUNTS.PAYROLL_PAYABLE, debit: grossPayable, credit: 0,
    description: 'تسوية استحقاق الرواتب عند الصرف',
  });
  if (totals.advances > 0) lines.push({
    accountId: PAYROLL_ACCOUNTS.EMPLOYEE_ADVANCE, debit: 0, credit: totals.advances,
    description: 'تسوية سلف العاملين المخصومة',
  });
  if (net > 0) lines.push({
    accountId: paymentMethod === 'cash' ? PAYROLL_ACCOUNTS.CASH : PAYROLL_ACCOUNTS.BANK,
    debit: 0, credit: net, description: paymentMethod === 'cash' ? 'صافي الرواتب نقداً' : 'صافي الرواتب بنكياً',
  });
  return normalizeLines(lines);
}

function ensurePaymentMethod(value) {
  const method = String(value || '').trim();
  if (!['cash', 'bank'].includes(method)) fail('طريقة الصرف يجب أن تكون نقداً أو بنكياً.', { code: 'invalid-argument' });
  return method;
}

export async function payPayroll(db, FieldValue, payload, {
  userId = null, now = new Date(), onBeforeCommit = null,
} = {}) {
  const id = cleanText(payload?.runId, 'معرّف المسير', { required: true });
  const paymentMethod = ensurePaymentMethod(payload?.paymentMethod);
  const runRef = db.collection('payroll_runs').doc(id);

  return db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) fail('المسير غير موجود.', { code: 'not-found' });
    const run = runSnap.data();
    if (run.status !== PAYROLL_STATUS.APPROVED) fail('المسير يجب أن يكون معتمداً قبل الصرف.');
    const early = isoToday(now) < run.distributionDate;
    const earlyReason = cleanText(payload?.earlyReason, 'سبب الصرف المبكر');
    const requestedPayDate = String(payload?.payDate || run.distributionDate || '').slice(0, 10);
    if (!isRealDate(requestedPayDate)) fail('تاريخ الصرف غير صالح.', { code: 'invalid-argument' });
    if (early && !earlyReason) {
      fail(`لا يُصرف راتب ${run.periodKey} قبل ${run.distributionDate} إلا بسبب تدقيق صريح من المدير.`);
    }
    if (!early && requestedPayDate !== run.distributionDate) {
      fail(`تاريخ الصرف الثابت لهذا المسير هو ${run.distributionDate}.`, { code: 'invalid-argument' });
    }
    if (early && requestedPayDate !== isoToday(now)) {
      fail('الصرف المبكر الاستثنائي يُسجّل بتاريخ التنفيذ الفعلي فقط.', { code: 'invalid-argument' });
    }
    const payDate = early ? requestedPayDate : run.distributionDate;

    const itemSnap = await tx.get(runRef.collection('items'));
    if (itemSnap.empty) fail('المسير بلا سطور.');
    const items = itemSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
    if (items.some((item) => item.status !== PAYROLL_STATUS.APPROVED)) fail('بعض سطور المسير غير معتمدة.');

    const periodKey = periodKeyOf(payDate);
    const periodRef = db.collection('accounting_periods').doc(periodKey);
    const counterRef = db.collection('counters').doc(JOURNAL_COUNTER);
    const accountRefs = Object.keys(ACCOUNT_SEED).map((code) => db.collection('chart_of_accounts').doc(code));
    const lockRefs = items.map((item) => db.collection('payroll_payment_locks')
      .doc(`${run.periodKey}__${item.bikerId}`));
    const allocationRows = items.flatMap((item) => (item.advanceAllocations || [])
      .map((allocation) => ({ item, allocation, ref: db.collection('temporary_expenses').doc(allocation.advanceId) })));

    const [periodSnap, counterSnap, ...rest] = await Promise.all([
      tx.get(periodRef), tx.get(counterRef),
      ...accountRefs.map((ref) => tx.get(ref)),
      ...lockRefs.map((ref) => tx.get(ref)),
      ...allocationRows.map((row) => tx.get(row.ref)),
    ]);
    const accountSnaps = rest.slice(0, accountRefs.length);
    const lockSnaps = rest.slice(accountRefs.length, accountRefs.length + lockRefs.length);
    const advanceSnaps = rest.slice(accountRefs.length + lockRefs.length);
    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      fail(`الفترة ${periodKey} مقفلة — لا يمكن صرف الرواتب فيها.`);
    }
    for (const [index, snap] of accountSnaps.entries()) {
      if (!snap.exists) continue;
      const expected = ACCOUNT_SEED[accountRefs[index].id];
      const current = snap.data();
      if (current.accountType !== expected.accountType || current.active === false) {
        fail(`الحساب ${accountRefs[index].id} غير نشط أو نوعه لا يطابق دليل الحسابات.`);
      }
    }
    const duplicateIndex = lockSnaps.findIndex((snap) => snap.exists);
    if (duplicateIndex >= 0) {
      fail(`سبق صرف راتب ${items[duplicateIndex].name} للفترة ${run.periodKey}.`, { code: 'already-exists' });
    }
    for (const [index, row] of allocationRows.entries()) {
      const snap = advanceSnaps[index];
      if (!snap.exists) fail(`السلفة ${row.allocation.advanceId} غير موجودة.`, { code: 'not-found' });
      const current = { id: snap.id, ...snap.data() };
      const outstanding = outstandingOfAdvance(current);
      if (outstanding !== row.allocation.expectedOutstanding || outstanding < row.allocation.amount) {
        fail(`تغير رصيد سلفة ${row.item.name} بعد الاعتماد؛ ألغِ الاعتماد وأعد المعاينة.`);
      }
    }

    const lines = payrollJournalLines(run.totals, paymentMethod);
    const journalTotals = totalsOf(lines);
    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const entryRef = db.collection('journal_entries').doc();
    const nowIso = new Date(now).toISOString();

    if (onBeforeCommit) await onBeforeCommit();
    for (const [index, ref] of accountRefs.entries()) {
      if (!accountSnaps[index].exists) {
        tx.set(ref, {
          code: ref.id, ...ACCOUNT_SEED[ref.id], active: true,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    if (!periodSnap.exists) tx.set(periodRef, {
      periodKey, status: 'open', closedAt: null, closedBy: null, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(entryRef, {
      entryDate: payDate, periodKey, sourceType: 'payroll', sourceId: id,
      description: `صرف مسير رواتب ${run.periodKey}`,
      status: 'posted', entryNumber: nextNumber, lines, lineCount: lines.length,
      totalDebit: journalTotals.debit, totalCredit: journalTotals.credit,
      payrollSnapshot: {
        runId: id, periodKey: run.periodKey, distributionDate: run.distributionDate,
        policySnapshot: run.policySnapshot, distributionSnapshot: run.distributionSnapshot, totals: run.totals,
        accounts: { ...PAYROLL_ACCOUNTS, payment: paymentMethod === 'cash' ? PAYROLL_ACCOUNTS.CASH : PAYROLL_ACCOUNTS.BANK },
      },
      createdBy: userId, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp(),
    });
    tx.set(counterRef, journalCounterUpdate(counterSnap, nextNumber, payDate, FieldValue), { merge: true });
    for (const [index, item] of items.entries()) {
      tx.set(lockRefs[index], {
        periodKey: run.periodKey, bikerId: item.bikerId, runId: id,
        journalEntryId: entryRef.id, entryNumber: nextNumber,
        lockedAt: FieldValue.serverTimestamp(), lockedBy: userId,
      });
      tx.update(item.ref, {
        status: PAYROLL_STATUS.PAID, paymentMethod, payDate,
        journalEntryId: entryRef.id, journalEntryNumber: nextNumber,
        paidAt: FieldValue.serverTimestamp(), paidBy: userId,
      });
    }
    for (const [index, row] of allocationRows.entries()) {
      const current = advanceSnaps[index].data();
      const original = money(current.amount, 'قيمة السلفة');
      const recovered = round2((Number(current.recovered_amount) || 0) + row.allocation.amount);
      const fullyRecovered = recovered >= original;
      tx.update(row.ref, {
        recovered_amount: recovered,
        status: fullyRecovered ? 'recovered' : 'pending',
        recovered_date: fullyRecovered ? payDate : null,
        recovery_method: paymentMethod,
        payroll_lock_id: id,
        payroll_recovered_at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(runRef, {
      status: PAYROLL_STATUS.PAID, paymentMethod, payDate,
      journalEntryId: entryRef.id, journalEntryNumber: nextNumber,
      earlyPayment: early, earlyPaymentReason: early ? earlyReason : null,
      paidAt: FieldValue.serverTimestamp(), paidBy: userId,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: userId,
    });
    tx.set(db.collection('audit_logs').doc(), auditRecord(
      'payroll-pay', id, userId,
      { status: run.status },
      { status: PAYROLL_STATUS.PAID, payDate, paymentMethod, entryId: entryRef.id, entryNumber: nextNumber },
      early ? `صرف مبكر: ${earlyReason}` : `صرف في موعد التوزيع ${run.distributionDate}`,
      FieldValue,
    ));
    return {
      runId: id, status: PAYROLL_STATUS.PAID, payDate, paymentMethod,
      entryId: entryRef.id, entryNumber: nextNumber, totals: run.totals, atIso: nowIso,
    };
  });
}

export async function reversePayroll(db, FieldValue, payload, { userId = null, now = new Date() } = {}) {
  const id = cleanText(payload?.runId, 'معرّف المسير', { required: true });
  const reason = cleanText(payload?.reason, 'سبب العكس', { required: true });
  const reversalDate = String(payload?.reversalDate || isoToday(now)).slice(0, 10);
  if (!isRealDate(reversalDate)) fail('تاريخ العكس غير صالح.', { code: 'invalid-argument' });
  const runRef = db.collection('payroll_runs').doc(id);

  return db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) fail('المسير غير موجود.', { code: 'not-found' });
    const run = runSnap.data();
    if (run.status !== PAYROLL_STATUS.PAID || !run.journalEntryId) fail('لا يمكن عكس مسير غير مصروف.');
    const entryRef = db.collection('journal_entries').doc(run.journalEntryId);
    const [entrySnap, itemsSnap] = await Promise.all([tx.get(entryRef), tx.get(runRef.collection('items'))]);
    if (!entrySnap.exists || entrySnap.data().status === 'reversed') fail('قيد المسير غير موجود أو معكوس بالفعل.');
    const items = itemsSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
    const periodKey = periodKeyOf(reversalDate);
    const periodRef = db.collection('accounting_periods').doc(periodKey);
    const counterRef = db.collection('counters').doc(JOURNAL_COUNTER);
    const lockRefs = items.map((item) => db.collection('payroll_payment_locks').doc(`${run.periodKey}__${item.bikerId}`));
    const allocationRows = items.flatMap((item) => (item.advanceAllocations || [])
      .map((allocation) => ({ item, allocation, ref: db.collection('temporary_expenses').doc(allocation.advanceId) })));
    const [periodSnap, counterSnap, ...rest] = await Promise.all([
      tx.get(periodRef), tx.get(counterRef),
      ...lockRefs.map((ref) => tx.get(ref)),
      ...allocationRows.map((row) => tx.get(row.ref)),
    ]);
    const lockSnaps = rest.slice(0, lockRefs.length);
    const advanceSnaps = rest.slice(lockRefs.length);
    if (periodSnap.exists && periodSnap.data().status === 'closed') {
      fail(`الفترة ${periodKey} مقفلة — لا يمكن تسجيل العكس فيها.`);
    }
    if (lockSnaps.some((snap) => !snap.exists || snap.data().runId !== id)) {
      fail('قفل صرف أحد العمال تغيّر؛ أوقف العكس وراجع السجل.');
    }
    for (const [index, row] of allocationRows.entries()) {
      const snap = advanceSnaps[index];
      if (!snap.exists || snap.data().payroll_lock_id !== id) {
        fail(`سلفة ${row.item.name} تغيرت بعد الصرف؛ لا يمكن عكس نصف حالة.`);
      }
    }

    const original = entrySnap.data();
    const reversalLines = buildReversalLines(original.lines || []);
    const totals = totalsOf(reversalLines);
    const nextNumber = counterSnap.exists ? (Number(counterSnap.data().nextNumber) || 1) : 1;
    const reversalRef = db.collection('journal_entries').doc();
    if (!periodSnap.exists) tx.set(periodRef, {
      periodKey, status: 'open', closedAt: null, closedBy: null, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(reversalRef, {
      entryDate: reversalDate, periodKey, sourceType: 'payroll_reversal', sourceId: id,
      description: `عكس مسير رواتب ${run.periodKey} — ${reason}`,
      status: 'posted', entryNumber: nextNumber, reversesEntryId: entryRef.id,
      lines: reversalLines, lineCount: reversalLines.length,
      totalDebit: totals.debit, totalCredit: totals.credit,
      createdBy: userId, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp(),
    });
    tx.update(entryRef, {
      status: 'reversed', reversedBy: reversalRef.id,
      reversedAt: FieldValue.serverTimestamp(), reversalReason: reason,
    });
    tx.set(counterRef, journalCounterUpdate(counterSnap, nextNumber, reversalDate, FieldValue), { merge: true });
    for (const [index, item] of items.entries()) {
      tx.delete(lockRefs[index]);
      tx.update(item.ref, {
        status: PAYROLL_STATUS.REVERSED, reversalEntryId: reversalRef.id,
        reversalEntryNumber: nextNumber, reversedAt: FieldValue.serverTimestamp(),
        reversedBy: userId, reversalReason: reason,
      });
    }
    for (const row of allocationRows) {
      const allocation = row.allocation;
      tx.update(row.ref, {
        recovered_amount: allocation.priorRecoveredAmount,
        status: allocation.priorStatus,
        recovered_date: allocation.priorRecoveredDate,
        recovery_method: allocation.priorRecoveryMethod,
        payroll_lock_id: FieldValue.delete(),
        payroll_recovered_at: FieldValue.delete(),
      });
    }
    tx.update(runRef, {
      status: PAYROLL_STATUS.REVERSED,
      reversalEntryId: reversalRef.id, reversalEntryNumber: nextNumber,
      reversedAt: FieldValue.serverTimestamp(), reversedBy: userId, reversalReason: reason,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: userId,
    });
    tx.set(db.collection('audit_logs').doc(), auditRecord(
      'payroll-reverse', id, userId,
      { status: run.status, entryId: entryRef.id },
      { status: PAYROLL_STATUS.REVERSED, reversalEntryId: reversalRef.id, entryNumber: nextNumber },
      reason, FieldValue,
    ));
    return { runId: id, status: PAYROLL_STATUS.REVERSED, reversalEntryId: reversalRef.id, entryNumber: nextNumber };
  });
}

export async function cancelPayroll(db, FieldValue, { runId, reason }, { userId = null } = {}) {
  const id = cleanText(runId, 'معرّف المسير', { required: true });
  const why = cleanText(reason, 'سبب الإلغاء', { required: true });
  const runRef = db.collection('payroll_runs').doc(id);
  return db.runTransaction(async (tx) => {
    const [runSnap, itemsSnap] = await Promise.all([tx.get(runRef), tx.get(runRef.collection('items'))]);
    if (!runSnap.exists) fail('المسير غير موجود.', { code: 'not-found' });
    const run = runSnap.data();
    if (run.status !== PAYROLL_STATUS.DRAFT) fail('لا يُلغى إلا مسير مسودة؛ المعتمد يُلغى اعتماده أولاً.');
    tx.update(runRef, {
      status: PAYROLL_STATUS.CANCELLED, cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: userId, cancellationReason: why, updatedAt: FieldValue.serverTimestamp(),
    });
    for (const item of itemsSnap.docs) tx.update(item.ref, { status: PAYROLL_STATUS.CANCELLED });
    tx.set(db.collection('audit_logs').doc(), auditRecord(
      'payroll-cancel', id, userId, { status: run.status }, { status: PAYROLL_STATUS.CANCELLED }, why, FieldValue,
    ));
    return { runId: id, status: PAYROLL_STATUS.CANCELLED };
  });
}

export const PAYROLL_TEST_ONLY = Object.freeze({
  outstandingOfAdvance,
  payrollJournalLines,
  addUtcDays,
});
