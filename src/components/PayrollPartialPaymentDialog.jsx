import { useState } from 'react';
import { Card } from './UI';
import DateField from './DateField';
import { formatCurrencyPrecise } from '../data/initialData';
import { describeBackendError } from '../lib/firebaseClient';
const INPUT = 'w-full rounded-control border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800';
export default function PayrollPartialPaymentDialog({ run, items, api, onClose, onRecorded }) {
  const [bikerIds, setIds] = useState([]);
  const [paymentMethod, setMethod] = useState('');
  const [payDate, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [paymentReference, setReference] = useState('');
  const [preview, setPreview] = useState(null);
  const [review, setReview] = useState({ advances: [], legacy: [] });
  const [reconciledAdvances, setReconciled] = useState([]);
  const [reconciliationConfirmed, setReconciliationConfirmed] = useState(false);
  const [unrelatedLegacyPayments, setUnrelated] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (setter, value) => { setter(value); setPreview(null); setConfirmed(false); setError(''); };
  const payload = () => ({ runId: run.runId, bikerIds, paymentMethod, payDate, recordedNetAmount: Number(amount), reason: reason.trim(), paymentReference: paymentReference.trim(), ...(reconciledAdvances.length ? { reconciledAdvances } : {}), ...(unrelatedLegacyPayments.length ? { unrelatedLegacyPayments } : {}) });
  const ready = bikerIds.length > 0 && paymentMethod && payDate && amount !== '' && Number(amount) >= 0 && reason.trim() && reconciledAdvances.every(row => bikerIds.includes(row.bikerId)) && (!reconciledAdvances.length || reconciliationConfirmed);
  const invoke = async record => {
    setBusy(true); setError('');
    try {
      if (record) {
        const result = await api.recordPartialPayment({ ...payload(), previewHash: preview.previewHash, recordedExternally: true, ...(reconciledAdvances.length ? { confirmAdvanceReconciliation: reconciliationConfirmed } : {}) });
        await onRecorded(result);
      } else { const result = await api.previewPartialPayment(payload()); setPreview(result); setReview({ advances: result.recoveryCandidates || [], legacy: result.historicalPayments || [] }); }
    } catch (error) { setError(describeBackendError(error) || error.message); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/70" role="dialog" aria-modal="true" aria-label="تسجيل دفعة لعمال محددين">
    <Card className="w-full max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4">
      <h3 className="text-lg font-bold">تسجيل دفعة لعمال محددين</h3>
      <p className="text-xs text-slate-500">يسجل سدادًا تم خارج النظام. يعتمد مبالغ الصفوف المحفوظة، ولا يعيد احتساب رواتب المصروفين أو يسدد بقية العمال.</p>
      <fieldset disabled={busy} className="space-y-2"><legend className="font-semibold text-sm mb-2">اختر العمال من المسير المحفوظ</legend>
        {items.map(item => <label key={item.bikerId} className="flex items-start gap-3 border-b border-slate-100 py-2 text-sm">
          <input type="checkbox" aria-label={`تحديد ${item.name}`} disabled={!['draft', 'approved'].includes(item.status)} checked={bikerIds.includes(item.bikerId)} onChange={event => change(setIds, event.target.checked ? [...bikerIds, item.bikerId] : bikerIds.filter(id => id !== item.bikerId))} />
          <span className="min-w-0"><span translate="no" className="font-semibold">{item.name}</span><span className="block text-[10px]" dir="ltr" translate="no">{item.bikerId}</span>
            <span className="block text-xs text-slate-500">الصافي المحفوظ {formatCurrencyPrecise(item.netDue)}{item.status === 'paid' ? ' · مصروف سابقًا' : ''}</span></span>
        </label>)}
      </fieldset>
      <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs">طريقة السداد الفعلية<select aria-label="طريقة السداد الفعلية" className={INPUT} value={paymentMethod} onChange={event => change(setMethod, event.target.value)}><option value="">اختر طريقة السداد</option><option value="cash">نقدي من الصندوق</option><option value="bank">بنكي</option></select></label>
        <label className="text-xs">تاريخ السداد الفعلي<DateField ariaLabel="تاريخ السداد الفعلي" value={payDate} onChange={event => change(setDate, event.target.value)} /></label>
        <label className="text-xs">صافي المبلغ المدفوع فعلاً<input aria-label="صافي المبلغ المدفوع فعلاً" type="number" min="0" step="0.01" className={INPUT} value={amount} onChange={event => change(setAmount, event.target.value)} /></label>
        <label className="text-xs">مرجع السداد<input aria-label="مرجع السداد" className={INPUT} value={paymentReference} onChange={event => change(setReference, event.target.value)} /></label>
        <label className="text-xs sm:col-span-2">بيان الدفعة — إلزامي<textarea aria-label="بيان الدفعة" className={INPUT} value={reason} onChange={event => change(setReason, event.target.value)} /></label>
      </fieldset>
      {review.advances.length > 0 && <fieldset disabled={busy} className="space-y-2 border rounded-control p-3"><legend className="text-sm font-bold">مطابقة سلف مستردة خُصمت من الراتب</legend>
        <p className="text-xs text-slate-500">اختر معرّف السلفة والعامل فقط إذا كان الاسترداد المسجل يمثل خصم راتب، ولم تُرد السلفة نقدًا. السلف المرحّلة أو المخصومة سابقًا غير مؤهلة.</p>
        {review.advances.map(row => { const mapping = reconciledAdvances.find(r => r.advanceId === row.advanceId); return <div key={row.advanceId} className="border-b py-2 space-y-1">
          <label className="flex gap-2 text-xs"><input type="checkbox" aria-label={`مطابقة سلفة ${row.advanceId}`} disabled={!row.eligible} checked={Boolean(mapping)} onChange={event => { change(setReconciled, event.target.checked ? [...reconciledAdvances, { advanceId: row.advanceId, bikerId: row.bikerId || '' }] : reconciledAdvances.filter(r => r.advanceId !== row.advanceId)); setReconciliationConfirmed(false); }} /><span><span translate="no">{row.title}</span> · {formatCurrencyPrecise(row.amount)}<span className="block" translate="no" dir="ltr">{row.advanceId} · {row.recoveredDate}</span>{!row.eligible && <span className="block text-red-700">غير مؤهلة: راجع الربط أو الاسترداد المرحّل أو السداد السابق</span>}</span></label>
          {mapping && <select aria-label={`عامل السلفة ${row.advanceId}`} className={INPUT} disabled={Boolean(row.bikerId)} value={mapping.bikerId} onChange={event => { change(setReconciled, reconciledAdvances.map(r => r.advanceId === row.advanceId ? { ...r, bikerId: event.target.value } : r)); setReconciliationConfirmed(false); }}><option value="">اختر العامل صراحةً</option>{items.filter(item => bikerIds.includes(item.bikerId)).map(item => <option key={item.bikerId} value={item.bikerId} translate="no">{item.name} · {item.bikerId}</option>)}</select>}
        </div>; })}
        {reconciledAdvances.length > 0 && <label className="flex gap-2 text-xs"><input type="checkbox" checked={reconciliationConfirmed} onChange={event => change(setReconciliationConfirmed, event.target.checked)} />أقر أن السلف المحددة خُصمت من راتب هؤلاء العمال ولم تُرد نقدًا</label>}
      </fieldset>}
      {review.legacy.some(row => row.confidence === 'needs_review') && <fieldset disabled={busy} className="space-y-2 border rounded-control p-3"><legend className="text-sm font-bold">مطابقة دفعات قديمة دون معرّفات عمال</legend><p className="text-xs text-slate-500">السداد المربوط بمعرّف العامل أو باسمه لا يمكن تجاوزه. أقر الاستبعاد فقط إن كانت الدفعة القديمة تخص عمالًا آخرين.</p>{review.legacy.filter(row => row.confidence === 'needs_review').map(row => { const key = `${row.collection}/${row.id}`; return <label key={key} className="flex gap-2 text-xs"><input type="checkbox" checked={unrelatedLegacyPayments.includes(key)} onChange={event => change(setUnrelated, event.target.checked ? [...unrelatedLegacyPayments, key] : unrelatedLegacyPayments.filter(id => id !== key))} /><span>أؤكد أن هذا السجل لا يخص العمال المحددين: <span translate="no">{row.description} · {key}</span></span></label>; })}</fieldset>}
      <button disabled={!ready || busy} className="sw-button sw-button--sm sw-button--secondary" onClick={() => invoke(false)}>معاينة الدفعة المحددة</button>
      {preview && <div className="space-y-3 border rounded-control p-3 text-sm">
        <p>العمال المحددون: {preview.selectedCount} · الباقون دون سداد: {preview.remainingCount}</p>
        <div className="overflow-x-auto"><table className="w-full text-xs" aria-label="مكونات الدفعة المحددة"><thead><tr>{['العامل', 'المعرّف', 'الإجمالي', 'الخصم', 'السلف', 'الصافي'].map(h => <th key={h} className="p-2 text-start">{h}</th>)}</tr></thead><tbody>{preview.lines.map(line => <tr key={line.bikerId}><td className="p-2" translate="no">{line.name}</td><td className="p-2" translate="no" dir="ltr">{line.bikerId}</td>{[line.gross, line.deduction, line.advanceDeduction, line.netDue].map((v,i) => <td key={i} className="p-2 whitespace-nowrap">{formatCurrencyPrecise(v)}</td>)}</tr>)}</tbody></table></div>
        <p>الإجمالي {formatCurrencyPrecise(preview.gross)} · السلف {formatCurrencyPrecise(preview.totals.advances)} · الصافي {formatCurrencyPrecise(preview.totals.net)}</p>
        {!preview.matchesRecordedAmount && <p role="alert" className="text-red-700">المبلغ المدفوع لا يطابق صافي الصفوف المحفوظة؛ راجع فروقات السلف قبل التسجيل.</p>}
        {preview.historicalPayments?.some(row => !row.confirmedUnrelated) && <div role="alert" className="text-red-700 space-y-2"><p>توجد أدلة سداد سابقة أو سجلات رواتب تحتاج مطابقة؛ لا يُسجل سداد جديد قبل المراجعة.</p>{preview.historicalPayments.map(row => <p key={`${row.collection}/${row.id}`} className="text-xs"><span translate="no">{row.description}</span> · <span dir="ltr" translate="no">{row.collection}/{row.id}</span> · {row.amount != null ? formatCurrencyPrecise(row.amount) : ''}</p>)}</div>}
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy || !preview.matchesRecordedAmount || preview.canRecord === false} onChange={event => setConfirmed(event.target.checked)} />أؤكد أن السداد تم خارج النظام بهذه الطريقة والتاريخ والمبلغ للعمال المحددين فقط</label>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2"><button className="sw-button sw-button--sm sw-button--primary" disabled={busy || !preview?.matchesRecordedAmount || preview?.canRecord === false || !confirmed} onClick={() => invoke(true)}>{busy ? 'جارٍ التنفيذ…' : 'تسجيل السداد الخارجي المحدد'}</button><button className="sw-button sw-button--sm sw-button--secondary" disabled={busy} onClick={onClose}>إلغاء</button></div>
    </Card>
  </div>;
}
