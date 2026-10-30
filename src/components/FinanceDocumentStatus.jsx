import { FINANCE_BLOCKER_LABELS, PAYMENT_PROOF_LABELS } from '../lib/financeWorkflowDimensions';

const RULE_EVIDENCE = 'الغرض ودليل المراجعة غير مكتملين.';
const RULE_NAMES = { own_entry: 'قيده المرحّل على 2300', payment_correction: '«تصحيح جهة دفع» المرحّل إلى 2300' };

export default function FinanceDocumentStatus({ dimensions }) {
  const d = dimensions;
  const states = [['التسجيل', d.registration], ['التفاصيل', d.details], ['المراجعة', d.review],
    ['الاعتماد', d.approval], ['الترحيل', d.posting], ['السداد', d.payment]];
  const bool = value => value === true ? 'نعم' : value === false ? 'لا' : 'غير محسوم';
  return <section className="fw-read-status" aria-label="حقيقة التسجيل وحالات المستند">
    <h3 className="fw-form-section-title">حالة السجل المحفوظ</h3>
    <dl className="fw-document-status" aria-label="حالات المصروف المنفصلة">{states.map(([label, state]) => <div key={label}><dt>{label}</dt><dd>{state.label}</dd></div>)}</dl>
    <p className="fw-workbench-note">وجود نواقص أو موانع ترحيل لا يعني أن المستند غير مسجل. المراجعة المعلّقة ليست اعتمادًا.</p>
    <details className="fw-form-section"><summary>نواقص بيانات المصدر ({d.sourceGaps.length})</summary>
      {d.sourceGaps.length ? <ul>{d.sourceGaps.map(item => <li key={item.text}>{item.text}</li>)}</ul>
        : <p>لا يظهر نقص في البيانات الأساسية بهذا الفحص؛ قد تبقى موانع مالية أو ضريبية.</p>}
    </details>
    <details className="fw-form-section" open={d.postingBlockers.length > 0}><summary>موانع الاعتماد والترحيل ({d.postingBlockers.length})</summary>
      {d.postingBlockers.length ? <ul>{d.postingBlockers.map(item => <li key={item.text}><strong>{FINANCE_BLOCKER_LABELS[item.category]}: </strong>{item.text}</li>)}</ul>
        : <p>لا موانع ظاهرة من فحص البيانات. تبقى حماية المصدر والفترة وخطوة الاعتماد كما هي.</p>}
    </details>
    {d.ruleResolved?.length > 0 && <details className="fw-form-section" aria-label="محلولة بقاعدة فترة التأسيس"><summary>محلولة بقاعدة فترة التأسيس ({d.ruleResolved.length})</summary>
      <p>{PAYMENT_PROOF_LABELS.founding_rule}: دفعه هادي، والقيد {d.payment.ruleEntry != null ? <bdi dir="ltr">#{d.payment.ruleEntry}</bdi> : 'المرحّل'} ({RULE_NAMES[d.payment.rule] || 'على 2300'}).
        هذه لا تُعدّ موانع ولا تمنع الاكتمال:</p>
      <ul>{d.ruleResolved.map(item => <li key={item.text}><strong>{FINANCE_BLOCKER_LABELS[item.category]}: </strong>{item.text === RULE_EVIDENCE
        ? 'دليل المراجعة هو قيد القاعدة، وسبب المصروف مكتوب.' : item.text}</li>)}</ul>
    </details>}
    <details className="fw-form-section"><summary>حقائق الفاتورة المحفوظة</summary>
      <p>رقم الفاتورة: {d.sourceFacts.invoiceNumber == null || d.sourceFacts.invoiceNumber === '' ? 'غير مسجل في المصدر' : d.sourceFacts.invoiceNumber}</p>
      <p>فاتورة ضريبية: {bool(d.sourceFacts.isTaxInvoice)} · قابلة لخصم المدخلات: {bool(d.sourceFacts.vatDeductible)}</p>
      <p>مرجع مراجعة الضريبة: {d.sourceFacts.taxReviewRef || 'غير مسجل'}</p>
      <small>الرقم الغائب يبقى غائبًا. هذا العرض لا يغيّر نوع الفاتورة أو أهلية الضريبة أو شروط الترحيل.</small>
    </details>
  </section>;
}
