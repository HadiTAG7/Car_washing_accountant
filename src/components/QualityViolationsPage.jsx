import SweaterFreshnessBar from './SweaterFreshnessBar';
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
import { Card } from './UI';
import BikerDeductionFollowup from './BikerDeductionFollowup';
import './QualityViolationsPage.css';

const number = value => value == null ? 'غير متاح' : formatNumber(Math.round(value * 100) / 100);
const stamp = value => value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }) : 'غير متاح';
const button = 'sw-button sw-button--secondary sw-button--sm';
const typeLabels = { violations: 'مخالفات', damages: 'أضرار', compensations: 'تعويضات', freeWashCompensation: 'غسلات مجانية',
  cancelledByBiker: 'إلغاء البايكر', cancelledMaintenance: 'إلغاء الصيانة', cancelledByCustomer: 'إلغاء العميل' };
const eventKey = (month, row) => `${month}:${row.metricKey}:${row.sourceId}`;

export default function QualityViolationsPage() {
  const { role, isPartnerView } = usePartnerView();
  if (role !== 'admin' || isPartnerView) return null;
  return <QualityViolationsContent />;
}

export function QualityViolationsContent() {
  const today = riyadhToday(), [month, setMonth] = useState(today.slice(0, 7));
  const [activeType, setActiveType] = useState(COMPENSATION_KEYS[0]), [search, setSearch] = useState(''), [selected, setSelected] = useState(null);
  const [drafts, setDrafts] = useState({}), [deductionDirty, setDeductionDirty] = useState(false);
  const tabRefs = useRef({});
  const read = useQualityViolations(month);
  const loading = read.current.loading || read.workers.loading, error = read.current.error || read.workers.error;
  const snapshot = loading || error ? null : read.current.snapshot;
  const rows = useMemo(() => qualityBikerRows(snapshot, read.workers.bikers), [snapshot, read.workers.bikers]);
  const events = useMemo(() => rows.flatMap(biker => biker.events.map(row => ({ ...row, bikerLabel: biker.name, bikerRowId: biker.id })))
    .sort((a, b) => `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`)), [rows]);
  const quality = useOverviewBikerQuality(read.workers.bikers, month, true);
  const selectedRow = rows.find(row => row.id === selected);
  const draftCount = Object.keys(drafts).length + Number(deductionDirty);
  useEffect(() => {
    if (!draftCount) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftCount]);
  const updateDraft = (key, value) => setDrafts(previous => ({ ...previous, [key]: value }));
  const clearDraft = key => setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; });
  const protectLink = event => { if (draftCount && !window.confirm('عندك تغييرات غير محفوظة. تتركها وتكمل؟')) event.preventDefault(); };
  const chooseType = (key, focus = false) => { setActiveType(key); if (focus) tabRefs.current[key]?.focus(); };
  const matches = row => (!selected || row.bikerRowId === selected) && `${row.bikerLabel} ${row.driverExternalId || ''} ${row.bookingId || ''} ${row.date || ''} ${row.reason || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  return <><TopBar title="الجودة والمخالفات" subtitle="المشاكل حسب النوع، وتفاصيلها من المصدر المحفوظ" />
    <main className="qv-page" dir="rtl">
      <SweaterFreshnessBar />
      <div className="qv-toolbar"><div><h2>الجودة والمخالفات</h2><p>من اللقطات المحفوظة · بدون اتصال مباشر بسويتر</p></div>
        <BikerProfileMonthPicker value={month} max={today.slice(0, 7)} language="ar" onChange={value => { setMonth(value); setSelected(null); }} />
        <button type="button" className={button} onClick={read.refresh}>تحديث البيانات</button>
      </div>
      <nav className="qv-links" aria-label="مسارات المراجعة">
        <a href="?page=compensation_review" onClick={protectLink}>مراجعة التكتات والاعتراضات</a>
        <a href={`?page=sweater_settlements&period=${month}#settlement-bookings`} onClick={protectLink}>تفاصيل إلغاء الحجوزات</a>
      </nav>
      {draftCount > 0 && <p role="note" className="qv-drafts">مسودات غير محفوظة: {draftCount}. تبقى أثناء تبديل التبويبات والبحث والشهر هنا؛ مغادرة الصفحة تفقدها.</p>}
      <label className="qv-search">بحث بالحجز أو البايكر أو السبب<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {selectedRow && <p role="status">فلتر البايكر: {selectedRow.name} <button type="button" className={button} onClick={() => setSelected(null)}>عرض كل البايكرز</button></p>}
      <div className="qv-tabs" role="tablist" aria-label="أنواع المشاكل">
        {COMPENSATION_KEYS.map(key => {
          const group = snapshot?.eventGroups?.[key];
          return <button type="button" role="tab" key={key} ref={element => { tabRefs.current[key] = element; }}
            id={`qv-tab-${key}`} aria-controls={`qv-panel-${key}`} aria-selected={activeType === key} tabIndex={activeType === key ? 0 : -1}
            onClick={() => chooseType(key)} onKeyDown={event => {
              const index = COMPENSATION_KEYS.indexOf(key), offset = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
              const next = event.key === 'Home' ? COMPENSATION_KEYS[0] : event.key === 'End' ? COMPENSATION_KEYS.at(-1)
                : offset ? COMPENSATION_KEYS[(index + offset + COMPENSATION_KEYS.length) % COMPENSATION_KEYS.length] : null;
              if (next) { event.preventDefault(); chooseType(next, true); }
            }}><span>{typeLabels[key]}</span><small>{group ? `${number(group.rows.length)}${group.complete ? '' : ' · جزئي'}` : 'غير متاح'}</small></button>;
        })}
      </div>
      <p className="qv-note">الأعداد على التبويبات للصفوف المستلمة فقط؛ لا تثبت اكتمال تفاصيل الشهر.</p>
      {loading ? <p role="status">جارٍ قراءة اللقطات…</p> : error ? <p role="alert">تعذّرت قراءة التفاصيل. أعد المحاولة.</p> : COMPENSATION_KEYS.map(key => {
        const group = snapshot?.eventGroups?.[key], own = events.filter(row => row.metricKey === key), shown = own.filter(matches);
        return <section key={key} role="tabpanel" id={`qv-panel-${key}`} aria-labelledby={`qv-tab-${key}`} hidden={activeType !== key}>
          <TypeSummary metricKey={key} snapshot={snapshot} previous={read.previous} month={month} />
          {!group ? <p className="qv-note">ما وصلت تفاصيل سويتر لهذا النوع؛ المجاميع وحدها لا تحدد الحجز أو البايكر.</p>
            : <><p className="qv-note">نتائج البحث: {shown.length} من {own.length} صف مستلم.</p>
              {!own.length ? <p>{group.complete ? 'لا حالات في التفاصيل المكتملة لهذا النوع.' : 'لا صفوف مستلمة بعد؛ التفاصيل جزئية وليست صفر حالات.'}</p>
                : !shown.length && <p>لا توجد نتائج للبحث.</p>}
              {(read.objections.loading || read.objections.error) && <p role="alert">{read.objections.loading ? 'جارٍ قراءة متابعة الاعتراضات…' : 'تعذّرت قراءة متابعة الاعتراضات؛ الحفظ متوقف.'}</p>}
              <div className="qv-events">{own.map(row => {
                const key = eventKey(month, row), objection = read.objections.data?.find(o => o.metricKey === row.metricKey && o.sourceId === row.sourceId);
                return <div key={key} hidden={!matches(row)}><EventRow row={row} month={month} today={today} objection={objection}
                  draft={drafts[key]} updateDraft={value => updateDraft(key, value)} clearDraft={() => clearDraft(key)}
                  deadlineDays={read.settings.error || read.settings.loading ? null : read.settings.data?.deadlineDays}
                  disabled={Boolean(read.objections.error || read.objections.loading)} save={read.save} /></div>;
              })}</div>
            </>}
        </section>;
      })}
      <details className="qv-secondary"><summary>حسب البايكر</summary><Card className="qv-panel">
        <p>الأرقام الجزئية هي الصفوف المستلمة فقط. عدم توفر الإسناد لا يعني صفر مخالفات.</p>
        <ScrollableTable className="overflow-x-auto"><table className="qv-table"><thead><tr>{['البايكر', 'رقم سويتر', 'المخالفات (ر.س)', 'الغسلات المجانية', 'إلغاء البايكر', 'الأضرار والحوادث (ر.س)', 'نقاط الجودة من البروفايل', 'التفاصيل'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => {
            const result = quality.available ? quality.data?.find(r => r.bikerUID === row.biker?.id && !r.failed) : null;
            const score = result?.data?.reports ? bikerQualitySummary(result.data.reports, row.biker?.id, month, today, result.data.manual) : null;
            return <tr key={row.id}><th>{row.name}</th><td><bdi>{row.externalId || 'غير مربوط بسويتر'}</bdi></td>
              {['violations', 'freeWashCompensation', 'cancelledByBiker', 'damages'].map(key => <td key={key}>{number(row.values[key].value)}{row.values[key].value != null && row.values[key].partial && <small> · جزئي</small>}</td>)}
              <td>{score?.points != null ? `${number(score.points)} / ${number(score.weight)}${score.incomplete ? ' · جزئي' : ''}` : 'غير متاح'}</td>
              <td><button type="button" className={button} onClick={() => { setSelected(row.id); chooseType(row.events[0]?.metricKey || activeType, true); tabRefs.current[row.events[0]?.metricKey || activeType]?.scrollIntoView?.({ block: 'nearest' }); }}>عرض الصفوف ({row.events.length})</button></td></tr>;
          })}</tbody></table></ScrollableTable>
      </Card></details>
      <details className="qv-secondary"><summary>إسناد خصومات البايكر — أدوات المتابعة الداخلية</summary>
        <BikerDeductionFollowup records={read.deductions} periodKey={month} loading={read.objections.loading} readError={read.objections.error}
          preview={read.previewDeduction} save={read.saveDeduction} disabled={Boolean(read.objections.loading || read.objections.error)} onDraftChange={setDeductionDirty} />
      </details>
      <details className="qv-secondary"><summary>مهلة الاعتراض</summary><Card className="qv-panel">
        <p>متابعة داخلية فقط؛ تغيير الحالة هنا لا يرسل اعتراضًا إلى سويتر.</p>
        {read.settings.loading ? <p>جارٍ قراءة المهلة…</p> : read.settings.error ? <p role="alert">تعذّرت قراءة المهلة؛ لا يمكن تحديد قرب انتهائها.</p>
          : <DeadlineSetting settings={read.settings.data} save={read.saveSettings} draft={drafts.deadline} updateDraft={value => updateDraft('deadline', value)} clearDraft={() => clearDraft('deadline')} />}
      </Card></details>
    </main></>;
}

