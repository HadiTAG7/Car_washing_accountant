import { useCallback, useMemo, useState } from 'react';
import {
  Boxes, Plus, Download, Loader2, TrendingDown, Package, Layers,
  CalendarClock, PackageMinus, PowerOff, Power, AlertTriangle,
} from 'lucide-react';
import { formatCurrency, formatCurrencyPrecise } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, PrimaryButton, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useFixedAssets } from '../hooks/useFixedAssets';
import { useAuth } from '../hooks/useAuth';
import {
  createAsset, postDepreciationForPeriod, postDepreciationBacklog,
  disposeAsset, setAssetActive,
} from '../lib/accounting/firestoreAssets';
import { USEFUL_LIFE_PRESETS, validateAsset } from '../lib/accounting/depreciation';
import { isFirebaseConfigured, missingEnvNames, describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

const todayIso = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  name: '', cost: '', salvageValue: '', usefulLifeMonths: 60, inServiceDate: todayIso(),
});

/**
 * الأصول الثابتة — the register, its straight-line schedules, and the monthly
 * charge that turns a capitalised purchase into an expense over its life.
 *
 * Capitalising to 1500 and never depreciating overstates both the assets and
 * the profit every month, forever; this page is where that stops. Posting a
 * month is deliberate and idempotent — the ledger, not a flag on the asset,
 * is what says a month has been charged.
 */
