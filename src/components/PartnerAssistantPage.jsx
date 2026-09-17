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

const WHEN = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn',
});
const when = (iso) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? WHEN.format(new Date(t)) : '—';
};

const CAN_SEE = [
  'نسبتك وعدد عمالتك من مجموع العمالة',
  'رأس مالك: المطلوب والمسدَّد والمتبقّي، وسندات قبضك',
  'قائمة الدخل بحصّتك لأي شهرٍ مُرحَّل، وتفصيل المصاريف بالحساب',
  'عدد الغسلات التي تعادل حصّتك (١٠٠ غسلة ونسبتك ١٠٪ = ١٠ غسلات)',
  'اتجاه صافي ربحك خلال الأشهر الماضية',
];
const CANNOT_SEE = [
  'أسماء العاملين أو رواتبهم أو بياناتهم',
  'بيانات أي شريكٍ آخر أو سنداته',
  'الدفاتر الخام أو أرقام الشركة غير المقسومة',
  'أي تعديل — الرابط للقراءة فقط، ولا أداة كتابة فيه أصلاً',
];

const REVOKE_FIELDS = [
  { name: 'reason', label: 'السبب', type: 'textarea', placeholder: 'اختياري — مثلاً: بدّلت جهازي', hint: 'يُسجَّل مع الإلغاء للمراجعة.' },
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
      showToast(active ? 'بُدِّل الرابط — القديم لم يعد يعمل' : 'أُنشئ رابطك — انسخه الآن');
    } catch (e) {
      const msg = describeBackendError(e) || e?.message || 'تعذّر إنشاء الرابط';
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
      showToast('أُوقف الرابط — لن يعمل بعد الآن');
    } catch (e) {
      setDialogError(describeBackendError(e) || e?.message || 'تعذّر إيقاف الرابط');
    } finally { setBusy(false); }
  }

  const copy = async () => {
    try { await navigator.clipboard?.writeText(url); showToast('نُسخ الرابط'); }
    catch { showToast('تعذّر النسخ — حدّد الرابط وانسخه يدوياً', 'error'); }
  };

  return (
    <>
      <TopBar title={meta.title} subtitle={meta.subtitle} />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {error && <ErrorState title="تعذّر تحميل حال الرابط" error={error} />}

        {/* ── ما هذا؟ ─────────────────────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <span className="w-12 h-12 rounded-control bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0">
              <Bot size={24} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">اسأل مساعدك عن حصّتك</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                رابطٌ خاص بك تلصقه في Claude أو ChatGPT كـ«موصِّل مخصّص» (MCP)، فيصير مساعدك يقرأ
                أرقامك — نسبتك ورأس مالك وقائمة دخلك — ويجيبك بلغتك: «كم ربحتُ هذا الشهر؟»، «كم بقي
                عليّ من رأس المال؟»، «كم غسلة تعادل حصّتي في أغسطس؟».
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-control border border-emerald-100 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-4">
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-1.5"><ShieldCheck size={14} /> ما يراه المساعد</p>
              <ul className="space-y-1.5 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed">
                {CAN_SEE.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />{t}</li>)}
              </ul>
            </div>
            <div className="rounded-control border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5"><EyeOff size={14} /> ما لا يراه أبداً</p>
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
              title="رابطك الجديد — انسخه الآن"
              subtitle="لن يُعرض مرة أخرى: الخادم يحفظ بصمته لا الرمز نفسه. إن فقدته فبدّله من هنا."
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
                    أخفِه
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  الرابط هو المفتاح: من يعرفه يقرأ حصّتك. لا ترسله في مكانٍ عام، وإن شككت بدّله.
                  المعرّف: <code className="font-mono">{fresh.keyId}</code>
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
            title="حال الرابط"
            subtitle={isSelf
              ? 'رابطٌ فعّال واحد في كل وقت — التبديل يُميت القديم فوراً'
              : 'الرابط يُنشئه الشريك من حسابه؛ المدير يرى الحالة ويوقفه من «إدارة الشركاء»'}
            action={isSelf ? (
              <div className="flex items-center gap-2 flex-wrap">
                {!active && (
                  <PrimaryButton icon={KeyRound} onClick={mint} disabled={busy || !isFirebaseConfigured}>
                    {busy ? 'جارٍ الإنشاء…' : 'إنشاء رابط'}
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
            <LoadingState message="جارٍ قراءة حال الرابط..." />
          ) : !active ? (
            <EmptyState
              compact
              icon={Link2}
              title="لا رابط فعّال"
              hint={isSelf ? 'اضغط «إنشاء رابط» ثم الصقه في مساعدك.' : 'لم يُنشئ الشريك رابطاً بعد.'}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <StatCard icon={ShieldCheck} tone="emerald" label="الحالة" value="فعّال" sub={`المعرّف ${active.keyId}`} />
              <StatCard icon={KeyRound} label="أُنشئ في" value={when(active.createdAtIso)} sub={active.rotatedFrom ? 'بدلاً من رابطٍ سابق' : 'أول رابط'} />
              <StatCard
                icon={Clock}
                tone={active.lastUsedAtIso ? 'primary' : 'slate'}
                label="آخر استعمال"
                value={active.lastUsedAtIso ? when(active.lastUsedAtIso) : 'لم يُستعمل بعد'}
                sub="يُحدَّث كل بضع دقائق عند الاستعمال"
              />
            </div>
          )}
        </Card>

        {/* ── كيف أربطه؟ ───────────────────────────────────────── */}
        <Card className="p-5 sm:p-6">
          <SectionHeader title="كيف أربطه بمساعدي؟" subtitle="الخطوات نفسها تقريباً في الاثنين: أضِف موصِّلاً مخصّصاً والصق الرابط" />
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <details className="rounded-control border border-slate-200 dark:border-slate-700 p-4 group" open>
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100 text-sm">Claude (claude.ai)</summary>
              <ol className="mt-3 space-y-2 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed list-decimal pr-5">
                <li><strong>Customize</strong> ← <strong>Connectors</strong> (الموصِّلات) — في حسابات الشركات: Organization settings ← Connectors.</li>
                <li>اضغط <strong>+</strong> ثم <strong>Add custom connector</strong> (في حسابات الشركات: Add ← Custom ← Web).</li>
                <li>الاسم: «حصّتي في سويتر» مثلاً، والرابط: الصق رابطك كما هو.</li>
                <li><strong>Advanced settings</strong> (بيانات OAuth) اختيارية — لا تحتاجها؛ اضغط <strong>Add</strong>.</li>
                <li>في المحادثة فعّل الموصِّل من أيقونة الأدوات، واسأل: «كم صافي ربحي هذا الشهر؟».</li>
              </ol>
            </details>
            <details className="rounded-control border border-slate-200 dark:border-slate-700 p-4 group">
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-slate-100 text-sm">ChatGPT (chatgpt.com)</summary>
              <ol className="mt-3 space-y-2 text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed list-decimal pr-5">
                <li>الإعدادات ← <strong>Apps &amp; Connectors</strong> (قد يظهر باسم Connectors أو Plugins) ← <strong>Advanced</strong> وفعّل <strong>Developer mode</strong>.</li>
                <li>عد إلى Connectors واضغط <strong>Create</strong>.</li>
                <li>الاسم: «حصّتي في سويتر»، ورابط الخادم (MCP Server URL): الصق رابطك.</li>
                <li>المصادقة: <strong>No authentication</strong>، ثم احفظ.</li>
                <li>في محادثةٍ جديدة اختر الموصِّل من «+» ← More، واسأل بلغتك.</li>
              </ol>
            </details>
          </div>
          <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            المساعد يرى ستّ أدوات فقط، كلها قراءة: من أنا، رأس مالي، قائمة الدخل، الاتجاه، التشغيل، والملخّص.
            أرقامها هي أرقام صفحتك بالضبط — محسوبةً بنفس الدوال ومقسومةً بنسبتك.
          </p>
        </Card>
      </main>

      <SweaterActionDialog
        open={dialog === 'rotate'}
        title="تبديل الرابط"
        subtitle="يُنشأ رابطٌ جديد ويتوقف القديم في نفس اللحظة — كل مساعدٍ يستعمل القديم سينقطع."
        icon={RefreshCw}
        fields={[]}
        confirmLabel="بدّل الآن"
        busyLabel="جارٍ التبديل…"
        busy={busy}
        error={dialogError}
        onConfirm={mint}
        onClose={() => setDialog(null)}
      />
      <SweaterActionDialog
        open={dialog === 'revoke'}
        title="إيقاف الرابط"
        subtitle="لن يعمل بعد الآن. تستطيع إنشاء رابطٍ جديد في أي وقت."
        icon={Ban}
        tone="danger"
        fields={REVOKE_FIELDS}
        confirmLabel="أوقف الرابط"
        busyLabel="جارٍ الإيقاف…"
        busy={busy}
        error={dialogError}
        onConfirm={revoke}
        onClose={() => setDialog(null)}
      />

      <Toast open={toast.open} message={toast.message} tone={toast.tone} onClose={closeToast} />
    </>
  );
}
