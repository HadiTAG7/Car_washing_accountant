import { useEffect, useMemo, useRef } from 'react';
import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { bikerBreakEven } from '../lib/breakEven';
import { displayBikerName } from '../lib/bikerNames';
import { OVERVIEW_SETTINGS as settings } from '../config/overviewSettings';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

// Break-even per biker for the bikers register: the overview's own statement,
// payroll preview and washes, so the figures match the overview to the halala.

const two = value => formatNumber(Math.round(value * 100) / 100);
const TONES = {
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  yellow: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};
const UNLINKED = 'السكن والدباب والتأمين والبنزين والجوال والإقامة والرسوم ليس لها حقل بايكر في القاعدة، فهي ضمن التكاليف المشتركة.';
const washersBasis = basis => basis === 'washers';

/** Reads the month once and hands the result up; mounted only for roles that may read payroll. */
export function BikerBreakEvenLoader({ periodKey, today, onResult }) {
  const data = useOverviewDashboard(periodKey, today);
  const lines = data.payroll?.data?.find(p => p.periodKey === periodKey && !p.unavailable)?.lines;
  const { finance, operations, washes, workers, payroll } = data;
  const result = useMemo(() => {
    if (finance.loading || payroll?.loading || washes.loading) return { status: 'loading' };
    if (!finance.statement || !lines || !operations || operations.conflicts.length) return { status: 'unavailable' };
    const value = bikerBreakEven({ statement: finance.statement, payrollLines: lines, washes: operations.rows, bikers: workers.bikers, periodKey, today });
    return value && !value.error ? { status: 'ready', value } : { status: 'unavailable' };
  }, [finance.loading, finance.statement, payroll?.loading, washes.loading, lines, operations, workers.bikers, periodKey, today]);
  // Hand up only a changed result: re-rendering the page re-renders this
  // loader, and an unchanged result must not set the page's state again.
  const sent = useRef(null);
  useEffect(() => {
    const v = result.value;
    const key = result.status !== 'ready' ? result.status : JSON.stringify([v.basis, v.total, v.allocatedTotal,
      v.rows.map(r => [r.bikerId, r.cost, r.washes, r.washDays, r.activeDays, r.elapsedWorkDays, r.actualDaily]), v.idle.rows.map(r => [r.bikerId, r.salary]), v.outside.length, v.unlinkedWashes]);
    if (sent.current === key) return;
    sent.current = key;
    onResult(result);
  }, [result, onResult]);
  return null;
}

export const BREAK_EVEN_COLUMNS = 7;

export function BreakEvenHeaders() {
  const th = 'py-3 px-4 whitespace-nowrap text-left tabular-nums';
  return <>
    <th className={th} title={`الراتب من مسير الشهر. ${UNLINKED}`}>التكاليف المباشرة</th>
    <th className={th} title={washersBasis(settings.bikerBreakEvenBasis)
      ? 'رواتب من لم يغسل والتكاليف غير المربوطة ببايكر، موزعة بالتساوي على أيام أهلية من غسلوا في المسير'
      : 'التكاليف غير المربوطة ببايكر، موزعة بالتساوي على أيام الأهلية في المسير'}>نصيبه من الثابتة</th>
    <th className={th} title={`(المباشرة + نصيبه من الثابتة) ÷ سعر الغسلة قبل الضريبة ${settings.washNetPrice}`}>المطلوب شهريًا</th>
    <th className={th} title={`المطلوب شهريًا ÷ أيام العمل (أيام الشهر − ${settings.monthlyDaysOff} إجازة، بالتناسب للشهر الجزئي)`}>المطلوب يوميًا</th>
    <th className={th} title="غسلاته ÷ أيام العمل المتاحة المنقضية بعد الإجازة النسبية؛ اليوم الجاري مستبعد">الفعلي يوميًا</th>
    <th className={th} title="عدد الأيام المكتملة التي سجل فيها غسلات؛ للمعلومة فقط">أيام الغسيل</th>
    <th className="py-3 px-4 whitespace-nowrap text-center" title="الفعلي ÷ المطلوب: الأخضر من 100%، الأصفر 80–99%، الأحمر تحت 80%">التغطية</th>
  </>;
}

