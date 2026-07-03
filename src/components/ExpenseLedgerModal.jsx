import { useEffect, useRef, useState } from 'react';
import {
  X, Plus, Trash2, FileText, Wallet, Calendar, Tag, Loader2, Inbox,
  Link as LinkIcon, Percent, Upload,
} from 'lucide-react';
import {
  formatCurrency, formatDate, todayISO, extractVat, netOfVat,
} from '../data/initialData';
import { uploadInvoiceFile, isSupabaseConfigured } from '../lib/supabaseClient';

const EMPTY_FORM = {
  description: '', amount: '', spentDate: '', notes: '', invoiceUrl: '', isTaxInvoice: false,
};

// Cheap link detector — anything starting with http:// or https:// is
// rendered as a clickable anchor in the list. Anything else (the admin
// pasted a bare drive path, a vendor portal slug, etc.) is preserved
// verbatim but stays as plain text so we don't generate broken links.
function isSafeHttpUrl(value) {
  const s = String(value || '').trim();
  return /^https?:\/\//i.test(s);
}

/**
 * Generic per-item expense ledger modal — shared by the Startup Fees and
 * Annual Expenses pages (and any future expense surface that grows a
 * sub-ledger). The table-specific behavior lives in the entries hook the
 * PAGE owns; this component is pure UI over its output.
 *
 * Props:
 *   isOpen / onClose   — standard modal lifecycle
 *   title              — full header line, e.g. `سجل مصاريف: الدباب`
 *   plannedAmount      — the parent's planned figure for the summary strip
 *   plannedLabel       — label over that figure (default "المخطط";
 *                        annual passes "التكلفة السنوية")
 *   ledger             — { entries, loading, error, addEntry, deleteEntry }
 *                        from useStartupCostEntries / useAnnualExpenseEntries
 *   onDirty            — called after every successful add/delete so the
 *                        parent page can refetch its items (the hook has
 *                        already pushed the new SUM onto the parent row)
 *   migrationFile      — SQL filename shown in the self-diagnosing error
 *                        banner when the entries table doesn't exist yet
 */
