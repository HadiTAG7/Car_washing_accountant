import { monthlyStatement, monthRange, DEFAULT_FEE_RULES } from './accounting/monthlyStatement.js';
import { round2, isBalanced } from './accounting/journal.js';
import { isRealCalendarDate } from './vatFields.js';

const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && isRealCalendarDate(date);
const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value));
const qty = value => numeric(value) && Number(value) >= 0 ? Number(value) : null;
const FINANCIAL_FIELDS = ['netRevenue', 'directCosts', 'operatingExpenses', 'netProfitBeforeFees', 'totalFees', 'netProfit'];

function sourceGoals() {
  return {
    status: 'source-documented-period-unbound', synchronized: false, approval: 'unconfirmed',
    source: {
      url: 'https://docs.google.com/spreadsheets/d/1QNl_S8IOUKXDl1IKK3vLFuZm-cw3mYFwEquZC6NWqUU/edit#gid=2100000004',
      sheet: 'kpi', range: 'A1:H30', inspectedAt: '2026-10-04T16:34:01Z',
    },
    months: [null, null, null],
    metrics: [
      { key: 'without-discount', label: 'الغسلات دون خصم', target: 0.9, unit: 'ratio', period: 'monthly', direction: 'higher', actual: null, progress: null, targetCell: 'E3' },
      { key: 'general-expenses', label: 'المصروفات العامة', target: 5000, unit: 'SAR', period: 'monthly', direction: 'lower', actual: null, progress: null, targetCell: 'E4' },
    ],
  };
}

