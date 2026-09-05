import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { useCallback, useMemo, useState } from 'react';
import {
  FileText, Plus, Trash2, Download, Loader2, Save, ShieldAlert,
  AlertTriangle, CheckCircle2, Ban, CornerUpLeft, CornerUpRight, RotateCcw,
  QrCode as QrIcon,
} from 'lucide-react';
import { formatCurrency, formatCurrencyPrecise } from '../data/initialData';
import { downloadCsv } from '../lib/exportCsv';
import TopBar from './TopBar';
import { Card, SectionHeader, StatCard, EmptyState, PrimaryButton, SecondaryButton } from './UI';
import DateField from './DateField';
import LoadingState from './LoadingState';
import ErrorState, { SetupRequiredCard } from './ErrorState';
import Toast from './Toast';
import QrCode from './QrCode';
import VoidDocumentModal from './VoidDocumentModal';
import { useSalesDocuments } from '../hooks/useSalesDocuments';
import { useAuth } from '../hooks/useAuth';
import { useWashes } from '../hooks/useWashes';
import { useLedger } from '../hooks/useLedger';
import { hasPostedEntryFor } from '../lib/accounting/firestoreLedger';
import {
  issueSimplifiedInvoice, issueInvoiceForWash, issueCreditNoteFor, issueDebitNoteFor,
  voidDocument, correctWashInvoice, saveSellerProfile,
} from '../lib/accounting/firestoreInvoicing';
import {
  DOCUMENT_TYPE_LABELS, invoiceTotals, decodeZatcaQrPayload, documentSign,
} from '../lib/accounting/invoicing';
import { integrationSummary } from '../lib/accounting/zatcaIntegration';
import { isFirebaseConfigured, missingEnvNames, describeBackendError } from '../lib/firebaseClient';
import { usePartnerView } from '../contexts/PartnerViewContext';

const todayIso = () => new Date().toISOString().slice(0, 10);
const nowTime  = () => new Date().toTimeString().slice(0, 8);
const emptyLine = () => ({ description: '', quantity: 1, unitPrice: '' });

const TYPE_TONE = {
  invoice:     'bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-100 dark:border-primary-500/30',
  credit_note: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/30',
  debit_note:  'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-500/30',
};

/**
 * المستندات الضريبية — issuing simplified (B2C) invoices and the credit/debit
 * notes that correct them.
 *
 * Two things this page is deliberate about:
 *   • It never claims compliance. The banner states exactly what is and is not
 *     connected, because a QR code on a page is easy to mistake for an
 *     e-invoicing integration, and it is not one.
 *   • It never offers "delete". An issued number is spoken for; the corrective
 *     instruments are a credit note (reduce) and a debit note (increase), and
 *     voiding records the reason without reusing the number.
 */
