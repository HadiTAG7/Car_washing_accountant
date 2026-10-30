import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { callFinanceApi } from '../lib/financeApi';
import { when } from '../lib/founding/foundingFormat';
import FinanceInvoiceLines from './FinanceInvoiceLines';

const COMPLETION_FIELD_LABELS = { purpose: 'سبب المصروف للمشروع', quantity: 'الكمية وطريقتها', taxReviewRef: 'مرجع مراجعة الضريبة' };
const quantityText = value => !value ? 'غير مسجلة'
  : value.mode === 'lines' ? `بنود مختلفة من الفاتورة: ${value.items} بنود بمجموع ${value.total ?? 'غير متاح'}`
  : value.quantity == null ? 'غير مسجلة' : `كمية متجانسة: ${value.quantity} × ${value.unitCost ?? 'غير متاح'}`;
const shown = (key, value) => key === 'quantity' ? quantityText(value) : value == null || value === '' ? 'غير مسجل' : String(value);

/**
 * «استكمال المستند المرحّل»: على مستند له قيد سارٍ، يستكمل الأدمن الحقول غير المالية فقط — سبب المصروف،
 * والكمية وطريقتها، ومرجع مراجعة الضريبة. الخادم يعيد بناء القيد قبل وبعد ويرفض أي فرق، فلا يتغير المبلغ
 * ولا الحسابات ولا القيود، ويحفظ على المستند من استكمل وماذا ومتى ولماذا.
 */
