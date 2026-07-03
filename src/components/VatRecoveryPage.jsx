import { useMemo } from 'react';
import {
  Percent, Receipt, Coins, Link as LinkIcon, FileText,
} from 'lucide-react';
import {
  formatCurrency, formatDate, extractVat, netOfVat,
} from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import { useTaxInvoices } from '../hooks/useTaxInvoices';
import { useStartupCosts } from '../hooks/useStartupCosts';
import { useAnnualExpenses } from '../hooks/useAnnualExpenses';
import { isSupabaseConfigured, missingEnvNames } from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// Same guard the detail modal uses — only http(s) values become anchors.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

// Tiny source chip next to the parent item name — tells the admin which
// page the invoice was logged from.
const SOURCE_META = {
  startup: { label: 'تأسيس', cls: 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-100 dark:border-primary-500/30' },
  annual:  { label: 'سنوي',  cls: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30' },
};
function SourceBadge({ source }) {
  const meta = SOURCE_META[source];
  if (!meta) return null;
  return (
    <span className={`inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export default function VatRecoveryPage() {
  const { invoices, loading, error, sourceErrors, refetch } = useTaxInvoices();
  const { items: startupItems } = useStartupCosts();
  const { items: annualItems }  = useAnnualExpenses();
  const { scalingFactor } = usePartnerView();

  // Resolve parentId → item name across both sources (uuids can't
  // collide, so one merged map is enough).
  const itemNameById = useMemo(() => {
    const m = new Map();
    startupItems.forEach((i) => m.set(i.id, i.itemName));
    annualItems.forEach((i)  => m.set(i.id, i.expenseName));
    return m;
  }, [startupItems, annualItems]);

  // All money figures are scaled by the viewing partner's share for
  // consistency with the rest of the dashboard (admin → ×1).
  const kpis = useMemo(() => {
    let inclusive = 0, vat = 0, net = 0;
    invoices.forEach((e) => {
      inclusive += e.amount || 0;
      vat       += extractVat(e.amount, true);
      net       += netOfVat(e.amount, true);
    });
    return {
      inclusive: inclusive * scalingFactor,
      vat:       vat       * scalingFactor,
      net:       net       * scalingFactor,
      count:     invoices.length,
    };
  }, [invoices, scalingFactor]);

  return (
    <>
      <TopBar
        title="الضريبة المستردة"
        subtitle="إجمالي ضريبة القيمة المضافة المتوقع استردادها من الفواتير الضريبية"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {/* Full ErrorState only when BOTH sources failed. A single
            failed source (usually its migration hasn't run yet) gets a
            compact amber note below while the healthy source's invoices
            keep rendering. */}
        {error && (
          <ErrorState
            title="تعذّر تحميل الفواتير الضريبية"
            error={error}
            onRetry={refetch}
          />
        )}
        {!error && sourceErrors.startup && (
          <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-xs px-4 py-2.5 rounded-xl leading-relaxed">
            تعذّر تحميل فواتير <strong>رسوم التأسيس</strong> — إن لم تكن قد شغّلت{' '}
            <code className="bg-amber-100 dark:bg-amber-500/25 px-1 rounded" dir="ltr">2026_06_startup_cost_entries_ALL.sql</code>{' '}
            في Supabase SQL Editor، شغّله ثم حدّث الصفحة. الفواتير السنوية معروضة أدناه.
          </div>
        )}
        {!error && sourceErrors.annual && (
          <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-xs px-4 py-2.5 rounded-xl leading-relaxed">
            تعذّر تحميل فواتير <strong>المصاريف السنوية</strong> — إن لم تكن قد شغّلت{' '}
            <code className="bg-amber-100 dark:bg-amber-500/25 px-1 rounded" dir="ltr">2026_06_annual_expense_entries_ALL.sql</code>{' '}
            في Supabase SQL Editor، شغّله ثم حدّث الصفحة. فواتير التأسيس معروضة أدناه.
          </div>
        )}

        {/* ── KPI summary ──────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <StatCard
            icon={Percent}
            iconBg="bg-emerald-50 dark:bg-emerald-500/15"
            iconColor="text-emerald-600 dark:text-emerald-400"
            label="إجمالي الضريبة المتوقع استردادها"
            value={formatCurrency(kpis.vat)}
            sub={`${kpis.count} ${kpis.count === 1 ? 'فاتورة ضريبية' : 'فاتورة ضريبية'}`}
          />
          <StatCard
            icon={Receipt}
            iconBg="bg-slate-100 dark:bg-slate-800"
            iconColor="text-slate-700 dark:text-slate-300"
            label="إجمالي الفواتير (شامل الضريبة)"
            value={formatCurrency(kpis.inclusive)}
            sub="مجموع المبالغ المدفوعة فعلياً"
          />
          <StatCard
            icon={Coins}
            iconBg="bg-primary-50 dark:bg-primary-500/15"
            iconColor="text-primary-700 dark:text-primary-400"
            label="صافي قيمة السلع (قبل الضريبة)"
            value={formatCurrency(kpis.net)}
            sub="الإجمالي مطروحاً منه الضريبة"
          />
        </div>

        {/* ── Tax invoices table ───────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="الفواتير الضريبية"
            subtitle="كل بند مصروف تأسيسي تم تحديده كفاتورة ضريبية"
          />

          {loading && invoices.length === 0 ? (
            <LoadingState message="جارٍ تحميل الفواتير الضريبية..." />
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
                <FileText size={26} />
              </div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                لا توجد فواتير ضريبية مسجّلة بعد
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                افتح أي بند في صفحة &quot;رسوم التأسيس&quot;، أضف مصروفاً، وفعّل
                خيار &quot;فاتورة ضريبية&quot; — وسيظهر هنا تلقائياً.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند الأصلي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الوصف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">شامل الضريبة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الضريبة (15%)</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الصافي</th>
                    <th className="py-3 px-4 whitespace-nowrap">الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((e) => {
                    const inclusive = (e.amount || 0) * scalingFactor;
                    const vat       = extractVat(e.amount, true) * scalingFactor;
                    const net       = netOfVat(e.amount, true) * scalingFactor;
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1.5">
                            {itemNameById.get(e.parentId) || '—'}
                            <SourceBadge source={e.source} />
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] font-medium text-slate-800 dark:text-slate-200">
                          {e.description}
                          {e.notes && (
                            <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500 mt-0.5">
                              {e.notes}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
                          {formatDate(e.spentDate)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                          {formatCurrency(inclusive)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(vat)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                          {formatCurrency(net)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {e.invoiceUrl && isSafeHttpUrl(e.invoiceUrl) ? (
                            <a
                              href={e.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-400 hover:underline font-semibold text-[12px]"
                              title={e.invoiceUrl}
                            >
                              <LinkIcon size={12} />
                              عرض
                            </a>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    <td colSpan={3} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      الإجمالي
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(kpis.inclusive)}
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {formatCurrency(kpis.vat)}
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(kpis.net)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
