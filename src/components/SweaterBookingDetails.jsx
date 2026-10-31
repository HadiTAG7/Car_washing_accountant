import { X } from 'lucide-react';
import ModalSurface from './ModalSurface';
import { useLanguage } from '../i18n/useLanguage';
import { useSweaterBookingSource } from '../hooks/useSweaterBookingSource';
import { useBikers } from '../hooks/useBikers';
import { displayBikerName } from '../lib/bikerNames';
import { bookingSourceObservations, cancellationDetails, cancellationTime, cancellationSourceLink } from '../lib/sweater/cancellationDetails';
import './SweaterBookingDetails.css';

function EventDetails({ observation, bikers, language }) {
  const text = (ar, en) => language === 'en' ? en : ar, missing = text('غير مسجّل', 'Not recorded');
  const r = observation.record, detail = cancellationDetails(r), time = cancellationTime(detail.time, detail.timeZone, language);
  const saved = cancellationTime(observation.savedAt, null, language);
  const matches = bikers.filter(biker => r.driverExternalId && biker.driverExternalId === r.driverExternalId);
  const biker = r.driverName || (matches.length === 1 ? displayBikerName(matches[0], language) : missing);
  const source = cancellationSourceLink(r.sourceUrl);
  const party = { admin: text('الإدارة', 'Administration'),
    biker: text('البايكر، بحسب حالة سويتر', 'Biker, according to Sweater status'), customer: text('العميل، بحسب حالة سويتر', 'Customer, according to Sweater status') };
  return <>
    <dl>
      <div><dt>{text('رقم الحجز في المصدر', 'Source booking ID')}</dt><dd><bdi>{r.sspBookingId}</bdi></dd></div>
      <div><dt>{text('حالة المصدر في هذه الملاحظة', 'Source status in this observation')}</dt><dd><bdi>{r.rawStatus || missing}</bdi></dd></div>
      <div><dt>{text('تاريخ الخدمة في المصدر', 'Source service date')}</dt><dd><bdi>{r.serviceDate || missing}</bdi></dd></div>
      <div><dt>{text('جهة الإلغاء في سويتر', 'Cancelling party in Sweater')}</dt><dd>{party[detail.party] || missing}</dd></div>
      <div><dt>{text('اسم منفّذ الإلغاء المسجّل', 'Recorded cancellation actor')}</dt><dd>{detail.actorName || missing}</dd></div>
      <div><dt>{text('سبب الإلغاء في المصدر', 'Cancellation reason in source')}</dt><dd>{detail.reason || missing}</dd></div>
      <div><dt>{text('وقت الإلغاء', 'Cancellation time')}</dt><dd><bdi>{time.text || missing}</bdi>
        {time.text && <small>{time.converted ? text(`بتوقيت الرياض · دقة ${time.precision === 'second' ? 'الثانية' : 'الدقيقة'}`, `Riyadh time · ${time.precision} precision`)
          : text('وقت المصدر كما هو؛ المنطقة الزمنية غير مثبتة أو التنسيق غير مقروء، فلا يمكن تحويله للرياض.', 'Source time unchanged; timezone is unconfirmed or format unreadable, so Riyadh conversion is unavailable.')}</small>}</dd></div>
      <div><dt>{text('البايكر المسند في هذه الملاحظة', 'Assigned biker in this observation')}</dt><dd>{biker} {r.driverExternalId && <bdi>· {r.driverExternalId}</bdi>}</dd></div>
      <div><dt>{text('وقت حفظ الملاحظة', 'Observation saved at')}</dt><dd><bdi>{saved.text || missing}</bdi>{saved.text && <small>{text('بتوقيت الرياض؛ ليس وقت الإلغاء أو تحديثًا مباشرًا لسويتر.', 'Riyadh time; not cancellation time or a live Sweater refresh.')}</small>}</dd></div>
    </dl>
    {detail.ambiguous && <p role="status">{text('الملاحظات تحتوي أكثر من بطاقة إلغاء؛ تعذّر تحديد بطاقة واحدة دون تخمين.', 'The notes contain multiple cancellation cards; one cannot be selected without guessing.')}</p>}
    {source && <a href={source} target="_blank" rel="noopener noreferrer">{text('فتح صفحة المصدر في سويتر', 'Open source page in Sweater')}</a>}
  </>;
}

export default function SweaterBookingDetails({ booking, onClose }) {
  const { language } = useLanguage(), text = (ar, en) => language === 'en' ? en : ar;
  const r = booking.record ?? booking, read = useSweaterBookingSource(r.sspBookingId), workers = useBikers();
  const observations = bookingSourceObservations(booking, read.error ? [] : read.data || []);
  const current = observations[0] || { record: r, savedAt: booking.updatedAtIso, original: true };
  return <ModalSurface className="sw-booking-details" onClose={onClose}>
    <section dir={language === 'en' ? 'ltr' : 'rtl'}>
      <header><h2>{text('تفاصيل المصدر والإلغاء', 'Source and cancellation details')}</h2>
        <button type="button" aria-label={text('إغلاق التفاصيل', 'Close details')} onClick={onClose}><X size={20} /></button></header>
      <p>{text('الحالة المحفوظة في قائمة الحجوزات', 'Saved status in the booking list')}: <bdi>{r.rawStatus || text('غير مسجّل', 'Not recorded')}</bdi></p>
      <p className="sw-booking-details__notice">{text('عرض للملاحظات المحفوظة فقط؛ لا يغيّر حالة الحجز أو الغسلات أو العمولات أو القيود. الإسناد لا يثبت مسؤولية البايكر.', 'Stored observations only; no booking status, washes, commissions or journals are changed. Assignment does not establish biker responsibility.')}</p>
      {read.loading && <p role="status">{text('جارٍ قراءة تفاصيل المصدر…', 'Loading source details…')}</p>}
      {read.error && <p role="alert">{text('تعذّرت قراءة ملاحظات المصدر. المعروض أدناه من الحجز المحفوظ فقط.', 'Source observations could not be read. Only the saved booking is shown below.')}</p>}
      {!read.loading && <><h3>{current.original ? text('تفاصيل الحجز المحفوظ', 'Saved booking details') : text('أحدث ملاحظة مصدر محفوظة', 'Latest stored source observation')}</h3>
        <EventDetails observation={current} bikers={workers.bikers} language={language} />
        {workers.error && <p role="status">{text('تعذّرت قراءة أسماء البايكرية؛ معرّف المصدر باقٍ ظاهرًا.', 'Biker names could not be read; the source ID remains visible.')}</p>}
        {observations.length > 1 && <details><summary>{text('الملاحظات السابقة', 'Earlier observations')} ({observations.length - 1})</summary>
          {observations.slice(1).map(item => <article key={item.id}><EventDetails observation={item} bikers={workers.bikers} language={language} /></article>)}
        </details>}
      </>}
    </section>
  </ModalSurface>;
}
