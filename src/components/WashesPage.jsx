import { translate } from '../i18n/locale';
import { getLocale } from '../i18n/locale';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SweaterWashWorkerSummary from './SweaterWashWorkerSummary';
import {
  Plus, Trash2, Pencil, Wallet, CheckCircle2, CalendarClock, Car,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, PrimaryButton,
  EmptyState as UIEmptyState,
} from './UI';
import AddWashModal from './AddWashModal';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useWashes } from '../hooks/useWashes';
import { useBikers } from '../hooks/useBikers';
import { useLanguage } from '../i18n/useLanguage';
import { displayRecordedBikerName, recordedBikerSweaterId } from '../lib/bikerNames';
import { formatDateOnly } from '../lib/dateOnly';
import { completedWashesYesterday, riyadhTodayISO } from '../lib/washesYesterday';
import { washDisplayStatus } from '../lib/sweater/washDisplayStatus';
import { useSweaterWashDetails } from '../hooks/useSweaterWashDetails';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { autoPostOnApproval, describeAutoPost, autoPostTone } from '../lib/accounting/autoPost';
import { isFirebaseConfigured, missingEnvNames } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

// ─── Status toggle pill (مكتملة ↔ قيد التنفيذ) ────────────────────────────
function WashStatusPill({ status, onChange, disabled, label }) {
  const isCompleted = status === 'مكتملة';
  const next        = isCompleted ? 'قيد التنفيذ' : 'مكتملة';
  const classes = isCompleted
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20';
  const dot = isCompleted ? 'bg-emerald-600' : 'bg-amber-500';
  return (
    <button
      type="button"
      aria-label={`تغيير اكتمال دفعة ${label}`}
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      title={disabled
        ? 'غير متاح في وضع عرض الشريك'
        : isCompleted ? 'انقر للتراجع إلى قيد التنفيذ' : 'انقر لتسجيل الغسلة كمكتملة'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      تغيير الاكتمال
    </button>
  );
}

// Thin wrapper over the shared EmptyState recipe so this page's "no washes
// yet" moment looks identical to every other empty table in the app.
function EmptyState({ onAdd, canMutate }) {
  return (
    <UIEmptyState
      icon={Car}
      title="لم تُسجَّل أي غسلة بعد"
      hint={canMutate
        ? 'ابدأ بتسجيل أول غسلة. ستظهر تلقائياً في عداد الغسلات داخل تبويب المصاريف المتغيرة.'
        : 'لم يتم تسجيل أي غسلة من قِبَل المشرف بعد.'}
      action={canMutate ? (
        <PrimaryButton icon={Plus} onClick={onAdd}>
          إضافة غسلة جديدة
        </PrimaryButton>
      ) : null}
    />
  );
}

function formatWashDate(value) {
  return formatDateOnly(value, getLocale());
}

export default function WashesPage() {
  const { bikers } = useBikers();
  const { language } = useLanguage();
  const {
    items, loading, error,
    addItem, updateItem, updateStatus, deleteItem, refetch,
  } = useWashes();
  const { scalingFactor, canMutate } = usePartnerView();
  const { settings } = useAccountingSettings();
  const bookingIds = items.filter(wash => wash.revenueOrigin === 'sweater' && wash.sspBookingId).map(wash => wash.sspBookingId);
  const washDetails = useSweaterWashDetails(bookingIds, bookingIds.length > 0);
  const byBookingId = new Map(washDetails.bookings.map(booking => [booking.sspBookingId, booking.record]));

  const [localOpen, setLocalOpen]         = useState(false);
  const [editingItem, setEditingItem]     = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });
  const [today, setToday] = useState(() => riyadhTodayISO());
  useEffect(() => {
    // Keep an open page correct after midnight (also catches background-tab wakeup).
    const refreshDay = () => setToday(riyadhTodayISO());
    const timer = window.setInterval(refreshDay, 60_000);
    window.addEventListener('focus', refreshDay);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshDay); };
  }, []);

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
    let completed = 0, revenue = 0;
    items.forEach((w) => {
      const q = w.quantity || 0;
      if (w.status === 'مكتملة') {
        completed += q;
        revenue   += q * w.price;
      }
    });
    // Pro-rata: revenue is a currency total (continuous), wash counts
    // round to the nearest integer so the KPI doesn't read "3.7 غسلة".
    return {
      completed: Math.round(completed * scalingFactor),
      revenue:   revenue * scalingFactor,
      yesterday: Math.round(completedWashesYesterday(items, today) * scalingFactor),
    };
  }, [items, scalingFactor, today]);

  async function handleAddItem(item) {
    try { await addItem(item); showToast('تم إضافة الغسلة بنجاح'); }
    catch (e) { setMutationError(e); throw e; }
  }
  async function handleUpdateItem(id, updates) {
    try { await updateItem(id, updates); showToast('تم حفظ التعديلات'); }
    catch (e) { setMutationError(e); throw e; }
  }
  /**
   * Marking a wash مكتملة is the approval moment: the sale is earned, so
   * that is when it belongs in the books. Posting is attempted only on the
   * transition INTO completed, and its result is always shown — a silently
   * swallowed posting failure is how a ledger goes stale without anyone
   * noticing.
   */
  async function handleUpdateStatus(id, status) {
    const before = items.find((w) => w.id === id);
    try { await updateStatus(id, status); }
    catch (e) { setMutationError(e); return; }
    if (!settings.autoPost) return;
    const result = await autoPostOnApproval({
      kind: 'wash', id,
      before: { status: before?.status },
      after: { status },
      vatRegistered: settings.vatRegistered,
      washPriceMode: settings.washPriceMode,
    });
    // `null` means it was not an approval transition — nothing to say.
    if (result && result.status !== 'skipped') {
      showToast(describeAutoPost(result), autoPostTone(result));
    } else if (result?.blocking) {
      showToast(describeAutoPost(result), 'error');
    }
  }
  async function handleDelete(item) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(translate(`هل تريد حذف هذه الدفعة (${formatNumber(item.quantity)} غسلة)؟ لا يمكن التراجع.`))
      : true;
    if (!confirmed) return;
    try { await deleteItem(item.id); showToast('تم حذف الغسلة'); }
    catch (e) { setMutationError(e); }
  }

  return (
    <>
      <TopBar
        title="الغسلات"
        subtitle="سجل كل غسلة لتغذية عداد البايكرز ومتابعة الإيرادات اليومية"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        <SweaterWashWorkerSummary washes={items} bikers={bikers} scalingFactor={scalingFactor} detailsSource={washDetails} />
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
            title="تعذّر تحميل سجل الغسلات"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI summary ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 md:col-span-1"
            icon={CheckCircle2}
            tone="emerald"
            label="إجمالي الغسلات المكتملة"
            value={formatNumber(totals.completed)}
            sub={
              items.length === 0
                ? 'ابدأ بتسجيل أول دفعة'
                : `${formatNumber(items.length)} ${items.length === 1 ? 'دفعة' : 'دفعات'} مسجّلة`
            }
          />
          <StatCard
            icon={Wallet}
            tone="primary"
            label="إجمالي الإيرادات"
            value={formatCurrency(totals.revenue)}
            sub="عدد الغسلات × سعر الغسلة (للدفعات المكتملة)"
          />
          <StatCard
            icon={CalendarClock}
            tone="amber"
            label="غسلات أمس"
            value={formatNumber(totals.yesterday)}
            sub="الغسلات المكتملة المسجلة ليوم أمس فقط — بتوقيت الرياض"
          />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل الغسلات"
            subtitle={canMutate
              ? 'حرّر الحالة مباشرةً من الجدول أو افتح غسلة للتعديل الكامل'
              : 'عرض حصّتك من سجل الغسلات (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={openAddModal}>
                إضافة غسلة جديدة
              </PrimaryButton>
            ) : null}
          />
          {washDetails.loading && <p role="status" className="text-xs text-slate-500 mb-3">نحمّل حالة التكت من السجلات المحفوظة...</p>}
          {washDetails.error && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300 mb-3">تعذّر التحقق من التكت؛ حالة اكتمال الغسلة ما زالت معروضة من السجل.</p>}

          {loading && !items.length ? (
            <LoadingState rows={4} />
          ) : items.length === 0 ? (
            <EmptyState onAdd={openAddModal} canMutate={canMutate} />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[800px] text-sm" aria-label="سجل الغسلات">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4 whitespace-nowrap">ID الغسلة</th>
                    <th className="py-3 px-4 whitespace-nowrap">ID العامل</th>
                    <th className="py-3 px-4 whitespace-nowrap">اسم العامل</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">إجمالي الإيرادات</th>
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                    <th className="py-3 px-4 whitespace-nowrap text-left w-20">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w) => {
                    const total = (w.quantity || 0) * (w.price || 0);
                    const label = displayRecordedBikerName(w, bikers, language);
                    const sourceRecord = byBookingId.get(w.sspBookingId);
                    const displayStatus = washDisplayStatus(w, sourceRecord);
                    const statusClasses = {
                      completed: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      exceptional: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      ticket: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300',
                      pending: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
                    };
                    return (
                      <tr
                        key={w.id}
                        className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td dir="ltr" translate="no" className="py-3 px-4 whitespace-nowrap text-start tabular-nums align-top">
                          {w.sspBookingId || w.id || '—'}
                        </td>
                        <td dir="ltr" translate="no" className="py-3 px-4 whitespace-nowrap text-start tabular-nums align-top">
                          {recordedBikerSweaterId(w, bikers) || '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-normal break-words min-w-[180px] font-medium text-slate-800 dark:text-slate-200 align-top">
                          <span translate="no" dir="auto">{label}</span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100 align-top">
                          {formatCurrency(total * scalingFactor)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400 align-top">
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            <CalendarClock size={13} className="text-slate-500 dark:text-slate-400" />
                            {formatWashDate(w.washDate)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusClasses[displayStatus.tone]}`}>{displayStatus.label}</span>
                          {displayStatus.ticketRef && <p dir="ltr" translate="no" className="text-[11px] tabular-nums mt-1">{displayStatus.ticketRef}</p>}
                          {displayStatus.exceptional && <p className="text-[11px] text-slate-500 mt-1">اعتماد استثنائي أيضًا</p>}
                          {w.revenueOrigin === 'sweater' && !sourceRecord && !washDetails.loading && !washDetails.error
                            && <p className="text-[11px] text-slate-500 mt-1">بيانات التكت غير متاحة</p>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-left align-top">
                          {canMutate && (
                            <div className="inline-flex items-center gap-1">
                              <WashStatusPill status={w.status} label={label} onChange={(next) => handleUpdateStatus(w.id, next)} disabled={!canMutate} />
                              <button
                                type="button"
                                onClick={() => openEditModal(w)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 p-1.5 rounded-control hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                                aria-label={`تعديل دفعة ${label}`}
                                title="تعديل الدفعة"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(w)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-300 p-1.5 rounded-control hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                                aria-label={`حذف دفعة ${label}`}
                                title="حذف الدفعة"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      <AddWashModal
        bikers={bikers}
        isOpen={isModalOpen}
        onClose={closeModal}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
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
