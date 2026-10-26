import { useEffect, useMemo, useRef, useState } from 'react';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useQualityViolations } from '../hooks/useQualityViolations';
import { useOverviewBikerQuality } from '../hooks/useOverviewBikerQuality';
import { bikerQualitySummary } from '../lib/bikerQualitySummary';
import { qualityBikerRows } from '../lib/qualityViolations';
import { riyadhToday } from '../lib/bikerProfile';
import { COMPENSATION_KEYS, SWEATER_METRICS } from '../../functions/src/sweater/metricsContract';
import { COMPENSATION_LABELS, OBJECTION_STATUSES, objectionDeadline, groupAmount } from '../../functions/src/sweater/compensationEvents';
import { formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import BikerProfileMonthPicker from './BikerProfileMonthPicker';
import ScrollableTable from './ScrollableTable';
import { Card, SectionHeader } from './UI';
import './QualityViolationsPage.css';
const number = value => value == null ? 'غير متاح' : formatNumber(Math.round(value * 100) / 100);
const stamp = value => value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }) : 'غير متاح';
const button = 'sw-button sw-button--secondary sw-button--sm';

export default function QualityViolationsPage() {
  const { role, isPartnerView } = usePartnerView();
  if (role !== 'admin' || isPartnerView) return null;
  return <QualityViolationsContent />;
}
export function QualityViolationsContent() {
  const today = riyadhToday(), [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState(null);
  const read = useQualityViolations(month), snapshot = read.current.snapshot;
  const rows = useMemo(() => qualityBikerRows(snapshot, read.workers.bikers), [snapshot, read.workers.bikers]);
  const quality = useOverviewBikerQuality(read.workers.bikers, month, true);
  const [search, setSearch] = useState('');
  const visible = rows.filter(row => `${row.name} ${row.externalId}`.toLowerCase().includes(search.toLowerCase()));
  const selectedRow = rows.find(row => row.id === selected);
  const detailRef = useRef(null);
  const openedFrom = useRef(null);
  useEffect(() => { if (selected) { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); } }, [selected]);
  const eventCount = rows.reduce((sum, row) => sum + row.events.length, 0);
  const loading = read.current.loading || read.workers.loading, error = read.current.error || read.workers.error;
  return <><TopBar title="الجودة والمخالفات" subtitle="تفاصيل سويتر ومتابعة الاعتراضات" />
    <main className="qv-page" dir="rtl"><div className="qv-toolbar"><div><h2>الجودة والمخالفات</h2><p>من اللقطات المحفوظة · بدون اتصال مباشر بسويتر</p></div>
      <BikerProfileMonthPicker value={month} max={today.slice(0, 7)} language="ar" onChange={value => { setMonth(value); setSelected(null); }} />
      <button className={button} onClick={read.refresh}>تحديث البيانات</button></div>
      <Card className="qv-panel"><SectionHeader title="مهلة الاعتراض" subtitle="متابعة داخلية فقط؛ تغيير الحالة هنا لا يرسل اعتراضًا إلى سويتر." />
        {read.settings.loading ? <p>جارٍ قراءة المهلة…</p> : read.settings.error ? <p role="alert">تعذّرت قراءة المهلة؛ لا يمكن تحديد قرب انتهائها.</p>
          : <DeadlineSetting key={read.settings.data?.revision || 0} settings={read.settings.data} save={read.saveSettings} />}</Card>
      {loading ? <p role="status">جارٍ قراءة اللقطات…</p> : error ? <p role="alert">تعذّرت قراءة التفاصيل. أعد المحاولة.</p> : <>
        <section aria-label="ملخص الشهر"><SectionHeader title="ملخص الشهر" subtitle={`${month} · كل بند يحتفظ بوقت قراءته وتغطيته`} />
          <div className="qv-summary">{COMPENSATION_KEYS.map(key => {
            const group = snapshot?.eventGroups?.[key], value = snapshot?.metrics?.[key], money = SWEATER_METRICS[key].unit === 'sar';
            const count = money ? group?.totalRows ?? null : value ?? null, amount = groupAmount(group, value, key);
            const oldSnapshot = read.previous.error || read.previous.loading ? null : read.previous.snapshot;
            const oldGroup = oldSnapshot?.eventGroups?.[key], oldValue = oldSnapshot?.metrics?.[key];
            const oldCount = money ? oldGroup?.totalRows ?? null : oldValue ?? null, oldAmount = groupAmount(oldGroup, oldValue, key);
            return <Card className="qv-panel" key={key}><h3>{COMPENSATION_LABELS[key]}</h3><strong>{number(count)} <small>{key === 'freeWashCompensation' ? 'غسلة' : 'واقعة'}</small></strong><p>{number(amount)} ر.س</p>
              <small>عن الشهر السابق: العدد {count != null && oldCount != null ? number(count - oldCount) : 'غير متاح'} · المبلغ {amount != null && oldAmount != null ? `${number(amount - oldAmount)} ر.س` : 'غير متاح'}</small>
              <p className="qv-note">{!group ? 'ما وصلت تفاصيل سويتر' : `${group.rows.length} صف مستلم${group.totalRows != null ? ` من ${group.totalRows}` : ''} · ${group.complete ? 'الجدول مكتمل حسب المصدر' : 'تفاصيل جزئية'}`}</p>
              <small>قراءة المصدر: {stamp(snapshot?.metricSources?.[key]?.extractedAtIso)} (الرياض)</small></Card>;
          })}</div></section>
        {!eventCount && <Card className="qv-panel"><h3>ما وصلت تفاصيل سويتر</h3><p>المجاميع وحدها لا تحدد البايكر أو الحجز. ستظهر الصفوف بعد استيراد جداول المصدر.</p></Card>}
        <Card className="qv-panel"><SectionHeader title="حسب البايكر" subtitle="الأرقام الجزئية هي الصفوف المستلمة فقط. عدم توفر الإسناد لا يعني صفر مخالفات." />
          <label className="qv-search">بحث بالاسم أو رقم سويتر<input value={search} onChange={e => setSearch(e.target.value)} /></label>
          <ScrollableTable className="overflow-x-auto"><table className="qv-table"><thead><tr>{['البايكر', 'رقم سويتر', 'المخالفات (ر.س)', 'الغسلات المجانية', 'إلغاء البايكر', 'الأضرار والحوادث (ر.س)', 'نقاط الجودة من البروفايل', 'التفاصيل'].map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{visible.map(row => {
              const result = quality.available ? quality.data?.find(r => r.bikerUID === row.biker?.id && !r.failed) : null;
              const score = result?.data?.reports ? bikerQualitySummary(result.data.reports, row.biker?.id, month, today, result.data.manual) : null;
              return <tr key={row.id}><th>{row.name}</th><td><bdi>{row.externalId || 'غير مربوط بسويتر'}</bdi></td>
                {['violations', 'freeWashCompensation', 'cancelledByBiker', 'damages'].map(key => <td key={key}>{number(row.values[key].value)}{row.values[key].value != null && row.values[key].partial && <small> · جزئي</small>}</td>)}
                <td>{score?.points != null ? `${number(score.points)} / ${number(score.weight)}${score.incomplete ? ' · جزئي' : ''}` : 'غير متاح'}</td>
                <td><button className={button} aria-expanded={selected === row.id} onClick={event => { openedFrom.current = event.currentTarget; setSelected(row.id); }}>عرض الصفوف ({row.events.length})</button></td></tr>;
            })}</tbody></table></ScrollableTable>
          {!visible.length && <p>لا توجد نتائج للبحث.</p>}
        </Card>
        {selectedRow && <section ref={detailRef} tabIndex={-1} className="qv-details" aria-label="تفاصيل البايكر"><Card className="qv-panel"><SectionHeader title={`تفاصيل ${selectedRow.name}`} action={<button className={button} onClick={() => { setSelected(null); openedFrom.current?.focus(); }}>إغلاق التفاصيل</button>} />
          {!selectedRow.events.length ? <p>ما وصلت تفاصيل سويتر لهذا البايكر في الشهر.</p> : <>
            {(read.objections.loading || read.objections.error) && <p role="alert">{read.objections.loading ? 'جارٍ قراءة متابعة الاعتراضات…' : 'تعذّرت قراءة متابعة الاعتراضات؛ الحفظ متوقف.'}</p>}
            <div className="qv-events">{selectedRow.events.toSorted((a, b) => `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`)).map(row => {
              const objection = read.objections.data?.find(o => o.metricKey === row.metricKey && o.sourceId === row.sourceId);
              return <EventRow key={`${month}:${row.metricKey}:${row.sourceId}:${objection?.revision || 0}`} row={row} month={month} today={today} objection={objection}
                deadlineDays={read.settings.error || read.settings.loading ? null : read.settings.data?.deadlineDays} disabled={Boolean(read.objections.error || read.objections.loading)} save={read.save} />;
            })}</div></>}
        </Card></section>}
      </>}
    </main></>;
}
function DeadlineSetting({ settings, save }) {
  const [value, setValue] = useState(settings?.deadlineDays ?? ''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <form className="qv-toolbar" onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage('');
    try { await save({ deadlineDays: value === '' ? null : Number(value), expectedRevision: settings?.revision || 0 }); setMessage('حُفظت المهلة.'); }
    catch (error) { setMessage(error.message || 'تعذّر حفظ المهلة.'); } finally { setBusy(false); }
  }}><label>المهلة بالأيام (تحددها أنت)<input type="number" min="1" max="365" value={value} onChange={e => setValue(e.target.value)} /></label>
    <button className={button} disabled={busy}>حفظ المهلة</button><p role="status">{message || (settings?.deadlineDays == null ? 'المهلة غير محددة؛ لن نفترض موعدًا للاعتراض.' : `المهلة ${settings.deadlineDays} يومًا من تاريخ الواقعة.`)}</p>
    {settings?.updatedAtIso && <small>آخر تعديل: {settings.updatedByName} · {stamp(settings.updatedAtIso)}</small>}</form>;
}
function EventRow({ row, objection, month, today, deadlineDays, disabled, save }) {
  const [status, setStatus] = useState(objection?.status || 'unseen'), [note, setNote] = useState(objection?.note || '');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const deadline = objectionDeadline(row, deadlineDays, today, objection?.status);
  return <article className={`qv-event qv-tone-${deadline?.tone || ''}`}><h3>{COMPENSATION_LABELS[row.metricKey]} · الحجز <bdi>{row.bookingId || 'غير متاح'}</bdi></h3>
    <p>التاريخ: <bdi>{row.date || 'غير متاح'}</bdi> · الوقت: <bdi>{row.time || 'غير متاح'}</bdi> (الرياض)</p><p>السبب: {row.reason || 'غير متاح من المصدر'}</p>
    <p>العدد: {row.quantity} · المبلغ: {number(row.amount)} ر.س · <a href={row.sourceUrl} target="_blank" rel="noreferrer">عرض المصدر</a></p>
    {deadline && <p>آخر يوم للاعتراض: <bdi>{deadline.dueDate}</bdi> · {deadline.days < 0 ? `انتهت المهلة منذ ${-deadline.days} يوم` : `باقي ${deadline.days} يوم`}</p>}
    {objection && objection.snapshotId !== row.snapshotId && <p className="qv-warning">وصلت قراءة أحدث. راجع بيانات الصف قبل تحديث المتابعة.</p>}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try {
      await save({ periodKey: month, metricKey: row.metricKey, sourceId: row.sourceId, snapshotId: row.snapshotId, expectedRevision: objection?.revision || 0, status, note }); setMessage('حُفظت المتابعة الداخلية.');
    } catch (error) { setMessage(error.message || 'تعذّر حفظ المتابعة.'); } finally { setBusy(false); } }}>
      <label>حالة الاعتراض<select value={status} onChange={e => setStatus(e.target.value)}>{OBJECTION_STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>ملاحظة<textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className={button} disabled={disabled || busy}>حفظ المتابعة</button><p role="status">{message}</p>
    </form>{objection?.updatedAtIso && <small>آخر تعديل: {objection.updatedByName} · {stamp(objection.updatedAtIso)}</small>}
  </article>;
}
