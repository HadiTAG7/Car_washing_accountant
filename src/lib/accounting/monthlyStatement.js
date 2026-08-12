// ═══════════════════════════════════════════════════════════════════════════
// قائمة الدخل الشهرية — from the LEDGER, not from the operational tables
// ═══════════════════════════════════════════════════════════════════════════
// The monthly income statement used to be summed straight out of `washes`,
// `variable_expenses`, `monthly_expenses` and `annual_expenses`. Every figure
// on it — revenue, gross profit, the management fee, the supervisor's share,
// the six-month trend, the CSV — came from those raw rows.
//
// Which meant a credit note changed nothing. Cancel a 115-riyal sale in full
// and the statement still reported 115 of revenue, still charged 10% of a
// profit that had been given back, and still disagreed with the trial balance,
// the VAT return and the balance sheet — all three of which read the journal.
// A wash typed in but never posted counted too, so the official statement
// reported revenue the books had never recognised.
//
// So the statement reads `journal_entries` through `incomeStatement`, and net
// revenue is 4000 net of 4010 — credit notes reduce it because a contra-revenue
// debit is exactly what they post. The raw tables keep their own page; here
// they appear only as a RECONCILIATION, which is the honest role for them:
// "the operation says X, the books say Y, and here is the difference".
//
// Pure functions, so the page, the CSV, the chart and the tests all consume the
// same numbers and cannot drift apart.
// ═══════════════════════════════════════════════════════════════════════════

import { round2 } from './journal';
import { ACC } from './chartOfAccounts';
import { incomeStatement } from './reports';

/**
 * The fees that apply when `fee_rules` has not been configured.
 *
 * These are the rates the statement has always charged; they live here rather
 * than inline in the page so that the screen, the CSV and the trend cannot
 * disagree about them. A configured rule set replaces them entirely.
 */
export const DEFAULT_FEE_RULES = [
  { key: 'management', label: 'رسوم الإدارة (10% من صافي الربح)', basis: 'profit', rate: 0.10, effectiveFrom: null },
  { key: 'supervisor', label: 'راتب المشرف (5% من صافي الربح)',   basis: 'profit', rate: 0.05, effectiveFrom: null },
];

/** `2026-08` → { from: '2026-08-01', to: '2026-08-31' }. */
export function monthRange(periodKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
  if (!m) return { from: null, to: null };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { from: null, to: null };
  // Day 0 of the NEXT month is the last day of this one — leap years included.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The fee a rule charges for a period.
 *
 * A losing month triggers neither a management fee nor a supervisor's share:
 * both are a cut of something the month did not produce. Charging them anyway
 * would deepen the loss by 15% of itself, which is not a rule any partner
 * agreed to.
 */
function feeAmount(rule, { netRevenue, operatingProfit }) {
  const rate = Number(rule.rate) || 0;
  const base = rule.basis === 'profit' ? operatingProfit : netRevenue;
  return base > 0 ? round2(base * rate) : 0;
}

function scaleRows(rows, factor) {
  return rows.map((r) => ({ ...r, amount: round2((Number(r.amount) || 0) * factor) }));
}

/**
 * قائمة دخل شهر واحد، مبنية على القيود المُرحّلة.
 *
 * `scalingFactor` is the partner-view pro-rata share. The whole statement is
 * linear in it, so it is applied once at the end rather than smeared over the
 * inputs — and the "profit must be positive" gate on fees is unaffected,
 * because a positive factor cannot change a number's sign.
 */
export function monthlyStatement({
  accounts = [], entries = [], lines = [], periodKey,
  feeRules = null, scalingFactor = 1,
} = {}) {
  const { from, to } = monthRange(periodKey);
  const factor = Number(scalingFactor) || 0;
  const is = incomeStatement(accounts, entries, lines, { from, to });

  // 4000 gross sales and 4010 returns, kept apart on the face of the
  // statement. Netting them into one line would hide the returns, which is
  // the whole reason 4010 is a separate contra account.
  const revenueRow = (code) => is.revenue.find((r) => String(r.code) === code);
  const grossRevenue = round2(revenueRow(ACC.WASH_REVENUE)?.amount || 0);
  // The contra account's `amount` comes back NEGATIVE (credit − debit on a
  // debit-side account), so flipping the sign gives the returns as a positive
  // figure to subtract.
  const salesReturns = round2(-(revenueRow(ACC.SALES_RETURNS)?.amount || 0));
  const otherRevenue = round2(
    is.revenue
      .filter((r) => String(r.code) !== ACC.WASH_REVENUE && String(r.code) !== ACC.SALES_RETURNS)
      .reduce((s, r) => s + r.amount, 0),
  );
  const netRevenue = round2(grossRevenue - salesReturns + otherRevenue);

  const directCosts = round2(is.totalCost);
  const operatingExpenses = round2(is.totalExpenses);
  const grossProfit = round2(netRevenue - directCosts);
  const netProfitBeforeFees = round2(grossProfit - operatingExpenses);

  const rules = (feeRules && feeRules.length ? feeRules : DEFAULT_FEE_RULES)
    .filter((f) => !f.effectiveFrom || !to || f.effectiveFrom <= to);
  const fees = rules.map((f) => ({
    key: f.key,
    label: f.label,
    basis: f.basis === 'profit' ? 'profit' : 'revenue',
    rate: Number(f.rate) || 0,
    amount: round2(feeAmount(f, { netRevenue, operatingProfit: netProfitBeforeFees }) * factor),
  }));
  const totalFees = round2(fees.reduce((s, f) => s + f.amount, 0));

  const scaled = {
    grossRevenue: round2(grossRevenue * factor),
    salesReturns: round2(salesReturns * factor),
    otherRevenue: round2(otherRevenue * factor),
    netRevenue: round2(netRevenue * factor),
    directCosts: round2(directCosts * factor),
    operatingExpenses: round2(operatingExpenses * factor),
    grossProfit: round2(grossProfit * factor),
    netProfitBeforeFees: round2(netProfitBeforeFees * factor),
  };

  return {
    periodKey, from, to,
    ...scaled,
    totalCosts: round2(scaled.directCosts + scaled.operatingExpenses),
    fees, totalFees,
    netProfit: round2(scaled.netProfitBeforeFees - totalFees),
    // The account-level rows behind each subtotal, for the breakdown table.
    revenueRows: scaleRows(is.revenue, factor),
    costRows: scaleRows(is.costOfServices, factor),
    expenseRows: scaleRows(is.expenses, factor),
    // "Nothing posted in this month" — distinct from "posted and netted to
    // zero", which is a real result the statement should still show.
    hasActivity: is.revenue.length > 0 || is.costOfServices.length > 0 || is.expenses.length > 0,
  };
}

/**
 * مطابقة التشغيل بالدفاتر.
 *
 * The operational tables are not wrong — they are a different question. This
 * states both answers and the gap between them, so an unposted wash shows up
 * as a number to act on instead of silently inflating an official statement.
 */
export function reconcileOperational({ operationalRevenue, statement }) {
  const operational = round2(operationalRevenue);
  const ledger = round2(statement?.netRevenue ?? 0);
  return {
    operational,
    ledger,
    difference: round2(operational - ledger),
    // Returns explain part of any gap on their own: a credit note reduces the
    // ledger without touching the wash it came from.
    salesReturns: round2(statement?.salesReturns ?? 0),
    matched: Math.abs(round2(operational - ledger)) < 0.005,
  };
}
