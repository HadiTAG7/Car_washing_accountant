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
 * `spendDate` is the record's own spend date. It is NOT a substitute for the
 * invoice date — a purchase paid in April against a March invoice is deducted
 * in March — so it is offered only as a one-click fill the user chooses,
 * never as a silent fallback.
 */
export default function TaxInvoiceFields({
  form, onChange, idPrefix = 'inv', amount = 0, spendDate = '',
}) {
  const check = inputInvoiceEligibility({
    isTaxInvoice: true,
    amount,
    invoiceNumber: form.invoiceNumber,
    invoiceDate: form.invoiceDate,
    supplier: form.supplier,
    vatDeductible: form.vatDeductible,
  });

  const set = (patch) => onChange({ ...form, ...patch });

  // The stated amount cannot exceed the invoice it sits on — a VAT of 200 on a
  // 115 purchase is a typo, and letting it through would reclaim money the
  // document does not support.
  const statedVat = form.vatAmount === '' || form.vatAmount === null || form.vatAmount === undefined
    ? null : Number(form.vatAmount);
  let vatProblem = '';
  if (statedVat !== null && (!Number.isFinite(statedVat) || statedVat < 0)) {
    vatProblem = 'مبلغ الضريبة يجب أن يكون رقماً موجباً.';
  } else if (statedVat !== null && (form.priceMode || 'inclusive') === 'inclusive'
    && Number(amount) > 0 && statedVat > Number(amount) + 0.005) {
    vatProblem = `مبلغ الضريبة أكبر من إجمالي الفاتورة (${Number(amount).toFixed(2)}).`;
  }

  // Which of the three sources will actually be used, said out loud so the
  // deduction is never a mystery.
  const taxSourceLabel = statedVat !== null && !vatProblem
    ? 'مبلغ مكتوب على الفاتورة'
    : (form.vatRate !== null && form.vatRate !== undefined && form.vatRate !== ''
      ? 'نسبة مثبتة على الفاتورة'
      : 'سياسة تاريخ الفاتورة');

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
          {spendDate && spendDate !== form.invoiceDate && (
            <button type="button" onClick={() => set({ invoiceDate: spendDate })}
              className="mt-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:underline">
              نفس تاريخ الصرف ({spendDate})
            </button>
          )}
        </div>
      </div>

      {/* ── مبلغ الضريبة كما كتبه المورّد ─────────────────────────────
          The deduction rests on the paper, and the paper states its own VAT.
          Without this the report had to derive the tax from a rate — and the
          only rate it had was TODAY's, so a 5%-era invoice was reclaimed at
          15% the moment the standard rate moved. The rate below is the
          fallback for a document whose amount is not itemised; it is the
          invoice's own rate, not the current one. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor={`${idPrefix}-vat-amount`}>
            مبلغ الضريبة على الفاتورة
          </label>
          <input id={`${idPrefix}-vat-amount`} type="number" min="0" step="0.01" dir="ltr"
            value={form.vatAmount ?? ''}
            onChange={(e) => set({ vatAmount: e.target.value === '' ? null : e.target.value })}
            placeholder="اتركه فارغاً إن لم يكن مذكوراً"
            className={`${INPUT_CLS} tabular-nums`} />
          {vatProblem && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{vatProblem}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor={`${idPrefix}-vat-rate`}>
            نسبة الفاتورة
          </label>
          <select id={`${idPrefix}-vat-rate`}
            value={form.vatRate === null || form.vatRate === undefined ? '' : String(form.vatRate)}
            onChange={(e) => set({ vatRate: e.target.value === '' ? null : Number(e.target.value) })}
            className={INPUT_CLS}>
            <option value="">حسب سياسة تاريخ الفاتورة</option>
            <option value="0.15">15%</option>
            <option value="0.05">5%</option>
            <option value="0">معفاة / صفرية</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
            htmlFor={`${idPrefix}-price-mode`}>
            المبلغ المسجَّل
          </label>
          <select id={`${idPrefix}-price-mode`} value={form.priceMode || 'inclusive'}
            onChange={(e) => set({ priceMode: e.target.value })}
            className={INPUT_CLS}>
            <option value="inclusive">شامل الضريبة</option>
            <option value="exclusive">غير شامل الضريبة</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        المصدر المُعتمد للخصم: <span className="font-semibold">{taxSourceLabel}</span>.
        المبلغ المكتوب على الفاتورة يسبق النسبة، والنسبة المثبتة تسبق سياسة تاريخها.
      </p>

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
            {' '}الخصم يحتاج فاتورة ضريبية فعلية، وتاريخ الفاتورة هو ما يحدّد
            فترة الخصم — لا تاريخ الصرف.
          </span>
        </p>
      )}
    </div>
  );
}
