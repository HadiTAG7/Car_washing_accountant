import { previewPayrollMonths } from '../functions/src/payroll.js';
import { liveIncomeStatement } from '../src/lib/accounting/liveIncomeStatement.js';
import { taxPolicyAt, normalizeTaxPolicyHistory } from '../src/lib/accounting/taxPolicy.js';
import { cashAccountBalances } from '../src/lib/accounting/cashBalances.js';
import { composeTaxInvoices } from '../src/lib/taxInvoiceFeed.js';
import { buildVatDashboardReport } from '../src/lib/vatDashboard.js';
import { mapWash, mapStartupCostEntry, mapStartupCost, mapAnnualExpenseEntry, mapMonthlyExpense, mapVariableExpense } from '../src/lib/mappers.js';
import { REPORT_FINANCIAL_IDS, financialSnapshotSchema } from '../src/lib/reportPublication.js';
import { embeddedLinesOf } from './partnerMcp/data.js';

// Every financial query joins the existing report transaction's read set.
// No write API is exposed to the read-only payroll preview or calculations.
export function reportReadDb(db, tx) {
  const wrap = ref => ({ get: () => tx.get(ref),
    doc: key => wrap(ref.doc(key)), collection: name => wrap(ref.collection(name)),
    where: (...args) => wrap(ref.where(...args)), orderBy: (...args) => wrap(ref.orderBy(...args)),
    limit: n => wrap(ref.limit(n)) });
  return { collection: name => wrap(db.collection(name)) };
}

export async function captureReportFinancials(db, requestedCutAt, now = new Date()) {
  const capturedAt = new Date(now.getTime() + 3 * 3600000).toISOString().replace('Z', '+03:00');
  const today = capturedAt.slice(0, 10), month = today.slice(0, 7);
  const metrics = REPORT_FINANCIAL_IDS.map(id => ({ id, value: null, basis: 'unavailable', coverage: 'تعذرت قراءة المصدر؛ لم يُفترض صفر.' }));
  const set = (id, value, basis, coverage) => {
    if (Number.isFinite(value)) Object.assign(metrics.find(m => m.id === id), { value, basis, coverage });
  };
  const cache = new Map();
  const rows = name => {
    if (!cache.has(name)) cache.set(name, db.collection(name).get().then(s => s.docs.map(d => ({ ...d.data(), id: d.id }))));
    return cache.get(name);
  };
  const settings = (async () => {
    const snap = await db.collection('app_settings').doc('accounting').get();
    if (!snap.exists) throw new Error('missing accounting policy');
    const v = snap.data().value || snap.data();
    const base = { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, vatFilingPeriod: 'quarterly', ...v };
    return { ...base, taxPolicyHistory: normalizeTaxPolicyHistory(v.taxPolicyHistory, base) };
  })();
  const ledger = Promise.all(['chart_of_accounts', 'journal_entries', 'journal_lines'].map(rows)).then(([accounts, entries, legacy]) => {
    if (!accounts.length) throw new Error('missing chart');
    return { accounts, entries, lines: entries.flatMap(embeddedLinesOf).concat(legacy) };
  });
  const income = (async () => {
    const [l, policy, fees, washes, variables, monthlies, annualEntries, vouchers, settlements, bookings, previews] = await Promise.all([
      ledger, settings, rows('fee_rules'), rows('washes'), rows('variable_expenses'), rows('monthly_expenses'),
      rows('annual_expense_entries'), rows('expense_vouchers'), rows('sweater_settlements'), rows('sweater_bookings'),
      previewPayrollMonths(db, [month], { now }),
    ]);
    if (!previews[0] || previews[0].error || !Array.isArray(previews[0].lines)) throw new Error('unavailable payroll');
    const feeRules = fees.filter(r => r.active !== false).map(r => ({ key: r.key ?? r.id, label: r.label ?? r.key ?? r.id,
      basis: r.basis === 'profit' ? 'profit' : 'revenue', rate: Number(r.rate) || 0, effectiveFrom: r.effective_from ?? r.effectiveFrom ?? null }));
    const statement = liveIncomeStatement({ ...l, periodKey: month, feeRules, scalingFactor: 1,
      sources: { washes, variables, monthlies, annualEntries, vouchers, settlements, bookings, payrollPreviews: previews },
      policyAt: day => taxPolicyAt(day, policy) });
    const scope = statement.issues.length ? `؛ استُبعدت ${statement.issues.length} عمليات تحتاج مراجعة.` : '';
    set('revenue', statement.netRevenue, 'operational', `قائمة الدخل · ${month}${scope}`);
    set('expenses', statement.totalCosts, 'operational', `قائمة الدخل · ${month}؛ تشمل تقديرات الرواتب إن لم يعتمد المسير.${scope}`);
    set('net-profit', statement.netProfit, 'operational', `نتيجة قائمة الدخل · ${month}${scope}`);
  })();
  const cash = ledger.then(l => {
    const balances = cashAccountBalances(l);
    for (const [id, code] of [['bank-ledger', '1020'], ['cash-ledger', '1010']])
      set(id, balances.find(b => String(b.code) === code)?.balance, 'ledger', 'رصيد الدفتر التراكمي؛ لا يثبت التحصيل أو رصيد كشف البنك.');
  });
  const vat = (async () => {
    const [l, policy, washes, startupEntries, annualEntries, monthlyExpenses, variableExpenses, voucherItems, parentItems, settlements] = await Promise.all([
      ledger, settings, rows('washes'), rows('startup_cost_entries'), rows('annual_expense_entries'), rows('monthly_expenses'),
      rows('variable_expenses'), rows('expense_vouchers'), rows('startup_costs'), rows('sweater_settlements'),
    ]);
    const inputs = composeTaxInvoices({ startupEntries: startupEntries.map(mapStartupCostEntry), annualEntries: annualEntries.map(mapAnnualExpenseEntry),
      monthlyExpenses: monthlyExpenses.map(mapMonthlyExpense), variableExpenses: variableExpenses.map(mapVariableExpense),
      voucherItems, ledgerParents: startupEntries, parentItems: parentItems.map(mapStartupCost), includeNonTax: true });
    const report = buildVatDashboardReport({ inputs, washes: washes.map(mapWash), ...l, settlements, settings: policy,
      period: month, filing: 'monthly', today });
    if (!report.outputUnavailable) set('vat-due', report.netTax, 'operational', `الضريبة المستردة · ${month}؛ الموجب مستحق والسالب مسترد؛ حسب السياسة المحفوظة.`);
  })();
  // A failed source is an explicit gap, never a fabricated zero or a rejected
  // administrative report. Other independently verified figures remain usable.
  const results = await Promise.allSettled([income, cash, vat]);
  // SQL errors abort the underlying transaction: do not pretend an archive
  // write can safely commit after one. The HTTP layer reports the failed save.
  const fatal = results.find(r => r.status === 'rejected' && /^[0-9A-Z]{5}$/.test(String(r.reason?.code || '')));
  if (fatal) throw fatal.reason;
  return financialSnapshotSchema.parse({ version: 1, source: 'site-functions', requestedCutAt, capturedAt, month, metrics });
}
