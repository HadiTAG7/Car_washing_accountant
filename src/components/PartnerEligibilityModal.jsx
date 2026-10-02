import { useEffect, useState } from 'react';
import { X, Users } from 'lucide-react';
import ModalSurface from './ModalSurface';
import { callPartnerEligibilityGet, callPartnerEligibilitySet, describeBackendError } from '../lib/firebaseClient';

export default function PartnerEligibilityModal({ partner, onClose, onSaved }) {
  const [config, setConfig] = useState(null);
  const [periodKey, setPeriodKey] = useState('');
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    callPartnerEligibilityGet({ partnerId: partner.id }).then(data => {
      if (!live) return;
      setConfig(data); setPeriodKey(data.currentMonth); setCount(String(data.current.eligibleWorkers)); setError('');
    }).catch(e => { if (live) setError(describeBackendError(e)); });
    return () => { live = false; };
  }, [partner.id, reload]);

  function chooseMonth(month) {
    setPeriodKey(month);
    const active = config.changes.filter(row => row.periodKey <= month).sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0];
    setCount(String(active?.eligibleWorkers ?? config.current.originalWorkers));
  }
  async function save(event) {
    event.preventDefault();
    if (busy || !config || count === '') return;
    setBusy(true); setError('');
    try {
      await callPartnerEligibilitySet({ partnerId: partner.id, periodKey, eligibleWorkers: Number(count), reason, expectedRevision: config.revision });
      onSaved?.();
    } catch (e) { setError(describeBackendError(e)); }
    finally { setBusy(false); }
  }
  const original = config?.current.originalWorkers ?? partner.workersCount;
  const eligible = count === '' ? null : Number(count);
  const valid = config && periodKey >= config.currentMonth && Number.isInteger(eligible) && eligible >= 0 && eligible <= original && reason.trim();
  return <ModalSurface onClose={() => { if (!busy) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center" >
    <div className="relative w-full max-w-xl mx-4 my-4 max-h-[92vh] overflow-y-auto p-5 sm:p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-card border border-slate-200 dark:border-slate-700">
    <div className="flex justify-between items-start gap-3 mb-5">
      <div><h2 className="text-lg font-bold flex items-center gap-2"><Users size={20} /> أهلية البايكرز للتشغيل</h2><p className="text-sm mt-1 text-slate-500 dark:text-slate-400">{partner.partnerName} — إدارة خاصة بالأدمن</p></div>
      <button type="button" aria-label="إغلاق" onClick={onClose} disabled={busy} className="sw-tap p-2 rounded-control"><X size={20} /></button>
    </div>
    {!config && !error && <p role="status">جارٍ تحميل إعدادات الشريك…</p>}
    {error && <div role="alert" className="p-3 mb-4 rounded-control bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"><p>{error}</p><button type="button" disabled={busy} className="underline mt-2" onClick={() => { setConfig(null); setReload(n => n + 1); }}>إعادة تحميل الإعدادات</button></div>}
    {config && <form onSubmit={save} className="space-y-4">
      <p className="text-sm p-3 rounded-control bg-slate-50 dark:bg-slate-800">العدد الأصلي: <strong>{original} بايكر</strong>. رأس المال ورسوم التأسيس لا يتغيران.</p>
      <label className="block text-sm font-semibold">يسري من شهر
        <input required type="month" min={config.currentMonth} value={periodKey} onChange={e => chooseMonth(e.target.value)} className="mt-2 w-full rounded-control border border-slate-300 dark:border-slate-600 bg-transparent p-3" disabled={busy} />
      </label>
      <label className="block text-sm font-semibold">عدد البايكرز المؤهلين
        <input required type="number" min="0" max={original} step="1" value={count} onChange={e => setCount(e.target.value)} className="mt-2 w-full rounded-control border border-slate-300 dark:border-slate-600 bg-transparent p-3" disabled={busy} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>الموقوف مؤقتاً: <strong>{Number.isInteger(eligible) && eligible >= 0 && eligible <= original ? original - eligible : '—'} بايكر</strong></span><button type="button" className="underline text-primary-700 dark:text-primary-300" disabled={busy} onClick={() => setCount(String(original))}>إعادة العدد الكامل</button></div>
      <label className="block text-sm font-semibold">سبب التغيير — للأدمن فقط
        <textarea required maxLength={500} rows={2} value={reason} onChange={e => setReason(e.target.value)} className="mt-2 w-full rounded-control border border-slate-300 dark:border-slate-600 bg-transparent p-3" disabled={busy} />
      </label>
      <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">يستمر هذا العدد حتى تعديل لاحق. الإيرادات والمصاريف التشغيلية تتوزع حسب العدد المؤهل لكل شريك. الشريك يرى عدده فقط، وباقي الشركاء لا يرون تعطيله أو سببه. الأشهر السابقة والمقفلة لا تُعدّل.</p>
      {config.changes.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">سجل التغييرات الخاص</summary><ul className="space-y-2 mt-3">{config.changes.map(row => <li key={row.periodKey} className="p-2 rounded-control bg-slate-50 dark:bg-slate-800"><strong>{row.periodKey} — {row.eligibleWorkers} مؤهل</strong><p className="break-words">{row.reason}</p></li>)}</ul></details>}
      <div className="flex gap-3 pt-2"><button type="submit" disabled={!valid || busy} className="sw-tap flex-1 p-3 rounded-control bg-primary-700 text-white font-bold disabled:opacity-50">{busy ? 'جارٍ الحفظ…' : 'حفظ أهلية التشغيل'}</button><button type="button" onClick={onClose} disabled={busy} className="sw-tap p-3 rounded-control border border-slate-300 dark:border-slate-600">إلغاء</button></div>
    </form>}
    </div>
  </ModalSurface>;
}
