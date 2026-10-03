// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const partnerView = {
  viewedPartner: { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3, userId: 'uid1' },
  investorLinkMissing: false,
  scalingFactor: 0.3,
  totalWorkers: 10,
};
const paymentsState = { payments: [], loading: false, error: null };
const ledgerState = { accounts: [], entries: [], lines: [], periods: [], loading: false, error: null };
const insightsState = { insights: null, washMonths: [], loading: false, error: null };
let statementError = null;
let statementOverrides = {};
vi.mock('../../hooks/usePartnerStatement', () => ({ usePartnerStatement: () => {
  const keys = [...new Set(ledgerState.entries.map(e => e.periodKey))];
  if (!keys.length) keys.push(new Date().toISOString().slice(0, 7));
  const factor = partnerView.scalingFactor;
  return { loading: false, error: statementError, report: {
    asOf: '2026-10-03T18:00:00Z', from: '2026-05-01', through: '2026-09-30',
    statements: keys.map(periodKey => ({
      ...monthlyStatement({ scalingFactor: factor }), periodKey,
      annualReserve: 10000 * factor, totalAllocation: 150000 * factor,
      totalFees: 0,
      netAfterReserve: COMPANY_NET * factor,
      founding: { available: true, budget: 60000, funded: 30000, covered: 30000, remaining: 0, uncovered: 15000 },
      ...statementOverrides[periodKey],
    })),
  } };
} }));

vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => partnerView }));
vi.mock('../../hooks/usePartnerPayments', () => ({ usePartnerPayments: () => paymentsState }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ledgerState }));
vi.mock('../../hooks/useFeeRules', () => ({ useFeeRules: () => ({ rules: [] }) }));
vi.mock('../../hooks/usePartnerInsights', () => ({ usePartnerInsights: () => insightsState }));

let COMPANY_NET = 50000;
// قائمة جاهزة بأرقام الشركة — المكوّن يقسمها بـ scalingFactor.
vi.mock('../../lib/accounting/monthlyStatement', () => ({
  monthlyStatement: ({ scalingFactor = 1 }) => ({
    hasActivity:  true,
    grossRevenue: 200000 * scalingFactor,
    salesReturns: 0,
    otherRevenue: 0,
    netRevenue:   200000 * scalingFactor,
    directCosts:  90000 * scalingFactor,
    grossProfit:  110000 * scalingFactor,
    operatingExpenses: 60000 * scalingFactor,
    netProfitBeforeFees: 50000 * scalingFactor,
    totalCosts:   150000 * scalingFactor,
    expenseBreakdown: {
      total: 150000 * scalingFactor,
      fixedTotal: 90000 * scalingFactor,
      groups: [
        { key: 'variable', label: 'المصروفات المتغيرة والعمولات', amount: 60000 * scalingFactor,
          items: [{ id: 'v1', entryDate: '2026-08-03', accountName: 'مواد تشغيل', description: 'مستلزمات الغسيل', amount: 60000 * scalingFactor }] },
        { key: 'monthly', label: 'المصروفات الثابتة الشهرية والرواتب', amount: 80000 * scalingFactor,
          items: [{ id: 'm1', entryDate: '2026-08-04', accountName: 'رواتب', description: 'رواتب البايكرز', amount: 80000 * scalingFactor }] },
        { key: 'annual', label: 'المصروفات السنوية', amount: 10000 * scalingFactor,
          items: [{ id: 'a1', groupKey: 'annual', entryDate: '2026-08-05', accountName: 'مصروفات سنوية', description: 'إيجار السكن', annualAmount: 120000 * scalingFactor, amount: 10000 * scalingFactor }] },
        { key: 'other', label: 'بنود أخرى', amount: 0, items: [] },
      ],
    },
    fees: [],
    netProfit:    COMPANY_NET * scalingFactor,
  }),
}));

const InvestorPage = (await import('../InvestorPage')).default;
const { IncomeStatementCard, FoundingStageNotice } = await import('../InvestorPage');
const { PartnerComparisonCard } = await import('../InvestorPage');
const { monthlyStatement } = await import('../../lib/accounting/monthlyStatement');

/**
 * المبلغ المعروض في صفٍّ من القائمة.
 *
 * يُلتقط بنمطه لا بتجريد ما ليس رقماً: رمز العملة «ر.س» يحمل نقطة، فتجريدُ
 * الحروف وحدها يترك نقطتين في السلسلة ويُنتج NaN.
 */
function amountIn(row) {
  const text = row.querySelectorAll('td')[1].textContent;
  const match = text.match(/\d[\d,\u066C]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/[,\u066C]/g, '')) : NaN;
}

afterEach(() => {
  cleanup();
  COMPANY_NET = 50000;
  statementError = null;
  statementOverrides = {};
  partnerView.investorLinkMissing = false;
  partnerView.partnerLinkLoading = false;
  partnerView.partnerLinkError = null;
  partnerView.recheckPartnerLink = undefined;
  partnerView.viewedPartner = { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3, userId: 'uid1' };
  partnerView.scalingFactor = 0.3;
  partnerView.totalWorkers = 10;
  paymentsState.payments = [];
  ledgerState.entries = [];
  ledgerState.accounts = [];
  ledgerState.lines = [];
  ledgerState.periods = [];
  insightsState.insights = null;
  insightsState.washMonths = [];
});

