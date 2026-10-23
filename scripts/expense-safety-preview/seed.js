import { memoryFinanceDb } from '../../server/__tests__/financeFixtures.js';
import { OWNER_ADVANCE_MONTH_PLAN } from '../../src/lib/advanceMonth.js';
export function expensePreviewDb() {
  const rows = { 'users/local-admin': { role: 'admin' },
    'startup_costs/paid': { item_name: 'تجهيز اختباري مدفوع', category: 'test', budgeted_amount: 100, actual_amount: 100, quantity: 1, status: 'completed' },
    'startup_costs/legacy': { item_name: 'بند قديم اختباري بلا دفعات', category: 'test', budgeted_amount: 100, actual_amount: 100, quantity: 1, status: 'completed' },
    'startup_costs/empty': { item_name: 'خطة تأسيس اختبارية فارغة', category: 'test', budgeted_amount: 100, actual_amount: 0, quantity: 1, status: 'in_progress' },
    'startup_cost_entries/s1': { startup_cost_id: 'paid', amount: 100, description: 'دفعة اختبارية', spent_date: '2026-10-01' },
    'annual_expenses/missing': { expense_name: 'اشتراك اختباري بلا دفعات', category: 'test', annual_cost: 200, quantity: 1, actual_amount: 0, payment_status: 'paid', payment_month: 1, payment_day: 1 },
    'annual_expenses/paid': { expense_name: 'مصروف اختباري له دفعات', category: 'test', annual_cost: 300, quantity: 1, actual_amount: 100, payment_status: 'pending', payment_month: 1, payment_day: 1 },
    'annual_expenses/empty': { expense_name: 'خطة سنوية اختبارية فارغة', category: 'test', annual_cost: 100, quantity: 1, actual_amount: 0, payment_status: 'pending', payment_month: 1, payment_day: 1 },
    'annual_expense_entries/a1': { annual_expense_id: 'paid', amount: 100, description: 'دفعة اختبارية', spent_date: '2026-10-01' },
    'bikers/left': { name: 'بايكر اختباري غادر', current_status: 'هرب', salary: 900 },
    'bikers/working': { name: 'بايكر اختباري عامل', current_status: 'شغال', salary: 900 },
    'washes/w1': { biker_id: 'working', wash_date: '2026-10-20', status: 'مكتملة', quantity: 1, price: 20 },
  };
  OWNER_ADVANCE_MONTH_PLAN.rows.forEach(([id, amount, spent_date, status], index) => { rows[`temporary_expenses/${id}`] = { title: `سلفة اختبار ${index + 1}`, amount, spent_date, status, assignment_month: '2026-09', biker_id: index === 1 ? 'deleted' : index < 4 ? 'left' : 'working' }; });
  return memoryFinanceDb(rows);
}
