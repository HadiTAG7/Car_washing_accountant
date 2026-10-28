import { translate } from '../i18n/locale';
import { useCallback, useMemo, useState } from 'react';
import {
  Lock, Unlock, ShieldCheck, AlertTriangle, CheckCircle2, Loader2, Database, Upload,
  CalendarRange, FilePlus2, Zap, Link2, Receipt,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, PrimaryButton, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import DateField from './DateField';
import { useLedger } from '../hooks/useLedger';
import { useAuth } from '../hooks/useAuth';
import { closePreflight, currentPeriodKey } from '../lib/accounting/periods';
import { closePeriod, reopenPeriod, seedChartOfAccounts, fetchCloseReadiness } from '../lib/accounting/firestoreLedger';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { collectUnposted, postUnposted } from '../lib/accounting/postOperations';
import {
  previewGeneration, generateVouchers, fetchVoucherBundle, setVoucherInvoice,
} from '../lib/accounting/firestoreRecurring';
import VoucherInvoiceModal from './VoucherInvoiceModal';
import OperationsReadinessBanner from './OperationsReadinessBanner';
import { linkLegacyInvoices } from '../lib/accounting/firestoreInvoicing';
import { addMonths } from '../lib/accounting/depreciation';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { isFirebaseConfigured, missingEnvNames, describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

/**
 * إقفال الفترة — freezes a month so a filed period keeps matching what was
 * filed. Closing is gated on a preflight that must pass; after closing, a
 * correction is a dated entry in an OPEN period, not an edit to history.
 */
export default function PeriodClosePage() {
  const { entries, periods, linesByEntry, needsSeeding, loading, error, refetch } = useLedger();
  const { user } = useAuth();
  const { canMutate, role } = usePartnerView();
  const readinessQuery = useFirestoreQuery(fetchCloseReadiness, {
    enabled: isFirebaseConfigured, fallback: null, preserveResult: true,
  });
  const readinessByKey = new Map((readinessQuery.data?.periods || []).map(p => [p.periodKey, p]));
  const [editingSettings, setEditingSettings] = useState(false);
  const [pendingSetting, setPendingSetting] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [operationsOpen,setOperationsOpen]=useState(()=>new Set([currentPeriodKey()]));
  const {
    settings, update: updateSettings, setPolicy, seedPolicy,
    baselineFrom, policyConfigured,
  } = useAccountingSettings();
  const [busy, setBusy] = useState('');
  // Result of the last unposted-operations scan / sweep.
  const [scan, setScan] = useState(null);
  const [progress, setProgress] = useState(null);
  // Recurring-voucher generation: a range, and a preview of what it would create.
  const [range, setRange] = useState(() => ({
    from: addMonths(currentPeriodKey(), -2), through: currentPeriodKey(),
  }));
  const [genPreview, setGenPreview] = useState(null);
  // The generated vouchers, and the one whose supplier invoice is being
  // recorded. A voucher without an invoice number, date and supplier gets no
  // input-VAT asset — in the ledger AND in the return — so there has to be a
  // way to record one; the template cannot supply it, since the paper is
  // per-period.
  const [vouchers, setVouchers] = useState(null);
  const [invoiceFor, setInvoiceFor] = useState(null);
  // Legacy invoices with no ledger link: the dry-run plan, then the apply.
  const [legacyPlan, setLegacyPlan] = useState(null);
  // The date a tax-switch change takes effect from. Today by default, because
  // a change made today applies from today — back-dating one restates a period
  // that has already been filed, so it has to be typed on purpose.
  const [policyFrom, setPolicyFrom] = useState('');
  // The date the CURRENT policy started, asked for once. Never inferred: a
  // guessed baseline is the same bug wearing a timestamp.
  const [baselineDraft, setBaselineDraft] = useState('');
  const [policyReason, setPolicyReason] = useState('');
  const [closeKey, setCloseKey] = useState('');
  const [reopenKey, setReopenKey] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // Every month that has entries, plus the current one, newest first.
  const periodKeys = useMemo(() => {
    const set = new Set(entries.map((e) => e.periodKey).filter(Boolean));
    periods.forEach((p) => set.add(p.periodKey));
    set.add(currentPeriodKey());
    return [...set].sort().reverse();
  }, [entries, periods]);

  const statusOf = useCallback(
    (key) => periods.find((p) => p.periodKey === key)?.status || 'open',
    [periods],
  );

  const preflights = useMemo(() => {
    const m = new Map();
    for (const key of periodKeys) m.set(key, closePreflight(key, { entries, linesByEntry }));
    return m;
  }, [periodKeys, entries, linesByEntry]);

  async function handleSeed() {
    setBusy('seed');
    try {
      const r = await seedChartOfAccounts();
      showToast(r.created > 0
        ? `تمت تهيئة دليل الحسابات — ${r.created} حساب جديد.`
        : 'دليل الحسابات مُهيّأ بالفعل.');
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّرت التهيئة', 'error');
    } finally { setBusy(''); }
  }

  async function handleScan() {
    setBusy('scan');
    try {
      const r = await collectUnposted();
      setScan(r);
      showToast(r.ready.length
        ? `${r.ready.length} عملية جاهزة للترحيل.`
        : 'لا توجد عمليات غير مُرحّلة.');
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الفحص', 'error');
    } finally { setBusy(''); }
  }

  async function handlePostAll() {
    const pending = scan?.ready?.length || 0;
    const ok = typeof window === 'undefined' || window.confirm(
      translate(`ترحيل ${pending} عملية إلى دفتر الأستاذ؟\n\n`
      + 'العملية آمنة وقابلة للتكرار: أي عملية مُرحّلة مسبقاً تُتجاوز تلقائياً.'),
    );
    if (!ok) return;
    setBusy('post');
    setProgress({ done: 0, total: pending, label: '' });
    try {
      const r = await postUnposted({ onProgress: (p) => setProgress(p) });
      setScan(null);
      showToast(
        r.failed.length
          ? `تم ترحيل ${r.posted.length} عملية، وفشل ${r.failed.length}.`
          : `تم ترحيل ${r.posted.length} عملية بنجاح.`,
        r.failed.length ? 'error' : 'success',
      );
      if (r.failed.length) console.error('[posting] failures:', r.failed);
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الترحيل', 'error');
    } finally { setBusy(''); setProgress(null); }
  }

  /**
   * Saving a TAX switch records the date it takes effect — on the SERVER.
   *
   * `vatRegistered`, `washPriceMode` and the rate decide what a wash's revenue
   * is, so changing one without a date silently restates every past month that
   * is derived from raw wash rows. And the FIRST change needs a baseline date
   * as well: storing only the new row would leave every earlier month either
   * unanswerable or, worse, answered by the new policy.
   */
  async function handlePolicy(patch, confirmed = false) {
    if (!confirmed) { setPendingSetting({ kind: 'policy', patch }); return; }
    setBusy('settings');
    try {
      await setPolicy({
        vatRegistered: settings.vatRegistered,
        washPriceMode: settings.washPriceMode,
        vatRate: settings.vatRate,
        ...patch,
        effectiveFrom: policyFrom,
        baselineFrom: policyConfigured ? null : baselineDraft,
        reason: policyReason.trim() || null,
      });
      showToast(`تم الحفظ، ساري من ${policyFrom}. الأشهر السابقة تبقى على قواعدها.`);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الحفظ', 'error');
    } finally { setBusy(''); }
  }

  /** Records the baseline without changing anything — makes the past readable. */
  async function handleSeedPolicy(confirmed = false) {
    if (confirmed !== true) { setPendingSetting({ kind: 'seed' }); return; }
    setBusy('settings');
    try {
      await seedPolicy({ baselineFrom: baselineDraft, note: policyReason.trim() || null });
      showToast(`تم تسجيل السياسة القائمة من ${baselineDraft}.`);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّرت التهيئة', 'error');
    } finally { setBusy(''); }
  }

  /** The switches that move no past figure. */
  async function handleSetting(patch, confirmed = false) {
    if (!confirmed) { setPendingSetting({ kind: 'setting', patch }); return; }
    setBusy('settings');
    try {
      await updateSettings(patch);
      showToast('تم حفظ إعدادات المحاسبة.');
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الحفظ', 'error');
    } finally { setBusy(''); }
  }

  async function handleToggleAutoPost(next) {
    setPendingSetting({ kind: 'setting', patch: { autoPost: next } });
  }

  /**
   * ربط الفواتير القديمة — dry-run first, always.
   *
   * Invoices issued before the two-path split carry no ledger link, so no
   * credit note can be raised against them. The scan adopts only links a
   * document already declares and that the posting lock, the entry and the
   * total all confirm; anything else is listed for a person to decide,
   * because a guessed link writes a tax document to an entry that may not be
   * its own.
   */
  async function handleScanLegacy() {
    setBusy('legacy-scan');
    try {
      const r = await linkLegacyInvoices({ apply: false });
      setLegacyPlan(r);
      showToast(r.candidates === 0
        ? 'كل الفواتير مرتبطة بقيودها — لا يوجد ما يُرحَّل.'
        : `${r.linkable.length} فاتورة قابلة للربط المؤكد، و${r.review.length} تحتاج مراجعة يدوية.`);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الفحص', 'error');
    } finally { setBusy(''); }
  }

  async function handleApplyLegacy() {
    const count = legacyPlan?.linkable?.length || 0;
    const ok = typeof window === 'undefined' || window.confirm(
      translate(`ربط ${count} فاتورة بقيودها؟\n\n`
      + 'يُكتب الرابط فقط — رقم المستند وتاريخه ومبالغه ورمز QR لا تُمسّ. '
      + 'الحالات الغامضة لا تُربط.'),
    );
    if (!ok) return;
    setBusy('legacy-apply');
    try {
      const r = await linkLegacyInvoices({ apply: true });
      setLegacyPlan(r);
      showToast(`تم ربط ${r.applied} فاتورة. المتبقي للمراجعة اليدوية: ${r.review.length}.`);
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الربط', 'error');
    } finally { setBusy(''); }
  }

  async function handlePreviewVouchers() {
    setBusy('preview');
    try {
      const r = await previewGeneration(range);
      setGenPreview(r);
      showToast(r.toCreate.length
        ? `${r.toCreate.length} سند سيُنشأ في المدى المحدد.`
        : 'لا توجد سندات ناقصة في هذا المدى.');
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الفحص', 'error');
    } finally { setBusy(''); }
  }

  async function handleLoadVouchers() {
    setBusy('vouchers');
    try {
      const b = await fetchVoucherBundle();
      setVouchers(b.vouchers);
      showToast(`${b.vouchers.length} سند محمَّل.`);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر تحميل السندات', 'error');
    } finally { setBusy(''); }
  }

  async function handleSaveVoucherInvoice(id, fields) {
    await setVoucherInvoice(id, { ...fields, userId: user?.id });
    const b = await fetchVoucherBundle();
    setVouchers(b.vouchers);
    setScan(null);
    showToast('حُفظت بيانات الفاتورة — صار السند مؤهلاً لخصم ضريبته عند الترحيل.');
  }

  async function handleGenerateVouchers() {
    const count = genPreview?.toCreate?.length || 0;
    const ok = typeof window === 'undefined' || window.confirm(
      translate(`إنشاء ${count} سند من ${range.from} إلى ${range.through}؟\n\n`
      + 'كل سند يحمل تاريخ استحقاق حقيقي، فيصبح قابلاً للترحيل وللمطالبة بضريبته. '
      + 'العملية قابلة للتكرار: رقم السند مشتق من المصروف والفترة، فلا يتكرر.'),
    );
    if (!ok) return;
    setBusy('generate');
    try {
      const r = await generateVouchers({ ...range, userId: user?.id });
      setGenPreview(null);
      setScan(null);
      showToast(`تم إنشاء ${r.created} سند عبر ${r.periods.length} فترة.`);
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الإنشاء', 'error');
    } finally { setBusy(''); }
  }

  async function handleClose(key) {
    setBusy(key);
    try {
      await closePeriod(key, { overrideReason });
      showToast(`تم إقفال الفترة ${key}.`);
      setCloseKey('');
      setOverrideReason('');
      await readinessQuery.refetch();
      await refetch();
    } catch (e) {
      showToast(e?.message || 'تعذّر الإقفال', 'error');
    } finally { setBusy(''); }
  }

  async function handleReopen(key) {
    // A reason is required by the rules, not just asked for here: re-opening
    // a filed period is the one action that can change what a filed month
    // says, so it needs an admin and a stated why.
    const reason = reopenReason.trim();
    if (!reason) { showToast('سبب إعادة الفتح مطلوب.', 'error'); return; }
    setBusy(key);
    try {
      await reopenPeriod(key, { reason });
      showToast(`تمت إعادة فتح الفترة ${key}.`);
      setReopenKey('');
      setReopenReason('');
      await refetch();
    } catch (e) {
      showToast(e?.message || 'تعذّرت إعادة الفتح', 'error');
    } finally { setBusy(''); }
  }

  const closedCount = periodKeys.filter((k) => statusOf(k) === 'closed').length;

  return (
    <>
      <TopBar title="إقفال الفترة" subtitle="تجميد الشهر بعد التحقق من توازن القيود" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل الفترات" error={error} onRetry={refetch} />}
        {readinessQuery.error && <ErrorState title="تعذّر فحص جاهزية الإقفال" error={readinessQuery.error} onRetry={readinessQuery.refetch} />}
        <Card className="p-5 space-y-4">
          <SectionHeader title="قائمة فحص الإقفال" subtitle="قراءة فقط؛ لا تُرحّل عمليات ولا تغيّر الفترات"
            action={<SecondaryButton onClick={readinessQuery.refetch} disabled={readinessQuery.loading}>تحديث الفحص</SecondaryButton>} />
          {readinessQuery.loading && <p>جارٍ فحص الجاهزية...</p>}
          {(readinessQuery.data?.periods || []).map(period => <details key={period.periodKey} open={period.periodKey === currentPeriodKey()} onToggle={event=>{const open=event.currentTarget.open;setOperationsOpen(previous=>{if(previous.has(period.periodKey)===open)return previous;const next=new Set(previous);if(open)next.add(period.periodKey);else next.delete(period.periodKey);return next;});}} className="rounded-control border border-slate-300 dark:border-slate-700 p-3">
            <summary className={period.ok ? 'text-emerald-500 font-bold cursor-pointer' : 'text-rose-500 font-bold cursor-pointer'}>
              {period.periodKey} · {period.ok ? 'جاهزة للإقفال' : `غير جاهزة: ${period.failedCount} بنود`}
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              <li>{operationsOpen.has(period.periodKey)?<OperationsReadinessBanner periodKey={period.periodKey}/>:<a href={`?page=operations_close&period=${period.periodKey}`}>جاهزية شهر التشغيل · فتح قائمة الفحص</a>}</li>
              {period.checks.map(check => <li key={check.id} className={!check.applicable ? 'text-slate-500' : check.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                <a href={check.href}>{!check.applicable ? '—' : check.ok ? '✓' : '✗'} {check.label} · {check.count}{check.amount != null ? ` · ${formatCurrency(check.amount)}` : ''}</a>
                {check.note && <small className="block text-slate-500 mt-1 break-words">{check.note}</small>}
              </li>)}
            </ul>
            <p className="text-xs text-slate-500 mt-3">تاريخ الفحص: {period.today}</p>
          </details>)}
        </Card>

        {needsSeeding && (
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-10 h-10 rounded-control flex items-center justify-center shrink-0">
                  <Database size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">دليل الحسابات غير مُهيّأ</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                    أنشئ دليل الحسابات الافتراضي لمغسلة السيارات — عملية آمنة وقابلة للتكرار،
                    ولا تُعدّل أي حساب موجود.
                  </p>
                </div>
              </div>
              {canMutate && (
                <PrimaryButton icon={busy === 'seed' ? Loader2 : Database} onClick={handleSeed}
                  disabled={busy === 'seed'} className="shrink-0">
                  {busy === 'seed' ? 'جارٍ التهيئة...' : 'تهيئة دليل الحسابات'}
                </PrimaryButton>
              )}
            </div>
          </Card>
        )}

        {loading ? (
          <LoadingState message="جارٍ فحص الفترات..." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">
              <StatCard icon={ShieldCheck} tone="primary" label="عدد الفترات" value={String(periodKeys.length)} />
              <StatCard icon={Lock} tone="emerald" label="فترات مقفلة" value={String(closedCount)} />
              <StatCard className="col-span-2 md:col-span-1" icon={Unlock} tone="amber"
                label="فترات مفتوحة" value={String(periodKeys.length - closedCount)} />
            </div>

            {/* ── إعدادات المحاسبة ───────────────────────────────────
                Three switches that change what every figure downstream
                means, so they live in one place rather than being assumed:
                whether the business is VAT-registered, whether wash prices
                include the tax, and how often the return is filed. */}
            <Card className="p-6">
              <SectionHeader
                title="إعدادات المحاسبة"
                action={canMutate && <SecondaryButton onClick={() => { setEditingSettings(!editingSettings); setPendingSetting(null); }}>{editingSettings ? 'إنهاء التعديل' : 'تعديل الإعدادات'}</SecondaryButton>}
                subtitle="تحكم في احتساب الضريبة ودورية الإقرار — تنعكس مباشرة على تقرير ضريبة القيمة المضافة والقيود"
              />
              {/* ── السجل التاريخي للسياسة ────────────────────────────
                  Until this exists, "what were the rules in July?" has no
                  answer — and the honest reading of an unconfigured install is
                  that today's switches are an ASSUMPTION about every past
                  month, not a record of one. The date is asked for, never
                  inferred: a guessed baseline is the same bug with a
                  timestamp on it. */}
              <details className="my-3 text-xs"><summary className="cursor-pointer">سجل تغييرات الإعدادات وتواريخ السريان</summary>
                <ul className="mt-2 space-y-2">{(settings.taxPolicyHistory || []).map((row, index) => <li key={`${row.effectiveFrom}-${index}`}>
                  {row.effectiveFrom} · {row.vatRegistered ? 'مسجّل' : 'غير مسجّل'} · {row.washPriceMode} · {Number(row.vatRate) * 100}% · {row.reason || row.note || '—'}
                </li>)}</ul>
              </details>
              {!policyConfigured ? (
                <div role="note" className="flex flex-col gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed mb-4">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-bold">السجل التاريخي للسياسة الضريبية غير مُهيّأ.</p>
                      <p className="mt-1">
                        الإعدادات أدناه تُقرأ حالياً كافتراض يسري على كل التواريخ. سجّل تاريخ بدء
                        السياسة الحالية (أو بداية الدفاتر) ليصبح كل شهر سابق قابلاً للإجابة، ولا
                        يتغيّر بتغيير إعداد اليوم.
                      </p>
                    </div>
                  </div>
                  {canMutate && (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-full sm:w-56">
                        <label className="block text-[11px] font-bold mb-1.5">تاريخ بدء السياسة الحالية</label>
                        <DateField
                          name="baselineFrom" value={baselineDraft}
                          onChange={(e) => setBaselineDraft(e.target.value)}
                          ariaLabel="تاريخ بدء السياسة الضريبية الحالية"
                          disabled={busy === 'settings'}
                        />
                      </div>
                      <PrimaryButton
                        icon={busy === 'settings' ? Loader2 : ShieldCheck}
                        onClick={handleSeedPolicy}
                        disabled={!editingSettings || busy === 'settings' || !baselineDraft}
                      >
                        تسجيل السياسة القائمة
                      </PrimaryButton>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                  السجل التاريخي مُهيّأ من {baselineFrom}. التواريخ الأسبق منه تُعرض
                  «السياسة التاريخية غير مهيأة» بدل رقم محسوب بقواعد اليوم.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    التسجيل الضريبي
                  </label>
                  <label className="flex items-center gap-2.5 min-h-touch cursor-pointer select-none">
                    <input type="checkbox" checked={Boolean(settings.vatRegistered)}
                      disabled={!editingSettings || !canMutate || busy === 'settings'}
                      onChange={(e) => handlePolicy({ vatRegistered: e.target.checked })}
                      className="w-4 h-4 accent-primary-600" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      التسجيل الضريبي في سياسة الدفتر (حسب تاريخ السريان)
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    عند إلغائها يُسجَّل كامل مبلغ الغسلة إيراداً بلا ضريبة مخرجات.
                  </p>
                </div>
                <div>
                  <label htmlFor="wash-price-mode" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    سعر الغسلة
                  </label>
                  <select id="wash-price-mode" value={settings.washPriceMode}
                    disabled={!editingSettings || !canMutate || busy === 'settings'}
                    onChange={(e) => handlePolicy({ washPriceMode: e.target.value })}
                    className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                    <option value="inclusive">شامل الضريبة</option>
                    <option value="exclusive">غير شامل الضريبة</option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    «شامل» يستخرج الضريبة من السعر؛ «غير شامل» يضيفها فوقه.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    سريان تغيير الضريبة من
                  </label>
                  <DateField
                    name="policyFrom" value={policyFrom}
                    onChange={(e) => setPolicyFrom(e.target.value)}
                    ariaLabel="تاريخ سريان تغيير إعدادات الضريبة"
                    disabled={!editingSettings || !canMutate || busy === 'settings'}
                  />
                  <input
                    type="text" value={policyReason}
                    disabled={!editingSettings || !canMutate || busy === 'settings'}
                    onChange={(e) => setPolicyReason(e.target.value)}
                    placeholder="سبب التغيير (مطلوب للتاريخ الرجعي)"
                    className="w-full min-h-touch mt-2 px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    تغيير التسجيل أو وضع السعر أو النسبة يُسجَّل بتاريخ سريان، فلا يُعاد احتساب شهر
                    سابق بقواعد اليوم. تاريخ يقع في فترة مقفلة يحتاج مديراً وسبباً مكتوباً.
                  </p>
                </div>
                <div>
                  <label htmlFor="vat-rate" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    نسبة الضريبة
                  </label>
                  <select id="vat-rate" value={String(settings.vatRate)}
                    disabled={!editingSettings || !canMutate || busy === 'settings' || !settings.vatRegistered}
                    onChange={(e) => handlePolicy({ vatRate: Number(e.target.value) })}
                    className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                    <option value="0.15">15%</option>
                    <option value="0.05">5%</option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    النسبة السعودية 15% منذ يوليو 2020، و5% قبلها. تُخزَّن على كل مستند وقيد،
                    فتوثيق نسبة قديمة يُبقيها كما فُوترت.
                  </p>
                </div>
                <div>
                  <label htmlFor="vat-filing" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    دورية الإقرار الضريبي
                  </label>
                  <select id="vat-filing" value={settings.vatFilingPeriod}
                    disabled={!editingSettings || !canMutate || busy === 'settings'}
                    onChange={(e) => handleSetting({ vatFilingPeriod: e.target.value })}
                    className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                    <option value="quarterly">ربع سنوي</option>
                    <option value="monthly">شهري</option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    الإقرار ربع سنوي للتوريدات دون 40 مليون ريال، وشهري فوقها.
                  </p>
                </div>
              </div>
            </Card>

            {/* ── الترحيل التلقائي ───────────────────────────────────
                Off by default, and switched in exactly one visible place: an
                existing install must not silently start writing entries
                because the app updated. */}
            <Card className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <span className={`w-10 h-10 rounded-control flex items-center justify-center shrink-0 ${
                    settings.autoPost
                      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}>
                    <Zap size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">الترحيل التلقائي عند الاعتماد</p>
                    <a className="text-primary-500 text-sm" href="#unposted-scan">{readinessQuery.loading ? 'جارٍ فحص الجاهزية...' : readinessQuery.data ? `${readinessQuery.data.periods.filter(p => statusOf(p.periodKey) !== 'closed').reduce((sum, p) => sum + p.unposted.filter(r => r.approved).length, 0)} عملية تنتظر الترحيل اليدوي` : 'لم يكتمل فحص الجاهزية'}</a>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                      يُرحَّل القيد لحظة إتمام الغسلة أو سداد المصروف — لا عند كل حفظ،
                      بل عند الانتقال إلى الحالة المعتمدة فقط. تُطبَّق نفس الضوابط:
                      لا تكرار، ولا ترحيل في فترة مقفلة، وأي إخفاق يُعرض ولا يُبتلع.
                      {settings.autoPost
                        ? ' تذكّر أن القيد المُرحّل لا يُعدَّل — تعديل السجل بعد الترحيل يحتاج قيداً عكسياً.'
                        : ' الترحيل يتم يدوياً من «فحص غير المُرحّل» أدناه.'}
                    </p>
                  </div>
                </div>
                {canMutate && (
                  <label className="flex items-center gap-2.5 min-h-touch cursor-pointer select-none shrink-0">
                    <input type="checkbox" checked={Boolean(settings.autoPost)} disabled={!editingSettings || Boolean(busy)}
                      onChange={(e) => handleToggleAutoPost(e.target.checked)}
                      className="w-4 h-4 accent-primary-600" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {settings.autoPost ? 'مفعّل' : 'موقوف'}
                    </span>
                  </label>
                )}
              </div>
            </Card>

            {/* ── سندات المصاريف المتكررة ───────────────────────────
                A row like "الإيجار 5,000 شهرياً" is a TEMPLATE, not a
                document: it has no date, so nothing can post it and no VAT
                claim can be dated to it. Generating one dated voucher per
                month turns it into ordinary business the rest of the system
                already knows how to handle. Runs BEFORE the posting sweep,
                because the sweep is what carries the vouchers into the books. */}
            <Card className="p-6" id="recurring-vouchers">
              <SectionHeader
                title="سندات المصاريف المتكررة"
                subtitle="سند مؤرَّخ لكل شهر من كل مصروف متكرر — رقمه مشتق من المصروف والفترة فلا يتكرر"
                action={canMutate ? (
                  <div className="flex items-center gap-2">
                    <SecondaryButton icon={busy === 'preview' ? Loader2 : CalendarRange}
                      onClick={handlePreviewVouchers} disabled={Boolean(busy)}>
                      {busy === 'preview' ? 'جارٍ الفحص...' : 'فحص المدى'}
                    </SecondaryButton>
                    {genPreview && genPreview.toCreate.length > 0 && (
                      <PrimaryButton icon={busy === 'generate' ? Loader2 : FilePlus2}
                        onClick={handleGenerateVouchers} disabled={Boolean(busy)}>
                        {busy === 'generate' ? 'جارٍ الإنشاء...' : `إنشاء ${genPreview.toCreate.length}`}
                      </PrimaryButton>
                    )}
                  </div>
                ) : null}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="gen-from" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">من فترة</label>
                  <input id="gen-from" type="month" value={range.from} dir="ltr"
                    onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setGenPreview(null); }}
                    className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                  <label htmlFor="gen-through" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">إلى فترة</label>
                  <input id="gen-through" type="month" value={range.through} dir="ltr"
                    onChange={(e) => { setRange((r) => ({ ...r, through: e.target.value })); setGenPreview(null); }}
                    className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                </div>
              </div>
              {!genPreview ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  اضغط «فحص المدى» لمعاينة السندات الناقصة قبل إنشائها — لا يُنشأ شيء قبل المعاينة.
                  تاريخ الاستحقاق يُقصَر على آخر يوم في الشهر، فلا يُنتج «31 فبراير».
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                      سندات ستُنشأ ({genPreview.toCreate.length})
                    </h4>
                    {genPreview.toCreate.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        لا شيء — كل الفترات في المدى مغطّاة بالفعل.
                      </p>
                    ) : (
                      <ul className="space-y-1 max-h-56 overflow-y-auto">
                        {genPreview.toCreate.slice(0, 100).map((v) => (
                          <li key={v.id}
                            className="flex items-baseline justify-between gap-3 text-xs py-1 border-b border-slate-50 dark:border-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 min-w-0 truncate">{v.templateName}</span>
                            <span className="tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                              {v.dueDate} · {formatCurrency(v.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                      مصاريف مستبعدة ({genPreview.skipped.length})
                    </h4>
                    {genPreview.skipped.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">لا شيء.</p>
                    ) : (
                      <ul className="space-y-1 max-h-56 overflow-y-auto">
                        {genPreview.skipped.map((s) => (
                          <li key={s.id}
                            className="flex items-baseline justify-between gap-3 text-xs py-1 border-b border-slate-50 dark:border-slate-800/60">
                            <span className="text-slate-600 dark:text-slate-400 min-w-0 truncate">{s.name}</span>
                            <span className="text-slate-500 dark:text-slate-400 shrink-0">{s.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* ── فواتير الموردين على السندات ────────────────────
                  A voucher is created on the due date; the supplier's invoice
                  arrives later. Until its number, date and supplier are on
                  the record, the ledger opens no input-VAT account for it and
                  the VAT report lists it as غير مؤهلة — one rule, stated
                  twice. This is the only place that rule can be satisfied,
                  because the paper is per-period and the template has none. */}
              <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      فواتير الموردين على السندات
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                      سند بلا رقم فاتورة وتاريخ ومورّد لا تُخصم ضريبته — لا في
                      الدفاتر ولا في التقرير. سجّلها هنا حين تصل الورقة.
                    </p>
                  </div>
                  {canMutate && (
                    <SecondaryButton icon={busy === 'vouchers' ? Loader2 : Receipt}
                      onClick={handleLoadVouchers} disabled={Boolean(busy)}>
                      {busy === 'vouchers' ? 'جارٍ التحميل...' : 'عرض السندات'}
                    </SecondaryButton>
                  )}
                </div>
                {vouchers && (() => {
                  // A posted voucher is frozen; a cancelled one is a month
                  // nobody incurred. Neither can take an invoice.
                  const open = vouchers.filter((v) => !v.posted && v.status !== 'cancelled'
                    && v.isTaxInvoice);
                  const missing = open.filter((v) => !v.invoiceNumber || !v.invoiceDate || !v.supplier);
                  return open.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      لا توجد سندات ضريبية غير مُرحّلة.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                        {missing.length} من {open.length} سنداً ينقصها بيان الفاتورة.
                      </p>
                      <ul className="space-y-1 max-h-64 overflow-y-auto">
                        {open.map((v) => {
                          const incomplete = !v.invoiceNumber || !v.invoiceDate || !v.supplier;
                          return (
                            <li key={v.id}
                              className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-slate-50 dark:border-slate-800/60">
                              <span className="text-slate-700 dark:text-slate-300 min-w-0 truncate">
                                {v.templateName || 'مصروف شهري'} — {v.periodKey}
                              </span>
                              <span className={`shrink-0 ${incomplete
                                ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                                {incomplete ? 'بلا فاتورة' : `فاتورة ${v.invoiceNumber}`}
                              </span>
                              {canMutate && (
                                <button type="button" onClick={() => setInvoiceFor(v)}
                                  className="shrink-0 font-semibold text-primary-700 dark:text-primary-300 hover:underline">
                                  {incomplete ? 'تسجيل الفاتورة' : 'تعديل'}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* ── ترحيل العمليات ─────────────────────────────────────
                Posting is deliberate, not a side effect of saving a wash: an
                operator editing a record three times must not mint three
                entries. The sweep is idempotent — anything already posted is
                skipped — so it doubles as the migration path for the backlog
                that predates the ledger. */}
            <Card className="p-6">
              <span id="unposted-scan" />
              <SectionHeader
                title="ترحيل العمليات إلى دفتر الأستاذ"
                subtitle="تحويل الغسلات والمصروفات والدفعات والعهد إلى قيود مزدوجة — آمن وقابل للتكرار"
                action={canMutate ? (
                  <div className="flex items-center gap-2">
                    <SecondaryButton icon={busy === 'scan' ? Loader2 : ShieldCheck}
                      onClick={handleScan} disabled={Boolean(busy)}>
                      {busy === 'scan' ? 'جارٍ الفحص...' : 'فحص غير المُرحّل'}
                    </SecondaryButton>
                    {scan && scan.ready.length > 0 && (
                      <PrimaryButton icon={busy === 'post' ? Loader2 : Upload}
                        onClick={handlePostAll} disabled={Boolean(busy)}>
                        {busy === 'post' ? 'جارٍ الترحيل...' : `ترحيل ${scan.ready.length}`}
                      </PrimaryButton>
                    )}
                  </div>
                ) : null}
              />
              {progress && (
                <p role="status" className="text-xs text-slate-600 dark:text-slate-300 tabular-nums mb-3">
                  {progress.done} / {progress.total} — {progress.label}
                </p>
              )}
              {!scan ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  اضغط «فحص غير المُرحّل» لعرض العمليات التي لم تدخل الدفاتر بعد،
                  مع سبب استبعاد كل عملية غير مؤهلة.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                      جاهزة للترحيل ({scan.ready.length})
                    </h4>
                    {scan.ready.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">لا شيء — كل العمليات مُرحّلة.</p>
                    ) : (
                      <ul className="space-y-1 max-h-56 overflow-y-auto">
                        {scan.ready.slice(0, 100).map((r) => (
                          <li key={`${r.sourceType}-${r.sourceId}`}
                            className="flex items-baseline justify-between gap-3 text-xs py-1 border-b border-slate-50 dark:border-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 min-w-0 truncate">{r.label}</span>
                            <span className="tabular-nums text-slate-500 dark:text-slate-400 shrink-0">{r.date}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                      مستبعدة ({scan.skipped.length})
                    </h4>
                    {scan.skipped.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">لا شيء.</p>
                    ) : (
                      <ul className="space-y-1 max-h-56 overflow-y-auto">
                        {scan.skipped.slice(0, 100).map((r, i) => (
                          <li key={`${r.kind}-${i}`}
                            className="flex items-baseline justify-between gap-3 text-xs py-1 border-b border-slate-50 dark:border-slate-800/60">
                            <span className="text-slate-600 dark:text-slate-400 min-w-0 truncate">{r.label || '—'}</span>
                            <span className="text-slate-500 dark:text-slate-400 shrink-0">{r.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </Card>

            {/* ── ربط الفواتير القديمة ─────────────────────────────────
                A migration, not a footnote: an invoice with no ledger link
                cannot be credited, so this has to run before the books are
                relied on. Dry-run by default, and it never guesses. */}
            <Card className="p-6">
              <SectionHeader
                title="ربط الفواتير القديمة بقيودها"
                subtitle="فاتورة بلا قيد لا يمكن إصدار إشعار عليها — يُربط المؤكد فقط، والغامض يُعرض للمراجعة"
                action={canMutate ? (
                  <div className="flex items-center gap-2">
                    <SecondaryButton
                      icon={busy === 'legacy-scan' ? Loader2 : Link2}
                      onClick={handleScanLegacy}
                      disabled={Boolean(busy)}
                    >
                      {busy === 'legacy-scan' ? 'جارٍ الفحص...' : 'فحص (تجريبي)'}
                    </SecondaryButton>
                    {(legacyPlan?.linkable?.length || 0) > 0 && (
                      <PrimaryButton
                        icon={busy === 'legacy-apply' ? Loader2 : Link2}
                        onClick={handleApplyLegacy}
                        disabled={Boolean(busy)}
                      >
                        {busy === 'legacy-apply' ? 'جارٍ الربط...' : `ربط ${legacyPlan.linkable.length}`}
                      </PrimaryButton>
                    )}
                  </div>
                ) : null}
              />
              {!legacyPlan ? (
                <EmptyState
                  icon={Link2}
                  title="لم يُجرَ الفحص بعد"
                  hint="الفحص لا يكتب شيئاً — يعرض ما يمكن ربطه بثقة وما يحتاج قراراً بشرياً."
                  compact
                />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={Database} tone="slate" label="فواتير مفحوصة" value={String(legacyPlan.scanned)} />
                    <StatCard icon={Link2} tone="primary" label="بلا رابط" value={String(legacyPlan.candidates)} />
                    <StatCard icon={CheckCircle2} tone="emerald" label="ربط مؤكد" value={String(legacyPlan.linkable.length)}
                      sub="رابط مُعلن + قفل + قيد مُرحّل + تطابق المبلغ" />
                    <StatCard icon={AlertTriangle} tone="amber" label="مراجعة يدوية" value={String(legacyPlan.review.length)} />
                  </div>

                  {legacyPlan.applied > 0 && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                      تم ربط {legacyPlan.applied} فاتورة في آخر تشغيل.
                    </p>
                  )}

                  {legacyPlan.review.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">
                        تحتاج قراراً بشرياً — لم يُخمَّن لها رابط
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[38rem]">
                          <thead>
                            <tr className="text-right text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">
                              <th className="py-2 px-3">المستند</th>
                              <th className="py-2 px-3">التاريخ</th>
                              <th className="py-2 px-3 text-left">الإجمالي</th>
                              <th className="py-2 px-3">السبب</th>
                              <th className="py-2 px-3">مرشّحون (للاطلاع فقط)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {legacyPlan.review.slice(0, 50).map((r) => (
                              <tr key={r.documentId} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                                <td className="py-2 px-3 tabular-nums font-semibold text-slate-900 dark:text-slate-100">{r.documentNumber || r.documentId}</td>
                                <td className="py-2 px-3 tabular-nums text-slate-600 dark:text-slate-300">{r.issueDate || '—'}</td>
                                <td className="py-2 px-3 text-left tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(r.gross)}</td>
                                <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{r.reason}</td>
                                <td className="py-2 px-3 tabular-nums text-slate-500 dark:text-slate-400">
                                  {(r.candidates || []).length
                                    ? (r.candidates || []).map((c) => `قيد ${c.entryNumber} (${c.entryDate})`).join('، ')
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {legacyPlan.review.length > 50 && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                          معروض أول 50 من {legacyPlan.review.length}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <SectionHeader title="الفترات المحاسبية"
                subtitle="لا يمكن الترحيل في فترة مقفلة — التصحيح يكون بقيد في فترة مفتوحة" />
              {periodKeys.length === 0 ? (
                <EmptyState icon={Lock} title="لا توجد فترات بعد"
                  hint="تُنشأ الفترة تلقائياً عند ترحيل أول قيد فيها." compact />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[42rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">الفترة</th>
                        <th className="py-3 px-4">الحالة</th>
                        <th className="py-3 px-4 text-center">عدد القيود</th>
                        <th className="py-3 px-4 text-left">إجمالي المدين</th>
                        <th className="py-3 px-4">الفحص قبل الإقفال</th>
                        <th className="py-3 px-4 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodKeys.map((key) => {
                        const status = statusOf(key);
                        const pre = preflights.get(key);
                        const readiness = readinessByKey.get(key);
                        const ready = readiness?.ok === true && !readinessQuery.loading && !readinessQuery.error;
                        const ended = !readinessQuery.loading && !readinessQuery.error && readiness?.checks.find(c => c.id === 'ended')?.ok === true;
                        const isClosed = status === 'closed';
                        return (
                          <tr key={key} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors align-top">
                            <td className="py-3 px-4 whitespace-nowrap tabular-nums font-bold text-slate-900 dark:text-slate-100">{key}</td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${
                                isClosed
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                  : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30'
                              }`}>
                                {isClosed ? <Lock size={11} /> : <Unlock size={11} />}
                                {isClosed ? 'مقفلة' : 'مفتوحة'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center tabular-nums text-slate-700 dark:text-slate-300">{pre.entryCount}</td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(pre.totals.debit)}</td>
                            <td className="py-3 px-4">
                              {ready ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  <CheckCircle2 size={12} /> جاهزة للإقفال
                                </span>
                              ) : (
                                <ul className="space-y-1">
                                  <li className="text-rose-500">{readiness ? `غير جاهزة: ${readiness.failedCount} بنود` : 'لم يكتمل فحص الجاهزية'}</li>
                                  {pre.problems.map((p) => (
                                    <li key={p} className="flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-300 leading-relaxed">
                                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                      <span>{p}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {pre.warnings.map((w) => (
                                <p key={w} className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">{w}</p>
                              ))}
                            </td>
                            <td className="py-3 px-4 text-left">
                              {!canMutate ? (
                                <span className="text-[11px] text-slate-400 dark:text-slate-500">للعرض فقط</span>
                              ) : isClosed ? (
                                reopenKey === key ? (
                                  <div className="min-w-[17rem] space-y-2">
                                    <input
                                      type="text"
                                      value={reopenReason}
                                      onChange={(e) => setReopenReason(e.target.value)}
                                      aria-label={`سبب إعادة فتح الفترة ${key}`}
                                      placeholder="سبب إعادة الفتح (يُسجّل في التدقيق)"
                                      className="w-full px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <SecondaryButton onClick={() => { setReopenKey(''); setReopenReason(''); }}
                                        disabled={busy === key}>إلغاء</SecondaryButton>
                                      <PrimaryButton icon={busy === key ? Loader2 : Unlock}
                                        onClick={() => handleReopen(key)}
                                        disabled={busy === key || !reopenReason.trim()}>
                                        {busy === key ? '...' : 'تأكيد إعادة الفتح'}
                                      </PrimaryButton>
                                    </div>
                                  </div>
                                ) : (
                                  <SecondaryButton icon={Unlock}
                                    onClick={() => { setReopenKey(key); setReopenReason(''); }}
                                    disabled={busy === key}>
                                    إعادة فتح
                                  </SecondaryButton>
                                )
                              ) : !ended ? <span className="text-xs text-slate-500">{readinessQuery.loading || readinessQuery.error ? 'لم يكتمل فحص الجاهزية' : 'الإقفال متاح بعد نهاية الشهر'}</span> : (
                                closeKey === key ? (
                                  <div className="min-w-[17rem] space-y-2 text-right">
                                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                      تأكيد إقفال {key}: {pre.entryCount} قيد، وإجمالي المدين {formatCurrency(pre.totals.debit)}.
                                      بعد الإقفال لا يمكن الترحيل أو التعديل في هذه الفترة.
                                    </p>
                                    {!ready && role === 'admin' && <label className="block text-xs">سبب تجاوز قائمة الإقفال
                                      <textarea aria-label="سبب تجاوز قائمة الإقفال" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="block w-full bg-slate-900 p-2 border rounded-control" />
                                    </label>}
                                    <div className="flex gap-2 justify-end">
                                      <SecondaryButton onClick={() => setCloseKey('')}
                                        disabled={busy === key}>إلغاء</SecondaryButton>
                                      <PrimaryButton icon={busy === key ? Loader2 : Lock}
                                        onClick={() => handleClose(key)} disabled={busy === key || (!ready && (role !== 'admin' || !overrideReason.trim()))}>
                                        {busy === key ? '...' : 'تأكيد الإقفال'}
                                      </PrimaryButton>
                                    </div>
                                  </div>
                                ) : (
                                  <PrimaryButton icon={Lock} onClick={() => { setOverrideReason(''); setCloseKey(key); }}
                                    disabled={busy === key || (!ready && role !== 'admin') || !pre.ok}
                                    title={ready ? undefined : 'صحّح المشاكل أعلاه أولاً'}>
                                    {ready ? 'إقفال' : 'تجاوز المدير'}
                                  </PrimaryButton>
                                )
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
          </>
        )}
      </main>

      <VoucherInvoiceModal
        voucher={invoiceFor} onClose={() => setInvoiceFor(null)}
        onSave={handleSaveVoucherInvoice} />

      {pendingSetting && <div role="dialog" aria-modal="true" aria-label="تأكيد تعديل الإعدادات" className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
        <Card className="p-5 max-w-lg space-y-4">
          <h2>تأكيد تعديل الإعدادات</h2>
          <p>لن يتغير الإعداد قبل تأكيدك. تغيير السياسة يحتاج تاريخ سريان صريح.</p>
          <pre dir="ltr" className="text-xs whitespace-pre-wrap">{JSON.stringify(pendingSetting.patch || {}, null, 2)}</pre>
          <SecondaryButton onClick={() => setPendingSetting(null)}>إلغاء</SecondaryButton>
          <PrimaryButton disabled={Boolean(busy) || (pendingSetting.kind === 'policy' && !policyFrom)} onClick={async () => {
            if (pendingSetting.kind === 'policy') await handlePolicy(pendingSetting.patch, true);
            else if (pendingSetting.kind === 'seed') await handleSeedPolicy(true);
            else await handleSetting(pendingSetting.patch, true);
            setPendingSetting(null);
          }}>تأكيد حفظ الإعدادات</PrimaryButton>
        </Card>
      </div>}
      <Toast open={toast.open} message={toast.message} tone={toast.tone}
        duration={toast.duration} onClose={closeToast} />
    </>
  );
}
