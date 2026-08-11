// ═══════════════════════════════════════════════════════════════════════════
// التقارير المالية — ledger, trial balance, income statement, balance sheet
// ═══════════════════════════════════════════════════════════════════════════
// Every report here reads ONLY posted journal lines. Nothing sums the
// operational collections directly: a figure that appears in a statement must
// be traceable to an entry, and an entry that was reversed must stop counting
// automatically. That is what makes the numbers auditable.
//
// All functions are pure — they take rows in, return rows out — so the whole
// reporting layer is unit-tested without a database.
// ═══════════════════════════════════════════════════════════════════════════

import { round2, MONEY_EPSILON } from './journal';
import { indexAccounts } from './chartOfAccounts';

/**
 * Keeps only lines belonging to POSTED entries, optionally within a date
 * window. A reversal is itself a posted entry, so its opposite lines are
 * included and cancel the original — no special-casing needed.
 */
export function postedLines(entries, lines, { from = null, to = null } = {}) {
  const meta = new Map();
  for (const e of entries || []) {
    if (e.status !== 'posted') continue;
    const d = String(e.entryDate || '');
    if (from && d < from) continue;
    if (to && d > to) continue;
    meta.set(e.id, e);
  }
  const out = [];
  for (const l of lines || []) {
    const e = meta.get(l.entryId);
    if (!e) continue;
    out.push({
      ...l,
      entryDate:   e.entryDate,
      entryNumber: e.entryNumber,
      periodKey:   e.periodKey,
      sourceType:  e.sourceType,
      entryDescription: e.description,
    });
  }
  return out;
}

/** Signed movement of a line for an account with the given normal balance. */
export function signedAmount(line, normalBalance) {
  const d = Number(line.debit) || 0;
  const c = Number(line.credit) || 0;
  return normalBalance === 'credit' ? round2(c - d) : round2(d - c);
}

/**
 * دفتر الأستاذ لحساب واحد.
 *
 * The opening balance is every posted movement STRICTLY BEFORE `from`, so a
 * window never loses history — it carries it in. Rows then run in date then
 * entry-number order with a running balance, and `closing = opening + Σ`.
 */
export function generalLedger(accountCode, entries, lines, { from = null, to = null, account = null } = {}) {
  const code = String(accountCode);
  const normal = account?.normalBalance || 'debit';

  const all = postedLines(entries, lines).filter((l) => String(l.accountId) === code);

  let opening = 0;
  const window = [];
  for (const l of all) {
    if (from && l.entryDate < from) { opening += signedAmount(l, normal); continue; }
    if (to && l.entryDate > to) continue;
    window.push(l);
  }
  opening = round2(opening);

  window.sort((a, b) => {
    const byDate = String(a.entryDate).localeCompare(String(b.entryDate));
    if (byDate !== 0) return byDate;
    return (a.entryNumber || 0) - (b.entryNumber || 0);
  });

  let running = opening;
  let totalDebit = 0, totalCredit = 0;
  const rows = window.map((l) => {
    running = round2(running + signedAmount(l, normal));
    totalDebit  += Number(l.debit)  || 0;
    totalCredit += Number(l.credit) || 0;
    return {
      entryId:     l.entryId,
      entryNumber: l.entryNumber,
      entryDate:   l.entryDate,
      description: l.description || l.entryDescription || '',
      sourceType:  l.sourceType,
      debit:       round2(l.debit),
      credit:      round2(l.credit),
      balance:     running,
    };
  });

  return {
    accountCode: code,
    account,
    opening,
    closing: running,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    rows,
  };
}

/**
 * ميزان المراجعة.
 *
 * Per account: total debits, total credits, and the net balance placed on the
 * side it belongs to. The grand totals must agree — `balanced` says whether
 * they do, and `difference` is what to hunt for when they do not.
 */
