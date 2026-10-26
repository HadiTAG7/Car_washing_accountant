import { useEffect, useState } from 'react';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useLanguage } from '../i18n/useLanguage';
import { useOperationsToday } from '../hooks/useOperationsToday';
import { riyadhToday } from '../lib/bikerProfile';
import { displayBikerName } from '../lib/bikerNames';
import { coverageTone } from '../lib/breakEven';
import { formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import DateField from './DateField';
import { Card, SectionHeader } from './UI';
import ScrollableTable from './ScrollableTable';
import './OperationsTodayPage.css';

export default function OperationsTodayPage(props) {
  const { role, isPartnerView } = usePartnerView();
  // This page includes company cost/payroll-derived comparisons. Existing
  // admin/accountant access only; never mount company reads in partner mode.
  if (isPartnerView || !['admin', 'accountant'].includes(role)) return null;
  return <OperationsTodayContent {...props} />;
}

export function OperationsTodayContent({ onNavigate }) {
  const { language } = useLanguage();
  const text = (ar, en) => language === 'en' ? en : ar;
  const today = riyadhToday();
  const [day, setDay] = useState(today);
  const [invalidDay, setInvalidDay] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Local freshness colour only; no polling or source connection.
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const read = useOperationsToday(day, today, now), v = read.value?.error ? null : read.value;
  const num = n => n == null ? text('غير متاح', 'Unavailable') : formatNumber(Math.round(n * 100) / 100);
  const stamp = iso => iso ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(iso)) : text('غير متاح', 'Unavailable');
  const freshness = v?.freshness;
  const imported = text('حسب آخر استيراد', 'Based on the last import');
  const idle = () => {
    const url = new URL(window.location.href); url.searchParams.set('bikerTab', 'idle');
    window.history.replaceState(null, '', url); onNavigate?.('bikers');
  };
  const metric = (label, value, note, tone = '') => <Card className={`ot-metric ot-tone-${tone}`}><h3>{label}</h3><strong><bdi>{num(value)}</bdi></strong>{note && <p>{note}</p>}<small>{imported}</small></Card>;
  const financialReady = v?.dailyRequired != null;
  return <>
    <TopBar title={text('اليوم', 'Today')} subtitle={text('وضع التشغيل من البيانات المحفوظة', 'Operations from stored data')} />
    <main className="ot-page" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <div className="ot-toolbar"><div><h2>{text('كيف التشغيل اليوم؟', 'How are operations today?')}</h2><p>{text('قراءة فقط · بدون اتصال مباشر بسويتر', 'Read only · no direct Sweater connection')}</p></div>
        <div className="ot-day"><label htmlFor="operations-day">{text('اليوم بتوقيت الرياض', 'Day in Riyadh')}</label><DateField id="operations-day" ariaLabel={text('اختيار اليوم', 'Select day')} value={day} onChange={event => {
          const next = event.target.value;
          if (!next || next > today) { setInvalidDay(true); return; }
          setInvalidDay(false); setDay(next);
        }} /><button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={() => { setDay(today); setInvalidDay(false); }}>{text('اليوم الحالي', 'Current day')}</button>
          <button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={read.retry}>{text('تحديث البيانات', 'Refresh data')}</button></div>
      </div>
      {invalidDay && <p role="alert">{text('اختر اليوم أو يومًا سابقًا.', 'Choose today or an earlier day.')}</p>}
      <Card className={`ot-freshness ot-tone-${freshness?.tone || 'red'}`}>
        <strong>{text('آخر استيراد من سويتر', 'Last Sweater import')}: <bdi>{read.stateLoading ? '…' : stamp(freshness?.savedAt)}</bdi> {text('(الرياض)', '(Riyadh)')}</strong>
        <p>{text('قراءة المصدر', 'Source read')}: <bdi>{stamp(freshness?.observedAt)}</bdi>{freshness?.ageHours != null && <> · {text('عمر البيانات', 'Data age')}: {num(freshness.ageHours)} {text('ساعة', 'hours')}</>}</p>
        {read.stateError && <p role="alert">{text('تعذّرت قراءة وقت الاستيراد؛ الحداثة غير مؤكدة.', 'Import time could not be read; freshness is unconfirmed.')}</p>}
        {freshness?.coverage && <p>{text('نطاق آخر استيراد', 'Latest import scope')}: <bdi>{freshness.coverage.rangeFrom || '—'} — {freshness.coverage.rangeTo || '—'}</bdi> · {freshness.coverage.isComplete === true ? text('مكتمل حسب سجل الاستيراد', 'Complete according to the import record') : text('تغطية جزئية؛ لا تثبت اكتمال اليوم أو الشركة', 'Partial coverage; does not establish completeness for the day or company')}</p>}
        <small>{day < today ? text('عرض التاريخ من السجلات الحالية؛ ليس لقطة محفوظة وقتها. التكاليف والحالات حسب آخر بيانات متاحة.', 'Historical date shown from current records, not a saved point-in-time snapshot. Costs and statuses use the latest available data.') : text('اليوم ما اكتمل؛ متوسطات الأيام المكتملة تستبعد اليوم.', 'Today is incomplete; completed-day averages exclude today.')}</small>
      </Card>
      {read.loading ? <p role="status">{text('جارٍ قراءة التشغيل…', 'Loading operations…')}</p> : (read.error || read.value?.error) ? <p role="alert">{text('تعذّر تأكيد أرقام التشغيل. أعد القراءة أو راجع تعارض الغسلات.', 'Operational totals could not be confirmed. Refresh or review wash conflicts.')}</p> : v && <>
        <section aria-label={text('الفريق', 'Team')}><SectionHeader title={text('الفريق', 'Team')} subtitle={<bdi>{day}</bdi>} />
          <div className="ot-metrics">
            {metric(day === today ? text('غسلات اليوم حتى الآن', 'Washes today so far') : text('غسلات اليوم المختار', 'Selected day washes'), v.quantity, financialReady ? `${text('مقابل التعادل', 'Against break-even')}: ${num(v.dailyRequired)} ${text('غسلة', 'washes')}` : null, financialReady ? v.quantity >= v.dailyRequired ? 'green' : 'red' : '')}
            {metric(text('غسلات أمس', 'Previous day washes'), v.yesterdayQuantity, v.yesterday)}
            {metric(text('نقطة التعادل اليومية', 'Daily break-even'), v.dailyRequired, text('نفس حساب النظرة العامة · غسلة / يوم', 'Same overview calculation · washes/day'))}
            {metric(text('متوسط آخر 7 أيام مكتملة', 'Last 7 completed days average'), v.weeklyAverage, `${v.weekFrom} — ${v.lastCompleted} · ${text('يشمل الأيام بلا غسلات', 'Includes zero-wash days')}`)}
            {metric(text('المتبقي للتعادل الشهري', 'Washes left to monthly break-even'), v.remainingWashes, `${text('غسلات الشهر المسجلة', 'Recorded month washes')}: ${num(v.monthQuantity)}`)}
            {metric(text('المطلوب يوميًا لباقي الشهر', 'Needed daily for the rest of the month'), v.neededPerRemainingDay, `${num(v.remainingDays)} ${day === today ? text('يوم متبقٍ؛ يشمل اليوم الجاري', 'days left; includes the current day') : text('يوم بعد اليوم المختار', 'days after the selected day')}`)}
          </div>
          {(!financialReady || read.financeError || v.partialCosts || v.payrollError) && <p className="ot-warning" role="status">{text('التعادل والتغطية يتبعان القائمة والمسير المتاحين. أي مصدر ناقص يظهر غير متاح، والتكاليف ذات النواقص تبقى جزئية.', 'Break-even and coverage follow the available statement and payroll. Missing sources remain unavailable; incomplete costs remain partial.')}</p>}
        </section>
        <Card className="ot-panel"><SectionHeader title={text('تنبيهات اليوم', 'Daily alerts')} />
          <ul className="ot-alerts">
            {v.silentCount > 0 && <li className="ot-red"><button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={idle}>{text('بايكر يومين مكتملين بدون غسلات', 'Bikers with two completed days without washes')}: {num(v.silentCount)} · {text('فتح الخاملين', 'Open idle bikers')}</button></li>}
            {v.unlinkedCount > 0 && <li className="ot-red"><button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={() => onNavigate?.('washes')}>{text('غسلات اليوم بدون بايكر مربوط', 'Day washes without a linked biker')}: {num(v.unlinkedCount)}</button></li>}
            {freshness?.tone !== 'green' && <li className={freshness?.tone === 'yellow' ? 'ot-yellow' : 'ot-red'}>{freshness?.savedAt ? text('البيانات متأخرة؛ الأرقام حسب آخر استيراد.', 'Data is stale; figures reflect the last import.') : text('وقت الاستيراد غير متاح؛ لا يمكن تأكيد حداثة البيانات.', 'Import time is unavailable; data freshness cannot be confirmed.')}</li>}
            {v.reconciliation && v.reconciliation.difference !== 0 && <li className="ot-yellow">{v.reconciliation.unknownAtCutoff ? text('مطابقة سويتر تحتاج توقيت الغسلات', 'Sweater reconciliation needs wash completion times') : text('عدد سويتر يختلف عن المسجل', 'Sweater count differs from recorded')}: <bdi>{num(v.reconciliation.sweater)} / {num(v.reconciliation.registered)}</bdi> · {text('الفرق', 'Difference')}: <bdi>{num(v.reconciliation.difference)}</bdi><small className="block">{text('لقطة الشهر', 'Monthly snapshot')}: {stamp(v.reconciliation.extractedAt)} · {text('المسجل قبل وقت اللقطة من أوقات الانتهاء المحفوظة؛ الفرق لا يثبت سببه.', 'Recorded before the snapshot time using stored completion times; the difference does not establish its cause.')}{v.reconciliation.unknownAtCutoff > 0 && <> · {text('غسلات بنفس اليوم دون توقيت مؤكد', 'Same-day washes without confirmed timing')}: {num(v.reconciliation.unknownAtCutoff)}</>}</small></li>}
          </ul>
          {!v.silentCount && !v.unlinkedCount && freshness?.tone === 'green' && v.reconciliation?.difference === 0 && <p>{text('ما فيه تنبيه ضمن المصادر المقروءة.', 'No alerts in the read sources.')}</p>}
          {!v.reconciliation && <p>{text('مطابقة عدد سويتر: غير متاح لهذا التاريخ؛ لا توجد لقطة مناسبة قبله.', 'Sweater count reconciliation is unavailable for this date; no suitable snapshot precedes it.')}</p>}
          <small>{imported}</small>
        </Card>
        <Card className="ot-panel"><SectionHeader title={text('البايكرية النشطون', 'Active bikers')} subtitle={text('المتوسط والتغطية على أيام العمل المتاحة المكتملة؛ الحالات من السجل الحالي.', 'Average and coverage use completed available workdays; statuses use the current roster.')} />
          <ScrollableTable className="overflow-x-auto"><table aria-label={text('تشغيل البايكرية', 'Biker operations')} className="ot-table"><thead><tr>{['البايكر', 'غسلات اليوم', 'غسلات أمس', 'الفعلي / يوم عمل متاح', 'التغطية', 'إلغاءات البايكر هالشهر', 'الحالة'].map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{v.rows.map(r => <tr key={r.biker.id}><th scope="row"><span translate="no">{displayBikerName(r.biker, language)}</span><small className="block"><bdi>{r.biker.driverExternalId || '—'}</bdi></small>{r.silentTwo && <small className="ot-red block">{text('يومين مكتملين بدون غسلات', 'Two completed days without washes')}</small>}</th><td>{num(r.today)}</td><td>{num(r.yesterday)}</td><td>{num(r.actualDaily)}</td><td className={`ot-${coverageTone(r.coverage) || ''}`}>{r.coverage == null ? num(null) : `${num(r.coverage * 100)}%`}</td>
              <td>{num(r.cancellationCount)}{r.cancellationCount != null && r.cancellationPartial && <small className="block">{text('موثقة فقط · تغطية جزئية', 'Observed only · partial coverage')}</small>}</td>
              <td>{r.status === 'idle' ? <button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={idle}>{text('خامل', 'Idle')}</button> : r.status === 'working' ? text('شغال', 'Working') : text('غير محسوم', 'Unconfirmed')}</td></tr>)}</tbody></table></ScrollableTable>
          {!v.rows.length && <p>{text('ما فيه بايكر نشط في السجل لهذا اليوم.', 'No active roster biker for this day.')}</p>}
          <p className="ot-note">{text('التغطية من توزيع التكلفة الحالي نفسه؛ من ليس له نصيب تكلفة لا نختلق له نسبة. الإلغاءات الغائبة ليست صفرًا.', 'Coverage uses the existing cost allocation; no ratio is invented without an allocated cost. Missing cancellations are not zero.')}</p><small>{imported}</small>
        </Card>
        <Card className="ot-panel"><SectionHeader title={text('المناطق', 'Regions')} subtitle={text('الغسلات المكتملة المسجلة، مربوطة بمنطقة الحجز المستورد؛ لا نعدّ الحجز الخام غسلة.', 'Recorded completed washes linked to imported booking regions; raw bookings are not counted as washes.')} />
          {read.bookingsUnavailable || !v.regions ? <p>{text('تعذّرت قراءة المناطق أو ما زالت تُقرأ؛ غير متاح.', 'Regions could not be confirmed or are still loading; unavailable.')}</p> : <ScrollableTable className="overflow-x-auto"><table className="ot-table" aria-label={text('غسلات المناطق', 'Region washes')}><thead><tr><th>{text('المنطقة', 'Region')}</th><th>{text('اليوم المختار', 'Selected day')}</th><th>{text('آخر 7 أيام مكتملة', 'Last 7 completed days')}</th></tr></thead><tbody>{v.regions.map(r => <tr key={r.region}><th scope="row">{r.region}</th><td>{num(r.today)}</td><td>{num(r.week)}</td></tr>)}</tbody></table></ScrollableTable>}
          <small>{imported} · <bdi>{v.weekFrom} — {v.lastCompleted}</bdi></small>
        </Card>
      </>}
    </main>
  </>;
}
