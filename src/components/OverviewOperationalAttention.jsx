import { OVERVIEW_SETTINGS as settings } from '../config/overviewSettings';
import { overviewAttention, overviewSettlements } from '../lib/overviewInsights';
import { displayBikerName } from '../lib/bikerNames';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

export default function OverviewOperationalAttention({ data, periodKey, today, washReady, workerReady, language, onNavigate }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const ops = washReady ? data.operations : null;
  const bookingReady = data.bookings && !data.bookings.loading && !data.bookings.error;
  const adjustmentReady = data.adjustments && !data.adjustments.loading && !data.adjustments.error;
  const a = overviewAttention({ ops, today, bikers: workerReady ? data.workers.bikers : [], bookings: bookingReady ? data.bookings.items : [] });
  const s = ops && adjustmentReady ? overviewSettlements({ adjustments: data.adjustments.items, periodKey, to: ops.to }) : null;
  const bikerLabel = biker => <span translate="no">{biker?.driverExternalId && <bdi>{biker.driverExternalId} · </bdi>}{displayBikerName(biker, language)}</span>;
  return <>
    <div className="sw-overview__attention sw-overview__new-attention">
      {bookingReady && a.shortWashes.length > 0 && <section><h3>{text(`غسلات أقل من ${settings.shortWashMinutes} دقائق`, `Washes shorter than ${settings.shortWashMinutes} minutes`)}</h3>
        <ul>{a.shortWashes.map(row => <li key={row.sspBookingId}><span>{row.biker ? bikerLabel(row.biker) : row.driverName || text('الاسم غير متاح', 'Name unavailable')}</span>
          <bdi>{row.sspBookingId}</bdi><span><bdi>{formatNumber(Math.round(row.duration * 100) / 100)}</bdi> {text('دقيقة', 'min')}</span></li>)}</ul>
      </section>}
      {s && !s.malformed && s.violations.length > 0 && <section><h3>{text('مخالفات وتعويضات الشهر', 'Monthly violations and compensation')}</h3>
        <ul>{s.violations.map(row => <li key={row.id}><span>{row.nameArabic || row.typeKey} · {row.driverName || row.sspBookingId || row.effectiveDate}</span>
          <span>{formatCurrencyPrecise(row.amount)} · {row.approvalStatus === 'approved' ? text('معتمد', 'Approved') : text('معلّق / محل اعتراض', 'Pending / disputed')}</span></li>)}</ul>
        <button className="sw-overview__link" type="button" onClick={() => onNavigate?.('sweater_settlements')}>{text('فتح التفاصيل', 'Open details')}</button>
      </section>}
      {workerReady && a.idle.length > 0 && <section><h3>{text('بايكر بلا غسلات مسجلة أمس', 'Bikers without recorded washes yesterday')}</h3>
        <small>{text('أمس فقط، آخر يوم مكتمل، من النشطين المسجلين؛ وليس إثبات غياب. لا نرسل أو نسجل أي إجراء تلقائي.', 'Yesterday only, the last completed day, for the recorded active roster; not proof of absence. No automatic action is sent or recorded.')}</small>
        <ul>{a.idle.map(({ biker, dates }) => <li key={biker.id}>{bikerLabel(biker)}<bdi>{dates.join(' · ')}</bdi></li>)}</ul>
      </section>}
      {workerReady && a.iqamas.length > 0 && <section><h3>{text(`إقامات تنتهي خلال ${settings.documentWarningDays} يومًا`, `Iqamas expiring within ${settings.documentWarningDays} days`)}</h3>
        <ul>{a.iqamas.map(({ biker, daysLeft }) => <li key={biker.id}>{bikerLabel(biker)}<bdi>{biker.iqamaExpiry}</bdi><span>{formatNumber(daysLeft)} {text('يوم', 'days')}</span></li>)}</ul>
      </section>}
      {workerReady && a.missingEndDate.length > 0 && <section><h3>{text('يحتاج تاريخ نهاية', 'Needs an end date')}</h3>
        <small>{text(`حالتهم ${settings.departedStatuses.join(' / ')} ولا تاريخ نهاية لهم، فرواتبهم تُحسب في مسير الشهر. للعرض فقط؛ لا يُعدَّل شيء تلقائيًا.`,
          `Their status is ${settings.departedStatuses.join(' / ')} with no end date, so the month’s payroll still counts them. For review only; nothing is changed automatically.`)}</small>
        <ul>{a.missingEndDate.map(biker => <li key={biker.id}>{bikerLabel(biker)}<span translate="no">{biker.currentStatus}</span>{biker.startDate && <bdi>{biker.startDate}</bdi>}</li>)}</ul>
        <button className="sw-overview__link" type="button" onClick={() => onNavigate?.('bikers')}>{text('فتح سجل البايكر', 'Open the bikers register')}</button>
      </section>}
    </div>
    <details className="sw-overview__disclosure sw-overview__data-gaps"><summary>{text('تغطية التنبيهات والبيانات الناقصة', 'Alert coverage and missing data')}</summary>
      <p>{!bookingReady ? text('قراءة حجوزات سويتر غير متاحة؛ لا يمكن فحص مدد الغسيل.', 'Sweater bookings are unavailable; durations cannot be checked.')
        : !ops ? text('الغسلات غير مؤكدة؛ تنبيهات التشغيل متوقفة لحين تحقق المصدر.', 'Washes are unconfirmed; operational alerts await source verification.')
          : text(`فُحص توقيت ${a.timed} حجزًا. ${a.missingTiming} غسلة مرتبطة بلا وقت بدء وإكمال صالحين؛ لم نختلق لها مدة.`, `Checked timing for ${a.timed} bookings. ${a.missingTiming} linked washes lack valid start/end times; no duration was invented.`)}</p>
      <p>{text('حقول المدة: sweater_bookings.record.startedAt وcompletedAt، مع رقم الحجز sspBookingId. قرار المالك بالإكمال ليس وقت انتهاء.', 'Duration fields: sweater_bookings.record.startedAt and completedAt, linked by sspBookingId. An owner completion decision is not an end timestamp.')}</p>
      {a.conflictingBookings > 0 && <p>{text('حجوزات بتوقيتات متعارضة مستبعدة من تنبيه القِصر', 'Conflicting bookings excluded from short-wash alerts')}: {formatNumber(a.conflictingBookings)}</p>}
      <p>{text('انتهاء الإقامة: bikers.iqama_expiry.', 'Iqama expiry: bikers.iqama_expiry.')} {workerReady && ops ? text(`غير متاح لدى ${a.missingIqama} بايكر.`, `Unavailable for ${a.missingIqama} bikers.`) : text('تعذّر تأكيد تغطية الوثائق بعد.', 'Document coverage is not confirmed yet.')}</p>
      <p>{text('لا توجد حقول موثقة لانتهاء تأمين الدباب أو الاستمارة؛ لا تنبيهات لهما. نحتاج تاريخ انتهاء التأمين وتاريخ انتهاء الاستمارة وربطهما بالدباب.', 'No documented bike insurance or registration expiry fields; their alerts are omitted. Each needs an expiry date linked to the bike.')}</p>
      {!adjustmentReady && <p>{text('قراءة المخالفات والتسويات الخصمية غير متاحة بعد.', 'Violation and deduction adjustments are not available yet.')}</p>}
      {(data.bookings?.error || data.adjustments?.error || data.settlements?.error) && <button type="button" className="sw-overview__link" onClick={data.retry}>{text('إعادة قراءة المصادر', 'Retry source reads')}</button>}
      {today.slice(0, 7) !== periodKey && <p>{text('تنبيهات عدم وجود غسلات أمس وانتهاء الوثائق للشهر الحالي فقط؛ حالة العامل الحالية لا تثبت حالته التاريخية.', 'No-wash and document expiry alerts apply to the current month only; current worker status does not establish historical status.')}</p>}
    </details>
  </>;
}
