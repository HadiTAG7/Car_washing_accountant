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
import { useSweaterIntegration, useSweaterConfig } from '../hooks/useSweater';
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

const STALE_HOURS = 30;

function hoursSince(iso) {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  return Number.isFinite(h) ? Math.floor(h) : null;
}

export default function SweaterIntegrationPage() {
  const { canMutate } = usePartnerView();
  const integ = useSweaterIntegration();
  const config = useSweaterConfig();

  // جاهزية الخادم — تُقرأ من مسبارٍ لا يعرض قيمةً، فيُعرف أن الإعداد ناقص
  // قبل الضغط على الزر لا بعد فشله.
  const [readiness, setReadiness] = useState(null);
  // نوافذ داخلية بدل `prompt` — الأخيرة محجوبةٌ في المتصفح الآلي.
  const [createOpen, setCreateOpen] = useState(false);
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

  const st = integ.current;
  const lastHours = hoursSince(st?.lastSuccessAtIso);
  const stale = lastHours === null || lastHours > STALE_HOURS;
  const agentAlert = ['session_expired', 'otp_required', 'blocked'].includes(st?.lastAgentStatus);

  const activeKeys = useMemo(() => integ.keys.filter((k) => k.status === 'active'), [integ.keys]);

  return (
    <>
      <TopBar title="تكامل سويتر" subtitle="حال الوصلة مع المنصة، وسجل الاستيراد، ومفاتيح الوكيل" />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {integ.error && <ErrorState error={integ.error} />}

        {/* ── السرّ يُعرض مرة واحدة ── */}
        {freshSecret && (
          <Card className="p-4 sm:p-5 border-emerald-200 dark:border-emerald-500/40">
            <SectionHeader
              title="المفتاح الجديد — انسخه الآن"
              subtitle="لن يُعرض مرة أخرى. المخزَّن مُعمّى ولا يُسترجَع، وفقدُه يعني إنشاء غيره."
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
              المعرّف: <code className="font-mono">{freshSecret.keyId}</code> · ضعهما في إعداد وكيل
              المتصفح كما في <code>docs/SWEATER_BROWSER_AGENT.md</code>.
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
            sub={st?.lastSuccessAtIso ? st.lastSuccessAtIso.slice(0, 16).replace('T', ' ') : 'لم يصل شيء بعد'}
          />
          <StatCard
            icon={CheckCircle2}
            tone="indigo"
            label="آخر دفعة"
            value={st?.lastCounts ? formatNumber((st.lastCounts.new || 0) + (st.lastCounts.modified || 0)) : '—'}
            sub={st?.lastCounts
              ? `جديد ${formatNumber(st.lastCounts.new || 0)} · معدّل ${formatNumber(st.lastCounts.modified || 0)} · مرفوض ${formatNumber(st.lastCounts.rejected || 0)}`
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
              : `لم يصل استيرادٌ ناجح منذ ${lastHours === null ? '—' : formatNumber(lastHours)} ساعة. `
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
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{k.label || '—'}</td>
                      <td className="py-3 px-4 font-mono text-[12px] text-slate-600 dark:text-slate-400">{k.keyId}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">…{k.fingerprint?.slice(-8)}</td>
                      <td className="py-3 px-4 text-[12px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {k.lastUsedAtIso ? k.lastUsedAtIso.slice(0, 16).replace('T', ' ') : 'لم يُستعمل'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[11px] font-bold ${k.status === 'active' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>
                          {k.status === 'active' ? 'فعّال' : 'مُلغى'}
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
          <SectionHeader title="سجل الاستيراد" subtitle="آخر ٣٠ دفعة — بعددها ونتيجتها وتغطيتها" />
          {integ.loading && integ.runs.length === 0 ? (
            <div className="mt-4"><LoadingState message="جارٍ التحميل..." /></div>
          ) : integ.runs.length === 0 ? (
            <div className="mt-4">
              <EmptyState compact icon={Inbox} title="لا دفعات بعد"
                hint="أول دفعة من الوكيل ستظهر هنا فور وصولها." />
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
                  </tr>
                </thead>
                <tbody>
                  {integ.runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400">{r.importRunId}</td>
                      <td className="py-3 px-4 text-[12px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {r.startedAtIso ? r.startedAtIso.slice(0, 16).replace('T', ' ') : '—'}
                      </td>
                      <td className="py-3 px-4 text-[12px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {r.coverage?.rangeFrom ? `${r.coverage.rangeFrom} → ${r.coverage.rangeTo}` : '—'}
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums text-[12px]">
                        <span className="text-emerald-700 dark:text-emerald-400">{formatNumber(r.result?.counts?.new ?? 0)}</span>
                        {' / '}
                        <span className="text-sky-700 dark:text-sky-400">{formatNumber(r.result?.counts?.modified ?? 0)}</span>
                        {' / '}
                        <span className="text-rose-700 dark:text-rose-400">{formatNumber(r.result?.counts?.rejected ?? 0)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[11px] font-bold ${r.status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          {r.status === 'completed' ? 'مكتملة'
                            : r.status === 'completed_with_gaps' ? 'مكتملة بفجوات' : r.status}
                        </span>
                        {r.coverageIssues?.length > 0 && (
                          <span className="block text-[11px] text-amber-700 dark:text-amber-400">{r.coverageIssues[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">أسعار الخدمات</p>
              {config.prices.length === 0
                ? <p className="text-[12px] text-slate-500">لم تُزرع بعد.</p>
                : config.prices.map((p) => (
                  <div key={p.id} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                    <span className="text-[12px] text-slate-700 dark:text-slate-300">{p.nameArabic || p.serviceType}</span>
                    <span className="text-[12px] tabular-nums text-slate-600 dark:text-slate-400">
                      {p.netRate} + ضريبة = {p.grossRate} · من {p.effectiveFrom}
                    </span>
                  </div>
                ))}
            </div>
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
