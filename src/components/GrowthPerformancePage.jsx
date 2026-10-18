import { useMemo, useRef, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { useGrowthPerformance } from '../hooks/useGrowthPerformance';
import { growthMetrics, growthDifference, growthDay, shiftGrowthDay } from '../lib/growthMetrics';
import { riyadhToday } from '../lib/bikerProfile';
import TopBar from './TopBar';
import './GrowthPerformancePage.css';

export function GrowthPerformanceView({ data, language = 'ar' }) {
  const t = (ar, en) => language === 'en' ? en : ar;
  const [workerId, setWorkerId] = useState('all');
  const [region, setRegion] = useState('all');
  const [detailDate, setDetailDate] = useState(null);
  const dayButtons = useRef(new Map());
  const displayWorkers = useMemo(() => data.workers.map(w => ({ ...w, name: language === 'en' ? w.nameEnglish : w.name })), [data, language]);
  const metrics = useMemo(() => growthMetrics({ workers: displayWorkers, from: data.from, to: data.to,
    measurementDay: data.to, workerId, region }), [displayWorkers, data.from, data.to, workerId, region]);
  const number = value => value == null ? t('غير متاح', 'Unavailable')
    : new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'ar-SA', { maximumFractionDigits: 2, numberingSystem: 'latn' }).format(value);
  const date = value => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
    { day: 'numeric', month: 'short', timeZone: 'UTC', numberingSystem: 'latn' }).format(new Date(`${value}T00:00:00Z`));
  const percentage = (value, known = true) => value == null
    ? (known ? t('غير منطبقة', 'Not applicable') : t('غير متاح', 'Unavailable')) : `${number(value)}%`;
  const rosterTime = Number.isFinite(Date.parse(data.roster?.at)) ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
    { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(data.roster.at)) : t('غير متاح', 'Unavailable');
  const selectedCodes = new Set(metrics.rows.map(r => r.code));
  const exclusions = data.exclusions.filter(x => selectedCodes.has(x.code));
  const gaps = data.gaps.filter(x => selectedCodes.has(x.code));
  const maximum = Math.max(1, ...metrics.timeline.map(d => d.count || 0));
  const weeks = [];
  for (let start = data.from; start <= data.to; start = shiftGrowthDay(start, 1)) {
    if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 6) continue;
    const end = shiftGrowthDay(start, 6);
    if (end > data.to) continue;
    const days = metrics.timeline.filter(d => d.date >= start && d.date <= end);
    weeks.push({ start, end, count: days.length === 7 && days.every(d => d.coverage === 'complete') ? days.reduce((n, d) => n + d.count, 0) : null });
  }
  return <div className="sw-growth" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <section className="sw-growth__filters" aria-label={t('فلاتر الأداء', 'Performance filters')}>
      <label>{t('البايكر', 'Biker')}<select value={workerId} onChange={e => setWorkerId(e.target.value)}>
        <option value="all">{t('الكل', 'All')}</option>
        {displayWorkers.filter(w => region === 'all' || w.region === region).map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
      </select></label>
      <label>{t('الموقع', 'Zone')}<select value={region} onChange={e => { setRegion(e.target.value); setWorkerId('all'); }}>
        <option value="all">{t('كل المواقع', 'All zones')}</option>{metrics.regions.map(r => <option key={r}>{r}</option>)}
      </select></label>
      <span>{t('العاملون ضمن اللقطة', 'Workers in snapshot')}: {metrics.selectedCount} / {metrics.activeCount}</span>
    </section>
    <p className="sw-growth__notice">{t('Active بحسب لقطة SSP الموثقة', 'Active according to the verified SSP snapshot')} {rosterTime} {t('الرياض — الحالة ليست حية', 'Riyadh — not live status')}</p>
    <p className="sw-growth__meta">{t('المواقع من اللقطة نفسها؛ لا تثبت حضورًا أو حالة تاريخية. آخر قراءة للغسلات:', 'Zones use the same snapshot; this does not establish attendance or historical status. Washes last read:')} {' '}
      {new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(data.readAt))}</p>
    <div className="sw-growth__cards">
      <section className="sw-growth__card"><h2>{t('مقابل اليوم السابق', 'Versus previous day')}</h2>
        <strong>{number(metrics.current)}</strong><p>{date(data.to)} · {t('مقابل', 'versus')} {number(metrics.previous)} ({date(shiftGrowthDay(data.to, -1))})</p>
        <p>{t('الفرق', 'Change')}: <bdi>{number(metrics.daily.delta)}</bdi> · <bdi>{percentage(metrics.daily.percent, metrics.current != null && metrics.previous != null)}</bdi></p>
        <small>{t('المفقود ليس صفرًا؛ النسبة غير منطبقة إذا كان المقام صفرًا.', 'Missing is not zero; percentage is not applicable for a zero denominator.')}</small>
      </section>
      <section className="sw-growth__card"><h2>{t('مقابل متوسط 7 أيام عمل', 'Versus 7-workday average')}</h2>
        <strong>{number(metrics.baseline.mean)}</strong>
        {metrics.baseline.available ? <><p>{number(metrics.baseline.total)} ÷ {metrics.baseline.sampleSize} · {metrics.baseline.provisional ? t('عينة مؤقتة', 'Provisional sample') : t('عينة موثقة', 'Verified sample')}</p>
          <p>{t('الفرق', 'Change')}: {number(metrics.baseline.delta)} · {percentage(metrics.baseline.percent, metrics.current != null)}</p>
          <small>{metrics.baseline.dates.map(date).join(' · ')}</small></>
          : <p>{metrics.selectedCount > 1 ? t('مرجع شخصي لكل بايكر؛ لا ندمج عينات غير متكافئة للفريق.', 'A personal baseline; unequal worker samples are not pooled for the team.')
            : t('دليل أيام العمل أو اكتمال التنفيذ غير كافٍ؛ لا نتجاوز الأيام الناقصة.', 'Workday or completion evidence is insufficient; unknown days are not skipped.')}</p>}
      </section>
      <section className="sw-growth__card"><h2>{t('المتوسط العام / يوم غسلات مسجل', 'General average / recorded wash day')}</h2>
        <strong>{number(metrics.generalAverage.mean)}</strong>
        <p>{number(metrics.generalAverage.total)} ÷ {metrics.generalAverage.dayCount} {t('أيام مميزة', 'distinct days')}</p>
        <small>{date(data.from)} — {date(data.to)} · {t('يشمل يوم القياس؛ إحصاء وصفي للسجلات وليس حضورًا أو خط أساس مستقلًا.', 'Includes the measurement day; descriptive records, not attendance or an independent baseline.')}</small>
        {metrics.generalAverage.dayCount === 1 && <p>{t('عينة يوم واحد فقط.', 'Only one recorded day.')}</p>}
      </section>
    </div>
    <section className="sw-growth__panel"><h2>{t('اتجاه الغسلات اليومية', 'Daily wash trend')}</h2>
      <p>{t('الأعداد الجزئية تعرض المسجل فقط؛ الشرطة تعني غير متاح، لا صفرًا.', 'Partial counts show recorded services only; a dash means unavailable, not zero.')}</p>
      <div className="sw-growth__chart" role="group" aria-label={t('الغسلات حسب التاريخ', 'Washes by date')}>
        {metrics.timeline.map(day => <button type="button" key={day.date} ref={node => { if (node) dayButtons.current.set(day.date, node); else dayButtons.current.delete(day.date); }} aria-pressed={detailDate === day.date} onClick={() => setDetailDate(day.date)}
          aria-label={`${day.date}: ${number(day.count)} · ${day.coverage === 'complete' ? t('مكتمل', 'Complete') : t('جزئي', 'Partial')}`}>
          <span>{day.count == null ? '—' : number(day.count)}</span><span className="sw-growth__track"><i style={{ height: `${(day.count || 0) / maximum * 100}%` }} /></span>
          <small>{date(day.date)}</small>{day.coverage !== 'complete' && <small>{t('جزئي', 'Partial')}</small>}
        </button>)}
      </div>
      {detailDate && metrics.timeline.some(d => d.date === detailDate) && <div className="sw-growth__detail"><h3>{date(detailDate)}</h3>
        {metrics.rows.map(worker => <p key={worker.id}><bdi>{worker.code}</bdi> — {worker.name}: {number(worker.days.find(d => d.date === detailDate)?.count)}</p>)}
        <button type="button" onClick={() => { const trigger = dayButtons.current.get(detailDate); setDetailDate(null); trigger?.focus(); }}>{t('إغلاق التفاصيل', 'Close details')}</button></div>}
    </section>
    <section className="sw-growth__panel"><h2>{t('تفصيل البايكرز', 'Biker breakdown')}</h2>
      <div className="sw-growth__scroll"><table><thead><tr>{['Sweater ID', t('الاسم', 'Name'), t('الموقع', 'Zone'), date(data.to), date(shiftGrowthDay(data.to, -1)), t('الفرق', 'Change'), t('التغير %', 'Change %'), t('متوسط 7 أيام', '7-day average'), t('المتوسط العام', 'General average')].map((label, i) => <th key={i}>{label}</th>)}</tr></thead>
        <tbody>{metrics.rows.map(worker => <tr key={worker.id}><td><bdi>{worker.code}</bdi></td><td><button type="button" onClick={() => setWorkerId(worker.id)}>{worker.name}</button></td><td>{worker.region}</td>
          <td>{number(worker.current)}</td><td>{number(worker.previous)}</td><td>{number(worker.daily.delta)}</td><td>{percentage(worker.daily.percent, worker.current != null && worker.previous != null)}</td>
          <td>{number(worker.baseline.mean)}{worker.baseline.provisional && ' *'}</td><td>{number(worker.generalAverage.mean)}<small>{worker.generalAverage.total} ÷ {worker.generalAverage.dayCount}</small></td></tr>)}</tbody></table></div>
      {!metrics.rows.length && <p>{t('لا توجد بيانات ضمن الفلاتر المختارة.', 'No data for the selected filters.')}</p>}
    </section>
    <details className="sw-growth__panel"><summary>{t('التغطية والفروق والمقارنة الأسبوعية', 'Coverage, differences and weekly comparison')}</summary>
      <p>{t('نطاق الأفراد فقط؛ الشركات جزئية ومنفصلة. انخفاض العدد ليس دليل تقصير أو سببًا مثبتًا.', 'Individual services only; corporate coverage is partial and separate. Lower counts do not prove underperformance or causation.')}</p>
      <p>{t('المسجل المرتبط قبل التنقيح', 'Linked records before adjustment')}: {number(metrics.generalAverage.total + exclusions.length)} · {t('المؤهل المعروض', 'Eligible displayed')}: {number(metrics.generalAverage.total)}</p>
      {exclusions.map((x, i) => <p key={i}><bdi>{x.reference}</bdi> · {x.code} · {date(x.date)} · {t('تعارض إتمام؛ مستبعد تحليليًا فقط، دون حذف الأصل.', 'Completion conflict; analytically excluded without deleting the original.')}</p>)}
      {gaps.length > 0 && <><h3>{t('فجوات الإتمام أو الربط', 'Completion or linking gaps')}</h3>{gaps.map((x, i) => <p key={i}><bdi>{x.reference}</bdi> · {x.code} · {date(x.date)}</p>)}</>}
      <p>{t('الإسناد والإلغاء من قوائم الأفراد ضمن الأيام المقروءة؛ ليست نسبة إكمال لجميع الطلبات.', 'Assignment and cancellation use the observed individual-day lists, not a completion rate for all requests.')}</p>
      {metrics.rows.map(worker => { const days = data.workers.find(w => w.id === worker.id)?.days.filter(d => d.date >= data.from && d.date <= data.to) || [];
        const complete = days.length > 0 && days.every(d => d.assigned != null);
        return <p key={worker.id}>{worker.code} — {worker.name}: {t('إسناد', 'Assigned')} {number(complete ? days.reduce((n, d) => n + d.assigned, 0) : null)} · {t('إلغاء', 'Cancelled')} {number(complete ? days.reduce((n, d) => n + d.cancelled, 0) : null)}</p>; })}
      <h3>{t('أسابيع مكتملة السبت–الجمعة', 'Complete Saturday–Friday weeks')}</h3>
      {weeks.map((week, i) => <p key={week.start}>{date(week.start)} — {date(week.end)}: {number(week.count)}
        {i > 0 && <> · {t('مقابل السابق', 'Versus previous')}: {number(growthDifference(week.count, weeks[i - 1].count).delta)} · {percentage(growthDifference(week.count, weeks[i - 1].count).percent, week.count != null && weeks[i - 1].count != null)}</>}</p>)}
      {!weeks.length && <p>{t('لا يوجد أسبوع مكتمل ضمن الفترة.', 'No complete week in this range.')}</p>}
      <p>{t('عدم كفاية التغطية يمنع نسبة نمو أسبوعية؛ لا نفترض أربعة أسابيع مكتملة.', 'Insufficient coverage prevents weekly growth calculation; four complete weeks are not assumed.')}</p>
    </details>
  </div>;
}

