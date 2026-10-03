import { getLocale } from '../i18n/locale';
// ═══════════════════════════════════════════════════════════════════════════
// المساعد الذكي — رابط MCP خاص بالشريك، يُنشئه ويلصقه في Claude أو ChatGPT
// ═══════════════════════════════════════════════════════════════════════════
// الشريك يريد أن يسأل مساعده «كم ربحتُ هذا الشهر؟» بلا أن يفتح التطبيق ويقرأ
// جداول. هذه الصفحة تعطيه رابطاً واحداً يلصقه في «موصِّل مخصّص» فيصير مساعده
// يقرأ حصّته — حصّته وحدها.
//
// ── الرمز يُعرض مرة واحدة ──
// الخادم يخزّن بصمة الرمز لا الرمز، فلا يستطيع أحدٌ — ولا نحن — استرجاعه بعد
// هذه اللحظة. فقدُه ليس كارثة: «تبديل الرابط» يُنشئ غيره ويُميت القديم في
// نفس المعاملة.
//
// ── المدير المحاكي يرى ولا يفعل ──
// الرابط هوية: يُنشئه صاحبه من حسابه. المدير في المحاكاة يرى الحالة، وإن أراد
// الإلغاء فمن «إدارة الشركاء»، حيث يقف باسمه لا باسم الشريك.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import {
  Bot, Copy, KeyRound, RefreshCw, Ban, ShieldCheck, EyeOff, CheckCircle2, Clock, Link2,
} from 'lucide-react';

import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, PrimaryButton, SecondaryButton } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import Toast from './Toast';
import QrCode from './QrCode';
import SweaterActionDialog from './SweaterActionDialog';

import { usePartnerView } from '../contexts/PartnerViewContext';
import { usePartnerMcpKeys, activeKeyFor } from '../hooks/usePartnerMcpKeys';
import { describeBackendError, ledgerApiUrl, isFirebaseConfigured } from '../lib/firebaseClient';
import { partnerMcpUrl } from '../lib/partnerMcpUrl';

const when = (iso) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn',
  }).format(new Date(t)) : '—';
};

const CAN_SEE = [
  'عدد عمالك فقط',
  'رأس مالك: المطلوب والمسدَّد والمتبقّي، وسندات قبضك',
  'قائمة الدخل بحصّتك لأي شهر مُرحَّل، وتفاصيل المصاريف حسب الحساب',
  'عدد الغسلات التي تعادل حصّتك فقط',
  'اتجاه حصتك التحليلية من نتيجة الشركة خلال الأشهر الماضية',
];
const CANNOT_SEE = [
  'أسماء العاملين أو رواتبهم أو بياناتهم',
  'بيانات أي شريك ثاني أو سنداته',
  'الدفاتر الخام أو أرقام الشركة غير المقسومة',
  'أي تعديل؛ الرابط للقراءة بس، وما فيه أداة تقدر تغيّر البيانات',
];

const REVOKE_FIELDS = [
  { name: 'reason', label: 'السبب', type: 'textarea', placeholder: 'اختياري — مثلاً: بدّلت جهازي', hint: 'يتسجّل مع الإلغاء عشان المراجعة.' },
];