describe('مقارنة فترات الشريك', () => {
  it('المقارنة مطوية افتراضياً وتتيح اختيار شهرين دون كشف النسبة', () => {
    const st = periodKey => ({ ...monthlyStatement({ scalingFactor: 0.2 }), periodKey, annualReserve: 50, netAfterReserve: 9950 });
    render(<PartnerComparisonCard report={{ statements: [st('2026-08'), st('2026-07')] }} activeMonth="2026-08" />);
    const summary = screen.getByText('مقارنة تقاريرك');
    expect(summary.closest('details').open).toBe(false);
    fireEvent.click(summary);
    expect(summary.closest('details').open).toBe(true);
    expect(screen.getByLabelText('الفترة الأولى').value).toBe('2026-08');
    expect(screen.getByLabelText('الفترة الثانية').value).toBe('2026-07');
    expect(screen.getByRole('table', { name: 'مقارنة أرقام حصتك' })).toBeTruthy();
    expect(screen.queryByText(/20\.0%/)).toBeNull();
    fireEvent.change(screen.getByLabelText('نوع المقارنة'), { target: { value: 'year' } });
    expect(screen.getByText('عشان تقارن، اختار فترتين مختلفتين')).toBeTruthy();
  });
});

describe('صفحة المستثمر — قائمة الدخل', () => {
  const foundingCard = status => <IncomeStatementCard sharePercent={20} hasShare paid={200000}
    availableMonths={['2026-05']} activeMonth="2026-05" onMonthChange={() => {}}
    statement={{ ...monthlyStatement({ scalingFactor: 0 }), netAfterReserve: 0 }}
    foundingStatus={{ available: true, budget: 200000, funded: 200000, covered: 0, remaining: 38182.14, uncovered: 0, ...status }} />;

  it.each([0, 15000])('تزيل بند ما بعد التأسيس بقيمة %s وفقرة الرصيد التحليلي دون تغيير بيانات المصدر', uncovered => {
    const status = { available: true, budget: 60000, funded: 60000, covered: 30000,
      remaining: 38182.14, uncovered, fundingAsOf: '2026-10-03' };
    const before = JSON.stringify(status);
    render(<FoundingStageNotice status={status} />);
    expect(screen.getByText('المدفوع من التأسيس هذا الشهر').textContent).toContain('30,000.00');
    const remaining = screen.getByText('المتبقي من مبلغ التأسيس');
    expect(remaining.textContent).toContain('38,182.14');
    expect(remaining.parentElement.children).toHaveLength(2);
    expect(screen.queryByText('بعد ما يخلص رصيد التأسيس')).toBeNull();
    expect(screen.queryByText(/هذا رصيد تحليلي من المبالغ اللي سددتها/)).toBeNull();
    expect(screen.getByText(/حتى لو سددت متأخر/)).toBeTruthy();
    expect(JSON.stringify(status)).toBe(before);
  });

  it('رصيد التأسيس المتاح مفتوح افتراضياً ويمكن إخفاؤه وإظهاره دون تغيير النتيجة', () => {
    render(foundingCard({}));
    const title = screen.getByText('رصيد مصاريف التأسيس');
    const details = title.closest('details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(true);
    fireEvent.click(title.closest('summary'));
    expect(details.open).toBe(false);
    fireEvent.click(title.closest('summary'));
    expect(details.open).toBe(true);
    expect(screen.getByText('المتبقي من مبلغ التأسيس').textContent).toContain('38,182.14');
    expect(amountIn(screen.getByText('= نتيجتك بعد تغطية التأسيس').closest('tr'))).toBe(0);
  });

  it('رصيد التأسيس المنتهي مطوي افتراضياً وتبقى إمكانية إظهار تفاصيله', () => {
    render(foundingCard({ remaining: 0 }));
    const title = screen.getByText('رصيد مصاريف التأسيس');
    const details = title.closest('details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    fireEvent.click(title.closest('summary'));
    expect(details.open).toBe(true);
  });

  it('يطوي التفاصيل عند نفاد الرصيد أثناء تحديث التقرير ويعيد فتحها عند توفر رصيد', () => {
    const { rerender } = render(foundingCard({}));
    rerender(foundingCard({ remaining: 0 }));
    expect(screen.getByText('رصيد مصاريف التأسيس').closest('details')?.open).toBe(false);
    rerender(foundingCard({ remaining: 100 }));
    expect(screen.getByText('رصيد مصاريف التأسيس').closest('details')?.open).toBe(true);
  });

  it('عدم وجود دفعات لا يعني أن رسوم التأسيس قد نفدت', () => {
    render(foundingCard({ funded: 0, remaining: 0 }));
    expect(screen.getByText('رصيد مصاريف التأسيس').closest('details')?.open).toBe(true);
  });

  it('توضح تغطية السداد المتأخر وتبقي شهر المصروف وتعرض نتيجة صفر بعد التغطية', () => {
    render(<IncomeStatementCard sharePercent={20} hasShare paid={200000} availableMonths={['2026-05']}
      activeMonth="2026-05" onMonthChange={() => {}} statement={{ ...monthlyStatement({ scalingFactor: 0 }),
        netAfterReserve: -40, totalCosts: 40, totalAllocation: 40 }}
      foundingStatus={{ available: true, budget: 200000, funded: 200000, covered: 40,
        remaining: 199960, uncovered: 0, fundingAsOf: '2026-10-03', cashPaidThroughMonth: 0 }} />);
    expect(screen.getByText(/حتى لو سددت متأخر/)).toBeTruthy();
    expect(screen.getByText(/ما تغيّر تاريخ الدفع/)).toBeTruthy();
    expect(amountIn(screen.getByText('تغطية من رصيد رسوم التأسيس').closest('tr'))).toBe(40);
    expect(amountIn(screen.getByText('= نتيجتك بعد تغطية التأسيس').closest('tr'))).toBe(0);
    expect(screen.getByRole('combobox', { name: 'فترة التقرير (الشهر)' }).value).toBe('2026-05');
  });
  it('زر الاحتياطي يشرح المعنى والسياسة ويغلق الشرح عند الضغط ثانية', () => {
    render(<InvestorPage view="income" />);
    const button = screen.getByRole('button', { name: 'شرح احتياطي التجديد السنوي' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/نخصص جزء من ربح الشهر لتجديد/)).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const explanation = document.getElementById(button.getAttribute('aria-controls'));
    expect(explanation.textContent).toContain('نخصص جزء من ربح الشهر لتجديد');
    expect(explanation.textContent).toContain('إذا الشهر فيه خسارة أو تعادل، ما نحجز أي مبلغ');
    expect(explanation.textContent).toContain('بعد المصروفات والرسوم');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/نخصص جزء من ربح الشهر لتجديد/)).toBeNull();
  });
  it.each(['no-profit', 'limited'])('يبين سبب احتياطي الشهر (%s) ولا يعرض المخطط كخصم', reason => {
    const reserved = reason === 'limited' ? 50 : 0;
    render(<IncomeStatementCard sharePercent={20} hasShare paid={0}
      availableMonths={['2026-09']} activeMonth="2026-09" onMonthChange={vi.fn()}
      statement={{ hasActivity: true, netRevenue: 100, netProfit: reserved, netAfterReserve: 0,
        annualReserve: reserved, fees: [], renewalReserve: { scheduledAmount: 100, availableProfit: reserved, reason },
        expenseBreakdown: { total: reserved, fixedTotal: reserved, groups: [
          { key: 'annual', amount: reserved, items: [
            { id: 'a', description: 'إيجار السكن', annualAmount: 1200, scheduledAmount: 100, amount: reserved },
          ] },
        ] },
      }} />);
    const button = screen.getByRole('button', { name: 'شرح احتياطي التجديد السنوي' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل احتياطي التجديد السنوي — حصة هذا الشهر' }));
    expect(amountIn(screen.getByText('إيجار السكن').closest('tr'))).toBe(reserved);
    if (reason === 'no-profit') expect(screen.getByText('ما احتسبنا احتياطي لهالشهر، لأن ما فيه ربح متاح.')).toBeTruthy();
    else expect(screen.getByText('حجزنا قدّ الربح المتاح بس، وهو أقل من الحصة الشهرية المخططة.')).toBeTruthy();
  });
  it('تظهر المجاميع وحدها أولاً، وكل مجموعة تفتح وتغلق تفاصيلها دون تغيير المجموع', () => {
    render(<InvestorPage view="income" />);
    const table = screen.getByText('= حصتك التحليلية من نتيجة الشركة').closest('table');
    for (const [label, description, expected] of [
      ['المصاريف المتغيرة والعمولات', 'مستلزمات الغسيل', 18000],
      ['المصاريف الشهرية والرواتب', 'رواتب البايكرز', 24000],
      ['احتياطي التجديد السنوي — حصة هذا الشهر', 'إيجار السكن', 3000],
    ]) {
      const totalRow = screen.getByText(label).closest('tr');
      const button = screen.getByRole('button', { name: `تفاصيل ${label}` });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText(description)).toBeNull();
      const before = amountIn(totalRow);
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const itemRow = screen.getByText(description).closest('tr');
      expect(table.contains(itemRow)).toBe(true);
      expect(document.getElementById(button.getAttribute('aria-controls')).contains(itemRow)).toBe(true);
      expect(amountIn(itemRow)).toBe(expected);
      expect(screen.getByText(description).closest('details')).toBeNull();
      expect(screen.getAllByText(description)).toHaveLength(1);
      expect(amountIn(totalRow)).toBe(before);
      fireEvent.click(button);
      expect(screen.queryByText(description)).toBeNull();
      expect(amountIn(totalRow)).toBe(before);
    }
  });

  it('يحافظ على قسمة السنوي والأرصدة ويبدل التفاصيل مع الشهر دون إعادة احتساب الحصة', () => {
    const onMonthChange = vi.fn();
    const props = {
      sharePercent: 20, hasShare: true, paid: 40000, foundingStatus: null,
      availableMonths: ['2026-08', '2026-09'], activeMonth: '2026-08', onMonthChange,
      statement: {
        hasActivity: true, netRevenue: 900, netProfit: 600, netAfterReserve: 500,
        annualReserve: 100, fees: [],
        expenseBreakdown: { total: 400, fixedTotal: 100, groups: [
          { key: 'variable', amount: 0, items: [] },
          { key: 'monthly', amount: 0, items: [] },
          { key: 'other', amount: 300, items: [
            { id: 'o1', description: 'صيانة استثنائية', accountName: 'صيانة', entryDate: '2026-08-10', amount: 300 },
          ] },
          { key: 'annual', amount: 100, items: [
            { id: 'a1', groupKey: 'annual', description: 'تجديد التأمين', annualAmount: 1200, amount: 100 },
          ] },
        ] },
      },
    };
    const { rerender } = render(<IncomeStatementCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل احتياطي التجديد السنوي — حصة هذا الشهر' }));
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل المصاريف الأخرى' }));
    const annualRow = screen.getByText('تجديد التأمين').closest('tr');
    expect(annualRow?.textContent).toMatch(/حصتك السنوية.*1,200.*÷ 12/);
    expect(amountIn(annualRow)).toBe(100);
    expect(amountIn(screen.getByText('صيانة استثنائية').closest('tr'))).toBe(300);
    expect(amountIn(screen.getByText('= حصتك التحليلية من نتيجة الشركة').closest('tr'))).toBe(500);
    fireEvent.change(screen.getByRole('combobox', { name: 'فترة التقرير (الشهر)' }), { target: { value: '2026-09' } });
    expect(onMonthChange).toHaveBeenCalledWith('2026-09');
    rerender(<IncomeStatementCard {...props} activeMonth="2026-09" statement={{
      ...props.statement, annualReserve: 0, expenseBreakdown: { total: 0, fixedTotal: 0, groups: [] },
    }} />);
    expect(screen.queryByText('تجديد التأمين')).toBeNull();
    expect(screen.queryByText('صيانة استثنائية')).toBeNull();
  });

  it('لا يخفي البنود المتقابلة عندما يكون صافي مجموعتها صفراً', () => {
    render(<IncomeStatementCard sharePercent={20} hasShare paid={0} availableMonths={['2026-09']}
      activeMonth="2026-09" onMonthChange={vi.fn()} statement={{
        hasActivity: true, netRevenue: 0, netProfit: 0, annualReserve: 0, fees: [],
        expenseBreakdown: { total: 0, fixedTotal: 0, groups: [
          { key: 'other', amount: 0, items: [
            { id: 'cost', description: 'مصروف صيانة', accountName: 'صيانة', entryDate: '2026-09-01', amount: 100 },
            { id: 'refund', description: 'استرداد صيانة', accountName: 'صيانة', entryDate: '2026-09-02', amount: -100 },
          ] },
        ] },
      }} />);
    expect(screen.getByText('المصاريف الأخرى')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل المصاريف الأخرى' }));
    expect(screen.getByText('مصروف صيانة').closest('tr')).toBeTruthy();
    expect(screen.getByText('استرداد صيانة').closest('tr').textContent).toMatch(/-100/);
  });

  it('يعرض انتظار التحقق لا رسالة فقد الربط', () => {
    partnerView.viewedPartner = null;
    partnerView.partnerLinkLoading = true;
    render(<InvestorPage />);
    expect(screen.getByText('نتأكد من ربط حسابك...')).toBeTruthy();
    expect(screen.queryByText(/حسابك للحين ما انربط بسجل شريك/)).toBeNull();
  });

  it('يفصل خطأ القراءة عن فقد الربط ويتيح إعادة القراءة فقط', () => {
    partnerView.viewedPartner = null;
    partnerView.partnerLinkError = new Error('connection failed');
    partnerView.recheckPartnerLink = vi.fn();
    render(<InvestorPage />);
    expect(screen.getByText('ما قدرنا نتأكد من ربط حسابك')).toBeTruthy();
    expect(screen.queryByText(/حسابك للحين ما انربط بسجل شريك/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(partnerView.recheckPartnerLink).toHaveBeenCalledOnce();
  });

  it('يعرض ميزانية التأسيس للشريك 20 ألف لكل بايكر، بدلاً من حد شركة عام', () => {
    ledgerState.accounts = [{ code: '5010', accountType: 'expense' }];
    ledgerState.entries = [{ id: 'e1', entryDate: '2026-08-04', periodKey: '2026-08', status: 'posted', sourceKind: 'monthly' }];
    ledgerState.lines = [{ id: 'l1', entryId: 'e1', accountId: '5010', debit: 100000, credit: 0 }];
    COMPANY_NET = -20000;
    render(<InvestorPage view="income" />);
    expect(screen.getByText('رصيد مصاريف التأسيس')).toBeTruthy();
    expect(screen.getByText(/ميزانيتك:.*60,000.*20,000/)).toBeTruthy();
    expect(screen.getByText('= نتيجتك بعد تغطية التأسيس')).toBeTruthy();
  });
  it('النتيجة السالبة لا تُعرض كخسارة شخصية جديدة فوق رسوم الشريك المدفوعة', () => {
    COMPANY_NET = -20000;
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 30000, paymentDate: '2026-07-01' }];
    render(<InvestorPage view="income" />);
    expect(screen.getByText('= حصتك التحليلية من نتيجة الشركة')).toBeTruthy();
    expect(screen.getByText(/هذي النتيجة مو مطالبة مالية جديدة عليك/)).toBeTruthy();
    expect(screen.getByText(/المسجّل في سندات رأس مالك:.*30,000/)).toBeTruthy();
    expect(screen.queryByText('= صافي ربحك من هذا الشهر')).toBeNull();
  });
  it('تعرض قائمة الدخل ببنودها', () => {
    render(<InvestorPage view="income" />);
    for (const label of ['حصتك من صافي الإيرادات', 'المصاريف المتغيرة والعمولات',
      'المصاريف الشهرية والرواتب', 'احتياطي التجديد السنوي — حصة هذا الشهر']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it.each([0.2, 0.35])('عنوان قائمة الدخل لا يكشف نسبة الشريك (%s) ولا يغير مبالغه', factor => {
    partnerView.scalingFactor = factor;
    render(<InvestorPage view="income" />);
    const heading = screen.getByRole('heading', { name: 'قائمة الدخل — حصّتك' });
    expect(heading.parentElement.textContent).not.toMatch(/[%٪]/);
    expect(heading.parentElement.textContent).toContain('إيراداتك ومصاريفك ونتيجة الشهر');
    expect(amountIn(screen.getByText('حصتك من صافي الإيرادات').closest('tr'))).toBe(200000 * factor);
  });

  it('تعرض حصة الشريك من الفئات والبنود التفصيلية دون كشف شريك آخر', () => {
    render(<InvestorPage view="income" />);
    expect(screen.getByText(/هذي تفاصيل حصتك من المصروفات/)).toBeTruthy();
    expect(screen.getByText('المصاريف المتغيرة والعمولات')).toBeTruthy();
    expect(screen.getByText('المصاريف الشهرية والرواتب')).toBeTruthy();
    expect(screen.getByText('احتياطي التجديد السنوي — حصة هذا الشهر')).toBeTruthy();
    expect(screen.getByText(/إجمالي المصروفات الثابتة الشهرية والسنوية/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل المصاريف الشهرية والرواتب' }));
    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل احتياطي التجديد السنوي — حصة هذا الشهر' }));
    expect(screen.getByText('رواتب البايكرز')).toBeTruthy();
    expect(screen.getByText('إيجار السكن')).toBeTruthy();
    expect(screen.getByText(/إجمالي مصروفاتك واحتياطي التجديد:/)).toBeTruthy();
    expect(screen.queryByText('هادي الغانم')).toBeNull();
  });

  it('السطر الأخير نتيجة تحليلية للقارئ لا توزيع أرباح أو مطالبة شخصية', () => {
    render(<InvestorPage view="income" />);
    expect(screen.getByText('= حصتك التحليلية من نتيجة الشركة')).toBeTruthy();
    expect(screen.queryByText('= صافي الربح النهائي للشركاء')).toBeNull();
  });

  it('القسمة مطبَّقة فعلاً لا معروضة فقط', () => {
    // الرقم يُقرأ من صفّ النتيجة وحده: مبلغٌ مطابق في موضع آخر من الصفحة
    // لا يثبت شيئاً عن هذا السطر.
    partnerView.scalingFactor = 0.4;
    render(<InvestorPage view="income" />);
    const row = screen.getByText('= حصتك التحليلية من نتيجة الشركة').closest('tr');
    expect(amountIn(row)).toBe(COMPANY_NET * 0.4);
  });

  it('والنصف يعطي نصف الرقم — لا رقماً ثابتاً', () => {
    partnerView.scalingFactor = 0.5;
    render(<InvestorPage view="income" />);
    const row = screen.getByText('= حصتك التحليلية من نتيجة الشركة').closest('tr');
    expect(amountIn(row)).toBe(COMPANY_NET * 0.5);
  });

  it('لا تعرض أدوات المحاسب ولا داخليات الدفاتر', () => {
    // هذه هي الشكوى الأصلية: تفاصيل لا يحتاجها المستثمر.
    render(<InvestorPage view="income" />);
    for (const forbidden of ['فرق غير مفسَّر', 'حساب 4000', 'تصدير CSV',
      'مطابقة سجل التشغيل بالدفاتر', 'ميزان المراجعة', 'نسخة احتياطية',
      'تفاصيل تشغيلية']) {
      expect(screen.queryByText(new RegExp(forbidden))).toBeNull();
    }
  });

  it('عمالة صفر: إشعارٌ لا قائمة أصفار', () => {
    partnerView.viewedPartner = { id: 'p1', partnerName: 'سالم', workersCount: 0, userId: 'uid1' };
    render(<InvestorPage view="income" />);
    expect(screen.getByText('للحين ما تسجّل لك عدد عمال')).toBeTruthy();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });
  it('عطل مصدر المصروفات لا يعيد عرض حسبة الرواتب الناقصة ولا صفراً مضللاً', () => {
    statementError = new Error('تعذر قراءة المصروفات');
    render(<InvestorPage view="income" />);
    expect(screen.getByText('ما قدرنا نتأكد من المصروفات ورصيد التأسيس')).toBeTruthy();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });
  it('يسمي السنوي احتياطياً ولا يقول إنه مصروف كامل في شهر القيد', () => {
    render(<InvestorPage view="income" />);
    expect(screen.getByText('احتياطي التجديد السنوي — حصة هذا الشهر')).toBeTruthy();
    expect(screen.getByText(/كل بند سنوي ÷ 12 لتجديد السنة الجاية/)).toBeTruthy();
    expect(screen.queryByText(/المبلغ السنوي يظهر في شهر قيده/)).toBeNull();
  });
});

describe('صفحة المستثمر — الخيارات الأربعة', () => {
  it.each([50, 75])('يعرض عدد عمال الشريك فقط دون إجمالي المشروع %s', totalWorkers => {
    partnerView.viewedPartner = { ...partnerView.viewedPartner, workersCount: 10 };
    partnerView.totalWorkers = totalWorkers;
    partnerView.scalingFactor = 10 / totalWorkers;
    render(<InvestorPage view="overview" />);
    const identity = screen.getByText('أحمد الغانم').parentElement;
    expect(identity.textContent).toContain('عدد عمالك: 10');
    expect(identity.textContent).not.toContain('من أصل');
    expect(identity.textContent).not.toContain(String(totalWorkers));
    expect(identity.textContent).not.toContain('%');
  });
  it('رأس المال يبقى واضحاً بالأرقام دون بطاقة شريط فارغة من أي وصف', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 60000, paymentDate: '2026-07-01' }];
    const { container } = render(<InvestorPage view="capital" />);
    expect(screen.getByText('✓ مسدّد بالكامل')).toBeTruthy();
    expect(screen.getByText('الرسوم المطلوبة')).toBeTruthy();
    expect(screen.getByText('المسدَّد')).toBeTruthy();
    const cards = [...container.querySelectorAll('div[style]')]
      .filter(element => element.style.borderRadius === 'var(--sw-radius-card)');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.textContent.trim()).not.toBe('');
  });
  // الادعاء الحامل للتقسيم: كل خيارٍ يحمل شيئه وحده. بدونه يعود الأربعة
  // ورقةً واحدة بأربعة عناوين — وهي الحالة التي خرجنا منها.
  it('«نظرة عامة» تعرض الهوية ورأس المال وملخص الشهر، لا السندات ولا الاتجاه', () => {
    render(<InvestorPage view="overview" />);
    expect(screen.getByText('أحمد الغانم')).toBeTruthy();
    expect(screen.getByText(/عدد عمالك: 3/)).toBeTruthy();
    expect(screen.queryByText('30.0%')).toBeNull();
    expect(screen.getByText('الرسوم المطلوبة')).toBeTruthy();
    expect(screen.getByLabelText('ملخص الشهر')).toBeTruthy();
    expect(screen.queryByText('نتيجة آخر شهر')).toBeNull();
    expect(screen.queryByText('سندات قبضك')).toBeNull();
    expect(screen.queryByText('حصتك من نتيجة الشركة شهرياً')).toBeNull();
    // ولا جدول قيود: القائمة التفصيلية خيارٌ آخر.
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });

  it('«رأس مالي» تعرض السندات والتحصيل، لا قائمة الدخل', () => {
    paymentsState.payments = [
      { id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', method: 'cash', notes: 'دفعة أولى' },
      { id: 'r2', partnerId: 'p2', amount: 99999, paymentDate: '2026-07-02', method: 'cash', notes: 'ليست له' },
    ];
    render(<InvestorPage view="capital" />);
    expect(screen.getByText('سندات قبضك')).toBeTruthy();
    expect(screen.getByText('دفعة أولى')).toBeTruthy();
    expect(screen.getByText('تحصيل رأس المال شهرياً')).toBeTruthy();
    // سند شريك آخر لا يظهر ولا يدخل في المجموع.
    expect(screen.queryByText('ليست له')).toBeNull();
    expect(screen.queryByText(/99,999/)).toBeNull();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });

  it('وبلا دفعات: حالة فارغة لا صفٌّ بصفر', () => {
    render(<InvestorPage view="capital" />);
    expect(screen.getByText('للحين ما فيه دفعات مسجّلة')).toBeTruthy();
  });

  it('«اتجاه ٦ أشهر» تعرض الرسم وحده', () => {
    render(<InvestorPage view="trends" />);
    expect(screen.getByText('حصتك من نتيجة الشركة شهرياً')).toBeTruthy();
    expect(screen.queryByText('سندات قبضك')).toBeNull();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });

  it('عرضٌ لا يعرفه الجدول يسقط على «نظرة عامة» لا على شاشة فارغة', () => {
    render(<InvestorPage view="ledger" />);
    expect(screen.getByText('أحمد الغانم')).toBeTruthy();
  });

  it('وبلا `view` يفتح على «نظرة عامة»', () => {
    render(<InvestorPage />);
    expect(screen.getByLabelText('ملخص الشهر')).toBeTruthy();
  });

  it('حسابٌ بلا ربط: بطاقة واحدة في كل خيار، ولا بيانات', () => {
    // الحارس فوق الأربعة: خيارٌ واحد يُفلت الحساب المسدود يكفي لتسريب
    // أرقام الشركة كاملةً إلى حسابٍ لم تُتحقَّق هويته.
    partnerView.investorLinkMissing = true;
    for (const view of ['overview', 'capital', 'journey', 'income', 'trends']) {
      render(<InvestorPage view={view} />);
      expect(screen.getByText(/حسابك للحين ما انربط بسجل شريك/)).toBeTruthy();
      expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
      expect(screen.queryByText('سندات قبضك')).toBeNull();
      expect(screen.queryByLabelText('ملخص الشهر')).toBeNull();
      cleanup();
    }
  });
});

describe('صفحة المستثمر — المؤشرات الجديدة', () => {
  // شهران مُرحّلان كي يكون للاسترداد والتغيّر معنى.
  const twoMonths = () => {
    ledgerState.entries = [
      { id: 'e1', entryDate: '2026-07-10', periodKey: '2026-07', status: 'posted', lines: [] },
      { id: 'e2', entryDate: '2026-08-10', periodKey: '2026-08', status: 'posted', lines: [] },
    ];
  };

  it('ملخص الشهر ثلاث بطاقات من تقرير الشريك مع الرسوم والاحتياطي دون إعادة تقسيم', () => {
    twoMonths();
    statementOverrides['2026-08'] = Object.freeze({ netRevenue: 60000, totalCosts: 42000,
      totalFees: 1200, annualReserve: 3000, totalAllocation: 45000, netAfterReserve: 13800 });
    render(<InvestorPage view="overview" />);
    const summary = screen.getByLabelText('ملخص الشهر');
    expect(summary.querySelectorAll('.sw-stat-card')).toHaveLength(3);
    for (const [label, amount] of [['مجموع الإيرادات', '60,000.00'], ['مجموع المصروفات', '46,200.00'], ['صافي الربح', '13,800.00']]) {
      expect(within(summary).getByText(label).closest('.sw-stat-card').querySelector('.sw-stat-value').textContent).toContain(amount);
    }
    expect(screen.queryByText('نتيجة آخر شهر')).toBeNull();
    expect(screen.getByText('المدفوع من التأسيس هذا الشهر')).toBeTruthy();
    expect(statementOverrides['2026-08'].netAfterReserve).toBe(13800);
  });

  it('يتغير الملخص بالشهر المختار ويبقي الخسارة سالبة دون تغيير النتيجة السنوية', () => {
    twoMonths();
    statementOverrides['2026-07'] = { netRevenue: 3000, totalCosts: 9000, totalFees: 0,
      annualReserve: 0, totalAllocation: 9000, netAfterReserve: -6000 };
    const { rerender } = render(<InvestorPage view="overview" />);
    const selector = screen.getByLabelText('فترة الملخص (الشهر)');
    expect(selector.value).toBe('2026-08');
    fireEvent.change(selector, { target: { value: '2026-07' } });
    const summary = screen.getByLabelText('ملخص الشهر');
    expect(within(summary).getByText('مجموع الإيرادات').closest('.sw-stat-card').textContent).toContain('3,000.00');
    expect(within(summary).getByText('مجموع المصروفات').closest('.sw-stat-card').textContent).toContain('9,000.00');
    expect(within(summary).getByText('صافي الربح').closest('.sw-stat-card').querySelector('.sw-stat-value').textContent).toMatch(/-6,000\.00/);
    expect(screen.getByText('حصتك التحليلية من نتيجة 2026').closest('.sw-stat-card').textContent).toContain('9,000.00');
    rerender(<InvestorPage view="income" />);
    expect(screen.getByLabelText('فترة التقرير (الشهر)').value).toBe('2026-07');
    rerender(<InvestorPage view="overview" />);
    expect(screen.getByLabelText('فترة الملخص (الشهر)').value).toBe('2026-07');
  });

  it('الشهر بلا نشاط أو تعطل المصدر لا يظهران كربح صفري', () => {
    twoMonths();
    statementOverrides['2026-07'] = { hasActivity: false };
    const { rerender } = render(<InvestorPage view="overview" />);
    fireEvent.change(screen.getByLabelText('فترة الملخص (الشهر)'), { target: { value: '2026-07' } });
    expect(screen.getByLabelText('ملخص الشهر').querySelectorAll('.sw-stat-card')).toHaveLength(0);
    expect(within(screen.getByLabelText('ملخص الشهر')).getByText('ما فيه حركة مُرحّلة لهالشهر')).toBeTruthy();
    statementError = new Error('تعذر قراءة المصروفات');
    rerender(<InvestorPage view="overview" />);
    expect(screen.queryByLabelText('ملخص الشهر')).toBeNull();
  });

  it('النظرة العامة تعرض الخسارة ولا تحولها إلى مطالبة أو صفر', () => {
    COMPANY_NET = -20000;
    twoMonths();
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 30000, paymentDate: '2026-07-01' }];
    render(<InvestorPage view="overview" />);
    const profitCard = within(screen.getByLabelText('ملخص الشهر')).getByText('صافي الربح').closest('.sw-stat-card');
    expect(profitCard.querySelector('.sw-stat-value').textContent).toMatch(/-6,000\.00/);
    expect(screen.queryByText('مبلغ إضافي مطلوب منك')).toBeNull();
    expect(profitCard.textContent).toContain('مو توزيع مستحق');
    expect(screen.queryByText('صافي ربحك')).toBeNull();
  });

  it('نظرة عامة: استرداد رأس المال من حصّته مقابل سنداته', () => {
    twoMonths();
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    render(<InvestorPage view="overview" />);
    expect(screen.getByText('مقارنة نتائج الشركة برأس مالك')).toBeTruthy();
    // شهران × 50000 × 0.3 = 30000 من 20000 → استُردّ.
    expect(screen.getByText('150.0%')).toBeTruthy();
    expect(screen.getByText('✓ تعادل')).toBeTruthy();
    expect(screen.getByText(/حصتك التحليلية من نتيجة 2026/)).toBeTruthy();
  });

  it('يبقي ملخصاً واحداً بثلاث بطاقات ويحفظ المعلومات المختلفة', () => {
    twoMonths();
    render(<InvestorPage view="overview" />);
    expect(screen.getAllByLabelText('ملخص الشهر')).toHaveLength(1);
    expect(screen.getByLabelText('ملخص الشهر').querySelectorAll('.sw-stat-card')).toHaveLength(3);
    expect(screen.queryByText('نتيجة آخر شهر')).toBeNull();
    expect(screen.queryByText('صافي الإيرادات (حصّتك)')).toBeNull();
    expect(screen.queryByText('التكاليف (حصّتك)')).toBeNull();
    expect(screen.getByText('الرسوم المطلوبة')).toBeTruthy();
    expect(screen.getByText('المدفوع من التأسيس هذا الشهر')).toBeTruthy();
    expect(screen.getByText('حصتك التحليلية من نتيجة 2026')).toBeTruthy();
    expect(screen.getByText('غسلات تعادل حصّتك')).toBeTruthy();
    expect(screen.getByText('مقارنة نتائج الشركة برأس مالك')).toBeTruthy();
  });

  it.each([
    { companyCount: 100, shareCount: 30 },
    { companyCount: 150, shareCount: 30 },
    { companyCount: 100, shareCount: 0 },
  ])('يعرض غسلات الشريك $shareCount دون إجمالي الشركة $companyCount', ({ companyCount, shareCount }) => {
    twoMonths();
    insightsState.washMonths = [{ month: '2026-08', companyCount, shareCount }];
    insightsState.insights = { sharePercent: 30, months: insightsState.washMonths };
    render(<InvestorPage view="overview" />);
    const card = screen.getByText('غسلات تعادل حصّتك').closest('.sw-stat-card');
    expect(card.querySelector('.sw-stat-value').textContent.trim()).toBe(String(shareCount));
    expect(card.textContent).toContain('أغسطس ٢٠٢٦');
    expect(card.textContent).not.toContain('من أصل');
    expect(card.textContent).not.toContain(String(companyCount));
  });

  it('يبقي غسلات الشريك غير المتاحة مختلفة عن صفر متحقق منه', () => {
    twoMonths();
    render(<InvestorPage view="overview" />);
    const card = screen.getByText('غسلات تعادل حصّتك').closest('.sw-stat-card');
    expect(card.querySelector('.sw-stat-value').textContent.trim()).toBe('—');
    expect(card.textContent).toContain('نحسبه من سجل الغسلات إذا صار متاح');
    expect(card.textContent).not.toContain('من أصل');
  });

  it.each(['open', 'closed'])('تخفي بطاقة حالة التقرير كاملة في عروض الشريك مع فترة %s وتبقي حالة الدفتر', status => {
    ledgerState.entries = [{ id: 'e1', entryDate: '2026-08-10', periodKey: '2026-08', status: 'posted', lines: [] }];
    ledgerState.periods = [{ id: '2026-08', status }];
    for (const view of ['overview', 'income', 'trends']) {
      render(<InvestorPage view={view} />);
      expect(screen.queryByText(/حالة التقرير|مبدئي|نهائي/)).toBeNull();
      expect(screen.queryByLabelText('حالة التقرير')).toBeNull();
      expect(screen.queryByText(/أرقام تشغيلية قابلة للتحديث|ليس كشف توزيع أرباح معتمداً/)).toBeNull();
      expect(screen.queryByText(/آخر تحديث من المصدر:|نطاق البيانات:/)).toBeNull();
      if (view === 'income') {
        expect(screen.getByLabelText('فترة التقرير (الشهر)').value).toBe('2026-08');
      }
      expect(ledgerState.periods).toEqual([{ id: '2026-08', status }]);
      cleanup();
    }
  });

  it('رأس مالي: رصيده في الدفاتر، وما لم يُرحَّل بعد يُسمّى «قيد الترحيل»', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    ledgerState.entries = [{ id: 'e1', entryDate: '2026-07-02', periodKey: '2026-07', status: 'posted', lines: [] }];
    // حساب رأس مال الشريك 3000-p1 مُرحَّل بـ 15000 فقط.
    ledgerState.lines = [{ id: 'l1', entryId: 'e1', accountId: '3000-p1', debit: 0, credit: 15000 }];
    render(<InvestorPage view="capital" />);
    expect(screen.getByText('رصيدك في الدفاتر')).toBeTruthy();
    expect(screen.getByText('قيد الترحيل')).toBeTruthy();
    expect(screen.queryByText('المسدَّد بالسندات')).toBeNull();
    // 20000 بالسندات − 15000 في الدفاتر = 5000 قيد الترحيل (لا 15,000 ولا 20,000).
    // النصّ يبدأ بعلامة اتجاهٍ (U+200F) قبل الرقم، فتُجرَّد قبل المطابقة.
    expect(screen.getByText((t) => t.replace(/[\u200e\u200f]/g, '').trim().startsWith('5,000'))).toBeTruthy();
  });

  it('عند تطابق السندات والدفاتر يظهر ملخص رأس المال مرة واحدة بلا بطاقات مكررة', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 60000, paymentDate: '2026-07-01' }];
    ledgerState.entries = [{ id: 'e1', status: 'posted' }];
    ledgerState.lines = [{ entryId: 'e1', accountId: '3000-p1', debit: 0, credit: 60000 }];
    render(<InvestorPage view="capital" />);
    expect(screen.getAllByText('المسدَّد')).toHaveLength(1);
    expect(screen.queryByText('رصيدك في الدفاتر')).toBeNull();
    expect(screen.queryByText('المسدَّد بالسندات')).toBeNull();
    expect(screen.queryByText('قيد الترحيل')).toBeNull();
    expect(screen.getByText('سندات قبضك')).toBeTruthy();
    expect(screen.getByText('✓ مسدّد بالكامل')).toBeTruthy();
  });

  it('لا يخفي الفرق عندما يزيد رصيد الدفاتر عن السندات ولا يدعي المطابقة', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01' }];
    ledgerState.entries = [{ id: 'e1', status: 'posted' }];
    ledgerState.lines = [{ entryId: 'e1', accountId: '3000-p1', debit: 0, credit: 25000 }];
    render(<InvestorPage view="capital" />);
    expect(screen.getByText('فرق يحتاج مراجعة')).toBeTruthy();
    expect(screen.queryByText('✓ مطابق')).toBeNull();
    expect(screen.getByText(/رصيد الدفاتر أعلى من سنداتك/)).toBeTruthy();
    expect(screen.queryByText('المسدَّد بالسندات')).toBeNull();
  });

  it('وبلا حسابٍ في الدفاتر لا تُعرض بطاقةٌ تدّعي المطابقة', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    render(<InvestorPage view="capital" />);
    expect(screen.queryByText('رصيدك في الدفاتر')).toBeNull();
  });
});