export function BreakEvenCells({ state, bikerId }) {
  const td = 'py-3 px-4 whitespace-nowrap text-left tabular-nums';
  if (state?.status !== 'ready') {
    const label = state?.status === 'loading' ? '…' : '—';
    return Array.from({ length: BREAK_EVEN_COLUMNS }, (_, i) => <td key={i} className={`${td} text-slate-400`}>{label}</td>);
  }
  const row = state.value.rows.find(r => r.bikerId === bikerId);
  if (!row) {
    // Paid without a wash, outside the washers basis: the salary is shared by the washers.
    const idle = state.value.idle.rows.find(r => r.bikerId === bikerId);
    const title = idle ? `لا غسلات له في الأيام المكتملة من الشهر؛ راتبه ${formatCurrencyPrecise(idle.salary)} ضمن التكاليف المشتركة على من غسلوا`
      : 'غير مدرج في مسير الشهر، فلا تكاليف له هنا';
    return Array.from({ length: BREAK_EVEN_COLUMNS }, (_, i) => <td key={i} className={`${td} text-slate-400`} title={title}>{idle && i === 4 ? 'لا غسلات' : idle && i === 5 ? '0' : '—'}</td>);
  }
  return <>
    <td className={td} title={row.approximate
      ? `لا تكاليف مباشرة مسجلة له؛ استُخدم متوسط التكاليف المباشرة لكل يوم أهلية لبقية البايكرية (${formatCurrencyPrecise(row.approxDirect)} لـ${formatNumber(row.activeDays)} يومًا). المبلغ غير مسجل ولا يدخل في مطابقة الإجمالي.`
      : `الراتب من المسير: ${formatCurrencyPrecise(row.direct)}. ${UNLINKED}`}>
      {formatCurrencyPrecise(row.direct + row.approxDirect)}
      {row.approximate && <span className="mr-1 rounded-control bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">تقريبي</span>}
    </td>
    <td className={td} title={`أيام الأهلية في المسير: ${formatNumber(row.activeDays)} من ${formatNumber(row.monthDays)}`}>{formatCurrencyPrecise(row.share)}</td>
    <td className={td}>{two(row.requiredMonthly)}</td>
    <td className={td} title={`أيام العمل: ${two(row.workDays)}`}>
      {row.requiredDaily == null ? '—' : two(row.requiredDaily)}
      {row.overCapacity && <span className="mr-1 rounded-control bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
        title={`أكثر من الطاقة اليومية ${settings.dailyAppointmentsPerBiker} غسلات`}>فوق الطاقة</span>}
    </td>
    <td className={td} title={row.elapsedWorkDays == null || row.outsideAvailability ? 'فترة النشاط غير مؤكدة أو توجد غسلات خارجها؛ الفعلي غير متاح'
      : `${formatNumber(row.washes)} غسلة ÷ ${two(row.elapsedWorkDays)} يوم عمل متاح منقضٍ`}>{row.actualDaily == null ? '—' : two(row.actualDaily)}
      <small className="block text-[10px] text-slate-500">متوسط الغسلات في أيام الغسيل: {row.averagePerWashDay == null ? '—' : two(row.averagePerWashDay)}</small></td>
    <td className={td}>{formatNumber(row.washDays)}</td>
    <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums">
      {row.coverage == null ? '—' : <span className={`inline-block rounded-control px-2 py-0.5 text-xs font-semibold ${TONES[row.tone]}`}>{formatNumber(Math.round(row.coverage * 100))}%</span>}
    </td>
  </>;
}

/** Above the table: who is paid this month without a wash, and the daily break-even without them. */
export function IdleSalariesCard({ state, monthLabel }) {
  if (state?.status !== 'ready' || !state.value.idle.count) return null;
  const { idle, estimated, monthDays } = state.value;
  return <section className="mb-4 rounded-card border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10" aria-label="رواتب بايكرية بلا غسلات">
    <h3 className="font-semibold text-slate-800 dark:text-slate-200">رواتب بايكرية بلا غسلات</h3>
    <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-2">
      <div><dt className="text-xs text-slate-500 dark:text-slate-400">العدد</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(idle.count)}</dd></div>
      <div><dt className="text-xs text-slate-500 dark:text-slate-400">المبلغ</dt><dd className="text-lg font-semibold tabular-nums">{formatCurrencyPrecise(idle.salaries)}</dd></div>
      <div><dt className="text-xs text-slate-500 dark:text-slate-400">نقطة التعادل اليومية</dt><dd className="text-lg font-semibold tabular-nums">{two(idle.dailyRequired)} <span className="text-xs font-normal">غسلة/يوم</span></dd></div>
      <div><dt className="text-xs text-slate-500 dark:text-slate-400">بدونهم</dt><dd className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{two(idle.dailyWithout)} <span className="text-xs font-normal">غسلة/يوم</span></dd></div>
    </dl>
    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      في مسير {monthLabel} وليس لهم غسلة في يوم مكتمل من الشهر. نقطة التعادل اليومية = مصروفات الشهر ÷ سعر الغسلة {formatCurrencyPrecise(settings.washNetPrice)} ÷ أيام الشهر، وبدونهم تُطرح رواتبهم من المصروفات.
      {estimated && ' الرواتب تقديرية حتى اعتماد المسير.'}
    </p>
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-600 dark:text-slate-400">الأسماء</summary>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{idle.rows.map(r => <li key={r.bikerId} className="flex justify-between gap-3">
        <span translate="no" dir="auto">{r.biker ? displayBikerName(r.biker, 'ar') : r.name}</span>
        <span className="tabular-nums">{formatCurrencyPrecise(r.salary)}{r.activeDays < monthDays ? ` · ${formatNumber(r.activeDays)} يومًا` : ''}</span></li>)}</ul>
    </details>
  </section>;
}

