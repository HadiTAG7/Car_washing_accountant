import { useContext, useMemo, useState } from 'react';
import { Archive, RefreshCw, AlertTriangle } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { FINANCE_ROLES, parseFinanceReport } from '../lib/financeReportContract';
import { LanguageContext } from '../i18n/LanguageContext';
import FinanceReportPublisher from './FinanceReportPublisher';
import FinanceReportOwnerView from './FinanceReportOwnerView';
import { financeDateLabel } from '../lib/financeReportPresentation';
import './FinanceWorkspace.css';

function initialSelection() {
  const query = new URLSearchParams(window.location.search), revision = Number(query.get('revision'));
  return { reportId: query.get('report') || '', revision: Number.isInteger(revision) && revision > 0 ? revision : undefined };
}
export default function FinanceReportsPage() {
  const [selection, setSelection] = useState(initialSelection), [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ role: 'all', from: '', to: '', search: '' }), [searchDraft, setSearchDraft] = useState('');
  const language = useContext(LanguageContext);
  const archive = useFinanceRead('finance-reports', { action: 'archive', page, pageSize: 10,
    ...(filters.role !== 'all' ? { sourceRole: Number(filters.role) } : {}), ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}), ...(filters.search ? { search: filters.search } : {}) });
  const items = archive.data?.items || [], reportId = selection.reportId || items[0]?.reportId;
  const read = useFinanceRead('finance-reports', { action: 'read', reportId, ...(selection.revision ? { revision: selection.revision } : {}) }, Boolean(reportId));
  const parsed = useMemo(() => {
    if (!read.data?.report) return { report: null };
    try { return { report: parseFinanceReport(read.data.report), previousReport: read.data.previousReport ? parseFinanceReport(read.data.previousReport) : null }; }
    catch { return { report: null, error: 'تعذر التحقق من صيغة التقرير؛ لم تُعرض بيانات بديلة.' }; }
  }, [read.data]);
  const error = archive.error || read.error || parsed.error;
  const changeFilter = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); setSelection({ reportId: '' }); };
  const choosePage = value => { setPage(value); setSelection({ reportId: '' }); };
  if (!archive.allowed) return <div className="fw-page"><p role="alert">تقارير المالية التفصيلية للإدارة فقط.</p></div>;
  return <><TopBar title="تقارير المالية والأرشيف" subtitle="الوضع المالي، الملاحظات المهمة، والقرارات المطلوبة" /><main className="fw-page fr-report-page" dir="rtl">
    <div className="fw-toolbar"><p>كل تقرير لقطة محفوظة وقت قطعه، وليست أرقام اليوم.</p><button type="button" onClick={() => { archive.refresh(); read.refresh(); }}><RefreshCw size={16} /> تحديث القراءة</button></div>
    <section className="fr-archive-filters" aria-label="تصفية كل تقارير المالية">
      <label>الفريق<select aria-label="تصفية الفريق في صفحة الأرشيف" value={filters.role} onChange={event => changeFilter('role', event.target.value)}><option value="all">فريق المالية كله</option>{Object.entries(FINANCE_ROLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>من تاريخ<input type="date" aria-label="من تاريخ" lang="en" value={filters.from} onChange={event => changeFilter('from', event.target.value)} /></label>
      <label>إلى تاريخ<input type="date" aria-label="إلى تاريخ" lang="en" value={filters.to} onChange={event => changeFilter('to', event.target.value)} /></label>
      <form className="fr-search-form" onSubmit={event => { event.preventDefault(); changeFilter('search', searchDraft.trim()); }}><label>البحث في كل التقارير<input type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="عنوان، ملاحظة، أو مرجع محفوظ" /></label><button type="submit">بحث</button></form>
    </section>
    <small>البحث والتاريخ والفريق تشمل الأرشيف كله، قبل تقسيم النتائج إلى صفحات.</small>
    {error && <div role="alert" className="fw-warning"><AlertTriangle size={18} />{error}</div>}
    <div className="fw-report-layout"><aside className="fw-panel" aria-label="أرشيف تقارير المالية"><h2><Archive size={18} /> الأرشيف</h2>
      {archive.loading ? <LoadingState message="جارٍ قراءة أرشيف المالية..." /> : !archive.error && <p role="status">{archive.data?.total ?? 0} تقرير مطابق</p>}
      <div className="fr-archive-list">{items.map(item => <button type="button" className={item.reportId === reportId ? 'fw-selected' : ''} key={item.reportId}
        aria-pressed={item.reportId === reportId} onClick={() => setSelection({ reportId: item.reportId })}>
        <strong>{financeDateLabel(item.dateRiyadh)}</strong><span>{item.headline || 'تقرير مالي محفوظ'}</span><small>{FINANCE_ROLES[item.sourceRole]}</small>
      </button>)}</div>
      {!archive.loading && !archive.error && !items.length && <p>لا تقارير تطابق التصفية. لم يتغير أي تقرير محفوظ.</p>}
      {archive.data && <><nav className="fr-archive-pagination" aria-label="صفحات أرشيف المالية"><button type="button" disabled={archive.data.page <= 1} onClick={() => choosePage(archive.data.page - 1)}>السابق</button>
        {Array.from({ length: archive.data.pages }, (_, index) => index + 1).filter(value => value === 1 || value === archive.data.pages || Math.abs(value - archive.data.page) <= 2).map(value => <button type="button" key={value} aria-label={`صفحة ${value}`} aria-current={value === archive.data.page ? 'page' : undefined} onClick={() => choosePage(value)}>{value}</button>)}
        <button type="button" disabled={archive.data.page >= archive.data.pages} onClick={() => choosePage(archive.data.page + 1)}>التالي</button></nav><small>صفحة {archive.data.page} من {archive.data.pages}</small></>}
    </aside><section aria-label="التقرير المختار" className="fw-report">
      {read.loading && <LoadingState message="جارٍ قراءة نسخة التقرير..." />}
      {parsed.report && !error && <LanguageContext.Provider value={{ ...language, language: 'ar' }}><FinanceReportOwnerView report={parsed.report} previousReport={parsed.previousReport}
        currentRevision={read.data.currentRevision} history={read.data.history} historyLimited={read.data.historyLimited} onRevision={revision => setSelection({ reportId, revision })} /></LanguageContext.Provider>}
      {!parsed.report && !read.loading && !error && <p>اختر تقريرًا محفوظًا من الأرشيف. لا تُنشأ أرقام بديلة عند غياب التقرير.</p>}
    </section></div>
    <FinanceReportPublisher onPublished={id => { setPage(1); setSelection({ reportId: id }); archive.refresh(); read.refresh(); }} />
  </main></>;
}
