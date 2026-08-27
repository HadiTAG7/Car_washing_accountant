import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from './UI';
import { fieldProblem, dialogPayload, initialValues } from '../lib/sweater/dialogFields';

// ═══════════════════════════════════════════════════════════════════════════
// نافذة إجراء سويتر — وُجدت لأن `prompt()` لا يعمل في متصفحٍ آلي
// ═══════════════════════════════════════════════════════════════════════════
// خمسة إجراءات في صفحتَي سويتر كانت تسأل بـ`window.prompt`، فتوقّف الوكيل عند
// أول نقرة: `prompt() is not supported`. ولم يكن العطب في الأتمتة وحدها —
// `prompt` يحجب الصفحة، بلا تنسيق ولا اتجاه عربي ولا تحقق، و
// `Number(prompt('المبلغ'))` على فراغٍ يعطي **صفراً يُسجَّل بصمت**.
//
// ── ولماذا مكوّنٌ واحد لا خمسة ──
// الخمس تتشارك كل شيء: الغلاف، ومفتاح الهروب، والإلغاء الآمن، وتجميد الإرسال،
// وعرض رفض الخادم. خمس نسخٍ منها سبعمئة سطرٍ متطابقة تنجرف عن بعضها عند أول
// تعديل. فوصفُ حقولٍ صغير يصف الاختلاف، والباقي مشترك.
//
// ── والوصول ليس زينة هنا ──
// `role="dialog"` واسمٌ لكل حقل عبر `<label htmlFor>` هما ما يجعل الوكيل
// يجدها ويملؤها. نافذةٌ جميلة بلا أسماء = `prompt` آخر بواجهةٍ ألطف.
//
// ── والتاريخ بمدخلٍ أصيل، خلافاً لاصطلاح التطبيق ──
// `DateField` في هذا المشروع تقويمٌ مخصّص بلا حقل كتابة: مدخله الوحيد
// `aria-hidden` و`tabIndex={-1}` ويتجاهل `onChange`. وهي مقايضةٌ صحيحة لنموذجٍ
// يملؤه إنسان (تنسيقٌ موحّد وأرقام لاتينية)، وخاطئةٌ لنافذةٍ يقودها وكيل — إذ
// لا سبيل لكتابة تاريخٍ فيها. فهنا `<input type="date">` بـ`lang="en-GB"`
// الذي يمنع الأرقام العربية-الهندية التي بُني `DateField` لتفاديها أصلاً.
// ═══════════════════════════════════════════════════════════════════════════

export default function SweaterActionDialog({
  open,
  title,
  subtitle = null,
  icon: Icon = null,
  tone = 'primary',
  fields = [],
  confirmLabel = 'تأكيد',
  busyLabel = 'جارٍ التنفيذ…',
  busy = false,
  error = null,
  context = null,
  onConfirm,
  onClose,
}) {
  const [values, setValues] = useState(() => initialValues(fields));
  const [touched, setTouched] = useState(false);

  // إعادة الضبط عند كل فتح: نافذةٌ تُفتح بقيم مرةٍ سابقة تُرسل ما لم يُقصد.
  // مقارنةُ الهوية على `open` وحده تكفي لأن الحقول ثابتة لكل استدعاء.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setValues(initialValues(fields)); setTouched(false); }
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const problems = fields.map((f) => [f, fieldProblem(f, values[f.name])]);
  const firstProblem = problems.find(([, p]) => p)?.[1] ?? null;
  const canSubmit = !firstProblem && !busy;

  const set = (name, v) => setValues((prev) => ({ ...prev, [name]: v }));

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    onConfirm(dialogPayload(fields, values));
  };

  const chip = tone === 'danger'
    ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300'
    : 'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300';

  const inputClass = 'w-full px-3 py-2.5 rounded-control border border-slate-200 '
    + 'dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 '
    + 'dark:text-slate-100 focus:outline-none focus:border-primary-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* النقر خارجها إلغاءٌ آمن — لا يستدعي شيئاً */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
        data-testid="sweater-dialog-backdrop"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <span className={`w-10 h-10 rounded-control flex items-center justify-center shrink-0 ${chip}`}>
                <Icon size={19} strokeWidth={2.2} />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">{title}</h3>
              {subtitle && (
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy} aria-label="إغلاق"
            className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form
          className="p-5 sm:p-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          {context}

          {fields.map((f) => {
            const id = `sweater-dlg-${f.name}`;
            const problem = problems.find(([x]) => x.name === f.name)?.[1] ?? null;
            const common = {
              id,
              name: f.name,
              value: values[f.name],
              disabled: busy,
              onChange: (e) => set(f.name, e.target.value),
              className: inputClass,
            };
            return (
              <div key={f.name}>
                <label htmlFor={id} className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {f.label} {f.required && <span className="text-rose-600">*</span>}
                </label>

                {f.type === 'textarea' && <textarea rows={3} placeholder={f.placeholder} {...common} />}

                {f.type === 'number' && (
                  <input
                    type="number" step="any" inputMode="decimal" dir="ltr"
                    placeholder={f.placeholder}
                    {...common}
                    className={`${inputClass} text-left tabular-nums`}
                  />
                )}

                {f.type === 'date' && (
                  <input
                    type="date" dir="ltr" lang="en-GB"
                    {...common}
                    className={`${inputClass} text-left tabular-nums`}
                  />
                )}

                {(!f.type || f.type === 'text') && (
                  <input type="text" placeholder={f.placeholder} {...common} />
                )}

                {f.hint && (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{f.hint}</p>
                )}
                {touched && problem && (
                  <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-400 font-medium">{problem}</p>
                )}
              </div>
            );
          })}

          {/* رفض الخادم يُعرض هنا والنافذة تبقى بقيمها — إغلاقها كأنها نجحت
              يجعل المستخدم يظن أن الأمر تمّ. */}
          {error && (
            <div role="alert" className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 text-[12px] text-rose-700 dark:text-rose-300 font-medium leading-relaxed">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1 break-words">{error}</span>
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <SecondaryButton onClick={onClose} disabled={busy}>تراجع</SecondaryButton>
          <PrimaryButton icon={busy ? Loader2 : Icon} disabled={busy} onClick={submit}>
            {busy ? busyLabel : confirmLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
