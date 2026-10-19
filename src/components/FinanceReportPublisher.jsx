import { useContext, useRef, useState } from 'react';
import { Upload, ShieldCheck } from 'lucide-react';
import { parseFinanceReport } from '../lib/financeReportContract';
import { callFinanceApi } from '../lib/financeApi';
import { LanguageContext } from '../i18n/LanguageContext';
export default function FinanceReportPublisher({ onPublished }) {
  const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const selection = useRef(0), language = useContext(LanguageContext);
  async function load(event) {
    const version = ++selection.current;
    setError(''); setReport(null); const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 102400) { setError('ملف التقرير أكبر من الحد المسموح.'); return; }
    try {
      const content = file.text ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file);
      });
      const parsed = parseFinanceReport(JSON.parse(content));
      if (version === selection.current) setReport(parsed);
    } catch (e) { if (version === selection.current) setError(e instanceof SyntaxError ? 'ملف التقرير غير صالح؛ اختر التقرير المراجع.' : e.message); }
  }
  async function publish() {
    setBusy(true); setError('');
    try {
      const result = await callFinanceApi('finance-reports', { action: 'save', report, expectedRevision: report.revision - 1 });
      const after = await callFinanceApi('finance-reports', { action: 'read', reportId: report.reportId, revision: report.revision });
      if (JSON.stringify(parseFinanceReport(after.report)) !== JSON.stringify(report)) throw new Error('لم تتطابق قراءة التقرير المحفوظ؛ اقرأ الأرشيف قبل الإعادة.');
      setReport(null); onPublished(result.reportId);
    } catch (e) { setError(`${e.message} لا تعِد الحفظ قبل قراءة المعرف في الأرشيف.`); }
    finally { setBusy(false); }
  }
  return <details className="fw-panel"><summary><Upload size={16} /> إضافة تقرير مراجع</summary>
    <p>المراجعة المكتملة شرط للحفظ. التصحيح نسخة جديدة بسبب واضح؛ لا يستبدل التاريخ. لا تنفذ هذه الخطوة أي معاملة مالية.</p>
    <label>ملف التقرير المراجع من فريق المالية<input type="file" accept="application/json,.json" onChange={load} disabled={busy} /></label>
    {error && <p className="fw-warning" role="alert">{error}</p>}
    {report && <LanguageContext.Provider value={{ ...language, language: 'ar' }}><section aria-label="معاينة التقرير قبل النشر"><h2><ShieldCheck size={18} />{report.title}</h2><p>{report.summary}</p>
      <p>{report.period.from} — {report.period.to} · {report.cutAtRiyadh} · النسخة {report.revision}</p>
      {report.visibleWarnings.map(w => <p className="fw-warning" key={w.id}>{w.text}</p>)}
      <p>مرجع المراجعة: {report.review.sourceRef} · {report.review.at}</p>
      <button type="button" className="fw-primary" disabled={busy} onClick={publish}>{busy ? 'جارٍ الحفظ والتحقق...' : 'نشر التقرير المراجع والتحقق من حفظه'}</button>
    </section></LanguageContext.Provider>}
  </details>;
}
