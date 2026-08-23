import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Plus, Trash2, FileText, Wallet, Calendar, Tag, Loader2, Inbox,
  Link as LinkIcon, Percent, Upload, Home, Wand2, Pencil, Check, RotateCcw, Send,
} from 'lucide-react';
import {
  formatCurrency, formatDate, formatNumber, todayISO, extractVat,
} from '../data/initialData';
import { uploadInvoiceFile, isFirebaseConfigured, describeBackendError } from '../lib/firebaseClient';
import { EmptyState } from './UI';
import DateField from './DateField';
import TaxInvoiceFields from './TaxInvoiceFields';
import PurchaseAmountBreakdown from './PurchaseAmountBreakdown';
import { blockingVatProblems } from '../lib/vatFields';
import {
  EMPTY_TAX_INVOICE_FIELDS, submitTaxInvoiceFields, readTaxInvoiceFields,
} from '../lib/taxInvoiceForm';
import { groupEntriesByUnit, unassignedCount } from '../lib/unitSuggest';
import AssignUnitsPanel from './AssignUnitsPanel';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import {
  fetchEntries, isLiveSourceEntry, postSource, reverseEntry,
} from '../lib/accounting/firestoreLedger';

const EMPTY_FORM = {
  description: '', amount: '', spentDate: '', notes: '', invoiceUrl: '', isTaxInvoice: false,
  unit: '',
  ...EMPTY_TAX_INVOICE_FIELDS,
};

/**
 * مصروفٌ مسجَّل ⇐ حالةُ النموذج.
 *
 * The edit form IS the add form: one set of fields, one validator, one VAT
 * block. A second «edit» form would be a second answer to «ما المصروف الصحيح؟»
 * and the two drift the first time one of them gains a field.
 */
function formFromEntry(e) {
  return {
    description:  e.description || '',
    amount:       String(e.amount ?? ''),
    spentDate:    e.spentDate || '',
    notes:        e.notes || '',
    invoiceUrl:   e.invoiceUrl || '',
    isTaxInvoice: e.isTaxInvoice === true,
    unit:         e.unit || '',
    ...readTaxInvoiceFields(e),
  };
}

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
 *   onDirty            — called after every successful add/delete so the
 *                        parent page can refetch its items (the hook has
 *                        already pushed the new SUM onto the parent row)
 *   migrationFile      — SQL filename shown in the self-diagnosing error
 *                        banner when the entries table doesn't exist yet
 */
