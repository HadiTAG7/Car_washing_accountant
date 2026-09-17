// ═══════════════════════════════════════════════════════════════════════════
// سطر قائمة الدخل
// ═══════════════════════════════════════════════════════════════════════════
// نُقل حرفياً من `FinancialSummaryPage.jsx` حين صارت صفحة المستثمر تعرض
// القائمة نفسها بحصّته. استيراده من هناك كان سيجرّ الصفحة الثقيلة كاملة —
// سبعة خطّافات بيانات ونافذة التنقيب ورسم الاتجاه — إلى حزمة صفحةٍ لا تقرأ
// شيئاً من ذلك، وهو عكس المقصود: صفحة المستثمر تطلب أقلّ لا أكثر.
//
// نقلٌ لا إعادة كتابة: السلوك والتنسيق كما هما، والصفحتان تعرضان سطراً واحداً
// لا سطرين يتشابهان اليوم ويفترقان بعد شهر.
// ═══════════════════════════════════════════════════════════════════════════

import { ListFilter } from 'lucide-react';
import { formatCurrency } from '../../data/initialData';

// ─── Income statement row ────────────────────────────────────────────────
// `kind`: 'plus' (revenue) | 'minus' (cost) | 'subtotal' (gross profit)
//       | 'expenseSubtotal' (total outflow tally) | 'final' (net profit)
//       — drives sign, color, and emphasis.
// `onClick`: when provided, the row becomes a button-styled drill-down
// trigger (cursor + hover tint + leading filter icon).
export default function StatementRow({ label, amount, kind = 'minus', tone = 'auto', onClick }) {
  const isPlus            = kind === 'plus';
  const isSubtotal        = kind === 'subtotal';
  const isExpenseSubtotal = kind === 'expenseSubtotal';
  const isFinal           = kind === 'final';

  // tone='auto' lets the final row pick emerald/rose from amount sign.
  const positive   = amount >= 0;
  const finalGood  = isFinal && positive;
  const finalBad   = isFinal && !positive;

  // Expense subtotals are tallies of outflow, so always show the minus
  // sign — they should never be confused with a profit subtotal.
  const sign = isPlus
    ? '+'
    : (isSubtotal || isFinal)
      ? '='
      : '−';

  // `=` alone erases the sign of a losing subtotal/final row — restore
  // the minus inside the amount so the figure matches the KPI and CSV.
  const negMark = (isSubtotal || isFinal) && amount < 0 ? '−' : '';

  // Plain line items get the standard table hairline. Banner rows (both
  // subtotals + the final row) are skipped on purpose: they carry their own
  // coloured `border-t-2`, and a second border-colour utility on the same
  // element would fight it.
  let rowClass = (isSubtotal || isExpenseSubtotal || isFinal)
    ? ''
    : 'border-b border-slate-50 dark:border-slate-800/60';
  // Both subtotal kinds share the same slate banner styling — the gross
  // profit subtotal and the expenses tally read as parallel structural
  // dividers in the statement.
  if (isSubtotal || isExpenseSubtotal) {
    rowClass = 'border-t-2 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800';
  }
  if (finalGood) {
    rowClass = 'border-t-2 border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30';
  }
  if (finalBad) {
    rowClass = 'border-t-2 border-rose-100 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30';
  }

  let amountClass = 'text-rose-700 dark:text-rose-400';
  if (isPlus)            amountClass = 'text-emerald-700 dark:text-emerald-400';
  if (isSubtotal)        amountClass = positive
    ? 'text-slate-900 dark:text-slate-100'
    : 'text-rose-700 dark:text-rose-400';
  // Expense subtotal mirrors the gross-profit subtotal's high-contrast
  // slate text so the figure is clearly readable against the slate banner.
  // The leading `−` sign carries the outflow semantics without needing red.
  if (isExpenseSubtotal) amountClass = 'text-slate-900 dark:text-slate-100';
  if (finalGood)         amountClass = 'text-emerald-600 dark:text-emerald-400';
  if (finalBad)          amountClass = 'text-rose-600 dark:text-rose-400';
  if (tone === 'slate' && !isFinal && !isSubtotal && !isExpenseSubtotal) {
    amountClass = 'text-slate-700 dark:text-slate-300';
  }

  let labelClass = 'text-slate-700 dark:text-slate-300';
  if (isSubtotal || isExpenseSubtotal) {
    labelClass = 'font-bold text-slate-900 dark:text-slate-100';
  }
  if (finalGood) labelClass = 'font-black text-emerald-600 dark:text-emerald-400';
  if (finalBad)  labelClass = 'font-black text-rose-600 dark:text-rose-400';

  const amountWeight = isFinal
    ? 'font-black text-lg'
    : (isSubtotal || isExpenseSubtotal)
      ? 'font-extrabold'
      : 'font-bold';

  const clickable = typeof onClick === 'function';
  const interactiveClass = clickable
    ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group'
    : '';

  return (
    <tr
      className={`${rowClass} ${interactiveClass}`.trim()}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable
        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
        : undefined}
      aria-label={clickable ? `عرض تفاصيل: ${label}` : undefined}
    >
      <td className={`py-3 px-4 whitespace-nowrap ${labelClass}`}>
        <span className="inline-flex items-center gap-2">
          {clickable && (
            <ListFilter
              size={13}
              strokeWidth={2.2}
              className="text-slate-500 dark:text-slate-400 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors shrink-0"
              aria-hidden="true"
            />
          )}
          <span>{label}</span>
        </span>
      </td>
      <td className={`py-3 px-4 whitespace-nowrap text-left tabular-nums ${amountWeight} ${amountClass}`}>
        {sign}{negMark}{formatCurrency(Math.abs(amount))}
      </td>
    </tr>
  );
}
