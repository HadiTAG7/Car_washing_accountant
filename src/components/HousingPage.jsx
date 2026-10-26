import { useMemo, useState } from 'react';
import { Home, Users, BedDouble, AlertTriangle, Wallet, RefreshCw, Pencil } from 'lucide-react';
import { useLanguage } from '../i18n/useLanguage';
import { displayBikerName } from '../lib/bikerNames';
import { riyadhToday } from '../lib/bikerProfile';
import { housingOverview, housingBikerHref } from '../lib/housingOverview';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import EditHousingUnitModal from './EditHousingUnitModal';
import ModalSurface from './ModalSurface';
import { useBikers } from '../hooks/useBikers';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useAllStartupEntries } from '../hooks/useStartupCostEntries';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { useAllAnnualEntries } from '../hooks/useAnnualExpenseEntries';
import { useHousingUnits } from '../hooks/useHousingUnits';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

const financialHref = '?page=annual';
const value = n => n === null ? 'غير متاح' : formatCurrencyPrecise(n);
const count = n => n === null ? 'غير مسجلة' : formatNumber(n);

function HousingConfirmation({ request, onCancel, onConfirm, busy, error }) {
  const [confirmed, setConfirmed] = useState(false);
  return <ModalSurface onClose={busy ? undefined : onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
    <form onSubmit={e => { e.preventDefault(); if (confirmed && !busy) onConfirm(); }} className="bg-white dark:bg-slate-900 rounded-card p-6 w-full max-w-lg space-y-4">
      <h2 className="text-lg font-bold">{request.title}</h2>
      <p>{request.description}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">تاريخ النهاية لا يلغي السكن تلقائيًا. هذا التغيير يخص ربط السكن فقط.</p>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />أؤكد تنفيذ تغيير السكن الموضح</label>
      {error && <p role="alert" className="text-rose-600 dark:text-rose-300">{error.message || 'تعذّر تنفيذ العملية'}</p>}
      <div className="flex flex-wrap gap-3"><button className="sw-button sw-button--primary" disabled={!confirmed || busy}>تأكيد تغيير السكن</button>
        <button type="button" className="sw-button sw-button--secondary" disabled={busy} onClick={onCancel}>إلغاء دون تغيير</button></div>
    </form>
  </ModalSurface>;
}

export default function HousingPage() {
  const { language } = useLanguage();
  const bikerState = useBikers(), startupState = useStartupCosts(), setupState = useAllStartupEntries();
  const annualState = useAnnualExpenses(), rentState = useAllAnnualEntries(), metaState = useHousingUnits();
  const { canMutate, role } = usePartnerView();
  const canConfirmResidence = canMutate && role === 'admin';
  const [editingUnit, setEditingUnit] = useState(null), [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false), [mutationError, setMutationError] = useState(null);
  const states = [bikerState,startupState,setupState,annualState,rentState,metaState];
  const loading = states.some(s => s.loading), error = states.find(s => s.error)?.error;
  const today = riyadhToday();
  const model = useMemo(() => housingOverview({ items: startupState.items, entries: setupState.entries,
    bikers: bikerState.bikers, annualItems: annualState.items, annualEntries: rentState.entries, metaRows: metaState.metaRows, today }),
  [startupState.items,setupState.entries,bikerState.bikers,annualState.items,rentState.entries,metaState.metaRows,today]);
  const refresh = () => states.forEach(s => s.refetch?.());
  const residents = model.rows.reduce((n,u) => n + u.residents.length,0);
  const inactive = model.rows.reduce((n,u) => n + u.inactive.length,0);
  const capacityKnown = model.rows.every(u => u.capacity !== null);
  const capacity = capacityKnown ? model.rows.reduce((n,u) => n + u.capacity,0) : null;
  const vacant = capacityKnown ? model.rows.reduce((n,u) => n + u.vacant,0) : null;
  const nameOf = b => displayBikerName(b,language);
  const propose = (biker, destination) => {
    setMutationError(null);
    setRequest({ biker, destination, originalResidence: biker.residence || '',
      title: destination ? 'تأكيد إسناد السكن' : 'اقتراح إخلاء السكن',
      description: destination ? `${nameOf(biker)} ← ${destination}` : `${nameOf(biker)} — ${biker.residence} — سيصبح بلا سكن مرتبط بعد تأكيدك.` });
  };
  async function confirm() {
    if (!canConfirmResidence || !request || busy) return;
    const current = bikerState.bikers.find(b => b.id === request.biker.id);
    if (!current || (current.residence || '') !== request.originalResidence) {
      setMutationError(new Error('تغير سكن البايكر؛ أغلق الاقتراح وراجع البيانات الجديدة.')); return;
    }
    setBusy(true); setMutationError(null);
    try { await bikerState.updateBiker(current.id,{ residence: request.destination }); setRequest(null); }
    catch (e) { setMutationError(e); }
    finally { setBusy(false); }
  }
  return <>
    <TopBar title="السكن" subtitle="الإشغال الفعلي، وتكاليف السكن، وعقود الإيجار" />
    <main className="p-4 sm:p-6 lg:p-8 space-y-5">
      <SectionHeader title="وضع السكن" subtitle={`قراءة ${today} · من سجل البايكر والمصاريف المسجلة`}
        action={<button type="button" onClick={refresh} className="sw-button sw-button--secondary"><RefreshCw size={14}/>تحديث البيانات</button>} />
      {loading ? <LoadingState message="جارٍ تحميل بيانات السكن..." /> : error ? <ErrorState title="تعذّر تحميل بيانات السكن" error={error} onRetry={refresh}/> : <>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard icon={Home} label="السعة الكلية" value={count(capacity)} sub={`${model.rows.length} سكنات`} />
          <StatCard icon={Users} label="الساكنون النشطون" value={count(residents-inactive)} sub={`${residents} مرتبطًا بالسكن في السجل`} />
          <StatCard icon={AlertTriangle} tone={inactive ? 'amber':'slate'} label="يحتاج إخلاء" value={count(inactive)} sub="اقتراحات للمراجعة؛ لا إخلاء تلقائي" />
          <StatCard icon={BedDouble} label="أسرّة غير مرتبطة" value={count(vacant)} sub="لا تشمل أسرّة غير النشطين قبل تأكيد إخلائهم" />
        </div>
        <Card className="p-4 space-y-2">
          <h2 className="font-bold">تنبيهات السكن</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">الخلو محسوب من السعة ناقص كل المرتبطين. يلزم التحقق الميداني قبل تسكين ساكن جديد.</p>
          {model.alerts.map(a => <p key={`${a.kind}:${a.unit}`} className="text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={14} className="inline ml-1"/>
            {a.kind === 'due' ? <a href={financialHref}>{a.unit}: دفعة إيجار {value(a.amount)} · {a.date} · {a.days<0?'متأخرة':`خلال ${a.days} أيام`}</a>
              : a.kind === 'inactive' ? <a href={`#housing-${encodeURIComponent(a.unit)}`}>{a.unit}: {a.count} يحتاجون مراجعة الإخلاء</a>
              : <a href="#housing-unhoused">{a.unit} ممتلئ، ويوجد {a.count} بايكر نشط بلا سكن معروف</a>}</p>)}
          {!model.alerts.length && <p>ما فيه تنبيهات إشغال</p>}
          {model.rows.some(u=>!u.nextPayment) && <p className="text-sm text-amber-700 dark:text-amber-300">لا يمكن تأكيد دفعات خلال 30 يومًا للسكنات التي ينقصها جدول دفعات.</p>}
        </Card>
        {!model.rows.length && <EmptyState icon={Home} title="لا سكنات معرَّفة بعد" hint="أضف السكنات إلى بنود التجهيز أو بيانات السكن."/>}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          {model.rows.map(u => <Card key={u.key} id={`housing-${u.name}`} className="p-4 sm:p-5 space-y-4 min-w-0">
            <SectionHeader title={u.name} action={canMutate && <button type="button" aria-label={`تعديل بيانات ${u.name}`} onClick={() => setEditingUnit(u)} className="sw-button sw-button--secondary"><Pencil size={14}/></button>}/>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="السعة" number={count(u.capacity)}/><Metric label="الساكنون النشطون" number={count(u.active.length)}/>
              <Metric label="غير نشطين · يحتاج إخلاء" number={count(u.inactive.length)} warning={u.inactive.length>0}/><Metric label="أسرّة غير مرتبطة فعليًا" number={count(u.vacant)}/>
            </dl>
            {u.overCapacity && <p className="text-rose-600 dark:text-rose-300">عدد المرتبطين أكبر من السعة المسجلة</p>}
            {u.inactive.length>0 && <p className="text-xs text-slate-500 dark:text-slate-400">بعد تأكيد الإخلاء قد تتاح {count(u.afterEviction)} أسرّة؛ ليست متاحة مؤكدًا الآن.</p>}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <h3 className="font-bold text-sm mb-2">التكلفة الشهرية</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm"><Metric label="الإيجار الشهري" number={value(u.monthly)}/><Metric label="للساكن النشط شهريًا" number={value(u.perActiveMonthly)}/>
                <Metric label="التجهيز · مرة واحدة" number={value(u.cost)}/><Metric label="دفعات إيجار مسجلة" number={value(u.recorded)}/></dl>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">الشهري = قيمة العقد السنوية ÷ 12. التجهيز منفصل ولا يُضاف إلى تكلفة الشهر.</p>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <h3 className="font-bold text-sm mb-2">عقد الإيجار</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm"><Metric label="المبلغ السنوي" number={value(u.annual)}/><Metric label="مدفوع بإثبات مسجل" number={value(u.unconfirmed && !u.paid ? null : u.paid)}/>
                <Metric label="المتبقي من العقد" number={value(u.remaining)}/><Metric label="الدفعة القادمة" number={u.nextPayment?.date || 'غير مسجلة'}/></dl>
              {u.contract && <p className="text-xs mt-2">الفترة: <span dir="ltr">{u.contract.from} — {u.contract.to}</span></p>}
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">ناقص: {u.missing.join('، ')}.</p>
              <a className="text-sm text-primary-700 dark:text-primary-300 underline mt-2 inline-block" href={financialHref}>تفاصيل الإيجار والدفعات</a>
              <details className="mt-2 text-xs"><summary className="cursor-pointer">مصادر العقد والتكلفة</summary>
                <p className="my-2">التجهيز: {u.entryCount} مستندات مسندة لهذا السكن.</p>
                {u.payments.map(e => <div key={e.id} className="py-2 border-t border-slate-200 dark:border-slate-700 break-words space-y-1">
                  <p>{e.description} · {value(e.amount)} · {e.spentDate}</p>
                  {e.housingEvidence?.purpose && <p className="leading-relaxed">{e.housingEvidence.purpose}</p>}
                  {e.invoiceUrl && <a className="underline" href={e.invoiceUrl} target="_blank" rel="noreferrer">فتح مستند الإيجار</a>}
                </div>)}
                {!u.payments.length && <p>لا دفعات مسندة لهذا السكن</p>}
              </details>
            </div>
            <details open={u.inactive.length>0} className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <summary className="cursor-pointer font-bold text-sm">الساكنون ({u.residents.length})</summary>
              <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
                {[...u.inactive,...u.active].map(b => { const needs=u.inactive.includes(b); return <li key={b.id} className="py-2 space-y-1 text-sm">
                  <div className="flex flex-wrap justify-between gap-2"><a href={housingBikerHref(b.id)} className="underline" translate="no" dir="auto">{nameOf(b)}</a>
                    {needs && <span className="text-amber-700 dark:text-amber-300">يحتاج إخلاء</span>}</div>
                  {needs && <p className="text-xs text-slate-500 dark:text-slate-400">{b.currentStatus}{b.endDate ? ` · نهاية العمل: ${b.endDate}` : ''}</p>}
                  {canConfirmResidence && <button type="button" className="text-xs text-primary-700 dark:text-primary-300 underline" onClick={() => propose(b,'')}>{needs ? 'مراجعة اقتراح الإخلاء':'مراجعة إخلاء السكن'}</button>}
                </li>; })}
              </ul>
            </details>
            {u.notes && <p className="text-sm whitespace-pre-wrap">{u.notes}</p>}
          </Card>)}
        </div>
        <Card className="p-4 space-y-2">
          <h2 className="font-bold flex items-center gap-2"><Wallet size={16}/>مصادر التكلفة والبيانات الناقصة</h2>
          {model.sharedPlans.map(p => <p key={p.id} className="text-sm">{p.expenseName}: {value(p.annualCost)} ميزانية سنوية مشتركة؛ لا تُقسم بالتساوي على السكنات.</p>)}
          <p className="text-sm">تجهيز غير مسند لسكن: {value(model.setupUnassigned)} · إيجار غير مسند: {value(model.rentUnassigned)}.</p>
          <p className="text-sm">قيمة العقد من وصف العقد المراجع متى كانت صريحة. الدفعات المسجلة وحدها لا تثبت قيمة الإيجار السنوي.</p>
        </Card>
        <Card id="housing-unhoused" className="p-4">
          <SectionHeader title="نشطون بلا سكن معروف" subtitle={`${model.unhoused.length} بايكر؛ لا تشمل الهاربين أو من انتهى عمله`}/>
          {!model.unhoused.length ? <p className="text-sm">كل البايكرية النشطين مرتبطون بسكن</p> : <ul className="space-y-3">{model.unhoused.map(b => <li key={b.id} className="flex flex-wrap gap-3 items-center justify-between">
            <a className="underline" href={housingBikerHref(b.id)}>{nameOf(b)}</a><span className="text-xs">{b.residence || 'لم يُذكر سكن'}</span>
            {canConfirmResidence && <select aria-label={`اقتراح سكن ${nameOf(b)}`} value="" onChange={e => e.target.value && propose(b,e.target.value)} className="p-2 rounded-control bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600">
              <option value="">اختر سكنًا للمراجعة</option>{model.rows.filter(u => u.vacant>0).map(u => <option key={u.key} value={u.name}>{u.name} · {u.vacant} أسرّة غير مرتبطة</option>)}
            </select>}
          </li>)}</ul>}
        </Card>
      </>}
    </main>
    {editingUnit && canMutate && <EditHousingUnitModal isOpen unit={editingUnit} onClose={() => setEditingUnit(null)} onSave={patch => metaState.upsertUnitMeta(editingUnit.name,patch)}/>}
    {request && canConfirmResidence && <HousingConfirmation key={`${request.biker.id}:${request.destination}`} request={request} busy={busy} error={mutationError} onCancel={() => setRequest(null)} onConfirm={confirm}/>}
  </>;
}

function Metric({ label, number, warning = false }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt><dd className={`font-bold mt-1 tabular-nums break-words ${warning?'text-amber-700 dark:text-amber-300':''}`}>{number}</dd></div>;
}
