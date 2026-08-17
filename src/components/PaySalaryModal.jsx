import { useEffect, useMemo, useState } from 'react';
import { X, Banknote, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '../data/initialData';
import { formatMonthLabel, monthOf } from '../lib/variableExpenseTotals';
import { netSalary } from '../lib/bikerStats';
import DateField from './DateField';

// ═══════════════════════════════════════════════════════════════════════════
// صرف الراتب — قيدان صادقان بدل قيدٍ ملفَّق
// ═══════════════════════════════════════════════════════════════════════════
// Deducting an advance from a salary is TWO facts, and they are recorded as
// two records that post through the existing, tested adapters:
//
//   1. The salary, in full, as a paid one-time monthly expense
//      (Dr مصروف / Cr نقد بالكامل) — the biker earned the whole thing.
//   2. Each deducted advance marked recovered on the SAME date with the SAME
//      money account (Dr نقد بالخصم / Cr 1300) — the debt came back.
//
// Net cash movement = salary − deductions, exactly what left the drawer.
// Inventing a single "net salary" expense instead would understate the wage
// AND leave the advance forever outstanding on 1300.
//
// Deduction is per-advance and whole: an advance is one debt with one posted
// outlay, so it is either settled or still pending — the ledger has no half
// state. Partial repayment = record smaller advances to begin with.
// ═══════════════════════════════════════════════════════════════════════════

const METHODS = [
  { value: 'cash',     label: 'نقدي (الصندوق)',  recovery: 'cash' },
  { value: 'transfer', label: 'تحويل بنكي',       recovery: 'bank' },
];

export default function PaySalaryModal({
  isOpen, onClose, biker, pendingAdvances = [], salaryPaidInMonth, onPay,
}) {
  const [form, setForm] = useState({ amount: '', payDate: '', paymentMethod: 'cash' });
  const [checked, setChecked] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      amount:        biker?.salary ? String(biker.salary) : '',
      payDate:       todayISO(),
      paymentMethod: 'cash',
    });
    // Default to deducting everything outstanding — the user unchecks what
    // should wait. Salary day is when advances are settled; forgetting one is
    // the likelier mistake, and unchecking is one click.
    setChecked(new Set(pendingAdvances.map((a) => a.id)));
    // pendingAdvances is derived per-open from the biker row; keying the
    // reset on isOpen alone is deliberate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, biker?.id]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }
  function toggleAdvance(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const amount = Math.max(0, parseFloat(form.amount) || 0);
  const deducted = useMemo(
    () => pendingAdvances.filter((a) => checked.has(a.id)),
    [pendingAdvances, checked],
  );
  const summary = netSalary(amount, deducted);
  const payMonth = monthOf(form.payDate);
  const duplicateWarning = Boolean(salaryPaidInMonth && payMonth && salaryPaidInMonth === payMonth);
  const isValid = amount > 0 && Boolean(form.payDate);

  async function handleSubmit(e) {
    e.preventDefault();
    // `exceedsSalary` is checked HERE, not only on the disabled button: a
    // form submits on Enter too, and a guard that lives only in the
    // button's `disabled` prop is a guard that Enter walks straight past.
    if (!isValid || submitting || summary.exceedsSalary) return;
    setSubmitting(true);
    try {
      const method = METHODS.find((m) => m.value === form.paymentMethod) || METHODS[0];
      await onPay({
        amount,
        payDate:        form.payDate,
        paymentMethod:  method.value,
        recoveryMethod: method.recovery,
        monthLabel:     formatMonthLabel(payMonth),
        deductedAdvances: deducted,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 w-9 h-9 rounded-control flex items-center justify-center">
              <Banknote size={18} />
            </span>
            صرف راتب — {biker?.name || ''}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {duplicateWarning && (
            <div role="alert" className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-smallcard p-3.5 text-[13px] text-amber-800 dark:text-amber-300 leading-relaxed">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                سبق تسجيل راتب لـ{biker?.name} في {formatMonthLabel(payMonth)}. التسجيل
                مرة أخرى يضيف مصروفاً ثانياً لنفس الشهر — تأكد أن هذا مقصود.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="salaryAmount">
                مبلغ الراتب (ر.س)
              </label>
              <input
                id="salaryAmount"
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="any"
                required
                autoFocus
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="salaryDate">
                تاريخ الصرف
              </label>
              <DateField
                id="salaryDate"
                name="payDate"
                value={form.payDate}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="salaryMethod">
              طريقة الدفع
            </label>
            <select
              id="salaryMethod"
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={handleChange}
              className="w-full px-3 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              استرداد السلف المخصومة يُقيَّد على نفس الحساب، فيتطابق صافي النقد مع
              ما خرج فعلاً.
            </p>
          </div>

          {pendingAdvances.length > 0 && (
            <fieldset>
              <legend className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                خصم السلف القائمة
              </legend>
              <div className="space-y-2">
                {pendingAdvances.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer hover:border-primary-400 transition-colors"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked.has(a.id)}
                        onChange={() => toggleAdvance(a.id)}
                        className="accent-emerald-600 w-4 h-4 shrink-0"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {a.title || 'سلفة'}
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1.5">
                          {formatDate(a.spentDate)}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                      {formatCurrency(a.amount)}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                الخصم بكامل مبلغ السلفة — سلفةٌ واحدة دينٌ واحد في الدفاتر، إما
                مستردّة أو قائمة. أزل التحديد عمّا يبقى للشهر القادم.
              </p>
            </fieldset>
          )}

          {/* ── المعاينة: راتب − سلف = صافي ── */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 text-sm space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">الراتب المستحق:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(summary.gross)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400">سلف مخصومة ({deducted.length}):</span>
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">− {formatCurrency(summary.deducted)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-slate-700 dark:text-slate-300">صافي المدفوع الآن:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums text-base">{formatCurrency(summary.net)}</span>
            </div>
            {summary.exceedsSalary && (
              <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed pt-1">
                السلف المختارة أكبر من الراتب — لن يُدفع نقد، ويبقى الفرق
                ({formatCurrency(summary.deducted - summary.gross)}) سلفةً قائمة:
                أزل تحديد ما يتجاوز الراتب.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!isValid || submitting || summary.exceedsSalary}
              className="sw-button sw-button--sm sw-button--primary flex-1"
            >
              <Banknote size={18} />
              {submitting ? 'جارٍ الصرف...' : `صرف ${formatCurrency(summary.net)}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sw-button sw-button--sm sw-button--secondary"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
