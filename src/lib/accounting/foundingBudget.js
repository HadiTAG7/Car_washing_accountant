import { ACC } from './chartOfAccounts.js';
import { round2 } from './journal.js';
import { postedLines, sourceKindOf } from './reports.js';

// This is a management/allocation threshold, never an accounting posting rule.
export const FOUNDING_BUDGET = 1_000_000;

/**
 * Costs recognized from the posted ledger toward the founding funding cap.
 * Startup purchases are included at acquisition, not again on depreciation.
 * Other assets and disposal losses are not founding spend. Reversals retain
 * their original kind and subtract their original amount.
 *
 * The gate for a month reads the cumulative amount BEFORE that month: a cap
 * crossed mid-month never retroactively allocates that month's loss.
 */
export function foundingBudgetStatus({ accounts = [], entries = [], lines = [], periodKey } = {}) {
  const expenseCodes = new Set(accounts
    .filter((account) => account.accountType === 'expense'
      && ![ACC.DEPRECIATION, ACC.ASSET_DISPOSAL_LOSS].includes(String(account.code)))
    .map((account) => String(account.code)));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodKey || '')) || expenseCodes.size === 0) {
    return { available: false, recordedCost: null, remaining: null, gateClosed: null };
  }

  const kindByEntry = new Map(entries.map((entry) => [entry.id, sourceKindOf(entry)]));
  let before = 0;
  let through = 0;
  for (const line of postedLines(entries, lines)) {
    const month = String(line.entryDate || '').slice(0, 7);
    if (month > periodKey) continue;
    const code = String(line.accountId);
    if (!expenseCodes.has(code)
      && !(code === ACC.FIXED_ASSETS && kindByEntry.get(line.entryId) === 'startup')) continue;
    const amount = (Number(line.debit) || 0) - (Number(line.credit) || 0);
    through += amount;
    if (month < periodKey) before += amount;
  }
  const recordedCost = round2(Math.max(0, through));
  return {
    available: true,
    budget: FOUNDING_BUDGET,
    recordedCost,
    remaining: round2(Math.max(0, FOUNDING_BUDGET - recordedCost)),
    gateClosed: round2(Math.max(0, before)) < FOUNDING_BUDGET,
  };
}