export default function ExpenseLedgerModal({
  isOpen, onClose, title, plannedAmount = 0, plannedLabel = 'المخطط',
  ledger, onDirty, migrationFile, uploadFolder = 'misc',
}) {
  const { entries, loading, error, addEntry, deleteEntry } = ledger;

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Reset form on every open; seed today's date.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY_FORM, spentDate: todayISO() });
  }, [isOpen]);

  const fileInputRef = useRef(null);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const url = await uploadInvoiceFile(file, uploadFolder);
      // Drop the public URL straight into the invoice field — it then
      // flows through the entries list + VAT report as a normal link.
      setForm((prev) => ({ ...prev, invoiceUrl: url }));
    } catch (err) {
      setUploadError(err?.message || 'تعذّر رفع الملف.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (!isOpen) return null;

  const recordedTotal = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const planned       = plannedAmount || 0;
  const remaining     = Math.max(0, planned - recordedTotal);
  const overspent     = recordedTotal > planned && planned > 0;

  const trimmedDesc   = form.description.trim();
  const parsedAmount  = Math.max(0, parseFloat(form.amount) || 0);
  const isValid       = trimmedDesc.length > 0 && parsedAmount > 0 && Boolean(form.spentDate);

  function handleChange(e) {
    const { name, type, value, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await addEntry({
        description:  trimmedDesc,
        amount:       parsedAmount,
        spentDate:    form.spentDate,
        notes:        form.notes.trim(),
        invoiceUrl:   form.invoiceUrl.trim(),
        isTaxInvoice: form.isTaxInvoice,
      });
      setForm({ ...EMPTY_FORM, spentDate: todayISO() });
      onDirty?.(); // tell the parent page to refetch its items so totals update
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entry) {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`هل أنت متأكد من حذف "${entry.description}" من السجل؟`)
      : true;
    if (!confirmed) return;
    setDeletingId(entry.id);
    try {
      await deleteEntry(entry.id);
      onDirty?.();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 my-4 max-h-[92vh] overflow-y-auto border border-slate-100 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-xl flex items-center justify-center">
              <FileText size={18} />
            </span>
            <span className="min-w-0">
              <span className="block">{title}</span>
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                أضف المصاريف خطوة بخطوة — الإجمالي يحدّث "المبلغ الفعلي" تلقائياً
              </span>
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{plannedLabel}</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(planned)}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">المسجّل</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(recordedTotal)}
              </p>
            </div>
            <div className={`rounded-xl px-3 py-2.5 border ${
              overspent
                ? 'bg-red-50 dark:bg-red-500/15 border-red-200 dark:border-red-500/40'
                : remaining > 0
                  ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/40'
                  : 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/40'
            }`}>
              <p className={`text-[11px] leading-snug ${
                overspent
                  ? 'text-red-700 dark:text-red-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {overspent ? 'تجاوز' : 'المتبقي'}
              </p>
              <p className={`font-bold tabular-nums mt-0.5 ${
                overspent
                  ? 'text-red-700 dark:text-red-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {formatCurrency(overspent ? recordedTotal - planned : remaining)}
              </p>
            </div>
          </div>

          {/* Add form */}
          <form onSubmit={handleAdd} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              إضافة مصروف جديد
            </p>

            {/* Description + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
              <div className="relative">
                <Tag
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="مثال: شراء أثاث المطبخ"
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
              <div className="relative">
                <Calendar
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="date"
                  name="spentDate"
                  value={form.spentDate}
                  onChange={handleChange}
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
            </div>

            {/* Amount + Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <div className="relative">
                <Wallet
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="المبلغ (ر.س)"
                  min="0"
                  step="any"
                  required
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium tabular-nums bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
              <input
                type="text"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="ملاحظات اختيارية (رقم الفاتورة، الجهة...)"
                className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-medium bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
              />
            </div>

            {/* Invoice: paste a link OR upload a file. The upload lands in
                the 'invoices' bucket and its public URL fills the same
                field, so both paths flow identically downstream. */}
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <LinkIcon
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                />
                <input
                  type="url"
                  name="invoiceUrl"
                  value={form.invoiceUrl}
                  onChange={handleChange}
                  placeholder="رابط الفاتورة، أو ارفع ملفاً ←"
                  dir="ltr"
                  autoComplete="off"
                  className="w-full pr-9 pl-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 font-mono bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-colors"
                />
              </div>
              {isSupabaseConfigured && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="رفع صورة/PDF للفاتورة"
                    className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-700 dark:text-slate-200 px-3 rounded-xl text-xs font-semibold transition-colors shrink-0"
                  >
                    {uploading
                      ? <Loader2 size={15} className="animate-spin" />
                      : <Upload size={15} />}
                    رفع
                  </button>
                </>
              )}
            </div>
            {uploadError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed">{uploadError}</p>
            )}
            {form.invoiceUrl && !uploadError && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 leading-relaxed truncate" dir="ltr">
                ✓ {form.invoiceUrl}
              </p>
            )}

            {/* Tax-invoice toggle. When on, the amount above is treated
                as VAT-inclusive and the 15% portion is back-derived. */}
            <label
              htmlFor="ledgerIsTaxInvoice"
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                form.isTaxInvoice
                  ? 'border-emerald-300 dark:border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/15'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60'
              }`}
            >
              <input
                id="ledgerIsTaxInvoice"
                type="checkbox"
                name="isTaxInvoice"
                checked={form.isTaxInvoice}
                onChange={handleChange}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-400 accent-emerald-600"
              />
              <Percent size={14} className={form.isTaxInvoice ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'} />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                فاتورة ضريبية
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1">
                  (المبلغ شامل ضريبة القيمة المضافة 15%)
                </span>
              </span>
            </label>

            {/* Live VAT breakdown — only when taxable AND an amount is set. */}
            {form.isTaxInvoice && parsedAmount > 0 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-[12px]">
                <span className="text-emerald-800 dark:text-emerald-300">
                  الضريبة المتوقع استردادها:
                  <span className="font-bold tabular-nums mr-1">{formatCurrency(extractVat(parsedAmount))}</span>
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  صافي قيمة السلعة:
                  <span className="font-bold tabular-nums mr-1">{formatCurrency(netOfVat(parsedAmount))}</span>
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-600 dark:hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> جارٍ التسجيل...</>
              ) : (
                <><Plus size={16} /> إضافة المصروف</>
              )}
            </button>
          </form>

          {/* Entries list */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              المصاريف المسجّلة ({entries.length})
            </p>

            {error && (
              <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/30 rounded-lg px-3 py-2.5 mb-2 leading-relaxed">
                <p className="font-bold mb-1">تعذّر تحميل السجل.</p>
                {/* Surface the real Supabase error verbatim — most often
                    "relation ... does not exist" when the SQL migration
                    hasn't been run yet. Showing the message turns this
                    into a self-diagnosing screen instead of a black box. */}
                {error?.message && (
                  <p className="font-mono text-[11px] opacity-80 break-words" dir="ltr">
                    {error.message}
                  </p>
                )}
                {migrationFile && (
                  <p className="mt-1.5 text-[11px]">
                    إن لم تكن قد شغّلت ملف الـ migration{' '}
                    <code className="bg-red-100 dark:bg-red-500/25 px-1 rounded" dir="ltr">
                      {migrationFile}
                    </code>{' '}
                    في Supabase SQL Editor، شغّله ثم أعد فتح المودال.
                  </p>
                )}
              </div>
            )}

            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-500 dark:text-slate-400 text-xs gap-2">
                <Loader2 size={14} className="animate-spin" />
                جارٍ التحميل...
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                <Inbox size={26} className="text-slate-400 dark:text-slate-500 mb-2" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">لا توجد مصاريف مسجّلة بعد</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  استخدم النموذج أعلاه لتسجيل أول مصروف لهذا البند.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                {entries.map((e) => {
                  const busy = deletingId === e.id;
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                          {e.description}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={11} />
                            {formatDate(e.spentDate)}
                          </span>
                          {e.isTaxInvoice && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">·</span>
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                                <Percent size={11} />
                                ض.ق.م: {formatCurrency(extractVat(e.amount))}
                              </span>
                            </>
                          )}
                          {e.invoiceUrl && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">·</span>
                              {isSafeHttpUrl(e.invoiceUrl) ? (
                                <a
                                  href={e.invoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-400 hover:underline font-semibold"
                                  title={e.invoiceUrl}
                                >
                                  <LinkIcon size={11} />
                                  عرض الفاتورة
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={e.invoiceUrl}>
                                  <LinkIcon size={11} />
                                  {e.invoiceUrl}
                                </span>
                              )}
                            </>
                          )}
                          {e.notes && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">·</span>
                              <span className="truncate">{e.notes}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                        {formatCurrency(e.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(e)}
                        disabled={busy}
                        title="حذف هذا المصروف من السجل"
                        aria-label={`حذف ${e.description}`}
                        className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/15 disabled:opacity-60 transition-colors shrink-0"
                      >
                        {busy
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