// السكنات (أو أي تقسيم داخل البند) تُمرَّر اختياريةً — المكوّن مشترك مع
// المصاريف السنوية التي لا تقسيم لها، فغيابها لا يعرض شيئاً.
export default function ExpenseLedgerModal({
  isOpen, onClose, title, plannedAmount = 0, plannedLabel = 'المخطط',
  ledger, onDirty, migrationFile, uploadFolder = 'misc',
  units = null, onAssignUnits = null, sourceKind = null,
}) {
  const { entries, loading, error, addEntry, deleteEntry, updateEntry } = ledger;
  // المصاريف السنوية تشارك هذا المكوّن ولا تملك استدعاء تعديل — فغيابه
  // لا يعرض قلماً أصلاً، بدل زرٍّ يفشل.
  const canEdit = typeof updateEntry === 'function';
  // ── الهوية تُثبَّت، لا القيمة فقط ──
  // Rebuilt inline, this array was a NEW identity on every render — and it is
  // passed down to `AssignUnitsPanel`, whose `useMemo`/`useEffect` pair then
  // refired and overwrote the user's per-row corrections with the machine's
  // suggestions. Typing one character in the form above was enough to wipe a
  // review in progress. The names are what matter, so they key the memo.
  // JSON rather than a `join` separator: a separator is a character a housing
  // name is allowed to contain, and splitting on it would silently invent a
  // unit that does not exist.
  const unitKey = JSON.stringify(Array.isArray(units) ? units.filter(Boolean) : []);
  const unitList = useMemo(() => JSON.parse(unitKey), [unitKey]);
  const hasUnits = unitList.length > 0;
  const unitGroups = hasUnits ? groupEntriesByUnit(entries, unitList) : [];
  const pendingUnits = hasUnits ? unassignedCount(entries) : 0;

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [postingId, setPostingId] = useState(null);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseDate, setReverseDate] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const bookEntriesQ = useFirestoreQuery(fetchEntries, {
    enabled: Boolean(isOpen && sourceKind && isFirebaseConfigured),
    fallback: [],
  });
  // ── ما يرفضه الخادم يجب أن يُقرأ ──
  // `handleAdd` and `handleDelete` were `try`/`finally` with no `catch`, and
  // the app has no ErrorBoundary and no `unhandledrejection` listener. So a
  // refusal the server had already written in Arabic FOR THIS USER — «س ليس
  // من سكنات هذا البند» — died in the console: the spinner stopped, the form
  // stayed full, nothing was added, and nothing said why.
  const [actionError, setActionError] = useState('');

  // Reset form on every open; seed today's date.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY_FORM, spentDate: todayISO() });
    setActionError('');
    setEditingId(null);
    setReverseTarget(null);
    setReverseDate('');
    setReverseReason('');
  }, [isOpen]);

  const fileInputRef = useRef(null);
  const formRef = useRef(null);

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
  // ── أخطاء الضريبة تمنع الحفظ، لا تُعرَض فقط ──
  // Serves BOTH sub-ledgers — رسوم التأسيس and المصاريف السنوية — so the two
  // cannot end up with different ideas of what a valid VAT field is.
  const vatProblems   = form.isTaxInvoice
    ? blockingVatProblems(form, { amount: parsedAmount }) : [];
  const isValid       = trimmedDesc.length > 0 && parsedAmount > 0
    && Boolean(form.spentDate) && vatProblems.length === 0;

  function handleChange(e) {
    const { name, type, value, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  function startEdit(entry) {
    setForm(formFromEntry(entry));
    setEditingId(entry.id);
    setActionError('');
    // `?.` on the METHOD too — jsdom has no `scrollIntoView`, and neither do
    // some embedded webviews. Scrolling is a courtesy; throwing here would
    // abort the edit itself.
    formRef.current?.scrollIntoView?.({ block: 'nearest' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, spentDate: todayISO() });
    setActionError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const payload = {
        description:  trimmedDesc,
        amount:       parsedAmount,
        spentDate:    form.spentDate,
        notes:        form.notes.trim(),
        invoiceUrl:   form.invoiceUrl.trim(),
        isTaxInvoice: form.isTaxInvoice,
        // ── التقسيم يُرسَل فقط حين يوجد ──
        // The picker was shipped without this line, so choosing a housing
        // unit changed the screen and nothing else: the row saved as «غير
        // محدد» and nothing said so. Spread conditionally rather than always
        // — the annual ledger shares this component and has no divisions, and
        // a `unit: ''` on its payload would be a field the server never asked
        // for.
        ...(hasUnits ? { unit: form.unit } : {}),
        ...submitTaxInvoiceFields(form),
      };
      // ── نفس الحمولة للمسارين ──
      // The edit sends every field, not a diff: the server compares against
      // what it reads inside the transaction and acts on what actually moved.
      // A diff computed here would be computed against a row this screen may
      // have been holding for a while.
      if (editingId) await updateEntry(editingId, payload);
      else await addEntry(payload);
      setEditingId(null);
      setForm({ ...EMPTY_FORM, spentDate: todayISO() });
      onDirty?.(); // tell the parent page to refetch its items so totals update
    } catch (err) {
      // The form keeps its values — the user re-reads the message and fixes
      // the one field it names, rather than retyping an invoice.
      setActionError(describeBackendError(err) || err?.message
        || (editingId ? 'تعذّر حفظ التعديل.' : 'تعذّر تسجيل المصروف.'));
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
    setActionError('');
    try {
      await deleteEntry(entry.id);
      onDirty?.();
    } catch (err) {
      // A posted entry is refused deletion on purpose («لا يمكن حذف مصروف
      // مُرحَّل…»). That refusal is the answer to the user's question, so it
      // belongs on the screen, not in the console.
      setActionError(describeBackendError(err) || err?.message || 'تعذّر حذف المصروف.');
    } finally {
      setDeletingId(null);
    }
  }

  function liveEntryFor(sourceId) {
    return (bookEntriesQ.data || []).find((row) => (
      String(row.sourceId ?? '') === String(sourceId ?? '')
      && isLiveSourceEntry(row, sourceKind, 'expense')
    )) || null;
  }

  async function handlePost(entry) {
    if (!sourceKind || postingId) return;
    const confirmed = typeof window === 'undefined' || window.confirm(
      `ترحيل "${entry.description}" إلى دفتر الأستاذ؟`,
    );
    if (!confirmed) return;
    setPostingId(entry.id);
    setActionError('');
    try {
      await postSource(sourceKind, entry.id);
      await bookEntriesQ.refetch();
      onDirty?.();
    } catch (err) {
      setActionError(describeBackendError(err) || err?.message || 'تعذّر ترحيل المصروف.');
    } finally {
      setPostingId(null);
    }
  }

  function startReverse(entry, postedEntry) {
    setReverseTarget({ entry, postedEntry });
    setReverseDate(entry.spentDate || todayISO());
    setReverseReason(`تصحيح بيانات فاتورة المورد للمصروف: ${entry.description}`);
    setActionError('');
  }

  async function handleReverse() {
    if (!reverseTarget || !reverseDate || !reverseReason.trim() || postingId) return;
    setPostingId(reverseTarget.entry.id);
    setActionError('');
    try {
      await reverseEntry(reverseTarget.postedEntry.id, {
        entryDate: reverseDate,
        description: reverseReason.trim(),
      });
      await bookEntriesQ.refetch();
      setReverseTarget(null);
      setReverseDate('');
      setReverseReason('');
      onDirty?.();
    } catch (err) {
      setActionError(describeBackendError(err) || err?.message || 'تعذّر عكس القيد.');
    } finally {
      setPostingId(null);
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
          <form
            ref={formRef}
            onSubmit={handleAdd}
            className={`border rounded-smallcard p-4 space-y-3 ${
              editingId
                ? 'bg-amber-50/60 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/30'
                : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
            }`}
          >
            {/* ── النموذج يقول أي عملٍ هو ──
                نفس الحقول للإضافة والتعديل، فلولا هذا السطر واللون لَما عرف
                المستخدم أنه يعدّل صفاً قائماً بدل أن يضيف صفاً جديداً. */}
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {editingId ? 'تعديل مصروف مسجَّل' : 'إضافة مصروف جديد'}
              </p>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline decoration-dotted underline-offset-4"
                >
                  إلغاء التعديل
                </button>
              )}
            </div>
            {editingId && (
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                الاسم والملاحظات والفاتورة والتقسيم تُعدَّل دائماً — وتغيير الاسم يُحدِّث
                نصّ القيد في الدفاتر معه. أما المبلغ والتاريخ وبيانات الضريبة فلا تتغيّر
                بعد ترحيل المصروف؛ يُعكس القيد أولاً.
              </p>
            )}

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

            {/* ── التقسيم: أين يقع المصروف، قبل كم كلّف ──
                Its own full-width row. It first shipped as a third child of a
                two-column grid, which dropped it into a 180px cell under the
                amount with no label — present in the DOM and invisible in
                practice, which is exactly how it was reported. Classification
                is a decision about WHERE the expense lands, so it precedes the
                money; and it renders only when the item has divisions, leaving
                every other ledger (the annual one shares this component)
                byte-identical. */}
            {hasUnits && (
              <div className="relative">
                <Home
                  size={15}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none"
                />
                <select
                  id="ledgerUnit"
                  name="unit"
                  value={form.unit}
                  onChange={handleChange}
                  aria-label="التقسيم الذي يخصّه هذا المصروف"
                  className="w-full pr-9 pl-3 py-3 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
                >
                  <option value="">اختر التقسيم — يبقى «غير محدد» إن تركته</option>
                  {unitList.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}

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
            <PurchaseAmountBreakdown form={form} amount={parsedAmount} />

            {/* بيانات الفاتورة — required before the VAT report will
                deduct this purchase. */}
            {form.isTaxInvoice && (
              <TaxInvoiceFields
                form={form}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
                idPrefix="ledger"
                amount={parsedAmount}
                problems={vatProblems}
                spendDate={form.spentDate}
              />
            )}

            {actionError && (
              <p
                role="alert"
                className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-control px-3 py-2.5 leading-relaxed"
              >
                {actionError}
              </p>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="sw-button sw-button--sm sw-button--primary w-full"
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> {editingId ? 'جارٍ الحفظ...' : 'جارٍ التسجيل...'}</>
              ) : editingId ? (
                <><Check size={16} /> حفظ التعديل</>
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

            {reverseTarget && (
              <div className="mb-3 rounded-smallcard border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 space-y-3">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                  عكس قيد «{reverseTarget.entry.description}» قبل تعديل بياناته المالية
                </p>
                <DateField
                  name="reverseDate"
                  value={reverseDate}
                  onChange={(e) => setReverseDate(e.target.value)}
                  ariaLabel="تاريخ القيد العكسي"
                  required
                />
                <input
                  type="text"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  aria-label="سبب عكس القيد"
                  className="w-full px-3 py-2 rounded-control border border-amber-200 dark:border-amber-500/30 bg-white dark:bg-slate-900 text-sm"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={handleReverse}
                    disabled={!reverseDate || !reverseReason.trim() || Boolean(postingId)}
                    className="sw-button sw-button--sm sw-button--primary">
                    {postingId ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    تنفيذ العكس
                  </button>
                  <button type="button" onClick={() => setReverseTarget(null)}
                    disabled={Boolean(postingId)} className="sw-button sw-button--sm sw-button--secondary">
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* ── الشرائح ذهبت والرؤوس حلّت محلّها ──
                They showed the same per-division totals the group headers now
                carry. Two renderings of one number on one screen is an
                invitation for them to disagree one day. */}
            {hasUnits && (
              <div className="mb-3 space-y-2">
                {onAssignUnits && pendingUnits > 0 && !assignOpen && (
                  <button
                    type="button"
                    onClick={() => setAssignOpen(true)}
                    className="sw-button sw-button--sm sw-button--secondary"
                  >
                    <Wand2 size={15} />
                    اقتراح توزيع {formatNumber(pendingUnits)} مصروفاً على السكنات
                  </button>
                )}
                {onAssignUnits && assignOpen && (
                  <AssignUnitsPanel
                    entries={entries}
                    units={unitList}
                    onApply={async (assignments) => { await onAssignUnits(assignments); onDirty?.(); }}
                    onClose={() => setAssignOpen(false)}
                  />
                )}
              </div>
            )}

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
                {/* ── القائمة أقسامٌ لا صفوفٌ مسطّحة ──
                    `unitGroups` was already computed for the chips; the rows
                    stayed flat, so the divisions were a summary above a list
                    that ignored them. Now each division is a section with its
                    own total, «غير محدد» last, and a division with no spend
                    still shows its header at zero — the list describes what
                    exists, not only what has been paid for. */}
                {(hasUnits ? unitGroups : [{ key: '__all__', items: entries }]).map((g) => (
                  <Fragment key={g.key}>
                    {hasUnits && (
                      <li className="flex items-baseline justify-between gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300 truncate">
                          {g.label}
                          <span className="mr-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            ({formatNumber(g.items.length)})
                          </span>
                        </span>
                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300 tabular-nums shrink-0">
                          {formatCurrency(g.total)}
                        </span>
                      </li>
                    )}
                    {g.items.map((e) => {
                      const busy = deletingId === e.id;
                      const postedEntry = sourceKind ? liveEntryFor(e.id) : null;
                      const accountingBusy = postingId === e.id;
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
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => startEdit(e)}
                              disabled={busy}
                              title="تعديل هذا المصروف"
                              aria-label={`تعديل ${e.description}`}
                              className={`sw-tap inline-flex items-center justify-center p-1.5 rounded-control transition-colors shrink-0 disabled:opacity-60 ${
                                editingId === e.id
                                  ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15'
                                  : 'text-slate-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/15'
                              }`}
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {sourceKind && (postedEntry ? (
                            <button
                              type="button"
                              onClick={() => startReverse(e, postedEntry)}
                              disabled={busy || accountingBusy}
                              title={`عكس القيد رقم ${postedEntry.entryNumber ?? '—'}`}
                              aria-label={`عكس قيد ${e.description}`}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/15 disabled:opacity-60 transition-colors shrink-0"
                            >
                              {accountingBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePost(e)}
                              disabled={busy || accountingBusy || bookEntriesQ.loading}
                              title="ترحيل هذا المصروف إلى دفتر الأستاذ"
                              aria-label={`ترحيل ${e.description}`}
                              className="sw-tap inline-flex items-center justify-center p-1.5 rounded-control text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 disabled:opacity-60 transition-colors shrink-0"
                            >
                              {accountingBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                          ))}
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
                  </Fragment>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
