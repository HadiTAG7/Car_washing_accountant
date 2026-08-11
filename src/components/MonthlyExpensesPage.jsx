import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, Clock, CalendarClock, Calendar, Receipt,
  Percent, Link as LinkIcon,
} from 'lucide-react';
import { formatCurrency, formatCurrencyPrecise, formatNumber, extractVat, MONTHLY_EXPENSE_CATEGORIES } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as EmptyStateShell,
} from './UI';
import AddMonthlyExpenseModal from './AddMonthlyExpenseModal';
import PaymentStatusPill from './PaymentStatusPill';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useMonthlyExpenses } from '../hooks/useMonthlyExpenses';
import { useMonthlyExpenseCategories } from '../hooks/useMonthlyExpenseCategories';
import { useAuth } from '../hooks/useAuth';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { autoPost, describeAutoPost, autoPostTone } from '../lib/accounting/autoPost';
import { isFirebaseConfigured, missingEnvNames, describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// Only http(s) values become clickable — mirrors the guard used by the
// ledger modal and the VAT report so a pasted `javascript:` URL can never
// become a live anchor.
function isSafeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

// Returns true if today's day-of-month matches the recurring payment day.
function isMonthlyDueToday(paymentDay) {
  if (!paymentDay) return false;
  return new Date().getDate() === Number(paymentDay);
}

function EmptyState({ onAdd, canMutate }) {
  return (
    <EmptyStateShell
      icon={Receipt}
      title="لا توجد مصاريف شهرية بعد"
      hint={canMutate
        ? 'أضف أول مصروف شهري متكرر لمتابعة التكاليف التشغيلية الجارية.'
        : 'لم يقم المشرف بتسجيل أي مصروف شهري بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة مصروف شهري
        </PrimaryButton>
      ) : null}
    />
  );
}

function formatPaymentDay(day) {
  if (!day) return '—';
  return `يوم ${formatNumber(day)} من الشهر`;
}

// Pretty-prints a YYYY-MM-DD into an Arabic date with Latin digits.
function formatLoggedDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
      numberingSystem: 'latn',
    }).format(d);
  } catch {
    return iso;
  }
}

