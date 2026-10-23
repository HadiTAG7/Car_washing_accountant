import { useState } from 'react';
import { ArrowLeft, RefreshCw, AlertTriangle, TrendingUp, Receipt, Wallet, HandCoins, Landmark, Users, Percent, CheckCircle2 } from 'lucide-react';
import TopBar from './TopBar';
import BikerProfileMonthPicker from './BikerProfileMonthPicker';
import { useFinanceHomeData } from '../hooks/useFinanceHomeData';
import { APPROVED_SETTLEMENT_STATUSES } from '../lib/financeHome';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { riyadhTodayISO } from '../lib/washesYesterday';
import './FinanceWorkspace.css';
import './BikerProfile.css';
import './FinanceHomePage.css';

const money = value => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
const amountText = value => money(value) === null ? 'المبلغ غير متاح' : `${money(value)} ر.س`;

function Metric({ label, value, note, date, icon: Icon, tone = '', onClick, children }) {
  return <button type="button" className={`fm-card ${tone ? `fm-card--${tone}` : ''}`} onClick={onClick}>
    <span className="fm-card__top"><span>{label}</span><span className="fm-card__icon"><Icon size={20} /></span></span>
    <strong className="fm-card__value">{money(value) === null ? 'غير متاح' : <><bdi dir="ltr">{money(value)}</bdi><small>ر.س</small></>}</strong>
    {children}
    {note && <span className="fm-card__note">{note}</span>}
    <span className="fm-card__footer"><span>{date}</span><ArrowLeft size={15} aria-hidden="true" /></span>
  </button>;
}

function ActionList({ data, onNavigate }) {
  const { ledger, vat, workbench, settlement, settlementReady, budget, month } = data;
  const rows = [];
  ledger?.negativeAccounts.forEach(account => rows.push({ key: `cash-${account.code}`, danger: true, route: 'ledger',
    label: `${account.name} رصيده سالب`, detail: amountText(account.balance) }));
  if (vat?.unpostedEligible.length) rows.push({ key: 'vat', route: 'vat', label: 'فواتير ضريبتها مؤهلة ولم تُرحّل إلى حساب 1200',
    detail: `${vat.unpostedEligible.length} فواتير · ${amountText(vat.unpostedInputTax)}` });
  if (settlementReady && !APPROVED_SETTLEMENT_STATUSES.has(settlement?.status)) rows.push({ key: 'settlement', route: 'sweater_settlements',
    label: settlement?.figures ? 'تسوية سويتر بانتظار الاعتماد' : 'تسوية سويتر لم تُحسب',
    detail: settlement?.figures ? `${settlement.figures.counts?.eligible ?? '—'} خدمات مؤهلة من ${settlement.figures.counts?.imported ?? '—'} حجز · ${month}` : month });
  if (workbench?.unknownPayment.count) rows.push({ key: 'payment', route: 'finance_workbench', label: 'مستندات السداد غير مثبت',
    detail: `${workbench.unknownPayment.count} مستندات · ${amountText(workbench.unknownPayment.amount)}` });
  if (workbench?.pending.count) rows.push({ key: 'pending', route: 'finance_workbench', label: 'مستندات بانتظار المراجعة أو الاعتماد أو الترحيل',
    detail: `${workbench.pending.count} مستندات · ${amountText(workbench.pending.amount)}` });
  const overrunCount = budget?.cards.filter(card => card.budget.amount > 0 && card.spent > card.budget.amount).length || 0;
  if (overrunCount) rows.push({ key: 'budget', route: 'budgets', label: 'ميزانيات متجاوزة',
    detail: `${overrunCount} بنود · ${budget.totals.remaining < 0 ? `العجز الإجمالي: ${amountText(budget.totals.remaining)}` : 'راجع تفاصيل التجاوز'} · ${budget.month}` });
  const complete = ledger && vat && workbench && budget && settlementReady;
  return <section className="fm-actions" aria-labelledby="finance-actions-title">
    <div className="fm-section-heading"><h2 id="finance-actions-title">يحتاج إجراء</h2>{rows.length > 0 && <span className="fm-count">{rows.length}</span>}</div>
    {rows.length > 0 && <ul>{rows.map(row => <li key={row.key} className={row.danger ? 'fm-action--danger' : ''}>
      <button type="button" onClick={() => onNavigate(row.route)}>
        <AlertTriangle size={17} aria-hidden="true" /><span className="fm-action__label">{row.label}</span>
        <span className="fm-action__detail">{row.detail}</span><ArrowLeft size={16} aria-hidden="true" />
      </button>
    </li>)}</ul>}
    {rows.length === 0 && complete && <p className="fm-clear"><CheckCircle2 size={18} />ما فيه شي يحتاج إجراء</p>}
    {!complete && <p className="fm-incomplete" role="status">{data.loading ? 'جارٍ التحقق من البنود المتبقية…' : 'لم يكتمل فحص جميع البنود؛ لا يعني ذلك خلوّها من الإجراءات.'}</p>}
    <p className="fm-scope">المستندات: كل الفترات. الميزانيات: الشهر الحالي والسنة، كما في صفحة الرقابة والميزانيات.</p>
  </section>;
}

export default function FinanceHomePage({ onNavigate }) {
  const { role, isPartnerView } = usePartnerView();
  if (role !== 'admin' || isPartnerView) return <div className="fw-page" role="alert">لوحة المالية التفصيلية للإدارة فقط.</div>;
  return <FinanceHomeContent onNavigate={onNavigate} />;
}

