import { Percent, HelpCircle } from 'lucide-react';
import { formatCurrencyPrecise } from '../data/initialData';
import { purchaseAmounts, amountRoleOf } from '../lib/accounting/purchaseDisplay';

/**
 * شارة ضريبة المشتريات على سطر في قائمة.
 *
 * The three expense lists each rendered `extractVat(total)` — the stored
 * amount treated as a GROSS, split at 15%. Two things were wrong with that,
 * and both changed the number:
 *
 *   • a row saved `exclusive` means the amount is the NET, so the tax is on
 *     top of it and the badge understated it;
 *   • 15% was assumed whatever the invoice said, so a 5%-era document showed
 *     three times the tax that was actually paid.
 *
 * Now it comes from the same engine the ledger posts with, and when the tax
 * genuinely cannot be determined it SAYS so rather than showing a figure
 * nobody can support. See docs/AMOUNT_DEFINITION.md.
 *
 * `row` is the app shape with `amount` already mapped from whichever column
 * the source uses (`total_monthly_cost`, `total_variable_cost`, `amount`).
 */
export default function PurchaseVatBadge({ row, policyAt = null, scale = 1 }) {
  if (!row?.isTaxInvoice) return null;
  const a = purchaseAmounts(row, { policyAt });
  const role = amountRoleOf(row);

  if (!a.known) {
    return (
      <span
        title={a.reason || ''}
        className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-100 dark:border-amber-500/30 px-2 py-0.5 rounded-full">
        <HelpCircle size={11} />
        ض.ق.م غير محدَّدة
      </span>
    );
  }

  return (
    <span
      title={`المبلغ المسجَّل ${role.label} — الصافي ${formatCurrencyPrecise(a.net * scale)}`
        + ` · الإجمالي ${formatCurrencyPrecise(a.gross * scale)}`
        + (a.deductible ? '' : ' · غير قابلة للخصم، محمّلة على التكلفة')}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums border ${
        a.deductible
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
      }`}>
      <Percent size={11} />
      ض.ق.م: {formatCurrencyPrecise(a.documentVat * scale)}
      <span className="font-normal opacity-70">· {role.short} {formatCurrencyPrecise(Number(row.amount) * scale)}</span>
    </span>
  );
}
