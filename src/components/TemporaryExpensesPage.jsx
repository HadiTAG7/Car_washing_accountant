import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, RefreshCw, Coins, Hourglass, CheckCircle2, Inbox,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState,
} from './UI';
import AddTemporaryExpenseModal from './AddTemporaryExpenseModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useTemporaryExpenses } from '../hooks/useTemporaryExpenses';
import {
  isSupabaseConfigured, missingEnvNames, describeSupabaseError,
} from '../lib/supabaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

export default function TemporaryExpensesPage() {
  const {
    expenses,
    loading,
    error,
    addTemporaryExpense,
    toggleRecoveryStatus,
    deleteTemporaryExpense,
    refetch,
  } = useTemporaryExpenses();
  const { scalingFactor, canMutate } = usePartnerView();

  const [addOpen, setAddOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // ── KPI totals ──────────────────────────────────────────────
  // Split the ledger into recovered vs pending so each bucket renders its
  // own colored summary card. Totals are derived per render — cheap, since
  // the row count is tiny relative to other modules.
  const kpis = useMemo(() => {
    const totalAll = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const recoveredRows = expenses.filter((e) => e.status === 'recovered');
    const pendingRows   = expenses.filter((e) => e.status === 'pending');
    const totalRecovered = recoveredRows.reduce((s, e) => s + (e.amount || 0), 0);
    const totalPending   = pendingRows.reduce((s, e) => s + (e.amount || 0), 0);
    // Pro-rata: aggregate amounts scale by the viewing partner's share.
    // Counts round to the nearest integer so the KPI text stays sensible
    // ("1 سجل بانتظار الاسترداد" rather than "0.3 سجل").
    return {
      totalAll:       totalAll       * scalingFactor,
      totalRecovered: totalRecovered * scalingFactor,
      totalPending:   totalPending   * scalingFactor,
      countRecovered: Math.round(recoveredRows.length * scalingFactor),
      countPending:   Math.round(pendingRows.length   * scalingFactor),
      countAll:       Math.round(expenses.length      * scalingFactor),
    };
  }, [expenses, scalingFactor]);

  async function handleAdd(expense) {
    try {
      setMutationError(null);
      await addTemporaryExpense(expense);
      showToast('تم تسجيل المصروف المؤقت بنجاح');
    } catch (e) {
      console.error('🔥 Real Supabase Error (TemporaryExpensesPage.handleAdd):', e);
      setMutationError(e);
      showToast(describeSupabaseError(e) || e?.message || 'تعذّر تسجيل المصروف', 'error');
      throw e;
    }
  }

  async function handleToggle(expense) {
    try {
      setMutationError(null);
      await toggleRecoveryStatus(expense.id, expense.status);
      showToast(
        expense.status === 'recovered'
          ? 'تمت إعادته إلى قائمة المعلق'
          : 'تم تأكيد استرداد المبلغ',
      );
    } catch (e) {
      console.error('🔥 Real Supabase Error (TemporaryExpensesPage.handleToggle):', e, { id: expense.id, status: expense.status });
      setMutationError(e);
      showToast(describeSupabaseError(e) || e?.message || 'تعذّر تحديث الحالة', 'error');
    }
  }

  async function handleDelete(expense) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل أنت متأكد من حذف "${expense.title}" نهائياً؟`)
      : true;
    if (!confirmed) return;
    try {
      setMutationError(null);
      await deleteTemporaryExpense(expense.id);
      showToast('تم حذف السجل');
    } catch (e) {
      console.error('🔥 Real Supabase Error (TemporaryExpensesPage.handleDelete):', e, { id: expense.id });
      setMutationError(e);
      showToast(describeSupabaseError(e) || e?.message || 'تعذّر حذف السجل', 'error');
    }
  }

  return (
    <>
      <TopBar
        title="المصروفات المؤقتة"
        subtitle="تتبع المبالغ المدفوعة مؤقتاً والمتوقع استردادها لاحقاً"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {error && (
          <ErrorState
            title="تعذّر تحميل سجل المصروفات المؤقتة"
            error={error}
            onRetry={refetch}
          />
        )}

        {mutationError && (
          <ErrorState
            title="تعذّر تنفيذ العملية"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {/* ── KPI summary ──────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            icon={Coins}
            tone="slate"
            label="إجمالي المصروفات المؤقتة"
            value={formatCurrency(kpis.totalAll)}
            sub={`${kpis.countAll} ${kpis.countAll === 1 ? 'سجل مسجّل' : 'سجل مسجّل'}`}
          />
          <StatCard
            icon={CheckCircle2}
            tone="emerald"
            label="المبالغ المستردة"
            value={formatCurrency(kpis.totalRecovered)}
            sub={`${kpis.countRecovered} ${kpis.countRecovered === 1 ? 'سجل مكتمل' : 'سجل مكتمل'}`}
          />
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-500/40 p-4 sm:p-5 shadow-sm dark:shadow-slate-950/40 ring-1 ring-amber-100 dark:ring-amber-500/20 transition-colors duration-200">
            <div className="flex items-start justify-between">
              <div className="bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 w-11 h-11 rounded-xl flex items-center justify-center">
                <Hourglass size={20} strokeWidth={2.2} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                ⏳ معلق
              </span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mt-4 mb-1">المعلق قيد الاسترداد</p>
            <p className="text-2xl font-extrabold tabular-nums text-amber-700 dark:text-amber-300">
              {formatCurrency(kpis.totalPending)}
            </p>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 mt-1">
              {kpis.countPending} {kpis.countPending === 1 ? 'سجل بانتظار الاسترداد' : 'سجل بانتظار الاسترداد'}
            </p>
          </div>
        </div>

        {/* ── Tracking table ───────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل المصروفات المؤقتة"
            subtitle={canMutate
              ? 'كل المبالغ المدفوعة مؤقتاً وحالة استردادها'
              : 'عرض حصّتك من المصروفات المؤقتة (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={() => setAddOpen(true)}>
                إضافة مصروف مؤقت
              </PrimaryButton>
            ) : null}
          />

          {loading && expenses.length === 0 ? (
            <LoadingState message="جارٍ تحميل سجل المصروفات..." />
          ) : expenses.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="لا توجد مصروفات مؤقتة مسجّلة بعد"
              hint={canMutate
                ? 'اضغط "إضافة مصروف مؤقت" لتسجيل أول مبلغ مدفوع مؤقتاً وستظهر هنا.'
                : 'لم يتم تسجيل أي مصروف مؤقت من قِبَل المشرف بعد.'}
              action={canMutate ? (
                <PrimaryButton icon={Plus} onClick={() => setAddOpen(true)}>
                  إضافة مصروف مؤقت
                </PrimaryButton>
              ) : null}
            />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">البند</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الصرف</th>
                    <th className="py-3 px-4 whitespace-nowrap">حالة الاسترداد</th>
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الاسترداد</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-16">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => {
                    const isRecovered = e.status === 'recovered';
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors group"
                      >
                        <td className="py-3 px-4 whitespace-normal break-words text-slate-800 dark:text-slate-200 font-semibold min-w-[180px] leading-relaxed">
                          {e.title}
                          {e.notes && (
                            <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                              {e.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrency((e.amount || 0) * scalingFactor)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                          {formatDate(e.spentDate)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isRecovered ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md border bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30">
                              <CheckCircle2 size={12} strokeWidth={2.5} />
                              تم الاسترداد
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md border bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/40">
                                <Hourglass size={12} strokeWidth={2.5} />
                                ⏳ معلق قيد الاسترداد
                              </span>
                              {canMutate && (
                                <button
                                  type="button"
                                  onClick={() => handleToggle(e)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white transition-colors shadow-sm"
                                  title="تأكيد استرداد هذا المبلغ"
                                  aria-label={`تأكيد استرداد ${e.title}`}
                                >
                                  <CheckCircle2 size={12} strokeWidth={2.5} />
                                  تأكيد الاسترداد
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums">
                          {isRecovered ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                              {formatDate(e.recoveredDate)}
                            </span>
                          ) : canMutate ? (
                            <button
                              type="button"
                              onClick={() => handleToggle(e)}
                              className="text-[11px] text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                              title="تأكيد الاسترداد الآن"
                            >
                              <span className="inline-flex items-center gap-1">
                                <RefreshCw size={11} />
                                لم يُسترد بعد
                              </span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left">
                          {canMutate && (
                            <button
                              type="button"
                              onClick={() => handleDelete(e)}
                              className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors md:opacity-0 md:group-hover:opacity-100"
                              aria-label={`حذف ${e.title}`}
                              title="حذف هذا السجل نهائياً"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      الإجمالي
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(kpis.totalAll)}
                    </td>
                    <td colSpan={4} className="py-3 px-4 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">{formatCurrency(kpis.totalRecovered)}</span>
                      <span className="mx-1.5">مسترد</span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="text-amber-700 dark:text-amber-400 font-semibold tabular-nums mr-1.5">{formatCurrency(kpis.totalPending)}</span>
                      <span>معلق قيد الاسترداد</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddTemporaryExpenseModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAdd}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        tone={toast.tone}
        duration={toast.duration}
        onClose={closeToast}
      />
    </>
  );
}