export default function FinancePostedCompletion({ kind, detail, busy, onDone, onMessage }) {
  const row = detail?.row || {}, meta = row.finance_metadata || {}, savedLines = meta.invoiceLines || null;
  const [purpose, setPurpose] = useState(meta.purpose || ''), [taxReviewRef, setTaxReviewRef] = useState(meta.taxReviewRef || '');
  const [mode, setMode] = useState(savedLines ? 'lines' : 'single'), [quantity, setQuantity] = useState(row.quantity ?? '');
  const [lines, setLines] = useState(savedLines ? structuredClone(savedLines) : { version: 1, items: [], vatAllocation: null });
  const [reason, setReason] = useState(''), [preview, setPreview] = useState(null), [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  if (!detail?.completion?.available) return null;
  const history = detail.completion.history || [], exception = Boolean(meta.quantityException);
  const completion = {
    ...(purpose.trim() && purpose.trim() !== (meta.purpose || '') ? { purpose: purpose.trim() } : {}),
    ...(taxReviewRef.trim() && taxReviewRef.trim() !== (meta.taxReviewRef || '') ? { taxReviewRef: taxReviewRef.trim() } : {}),
    ...(exception ? {} : mode === 'single' ? (quantity !== '' && (savedLines || Number(quantity) !== row.quantity) ? { quantityMode: 'single', quantity: Number(quantity) } : {})
      : JSON.stringify(lines) !== JSON.stringify(savedLines) && lines.items.length ? { quantityMode: 'lines', invoiceLines: lines } : {}),
  };
  const changed = Object.keys(completion).length > 0, off = busy || working;
  const edit = setter => value => { setter(value); setPreview(null); setConfirmed(false); setError(''); };
  async function run(action) {
    setWorking(true); setError('');
    try {
      const common = { kind, sourceId: detail.sourceId, sourceHash: detail.sourceHash, completion };
      if (action === 'previewCompletion') { setPreview(await callFinanceApi('finance-workbench', { ...common, action })); return; }
      await callFinanceApi('finance-workbench', { ...common, action, previewHash: preview.previewHash, reason: reason.trim(), confirm: true });
      setPreview(null); setConfirmed(false); setReason('');
      onMessage?.('استُكمل المستند المرحّل. لم يتغير المبلغ ولا الحسابات ولا القيود، وحُفظ اسمك ووقت التعديل.');
      onDone(detail.sourceId);
    } catch (e) { setError(e.message); } finally { setWorking(false); }
  }
  return <section className="fw-form-section" aria-label="استكمال المستند المرحّل">
    <h3 className="fw-form-section-title"><ClipboardCheck size={17} /> استكمال المستند المرحّل</h3>
    <p>للحقول غير المالية فقط: سبب المصروف، والكمية وطريقتها، ومرجع مراجعة الضريبة. لا يتغير المبلغ ولا الحسابات ولا القيود — الخادم يعيد بناء القيد قبل وبعد ويرفض أي فرق. يُحفظ اسمك ووقت التعديل وسببه على المستند.</p>
    {error && <div className="fw-warning" role="alert">{error}</div>}
    <div className="fw-form">
      <label className="fw-wide">سبب المصروف للمشروع<input value={purpose} onChange={e => edit(setPurpose)(e.target.value)} disabled={off} /></label>
      {exception ? <p className="fw-wide">الكمية مثبتة باستثناء بقرار هادي؛ لا تُستكمل من هنا.</p> : <>
        <label>طريقة تمثيل الكمية<select value={mode} onChange={e => edit(setMode)(e.target.value)} disabled={off}>
          <option value="single">كمية متجانسة واحدة</option><option value="lines">بنود مختلفة من الفاتورة</option></select></label>
        {mode === 'single' && <label>الكمية<input type="number" step="any" min="0" value={quantity} onChange={e => edit(setQuantity)(e.target.value)} disabled={off} /></label>}
      </>}
      <label>مرجع مراجعة الضريبة<input value={taxReviewRef} onChange={e => edit(setTaxReviewRef)(e.target.value)} disabled={off} /></label>
    </div>
    {!exception && mode === 'lines' && <FinanceInvoiceLines value={lines} onChange={edit(setLines)} disabled={off} amount={String(row.amount ?? row.total_variable_cost ?? row.total_monthly_cost ?? '')}
      vatAmount={row.vat_amount ?? ''} taxReviewRef={taxReviewRef} isTaxInvoice={String(row.is_tax_invoice)} />}
    {preview && <div className="fw-table-scroll"><table aria-label="معاينة الاستكمال"><thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead><tbody>
      {Object.entries(preview.fields).map(([key, value]) => <tr key={key}><th scope="row">{COMPLETION_FIELD_LABELS[key]}</th><td>{shown(key, value.before)}</td><td>{shown(key, value.after)}</td></tr>)}
    </tbody></table><p className="fw-success" role="note">معالجة القيد لم تتغير: نفس الحسابات والمبالغ والضريبة والتاريخ. لم يُحفظ بعد.</p></div>}
    {preview && <div className="fw-confirm-step"><label>سبب الاستكمال<input value={reason} onChange={e => setReason(e.target.value)} disabled={off} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={off} /> أؤكد استكمال هذه الحقول غير المالية فقط؛ لا يتغير المبلغ ولا الحسابات ولا القيود.</label></div>}
    <div className="fw-actions">
      {!preview ? <button type="button" disabled={off || !changed} onClick={() => run('previewCompletion')}>{working ? 'جارٍ التحقق…' : 'معاينة الاستكمال'}</button>
        : <button type="button" className="fw-primary" disabled={off || !confirmed || reason.trim().length < 3} onClick={() => run('complete')}>{working ? 'جارٍ الحفظ…' : 'احفظ الاستكمال'}</button>}
    </div>
    {history.length > 0 && <details className="fw-form-section" open><summary>سجل الاستكمال ({history.length})</summary><ul>
      {history.map((item, index) => <li key={index}>{item.fields.map(key => COMPLETION_FIELD_LABELS[key] || key).join('، ')} — <bdi>{item.byName || 'غير معروف'}</bdi> <bdi>{when(item.atIso)}</bdi>{item.reason ? ` · «${item.reason}»` : ''}</li>)}
    </ul></details>}
  </section>;
}
