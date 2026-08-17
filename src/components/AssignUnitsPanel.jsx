import { useEffect, useMemo, useState } from 'react';
import { Wand2, Check, X, Loader2 } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import { suggestUnitAssignments } from '../lib/unitSuggest';

// ═══════════════════════════════════════════════════════════════════════════
// توزيع المصاريف على السكنات — اقتراحٌ يُراجَع قبل أن يُحفظ
// ═══════════════════════════════════════════════════════════════════════════
// Twenty-seven rows recorded before the units existed, most of them naming
// where they went. The machine reads the names back; the person confirms them.
//
// Nothing here writes on open, and nothing writes per row: the whole
// distribution goes in one call, so a half-applied batch cannot leave the
// owner unable to tell which half took. Rows the matcher could not place stay
// «غير محدد» rather than being pushed into a plausible unit — a wrong
// assignment is invisible once saved, and an unassigned row is not.
// ═══════════════════════════════════════════════════════════════════════════

export default function AssignUnitsPanel({ entries, units, onApply, onClose }) {
  // Local edits over the suggestion, keyed by entry id. The suggestion is the
  // starting point, never the answer.
  const [choice, setChoice] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const rows = useMemo(
    () => suggestUnitAssignments(entries, units),
    [entries, units],
  );

  useEffect(() => {
    setChoice(Object.fromEntries(rows.map((r) => [r.entryId, r.suggested || ''])));
  }, [rows]);

  const chosen = rows.filter((r) => choice[r.entryId]);
  const matched = rows.filter((r) => r.suggested).length;

  async function handleApply() {
    if (!chosen.length || submitting) return;
    setSubmitting(true);
    try {
      await onApply(chosen.map((r) => ({ entryId: r.entryId, unit: choice[r.entryId] })));
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-smallcard border border-primary-200 dark:border-primary-500/30 bg-primary-50/50 dark:bg-primary-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Wand2 size={15} className="text-primary-600 dark:text-primary-400 shrink-0" />
            توزيع مقترح على السكنات
          </p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            قُرئ السكن من وصف كل مصروف — {formatNumber(matched)} من {formatNumber(rows.length)} وُجد لها سكن.
            راجِعها وغيّر ما تريد؛ <strong>لا يُحفظ شيء حتى تضغط التأكيد</strong>، وما تتركه فارغاً يبقى «غير محدد».
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="sw-tap shrink-0 inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="إغلاق لوحة التوزيع"
        >
          <X size={16} />
        </button>
      </div>

      <ul className="max-h-64 overflow-y-auto divide-y divide-primary-100 dark:divide-primary-500/20 rounded-control border border-primary-100 dark:border-primary-500/20 bg-white dark:bg-slate-900">
        {rows.map((r) => (
          <li key={r.entryId} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 text-[12px] text-slate-700 dark:text-slate-300 truncate" title={r.description}>
              {r.description}
            </span>
            <span className="shrink-0 text-[12px] font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatCurrency(r.amount)}
            </span>
            <select
              value={choice[r.entryId] ?? ''}
              onChange={(e) => setChoice((p) => ({ ...p, [r.entryId]: e.target.value }))}
              aria-label={`سكن ${r.description}`}
              className={`shrink-0 max-w-[8.5rem] text-[11px] px-2 py-1.5 rounded-control border bg-white dark:bg-slate-800 focus:outline-none focus:border-primary-500 transition-colors ${
                choice[r.entryId]
                  ? 'border-emerald-300 dark:border-emerald-500/40 text-slate-800 dark:text-slate-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}
            >
              <option value="">غير محدد</option>
              {units.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={!chosen.length || submitting}
          className="sw-button sw-button--sm sw-button--primary flex-1"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {submitting
            ? 'جارٍ الحفظ...'
            : `تأكيد توزيع ${formatNumber(chosen.length)} مصروفاً`}
        </button>
        <button type="button" onClick={onClose} className="sw-button sw-button--sm sw-button--secondary">
          إلغاء
        </button>
      </div>
    </div>
  );
}
