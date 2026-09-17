// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => partnerView }));
vi.mock('../../hooks/usePartnerPayments', () => ({ usePartnerPayments: () => paymentsState }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => ledgerState }));
vi.mock('../../hooks/useFeeRules', () => ({ useFeeRules: () => ({ rules: [] }) }));
vi.mock('../../hooks/usePartnerInsights', () => ({ usePartnerInsights: () => insightsState }));

const COMPANY_NET = 50000;
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
    fees: [],
    netProfit:    COMPANY_NET * scalingFactor,
  }),
}));

const InvestorPage = (await import('../InvestorPage')).default;

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
  partnerView.investorLinkMissing = false;
  partnerView.viewedPartner = { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3, userId: 'uid1' };
  partnerView.scalingFactor = 0.3;
  paymentsState.payments = [];
  ledgerState.entries = [];
  ledgerState.periods = [];
  insightsState.insights = null;
  insightsState.washMonths = [];
});

describe('صفحة المستثمر — قائمة الدخل', () => {
  it('تعرض قائمة الدخل ببنودها', () => {
    render(<InvestorPage view="income" />);
    for (const label of ['إيرادات المبيعات', '= صافي الإيرادات',
      'يُخصم منه: التكاليف المباشرة والعمولات', '= مجمل الربح التشغيلي',
      'يُخصم منه: المصاريف التشغيلية', '= صافي الربح قبل الرسوم']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('السطر الأخير يقول «ربحك» لا «للشركاء» — الرقم حصّةُ قارئه', () => {
    render(<InvestorPage view="income" />);
    expect(screen.getByText('= صافي ربحك من هذا الشهر')).toBeTruthy();
    expect(screen.queryByText('= صافي الربح النهائي للشركاء')).toBeNull();
  });

  it('القسمة مطبَّقة فعلاً لا معروضة فقط', () => {
    // الرقم يُقرأ من صفّ «صافي ربحك» وحده: مبلغٌ مطابق في موضع آخر من الصفحة
    // لا يثبت شيئاً عن هذا السطر.
    partnerView.scalingFactor = 0.4;
    render(<InvestorPage view="income" />);
    const row = screen.getByText('= صافي ربحك من هذا الشهر').closest('tr');
    expect(amountIn(row)).toBe(COMPANY_NET * 0.4);
  });

  it('والنصف يعطي نصف الرقم — لا رقماً ثابتاً', () => {
    partnerView.scalingFactor = 0.5;
    render(<InvestorPage view="income" />);
    const row = screen.getByText('= صافي ربحك من هذا الشهر').closest('tr');
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
    expect(screen.getByText(/نسبتك ٠٪/)).toBeTruthy();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });
});

describe('صفحة المستثمر — الخيارات الأربعة', () => {
  // الادعاء الحامل للتقسيم: كل خيارٍ يحمل شيئه وحده. بدونه يعود الأربعة
  // ورقةً واحدة بأربعة عناوين — وهي الحالة التي خرجنا منها.
  it('«نظرة عامة» تعرض الهوية ورأس المال ونتيجة آخر شهر، لا السندات ولا الاتجاه', () => {
    render(<InvestorPage view="overview" />);
    expect(screen.getByText('أحمد الغانم')).toBeTruthy();
    expect(screen.getByText('30.0%')).toBeTruthy();
    expect(screen.getByText('الرسوم المطلوبة')).toBeTruthy();
    expect(screen.getByText('نتيجة آخر شهر')).toBeTruthy();
    expect(screen.queryByText('سندات قبضك')).toBeNull();
    expect(screen.queryByText('صافي ربحك شهرياً')).toBeNull();
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
    expect(screen.getByText('لا توجد دفعات مسجّلة بعد')).toBeTruthy();
  });

  it('«اتجاه ٦ أشهر» تعرض الرسم وحده', () => {
    render(<InvestorPage view="trends" />);
    expect(screen.getByText('صافي ربحك شهرياً')).toBeTruthy();
    expect(screen.queryByText('سندات قبضك')).toBeNull();
    expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
  });

  it('عرضٌ لا يعرفه الجدول يسقط على «نظرة عامة» لا على شاشة فارغة', () => {
    render(<InvestorPage view="ledger" />);
    expect(screen.getByText('أحمد الغانم')).toBeTruthy();
  });

  it('وبلا `view` يفتح على «نظرة عامة»', () => {
    render(<InvestorPage />);
    expect(screen.getByText('نتيجة آخر شهر')).toBeTruthy();
  });

  it('حسابٌ بلا ربط: بطاقة واحدة في كل خيار، ولا بيانات', () => {
    // الحارس فوق الأربعة: خيارٌ واحد يُفلت الحساب المسدود يكفي لتسريب
    // أرقام الشركة كاملةً إلى حسابٍ لم تُتحقَّق هويته.
    partnerView.investorLinkMissing = true;
    for (const view of ['overview', 'capital', 'income', 'trends']) {
      render(<InvestorPage view={view} />);
      expect(screen.getByText(/لم يُربط حسابك بسجل شريك بعد/)).toBeTruthy();
      expect(screen.queryByText('إيرادات المبيعات')).toBeNull();
      expect(screen.queryByText('سندات قبضك')).toBeNull();
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

  it('نظرة عامة: استرداد رأس المال من حصّته مقابل سنداته', () => {
    twoMonths();
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    render(<InvestorPage view="overview" />);
    expect(screen.getByText('استرداد رأس مالك')).toBeTruthy();
    // شهران × 50000 × 0.3 = 30000 من 20000 → استُردّ.
    expect(screen.getByText('150.0%')).toBeTruthy();
    expect(screen.getByText('✓ تم')).toBeTruthy();
    expect(screen.getByText(/صافي ربحك منذ بداية 2026/)).toBeTruthy();
  });

  it('والتغيّر عن الشهر السابق يظهر تحت صافي الربح', () => {
    twoMonths();
    render(<InvestorPage view="overview" />);
    // الشهران متساويان في القائمة المزيّفة → «= 0.0% عن الشهر السابق».
    expect(screen.getByText(/عن الشهر السابق/)).toBeTruthy();
  });

  it('وغسلاتٌ تعادل حصّته من الخادم لا من `washes`', () => {
    twoMonths();
    insightsState.washMonths = [{ month: '2026-08', companyCount: 100, shareCount: 30 }];
    insightsState.insights = { sharePercent: 30, months: insightsState.washMonths };
    render(<InvestorPage view="overview" />);
    expect(screen.getByText('غسلات تعادل حصّتك')).toBeTruthy();
    expect(screen.getByText(/من أصل 100 غسلة مكتملة/)).toBeTruthy();
  });

  it('قائمة الدخل: «نهائي» للشهر المُقفَل و«مبدئي» للمفتوح', () => {
    ledgerState.entries = [{ id: 'e1', entryDate: '2026-08-10', periodKey: '2026-08', status: 'posted', lines: [] }];
    ledgerState.periods = [{ id: '2026-08', status: 'closed' }];
    render(<InvestorPage view="income" />);
    expect(screen.getByText('نهائي')).toBeTruthy();
    cleanup();
    ledgerState.periods = [{ id: '2026-08', status: 'open' }];
    render(<InvestorPage view="income" />);
    expect(screen.getByText('مبدئي')).toBeTruthy();
  });

  it('رأس مالي: رصيده في الدفاتر، وما لم يُرحَّل بعد يُسمّى «قيد الترحيل»', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    ledgerState.entries = [{ id: 'e1', entryDate: '2026-07-02', periodKey: '2026-07', status: 'posted', lines: [] }];
    // حساب رأس مال الشريك 3000-p1 مُرحَّل بـ 15000 فقط.
    ledgerState.lines = [{ id: 'l1', entryId: 'e1', accountId: '3000-p1', debit: 0, credit: 15000 }];
    render(<InvestorPage view="capital" />);
    expect(screen.getByText('رصيدك في الدفاتر')).toBeTruthy();
    expect(screen.getByText('قيد الترحيل')).toBeTruthy();
    // 20000 بالسندات − 15000 في الدفاتر = 5000 قيد الترحيل (لا 15,000 ولا 20,000).
    // النصّ يبدأ بعلامة اتجاهٍ (U+200F) قبل الرقم، فتُجرَّد قبل المطابقة.
    expect(screen.getByText((t) => t.replace(/[\u200e\u200f]/g, '').trim().startsWith('5,000'))).toBeTruthy();
  });

  it('وبلا حسابٍ في الدفاتر لا تُعرض بطاقةٌ تدّعي المطابقة', () => {
    paymentsState.payments = [{ id: 'r1', partnerId: 'p1', amount: 20000, paymentDate: '2026-07-01', paymentMethod: 'cash' }];
    render(<InvestorPage view="capital" />);
    expect(screen.queryByText('رصيدك في الدفاتر')).toBeNull();
  });
});
