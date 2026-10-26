import { useContext, useMemo, useState } from 'react';
import { FileText, Archive, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import DateField from './DateField';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { OPERATIONS_KINDS, OPERATIONS_STATUSES, OPERATIONS_STAGES, OPERATIONS_STATES, parseOperationsReport } from '../lib/operationsReportContract';
import { LanguageContext } from '../i18n/LanguageContext';
import OperationsReportPublisher from './OperationsReportPublisher';
import './FinanceWorkspace.css';
import './FinanceReportsPage.css';
import OperationsReportOverview from './OperationsReportOverview';
import { operationsHeading } from '../lib/operationsReportPresentation';
import { needsReportWording } from '../lib/reportPublication';

const bases = { operational: 'قيمة تشغيلية', estimate: 'تقديري', unavailable: 'غير متاح' };
const dateText = value => value ? new Date(value).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn', dateStyle: 'medium', timeStyle: 'short' }) : 'غير موثق بدقة';
export default function OperationsReportsPage() {
  const [page, setPage] = useState(1), [selected, setSelected] = useState(''), [revision, setRevision] = useState(undefined);
  const [query,setQuery]=useState(''),[sourceRole,setSourceRole]=useState('all');
  const [kind, setKind] = useState('all'), [status, setStatus] = useState('all'), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [tab, setTab] = useState('summary'), [state, setState] = useState('all');
  const language = useContext(LanguageContext);
  const archive = useOperationsRead('operations-reports', { action: 'list',page,pageSize:8,...(query?{query}:{}),
    ...(kind!=='all'?{kind}:{}),...(status!=='all'?{status}:{}),...(from?{from}:{}),...(to?{to}:{}),...(sourceRole!=='all'?{sourceRole:Number(sourceRole)}:{}) });
  const items = Array.isArray(archive.data?.items) ? archive.data.items : [];
  const visibleItems = items;
  const currentPage=archive.data?.page||page,pageCount=archive.data?.pageCount||1;
  const resetSelection=()=>{setPage(1);setSelected('');setRevision(undefined);};
  const choosePage=n=>{setPage(n);setSelected('');setRevision(undefined);};
  const reportId = visibleItems.some(item => item.reportId === selected) ? selected : visibleItems[0]?.reportId;
  const read = useOperationsRead('operations-reports', { action: 'read', reportId, ...(revision ? { revision } : {}) }, Boolean(reportId));
  const parsed = useMemo(() => {
    if (!read.data?.report) return { report: null, error: null };
    try { return { report: parseOperationsReport(read.data.report), error: null }; }
    catch { return { report: null, error: 'تعذر التحقق من صيغة التقرير؛ لم تُعرض بيانات بديلة.' }; }
  }, [read.data]);
  const report = parsed.report, error = archive.error || read.error || parsed.error;
  const filteredCases = report?.cases.filter(c => state === 'all' || c.status === state) || [];
  if (!archive.allowed) return <div className="fw-page"><p role="alert">تقارير العمليات التفصيلية للإدارة فقط.</p></div>;
  return <>
    <TopBar title="تقارير العمليات" subtitle="التشغيل والمزامنة والأصول — لقطات مراجعة وأرشيف، لا تسجيل عمليات جديدة" />
    <main className="fw-page finance-reports-page" dir="rtl">
      <div className="fw-toolbar">
        <label>بحث في كل التقارير <input type="search" aria-label="بحث في كل التقارير" maxLength={200} value={query} onChange={e=>{setQuery(e.target.value);resetSelection();}} /></label>
        <label>الفريق <select aria-label="فريق التقرير" value={sourceRole} onChange={e=>{setSourceRole(e.target.value);resetSelection();}}><option value="all">كل فرق العمليات</option>
          {(archive.data?.teams||[]).map(({id,label})=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>نوع التقرير <select value={kind} onChange={e => { setKind(e.target.value); resetSelection(); }}>
          <option value="all">كل الأنواع</option>{Object.entries(OPERATIONS_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>حالة التقرير <select value={status} onChange={e => { setStatus(e.target.value); resetSelection(); }}><option value="all">كل الحالات</option>{Object.entries(OPERATIONS_STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div><span>من تاريخ التقرير</span><DateField ariaLabel="من تاريخ التقرير" value={from} onChange={e => { setFrom(e.target.value); resetSelection(); }} /></div>
        <div><span>إلى تاريخ التقرير</span><DateField ariaLabel="إلى تاريخ التقرير" value={to} onChange={e => { setTo(e.target.value); resetSelection(); }} /></div>
        {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo(''); resetSelection(); }}>مسح فترة التصفية</button>}
        <button type="button" onClick={() => { archive.refresh(); read.refresh(); }}><RefreshCw size={16} /> تحديث القراءة</button>
      </div>
      {error && <div role="alert" className="fw-warning"><AlertTriangle size={18} />{error}</div>}
      {archive.loading && <LoadingState message="جارٍ قراءة أرشيف العمليات..." />}
      <OperationsReportPublisher canPublish={!archive.loading && !archive.error} onPublished={id => { setPage(1);setQuery('');setSourceRole('all'); setKind('all'); setStatus('all'); setFrom(''); setTo(''); setSelected(id); setRevision(undefined); archive.refresh(); read.refresh(); }} />
      <div className="fw-report-layout">
        <aside className="fw-panel fw-archive" aria-label="أرشيف تقارير العمليات">
          <h2><Archive size={18} /> الأرشيف</h2><small>البحث والفلاتر على كامل الأرشيف قبل تقسيم الصفحات.</small>
          {archive.data&&<p role="status" aria-label="نتائج أرشيف العمليات">{archive.data.total??items.length} تقريرًا مطابقًا · صفحة {currentPage} من {pageCount}</p>}
          {!archive.loading && !error && visibleItems.length === 0 && <p>لا تقارير محفوظة في هذا النطاق. غير المتاح ليس صفرًا.</p>}
          {visibleItems.map(item => <button type="button" className={item.reportId === reportId ? 'fw-selected' : ''} key={item.reportId}
            aria-pressed={item.reportId === reportId} onClick={() => { setSelected(item.reportId); setRevision(undefined); setTab('summary'); }}>
            <strong>{operationsHeading(item)}</strong><span>{item.sourceLabel} · {OPERATIONS_KINDS[item.kind]}</span><small>{OPERATIONS_STATUSES[item.status]} · {item.archiveMode === 'historical_imported' ? 'أرشيف تاريخي منقول' : 'تقرير مراجع'}</small>
          </button>)}
          {pageCount>1&&<nav className="finance-report-pagination" aria-label="صفحات تقارير العمليات"><button type="button" disabled={currentPage<=1||archive.loading} onClick={()=>choosePage(currentPage-1)}>السابق</button>
            {[...new Set([1,currentPage-1,currentPage,currentPage+1,pageCount])].filter(n=>n>=1&&n<=pageCount).sort((a,b)=>a-b).map(n=><button type="button" key={n} aria-label={`صفحة ${n}`} aria-current={n===currentPage?'page':undefined} onClick={()=>choosePage(n)}>{n}</button>)}
            <button type="button" disabled={currentPage>=pageCount||archive.loading} onClick={()=>choosePage(currentPage+1)}>التالي</button></nav>}
        </aside>
        <section aria-label="التقرير المختار" className="fw-report">
          {read.loading && <LoadingState message="جارٍ قراءة نسخة التقرير..." />}
          {report && !error && <LanguageContext.Provider value={{ ...language, language: 'ar' }}>
            <OperationsReportOverview report={report}/>
            <details className="fw-panel finance-report-technical"><summary>التفاصيل التقنية والتقرير المحفوظ</summary>
            <header className="fw-panel fw-report-head"><div className="fw-eyebrow"><ShieldCheck size={16} /> تقرير عمليات مراجع · {report.sourceLabel} · الدور الأصلي {report.sourceRole}</div>
              <h1>{report.title}</h1><span className="fw-badge">النسخة المعروضة: {report.revision}</span><p>{report.summary}</p>
              {report.revision < read.data.currentRevision && <div className="fw-warning" role="note"><div>
                <p>نسخة تاريخية معروضة. أحدث نسخة محفوظة: {read.data.currentRevision} — لا تعتبر هذه آخر نتيجة.</p>
                <button type="button" onClick={() => setRevision(undefined)}>عرض أحدث نسخة</button>
              </div></div>}
              <div className="fw-meta"><span>الفترة {report.period.from || 'غير موثق'} — {report.period.to || 'غير موثق'}</span><span>القطع: {dateText(report.cutAtRiyadh)} — الرياض</span></div>
              <div className="fw-meta"><span>تاريخ الخدمة: {report.serviceDateRiyadh || 'غير موثق'}</span><span>إصدار المصدر الأصلي: {dateText(report.issuedAtRiyadh)}</span><span>حفظ النسخة في سويتر: {dateText(read.data.savedAt)}</span><span>مراجعة النقل/النشر: {dateText(report.review.at)}</span></div>
              <p>{OPERATIONS_KINDS[report.kind]} · الجولة {report.round} · {OPERATIONS_STATUSES[report.status]}</p>
              {report.snapshot === 'partial' && <p className="fw-warning" role="note">لقطة جزئية عند القطع؛ ليست إغلاقًا لليوم أو دليل اكتمال كل العمليات.</p>}
              {report.historicalImported && <div className="fw-warning" role="note"><div><strong>أرشيف تاريخي منقول — ليس حالة التشغيل الحالية</strong><p>{report.historicalImported.timeNote}</p><p>تاريخ المصدر الأصلي: {report.historicalImported.originalReportDate} · آخر يوم دليل موثق: {report.historicalImported.evidenceThroughDate} · دقة القطع: {({ exact: 'دقيق', date_only: 'تاريخ فقط', approximate: 'تقريبي' })[report.historicalImported.cutPrecision]}</p><code>{report.historicalImported.sourceSha256}</code></div></div>}
              <p className="fw-integrity">{report.historicalIntegrity}</p>
              <label>نسخة محفوظة <select aria-label="نسخة التقرير" value={revision || read.data.currentRevision} onChange={e => setRevision(Number(e.target.value))}>
                {(read.data.history || []).map(h => <option value={h.revision} key={h.revision}>{h.revision} — {h.reason}</option>)}
              </select></label>
              {read.data.historyLimited && <small>تعرض القائمة حتى30 نسخة حديثة؛ تبقى النسخ الأقدم محفوظة ويمكن قراءتها برقم النسخة من أدوات العمليات.</small>}
            </header>
            {report.visibleWarnings.map(w => <div role={w.severity === 'critical' ? 'alert' : 'note'} className="fw-warning" key={w.id}><AlertTriangle size={18} />{w.text} {needsReportWording(w.text)&&<span className="report-wording-warning">تحتاج صياغة</span>}</div>)}
            <div className="fw-tabs" role="tablist" aria-label="أقسام تقرير العمليات">
              {[['summary', 'الملخص'], ['cases', 'المتابعات'], ['evidence', 'المصادر والتفاصيل']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1} aria-controls={`operations-report-${id}`} id={`operations-tab-${id}`} onClick={() => setTab(id)}
                onKeyDown={e => {
                  const ids = ['summary', 'cases', 'evidence'];
                  const offset = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
                  const next = e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[2] : offset ? ids[(ids.indexOf(id) + offset + 3) % 3] : null;
                  if (next) { e.preventDefault(); setTab(next); document.getElementById(`operations-tab-${next}`)?.focus(); }
                }}>{label}</button>)}
            </div>
            {tab === 'summary' && <div role="tabpanel" id="operations-report-summary" aria-labelledby="operations-tab-summary">
              <div className="fw-metrics">{Object.entries(OPERATIONS_STAGES).map(([id, label]) => <article className="fw-panel fw-metric" key={id}><span>{label}</span><strong>{report.activity[id].count === null ? 'غير متاح' : report.activity[id].count.toLocaleString('en-US')}</strong><p>{report.activity[id].detail}</p></article>)}</div>
              <div className="fw-panel"><h2>حدود التغطية</h2>{[['individual', 'الفردي'], ['b2b', 'الشركات B2B']].map(([id, label]) => <div key={id}><h3>{label} — {({ verified: 'متحقق ضمن نطاقه', partial: 'جزئي', unavailable: 'غير متاح' })[report.coverage[id].status]}</h3><p>{report.coverage[id].detail}</p></div>)}</div>
              <div className="fw-metrics">{report.metrics.map(m => <article className="fw-panel fw-metric" key={m.id}><span>{m.label}</span>
                <strong>{m.value === null ? 'غير متاح' : m.value.toLocaleString('ar-SA', { numberingSystem: 'latn', maximumFractionDigits: 2 })} <small>{m.value === null ? '' : m.unit}</small></strong>
                <span className="fw-badge">{bases[m.basis]}</span><p>{m.coverage}</p><small>{dateText(m.asOf)}</small></article>)}</div>
              <div className="fw-panel"><h2>حالة المتابعة</h2><div className="fw-case-bars">{Object.entries(OPERATIONS_STATES).map(([id, label]) => {
                const count = report.cases.filter(c => c.status === id).length;
                return <div key={id}><span>{label}</span><meter min="0" max={Math.max(1, report.cases.length)} value={count} aria-label={label} /><strong>{count}</strong></div>;
              })}</div><small>حالات هذا التقرير فقط؛ لا تثبت إغلاق جميع العمليات.</small></div>
            </div>}
            {tab === 'cases' && <div role="tabpanel" id="operations-report-cases" aria-labelledby="operations-tab-cases"><div className="fw-toolbar"><label>حالة المتابعة <select value={state} onChange={e => setState(e.target.value)}>
              <option value="all">جميع الحالات</option>{Object.entries(OPERATIONS_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label><p role="status" aria-label="عدد حالات العمليات المطابقة">الحالات المطابقة: {filteredCases.length} / {report.cases.length}</p></div>{filteredCases.map(c => <article className="fw-panel fw-case" key={c.caseId}>
              <div className="fw-meta"><span className="fw-badge">{OPERATIONS_STATES[c.status]}</span><span>المسؤول: الدور {c.ownerRole}</span></div>
              <h2>{c.title}</h2><code>{c.caseId}</code><p>{c.evidence}</p><p><strong>التالي:</strong> {c.next}</p>
              {c.verification && <small>التحقق: {c.verification.kind === 'self' ? 'ذاتي موثق — ليس مستقلًا' : c.verification.kind === 'owner' ? 'قرار المالك' : 'مستقل'} · {dateText(c.verification.at)}</small>}
            </article>)}{report.cases.length === 0 ? <p>لم تُدرج حالات في هذا التقرير؛ لا يثبت ذلك اكتمال كل الملفات.</p>
              : filteredCases.length === 0 && <p>لا حالات تطابق التصفية الحالية. غيّر التصفية لعرض بقية الحالات؛ لم تُغلق أو تتغير أي حالة.</p>}</div>}
            {tab === 'evidence' && <div role="tabpanel" id="operations-report-evidence" aria-labelledby="operations-tab-evidence">
              <div className="fw-panel"><h2>المصادر وحدود التغطية</h2>{report.sources.map(s => <details key={s.id}><summary>{s.label} — {({ verified: 'متحقق ضمن نطاقه', partial: 'جزئي', unavailable: 'غير متاح' })[s.status]}</summary><p>{s.coverage}</p><p>{s.sourceRef}</p><small>{dateText(s.checkedAt)}</small></details>)}</div>
              {report.sections.map(s => <details className="fw-panel" key={s.id}><summary><FileText size={16} /> {s.title}</summary><p>{s.text}</p>
                {s.rows && <div className="fw-table-scroll"><table><thead><tr>{s.columns.map((label, i) => <th key={i}>{label}</th>)}</tr></thead><tbody>{s.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? 'غير متاح' : value}</td>)}</tr>)}</tbody></table></div>}
              </details>)}
            </div>}
            </details>
          </LanguageContext.Provider>}
          {!report && !read.loading && !error && <div className="fw-panel"><FileText size={32} /><h2>تقارير موثقة، لا بيانات تجريبية</h2><p>تظهر التقارير بعد مراجعتها وحفظها والتحقق من نسختها؛ التاريخي المنقول يحمل وسمًا واضحًا.</p></div>}
        </section>
      </div>
    </main>
  </>;
}