export function trialBalance(accounts, entries, lines, { from = null, to = null } = {}) {
  const index = indexAccounts(accounts);
  const rows = new Map();

  for (const l of postedLines(entries, lines, { from, to })) {
    const code = String(l.accountId);
    if (!rows.has(code)) {
      const a = index.get(code);
      rows.set(code, {
        code,
        nameArabic:   a?.nameArabic || `حساب غير معرّف (${code})`,
        accountType:  a?.accountType || 'unknown',
        normalBalance: a?.normalBalance || 'debit',
        known:        Boolean(a),
        debit: 0, credit: 0,
      });
    }
    const r = rows.get(code);
    r.debit  += Number(l.debit)  || 0;
    r.credit += Number(l.credit) || 0;
  }

  const list = [...rows.values()].map((r) => {
    const debit  = round2(r.debit);
    const credit = round2(r.credit);
    const net    = round2(debit - credit);
    return {
      ...r,
      debit,
      credit,
      // Presented on the side the balance actually falls, not the side the
      // account normally sits on — an overdrawn cash account should show it.
      balanceDebit:  net > 0 ? net : 0,
      balanceCredit: net < 0 ? round2(-net) : 0,
      balance: r.normalBalance === 'credit' ? round2(-net) : net,
    };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

  const totalDebit  = round2(list.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(list.reduce((s, r) => s + r.credit, 0));
  const difference  = round2(totalDebit - totalCredit);

  // An account used by a line but missing from the chart is a data problem
  // worth surfacing loudly — the trial balance would still add up.
  const unknownAccounts = list.filter((r) => !r.known).map((r) => r.code);

  return {
    rows: list,
    totalDebit,
    totalCredit,
    difference,
    balanced: Math.abs(difference) < MONEY_EPSILON,
    unknownAccounts,
  };
}

/**
 * قائمة الدخل — from posted entries only.
 *
 * Revenue and expense accounts are read from the ledger, never from the
 * operational tables. Management/supervisor fees come in as CONFIGURED rules
 * (`feeRules`), each with an effective date, so no percentage is hard-coded.
 */
export function incomeStatement(accounts, entries, lines, { from = null, to = null, feeRules = [] } = {}) {
  const tb = trialBalance(accounts, entries, lines, { from, to });
  const index = indexAccounts(accounts);

  const revenue = [], costOfServices = [], expenses = [];
  for (const r of tb.rows) {
    const a = index.get(r.code);
    if (!a) continue;
    if (a.accountType === 'revenue') {
      revenue.push({ ...r, amount: round2(r.credit - r.debit) });
    } else if (a.accountType === 'expense') {
      const amount = round2(r.debit - r.credit);
      // Direct service costs are separated from overheads so gross margin is
      // meaningful for a wash business.
      if (a.directCost || r.code.startsWith('50') || r.code.startsWith('51')) {
        costOfServices.push({ ...r, amount });
      } else {
        expenses.push({ ...r, amount });
      }
    }
  }

  const totalRevenue = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalCost    = round2(costOfServices.reduce((s, r) => s + r.amount, 0));
  const grossProfit  = round2(totalRevenue - totalCost);
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  const operatingProfit = round2(grossProfit - totalExpenses);

  // Configured fees, applied only when their effective date has arrived.
  const appliedFees = (feeRules || [])
    .filter((f) => !f.effectiveFrom || !to || f.effectiveFrom <= to)
    .map((f) => ({
      key:    f.key,
      label:  f.label,
      basis:  f.basis || 'revenue',
      rate:   Number(f.rate) || 0,
      effectiveFrom: f.effectiveFrom || null,
      amount: round2((f.basis === 'profit' ? operatingProfit : totalRevenue) * (Number(f.rate) || 0)),
    }));
  const totalFees = round2(appliedFees.reduce((s, f) => s + f.amount, 0));

  return {
    revenue, costOfServices, expenses,
    totalRevenue, totalCost, grossProfit, totalExpenses, operatingProfit,
    appliedFees, totalFees,
    netProfit: round2(operatingProfit - totalFees),
  };
}

/**
 * المركز المالي.
 *
 * Assets = Liabilities + Equity. Because equity here excludes the current
 * period's result, that result is added back as "أرباح الفترة" — otherwise
 * the sheet would be out by exactly the net profit.
 */
export function balanceSheet(accounts, entries, lines, { asOf = null, feeRules = [] } = {}) {
  const tb = trialBalance(accounts, entries, lines, { to: asOf });
  const index = indexAccounts(accounts);

  const assets = [], liabilities = [], equity = [];
  for (const r of tb.rows) {
    const a = index.get(r.code);
    if (!a) continue;
    const debitPositive  = round2(r.debit - r.credit);
    const creditPositive = round2(r.credit - r.debit);
    if (a.accountType === 'asset')      assets.push({ ...r, amount: debitPositive });
    else if (a.accountType === 'liability') liabilities.push({ ...r, amount: creditPositive });
    else if (a.accountType === 'equity')    equity.push({ ...r, amount: creditPositive });
  }

  const is = incomeStatement(accounts, entries, lines, { to: asOf, feeRules });
  const totalAssets      = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const equityBeforeResult = round2(equity.reduce((s, r) => s + r.amount, 0));
  const periodResult     = is.netProfit;
  const totalEquity      = round2(equityBeforeResult + periodResult);
  const difference       = round2(totalAssets - (totalLiabilities + totalEquity));

  return {
    assets, liabilities, equity,
    totalAssets, totalLiabilities,
    equityBeforeResult, periodResult, totalEquity,
    difference,
    balanced: Math.abs(difference) < MONEY_EPSILON,
  };
}

/**
 * رصيد شريك — derived, never stored.
 * The credit balance of the partner's capital account IS what they have paid.
 */
export function partnerCapitalBalance(partnerAccountCode, entries, lines) {
  const code = String(partnerAccountCode);
  let bal = 0;
  for (const l of postedLines(entries, lines)) {
    if (String(l.accountId) !== code) continue;
    bal += (Number(l.credit) || 0) - (Number(l.debit) || 0);
  }
  return round2(bal);
}
