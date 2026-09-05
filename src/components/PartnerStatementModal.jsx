import ModalSurface from './ModalSurface';
import { useMemo } from 'react';
import { X, Printer, Wallet } from 'lucide-react';
import {
  formatCurrency, formatDate, formatNumber, PER_WORKER_FEE, BRAND,
} from '../data/initialData';
import { usePartnerPayments } from '../hooks/usePartnerPayments';

// Payment-method labels for the receipt lines (mirror the ledger page).
const METHOD_LABEL = {
  bank_transfer: 'تحويل بنكي',
  cash: 'نقدي',
  mada_pos: 'مدى / شبكة',
};

/**
 * One-page capital statement for a single partner — designed to be
 * printed or saved as PDF (browser print dialog → Save as PDF) and
 * handed to the partner. `@media print` in index.css hides the app
 * chrome so only the statement sheet prints.
 *
 * Capital math is the same rule used across the app:
 *   required  = workersCount × PER_WORKER_FEE
 *   paid      = SUM(partner_payments) for this partner — the receipts are
 *               the evidence, so the total always matches the lines shown
 *   remaining = max(0, required − paid)
 * If the partner has dated receipts in partner_payments they're listed;
 * otherwise the statement still shows the paid/remaining summary from
 * the cached figure (many partners were entered directly).
 */
export default function PartnerStatementModal({ isOpen, onClose, partner }) {
  const { payments } = usePartnerPayments();

  const rows = useMemo(
    () => (partner ? payments.filter((p) => p.partnerId === partner.id) : []),
    [payments, partner],
  );

  if (!isOpen || !partner) return null;

  const required  = (partner.workersCount || 0) * PER_WORKER_FEE;
  // Summed from the receipts listed below, so the statement's total and its
  // line items can never disagree — the cached aggregate could.
  const paid      = rows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, required - paid);
  const settled   = required > 0 && remaining === 0;
  const today     = formatDate(new Date().toISOString().slice(0, 10));

  return (
    <ModalSurface onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center print:static print:block">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm print:hidden" onClick={onClose} />

      <div
        id="partner-statement-sheet"
        className="relative bg-white dark:bg-slate-900 print:dark:bg-white rounded-card print:rounded-none w-full max-w-2xl mx-4 my-4 print:m-0 print:max-w-none max-h-[92vh] print:max-h-none overflow-y-auto border border-slate-100 dark:border-slate-800 print:border-0"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        {/* Toolbar — screen only */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 print:hidden">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">كشف حساب الشريك</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="sw-button sw-button--sm sw-button--primary"
            >
              <Printer size={14} />
              طباعة / حفظ PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
              aria-label="إغلاق"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Statement body */}
        <div className="p-6 sm:p-8 print:p-0 text-slate-900 dark:text-slate-100 print:text-black">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 pb-5 border-b-2 border-slate-100 dark:border-slate-800 print:border-slate-300">
            <div>
              <p className="text-xl font-extrabold">{BRAND.nameAr}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{BRAND.tagline}</p>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold">كشف حساب رأس المال</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">بتاريخ {today}</p>
            </div>
          </div>

          {/* Partner meta */}
          <div className="grid grid-cols-2 gap-4 mt-5 text-sm">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">الشريك</p>
              <p className="font-bold">{partner.partnerName}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">عدد العمالة</p>
              <p className="font-bold tabular-nums">{formatNumber(partner.workersCount || 0)}</p>
            </div>
          </div>

          {/* Capital summary */}
          <div className="mt-6 rounded-smallcard border border-slate-100 dark:border-slate-800 print:border-slate-300 divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-200 text-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-500 dark:text-slate-400">
                الرسوم المطلوبة
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1 tabular-nums">
                  ({formatNumber(partner.workersCount || 0)} × {formatCurrency(PER_WORKER_FEE)})
                </span>
              </span>
              <span className="font-bold tabular-nums">{formatCurrency(required)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-500 dark:text-slate-400">المُسدَّد</span>
              <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(paid)}</span>
            </div>
            <div className={`flex items-center justify-between px-4 py-3 ${settled ? 'bg-emerald-50 dark:bg-emerald-500/10 print:bg-emerald-50' : 'bg-amber-50 dark:bg-amber-500/10 print:bg-amber-50'}`}>
              <span className="font-bold">{settled ? 'الحالة' : 'المتبقّي'}</span>
              <span className={`font-extrabold tabular-nums ${settled ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {settled ? 'مسدَّد بالكامل ✓' : formatCurrency(remaining)}
              </span>
            </div>
          </div>

          {/* Receipts */}
          <div className="mt-6">
            <p className="text-sm font-bold mb-2 flex items-center gap-1.5">
              <Wallet size={14} className="text-slate-500 dark:text-slate-400" />
              سجل الدفعات
            </p>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic py-3">
                لا توجد دفعات مسجّلة بسندات مؤرخة. المبلغ المُسدَّد أعلاه مُدخل إجمالاً.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2 px-2">التاريخ</th>
                    <th className="py-2 px-2">الطريقة</th>
                    <th className="py-2 px-2">البيان</th>
                    <th className="py-2 px-2 text-left tabular-nums">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2 px-2 tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(r.paymentDate)}</td>
                      <td className="py-2 px-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{METHOD_LABEL[r.paymentMethod] || r.paymentMethod}</td>
                      <td className="py-2 px-2 text-slate-500 dark:text-slate-400">{r.notes || '—'}</td>
                      <td className="py-2 px-2 text-left tabular-nums font-bold">{formatCurrency(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="mt-8 text-[10px] text-slate-500 dark:text-slate-400 text-center print:mt-12">
            كشف آلي صادر من نظام {BRAND.nameAr} — {today}
          </p>
        </div>
      </div>
    </ModalSurface>
  );
}