export default function SalesDocumentsPage() {
  const { documents, seller, totals, gaps, integrityProblems, loading, error, refetch } = useSalesDocuments();
  const { user } = useAuth();
  const { canMutate } = usePartnerView();
  const { items: washes, refetch: refetchWashes } = useWashes();
  const { entries, refetch: refetchLedger } = useLedger();
  const status = useMemo(() => integrationSummary(), []);

  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success', duration: 3000 });
  const [expanded, setExpanded] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [correcting, setCorrecting] = useState(null);
  // The wash panel's own issue date — the paper's date, not the service's.
  const [washIssueDate, setWashIssueDate] = useState(todayIso());

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    issueDate: todayIso(), customer: '', priceMode: 'inclusive',
    // A standalone invoice CREATES the sale in the books, so the settlement is
    // an answer the page has to collect. There is no honest default for "which
    // drawer did this money go into", only a common one.
    paymentMethod: 'cash', paymentStatus: 'paid',
    lines: [emptyLine()],
  });

  // ── الغسلات المُرحّلة التي لم تُفوتَر بعد ──
  // Two separate facts: the wash is in the books (it has a live posted entry),
  // and no document has been issued against it yet. Both are read here rather
  // than trusted, and the server checks them again on issue — this list only
  // decides what to OFFER.
  const invoicedWashIds = useMemo(
    () => new Set(documents.filter((d) => d.washId).map((d) => String(d.washId))),
    [documents],
  );
  const invoiceableWashes = useMemo(
    () => washes
      .filter((w) => w.status === 'مكتملة'
        && !invoicedWashIds.has(String(w.id))
        && hasPostedEntryFor(entries, 'wash', w.id, 'wash'))
      .sort((a, b) => String(b.washDate).localeCompare(String(a.washDate)))
      .slice(0, 25),
    [washes, entries, invoicedWashIds],
  );

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ open: true, message, tone, duration: tone === 'error' ? 8000 : 3000 });
  }, []);
  const closeToast = useCallback(() => setToast((t) => ({ ...t, open: false })), []);

  // The seller card edits a local copy so a half-typed VAT number is never saved.
  const { policyAt, loading: policyLoading, error: policyError, baselineFrom, policyConfigured } = useAccountingSettings();
  const ledgerPolicy = policyAt(todayIso());
  const registrationConflict = !policyLoading && !policyError && policyConfigured && ledgerPolicy.known && seller && Boolean(seller.vatRegistered) !== Boolean(ledgerPolicy.vatRegistered);
  const sellerDraft = profile ?? seller ?? { name: '', vatNumber: '', address: '', vatRegistered: false };
  const patchSeller = (patch) => setProfile({ ...sellerDraft, ...patch });

  const preview = useMemo(() => invoiceTotals(
    form.lines.filter((l) => Number(l.unitPrice) > 0),
    { priceMode: form.priceMode, taxable: Boolean(seller?.vatRegistered) },
  ), [form.lines, form.priceMode, seller]);

  function patchLine(i, patch) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  }

  async function handleSaveSeller() {
    setBusy('seller');
    try {
      await saveSellerProfile(sellerDraft, { userId: user?.id });
      setProfile(null);
      showToast('تم حفظ بيانات المنشأة.');
      await refetch();
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الحفظ', 'error');
    } finally { setBusy(''); }
  }

  async function handleIssue() {
    const lines = form.lines.filter((l) => Number(l.unitPrice) > 0 && Number(l.quantity) > 0);
    if (lines.length === 0) { showToast('أضف سطراً واحداً على الأقل بسعر أكبر من صفر.', 'error'); return; }
    setBusy('issue');
    try {
      const res = await issueSimplifiedInvoice({
        issueDate: form.issueDate,
        issueTime: nowTime(),
        priceMode: form.priceMode,
        paymentMethod: form.paymentMethod,
        paymentStatus: form.paymentStatus,
        customer: form.customer.trim() ? { name: form.customer.trim() } : null,
        lines: lines.map((l) => ({
          description: l.description.trim() || 'خدمة غسيل',
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
        })),
      }, { userId: user?.id });
      setForm({
        issueDate: todayIso(), customer: '', priceMode: 'inclusive',
        paymentMethod: 'cash', paymentStatus: 'paid', lines: [emptyLine()],
      });
      showToast(`تم إصدار الفاتورة ${res.documentNumber} وترحيل قيدها رقم ${res.journalEntryNumber}.`);
      await Promise.all([refetch(), refetchLedger()]);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الإصدار', 'error');
    } finally { setBusy(''); }
  }

  /**
   * Invoicing a wash sends its id and the ISSUE DATE — the wash supplies
   * everything else. The two dates are different facts: the wash's date is
   * when the service happened, and the invoice's is when the paper was raised,
   * which is what its number, year, period and QR timestamp follow.
   */
  async function handleIssueForWash(wash) {
    if (washIssueDate < wash.washDate) {
      showToast('تاريخ الإصدار قبل تاريخ الغسلة — الفاتورة لا تسبق الخدمة.', 'error');
      return;
    }
    setBusy(`wash-${wash.id}`);
    try {
      const res = await issueInvoiceForWash(wash.id, {
        issueDate: washIssueDate, issueTime: nowTime(),
      });
      showToast(
        `تم إصدار الفاتورة ${res.documentNumber} بتاريخ ${res.issueDate} `
        + `عن توريد ${res.supplyDate} — بلا قيد جديد.`,
      );
      await Promise.all([refetch(), refetchWashes?.(), refetchLedger()]);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر إصدار فاتورة الغسلة', 'error');
    } finally { setBusy(''); }
  }

  /**
   * التصحيح الذري — cancel the paper, reverse the wash's entry, free the lock
   * and release the claim, in one server transaction. The ledger refuses to
   * reverse an entry a live invoice documents, so this is the only way through
   * — and it is the only way that cannot leave the four halves out of step.
   */
  async function handleCorrect({ reason, reversalDate }) {
    const docRow = correcting;
    if (!docRow) return;
    setBusy(docRow.id);
    try {
      const res = await correctWashInvoice(docRow.id, { reason, reversalDate });
      setCorrecting(null);
      showToast(
        `تم تصحيح ${res.documentNumber}: عُكس القيد بقيد رقم ${res.reversalEntryNumber}`
        + `${res.lockReleased ? '، وفُك قفل الغسلة' : ''}`
        + '. صحّح الغسلة وأعد ترحيلها ثم أصدر الفاتورة البديلة.',
      );
      await Promise.all([refetch(), refetchWashes?.(), refetchLedger()]);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر التصحيح', 'error');
    } finally { setBusy(''); }
  }

  async function handleNote(docRow, kind) {
    const label = kind === 'credit' ? 'الإشعار الدائن' : 'الإشعار المدين';
    const reason = typeof window === 'undefined' ? '' : window.prompt(
      `سبب ${label} على الفاتورة ${docRow.documentNumber}:`, '',
    );
    if (reason == null) return;
    if (!reason.trim()) { showToast('السبب مطلوب — يُقرأ في المراجعة الضريبية.', 'error'); return; }
    setBusy(docRow.id);
    try {
      const payload = { issueDate: todayIso(), issueTime: nowTime(), reason: reason.trim() };
      const res = kind === 'credit'
        ? await issueCreditNoteFor(docRow.id, payload, { userId: user?.id })
        : await issueDebitNoteFor(docRow.id, { ...payload, lines: docRow.lines }, { userId: user?.id });
      showToast(`تم إصدار ${res.documentNumber}.`);
      await Promise.all([refetch(), refetchLedger()]);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || `تعذّر إصدار ${label}`, 'error');
    } finally { setBusy(''); }
  }

  /**
   * Voiding goes through a dialog rather than a prompt, because it needs a
   * DATE as well as a reason: a document whose month has since been closed can
   * only be reversed in an open one, and a text prompt cannot ask for that.
   */
  async function handleVoid({ reason, reversalDate }) {
    const docRow = voiding;
    if (!docRow) return;
    setBusy(docRow.id);
    try {
      await voidDocument(docRow.id, { reason, reversalDate, userId: user?.id });
      setVoiding(null);
      showToast(`تم إلغاء ${docRow.documentNumber}.`);
      await Promise.all([refetch(), refetchLedger()]);
    } catch (e) {
      showToast(describeBackendError(e) || e?.message || 'تعذّر الإلغاء', 'error');
    } finally { setBusy(''); }
  }

  function handleExport() {
    downloadCsv(
      'المستندات-الضريبية',
      // Both dates. They are different facts, and a tax export that carries
      // only one of them cannot answer "which period does this belong to?"
      // and "when was the service rendered?" at the same time.
      ['رقم المستند', 'النوع', 'تاريخ الإصدار', 'تاريخ التوريد', 'العميل', 'مرجع',
        'الصافي', 'الضريبة', 'الإجمالي', 'الحالة', 'الاتجاه', 'بديل عن', 'استُبدل بـ'],
      documents.map((d) => [
        d.documentNumber, DOCUMENT_TYPE_LABELS[d.type] || d.type,
        d.issueDate, d.supplyDate || d.issueDate,
        d.customer?.name || '', d.referenceNumber || '',
        Number((d.net || 0).toFixed(2)), Number((d.vat || 0).toFixed(2)), Number((d.gross || 0).toFixed(2)),
        d.status === 'cancelled' ? 'ملغى' : 'صادر',
        documentSign(d.type) < 0 ? 'خصم' : 'إضافة',
        d.replacesDocumentNumber || '', d.replacedByDocumentNumber || '',
      ]),
    );
  }

  return (
    <>
      <TopBar title="المستندات الضريبية" subtitle="فواتير مبسطة وإشعارات دائنة ومدينة بترقيم متسلسل" />

      <main className="p-4 sm:p-6 lg:p-8 space-y-6">
        {!isFirebaseConfigured && <SetupRequiredCard missing={missingEnvNames} />}
        {error && <ErrorState title="تعذّر تحميل المستندات" error={error} onRetry={refetch} />}

        {/* ── حدود التكامل، معلنة قبل أي شيء آخر ────────────────────
            Stated first and unconditionally. A page that prints a QR code
            invites the assumption that it files something; it does not. */}
        <div role="note" className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-3 rounded-control leading-relaxed">
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-bold">لا يوجد ربط مع منصة «فاتورة» (هيئة الزكاة والضريبة والجمارك).</p>
            <p className="mt-1">{status.warning}</p>
            <p className="mt-1">
              <span className="font-semibold">المُنفَّذ:</span> {status.implemented.join(' · ')}.
              {' '}
              <span className="font-semibold">غير المُنفَّذ:</span> {status.missing.join(' · ')}.
            </p>
          </div>
        </div>

        {integrityProblems.length > 0 && (
          <div role="alert" className="flex items-start gap-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs px-4 py-3 rounded-control leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">خلل في تسلسل الترقيم — أول ما يُسأل عنه في المراجعة.</p>
              {integrityProblems.map((g) => (
                <p key={g.series} className="tabular-nums mt-0.5">
                  {g.series}: {g.missing.length ? `أرقام مفقودة ${g.missing.join('، ')}` : ''}
                  {g.duplicates.length ? ` أرقام مكررة ${g.duplicates.join('، ')}` : ''}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* ── هوية المنشأة ─────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="بيانات المنشأة على المستند"
            subtitle="الاسم والرقم الضريبي يدخلان في رمز QR — رقم خاطئ يُبطل كل رمز صادر بعده"
            action={canMutate && profile ? (
              <PrimaryButton icon={busy === 'seller' ? Loader2 : Save} onClick={handleSaveSeller} disabled={Boolean(busy)}>
                {busy === 'seller' ? 'جارٍ الحفظ...' : 'حفظ'}
              </PrimaryButton>
            ) : null}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="seller-name" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">اسم المنشأة</label>
              <input id="seller-name" type="text" value={sellerDraft.name} disabled={!canMutate}
                onChange={(e) => patchSeller({ name: e.target.value })}
                className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100" />
            </div>
            <div>
              <label htmlFor="seller-vat" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">الرقم الضريبي</label>
              <input id="seller-vat" type="text" inputMode="numeric" dir="ltr" maxLength={15}
                value={sellerDraft.vatNumber} disabled={!canMutate}
                onChange={(e) => patchSeller({ vatNumber: e.target.value.replace(/\D/g, '') })}
                placeholder="3XXXXXXXXXXXX3"
                className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">15 رقماً، يبدأ وينتهي بالرقم 3.</p>
            </div>
            <div>
              <label htmlFor="seller-address" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">العنوان</label>
              <input id="seller-address" type="text" value={sellerDraft.address} disabled={!canMutate}
                onChange={(e) => patchSeller({ address: e.target.value })}
                className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2.5 min-h-touch cursor-pointer select-none">
                <input type="checkbox" checked={Boolean(sellerDraft.vatRegistered)} disabled={!canMutate}
                  onChange={(e) => patchSeller({ vatRegistered: e.target.checked })}
                  className="w-4 h-4 accent-primary-600" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">مسجّلة في ضريبة القيمة المضافة</span>
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">هذا إعداد ملف البائع للمستندات الجديدة. سياسة الدفتر المحاسبي مؤرخة وتُراجع في إقفال الفترات{baselineFrom ? `؛ بداية سجلها ${baselineFrom}` : ''}.</p>
          {registrationConflict && <p role="alert" className="p-3 rounded-control bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200">تعارض إعدادات التسجيل: ملف البائع {seller.vatRegistered ? 'مسجّل' : 'غير مسجّل'}، وسياسة الدفتر {ledgerPolicy.vatRegistered ? 'مسجّلة' : 'غير مسجّلة'}. سياسة الدفتر سارية من {ledgerPolicy.effectiveFrom}. راجع المصدرين وتاريخ السريان قبل إصدار مستند؛ لم تُعدّل أي قيمة تلقائيًا.</p>}
          {!seller?.vatRegistered && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
              التسجيل الضريبي غير مفعّل في ملف البائع المستخدم لإصدار المستندات — وفق هذا الملف ستصدر المستندات بدون ضريبة وبدون رمز QR،
              لأن رمز QR أثرٌ خاص بالفاتورة الضريبية ولا يجوز طبعه على إيصال غير ضريبي.
            </p>
          )}
        </Card>

        {/* ── إصدار فاتورة ─────────────────────────────────────────── */}
        {canMutate && (
          <Card className="p-6">
            <SectionHeader title="إصدار فاتورة بيع مستقلة"
              subtitle="بيع لا يقابله سجل غسلة — الخادم يُنشئ الفاتورة وقيد البيع في معاملة واحدة" />
            <div className="flex items-start gap-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs px-4 py-3 rounded-control leading-relaxed mb-4">
              <FileText size={16} className="shrink-0 mt-0.5" />
              <p>
                هذه الفاتورة هي مصدر البيع نفسه، فتُرحَّل مع إصدارها:
                مدين {form.paymentStatus === 'unpaid' ? 'ذمم العملاء' : form.paymentMethod === 'cash' ? 'الصندوق' : form.paymentMethod === 'credit' ? 'ذمم العملاء' : 'البنك'} بالإجمالي،
                دائن الإيراد بالصافي ودائن ضريبة المخرجات.
                فاتورة غسلة مُرحّلة تُصدر من القائمة أدناه ولا تُنشئ قيداً ثانياً.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">تاريخ الإصدار</label>
                <DateField name="issueDate" value={form.issueDate}
                  onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} ariaLabel="تاريخ الإصدار" />
              </div>
              <div>
                <label htmlFor="doc-customer" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  العميل <span className="font-normal text-slate-500 dark:text-slate-400">(اختياري)</span>
                </label>
                <input id="doc-customer" type="text" value={form.customer}
                  onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                  className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100" />
              </div>
              <div>
                <label htmlFor="doc-mode" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">وضع التسعير</label>
                <select id="doc-mode" value={form.priceMode}
                  onChange={(e) => setForm((f) => ({ ...f, priceMode: e.target.value }))}
                  className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                  <option value="inclusive">السعر شامل الضريبة</option>
                  <option value="exclusive">السعر غير شامل الضريبة</option>
                </select>
              </div>
            </div>

            {/* ── السداد: الجانب المدين من القيد ─────────────────────
                Not cosmetic. These two answer "which account did the money
                land in", which is the debit of the entry this invoice posts.
                An unpaid sale is a receivable whatever instrument was named
                on it, so the status wins over the method. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="doc-pay-method" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">طريقة السداد</label>
                <select id="doc-pay-method" value={form.paymentMethod}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                  <option value="cash">نقداً — الصندوق</option>
                  <option value="card">شبكة — البنك</option>
                  <option value="transfer">تحويل — البنك</option>
                  <option value="credit">آجل — ذمم العملاء</option>
                </select>
              </div>
              <div>
                <label htmlFor="doc-pay-status" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">حالة السداد</label>
                <select id="doc-pay-status" value={form.paymentStatus}
                  onChange={(e) => setForm((f) => ({ ...f, paymentStatus: e.target.value }))}
                  className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100">
                  <option value="paid">محصّلة</option>
                  <option value="unpaid">غير محصّلة — ذمة على العميل</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-6">
                    <label className="sr-only" htmlFor={`line-desc-${i}`}>وصف السطر {i + 1}</label>
                    <input id={`line-desc-${i}`} type="text" placeholder="الوصف — مثال: غسيل خارجي"
                      value={l.description} onChange={(e) => patchLine(i, { description: e.target.value })}
                      className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100" />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className="sr-only" htmlFor={`line-qty-${i}`}>الكمية {i + 1}</label>
                    <input id={`line-qty-${i}`} type="number" min="0" step="1" placeholder="الكمية"
                      value={l.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })}
                      className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <label className="sr-only" htmlFor={`line-price-${i}`}>سعر الوحدة {i + 1}</label>
                    <input id={`line-price-${i}`} type="number" min="0" step="0.01" placeholder="سعر الوحدة"
                      value={l.unitPrice} onChange={(e) => patchLine(i, { unitPrice: e.target.value })}
                      className="w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100" />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    <button type="button" aria-label={`حذف السطر ${i + 1}`}
                      onClick={() => setForm((f) => ({
                        ...f, lines: f.lines.length > 1 ? f.lines.filter((_, idx) => idx !== i) : [emptyLine()],
                      }))}
                      className="w-full min-h-touch flex items-center justify-center rounded-control border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <SecondaryButton icon={Plus} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
                إضافة سطر
              </SecondaryButton>
              <div className="flex items-center gap-5 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  الصافي <span className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">{formatCurrencyPrecise(preview.net)}</span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  الضريبة <span className="tabular-nums font-semibold text-slate-900 dark:text-slate-100">{formatCurrencyPrecise(preview.vat)}</span>
                </span>
                <span className="text-slate-900 dark:text-slate-100 font-bold tabular-nums">{formatCurrencyPrecise(preview.gross)}</span>
                <PrimaryButton icon={busy === 'issue' ? Loader2 : FileText} onClick={handleIssue} disabled={Boolean(busy)}>
                  {busy === 'issue' ? 'جارٍ الإصدار...' : 'إصدار'}
                </PrimaryButton>
              </div>
            </div>
          </Card>
        )}

        {/* ── فواتير الغسلات المُرحّلة ─────────────────────────────────
            The other path, and the one that must NOT post. Only the wash id
            travels; the server reads the wash, its posting lock and its posted
            entry, and prints exactly what the books already say. */}
        {canMutate && invoiceableWashes.length > 0 && (
          <Card className="p-6">
            <SectionHeader
              title="فواتير غسلات مُرحّلة بانتظار الإصدار"
              subtitle="الفاتورة توثّق قيد الغسلة القائم ولا تُنشئ قيداً ثانياً — الإيراد مُسجَّل مرة واحدة"
            />
            {/* The paper's own date. A wash on 31 July invoiced on 12 August is
                an AUGUST document for a JULY supply: the number, the year, the
                counter, the period and the QR timestamp all follow this field,
                and the wash's date rides along as `supplyDate`. */}
            <div className="flex flex-wrap items-end gap-4 mb-4">
              <div className="w-full sm:w-56">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  تاريخ إصدار الفواتير
                </label>
                <DateField
                  name="washIssueDate" value={washIssueDate}
                  onChange={(e) => setWashIssueDate(e.target.value)}
                  ariaLabel="تاريخ إصدار فواتير الغسلات"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex-1 min-w-[16rem]">
                تاريخ التوريد يأتي من الغسلة نفسها ويُطبع على الفاتورة بجانب تاريخ الإصدار.
                الرقم والفترة ورمز QR تتبع تاريخ الإصدار، ولا يجوز أن يسبق تاريخ الغسلة.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[38rem]">
                <thead>
                  <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-4">تاريخ التوريد</th>
                    <th className="py-3 px-4">البايكر</th>
                    <th className="py-3 px-4 text-center">العدد</th>
                    <th className="py-3 px-4 text-left">السعر</th>
                    <th className="py-3 px-4 text-left">الإجمالي</th>
                    <th className="py-3 px-4 text-left">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceableWashes.map((w) => {
                    const tooEarly = washIssueDate < w.washDate;
                    return (
                      <tr key={w.id} className="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{w.washDate}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{w.bikerName || '—'}</td>
                        <td className="py-3 px-4 text-center tabular-nums text-slate-700 dark:text-slate-300">{w.quantity}</td>
                        <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(w.price)}</td>
                        <td className="py-3 px-4 text-left tabular-nums font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrencyPrecise((w.quantity || 0) * (w.price || 0))}
                        </td>
                        <td className="py-3 px-4 text-left whitespace-nowrap">
                          <SecondaryButton
                            icon={busy === `wash-${w.id}` ? Loader2 : FileText}
                            onClick={() => handleIssueForWash(w)}
                            disabled={Boolean(busy) || tooEarly}
                            title={tooEarly ? 'تاريخ الإصدار قبل تاريخ الغسلة' : undefined}
                          >
                            {busy === `wash-${w.id}` ? 'جارٍ الإصدار...' : 'إصدار الفاتورة'}
                          </SecondaryButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {loading ? (
          <LoadingState message="جارٍ تحميل المستندات..." />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-5">
              <StatCard icon={FileText} tone="primary" label="عدد المستندات" value={String(totals.count)} />
              <StatCard icon={CheckCircle2} tone="indigo" label="صافي المبيعات" value={formatCurrency(totals.net)} />
              <StatCard icon={QrIcon} tone="emerald" label="ضريبة المخرجات"
                value={formatCurrencyPrecise(totals.vat)} sub="بعد خصم الإشعارات الدائنة" />
              <StatCard icon={FileText} tone="amber" label="إجمالي المستندات" value={formatCurrency(totals.gross)} />
            </div>

            <Card className="p-6">
              <SectionHeader
                title="سجل المستندات"
                subtitle={gaps.map((g) => `${g.series}: ${g.count}`).join(' · ') || 'لا مستندات بعد'}
                action={documents.length > 0 ? (
                  <SecondaryButton icon={Download} onClick={handleExport}>تصدير CSV</SecondaryButton>
                ) : null}
              />
              {documents.length === 0 ? (
                <EmptyState icon={FileText} title="لم تصدر أي مستندات بعد"
                  hint="أصدر فاتورة من النموذج أعلاه — يُمنح الرقم تلقائياً." compact />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[52rem]">
                    <thead>
                      <tr className="text-right text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-3 px-4">رقم المستند</th>
                        <th className="py-3 px-4">النوع</th>
                        <th className="py-3 px-4">الإصدار / التوريد</th>
                        <th className="py-3 px-4">العميل / المرجع</th>
                        <th className="py-3 px-4 text-left">الصافي</th>
                        <th className="py-3 px-4 text-left">الضريبة</th>
                        <th className="py-3 px-4 text-left">الإجمالي</th>
                        <th className="py-3 px-4 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((d) => {
                        const cancelled = d.status === 'cancelled';
                        const isOpen = expanded === d.id;
                        return [
                          <tr key={d.id} className={`border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${cancelled ? 'opacity-60' : ''}`}>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <button type="button" onClick={() => setExpanded(isOpen ? null : d.id)}
                                className="tabular-nums font-bold text-slate-900 dark:text-slate-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                aria-expanded={isOpen}>
                                {d.documentNumber}
                              </button>
                              {cancelled && (
                                <span className="mr-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  ملغى
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className={`inline-flex px-2.5 py-1 rounded-full border text-[11px] font-semibold ${TYPE_TONE[d.type] || ''}`}>
                                {DOCUMENT_TYPE_LABELS[d.type] || d.type}
                              </span>
                            </td>
                            {/* Both dates. They coincide on most documents, and
                                when they do not that is exactly the fact a
                                reader needs — the supply is what the invoice
                                is FOR, the issue date is what its number and
                                its period follow. */}
                            <td className="py-3 px-4 whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                              {d.issueDate}
                              {d.supplyDate && d.supplyDate !== d.issueDate && (
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                                  توريد {d.supplyDate}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                              {d.customer?.name || '—'}
                              {d.referenceNumber && (
                                <span className="block text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                  على {d.referenceNumber}
                                </span>
                              )}
                              {d.replacesDocumentNumber && (
                                <span className="block text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                  بديل عن {d.replacesDocumentNumber}
                                </span>
                              )}
                              {d.replacedByDocumentNumber && (
                                <span className="block text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                  استُبدل بـ {d.replacedByDocumentNumber}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(d.net)}</td>
                            <td className="py-3 px-4 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(d.vat)}</td>
                            <td className={`py-3 px-4 text-left tabular-nums font-bold ${documentSign(d.type) < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'}`}>
                              {documentSign(d.type) < 0 ? '−' : ''}{formatCurrencyPrecise(d.gross)}
                            </td>
                            <td className="py-3 px-4 text-left whitespace-nowrap">
                              {!canMutate ? (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">للعرض فقط</span>
                              ) : cancelled ? (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">—</span>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  {d.type === 'invoice' && (
                                    <>
                                      <button type="button" title="إشعار دائن — تخفيض أو إلغاء"
                                        onClick={() => handleNote(d, 'credit')} disabled={busy === d.id}
                                        className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                                        <CornerUpLeft size={16} />
                                      </button>
                                      <button type="button" title="إشعار مدين — زيادة"
                                        onClick={() => handleNote(d, 'debit')} disabled={busy === d.id}
                                        className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <CornerUpRight size={16} />
                                      </button>
                                    </>
                                  )}
                                  {/* A wash-linked invoice cannot simply be voided: its
                                      entry belongs to the wash, and the ledger refuses to
                                      reverse an entry a live invoice documents. It gets the
                                      atomic correction instead — one call that cancels the
                                      paper, reverses the entry, frees the lock and releases
                                      the claim. Everything else gets the ordinary void; a
                                      NOTE gets it too, because its own entry is only
                                      unwound that way. */}
                                  {d.linkedJournalEntryId && !d.journalEntryId ? (
                                    <button type="button" title="تصحيح ذري — إلغاء الفاتورة وعكس قيد الغسلة معاً"
                                      onClick={() => setCorrecting(d)} disabled={busy === d.id}
                                      className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                                      <RotateCcw size={16} />
                                    </button>
                                  ) : (
                                    <button type="button" title="إلغاء المستند"
                                      onClick={() => setVoiding(d)} disabled={busy === d.id}
                                      className="min-h-touch min-w-touch flex items-center justify-center rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
                                      <Ban size={16} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>,
                          isOpen && (
                            <tr key={`${d.id}-detail`} className="border-b border-slate-50 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-800/30">
                              <td colSpan={8} className="py-4 px-4">
                                <div className="flex flex-col lg:flex-row gap-6">
                                  <div className="min-w-0 flex-1">
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">سطور المستند</h4>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-right text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                          <th className="py-1.5 pl-3">الوصف</th>
                                          <th className="py-1.5 pl-3 text-center">الكمية</th>
                                          <th className="py-1.5 pl-3 text-left">السعر</th>
                                          <th className="py-1.5 pl-3 text-left">الصافي</th>
                                          <th className="py-1.5 text-left">الضريبة</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(d.lines || []).map((l, i) => (
                                          <tr key={i} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                            <td className="py-1.5 pl-3 text-slate-700 dark:text-slate-300">{l.description || '—'}</td>
                                            <td className="py-1.5 pl-3 text-center tabular-nums text-slate-700 dark:text-slate-300">{l.quantity}</td>
                                            <td className="py-1.5 pl-3 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(l.unitPrice)}</td>
                                            <td className="py-1.5 pl-3 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(l.lineNet)}</td>
                                            <td className="py-1.5 text-left tabular-nums text-slate-700 dark:text-slate-300">{formatCurrencyPrecise(l.lineVat)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {d.reason && (
                                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                                        <span className="font-bold">السبب:</span> {d.reason}
                                      </p>
                                    )}
                                    {d.voidReason && (
                                      <p className="text-xs text-rose-700 dark:text-rose-300 mt-1 leading-relaxed">
                                        <span className="font-bold">سبب الإلغاء:</span> {d.voidReason}
                                      </p>
                                    )}
                                  </div>
                                  <div className="shrink-0">
                                    {d.qrPayload ? (
                                      <>
                                        <QrCode value={d.qrPayload} size={148}
                                          title={`رمز الفاتورة ${d.documentNumber}`} />
                                        <QrFields payload={d.qrPayload} />
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[16rem] leading-relaxed">
                                        لا يحمل هذا المستند رمز QR — لأنه غير خاضع للضريبة.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </main>

      {voiding && (
        <VoidDocumentModal
          key={`void-${voiding.id}`}
          document={voiding}
          busy={busy === voiding.id}
          onConfirm={handleVoid}
          onClose={() => setVoiding(null)}
        />
      )}

      {correcting && (
        <VoidDocumentModal
          key={`correct-${correcting.id}`}
          mode="correct"
          document={correcting}
          busy={busy === correcting.id}
          onConfirm={handleCorrect}
          onClose={() => setCorrecting(null)}
        />
      )}

      <Toast open={toast.open} message={toast.message} tone={toast.tone}
        duration={toast.duration} onClose={closeToast} />
    </>
  );
}

/**
 * What the QR actually encodes, decoded back from the stored payload rather
 * than re-derived from the document — so a mismatch between the two would be
 * visible instead of hidden.
 */
function QrFields({ payload }) {
  const fields = useMemo(() => {
    try { return decodeZatcaQrPayload(payload); } catch { return null; }
  }, [payload]);
  if (!fields) return null;
  const rows = [
    ['المورّد', fields[1]],
    ['الرقم الضريبي', fields[2]],
    ['التاريخ والوقت', fields[3]],
    ['الإجمالي', fields[4]],
    ['الضريبة', fields[5]],
  ];
  return (
    <dl className="mt-2 text-[10px] leading-relaxed max-w-[16rem]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="text-slate-700 dark:text-slate-300 tabular-nums truncate" dir="auto">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
