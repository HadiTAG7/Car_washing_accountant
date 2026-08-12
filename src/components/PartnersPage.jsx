import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Users, UserCheck, Briefcase, Trash2, Pencil, Building2, Coins, FileText,
} from 'lucide-react';
import { formatNumber, formatCurrency, PER_WORKER_FEE } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard,
  PrimaryButton,
  EmptyState,
} from './UI';
import AddPartnerModal from './AddPartnerModal';
import EditPartnerModal from './EditPartnerModal';
import PartnerStatementModal from './PartnerStatementModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import { usePartners } from '../hooks/usePartners';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import { paidByPartner } from '../lib/accounting/partnerTotals';
import { describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

export default function PartnersPage() {
  const {
    partners: allPartners,
    loading,
    error,
    addPartner,
    updatePartner,
    deletePartner,
    refetch,
  } = usePartners();
  const { isPartnerView, viewedPartner, canMutate } = usePartnerView();
  // Paid-to-date is DERIVED from the receipts, not read off the cached
  // `partners.paid_amount` aggregate — that field is maintained by a
  // client-side read-then-sum and can drift from its own evidence.
  const { payments: partnerPayments } = usePartnerPayments();
  const paidTotals = useMemo(() => paidByPartner(partnerPayments), [partnerPayments]);

  // Partner view filters the page to just the viewed partner's row — they
  // shouldn't see the rest of the fleet's data. Admin (no partner view)
  // sees the full list. The KPIs below recompute from `partners`, so the
  // totals in partner view reflect ONLY that one row's contribution —
  // which is exactly what a partner expects to see on this page (their
  // own headcount, their own paid_amount, their own capital ceiling).
  const partners = useMemo(() => {
    if (isPartnerView && viewedPartner) {
      return allPartners.filter((p) => p.id === viewedPartner.id);
    }
    return allPartners;
  }, [allPartners, isPartnerView, viewedPartner]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  // Partner whose printable capital statement is open.
  const [statementPartner, setStatementPartner] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // ── KPI totals ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPartners     = partners.length;
    const totalWorkers      = partners.reduce((s, p) => s + (p.workersCount || 0), 0);
    const activeCount       = partners.filter((p) => p.status === 'active').length;
    // Capital fee × headcount across the entire fleet — the receivable
    // ceiling, in other words.
    const totalProjectValue = totalWorkers * PER_WORKER_FEE;
    // Cash actually collected, summed from the receipts themselves.
    const totalPaidTillNow  = partners.reduce((s, p) => s + (paidTotals.get(String(p.id)) || 0), 0);
    return { totalPartners, totalWorkers, activeCount, totalProjectValue, totalPaidTillNow };
  }, [partners, paidTotals]);

  async function handleAdd(partner) {
    try {
      setMutationError(null);
      await addPartner(partner);
      showToast('تم إضافة الشريك بنجاح');
    } catch (e) {
      console.error('🔥 Firestore Error (PartnersPage.handleAdd):', e);
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر إضافة الشريك', 'error');
    }
  }
  async function handleSaveEdit(id, patch) {
    try {
      setMutationError(null);
      console.info('[PartnersPage] saving edit', { id, patch });
      await updatePartner(id, patch);
      showToast('تم حفظ بيانات الشريك');
    } catch (e) {
      console.error('🔥 Firestore Error (PartnersPage.handleSaveEdit):', e, { id, patch });
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر حفظ التعديلات', 'error');
      throw e;
    }
  }
  async function handleDelete(id) {
    try {
      setMutationError(null);
      await deletePartner(id);
      showToast('تم حذف الشريك');
    } catch (e) {
      console.error('🔥 Firestore Error (PartnersPage.handleDelete):', e, { id });
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر حذف الشريك', 'error');
    }
  }

  return (
    <>
      <TopBar
        title="إدارة الشركاء"
        subtitle="متابعة الشركاء وعدد العمالة لكل شريك ورأس المال المُسدَّد"
      />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {mutationError && (
          <ErrorState
            title="تعذّر تنفيذ العملية"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}
        {error && (
          <ErrorState
            title="تعذّر تحميل بيانات الشركاء"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI row ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-5">
          <StatCard
            className="col-span-2 lg:col-span-1"
            icon={Briefcase}
            tone="primary"
            label="إجمالي الشركاء"
            value={formatNumber(kpis.totalPartners)}
            sub="عدد الشركاء المسجّلين في النظام"
          />
          <StatCard
            icon={Users}
            tone="amber"
            label="إجمالي العمالة"
            value={formatNumber(kpis.totalWorkers)}
            sub="مجموع عمالة جميع الشركاء"
          />
          <StatCard
            icon={UserCheck}
            tone="emerald"
            label="الشركاء النشطين"
            value={formatNumber(kpis.activeCount)}
            sub={`${kpis.totalPartners > 0 ? ((kpis.activeCount / kpis.totalPartners) * 100).toFixed(0) : 0}% من إجمالي الشركاء`}
          />
          <StatCard
            icon={Building2}
            tone="indigo"
            label="إجمالي قيمة المشروع"
            value={formatCurrency(kpis.totalProjectValue)}
            sub="إجمالي رسوم التأسيس المطلوبة من الشركاء"
          />
          <StatCard
            icon={Coins}
            tone="emerald"
            label="إجمالي المبالغ المدفوعة"
            value={formatCurrency(kpis.totalPaidTillNow)}
            sub="السيولة المحصلة في الخزينة إلى الآن"
          />
        </div>

        {/* ── Partners table (v2 — capital tracking) ─────────── */}
        <Card className="p-6">
          <SectionHeader
            title="قائمة الشركاء"
            subtitle={canMutate
              ? 'زر القلم لتعديل بيانات الشريك، وزر الكشف لطباعة كشف حسابه — المدفوعات تُدار من صفحة مدفوعات الشركاء'
              : 'بياناتك كشريك (للقراءة فقط)'}
            action={canMutate ? (
              <PrimaryButton icon={Plus} onClick={() => setIsModalOpen(true)}>
                إضافة شريك جديد
              </PrimaryButton>
            ) : null}
          />
          <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
            <table className="w-full min-w-[860px] text-sm">
              {/* === HEADER — 7 columns, exact order per spec ============== */}
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                  <th className="py-3 px-4 whitespace-nowrap">اسم الشريك</th>
                  <th className="py-3 px-4 whitespace-nowrap text-center">عدد العمالة</th>
                  <th className="py-3 px-4 whitespace-nowrap text-center">النسبة</th>
                  <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">الرسوم المطلوبة</th>
                  <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ المدفوع</th>
                  <th className="py-3 px-4 whitespace-nowrap text-left tabular-nums">المبلغ المتبقي</th>
                  <th className="py-3 px-4 whitespace-nowrap text-left w-24">إجراءات</th>
                </tr>
              </thead>

              {/* === BODY — one <tr> per partner with all 7 cells ========= */}
              <tbody>
                {loading && partners.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10">
                      <LoadingState message="جارٍ تحميل بيانات الشركاء..." />
                    </td>
                  </tr>
                )}
                {!loading && partners.length === 0 && !error && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        compact
                        icon={Briefcase}
                        title="لا يوجد شركاء مسجّلين بعد"
                        hint='اضغط "إضافة شريك جديد" أعلى الجدول لتسجيل أول شريك.'
                      />
                    </td>
                  </tr>
                )}
                {partners.map((p) => {
                  // ── Percentage: pure client-side derivation. Never stored
                  // in the DB — `partners` table has no percentage column.
                  const pct = kpis.totalWorkers > 0
                    ? (p.workersCount / kpis.totalWorkers) * 100
                    : 0;

                  // ── Capital & receivable
                  const required = (p.workersCount || 0) * PER_WORKER_FEE;
                  const paid     = paidTotals.get(String(p.id)) || 0;
                  const balance  = Math.max(0, required - paid);
                  const settled  = balance === 0;

                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* 1. اسم الشريك */}
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[180px] font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-2">
                          <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-8 h-8 rounded-control flex items-center justify-center shrink-0">
                            <Briefcase size={14} />
                          </span>
                          <span className="truncate">{p.partnerName}</span>
                        </div>
                      </td>

                      {/* 2. عدد العمالة */}
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300">
                        {formatNumber(p.workersCount || 0)}
                      </td>

                      {/* 3. النسبة — derived on the fly from workers share */}
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums">
                        <span
                          className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-control bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300"
                          title="محسوبة تلقائياً حسب عدد العمالة"
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </td>

                      {/* 4. الرسوم المطلوبة = workersCount × PER_WORKER_FEE */}
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(required)}
                      </td>

                      {/* 5. المبلغ المدفوع */}
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(paid)}
                      </td>

                      {/* 6. المبلغ المتبقي — emerald if 0, amber if > 0 */}
                      <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums">
                        {settled ? (
                          <span
                            className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-control bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30"
                            title="الرصيد مُسدَّد بالكامل"
                          >
                            ✓ مسدّد بالكامل
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-control bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-500/30"
                            title="مبلغ مستحَق على الشريك"
                          >
                            {formatCurrency(balance)}
                          </span>
                        )}
                      </td>

                      {/* 7. إجراءات */}
                      <td className="py-3 px-4 whitespace-nowrap text-left">
                        <div className="inline-flex items-center gap-1">
                          {/* Statement: available to everyone (a partner
                              can print their own even in read-only view). */}
                          <button
                            type="button"
                            onClick={() => setStatementPartner(p)}
                            className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-400 p-1.5 rounded-control hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
                            aria-label={`كشف حساب ${p.partnerName}`}
                            title="كشف حساب الشريك (طباعة / PDF)"
                          >
                            <FileText size={15} />
                          </button>
                          {canMutate && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingPartner(p)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors duration-150 p-1.5 rounded-control hover:bg-indigo-50 dark:hover:bg-indigo-500/15 cursor-pointer"
                                aria-label={`تعديل ${p.partnerName}`}
                                title="تعديل بيانات الشريك"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(p.id)}
                                className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-control hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                                aria-label={`حذف ${p.partnerName}`}
                                title="حذف الشريك"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      <AddPartnerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAdd}
        showToast={showToast}
      />

      <EditPartnerModal
        isOpen={Boolean(editingPartner)}
        partner={editingPartner}
        onClose={() => setEditingPartner(null)}
        onSave={handleSaveEdit}
        showToast={showToast}
      />

      <PartnerStatementModal
        isOpen={Boolean(statementPartner)}
        partner={statementPartner}
        onClose={() => setStatementPartner(null)}
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
