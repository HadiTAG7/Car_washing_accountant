import { useEffect, useState } from 'react';
import { X, Receipt, Loader2 } from 'lucide-react';
import TaxInvoiceFields from './TaxInvoiceFields';
import { blockingVatProblems } from '../lib/vatFields';
import {
  EMPTY_TAX_INVOICE_FIELDS, readTaxInvoiceFields, submitTaxInvoiceFields,
} from '../lib/taxInvoiceForm';
import { formatCurrency, formatDate } from '../data/initialData';

/**
 * تسجيل فاتورة المورّد على سند دوري.
 *
 * A voucher is created on the due date; the supplier's invoice arrives later.
 * Until its number and date are recorded the voucher has no deductible input
 * tax — the ledger withholds the 1200 line and the VAT report lists it as
 * غير مؤهلة. Both refusals are the same rule, and this is the door that
 * satisfies it.
 *
 * Without this the monthly rent — the largest recurring input tax most of
 * these businesses have — could never be reclaimed at all: the template has
 * no per-period invoice to copy, so nothing else could ever supply one.
 *
 * The same `blockingVatProblems` gate as every expense form, and the data
 * layer runs it again in `setVoucherInvoice` — because a form is a
 * convenience, not a boundary.
 */
export default function VoucherInvoiceModal({ voucher, onClose, onSave }) {
  const [form, setForm] = useState({ ...EMPTY_TAX_INVOICE_FIELDS, isTaxInvoice: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!voucher) return;
    setError('');
    setForm({
      ...EMPTY_TAX_INVOICE_FIELDS,
      ...readTaxInvoiceFields(voucher),
      isTaxInvoice: true,
      // The due date is a sensible first guess for the invoice date and
      // nothing more — a supplier dates the paper, not the calendar.
      invoiceDate: voucher.invoiceDate || '',
    });
  }, [voucher]);

  if (!voucher) return null;

  const amount = Number(voucher.amount) || 0;
  const problems = blockingVatProblems({ ...form, isTaxInvoice: true }, { amount });
  const isValid = problems.length === 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(voucher.id, submitTaxInvoiceFields(form));
      onClose();
    } catch (err) {
      setError(err?.message || 'تعذّر حفظ بيانات الفاتورة.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl rounded-t-card sm:rounded-card max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Receipt size={18} />فاتورة السند
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {voucher.templateName || 'مصروف شهري'} — {voucher.periodKey}
              {' · '}استحقاق {formatDate(voucher.dueDate)}
              {' · '}{formatCurrency(amount)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="p-2 -m-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-control px-4 py-3">
            حتى تُسجَّل هذه البيانات لا تُخصم ضريبة هذا السند: الدفاتر لا تفتح
            له حساب ضريبة مدخلات، والتقرير يدرجه غير مؤهل — وهما القاعدة
            نفسها. المبلغ المسجَّل {voucher.priceMode === 'exclusive'
              ? 'صافٍ، والضريبة تُضاف فوقه' : 'شامل الضريبة'}.
          </p>

          <TaxInvoiceFields
            form={form} onChange={setForm} idPrefix="voucher"
            amount={amount} spendDate={voucher.dueDate} problems={problems} />

          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={!isValid || saving}
              className="flex-1 min-h-touch px-4 rounded-control bg-primary-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
              {saving ? 'جارٍ الحفظ...' : 'حفظ بيانات الفاتورة'}
            </button>
            <button type="button" onClick={onClose}
              className="min-h-touch px-5 rounded-control border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
