import { useEffect, useMemo, useRef } from 'react';
import { useOverviewDashboard } from '../hooks/useOverviewDashboard';
import { bikerBreakEven } from '../lib/breakEven';
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
    const key = result.status !== 'ready' ? result.status : JSON.stringify([result.value.total, result.value.allocatedTotal,
      result.value.rows.map(r => [r.bikerId, r.cost, r.washes, r.washDays, r.activeDays]), result.value.outside.length, result.value.unlinkedWashes]);
    if (sent.current === key) return;
    sent.current = key;
    onResult(result);
  }, [result, onResult]);
  return null;
}

export const BREAK_EVEN_COLUMNS = 6;

export function BreakEvenHeaders() {
  const th = 'py-3 px-4 whitespace-nowrap text-left tabular-nums';
  return <>
    <th className={th} title={`الراتب من مسير الشهر. ${UNLINKED}`}>التكاليف المباشرة</th>
    <th className={th} title="التكاليف غير المربوطة ببايكر، موزعة بالتساوي على أيام الأهلية في المسير">نصيبه من الثابتة</th>
    <th className={th} title={`(المباشرة + نصيبه من الثابتة) ÷ سعر الغسلة قبل الضريبة ${settings.washNetPrice}`}>المطلوب شهريًا</th>
    <th className={th} title={`المطلوب شهريًا ÷ أيام العمل (أيام الشهر − ${settings.monthlyDaysOff} إجازة، بالتناسب للشهر الجزئي)`}>المطلوب يوميًا</th>
    <th className={th} title="غسلاته في الأيام المكتملة ÷ الأيام التي غسل فيها">الفعلي يوميًا</th>
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
  if (!row) return Array.from({ length: BREAK_EVEN_COLUMNS }, (_, i) => <td key={i} className={`${td} text-slate-400`} title="غير مدرج في مسير الشهر، فلا تكاليف له هنا">—</td>);
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
    <td className={td} title={`${formatNumber(row.washes)} غسلة ÷ ${formatNumber(row.washDays)} يوم غسيل مكتمل`}>{row.actualDaily == null ? 'لا غسلات' : two(row.actualDaily)}</td>
    <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums">
      {row.coverage == null ? '—' : <span className={`inline-block rounded-control px-2 py-0.5 text-xs font-semibold ${TONES[row.tone]}`}>{formatNumber(Math.round(row.coverage * 100))}%</span>}
    </td>
  </>;
}

export function BreakEvenReconciliation({ state, monthLabel }) {
  if (state?.status === 'loading') return <p className="mt-4 text-xs text-slate-500">جارٍ حساب نقطة التعادل…</p>;
  if (state?.status !== 'ready') return <p className="mt-4 text-xs text-slate-500">نقطة التعادل لكل بايكر غير متاحة لحين تأكيد مصروفات الشهر ومسير الرواتب والغسلات.</p>;
  const r = state.value;
  const balanced = r.difference === 0;
  return <section className="mt-4 rounded-card border border-slate-100 p-4 text-sm dark:border-slate-800" aria-label="مطابقة نقطة التعادل">
    <h3 className="font-semibold text-slate-800 dark:text-slate-200">نقطة التعادل — {monthLabel}</h3>
    <p className={`mt-1 font-semibold ${balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} role={balanced ? undefined : 'alert'}>
      مجموع تكاليف البايكرية {formatCurrencyPrecise(r.allocatedTotal)} {balanced ? '=' : '≠'} إجمالي مصروفات الشهر {formatCurrencyPrecise(r.total)} · الفرق {formatCurrencyPrecise(r.difference)}
    </p>
    <p className="mt-1 text-slate-600 dark:text-slate-400">
      المباشرة المسجلة (الرواتب) {formatCurrencyPrecise(r.directTotal)} + المشتركة {formatCurrencyPrecise(r.shared)} · متوسط المطلوب يوميًا لكل بايكر {r.averageRequiredDaily == null ? '—' : two(r.averageRequiredDaily)} غسلة
      {r.estimated && ' · الرواتب تقديرية حتى اعتماد المسير'}
    </p>
    {r.approximateTotal > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">مبالغ تقريبية غير مسجلة لمن لا تكاليف مباشرة لهم: {formatCurrencyPrecise(r.approximateTotal)} — لا تدخل في المطابقة.</p>}
    {r.unlinkedWashes > 0 && <p className="mt-1 text-slate-600 dark:text-slate-400">غسلات بلا بايكر مرتبط: {formatNumber(r.unlinkedWashes)}</p>}
    {r.outside.length > 0 && <p className="mt-1 text-slate-600 dark:text-slate-400">لهم غسلات وليسوا في المسير: {r.outside.map(o => `${o.name} (${formatNumber(o.washes)})`).join('، ')}</p>}
    <p className="mt-2 text-xs text-slate-500">
      {UNLINKED} سعر الغسلة {formatCurrencyPrecise(settings.washNetPrice)} · الطاقة {formatNumber(settings.dailyAppointmentsPerBiker)} غسلات/يوم · أيام الإجازة الشهرية: {formatNumber(settings.monthlyDaysOff)} · التوزيع بالتساوي.
      التغطية: الأخضر من 100%، الأصفر 80–99%، الأحمر تحت 80%.
    </p>
  </section>;
}