export function BreakEvenReconciliation({ state, monthLabel }) {
  if (state?.status === 'loading') return <p className="mt-4 text-xs text-slate-500">جارٍ حساب نقطة التعادل…</p>;
  if (state?.status !== 'ready') return <p className="mt-4 text-xs text-slate-500">نقطة التعادل لكل بايكر غير متاحة لحين تأكيد مصروفات الشهر ومسير الرواتب والغسلات.</p>;
  const r = state.value;
  const washers = washersBasis(r.basis);
  const balanced = r.difference === 0;
  const carriers = washers ? `من غسلوا (${formatNumber(r.rows.length)})` : `البايكرية في المسير (${formatNumber(r.rows.length)})`;
  return <section className="mt-4 rounded-card border border-slate-100 p-4 text-sm dark:border-slate-800" aria-label="مطابقة نقطة التعادل">
    <h3 className="font-semibold text-slate-800 dark:text-slate-200">نقطة التعادل — {monthLabel}</h3>
    {r.rows.length === 0 && <p className="mt-1 text-slate-600 dark:text-slate-400">{washers ? 'لا يوجد بايكر في المسير سجّل غسلة في يوم مكتمل من الشهر بعد؛ لا توزيع.' : 'لا يوجد بايكر في مسير الشهر؛ لا توزيع.'}</p>}
    <p className={`mt-1 font-semibold ${balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} role={balanced ? undefined : 'alert'}>
      مجموع تكاليف {carriers} {formatCurrencyPrecise(r.allocatedTotal)} {balanced ? '=' : '≠'} إجمالي مصروفات الشهر {formatCurrencyPrecise(r.total)} · الفرق {formatCurrencyPrecise(r.difference)}
    </p>
    <p className="mt-1 text-slate-600 dark:text-slate-400">
      رواتبهم {formatCurrencyPrecise(r.directTotal)} + المشتركة {formatCurrencyPrecise(r.shared)}
      {washers && r.idle.count > 0 && ` (منها رواتب بلا غسلات ${formatCurrencyPrecise(r.idle.salaries)})`}
      {' · '}متوسط المطلوب يوميًا لكل بايكر {r.averageRequiredDaily == null ? '—' : two(r.averageRequiredDaily)} غسلة
      {r.estimated && ' · الرواتب تقديرية حتى اعتماد المسير'}
    </p>
    {r.approximateTotal > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">مبالغ تقريبية غير مسجلة لمن لا تكاليف مباشرة لهم: {formatCurrencyPrecise(r.approximateTotal)} — لا تدخل في المطابقة.</p>}
    {r.unlinkedWashes > 0 && <p className="mt-1 text-slate-600 dark:text-slate-400">غسلات بلا بايكر مرتبط: {formatNumber(r.unlinkedWashes)}</p>}
    {r.outside.length > 0 && <p className="mt-1 text-slate-600 dark:text-slate-400">لهم غسلات وليسوا في المسير: {r.outside.map(o => `${o.name} (${formatNumber(o.washes)})`).join('، ')}</p>}
    <p className="mt-2 text-xs text-slate-500">
      {washers ? 'الأساس: تكلفة الشهر كاملة (رواتب الكل والتكاليف الثابتة) على من سجّل غسلة في يوم مكتمل من الشهر، بالتناسب مع أيام المسير. «حسب المسير» خيار في الإعدادات.'
        : 'الأساس: كل من في مسير الشهر، بالتناسب مع أيام المسير.'}
    </p>
    <p className="mt-1 text-xs text-slate-500">
      {UNLINKED} سعر الغسلة {formatCurrencyPrecise(settings.washNetPrice)} · الطاقة {formatNumber(settings.dailyAppointmentsPerBiker)} غسلات/يوم · أيام الإجازة الشهرية: {formatNumber(settings.monthlyDaysOff)} · التوزيع بالتساوي.
      التغطية: الأخضر من 100%، الأصفر 80–99%، الأحمر تحت 80%.
    </p>
  </section>;
}
