import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Users, UserCheck, Briefcase, Trash2, Pencil,
} from 'lucide-react';
import { formatNumber, formatCurrency, PER_WORKER_FEE } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard,
  PrimaryButton,
} from './UI';
import AddPartnerModal from './AddPartnerModal';
import EditPartnerModal from './EditPartnerModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import { usePartners } from '../hooks/usePartners';
import { describeSupabaseError } from '../lib/supabaseClient';

export default function PartnersPage() {
  const {
    partners,
    loading,
    error,
    addPartner,
    updatePartner,
    deletePartner,
    refetch,
  } = usePartners();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // ── KPI totals ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPartners = partners.length;
    const totalWorkers  = partners.reduce((s, p) => s + (p.workersCount || 0), 0);
    const activeCount   = partners.filter((p) => p.status === 'active').length;
    return { totalPartners, totalWorkers, activeCount };
  }, [partners]);

  async function handleAdd(partner) {
    try {
      setMutationError(null);
      await addPartner(partner);
      showToast('تم إضافة الشريك بنجاح');
    } catch (e) {
      setMutationError(e);
      showToast(describeSupabaseError(e) || 'تعذّر إضافة الشريك', 'error');
    }
  }
  async function handleSaveEdit(id, patch) {
    try {
      setMutationError(null);
      await updatePartner(id, patch);
      showToast('تم حفظ بيانات الشريك');
    } catch (e) {
      setMutationError(e);
      showToast(describeSupabaseError(e) || 'تعذّر حفظ التعديلات', 'error');
      throw e;
    }
  }
  async function handleDelete(id) {
    try {
      setMutationError(null);
      await deletePartner(id);
      showToast('تم حذف الشريك');
    } catch (e) {
      setMutationError(e);
      showToast(describeSupabaseError(e) || 'تعذّر حذف الشريك', 'error');
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <StatCard
            icon={Briefcase}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الشركاء"
            value={formatNumber(kpis.totalPartners)}
            sub="عدد الشركاء المسجّلين في النظام"
          />
          <StatCard
            icon={Users}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="إجمالي العمالة"
            value={formatNumber(kpis.totalWorkers)}
            sub="مجموع عمالة جميع الشركاء"
          />
          <StatCard
            icon={UserCheck}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="الشركاء النشطين"
            value={formatNumber(kpis.activeCount)}
            sub={`${kpis.totalPartners > 0 ? ((kpis.activeCount / kpis.totalPartners) * 100).toFixed(0) : 0}% من إجمالي الشركاء`}
          />
        </div>

        {/* ── Partners table (v2 — capital tracking) ─────────── */}
        <Card className="p-6">
          <SectionHeader
            title="قائمة الشركاء"
            subtitle="استخدم زر القلم لتعديل بيانات أي شريك بما فيها المبلغ المدفوع"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsModalOpen(true)}>
                إضافة شريك جديد
              </PrimaryButton>
            }
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
                    <td colSpan={7} className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                      لا يوجد شركاء مسجّلين بعد — اضغط &quot;إضافة شريك جديد&quot; للبدء
                    </td>
                  </tr>
                )}
                {partners.map((p) => {
                  // ── Percentage: prefer stored, fall back to workforce share
                  const derived  = kpis.totalWorkers > 0
                    ? (p.workersCount / kpis.totalWorkers) * 100
                    : 0;
                  const pct      = p.percentage != null ? p.percentage : derived;
                  const isCustom = p.percentage != null;

                  // ── Capital & receivable
                  const required = (p.workersCount || 0) * PER_WORKER_FEE;
                  const paid     = p.paidAmount || 0;
                  const balance  = Math.max(0, required - paid);
                  const settled  = balance === 0;

                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* 1. اسم الشريك */}
                      <td className="py-3 px-4 whitespace-normal break-words min-w-[180px] font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-2">
                          <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
                            <Briefcase size={14} />
                          </span>
                          <span className="truncate">{p.partnerName}</span>
                        </div>
                      </td>

                      {/* 2. عدد العمالة */}
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums text-slate-700 dark:text-slate-300">
                        {formatNumber(p.workersCount || 0)}
                      </td>

                      {/* 3. النسبة */}
                      <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg ${
                            isCustom
                              ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                          }`}
                          title={isCustom ? 'نسبة مُحدّدة يدوياً' : 'محسوبة تلقائياً حسب عدد العمالة'}
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
                            className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/30"
                            title="الرصيد مُسدَّد بالكامل"
                          >
                            ✓ مسدّد بالكامل
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[13px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-500/30"
                            title="مبلغ مستحَق على الشريك"
                          >
                            {formatCurrency(balance)}
                          </span>
                        )}
                      </td>

                      {/* 7. إجراءات */}
                      <td className="py-3 px-4 whitespace-nowrap text-left">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingPartner(p)}
                            className="text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors duration-150 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/15 cursor-pointer"
                            aria-label={`تعديل ${p.partnerName}`}
                            title="تعديل بيانات الشريك"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p.id)}
                            className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors"
                            aria-label={`حذف ${p.partnerName}`}
                            title="حذف الشريك"
                          >
                            <Trash2 size={15} />
                          </button>
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
      />

      <EditPartnerModal
        isOpen={Boolean(editingPartner)}
        partner={editingPartner}
        onClose={() => setEditingPartner(null)}
        onSave={handleSaveEdit}
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
