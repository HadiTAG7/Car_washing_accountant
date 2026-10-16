import { useState } from 'react';
import { Activity, ArrowUpRight, Bike, CalendarDays, CheckCircle2, DatabaseBackup, Loader2, Receipt, Star, Ticket, TrendingUp, Wallet, X } from 'lucide-react';
import { useLanguage } from '../i18n/useLanguage';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { riyadhToday } from '../lib/bikerProfile';
import { isOverviewWorkingBiker } from '../lib/overviewDashboard';
import { displayBikerName, displayRecordedBikerName, recordedBikerSweaterId } from '../lib/bikerNames';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { downloadFullBackup } from '../lib/backupZip';
import TopBar from './TopBar';
import CapitalOverviewPage from './CapitalOverviewPage';
import BikerProfileMonthPicker from './BikerProfileMonthPicker';
import IncomeStatementDetailsModal from './IncomeStatementDetailsModal';
import ModalSurface from './ModalSurface';
import Toast from './Toast';
import { Card, SectionHeader } from './UI';
import { SetupRequiredCard } from './ErrorState';
import './BikerProfile.css';
import './OverviewPage.css';

export default function OverviewPage(props) {
  const { role, isPartnerView } = usePartnerView();
  // The admin dashboard never mounts its company data hooks in partner mode.
  // Other existing roles retain their previous overview and navigation policy.
  if (isPartnerView || role === 'partner' || role === 'supervisor') return null;
  return ['admin', 'accountant'].includes(role) ? <ManagementOverview {...props} /> : <CapitalOverviewPage />;
}

