import { formatCurrencyPrecise } from '../data/initialData';
import { purchaseAmounts, amountRoleOf } from '../lib/accounting/purchaseDisplay';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { taxPolicyAt } from '../lib/accounting/taxPolicy';

/**
 * الصافي والضريبة والإجمالي، كما ستُرحَّل — a live breakdown of one purchase.
 *
 * The three expense modals each rendered `extractVat(total)` and
 * `netOfVat(total)`: the amount treated as a GROSS, split at 15%, whatever
 * the invoice actually said. Two ways for that to be wrong, and both moved
 * the number the user was reading:
 *
 *   • `exclusive` means the amount is the NET and the tax sits on top of it,
 *     so the settlement is `amount + VAT` and the preview understated both;
 *   • a 5%-era invoice, or one with the tax written on it, was shown at 15%.
 *
 * Now it is the same engine the ledger posts with, so what the user is
 * looking at while typing is what the entry will say. And when the tax
 * genuinely cannot be resolved — no amount on the paper, no rate on it, no
 * policy covering its date — it says so instead of showing a figure the
 * posting would refuse.
 *
 * See docs/AMOUNT_DEFINITION.md.
 */
export default function PurchaseAmountBreakdown({ form, amount, suffix = '' }) {
  const { settings } = useAccountingSettings();
  const policyAt = (date) => taxPolicyAt(date, settings);

  if (!form?.isTaxInvoice || !(Number(amount) > 0)) return null;

  const row = { ...form, amount, isTaxInvoice: true };
  const a = purchaseAmounts(row, { policyAt });
  const role = amountRoleOf(row);

  if (!a.known) {
    return (
      <div role="status"
        className="px-3 py-2 rounded-control bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
        الضريبة غير محدَّدة: لا مبلغ مكتوب على الفاتورة، ولا نسبة مثبتة، ولا
        سياسة ضريبية تغطّي تاريخها — اكتب المبلغ أو النسبة، أو هيّئ السياسة.
        <span className="block opacity-80 mt-0.5">ولا تُفترض 15%: فاتورة من عصر الـ5% تُستردّ ثلاثة أضعاف ما دُفع.</span>
      </div>
    );
  }

  return (
    <div role="status"
      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-control text-[12px] border ${
        a.deductible
          ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30'
          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
      }`}>
      <span className={a.deductible ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}>
        {a.deductible ? `الضريبة المتوقع استردادها${suffix}:` : `ضريبة الفاتورة (غير قابلة للخصم)${suffix}:`}
        <span className="font-bold tabular-nums mr-1">{formatCurrencyPrecise(a.documentVat)}</span>
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        الصافي:
        <span className="font-bold tabular-nums mr-1">{formatCurrencyPrecise(a.net)}</span>
        <span className="mx-1.5 opacity-50">·</span>
        الإجمالي:
        <span className="font-bold tabular-nums mr-1">{formatCurrencyPrecise(a.gross)}</span>
      </span>
      <span className="w-full text-[11px] text-slate-500 dark:text-slate-400">
        المبلغ المسجَّل {role.label}
        {a.deductible ? '' : ' — الضريبة محمّلة على التكلفة، ولا يُفتح لها حساب مدخلات'}
      </span>
    </div>
  );
}
