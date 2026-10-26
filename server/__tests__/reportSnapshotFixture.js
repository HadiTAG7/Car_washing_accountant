import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';
export const snapshotNow = new Date('2026-10-26T16:30:00Z');
export function snapshotSeed() {
  const seed = { 'users/test-admin': { role: 'admin' },
    'app_settings/accounting': { value: { vatRegistered: true, vatRate: 0.15, washPriceMode: 'exclusive',
      taxPolicyHistory: [{ effectiveFrom: '2026-05-01', vatRegistered: true, vatRate: 0.15, washPriceMode: 'exclusive' }] } },
    'fee_rules/none': { key: 'none', active: true, rate: 0, basis: 'revenue' },
    'washes/one': { wash_date: '2026-10-04', status: 'مكتملة', quantity: 3, price: 20, price_mode: 'exclusive', revenue_origin: 'direct' },
    'variable_expenses/cost': { expense_name: 'مصروف اختبار', logged_date: '2026-10-05', total_variable_cost: 50, is_tax_invoice: false },
    'payroll_periods/2026-10': { currentRunId: 'frozen' },
    'payroll_runs/frozen': { periodKey: '2026-10', status: 'approved', totals: {}, estimated: false },
    'payroll_runs/frozen/items/worker': { basicDue: 100, bonus: 0, deduction: 0, status: 'approved' },
    'journal_entries/capital': { entryDate: '2026-09-01', status: 'posted', lines: [{ accountId: '1020', debit: 1000, credit: 0 }, { accountId: '3000', credit: 1000, debit: 0 }] },
    'journal_entries/expense': { entryDate: '2026-10-05', status: 'posted', lines: [{ accountId: '5100', debit: 25, credit: 0 }, { accountId: '1020', credit: 25, debit: 0 }] },
    'journal_entries/advance': { entryDate: '2026-10-05', status: 'posted', lines: [{ accountId: '1300', debit: 12, credit: 0 }, { accountId: '1010', credit: 12, debit: 0 }] },
  };
  for (const a of DEFAULT_CHART_OF_ACCOUNTS) seed[`chart_of_accounts/${a.code}`] = a;
  return seed;
}