export function GrowthPerformanceContent({ language = 'ar', source, period, onPeriodChange }) {
  const t = (ar, en) => language === 'en' ? en : ar;
  const yesterday = shiftGrowthDay(riyadhToday(), -1);
  const [draft, setDraft] = useState(period);
  const [validation, setValidation] = useState(false);
  return <main className="sw-growth__page" dir={language === 'en' ? 'ltr' : 'rtl'}>
      <form className="sw-growth__filters" onSubmit={event => { event.preventDefault();
        const valid = growthDay(draft.from) && growthDay(draft.to) && draft.from <= draft.to && draft.to <= yesterday
          && Date.parse(draft.to) - Date.parse(draft.from) <= 92 * 86400000;
        setValidation(!valid); if (valid) onPeriodChange({ ...draft }); }}>
        <label>{t('من', 'From')}<input type="date" value={draft.from} max={yesterday} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} required /></label>
        <label>{t('إلى / يوم القياس', 'To / measurement day')}<input type="date" value={draft.to} max={yesterday} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} required /></label>
        <button type="submit">{t('عرض الفترة', 'Show period')}</button>
      </form>
      {validation && <p role="alert">{t('اختر فترة مكتملة لا تتجاوز 93 يومًا.', 'Choose a completed period of up to 93 days.')}</p>}
      {!source.allowed ? <p>{t('هذه الصفحة متاحة للأدمن فقط.', 'This page is for administrators only.')}</p>
        : source.loading ? <p role="status">{t('جارٍ قراءة بيانات النمو…', 'Loading growth data…')}</p>
          : source.error ? <div role="alert"><p>{source.error}</p><button type="button" onClick={source.retry}>{t('إعادة المحاولة', 'Retry')}</button></div>
            : source.data && <GrowthPerformanceView key={`${period.from}|${period.to}`} data={source.data} language={language} />}
    </main>;
}

export default function GrowthPerformancePage() {
  const { language } = useLanguage();
  const yesterday = shiftGrowthDay(riyadhToday(), -1);
  const [period, setPeriod] = useState({ from: `${yesterday.slice(0, 7)}-01`, to: yesterday });
  const source = useGrowthPerformance(period.from, period.to);
  return <><TopBar title={language === 'en' ? 'Growth and biker performance' : 'النمو وأداء البايكرز'}
    subtitle={language === 'en' ? 'Wash comparisons within verified coverage' : 'مقارنات الغسلات ضمن التغطية الموثقة'} />
    <GrowthPerformanceContent language={language} source={source} period={period} onPeriodChange={setPeriod} /></>;
}
