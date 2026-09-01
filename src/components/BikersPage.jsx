import { useCallback, useMemo, useState } from 'react';
import {
  Bike, Plus, Pencil, Trash2, Banknote, HandCoins, Users, Wallet,
  Car, Import, ClipboardList, ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, StatusBadge, PrimaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import AddBikerModal from './AddBikerModal';
import AddBikerAdvanceModal from './AddBikerAdvanceModal';
import BikerPayroll from './BikerPayroll';
import { useBikers } from '../hooks/useBikers';
import { useWashes } from '../hooks/useWashes';
import { useTemporaryExpenses } from '../hooks/useTemporaryExpenses';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { describeBackendError } from '../lib/firebaseClient';
import { formatCurrency, formatNumber, formatDate } from '../data/initialData';
import { todayMonth, formatMonthLabel } from '../lib/variableExpenseTotals';
import {
  BIKER_SORT_COLUMNS, sortBikers, nextSort, loadSort, saveSort,
} from '../lib/bikerSort';
import {
  washStatsFor, pendingAdvancesFor, iqamaStatus, unregisteredBikerNames,
} from '../lib/bikerStats';

// ═══════════════════════════════════════════════════════════════════════════
// البايكر — سجل من يغسلون السيارات: هوياتهم، رواتبهم، وسلفهم
// ═══════════════════════════════════════════════════════════════════════════
// Everything financial on this page is DERIVED, never stored on the biker:
// washes and commission from the wash log through the same rule the Variable
// Expenses page applies, outstanding advances from `temporary_expenses`
// (linked by biker_id), salary payments as ordinary paid monthly expenses.
// The registry holds only what a free-text name never could: phone,
// residence, salary figure, iqama.
//
// ── لا scalingFactor هنا، عمداً ──
// TemporaryExpensesPage scales its money by the partner's share because an
// outlay is company money. A SALARY is a fact about a person — scaling it by
// a partnership share would show a partner «راتب أحمد: 1000» for a man paid
// 2000, which is not a share, it is a wrong number. So partner view reads
// this page unscaled; mutations stay behind canMutate like everywhere else.
// ═══════════════════════════════════════════════════════════════════════════

function IqamaBadge({ expiry }) {
  const state = iqamaStatus(expiry);
  if (!state) return <span className="text-slate-400 dark:text-slate-500">—</span>;
  if (state === 'expired') {
    return <StatusBadge status="critical">منتهية {formatDate(expiry)}</StatusBadge>;
  }
  if (state === 'soon') {
    return <StatusBadge status="due-soon">تنتهي {formatDate(expiry)}</StatusBadge>;
  }
  return <StatusBadge status="good">سارية حتى {formatDate(expiry)}</StatusBadge>;
}

/**
 * رأسُ عمودٍ يُرتَّب بالنقر.
 *
 * زرٌّ داخل `<th>` لا `onClick` على `<th>` نفسه: الأخير لا تصله لوحة
 * المفاتيح ولا قارئ الشاشة. و`aria-sort` على الخليّة هو ما يقول للقارئ —
 * وللوكيل الآلي — بأي عمودٍ رُتّبت القائمة وباتجاهٍ ماذا.
 *
 * ── ولماذا هو **خارج** `BikersPage` ──
 * لو عُرِّف في جسمها لتغيّرت هويّته مع كل رسمة، فيفكّ React الخليّة ويركّبها
 * من جديد بدل تحديثها — ويذهب التركيز إلى `<body>` عند أول نقرة. فيفقد
 * مستخدم لوحة المفاتيح موضعه، ولا يستطيع الضغط ثانيةً ليعكس الاتجاه دون
 * البحث عن الزر مرّةً أخرى. (وهذا ما رصده اختبار التركيز فعلاً، لا تخميناً.)
 */
function SortableTh({ id, sort, onSort, className = '' }) {
  const col = BIKER_SORT_COLUMNS[id];
  const active = sort.column === id;
  const Icon = !active ? ChevronsUpDown : (sort.direction === 'asc' ? ArrowUp : ArrowDown);
  return (
    <th
      className={`py-3 px-4 whitespace-nowrap ${className}`}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(id)}
        title={`ترتيب حسب ${col.label}`}
        className={`inline-flex items-center gap-1 group transition-colors ${
          active ? 'text-primary-700 dark:text-primary-300' : 'hover:text-slate-700 dark:hover:text-slate-200'
        }`}
      >
        <span>{col.label}</span>
        <Icon
          size={12}
          className={`shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
        />
      </button>
    </th>
  );
}

export default function BikersPage({ role, payrollPreview = false }) {
  const { bikers, loading, error, addBiker, updateBiker, deleteBiker, refetch } = useBikers();
  const { items: washes } = useWashes();
  const { expenses: temps, addTemporaryExpense } = useTemporaryExpenses();
  const { canMutate } = usePartnerView();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingBiker, setEditingBiker] = useState(null);
  const [advanceBiker, setAdvanceBiker] = useState(null);
  const [activeSection, setActiveSection] = useState(payrollPreview ? 'payroll' : 'registry');
  const [importing, setImporting] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  const month = todayMonth();

  // One derived bundle per biker — stats, advances, iqama — computed from the
  // same rows every other page reads, so no number here can disagree with them.
  const rows = useMemo(() => bikers.map((b) => {
    const stats = washStatsFor(b.name, washes || [], month);
    const { advances, total: advancesTotal } = pendingAdvancesFor(b.id, temps || []);
    return { ...b, stats, advances, advancesTotal };
  }), [bikers, washes, temps, month]);

  // ── الترتيب باختيار المالك ──
  // يُقرأ المحفوظ عند أول رسمة فقط (مُهيّئ كسول) — قراءته في كل رسمة تلمس
  // `localStorage` بلا داعٍ، وتُسقط الصفحة في وضعٍ يمنعه لو لم تُحرَس.
  const [sort, setSort] = useState(loadSort);
  const sortedRows = useMemo(() => sortBikers(rows, sort), [rows, sort]);
  const applySort = useCallback((columnId) => {
    setSort((prev) => {
      const next = nextSort(prev, columnId);
      saveSort(next);
      return next;
    });
  }, []);

  const kpis = useMemo(() => ({
    count:          bikers.length,
    salaries:       bikers.reduce((s, b) => s + (b.salary || 0), 0),
    advancesTotal:  rows.reduce((s, r) => s + r.advancesTotal, 0),
    monthWashes:    rows.reduce((s, r) => s + r.stats.washCount, 0),
  }), [bikers, rows]);

  // Names living only on wash rows — one click registers them all.
  const importableNames = useMemo(
    () => unregisteredBikerNames(washes || [], bikers),
    [washes, bikers],
  );

  async function guarded(label, fn) {
    try {
      setMutationError(null);
      await fn();
      showToast(label);
      return true;
    } catch (e) {
      console.error('🔥 Firestore Error (BikersPage):', e);
      setMutationError(e);
      showToast(describeBackendError(e) || e?.message || 'تعذّر تنفيذ العملية', 'error');
      return false;
    }
  }

  const handleAdd = (biker) => guarded('تمت إضافة البايكر بنجاح', () => addBiker(biker));
  const handleEdit = async (id, patch) => {
    const ok = await guarded('تم حفظ التعديلات', () => updateBiker(id, patch));
    if (!ok) throw new Error('save-failed'); // keep the modal open on failure
  };

  async function handleDelete(row) {
    if (row.advancesTotal > 0) {
      showToast(`على ${row.name} سلف قائمة (${formatCurrency(row.advancesTotal)}) — استردّها أو اخصمها من راتبه قبل الحذف.`, 'error');
      return;
    }
    const ok = window.confirm(
      `حذف «${row.name}» من السجل؟\n\nغسلاته وعمولاته السابقة تبقى محفوظة باسمه في سجل الغسلات — يُحذف ملفه فقط.`,
    );
    if (!ok) return;
    await guarded('تم حذف البايكر', () => deleteBiker(row.id));
  }

  const handleAdvance = (advance) => guarded(
    'سُجّلت السلفة — تدخل الدفاتر من «فحص غير المُرحّل» في إقفال الفترة',
    () => addTemporaryExpense(advance),
  );

  async function handleImportNames() {
    if (!importableNames.length || importing) return;
    setImporting(true);
    try {
      await guarded(
        `أُضيف ${formatNumber(importableNames.length)} بايكر من سجل الغسلات — أكمل بياناتهم بزر التعديل`,
        async () => {
          for (const name of importableNames) {
            // Name only; salary/phone get filled in by hand afterwards.
            await addBiker({ name, salary: 0 });
          }
        },
      );
      await refetch();
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <TopBar
        title="البايكر"
        subtitle="سجل العاملين ومسير رواتبهم الشهري من المعاينة حتى الصرف"
      />
      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {mutationError && (
          <ErrorState title="تعذّر تنفيذ العملية" error={mutationError} onRetry={() => setMutationError(null)} />
        )}
        {error && !(payrollPreview && activeSection === 'payroll') && (
          <ErrorState title="تعذّر تحميل سجل البايكرات" error={error} onRetry={refetch} />
        )}

        <div className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-control p-1 payroll-no-print" role="tablist" aria-label="أقسام صفحة البايكر">
          <button type="button" role="tab" aria-selected={activeSection === 'registry'} onClick={() => setActiveSection('registry')} className={`sw-button sw-button--sm ${activeSection === 'registry' ? 'sw-button--primary' : 'sw-button--secondary'}`}><Bike size={16} /> سجل البايكرات</button>
          <button type="button" role="tab" aria-selected={activeSection === 'payroll'} onClick={() => setActiveSection('payroll')} className={`sw-button sw-button--sm ${activeSection === 'payroll' ? 'sw-button--primary' : 'sw-button--secondary'}`}><ClipboardList size={16} /> مسير الرواتب</button>
        </div>

        {activeSection === 'payroll' ? (
          <BikerPayroll role={role} previewMode={payrollPreview} />
        ) : (
          <>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          <StatCard
            icon={Users}
            tone="primary"
            label="عدد البايكرات"
            value={formatNumber(kpis.count)}
            sub="المسجّلون في هذا السجل"
          />
          <StatCard
            icon={Banknote}
            tone="emerald"
            label="إجمالي الرواتب الشهرية"
            value={formatCurrency(kpis.salaries)}
            sub="مجموع الرواتب المتفق عليها"
          />
          <StatCard
            icon={Wallet}
            tone="amber"
            label="السلف القائمة"
            value={formatCurrency(kpis.advancesTotal)}
            sub="ما لم يُخصم أو يُسترد بعد"
          />
          <StatCard
            icon={Car}
            tone="indigo"
            label={`غسلات ${formatMonthLabel(month)}`}
            value={formatNumber(kpis.monthWashes)}
            sub="للمسجّلين في هذا السجل"
          />
        </div>

        <Card className="p-6">
          <SectionHeader
            title="سجل البايكرات"
            subtitle={canMutate
              ? 'الغسلات والعمولات تُحسب تلقائياً من سجل الغسلات بنفس الاسم'
              : 'عرض للقراءة فقط'}
            action={canMutate ? (
              <div className="flex items-center gap-2 flex-wrap">
                {importableNames.length > 0 && (
                  <button
                    type="button"
                    onClick={handleImportNames}
                    disabled={importing}
                    className="sw-button sw-button--sm sw-button--secondary"
                    title={`أسماء موجودة في الغسلات ولا ملف لها: ${importableNames.join('، ')}`}
                  >
                    <Import size={16} />
                    {importing ? 'جارٍ الاستيراد...' : `استيراد ${formatNumber(importableNames.length)} من الغسلات`}
                  </button>
                )}
                <PrimaryButton icon={Plus} onClick={() => setIsAddOpen(true)}>
                  إضافة بايكر
                </PrimaryButton>
              </div>
            ) : null}
          />

          <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
            <table className="w-full min-w-[1320px] text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                  <SortableTh sort={sort} onSort={applySort} id="name" />
                  <SortableTh sort={sort} onSort={applySort} id="contact" />
                  <SortableTh sort={sort} onSort={applySort} id="residence" />
                  <SortableTh sort={sort} onSort={applySort} id="sponsor" />
                  <SortableTh sort={sort} onSort={applySort} id="nationality" />
                  <SortableTh sort={sort} onSort={applySort} id="salary" className="text-left tabular-nums" />
                  <SortableTh sort={sort} onSort={applySort} id="advances" className="text-left tabular-nums" />
                  <SortableTh sort={sort} onSort={applySort} id="washCount" className="text-center" />
                  <SortableTh sort={sort} onSort={applySort} id="commission" className="text-left tabular-nums" />
                  <SortableTh sort={sort} onSort={applySort} id="iqamaExpiry" />
                  <th className="py-3 px-4 whitespace-nowrap text-left w-36">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading && bikers.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-10">
                      <LoadingState message="جارٍ تحميل سجل البايكرات..." />
                    </td>
                  </tr>
                )}
                {!loading && bikers.length === 0 && !error && (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState
                        compact
                        icon={Bike}
                        title="لا يوجد بايكرات مسجّلون بعد"
                        hint={canMutate
                          ? (importableNames.length
                            ? `في سجل الغسلات ${formatNumber(importableNames.length)} اسماً بلا ملف — استوردها بزرٍّ واحد أعلى الجدول، أو أضف بايكراً جديداً.`
                            : 'اضغط «إضافة بايكر» لتسجيل أول عامل: اسمه وجواله وسكنه وراتبه.')
                          : 'لم يُسجَّل أي بايكر بعد.'}
                      />
                    </td>
                  </tr>
                )}
                {sortedRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 whitespace-normal break-words min-w-[160px] font-medium text-slate-800 dark:text-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-8 h-8 rounded-control flex items-center justify-center shrink-0">
                          <Bike size={14} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{r.name}</span>
                          {r.startDate && (
                            <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                              منذ {formatDate(r.startDate)}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums" dir="ltr">
                      {r.contactNumber || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-normal break-words text-slate-600 dark:text-slate-400">
                      {r.residence || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-normal break-words text-slate-600 dark:text-slate-400">
                      {r.sponsor || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {r.nationality || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums font-semibold">
                      {r.salary > 0 ? formatCurrency(r.salary) : '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums">
                      {r.advancesTotal > 0 ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          {formatCurrency(r.advancesTotal)}
                          <span className="text-[11px] font-normal mr-1">({formatNumber(r.advances.length)})</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">لا شيء</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-center tabular-nums">
                      {formatNumber(r.stats.washCount)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-left tabular-nums">
                      {r.stats.commission > 0 ? formatCurrency(r.stats.commission) : '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <IqamaBadge expiry={r.iqamaExpiry} />
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-left">
                      <div className="inline-flex items-center gap-1">
                        {canMutate && (
                          <>
                            <button
                              type="button"
                              onClick={() => setAdvanceBiker(r)}
                              className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors duration-150 p-1.5 rounded-control hover:bg-amber-50 dark:hover:bg-amber-500/15 cursor-pointer"
                              aria-label={`سلفة لـ ${r.name}`}
                              title="تسجيل سلفة"
                            >
                              <HandCoins size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingBiker(r)}
                              className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors duration-150 p-1.5 rounded-control hover:bg-indigo-50 dark:hover:bg-indigo-500/15 cursor-pointer"
                              aria-label={`تعديل ${r.name}`}
                              title="تعديل البيانات"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(r)}
                              className="sw-tap inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors duration-150 p-1.5 rounded-control hover:bg-rose-50 dark:hover:bg-rose-500/15 cursor-pointer"
                              aria-label={`حذف ${r.name}`}
                              title="حذف الملف — الغسلات القديمة تبقى"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
          </>
        )}
      </main>

      <AddBikerModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onAdd={handleAdd}
        bikers={bikers}
      />
      <AddBikerModal
        isOpen={Boolean(editingBiker)}
        onClose={() => setEditingBiker(null)}
        onUpdate={handleEdit}
        initialValues={editingBiker}
        bikers={bikers}
      />
      <AddBikerAdvanceModal
        isOpen={Boolean(advanceBiker)}
        onClose={() => setAdvanceBiker(null)}
        biker={advanceBiker}
        onAdd={handleAdvance}
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
