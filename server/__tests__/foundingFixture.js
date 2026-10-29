// Synthetic data only: one posted startup item paid «from the bank», one posted
// cash expense, two small unposted ones, and one posted partner payment.
export const foundingAuth = { uid: 'test-admin' };
const account = (code, accountType) => ({ code, nameArabic: code, accountType, active: true });
export function foundingSeed() {
  return {
    'users/test-admin': { role: 'admin', displayName: 'مدير الاختبار' },
    'users/test-accountant': { role: 'accountant' },
    'app_settings/accounting': { value: { vatRegistered: false } },
    'counters/journal': { nextNumber: 10 },
    'accounting_periods/2026-07': { periodKey: '2026-07', status: 'closed' },
    'accounting_periods/2026-09': { periodKey: '2026-09', status: 'open' },
    ...Object.fromEntries([['1010', 'asset'], ['1020', 'asset'], ['1300', 'asset'], ['1500', 'asset'], ['2000', 'liability'], ['3000', 'equity'],
      ['3000-p1', 'equity'], ['5100', 'expense']].map(([code, type]) => [`chart_of_accounts/${code}`, account(code, type)])),
    'partners/p1': { partner_name: 'شريك أ' },
    'variable_expense_categories/cat1': { label: 'تشغيل' },
    'startup_costs/s1': { item_name: 'تجهيز', budgeted_amount: 5000, actual_amount: 1000 },
    'startup_cost_entries/se1': { startup_cost_id: 's1', description: 'تجهيز المغسلة', amount: 1000, spent_date: '2026-08-10', payment_method: 'transfer',
      invoice_url: 'https://example.org/invoice-se1', supplier: 'مورد', quantity: 1, unit_cost: 1000 },
    'journal_entries/je1': { entryDate: '2026-08-10', periodKey: '2026-08', sourceType: 'expense', sourceKind: 'startup', sourceId: 'se1', status: 'posted', entryNumber: 1,
      description: 'تجهيز', lines: [{ accountId: '1500', debit: 1000, credit: 0 }, { accountId: '1020', debit: 0, credit: 1000 }] },
    'posting_locks/startup__se1': { entryId: 'je1' },
    'variable_expenses/v1': { expense_name: 'أدوات', total_variable_cost: 230, logged_date: '2026-09-05', category_id: 'cat1', quantity: 1, unit_cost: 230, payment_method: 'cash' },
    'variable_expenses/v2': { expense_name: 'ماء', total_variable_cost: 120, logged_date: '2026-9-10', category_id: 'cat1', quantity: 1, unit_cost: 120, payment_method: 'cash' },
    'variable_expenses/v3': { expense_name: 'صيانة', total_variable_cost: 800, logged_date: '2026-08-20', category_id: 'cat1', quantity: 1, unit_cost: 800, payment_method: 'cash' },
    'journal_entries/je3': { entryDate: '2026-08-20', periodKey: '2026-08', sourceType: 'expense', sourceKind: 'variable', sourceId: 'v3', status: 'posted', entryNumber: 3,
      description: 'صيانة', lines: [{ accountId: '5100', debit: 800, credit: 0 }, { accountId: '1010', debit: 0, credit: 800 }] },
    'partner_payments/pp1': { partner_id: 'p1', amount: 5000, payment_date: '2026-08-01', payment_method: 'bank_transfer' },
    'journal_entries/je4': { entryDate: '2026-08-01', periodKey: '2026-08', sourceType: 'partner_payment', sourceId: 'pp1', status: 'posted', entryNumber: 4,
      description: 'دفعة', lines: [{ accountId: '1020', debit: 5000, credit: 0 }, { accountId: '3000-p1', debit: 0, credit: 5000 }] },
  };
}
