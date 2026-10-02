import { describe, expect, it } from 'vitest';
import { partnerOperatingStatement, partnerFoundingAllocation } from '../partnerOperatingStatement.js';

const accounts = [
  { code: '4000', accountType: 'revenue', normalBalance: 'credit', nameArabic: 'إيرادات' },
  { code: '4010', accountType: 'revenue', normalBalance: 'debit', contra: true },
  { code: '5010', accountType: 'expense', normalBalance: 'debit', directCost: true, nameArabic: 'رواتب' },
  { code: '5000', accountType: 'expense', normalBalance: 'debit', directCost: true },
  { code: '5100', accountType: 'expense', normalBalance: 'debit', directCost: true },
  { code: '5200', accountType: 'expense', normalBalance: 'debit' },
  { code: '5300', accountType: 'expense', normalBalance: 'debit' },
];
const data = {
  accounts, entries: [], lines: [],
  monthlyExpenses: [{ id: 'phone', expense_name: 'اتصالات', recurrence: 'monthly', total_monthly_cost: 300 }],
  variableExpenses: [{ id: 'materials', expense_name: 'مواد غسيل', logged_date: '2026-09-03', total_variable_cost: 500 }],
  annualExpenses: [{ id: 'housing', expense_name: 'سكن', annual_cost: 180000 }],
};
const compute = (over = {}) => partnerOperatingStatement({ ...data, periodKey: '2026-09', scalingFactor: 0.1, ...over });

