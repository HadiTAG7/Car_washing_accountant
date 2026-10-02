import { describe, it, expect } from 'vitest';
import { partnerAllocationReport } from '../src/partnerAllocationReport.js';
import { dispatch } from '../src/handlers.js';

function database(overrides = {}) {
  const rows = {
    users: [{ id: 'u1', role: 'partner' }, { id: 'admin', role: 'admin' }],
    partners: [{ id: 'p1', workers_count: 1, user_id: 'u1' }, { id: 'p2', workers_count: 9, user_id: 'u2' }],
    chart_of_accounts: [
      { id: '4000', code: '4000', accountType: 'revenue', normalBalance: 'credit' },
      { id: '5100', code: '5100', accountType: 'expense', normalBalance: 'debit', directCost: true },
      { id: '5200', code: '5200', accountType: 'expense', normalBalance: 'debit' },
      { id: '5300', code: '5300', accountType: 'expense', normalBalance: 'debit' },
    ],
    monthly_expenses: [{ id: 'phone', expense_name: 'اتصال', recurrence: 'monthly', total_monthly_cost: 300 }],
    variable_expenses: [{ id: 'm', expense_name: 'مواد', logged_date: '2026-09-01', total_variable_cost: 500, supplier: 'سري', invoice_url: 'https://private.example' }],
    annual_expenses: [{ id: 'rent', expense_name: 'سكن', annual_cost: 180000 }],
    annual_expense_entries: [{ id: 'first-rent', annual_expense_id: 'rent', amount: 180000, spent_date: '2026-09-01' }],
    partner_payments: [
      { id: 'receipt', partner_id: 'p1', amount: 20000, payment_date: '2026-09-01' },
      { id: 'other', partner_id: 'p2', amount: 777777, payment_date: '2026-09-01', notes: 'دفعة الشريك الآخر' },
    ],
    ...overrides,
  };
  const doc = row => ({ id: row.id, exists: true, data: () => row, get: key => row[key] });
  const snap = list => ({ docs: list.map(doc), size: list.length, empty: !list.length });
  const db = { collection(name) {
    let selected = rows[name] || [];
    const q = {
      get: async () => snap(selected),
      select: () => q,
      where: (key, _operator, value) => { selected = selected.filter(r => r[key] === value); return q; },
      limit: n => { selected = selected.slice(0, n); return q; },
      doc: id => ({ get: async () => selected.find(r => r.id === id) ? doc(selected.find(r => r.id === id)) : { exists: false } }),
    };
    return q;
  } };
  return db;
}

