import { useMemo, useRef, useState } from 'react';
import { Inbox, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import ModalSurface from './ModalSurface';
import FinanceExpenseForm from './FinanceExpenseForm';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { callFinanceApi } from '../lib/financeApi';
import { approveFinanceSelection } from '../lib/financeWorkbenchActions';
import { documentAge, documentDay, documentKey, EXPENSE_KIND_LABELS, filterWorkbenchItems, sumWorkbenchItems, workbenchCounters, WORKBENCH_STAGES } from '../lib/financeWorkbenchView';
import { riyadhTodayISO } from '../lib/washesYesterday';
import './FinanceWorkspace.css';
import './FinanceWorkbenchPage.css';

const PAGE_SIZE = 15;
const money = value => Number.isFinite(value) ? `${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ر.س` : 'مبلغ غير مكتمل';
const stageNames = { ...WORKBENCH_STAGES, payment_conflict: 'طريقة دفع متناقضة' };
const totalText = total => `${total.count} مستند · ${money(total.amount)}${total.missing ? ` (${total.missing} دون مبلغ؛ المعروف ${money(total.knownAmount)})` : ''}`;

export default function FinanceWorkbenchPage() {
  const [filters, setFilters] = useState({ month: '', kind: 'all', stage: 'all', search: '' });
  const [page, setPage] = useState(1), [selected, setSelected] = useState(null), [capture, setCapture] = useState(null);
  const [message, setMessage] = useState(''), [dirty, setDirty] = useState(false), [formBusy, setFormBusy] = useState(false);
  const [checked, setChecked] = useState([]), [bulkOpen, setBulkOpen] = useState(false), [bulkBusy, setBulkBusy] = useState(false);
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [bulkResult, setBulkResult] = useState(null), [bulkError, setBulkError] = useState('');
  const batchFlight = useRef(false);
  const list = useFinanceRead('finance-workbench', { action: 'browse' });
  const items = useMemo(() => list.data?.items || [], [list.data]);
  const scope = useMemo(() => filterWorkbenchItems(items, { ...filters, stage: 'all' }), [items, filters]);
  const counters = useMemo(() => workbenchCounters(scope), [scope]);
  const filtered = useMemo(() => filterWorkbenchItems(scope, { stage: filters.stage }), [scope, filters.stage]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const active = capture || selected || items[0];
  const kind = active?.kind || (filters.kind === 'all' ? 'variable' : filters.kind), sourceId = capture ? undefined : active?.sourceId;
  const read = useFinanceRead('finance-workbench', { action: 'read', kind, sourceId }, Boolean(sourceId) && !capture);
  const options = useFinanceRead('finance-workbench', { action: 'options', kind }, Boolean(active));
  const selection = items.filter(item => checked.includes(documentKey(item)));
  const today = riyadhTodayISO();
  const months = [...new Set(items.map(item => documentDay(item.date)?.slice(0, 7)).filter(Boolean))].sort().reverse();
  function mayLeave() {
    return !formBusy && !bulkBusy && (!dirty || window.confirm('عندك تغييرات غير محفوظة. تتركها وتكمل؟'));
  }
  function choose(item) {
    if (!mayLeave()) return;
    setSelected({ kind: item.kind, sourceId: item.sourceId }); setCapture(null); setDirty(false); setMessage('');
  }
  function refresh() {
    if (!mayLeave()) return;
    setDirty(false); setMessage(''); setChecked([]); list.refresh(); read.refresh(); options.refresh();
  }
  function changed(id) {
    setSelected({ kind, sourceId: id }); setCapture(null); setDirty(false); setChecked([]); list.refresh(); read.refresh();
  }
  function changeFilter(key, value) { setFilters(f => ({ ...f, [key]: value })); setPage(1); setChecked([]); }
  function openBulk() {
    if (!selection.length || !mayLeave()) return;
    if (dirty) { setDirty(false); read.refresh(); setCapture(null); }
    setReason(''); setConfirmed(false); setBulkResult(null); setBulkError(''); setBulkOpen(true);
  }
  async function approveBulk() {
    if (batchFlight.current || bulkResult) return;
    batchFlight.current = true; setBulkBusy(true); setBulkError('');
    try {
      const result = await approveFinanceSelection({ items: selection, reason, confirmed, call: callFinanceApi });
      setBulkResult(result); setChecked([]); list.refresh(); read.refresh();
      setMessage(`تحقق اعتماد ${result.verified.length} مستند. لم يُرحّل أو يُدفع أي مستند ضمن هذه الخطوة.`);
    } catch (error) { setBulkError(error.message); }
    finally { batchFlight.current = false; setBulkBusy(false); }
  }
  if (!list.allowed) return <div className="fw-page" role="alert">صندوق العمل المالي للإدارة فقط.</div>;
  return <><TopBar title="صندوق العمل المالي" subtitle="كل مستند، وخطوته الجاية — دون تغيير الضوابط" /><main className="fw-page fw-workbench" dir="rtl">
    <div className="fw-toolbar"><div><h2>المستندات المسجلة ومراحلها</h2><small>التسجيل وحفظ التفاصيل والمراجعة والاعتماد والترحيل والسداد حالات منفصلة.</small></div><div className="fw-actions">
      <button type="button" disabled={formBusy || bulkBusy || list.loading} onClick={refresh}><RefreshCw size={16} /> تحديث البيانات</button>
      <button type="button" className="fw-primary" disabled={formBusy || bulkBusy} onClick={() => { if (!mayLeave()) return; setCapture({ kind: filters.kind === 'all' ? kind : filters.kind, requestId: crypto.randomUUID() }); setDirty(false); setMessage(''); }}><Plus size={16} /> مستند جديد</button>
    </div></div>
    <p className="fw-workbench-note"><AlertTriangle size={17} />النواقص تمنع الاعتماد. الاعتماد لا يعني الترحيل أو السداد، والترحيل لا يصرف أموالًا.</p>
    <p className="fw-workbench-note">كل مستند في القائمة مسجل بالفعل. حالة النواقص قد تعني مانع ترحيل مشتركًا، وليس نقص تسجيل.</p>
    {message && <div className="fw-success" role="status">{message}</div>}
    {list.error && <div className="fw-warning" role="alert">{list.error} لم تكتمل قراءة القائمة؛ لا توجد أعداد متحققة.</div>}
    <section className="fw-stage-counters" aria-label="عدادات مراحل المستندات">{Object.entries(stageNames).map(([stage, label]) => <button type="button" key={stage}
      className={`fw-counter fw-counter--${stage}`} aria-pressed={filters.stage === stage} disabled={list.loading || Boolean(list.error)}
      onClick={() => changeFilter('stage', filters.stage === stage ? 'all' : stage)}>
      <span>{label}</span><strong>{list.loading || list.error ? '—' : counters[stage].count}</strong><small>{list.loading || list.error ? 'بانتظار القراءة' : money(counters[stage].amount)}</small>
    </button>)}</section>
    <small>العدادات حسب الشهر والنوع والبحث، قبل فلتر المرحلة. «مرحل والسداد غير مثبت» تشمل غير المسدد وما ينقصه دليل.</small>
    <section className="fw-filters" aria-label="تصفية المستندات">
      <label>الشهر<select aria-label="الشهر" value={filters.month} onChange={e => changeFilter('month', e.target.value)}><option value="">كل الشهور</option>{months.map(month => <option key={month} value={month}>{month}</option>)}</select></label>
      <label>الحالة<select aria-label="الحالة" value={filters.stage} onChange={e => changeFilter('stage', e.target.value)}><option value="all">كل المراحل</option>{Object.entries(stageNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>نوع المصروف<select aria-label="نوع المصروف" value={filters.kind} onChange={e => changeFilter('kind', e.target.value)}><option value="all">كل الأنواع</option>{Object.entries(EXPENSE_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="fw-search">بحث<input type="search" placeholder="الوصف، المورد، رقم المستند" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /></label>
    </section>
    {list.loading ? <LoadingState message="جارٍ قراءة كل المستندات ومراحلها..." /> : !list.error && <div className="fw-results-summary" role="status">
      <strong>نتيجة التصفية: {totalText(sumWorkbenchItems(filtered))}</strong><small>إجمالي السجلات: {items.length} · الأحدث أولًا · قراءة {list.data?.readAt ? new Date(list.data.readAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }) : 'غير متاحة'} بتوقيت الرياض</small>
    </div>}
    <div className="fw-records"><aside className="fw-panel fw-documents" aria-label="سجلات المصروفات"><h2><Inbox size={18} /> المستندات</h2>
      <div className="fw-selection-actions"><label><input type="checkbox" aria-label="تحديد الجاهز في هذه الصفحة" disabled={!shown.some(item => item.approvalReady) || formBusy || bulkBusy}
        checked={shown.some(item => item.approvalReady) && shown.filter(item => item.approvalReady).every(item => checked.includes(documentKey(item)))}
        onChange={e => setChecked(previous => e.target.checked ? [...new Set([...previous, ...shown.filter(item => item.approvalReady).map(documentKey)])] : previous.filter(key => !shown.some(item => documentKey(item) === key)))} /> تحديد الجاهز بالصفحة</label>
        <button type="button" disabled={!selection.length || formBusy || bulkBusy} onClick={openBulk}>اعتماد المحدد ({selection.length})</button></div>
      <div className="fw-document-list">{shown.map(item => { const age = documentAge(item.date, today), key = documentKey(item); return <article className={`fw-document-row ${!capture && kind === item.kind && sourceId === item.sourceId ? 'fw-selected' : ''}`} key={key}>
        <input type="checkbox" aria-label={`تحديد ${item.title}`} checked={checked.includes(key)} disabled={!item.approvalReady || formBusy || bulkBusy}
          onChange={e => setChecked(previous => e.target.checked ? [...previous, key] : previous.filter(value => value !== key))} />
        <button type="button" disabled={formBusy || bulkBusy} onClick={() => choose(item)}><strong>{item.title || 'مستند دون وصف'}</strong><span>{money(item.amount)}</span>
          <small>{documentDay(item.date) || 'التاريخ غير مثبت'} · {EXPENSE_KIND_LABELS[item.kind]}</small>
          <small>{item.supplier || 'المورد غير مثبت'}{item.documentNumber ? ` · مستند ${item.documentNumber}` : ''}</small>
          <span className={`fw-stage fw-stage--${item.workflowStage}`}>{WORKBENCH_STAGES[item.workflowStage] || 'غير متاح'}</span>
          {item.workflowStage === 'complete' && item.workflowDimensions?.payment?.basis === 'founding_rule' && <small>{item.workflowDimensions.payment.label}</small>}
          {item.workflowDimensions && <small>{item.workflowDimensions.details.label} · {item.workflowDimensions.review.label}</small>}
          {age > 30 && item.workflowStage !== 'complete' && <small className="fw-age-warning">أقدم من 30 يومًا ولم يكتمل · {age} يومًا</small>}
          {item.paymentConflict && <small className="fw-age-warning">طريقة دفع متناقضة</small>}
        </button></article>; })}
      {!list.loading && !list.error && !shown.length && <p>لا توجد مستندات تطابق التصفية.</p>}</div>
      <nav className="fw-pagination" aria-label="صفحات المستندات"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>السابق</button>
        {Array.from({ length: pages }, (_, index) => index + 1).filter(number => number === 1 || number === pages || Math.abs(number - currentPage) <= 2).map(number => <button type="button" key={number} aria-label={`صفحة ${number}`} aria-current={currentPage === number ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button>)}
        <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>التالي</button></nav>
      <small>صفحة {currentPage} من {pages} · مجموع هذه الصفحة: {money(sumWorkbenchItems(shown).amount)}</small>
    </aside><section className="fw-panel fw-document-editor" aria-label="مراجعة المصروف">
      {(read.error || options.error) && <div className="fw-warning" role="alert">{read.error || options.error}</div>}
      {capture ? <FinanceExpenseForm key={`${kind}-${capture.requestId}`} kind={kind} requestId={capture.requestId} options={options} onCancel={() => { if (mayLeave()) { setCapture(null); setDirty(false); } }} onSaved={changed} onMessage={setMessage} onEdit={() => setDirty(true)} onBusy={setFormBusy} />
        : read.loading ? <LoadingState message="جارٍ قراءة المصدر والاعتماد والقيد..." />
          : read.data && !read.error ? <FinanceExpenseForm key={`${kind}-${sourceId}-${read.data.sourceHash}-${read.data.approved}-${read.data.workflowStage}`} kind={kind} detail={read.data} options={options} onSaved={changed} onReload={refresh} onMessage={setMessage} onEdit={() => setDirty(true)} onBusy={setFormBusy} />
            : <p>اختر مستندًا أو سجّل مستندًا جديدًا. أخطاء القراءة لا تعني عدم وجود مستندات.</p>}
    </section></div>
    {bulkOpen && <ModalSurface className="fw-page fw-workbench fw-bulk-modal" onClose={() => { if (!bulkBusy) setBulkOpen(false); }}><h2>اعتماد مجموعة مستندات</h2>
      {!bulkResult ? <><p>ستعتمد {totalText(sumWorkbenchItems(selection))}. لن يُرحّل أو يُدفع أي مستند.</p><p>نعيد التحقق من كل نسخة، ونستخدم نفس اعتماد المستند المفرد. أي مستند تغير سيُتجاوز.</p>
        <label>سبب الاعتماد الجماعي<input value={reason} onChange={e => setReason(e.target.value)} disabled={bulkBusy} /></label>
        <label className="fw-bulk-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={bulkBusy} /> راجعت المستندات المحددة وأؤكد اعتماد نسخها الحالية فقط.</label>
        {bulkError && <p role="alert">{bulkError}</p>}<div className="fw-actions"><button type="button" className="fw-primary" disabled={bulkBusy || !confirmed || reason.trim().length < 3} onClick={approveBulk}>{bulkBusy ? 'جارٍ التحقق والاعتماد…' : 'تأكيد الاعتماد الجماعي'}</button>
          <button type="button" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>إلغاء</button></div></> : <><p role="status">تم التحقق من اعتماد {bulkResult.verified.length}. متجاوز: {bulkResult.skipped.length}. غير مؤكد: {bulkResult.uncertain.length}. لم تبدأ محاولته: {bulkResult.unattempted.length}.</p>
          {bulkResult.uncertain.length > 0 && <p className="fw-warning">توقفت المجموعة عند نتيجة غير مؤكدة. أعد قراءة المستند قبل أي محاولة جديدة.</p>}
          {[...bulkResult.skipped, ...bulkResult.uncertain].map(item => <p key={documentKey(item)}>{item.title}: {item.reason}</p>)}
          <button type="button" onClick={() => setBulkOpen(false)}>إغلاق النتيجة</button></>}
    </ModalSurface>}
  </main></>;
}
