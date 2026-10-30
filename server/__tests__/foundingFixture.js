import { foundingEntryId } from '../foundingSettlement.js';
import { financeHash } from '../../functions/src/financeHash.js';

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

// Like «14 سرير ومحلقاته»: posted on cash with input VAT in a filed quarter, its cash credit moved to the
// bank by a cash/bank correction (with another source), then to 2300 by a posted «تصحيح جهة دفع».
export function foundingCorrectionsSeed() {
  return {
    'chart_of_accounts/1200': account('1200', 'asset'), 'chart_of_accounts/5300': account('5300', 'expense'),
    'startup_cost_entries/se2': { startup_cost_id: 's1', description: 'تجهيز المغسلة — مرة ثانية', amount: 1000, spent_date: '2026-08-12', payment_method: 'cash',
      invoice_url: 'https://example.org/invoice-se2', supplier: 'مورد', is_tax_invoice: true, vat_deductible: true, vat_amount: 130.43, price_mode: 'inclusive' },
    'journal_entries/je5': { entryDate: '2026-08-12', periodKey: '2026-08', sourceType: 'expense', sourceKind: 'startup', sourceId: 'se2', status: 'posted', entryNumber: 5,
      description: 'تجهيز مكرر', lines: [{ accountId: '1500', debit: 869.57, credit: 0 }, { accountId: '1200', debit: 130.43, credit: 0 }, { accountId: '1010', debit: 0, credit: 1000 }] },
    'posting_locks/startup__se2': { entryId: 'je5' },
    'journal_entries/cb1': { entryDate: '2026-09-30', periodKey: '2026-09', sourceType: 'adjustment', sourceKind: 'owner_cash_bank_correction', sourceId: 'cb1', status: 'posted',
      entryNumber: 6, description: 'تصحيح الصندوق والبنك', cashBankCorrection: { sources: [{ source: 'expense:se2', netCashCreditHalala: 100000 }, { source: 'expense:v3', netCashCreditHalala: 50000 }] },
      lines: [{ accountId: '1010', debit: 1500, credit: 0 }, { accountId: '1020', debit: 0, credit: 1500 }] },
    [`journal_entries/${foundingEntryId('doc:startup:se2')}`]: { entryDate: '2026-09-30', periodKey: '2026-09', sourceType: 'adjustment', sourceKind: 'founding_document',
      sourceId: foundingEntryId('doc:startup:se2'), status: 'posted', entryNumber: 7, description: 'تصحيح جهة دفع',
      foundingEntry: { key: 'doc:startup:se2', type: 'document', sourceKey: 'startup:se2', reason: 'قاعدة', approvedByName: 'مدير الاختبار' },
      lines: [{ accountId: '1020', debit: 1000, credit: 0 }, { accountId: '2300', debit: 0, credit: 1000 }] },
    [`founding_decisions/${financeHash('startup:se2').slice(0, 40)}`]: { sourceKey: 'startup:se2', decision: 'founding_rule' },
    'counters/journal': { nextNumber: 20 },
    // Temporary items: before the cutoff, after it, never posted, already recovered.
    'bikers/b1': { name: 'سالم', salary: 3000, start_date: '2026-01-01' },
    'temporary_expenses/t1': { biker_id: 'b1', title: 'عهدة وقود', amount: 300, spent_date: '2026-08-15', status: 'pending', recovered_amount: 0, payment_method: 'cash' },
    'temporary_expenses/t2': { title: 'مشتريات مؤقتة', amount: 50, spent_date: '2026-10-12', status: 'pending', recovered_amount: 0, payment_method: 'cash' },
    'temporary_expenses/t3': { biker_id: 'b1', title: 'غير مرحّلة', amount: 40, spent_date: '2026-08-20', status: 'pending', recovered_amount: 0 },
    'temporary_expenses/t4': { biker_id: 'b1', title: 'مستردة', amount: 70, spent_date: '2026-08-02', status: 'recovered', recovered_amount: 70, recovered_date: '2026-08-30' },
    ...Object.fromEntries([['t1', 300, '2026-08-15', 11], ['t2', 50, '2026-10-12', 12], ['t4', 70, '2026-08-02', 13]].map(([id, amount, date, n]) => [`journal_entries/je_${id}`,
      { entryDate: date, periodKey: date.slice(0, 7), sourceType: 'temporary_expense', sourceId: id, status: 'posted', entryNumber: n, description: 'عهدة',
        lines: [{ accountId: '1300', debit: amount, credit: 0 }, { accountId: '1010', debit: 0, credit: amount }] }])),
  };
}

