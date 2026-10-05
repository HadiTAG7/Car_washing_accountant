// Management allocation only. Never posts, reclassifies, transfers cash, or
// changes the official company income statement. Annual amounts are a renewal
// reserve (not a second recognition of the first annual payment).
import { monthlyStatement, DEFAULT_FEE_RULES, monthRange } from './monthlyStatement.js';
import { postedLines, incomeStatementLines, sourceKindOf } from './reports.js';
import { ACC } from './chartOfAccounts.js';
import { round2 } from './journal.js';
import { ADAPTERS } from './sourceAdapters.js';
import { templateActiveIn } from './recurring.js';
import { taxPolicyAt } from './taxPolicy.js';

const GROUPS = [
  ['variable', 'المصروفات المتغيرة والعمولات'],
  ['monthly', 'المصروفات الشهرية والرواتب'],
  ['annual', 'احتياطي التجديد السنوي — حصة الشهر'],
  ['other', 'مصروفات أخرى'],
];
const sourceKey = (kind, id) => `${kind}:${id}`;
const datedMonth = date => String(date || '').slice(0, 7);

// Older postings used sourceType='expense' without sourceKind. Resolve only
// an exact, unique stored source identity; never match an amount or a name.
export function normalizePartnerEntrySources(entries, sources) {
  const kindsById = new Map();
  for (const [kind, rows] of Object.entries(sources)) {
    for (const row of rows) {
      const kinds = kindsById.get(row.id) || [];
      if (!kinds.includes(kind)) kinds.push(kind);
      kindsById.set(row.id, kinds);
    }
  }
  const normalized = entries.map(e => {
    if (e.reversalOf || e.sourceKind || e.sourceType !== 'expense') return e;
    const kinds = kindsById.get(e.sourceId) || [];
    if (kinds.length > 1) throw new Error('أصل قيد مصروف قديم ملتبس؛ يلزم تدقيقه قبل تأكيد حسبة الشريك.');
    return kinds.length ? { ...e, sourceKind: kinds[0] } : e;
  });
  const index = new Map(normalized.map(e => [e.id, e]));
  return normalized.map(e => e.reversalOf && sourceKindOf(e) === 'expense'
    ? { ...e, reversedSourceKind: sourceKindOf(index.get(e.reversalOf)) } : e);
}

// Allocate cumulative cents rather than rounding 12 independent fractions.
// The twelve scheduled shares sum to the annual amount. Actual reservations
// can be lower: they are funded only from that month's available profit.
export function annualMonthlyShare(annualAmount, periodKey, factor = 1) {
  const month = Number(String(periodKey).slice(5, 7));
  const cents = Math.round(Number(annualAmount) * factor * 100);
  return (Math.round(cents * month / 12) - Math.round(cents * (month - 1) / 12)) / 100;
}

