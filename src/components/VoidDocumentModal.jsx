import { useEffect, useState } from 'react';
import { X, Ban, Loader2, AlertTriangle } from 'lucide-react';
import { formatCurrencyPrecise } from '../data/initialData';
import DateField from './DateField';
import { PrimaryButton, SecondaryButton } from './UI';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * حوار إلغاء مستند — the reason AND the date the correction lands on.
 *
 * The date is here because a `window.prompt` cannot ask for one, and without
 * it a note raised in a month that has since been closed simply could not be
 * voided: the server used to fall back to the note's own date, which is the
 * one date the closed period refuses. Whoever voids the document chooses the
 * open month the reversal belongs in, and sees which entry it will reverse
 * before confirming.
 *
 * A document with no journal entry of its own — the invoice for a wash that
 * was posted from the washes register — reverses nothing here, and the dialog
 * says so rather than implying an accounting effect it does not have.
 */
// Mounted per document (the caller keys it on the document id), so the draft
// resets by remounting rather than by an effect that re-renders on open.
export default function VoidDocumentModal({ document: doc, busy = false, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [reversalDate, setReversalDate] = useState(todayIso);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const reverses = Boolean(doc.journalEntryId);
  const canSubmit = Boolean(reason.trim()) && (!reverses || Boolean(reversalDate)) && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`إلغاء المستند ${doc.documentNumber}`}
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-control flex items-center justify-center shrink-0 bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">
              <Ban size={20} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                إلغاء {doc.documentNumber}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
                {doc.issueDate} · {formatCurrencyPrecise(doc.gross)}
              </p>
            </div>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy} aria-label="إغلاق"
            className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p>
              {reverses
                ? `الإلغاء يعكس قيد المستند رقم ${doc.journalEntryNumber ?? '—'} بقيد مرآة مؤرّخ بالتاريخ أدناه. `
                  + 'الرقم يبقى محجوزاً — لا يُعاد استخدامه ولا يُحذف المستند.'
                : 'هذا المستند لا يحمل قيداً خاصاً به، فالإلغاء يوثّق النية فقط. '
                  + 'الأثر المحاسبي لغسلة مُرحّلة يُصحَّح بعكس قيدها من دفتر الأستاذ.'}
            </p>
          </div>

          <div>
            <label htmlFor="void-reason" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              سبب الإلغاء <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="void-reason" rows={3} value={reason} disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="يُقرأ في المراجعة الضريبية — اذكر السبب بوضوح."
              className="w-full px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          {reverses && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                تاريخ القيد العكسي <span className="text-rose-600">*</span>
              </label>
              <DateField
                name="reversalDate" value={reversalDate}
                onChange={(e) => setReversalDate(e.target.value)}
                ariaLabel="تاريخ القيد العكسي"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                يجب أن يقع في فترة مفتوحة. إذا كان شهر المستند مقفلاً، اختر شهراً مفتوحاً —
                القيد الأصلي يبقى كما هو في شهره، والمرآة تُسجَّل في الشهر الذي تختاره.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <SecondaryButton onClick={onClose} disabled={busy}>تراجع</SecondaryButton>
          <PrimaryButton
            icon={busy ? Loader2 : Ban}
            disabled={!canSubmit}
            onClick={() => onConfirm({
              reason: reason.trim(),
              reversalDate: reverses ? reversalDate : null,
            })}
          >
            {busy ? 'جارٍ الإلغاء...' : 'تأكيد الإلغاء'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
