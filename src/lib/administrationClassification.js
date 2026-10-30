// Proposed presentation only. Never updates a source, a recovery or a journal.
export const ADMINISTRATION_GROUPS = Object.freeze({
  advances: 'السلف في صفحة البايكر', salary: 'رواتب الإدارة', official: 'الرسوم الحكومية والرسمية',
  housing: 'السكن', review: 'يحتاج تصنيفًا من هادي',
});
const normalize = value => String(value || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْ]/g, '');
export function temporaryClassification(row) {
  const title = row.title || row.expense_name || row.extra?.expense_name || 'وصف غير مسجل';
  const date = row.spentDate || row.spent_date || row.expense_date || row.extra?.expense_date || null;
  const bikerId = row.bikerId || row.biker_id || null;
  const text = normalize(`${title} ${row.notes || ''}`);
  let group = 'review', note = 'ما طبيعة هذا المبلغ والجهة التي تتحمله؟';
  if (bikerId || row.category === 'worker_advance' || row.extra?.category === 'worker_advance' || /سلف/.test(text)) {
    group = 'advances'; note = bikerId ? 'الخصم والاسترداد من مسار المسير الحالي فقط.' : 'سلفة جماعية؛ يلزم توزيع موثق على البايكرية قبل ربط الخصم.';
  } else if (/كهرباء.*سكن|سكن.*كهرباء/.test(text)) {
    group = 'housing'; note = 'مكتوب أنه يخصم من الإيجار؛ هل تمت المقاصة مع المؤجر؟ لا يحتسب مصروفًا ثانيًا.';
  } else if (/راتب|رابت/.test(text) && /مشرف|احمد/.test(text)) {
    group = 'salary'; note = 'مصروف على الشركة حسب قرار هادي؛ إعادة التصنيف تنتظر الموافقة.';
  } else if (/رسوم|قوى|سجل تجاري|بدل سعوده|تعديل حساب/.test(text)) {
    group = 'official'; note = /تعديل حساب/.test(text) ? 'ما طبيعة رسم تعديل الحساب؟ المقترح على الشركة وفق قرار رسوم الشركاء.' : 'على الشركة، ولو كان مرتبطًا بشريك أو أحد أقاربه.';
  }
  const amount = Number(row.amount) || 0;
  const recovered = row.status === 'recovered' ? amount : Math.min(amount, Math.max(0, Number(row.recoveredAmount ?? row.recovered_amount) || 0));
  return { source: row, id: row.id, title, date, amount, group, destination: ADMINISTRATION_GROUPS[group], note,
    bikerId, status: row.status, recovered, outstanding: Math.round((amount - recovered) * 100) / 100,
    // Settled by expense documents paid from this custody (workbench «من عهدة شخص» / «دفع موظف»).
    documentRecovered: Math.max(0, Number(row.documentRecovered) || 0), recoveryMethod: row.recoveryMethod ?? row.recovery_method ?? null,
    assignmentMonth: row.assignmentMonth || row.assignment_month || null };
}
export const temporaryProposals = rows => rows.map(temporaryClassification);