export default function MonthlyExpensesPage() {
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useMonthlyExpenses();

  const {
    categories, addCategory, deleteCategory, getCategoryLabel,
  } = useMonthlyExpenseCategories();

  const { scalingFactor, canMutate } = usePartnerView();
  const { user } = useAuth();
  const { settings } = useAccountingSettings();

  const [localOpen, setLocalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => {
    setToast((t) => ({ ...t, open: false }));
  }, []);

  const isModalOpen = localOpen || Boolean(editingItem);
  function openAddModal()      { setEditingItem(null); setLocalOpen(true); }
  function openEditModal(item) { setLocalOpen(false); setEditingItem(item); }
  function closeModal()        { setLocalOpen(false); setEditingItem(null); }

  const totals = useMemo(() => {
    let total = 0, paid = 0, pending = 0;
    items.forEach((i) => {
      total += i.totalMonthlyCost;
      if (i.paymentStatus === 'paid') paid += i.totalMonthlyCost;
      else pending += i.totalMonthlyCost;
    });
    // Pro-rata: every aggregate is multiplied by the viewing partner's
    // workforce share. Admin view → scalingFactor=1 → identity math.
    return {
      total:   total   * scalingFactor,
      paid:    paid    * scalingFactor,
      pending: pending * scalingFactor,
    };
  }, [items, scalingFactor]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة المصروف الشهري بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  /**
   * Marking a one-off expense مسدَّد is its approval moment. A RECURRING row
   * is deliberately excluded: it is a template with no date, and its dated
   * vouchers are what get posted — auto-posting the template here would put a
   * dateless cost in the books.
   */
  async function handleUpdateStatus(id, status) {
    const before = items.find((m) => m.id === id);
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); return; }
    if (!settings.autoPost || status !== 'paid') return;
    if (before?.paymentStatus === 'paid') return;      // not a transition
    if (!before?.loggedDate) return;                   // recurring template
    const result = await autoPost({
      kind: 'monthly', id, userId: user?.id, vatRegistered: settings.vatRegistered,
    });
    if (result.status !== 'skipped' || result.blocking) {
      showToast(describeAutoPost(result), autoPostTone(result));
    }
  }
  async function handleAddCategory(label) {
    try {
      const newId = await addCategory({ label });
      showToast('تم إضافة التصنيف الجديد بنجاح');
      return newId;
    } catch (e) {
      console.error('Firestore Category Error:', e, 'label:', label);
      showToast(describeBackendError(e) || 'تعذّر إضافة التصنيف الجديد', 'error');
      throw e;
    }
  }
  async function handleDeleteCategory(id) {
    try {
      await deleteCategory(id);
      showToast('تم حذف التصنيف من القوائم');
    } catch (e) {
      showToast(describeBackendError(e) || 'تعذّر حذف التصنيف', 'error');
      throw e;
    }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل تريد حذف "${item.expenseName}"؟ لا يمكن التراجع.`)
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف المصروف'); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="المصاريف الشهرية"
        subtitle="متابعة المصاريف التشغيلية الشهرية المتكررة"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {mutationError && (
          <ErrorState
            title="تعذّر حفظ التغييرات"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {error && (
          <ErrorState
            title="تعذّر تحميل المصاريف الشهرية"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={Wallet}
            tone="primary"
            label="إجمالي المصاريف الشهرية"
            value={formatCurrency(totals.total)}
            sub={`${items.length} ${items.length === 1 ? 'مصروف' : 'مصاريف'}`}
          />
          <StatCard
            icon={CheckCircle2}
            tone="emerald"
            label="مصاريف مدفوعة"
            value={formatCurrency(totals.paid)}
            sub={
              totals.total > 0
                ? `${((totals.paid / totals.total) * 100).toFixed(0)}% من الإجمالي`
                : 'لا توجد مدفوعات بعد'
            }
          />
          <StatCard
            icon={Clock}
            tone="amber"
            label="مصاريف معلقة"
            value={formatCurrency(totals.pending)}
            sub={
              totals.total > 0
                ? `${((totals.pending / totals.total) * 100).toFixed(0)}% من الإجمالي`
                : 'لا توجد مصاريف معلقة'
            }
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بنود المصاريف الشهرية"
            subtitle={canMutate
              ? 'حرّر الحالة مباشرةً من الجدول أو افتح بند للتعديل الكامل'
              : 'عرض حصّتك من المصاريف الشهرية (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة مصروف شهري
              </PrimaryButton>
            ) : null}
          />

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} canMutate={canMutate} />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">المصروف</th>
                    <th className="py-3 px-4 whitespace-nowrap">التصنيف</th>
                    <th className="py-3 px-4 whitespace-nowrap text-center tabular-nums">الكمية</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">تكلفة الوحدة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الإجمالي الشهري</th>
                    <th className="py-3 px-4 whitespace-nowrap">التكرار / الموعد</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr
                      key={i.id}
                      className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{i.expenseName}</div>
                        {i.quantity > 1 && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                            الكمية: {formatNumber(i.quantity)} | تكلفة الوحدة: {formatCurrency(i.unitCost * scalingFactor)}
                          </div>
                        )}
                        {/* Tax invoice: show the reclaimable VAT inline and
                            link the invoice, so the row is self-verifying at
                            filing time. Only http(s) values become anchors. */}
                        {i.isTaxInvoice && (
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30 px-2 py-0.5 rounded-full tabular-nums">
                              <Percent size={11} />
                              ض.ق.م: {formatCurrencyPrecise(extractVat(i.totalMonthlyCost) * scalingFactor)}
                            </span>
                            {i.invoiceUrl && isSafeHttpUrl(i.invoiceUrl) && (
                              <a
                                href={i.invoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={i.invoiceUrl}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:underline"
                              >
                                <LinkIcon size={11} />
                                الفاتورة
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <span className="inline-flex text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-control">
                          {getCategoryLabel(i.categoryId)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        {formatNumber(i.quantity)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300 align-top">
                        {formatCurrency(i.unitCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100 align-top">
                        {formatCurrency(i.totalMonthlyCost * scalingFactor)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400 align-top">
                        {i.recurrence === 'one_time' ? (
                          <div className="flex flex-col gap-1">
                            {/* Informational (indigo), not brand: `accent-*`
                                aliases the brand ramp in the DS, so an orange
                                chip here was indistinguishable from the
                                "متكرر شهرياً" chip below. */}
                            <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-control border border-indigo-100 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                              مرة واحدة
                            </span>
                            <span className="inline-flex items-center gap-1.5 tabular-nums text-[12px]">
                              <Calendar size={13} className="text-slate-500 dark:text-slate-400" />
                              {formatLoggedDate(i.loggedDate)}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-control border border-primary-100 dark:border-primary-500/30 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 text-[10px] font-bold">
                              متكرر شهرياً
                            </span>
                            <span className="inline-flex items-center gap-1.5 tabular-nums text-[12px]">
                              <CalendarClock size={13} className="text-slate-500 dark:text-slate-400" />
                              {formatPaymentDay(i.paymentDay)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <PaymentStatusPill
                          status={i.paymentStatus}
                          dueToday={i.recurrence !== 'one_time' && isMonthlyDueToday(i.paymentDay)}
                          onChange={(next) => handleUpdateStatus(i.id, next)}
                          disabled={!canMutate}
                        />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                        {canMutate && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
                              aria-label={`تعديل ${i.expenseName}`}
                              title="تعديل المصروف"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(i)}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                              aria-label={`حذف ${i.expenseName}`}
                              title="حذف المصروف"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddMonthlyExpenseModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        onAddCategory={handleAddCategory}
        onDeleteCategory={handleDeleteCategory}
        categories={categories}
        protectedCategoryLabels={MONTHLY_EXPENSE_CATEGORIES.map((c) => c.label)}
        initialValues={editingItem}
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
