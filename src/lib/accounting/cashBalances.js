import { generalLedger } from './reports.js';
import { ACC } from './chartOfAccounts.js';

export function cashAccountBalances(ledger) {
  const roots = new Set([ACC.CASH, ACC.BANK]);
  let added;
  do {
    added = false;
    for (const account of ledger.accounts) if (roots.has(String(account.parentId)) && !roots.has(String(account.code))) {
      roots.add(String(account.code)); added = true;
    }
  } while (added);
  return ledger.accounts.filter(account => roots.has(String(account.code))).map(account => ({
    code: account.code, name: account.nameArabic || 'حساب نقدي',
    balance: generalLedger(account.code, ledger.entries, ledger.lines).closing,
  }));
}
