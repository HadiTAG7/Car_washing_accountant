import { FreshnessBarView } from './SweaterFreshnessBar';
import { useFreshnessClock } from '../hooks/useSweaterFreshness';
import { operationFreshness, importStamp, importRunErrors } from '../lib/sweaterFreshness';
import { OPERATIONS_SETTINGS } from '../config/operationsSettings';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plug, KeyRound, ShieldAlert, CheckCircle2, Clock, AlertTriangle, Copy, Ban, Inbox,
} from 'lucide-react';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import SweaterActionDialog from './SweaterActionDialog';
import SweaterHandoffPreview from './SweaterHandoffPreview';
import SweaterOwnerWashTaxCorrection from './SweaterOwnerWashTaxCorrection';
import { useSweaterIntegration, useSweaterConfig, useSweaterServiceTypes } from '../hooks/useSweater';
import SweaterServicePrices from './SweaterServicePrices';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { describeBackendError } from '../lib/firebaseClient';
import { formatNumber } from '../data/initialData';
import { AGENT_STATUS_AR, labelOf } from '../lib/sweater/labels';

// ═══════════════════════════════════════════════════════════════════════════
// تكامل سويتر — حال الوصلة، وسجلّها، ومفاتيحها
// ═══════════════════════════════════════════════════════════════════════════
// «المزامنة القادمة» لا تُعرض هنا، ولن تُعرض: الوكيل مجدولٌ خارج هذا النظام
// (على جهازك أو خادمك)، وادعاءُ معرفتنا بموعده كذبٌ مريح. المعروض بدلها
// **حارس تقادم**: متى وصل آخر استيراد ناجح، وهل تأخّر. وهو محسوبٌ لحظة
// القراءة فلا يحتاج مجدولاً أصلاً.
//
// ولا سرّ في هذه الشاشة: المفتاح يُعرض **مرة واحدة عند إنشائه** ثم لا يُسترجَع
// أبداً — لا من الخادم ولا من المخزن، لأن المخزَّن مُعمّى ولأن استرجاعه
// يجعل الوصول إلى الشاشة كافياً لانتحال الوكيل.
// ═══════════════════════════════════════════════════════════════════════════