function TypeSummary({ metricKey: key, snapshot, previous, month }) {
  const group = snapshot?.eventGroups?.[key], value = snapshot?.metrics?.[key], money = SWEATER_METRICS[key].unit === 'sar';
  const count = money ? group?.totalRows ?? null : value ?? null, amount = groupAmount(group, value, key);
  const oldSnapshot = previous.error || previous.loading ? null : previous.snapshot;
  const oldGroup = oldSnapshot?.eventGroups?.[key], oldValue = oldSnapshot?.metrics?.[key];
  const oldCount = money ? oldGroup?.totalRows ?? null : oldValue ?? null, oldAmount = groupAmount(oldGroup, oldValue, key);
  return <Card className="qv-panel qv-type-summary"><h2>{typeLabels[key]} · {month}</h2>
    <div className="qv-type-totals"><p>العدد حسب المصدر: <strong>{number(count)} <small>{key === 'freeWashCompensation' ? 'غسلة' : 'واقعة'}</small></strong></p><p>المبلغ: <strong>{number(amount)} ر.س</strong></p></div>
    <small>عن الشهر السابق: العدد {count != null && oldCount != null ? number(count - oldCount) : 'غير متاح'} · المبلغ {amount != null && oldAmount != null ? `${number(amount - oldAmount)} ر.س` : 'غير متاح'}</small>
    <p className="qv-note">{!group ? 'ما وصلت تفاصيل سويتر' : `${group.rows.length} صف مستلم${group.totalRows != null ? ` من ${group.totalRows}` : ''} · ${group.complete ? 'الجدول مكتمل حسب المصدر' : 'تفاصيل جزئية'}`}</p>
    <small>قراءة المصدر: {stamp(snapshot?.metricSources?.[key]?.extractedAtIso)} (الرياض)</small>
  </Card>;
}

