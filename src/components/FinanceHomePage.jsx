import { useMemo, useState } from 'react';
import { Landmark, Inbox, Receipt, Handshake, BookOpen, FileText, ArrowLeft, RefreshCw, AlertTriangle, Wallet } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useLedger } from '../hooks/useLedger';
import { incomeStatement, generalLedger } from '../lib/accounting/reports';
import { usePartnerView } from '../contexts/PartnerViewContext';
import './FinanceWorkspace.css';

const sections = [
  { title: 'صندوق العمل', icon: Inbox, text: 'المستند، النقص، المراجعة والاعتماد والترحيل — خطوات مستقلة.', links: [['finance_workbench', 'فتح صندوق العمل']] },
  { title: 'المصاريف', icon: Receipt, text: 'كل مصروف في سجله الأصلي، دون إنشاء نسخة للتجميع.', links: [['startup', 'التأسيس'], ['annual', 'السنوية'], ['monthly', 'الشهرية'], ['variable', 'المتغيرة'], ['temporary_expenses', 'المؤقتة']] },
  { title: 'الشركاء والتمويل', icon: Handshake, text: 'رأس المال والمدفوعات ومصادر التمويل.', links: [['partners', 'الشركاء'], ['payments', 'مدفوعات الشركاء']] },
  { title: 'المحاسبة والرقابة', icon: BookOpen, text: 'الدفاتر والقوائم والضريبة والأصول في مسار واضح.', links: [['ledger', 'دفتر الأستاذ'], ['trial', 'ميزان المراجعة'], ['balance', 'المركز المالي'], ['summary', 'قائمة الدخل'], ['budgets', 'الميزانيات'], ['vat', 'الضريبة'], ['documents', 'المستندات الضريبية'], ['assets', 'الأصول الثابتة'], ['sweater_settlements', 'تسويات سويتر'], ['periods', 'إقفال الفترة']] },
  { title: 'الرواتب ماليًا', icon: Wallet, text: 'رابط للمسير الحالي؛ لا نقل لإدارة الموظفين ولا أمر صرف.', links: [['finance_payroll', 'مسير الرواتب']] },
  { title: 'تقارير المالية', icon: FileText, text: 'تقارير المدير المالي والتسجيل والضرائب، مع مصادر ونسخ وأرشيف.', links: [['finance_reports', 'عرض التقارير والأرشيف']] },
];
export default function FinanceHomePage({ onNavigate }) {
  const { role, isPartnerView } = usePartnerView();
  if (role !== 'admin' || isPartnerView) return <div className="fw-page" role="alert">لوحة المالية التفصيلية للإدارة فقط.</div>;
  return <FinanceHomeContent onNavigate={onNavigate} />;
}
function FinanceHomeContent({ onNavigate }) {
  const ledger = useLedger();
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Riyadh' }).slice(0, 7));
  const [readStarted, setReadStarted] = useState(() => new Date().toISOString());
  const data = useMemo(() => {
    const from = `${month}-01`, to = `${month}-31`;
    const income = incomeStatement(ledger.accounts, ledger.entries, ledger.lines, { from, to, salaryAccrual: false });
    const balance = code => generalLedger(code, ledger.entries, ledger.lines).closing;
    return { income, cash: balance('1010'), bank: balance('1020') };
  }, [ledger.accounts, ledger.entries, ledger.lines, month]);
  const available = !ledger.loading && !ledger.error && !ledger.needsSeeding && ledger.accounts.length > 0;
  const metrics = [ ['الإيرادات المرحلة', data.income.totalRevenue], ['تكاليف ومصروفات الفترة المرحلة', data.income.totalCost + data.income.totalExpenses],
    ['رصيد الصندوق الدفتري', data.cash], ['رصيد البنك الدفتري', data.bank] ];
  return <><TopBar title="المالية" subtitle="من المستند إلى القرار — مركز عمل فريق المالية" /><main className="fw-page" dir="rtl">
    <section className="fw-hero"><div><div className="fw-eyebrow"><Landmark size={18} /> مالية سويتر</div><h1>صورة واضحة. خطوة موثقة.</h1><p>الأرقام والمستندات والمتابعة في مكان واحد، مع بقاء الفرق بين التسجيل والاعتماد والترحيل والسداد ظاهرًا.</p></div><button type="button" onClick={() => onNavigate('finance_workbench')}>ابدأ من صندوق العمل <ArrowLeft size={17} /></button></section>
    <div className="fw-toolbar"><label>فترة القيود <input type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>
      <button type="button" disabled={ledger.loading} onClick={() => { setReadStarted(new Date().toISOString()); ledger.refetch(); }}><RefreshCw size={16} /> تحديث البيانات</button></div>
    <div className="fw-warning" role="note"><AlertTriangle size={18} />الأرقام أدناه من القيود المرحلة؛ ليست كشف بنك أو جرد صندوق أو تحصيلًا مثبتًا. نتيجة الفترة بتاريخ القيد لا تعني اكتمال نتيجتها الاقتصادية.</div>
    {ledger.error && <div className="fw-warning" role="alert">تعذر تحميل الدفاتر؛ لا تُعرض أرقام بديلة أو أصفار.</div>}
    {ledger.loading && <LoadingState message="جارٍ قراءة الدفاتر..." />}
    <div className="fw-metrics">{metrics.map(([label, value]) => <article className="fw-panel fw-metric" key={label}><span>{label}</span><strong>{available ? value.toLocaleString('ar-SA', { numberingSystem: 'latn', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'غير متاح'} <small>{available ? 'ر.س' : ''}</small></strong><small>{label.includes('رصيد') ? 'تراكمي لكل الدفاتر عند القراءة' : `بتاريخ القيد — ${month}`}</small></article>)}</div>
    <p className="fw-meta">بدء القراءة: {new Date(readStarted).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn' })} — الرياض. التحديث يدوي، ولا توجد أرقام تشغيلية مضافة إلى الأرصدة.</p>
    <div className="fw-sections">{sections.map(s => <section className="fw-panel fw-section" key={s.title}><div className="fw-section-icon"><s.icon size={23} /></div><h2>{s.title}</h2><p>{s.text}</p><div className="fw-links">{s.links.map(([id, label]) => <button type="button" key={id} onClick={() => onNavigate(id)}>{label}<ArrowLeft size={14} /></button>)}</div></section>)}</div>
  </main></>;
}