export default function FixedAssetsPage() {
  const {
    assets, summary, pendingPeriods, period, reconciliation, loading, error, refetch,
  } = useFixedAssets();
  const { user } = useAuth();
  const { canMutate } = usePartnerView();

  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  const draft = useMemo(() => ({
    name: form.name.trim(),
    cost: Number(form.cost) || 0,
    salvageValue: Number(form.salvageValue) || 0,
    usefulLifeMonths: Number(form.usefulLifeMonths) || 0,
    inServiceDate: form.inServiceDate,
  }), [form]);
  const draftProblems = useMemo(() => validateAsset(draft), [draft]);
  const draftMonthly = draftProblems.length === 0
    ? Math.round(((draft.cost - draft.salvageValue) / draft.usefulLifeMonths) * 100) / 100
    : 0;

  const backlogTotal = pendingPeriods.reduce((s, p) => s + p.total, 0);

  async function handleAdd() {
    if (draftProblems.length) { showToast(draftProblems[0], 'error'); return; }
    setBusy('add');
    try {
      await createAsset(draft, { userId: user?.id });
      setForm(emptyForm());
      setShowForm(false);
      showToast(`تمت إضافة «${draft.name}» إلى سجل الأصول.`);
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّرت الإضافة', 'error');
    } finally { setBusy(''); }
  }

  async function handlePostPeriod(periodKey) {
    setBusy(periodKey);
    try {
      const r = await postDepreciationForPeriod(periodKey, { userId: user?.id });
      showToast(`تم ترحيل إهلاك ${periodKey} — ${r.assetCount} أصل بمبلغ ${formatCurrencyPrecise(r.total)}.`);
      await refetch();
    } catch (e) {
      showToast(e?.message || 'تعذّر الترحيل', 'error');
    } finally { setBusy(''); }
  }

  async function handlePostBacklog() {
    const ok = typeof window === 'undefined' || window.confirm(
      `ترحيل إهلاك ${pendingPeriods.length} شهر بإجمالي ${formatCurrencyPrecise(backlogTotal)}؟\n\n`
      + 'يُرحَّل كل شهر بقيد مستقل مؤرَّخ في آخر يوم منه. '
      + 'العملية قابلة للتكرار: أي شهر مُرحّل يُتجاوَز تلقائياً.',
    );
    if (!ok) return;
    setBusy('backlog');
    setProgress({ done: 0, total: pendingPeriods.length, label: '' });
    try {
      const r = await postDepreciationBacklog({
        userId: user?.id, onProgress: (p) => setProgress(p),
      });
      showToast(
        r.failed.length
          ? `تم ترحيل ${r.posted.length} شهر، وفشل ${r.failed.length}.`
          : `تم ترحيل إهلاك ${r.posted.length} شهر.`,
        r.failed.length ? 'error' : 'success',
      );
      if (r.failed.length) console.error('[depreciation] failures:', r.failed);
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الترحيل', 'error');
    } finally { setBusy(''); setProgress(null); }
  }

  async function handleDispose(asset) {
    const date = typeof window === 'undefined' ? '' : window.prompt(
      `تاريخ استبعاد «${asset.name}» (YYYY-MM-DD):`, todayIso(),
    );
    if (date == null) return;
    const proceedsRaw = window.prompt('المتحصلات من البيع (0 إذا كان إخراجاً بلا مقابل):', '0');
    if (proceedsRaw == null) return;
    const ok = window.confirm(
      `استبعاد «${asset.name}»؟\n\n`
      + `القيمة الدفترية الحالية: ${formatCurrencyPrecise(asset.netBookValue)}\n`
      + `المتحصلات: ${formatCurrencyPrecise(Number(proceedsRaw) || 0)}\n\n`
      + 'سيُرحَّل قيد يُقفل الأصل ومجمّع إهلاكه ويسجّل الربح أو الخسارة.',
    );
    if (!ok) return;
    setBusy(asset.id);
    try {
      const r = await disposeAsset(asset.id, {
        disposalDate: date, proceeds: Number(proceedsRaw) || 0, userId: user?.id,
      });
      showToast(r.result >= 0
        ? `تم الاستبعاد بربح ${formatCurrencyPrecise(r.result)}.`
        : `تم الاستبعاد بخسارة ${formatCurrencyPrecise(-r.result)}.`);
      await refetch();
    } catch (e) {
      showToast(e?.message || 'تعذّر الاستبعاد', 'error');
    } finally { setBusy(''); }
  }

  async function handleToggleActive(asset) {
    setBusy(asset.id);
    try {
      await setAssetActive(asset.id, asset.active === false, { userId: user?.id });
      showToast(asset.active === false ? 'تم تفعيل الأصل.' : 'تم تعطيل الأصل — لن يُحتسب له إهلاك.');
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر التعديل', 'error');
    } finally { setBusy(''); }
  }

  function handleExport() {
    downloadCsv(
      `سجل-الأصول-${period}`,
      ['الأصل', 'التكلفة', 'التخريدية', 'العمر (شهر)', 'بدء التشغيل', 'القسط الشهري',
        'مجمع الإهلاك', 'القيمة الدفترية', 'نهاية الإهلاك', 'الحالة'],
      assets.map((a) => [
        a.name, Number(a.cost.toFixed(2)), Number((a.salvageValue || 0).toFixed(2)),
        a.usefulLifeMonths, a.inServiceDate, Number(a.monthly.toFixed(2)),
        Number(a.accumulated.toFixed(2)), Number(a.netBookValue.toFixed(2)),
        a.endPeriod,
        a.disposalDate ? `مستبعد ${a.disposalDate}` : a.active === false ? 'معطّل'
          : a.fullyDepreciated ? 'مهلك بالكامل' : 'قيد التشغيل',
      ]),
    );
  }

  return (
    <>
      <TopBar title="الأصول الثابتة" subtitle="السجل وجدول الإهلاك بالقسط الثابت وقيوده الشهرية" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل سجل الأصول" error={error} onRetry={refetch} />}

        {reconciliation.length > 0 && (
          <div role="alert" className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                إهلاك مُرحَّل لا يطابق السجل — غالباً أصل أُضيف بتاريخ سابق بعد ترحيل شهوره.
              </p>
              {reconciliation.map((r) => (
                <p key={r.periodKey} className="tabular-nums mt-0.5">
                  {r.periodKey}: المُرحَّل {formatCurrencyPrecise(r.posted)} ·
                  {' '}المطلوب حسب السجل {formatCurrencyPrecise(r.expected)} ·
                  {' '}الفرق {formatCurrencyPrecise(r.difference)}
                </p>
              ))}
              <p className="mt-1">
                لا يُصحَّح هذا بإعادة الترحيل — القيد المُرحّل لا يُعدَّل. اعكس قيد الشهر
                ثم رحّله من جديد، أو سجّل الفرق كقيد تسوية في فترة مفتوحة.
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingState message="جارٍ تحميل السجل..." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-5">
              <StatCard icon={Package} tone="primary" label="أصول قيد التشغيل"
                value={String(summary.count)} sub={summary.disposed ? `${summary.disposed} مستبعد` : undefined} />
              <StatCard icon={Layers} tone="indigo" label="إجمالي التكلفة" value={formatCurrency(summary.cost)} />
              <StatCard icon={TrendingDown} tone="amber" label="مجمع الإهلاك"
                value={formatCurrency(summary.accumulated)} sub={`حتى ${period}`} />
              <StatCard icon={Boxes} tone="emerald" label="القيمة الدفترية" value={formatCurrency(summary.netBookValue)} />
            </div>

            {/* ── الأشهر المستحقة ───────────────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="قيود الإهلاك المستحقة"
                subtitle="كل شهر بقيد مستقل مؤرَّخ في آخر يوم منه — مدين مصروف الإهلاك، دائن مجمع الإهلاك"
                action={canMutate && pendingPeriods.length > 0 ? (
                  <PrimaryButton icon={busy === 'backlog' ? Loader2 : CalendarClock}
                    onClick={handlePostBacklog} disabled={Boolean(busy)}>
                    {busy === 'backlog' ? 'جارٍ الترحيل...' : `ترحيل ${pendingPeriods.length} شهر`}
                  </PrimaryButton>
                ) : null}
              />
              {progress && (
                <p role="status" className="text-xs text-slate-600 dark:text-slate-300 tabular-nums mb-3">
                  {progress.done} / {progress.total} — {progress.label}
                </p>
              )}
              {pendingPeriods.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {assets.length === 0
                    ? 'لا توجد أصول في السجل بعد — أضف أصلاً ليبدأ جدول إهلاكه.'
                    : 'كل الأشهر المستحقة حتى اليوم مُرحّلة. لا يُرحَّل شهر مستقبلي لأن مصروفه لم يُستحق بعد.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[34rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">الشهر</th>
                        <th className="py-3 px-4 text-center">عدد الأصول</th>
                        <th className="py-3 px-4 text-left">مبلغ الإهلاك</th>
                        <th className="py-3 px-4 text-left">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingPeriods.map((p) => (
                        <tr key={p.periodKey} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 tabular-nums font-bold text-slate-900 dark:text-slate-100">{p.periodKey}</td>
                          <td className="py-3 px-4 text-center tabular-nums text-slate-700 dark:text-slate-300">{p.rows.length}</td>
                          <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(p.total)}</td>
                          <td className="py-3 px-4 text-left">
                            {canMutate ? (
                              <SecondaryButton icon={busy === p.periodKey ? Loader2 : TrendingDown}
                                onClick={() => handlePostPeriod(p.periodKey)} disabled={Boolean(busy)}>
                                {busy === p.periodKey ? '...' : 'ترحيل'}
                              </SecondaryButton>
                            ) : (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">للعرض فقط</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── إضافة أصل ─────────────────────────────────────────── */}
            {canMutate && (
              <Card className="p-6">
                <SectionHeader
                  title="إضافة أصل"
                  subtitle="التكلفة بالصافي بعد استبعاد الضريبة القابلة للاسترداد"
                  action={(
                    <SecondaryButton icon={Plus} onClick={() => setShowForm((s) => !s)}>
                      {showForm ? 'إخفاء' : 'أصل جديد'}
                    </SecondaryButton>
                  )}
                />
                {showForm && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div className="lg:col-span-2">
                        <label htmlFor="asset-name" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">اسم الأصل</label>
                        <input id="asset-name" type="text" value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="مثال: ماكينة ضغط عالي"
                          className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100" />
                      </div>
                      <div>
                        <label htmlFor="asset-cost" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">التكلفة</label>
                        <input id="asset-cost" type="number" min="0" step="0.01" value={form.cost}
                          onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                          className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                      </div>
                      <div>
                        <label htmlFor="asset-salvage" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          القيمة التخريدية
                        </label>
                        <input id="asset-salvage" type="number" min="0" step="0.01" value={form.salvageValue}
                          onChange={(e) => setForm((f) => ({ ...f, salvageValue: e.target.value }))}
                          placeholder="0"
                          className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">بدء التشغيل</label>
                        <DateField name="inServiceDate" value={form.inServiceDate}
                          onChange={(e) => setForm((f) => ({ ...f, inServiceDate: e.target.value }))}
                          ariaLabel="تاريخ بدء التشغيل" />
                      </div>
                      <div className="lg:col-span-3">
                        <label htmlFor="asset-life" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                          العمر الإنتاجي (بالأشهر)
                        </label>
                        <div className="flex gap-2">
                          <input id="asset-life" type="number" min="1" step="1" value={form.usefulLifeMonths}
                            onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                            className="w-28 min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                          <select aria-label="عمر جاهز" value=""
                            onChange={(e) => e.target.value && setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                            className="flex-1 min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                            <option value="">اختر عمراً جاهزاً…</option>
                            {USEFUL_LIFE_PRESETS.map((p) => (
                              <option key={p.months} value={p.months}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="lg:col-span-2 flex items-end justify-between gap-3">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          القسط الشهري{' '}
                          <span className="tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {formatCurrencyPrecise(draftMonthly)}
                          </span>
                        </p>
                        <PrimaryButton icon={busy === 'add' ? Loader2 : Plus} onClick={handleAdd}
                          disabled={Boolean(busy) || draftProblems.length > 0}>
                          {busy === 'add' ? 'جارٍ الحفظ...' : 'إضافة'}
                        </PrimaryButton>
                      </div>
                    </div>
                    {draftProblems.length > 0 && form.name.trim() !== '' && (
                      <p role="alert" className="text-xs text-rose-700 dark:text-rose-300 mt-3 leading-relaxed">
                        {draftProblems[0]}
                      </p>
                    )}
                  </>
                )}
              </Card>
            )}

            {/* ── السجل ─────────────────────────────────────────────── */}
            <Card className="p-6">
              <SectionHeader
                title="سجل الأصول"
                subtitle={`الأرصدة كما في ${period} — اضغط اسم الأصل لعرض جدول إهلاكه`}
                action={assets.length > 0 ? (
                  <SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>
                ) : null}
              />
              {assets.length === 0 ? (
                <EmptyState icon={Boxes} title="لا توجد أصول ثابتة بعد"
                  hint="أضف أصلاً ليبدأ جدول إهلاكه تلقائياً من شهر تشغيله." compact />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[52rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">الأصل</th>
                        <th className="py-3 px-4 text-left">التكلفة</th>
                        <th className="py-3 px-4">بدء التشغيل</th>
                        <th className="py-3 px-4 text-center">العمر</th>
                        <th className="py-3 px-4 text-left">القسط الشهري</th>
                        <th className="py-3 px-4 text-left">مجمع الإهلاك</th>
                        <th className="py-3 px-4 text-left">القيمة الدفترية</th>
                        <th className="py-3 px-4 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((a) => {
                        const isOpen = expanded === a.id;
                        const inactive = a.disposalDate || a.active === false;
                        return [
                          <tr key={a.id} className={`border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${inactive ? 'opacity-60' : ''}`}>
                            <td className="py-3 px-4">
                              <button type="button" onClick={() => setExpanded(isOpen ? null : a.id)}
                                aria-expanded={isOpen}
                                className="font-semibold text-slate-900 dark:text-slate-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-right">
                                {a.name}
                              </button>
                              {a.disposalDate && (
                                <span className="block text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                                  مستبعد في {a.disposalDate}
                                </span>
                              )}
                              {!a.disposalDate && a.active === false && (
                                <span className="block text-[10px] text-slate-500 dark:text-slate-400">معطّل</span>
                              )}
                              {!inactive && a.fullyDepreciated && (
                                <span className="block text-[10px] text-emerald-700 dark:text-emerald-300">مهلك بالكامل</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(a.cost)}</td>
                            <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{a.inServiceDate}</td>
                            <td className="py-3 px-4 text-center tabular-nums text-slate-700 dark:text-slate-300">{a.usefulLifeMonths}</td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(a.monthly)}</td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(a.accumulated)}</td>
                            <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">{formatCurrencyPrecise(a.netBookValue)}</td>
                            <td className="py-3 px-4 text-left whitespace-nowrap">
                              {!canMutate ? (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">للعرض فقط</span>
                              ) : a.disposalDate ? (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">—</span>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button type="button" title="استبعاد الأصل (بيع أو إخراج)"
                                    onClick={() => handleDispose(a)} disabled={busy === a.id}
                                    className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                                    <PackageMinus size={16} />
                                  </button>
                                  <button type="button" title={a.active === false ? 'تفعيل' : 'تعطيل — إيقاف احتساب الإهلاك'}
                                    onClick={() => handleToggleActive(a)} disabled={busy === a.id}
                                    className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
                                    {a.active === false ? <Power size={16} /> : <PowerOff size={16} />}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>,
                          isOpen && (
                            <tr key={`${a.id}-schedule`} className="border-b border-slate-50 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-800/30">
                              <td colSpan={8} className="py-4 px-4">
                                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">
                                  جدول الإهلاك — {a.schedule.length} شهر من {a.startPeriod} إلى {a.endPeriod}
                                </h4>
                                {a.schedule.length === 0 ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">لا يوجد جدول — راجع بيانات الأصل.</p>
                                ) : (
                                  <div className="max-h-64 overflow-y-auto">
                                    <table className="w-full text-xs">
                                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                                        <tr className="text-right text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                          <th className="py-1.5 pl-3">الشهر</th>
                                          <th className="py-1.5 pl-3 text-left">القسط</th>
                                          <th className="py-1.5 pl-3 text-left">المجمّع</th>
                                          <th className="py-1.5 text-left">القيمة الدفترية</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {a.schedule.map((r) => (
                                          <tr key={r.periodKey} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                            <td className="py-1.5 pl-3 tabular-nums text-slate-700 dark:text-slate-300">{r.periodKey}</td>
                                            <td className="py-1.5 pl-3 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(r.amount)}</td>
                                            <td className="py-1.5 pl-3 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(r.accumulated)}</td>
                                            <td className="py-1.5 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(r.netBookValue)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-slate-800 font-bold">
                        <td className="py-3 px-4 text-slate-900 dark:text-slate-100">الإجمالي</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.cost)}</td>
                        <td className="py-3 px-4" colSpan={3} />
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.accumulated)}</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.netBookValue)}</td>
                        <td className="py-3 px-4" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </main>

      <Toast open={toast.open} message={toast.message} tone={toast.tone}
        duration={toast.duration} onClose={closeToast} />
    </>
  );
}
