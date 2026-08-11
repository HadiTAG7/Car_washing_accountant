import { useCallback, useMemo, useState } from 'react';
import {
  Lock, Unlock, ShieldCheck, AlertTriangle, CheckCircle2, Loader2, Database, Upload,
} from 'lucide-react';
import { formatCurrency } from '../data/initialData';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, PrimaryButton, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import { useLedger } from '../hooks/useLedger';
import { useAuth } from '../hooks/useAuth';
import { closePreflight, currentPeriodKey } from '../lib/accounting/periods';
import { closePeriod, reopenPeriod, seedChartOfAccounts } from '../lib/accounting/firestoreLedger';
import { collectUnposted, postUnposted } from '../lib/accounting/postOperations';
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
  const { canMutate } = usePartnerView();
  const [busy, setBusy] = useState('');
  // Result of the last unposted-operations scan / sweep.
  const [scan, setScan] = useState(null);
  const [progress, setProgress] = useState(null);
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
      const r = await seedChartOfAccounts({ userId: user?.id });
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
      `ترحيل ${pending} عملية إلى دفتر الأستاذ؟\n\n`
      + 'العملية آمنة وقابلة للتكرار: أي عملية مُرحّلة مسبقاً تُتجاوز تلقائياً.',
    );
    if (!ok) return;
    setBusy('post');
    setProgress({ done: 0, total: pending, label: '' });
    try {
      const r = await postUnposted({
        userId: user?.id,
        onProgress: (p) => setProgress(p),
      });
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

  async function handleClose(key) {
    const pre = preflights.get(key);
    const ok = typeof window === 'undefined' || window.confirm(
      `إقفال الفترة ${key}؟\n\n`
      + `عدد القيود: ${pre.entryCount}\n`
      + `إجمالي المدين: ${pre.totals.debit.toFixed(2)}\n\n`
      + 'بعد الإقفال لن يمكن الترحيل أو التعديل في هذه الفترة — '
      + 'وأي تصحيح يكون بقيد في فترة مفتوحة.',
    );
    if (!ok) return;
    setBusy(key);
    try {
      await closePeriod(key, { userId: user?.id });
      showToast(`تم إقفال الفترة ${key}.`);
      await refetch();
    } catch (e) {
      showToast(e?.message || 'تعذّر الإقفال', 'error');
    } finally { setBusy(''); }
  }

  async function handleReopen(key) {
    const ok = typeof window === 'undefined' || window.confirm(
      `إعادة فتح الفترة ${key}؟\n\nستُسجَّل العملية في سجل التدقيق باسمك.`,
    );
    if (!ok) return;
    setBusy(key);
    try {
      await reopenPeriod(key, { userId: user?.id, reason: 'إعادة فتح من صفحة الإقفال' });
      showToast(`تمت إعادة فتح الفترة ${key}.`);
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

            {/* ── ترحيل العمليات ─────────────────────────────────────
                Posting is deliberate, not a side effect of saving a wash: an
                operator editing a record three times must not mint three
                entries. The sweep is idempotent — anything already posted is
                skipped — so it doubles as the migration path for the backlog
                that predates the ledger. */}
            <Card className="p-6">
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
                              {pre.ok ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  <CheckCircle2 size={12} /> جاهزة للإقفال
                                </span>
                              ) : (
                                <ul className="space-y-1">
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
                            <td className="py-3 px-4 text-left whitespace-nowrap">
                              {!canMutate ? (
                                <span className="text-[11px] text-slate-400 dark:text-slate-500">للعرض فقط</span>
                              ) : isClosed ? (
                                <SecondaryButton icon={Unlock} onClick={() => handleReopen(key)}
                                  disabled={busy === key}>
                                  {busy === key ? '...' : 'إعادة فتح'}
                                </SecondaryButton>
                              ) : (
                                <PrimaryButton icon={Lock} onClick={() => handleClose(key)}
                                  disabled={busy === key || !pre.ok}
                                  title={pre.ok ? undefined : 'صحّح المشاكل أعلاه أولاً'}>
                                  {busy === key ? '...' : 'إقفال'}
                                </PrimaryButton>
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

      <Toast open={toast.open} message={toast.message} tone={toast.tone}
        duration={toast.duration} onClose={closeToast} />
    </>
  );
}