export default function SweaterIntegrationPage() {
  const { canMutate, role, isPartnerView } = usePartnerView();
  const integ = useSweaterIntegration();
  const config = useSweaterConfig();
  const staff = !isPartnerView && (role === 'admin' || role === 'accountant');
  const { serviceTypes } = useSweaterServiceTypes(staff);

  // جاهزية الخادم — تُقرأ من مسبارٍ لا يعرض قيمةً، فيُعرف أن الإعداد ناقص
  // قبل الضغط على الزر لا بعد فشله.
  const [readiness, setReadiness] = useState(null);
  // نوافذ داخلية بدل `prompt` — الأخيرة محجوبةٌ في المتصفح الآلي.
  const [createOpen, setCreateOpen] = useState(false);
  const [n8nOpen, setN8nOpen] = useState(false);
  const [revokeKeyRow, setRevokeKey] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [freshSecret, setFreshSecret] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // لا `guarded` هنا بعد اليوم: كل فعلٍ صار وراء نافذة تعرض رفض الخادم
  // **داخلها** وتبقى بقيمها. لافتةٌ عامة فوق الصفحة كانت تترك المستخدم يبحث
  // عن سبب فشلٍ وقع في نافذةٍ أُغلقت.

  useEffect(() => {
    let alive = true;
    fetch('/api/integrations/sweater/health', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.result) setReadiness(j.result); })
      // مسبارٌ لا يُجيب لا يعطّل الصفحة: الجاهزية معلومةٌ مساعدة لا شرط عرض.
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const now = useFreshnessClock();
  const st = integ.current;
  const freshness = operationFreshness(st, now);
  const lastSuccessIso = freshness.savedAt;
  const lastHours = freshness.savedAgeHours == null ? null : Math.floor(freshness.savedAgeHours);
  const stale = freshness.tone !== 'green';
  const staleSource = freshness.sourceTimeUncertain
    || (freshness.savedAgeHours <= OPERATIONS_SETTINGS.freshnessWarningHours && freshness.ageHours > OPERATIONS_SETTINGS.freshnessWarningHours)
    || (freshness.savedAgeHours <= OPERATIONS_SETTINGS.freshnessCriticalHours && freshness.ageHours > OPERATIONS_SETTINGS.freshnessCriticalHours);
  const latestCounts = lastSuccessIso && lastSuccessIso === st?.lastOperationalSuccessAtIso ? st.lastOperationalCounts : st?.lastCounts;
  const agentAlert = ['session_expired', 'otp_required', 'blocked'].includes(st?.lastAgentStatus);

  const activeKeys = useMemo(() => integ.keys.filter((k) => k.status === 'active'
    && (!k.expiresAtIso || Date.parse(k.expiresAtIso) > now)), [integ.keys, now]);

  return (
    <>
      <TopBar title="تكامل سويتر" subtitle="حال الوصلة مع المنصة، وسجل الاستيراد، ومفاتيح الوكيل" />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {integ.error && <ErrorState error={integ.error} />}
        <FreshnessBarView value={freshness} loading={integ.loading} error={integ.error} />
        {!isPartnerView && ['admin', 'accountant'].includes(role) && <><SweaterOwnerWashTaxCorrection /><SweaterHandoffPreview /></>}

        {/* ── السرّ يُعرض مرة واحدة ── */}
        {freshSecret && (
          <Card className="p-4 sm:p-5 border-emerald-200 dark:border-emerald-500/40">
            <SectionHeader
              title="المفتاح الجديد — انسخه الآن"
              subtitle="لن يُعرض مرة أخرى. احفظه في بيانات اعتماد الخدمة؛ فقدُه يعني إنشاء غيره."
            />
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <code className="flex-1 min-w-0 break-all font-mono text-[12px] bg-slate-900 text-emerald-300 px-3 py-2.5 rounded-control">
                {freshSecret.secret}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(freshSecret.secret);
                  showToast('نُسخ المفتاح');
                }}
                className="sw-button sw-button--sm sw-button--secondary"
              >
                <Copy size={15} /> انسخ
              </button>
              <button type="button" onClick={() => setFreshSecret(null)} className="sw-button sw-button--sm sw-button--secondary">
                أخفِه
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              المعرّف: <code className="font-mono">{freshSecret.keyId}</code> · {freshSecret.authMode === 'bearer-sha256'
                ? 'في n8n اختر Header Auth؛ الاسم Authorization والقيمة Bearer ثم مسافة ثم المفتاح. لا تضعه في نص العقد أو رابط الطلب.'
                : <>ضعه مع السرّ في إعداد وكيل المتصفح كما في <code>docs/SWEATER_BROWSER_AGENT.md</code>.</>}
              {freshSecret.expiresAtIso && <> · ينتهي: <bdi>{freshSecret.expiresAtIso.slice(0, 10)}</bdi></>}
            </p>
          </Card>
        )}

        {/* ── جاهزية الخادم ── */}
        {readiness && !readiness.ready && (
          <div role="alert" className="flex items-start gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-3 py-2.5 text-[12px] text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">
              <strong>إعداد الخادم ناقص.</strong>{' '}
              {readiness.checks?.filter((c) => !c.present).map((c) => (
                <span key={c.name} className="block mt-1">
                  <code className="font-mono">{c.name}</code> — {c.why}
                </span>
              ))}
              <span className="block mt-1">{readiness.hint}</span>
            </span>
          </div>
        )}

        {/* ── الحال ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          <StatCard
            icon={Plug}
            tone={stale || agentAlert ? 'amber' : 'emerald'}
            label="حال الوصلة"
            value={agentAlert ? labelOf(AGENT_STATUS_AR, st.lastAgentStatus) : stale ? 'متأخرة' : 'تعمل'}
            sub={st?.source === 'browser_agent' ? 'وكيل المتصفح' : (st?.source || 'لم يتصل بعد')}
          />
          <StatCard
            icon={Clock}
            tone={stale ? 'amber' : 'primary'}
            label="آخر استيراد ناجح"
            value={lastHours === null ? '—' : `قبل ${formatNumber(lastHours)} ساعة`}
            sub={lastSuccessIso ? `${importStamp(lastSuccessIso)} (الرياض)` : 'لم يصل شيء بعد'}
          />
          <StatCard
            icon={CheckCircle2}
            tone="indigo"
            label="آخر دفعة"
            value={latestCounts ? formatNumber((latestCounts.new || 0) + (latestCounts.modified || 0)) : '—'}
            sub={latestCounts
              ? `جديد ${formatNumber(latestCounts.new || 0)} · معدّل ${formatNumber(latestCounts.modified || 0)} · مرفوض ${formatNumber(latestCounts.rejected || 0)}`
              : 'لا دفعات'}
          />
          <StatCard
            icon={KeyRound}
            tone={activeKeys.length ? 'emerald' : 'amber'}
            label="مفاتيح فعّالة"
            value={formatNumber(activeKeys.length)}
            sub={readiness && !readiness.ready
              ? 'إعداد الخادم ناقص — انظر التنبيه أعلاه'
              : activeKeys.length ? 'الوكيل يوقّع بها' : 'أنشئ مفتاحاً ليعمل الوكيل'}
          />
        </div>

        {(stale || agentAlert) && (
          <p className="text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-3 py-2.5 leading-relaxed">
            {agentAlert
              ? `الوكيل توقّف بأمان: ${labelOf(AGENT_STATUS_AR, st.lastAgentStatus)}. `
                + 'المنصة تطلب تدخّلاً بشرياً — سجّل الدخول عندها ثم أعِد تشغيل الوكيل. '
                + 'الوكيل لا يتجاوز مصادقةً ولا يخزّن رمز تحقق.'
              : freshness.sourceTimeUncertain ? 'وقت قراءة المصدر غير مؤكد؛ نجاح الحفظ لا يثبت حداثة البيانات. راجع توقيت القراءة ونطاقها.'
                : staleSource ? `وصل استيراد قبل ${formatNumber(lastHours)} ساعة، لكن قراءة المصدر قديمة؛ عمر البيانات ${formatNumber(Math.floor(freshness.ageHours))} ساعة. راجع توقيت القراءة ونطاقها.`
                  : (lastHours === null ? 'لم يصل أي استيراد ناجح حتى الآن. ' : `لم يصل استيرادٌ ناجح منذ ${formatNumber(lastHours)} ساعة. `)
                    + 'تحقّق من جدولة الوكيل ومن صلاحية مفتاحه.'}
          </p>
        )}

        {/* ── ملاحظة صادقة عن الجدولة ── */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong className="text-slate-800 dark:text-slate-200">لا «مزامنة قادمة» هنا، عمداً.</strong>{' '}
              الوكيل مجدولٌ خارج هذا النظام، فادّعاء معرفتنا بموعده لا يصحّ. المعروض بدلها متى وصل
              آخر استيرادٍ ناجح — وهو ما يكشف التوقّف فعلاً. وهذا الباب يستقبل ولا يطلب: لا يفتح
              جلسةً على سويتر ولا يحفظ كلمة مرور ولا رمز تحقق.
            </p>
          </div>
        </Card>

        {/* ── المفاتيح ── */}
        <Card className="p-4 sm:p-6">
          <SectionHeader title="الربط مع n8n" subtitle="استيراد الغسلات باتصال مستقل يمكن إلغاؤه؛ دون صلاحية قبض أو رواتب أو ترحيل مالي." />
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            الربط يستقبل بيانات الغسلات التي يجمعها مسار n8n. دخول بوابة سويتر وجلب الحجوزات خطوة مستقلة؛ إنشاء المفتاح لا يبدأ المزامنة.
          </p>
          <p className="mt-2 text-xs break-all" dir="ltr">POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/integrations/sweater/n8n</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canMutate && role === 'admin' && !isPartnerView && <button type="button" disabled={busy !== null}
              onClick={() => { setDialogError(null); setN8nOpen(true); }} className="sw-button sw-button--sm sw-button--primary">
              <KeyRound size={16} /> إنشاء اتصال n8n
            </button>}
            <a className="sw-button sw-button--sm sw-button--secondary" href="/integrations/sweater-n8n.json" download>تنزيل مسار الاستيراد لـ n8n</a>
          </div>
          <p className="mt-2 text-xs text-slate-500">المفتاح صالح 90 يومًا، ويظهر مرة واحدة. احفظه في Header Auth داخل n8n. المسار يفحص الدفعة قبل الحفظ ويتحقق من النتيجة بعده.</p>
        </Card>

        <Card className="p-4 sm:p-6">
          <SectionHeader
            title="مفاتيح الوكيل"
            subtitle="السرّ يُعرض مرة واحدة عند الإنشاء. المخزَّن مُعمّى ولا يُسترجَع — والتدوير إنشاءٌ ثم إلغاء."
            action={canMutate ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => { setDialogError(null); setCreateOpen(true); }}
                className="sw-button sw-button--sm sw-button--primary"
              >
                <KeyRound size={16} /> أنشئ مفتاحاً
              </button>
            ) : null}
          />
          {integ.keysError ? (
            <p className="mt-4 text-[12px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-control px-3 py-2.5 leading-relaxed">
              قائمة المفاتيح متاحة للمحاسب فأعلى — وبقية هذه الصفحة مقروءة لك.
            </p>
          ) : integ.keys.length === 0 ? (
            <div className="mt-4">
              <EmptyState compact icon={KeyRound} title="لا مفاتيح بعد"
                hint="أنشئ مفتاحاً وضعه في إعداد وكيل المتصفح ليبدأ الاستيراد." />
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mt-4">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4">الاسم</th>
                    <th className="py-3 px-4">المعرّف</th>
                    <th className="py-3 px-4">البصمة</th>
                    <th className="py-3 px-4">آخر استعمال</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left w-24">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {integ.keys.map((k) => (
                    <tr key={k.keyId} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{k.label || '—'}
                        {k.authMode === 'bearer-sha256' && <p className="text-xs text-slate-500">n8n · ينتهي {k.expiresAtIso?.slice(0, 10) || '—'}</p>}
                      </td>
                      <td className="py-3 px-4 font-mono text-[12px] text-slate-600 dark:text-slate-400">{k.keyId}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">…{k.fingerprint?.slice(-8)}</td>
                      <td className="py-3 px-4 text-[12px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {k.lastUsedAtIso ? k.lastUsedAtIso.slice(0, 16).replace('T', ' ') : 'لم يُستعمل'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[11px] font-bold ${k.status === 'active' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>
                          {k.status !== 'active' ? 'مُلغى' : k.expiresAtIso && Date.parse(k.expiresAtIso) <= now ? 'منتهي' : 'فعّال'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left">
                        {canMutate && k.status === 'active' && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => { setDialogError(null); setRevokeKey(k); }}
                            className="text-[12px] px-2.5 py-1.5 rounded-control border border-slate-200 dark:border-slate-700 hover:border-rose-500 text-slate-600 dark:text-slate-400 transition-colors inline-flex items-center gap-1"
                          >
                            <Ban size={13} /> ألغِ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── سجل التشغيل ── */}
        <Card className="p-4 sm:p-6">
          <SectionHeader title="سجل الاستيراد" subtitle={`آخر ${OPERATIONS_SETTINGS.importHistoryDays} أيام — التشغيلات المحفوظة فقط؛ المحاولات التي لم تصل للخادم لا تظهر هنا.`} />
          <p className="text-sm mt-2">{integ.runs.length} تشغيل محفوظ في الفترة · الأوقات بتوقيت الرياض</p>
          {integ.loading && integ.runs.length === 0 ? (
            <div className="mt-4"><LoadingState message="جارٍ التحميل..." /></div>
          ) : integ.runs.length === 0 ? (
            <div className="mt-4">
              <EmptyState compact icon={Inbox} title="لا تشغيلات محفوظة خلال آخر 7 أيام"
                hint="لا يثبت غياب السجل أن الوكيل حاول الاتصال. وقت آخر نجاح ظاهر أعلى الصفحة." />
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mt-4">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4">الدفعة</th>
                    <th className="py-3 px-4">الوقت</th>
                    <th className="py-3 px-4">النطاق</th>
                    <th className="py-3 px-4 text-center">جديد / معدّل / مرفوض</th>
                    <th className="py-3 px-4">النتيجة</th>
                    <th className="py-3 px-4">الأخطاء</th>
                  </tr>
                </thead>
                <tbody>
                  {integ.runs.map(r => <IntegrationRunRow key={r.id} run={r} />)}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── الإعدادات المؤرخة ── */}
        <Card className="p-4 sm:p-6">
          <SectionHeader
            title="الإعدادات السارية"
            subtitle="الأسعار وأنواع الخصومات — مؤرخة، فتعديلها اليوم لا يمسّ شهراً مضى"
          />
          <p className="text-sm mt-3">حدود حداثة البيانات: أصفر بعد {OPERATIONS_SETTINGS.freshnessWarningHours} ساعات، وأحمر بعد {OPERATIONS_SETTINGS.freshnessCriticalHours} ساعة. موحّدة في إعدادات عرض التشغيل.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <SweaterServicePrices prices={config.prices} serviceTypes={serviceTypes}
              canEdit={canMutate && role === 'admin' && !isPartnerView} onSave={config.savePrice} />
            <div>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                أنواع الخصومات ({formatNumber(config.adjustmentTypes.length)})
              </p>
              {config.adjustmentTypes.slice(0, 12).map((t) => (
                <div key={t.id} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                  <span className="text-[12px] text-slate-700 dark:text-slate-300">{t.nameArabic}</span>
                  <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    {t.amountMode === 'fixed' ? `${t.amount} ر.س` : t.amountMode === 'per_unit' ? `${t.amount} للوحدة` : 'من المنصة'}
                    {' · '}{t.accountCode}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </main>

      {/* ── إنشاء مفتاح ── */}
      <SweaterActionDialog
        open={createOpen}
        title="إنشاء مفتاح تكامل"
        subtitle="السرّ يُعرض مرة واحدة بعد الإنشاء ولا يُسترجَع بعدها."
        icon={KeyRound}
        busy={busy === 'key'}
        error={dialogError}
        confirmLabel="أنشئ المفتاح"
        busyLabel="جارٍ الإنشاء…"
        fields={[{
          name: 'label',
          label: 'اسم المفتاح',
          type: 'text',
          required: true,
          defaultValue: 'الوكيل الرابع — Codex',
          hint: 'للتمييز في القائمة وسجل الاستعمال — لا يدخل التوقيع.',
        }]}
        onClose={() => { setCreateOpen(false); setDialogError(null); }}
        onConfirm={async ({ label }) => {
          setDialogError(null);
          setBusy('key');
          try {
            const r = await integ.createKey(label);
            setCreateOpen(false);
            // السرّ يُعرض هنا مرةً واحدة — وبعدها لا سبيل إليه.
            if (r?.secret) setFreshSecret(r);
            showToast('أُنشئ المفتاح');
          } catch (e) {
            console.error('🔥 SweaterIntegration.createKey:', e);
            setDialogError(describeBackendError(e) || e?.message || 'تعذّر إنشاء المفتاح');
          } finally { setBusy(null); }
        }}
      />

      {/* ── إلغاء مفتاح ── */}
      <SweaterActionDialog open={n8nOpen} title="إنشاء اتصال n8n" icon={KeyRound}
        subtitle="يسمح بمعاينة وحفظ غسلات من المصدر والتحقق منها فقط. لا يمنح إدارة الحساب أو تأكيد التحصيل. يظهر المفتاح مرة واحدة وينتهي بعد 90 يومًا."
        busy={busy === 'n8n'} error={dialogError} confirmLabel="إنشاء مفتاح n8n" busyLabel="جارٍ الإنشاء…"
        fields={[{ name: 'label', label: 'اسم اتصال n8n', type: 'text', required: true, defaultValue: 'n8n — تسجيل الغسلات' }]}
        onClose={() => { setN8nOpen(false); setDialogError(null); }}
        onConfirm={async ({ label }) => {
          setDialogError(null); setBusy('n8n');
          try {
            const r = await integ.createN8nKey(label);
            if (r?.secret) setFreshSecret(r);
            setN8nOpen(false); showToast('أُنشئ اتصال n8n');
          } catch (e) {
            setDialogError(describeBackendError(e) || 'تعذّر إنشاء اتصال n8n');
          } finally { setBusy(null); }
        }} />

      <SweaterActionDialog
        open={Boolean(revokeKeyRow)}
        title="إلغاء مفتاح التكامل"
        subtitle="الإلغاء نهائي — الوكيل الذي يوقّع به يتوقف فوراً."
        icon={Ban}
        tone="danger"
        busy={busy === 'revoke'}
        error={dialogError}
        confirmLabel="ألغِ المفتاح"
        busyLabel="جارٍ الإلغاء…"
        context={revokeKeyRow ? (
          // المعرّف والبصمة يكفيان للتمييز — والسرّ لا يُعرض هنا ولا في أي
          // مكانٍ بعد لحظة إنشائه.
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-control px-3 py-2.5 text-[12px] text-slate-600 dark:text-slate-400 space-y-1">
            <p>الاسم: <strong className="text-slate-800 dark:text-slate-200">{revokeKeyRow.label || '—'}</strong></p>
            <p>المعرّف: <code className="font-mono">{revokeKeyRow.keyId}</code></p>
            <p>البصمة: <code className="font-mono">…{String(revokeKeyRow.fingerprint || '').slice(-8)}</code></p>
          </div>
        ) : null}
        fields={[{
          name: 'reason',
          label: 'سبب الإلغاء',
          type: 'textarea',
          required: true,
          placeholder: 'تدوير دوري، أو اشتباه تسريب، أو إيقاف الوكيل…',
          hint: 'يبقى في سجل التدقيق.',
        }]}
        onClose={() => { setRevokeKey(null); setDialogError(null); }}
        onConfirm={async ({ reason }) => {
          setDialogError(null);
          setBusy('revoke');
          try {
            await integ.revokeKey(revokeKeyRow.keyId, reason);
            setRevokeKey(null);
            showToast('أُلغي المفتاح');
          } catch (e) {
            console.error('🔥 SweaterIntegration.revokeKey:', e);
            setDialogError(describeBackendError(e) || e?.message || 'تعذّر إلغاء المفتاح');
          } finally { setBusy(null); }
        }}
      />

      <Toast open={toast.open} message={toast.message} tone={toast.tone} duration={toast.duration} onClose={closeToast} />
    </>
  );
}

function IntegrationRunRow({ run: r }) {
  const counts = r.result?.counts, errors = importRunErrors(r);
  const count = key => counts?.[key] == null ? 'غير مسجل' : formatNumber(counts[key]);
  return <tr className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 max-w-64 break-all text-xs">{r.importRunId || r.id}</td>
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 text-xs tabular-nums"><bdi>{importStamp(r.startedAtIso)}</bdi></td>
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 text-xs"><bdi>{r.coverage?.rangeFrom || '—'} → {r.coverage?.rangeTo || '—'}</bdi></td>
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 text-center text-xs tabular-nums">{count('new')} / {count('modified')} / {count('rejected')}</td>
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 text-xs">{r.status === 'completed' ? 'مكتملة' : r.status === 'completed_with_gaps' ? 'مكتملة بفجوات' : r.status === 'failed' ? 'فشلت' : r.status === 'processing' ? 'قيد التنفيذ' : 'حالة غير معروفة'}
      {counts?.needsReview > 0 && <p>تحتاج مراجعة: {count('needsReview')}</p>}
      {(r.coverageIssues || r.result?.coverageIssues)?.length > 0 && <details><summary>فجوات التغطية</summary><ul>{(r.coverageIssues || r.result.coverageIssues).map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
    </td>
    <td className="text-slate-700 dark:text-slate-300 py-3 px-4 text-xs max-w-80 break-words">{errors.length ? <details><summary>{errors.length} أسباب مسجلة</summary><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></details> : r.status === 'failed' ? 'فشل التشغيل؛ تفاصيل الخطأ غير مسجلة' : counts ? 'لا أخطاء مسجلة' : 'غير مسجلة'}</td>
  </tr>;
}
