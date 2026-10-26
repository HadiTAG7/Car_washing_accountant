import { useMemo, useRef, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { useGrowthPerformance } from '../hooks/useGrowthPerformance';
import { growthMetrics, growthDay, shiftGrowthDay } from '../lib/growthMetrics';
import { riyadhToday } from '../lib/bikerProfile';
import TopBar from './TopBar';
import DateField from './DateField';
import './GrowthPerformancePage.css';

export function GrowthPerformanceView({ data, language = 'ar' }) {
  const t = (ar, en) => language === 'en' ? en : ar;
  const [workerId, setWorkerId] = useState('all'), [region, setRegion] = useState('all'), [detailDate, setDetailDate] = useState(null);
  const dayButtons = useRef(new Map());
  const displayWorkers = useMemo(() => data.workers.map(w => ({ ...w, name: language === 'en' ? w.nameEnglish || w.name : w.name })), [data.workers, language]);
  const metrics = useMemo(() => growthMetrics({ workers: displayWorkers, from: data.from, to: data.to, measurementDay: data.to, workerId, region }), [displayWorkers, data.from, data.to, workerId, region]);
  const number = n => n == null ? t('غير متاح', 'Unavailable') : new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'ar-SA', { maximumFractionDigits: 2, numberingSystem: 'latn' }).format(n);
  const date = d => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', { day:'numeric',month:'short',year:'numeric',timeZone:'UTC',numberingSystem:'latn' }).format(new Date(`${d}T00:00:00Z`));
  const percentage = n => n == null ? t('غير متاح', 'Unavailable') : `${number(n)}%`;
  const rosterTime = Number.isFinite(Date.parse(data.roster?.at)) ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', { dateStyle:'medium',timeZone:'Asia/Riyadh',numberingSystem:'latn' }).format(new Date(data.roster.at)) : t('غير متاح', 'Unavailable');
  const maximum = Math.max(1, ...metrics.timeline.map(d => d.rate || 0));
  const warningLabels = {
    unlinked: t('غسلات بلا ربط بايكر مؤكد؛ بقيت في الإجمالي.', 'Washes without a confirmed biker link remain in the total.'),
    'unknown-zone': t('بايكرية بلا منطقة في لقطة المواقع.', 'Bikers without a zone in the location snapshot.'),
    availability: t('بيانات أيام العمل غير مكتملة؛ لا نفترض متوسطًا.', 'Workday data is incomplete; no average is assumed.'),
  };
  const warnings = [...(data.warnings || [])];
  if (metrics.unavailableAvailability && !warnings.some(w => w.code === 'availability')) warnings.push({code:'availability',count:metrics.unavailableAvailability});
  const selectWorker = id => { setWorkerId(id); setDetailDate(null); };
  return <div className="sw-growth" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <section className="sw-growth__filters" aria-label={t('فلاتر الأداء', 'Performance filters')}>
      <label>{t('البايكر', 'Biker')}<select value={workerId} onChange={e => selectWorker(e.target.value)}><option value="all">{t('الكل', 'All')}</option>{displayWorkers.filter(w => region === 'all' || w.region === region).map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label>
      <label>{t('الموقع', 'Zone')}<select value={region} onChange={e => {setRegion(e.target.value);selectWorker('all');}}><option value="all">{t('كل المواقع', 'All zones')}</option>{metrics.regions.map(r => <option key={r}>{r}</option>)}</select></label>
      <span>{t('البايكرية المعروضون', 'Displayed bikers')}: <bdi>{number(metrics.selectedCount)}</bdi> {t('من إجمالي', 'of')} <bdi>{number(metrics.activeCount)}</bdi></span>
    </section>
    <p className="sw-growth__meta">{t('آخر لقطة مواقع من سويتر', 'Last Sweater location snapshot')}: {rosterTime}</p>
    <details className="sw-growth__warnings"><summary>{number(warnings.length)} {t('ملاحظات على البيانات', 'data notes')} · <u>{t('تفاصيل', 'Details')}</u></summary>
      <p>{t('القائمة من المسير الحالي والغسلات المسجلة؛ اللقطة للمناطق فقط، ولا تثبت حضورًا.', 'The roster comes from current payroll and recorded washes; the snapshot supplies zones only, not attendance.')}</p>
      {warnings.map(w => <p key={w.code}>{warningLabels[w.code]} {number(w.count)}</p>)}
      <p>{t('أيام العمل هي الأيام المستحقة المكتملة، ناقص يومي الإجازة بالتناسب، بنفس حساب التعادل.', 'Available workdays are completed eligible days minus two prorated days off, using the break-even definition.')}</p>
      <p>{t('المتوسط السابق يشمل الأيام السبعة قبل يوم القياس، بما فيها الأيام بلا غسلات. الأرقام تصف السجل ولا تثبت اكتمال الاستيراد.', 'The prior average covers the seven days before measurement, including zero-wash days. Figures describe the register, not import completeness.')}</p>
      <p>{t('آخر قراءة للسجلات', 'Register last read')}: <bdi>{data.readAt}</bdi></p>
    </details>
    <div className="sw-growth__cards">
      <section className="sw-growth__card"><h2>{t('إجمالي الغسلات المسجلة', 'Total registered washes')}</h2><strong>{number(metrics.total)}</strong><p>{date(data.from)} — {date(data.to)}</p><small>{t('بنفس أساس صفحة الغسلات والفلاتر المختارة.', 'Same basis as the wash register and selected filters.')}</small></section>
      <section className="sw-growth__card"><h2>{t('غسلات / يوم عمل متاح', 'Washes per available workday')}</h2><strong>{number(metrics.actualDaily)}</strong><p><bdi>{number(metrics.total)} ÷ {number(metrics.workDays)}</bdi></p><small>{t('ترتيب البايكرية على هذا المتوسط.', 'Bikers are ranked by this average.')}</small></section>
      <section className="sw-growth__card"><h2>{t('مقابل اليوم السابق', 'Versus previous day')}</h2><strong>{number(metrics.currentRate)}</strong><p>{date(data.to)} · {t('مقابل', 'versus')} {number(metrics.previousRate)} ({date(shiftGrowthDay(data.to,-1))})</p><p>{t('الفرق', 'Change')}: {number(metrics.daily.delta)} · {percentage(metrics.daily.percent)}</p><small>{t('غسلات لكل يوم عمل متاح؛ ليس العدد الخام.', 'Washes per available workday, not the raw count.')}</small></section>
      <section className="sw-growth__card"><h2>{t('مقابل متوسط 7 أيام مكتملة', 'Versus the prior 7 completed days')}</h2><strong>{number(metrics.baselineRate)}</strong><p>{date(metrics.sampleFrom)} — {date(shiftGrowthDay(data.to,-1))}</p><p>{t('الفرق', 'Change')}: {number(metrics.baseline.delta)} · {percentage(metrics.baseline.percent)}</p><small>{t('بنفس أيام العمل المتاحة، ويوم القياس خارج المرجع.', 'Same available-workday denominator; measurement day is excluded from the baseline.')}</small></section>
    </div>
    <section className="sw-growth__panel"><h2>{workerId === 'all' ? t('اتجاه الفريق', 'Team trend') : `${t('اتجاه البايكر', 'Biker trend')}: ${metrics.rows[0]?.name || ''}`}</h2>
      <p className="sw-growth__meta">{t('ارتفاع العمود: غسلات لكل يوم عمل متاح · العدد الخام أسفل التاريخ.', 'Bar height: washes per available workday · raw count below the date.')}</p>
      <div className="sw-growth__chart" role="group" aria-label={t('اتجاه الغسلات في يوم العمل المتاح', 'Washes per available workday trend')}>
        {metrics.timeline.map(d => <button type="button" key={d.date} ref={node => {if(node) dayButtons.current.set(d.date,node);else dayButtons.current.delete(d.date);}} aria-pressed={detailDate===d.date} aria-label={`${d.date}: ${number(d.rate)} · ${t('غسلات', 'washes')}: ${number(d.count)}`} onClick={()=>setDetailDate(d.date)}><span>{number(d.rate)}</span><span className="sw-growth__track"><i style={{height:`${(d.rate||0)/maximum*100}%`}} /></span><small>{date(d.date)}</small><small>{t('غسلات', 'washes')}: {number(d.count)}</small></button>)}
      </div>
      {detailDate && <div className="sw-growth__detail"><h3>{date(detailDate)}</h3>{metrics.rows.map(w=><p key={w.id}>{w.code} — {w.name}: {number(w.days.find(d=>d.date===detailDate)?.recordedCount)}</p>)}<button type="button" onClick={()=>{const trigger=dayButtons.current.get(detailDate);setDetailDate(null);trigger?.focus();}}>{t('إغلاق التفاصيل', 'Close details')}</button></div>}
    </section>
    <section className="sw-growth__panel"><h2>{t('تفصيل البايكرز', 'Biker breakdown')}</h2>
      <div className="sw-growth__scroll"><table aria-label={t('تفصيل البايكرز', 'Biker breakdown')}><thead><tr>{['Sweater ID',t('الاسم','Name'),t('الموقع','Zone'),t('إجمالي الغسلات المسجلة','Total registered washes'),t('أيام العمل المتاحة','Available workdays'),t('غسلات / يوم عمل متاح','Washes per available workday'),date(data.to),date(shiftGrowthDay(data.to,-1)),t('التغير في المعدل %','Rate change %'),t('متوسط 7 أيام مكتملة','7 completed days average')].map((l,i)=><th key={i}>{l}</th>)}</tr></thead>
        <tbody>{metrics.rows.map(w=><tr key={w.id}><td><bdi>{w.code}</bdi></td><td><button type="button" onClick={()=>selectWorker(w.id)}>{w.name}</button></td><td>{w.region}</td><td>{number(w.total)}</td><td>{number(w.workDays)}</td><td>{number(w.actualDaily)}</td><td>{number(w.currentRate)}</td><td>{number(w.previousRate)}</td><td>{percentage(w.daily.percent)}</td><td>{number(w.baselineRate)}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={3}>{t('المجموع','Total')}</th><td>{number(metrics.total)}</td><td>{number(metrics.workDays)}</td><td>{number(metrics.actualDaily)}</td><td colSpan={4}/></tr></tfoot></table></div>
      {!metrics.rows.length && <p>{t('لا توجد بيانات ضمن الفلاتر المختارة.', 'No data for the selected filters.')}</p>}
    </section>
  </div>;
}

export function GrowthPerformanceContent({ language = 'ar', source, period, onPeriodChange }) {
  const t = (ar, en) => language === 'en' ? en : ar;
  const yesterday = shiftGrowthDay(riyadhToday(), -1);
  const [draft, setDraft] = useState(period), [validation, setValidation] = useState(false);
  return <main className="sw-growth__page" dir={language === 'en' ? 'ltr' : 'rtl'}>
    <form className="sw-growth__filters" onSubmit={event=>{event.preventDefault();const valid=growthDay(draft.from)&&growthDay(draft.to)&&draft.from<=draft.to&&draft.to<=yesterday&&Date.parse(draft.to)-Date.parse(draft.from)<=92*86400000;setValidation(!valid);if(valid)onPeriodChange({...draft});}}>
      <label>{t('من','From')}<DateField ariaLabel={t('من','From')} className="sw-growth__date-trigger" value={draft.from} onChange={e=>setDraft(d=>({...d,from:e.target.value}))} required/></label>
      <label>{t('إلى / يوم القياس','To / measurement day')}<DateField ariaLabel={t('إلى / يوم القياس','To / measurement day')} className="sw-growth__date-trigger" value={draft.to} onChange={e=>setDraft(d=>({...d,to:e.target.value}))} required/></label>
      <button type="submit">{t('عرض الفترة','Show period')}</button>
    </form>
    {validation&&<p role="alert">{t('اختر فترة مكتملة لا تتجاوز 93 يومًا.','Choose a completed period of up to 93 days.')}</p>}
    {!source.allowed?<p>{t('هذه الصفحة متاحة للأدمن فقط.','This page is for administrators only.')}</p>:source.loading?<p role="status">{t('جارٍ قراءة بيانات النمو…','Loading growth data…')}</p>:source.error?<div role="alert"><p>{source.error}</p><button type="button" onClick={source.retry}>{t('إعادة المحاولة','Retry')}</button></div>:source.data&&<GrowthPerformanceView key={`${period.from}|${period.to}`} data={source.data} language={language}/>}
  </main>;
}
export default function GrowthPerformancePage() {
  const {language}=useLanguage(), yesterday=shiftGrowthDay(riyadhToday(),-1);
  const [period,setPeriod]=useState({from:`${yesterday.slice(0,7)}-01`,to:yesterday});
  const source=useGrowthPerformance(period.from,period.to);
  return <><TopBar title={language==='en'?'Growth and biker performance':'النمو وأداء البايكرز'} subtitle={language==='en'?'Current records and available-workday comparisons':'السجلات الحالية والمقارنة بأيام العمل المتاحة'}/><GrowthPerformanceContent language={language} source={source} period={period} onPeriodChange={setPeriod}/></>;
}
