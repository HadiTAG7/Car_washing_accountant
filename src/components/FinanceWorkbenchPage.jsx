import { useState } from 'react';
import { Inbox, Plus, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import TopBar from './TopBar';
import LoadingState from './LoadingState';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { callFinanceApi } from '../lib/financeApi';
import './FinanceWorkspace.css';

const labels = { variable: 'المتغيرة', monthly: 'الشهرية المفردة', annual: 'السنوية', startup: 'التأسيسية' };
const fields = { variable: ['expense_name', 'total_variable_cost', 'logged_date'], monthly: ['expense_name', 'total_monthly_cost', 'logged_date'],
  annual: ['description', 'amount', 'spent_date', 'annual_expense_id'], startup: ['description', 'amount', 'spent_date', 'startup_cost_id'] };
const stageLabels = { protected: 'مصدر محمي — له أثر ترحيل', closed_period: 'فترة مقفلة', approved: 'اعتماد النسخة الحالية', review_ready: 'جاهز للمراجعة، غير معتمد', incomplete: 'به نواقص' };
export default function FinanceWorkbenchPage() {
  const [kind, setKind] = useState('variable'), [selected, setSelected] = useState(''), [after, setAfter] = useState(undefined);
  const [capture, setCapture] = useState(''), [message, setMessage] = useState('');
  const list = useFinanceRead('finance-workbench', { action: 'list', kind, ...(after ? { after } : {}) });
  const sourceId = selected || list.data?.items?.[0]?.sourceId;
  const read = useFinanceRead('finance-workbench', { action: 'read', kind, sourceId }, Boolean(sourceId) && !capture);
  const options = useFinanceRead('finance-workbench', { action: 'options', kind });
  const changed = id => { setCapture(''); setSelected(id); list.refresh(); read.refresh(); };
  if (!list.allowed) return <div className="fw-page" role="alert">صندوق العمل المالي للإدارة فقط.</div>;
  return <><TopBar title="صندوق العمل المالي" subtitle="المستند والمراجعة والاعتماد والترحيل — دون افتراض سداد" /><main className="fw-page" dir="rtl">
    <div className="fw-toolbar"><label>نوع المصروف <select value={kind} onChange={e => { setKind(e.target.value); setSelected(''); setAfter(undefined); setCapture(''); setMessage(''); }}>
      {Object.entries(labels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
    </select></label><div className="fw-actions"><button type="button" onClick={() => { setMessage(''); list.refresh(); read.refresh(); options.refresh(); }}><RefreshCw size={16} /> تحديث</button>
      <button type="button" className="fw-primary" onClick={() => { setCapture(crypto.randomUUID()); setMessage(''); }}><Plus size={16} /> تسجيل مستند جديد غير مرحّل</button></div></div>
    <div className="fw-warning" role="note"><AlertTriangle size={18} />الاعتماد لا يعني السداد، والترحيل لا يصرف أموالًا. لا رواتب أو سلف أو قوالب متكررة أو تعديل مصدر مرحّل في هذا المسار.</div>
    {message && <div className="fw-success" role="status">{message}</div>}
    {(list.error || read.error || options.error) && <div className="fw-warning" role="alert">{list.error || read.error || options.error}</div>}
    <div className="fw-records"><aside className="fw-panel fw-record-list" aria-label="سجلات المصروفات"><h2><Inbox size={18} /> السجلات</h2>
      <small>{list.data?.coverage || 'قائمة محدودة؛ ليست رصيد الموردين أو عدد المصروفات المؤهلة.'}</small>
      {list.loading && <LoadingState message="جارٍ تحميل المصروفات..." />}
      {(list.data?.items || []).map(item => <button type="button" className={item.sourceId === sourceId && !capture ? 'fw-selected' : ''} key={item.sourceId}
        onClick={() => { setSelected(item.sourceId); setCapture(''); setMessage(''); }}><strong>{item.title}</strong><span>{item.amount === null ? 'مبلغ غير متاح' : `${item.amount} ر.س`} · {item.date || 'تاريخ غير متاح'}</span><small>السداد: {({ paid: 'مسجل مدفوع — يحتاج دليل', unpaid: 'غير مسدد', unknown: 'غير مثبت' })[item.paymentStatus] || 'غير مثبت'}</small></button>)}
      {list.data?.nextAfter && <button type="button" onClick={() => { setAfter(list.data.nextAfter); setSelected(''); }}>السجلات التالية</button>}
      {after && <button type="button" onClick={() => { setAfter(undefined); setSelected(''); }}>بداية القائمة</button>}
    </aside><section className="fw-panel" aria-label="مراجعة المصروف">
      {capture ? <ExpenseForm key={`${kind}-${capture}`} kind={kind} requestId={capture} options={options} onCancel={() => setCapture('')} onSaved={changed} onMessage={setMessage} />
        : read.loading ? <LoadingState message="جارٍ قراءة المصدر والاعتماد والقيد..." />
          : read.data && !read.error ? <ExpenseForm key={`${kind}-${sourceId}-${read.data.sourceHash}`} kind={kind} detail={read.data} options={options} onSaved={changed} onMessage={setMessage} />
            : <p>اختر سجلًا، أو سجّل مستندًا جديدًا واضحًا. لا تعرض أخطاء القراءة كعدم وجود مصروفات.</p>}
    </section></div>
  </main></>;
}
function fromRow(kind, row = {}) {
  const [title, amount, date, parent] = fields[kind], meta = row.finance_metadata || {};
  const bool = value => typeof value === 'boolean' ? String(value) : '';
  return { description: row[title] || '', amount: row[amount] ?? '', date: row[date] || '', quantity: row.quantity ?? '',
    classification: row[parent || 'category_id'] || '', supplier: row.supplier || '', invoiceNumber: row.invoice_number || '',
    invoiceDate: row.invoice_date || '', invoiceUrl: row.invoice_url || '', isTaxInvoice: bool(row.is_tax_invoice), vatAmount: row.vat_amount ?? '',
    vatRate: row.vat_rate ?? '', vatDeductible: bool(row.vat_deductible), priceMode: row.price_mode || '',
    paymentMethod: row.payment_method || 'unknown', paymentStatus: row.payment_status || 'unknown', paidDate: row.paid_date || '',
    fundingType: meta.fundingType || 'unknown', fundingReference: meta.fundingReference || '', purpose: meta.purpose || '',
    taxBasis: meta.taxBasis || 'document', taxReviewRef: meta.taxReviewRef || '', evidenceRefs: (meta.evidenceRefs || []).join('\n') };
}
function toPatch(kind, form) {
  const p = { description: form.description, amount: Number(form.amount), date: form.date, quantity: Number(form.quantity),
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
function ExpenseForm({ kind, detail, requestId, options, onSaved, onMessage, onCancel }) {
  const initial = fromRow(kind, detail?.row);
  const [form, setForm] = useState(initial), [preview, setPreview] = useState(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const protectedRow = Boolean(detail?.protectedSource || detail?.closed);
  const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setPreview(null); setConfirmed(false); setError(''); };
  const input = (label, key, type = 'text') => <label key={key}>{label}<input type={type} step={type === 'number' ? 'any' : undefined} value={form[key]} onChange={e => set(key, e.target.value)} disabled={protectedRow || busy} /></label>;
  const select = (label, key, values) => <label key={key}>{label}<select value={form[key]} onChange={e => set(key, e.target.value)} disabled={protectedRow || busy}>{values.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>;
  const previewData = preview?.postingPreview || detail?.postingPreview;
  async function execute(action) {
    setBusy(true); setError(''); onMessage('');
    const isPreview = action === 'preview' || action === 'previewCapture';
    try {
      const common = requestId ? { kind, requestId } : { kind, sourceId: detail.sourceId, sourceHash: detail.sourceHash };
      const patch = toPatch(kind, form);
      const body = { ...common, action, ...(['approve', 'post'].includes(action) ? {} : { patch }),
        ...(!isPreview ? { confirm: true } : {}), ...(['save', 'capture'].includes(action) ? { previewHash: preview.previewHash, reason } : {}),
        ...(action === 'approve' ? { reason, postingHash: detail.postingPreview.postingHash } : {}) };
      const result = await callFinanceApi('finance-workbench', body);
      if (isPreview) { setPreview(result); setConfirmed(false); return; }
      const sourceId = result.sourceId || result.verification?.sourceId;
      const after = await callFinanceApi('finance-workbench', { action: 'read', kind, sourceId });
      if (action === 'approve' && (!after.approved || after.sourceHash !== detail.sourceHash)) throw new Error('لم يثبت حفظ الاعتماد؛ لا تتابع الترحيل.');
      if (['save', 'capture'].includes(action) && after.sourceHash !== result.sourceHash) throw new Error('تغير المصدر بعد الحفظ؛ أعد القراءة قبل أي خطوة.');
      if (action === 'post' && (!after.protectedSource || !after.journalIds.length)) throw new Error('لم يثبت ربط القيد؛ لا تعِد الترحيل عميانيًا.');
      onMessage(action === 'post' ? `تحقق ربط المصدر بالقيد: ${after.journalIds.join('، ')}. هذا ترحيل لا صرف.`
        : action === 'approve' ? 'حُفظ اعتماد النسخة الحالية وتحققت إعادة قراءته. لم يُرحّل أو يُدفع.' : 'حُفظ المصدر غير المرحّل وتحققت إعادة قراءته. يحتاج مراجعة واعتمادًا منفصلين.');
      onSaved(sourceId);
    } catch (e) { setError(`${e.message} عند غموض نتيجة الحفظ، أعد قراءة المصدر قبل المحاولة.`); }
    finally { setBusy(false); }
  }
  return <>
    <div className="fw-meta"><span className="fw-badge">{requestId ? 'مستند جديد غير مرحّل' : stageLabels[detail.stage]}</span>{detail && <code>{detail.sourceId}</code>}</div>
    <h2><ShieldCheck size={19} /> {requestId ? 'تسجيل المستند' : 'المصدر والمراجعة'}</h2>
    {protectedRow && <div className="fw-warning">السجل محمي أو الفترة مقفلة؛ العرض فقط. لا حذف أو تعديل قيد قائم من هنا.</div>}
    {detail?.journalIds?.length > 0 && <p>القيود المرتبطة: {detail.journalIds.join('، ')}</p>}
    {error && <div className="fw-warning" role="alert">{error}</div>}
    <div className="fw-form">
      {input('وصف المصروف', 'description')}{input('المبلغ المسجل بالريال', 'amount', 'number')}{input('تاريخ المصروف الفعلي', 'date', 'date')}{input('الكمية المثبتة', 'quantity', 'number')}
      <label>التصنيف المثبت<select aria-label="تصنيف المصروف" value={form.classification} disabled={protectedRow || busy || (Boolean(detail) && ['annual', 'startup'].includes(kind))}
        onChange={e => set('classification', e.target.value)}><option value="">غير محدد</option>{(options.data?.items || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        {options.data?.limited && <small>قائمة التصنيفات محدودة؛ لا تختَر بدلًا من بند غير ظاهر.</small>}</label>
      {input('المورد', 'supplier')}{input('رقم الفاتورة الحقيقي', 'invoiceNumber')}{input('تاريخ الفاتورة', 'invoiceDate', 'date')}{input('رابط المستند الأصلي HTTPS', 'invoiceUrl', 'url')}
      {select('نوع المستند', 'isTaxInvoice', [['', 'غير محسوم'], ['true', 'فاتورة ضريبية مثبتة'], ['false', 'مستند غير ضريبي']])}
      {input('مبلغ الضريبة المطبوع — الفراغ غير متاح', 'vatAmount', 'number')}{input('النسبة الصريحة كعدد عشري — دون افتراض', 'vatRate', 'number')}
      {select('وضع السعر المثبت', 'priceMode', [['', 'غير محدد'], ['inclusive', 'شامل الضريبة'], ['exclusive', 'غير شامل الضريبة']])}
      {select('أهلية المدخلات بعد المراجعة', 'vatDeductible', [['', 'غير محسومة'], ['true', 'مؤهلة بدليل'], ['false', 'لا مطالبة مدخلات']])}
      {input('مرجع المراجعة الضريبية للأهلية', 'taxReviewRef')}
      {select('مصدر نسبة الضريبة بعد التحقق', 'taxBasis', [['document', 'مبلغ أو نسبة صريحة من المستند'], ['verified_historical_policy', 'سياسة تاريخية متحقق منها بمرجع مراجعة']])}
      {select('حالة السداد المثبتة — ليست أمر صرف', 'paymentStatus', [['unknown', 'غير مثبتة'], ['unpaid', 'ذمة مورد غير مسددة'], ['paid', 'سداد وقع بالفعل بدليله']])}
      {select('طريقة الدفع أو الذمة', 'paymentMethod', [['unknown', 'غير محددة'], ['cash', 'نقد'], ['transfer', 'تحويل'], ['card', 'بطاقة'], ['credit', 'ذمة مورد']])}
      {input('تاريخ السداد الفعلي إن ثبت', 'paidDate', 'date')}
      {select('مصدر التمويل المثبت', 'fundingType', [['unknown', 'غير مثبت'], ['company_cash', 'صندوق المنشأة'], ['company_bank', 'بنك المنشأة'], ['vendor_liability', 'ذمة مورد'], ['partner', 'دفع شريك — المقابل يحتاج حسمًا'], ['employee', 'تمويل موظف — المقابل يحتاج حسمًا']])}
      {input('مرجع إثبات التمويل أو الذمة', 'fundingReference')}{input('غرض المشروع المثبت', 'purpose')}
      <label className="fw-wide">مراجع الأدلة — مرجع واحد في كل سطر<textarea value={form.evidenceRefs} onChange={e => set('evidenceRefs', e.target.value)} disabled={protectedRow || busy} /></label>
    </div>
    {(preview?.issues || detail?.issues || []).length > 0 && <div className="fw-warning"><div><strong>نواقص تمنع الاعتماد:</strong><ul>{(preview?.issues || detail?.issues || []).map((issue, i) => <li key={i}>{issue}</li>)}</ul></div></div>}
    {preview && <ChangePreview kind={kind} preview={preview} options={options.data?.items || []} />}
    {previewData?.lines?.length > 0 && <details className="fw-panel"><summary>معاينة القيد من المسار الخادمي</summary>
      {[previewData, ...(previewData.settlement ? [previewData.settlement] : [])].map((entry, i) => <div key={i}>
        <p>{entry.entry.description} · {entry.entry.entryDate}</p><div className="fw-table-scroll"><table><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>
          {entry.lines.map((line, index) => <tr key={index}><td>{line.accountId} — {line.description}</td><td>{line.debit}</td><td>{line.credit}</td></tr>)}
        </tbody></table></div></div>)}<small>معاينة فقط، ليست قيدًا محفوظًا أو تحصيلًا أو صرفًا.</small></details>}
    {!protectedRow && <><label className="fw-form">سبب الخطوة ودليلها<input value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> أؤكد تنفيذ الخطوة المحددة أدناه فقط بعد مراجعة المستند والنسخة الحالية.</label>
      <div className="fw-actions">
        <button type="button" disabled={busy || options.loading || Boolean(options.error)} onClick={() => execute(requestId ? 'previewCapture' : 'preview')}>معاينة دون حفظ</button>
        <button type="button" disabled={busy || !confirmed || reason.trim().length < 3 || !preview} onClick={() => execute(requestId ? 'capture' : 'save')}>حفظ المصدر غير المرحّل</button>
        {detail && <><button type="button" disabled={busy || dirty || !confirmed || reason.trim().length < 3 || !detail.postingPreview?.ready || detail.approved}
          onClick={() => execute('approve')}>اعتماد هذه النسخة فقط</button>
          <button type="button" disabled={busy || dirty || !confirmed || !detail.approved || !detail.postingPreview?.ready} onClick={() => execute('post')}>ترحيل المصروف المعتمد</button></>}
        {onCancel && <button type="button" disabled={busy} onClick={onCancel}>إلغاء دون حفظ</button>}
      </div></>}
    <small>المراجعة والتحقق هنا ذاتيان موثقان، ولا يوصفان برقابة مستقلة. لا تغيّر حالة السداد دون مستند ولا تستخدم دفعة شخصية كدليل بنك المنشأة.</small>
  </>;
}
function ChangePreview({ kind, preview, options }) {
  const labels = { description: 'وصف المصروف', amount: 'المبلغ المسجل بالريال', date: 'تاريخ المصروف الفعلي', quantity: 'الكمية المثبتة',
    unitCost: 'تكلفة الوحدة', classification: 'التصنيف المثبت', supplier: 'المورد', invoiceNumber: 'رقم الفاتورة الحقيقي', invoiceDate: 'تاريخ الفاتورة',
    invoiceUrl: 'رابط المستند الأصلي HTTPS', isTaxInvoice: 'نوع المستند', vatAmount: 'مبلغ الضريبة', vatRate: 'نسبة الضريبة',
    vatDeductible: 'أهلية المدخلات بعد المراجعة', priceMode: 'وضع السعر المثبت', paymentMethod: 'طريقة الدفع أو الذمة', paymentStatus: 'حالة السداد',
    paidDate: 'تاريخ السداد الفعلي إن ثبت', fundingType: 'مصدر التمويل المثبت', fundingReference: 'مرجع إثبات التمويل أو الذمة',
    purpose: 'غرض المشروع المثبت', evidenceRefs: 'مراجع الأدلة — مرجع واحد في كل سطر', taxReviewRef: 'مرجع المراجعة الضريبية للأهلية', taxBasis: 'مصدر نسبة الضريبة بعد التحقق' };
  const values = { true: 'نعم', false: 'لا', unknown: 'غير مثبت', paid: 'سداد وقع بالفعل بدليله', unpaid: 'ذمة مورد غير مسددة',
    company_cash: 'صندوق المنشأة', company_bank: 'بنك المنشأة', vendor_liability: 'ذمة مورد', partner: 'دفع شريك — المقابل يحتاج حسمًا', employee: 'تمويل موظف — المقابل يحتاج حسمًا',
    cash: 'نقد', transfer: 'تحويل', card: 'بطاقة', credit: 'ذمة مورد', inclusive: 'شامل الضريبة', exclusive: 'غير شامل الضريبة',
    document: 'مبلغ أو نسبة صريحة من المستند', verified_historical_policy: 'سياسة تاريخية متحقق منها بمرجع مراجعة' };
  const before = { ...fromRow(kind, preview.before), unitCost: preview.before.unit_cost ?? '' };
  const after = { ...fromRow(kind, preview.after), unitCost: preview.after.unit_cost ?? '' };
  const changed = Object.keys(labels).filter(key => String(before[key]) !== String(after[key]));
  const show = (key, value) => key === 'classification' ? options.find(o => o.id === value)?.label || value || 'غير متاح'
    : value === '' || value === null || value === undefined ? 'غير متاح' : values[value] || String(value);
  return <details className="fw-panel" open><summary>معاينة التغيير — لم يُحفظ</summary>{changed.length ? <div className="fw-table-scroll"><table>
    <thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead><tbody>{changed.map(key => <tr key={key}><th scope="row">{labels[key]}</th><td>{show(key, before[key])}</td><td>{show(key, after[key])}</td></tr>)}</tbody>
  </table></div> : <p>لا تغيير في الحقول المعروضة.</p>}</details>;
}
