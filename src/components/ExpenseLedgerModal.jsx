import { useEffect, useRef, useState } from 'react';
import {
  X, Plus, Trash2, FileText, Wallet, Calendar, Tag, Loader2, Inbox,
  Link as LinkIcon, Percent, Upload,
} from 'lucide-react';
import {
  formatCurrency, formatDate, todayISO, extractVat, netOfVat,
} from '../data/initialData';
import { uploadInvoiceFile, isFirebaseConfigured } from '../lib/firebaseClient';
import { EmptyState } from './UI';
import DateField from './DateField';

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

      <div
        className="relative bg-white dark:bg-slate-900 rounded-card border border-slate-100 dark:border-slate-800 w-full max-w-2xl mx-4 my-4 max-h-[92vh] overflow-y-auto"
        style={{ boxShadow: 'var(--sw-shadow-overlay)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 w-9 h-9 rounded-control flex items-center justify-center shrink-0">
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
            className="sw-tap flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-control hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{plannedLabel}</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(planned)}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard px-3 py-2.5">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">المسجّل</p>
              <p className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {formatCurrency(recordedTotal)}
              </p>
            </div>
            <div className={`rounded-smallcard px-3 py-2.5 border ${
              overspent
                ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/30'
                : remaining > 0
                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/30'
                  : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/30'
            }`}>
              <p className={`text-[11px] leading-snug ${
                overspent
                  ? 'text-rose-700 dark:text-rose-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {overspent ? 'تجاوز' : 'المتبقي'}
              </p>
              <p className={`font-bold tabular-nums mt-0.5 ${
                overspent
                  ? 'text-rose-700 dark:text-rose-300'
                  : remaining > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300'
              }`}>
                {formatCurrency(overspent ? recordedTotal - planned : remaining)}
              </p>
            </div>
          </div>

          {/* Add form */}
          <form onSubmit={handleAdd} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              إضافة مصروف جديد
            </p>

            {/* Description + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
              <div className="relative">
                <Tag
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="مثال: شراء أثاث المطبخ"
                  required
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              <div className="relative">
                <Calendar
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <DateField
              name="spentDate"
              value={form.spentDate}
              onChange={handleChange}
              required
            />
              </div>
            </div>

            {/* Amount + Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
              <div className="relative">
                <Wallet
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
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
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              <input
                type="text"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="ملاحظات اختيارية (رقم الفاتورة، الجهة...)"
                className="w-full px-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>

            {/* Invoice: paste a link OR upload a file. The upload lands in
                the 'invoices' bucket and its public URL fills the same
                field, so both paths flow identically downstream. */}
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <LinkIcon
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <input
                  type="url"
                  name="invoiceUrl"
                  value={form.invoiceUrl}
                  onChange={handleChange}
                  placeholder="رابط الفاتورة، أو ارفع ملفاً ←"
                  dir="ltr"
                  autoComplete="off"
                  className="w-full pr-9 pl-4 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              {isFirebaseConfigured && (
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
                    className="sw-button sw-button--sm sw-button--secondary shrink-0"
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
              <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed" role="alert">{uploadError}</p>
            )}
            {form.invoiceUrl && !uploadError && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed truncate" dir="ltr" role="status">
                ✓ {form.invoiceUrl}
              </p>
            )}

            {/* Tax-invoice toggle. When on, the amount above is treated
                as VAT-inclusive and the 15% portion is back-derived. */}
            <label
              htmlFor="ledgerIsTaxInvoice"
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-control border cursor-pointer transition-colors ${
                form.isTaxInvoice
                  ? 'border-emerald-100 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <input
                id="ledgerIsTaxInvoice"
                type="checkbox"
                name="isTaxInvoice"
                checked={form.isTaxInvoice}
                onChange={handleChange}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-emerald-600"
              />
              <Percent size={14} className={form.isTaxInvoice ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'} />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                فاتورة ضريبية
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mr-1">
                  (المبلغ شامل ضريبة القيمة المضافة 15%)
                </span>
              </span>
            </label>

            {/* Live VAT breakdown — only when taxable AND an amount is set. */}
            {form.isTaxInvoice && parsedAmount > 0 && (
              <div
                role="status"
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-control bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/30 text-[12px]"
              >
                <span className="text-emerald-700 dark:text-emerald-300">
                  الضريبة المتوقع استردادها:
                  <span className="font-bold tabular-nums mr-1">{formatCurrency(extractVat(parsedAmount))}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  صافي قيمة السلعة:
                  <span className="font-bold tabular-nums mr-1">{formatCurrency(netOfVat(parsedAmount))}</span>
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary w-full"
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
              <div
                role="alert"
                className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 mb-2 leading-relaxed"
              >
                <p className="font-bold mb-1">تعذّر تحميل السجل.</p>
                {/* Surface the real Firestore error verbatim — most often
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
                    <code className="bg-rose-100 dark:bg-rose-500/20 px-1 rounded-control" dir="ltr">
                      {migrationFile}
                    </code>{' '}
                    — لم يعد مطلوباً على Firestore؛ تحقّق من صلاحيات حسابك ثم أعد فتح المودال.
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
              <div className="border border-slate-100 dark:border-slate-800 rounded-smallcard">
                <EmptyState
                  icon={Inbox}
                  title="لا توجد مصاريف مسجّلة بعد"
                  hint="استخدم النموذج أعلاه لتسجيل أول مصروف لهذا البند."
                  compact
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-smallcard overflow-hidden">
                {entries.map((e) => {
                  const busy = deletingId === e.id;
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
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
                                  className="inline-flex items-center gap-1 text-primary-700 dark:text-primary-300 hover:underline font-semibold"
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
                        className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 disabled:opacity-60 transition-colors shrink-0"
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
