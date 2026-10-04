export function supervisorFixture() {
  return {
    chart_of_accounts: [
      { id: '1010', code: '1010', accountType: 'asset', normalBalance: 'debit' },
      { id: '4000', code: '4000', accountType: 'revenue', normalBalance: 'credit' },
      { id: '5200', code: '5200', accountType: 'expense', normalBalance: 'debit' },
    ],
    journal_entries: [
      { id: 'sale', entryDate: '2026-08-01', periodKey: '2026-08', status: 'posted', sourceType: 'wash', sourceId: 'w1', lines: [{ accountId: '1010', debit: 1000, credit: 0 }, { accountId: '4000', debit: 0, credit: 1000 }] },
      { id: 'cost', entryDate: '2026-08-31', periodKey: '2026-08', status: 'posted', lines: [{ accountId: '5200', debit: 200, credit: 0 }, { accountId: '1010', debit: 0, credit: 200 }] },
    ],
    journal_lines: [], fee_rules: [],
    accounting_periods: [{ id: '2026-08', periodKey: '2026-08', status: 'closed' }],
    bikers: [{ id: 'b1', name: 'عامل تجريبي', start_date: '2026-08-01', contact_number: 'private-phone', iqama_number: 'private-id', salary: 2000 }],
    washes: [{ id: 'w1', biker_id: 'b1', biker_name: 'اسم قديم', quantity: 10, price: 100, status: 'مكتملة', wash_date: '2026-08-01' }],
  };
}
