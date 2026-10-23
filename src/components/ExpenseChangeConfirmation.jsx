import { useState } from 'react';
import ModalSurface from './ModalSurface';
export default function ExpenseChangeConfirmation({ request, onFinish }) {
  const [reason, setReason] = useState(''), [checked, setChecked] = useState(false);
  if (!request) return null;
  return <ModalSurface onClose={() => onFinish(null)} className="fixed inset-0 z-[70] bg-slate-950/70 flex items-center justify-center p-4">
    <form role="dialog" aria-modal="true" aria-label="تأكيد تغيير المصروف" onSubmit={event => { event.preventDefault(); if (checked && (!request.reasonRequired || reason.trim().length >= 3)) onFinish({ confirmed: true, reason: reason.trim() }); }}
      className="bg-white dark:bg-slate-900 rounded-card p-6 w-full max-w-lg space-y-4">
      <h2 className="font-bold text-lg">{request.title}</h2><p className="break-words">{request.description}</p>
      <p className="text-sm">لن يتغير السجل إلا بعد التأكيد. تغيير الحالة ليس إثبات دفع، ولا ينشئ قيدًا.</p>
      {request.reasonRequired && <label className="block">سبب التعديل<textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="block w-full border rounded-control p-2 bg-white dark:bg-slate-800" required minLength={3} /></label>}
      <label className="flex gap-2 items-center"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />راجعت التغيير وأؤكد تنفيذه</label>
      <div className="flex gap-3"><button type="submit" className="sw-button sw-button--primary" disabled={!checked || (request.reasonRequired && reason.trim().length < 3)}>تأكيد التغيير</button><button type="button" className="sw-button sw-button--secondary" onClick={() => onFinish(null)}>إلغاء دون تغيير</button></div>
    </form>
  </ModalSurface>;
}
