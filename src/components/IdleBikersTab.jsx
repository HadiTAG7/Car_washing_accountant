import ScrollableTable from './ScrollableTable';
import DateField from './DateField';
import { useState } from 'react';
import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { useIdleBikersData } from '../hooks/useIdleBikersData';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useLanguage } from '../i18n/useLanguage';
import { Card } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import BikerProfileMonthPicker from './BikerProfileMonthPicker';
import { riyadhToday } from '../lib/bikerProfile';
import { IDLE_REASONS } from '../lib/idleBikers';
import { displayBikerName } from '../lib/bikerNames';
import { formatCurrencyPrecise, formatDate, formatNumber } from '../data/initialData';
import { callServer } from '../lib/ledgerTransport';
import { invalidateCollections } from '../lib/readCache';
import { fetchRows, where } from '../lib/firestoreCrud';

const auditTime = value => new Date(value).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' });
const number = n => n == null ? 'غير متاح' : formatNumber(Math.round(n * 100) / 100);
export default function IdleBikersTab({ role }) {
  const { isPartnerView } = usePartnerView();
  if (isPartnerView || !['admin', 'accountant'].includes(role)) return null;
  return <IdleContent />;
}

function IdleContent() {
  const { language } = useLanguage();
  const today = riyadhToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [followupOverrides, setFollowupOverrides] = useState({});
  const data = useOverviewDashboard(month, today);
  const state = useIdleBikersData(data, { periodKey: month, today, followupOverrides });
  const { canMutate } = usePartnerView();
  const value = state.value;
  return <section className="space-y-5" aria-label="الخاملين">
    <div className="flex flex-wrap gap-3 justify-between items-center"><div><h2 className="text-xl font-bold">الخاملين</h2><p className="text-sm text-slate-500 dark:text-slate-400">في مسير الشهر، بلا تاريخ نهاية، مع استبعاد الهاربين واللي مشيناهم.</p></div>
      <BikerProfileMonthPicker value={month} max={today.slice(0, 7)} language={language} onChange={setMonth} /></div>
    {state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={state.retry} /> : !value ? <p>تعذّر تأكيد قائمة الخاملين من المصادر الحالية.</p> : <>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {[["الخاملين", `${value.count} بايكر`, `${value.noWashes} ما غسل هالشهر · ${value.stopped} متوقف`],
          ['تكلفتهم في الشهر', formatCurrencyPrecise(value.salaries), state.estimated ? 'من المسير التقديري؛ لا تغيير في الرواتب' : 'من مسير الشهر'],
          ['التعادل اليومي معهم', number(value.dailyRequired), 'غسلة في اليوم · نفس حساب النظرة العامة'],
          ['التعادل اليومي بدونهم', number(value.dailyWithout), 'طرح تكلفتهم من مصروفات الشهر للمقارنة فقط']].map(([title, amount, note]) =>
          <Card className="p-5" key={title}><h3 className="text-sm text-slate-500 dark:text-slate-400">{title}</h3><strong className="block text-2xl mt-2 tabular-nums">{amount}</strong><p className="text-xs mt-2 text-slate-500 dark:text-slate-400">{note}</p></Card>)}
      </div>
      <Card className="p-5"><h3 className="font-bold">لو اشتغلوا بمتوسط الشغالين</h3>
        <p className="mt-2 text-lg font-bold">{number(value.forecast.additionalWashes)} غسلة إضافية تقريبًا · {value.forecast.additionalRevenue == null ? 'غير متاح' : formatCurrencyPrecise(value.forecast.additionalRevenue)}</p>
        <p className="text-sm mt-2 text-slate-500 dark:text-slate-400">تقدير لباقي الشهر من اليوم: {value.forecast.workingCount} بايكر شغّال، {number(value.forecast.workingWashes)} غسلة ÷ {number(value.forecast.workingDays)} يوم عمل متاح منقضٍ = {number(value.forecast.average)} غسلة لكل بايكر في يوم العمل.</p>
        <p className="text-sm mt-1 text-slate-500 dark:text-slate-400">المتوسط × {number(value.forecast.remainingDays)} يوم عمل متبقٍ للخاملين × {value.forecast.price} ريال قبل الضريبة. الإجازة النسبية محسوبة؛ التقدير ليس إيرادًا معتمدًا.</p>
      </Card>
      <div className="flex flex-wrap gap-3 text-sm" aria-label="تنبيهات الخمول"><span>بدون سبب: {value.alerts.missingReason}</span><span>تاريخ البدء المتوقع فات: {value.alerts.overdue}</span><span>خامل أكثر من 14 يوم: {value.alerts.over14Days}</span></div>
      <Card className="p-4"><p className="text-xs mb-4 text-slate-500 dark:text-slate-400">اليوم الجاري مستبعد. المتوقف لم يغسل في آخر 3 أيام مكتملة أو أكثر. تكلفة حتى اليوم تقدير نسبي من استحقاق المسير حتى أمس.</p>
        {!value.count ? <p>ما فيه بايكر خامل حسب التعريف الحالي.</p> : <ScrollableTable stickyIdentity identityColumn={1} className="overflow-x-auto"><table className="w-full min-w-[1500px] text-sm"><caption className="text-right font-bold mb-3">قائمة الخاملين</caption>
          <thead><tr>{['الاسم', 'Sweater ID', 'المباشرة', 'السكن', 'آخر غسلة', 'أيام بدون غسلات', 'تكلفة الشهر', 'التكلفة حتى أمس', 'السبب', 'يبدأ متوقعًا', 'الملاحظة والمتابعة'].map(title => <th className="p-3 text-right" key={title}>{title}</th>)}</tr></thead>
          <tbody>{value.rows.map(row => <IdleRow key={`${row.bikerId}:${row.followup.revision || 0}`} row={row} language={language} canMutate={canMutate} onSaved={(id, followup) => setFollowupOverrides(previous => ({ ...previous, [id]: followup }))} />)}</tbody>
        </table></ScrollableTable>}
      </Card>
      {value.excluded.length > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">لم يدخل الخاملين {value.excluded.length} من المسير: من انتهت خدمتهم أو يحتاجون تاريخ نهاية أو لم تبدأ مباشرتهم أو لم تتأكد فترة استحقاقهم. راجع قائمة «يحتاج تاريخ نهاية» للتفاصيل.</p>}
    </>}
  </section>;
}

function IdleRow({ row, language, canMutate, onSaved }) {
  const [reasonKey, setReason] = useState(row.reasonKey), [expectedStartDate, setDate] = useState(row.expectedStartDate), [note, setNote] = useState(row.note);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [history, setHistory] = useState(null), [historyError, setHistoryError] = useState('');
  const name = displayBikerName(row.biker, language);
  const changed = reasonKey !== row.reasonKey || expectedStartDate !== row.expectedStartDate || note !== row.note;
  const field = 'rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 w-full';
  async function save() {
    setBusy(true); setError('');
    try { const result = await callServer('bikerIdleFollowupSave', { bikerId: row.bikerId, expectedRevision: row.followup.revision || 0, reasonKey, expectedStartDate, note });
      invalidateCollections(['bikers', 'audit_logs']); onSaved(row.bikerId, result.followup); }
    catch (failure) { setError(failure.message || 'تعذّر حفظ المتابعة.'); }
    finally { setBusy(false); }
  }
  async function readHistory(event) {
    if (!event.currentTarget.open || history !== null) return;
    try { setHistoryError(''); const records = await fetchRows('audit_logs', [where('documentId', '==', row.bikerId)]);
      setHistory(records.filter(record => record.action === 'biker-idle-followup').sort((a, b) => String(b.atIso).localeCompare(String(a.atIso)))); }
    catch { setHistoryError('تعذّر تحميل سجل التعديلات.'); }
  }
  return <tr className="border-t border-slate-200 dark:border-slate-700 align-top"><th className="p-3 text-right min-w-40"><span translate="no">{name}</span><small className="block mt-1 text-slate-500">{row.category === 'no_washes' ? 'ما غسل هالشهر' : 'متوقف'}</small></th>
    <td className="p-3">{row.biker.driverExternalId || <span className="text-amber-600 dark:text-amber-400">غير مربوط بسويتر</span>}</td>
    <td className="p-3 whitespace-nowrap">{row.biker.startDate ? formatDate(row.biker.startDate) : 'غير مسجلة'}</td><td className="p-3">{row.biker.residence || 'غير مسجل'}</td>
    <td className="p-3 whitespace-nowrap">{row.lastWash ? formatDate(row.lastWash) : 'ما له غسلات مسجلة'}</td><td className="p-3 tabular-nums">{row.silentDays}{row.alerts.over14Days && <small className="block text-rose-500">أكثر من 14 يوم</small>}</td>
    <td className="p-3 whitespace-nowrap">{formatCurrencyPrecise(row.monthlyCost)}</td><td className="p-3 whitespace-nowrap">{formatCurrencyPrecise(row.costToDate)}</td>
    <td className="p-3 min-w-52"><select className={field} aria-label={`سبب خمول ${name}`} value={reasonKey} onChange={event => setReason(event.target.value)} disabled={!canMutate || busy}><option value="">اختر السبب</option>{IDLE_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{row.alerts.missingReason && <small className="text-amber-600 dark:text-amber-400">بدون سبب مسجل</small>}</td>
    <td className="p-3 min-w-44"><DateField id={`idle-date-${row.bikerId}`} name="expectedStartDate" className={field} ariaLabel={`تاريخ البدء المتوقع ${name}`} value={expectedStartDate} onChange={event => setDate(event.target.value)} disabled={!canMutate || busy} />{row.alerts.overdue && <small className="text-rose-500">تاريخ البدء المتوقع فات</small>}</td>
    <td className="p-3 min-w-72"><textarea className={field} aria-label={`ملاحظة ${name}`} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} disabled={!canMutate || busy} />
      {canMutate && <button type="button" className="sw-button sw-button--primary sw-button--sm mt-2" onClick={save} disabled={!changed || busy || (reasonKey === 'other' && !note.trim())}>{busy ? 'جارٍ الحفظ…' : 'احفظ المتابعة'}</button>}
      {error && <p role="alert" className="text-rose-500">{error}</p>}
      {row.followup.updatedAtIso && <small className="block mt-2 text-slate-500">آخر تعديل: {row.followup.updatedByName || row.followup.updatedBy} · <bdi>{auditTime(row.followup.updatedAtIso)}</bdi></small>}
      <details className="mt-2" onToggle={readHistory}><summary className="cursor-pointer">سجل التعديلات</summary>{historyError ? <p role="alert">{historyError}</p> : history === null ? <p>جارٍ القراءة…</p> : !history.length ? <p>ما فيه تعديلات مسجلة.</p> : history.map(record => <div className="border-t py-2" key={record.id}><bdi>{auditTime(record.atIso)}</bdi><p>{record.after?.updatedByName || record.userId}</p><p>{IDLE_REASONS.find(([key]) => key === record.after?.reasonKey)?.[1] || 'بدون سبب'} · {record.after?.expectedStartDate || 'بدون موعد'}</p><p>{record.after?.note}</p></div>)}</details>
    </td>
  </tr>;
}
