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

describe('تقرير مصروفات الشريك الخادمي', () => {
  it('تقرير كامل بتاريخ محدد، سنوي محجوز ودفعة التأسيس غير مكررة', async () => {
    const r = await partnerAllocationReport(database(), { partnerId: 'p1', periodKey: '2026-09', today: new Date('2026-10-02') });
    expect(r.statements[0]).toMatchObject({ totalCosts: 80, annualReserve: 1500, totalAllocation: 1580,
      founding: { budget: 20000, initialSpent: 18000, covered: 1580, remaining: 420 } });
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
    expect(r.statements[0]).toMatchObject({ totalCosts: 80, annualReserve: 1500, totalAllocation: 1580,
      founding: { initialSpent: 18100, covered: 1580, remaining: 320 } });
  });
  it('المدير يحاكي الشريك بنفس الحسبة دون تعديل حالته', async () => {
    const r = await dispatch(database(), null, 'partnerInsights', { partnerId: 'p1', includeStatements: true, periodKey: '2026-09' }, { uid: 'admin' });
    expect(r.statements[0].totalAllocation).toBe(1580);
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
    expect(r.statements[0].founding.remaining).toBe(18420);
  });
});
