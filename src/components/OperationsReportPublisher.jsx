import { useContext, useRef, useState } from 'react';
import { Upload, ShieldCheck } from 'lucide-react';
import { parseOperationsReport } from '../lib/operationsReportContract';
import { callOperationsApi } from '../lib/operationsApi';
import { LanguageContext } from '../i18n/LanguageContext';
export default function OperationsReportPublisher({ onPublished, canPublish = false }) {
  const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState('');
  const selection = useRef(0), language = useContext(LanguageContext);
  async function load(event) {
    const version = ++selection.current;
    setError(''); setReport(null); const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 102400) { setError('ملف التقرير أكبر من الحد المسموح.'); return; }
    try {
      const content = file.text ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file);
      });
      const parsed = parseOperationsReport(JSON.parse(content));
      if (version === selection.current) setReport(parsed);
    } catch (e) { if (version === selection.current) setError(e instanceof SyntaxError ? 'ملف التقرير غير صالح؛ اختر التقرير المراجع.' : e.message); }
  }
  async function publish() {
    if (!report || !canPublish || uncertain || busy) return;
    setBusy(true); setError('');
    try {
      const result = await callOperationsApi('operations-reports', { action: 'save', report, expectedRevision: report.revision - 1 });
      if (result?.reportId !== report.reportId || result?.revision !== report.revision || typeof result?.duplicate !== 'boolean') throw new Error('إيصال الحفظ غير متحقق.');
      const after = await callOperationsApi('operations-reports', { action: 'read', reportId: report.reportId, revision: report.revision });
      if (JSON.stringify(parseOperationsReport(after.report)) !== JSON.stringify(report)) throw new Error('لم تتطابق قراءة التقرير المحفوظ؛ اقرأ الأرشيف قبل الإعادة.');
      setNotice(`تمت مطابقة النسخة المحفوظة: ${result.reportId} / ${result.revision}${result.duplicate ? ' — موجودة مسبقًا دون تكرار' : ''}`);
      setReport(null); onPublished(result.reportId);
    } catch (e) { setUncertain(true); setError(`${e.message} لا تعِد الحفظ قبل قراءة المعرف في الأرشيف.`); }
    finally { setBusy(false); }
  }
  async function resolveUncertain() {
    if (!report || busy) return;
    setBusy(true); setError('');
    try {
      const after = await callOperationsApi('operations-reports', { action: 'read', reportId: report.reportId });
      if (after?.report) {
        const stored = parseOperationsReport(after.report);
        if (stored.reportId !== report.reportId) throw new Error('معرف القراءة غير مطابق.');
        setNotice(`قُرئت النسخة الحالية ${stored.revision}. راجعها قبل أي إعادة أو تصحيح؛ القراءة ليست حفظًا جديدًا.`);
        onPublished(stored.reportId);
      } else if (after?.report === null) setNotice('قُرئ الأرشيف: لا نسخة محفوظة بهذا المعرف. يمكنك مراجعة الملف ثم الحفظ مجددًا.');
      else throw new Error('قراءة غير متحققة.');
      setUncertain(false);
    } catch (e) { setError(`${e.message} ما زال الحفظ معطلًا حتى تنجح القراءة.`); }
    finally { setBusy(false); }
  }
  return <details className="fw-panel"><summary><Upload size={16} /> إضافة تقرير مراجع</summary>
    <p>المراجعة المكتملة شرط للحفظ. التصحيح نسخة جديدة بسبب واضح؛ لا يستبدل التاريخ. لا تنفذ هذه الخطوة أي عملية تشغيلية.</p>
    <label>ملف التقرير المراجع من فريق العمليات<input type="file" accept="application/json,.json" onChange={load} disabled={busy || uncertain} /></label>
    {error && <p className="fw-warning" role="alert">{error}</p>}
    {notice && <p role="status" className="fw-success">{notice}</p>}
    {!canPublish && <p className="fw-warning">الحفظ معطل حتى تنجح قراءة الأرشيف ويثبت دور الأدمن الحالي.</p>}
    {uncertain && <button type="button" disabled={busy} onClick={resolveUncertain}>قراءة النسخة قبل إعادة الحفظ</button>}
    {report && <LanguageContext.Provider value={{ ...language, language: 'ar' }}><section aria-label="معاينة التقرير قبل النشر"><h2><ShieldCheck size={18} />{report.title}</h2><p>{report.summary}</p>
      <p>{report.period.from || 'غير موثق'} — {report.period.to || 'غير موثق'} · {report.cutAtRiyadh || 'وقت القطع غير موثق بدقة'} · النسخة {report.revision}</p>
      <p>تاريخ الخدمة: {report.serviceDateRiyadh || 'غير موثق'} · الجولة {report.round} · {report.archiveMode === 'historical_imported' ? 'أرشيف تاريخي منقول، ليس حالة حالية' : 'تقرير حالي مراجع'}</p>
      {report.historicalImported && <p className="fw-warning">{report.historicalImported.timeNote} — دقة القطع: {report.historicalImported.cutPrecision} · آخر يوم دليل: {report.historicalImported.evidenceThroughDate}</p>}
      {report.visibleWarnings.map(w => <p className="fw-warning" key={w.id}>{w.text}</p>)}
      <p>مرجع المراجعة: {report.review.sourceRef} · {report.review.at}</p>
      <button type="button" className="fw-primary" disabled={busy || uncertain || !canPublish} onClick={publish}>{busy ? 'جارٍ الحفظ والتحقق...' : 'نشر التقرير المراجع والتحقق من حفظه'}</button>
    </section></LanguageContext.Provider>}
  </details>;
}