// Pure, read-only calculation. Existing monthly financial policy is unchanged.
export function supervisorReport(data, periodKey) {
  const { from, to } = monthRange(periodKey);
  if (!from) throw new Error('اختر شهراً صحيحاً.');
  const entries = data.journal_entries || [];
  const accounts = data.chart_of_accounts || [];
  const entryIndex = new Map(entries.map(e => [e.id, e]));
  const lines = entries.flatMap(e => Array.isArray(e.lines) ? e.lines.map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` })) : [])
    .concat((data.journal_lines || []).filter(l => !Array.isArray(entryIndex.get(l.entryId)?.lines)));
  const rules = (data.fee_rules || []).filter(r => r.active !== false).map(r => ({ ...r, key: r.key || r.id, effectiveFrom: r.effective_from || null }));
  const issues = [];
  for (const name of ['chart_of_accounts', 'journal_entries', 'journal_lines', 'accounting_periods', 'fee_rules']) {
    if (!Array.isArray(data[name])) issues.push(`مصدر محاسبي غير متاح: ${name}.`);
  }
  if (!accounts.length) issues.push('دليل الحسابات غير متاح.');
  const accountCodes = new Set(accounts.map(a => String(a.code)));
  const invalidEntries = entries.filter(e => !validDate(e.entryDate));
  if (invalidEntries.length) issues.push('توجد قيود بتواريخ غير صالحة؛ لا يمكن إسنادها إلى شهر.');
  const monthEntries = entries.filter(e => e.entryDate >= from && e.entryDate <= to);
  const monthIds = new Set(monthEntries.map(e => e.id));
  const monthLines = lines.filter(l => monthIds.has(l.entryId));
  if (monthEntries.some(e => !['posted', 'reversed'].includes(e.status))) issues.push('توجد قيود غير مرحّلة في الشهر.');
  if (monthLines.some(l => !accountCodes.has(String(l.accountId)) || !numeric(l.debit) || !numeric(l.credit))) issues.push('توجد سطور محاسبية ناقصة أو حسابات غير معروفة.');
  if (monthEntries.some(e => {
    const rows = monthLines.filter(l => l.entryId === e.id);
    return rows.length === 0 || !isBalanced(rows);
  })) issues.push('توجد قيود غير متوازنة أو بلا سطور.');
  const applicable = (rules.length ? rules : DEFAULT_FEE_RULES).filter(r => !r.effectiveFrom || r.effectiveFrom <= to);
  const supervisorRules = applicable.filter(r => r.key === 'supervisor');
  const managementRules = applicable.filter(r => r.key === 'management');
  if (rules.some(r => !numeric(r.rate) || Number(r.rate) < 0 || !['profit', 'revenue'].includes(r.basis) || (r.effectiveFrom && !validDate(r.effectiveFrom)))) issues.push('قواعد الرسوم ناقصة أو غير صالحة.');
  if (supervisorRules.length !== 1 || supervisorRules[0]?.basis !== 'profit' || Number(supervisorRules[0]?.rate) !== 0.05) issues.push('سياسة رسوم المشرف لا تطابق قاعدة 5% من الربح؛ تحتاج مراجعة.');
  if (applicable.length !== 2 || managementRules.length !== 1 || managementRules[0]?.basis !== 'profit' || Number(managementRules[0]?.rate) !== 0.1) issues.push('سياسة رسوم الإدارة لا تطابق إجمالي 15%: 10% للإدارة و5% للمشرف على الأساس نفسه.');
  const statement = monthlyStatement({ accounts, entries, lines, periodKey, feeRules: rules });
  if (FINANCIAL_FIELDS.some(field => !Number.isFinite(statement[field])) || statement.fees.some(fee => !Number.isFinite(fee.amount))) issues.push('نتيجة مالية غير محدودة أو غير صالحة.');
  if (!statement.hasActivity) issues.push('لا توجد حركة مالية مرحّلة تؤكد نتيجة الشهر.');
  const period = (data.accounting_periods || []).find(p => (p.periodKey || p.id) === periodKey);
  const closed = period?.status === 'closed';
  if (!closed) issues.push('الشهر غير مقفل؛ نتيجة الشهر الكامل غير مؤكدة.');

  const bikers = data.bikers || [];
  const byId = new Map(bikers.map(b => [b.id, b]));
  const byName = new Map();
  for (const b of bikers) {
    const name = String(b.name || b.name_ar || b.name_en || '').trim();
    byName.set(name, [...(byName.get(name) || []), b]);
  }
  const actual = new Map(bikers.map(b => [b.id, { completedQuantity: 0, pendingQuantity: 0, invalidRows: 0 }]));
  let unknownDateRows = 0, unassignedQuantity = 0, unassignedRows = 0, invalidRows = 0, monthWashRows = 0, completedQuantity = 0, pendingQuantity = 0;
  for (const w of data.washes || []) {
    if (!validDate(w.wash_date)) { unknownDateRows += 1; continue; }
    if (w.wash_date < from || w.wash_date > to) continue;
    monthWashRows += 1;
    const candidates = byName.get(String(w.biker_name || '').trim()) || [];
    // A stale id must not silently fall back to a different person's name.
    const worker = w.biker_id ? byId.get(w.biker_id) : (candidates.length === 1 ? candidates[0] : null);
    const stats = worker ? actual.get(worker.id) : null;
    const amount = qty(w.quantity);
    if (amount === null || !['مكتملة', 'قيد التنفيذ'].includes(w.status)) {
      invalidRows += 1;
      if (stats) stats.invalidRows += 1;
      continue;
    }
    if (w.status === 'مكتملة') completedQuantity += amount;
    else pendingQuantity += amount;
    if (stats) stats[w.status === 'مكتملة' ? 'completedQuantity' : 'pendingQuantity'] += amount;
    else { unassignedQuantity += amount; unassignedRows += 1; }
  }
  const performanceComplete = Array.isArray(data.washes) && Array.isArray(data.bikers) && monthWashRows > 0
    && unknownDateRows === 0 && invalidRows === 0 && unassignedRows === 0
    && Number.isFinite(completedQuantity) && Number.isFinite(pendingQuantity)
    && [...actual.values()].every(stats => Number.isFinite(stats.completedQuantity) && Number.isFinite(stats.pendingQuantity));
  const financialComplete = issues.length === 0;
  const reference = financialComplete ? round2(Math.max(0, statement.netProfitBeforeFees) * 0.05) : null;
  return {
    periodKey, from, to,
    coverage: { financial: issues.length ? 'incomplete' : 'closed-ledger', issues, postedEntries: monthEntries.length, closed,
      performance: { source: 'washes', complete: performanceComplete, monthWashRows, unknownDateRows,
        unassignedQuantity: Number.isFinite(unassignedQuantity) ? unassignedQuantity : null, unassignedRows, invalidRows } },
    statement: financialComplete ? Object.fromEntries(FINANCIAL_FIELDS.map(field => [field, statement[field]])) : null,
    share: { rate: 0.05, basisField: 'netProfitBeforeFees', finalNetField: 'netProfit',
      basisAmount: financialComplete ? statement.netProfitBeforeFees : null,
      referenceAmount: Number.isFinite(reference) ? reference : null,
      managementRate: 0.1, combinedRate: 0.15, basisStatus: 'owner-confirmed',
      entitlementAmount: null, decision: 'reference-only' },
    kpis: { workers: Array.isArray(data.bikers) ? bikers.length : null,
      completedQuantity: performanceComplete ? completedQuantity : null,
      pendingQuantity: performanceComplete ? pendingQuantity : null },
    workers: bikers.map(b => ({ id: b.id, name: b.name || b.name_ar || b.name_en || 'اسم غير متاح',
      startDate: b.start_date || null, endDate: b.end_date || null,
      completedQuantity: performanceComplete ? actual.get(b.id).completedQuantity : null,
      pendingQuantity: performanceComplete ? actual.get(b.id).pendingQuantity : null,
      invalidRows: actual.get(b.id).invalidRows,
      target: null, achievement: null })),
    goals: sourceGoals(),
  };
}
