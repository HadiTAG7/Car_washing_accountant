import { useState } from 'react';
import { Card, SectionHeader, SecondaryButton } from './UI';
import { callSweaterImportPreview, callSweaterOwnerHandoffSave, describeBackendError } from '../lib/firebaseClient';
import { HANDOFF_MAX_BYTES, reviewSweaterHandoff } from '../lib/sweater/handoff';
import SweaterWashWorkerSummary from './SweaterWashWorkerSummary';

export default function SweaterHandoffPreview() {
  const [text, setText] = useState('');
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const change = value => { setText(value); setReview(null); setResult(null); setConfirmed(false); setSaveConfirmed(false); setError(''); };
  const readFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > HANDOFF_MAX_BYTES) { change(''); setError('حد الملف ٢ ميغابايت.'); return; }
    try { change(await file.text()); } catch { setError('ما قدرنا نقرأ الملف.'); }
  };
  const reviewLocal = () => {
    setResult(null); setConfirmed(false); setSaveConfirmed(false); setError('');
    try { setReview(reviewSweaterHandoff(JSON.parse(text))); }
    catch { setReview(null); setError('الملف ليس JSON صالحاً؛ لا تضع بيانات الدخول في الملف.'); }
  };
  const preview = async () => {
    if (!review?.ready || !confirmed || busy) return;
    setBusy(true); setError(''); setResult(null); setSaveConfirmed(false);
    try { setResult(await callSweaterImportPreview(review.payload)); }
    catch (err) { setError(describeBackendError(err)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!result?.canSave || result.saved || !saveConfirmed || !review?.ready || busy) return;
    setBusy(true); setError('');
    try { setResult(await callSweaterOwnerHandoffSave({ payload: review.payload,
      reviewedPayloadHash: result.reviewedPayloadHash, previewStateHash: result.previewStateHash })); }
    catch (err) { setError(describeBackendError(err)); setResult(null); setSaveConfirmed(false); }
    finally { setBusy(false); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'sweater-dry-run-review.json'; link.click(); URL.revokeObjectURL(url);
  };
  return <Card className="p-4 sm:p-5 space-y-4">
    <SectionHeader title="مراجعة ملف SSP ومعاينة الاستيراد" subtitle="المعاينة لا تحفظ؛ حفظ الغسلات بإقرار المالك يأتي بعدها دون ترحيل" />
    <p className="text-sm text-slate-600 dark:text-slate-300">المنسق يقرأ SSP من جلسته، ويسلّم JSON بلا كوكيز أو رموز دخول أو بيانات عملاء. إذا نوع الخدمة مو ظاهر، اتركه ناقصًا؛ ما نستنتجه من رقم الحجز.</p>
    <label className="block text-sm">ملف JSON<input type="file" accept=".json,application/json" onChange={readFile} disabled={busy} className="block mt-2 max-w-full" /></label>
    <label className="block text-sm">بيانات التسليم<textarea value={text} onChange={event => change(event.target.value)} disabled={busy}
      rows={6} dir="ltr" spellCheck={false} className="mt-2 w-full rounded-control border border-slate-200 dark:border-slate-700 bg-transparent p-3 font-mono text-xs" /></label>
    <SecondaryButton onClick={reviewLocal} disabled={!text.trim() || busy}>راجع الملف محليًا</SecondaryButton>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {review && <div className="space-y-3 text-sm" aria-label="نتيجة المراجعة المحلية">
      <p className="font-bold">{review.ready ? 'الملف جاهز للمعاينة فقط' : 'الملف غير جاهز؛ ما راح ينرسل'}</p>
      <p>عدد صفوف التسليم: {review.rows.length}</p>
      {review.errors.map((message, index) => <p key={index} className="text-red-700 dark:text-red-300">{message}</p>)}
      {review.warnings.map((message, index) => <p key={index} className="text-amber-700 dark:text-amber-300">{message}</p>)}
      {review.rows.filter(row => row.problems.length).map(row => <div key={row.index}>
        <p className="font-semibold">صف {row.index}: {row.sspBookingId}</p>
        {row.problems.map((problem, index) => <p key={index}>{problem.message}</p>)}
      </div>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!review.ready || busy} />
        راجعت الصفحات ونوع الخدمة من المصدر، دون تخمين</label>
      <SecondaryButton onClick={preview} disabled={!review.ready || !confirmed || busy}>
        {busy ? 'نحمّل المعاينة...' : 'معاينة dryRun على الخادم'}
      </SecondaryButton>
    </div>}
    {result && <div className="space-y-3 text-sm" aria-label="نتيجة dryRun">
      <p className="font-bold">{result.saved ? 'تم حفظ الغسلات وإقرار المالك دون ترحيل أو صرف عمولة' : 'معاينة فقط — ما تم استيراد أو ترحيل'}</p>
      <p>جديد: {result.counts.new} · معدل: {result.counts.modified} · مكرر: {result.counts.duplicate} · مرفوض: {result.counts.rejected} · يحتاج مراجعة: {result.counts.needsReview}</p>
      {result.previousRun && <p>المعرّف مستخدم سابقًا بنفس السجلات؛ هذه قراءة فقط، مو إعادة استيراد.</p>}
      {[...(result.coverageIssues || []), ...(result.reviewWarnings || [])].map((message, index) => <p key={index} className="text-amber-700 dark:text-amber-300">{message}</p>)}
      <div className="overflow-x-auto"><table className="w-full text-sm" aria-label="تصنيف سجلات المعاينة"><thead><tr><th>الحجز</th><th>النتيجة</th><th>الملاحظة</th></tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={index}><td className="py-2">{row.sspBookingId}</td><td>{row.outcome}</td><td>{row.reasonAr || '—'}</td></tr>)}</tbody></table></div>
      <p className="break-all text-xs">بصمة الملف المراجع: {result.reviewedPayloadHash}</p>
      {result.ownerConfirmation && <>
        <SweaterWashWorkerSummary washes={result.rows.map(row => ({ id: row.washId,
          bikerId: row.bikerId, bikerName: row.bikerName, sspBookingId: row.sspBookingId,
          washDate: row.serviceDate, quantity: 1, price: row.assertedAmount, status: 'مكتملة',
          revenueOrigin: 'sweater', collectionStatus: row.collectionStatus, workerCommissionPerWash: row.workerCommission }))} />
        <p>{result.ownerConfirmation.ownerName}: {result.ownerConfirmation.statement}</p>
        {!result.saved && <>
          <label className="flex items-start gap-2"><input type="checkbox" checked={saveConfirmed}
            onChange={event => setSaveConfirmed(event.target.checked)} disabled={!result.canSave || busy} />
            راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي</label>
          <SecondaryButton onClick={save} disabled={!result.canSave || !saveConfirmed || busy}>
            {busy ? 'نحفظ الغسلات...' : 'حفظ الغسلات بإقرار المالك'}
          </SecondaryButton>
        </>}
      </>}
      <SecondaryButton onClick={download}>تنزيل نتيجة المعاينة</SecondaryButton>
    </div>}
  </Card>;
}
