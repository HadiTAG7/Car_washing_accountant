import { round2 } from './journal.js';
import { incomeStatementLines, sourceKindOf } from './reports.js';

/** Trace the accepted statement movements, never a second operational query. */
export function incomeStatementDetails({ statement, accounts, entries, lines, operationalItems, factor }) {
  const byEntry = new Map(entries.map(entry => [entry.id, entry]));
  const byAccount = new Map(accounts.map(account => [String(account.code), account]));
  const byEntryLines = new Map();
  for (const line of lines) {
    if (!byEntryLines.has(line.entryId)) byEntryLines.set(line.entryId, []);
    byEntryLines.get(line.entryId).push({ accountCode: String(line.accountId), description: line.description || '',
      debit: Number(line.debit) || 0, credit: Number(line.credit) || 0 });
  }
  const revenueCodes = new Set(statement.revenueRows.map(row => String(row.code)));
  const directCodes = new Set(statement.costRows.map(row => String(row.code)));
  const operatingCodes = new Set(statement.expenseRows.map(row => String(row.code)));
  const allIncomeLines = incomeStatementLines(entries, lines);
  const movements = allIncomeLines.filter(line => (!statement.from || line.accountingDate >= statement.from)
    && (!statement.to || line.accountingDate <= statement.to)).flatMap((line, index) => {
    const code = String(line.accountId);
    if (!revenueCodes.has(code) && !directCodes.has(code) && !operatingCodes.has(code)) return [];
    const entry = byEntry.get(line.entryId);
    const original = byEntry.get(entry.reversesEntryId || entry.reversalOf);
    const tax = entry.purchaseTaxSnapshot || entry.taxSnapshot;
    const rawAmount = (revenueCodes.has(code) ? 1 : -1) * ((Number(line.credit) || 0) - (Number(line.debit) || 0));
    if (!rawAmount) return [];
    return [{ id: `journal:${line.entryId}:${line.id || index}`, accountCode: code,
      accountName: byAccount.get(code)?.nameArabic || byAccount.get(code)?.name || code,
      date: line.entryDate, accountingPeriod: line.accountingPeriod, periodBasis: line.periodBasis,
      description: line.description || entry.description || '', amount: round2(rawAmount * factor),
      status: original ? 'reversal' : entry.status,
      source: { kind: sourceKindOf(entry), id: entry.sourceId || original?.sourceId || null,
        entryId: entry.id, entryNumber: entry.entryNumber, date: entry.entryDate,
        description: entry.description || '', accountingPeriod: line.accountingPeriod,
        documentNumber: tax?.invoiceNumber || entry.invoiceNumber || null,
        invoiceDate: tax?.invoiceDate || null, supplier: tax?.supplier || null, tax,
        lines: byEntryLines.get(entry.id) || [] } }];
  });
  for (const item of operationalItems) {
    movements.push({ id: `operation:${item.sourceKind}:${item.sourceId}`, accountCode: item.accountCode,
      accountName: byAccount.get(item.accountCode)?.nameArabic || byAccount.get(item.accountCode)?.name || item.accountCode,
      date: item.date, accountingPeriod: item.date.slice(0, 7), periodBasis: 'record_date',
      description: item.description, amount: round2(item.amount * factor), status: 'unposted',
      source: { kind: item.sourceKind, id: item.sourceId, date: item.date, description: item.description,
        documentNumber: item.documentNumber || item.sspBookingId || null, supplier: item.supplier || null,
        invoiceDate: item.invoiceDate || null, tax: item.taxSnapshot || { net: item.amount, vat: item.vat, gross: item.gross } } });
  }
  const complete = (key, amount, items, components = [], adjustments = []) => {
    const sum = round2(items.reduce((total, item) => total + item.amount, 0));
    const existing = round2(adjustments.reduce((total, item) => total + item.amount, 0));
    const difference = round2(amount - sum - existing);
    if (difference) adjustments = [...adjustments, { kind: items.length && Math.abs(difference) <= items.length * 0.005 + 0.011
      ? 'rounding' : 'unexplained', amount: difference }];
    return { key, amount, items, components, adjustments, itemsTotal: sum,
      reconciledTotal: round2(sum + adjustments.reduce((total, item) => total + item.amount, 0)) };
  };
  const detail = {};
  const base = (key, amount, predicate, sign = 1) => {
    detail[key] = complete(key, amount, movements.filter(predicate).map(item => ({ ...item, amount: round2(item.amount * sign) })));
  };
  base('grossRevenue', statement.grossRevenue, item => item.accountCode === '4000');
  base('salesReturns', statement.salesReturns, item => item.accountCode === '4010', -1);
  base('otherRevenue', statement.otherRevenue, item => revenueCodes.has(item.accountCode) && !['4000', '4010'].includes(item.accountCode));
  base('directCosts', statement.directCosts, item => directCodes.has(item.accountCode));
  base('operatingExpenses', statement.operatingExpenses, item => operatingCodes.has(item.accountCode));
  // Salary journal dates in this month whose expense belongs elsewhere are
  // explained separately, outside the selected amount and its item sum.
  detail.directCosts.periodTransfers = allIncomeLines.filter(line => String(line.accountId) === '5010'
    && byAccount.get('5010')?.accountType === 'expense'
    && line.periodBasis.startsWith('payroll') && line.entryDate >= statement.from && line.entryDate <= statement.to
    && line.accountingPeriod !== statement.periodKey).map(line => ({ periodKey: line.accountingPeriod,
    entryNumber: line.entryNumber, paymentDate: line.entryDate,
    amount: round2(((Number(line.debit) || 0) - (Number(line.credit) || 0)) * factor) }));
  const combine = (key, amount, parts) => {
    const items = parts.flatMap(([part, sign]) => detail[part].items.map(item => ({ ...item, amount: round2(item.amount * sign) })));
    const adjustments = parts.flatMap(([part, sign]) => detail[part].adjustments.map(item => ({ ...item, amount: round2(item.amount * sign) })));
    const components = parts.map(([part, sign]) => ({ key: part, sign, amount: detail[part].amount }));
    detail[key] = complete(key, amount, items, components, adjustments);
  };
  combine('netRevenue', statement.netRevenue, [['grossRevenue', 1], ['salesReturns', -1], ['otherRevenue', 1]]);
  combine('totalCosts', statement.totalCosts, [['directCosts', 1], ['operatingExpenses', 1]]);
  combine('grossProfit', statement.grossProfit, [['netRevenue', 1], ['directCosts', -1]]);
  combine('netProfitBeforeFees', statement.netProfitBeforeFees, [['grossProfit', 1], ['operatingExpenses', -1]]);
  for (const fee of statement.fees) {
    const key = `fee:${fee.key}`;
    detail[key] = complete(key, fee.amount, [{ id: key, accountCode: '', accountName: fee.label,
      description: fee.label, status: 'calculated', amount: fee.amount,
      fee: { ...fee, base: fee.basis === 'profit' ? statement.netProfitBeforeFees : statement.netRevenue } }]);
  }
  combine('netProfit', statement.netProfit, [['netProfitBeforeFees', 1], ...statement.fees.map(fee => [`fee:${fee.key}`, -1])]);
  return detail;
}
