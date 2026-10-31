import { trialBalance, postedLines } from './accounting/reports';
import { round2 } from './accounting/journal';
import { liveIncomeStatement } from './accounting/liveIncomeStatement';
import { incomeCostReconciliation } from './accounting/incomeCostReconciliation';
import { buildVatReport } from './accounting/vatReturn';
import { registerSummary } from './accounting/depreciation';
import { capitalReceivables } from '../../functions/src/capitalReceivable.js';

export function reconciliationMonths(today) {
  return Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => `${today.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`);
}

// Compare existing page engines, not a second recognition policy. Current
// status registers have no historical snapshots: this panel is explicitly
// current, independently of the trial balance's historical movement filter.
export function subledgerReconciliation({ accounts, entries, lines, today, temporaries = [], partners = [],
  assets = [], invoices = [], sources = {}, feeRules = [], policyAt, status = {} }) {
  const balance = trialBalance(accounts, entries, lines, { to: today });
  const sum = codes => round2(balance.rows.filter(row => codes(String(row.code))).reduce((total, row) => total + row.balance, 0));
  const rows = [];
  function add(key, label, code, ledger, page, href, note) {
    const state = status[key] || {};
    const available = !state.loading && !state.error && Number.isFinite(page);
    rows.push({ key, label, code, ledger, page: available ? round2(page) : null,
      difference: available ? round2(page - ledger) : null, href, note,
      loading: Boolean(state.loading), error: state.error || (!available && !state.loading ? 'تعذرت قراءة المصدر كاملًا' : null) });
  }
  add('advances', 'العهد والسلف', '1300', sum(code => code === '1300'),
    temporaries.filter(row => row.status === 'pending').reduce((total, row) => total + Number(row.amount || 0), 0),
    '?page=temporary_expenses', 'المعلق في صفحة المصروفات المؤقتة مقابل الرصيد الدفتري؛ حالة السداد الحالية وليست لقطة تاريخية.');
  add('assets', 'الأصول الثابتة', '1500', sum(code => code === '1500'), registerSummary(assets, today.slice(0, 7)).cost,
    '?page=assets', 'تكلفة الأصول المسجلة في سجل الأصول، لا إجمالي مبالغ التأسيس الشاملة للضريبة.');
  let vat;
  if (!status.vat?.loading && !status.vat?.error) {
    try { vat = buildVatReport({ inputs: invoices, entries, lines, washes: [], period: '', policyAt }).input.tax; }
    catch (error) { status = { ...status, vat: { error: error.message } }; }
  }
  add('vat', 'ضريبة المدخلات المؤهلة', '1200', sum(code => code === '1200'), vat,
    '?page=vat', 'كل الفواتير المؤهلة في صفحة الضريبة، مقابل رصيد 1200؛ لا يشمل تغييرًا في التسجيل الضريبي.');
  // «ذمة رأس مال غير مسددة» (1100 «ذمة رأس مال — الشريك») is capital subscribed and not paid: not part of what was paid.
  const owed = [...capitalReceivables(postedLines(entries, lines, { to: today }),
    partners.map(p => ({ id: p.id, name: p.partnerName ?? p.partner_name ?? '' }))).byPartner.values()].reduce((total, n) => total + n, 0);
  add('capital', 'رأس مال الشركاء', '3000', round2(sum(code => code === '3000' || code.startsWith('3000-')) - owed),
    partners.reduce((total, row) => total + Number(row.paidAmount || 0), 0), '?page=partner_capital',
    `المدفوع في إدارة الشركاء مقابل حسابات رأس المال${owed ? ' بعد طرح ذمة رأس المال غير المسددة (1100)' : ''}؛ العرض لا يسجل دفعات أو قيودًا.`);
  const monthly = [];
  const incomeState = status.income || {};
  if (!incomeState.loading && !incomeState.error) {
    for (const periodKey of reconciliationMonths(today)) {
      try {
        const preview = sources.payrollPreviews?.find(row => row.periodKey === periodKey);
        if (!preview || preview.unavailable || !Array.isArray(preview.lines)) throw new Error('لم تكتمل معاينة الرواتب لهذا الشهر');
        const statement = liveIncomeStatement({ accounts, entries, lines, periodKey, sources, feeRules, policyAt });
        if (statement.issues?.length) throw new Error('توجد مستندات لم يكتمل أساس احتسابها في قائمة الدخل');
        monthly.push({ month: periodKey, statement, costs: incomeCostReconciliation({ statement, accounts, entries, lines }) });
      } catch (error) { monthly.push({ month: periodKey, error: error.message }); }
    }
  }
  const failed = monthly.some(row => row.error);
  const incomeStatus = { ...incomeState, error: incomeState.error || (failed ? 'بعض أشهر قائمة الدخل غير متاحة؛ لا يعرض مجموع ناقص.' : null) };
  const total = field => monthly.reduce((value, row) => value + Number(row.statement?.[field] || 0), 0);
  const expensePosted = monthly.reduce((value, row) => value + (row.costs?.posted || 0), 0);
  const revenuePosted = monthly.reduce((value, row) => value + (row.statement?.ledgerNetRevenue || 0), 0);
  status = { ...status, expenses: incomeStatus, revenue: incomeStatus };
  add('expenses', 'مصروفات قائمة الدخل', '5010 · 5100 · 5200 · 5300', expensePosted,
    total('totalCosts'), '?page=summary', 'أشهر السنة حتى الشهر الحالي؛ الرواتب حسب شهر الاستحقاق في القائمة وتاريخ القيد في الميزان.');
  add('revenue', 'إيراد قائمة الدخل', '4000', revenuePosted, total('netRevenue'), '?page=summary',
    'أشهر السنة حتى الشهر الحالي؛ الإيراد التشغيلي لا يثبت التحصيل أو الترحيل.');
  return { rows, monthly, differences: rows.filter(row => row.difference !== null && Math.abs(row.difference) >= 0.01).length,
    unavailable: rows.filter(row => row.difference === null).length };
}
