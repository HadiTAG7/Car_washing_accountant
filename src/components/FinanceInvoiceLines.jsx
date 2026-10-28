import { invoiceLinesTotal, MAX_FINANCE_INVOICE_LINES } from '../../functions/src/financeInvoiceLines';

export function InvoiceLinesRead({ value }) {
  if (!value) return <p>كمية متجانسة واحدة؛ لا توجد بنود مفصلة.</p>;
  const items = Array.isArray(value.items) ? value.items : [];
  return <><div className="fw-table-scroll"><table><thead><tr><th>البند</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>أساس سعر الوحدة</th><th>المبلغ</th><th>مرجع المصدر</th></tr></thead>
    <tbody>{items.map((line, index) => <tr key={line?.id || index}><td>{line?.description || 'غير مثبت'}{line?.amountNote && <small className="block">{line.amountNote}</small>}</td><td>{line?.quantity ?? 'غير مثبت'}</td>
      <td>{line?.unit || 'غير مثبت'}</td><td>{line?.unitCost ?? 'غير مثبت'}</td><td>{line?.amountSource === 'printed' ? line.unitPriceMode === 'exclusive' ? 'قبل الضريبة' : 'شامل الضريبة' : 'نفس أساس المستند'}</td>
      <td>{line?.amount ?? 'غير مثبت'}{line?.amountSource === 'printed' && <small className="block">إجمالي مطبوع في المصدر</small>}</td><td>{line?.sourceRef || 'غير مثبت'}</td></tr>)}</tbody></table></div>
    <p>مجموع البنود: {invoiceLinesTotal(value)} ريال</p>
    {value.vatAllocation && <p>الضريبة المطبوعة: {value.vatAllocation.printedVat ?? 'غير مثبتة'} · المؤهلة: {value.vatAllocation.eligibleVat ?? 'لم تُحسم'} · مرجع المراجعة: {value.vatAllocation.reviewRef || 'غير مثبت'}</p>}
  </>;
}

export default function FinanceInvoiceLines({ value, onChange, disabled, amount, vatAmount, taxReviewRef, isTaxInvoice }) {
  const items = Array.isArray(value?.items) ? value.items : [];
  const update = (index, key, next) => onChange({ ...value, items: items.map((line, at) => at === index ? { ...line, [key]: next } : line) });
  const numeric = event => event.target.value === '' ? '' : Number(event.target.value);
  const add = () => {
    let id = items.length + 1; while (items.some(line => line.id === `line-${id}`)) id++;
    onChange({ ...value, items: [...items, { id: `line-${id}`, description: '', quantity: '', unit: '', unitCost: '', amount: '', sourceRef: '' }] });
  };
  const tax = value?.vatAllocation;
  return <section className="fw-form-section fw-invoice-lines" aria-label="بنود الفاتورة المختلفة">
    <h3 className="fw-form-section-title">بنود الفاتورة المختلفة</h3>
    <p>انقل كل بند كما ورد في المصدر. لا تجمع وحدات مختلفة ولا تحسب سعرًا متوسطًا. المبالغ بنفس أساس السعر والضريبة للمستند.</p>
    {items.map((line, index) => <fieldset key={line.id || index} className="fw-form-section fw-invoice-lines__item" disabled={disabled}>
      <legend>البند {index + 1}</legend><div className="fw-form">
        <label>وصف البند<input value={line.description ?? ''} onChange={event => update(index, 'description', event.target.value)} /></label>
        <label>كمية البند<input type="number" step="any" value={line.quantity ?? ''} onChange={event => update(index, 'quantity', numeric(event))} /></label>
        <label>وحدة البند<input value={line.unit ?? ''} placeholder="كما في الفاتورة" onChange={event => update(index, 'unit', event.target.value)} /></label>
        <label>سعر وحدة البند<input type="number" step="any" value={line.unitCost ?? ''} onChange={event => update(index, 'unitCost', numeric(event))} /></label>
        <label>مبلغ البند<input type="number" step="0.01" value={line.amount ?? ''} onChange={event => update(index, 'amount', numeric(event))} /></label>
        <label>مرجع البند في المصدر<input value={line.sourceRef ?? ''} onChange={event => update(index, 'sourceRef', event.target.value)} /></label>
        <label>مصدر مبلغ البند<select value={line.amountSource || 'product'} onChange={event => onChange({ ...value, items: items.map((item, at) => at !== index ? item
          : event.target.value === 'printed' ? { ...item, amountSource: 'printed', unitPriceMode: '', amountNote: '' }
            : Object.fromEntries(Object.entries(item).filter(([key]) => !['amountSource', 'unitPriceMode', 'amountNote'].includes(key)))) })}>
          <option value="product">الكمية × السعر على أساس المستند نفسه</option><option value="printed">إجمالي مطبوع بسعر وحدة على أساس ضريبي مختلف</option>
        </select></label>
        {line.amountSource === 'printed' && <>
          <label>أساس سعر الوحدة المطبوع<select value={line.unitPriceMode || ''} onChange={event => update(index, 'unitPriceMode', event.target.value)}>
            <option value="">غير مثبت</option><option value="exclusive">قبل الضريبة</option><option value="inclusive">شامل الضريبة</option></select></label>
          <label>توضيح أساس الإجمالي المطبوع وتقريب المورد<input value={line.amountNote || ''} onChange={event => update(index, 'amountNote', event.target.value)} /></label>
          <small>انسخ الإجمالي المطبوع كما هو؛ لا نستخرج منه ضريبة سطر أو نعيد حساب تقريب المورد.</small>
        </>}
      </div><button type="button" className="fw-secondary" disabled={disabled} onClick={() => onChange({ ...value, items: items.filter((_, at) => at !== index) })}>إزالة البند {index + 1} من المسودة</button>
    </fieldset>)}
    <button type="button" className="fw-secondary" disabled={disabled || items.length >= MAX_FINANCE_INVOICE_LINES} onClick={add}>إضافة بند من الفاتورة</button>
    <p>مجموع البنود: {invoiceLinesTotal(value)} ريال · إجمالي المستند: {amount === '' ? 'غير مثبت' : amount} ريال. لا يتغير الإجمالي تلقائيًا.</p>
    {(isTaxInvoice === 'true' || tax) && <div className="fw-form-section">
      <label><input type="checkbox" checked={Boolean(tax)} disabled={disabled} onChange={event => onChange({ ...value, vatAllocation: event.target.checked
        ? { printedVat: vatAmount === '' ? '' : Number(vatAmount), eligibleVat: null, reviewRef: taxReviewRef || null } : null })} /> تفصيل أهلية ضريبة البنود من المراجعة</label>
      {tax && <div className="fw-form">
        <label>ضريبة البنود المطبوعة<input type="number" step="0.01" disabled={disabled} value={tax.printedVat ?? ''} onChange={event => onChange({ ...value, vatAllocation: { ...tax, printedVat: numeric(event) } })} /></label>
        <label>ضريبة البنود المؤهلة — اتركها فارغة إن لم تُحسم<input type="number" step="0.01" disabled={disabled} value={tax.eligibleVat ?? ''} onChange={event => onChange({ ...value, vatAllocation: { ...tax, eligibleVat: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
        <label>مرجع مراجعة ضريبة البنود<input disabled={disabled} value={tax.reviewRef || ''} onChange={event => onChange({ ...value, vatAllocation: { ...tax, reviewRef: event.target.value || null } })} /></label>
      </div>}
      <small>لا تستنتج الأهلية من الضريبة المطبوعة. الخصم الجزئي يبقى موقوفًا إذا لم يدعمه مسار الترحيل.</small>
    </div>}
  </section>;
}
