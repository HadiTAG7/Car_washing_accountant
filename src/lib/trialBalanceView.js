import { trialBalance, trialBalanceFromSums } from './accounting/reports';
import { round2 } from './accounting/journal';

export const TRIAL_TYPES = [
  ['asset', 'الأصول'], ['liability', 'الالتزامات'], ['equity', 'حقوق الملكية'],
  ['revenue', 'الإيرادات'], ['expense', 'المصروفات'], ['unknown', 'غير معرّف'],
];

export function previousDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// Presentation of the existing journal engine: no recognition or posting rules.
export function trialBalancePeriod(accounts, entries, lines, { from, to, showAll = false } = {}) {
  const movement = trialBalance(accounts, entries, lines, { from: from || null, to: to || null });
  const opening = from ? trialBalance(accounts, entries, lines, { to: previousDay(from) }) : { rows: [] };
  const closing = trialBalance(accounts, entries, lines, { to: to || null });
  return assemblePeriod(accounts, { movement, opening, closing }, { showAll });
}

/** Σ per account of two `posted_line_sums` results, in whole halalas. */
export function addLineSums(...lists) {
  const total = new Map();
  for (const sums of lists) for (const s of sums || []) {
    const code = String(s.account_id), t = total.get(code) || { account_id: code, debit: 0, credit: 0 };
    t.debit += Math.round(Number(s.debit || 0) * 100); t.credit += Math.round(Number(s.credit || 0) * 100);
    total.set(code, t);
  }
  return [...total.values()].map(t => ({ ...t, debit: t.debit / 100, credit: t.credit / 100 }));
}

/**
 * The same trial balance from the database's per-account sums — two calls of
 * `posted_line_sums`: up to the day before «من» (opening) and «من»..«إلى»
 * (movement). Closing is their sum, so no journal entry reaches the browser.
 */
export function trialBalancePeriodFromSums(accounts, { opening = [], movement = [] } = {}, { from, showAll = false } = {}) {
  return assemblePeriod(accounts, {
    movement: trialBalanceFromSums(accounts, movement),
    opening: from ? trialBalanceFromSums(accounts, opening) : { rows: [] },
    closing: trialBalanceFromSums(accounts, addLineSums(from ? opening : [], movement)),
  }, { showAll });
}

function assemblePeriod(accounts, { movement, opening, closing }, { showAll = false } = {}) {
  const before = new Map(opening.rows.map(row => [row.code, row]));
  const during = new Map(movement.rows.map(row => [row.code, row]));
  const after = new Map(closing.rows.map(row => [row.code, row]));
  const codes = new Set([...after.keys(), ...(showAll ? accounts.map(row => String(row.code)) : [])]);
  const accountIndex = new Map(accounts.map(row => [String(row.code), row]));
  const rows = [...codes].map(code => {
    const account = accountIndex.get(code);
    const fallback = { ...account, code, known: Boolean(account), normalBalance: account?.normalBalance || 'debit',
      accountType: account?.accountType || 'unknown', nameArabic: account?.nameArabic || `حساب غير معرّف (${code})` };
    const end = after.get(code) || { ...fallback, balanceDebit: 0, balanceCredit: 0, balance: 0 };
    const open = before.get(code), current = during.get(code);
    const openingSigned = round2((open?.balanceDebit || 0) - (open?.balanceCredit || 0));
    const closingSigned = round2(end.balanceDebit - end.balanceCredit);
    return { ...fallback, ...end, debit: current?.debit || 0, credit: current?.credit || 0,
      openingSigned, closingSigned, abnormal: end.balance < -0.005, hasMovement: after.has(code) };
  });
  const groups = TRIAL_TYPES.map(([type, label]) => {
    const list = rows.filter(row => row.accountType === type);
    const sum = field => round2(list.reduce((total, row) => total + row[field], 0));
    return { type, label, rows: list, openingSigned: sum('openingSigned'), debit: sum('debit'), credit: sum('credit'), closingSigned: sum('closingSigned') };
  }).filter(group => group.rows.length);
  const result = round2(rows.filter(row => ['revenue', 'expense'].includes(row.accountType))
    .reduce((total, row) => total + row.credit - row.debit, 0));
  return { ...movement, rows: groups.flatMap(group => group.rows), groups, result,
    closingDebit: round2(rows.reduce((total, row) => total + row.balanceDebit, 0)),
    closingCredit: round2(rows.reduce((total, row) => total + row.balanceCredit, 0)),
    openingDebit: round2(rows.reduce((total, row) => total + Math.max(0, row.openingSigned), 0)),
    openingCredit: round2(rows.reduce((total, row) => total + Math.max(0, -row.openingSigned), 0)),
    abnormalRows: rows.filter(row => row.abnormal) };
}

export function ledgerPeriodHref(code, from, to) {
  const params = new URLSearchParams({ page: 'ledger', account: String(code) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return `?${params}`;
}
