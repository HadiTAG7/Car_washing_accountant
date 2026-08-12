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
import { splitVat, VAT_RATE } from './vat';
import { ACC } from './chartOfAccounts';
import { incomeStatement, movementBySource } from './reports';

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
 * ما سجّله الدفتر عن غسلة بعينها — its own frozen tax split.
 *
 * `postSource` stores a `taxSnapshot` on the wash's entry: the switches that
 * were in force, and the net/vat/gross they produced. Reading it back is the
 * only way to answer "what was this wash's revenue?" that a later settings
 * change cannot move. Entries written before the snapshot existed are read off
 * their own lines, which say the same thing one step less directly.
 */
export function postedWashSplit(entry) {
  if (!entry) return null;
  const snap = entry.taxSnapshot;
  if (snap && Number.isFinite(Number(snap.net))) {
    return { net: round2(snap.net), vat: round2(snap.vat), gross: round2(snap.gross) };
  }
  const lines = Array.isArray(entry.lines) ? entry.lines : null;
  if (!lines) return null;
  let net = 0, vat = 0, gross = 0;
  for (const l of lines) {
    const code = String(l.accountId);
    const movement = (Number(l.credit) || 0) - (Number(l.debit) || 0);
    if (code === '4000') net += movement;
    else if (code === '2100') vat += movement;
    else gross += -movement;
  }
  return { net: round2(net), vat: round2(vat), gross: round2(gross) };
}

/**
 * صافي مبيعات الغسلات التشغيلية لشهر واحد.
 *
 * Two corrections live here, and they are different problems that looked like
 * one.
 *
 * **The tax.** `quantity × price` is a GROSS figure whenever wash prices are
 * quoted VAT-inclusive, and the statement's revenue is net of tax. Comparing
 * the two directly made output tax look like a posting gap: a single 115 wash
 * reported a 15-riyal "difference" that no amount of posting would close.
 *
 * **The date.** Splitting every wash with TODAY's switches made history move.
 * Post a July wash at 115 inclusive — 100 revenue, 15 tax, filed — then re-quote
 * prices as exclusive in August, and July's reconciliation would recompute that
 * same wash as 115 of revenue and report a discrepancy that is not in the data
 * at all. So a POSTED wash is read from its own entry's frozen snapshot, and
 * only an UNPOSTED one is split — under the policy effective on ITS date, via
 * the `policyAt` resolver the caller supplies.
 */
export function operationalWashSales(washes, {
  periodKey,
  // The policy in force on a given date. Defaults to one fixed policy, which
  // is what an install with no recorded history has.
  policyAt = null,
  vatRegistered = true, washPriceMode = 'inclusive', rate = VAT_RATE,
  isPosted = null, postedEntryOf = null,
} = {}) {
  const resolve = policyAt
    || (() => ({ vatRegistered, washPriceMode, vatRate: rate }));
  let net = 0, gross = 0, vat = 0, count = 0;
  let unpostedNet = 0, unpostedCount = 0;
  let fromLedger = 0;
  for (const w of washes || []) {
    if (w.status !== 'مكتملة') continue;
    const date = String(w.washDate || '').slice(0, 10);
    if (date.slice(0, 7) !== periodKey) continue;
    const amount = round2((Number(w.quantity) || 0) * (Number(w.price) || 0));
    if (amount <= 0) continue;

    // "Not in the books" is a fact about the ledger, so the caller supplies the
    // predicate rather than this module guessing at entry shapes.
    const posted = isPosted ? isPosted(w) : false;
    const recorded = posted && postedEntryOf ? postedWashSplit(postedEntryOf(w)) : null;
    const s = recorded || (() => {
      const policy = resolve(date);
      return splitVat(amount, {
        mode: w.priceMode || policy.washPriceMode,
        taxable: policy.vatRegistered,
        rate: policy.vatRate,
      });
    })();

    net += s.net; gross += s.gross; vat += s.vat; count += 1;
    if (recorded) fromLedger += 1;
    if (!posted) { unpostedNet += s.net; unpostedCount += 1; }
  }
  return {
    net: round2(net), gross: round2(gross), vat: round2(vat), count,
    unpostedNet: round2(unpostedNet), unpostedCount,
    // How many of the figures came from the books rather than from a
    // re-derivation. A month where this equals `count − unpostedCount` cannot
    // be moved by a settings change.
    fromLedger,
  };
}

/**
 * مطابقة التشغيل بالدفاتر — بستة بنود، لا برقم واحد.
 *
 * The operational tables are not wrong; they answer a different question. The
 * old version subtracted one total from another and blamed the whole gap on
 * unposted washes, which was wrong twice over: VAT made a perfectly reconciled
 * month look broken, and a credit note — which reduces the ledger and touches
 * no wash at all — was reported as a missing posting.
 *
 * The identity this states is:
 *
 *   (أ) صافي مبيعات تشغيلية
 *     = (ب) إيرادات الغسلات المُرحّلة
 *     + (ج) غسلات مكتملة غير مُرحّلة
 *     + (و) فرق غير مفسَّر
 *
 * with (د) returns and (هـ) other posted revenue shown alongside, because they
 * move the statement's net revenue without belonging to (أ) at all. Only (و)
 * is a discrepancy; everything else is an explanation.
 */
export function reconcileOperational({
  operational, statement, entries = [], lines = [], scalingFactor = 1,
}) {
  const factor = Number(scalingFactor) || 0;
  const { from, to } = monthRange(statement?.periodKey);

  const operationalNet = round2((operational?.net ?? 0) * factor);
  const unpostedNet    = round2((operational?.unpostedNet ?? 0) * factor);

  // 4000 split by what produced it. Wash revenue is the only part the
  // operational register has an opinion about.
  const bySource = movementBySource(entries, lines, ACC.WASH_REVENUE, { from, to });
  const postedWashNet = round2((bySource.wash || 0) * factor);
  const postedOtherOnSales = round2(
    Object.entries(bySource)
      .filter(([kind]) => kind !== 'wash')
      .reduce((s, [, v]) => s + v, 0) * factor,
  );

  const salesReturns = round2(statement?.salesReturns ?? 0);
  const otherRevenue = round2(postedOtherOnSales + (statement?.otherRevenue ?? 0));
  const unexplained = round2(operationalNet - postedWashNet - unpostedNet);

  return {
    // أ
    operationalNet,
    operationalGross: round2((operational?.gross ?? 0) * factor),
    operationalVat: round2((operational?.vat ?? 0) * factor),
    washCount: operational?.count ?? 0,
    // ب
    postedWashNet,
    // ج
    unpostedNet,
    unpostedCount: operational?.unpostedCount ?? 0,
    // د
    salesReturns,
    // هـ
    otherRevenue,
    // و
    unexplained,
    ledgerNetRevenue: round2(statement?.netRevenue ?? 0),
    // Only the unexplained remainder is a problem. A month with unposted
    // washes or credit notes is fully explained, and says so.
    matched: Math.abs(unexplained) < 0.005,
    clean: Math.abs(unexplained) < 0.005 && Math.abs(unpostedNet) < 0.005,
  };
}
