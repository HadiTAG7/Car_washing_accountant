import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import ModalSurface from './ModalSurface';
import { useLanguage } from '../i18n/useLanguage';
import { useBikerProfileBookings } from '../hooks/useBikerProfileBookings';
import { bikerProfileStats, riyadhToday } from '../lib/bikerProfile';
import { displayBikerName } from '../lib/bikerNames';
import { bikerCurrentStatusLabel } from '../lib/bikerCurrentStatus';
import { formatCurrencyPrecise, formatDate, formatNumber } from '../data/initialData';
import './BikerProfile.css';

export default function BikerProfile({ role, isPartnerView, ...props }) {
  if (role !== 'admin' || isPartnerView || !props.biker) return null;
  return <AdminBikerProfile {...props} />;
}

function AdminBikerProfile({ biker, washes, washesLoading, washesError, advances, advancesLoading, advancesError, onClose }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const today = riyadhToday();
  const [periodKey, setPeriodKey] = useState(today.slice(0, 7));
  const source = useBikerProfileBookings(biker.id, periodKey);
  const stats = useMemo(() => bikerProfileStats({ biker, washes, bookings: source.bookings, periodKey, today }),
    [biker, washes, source.bookings, periodKey, today]);
  const unavailable = text('غير متاح', 'Unavailable');
  const washReady = !washesLoading && !washesError && Array.isArray(washes) && stats.validPeriod && !stats.conflicts.length;
  const metric = value => washReady && value !== null ? formatNumber(value) : unavailable;
  const qualityReady = source.available && stats.validPeriod;
  const ownAdvances = (advances || []).filter(a => a.bikerId === biker.id && a.status === 'pending')
    .reduce((sum, a) => sum + Math.max(0, (Number(a.amount) || 0) - (Number(a.recoveredAmount) || 0)), 0);
  const information = [
    ['Sweater ID', 'Sweater ID', biker.driverExternalId],
    ['الحالة الحالية', 'Current status', bikerCurrentStatusLabel(biker.currentStatus, language)],
    ['الاسم بالعربي', 'Arabic name', biker.nameArabic], ['الاسم بالإنجليزي', 'English name', biker.nameEnglish],
    ['الجوال', 'Mobile', biker.contactNumber], ['الجنسية', 'Nationality', biker.nationality],
    ['السكن', 'Housing', biker.residence], ['الكفيل', 'Sponsor', biker.sponsor],
    ['تاريخ البداية', 'Start date', biker.startDate && formatDate(biker.startDate)],
    ['تاريخ النهاية', 'End date', biker.endDate && formatDate(biker.endDate)],
    ['رقم الإقامة', 'Iqama number', biker.iqamaNumber], ['انتهاء الإقامة', 'Iqama expiry', biker.iqamaExpiry && formatDate(biker.iqamaExpiry)],
    ['الراتب المتفق عليه', 'Agreed salary', biker.salary > 0 ? formatCurrencyPrecise(biker.salary) : null],
    ['السلف القائمة', 'Outstanding advances', !advancesLoading && !advancesError ? formatCurrencyPrecise(ownAdvances) : null],
  ];
  return <ModalSurface onClose={onClose} className="sw-biker-profile" >
    <header className="sw-biker-profile__header">
      <div><p>{text('بروفايل البايكر · للأدمن فقط', 'Biker profile · Admin only')}</p>
        <h2 translate="no" dir="auto">{displayBikerName(biker, language)}</h2></div>
      <button type="button" onClick={onClose} className="sw-button sw-button--secondary" aria-label={text('إغلاق البروفايل', 'Close profile')}><X size={20} /></button>
    </header>
    <div className="sw-biker-profile__body" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <section><h3>{text('بيانات العامل', 'Worker information')}</h3>
        <dl className="sw-biker-profile__info">{information.map(([ar, en, value]) => <div key={en}><dt>{text(ar, en)}</dt><dd translate="no" dir="auto">{value || unavailable}</dd></div>)}</dl>
      </section>
      <section>
        <div className="sw-biker-profile__period"><h3>{text('أداء الغسلات', 'Wash activity')}</h3>
          <label>{text('الشهر', 'Month')}<input type="month" value={periodKey} max={today.slice(0, 7)} onChange={e => setPeriodKey(e.target.value)} /></label></div>
        <p className="sw-biker-profile__note">{text('الأرقام من الغسلات المسجلة بالموقع، ولا تثبت اكتمال الاستيراد أو الحضور. اليوم وأمس بتوقيت الرياض.', 'Figures use washes recorded in this app, not proof of complete imports or attendance. Today and yesterday use Riyadh time.')}</p>
        {washesLoading && <p role="status">{text('جارٍ تحميل الغسلات…', 'Loading washes…')}</p>}
        {washesError && <p role="alert">{text('تعذّر تحميل الغسلات؛ لا يمكن تأكيد الأرقام.', 'Washes could not be loaded; figures cannot be confirmed.')}</p>}
        {!stats.validPeriod && <p role="alert">{text('اختر شهراً صالحاً.', 'Select a valid month.')}</p>}
        {stats.conflicts?.length > 0 && <p role="alert">{text('توجد سجلات تنفيذ مكررة متعارضة؛ الأرقام غير مؤكدة حتى مراجعتها.', 'Conflicting duplicate executions exist; figures are unconfirmed pending review.')}</p>}
        {stats.unlinkedLegacyRows > 0 && <p role="alert">{text('غسلات قديمة تحمل نفس الاسم دون ربط بمعرّف العامل، لم تُضم تلقائياً:', 'Legacy washes share this name without a worker ID; not automatically included:')} {formatNumber(stats.unlinkedLegacyRows)}</p>}
        <div className="sw-biker-profile__metrics">{[
          ['غسلات اليوم', 'Today’s washes', stats.todayWashes], ['غسلات أمس', 'Yesterday’s washes', stats.yesterdayWashes],
          ['غسلات الشهر المحدد', 'Selected month washes', stats.monthWashes], ['إجمالي الغسلات المسجلة', 'All recorded washes', stats.lifetimeWashes],
          ['متوسط اليوم التقويمي', 'Average per calendar day', stats.averagePerCalendarDay], ['متوسط أيام الغسيل', 'Average per wash day', stats.averagePerWashDay],
        ].map(([ar, en, value]) => <div key={en}><span>{text(ar, en)}</span><strong>{metric(value)}</strong></div>)}</div>
        {stats.validPeriod && <p className="sw-biker-profile__note">{text('مقام المتوسط: أيام الفترة المنقضية ضمن تاريخَي بدء ونهاية العامل', 'Average denominator: elapsed days within worker start/end dates')}: {formatNumber(stats.calendarDays)} · {text('أيام لها غسلات مسجلة', 'Days with recorded washes')}: {washReady ? formatNumber(stats.washDays) : unavailable}</p>}
        <details open><summary>{text('الغسلات يوماً بيوم', 'Daily wash counts')}</summary>
          {washReady ? <div className="sw-biker-profile__table"><table><thead><tr><th>{text('التاريخ', 'Date')}</th><th>{text('الغسلات المسجلة', 'Recorded washes')}</th></tr></thead><tbody>{stats.daily.map(d => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{formatNumber(d.count)}</td></tr>)}</tbody></table>
            {!stats.daily.length && <p>{text('لا توجد أيام منقضية ضمن هذه الفترة.', 'No elapsed days in this period.')}</p>}</div> : <p>{unavailable}</p>}
        </details>
      </section>
      <section><h3>{text('الجودة والتكتات · الشهر المحدد', 'Quality and tickets · Selected month')}</h3>
        <p className="sw-biker-profile__note">{text('من التقييمات ومراجع التكتات الموجودة في الحجوزات المستوردة فقط؛ ليس سجل تكتات سويتر الكامل أو حكماً على العامل.', 'Uses ratings and ticket references present in imported bookings only; not Sweater’s full ticket register or a worker assessment.')}</p>
        {source.loading && <p role="status">{text('جارٍ تحميل بيانات الجودة…', 'Loading quality data…')}</p>}
        {source.error && <p role="alert">{text('تعذّر تحميل مصدر الجودة؛ البيانات غير متاحة.', 'Quality source could not be loaded; data is unavailable.')}</p>}
        <p>{text('متوسط التقييم', 'Average rating')}: <strong>{qualityReady && stats.quality.averageRating !== null ? `${formatNumber(stats.quality.averageRating)} / 5` : unavailable}</strong>
          {qualityReady && <> · {text('عدد التقييمات', 'Ratings')}: {formatNumber(stats.quality.ratedCount)} · {text('الحجوزات المستوردة المرتبطة', 'Linked imported bookings')}: {formatNumber(stats.quality.importedBookings)}</>}</p>
        <details><summary>{text('التقييمات المسجلة', 'Recorded ratings')}</summary>{qualityReady && stats.quality.ratings.length ? <ul>{stats.quality.ratings.map(r => <li key={r.sspBookingId}><bdi>{r.sspBookingId}</bdi> · {formatDate(r.serviceDate)} · {formatNumber(Number(r.rating))} / 5</li>)}</ul> : <p>{unavailable}</p>}</details>
        <details><summary>{text('مراجع التكتات المتاحة', 'Available ticket references')}{qualityReady && stats.quality.tickets.length > 0 ? ` (${formatNumber(stats.quality.tickets.length)})` : ''}</summary>
          {qualityReady && stats.quality.tickets.length ? <ul>{stats.quality.tickets.map(t => <li key={t.ref}><bdi>{t.ref}</bdi> · {text('الحجوزات المرتبطة', 'Linked bookings')}: <bdi>{t.bookingIds.join('، ')}</bdi></li>)}</ul> : <p>{text('لا توجد مراجع تكتات متاحة في المصدر المقروء؛ هذا لا يثبت عدم وجود تكتات.', 'No ticket references are available from the read source; this does not prove there are no tickets.')}</p>}
        </details>
      </section>
    </div>
  </ModalSurface>;
}