export function ManagementOverview({ onNavigate }) {
  const { language } = useLanguage();
  const { canMutate, role } = usePartnerView();
  const text = (ar, en) => language === 'en' ? en : ar;
  const today = riyadhToday();
  const [periodKey, setPeriodKey] = useState(today.slice(0, 7));
  const [detail, setDetail] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success' });
  const data = useOverviewDashboard(periodKey, today);
  const { finance, operations: ops, quality: q, washes, workers, bookings } = data;
  const st = finance.statement;
  const washReady = !washes.loading && !washes.error && ops && !ops.conflicts.length && isFirebaseConfigured;
  const qualityReady = !bookings.loading && !bookings.error && q && !q.conflicts && isFirebaseConfigured;
  const workerReady = !workers.loading && !workers.error && isFirebaseConfigured;
  const unavailable = text('غير متاح', 'Unavailable');
  const number = value => value == null ? unavailable : formatNumber(value);
  const date = day => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
    { day: 'numeric', month: 'short', timeZone: 'UTC', numberingSystem: 'latn' }).format(new Date(`${day}T00:00:00Z`));
  const navigate = tab => onNavigate?.(tab);
  function changeMonth(month) { setDetail(null); setPeriodKey(month); }
  async function backup() {
    if (backupBusy) return;
    setBackupBusy(true);
    try { await downloadFullBackup(); setToast({ open: true, message: text('تم تنزيل النسخة الاحتياطية.', 'Backup downloaded.'), tone: 'success' }); }
    catch { setToast({ open: true, message: text('تعذّر تنزيل النسخة الاحتياطية.', 'Backup could not be downloaded.'), tone: 'error' }); }
    finally { setBackupBusy(false); }
  }
  const action = (ar, en, tab) => <button type="button" className="sw-overview__link" onClick={() => navigate(tab)}>{text(ar, en)}<ArrowUpRight size={16} aria-hidden="true" /></button>;
  const financialCards = [
    { key: 'netRevenue', label: text('صافي الإيرادات', 'Net revenue'), icon: TrendingUp, tone: 'green', note: text('بعد المرتجعات، دون ضريبة المخرجات', 'After returns, excluding output VAT') },
    { key: 'totalCosts', label: text('المصروفات والتكاليف', 'Expenses and costs'), icon: Receipt, tone: 'orange', note: st?.salaryAccrual?.estimated
      ? text('تشمل رواتب تقديرية حتى اعتماد المسير · قبل رسوم الإدارة والإشراف', 'Includes estimated salaries until payroll approval · before management and supervision fees')
      : text('تشمل الرواتب المستحقة · قبل رسوم الإدارة والإشراف', 'Includes accrued salaries · before management and supervision fees') },
    { key: 'netProfit', label: text('صافي الربح', 'Net profit'), icon: Wallet, tone: st?.netProfit < 0 ? 'amber' : 'green', note: text('بعد التكاليف ورسوم الإدارة والإشراف', 'After costs, management and supervision fees') },
  ];
  const detailRows = detail?.kind === 'day' ? detail.rows : ['month', 'bikerAverage'].includes(detail?.kind) ? ops?.rows
    : detail?.kind === 'yesterday' ? ops?.yesterdayRows : detail?.kind === 'ratings' ? q?.rated
      : detail?.kind === 'low' ? q?.low : detail?.kind === 'tickets' ? q?.rows.filter(row => row.ticketRef?.trim())
        : detail?.kind === 'workers' ? workers.bikers.filter(isOverviewWorkingBiker) : [];
  const isWashDetail = ['day', 'month', 'yesterday', 'bikerAverage'].includes(detail?.kind);
  return <>
    <TopBar title={text('نظرة عامة', 'Overview')} subtitle={text('صورة المشروع: المال، التشغيل والجودة', 'Your business at a glance: finance, operations and quality')}
      actions={canMutate && isFirebaseConfigured ? <button type="button" onClick={backup} disabled={backupBusy}
        className="sw-button sw-button--sm sw-button--secondary" aria-label={text('نسخة احتياطية', 'Backup')}>
        {backupBusy ? <Loader2 size={16} className="animate-spin" /> : <DatabaseBackup size={16} />}<span className="hidden sm:inline">{text('نسخة احتياطية', 'Backup')}</span></button> : null} />
    <main className="sw-overview" dir={language === 'en' ? 'ltr' : 'rtl'}>
      {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
      <div className="sw-overview__intro">
        <div><p className="sw-overview__eyebrow">{text('لوحة إدارة المشروع', 'BUSINESS DASHBOARD')}</p><h2>{text('كيف أداء سويتر؟', 'How is Sweater doing?')}</h2>
          <p>{text('تابع النتيجة، حركة التشغيل وتجربة العميل في مكان واحد.', 'Track results, operations and customer experience in one place.')}</p></div>
        <BikerProfileMonthPicker value={periodKey} max={today.slice(0, 7)} language={language} onChange={changeMonth} />
      </div>

      <section aria-labelledby="overview-finance-title" className="sw-overview__section">
        <SectionHeader title={<span id="overview-finance-title">{text('النتيجة المالية', 'Financial performance')}</span>} action={action('فتح قائمة الدخل', 'Open income statement', 'summary')} />
        <div className="sw-overview__financial-grid">{financialCards.map(({ key, label, icon, tone, note }) => <Metric key={key} label={label} icon={icon} tone={tone}
          value={st ? formatCurrencyPrecise(st[key]) : finance.loading ? '…' : unavailable} note={note} disabled={!st}
          onClick={() => setDetail({ kind: 'financial', key })}
          comparison={st && finance.previous ? `${text('التغير عن الشهر السابق', 'Change from previous month')}: ${formatCurrencyPrecise(st[key] - finance.previous[key])}` : null} />)}</div>
        {(!st || st.issues?.length > 0) && <div className="sw-overview__source-note" role={finance.error ? 'alert' : undefined}>
          {!st && <p>{finance.loading ? text('جارٍ تحميل القائمة والرواتب…', 'Loading statement and payroll…') : text('تعذّر تأكيد الأرقام المالية؛ أعد المحاولة أو راجع قائمة الدخل.', 'Financial figures could not be confirmed. Retry or review the income statement.')}</p>}
          {st?.issues?.length > 0 && <p role="alert">{text('تنبيه: الأرقام تستبعد سجلات ببيانات ضريبية غير محسومة؛ افتح التفاصيل قبل الاعتماد عليها.', 'Warning: figures exclude records with unresolved tax data. Open the details before relying on them.')}</p>}
          {finance.error && <button type="button" className="sw-overview__link" onClick={data.retry}>{text('إعادة المحاولة', 'Retry')}</button>}</div>}
      </section>

      <section aria-labelledby="overview-operations-title" className="sw-overview__section">
        <SectionHeader title={<span id="overview-operations-title">{text('حركة التشغيل', 'Operations')}</span>} subtitle={text('الغسلات المكتملة المسجلة، وليست الحجوزات الخام أو إثبات اكتمال الاستيراد.', 'Recorded completed washes, not raw bookings or proof of import completeness.')} action={action('فتح الغسلات', 'Open washes', 'washes')} />
        <div className="sw-overview__metric-grid sw-overview__operations-grid">
          <Metric icon={CalendarDays} label={text('غسلات أمس', 'Yesterday’s washes')} value={washReady ? number(ops.yesterdayQuantity) : unavailable}
            note={ops ? date(ops.yesterday) : ''} disabled={!washReady} onClick={() => setDetail({ kind: 'yesterday', title: text('غسلات أمس', 'Yesterday’s washes') })} />
          <Metric icon={CheckCircle2} label={text('غسلات الشهر', 'Monthly washes')} value={washReady ? number(ops.quantity) : unavailable} disabled={!washReady}
            note={ops ? `${date(ops.from)} — ${date(ops.to)}` : ''} onClick={() => setDetail({ kind: 'month', title: text('غسلات الشهر', 'Monthly washes') })}
            comparison={washReady ? `${text('الفترة المقارنة', 'Comparison window')}: ${date(ops.previousFrom)} — ${date(ops.previousTo)} · ${number(ops.previousQuantity)}` : null} />
          <Metric icon={Activity} label={text('المتوسط', 'Average')} value={washReady ? number(ops.average) : unavailable} disabled={!washReady}
            note={text('غسلة لكل يوم فيه غسلات فعلًا', 'Washes per day with recorded washes')} onClick={() => setDetail({ kind: 'month', title: text('المتوسط وأيام الغسيل', 'Average and wash days') })} />
          <Metric icon={Bike} label={text('متوسط غسلات البايكر', 'Average washes per biker')} value={washReady ? number(ops.averagePerBikerDay) : unavailable}
            disabled={!washReady || ops?.averagePerBikerDay == null}
            note={ops?.unlinkedBikerWashes ? text('توجد غسلات بلا ربط عامل مؤكّد', 'Some washes lack a confirmed worker link') : text('يوميًا · على أيام الغسيل الفعلية لكل بايكر', 'Daily · based on each biker’s actual wash days')}
            onClick={() => setDetail({ kind: 'bikerAverage', title: text('متوسط غسلات البايكر', 'Average washes per biker') })} />
          <Metric icon={Bike} label={text('البايكر العاملون', 'Working bikers')} value={workerReady ? number(ops?.working) : unavailable} disabled={!workerReady}
            note={text('الحالة الحالية المسجلة، وليس حضور الشهر', 'Current recorded status, not monthly attendance')} onClick={() => setDetail({ kind: 'workers', title: text('البايكر العاملون حاليًا', 'Currently working bikers') })} />
        </div>
        {(washes.error || ops?.conflicts.length > 0) && <p role="alert" className="sw-overview__notice">{text('تعذّر تأكيد إجمالي الغسلات؛ راجع المصدر أو تعارض التكرار.', 'Wash totals are unconfirmed. Review source availability or conflicting duplicates.')}</p>}
        <Card className="sw-overview__panel sw-overview__daily"><SectionHeader title={text('الغسلات يومًا بيوم', 'Daily washes')} subtitle={text('اضغط على اليوم لعرض الغسلات المسجلة فيه.', 'Select a day to view its recorded washes.')} />
          {washReady ? <><div className="sw-overview__bars" role="group" aria-label={text('رسم الغسلات اليومية', 'Daily washes chart')}>
            {ops.daily.map(day => <button type="button" key={day.date} aria-label={`${date(day.date)}: ${number(day.quantity)} ${text('غسلة', 'washes')}`}
              onClick={() => setDetail({ kind: 'day', title: date(day.date), rows: day.rows })}>
              <span className="sw-overview__bar-count">{number(day.quantity)}</span><span className="sw-overview__bar-track"><span style={{ height: `${day.quantity / Math.max(1, ...ops.daily.map(d => d.quantity)) * 100}%` }} /></span><time dateTime={day.date}>{Number(day.date.slice(8))}</time></button>)}
          </div><details className="sw-overview__disclosure"><summary>{text('عرض البيانات كجدول', 'View data as a table')}</summary><table><thead><tr><th>{text('التاريخ', 'Date')}</th><th>{text('الغسلات', 'Washes')}</th></tr></thead><tbody>{ops.daily.map(day => <tr key={day.date}><td>{date(day.date)}</td><td>{number(day.quantity)}</td></tr>)}</tbody></table></details></>
            : <p role="status">{washes.loading ? text('جارٍ تحميل الغسلات…', 'Loading washes…') : unavailable}</p>}
        </Card>
      </section>

      <section aria-labelledby="overview-quality-title" className="sw-overview__section">
        <SectionHeader title={<span id="overview-quality-title">{text('الجودة وتجربة العميل', 'Quality and customer experience')}</span>} subtitle={text('عينة الحجوزات المستوردة للشهر المحدد؛ ليست سجل التكتات الكامل ولا تقييم الجودة المركّب للبايكر.', 'Imported bookings for the selected month; not the complete ticket register or the biker’s composite quality assessment.')} action={action('سجل البايكر', 'Biker registry', 'bikers')} />
        <div className="sw-overview__metric-grid">
          <Metric icon={Star} tone="amber" label={text('تقييم العملاء', 'Customer rating')} value={qualityReady && q.average !== null ? `${number(q.average)} / 5` : unavailable}
            note={qualityReady && !q.rated.length ? text('لا توجد تقييمات عملاء صالحة في حجوزات الشهر المستوردة', 'No valid customer ratings in this month’s imported bookings') : text('من تقييمات فعلية في العينة المقروءة', 'From actual ratings in the read sample')} disabled={!qualityReady || !q?.rated.length} onClick={() => setDetail({ kind: 'ratings', title: text('تقييمات العملاء', 'Customer ratings') })} />
          <Metric icon={Star} label={text('عدد التقييمات', 'Ratings count')} value={qualityReady ? number(q.rated.length) : unavailable}
            note={qualityReady ? `${text('الحجوزات المقروءة', 'Read bookings')}: ${number(q.rows.length)}` : ''} disabled={!qualityReady} onClick={() => setDetail({ kind: 'ratings', title: text('تقييمات العملاء', 'Customer ratings') })} />
          <Metric icon={Ticket} tone="orange" label={text('مراجع التكتات', 'Ticket references')} value={qualityReady && q.tickets.length ? number(q.tickets.length) : unavailable}
            note={qualityReady && !q.tickets.length ? text('لم تصل مراجع تكتات في عينة الشهر؛ هذا لا يعني عدم وجود تكتات', 'No ticket references in this month’s sample; this does not mean there are no tickets') : text('غياب المرجع لا يثبت عدم وجود تكت', 'No reference does not prove there are no tickets')} disabled={!qualityReady || !q?.tickets.length} onClick={() => setDetail({ kind: 'tickets', title: text('مراجع التكتات المتاحة', 'Available ticket references') })} />
          <Metric icon={Activity} tone="amber" label={text('تقييمات أقل من 4', 'Ratings below 4')} value={qualityReady ? number(q.low.length) : unavailable}
            note={text('للمراجعة، وليس حكمًا على العامل', 'For review, not a judgment on a worker')} disabled={!qualityReady} onClick={() => setDetail({ kind: 'low', title: text('تقييمات تحتاج مراجعة', 'Ratings to review') })} />
        </div>
        {(bookings.error || q?.conflicts > 0) && <p role="alert" className="sw-overview__notice">{text('بيانات الجودة غير مؤكدة؛ المصدر متعذر أو يحوي تكرارًا متعارضًا.', 'Quality data is unconfirmed: the source is unavailable or has conflicting duplicates.')}</p>}
      </section>

      <Card className="sw-overview__panel"><SectionHeader title={text('يحتاج انتباهك', 'Needs your attention')} subtitle={text('ملاحظات من المصادر المقروءة فقط، لا قائمة شاملة بكل التزامات المشروع.', 'Findings from the read sources only, not a complete list of business obligations.')} />
        <div className="sw-overview__attention">
          <div><h3>{text('المصاريف والبيانات', 'Expenses and data')}</h3>
            {!st ? <p>{text('الأرقام المالية غير مؤكدة بعد.', 'Financial figures are not yet confirmed.')}</p> : <>
              <p>{text('سندات مصروف غير مدفوعة ومستحقة في الشهر', 'Unpaid expense vouchers due in this month')}: <strong>{number(data.dueVouchers.length)}</strong></p>
              {st.issues?.length > 0 && <p role="alert">{text('سجلات مستبعدة من القائمة لبيانات ضريبية غير محسومة', 'Records excluded from the statement due to unresolved tax data')}: <strong>{number(st.issues.length)}</strong></p>}
            </>}
            {workerReady && ops?.unspecified > 0 && <p>{text('بايكر بدون حالة مسجلة', 'Bikers without a recorded status')}: <strong>{number(ops.unspecified)}</strong></p>}
            {action('مراجعة المصاريف الشهرية', 'Review monthly expenses', 'monthly')}
          </div>
          <div><h3>{text('متابعة الجودة', 'Quality follow-up')}</h3>
            {!qualityReady || !workerReady ? <p>{unavailable}</p> : q.attention.length ? <ul>{q.attention.slice(0, 5).map(item => <li key={item.biker.id}>
              <span><bdi dir="ltr">{item.biker.driverExternalId || '—'}</bdi> · <span translate="no">{displayBikerName(item.biker, language)}</span></span>
              <small>{text('تقييمات منخفضة', 'Low ratings')}: {number(item.low)} · {text('مراجع تكتات', 'Ticket references')}: {number(item.tickets)}</small></li>)}</ul>
              : <p>{text('لا توجد ملاحظات مرتبطة بالعامل في العينة المقروءة؛ لا يثبت ذلك خلو سجل الجودة الكامل.', 'No worker-linked findings in the read sample; this does not establish a clean complete quality record.')}</p>}
            {role === 'admin' ? action('فتح سجل البايكر والتقييم المركّب', 'Open bikers and composite assessments', 'bikers') : action('سجل البايكر', 'Biker registry', 'bikers')}
          </div>
        </div>
      </Card>

      <Card className="sw-overview__panel"><details className="sw-overview__capital" onToggle={event => setCapitalOpen(event.currentTarget.open)}>
        <summary><span>{text('رأس المال والتأسيس', 'Capital and setup')}<small>{text('تحصيل الشركاء وصرف التأسيس · منفصل عن دخل التشغيل', 'Partner contributions and setup spending · separate from operating income')}</small></span></summary>
        {capitalOpen && <CapitalOverviewPage embedded />}
      </details></Card>
    </main>

    {detail?.kind === 'financial' && st && <IncomeStatementDetailsModal statement={st} detailKey={detail.key} onClose={() => setDetail(null)}
      onSelect={key => setDetail({ kind: 'financial', key })} onPeriodSelect={(month, key) => { setPeriodKey(month); setDetail({ kind: 'financial', key }); }} />}
    {detail && detail.kind !== 'financial' && <ModalSurface onClose={() => setDetail(null)}><section className="sw-overview-detail" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <header><h2>{detail.title}</h2><button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={() => setDetail(null)}><X size={20} /></button></header>
      <p><bdi dir="ltr">{detail.kind === 'yesterday' ? ops?.yesterday : periodKey}</bdi> · {text('سجلات مقروءة فقط', 'Read records only')}</p>
      {detail.kind === 'month' && <p>{text('المتوسط = الغسلات ÷ الأيام التي فيها غسلات', 'Average = washes ÷ days with washes')}: <bdi dir="ltr">{number(ops.quantity)} ÷ {number(ops.washDays)} = {number(ops.average)}</bdi></p>}
      {detail.kind === 'bikerAverage' && <p>{text('المتوسط اليومي للبايكر = الغسلات ÷ مجموع أيام الغسيل لكل بايكر', 'Daily biker average = washes ÷ the sum of each biker’s wash days')}: <bdi dir="ltr">{number(ops.quantity)} ÷ {number(ops.bikerWashDays)} = {number(ops.averagePerBikerDay)}</bdi></p>}
      {!detailRows?.length ? <p>{text('لا توجد سجلات ضمن النطاق المقروء.', 'No records in the read scope.')}</p> : <ul>{detailRows.map((row, index) => <li key={row.id || row.sspBookingId || index}>
        {isWashDetail ? <><bdi>{row.sspBookingId || row.id}</bdi><span><bdi>{recordedBikerSweaterId(row, workers.bikers) || '—'}</bdi> · <span translate="no">{displayRecordedBikerName(row, workers.bikers, language)}</span></span><span>{date(row.washDate)} · {number(row.quantity)} {text('غسلة', 'washes')}</span></>
          : detail.kind === 'workers' ? <><bdi>{row.driverExternalId || '—'}</bdi><span translate="no">{displayBikerName(row, language)}</span></>
            : <><bdi>{row.sspBookingId}</bdi><span>{date(row.serviceDate)}</span>{detail.kind === 'tickets' ? <bdi>{row.ticketRef}</bdi> : <bdi dir="ltr">{number(Number(row.rating))} / 5</bdi>}</>}
      </li>)}</ul>}
    </section></ModalSurface>}
    <Toast {...toast} onClose={() => setToast(current => ({ ...current, open: false }))} />
  </>;
}

function Metric({ label, value, icon: Icon, tone = 'orange', note, comparison, onClick, disabled }) {
  return <button type="button" className="sw-overview-metric" disabled={disabled} onClick={onClick} aria-label={label}>
    <span className={`sw-overview-metric__icon sw-overview-metric__icon--${tone}`}><Icon size={22} aria-hidden="true" /></span>
    <span className="sw-overview-metric__label">{label}</span><strong className="tabular-nums"><bdi>{value}</bdi></strong>
    <span className="sw-overview-metric__note">{note}</span>{comparison && <small>{comparison}</small>}
  </button>;
}
