import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Trash2, Building2, Coins, Wallet, Landmark, CreditCard, History,
} from 'lucide-react';
import {
  formatCurrency, formatDate, PER_WORKER_FEE,
} from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
} from './UI';
import CategorySelect from './CategorySelect';
import AddPartnerPaymentModal from './AddPartnerPaymentModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { usePartners } from '../hooks/usePartners';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import {
  isSupabaseConfigured, missingEnvNames, describeSupabaseError,
} from '../lib/supabaseClient';

// Visual treatment for the three payment methods in the table.
const METHOD_META = {
  bank_transfer: {
    label: 'تحويل بنكي',
    icon:  Landmark,
    cls:   'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  cash: {
    label: 'نقدي',
    icon:  Coins,
    cls:   'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30',
  },
  mada_pos: {
    label: 'مدى / شبكة',
    icon:  CreditCard,
    cls:   'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-100 dark:border-primary-500/30',
  },
};

function MethodPill({ method }) {
  const meta = METHOD_META[method] || METHOD_META.bank_transfer;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-md border ${meta.cls}`}>
      <Icon size={11} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

export default function PartnerPaymentsPage() {
  const {
    partners,
    loading: partnersLoading,
    error: partnersError,
    refetch: refetchPartners,
  } = usePartners();
  const {
    payments,
    loading: paymentsLoading,
    error: paymentsError,
    addPayment,
    deletePayment,
    refetch: refetchPayments,
  } = usePartnerPayments();

  // The user's explicit pick. May be null (initial load) or stale (if the
  // partner row got deleted while we were viewing it). The derived
  // `selectedPartner` below resolves these cases by falling back to the
  // first available partner.
  const [pickedPartnerId, setPickedPartnerId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // Auto-fall-back to the first partner during render so we never need to
  // setState from inside an effect. If the explicit pick is gone (or was
  // never made) and there's at least one partner, we silently use that.
  const selectedPartner = useMemo(() => {
    if (partners.length === 0) return null;
    return partners.find((p) => p.id === pickedPartnerId) || partners[0];
  }, [partners, pickedPartnerId]);
  const selectedPartnerId = selectedPartner?.id || null;

  const partnerPayments = useMemo(
    () => payments.filter((p) => p.partnerId === selectedPartnerId),
    [payments, selectedPartnerId],
  );

  // Capital tracking derived from the ledger, not from partners.paid_amount.
  // The trigger keeps the two in sync but this page treats the ledger as
  // the source of truth.
  const required = (selectedPartner?.workersCount || 0) * PER_WORKER_FEE;
  const paid     = partnerPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance  = Math.max(0, required - paid);
  const settled  = balance === 0 && required > 0;

  // Reshape partner list for the shared CategorySelect dropdown
  // (it expects { id, label }-shaped rows).
  const partnerOptions = useMemo(
    () => partners.map((p) => ({ id: p.id, label: p.partnerName })),
    [partners],
  );

  async function handleAddPayment(payment) {
    try {
      setMutationError(null);
      await addPayment(payment);
      // partners.paid_amount is updated by the DB trigger, but the
      // Partners page's cached snapshot won't notice without a refetch.
      refetchPartners?.();
      showToast('تم تسجيل الدفعة بنجاح');
    } catch (e) {
      console.error('🔥 Real Supabase Error (PartnerPaymentsPage.handleAddPayment):', e);
      setMutationError(e);
      showToast(describeSupabaseError(e) || e?.message || 'تعذّر تسجيل الدفعة', 'error');
      throw e;
    }
  }

  async function handleDelete(payment) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('هل أنت متأكد من حذف هذا السجل المالي؟')
      : true;
    if (!confirmed) return;
    try {
      setMutationError(null);
      await deletePayment(payment.id);
      refetchPartners?.();
      showToast('تم حذف الدفعة من السجل');
    } catch (e) {
      console.error('🔥 Real Supabase Error (PartnerPaymentsPage.handleDelete):', e, { id: payment.id });
      setMutationError(e);
      showToast(describeSupabaseError(e) || e?.message || 'تعذّر حذف الدفعة', 'error');
    }
  }

  const anyError    = partnersError || paymentsError;
  const anyLoading  = partnersLoading || paymentsLoading;

  return (
    <>
      <TopBar
        title="المدفوعات الخاصة لكل شريك"
        subtitle="سجل دفعات رأس المال لكل شريك ومتابعة الرصيد المتبقي"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isSupabaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}

        {anyError && (
          <ErrorState
            title="تعذّر تحميل بيانات الدفعات"
            error={anyError}
            onRetry={() => { refetchPartners?.(); refetchPayments?.(); }}
          />
        )}

        {mutationError && (
          <ErrorState
            title="تعذّر تنفيذ العملية"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}

        {/* ── Partner picker ─────────────────────────────────── */}
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                اختر الشريك
              </label>
              <div className="flex gap-2">
                <CategorySelect
                  categories={partnerOptions}
                  value={selectedPartnerId}
                  onChange={setPickedPartnerId}
                  placeholder="اختر شريكاً لعرض دفعاته"
                  emptyLabel="— لا يوجد شركاء مسجّلين —"
                  ariaLabel="اختر الشريك لعرض سجل دفعاته"
                />
              </div>
            </div>
            {selectedPartner && (
              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed tabular-nums shrink-0">
                <div>عدد العمالة: <span className="font-bold text-slate-700 dark:text-slate-300">{selectedPartner.workersCount || 0}</span></div>
                <div>الرسم لكل عامل: <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(PER_WORKER_FEE)}</span></div>
              </div>
            )}
          </div>
        </Card>

        {/* ── Per-partner KPI row ────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <StatCard
            icon={Building2}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-600"
            label="إجمالي الرسوم المطلوبة"
            value={formatCurrency(required)}
            sub={selectedPartner
              ? `${selectedPartner.workersCount || 0} عامل × ${formatCurrency(PER_WORKER_FEE)}`
              : 'اختر شريكاً لعرض القيمة'}
          />
          <StatCard
            icon={Coins}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="إجمالي المسدد الفعلي"
            value={formatCurrency(paid)}
            sub={`${partnerPayments.length} ${partnerPayments.length === 1 ? 'دفعة مسجّلة' : 'دفعة مسجّلة'}`}
          />
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 sm:p-5 shadow-sm dark:shadow-slate-950/40 transition-colors duration-200">
            <div className="flex items-start justify-between">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                settled
                  ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
              }`}>
                <Wallet size={20} strokeWidth={2.2} />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 mb-1">المتبقي للاستكمال</p>
            <p className="text-2xl font-extrabold tabular-nums">
              {settled ? (
                <span className="text-emerald-600 dark:text-emerald-400">✓ مسدّد بالكامل</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">{formatCurrency(balance)}</span>
              )}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              {settled
                ? 'الشريك سدّد كامل رسومه المستحقة'
                : 'الفرق بين المطلوب وما تم تحصيله'}
            </p>
          </div>
        </div>

        {/* ── Payment history table ──────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل الدفعات"
            subtitle={selectedPartner
              ? `كل الدفعات المسجّلة للشريك "${selectedPartner.partnerName}"`
              : 'اختر شريكاً لعرض دفعاته'}
            action={
              <PrimaryButton
                icon={Plus}
                onClick={() => setAddOpen(true)}
                disabled={!selectedPartnerId}
              >
                إضافة دفعة جديدة
              </PrimaryButton>
            }
          />

          {anyLoading && partnerPayments.length === 0 ? (
            <LoadingState message="جارٍ تحميل سجل الدفعات..." />
          ) : !selectedPartnerId ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
                <History size={26} />
              </div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                لا يوجد شركاء مسجّلين بعد
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                افتح صفحة &quot;إدارة الشركاء&quot; لإضافة أول شريك ثم ارجع هنا لتسجيل دفعاته.
              </p>
            </div>
          ) : partnerPayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
                <Wallet size={26} />
              </div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                لا توجد دفعات مسجّلة لهذا الشريك بعد
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">
                اضغط &quot;إضافة دفعة جديدة&quot; لتسجيل أول إيصال لهذا الشريك.
              </p>
              <PrimaryButton icon={Plus} onClick={() => setAddOpen(true)}>
                إضافة دفعة جديدة
              </PrimaryButton>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">تاريخ الدفعة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">قيمة الدفعة</th>
                    <th className="py-3 px-4 whitespace-nowrap">طريقة الدفع</th>
                    <th className="py-3 px-4">البيان والملاحظات</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-16">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerPayments.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                        {formatDate(p.paymentDate)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <MethodPill method={p.paymentMethod} />
                      </td>
                      <td className="py-3 px-4 whitespace-normal break-words text-slate-600 dark:text-slate-400 min-w-[200px] leading-relaxed">
                        {p.notes || <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-left">
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors"
                          aria-label={`حذف دفعة ${formatDate(p.paymentDate)}`}
                          title="حذف هذه الدفعة"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    <td colSpan={1} className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                      إجمالي المسدّد
                    </td>
                    <td className="py-3 px-4 text-left font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(paid)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddPartnerPaymentModal
        isOpen={addOpen}
        partnerId={selectedPartnerId}
        partnerName={selectedPartner?.partnerName || ''}
        onClose={() => setAddOpen(false)}
        onAdd={handleAddPayment}
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
