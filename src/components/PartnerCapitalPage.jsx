import { useMemo } from 'react';
import TopBar from './TopBar';
import { Card } from './UI';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { usePartners } from '../hooks/usePartners';
import { usePartnerPayments } from '../hooks/usePartnerPayments';
import { useLedger } from '../hooks/useLedger';
import { formatCurrency, formatDate } from '../data/initialData';
import { paymentHref, reconcilePartnerCapital } from '../lib/partnerCapitalReconciliation';
import { ReceiptPostings } from './founding/FoundingReceipts';

export default function PartnerCapitalPage() {
  const { role, isPartnerView } = usePartnerView();
  if (isPartnerView || !['admin', 'accountant'].includes(role)) return <p className="p-6">هذه الصفحة للإدارة المحاسبية.</p>;
  return <CapitalContent role={role} />;
}

function CapitalContent({ role }) {
  const partners = usePartners();
  const payments = usePartnerPayments();
  const ledger = useLedger();
  const result = useMemo(() => reconcilePartnerCapital(partners.partners, payments.payments, ledger.entries, ledger.lines),
    [partners.partners, payments.payments, ledger.entries, ledger.lines]);
  const error = partners.error || payments.error || ledger.error;
  const loading = partners.loading || payments.loading || ledger.loading;
  return <><TopBar title="مطابقة رأس المال" subtitle="سندات القبض مقابل دفتر الأستاذ — قراءة فقط" />
    <main className="p-4 sm:p-6 lg:p-8 space-y-6">
      {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={() => { partners.refetch(); payments.refetch(); ledger.refetch(); }} /> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[["المسجّل في سندات القبض", result.totals.recorded], ["المرحّل في دفتر الأستاذ", result.totals.posted],
            ["ذمة رأس مال غير مسددة", result.totals.receivable], ["الفرق", result.totals.difference]].map(([title, value]) =>
            <Card key={title} className="p-5"><p>{title}</p><strong className={`block mt-3 text-2xl tabular-nums ${title === 'الفرق' && value ? 'text-rose-500' : ''}`}>{formatCurrency(value)}</strong></Card>)}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">المطلوب حسب العمالة. المدفوع من سندات القبض، والمرحّل من حساب رأس مال كل شريك. لا ترحيل هنا إلا قيود السندات التي وصلت لحساب هادي، بموافقة المدير.</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">«ذمة رأس مال غير مسددة» رصيد أسطر 1100 «ذمة رأس مال — اسم الشريك»: رأس مال مقيّد على الشريك ولم يُدفع، فهو عمود مستقل لا فرق. الفرق = المسجّل في السندات − (المرحّل في الدفتر − الذمة). سند القبض لشريك عليه ذمة يُرحّل دائنًا على 1100 حتى تنتهي، والباقي لرأس المال.</p>
        {result.orphanPayments.length > 0 && <p role="alert" className="text-rose-500">توجد {result.orphanPayments.length} دفعات بلا شريك معروف؛ لم تدخل مجموع الشركاء.</p>}
        {result.unmatchedReceivables.count > 0 && <p role="alert" className="text-rose-500">توجد {result.unmatchedReceivables.count} أسطر «ذمة رأس مال» على 1100 لا تسمّي شريكًا واحدًا معروفًا ({formatCurrency(result.unmatchedReceivables.amount)})؛ لم تدخل ذمم الشركاء.</p>}
        <Card className="p-4 overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
          <caption className="text-right font-bold mb-4">مطابقة الشركاء</caption>
          <thead><tr>{['الشريك', 'المطلوب', 'المسجّل في السندات', 'المرحّل في الدفتر', 'ذمة رأس مال غير مسددة', 'الفرق'].map(label => <th key={label} className="p-3 text-right">{label}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <PartnerRow key={row.partner.id} row={row} />)}</tbody>
          <tfoot><tr className="font-bold border-t"><td className="p-3">الإجمالي</td>{COLUMNS.map(key => <td key={key} className="p-3 tabular-nums">{formatCurrency(result.totals[key])}</td>)}</tr></tfoot>
        </table></Card>
        {role === 'admin' && <ReceiptPostings onPosted={() => { payments.refetch(); ledger.refetch(); }} />}
      </>}
    </main></>;
}

const COLUMNS = ['required', 'recorded', 'posted', 'receivable', 'difference'];

function PartnerRow({ row }) {
  return <><tr className="border-t border-slate-200 dark:border-slate-700"><th scope="row" className="p-3 text-right">{row.partner.partnerName}</th>
    {COLUMNS.map(key => <td key={key} className={`p-3 tabular-nums ${key === 'difference' && row.difference ? 'text-rose-500 font-bold' : ''} ${key === 'receivable' && row.receivable ? 'text-amber-700 dark:text-amber-300 font-bold' : ''}`}>{formatCurrency(row[key])}</td>)}</tr>
    {(row.pending.length > 0 || row.difference !== 0) && <tr><td colSpan={6} className="px-3 pb-4">
      <details open={row.difference !== 0}><summary className="cursor-pointer text-primary-600 dark:text-primary-400">تفاصيل الفرق — {row.pending.length} سند</summary>
        {row.pending.map(payment => <div key={payment.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <a className="underline" href={paymentHref(payment)}>{formatDate(payment.paymentDate)} · {formatCurrency(payment.amount)}</a>
          <span>{payment.paymentMethod === 'bank_transfer' ? 'تحويل بنكي' : payment.paymentMethod === 'cash' ? 'نقد' : payment.paymentMethod === 'owner_current' ? 'وصلت لحساب هادي' : payment.paymentMethod || 'غير مسجل'} · {payment.reason}</span>
        </div>)}
        {Math.abs(row.difference - row.pending.reduce((sum, payment) => sum + payment.difference, 0)) >= 0.01 && <p className="text-amber-600">يوجد فرق إضافي يحتاج مراجعة حركات رأس المال في دفتر الأستاذ.</p>}
      </details></td></tr>}
  </>;
}
