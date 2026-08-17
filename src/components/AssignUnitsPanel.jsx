import { useEffect, useMemo, useState } from 'react';
import { Wand2, Check, X, Loader2, Search } from 'lucide-react';
import { formatCurrency, formatNumber } from '../data/initialData';
import { suggestUnitAssignments } from '../lib/unitSuggest';
import { normalizeUnitName } from '../lib/accounting/startupMigration';

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
//
// ── ولماذا بحثٌ وتعيينٌ جماعي، لا خريطة أسماء في الشيفرة ──
// The descriptions name places («النزهة»); the divisions are compass points
// («سكن الشمال»). Only the owner knows that one is the other — and that is
// one rule among many they hold and I do not. Hard-coding «النزهة ⇒ الشمال»
// would answer today's question and be wrong by next month. So the panel
// gives them the general form of the rule instead: narrow to the rows the
// rule is about, then apply one unit to all of them — still without writing
// anything until the single confirm.
// ═══════════════════════════════════════════════════════════════════════════

export default function AssignUnitsPanel({ entries, units, onApply, onClose }) {
  // Local edits over the suggestion, keyed by entry id. The suggestion is the
  // starting point, never the answer.
  const [choice, setChoice] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => suggestUnitAssignments(entries, units),
    [entries, units],
  );

  // ── البذرة مرّة واحدة لكل مجموعة صفوف ──
  // Re-seeding on every `rows` identity used to erase the corrections the
  // person had just made: the parent rebuilt `units` on each render, the memo
  // fell over, and this effect wrote the machine's guesses back on top. The
  // parent now hands down a stable list, and the seed only ever adds keys it
  // has not seen — so an answer a person gave is never overwritten by one the
  // machine guessed.
  useEffect(() => {
    setChoice((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (!(r.entryId in next)) next[r.entryId] = r.suggested || '';
      }
      return next;
    });
  }, [rows]);

  // البحث بالتطبيع نفسه: «النزهه» تجد «النزهة».
  const needle = normalizeUnitName(query);
  const visible = needle
    ? rows.filter((r) => normalizeUnitName(r.description).includes(needle))
    : rows;

  const chosen = rows.filter((r) => choice[r.entryId]);
  const matched = rows.filter((r) => r.suggested).length;

  /** يُسند التقسيم إلى الصفوف الظاهرة وحدها — في اللوحة، بلا كتابة. */
  function assignVisible(unit) {
    if (!unit || !visible.length) return;
    setChoice((prev) => {
      const next = { ...prev };
      for (const r of visible) next[r.entryId] = unit;
      return next;
    });
  }

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
            وما لم يُعرَف: ابحث بكلمة تجمعها ثم عيّنها دفعةً واحدة.
            <strong> لا يُحفظ شيء حتى تضغط التأكيد</strong>، وما تتركه فارغاً يبقى «غير محدد».
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

      {/* ── قاعدةٌ واحدة في خطوتين: ضيِّق، ثم عيِّن ──
          «أي شي في سكن النزهة اعتبره في الشمال» — يُكتب «النزهة» هنا فتبقى
          صفوفها وحدها، ثم يُختار «سكن الشمال». وتُكرَّر لأي قاعدة أخرى. */}
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في الوصف — مثال: النزهة"
            aria-label="ابحث في وصف المصاريف"
            className="w-full pr-8 pl-3 py-2 text-[12px] rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-primary-500 transition-colors"
          />
        </div>
        {/* فعلٌ لا حالة — يعود فارغاً بعد كل تعيين، كمنتقي «نقل إلى…». */}
        <select
          value=""
          onChange={(e) => assignVisible(e.target.value)}
          disabled={!visible.length}
          aria-label={`عيّن ${formatNumber(visible.length)} مصروفاً ظاهراً إلى تقسيم`}
          className="shrink-0 max-w-[11rem] text-[11px] px-2 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-60 focus:outline-none focus:border-primary-500 transition-colors"
        >
          <option value="">عيّن الظاهر ({formatNumber(visible.length)}) إلى…</option>
          {units.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <ul className="max-h-64 overflow-y-auto divide-y divide-primary-100 dark:divide-primary-500/20 rounded-control border border-primary-100 dark:border-primary-500/20 bg-white dark:bg-slate-900">
        {visible.length === 0 && (
          <li className="px-3 py-4 text-[12px] text-slate-500 dark:text-slate-400 text-center">
            لا مصروف يطابق «{query}».
          </li>
        )}
        {visible.map((r) => (
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
