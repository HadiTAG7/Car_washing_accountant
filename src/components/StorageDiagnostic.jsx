import { useEffect, useState } from 'react';
import { inspectStorage, seedStorage } from '../lib/storageDiagnostic';
import LanguageSwitcher from './LanguageSwitcher';

const readTime = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const markerLabel = value => ({ present: 'موجود', absent: 'غير موجود', unavailable: 'غير متاح', unexpected: 'قيمة اختبار غير متوقعة' })[value];
export default function StorageDiagnostic() {
  const [result, setResult] = useState(null); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  useEffect(() => { let active = true; inspectStorage().then(value => { if (active) setResult(value); })
    .catch(() => { if (active) setError('تعذّر إكمال فحص التخزين.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; }; }, []);
  const run = async seed => { setBusy(true); setError(''); try { setResult(await (seed ? seedStorage() : inspectStorage())); }
    catch { setError('تعذّر إكمال فحص التخزين.'); } finally { setBusy(false); } };
  const download = () => { if (!result) return; const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'sweater-storage-diagnostic.json'; link.click(); URL.revokeObjectURL(url); };
  return <main className="max-w-3xl mx-auto p-4 sm:p-8 space-y-5 text-slate-900 dark:text-slate-100">
    <div className="flex justify-end"><LanguageSwitcher /></div>
    <h1 className="text-xl font-bold">تشخيص بقاء تخزين المتصفح</h1>
    <p>هذه الشاشة تختبر مؤشرات منفصلة غير سرية فقط. لا تقرأ سجلات Firebase أو رموز الدخول، ولا تغيّر المصادقة أو البيانات المالية، ولا ترسل نتائج خارج المتصفح.</p>
    <p>بعد الدخول المعتاد، احفظ الدليل وازرع المؤشرات مرة واحدة، ثم اقرأها وتأكد من وجود المؤشرين ونزّل الدليل. بعد الاستعادة الطبيعية افتح الرابط نفسه واقرأ النتائج قبل إعادة الزرع.</p>
    {busy && <p role="status">جارٍ فحص التخزين...</p>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p>وقت القراءة بتوقيت الرياض: <time dir="ltr">{readTime(result.current.readAt)}</time></p>
      <p>النتائج الحالية التُقطت قبل زرع أي مؤشر جديد. وجود المؤشرات لا يثبت صلاحية جلسة الدخول.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-start"><caption className="text-start font-bold mb-2">المؤشرات المقروءة قبل الزرع</caption>
        <thead><tr><th className="text-start p-2">المخزن</th><th className="text-start p-2">القراءة</th><th className="text-start p-2">الكتابة</th><th className="text-start p-2">المؤشر</th></tr></thead>
        <tbody>{['localStorage', 'indexedDB'].map(name => <tr key={name}><td className="p-2" dir="ltr">{name}</td><td className="p-2">{result.current[name].readable ? 'متاحة' : 'غير متاحة'}</td>
          <td className="p-2">{result.current[name].writable ? 'متاحة' : 'غير متاحة'}</td><td className="p-2">{markerLabel(result.current[name].marker)}</td></tr>)}</tbody></table></div>
      {result.evidenceSaved === true && <p role="status">حُفظ دليل ما قبل الزرع أولًا، ثم تمت محاولة زرع المؤشرات.</p>}
      {result.evidenceSaved === false && <p role="alert">لم يمكن حفظ الدليل؛ لم تُزرع أي مؤشرات. نزّل النتائج للاحتفاظ بها.</p>}
      {result.seeded && <p>زرع localStorage: {result.seeded.localStorage ? 'تم' : 'لم يتم'} · زرع IndexedDB: {result.seeded.indexedDB ? 'تم' : 'لم يتم'}</p>}
      <h2 className="font-bold">القراءات المحفوظة قبل الزرع</h2>
      <p>السجل محلي ويحتفظ بآخر 20 قراءة. نزّل النتائج قبل أي استعادة للاحتفاظ بالدليل خارج هذه الصفحة.</p>
      {!result.history.length ? <p>لا توجد قراءات محفوظة بعد.</p> : <ul className="space-y-2">{result.history.map((row, index) => <li key={index} className="text-sm border rounded p-3">
        <time dir="ltr">{readTime(row.readAt)}</time><p>localStorage: {markerLabel(row.localStorage.marker)} · IndexedDB: {markerLabel(row.indexedDB.marker)}</p></li>)}</ul>}
    </>}
    <div className="flex flex-wrap gap-3">
      <button className="sw-button sw-button--secondary" disabled={busy} onClick={() => run(false)}>قراءة المؤشرات دون إعادة زرع</button>
      <button className="sw-button sw-button--primary" disabled={busy || !result} onClick={() => run(true)}>حفظ الدليل ثم زرع المؤشرات</button>
      <button className="sw-button sw-button--secondary" disabled={busy || !result} onClick={download}>تنزيل دليل التخزين</button>
    </div>
    <a href="/" className="inline-block underline">العودة إلى الموقع</a>
  </main>;
}