export function partnerOperatingStatement({
  accounts = [], entries = [], lines = [], periodKey, scalingFactor = 1,
  feeRules = null, monthlyExpenses = [], variableExpenses = [], annualExpenses = [],
  vouchers = [], settings = {},
  dynamicCommissions = [], dynamicVariableIds = [],
} = {}) {
  const range = monthRange(periodKey);
  if (!range.from) throw new Error('شهر التقرير غير صالح.');
  const factor = Math.max(0, Number(scalingFactor) || 0);
  entries = normalizePartnerEntrySources(entries, { monthly: monthlyExpenses, variable: variableExpenses, voucher: vouchers });
  const ledgerStatement = monthlyStatement({ accounts, entries, lines, periodKey, scalingFactor: factor });
  const accountIndex = new Map(accounts.map(a => [String(a.code), a]));
  const expenseCodes = new Set(accounts.filter(a => a.accountType === 'expense').map(a => String(a.code)));
  const entryIndex = new Map(entries.map(e => [e.id, e]));
  const seen = new Set();
  for (const e of entries) {
    if (e.status !== 'posted' && e.status !== 'reversed') continue;
    const original = e.reversalOf ? entryIndex.get(e.reversalOf) : e;
    if (original?.sourceId) seen.add(sourceKey(sourceKindOf(original), original.sourceId));
  }
  const items = [];
  const sources = new Map([
    ...monthlyExpenses.map(r => [sourceKey('monthly', r.id), r.expense_name]),
    ...variableExpenses.map(r => [sourceKey('variable', r.id), r.expense_name]),
    ...vouchers.map(r => [sourceKey('voucher', r.id), r.templateName]),
  ]);
  for (const line of incomeStatementLines(entries, lines, range)) {
    const code = String(line.accountId);
    if (!expenseCodes.has(code)) continue;
    const kind = sourceKindOf(entryIndex.get(line.entryId));
    // Initial setup stays in the books and is charged to founding only once.
    // Annual payments are likewise separate from the monthly renewal reserve.
    if (kind === 'annual' || kind === 'startup') continue;
    const groupKey = code === ACC.SALARY_EXPENSE ? 'monthly'
      : kind === 'variable' || [ACC.BIKER_COMMISSION, ACC.VARIABLE_COSTS].includes(code) ? 'variable'
        : ['monthly', 'voucher'].includes(kind) || code === ACC.RENT_MONTHLY ? 'monthly' : 'other';
    const rawAmount = round2((Number(line.debit) || 0) - (Number(line.credit) || 0));
    if (!rawAmount) continue;
    items.push({ id: `ledger:${line.id}`, groupKey, entryDate: line.entryDate, accountingPeriod: line.accountingPeriod,
      // Do not send payroll line descriptions or names to another partner.
      description: sources.get(sourceKey(kind, entryIndex.get(line.entryId)?.sourceId))
        || accountIndex.get(code)?.nameArabic || 'مصروف مرحّل',
      accountName: 'مسجل في الدفاتر', rawAmount, amount: round2(rawAmount * factor),
      section: accountIndex.get(code)?.directCost ? 'direct' : 'operating', basis: 'posted' });
  }

  // Match the variable-expense page's automatic wash commission, without
  // returning a worker name. A posted payroll/commission takes precedence.
  for (const row of dynamicCommissions.filter(r => r.periodKey === periodKey)) {
    const hasCommission = postedLines(entries, lines, range).some(l => {
      const e = entryIndex.get(l.entryId);
      const original = e?.reversalOf ? entryIndex.get(e.reversalOf) : e;
      return String(l.accountId) === ACC.BIKER_COMMISSION
        || (sourceKindOf(original) === 'variable' && dynamicVariableIds.includes(original?.sourceId));
    });
    if (hasCommission) break;
    const rawAmount = round2(Number(row.amount) || 0);
    items.push({ id: `commission:${row.id}:${periodKey}`, groupKey: 'variable', entryDate: `${periodKey}-01`,
      description: 'عمولات الغسلات المكتملة', accountName: 'حسب سجل التشغيل', rawAmount,
      amount: round2(rawAmount * factor), section: 'direct', basis: 'operational' });
  }

  const addSource = (kind, row, groupKey) => {
    if (seen.has(sourceKey(kind, row.id))) return;
    const adapter = ADAPTERS[kind];
    const built = adapter.build(row, { policyAt: date => taxPolicyAt(settings, date) });
    const cost = built.lines.filter(l => expenseCodes.has(String(l.accountId)))
      .reduce((sum, l) => sum + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    if (built.lines.some(l => Number(l.debit) > 0) && !built.lines.some(l => expenseCodes.has(String(l.accountId)))) {
      throw new Error('حساب المصروف غير موجود في دليل الحسابات؛ لا يمكن عرض المصروف بصفر.');
    }
    items.push({ id: `${kind}:${row.id}`, groupKey, entryDate: built.entry.entryDate,
      description: row.expense_name || row.templateName || 'مصروف مسجل',
      accountName: 'مسجل ولم يُرحّل', rawAmount: round2(cost), amount: round2(cost * factor),
      section: groupKey === 'variable' ? 'direct' : 'operating', basis: 'recorded' });
  };
  for (const row of variableExpenses) {
    if (datedMonth(row.invoice_date || row.logged_date) === periodKey) addSource('variable', row, 'variable');
  }
  for (const row of vouchers) {
    if (row.periodKey === periodKey && row.status !== 'cancelled') addSource('voucher', row, 'monthly');
  }
  for (const row of monthlyExpenses) {
    if (row.recurrence === 'one_time' || row.logged_date) {
      if (datedMonth(row.invoice_date || row.logged_date) === periodKey) addSource('monthly', row, 'monthly');
      continue;
    }
    if (!templateActiveIn(row, periodKey)) continue;
    // A cancelled voucher also suppresses its template; cancellation must
    // never silently reintroduce the original cost.
    if (vouchers.some(v => v.templateId === row.id && v.periodKey === periodKey)) continue;
    const id = `${row.id}__${periodKey}`;
    if (seen.has(sourceKey('voucher', id))) continue;
    const rawAmount = round2(Number(row.total_monthly_cost) || 0);
    items.push({ id: `template:${row.id}`, groupKey: 'monthly', entryDate: `${periodKey}-01`,
      description: row.expense_name || 'مصروف شهري', accountName: 'التزام شهري حسب البند المسجل',
      rawAmount, amount: round2(rawAmount * factor), section: 'operating', basis: 'scheduled' });
  }
  for (const row of annualExpenses) {
    if (row.active === false || (row.startPeriod && periodKey < row.startPeriod)
      || (row.endPeriod && periodKey > row.endPeriod)) continue;
    const annualAmount = round2(Number(row.annual_cost) || 0);
    items.push({ id: `reserve:${row.id}`, groupKey: 'annual', entryDate: `${periodKey}-01`,
      description: row.expense_name || 'بند سنوي', accountName: 'احتياطي للتجديد — ليس دفعة ثانية',
      annualAmount: round2(annualAmount * factor), rawAmount: annualAmount / 12,
      amount: annualMonthlyShare(annualAmount, periodKey, factor), section: 'reserve', basis: 'reserve' });
  }

  // Reconcile cents in operating costs independently of the reserve.
  for (const section of ['direct', 'operating']) {
    const rows = items.filter(i => i.section === section);
    const target = round2(rows.reduce((sum, i) => sum + i.rawAmount, 0) * factor);
    const delta = round2(target - rows.reduce((sum, i) => sum + i.amount, 0));
    if (rows.length && delta) rows.reduce((a, b) => Math.abs(a.rawAmount) > Math.abs(b.rawAmount) ? a : b).amount += delta;
  }
  const sum = rows => round2(rows.reduce((s, i) => s + i.amount, 0));
  const directCosts = sum(items.filter(i => i.section === 'direct'));
  const operatingExpenses = sum(items.filter(i => i.section === 'operating'));
  const totalCosts = round2(directCosts + operatingExpenses);
  const netProfitBeforeFees = round2(ledgerStatement.netRevenue - totalCosts);
  // Available profit is after operating costs and fee estimates, before the
  // renewal reservation. Rates, official fee postings and books stay intact.
  const rules = (feeRules?.length ? feeRules : DEFAULT_FEE_RULES).filter(r => !r.effectiveFrom || r.effectiveFrom <= range.to);
  const fees = rules.map(r => ({ ...r, amount: round2(Math.max(0, r.basis === 'profit' ? netProfitBeforeFees : ledgerStatement.netRevenue) * (Number(r.rate) || 0)) }));
  const totalFees = sum(fees);
  const netProfit = round2(netProfitBeforeFees - totalFees);
  const reserveItems = items.filter(i => i.section === 'reserve');
  const scheduledAmount = sum(reserveItems);
  const availableProfit = Math.max(0, netProfit);
  const annualReserve = round2(Math.min(Math.max(0, scheduledAmount), availableProfit));
  // Cumulative allocation keeps capped detail cents equal to the header.
  // Skipped months are not a debt and are not caught up in later months.
  let cumulativeScheduled = 0;
  let cumulativeReserved = 0;
  for (const item of reserveItems) {
    item.scheduledAmount = item.amount;
    cumulativeScheduled = round2(cumulativeScheduled + item.scheduledAmount);
    const target = scheduledAmount > 0 ? round2(annualReserve * cumulativeScheduled / scheduledAmount) : 0;
    item.amount = round2(target - cumulativeReserved);
    cumulativeReserved = target;
  }
  const totalAllocation = round2(totalCosts + annualReserve);
  const groups = GROUPS.map(([key, label]) => ({ key, label, items: items.filter(i => i.groupKey === key), amount: sum(items.filter(i => i.groupKey === key)) }));
  const renewalReserve = { scheduledAmount, availableProfit,
    reason: scheduledAmount <= 0 ? 'no-schedule' : availableProfit <= 0 ? 'no-profit'
      : annualReserve < scheduledAmount ? 'limited' : 'full' };
  return { ...ledgerStatement, ledgerStatement, basis: 'partner-allocation',
    directCosts, operatingExpenses, totalCosts, annualReserve, totalAllocation, renewalReserve,
    grossProfit: round2(ledgerStatement.netRevenue - directCosts), netProfitBeforeFees,
    fees, totalFees, netProfit,
    netAfterReserve: round2(netProfit - annualReserve),
    expenseBreakdown: { groups, total: totalAllocation, fixedTotal: sum(items.filter(i => ['monthly', 'annual'].includes(i.groupKey))) },
    hasActivity: ledgerStatement.hasActivity || items.some(i => i.amount !== 0) || scheduledAmount > 0 };
}

export function partnerFoundingAllocation({ workersCount = 0, paid = 0, spentBefore = 0,
  initialSpentThisMonth = 0, statement = {} } = {}) {
  const budget = round2(Math.max(0, Number(workersCount) || 0) * 20000);
  const funded = round2(Math.min(budget, Math.max(0, Number(paid) || 0)));
  const opening = round2(Math.min(funded, Math.max(0, funded - spentBefore)));
  const initialSpent = round2(Number(initialSpentThisMonth) || 0);
  const available = Math.min(funded, Math.max(0, opening - initialSpent));
  const covered = round2(Math.min(available, Math.max(0, statement.totalAllocation || 0)));
  return { available: true, budget, funded, opening, initialSpent, covered,
    uncovered: round2(Math.max(0, (statement.totalAllocation || 0) - covered)),
    remaining: round2(Math.max(0, available - covered)),
    recordedCost: round2(spentBefore + initialSpent + (statement.totalAllocation || 0)),
    gateClosed: covered > 0 };
}