function DeadlineSetting({ settings, save, draft, updateDraft, clearDraft }) {
  const value = draft ? draft.value : settings?.deadlineDays ?? '';
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <form className="qv-toolbar" onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage('');
    try { await save({ deadlineDays: value === '' ? null : Number(value), expectedRevision: draft?.expectedRevision ?? settings?.revision ?? 0 }); clearDraft(); setMessage('حُفظت المهلة.'); }
    catch (error) { setMessage(error.message || 'تعذّر حفظ المهلة.'); } finally { setBusy(false); }
  }}><label>المهلة بالأيام (تحددها أنت)<input type="number" min="1" max="365" value={value} onChange={e => updateDraft({ value: e.target.value, expectedRevision: draft?.expectedRevision ?? settings?.revision ?? 0 })} /></label>
    <button className={button} disabled={busy}>حفظ المهلة</button><p role="status">{message || (settings?.deadlineDays == null ? 'المهلة غير محددة؛ لن نفترض موعدًا للاعتراض.' : `المهلة ${settings.deadlineDays} يومًا من تاريخ الواقعة.`)}</p>
    {settings?.updatedAtIso && <small>آخر تعديل: {settings.updatedByName} · {stamp(settings.updatedAtIso)}</small>}</form>;
}

function EventRow({ row, objection, month, today, deadlineDays, disabled, save, draft, updateDraft, clearDraft }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const detailsRef = useRef(null);
  const status = draft?.status ?? objection?.status ?? 'unseen', note = draft?.note ?? objection?.note ?? '';
  const edit = patch => updateDraft({ status, note, expectedRevision: objection?.revision || 0, snapshotId: row.snapshotId, ...draft, ...patch });
  const deadline = objectionDeadline(row, deadlineDays, today, objection?.status);
  return <details ref={detailsRef} className={`qv-event qv-tone-${deadline?.tone || ''}`}>
    <summary><strong>الحجز <bdi>{row.bookingId || 'غير متاح'}</bdi></strong><span>{row.bikerLabel} · <bdi>{row.date || 'غير متاح'}</bdi></span>
      <span>{row.reason || 'غير متاح من المصدر'}</span><span>العدد: {number(row.quantity)} · المبلغ: {number(row.amount)} ر.س</span></summary>
    <h3>{COMPENSATION_LABELS[row.metricKey]}</h3>
    <p>البايكر: {row.bikerLabel} · رقم سويتر: <bdi>{row.driverExternalId || 'غير متاح'}</bdi></p>
    <p>التاريخ: <bdi>{row.date || 'غير متاح'}</bdi> · الوقت: <bdi>{row.time || 'غير متاح'}</bdi> (الرياض)</p><p>السبب: {row.reason || 'غير متاح من المصدر'}</p>
    <p>العدد: {row.quantity} · المبلغ: {number(row.amount)} ر.س · <a href={row.sourceUrl} target="_blank" rel="noreferrer">عرض المصدر</a></p>
    {deadline && <p>آخر يوم للاعتراض: <bdi>{deadline.dueDate}</bdi> · {deadline.days < 0 ? `انتهت المهلة منذ ${-deadline.days} يوم` : `باقي ${deadline.days} يوم`}</p>}
    {(objection && objection.snapshotId !== row.snapshotId || draft && draft.snapshotId !== row.snapshotId) && <p className="qv-warning">وصلت قراءة أحدث. راجع بيانات الصف قبل تحديث المتابعة.</p>}
    <p className="qv-note">متابعة داخلية فقط؛ الحفظ هنا لا يرسل اعتراضًا إلى سويتر.</p>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try {
      await save({ periodKey: month, metricKey: row.metricKey, sourceId: row.sourceId, snapshotId: draft?.snapshotId ?? row.snapshotId,
        expectedRevision: draft?.expectedRevision ?? objection?.revision ?? 0, status, note }); clearDraft(); setMessage('حُفظت المتابعة الداخلية.');
    } catch (error) { setMessage(error.message || 'تعذّر حفظ المتابعة.'); } finally { setBusy(false); } }}>
      <label>حالة المتابعة الداخلية<select value={status} onChange={e => edit({ status: e.target.value })}>{OBJECTION_STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>ملاحظة<textarea maxLength={1000} value={note} onChange={e => edit({ note: e.target.value })} /></label>
      <button className={button} disabled={disabled || busy}>حفظ المتابعة</button>
      {draft && <button type="button" className={button} disabled={busy} onClick={clearDraft}>إلغاء التعديلات</button>}
      <p role="status">{message}</p>
    </form>{objection?.updatedAtIso && <small>آخر تعديل: {objection.updatedByName} · {stamp(objection.updatedAtIso)}</small>}
    <button type="button" className={button} onClick={() => { detailsRef.current.open = false; detailsRef.current.querySelector('summary')?.focus(); }}>إغلاق التفاصيل</button>
  </details>;
}
