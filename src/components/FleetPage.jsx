import { useMemo, useRef, useState } from 'react';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useFleet } from '../hooks/useFleet';
import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { useIdleBikersData } from '../hooks/useIdleBikersData';
import { riyadhToday } from '../lib/bikerProfile';
import { displayBikerName } from '../lib/bikerNames';
import { FLEET_STATUSES, CLAIM_STATUSES, fleetSummary, fleetInventorySummary, fleetPolicy, parseFleetCsv, FLEET_CSV_COLUMNS } from '../lib/fleet';
import TopBar from './TopBar';
import DateField from './DateField';
import { Card, SectionHeader } from './UI';
import ScrollableTable from './ScrollableTable';
import './FleetPage.css';
const emptyData = { bikes: [], assignments: [], maintenance: [], incidents: [], policies: [], bikers: [], startup: [] };
const tabs = [['bikes', 'الدبابات'], ['assignments', 'التسليم'], ['maintenance', 'الصيانة'], ['incidents', 'الحوادث'], ['policies', 'التأمين'], ['csv', 'تعبئة السجل']];
const money = value => value == null ? 'غير مسجلة' : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} ر.س`;
const button = 'sw-button sw-button--secondary sw-button--sm';
const fields = {
  bike: [['internalNumber', 'الرقم الداخلي', 'text'], ['plate', 'رقم اللوحة', 'text'], ['model', 'الموديل', 'text'], ['purchasedOn', 'تاريخ الشراء', 'date'], ['startupItemId', 'بند التأسيس', 'startup'], ['status', 'الحالة', 'status'], ['statusSince', 'الحالة من تاريخ', 'date'], ['policyId', 'وثيقة خاصة بالدباب (اختياري)', 'policy']],
  policy: [['number', 'رقم الوثيقة', 'text'], ['company', 'شركة التأمين', 'text'], ['startsOn', 'بداية التأمين (لو معروفة)', 'date'], ['expiresOn', 'تاريخ انتهاء التأمين', 'date'], ['wholeFleet', 'تشمل الأسطول كاملًا', 'checkbox']],
  receive: [['bikeId', 'الدباب', 'bike'], ['bikerId', 'البايكر المستلم', 'biker'], ['receivedOn', 'تاريخ التسليم', 'date'], ['note', 'ملاحظة التسليم', 'textarea']],
  return: [['returnedOn', 'تاريخ الإرجاع', 'date'], ['note', 'ملاحظة الإرجاع', 'textarea']],
  maintenance: [['bikeId', 'الدباب', 'bike'], ['startedOn', 'تاريخ دخول الصيانة', 'date'], ['endedOn', 'تاريخ الخروج (اتركه فارغًا للصيانة المفتوحة)', 'date'], ['description', 'وصف الصيانة', 'textarea'], ['cost', 'تكلفة الصيانة', 'money'], ['expenseUrl', 'رابط مستند المصروف (لو موجود)', 'text']],
  incident: [['bikeId', 'الدباب', 'bike'], ['bikerId', 'بايكر الحادث (لو معروف)', 'biker'], ['happenedOn', 'تاريخ الحادث', 'date'], ['bookingId', 'رقم الحجز (لو موجود)', 'text'], ['description', 'وصف الحادث', 'textarea'], ['cost', 'تكلفة الحادث', 'money'], ['claimStatus', 'مطالبة التأمين وحالتها', 'claim'], ['claimNote', 'ملاحظة المطالبة', 'textarea']],
};
const defaults = kind => Object.fromEntries(fields[kind].map(([key, , type]) => [key, type === 'checkbox' ? false : '']));
export default function FleetPage() {
  const { role, isPartnerView } = usePartnerView();
  if (isPartnerView || !['admin', 'accountant'].includes(role)) return null;
  return <FleetContent />;
}
export function FleetContent() {
  const read = useFleet(), data = read.data || emptyData, today = riyadhToday();
  const [tab, setTab] = useState('bikes'), [search, setSearch] = useState(''), [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState({}), [drafts, setDrafts] = useState({}), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const flight = useRef(false);
  const tabButtons = useRef([]), formRefs = useRef({});
  const summary = useMemo(() => fleetSummary({ ...data, today }), [data, today]);
  const inventory = useMemo(() => fleetInventorySummary(data), [data]);
  const bikeName = id => data.bikes.find(b => b.id === id)?.internalNumber || 'دباب غير موجود في السجل';
  const bikerName = (id, saved = '') => { const biker = data.bikers.find(b => b.id === id); return biker ? displayBikerName(biker) : saved || (id ? 'بايكر غير موجود في القائمة' : 'غير معروف'); };
  const selectEdit = (kind, row) => { setEditing(old => ({ ...old, [kind]: row?.id || null })); setMessage('');
    if (row) requestAnimationFrame(() => { formRefs.current[kind]?.focus(); formRefs.current[kind]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }); };
  const recordFor = kind => ({ bike: data.bikes, policy: data.policies, return: data.assignments, maintenance: data.maintenance, incident: data.incidents }[kind] || []).find(row => row.id === editing[kind]) || null;
  const editor = (kind, title) => {
    const record = recordFor(kind), key = `${kind}:${record?.id || 'new'}`;
    const fresh = { ...defaults(kind), ...Object.fromEntries(fields[kind].map(([field]) => [field, record?.[field] ?? defaults(kind)[field]])) };
    const draft = drafts[key] || { data: fresh, expectedRevision: record?.revision || 0, requestId: record?.id || null };
    return read.canEdit && <FleetForm key={key} kind={kind} title={title} data={data} record={record} draft={draft} busy={busy} formRef={element => { formRefs.current[kind] = element; }}
      stale={draft.expectedRevision !== (record?.revision || 0)} onChange={(field, value) => setDrafts(old => ({ ...old, [key]: { ...draft, requestId: draft.requestId || (kind === 'bike' ? null : crypto.randomUUID()), data: { ...draft.data, [field]: value } } }))}
      reset={() => { setDrafts(old => { const next = { ...old }; delete next[key]; return next; }); selectEdit(kind, null); }}
      save={async () => {
        if (flight.current) return; flight.current = true; setBusy(true); setMessage('');
        try {
          const values = Object.fromEntries(fields[kind].map(([field, , type]) => [field, type === 'money' ? draft.data[field] === '' || draft.data[field] === null ? null : Number(draft.data[field]) : draft.data[field]]));
          await read.save({ kind, id: draft.requestId || record?.id || undefined, expectedRevision: draft.expectedRevision, data: values });
          setDrafts(old => { const next = { ...old }; delete next[key]; return next; }); selectEdit(kind, null); setMessage('حُفظ سجل الأسطول.');
        } catch (error) { setMessage(error.message || 'تعذّر حفظ سجل الأسطول.'); } finally { flight.current = false; setBusy(false); }
      }} />;
  };
  const filtered = data.bikes.filter(b => `${b.internalNumber} ${b.plate} ${b.model} ${bikerName(b.currentBikerId)}`.toLowerCase().includes(search.toLowerCase()));
  const selectedBike = data.bikes.find(b => b.id === selected);
  return <><TopBar title="الأسطول" subtitle="الدبابات والتسليم والصيانة والتأمين" /><main className="fleet-page" dir="rtl">
    <div className="fleet-toolbar"><div><h2>سجل الأسطول</h2><p>سجل تشغيلي مستقل؛ لا يغيّر الأصول الثابتة أو القيود.</p></div><button className={button} onClick={read.refetch} disabled={busy}>تحديث البيانات</button></div>
    {read.loading ? <p role="status">جارٍ قراءة الأسطول…</p> : read.error || !read.data ? <p role="alert">تعذّرت قراءة الأسطول؛ الأعداد غير مؤكدة. أعد المحاولة.</p> : <>
      <div className="fleet-metrics">{[['الدبابات المسجلة', inventory.registered], ['متاحة بدون بايكر', data.bikes.length ? summary.available.length : 'غير معروف'], ['في صيانة مفتوحة', inventory.maintenance]].map(([title, value]) => <Card className="fleet-panel" key={title}><h3>{title}</h3><strong>{value}</strong></Card>)}</div>
      {!data.bikes.length && <Card className="fleet-panel"><h3>ما تسجلت بيانات الدبابات بعد</h3><p>بند التأسيس يسجل 50 دبابًا. هذا لا يحدد لوحاتها أو مستلميها؛ أدخل البيانات الفعلية أولًا.</p><button className={button} onClick={() => setTab('csv')}>طريقة تعبئة الدبابات الخمسين</button></Card>}
      <Card className="fleet-panel"><SectionHeader title="تنبيهات الأسطول" /><ul className="fleet-alerts">
        {summary.available.length > 0 && <FleetIdleAlert available={summary.available.length} today={today} />}
        {summary.insuranceAlerts.map(({ policy, days }) => <li className={days < 0 ? 'fleet-danger' : 'fleet-warning'} key={policy.id}>وثيقة {policy.number} · {policy.company}: {days < 0 ? `انتهت منذ ${-days} يوم` : `تنتهي خلال ${days} يوم`} · <bdi>{policy.expiresOn}</bdi></li>)}
        {summary.longMaintenance.map(({ bike, days, since }) => <li className="fleet-warning" key={bike.id}>الدباب {bike.internalNumber} في الصيانة منذ {days} يوم · <bdi>{since}</bdi></li>)}
        {!summary.insuranceAlerts.length && !summary.longMaintenance.length && !summary.available.length && <li>{data.bikes.length ? 'ما فيه تنبيه من البيانات المسجلة.' : 'تكتمل التنبيهات بعد إدخال الدبابات والتأمين.'}</li>}
      </ul></Card>
      <div className="fleet-tabs" role="tablist" aria-label="أقسام الأسطول">{tabs.map(([key, label], index) => <button key={key} id={`fleet-tab-${key}`} ref={element => { tabButtons.current[index] = element; }} role="tab" aria-selected={tab === key} aria-controls={`fleet-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={button} onClick={() => setTab(key)} onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? (index + 1) % tabs.length : event.key === 'ArrowRight' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next !== null) { event.preventDefault(); setTab(tabs[next][0]); tabButtons.current[next]?.focus(); }
      }}>{label}</button>)}</div>
      {message && <p role="status" className="fleet-message">{message}</p>}
      <section hidden={tab !== 'bikes'} role="tabpanel" id="fleet-panel-bikes" aria-labelledby="fleet-tab-bikes"><Card className="fleet-panel"><SectionHeader title="سجل الدبابات" />
        <label>بحث بالرقم أو اللوحة أو البايكر<input value={search} onChange={e => setSearch(e.target.value)} /></label>
        <FleetTable headings={['الرقم الداخلي', 'اللوحة والموديل', 'الشراء والتأسيس', 'الحالة', 'البايكر الحالي', 'التأمين', 'المتابعة']}>
          {filtered.map(bike => { const policy = fleetPolicy(bike, data.policies, today), repair = data.maintenance.some(m => m.bikeId === bike.id && !m.endedOn); return <tr key={bike.id}><th>{bike.internalNumber}</th><td>{bike.plate || 'غير مسجلة'}<small>{bike.model || 'الموديل غير مسجل'}</small></td><td><bdi>{bike.purchasedOn || 'غير مسجل'}</bdi>{bike.startupItemId && <small><a href={`?page=startup&fleetItem=${encodeURIComponent(bike.startupItemId)}`}>بند التأسيس</a></small>}</td><td>{repair ? 'صيانة مفتوحة' : FLEET_STATUSES.find(([key]) => key === bike.status)?.[1]}<small>{bike.statusSince || ''}</small></td><td>{bike.currentBikerId ? bikerName(bike.currentBikerId) : 'بدون بايكر'}</td><td>{policy ? <>{policy.number}<small>{policy.company} · {policy.expiresOn}</small></> : 'غير مسجل'}</td><td><button className={button} onClick={() => setSelected(selected === bike.id ? null : bike.id)}>حركة الدباب</button>{read.canEdit && <button className={button} onClick={() => selectEdit('bike', bike)}>تعديل الدباب</button>}</td></tr>; })}
        </FleetTable>{!filtered.length && <p>لا توجد دبابات مطابقة.</p>}
        {selectedBike && <div className="fleet-history"><h3>حركة الدباب {selectedBike.internalNumber}</h3><h4>التسليم</h4>{data.assignments.filter(a => a.bikeId === selected).map(a => <p key={a.id}>{bikerName(a.bikerId, a.bikerName)} · {a.receivedOn} ← {a.returnedOn || 'ما رجع بعد'}</p>)}<h4>الصيانة</h4>{data.maintenance.filter(m => m.bikeId === selected).map(m => <p key={m.id}>{m.startedOn} · {m.description} · {money(m.cost)}</p>)}<h4>الحوادث</h4>{data.incidents.filter(i => i.bikeId === selected).map(i => <p key={i.id}>{i.happenedOn} · {bikerName(i.bikerId, i.bikerName)} · {i.description} · {money(i.cost)}</p>)}<RecordHistory record={selectedBike} /></div>}
      </Card>{editor('bike', editing.bike ? 'تعديل بيانات الدباب' : 'إضافة دباب فعلي')}</section>
      <section hidden={tab !== 'assignments'} role="tabpanel" id="fleet-panel-assignments" aria-labelledby="fleet-tab-assignments"><Card className="fleet-panel"><SectionHeader title="سجل التسليم والإرجاع" subtitle="السجل يبقى محفوظًا بعد تغيير المستلم؛ أرجع الدباب قبل تسليمه لبايكر آخر." /><FleetTable headings={['الدباب', 'البايكر', 'استلم في', 'رجع في', 'الملاحظة', 'الإرجاع']}>
        {data.assignments.toSorted((a,b) => b.receivedOn.localeCompare(a.receivedOn)).map(row => <tr key={row.id}><th>{bikeName(row.bikeId)}</th><td>{bikerName(row.bikerId, row.bikerName)}</td><td>{row.receivedOn}</td><td>{row.returnedOn || 'عند البايكر'}</td><td>{row.note}<RecordHistory record={row} /></td><td>{!row.returnedOn && read.canEdit && <button className={button} onClick={() => selectEdit('return', row)}>تسجيل الإرجاع</button>}</td></tr>)}
      </FleetTable>{!data.assignments.length && <p>ما فيه تسليم مسجل.</p>}</Card>{editing.return && editor('return', 'تسجيل إرجاع الدباب')}{editor('receive', 'تسليم دباب لبايكر')}</section>
      <section hidden={tab !== 'maintenance'} role="tabpanel" id="fleet-panel-maintenance" aria-labelledby="fleet-tab-maintenance"><Card className="fleet-panel"><SectionHeader title="الصيانة" subtitle="التكلفة هنا للمتابعة فقط؛ لا تُسجّل مصروفًا تلقائيًا." /><FleetTable headings={['الدباب', 'الدخول والخروج', 'الوصف', 'التكلفة', 'المستند', 'المتابعة']}>
        {data.maintenance.toSorted((a,b) => b.startedOn.localeCompare(a.startedOn)).map(row => <tr key={row.id}><th>{bikeName(row.bikeId)}</th><td>{row.startedOn}<small>{row.endedOn || 'صيانة مفتوحة'}</small></td><td>{row.description}</td><td>{money(row.cost)}</td><td>{row.expenseUrl ? <a href={row.expenseUrl}>مستند المصروف</a> : 'غير مربوط'}</td><td>{read.canEdit && <button className={button} onClick={() => selectEdit('maintenance', row)}>تعديل / إغلاق الصيانة</button>}<RecordHistory record={row} /></td></tr>)}
      </FleetTable>{!data.maintenance.length && <p>ما فيه صيانة مسجلة.</p>}</Card>{editor('maintenance', editing.maintenance ? 'تحديث الصيانة' : 'إضافة صيانة')}</section>
      <section hidden={tab !== 'incidents'} role="tabpanel" id="fleet-panel-incidents" aria-labelledby="fleet-tab-incidents"><Card className="fleet-panel"><SectionHeader title="الحوادث ومطالبات التأمين" subtitle="سجل متابعة فقط؛ لا ينشئ قيدًا أو تسوية أو مطالبة لدى شركة التأمين." /><FleetTable headings={['الدباب', 'التاريخ', 'البايكر', 'الحجز والوصف', 'التكلفة', 'المطالبة', 'المتابعة']}>
        {data.incidents.toSorted((a,b) => b.happenedOn.localeCompare(a.happenedOn)).map(row => <tr key={row.id}><th>{bikeName(row.bikeId)}</th><td>{row.happenedOn}</td><td>{bikerName(row.bikerId, row.bikerName)}</td><td>{row.bookingId || 'الحجز غير مسجل'}<small>{row.description}</small></td><td>{money(row.cost)}</td><td>{CLAIM_STATUSES.find(([key]) => key === row.claimStatus)?.[1]}<small>{row.claimNote}</small></td><td>{read.canEdit && <button className={button} onClick={() => selectEdit('incident', row)}>تحديث الحادث والمطالبة</button>}<RecordHistory record={row} /></td></tr>)}
      </FleetTable>{!data.incidents.length && <p>ما فيه حوادث مسجلة.</p>}</Card>{editor('incident', editing.incident ? 'تحديث الحادث' : 'إضافة حادث')}</section>
      <section hidden={tab !== 'policies'} role="tabpanel" id="fleet-panel-policies" aria-labelledby="fleet-tab-policies"><Card className="fleet-panel"><SectionHeader title="التأمين" subtitle="الوثيقة العامة تشمل الأسطول؛ ويمكن ربط وثيقة خاصة من بيانات الدباب." /><FleetTable headings={['الوثيقة', 'الشركة', 'البداية', 'الانتهاء', 'التغطية', 'المتابعة']}>
        {data.policies.map(row => <tr key={row.id}><th>{row.number}</th><td>{row.company}</td><td>{row.startsOn || 'غير مسجلة'}</td><td>{row.expiresOn}</td><td>{row.wholeFleet ? 'الأسطول كاملًا' : `${data.bikes.filter(b => b.policyId === row.id).length} دباب مربوط`}</td><td>{read.canEdit && <button className={button} onClick={() => selectEdit('policy', row)}>تعديل الوثيقة</button>}<RecordHistory record={row} /></td></tr>)}
      </FleetTable>{!data.policies.length && <p>ما فيه وثائق تأمين مسجلة.</p>}</Card>{editor('policy', editing.policy ? 'تعديل وثيقة التأمين' : 'إضافة وثيقة تأمين')}</section>
      <section hidden={tab !== 'csv'} role="tabpanel" id="fleet-panel-csv" aria-labelledby="fleet-tab-csv"><FleetCsv data={data} read={read} disabled={busy} /></section>
    </>}
  </main></>;
}
function FleetTable({ headings, children }) { return <ScrollableTable className="overflow-x-auto"><table className="fleet-table"><thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></ScrollableTable>; }
function RecordHistory({ record }) { return record?.history?.length ? <details><summary>سجل التعديلات ({record.history.length})</summary>{record.history.map((h,i) => <p key={i}>{h.after.updatedByName || h.userId} · <bdi>{h.atIso}</bdi></p>)}</details> : null; }
function FleetForm({ kind, title, data, record, draft, busy, stale, onChange, reset, save, formRef }) {
  const choices = type => ({ status: FLEET_STATUSES, claim: CLAIM_STATUSES, bike: data.bikes.map(b => [b.id, `${b.internalNumber} · ${b.plate || 'بدون لوحة'}`]),
    biker: data.bikers.map(b => [b.id, displayBikerName(b)]), startup: data.startup.map(s => [s.id, s.item_name]), policy: data.policies.map(p => [p.id, `${p.number} · ${p.company}`]) }[type]);
  return <Card className="fleet-panel"><SectionHeader title={title} />{stale && <p role="alert">تغيّر السجل أثناء التعديل؛ أعد قراءة النموذج قبل الحفظ.</p>}<form ref={formRef} tabIndex={-1} aria-label={title} onSubmit={e => { e.preventDefault(); save(); }}><div className="fleet-fields">
    {fields[kind].map(([key, label, type]) => <label key={key}>{label}{type === 'date' ? <DateField id={`fleet-${kind}-${key}`} ariaLabel={label} value={draft.data[key] || ''} disabled={busy} onChange={e => onChange(key, e.target.value)} />
      : type === 'checkbox' ? <input type="checkbox" checked={draft.data[key]} disabled={busy} onChange={e => onChange(key, e.target.checked)} />
        : type === 'textarea' ? <textarea value={draft.data[key]} maxLength={1000} disabled={busy} onChange={e => onChange(key, e.target.value)} />
          : choices(type) ? <select value={draft.data[key]} disabled={busy || key === 'bikeId' && Boolean(record)} onChange={e => onChange(key, e.target.value)}><option value="">اختر أو اتركه غير محدد</option>{choices(type).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select>
            : <input type={type === 'money' ? 'number' : 'text'} min={type === 'money' ? 0 : undefined} step={type === 'money' ? '0.01' : undefined} maxLength={type === 'text' ? 2000 : undefined} value={draft.data[key] ?? ''} disabled={busy || key === 'internalNumber' && Boolean(record)} onChange={e => onChange(key, e.target.value)} />}</label>)}
    </div><p className="fleet-note">اترك البيانات غير المعروفة فارغة. الحالة والتواريخ المطلوبة تُراجع قبل الحفظ.</p><div className="fleet-toolbar"><button className="sw-button sw-button--primary sw-button--sm" disabled={busy || stale}>حفظ {title}</button><button type="button" className={button} disabled={busy} onClick={reset}>نموذج جديد / إعادة القراءة</button></div></form></Card>;
}
function FleetIdleAlert({ available, today }) {
  const month = today.slice(0, 7), dashboard = useOverviewDashboard(month, today);
  const idle = useIdleBikersData(dashboard, { periodKey: month, today });
  const count = idle.value?.rows.filter(row => row.reasonKey === 'no_bike').length;
  return <li className={count ? 'fleet-warning' : ''}>{idle.loading ? 'جارٍ مطابقة المتاح مع الخاملين…' : idle.error || !idle.value ? 'الدبابات متاحة، لكن تعذّرت مطابقة الخاملين.' : count
    ? `${available} دباب متاح بدون بايكر، و${count} بايكر خامل بسبب «بدون دباب».` : 'لا يوجد بايكر خامل مسجل بسبب «بدون دباب» حسب مسير الشهر.'} <a href="?page=bikers&bikerTab=idle">فتح الخاملين</a></li>;
}
function FleetCsv({ data, read, disabled }) {
  const [preview, setPreview] = useState([]), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState([]);
  const lock = useRef(false);
  const template = () => { const blob = new Blob(['\uFEFF' + FLEET_CSV_COLUMNS.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'sweater-fleet-template.csv'; a.click(); URL.revokeObjectURL(url); };
  return <Card className="fleet-panel"><SectionHeader title="تعبئة الدبابات الخمسين" /><p>الأفضل ملف CSV من القائمة الفعلية للوحات. ارفعه، وراجع الصفوف، ثم احفظ السجلات التي تأكدت منها.</p><p>بديل: يقرأ وكيل العمليات صفحة Bikes في سويتر قراءة فقط، ويجهز الملف نفسه للمراجعة.</p><p>القالب فارغ عمدًا؛ لا ينشئ أرقام دبابات أو لوحات أو مستلمين من عنده.</p>
    <button className={button} onClick={template}>تحميل قالب CSV فارغ</button><details><summary>شرح أعمدة الملف</summary><p>internalNumber الرقم الداخلي الحقيقي · plate اللوحة · model الموديل · purchasedOn تاريخ الشراء.</p><p>startupItemId معرّف بند التأسيس · status: working أو maintenance أو stopped أو missing.</p><p>statusSince تاريخ دخول الحالة؛ مطلوب للصيانة · policyId معرّف وثيقة خاصة بالدباب (اختياري).</p><p>التواريخ YYYY-MM-DD. لا تضع أسماء بايكرية هنا؛ سجل التسليم يحفظهم بتاريخ فعلي.</p><p>بند الدبابات: {data.startup.filter(s => /دباب|دراج|bike/i.test(s.item_name)).map(s => `${s.item_name}: ${s.id}`).join(' · ') || 'اختر البند الفعلي من قائمة التأسيس'}</p></details>
    <label>رفع ملف الدبابات<input type="file" accept=".csv,text/csv" disabled={busy || disabled} onChange={async e => { setError(''); setPreview([]); setDone([]); setConfirmed(false); const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 500000) throw Error('ملف CSV كبير أو غير صالح.'); setPreview(parseFleetCsv(await file.text(), data.bikes, { today: riyadhToday(), startupIds: data.startup.map(s => s.id), policyIds: data.policies.map(p => p.id) })); } catch (failure) { setError(failure.message); } }} /></label>
    {error && <p role="alert">{error}</p>}{preview.length > 0 && <><p>المعاينة: {preview.length} دباب · تم حفظ {done.length}</p><FleetTable headings={['الرقم', 'اللوحة', 'الموديل', 'تاريخ الشراء', 'الحالة']}>{preview.map(row => <tr key={row.internalNumber}><th>{row.internalNumber}</th><td>{row.plate || 'غير مسجلة'}</td><td>{row.model || 'غير مسجل'}</td><td>{row.purchasedOn || 'غير مسجل'}</td><td>{FLEET_STATUSES.find(([key]) => key === row.status)?.[1]}</td></tr>)}</FleetTable>
      {read.canEdit && <><label className="fleet-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />راجعت {preview.length} صفًا من البيانات الفعلية، وأوافق على إضافتها للسجل.</label>
        <button className="sw-button sw-button--primary sw-button--sm" disabled={busy || disabled || !confirmed || done.length === preview.length} onClick={async () => {
          if (lock.current) return; lock.current = true; setBusy(true); setError('');
          try { for (const row of preview) { if (done.includes(row.internalNumber)) continue; await read.save({ kind: 'bike', expectedRevision: 0, data: row }, { refresh: false }); setDone(old => [...old, row.internalNumber]); } }
          catch (failure) { setError(`${failure.message} · توقف الحفظ؛ السجلات المحفوظة لا تتكرر عند الاستكمال.`); }
          finally { await read.refetch(); lock.current = false; setBusy(false); }
        }}>حفظ الدبابات المراجَعة ({preview.length - done.length})</button></>}
    </>}
  </Card>;
}
