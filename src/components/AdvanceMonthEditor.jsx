import { useState } from 'react';
import ModalSurface from './ModalSurface';
import { callAdvanceMonthPreview, callAdvanceMonthSave, describeBackendError } from '../lib/firebaseClient';
import { OWNER_ADVANCE_MONTH_PLAN as PLAN, isAssignmentMonth } from '../lib/advanceMonth';
import { formatCurrency } from '../data/initialData';
export default function AdvanceMonthEditor({ expense, ownerCorrection = false, onClose, onSaved }) {
  const [month, setMonth] = useState(expense?.assignmentMonth || '');
  const [reason, setReason] = useState(''); const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const payload = ownerCorrection ? { mode: PLAN.mode } : { mode: 'single', id: expense.id, assignmentMonth: month, reason };
  async function act(save) {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = save ? await callAdvanceMonthSave({ ...payload, previewHash: review.previewHash }) : await callAdvanceMonthPreview(payload);
      setReview(result); if (result.saved) await onSaved(result);
    } catch (e) { setError(describeBackendError(e)); setReview(null); }
    finally { setBusy(false); }
  }
  const change = setter => event => { setter(event.target.value); setReview(null); };
  return <ModalSurface onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
    <section role="dialog" aria-modal="true" aria-label="إسناد شهر السلفة" className="bg-white dark:bg-slate-900 rounded-card p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
      <h2 className="font-bold text-lg">إسناد شهر السلفة</h2>
      <p className="text-sm">يتغير شهر الإسناد فقط؛ المبلغ وتاريخ الصرف وحالة الدين والاسترداد تبقى محفوظة.</p>
      {ownerCorrection ? <p className="text-sm">{PLAN.reason}</p> : <>
        <p>{expense.title}</p><label className="block">شهر إسناد السلفة<input type="month" value={month} onChange={change(setMonth)} disabled={busy} className="block border rounded-control p-2 bg-white dark:bg-slate-800" /></label>
        <label className="block">سبب تعديل الإسناد<input value={reason} onChange={change(setReason)} disabled={busy} className="block w-full border rounded-control p-2 bg-white dark:bg-slate-800" /></label>
      </>}
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {review && <div className="space-y-2 text-sm">
        <p>{review.count} سجل · إجمالي {formatCurrency(review.amount)} · معلق {formatCurrency(review.pendingAmount)}</p>
        <p>{review.saved ? 'حُفظ إسناد الشهر مع سجل التدقيق' : 'معاينة فقط؛ لم تتغير البيانات'}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[540px] [&_td]:p-2 [&_th]:p-2"><thead><tr><th>البند</th><th>تاريخ الصرف</th><th>الشهر الحالي</th><th>الشهر المطلوب</th><th>المبلغ</th></tr></thead><tbody>{review.rows.map(row => <tr key={row.id}><td>{row.title}<small className="block" dir="ltr">{row.id}</small></td><td>{row.spentDate}</td><td>{row.beforeMonth}</td><td>{row.assignmentMonth}</td><td>{formatCurrency(row.amount)}</td></tr>)}</tbody></table></div>
      </div>}
      <div className="flex flex-wrap gap-2">
        {!review?.saved && <button className="sw-button sw-button--secondary" disabled={busy || (!ownerCorrection && (!isAssignmentMonth(month) || !reason.trim()))} onClick={() => act(false)}>معاينة إسناد الشهر</button>}
        {review?.canSave && !review.saved && <button className="sw-button sw-button--primary" disabled={busy} onClick={() => act(true)}>حفظ إسناد الشهر المراجع</button>}
        <button className="sw-button sw-button--secondary" disabled={busy} onClick={onClose}>إغلاق</button>
      </div>
    </section>
  </ModalSurface>;
}
