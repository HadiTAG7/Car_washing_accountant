import { useState } from 'react';
import TopBar from './TopBar';
import { useSupervisorRecords } from '../hooks/useSupervisor';
import { SUPERVISOR_COLLECTIONS } from '../lib/supervisorAccess';

const labels = { id: 'معرّف السجل', name: 'الاسم', name_ar: 'الاسم العربي', name_en: 'الاسم الإنجليزي', start_date: 'المباشرة', end_date: 'نهاية العمل',
  quantity: 'الكمية', price: 'السعر', status: 'الحالة', wash_date: 'تاريخ الغسلة', biker_name: 'العامل', biker_id: 'معرّف العامل',
  amount: 'المبلغ', description: 'الوصف', entryDate: 'تاريخ القيد', entryNumber: 'رقم القيد', periodKey: 'الشهر', lines: 'سطور القيد',
  expense_name: 'اسم المصروف', logged_date: 'تاريخ الصرف', invoice_date: 'تاريخ الفاتورة', invoice_number: 'رقم الفاتورة' };
const valueText = value => typeof value === 'number' && !Number.isFinite(value) ? 'غير متاح' : value === null || value === undefined || value === '' ? 'غير مذكور' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
export function SupervisorRecords({ collection, onCollectionChange, data, loading, error, onRetry, onNext, onFirst }) {
  return <main dir="rtl" className="p-4 sm:p-6 space-y-4 min-w-0">
    <h2 className="text-lg font-bold">بيانات العمل — قراءة فقط</h2>
    <label className="block text-sm">مجموعة البيانات<select aria-label="مجموعة البيانات" value={collection} onChange={e => onCollectionChange(e.target.value)} className="block w-full sm:w-auto min-h-11 border rounded-lg p-2 mt-1 bg-white dark:bg-slate-800">{Object.entries(SUPERVISOR_COLLECTIONS).map(([key, spec]) => <option key={key} value={key}>{spec.label}</option>)}</select></label>
    <p className="text-xs text-slate-600 dark:text-slate-300">النطاق: جميع التواريخ، بلا مرشح شهر. تعرض الصفحة 50 سجلًا كحد أقصى، مرتبة بمعرّف السجل. البيانات تقتصر على حقول العمل؛ هويات العمال وبيانات الدخول والمفاتيح خارج العرض.</p>
    <p className="text-xs text-slate-600 dark:text-slate-300">العرض ليس نسخة كاملة من الملفات: الملاحظات والأوصاف والأسباب الحرة محجوبة، وكذلك البنى المركبة غير المراجعة وتفاصيل الرواتب الفردية والمرفقات. أسماء العمال ومسميات العمل الضرورية فقط تظهر للتعريف بالسجلات.</p>
    {loading ? <p role="status">جارٍ قراءة الصفحة؛ عدد السجلات غير معروف بعد.</p> : error ? <div role="alert"><p>تعذّر قراءة هذه الصفحة؛ النتيجة غير متاحة.</p><button className="min-h-11 underline" onClick={onRetry}>إعادة القراءة</button></div> : data ? <>
      <p className="text-sm">سجلات الصفحة: {data.rows.length}. {data.hasMore ? 'توجد صفحات غير مفحوصة بعد.' : data.cursor ? 'هذه آخر صفحة؛ الصفحات السابقة مستقلة.' : 'اكتملت قراءة هذه المجموعة.'}</p>
      <p className="text-xs break-words">آخر قراءة: <span dir="ltr">{data.observedAt}</span></p>
      {data.rows.map(row => <details key={row.id} className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 p-3 sm:p-4">
        <summary className="min-h-11 cursor-pointer break-words font-semibold">{row.name || row.biker_name || row.expense_name || row.description || SUPERVISOR_COLLECTIONS[collection].label} — <span className="text-xs font-normal break-all">{row.id}</span></summary>
        <dl className="text-sm space-y-3 pt-3">{Object.entries(row).map(([field, value]) => <div key={field}><dt className="font-semibold">{labels[field] || field}</dt><dd className="whitespace-pre-wrap break-words mt-1 text-slate-600 dark:text-slate-300">{valueText(value)}</dd></div>)}</dl>
      </details>)}
      {data.rows.length === 0 && <p role="status">لم ترجع الصفحة سجلات؛ لا يمثل ذلك قيمة مالية أو نتيجة فترة.</p>}
      <div className="flex gap-3 flex-wrap"><button className="min-h-11 rounded-lg border px-4 disabled:opacity-40" disabled={!data.cursor} onClick={onFirst}>الصفحة الأولى</button><button className="min-h-11 rounded-lg border px-4 disabled:opacity-40" disabled={!data.nextCursor} onClick={onNext}>الصفحة التالية</button></div>
    </> : <p role="status">البيانات غير متاحة.</p>}
  </main>;
}
export default function SupervisorRecordsPage() {
  const [selection, setSelection] = useState({ collection: 'bikers', cursor: null });
  const { data, loading, error, refetch } = useSupervisorRecords(selection.collection, selection.cursor);
  return <><TopBar title="بيانات العمل" subtitle="سجلات للقراءة فقط" hidePartnerSelector /><SupervisorRecords collection={selection.collection} onCollectionChange={collection => setSelection({ collection, cursor: null })} data={data} loading={loading} error={error} onRetry={refetch} onFirst={() => setSelection(s => ({ ...s, cursor: null }))} onNext={() => setSelection(s => ({ ...s, cursor: data?.nextCursor || null }))} /></>;
}
