import { FileText, User, Hash, AlertTriangle } from 'lucide-react';
import DateField from './DateField';
import { inputInvoiceEligibility } from '../lib/accounting/vatReturn';

const INPUT_CLS = 'w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 '
  + 'dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 '
  + 'focus:outline-none focus:border-primary-500 transition-colors';

/**
 * بيانات الفاتورة الضريبية — supplier, invoice number, invoice date.
 *
 * These are not decoration: input VAT may only be deducted against a real
 * tax invoice, so the report checks exactly these fields. The panel tells
 * the user live whether this record will be deductible and what is still
 * missing, rather than letting them discover it as a silent absence from
 * the return three months later.
 *
 * `fallbackDate` is the record's own spend date — a purchase logged on the
 * day it happened is already dated, so the invoice-date field is optional
 * when that exists.
 */
export default function TaxInvoiceFields({
  form, onChange, idPrefix = 'inv', amount = 0, fallbackDate = '',
}) {
  const check = inputInvoiceEligibility({
    isTaxInvoice: true,
    amount,
    invoiceNumber: form.invoiceNumber,
    invoiceDate: form.invoiceDate,
    spentDate: fallbackDate,
    supplier: form.supplier,
    vatDeductible: form.vatDeductible,
  });

  const set = (patch) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor={`${idPrefix}-supplier`}>
            <User size={12} className="inline ml-1" />المورّد
          </label>
          <input id={`${idPrefix}-supplier`} type="text" value={form.supplier}
            onChange={(e) => set({ supplier: e.target.value })}
            placeholder="اسم المنشأة الموردة" className={INPUT_CLS} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor={`${idPrefix}-number`}>
            <Hash size={12} className="inline ml-1" />رقم الفاتورة
          </label>
          <input id={`${idPrefix}-number`} type="text" dir="ltr" value={form.invoiceNumber}
            onChange={(e) => set({ invoiceNumber: e.target.value })}
            placeholder="INV-000123" className={`${INPUT_CLS} tabular-nums`} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            <FileText size={12} className="inline ml-1" />تاريخ الفاتورة
          </label>
          <DateField name={`${idPrefix}-date`} value={form.invoiceDate}
            onChange={(e) => set({ invoiceDate: e.target.value })}
            ariaLabel="تاريخ الفاتورة" />
        </div>
      </div>

      <label className="flex items-center gap-2.5 min-h-touch cursor-pointer select-none">
        <input type="checkbox" checked={form.vatDeductible !== false}
          onChange={(e) => set({ vatDeductible: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-emerald-600" />
        <span className="text-sm text-slate-700 dark:text-slate-300">
          الضريبة قابلة للخصم
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">
            (ألغِ التحديد للمصروفات غير المؤهلة — الضيافة والسيارات الشخصية ونحوها)
          </span>
        </span>
      </label>

      {check.eligible ? (
        <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
          مؤهلة للخصم — ستُحتسب ضريبتها في تقرير ضريبة القيمة المضافة.
        </p>
      ) : (
        <p role="status" className="flex items-start gap-1.5 text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            لن تُخصم ضريبتها حتى تكتمل: <strong>{check.missing.join(' · ')}</strong>.
            {' '}الخصم يحتاج فاتورة ضريبية فعلية.
          </span>
        </p>
      )}
    </div>
  );
}
