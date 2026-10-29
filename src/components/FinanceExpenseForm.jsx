import { useRef, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { callFinanceApi } from '../lib/financeApi';
import { EXPENSE_KIND_LABELS, hasPaymentConflict, suggestedPaymentMethod, WORKBENCH_STAGES } from '../lib/financeWorkbenchView';
import FinanceInvoiceLines, { InvoiceLinesRead } from './FinanceInvoiceLines';
import FinanceDocumentStatus from './FinanceDocumentStatus';

const fields = { variable: ['expense_name', 'total_variable_cost', 'logged_date'], monthly: ['expense_name', 'total_monthly_cost', 'logged_date'],
  annual: ['description', 'amount', 'spent_date', 'annual_expense_id'], startup: ['description', 'amount', 'spent_date', 'startup_cost_id'] };
function fromRow(kind, row = {}) {
  const [title, amount, date, parent] = fields[kind], meta = row.finance_metadata || {};
  const bool = value => typeof value === 'boolean' ? String(value) : '';
  return { description: row[title] || '', amount: row[amount] ?? '', date: row[date] || '', quantity: row.quantity ?? '',
    classification: row[parent || 'category_id'] || '', supplier: row.supplier || '', invoiceNumber: row.invoice_number || '',
    invoiceDate: row.invoice_date || '', invoiceUrl: row.invoice_url || '', isTaxInvoice: bool(row.is_tax_invoice), vatAmount: row.vat_amount ?? '',
    vatRate: row.vat_rate ?? '', vatDeductible: bool(row.vat_deductible), priceMode: row.price_mode || '',
    paymentMethod: row.payment_method || 'unknown', paymentStatus: row.payment_status || 'unknown', paidDate: row.paid_date || '',
    fundingType: meta.fundingType || 'unknown', fundingReference: meta.fundingReference || '', purpose: meta.purpose || '',
    taxBasis: meta.taxBasis || 'document', taxReviewRef: meta.taxReviewRef || '', evidenceRefs: (meta.evidenceRefs || []).join('\n'),
    invoiceLines: meta.invoiceLines ? structuredClone(meta.invoiceLines) : null,
    quantityException: meta.quantityException ? structuredClone(meta.quantityException) : null,
    documentAllocation: meta.documentAllocation ? structuredClone(meta.documentAllocation) : null,
    reviewedDocumentIdentity: meta.reviewedDocumentIdentity ? structuredClone(meta.reviewedDocumentIdentity) : null };
}
function toPatch(kind, form) {
  const p = { description: form.description, amount: Number(form.amount), date: form.date,
    ...(form.quantityException ? { invoiceLines: null, quantityException: form.quantityException }
      : form.invoiceLines ? { invoiceLines: form.invoiceLines, quantityException: null } : { invoiceLines: null, quantityException: null, quantity: Number(form.quantity) }),
    documentAllocation: form.documentAllocation,
    reviewedDocumentIdentity: form.reviewedDocumentIdentity,
    supplier: form.supplier.trim() || null, invoiceNumber: form.invoiceNumber.trim() || null, invoiceDate: form.invoiceDate || null,
    invoiceUrl: form.invoiceUrl.trim() || null, vatAmount: form.vatAmount === '' ? null : Number(form.vatAmount),
    vatRate: form.vatRate === '' ? null : Number(form.vatRate), paidDate: form.paidDate || null,
    paymentMethod: form.paymentMethod, paymentStatus: form.paymentStatus, fundingType: form.fundingType,
    fundingReference: form.fundingReference.trim() || null, purpose: form.purpose.trim() || null,
    taxBasis: form.taxBasis, taxReviewRef: form.taxReviewRef.trim() || null, evidenceRefs: form.evidenceRefs.split('\n').map(v => v.trim()).filter(Boolean) };
  if (form.classification) p[kind === 'annual' || kind === 'startup' ? 'parentId' : 'categoryId'] = form.classification;
  for (const key of ['isTaxInvoice', 'vatDeductible']) if (form[key] !== '') p[key] = form[key] === 'true';
  if (form.priceMode) p.priceMode = form.priceMode;
  return p;
}
const paymentNames = { cash: 'نقد', transfer: 'تحويل بنكي', card: 'مدى / بطاقة', credit: 'على الحساب', owner_current: 'من حساب هادي الشخصي',
  founding_personal: 'دفع شخصي - فترة التأسيس', custody: 'من عهدة', partner_paid: 'دفعه شريك من جيبه' };

export default function FinanceExpenseForm({ kind, detail, requestId, options, onSaved, onMessage, onCancel, onEdit, onBusy, onReload }) {
  const initial = fromRow(kind, detail?.row);
  const [form, setForm] = useState(initial), [preview, setPreview] = useState(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false), [taxOpen, setTaxOpen] = useState(initial.isTaxInvoice === 'true');
  const [receiptType, setReceiptType] = useState('');
  const inFlight = useRef(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const protectedRow = Boolean(detail?.protectedSource || detail?.closed);
  const next = !detail || dirty || (!detail.approved && !detail.approvalReady) ? 'save' : detail.approved ? 'post' : 'approve';
  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value })); setPreview(null); setConfirmed(false); setError(''); onEdit?.();
    if (key === 'isTaxInvoice' && value === 'true') setTaxOpen(true);
  };
  const input = (label, key, type = 'text') => <label key={key}>{label}<input type={type} step={type === 'number' ? 'any' : undefined} value={form[key]}
    onChange={e => set(key, e.target.value)} disabled={protectedRow || busy} /></label>;
  const select = (label, key, values) => <label key={key}>{label}<select value={form[key]} onChange={e => set(key, e.target.value)} disabled={protectedRow || busy}>
    {values.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>;
  const conflict = hasPaymentConflict({ ...detail?.row, expense_name: form.description, description: form.description,
    payment_method: form.paymentMethod, receipt_type: receiptType || detail?.row.receipt_type });
  const suggestion = requestId ? suggestedPaymentMethod(form.description, receiptType) : null;
  const issues = preview?.issues || detail?.issues || [];
  const previewData = preview?.postingPreview || detail?.postingPreview;
  async function execute(action) {
    if (inFlight.current) return;
    const isPreview = action === 'preview' || action === 'previewCapture';
    if (uncertain && !isPreview) return;
    if (['approve', 'post'].includes(action) && (!confirmed || dirty || (action === 'approve' && (reason.trim().length < 3 || !detail?.approvalReady))
      || (action === 'post' && !detail?.postingReady))) return;
    inFlight.current = true; setBusy(true); onBusy?.(true); setError(''); onMessage('');
    try {
      const common = requestId ? { kind, requestId } : { kind, sourceId: detail.sourceId, sourceHash: detail.sourceHash };
      const body = { ...common, action, ...(['approve', 'post'].includes(action) ? {} : { patch: toPatch(kind, form) }),
        ...(!isPreview ? { confirm: true } : {}),
        ...(['save', 'capture'].includes(action) ? { previewHash: preview.previewHash, reason: 'حفظ بيانات المستند من صندوق العمل المالي' } : {}),
        ...(action === 'approve' ? { reason, postingHash: detail.postingPreview.postingHash } : {}) };
      const result = await callFinanceApi('finance-workbench', body);
      if (isPreview) { setPreview(result); setConfirmed(false); return; }
      const sourceId = result.sourceId || result.verification?.sourceId;
      const after = await callFinanceApi('finance-workbench', { action: 'read', kind, sourceId });
      if (action === 'approve' && (!after.approved || after.sourceHash !== detail.sourceHash)) throw new Error('لم يثبت حفظ الاعتماد؛ لا تتابع الترحيل.');
      if (['save', 'capture'].includes(action) && after.sourceHash !== result.sourceHash) throw new Error('تغير المصدر بعد الحفظ؛ أعد القراءة قبل أي خطوة.');
      if (action === 'post' && (!after.protectedSource || !after.journalIds.length)) throw new Error('لم يثبت ربط القيد؛ لا تعِد الترحيل عميانيًا.');
      setConfirmed(false); setReason(''); setPreview(null);
      onMessage(action === 'post' ? 'تحقق ربط المصدر بالقيد. هذا ترحيل لا صرف.'
        : action === 'approve' ? 'حُفظ اعتماد النسخة الحالية وتحققت إعادة قراءته. لم يُرحّل أو يُدفع.' : 'حُفظ المصدر غير المرحّل وتحققت إعادة قراءته. يحتاج مراجعة واعتمادًا منفصلين.');
      onSaved(sourceId);
    } catch (e) {
      if (!isPreview) setUncertain(true);
      setError(`${e.message} أعد قراءة الحالة قبل أي محاولة حفظ جديدة.`);
    } finally { inFlight.current = false; setBusy(false); onBusy?.(false); }
  }
  const primaryDisabled = busy || uncertain || (next === 'save' && (options.loading || Boolean(options.error)))
    || (next === 'approve' && (!confirmed || reason.trim().length < 3 || !detail?.approvalReady))
    || (next === 'post' && (!confirmed || !detail?.postingReady));
  return <>
    <div className="fw-document-heading"><h2><ShieldCheck size={19} />{requestId ? 'مستند جديد' : 'مراجعة المستند'}</h2>
      <span className={`fw-stage fw-stage--${detail?.workflowStage || 'incomplete'}`}>{requestId ? 'لم يُحفظ بعد' : WORKBENCH_STAGES[detail?.workflowStage] || 'عرض المستند'}</span></div>
    <small>{EXPENSE_KIND_LABELS[kind]}</small>
    {detail?.workflowDimensions ? <FinanceDocumentStatus dimensions={detail.workflowDimensions} /> : detail && <dl className="fw-document-status" aria-label="حالات المصروف المنفصلة">
      <div><dt>الاعتماد</dt><dd>{detail.approved ? 'اعتماد النسخة الحالية' : 'غير معتمد'}</dd></div>
      <div><dt>الترحيل</dt><dd>{detail.protectedSource ? 'المصدر محمي وله أثر سابق' : 'غير مرحل'}</dd></div>
      <div><dt>السداد</dt><dd>{detail.paymentProven ? 'مثبت في المصدر' : ({ paid: 'مسجل مدفوع — يحتاج دليل', unpaid: 'غير مسدد' })[detail.row.payment_status] || 'غير مثبت'}</dd></div>
    </dl>}
    {conflict && <div className="fw-payment-warning" role="note"><AlertTriangle size={18} /><span>طريقة دفع متناقضة: المستند يشير إلى تحويل أو مدى أو بنكي، لكن المسجل نقد. التنبيه لا يغيّر البيانات.</span></div>}
    {detail?.workflowNote && <p className="fw-warning">{detail.workflowNote}</p>}
    {detail?.postingHistory && (detail.postingHistory.active.length > 0 || detail.postingHistory.reversed.length > 0) &&
      <section className="fw-form-section" aria-label="القيود السارية وسجل العكس">
        <h3 className="fw-form-section-title">القيود السارية وسجل العكس</h3>
        <p>القيود السارية: {detail.postingHistory.active.map(entry => `#${entry.number ?? 'غير مرقم'}${entry.settlementOf ? ' (سداد)' : ''}`).join('، ') || 'لا يوجد بديل مرحل مثبت'}</p>
        {detail.postingHistory.reversed.map(entry => <p key={entry.id}>الأصل #{entry.number ?? 'غير مرقم'} معكوس · قيد العكس: {entry.reversal ? `#${entry.reversal.number ?? 'غير مرقم'}` : 'غير متاح'} · {entry.mirrorMatched ? 'الأصل والعكس متطابقان' : 'مطابقة العكس تحتاج مراجعة'}</p>)}
        {detail.postingHistory.fundingCorrections.length > 0 && <p>تصحيح جهة السداد المسجل: {detail.postingHistory.fundingCorrections.map(entry => `#${entry.number ?? 'غير مرقم'}`).join('، ')}. هذا ربط دفتري، وليس مطابقة كشف البنك.</p>}
        <p>القيود لا تعني اكتمال دليل المستند أو اعتماد نسخته الحالية. تبقى النواقص ظاهرة، ولا يسمح بإعادة الترحيل.</p>
      </section>}
    {protectedRow && <p className="fw-protected-note">المصدر محمي أو الفترة مقفلة؛ العرض فقط. لا تعديل للمصدر المرحّل من هذا المسار.</p>}
    {error && <div className="fw-warning" role="alert">{error}</div>}
    <section aria-label="الأساسي"><h3 className="fw-form-section-title">الأساسي</h3><div className="fw-form">
      {input('الوصف', 'description')}{input('المبلغ بالريال', 'amount', 'number')}{input('تاريخ المصروف', 'date', 'date')}{input('المورد', 'supplier')}
      {select('طريقة الدفع', 'paymentMethod', [['unknown', 'غير محددة'], ['cash', 'نقد'], ['transfer', 'تحويل بنكي'], ['card', 'مدى / بطاقة'], ['credit', 'على الحساب'], ['owner_current', 'من حساب هادي الشخصي'], ['founding_personal', 'دفع شخصي - فترة التأسيس'],
        // Set by the founding-period settlement with the partner / custodian named; shown, not offered.
        ...(['custody', 'partner_paid'].includes(form.paymentMethod) ? [[form.paymentMethod, paymentNames[form.paymentMethod]]] : [])])}
      {input('تاريخ السداد', 'paidDate', 'date')}{input('رابط الإيصال', 'invoiceUrl', 'url')}
    </div></section>
    {suggestion && form.paymentMethod !== suggestion && <div className="fw-suggestion" role="status"><span>اقتراح للمستند الجديد: {paymentNames[suggestion]}. لا يُطبق إلا بتأكيدك.</span>
      <button type="button" disabled={busy} onClick={() => set('paymentMethod', suggestion)}>تأكيد الاقتراح</button></div>}
    <details className="fw-form-section" open={taxOpen} onToggle={e => setTaxOpen(e.currentTarget.open)}><summary>الضريبة</summary><div className="fw-form">
      {select('هل هو فاتورة ضريبية؟', 'isTaxInvoice', [['', 'غير محسوم'], ['true', 'نعم، فاتورة ضريبية'], ['false', 'لا، مستند غير ضريبي']])}
      {input('الضريبة المكتوبة في الفاتورة', 'vatAmount', 'number')}{input('نسبة الضريبة كعدد عشري، مثل 0.15', 'vatRate', 'number')}
      {select('السعر يشمل الضريبة؟', 'priceMode', [['', 'غير محدد'], ['inclusive', 'نعم'], ['exclusive', 'لا']])}
      {select('هل ضريبتها قابلة للاسترداد؟', 'vatDeductible', [['', 'غير محسوم'], ['true', 'نعم، بدليل'], ['false', 'لا']])}
      {input('مرجع مراجعة الضريبة', 'taxReviewRef')}
      {select('من أين عرفت الضريبة؟', 'taxBasis', [['document', 'مبلغ أو نسبة مكتوبة في المستند'], ['verified_historical_policy', 'سياسة تاريخية متحقق منها بمرجع']])}
    </div></details>
    <details className="fw-form-section"><summary>السداد والتمويل</summary><div className="fw-form">
      {select('حالة السداد', 'paymentStatus', [['unknown', 'غير مثبتة'], ['unpaid', 'لم يُسدد بعد'], ['paid', 'تم السداد بدليله']])}
      {select('من أين دُفع المبلغ؟', 'fundingType', [['unknown', 'غير مثبت'], ['company_cash', 'صندوق المنشأة'], ['company_bank', 'بنك المنشأة'], ['vendor_liability', 'لم يُدفع — ذمة مورد'], ['partner', 'دفع شريك — يحتاج حسم الحساب'], ['employee', 'دفع موظف — يحتاج حسم الحساب'], ['owner_current', 'حساب هادي الجاري'], ...(form.fundingType === 'custody' ? [['custody', 'من عهدة']] : [])])}
      {input('دليل الدفع أو ذمة المورد', 'fundingReference')}{input('سبب المصروف للمشروع', 'purpose')}
    </div></details>
    <details className="fw-form-section"><summary>التصنيف والمراجع</summary><div className="fw-form">
      <label>طريقة تمثيل الكمية<select value={form.quantityException ? 'total' : form.invoiceLines ? 'lines' : 'single'} disabled={protectedRow || busy}
        onChange={event => {
          const mode = event.target.value;
          setForm(current => ({ ...current, invoiceLines: mode === 'lines' ? { version: 1, items: [], vatAllocation: null } : null,
            quantityException: mode === 'total' ? { version: 1, grantRef: detail.sourceContext.quantityGrant.ref, sourceRef: '' } : null }));
          setPreview(null);
          setConfirmed(false); setError(''); onEdit?.();
        }}>
        <option value="single">كمية متجانسة واحدة</option><option value="lines">بنود مختلفة من الفاتورة</option>
        {(detail?.sourceContext?.quantityGrant || form.quantityException) && <option value="total" disabled={!detail?.sourceContext?.quantityGrant}>إجمالي مثبت — العدد غير متاح بقرار هادي</option>}
      </select></label>
      {!form.invoiceLines && !form.quantityException && input('الكمية', 'quantity', 'number')}
      {form.quantityException && <label className="fw-wide">مرجع دليل المبلغ واستثناء العدد<input disabled={protectedRow || busy} value={form.quantityException.sourceRef}
        onChange={event => set('quantityException', { ...form.quantityException, sourceRef: event.target.value })} /></label>}
      <label>تصنيف المصروف<select value={form.classification} disabled={protectedRow || busy || (Boolean(detail) && ['annual', 'startup'].includes(kind))}
        onChange={e => set('classification', e.target.value)}><option value="">غير محدد</option>{(options.data?.items || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        {options.data?.limited && <small>قائمة التصنيفات محدودة؛ لا تختَر بدلًا من بند غير ظاهر.</small>}</label>
      {input('رقم المستند', 'invoiceNumber')}{input('تاريخ الفاتورة', 'invoiceDate', 'date')}
      {requestId && <label>نوع الإيصال للاقتراح فقط<select value={receiptType} onChange={e => setReceiptType(e.target.value)} disabled={busy}>
        <option value="">غير محدد</option><option value="نقد">إيصال نقدي</option><option value="تحويل بنكي">تحويل بنكي</option><option value="مدى">مدى / بطاقة</option></select></label>}
      <label className="fw-wide">روابط أو مراجع تؤيد المستند — كل مرجع في سطر<textarea value={form.evidenceRefs} onChange={e => set('evidenceRefs', e.target.value)} disabled={protectedRow || busy} /></label>
    </div></details>
    {form.quantityException && <p className="fw-warning">الكمية وسعر الوحدة غير متاحين بقرار هادي الموثق. لا نفترض كمية واحدة. بقية النواقص والاعتماد المنفصل باقية.</p>}
    {(detail?.sourceContext?.allocationGrant || form.documentAllocation) && <section className="fw-form-section" aria-label="توزيع الأصل المراجع">
      <h3 className="fw-form-section-title">توزيع الأصل المراجع</h3>
      <p>فاتورة واحدة: 200 ريال للدبابات و80 ريال للسكن، من إجمالي 280 ريال. لا مصروف جديد أو تكرار للبنود.</p>
      <label><input type="checkbox" disabled={protectedRow || busy || !detail?.sourceContext?.allocationGrant} checked={Boolean(form.documentAllocation)}
        onChange={event => set('documentAllocation', event.target.checked ? { version: 1, grantRef: detail.sourceContext.allocationGrant.ref, sourceRef: '' } : null)} /> ربط هذا السجل بحصته المراجعة من الأصل</label>
      {form.documentAllocation && <label>مرجع مراجعة توزيع الأصل<input disabled={protectedRow || busy} value={form.documentAllocation.sourceRef}
        onChange={event => set('documentAllocation', { ...form.documentAllocation, sourceRef: event.target.value })} /></label>}
      <small>يلزم اكتمال الربط في السجلين قبل الاعتماد. تغيير أحدهما يبطل صلاحية اعتماد التوزيع؛ لا يتغير أي مبلغ تلقائيًا.</small>
    </section>}
    {(detail?.sourceContext?.reviewedIdentityGrant || form.reviewedDocumentIdentity) && <section className="fw-form-section" aria-label="هوية المستند المراجعة">
      <h3>هوية المستند المراجعة</h3>
      <p>لا يوجد رقم فاتورة مطبوع. يبقى فارغًا، ويرتبط هذا المصدر فقط بالرأي المراجع دون تغيير الضريبة أو بقية الضوابط.</p>
      <label><input type="checkbox" disabled={protectedRow || busy || !detail?.sourceContext?.reviewedIdentityGrant} checked={Boolean(form.reviewedDocumentIdentity)}
        onChange={event => set('reviewedDocumentIdentity', event.target.checked ? { version: 1, grantRef: detail.sourceContext.reviewedIdentityGrant.ref, sourceRef: '' } : null)} /> ربط هوية المستند بالرأي المراجع</label>
      {form.reviewedDocumentIdentity && <label>مرجع دليل هوية المستند<input disabled={protectedRow || busy} value={form.reviewedDocumentIdentity.sourceRef}
        onChange={event => set('reviewedDocumentIdentity', { ...form.reviewedDocumentIdentity, sourceRef: event.target.value })} /></label>}
    </section>}
    {(preview?.sourceContext || detail?.sourceContext)?.warnings?.map(warning => <p className="fw-warning" key={warning}>{warning}</p>)}
    {form.invoiceLines && <FinanceInvoiceLines value={form.invoiceLines} onChange={value => set('invoiceLines', value)} disabled={protectedRow || busy}
      amount={form.amount} vatAmount={form.vatAmount} taxReviewRef={form.taxReviewRef} isTaxInvoice={form.isTaxInvoice} />}
    {issues.length > 0 && (preview || !detail?.workflowDimensions) && <details className="fw-document-issues"><summary>نواقص أو موانع اعتماد في المعاينة: {issues.length}</summary><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
    {preview && <ChangePreview kind={kind} preview={preview} options={options.data?.items || []} />}
    {previewData?.lines?.length > 0 && <details className="fw-form-section"><summary>معاينة القيد — دون ترحيل</summary>
      {[previewData, ...(previewData.settlement ? [previewData.settlement] : [])].map((entry, index) => <div key={index}>
        <p>{entry.entry.description} · {entry.entry.entryDate}</p><div className="fw-table-scroll"><table><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>
          {entry.lines.map((line, number) => <tr key={number}><td>{line.description || 'حساب في المعاينة'}</td><td>{line.debit}</td><td>{line.credit}</td></tr>)}
        </tbody></table></div></div>)}<small>معاينة فقط، ليست قيدًا محفوظًا أو تحصيلًا أو صرفًا.</small></details>}
    {!protectedRow && <>
      {next === 'approve' && <div className="fw-confirm-step"><label>سبب الاعتماد<input value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> راجعت المستند ومعاينة القيد وأؤكد اعتماد هذه النسخة فقط، دون ترحيل أو سداد.</label></div>}
      {next === 'post' && <div className="fw-confirm-step"><label>سبب الاعتماد المحفوظ<input value={detail.review?.reason || 'غير متاح'} readOnly /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> أؤكد ترحيل هذا المستند وحده بعد المراجعة؛ الترحيل ليس سدادًا.</label></div>}
      <div className="fw-document-actions"><button type="button" className="fw-primary" disabled={primaryDisabled}
        onClick={() => execute(next === 'save' ? preview ? requestId ? 'capture' : 'save' : requestId ? 'previewCapture' : 'preview' : next)}>
        {busy ? 'جارٍ تنفيذ الخطوة…' : next === 'save' ? 'احفظ' : next === 'approve' ? 'اعتمد' : 'رحّل'}</button>
        <details><summary>خيارات أخرى</summary><div className="fw-other-options">
          <button type="button" disabled={busy} onClick={() => execute(requestId ? 'previewCapture' : 'preview')}>معاينة دون حفظ</button>
          {detail && <button type="button" disabled={busy} onClick={() => onReload ? onReload() : onSaved(detail.sourceId)}>إعادة قراءة الحالة</button>}
          {onCancel && <button type="button" disabled={busy} onClick={onCancel}>إلغاء دون حفظ</button>}
        </div></details></div>
      {next === 'save' && <p className="fw-step-help">{preview ? 'لم يُحفظ بعد. راجع المعاينة، ثم اضغط «احفظ» لتأكيد حفظ المصدر فقط.' : 'أول ضغطة تعرض المعاينة؛ لا اعتماد أو ترحيل أو سداد مع الحفظ.'}</p>}
      {uncertain && preview?.sourceId && <button type="button" onClick={() => onSaved(preview.sourceId)}>قراءة نتيجة محاولة الحفظ</button>}
    </>}
    {detail?.row.invoice_url && /^https:\/\//i.test(detail.row.invoice_url) && !/\/api\/mcp\//i.test(detail.row.invoice_url)
      && <p><a href={detail.row.invoice_url} target="_blank" rel="noopener noreferrer">فتح الإيصال الأصلي</a></p>}
    <small>الحفظ والاعتماد والترحيل والسداد خطوات منفصلة. النواقص تمنع الاعتماد، ولا يتغير السداد بمجرد الترحيل.</small>
  </>;
}

export function ChangePreview({ kind, preview, options }) {
  const labels = { description: 'الوصف', amount: 'المبلغ بالريال', date: 'تاريخ المصروف', quantity: 'الكمية', classification: 'تصنيف المصروف',
    supplier: 'المورد', invoiceNumber: 'رقم المستند', invoiceDate: 'تاريخ الفاتورة', invoiceUrl: 'رابط الإيصال',
    isTaxInvoice: 'فاتورة ضريبية', vatAmount: 'مبلغ الضريبة', vatRate: 'نسبة الضريبة', vatDeductible: 'قابلية استرداد الضريبة', priceMode: 'السعر والضريبة',
    paymentMethod: 'طريقة الدفع', paymentStatus: 'حالة السداد', paidDate: 'تاريخ السداد', fundingType: 'مصدر التمويل', fundingReference: 'دليل الدفع أو الذمة',
    purpose: 'سبب المصروف للمشروع', evidenceRefs: 'مراجع المستند', taxReviewRef: 'مرجع مراجعة الضريبة', taxBasis: 'مصدر الضريبة' };
  const values = { true: 'نعم', false: 'لا', unknown: 'غير مثبت', paid: 'تم السداد بدليله', unpaid: 'لم يُسدد بعد', company_cash: 'صندوق المنشأة',
    company_bank: 'بنك المنشأة', vendor_liability: 'ذمة مورد', partner: 'دفع شريك', employee: 'دفع موظف', ...paymentNames,
    inclusive: 'شامل الضريبة', exclusive: 'غير شامل الضريبة', document: 'المستند', verified_historical_policy: 'سياسة تاريخية متحقق منها' };
  const before = fromRow(kind, preview.before), after = fromRow(kind, preview.after);
  const changed = Object.keys(labels).filter(key => String(before[key]) !== String(after[key]));
  const linesChanged = JSON.stringify(before.invoiceLines) !== JSON.stringify(after.invoiceLines);
  const evidenceChanged = JSON.stringify([before.quantityException, before.documentAllocation, before.reviewedDocumentIdentity]) !== JSON.stringify([after.quantityException, after.documentAllocation, after.reviewedDocumentIdentity]);
  const show = (key, value) => key === 'classification' ? options.find(o => o.id === value)?.label || 'غير متاح'
    : value === '' || value === null || value === undefined ? 'غير متاح' : values[value] || String(value);
  return <details className="fw-form-section" open><summary>معاينة التغيير — لم يُحفظ</summary>{changed.length ? <div className="fw-table-scroll"><table>
    <thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead><tbody>{changed.map(key => <tr key={key}><th scope="row">{labels[key]}</th><td>{show(key, before[key])}</td><td>{show(key, after[key])}</td></tr>)}</tbody>
  </table></div> : !linesChanged && !evidenceChanged && <p>لا تغيير في الحقول المعروضة.</p>}
    {linesChanged && <section aria-label="تغيير بنود الفاتورة"><h4>بنود الفاتورة قبل التغيير</h4><InvoiceLinesRead value={before.invoiceLines} />
      <h4>بنود الفاتورة بعد التغيير</h4><InvoiceLinesRead value={after.invoiceLines} /></section>}
    {evidenceChanged && <section aria-label="تغيير أدلة المصدر"><h4>أدلة المصدر قبل التغيير</h4><SourceEvidenceRead form={before} />
      <h4>أدلة المصدر بعد التغيير</h4><SourceEvidenceRead form={after} /></section>}
  </details>;
}

function SourceEvidenceRead({ form }) {
  return <>{form.quantityException ? <p>إجمالي مثبت دون كمية أو سعر وحدة بقرار هادي · {form.quantityException.grantRef} · {form.quantityException.sourceRef}</p>
    : <p>لا استثناء من متطلبات الكمية.</p>}
    {form.documentAllocation ? <p>ربط بتوزيع أصل مراجع · {form.documentAllocation.grantRef} · {form.documentAllocation.sourceRef}</p>
      : <p>لا ربط بتوزيع أصل.</p>}
    {form.reviewedDocumentIdentity ? <p>هوية مستند مراجعة دون رقم مطبوع · {form.reviewedDocumentIdentity.grantRef} · {form.reviewedDocumentIdentity.sourceRef}</p>
      : <p>لا ربط بهوية مستند مراجعة.</p>}</>;
}
