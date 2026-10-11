const round = value => Math.round(value * 100) / 100;
const money = value => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('مكونات مصروف الرواتب غير صالحة؛ راجع المسير.');
  return number;
};

// Read-only projection of the server payroll's salary account (5010).
// Commissions remain variable costs, and advance recovery is not a wage discount.
export function monthlyPayrollExpenses(preview, periodKey) {
  if (preview?.periodKey !== periodKey || !Array.isArray(preview?.lines)) {
    throw new Error('معاينة الرواتب لا تطابق الشهر المطلوب.');
  }
  const rows = preview.lines.map(line => {
    if (line.basicDue == null) throw new Error('مكونات مصروف الرواتب غير صالحة؛ راجع المسير.');
    const amount = round(money(line.basicDue) + money(line.bonus) - money(line.deduction));
    if (amount < 0) throw new Error('مكونات مصروف الرواتب غير صالحة؛ راجع المسير.');
    const paid = line.status === 'paid';
    return { bikerId: line.bikerId, bikerName: line.name, amount, basic: money(line.basicDue),
      bonus: money(line.bonus), deduction: money(line.deduction), days: line.daysEntitled,
      paid, payDate: paid ? line.payDate || null : null };
  }).filter(row => row.amount > 0);
  const total = round(rows.reduce((sum, row) => sum + row.amount, 0));
  const paid = round(rows.filter(row => row.paid).reduce((sum, row) => sum + row.amount, 0));
  return { periodKey, rows, total, paid, pending: round(total - paid), estimated: preview.estimated === true,
    snapshotOnly: preview.snapshotOnly === true, distributionDate: preview.distributionDate || null };
}

export function monthlyItemsForPeriod(items, periodKey) {
  return items.filter(row => row.recurrence !== 'one_time'
    || String(row.loggedDate || row.invoiceDate || '').slice(0, 7) === periodKey);
}

// A legacy salary row may overlap payroll. Do not silently add both or delete either.
export function hasManualSalaryRows(items, categories = []) {
  const salaryCategories = new Set(categories.filter(c => /رواتب|أجور|salary|wage|payroll/i.test(c.label || '')).map(c => c.id));
  return items.some(row => salaryCategories.has(row.categoryId) || /راتب|رواتب|salary|wage|payroll/i.test(row.expenseName || ''));
}