describe('توزيع التشغيل حسب المؤهلين مع ثبات رأس المال وخصوصية الشركاء', () => {
  const setup = () => database({
    users: [{ id: 'u1', role: 'partner' }, { id: 'u2', role: 'partner' }, { id: 'admin', role: 'admin' }],
    partners: ['p1', 'p2', 'p3'].map((id, i) => ({ id, workers_count: 10, user_id: `u${i + 1}` })),
    partner_worker_eligibility: [{ id: 'p1', changes: { '2026-10': { eligibleWorkers: 5, reason: 'private travel reason', updatedBy: 'secret admin' }, '2026-12': { eligibleWorkers: 10 } } }],
    monthly_expenses: [{ id: 'salary', expense_name: 'رواتب', recurrence: 'monthly', total_monthly_cost: 3000 }],
    variable_expenses: [{ id: 'fuel', logged_date: '2026-10-02', total_variable_cost: 2500 }],
    annual_expenses: [{ id: 'rent', expense_name: 'سكن', annual_cost: 12000 }],
    annual_expense_entries: [{ id: 'rent-first', annual_expense_id: 'rent', amount: 12000, spent_date: '2026-10-01' }],
    partner_payments: [{ id: 'paid', partner_id: 'p1', amount: 200000, payment_date: '2026-09-01' }],
    journal_entries: [{ id: 'sales', entryDate: '2026-10-01', status: 'posted', lines: [{ accountId: '4000', credit: 25000 }] }],
  });
  it('هادي ٥/٢٥ والباقون ١٠/٢٥ لكل الإيراد والمصاريف والسنوي دون ضياع أو ازدواج التوزيع', async () => {
    const reports = await Promise.all(['p1', 'p2', 'p3'].map(partnerId => partnerAllocationReport(setup(), { partnerId, periodKey: '2026-10', today: new Date('2026-12-03'), includeCapitalJourney: true })));
    const st = reports.map(r => r.statements.find(s => s.periodKey === '2026-10'));
    expect(st.map(s => s.netRevenue)).toEqual([5000, 10000, 10000]);
    expect(st.map(s => s.totalCosts)).toEqual([1100, 2200, 2200]);
    expect(st.map(s => s.annualReserve)).toEqual([200, 400, 400]);
    expect(st[0].eligibility).toMatchObject({ originalWorkers: 10, eligibleWorkers: 5, suspendedWorkers: 5, factor: 0.2 });
    expect(st[1].eligibility).toMatchObject({ originalWorkers: 10, eligibleWorkers: 10, suspendedWorkers: 0, factor: 0.4 });
    expect(reports[0].statements.at(-1).founding.budget).toBe(200000);
    expect(reports[0].capitalJourney.initialTotal).toBe(4000); // original ownership 10/30, not 5/25
    expect(reports[0].statements.find(s => s.periodKey === '2026-09').totalCosts).toBe(1000);
    expect(reports[0].workersCount).toBe(10);
  });
  it('تقرير شريك آخر لا يحمل هوية أو سبب أو تاريخ تعطيل غيره حتى مع تزوير المعرّف', async () => {
    const r = await dispatch(setup(), null, 'partnerInsights', { partnerId: 'p1', includeStatements: true, periodKey: '2026-10' }, { uid: 'u2' });
    expect(r.partnerId).toBe('p2');
    expect(r.statements.at(-1).eligibility).toMatchObject({ eligibleWorkers: 10, suspendedWorkers: 0, effectiveFrom: null });
    expect(JSON.stringify(r)).not.toMatch(/private travel|secret admin|updatedBy|totalEligibleWorkers|"p1"/);
  });
  it('الاستعادة ترجع حسبة الشهر الجديد فقط ولا تغير الأشهر السابقة', async () => {
    const r = await partnerAllocationReport(setup(), { partnerId: 'p1', today: new Date('2026-12-03') });
    expect(r.statements.find(s => s.periodKey === '2026-10').eligibility.factor).toBe(0.2);
    expect(r.statements.find(s => s.periodKey === '2026-11').eligibility.factor).toBe(0.2);
    expect(r.statements.find(s => s.periodKey === '2026-12').eligibility.factor).toBeCloseTo(1 / 3);
  });
  it('الأهلية والتقرير يدخلان شهر السعودية نفسه عند بداية الشهر', async () => {
    const r = await partnerAllocationReport(setup(), { partnerId: 'p1', today: new Date('2026-09-30T21:05:00Z') });
    expect(r.statements.at(-1)).toMatchObject({ periodKey: '2026-10', eligibility: { eligibleWorkers: 5, factor: 0.2 } });
  });
});

