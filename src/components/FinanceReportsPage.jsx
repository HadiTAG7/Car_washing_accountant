import { useContext, useMemo, useState } from 'react';
import { FileText, Archive, RefreshCw, AlertTriangle, ChevronLeft, ShieldCheck } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { FINANCE_ROLES, FINANCE_STATES, parseFinanceReport } from '../lib/financeReportContract';
import { LanguageContext } from '../i18n/LanguageContext';
import FinanceReportPublisher from './FinanceReportPublisher';
import './FinanceWorkspace.css';

const bases = { ledger: 'مرحّل دفتريًا', operational: 'قيمة تشغيلية', collected: 'تحصيل مثبت', estimate: 'تقديري', unavailable: 'غير متاح' };
const dateText = value => new Date(value).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn', dateStyle: 'medium', timeStyle: 'short' });
export default function FinanceReportsPage() {
  const [before, setBefore] = useState(undefined), [selected, setSelected] = useState(''), [revision, setRevision] = useState(undefined);
  const [role, setRole] = useState('all'), [tab, setTab] = useState('summary'), [state, setState] = useState('all');
  const language = useContext(LanguageContext);
  const archive = useFinanceRead('finance-reports', { action: 'list', ...(before ? { before } : {}) });
  const items = Array.isArray(archive.data?.items) ? archive.data.items : [];
  const visibleItems = items.filter(item => role === 'all' || String(item.sourceRole) === role);
  const reportId = selected || visibleItems[0]?.reportId;
  const read = useFinanceRead('finance-reports', { action: 'read', reportId, ...(revision ? { revision } : {}) }, Boolean(reportId));
  const parsed = useMemo(() => {
    if (!read.data?.report) return { report: null, error: null };
    try { return { report: parseFinanceReport(read.data.report), error: null }; }
    catch { return { report: null, error: 'تعذر التحقق من صيغة التقرير؛ لم تُعرض بيانات بديلة.' }; }
  }, [read.data]);
  const report = parsed.report, error = archive.error || read.error || parsed.error;
  const filteredCases = report?.cases.filter(c => state === 'all' || c.status === state) || [];
  if (!archive.allowed) return <div className="fw-page"><p role="alert">تقارير المالية التفصيلية للإدارة فقط.</p></div>;
  return <>
    <TopBar title="تقارير المالية" subtitle="تقارير موثقة لفريق المالية — لقطات مؤرخة، وليست أوامر صرف" />
    <main className="fw-page" dir="rtl">
      <div className="fw-toolbar">
        <label>الفريق <select aria-label="تصفية الفريق في صفحة الأرشيف" value={role} onChange={e => { setRole(e.target.value); setSelected(''); setRevision(undefined); }}>
          <option value="all">فريق المالية كله</option>{Object.entries(FINANCE_ROLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <button type="button" onClick={() => { archive.refresh(); read.refresh(); }}><RefreshCw size={16} /> تحديث القراءة</button>
      </div>
      {error && <div role="alert" className="fw-warning"><AlertTriangle size={18} />{error}</div>}
      {archive.loading && <LoadingState message="جارٍ قراءة أرشيف المالية..." />}
      <FinanceReportPublisher onPublished={id => { setBefore(undefined); setSelected(id); setRevision(undefined); archive.refresh(); read.refresh(); }} />
      <div className="fw-report-layout">
        <aside className="fw-panel fw-archive" aria-label="أرشيف تقارير المالية">
          <h2><Archive size={18} /> الأرشيف</h2><small>حتى30 تقريرًا في الصفحة؛ التصفية تخص الصفحة المعروضة.</small>
          {!archive.loading && !error && visibleItems.length === 0 && <p>لا تقارير محفوظة في هذا النطاق. غير المتاح ليس صفرًا.</p>}
          {visibleItems.map(item => <button type="button" className={item.reportId === reportId ? 'fw-selected' : ''} key={item.reportId}
            aria-pressed={item.reportId === reportId} onClick={() => { setSelected(item.reportId); setRevision(undefined); setTab('summary'); }}>
            <strong>{item.title}</strong><span>{item.dateRiyadh} · {FINANCE_ROLES[item.sourceRole]}</span><small>النسخة {item.revision}</small>
          </button>)}
          {archive.data?.nextBefore && <button type="button" onClick={() => { setBefore(archive.data.nextBefore); setSelected(''); setRevision(undefined); }}>تقارير أقدم <ChevronLeft size={16} /></button>}
          {before && <button type="button" onClick={() => { setBefore(undefined); setSelected(''); setRevision(undefined); }}>العودة للأحدث</button>}
        </aside>
        <section aria-label="التقرير المختار" className="fw-report">
          {read.loading && <LoadingState message="جارٍ قراءة نسخة التقرير..." />}
          {report && !error && <LanguageContext.Provider value={{ ...language, language: 'ar' }}>
            <header className="fw-panel fw-report-head"><div className="fw-eyebrow"><ShieldCheck size={16} /> تقرير مالي مراجع · {FINANCE_ROLES[report.sourceRole]}</div>
              <h1>{report.title}</h1><span className="fw-badge">النسخة المعروضة: {report.revision}</span><p>{report.summary}</p>
              {report.revision < read.data.currentRevision && <div className="fw-warning" role="note"><div>
                <p>نسخة تاريخية معروضة. أحدث نسخة محفوظة: {read.data.currentRevision} — لا تعتبر هذه آخر نتيجة.</p>
                <button type="button" onClick={() => setRevision(undefined)}>عرض أحدث نسخة</button>
              </div></div>}
              <div className="fw-meta"><span>الفترة {report.period.from} — {report.period.to}</span><span>القطع: {dateText(report.cutAtRiyadh)} — الرياض</span></div>
              <p className="fw-integrity">{report.historicalIntegrity}</p>
              <label>نسخة محفوظة <select aria-label="نسخة التقرير" value={revision || read.data.currentRevision} onChange={e => setRevision(Number(e.target.value))}>
                {(read.data.history || []).map(h => <option value={h.revision} key={h.revision}>{h.revision} — {h.reason}</option>)}
              </select></label>
              {read.data.historyLimited && <small>تعرض القائمة حتى30 نسخة حديثة؛ تبقى النسخ الأقدم محفوظة ويمكن قراءتها برقم النسخة من أدوات المالية.</small>}
            </header>
            {report.visibleWarnings.map(w => <div role={w.severity === 'critical' ? 'alert' : 'note'} className="fw-warning" key={w.id}><AlertTriangle size={18} />{w.text}</div>)}
            <div className="fw-tabs" role="tablist" aria-label="أقسام تقرير المالية">
              {[['summary', 'الملخص'], ['cases', 'المتابعات'], ['evidence', 'المصادر والتفاصيل']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1} aria-controls={`finance-report-${id}`} id={`finance-tab-${id}`} onClick={() => setTab(id)}
                onKeyDown={e => {
                  const ids = ['summary', 'cases', 'evidence'];
                  const offset = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
                  const next = e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[2] : offset ? ids[(ids.indexOf(id) + offset + 3) % 3] : null;
                  if (next) { e.preventDefault(); setTab(next); document.getElementById(`finance-tab-${next}`)?.focus(); }
                }}>{label}</button>)}
            </div>
            {tab === 'summary' && <div role="tabpanel" id="finance-report-summary" aria-labelledby="finance-tab-summary">
              <div className="fw-metrics">{report.metrics.map(m => <article className="fw-panel fw-metric" key={m.id}><span>{m.label}</span>
                <strong>{m.value === null ? 'غير متاح' : m.value.toLocaleString('ar-SA', { numberingSystem: 'latn', maximumFractionDigits: 2 })} <small>{m.value === null ? '' : m.unit}</small></strong>
                <span className="fw-badge">{bases[m.basis]}</span><p>{m.coverage}</p><small>{dateText(m.asOf)}</small></article>)}</div>
              <div className="fw-panel"><h2>حالة المتابعة</h2><div className="fw-case-bars">{Object.entries(FINANCE_STATES).map(([id, label]) => {
                const count = report.cases.filter(c => c.status === id).length;
                return <div key={id}><span>{label}</span><meter min="0" max={Math.max(1, report.cases.length)} value={count} aria-label={label} /><strong>{count}</strong></div>;
              })}</div><small>حالات هذا التقرير فقط، وليست نسبة اكتمال مالية.</small></div>
            </div>}
            {tab === 'cases' && <div role="tabpanel" id="finance-report-cases" aria-labelledby="finance-tab-cases"><div className="fw-toolbar"><label>حالة المتابعة <select value={state} onChange={e => setState(e.target.value)}>
              <option value="all">جميع الحالات</option>{Object.entries(FINANCE_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label><p role="status">الحالات المطابقة: {filteredCases.length} / {report.cases.length}</p></div>{filteredCases.map(c => <article className="fw-panel fw-case" key={c.caseId}>
              <div className="fw-meta"><span className="fw-badge">{FINANCE_STATES[c.status]}</span><span>المسؤول: الدور {c.ownerRole}</span></div>
              <h2>{c.title}</h2><code>{c.caseId}</code><p>{c.evidence}</p><p><strong>التالي:</strong> {c.next}</p>
              {c.verification && <small>التحقق: {c.verification.kind === 'self' ? 'ذاتي موثق — ليس مستقلًا' : c.verification.kind === 'owner' ? 'قرار المالك' : 'مستقل'} · {dateText(c.verification.at)}</small>}
            </article>)}{report.cases.length === 0 ? <p>لم تُدرج حالات في هذا التقرير؛ لا يثبت ذلك اكتمال كل الملفات.</p>
              : filteredCases.length === 0 && <p>لا حالات تطابق التصفية الحالية. غيّر التصفية لعرض بقية الحالات؛ لم تُغلق أو تتغير أي حالة.</p>}</div>}
            {tab === 'evidence' && <div role="tabpanel" id="finance-report-evidence" aria-labelledby="finance-tab-evidence">
              <div className="fw-panel"><h2>المصادر وحدود التغطية</h2>{report.sources.map(s => <details key={s.id}><summary>{s.label} — {({ verified: 'متحقق ضمن نطاقه', partial: 'جزئي', unavailable: 'غير متاح' })[s.status]}</summary><p>{s.coverage}</p><p>{s.sourceRef}</p><small>{dateText(s.checkedAt)}</small></details>)}</div>
              {report.sections.map(s => <details className="fw-panel" key={s.id}><summary><FileText size={16} /> {s.title}</summary><p>{s.text}</p>
                {s.rows && <div className="fw-table-scroll"><table><thead><tr>{s.columns.map((label, i) => <th key={i}>{label}</th>)}</tr></thead><tbody>{s.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? 'غير متاح' : value}</td>)}</tr>)}</tbody></table></div>}
              </details>)}
            </div>}
          </LanguageContext.Provider>}
          {!report && !read.loading && !error && <div className="fw-panel"><FileText size={32} /><h2>تقارير موثقة، لا بيانات تجريبية</h2><p>تظهر التقارير بعد مراجعة الفريق وحفظها والتحقق من نسختها. يبدأ الأرشيف من التفعيل.</p></div>}
        </section>
      </div>
    </main>
  </>;
}