function FinanceHomeContent({ onNavigate }) {
  const [month, setMonth] = useState(() => riyadhTodayISO().slice(0, 7));
  const data = useFinanceHomeData(month);
  const { ledger, statement, vat, settlement, settlementReady } = data;
  const [readStarted, setReadStarted] = useState(() => new Date().toISOString());
  const cumulativeDate = `تراكمي · ${data.today}`;
  const monthDate = `${month} · حتى ${data.today}`;
  const hasNegativeCash = Boolean(ledger?.negativeAccounts.length);
  return <><TopBar title="ملخص المالية" subtitle="نتيجة الشهر، الفلوس المتاحة، وما يحتاج إجراء" />
    <main className="fw-page fm-page" dir="rtl" aria-busy={data.loading}>
      <div className="fw-toolbar"><div className="fw-period" role="group" aria-label="فترة الملخص"><span>الشهر</span>
        <BikerProfileMonthPicker value={month} max="9999-12" language="en" onChange={setMonth} /></div>
        <button type="button" disabled={data.loading} onClick={() => { setReadStarted(new Date().toISOString()); data.refresh(); }}><RefreshCw size={16} /> تحديث البيانات</button>
      </div>
      <p className="fm-ledger-note" role="note"><AlertTriangle size={14} />الأرصدة دفترية، وليست كشف بنك أو جرد صندوق أو إثبات سداد.</p>
      {data.problems.length > 0 && <p className="fm-read-error" role="alert">تعذرت قراءة: {data.problems.join('، ')}. الأرقام غير المتحققة لا تُستبدل بأصفار.</p>}
      {data.loading && <p className="fm-loading" role="status">جارٍ قراءة الأرقام من مصادرها…</p>}
      <section aria-labelledby="finance-month-title">
        <div className="fm-section-heading"><h2 id="finance-month-title">نتيجة الشهر</h2><span>{month}</span></div>
        <div className="fm-grid fm-grid--month">
          <Metric label="الإيراد" value={statement?.netRevenue} icon={TrendingUp} tone="revenue" date={monthDate}
            note={`المرحل في الدفتر: ${amountText(ledger?.postedRevenue)}`} onClick={() => onNavigate('summary')} />
          <Metric label="المصروفات" value={statement?.totalCosts} icon={Receipt} date={monthDate}
            note={`المرحل: ${amountText(ledger?.postedCosts)}`} onClick={() => onNavigate('summary')} />
          <Metric label="نتيجة الشهر" value={statement?.netProfit} icon={Wallet} date={monthDate}
            tone={statement?.netProfit < 0 ? 'loss' : statement?.netProfit >= 0 ? 'profit' : ''}
            note={statement?.netProfit < 0 ? 'خسارة الشهر' : statement?.netProfit >= 0 ? 'ربح الشهر' : 'من قائمة الدخل'} onClick={() => onNavigate('summary')} />
          <Metric label="المتوقع من سويتر" value={settlementReady ? settlement?.figures?.netDue : null} icon={HandCoins} date={month}
            note={settlementReady && settlement?.figures ? APPROVED_SETTLEMENT_STATUSES.has(settlement.status) ? 'صافي المستحق في التسوية المعتمدة' : 'صافي التسوية المحسوبة · لم تُعتمد' : 'من تسويات سويتر للشهر'}
            onClick={() => onNavigate('sweater_settlements')} />
        </div>
        <p className="fm-posting-note">الإيراد يترحل مع فاتورة سويتر آخر الشهر، والرواتب وقت الإقفال</p>
      </section>
      <section aria-labelledby="finance-money-title">
        <div className="fm-section-heading"><h2 id="finance-money-title">الفلوس</h2><span>أرصدة الدفتر وصافي الضريبة</span></div>
        <div className="fm-grid fm-grid--money">
          <Metric label="النقد المتاح (دفتري)" value={ledger?.availableCash} icon={Landmark} date={cumulativeDate} onClick={() => onNavigate('ledger')}>
            <span className="fm-cash-split"><span className={ledger?.bank < 0 ? 'fm-negative' : ''}>البنك <bdi>{amountText(ledger?.bank)}</bdi></span>
              <span className={ledger?.cash < 0 ? 'fm-negative' : ''}>الصندوق <bdi>{amountText(ledger?.cash)}</bdi></span></span>
            {hasNegativeCash && <span className="fm-negative fm-cash-alert"><AlertTriangle size={14} />يوجد حساب نقدي بالسالب</span>}
          </Metric>
          <Metric label="رأس المال المدفوع" value={ledger?.capital} icon={Users} date={cumulativeDate}
            note="من حسابات رأس مال الشركاء في المركز المالي" onClick={() => onNavigate('balance')} />
          <Metric label="الضريبة المستحقة" value={vat?.netTax} icon={Percent} date={monthDate}
            note={vat?.direction === 'refundable' ? 'صافي الشهر قابل للاسترداد' : 'صافي ضريبة الشهر من صفحة الضريبة'} onClick={() => onNavigate('vat')} />
        </div>
      </section>
      <ActionList data={data} onNavigate={onNavigate} />
      <p className="fw-meta">بدء القراءة: {new Date(readStarted).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn' })} · الرياض</p>
    </main></>;
}
