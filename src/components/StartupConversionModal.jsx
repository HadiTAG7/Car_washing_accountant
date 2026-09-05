import ModalSurface from './ModalSurface';
import { useEffect, useState } from 'react';
import { X, ArrowLeftRight, Loader2, AlertTriangle } from 'lucide-react';
import DateField from './DateField';
import TaxInvoiceFields from './TaxInvoiceFields';
import PurchaseAmountBreakdown from './PurchaseAmountBreakdown';
import { blockingVatProblems } from '../lib/vatFields';
import { EMPTY_TAX_INVOICE_FIELDS, submitTaxInvoiceFields } from '../lib/taxInvoiceForm';
import { startupConversionProblems } from '../lib/accounting/startupMigration';
import { formatCurrency } from '../data/initialData';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../lib/accounting/postingRules';

const INPUT_CLS = 'w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 '
  + 'dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 '
  + 'focus:outline-none focus:border-primary-500 transition-colors';

/**
 * تحويل مبلغ فعلي مسجَّل على بند التأسيس إلى قيد في سجل مصاريفه.
 *
 * `startup_costs` grew an `actual_amount` column and a tax-invoice flag, and
 * the VAT report read both — but nothing could ever post them: the posting
 * adapter reads `startup_cost_entries`, and there is deliberately no adapter
 * for the parent, because a parent-level figure has no spend date, no payment
 * method and no invoice identity. The row entered the return and could never
 * reach `1200`, so `inputMismatch` for that item stayed open forever. It was
 * also dated by `created_at` — the day the row was TYPED, which is not the day
 * the money moved and not the day the invoice was raised.
 *
 * This asks for exactly the three facts the record does not contain. Nothing
 * is defaulted from `created_at`, and the entry's id is derived from the
 * parent, so converting twice writes the same document rather than a second.
 */
export default function StartupConversionModal({ item, onClose, onConvert }) {
  const [form, setForm] = useState({
    spentDate: '', paymentMethod: 'cash', description: '',
    isTaxInvoice: false, invoiceUrl: '', ...EMPTY_TAX_INVOICE_FIELDS,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item) return;
    setError('');
    setForm({
      // Deliberately empty: the spend date is a fact only the user has, and
      // seeding it with today's date or `created_at` would file the claim in
      // whichever quarter the form happened to be opened in.
      spentDate: '',
      paymentMethod: 'cash',
      description: item.itemName || '',
      isTaxInvoice: Boolean(item.isTaxInvoice),
      invoiceUrl: item.invoiceUrl || '',
      ...EMPTY_TAX_INVOICE_FIELDS,
      supplier: item.supplier || '',
      invoiceNumber: item.invoiceNumber || '',
      invoiceDate: item.invoiceDate || '',
      vatAmount: item.vatAmount ?? null,
      vatRate: item.vatRate ?? null,
      priceMode: item.priceMode || 'inclusive',
      vatDeductible: item.vatDeductible !== false,
    });
  }, [item]);

  if (!item) return null;

  const amount = Number(item.actualAmount) || 0;
  const vatProblems = form.isTaxInvoice ? blockingVatProblems(form, { amount }) : [];
  // The period check runs on the server side of the conversion too; here it
  // is only for a live message, so `closedPeriods` is left out.
  const problems = startupConversionProblems({ ...item, actualAmount: amount }, form);
  const isValid = problems.length === 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConvert(item.id, {
        spentDate: form.spentDate,
        paymentMethod: form.paymentMethod,
        description: form.description,
        isTaxInvoice: form.isTaxInvoice,
        invoiceUrl: form.invoiceUrl,
        ...submitTaxInvoiceFields(form),
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'تعذّر التحويل.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalSurface onClose={onClose} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl rounded-t-card sm:rounded-card max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ArrowLeftRight size={18} />تحويل مبلغ البند إلى قيد
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {item.itemName} — {formatCurrency(amount)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="p-2 -m-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-control px-4 py-3">
            هذا المبلغ مسجَّل على البند مباشرةً، فلا تاريخ صرف له ولا طريقة دفع
            ولا فاتورة — ولا يمكن ترحيله إلى الدفاتر ولا خصم ضريبته بدونها.
            أدخلها هنا ليصير قيداً في سجل مصاريف البند، ويُرحَّل كأي مصروف آخر.
            <span className="block mt-1 opacity-90">
              لا يُستعمل تاريخ إنشاء السجل بديلاً عن أيٍّ منها.
            </span>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                تاريخ الصرف / السداد
              </label>
              <DateField name="conv-spent-date" value={form.spentDate}
                onChange={(e) => setForm((f) => ({ ...f, spentDate: e.target.value }))}
                ariaLabel="تاريخ الصرف" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                htmlFor="conv-method">طريقة الدفع</label>
              <select id="conv-method" value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                className={INPUT_CLS}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              htmlFor="conv-description">الوصف</label>
            <input id="conv-description" type="text" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={INPUT_CLS} />
          </div>

          <label className="flex items-center gap-2.5 min-h-touch cursor-pointer select-none">
            <input type="checkbox" checked={form.isTaxInvoice}
              onChange={(e) => setForm((f) => ({ ...f, isTaxInvoice: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-emerald-600" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">فاتورة ضريبية</span>
          </label>

          {form.isTaxInvoice && (
            <>
              <PurchaseAmountBreakdown form={form} amount={amount} />
              <TaxInvoiceFields
                form={form} onChange={setForm} idPrefix="conv"
                amount={amount} spendDate={form.spentDate} problems={vatProblems} />
            </>
          )}

          {problems.length > 0 && (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{problems[0]}</span>
            </p>
          )}
          {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={!isValid || saving}
              className="flex-1 min-h-touch px-4 rounded-control bg-primary-600 text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
              {saving ? 'جارٍ التحويل...' : 'تحويل إلى قيد'}
            </button>
            <button type="button" onClick={onClose}
              className="min-h-touch px-5 rounded-control border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </ModalSurface>
  );
}