export default function PartnerAssistantPage({ partner, meta }) {
  const { myPartner, isAdmin } = usePartnerView();
  // الرابط هوية: يُنشئه صاحبه من حسابه. المدير المحاكي ليس صاحبه.
  const isSelf = Boolean(myPartner && partner && String(myPartner.id) === String(partner.id));
  const { keys, loading, error, createKey, revokeKey } = usePartnerMcpKeys({
    scope: isAdmin ? 'all' : 'mine',
  });
  const active = useMemo(() => activeKeyFor(keys, partner?.id), [keys, partner?.id]);

  const [fresh, setFresh] = useState(null);           // { token, keyId, createdAtIso } — مرة واحدة
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);         // 'rotate' | 'revoke' | null
  const [dialogError, setDialogError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success' });
  const showToast = useCallback((message, tone = 'success') => setToast({ open: true, message, tone }), []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  const url = fresh ? partnerMcpUrl(fresh.token, {
    env: import.meta.env, ledgerApiUrl, location: typeof window !== 'undefined' ? window.location : null,
  }) : null;

  async function mint() {
    setBusy(true); setDialogError(null);
    try {
      const r = await createKey(null);
      setFresh(r);
      setDialog(null);
      showToast(active ? 'تبدّل الرابط؛ القديم ما عاد يشتغل' : 'رابطك جاهز؛ انسخه الحين');
    } catch (e) {
      const msg = describeBackendError(e) || e?.message || 'ما قدرنا ننشئ الرابط';
      if (dialog) setDialogError(msg); else showToast(msg, 'error');
    } finally { setBusy(false); }
  }

  async function revoke({ reason }) {
    if (!active) return;
    setBusy(true); setDialogError(null);
    try {
      await revokeKey(active.keyId, reason);
      setFresh(null);
      setDialog(null);
      showToast('توقف الرابط؛ ما عاد بيشتغل');
    } catch (e) {
      setDialogError(describeBackendError(e) || e?.message || 'ما قدرنا نوقف الرابط');
    } finally { setBusy(false); }
  }

  const copy = async () => {
    try { await navigator.clipboard?.writeText(url); showToast('تم نسخ الرابط'); }
    catch { showToast('ما قدرنا ننسخ الرابط؛ حدّده وانسخه بنفسك', 'error'); }
  };

  return (
    <>
      <TopBar title={meta.title} subtitle={meta.subtitle} />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {error && <ErrorState title="ما قدرنا نحمّل حالة الرابط" error={error} />}

        {/* ── ما هذا؟ ─────────────────────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <span className="w-12 h-12 rounded-control bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0">
              <Bot size={24} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">اسأل مساعدك عن حصّتك</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                هذا رابط خاص فيك، تلصقه في Claude أو ChatGPT كـ«موصِّل مخصّص» (MCP). بعدها يقدر مساعدك يقرأ أرقامك، مثل رأس مالك وقائمة دخلك، ويجاوبك بلغتك: «كم ربحت هالشهر؟»، «كم باقي عليّ من رأس المال؟»، «كم غسلة تعادل حصّتي في أغسطس؟».
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-control border border-emerald-100 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-4">
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-1.5"><ShieldCheck size={14} /> ويش يشوف مساعدك</p>
              <ul className="space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed">
                {CAN_SEE.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />{t}</li>)}
              </ul>
            </div>
            <div className="rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5"><EyeOff size={14} /> ويش ما يقدر يشوف</p>
              <ul className="space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed">
                {CANNOT_SEE.map((t) => <li key={t} className="flex gap-2"><Ban size={14} className="mt-0.5 shrink-0 text-slate-400" />{t}</li>)}
              </ul>
            </div>
          </div>
        </Card>

        {/* ── الرمز يُعرض مرة واحدة ──────────────────────────────── */}
        {fresh && url && (
          <Card className="p-5 sm:p-6 border-emerald-200 dark:border-emerald-500/40">
            <SectionHeader
              title="رابطك الجديد — انسخه الحين"
              subtitle="الرابط ما ينعرض مرة ثانية؛ الخادم يحفظ بصمته، مو الرمز نفسه. إذا ضاع منك، بدّله من هنا."
            />
            <div className="mt-3 flex flex-col md:flex-row md:items-start gap-4">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <code dir="ltr" className="flex-1 min-w-0 break-all font-mono text-[12px] bg-slate-900 text-emerald-300 px-3 py-2.5 rounded-control select-all">
                    {url}
                  </code>
                  <button type="button" onClick={copy} className="sw-button sw-button--sm sw-button--secondary">
                    <Copy size={15} /> انسخ
                  </button>
                  <button type="button" onClick={() => setFresh(null)} className="sw-button sw-button--sm sw-button--secondary">
                    إخفاء الرابط
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  الرابط هو المفتاح: أي أحد عنده الرابط يقدر يقرأ حصّتك. لا ترسله في مكان عام، وإذا شكّيت إنه وصل لأحد، بدّله. المعرّف: <code className="font-mono">{fresh.keyId}</code>
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-center gap-1">
                <QrCode value={url} size={152} title="رابط المساعد الذكي" />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">امسحه من الجوال</span>
              </div>
            </div>
          </Card>
        )}

        {/* ── الحالة والإجراءات ─────────────────────────────────── */}
        <Card className="p-5 sm:p-6">
          <SectionHeader
            title="حالة الرابط"
            subtitle={isSelf
              ? 'تقدر تستخدم رابط فعّال واحد في كل وقت؛ إذا بدّلته، القديم يتوقف فوراً'
              : 'الشريك ينشئ الرابط من حسابه؛ المدير يشوف الحالة ويقدر يوقفه من «إدارة الشركاء»'}
            action={isSelf ? (
              <div className="flex items-center gap-2 flex-wrap">
                {!active && (
                  <PrimaryButton icon={KeyRound} onClick={mint} disabled={busy || !isFirebaseConfigured}>
                    {busy ? 'ننشئ الرابط…' : 'إنشاء رابط'}
                  </PrimaryButton>
                )}
                {active && (
                  <>
                    <SecondaryButton icon={RefreshCw} onClick={() => { setDialogError(null); setDialog('rotate'); }} disabled={busy}>
                      تبديل الرابط
                    </SecondaryButton>
                    <button
                      type="button"
                      onClick={() => { setDialogError(null); setDialog('revoke'); }}
                      disabled={busy}
                      className="sw-button sw-button--sm sw-button--secondary text-rose-700 dark:text-rose-300"
                    >
                      <Ban size={15} /> إيقاف الرابط
                    </button>
                  </>
                )}
              </div>
            ) : null}
          />
          {loading && keys.length === 0 ? (
            <LoadingState message="نتأكد من حالة الرابط..." />
          ) : !active ? (
            <EmptyState
              compact
              icon={Link2}
              title="ما فيه رابط فعّال"
              hint={isSelf ? 'اضغط «إنشاء رابط»، وبعدها الصقه في مساعدك.' : 'الشريك للحين ما أنشأ رابط.'}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <StatCard icon={ShieldCheck} tone="emerald" label="الحالة" value="فعّال" sub={`المعرّف ${active.keyId}`} />
              <StatCard icon={KeyRound} label="أُنشئ في" value={when(active.createdAtIso)} sub={active.rotatedFrom ? 'بدلاً من رابطٍ سابق' : 'أول رابط'} />
              <StatCard
                icon={Clock}
                tone={active.lastUsedAtIso ? 'primary' : 'slate'}
                label="آخر استعمال"
                value={active.lastUsedAtIso ? when(active.lastUsedAtIso) : 'للحين ما انستخدم'}
                sub="يتحدّث كل كم دقيقة وقت الاستخدام"
              />
            </div>
          )}
        </Card>

        {/* ── كيف أربطه؟ ───────────────────────────────────────── */}
        <Card className="p-5 sm:p-6">
          <SectionHeader title="شلون أربطه بمساعدي؟" subtitle="الخطوات تقريباً نفسها في الاثنين: أضف موصِّل مخصّص والصق الرابط" />
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <details className="rounded-control border border-slate-200 dark:border-slate-700 p-4 group">
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100 text-sm">Claude (claude.ai)</summary>
              <ol className="mt-3 space-y-2 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed list-decimal pr-5">
                <li><strong>Customize</strong> ← <strong>Connectors</strong> (الموصِّلات) — في حسابات الشركات: Organization settings ← Connectors.</li>
                <li>اضغط <strong>+</strong> ثم <strong>Add custom connector</strong> (في حسابات الشركات: Add ← Custom ← Web).</li>
                <li>الاسم مثلاً «حصّتي في سويتر»، والرابط: الصق رابطك مثل ما هو.</li>
                <li><strong>Advanced settings</strong> (بيانات OAuth) اختيارية، ما تحتاجها؛ اضغط <strong>Add</strong>.</li>
                <li>في المحادثة، فعّل الموصِّل من أيقونة الأدوات واسأل: «كم صافي ربحي هالشهر؟».</li>
              </ol>
            </details>
            <details className="rounded-control border border-slate-200 dark:border-slate-700 p-4 group">
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100 text-sm">ChatGPT (chatgpt.com)</summary>
              <ol className="mt-3 space-y-2 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed list-decimal pr-5">
                <li>الإعدادات ← <strong>Apps &amp; Connectors</strong> (قد يظهر باسم Connectors أو Plugins) ← <strong>Advanced</strong> وفعّل <strong>Developer mode</strong>.</li>
                <li>ارجع إلى Connectors واضغط <strong>Create</strong>.</li>
                <li>الاسم: «حصّتي في سويتر»، ورابط الخادم (MCP Server URL): الصق رابطك.</li>
                <li>المصادقة: <strong>No authentication</strong>، ثم احفظ.</li>
                <li>في محادثة جديدة، اختار الموصِّل من «+» ← More، واسأل بلغتك.</li>
              </ol>
            </details>
          </div>
          <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            مساعدك يشوف سبع أدوات بس، وكلها للقراءة: بياناتي، رأس مالي، قائمة الدخل، الاتجاه، التشغيل، استرداد رأس المال، والملخّص. أرقامها تخصك إنت بس، ومحسوبة بنفس حسبة صفحتك، من غير ما تظهر نسبة حصتك أو إجماليات المشروع.
          </p>
        </Card>
      </main>

      <SweaterActionDialog
        open={dialog === 'rotate'}
        title="تبديل الرابط"
        subtitle="ننشئ لك رابط جديد، والقديم يتوقف في نفس اللحظة. أي مساعد يستخدم الرابط القديم ما بيقدر يقرأ أرقامك بعد التبديل."
        icon={RefreshCw}
        fields={[]}
        confirmLabel="بدّل الحين"
        busyLabel="نبدّل الرابط…"
        busy={busy}
        error={dialogError}
        onConfirm={mint}
        onClose={() => setDialog(null)}
      />
      <SweaterActionDialog
        open={dialog === 'revoke'}
        title="إيقاف الرابط"
        subtitle="الرابط بيتوقف وما بيشتغل بعدها. تقدر تنشئ رابط جديد في أي وقت."
        icon={Ban}
        tone="danger"
        fields={REVOKE_FIELDS}
        confirmLabel="أوقف الرابط"
        busyLabel="نوقف الرابط…"
        busy={busy}
        error={dialogError}
        onConfirm={revoke}
        onClose={() => setDialog(null)}
      />

      <Toast open={toast.open} message={toast.message} tone={toast.tone} onClose={closeToast} />
    </>
  );
}