describe('تقرير مصروفات الشريك الخادمي', () => {
  const retroDatabase = (payments = [{ id: 'late', partner_id: 'p1', amount: 200000, payment_date: '2026-07-16' }]) => database({
    partners: [{ id: 'p1', workers_count: 10, user_id: 'u1' }, { id: 'p2', workers_count: 40, user_id: 'u2' }],
    monthly_expenses: [], annual_expenses: [], annual_expense_entries: [],
    variable_expenses: [
      { id: 'may', logged_date: '2026-05-01', total_variable_cost: 200 },
      { id: 'june', logged_date: '2026-06-01', total_variable_cost: 234 },
    ], partner_payments: payments,
  });
  it('دفعة يوليو تغطي مايو ويونيو حتى عند اختيار تقرير ينتهي في يونيو دون تغيير تاريخ السند', async () => {
    const receipt = { id: 'late', partner_id: 'p1', amount: 200000, payment_date: '2026-07-16' };
    const r = await partnerAllocationReport(retroDatabase([receipt]), { partnerId: 'p1', periodKey: '2026-06',
      today: new Date('2026-10-03'), includeCapitalJourney: true });
    const [may, june] = r.statements;
    expect(may).toMatchObject({ totalCosts: 40, founding: { funded: 200000, covered: 40, uncovered: 0, cashPaidThroughMonth: 0 } });
    expect(june).toMatchObject({ totalCosts: 46.8, founding: { covered: 46.8, uncovered: 0, remaining: 199913.2, cashPaidThroughMonth: 0 } });
    expect(may.netAfterReserve + may.founding.covered).toBe(0);
    expect(june.netAfterReserve + june.founding.covered).toBe(0);
    expect(r.capitalJourney).toMatchObject({ received: 200000, funded: 200000, operatingTotal: 86.8, remaining: 199913.2, complete: true });
    expect(r.capitalJourney.receipts[0].date).toBe('2026-07-16');
    expect(receipt.payment_date).toBe('2026-07-16');
    expect(r.fundingAsOf).toBe('2026-10-03');
  });
  it('الدفعة الجزئية تغطي الأقدم أولاً ولا تتجاوز المسدد أو تضاعف المصروف في يوليو', async () => {
    const r = await partnerAllocationReport(retroDatabase([{ id: 'late', partner_id: 'p1', amount: 50, payment_date: '2026-07-16' }]),
      { partnerId: 'p1', periodKey: '2026-07', today: new Date('2026-10-03') });
    expect(r.statements[0].founding).toMatchObject({ covered: 40, remaining: 10, uncovered: 0 });
    expect(r.statements[1].founding).toMatchObject({ covered: 10, remaining: 0, uncovered: 36.8 });
    expect(r.statements[2].founding).toMatchObject({ covered: 0, remaining: 0, recordedCost: 86.8, cashPaidThroughMonth: 50 });
    expect(r.statements.reduce((s, month) => s + month.founding.covered, 0)).toBe(50);
  });
  it('عند استكمال السداد يعاد توزيع التغطية دون خصم مصروفات الماضي مرتين', async () => {
    const r = await partnerAllocationReport(retroDatabase([
      { id: 'first', partner_id: 'p1', amount: 50, payment_date: '2026-07-16' },
      { id: 'second', partner_id: 'p1', amount: 36.8, payment_date: '2026-08-01' },
    ]), { partnerId: 'p1', periodKey: '2026-08', today: new Date('2026-10-03') });
    expect(r.statements[1].founding.covered).toBe(46.8);
    expect(r.statements.at(-1).founding).toMatchObject({ remaining: 0, recordedCost: 86.8 });
    expect(r.statements.reduce((s, month) => s + month.founding.covered, 0)).toBe(86.8);
  });
  it('لا يستعير دفعات الشركاء الآخرين أو السندات المستقبلية للتغطية', async () => {
    const r = await partnerAllocationReport(retroDatabase([
      { id: 'future', partner_id: 'p1', amount: 200000, payment_date: '2026-10-20' },
      { id: 'other', partner_id: 'p2', amount: 777777, payment_date: '2026-04-01' },
    ]), { partnerId: 'p1', periodKey: '2026-06', today: new Date('2026-10-03'), includeCapitalJourney: true });
    expect(r.statements[0].founding.covered).toBe(0);
    expect(r.capitalJourney.receipts).toEqual([]);
    expect(r.capitalJourney.received).toBe(0);
  });
  it('تاريخ التمويل يتبع يوم السعودية عند منتصف الليل لا يوم UTC السابق', async () => {
    const r = await partnerAllocationReport(retroDatabase([{ id: 'today', partner_id: 'p1', amount: 200000, payment_date: '2026-10-03' }]),
      { partnerId: 'p1', periodKey: '2026-06', today: new Date('2026-10-02T21:05:00Z') });
    expect(r.fundingAsOf).toBe('2026-10-03');
    expect(r.statements[0].founding.covered).toBe(40);
  });
  it('توزيع الدفعات المتأخرة يبقى محصوراً بميزانية التأسيس ولا يرفعها', async () => {
    const r = await partnerAllocationReport(retroDatabase([{ id: 'extra', partner_id: 'p1', amount: 300000, payment_date: '2026-07-16' }]),
      { partnerId: 'p1', periodKey: '2026-06', today: new Date('2026-10-03'), includeCapitalJourney: true });
    expect(r.capitalJourney).toMatchObject({ funded: 200000, received: 300000, remaining: 199913.2 });
  });
  it('رحلة رأس المال لا تؤكد رصيداً إذا كان يوم سند القبض أو الصرف غير موجود بالتقويم', async () => {
    const r = await partnerAllocationReport(database({
      partner_payments: [{ id: 'invalid-receipt', partner_id: 'p1', payment_date: '2026-09-99', amount: 20000 }],
      startup_costs: [{ id: 'bike', item_name: 'الدباب', actual_amount: 1000 }],
      startup_cost_entries: [{ id: 'bad-date', startup_cost_id: 'bike', amount: 1000, spent_date: '2026-09-99' }],
    }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02'), includeCapitalJourney: true });
    expect(r.capitalJourney.complete).toBe(false);
    expect(r.capitalJourney.receipts).toEqual([]);
    expect(r.capitalJourney.initialItems.find(i => i.description === 'الدباب').date).toBeNull();
    expect(r.capitalJourney.warnings).toHaveLength(2);
  });
  it('رحلة رأس المال تفصل التأسيس والدفعة السنوية الأولى عن التشغيل والاحتياطي دون تغيير القائمة', async () => {
    const db = database({
      startup_costs: [{ id: 'bike', item_name: 'قيمة الدباب', actual_amount: 1000 }],
      startup_cost_entries: [{ id: 'bike-payment', startup_cost_id: 'bike', description: 'اسم عامل سري', notes: 'لا تعرض', invoice_url: 'https://secret.example', amount: 1000, spent_date: '2026-09-02' }],
    });
    const options = { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') };
    const before = await partnerAllocationReport(db, options);
    const r = await partnerAllocationReport(db, { ...options, includeCapitalJourney: true });
    expect(r.statements).toEqual(before.statements);
    expect(r.capitalJourney).toMatchObject({ version: 1, received: 20000, funded: 20000,
      initialTotal: 18100, operatingTotal: 80, reserveTotal: 0, remaining: 1820, complete: true });
    expect(r.capitalJourney.initialItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'قيمة الدباب', amount: 100, date: '2026-09-02' }),
      expect.objectContaining({ description: 'سكن', amount: 18000, kind: 'annual' }),
    ]));
    const json = JSON.stringify(r.capitalJourney);
    for (const forbidden of ['اسم عامل سري', 'لا تعرض', 'secret.example', '777777', 'دفعة الشريك الآخر']) expect(json).not.toContain(forbidden);
    expect(r.capitalJourney.receipts).toHaveLength(1);
  });
  it('رحلة رأس المال تحترم حارس الهوية وتوضح صرف التأسيس الذي لا توجد له مستندات', async () => {
    const db = database({ startup_costs: [{ id: 'legacy', item_name: 'الفرنشايز', actual_amount: 2000 }] });
    const r = await dispatch(db, null, 'partnerInsights', {
      includeStatements: true, includeCapitalJourney: true, partnerId: 'p2', factor: 1, periodKey: '2026-09',
    }, { uid: 'u1' });
    expect(r.partnerId).toBe('p1');
    expect(r.capitalJourney.complete).toBe(false);
    expect(r.capitalJourney.warnings).toContainEqual(expect.objectContaining({ description: 'الفرنشايز', amount: 200 }));
    await expect(dispatch(db, null, 'partnerInsights', { includeStatements: true, includeCapitalJourney: true }, null))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('رحلة رأس المال تعرض العكس مرة واحدة وتطابق الرصيد حتى مع التقريب', async () => {
    const db = database({
      startup_costs: [{ id: 'setup', item_name: 'الفرنشايز', actual_amount: 100.03 }],
      startup_cost_entries: [{ id: 's', startup_cost_id: 'setup', amount: 100.03, spent_date: '2026-08-01' }],
      journal_entries: [
        { id: 's-post', entryDate: '2026-08-01', status: 'reversed', sourceKind: 'startup', sourceId: 's', lines: [{ accountId: '5200', debit: 100.03 }] },
        { id: 's-reverse', entryDate: '2026-09-01', status: 'posted', reversalOf: 's-post', reversedSourceKind: 'startup', lines: [{ accountId: '5200', credit: 100.03 }] },
      ],
    });
    const r = await partnerAllocationReport(db, { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02'), includeCapitalJourney: true });
    expect(r.capitalJourney.initialTotal).toBe(18000);
    expect(r.capitalJourney.initialItems.filter(i => i.description === 'الفرنشايز')).toHaveLength(2);
    expect(r.capitalJourney.initialItems.some(i => i.reversal && i.amount === -10)).toBe(true);
    expect(Math.round(r.capitalJourney.initialItems.reduce((sum, i) => sum + i.amount, 0) * 100)).toBe(1800000);
    expect(r.capitalJourney.remaining).toBe(r.statements.at(-1).founding.remaining);
  });
  it('رحلة رأس المال لا تسمي الالتزام الشهري صرفاً مؤكداً ولا الاحتياطي دفعة ثانية', async () => {
    const r = await partnerAllocationReport(database({ journal_entries: [
      { id: 'sales', entryDate: '2026-09-01', status: 'posted', lines: [{ accountId: '4000', credit: 25000 }] },
    ] }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02'), includeCapitalJourney: true });
    const j = r.capitalJourney;
    expect(j).toMatchObject({ operatingTotal: 80, reserveTotal: 1500, initialTotal: 18000, remaining: 420 });
    expect(j.months[0].groups.find(g => g.key === 'monthly').items[0].basis).toBe('scheduled');
    expect(j.initialItems).toHaveLength(1);
  });
  it.each(['2026-9-4', '2026-8-23', '2026-8-22'])('يقرأ التاريخ القديم %s دون إسقاط المصروف أو تغيير بياناته', async logged_date => {
    const row = { id: 'legacy', expense_name: 'مواد', logged_date, total_variable_cost: 500 };
    const db = database({ variable_expenses: [row] });
    const r = await partnerAllocationReport(db, { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    const month = logged_date.includes('-9-') ? '2026-09' : '2026-08';
    const variable = r.statements.find(s => s.periodKey === month).expenseBreakdown.groups.find(g => g.key === 'variable');
    expect(variable.amount).toBe(50);
    expect(variable.items[0].entryDate).toMatch(/^2026-0[89]-\d{2}$/);
    expect(row.logged_date).toBe(logged_date);
  });
  it('يوحّد صيغة تاريخ الفاتورة دون نقل الاعتراف إلى شهر الصرف', async () => {
    const r = await partnerAllocationReport(database({ variable_expenses: [{
      id: 'legacy', invoice_date: '2026-8-31', logged_date: '2026-9-4', total_variable_cost: 500,
    }] }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements.find(s => s.periodKey === '2026-08').totalCosts).toBe(80);
    expect(r.statements.find(s => s.periodKey === '2026-09').totalCosts).toBe(30);
  });
  it.each(['', '2026-99-1', '2026-2-31', '—'])('لا يخمّن تاريخاً للمصدر غير الصحيح (%s)', async logged_date => {
    await expect(partnerAllocationReport(database({ variable_expenses: [{
      id: 'bad', logged_date, total_variable_cost: 500,
    }] }), { partnerId: 'p1', periodKey: '2026-09' })).rejects.toThrow();
  });
  it('لا يستبدل تاريخ فاتورة غير صحيح بتاريخ صرف صحيح', async () => {
    await expect(partnerAllocationReport(database({ variable_expenses: [{
      id: 'bad', invoice_date: '2026-2-31', logged_date: '2026-09-04', total_variable_cost: 500,
    }] }), { partnerId: 'p1', periodKey: '2026-09' })).rejects.toThrow();
  });
  it('تقرير كامل بتاريخ محدد، لا احتياطي في الخسارة ودفعة التأسيس غير مكررة', async () => {
    const r = await partnerAllocationReport(database(), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements[0]).toMatchObject({ totalCosts: 80, annualReserve: 0, totalAllocation: 80,
      founding: { budget: 20000, initialSpent: 18000, covered: 80, remaining: 1920 } });
    const json = JSON.stringify(r);
    for (const forbidden of ['777777', 'دفعة الشريك الآخر', 'سري', 'private.example', 'taxSnapshot']) expect(json).not.toContain(forbidden);
    expect(r).toMatchObject({ from: '2026-09-01', through: '2026-09-30', factor: 0.1 });
  });
  it('المتصل لا يستطيع اختيار شريك آخر ولا تزوير نسبته', async () => {
    const r = await dispatch(database(), null, 'partnerInsights', { partnerId: 'p2', factor: 1, includeStatements: true, periodKey: '2026-09' }, { uid: 'u1' });
    expect(r.partnerId).toBe('p1');
    expect(r.factor).toBe(0.1);
    await expect(dispatch(database(), null, 'partnerInsights', { includeStatements: true }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('صرف التأسيس المرحّل يخصم من رصيده مرة واحدة ولا يتكرر كمصروف تشغيل', async () => {
    const r = await partnerAllocationReport(database({
      startup_cost_entries: [{ id: 'setup', amount: 1000, spent_date: '2026-09-01' }],
      journal_entries: [{ id: 'setup-post', entryDate: '2026-09-01', status: 'posted', sourceKind: 'startup', sourceId: 'setup', lines: [{ accountId: '5200', debit: 1000 }] }],
    }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements[0]).toMatchObject({ totalCosts: 80, annualReserve: 0, totalAllocation: 80,
      founding: { initialSpent: 18100, covered: 80, remaining: 1820 } });
  });
  it('المدير يحاكي الشريك بنفس الحسبة دون تعديل حالته', async () => {
    const r = await dispatch(database(), null, 'partnerInsights', { partnerId: 'p1', includeStatements: true, periodKey: '2026-09' }, { uid: 'admin' });
    expect(r.statements[0].totalAllocation).toBe(80);
  });
  it('تجديد العام الثاني يستخدم الاحتياطي ولا يخصم دفعة تأسيس أولى ثانية', async () => {
    const r = await partnerAllocationReport(database({ annual_expense_entries: [
      { id: 'a', annual_expense_id: 'rent', amount: 180000, spent_date: '2025-09-01' },
      { id: 'b', annual_expense_id: 'rent', amount: 180000, spent_date: '2026-09-01' },
    ] }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements.at(-1).founding.initialSpent).toBe(0);
  });
  it('مصدر غير متاح ليس صفراً، والفترة غير الصالحة لا تصبح تقرير العمر كله', async () => {
    const db = database();
    const original = db.collection;
    db.collection = name => name === 'variable_expenses' ? { get: async () => { throw new Error('source unavailable'); } } : original(name);
    await expect(partnerAllocationReport(db, { partnerId: 'p1' })).rejects.toThrow('source unavailable');
    await expect(partnerAllocationReport(database(), { partnerId: 'p1', periodKey: '2026-99' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('عكس الدفعة الأولى يعيد رصيد التأسيس ولا يعيد تحميل المصدر الخام', async () => {
    const journal_entries = [
      { id: 'rent-post', entryDate: '2026-09-01', status: 'reversed', sourceType: 'expense', sourceId: 'first-rent', lines: [{ accountId: '5300', debit: 180000 }] },
      { id: 'mirror', entryDate: '2026-09-02', status: 'posted', reversalOf: 'rent-post', reversedSourceKind: 'expense', lines: [{ accountId: '5300', credit: 180000 }] },
    ];
    const r = await partnerAllocationReport(database({ journal_entries }), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements[0].founding.initialSpent).toBe(0);
    expect(r.statements[0].founding.remaining).toBe(19920);
  });
  it('حد الربح يأتي من الخادم ولا يمكن للمتصل تجاوزه ببيانات طلبه', async () => {
    const db = database({ journal_entries: [
      { id: 'sales', entryDate: '2026-09-01', status: 'posted', lines: [{ accountId: '4000', credit: 10000 }] },
    ] });
    const r = await dispatch(db, null, 'partnerInsights', {
      partnerId: 'p2', factor: 1, annualReserve: 9000, includeStatements: true, periodKey: '2026-09',
    }, { uid: 'u1' });
    expect(r.partnerId).toBe('p1');
    expect(r.statements[0]).toMatchObject({ annualReserve: 782, netAfterReserve: 0, totalFees: 138,
      renewalReserve: { reason: 'limited', availableProfit: 782 } });
  });
  it('شهر خسارة ثم ربح لا يرحّل احتياطياً متأخراً ولا يقلل رصيد التأسيس به', async () => {
    const r = await partnerAllocationReport(database({ journal_entries: [
      { id: 'sales', entryDate: '2026-10-01', status: 'posted', lines: [{ accountId: '4000', credit: 25000 }] },
    ] }), { partnerId: 'p1', periodKey: '2026-10', today: new Date('2026-10-02') });
    const [loss, profit] = r.statements;
    expect(loss.annualReserve).toBe(0);
    expect(loss.founding.remaining).toBe(1920);
    expect(profit.annualReserve).toBe(1500);
    expect(profit.totalAllocation).toBe(1530);
    expect(profit.founding.remaining).toBe(390);
  });
});
