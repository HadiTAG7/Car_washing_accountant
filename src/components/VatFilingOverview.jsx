import { useMemo } from 'react';
import { Card, SectionHeader } from './UI';
import { formatCurrencyPrecise, formatDate, formatNumber } from '../data/initialData';
import { periodLabel, periodKeyFor } from '../lib/accounting/vatReturn';
import { buildVatDashboardReport, registeredVatPeriods, vatFilingDeadline, vatDaysRemaining, reportedVatFilings, TAX_FILING_REPORT_ID } from '../lib/vatDashboard';
import { useFinanceRead } from '../hooks/useFinanceRead';

export default function VatFilingOverview({ sources, settings, today, ready, scalingFactor = 1 }) {
  const read = useFinanceRead('finance-reports', { action: 'read', reportId: TAX_FILING_REPORT_ID, revision: 1 });
  const filings = reportedVatFilings(read.data?.report);
  const periods = useMemo(() => registeredVatPeriods(settings, today), [settings, today]);
  const rows = useMemo(() => periods.map(period => ({ period, deadline: vatFilingDeadline(period),
    report: buildVatDashboardReport({ ...sources, settings, today, period, filing: settings.vatFilingPeriod || 'quarterly' }) })), [periods, sources, settings, today]);
  const current = periodKeyFor(today, settings.vatFilingPeriod || 'quarterly');
  // The banner is the next upcoming obligation. Historical missing evidence
  // stays explicit in the table; it does not invent an overdue/unfiled fact.
  const next = rows.find(row => row.deadline >= today && !filings[row.period]);
  const days = next ? vatDaysRemaining(next.deadline, today) : null;
  const money = value => ready ? formatCurrencyPrecise(value * scalingFactor) : 'غير متاح';
  return <>
    {read.loading ? <p role="status">جارٍ التحقق من إثباتات تقديم الإقرارات…</p> : read.allowed && !read.error && next && <div role="status" className={`rounded-control border px-4 py-3 text-sm ${days < 10 ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>
      إقرار {periodLabel(next.period).split(' · ')[0]}: آخر موعد {formatDate(next.deadline)}، باقي {formatNumber(days)} يوم.
      {next.period === current && <span className="block text-xs mt-1">الفترة لم تنتهِ؛ الأرقام حتى اليوم.</span>}
    </div>}
    <Card className="p-4 sm:p-6">
      <SectionHeader title="الإقرارات" subtitle="أرقام الموقع الحالية للمقارنة؛ لا تعيد احتساب الإقرار المقدّم أو تثبت طلب استرداد." />
      <p className="text-xs text-slate-500 mb-3">الفترات تبدأ من تاريخ التسجيل المحفوظ في سياسة الدفتر، بانتظار تأكيد هادي.</p>
      {(!read.allowed || read.error) && <p role="alert" className="text-amber-700 dark:text-amber-300 mb-3">تعذر التحقق من إثباتات التقديم؛ لا يُفترض أن الإقرار غير مقدّم.</p>}
      {!periods.length ? <p>تاريخ التسجيل غير متاح؛ لم تُفترض فترات إقرار.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm text-right">
        <thead><tr>{['الفترة', 'آخر موعد', 'المخرجات التشغيلية', 'المدخلات المؤهلة', 'الصافي', 'الحالة', 'تاريخ التقديم', 'رقم المرجع'].map(label => <th key={label} scope="col" className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => { const evidence = filings[row.period];
          const available = ready && !row.report.outputUnavailable;
          return <tr key={row.period} className="border-t border-slate-200 dark:border-slate-700">
            <th scope="row" className="p-3">{periodLabel(row.period).split(' · ')[0]}</th><td className="p-3 whitespace-nowrap">{formatDate(row.deadline)}</td>
            <td className="p-3 tabular-nums">{available ? money(row.report.output.tax) : 'غير متاح'}</td><td className="p-3 tabular-nums">{money(row.report.input.tax)}</td>
            <td className="p-3 tabular-nums">{available ? <>{money(Math.abs(row.report.netTax))}<small className="block">{row.report.direction === 'refundable' ? 'مسترد تقديري' : row.report.direction === 'payable' ? 'مستحق تقديري' : 'لا مستحق ولا مسترد'}</small></> : 'غير متاح'}</td>
            <td className="p-3">{evidence ? <><strong className="text-emerald-700 dark:text-emerald-300">مقدّم حسب تقرير وكيل الضرائب</strong><small className="block">بانتظار تأكيد هادي · تقرير {formatDate(evidence.reportDate)}</small></>
              : row.period === current && !read.loading ? <>لم يُقدَّم<small className="block">لا يوجد إثبات محفوظ؛ الفترة جارية</small></> : 'حالة التقديم غير موثقة'}</td>
            <td className="p-3 whitespace-nowrap">{evidence ? formatDate(evidence.submittedAt) : '—'}</td><td className="p-3 tabular-nums"><bdi>{evidence?.reference || '—'}</bdi></td>
          </tr>; })}</tbody>
      </table></div>}
      <p className="text-xs text-slate-500 mt-3">وصول الاسترداد يحتاج إثبات قبض مستقلًا؛ التقديم لا يعني وصوله. الحالات هنا قراءة فقط من الأدلة المحفوظة.</p>
    </Card>
  </>;
}
