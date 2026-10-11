import { incomeStatementLines, sourceKindOf } from './reports.js';
import { monthRange } from './monthlyStatement.js';
import { payrollExpensePeriod } from './payrollExpensePeriod.js';
import { hasManualSalaryRows } from '../monthlyPayrollExpenses.js';
import { templateActiveIn } from './recurring.js';

const round = n => Math.round(n * 100) / 100;
const component = n => {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error('تعذّر تأكيد مكونات مصروف الرواتب.');
  return value;
};

// A read-only P&L accrual, not a journal, payroll approval or cash payment.
// The authoritative full run (frozen after approval/partial payment) replaces
// only its earned-period payroll salary postings. Other costs are never netted.
export function unpaidPayrollIncome({ preview, accounts, entries, lines, periodKey, monthlyExpenses = [] }) {
  if (!preview) return { items: [], summary: null };
  if (preview.periodKey !== periodKey || !Array.isArray(preview.lines)) throw new Error('معاينة الرواتب لا تطابق شهر قائمة الدخل.');
  const amount = round(preview.lines.reduce((sum, row) => {
    if (row.basicDue == null) throw new Error('تعذّر تأكيد مكونات مصروف الرواتب.');
    return sum + round(component(row.basicDue) + component(row.bonus) - component(row.deduction));
  }, 0));
  if (amount < 0) throw new Error('تعذّر تأكيد مكونات مصروف الرواتب.');
  const index = new Map(entries.map(e => [e.id, e]));
  const payrollKind = e => ['payroll', 'payroll_reversal'].includes(sourceKindOf(index.get(e?.reversalOf || e?.reversesEntryId) || e));
  const salaryLines = incomeStatementLines(entries, lines).filter(l => String(l.accountId) === '5010');
  // An undated legacy payroll cannot safely be treated as another month or zero.
  if (salaryLines.some(l => payrollKind(index.get(l.entryId)) && !payrollExpensePeriod(index.get(l.entryId), index))) {
    throw new Error('يوجد قيد رواتب بلا شهر استحقاق موثّق؛ راجعه قبل تأكيد القائمة.');
  }
  const inMonth = salaryLines.filter(l => l.accountingPeriod === periodKey);
  const legacyRows = monthlyExpenses.filter(r => r.recurrence === 'one_time' || r.logged_date
    ? String(r.invoice_date || r.logged_date || '').slice(0, 7) === periodKey : templateActiveIn(r, periodKey));
  if (amount && (hasManualSalaryRows(legacyRows.map(r => ({ expenseName: r.expense_name })))
    || inMonth.some(l => !payrollKind(index.get(l.entryId))))) {
    throw new Error('يوجد مصروف رواتب قديم خارج المسير؛ يلزم تدقيق ارتباطه قبل جمعه مع الرواتب المستحقة حتى لا يتكرر.');
  }
  const posted = round(inMonth.filter(l => payrollKind(index.get(l.entryId)))
    .reduce((sum, l) => sum + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0));
  if (posted < 0 || posted - amount > 0.011) throw new Error('مصروف الرواتب المرحّل لا يطابق المسير؛ أعد تحميل التقرير أو راجعه قبل اعتماده.');
  const unposted = round(Math.max(0, amount - posted));
  if (unposted && !accounts.some(a => String(a.code) === '5010' && a.accountType === 'expense')) {
    throw new Error('حساب الرواتب 5010 غير موجود في دليل الحسابات؛ لا يمكن عرض الرواتب بصفر.');
  }
  return { summary: { amount, posted, unposted, estimated: preview.estimated === true }, items: unposted ? [{
    sourceKind: 'payroll_accrual', sourceId: `salary:${periodKey}`, accountCode: '5010', date: monthRange(periodKey).to,
    amount: unposted, description: 'رواتب مستحقة غير مُرحّلة',
  }] : [] };
}
