// Read/display helpers only. No inferred value is persisted or used to authorise a posting.
export const WORKBENCH_STAGES = {
  incomplete: 'ناقص', ready: 'جاهز للاعتماد', approved: 'معتمد غير مرحل',
  posted_unproven: 'مرحل والسداد غير مثبت', complete: 'مكتمل',
  posted_review: 'مرحل ويحتاج استكمال',
};
export const EXPENSE_KIND_LABELS = { variable: 'المتغيرة', monthly: 'الشهرية المفردة', annual: 'السنوية', startup: 'التأسيسية' };
const clean = value => String(value || '').normalize('NFKC').replace(/[\u064b-\u065f\u0670]/g, '').toLowerCase();
export function suggestedPaymentMethod(description, receiptType = '') {
  const text = clean(`${description} ${receiptType}`);
  const card = /مدى/.test(text), transfer = /تحويل|بنكي/.test(text);
  if (card && transfer) return null; // Ambiguous evidence needs a manual choice.
  return card ? 'card' : transfer ? 'transfer' : null;
}
export function hasPaymentConflict(row) {
  return row.payment_method === 'cash' && /تحويل|مدى|بنكي/.test(clean([
    row.expense_name, row.description, row.receipt_type, row.receiptType, row.document_type,
  ].filter(Boolean).join(' ')));
}
export function documentDay(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || ''));
  if (!match) return null;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
export function documentAge(date, today) {
  const day = documentDay(date), now = documentDay(today);
  return day && now ? Math.floor((Date.parse(`${now}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000) : null;
}
export function sumWorkbenchItems(items) {
  const missing = items.filter(item => !Number.isFinite(item.amount)).length;
  const knownAmount = Math.round(items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0) * 100) / 100;
  return { count: items.length, amount: missing ? null : knownAmount, knownAmount, missing };
}
export function filterWorkbenchItems(items, { month = '', kind = 'all', stage = 'all', search = '' } = {}) {
  const term = clean(search).trim();
  return items.filter(item => (!month || documentDay(item.date)?.slice(0, 7) === month)
    && (kind === 'all' || item.kind === kind)
    && (stage === 'all' || (stage === 'payment_conflict' ? item.paymentConflict : item.workflowStage === stage))
    && (!term || clean(`${item.title} ${item.supplier || ''} ${item.documentNumber || ''}`).includes(term)))
    .sort((a, b) => (documentDay(b.date) || '').localeCompare(documentDay(a.date) || '')
      || `${a.kind}:${a.sourceId}`.localeCompare(`${b.kind}:${b.sourceId}`));
}
export function workbenchCounters(items) {
  return Object.fromEntries([...Object.keys(WORKBENCH_STAGES), 'payment_conflict'].map(stage =>
    [stage, sumWorkbenchItems(filterWorkbenchItems(items, { stage }))]));
}
export const documentKey = item => `${item.kind}:${item.sourceId}`;