describe('تقرير الشريك: كل المصروفات دون تكرار، واحتياطي السنوي', () => {
  it('يجمع الشهري والمتغير والسنوي ÷ 12 ويوزع مرة واحدة', () => {
    const r = compute();
    expect(r.expenseBreakdown.groups.map(g => [g.key, g.amount])).toEqual([
      ['variable', 50], ['monthly', 30], ['annual', 1500], ['other', 0],
    ]);
    expect(r.totalCosts).toBe(80);
    expect(r.annualReserve).toBe(1500);
    expect(r.totalAllocation).toBe(1580);
    expect(r.netAfterReserve).toBe(-1580);
  });

  it('البند الشهري لمرة واحدة يخص شهره، والمتغير لا ينتقل لشهر آخر', () => {
    expect(compute({ monthlyExpenses: [{ ...data.monthlyExpenses[0], recurrence: 'one_time', logged_date: '2026-08-03' }] }).totalCosts).toBe(50);
    expect(compute({ periodKey: '2026-10' }).totalCosts).toBe(30);
  });

  it('يفضّل المبلغ المرحّل على المصدر ولا يضيفه ثانية', () => {
    const entries = [{ id: 'v', entryDate: '2026-09-03', status: 'posted', sourceKind: 'variable', sourceId: 'materials' }];
    const lines = [{ id: 'l', entryId: 'v', accountId: '5100', debit: 450, credit: 0 }];
    expect(compute({ entries, lines }).totalCosts).toBe(75);
  });
  it('القيد القديم بلا sourceKind لا يكرر المصروف الخام', () => {
    const entries = [{ id: 'v', entryDate: '2026-09-03', status: 'posted', sourceType: 'expense', sourceId: 'materials' }];
    const lines = [{ id: 'l', entryId: 'v', accountId: '5100', debit: 450 }];
    expect(compute({ entries, lines }).totalCosts).toBe(75);
  });

  it('السند الشهري يحل مكان القالب حتى لو تغيّرت قيمة القالب', () => {
    const vouchers = [{ id: 'phone__2026-09', templateId: 'phone', templateName: 'اتصالات', periodKey: '2026-09', dueDate: '2026-09-01', amount: 200, status: 'active' }];
    expect(compute({ vouchers }).totalCosts).toBe(70);
    expect(compute({ vouchers: [{ ...vouchers[0], status: 'cancelled' }] }).totalCosts).toBe(50);
  });

  it('الرواتب لا تلغي بقية المصروفات، والدفعة السنوية الأولى ليست مصروفاً متكرراً', () => {
    const entries = [
      { id: 'salary', entryDate: '2026-09-01', status: 'posted', sourceType: 'payroll' },
      { id: 'rent', entryDate: '2026-09-01', status: 'posted', sourceKind: 'annual', sourceId: 'rent-payment' },
    ];
    const lines = [
      { id: 's', entryId: 'salary', accountId: '5010', debit: 1000 },
      { id: 'a', entryId: 'rent', accountId: '5300', debit: 180000 },
    ];
    const r = compute({ entries, lines });
    expect(r.totalCosts).toBe(180);
    expect(r.annualReserve).toBe(1500);
    expect(r.ledgerStatement.operatingExpenses).toBe(18000);
  });

  it('العكس لا يعيد إحياء المصروف الخام الملغى ولا يضاعف المبلغ السالب', () => {
    const entries = [
      { id: 'v', entryDate: '2026-09-03', status: 'reversed', sourceKind: 'variable', sourceId: 'materials' },
      { id: 'rev', entryDate: '2026-09-04', status: 'posted', reversalOf: 'v', reversedSourceKind: 'variable' },
    ];
    const lines = [{ id: 'a', entryId: 'v', accountId: '5100', debit: 500 }, { id: 'b', entryId: 'rev', accountId: '5100', credit: 500 }];
    expect(compute({ entries, lines }).totalCosts).toBe(30);
  });

  it('احتياطي 12 شهراً يساوي البند السنوي بالهللة حتى مع التقريب', () => {
    const results = Array.from({ length: 12 }, (_, i) => compute({ periodKey: `2026-${String(i + 1).padStart(2, '0')}`, annualExpenses: [{ id: 'a', expense_name: 'قوى', annual_cost: 13978.25 }] }));
    expect(Math.round(results.reduce((s, r) => s + r.annualReserve, 0) * 100)).toBe(Math.round(13978.25 * 0.1 * 100));
    for (const r of results) expect(r.expenseBreakdown.total).toBe(r.totalAllocation);
  });
  it('يشمل عمولات سجل الغسلات ولا يضيفها فوق العمولات المُرحّلة', () => {
    const dynamicCommissions = [{ id: 'comm', periodKey: '2026-09', amount: 400 }];
    expect(compute({ dynamicCommissions }).totalCosts).toBe(120);
    const entries = [{ id: 'c', entryDate: '2026-09-01', status: 'posted', sourceType: 'payroll' }];
    const lines = [{ id: 'c1', entryId: 'c', accountId: '5000', debit: 400 }];
    expect(compute({ entries, lines, dynamicCommissions }).totalCosts).toBe(120);
  });
  it('مردود المبيعات يخفض إيراد التقرير التشغيلي كما يخفض الدفتر', () => {
    const entries = [{ id: 'rev', entryDate: '2026-09-01', status: 'posted' }];
    const lines = [{ id: 'r1', entryId: 'rev', accountId: '4000', credit: 10000 }, { id: 'r2', entryId: 'rev', accountId: '4010', debit: 1000 }];
    expect(compute({ entries, lines }).netRevenue).toBe(900);
  });
});

describe('رصيد التأسيس لكل شريك — 20 ألف للبايكر', () => {
  it('يحد الرصيد بالمبلغ المسدد، ولا يحتسب رصيداً نقدياً لم يُدفع', () => {
    const r = partnerFoundingAllocation({ workersCount: 2, paid: 25000, spentBefore: 24000, initialSpentThisMonth: 500, statement: { totalAllocation: 1200 } });
    expect(r).toMatchObject({ budget: 40000, funded: 25000, opening: 1000, initialSpent: 500, covered: 500, uncovered: 700, remaining: 0 });
  });
  it('عند عبور الرصيد لا تُعفى مصروفات الشهر كلها: يعزل المغطى والزائد', () => {
    const r = partnerFoundingAllocation({ workersCount: 1, paid: 20000, spentBefore: 19500, statement: { totalAllocation: 1000 } });
    expect(r).toMatchObject({ covered: 500, uncovered: 500, remaining: 0 });
  });
});
