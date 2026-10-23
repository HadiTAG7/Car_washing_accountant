import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { monthRange } from './accounting/monthlyStatement.js';

// Break-even, read-only and display-only. Costs are the statement's own
// (monthlyStatement.totalCosts: direct costs + operating expenses), so these
// figures reconcile with the income statement and never form a second P&L.

const finite = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const cents = value => Math.round(value * 100);
const monthDaysOf = periodKey => Number(monthRange(periodKey).to.slice(8));

/** Coverage tone: green from 100%, yellow from 80% to 99%, red below 80%. */
export const coverageTone = coverage => coverage === null || coverage === undefined ? null
  : coverage >= 1 ? 'green' : coverage >= 0.8 ? 'yellow' : 'red';

/**
 * Washes needed a day: the month's costs ÷ net wash price ÷ calendar days.
 * `basis` says which costs: a complete month's, or the month to date.
 */
export function dailyBreakEven({ statement, periodKey, completeMonth, settings = OVERVIEW_SETTINGS }) {
  const costs = finite(statement?.totalCosts);
  if (costs === null || costs < 0 || !(settings.washNetPrice > 0) || !periodKey) return null;
  const monthDays = monthDaysOf(periodKey);
  return { costs, monthDays, price: settings.washNetPrice, required: costs / settings.washNetPrice / monthDays,
    basis: completeMonth ? 'month' : 'month_to_date',
    estimated: Boolean(statement?.salaryAccrual?.estimated), partial: Boolean(statement?.issues?.length) };
}

/** Each completed day against the line; today is still running and is neither. */
export function dailyBreakEvenDays(daily = [], required) {
  if (finite(required) === null) return null;
  const days = daily.map(day => ({ ...day, gap: day.quantity - required, reached: day.incomplete ? null : day.quantity >= required }));
  const completed = days.filter(day => !day.incomplete);
  return { days, completed: completed.length, reached: completed.filter(day => day.reached).length,
    averageGap: completed.length ? completed.reduce((sum, day) => sum + day.gap, 0) / completed.length : null };
}

/**
 * Break-even for each biker in one month.
 *
 * Direct costs are what is recorded against the biker. In the data model only
 * salaries carry one: the payroll preview line (basicDue + bonus − deduction),
 * which is exactly the statement's salary accrual. Housing, bike/insurance,
 * fuel, phone and iqama/fees have no biker field, so they are shared.
 *
 * Who carries the cost (settings.bikerBreakEvenBasis): 'washers' — bikers on
 * the payroll with a wash on a completed day of the month (the salaries of
 * those without one join the shared costs); 'payroll' — everyone paid.
 *
 * Shared costs = the statement's total − the carriers' direct costs, split
 * equally per payroll-eligible day (the payroll's own start/end proration).
 * Shares are apportioned in halalas so the allocation sums to the total exactly.
 *
 * A biker with eligible days but no recorded direct cost gets the average
 * direct cost per eligible day and is marked approximate; that amount is not a
 * recorded cost and is reported apart from the reconciliation.
 */
export function bikerBreakEven({ statement, payrollLines = [], washes = [], bikers = [], periodKey, today, settings = OVERVIEW_SETTINGS }) {
  const total = finite(statement?.totalCosts);
  if (total === null || !periodKey || !(settings.washNetPrice > 0)) return null;
  if (settings.fixedCostAllocation !== 'equal') throw new Error(`Unsupported fixed cost allocation: ${settings.fixedCostAllocation}`);
  if (!['washers', 'payroll'].includes(settings.bikerBreakEvenBasis)) throw new Error(`Unsupported break-even basis: ${settings.bikerBreakEvenBasis}`);
  const monthDays = monthDaysOf(periodKey);
  const { from, to } = monthRange(periodKey);
  const names = new Map(bikers.map(biker => [biker.id, biker]));

  const lines = new Map();
  for (const line of payrollLines) {
    if (!line?.bikerId) continue;
    if (finite(line.basicDue) === null) return { error: 'payroll_incomplete' };
    const days = Math.min(monthDays, Math.max(0, finite(line.daysEntitled) ?? 0));
    const direct = cents(finite(line.basicDue) + (finite(line.bonus) ?? 0) - (finite(line.deduction) ?? 0));
    const prior = lines.get(line.bikerId);
    lines.set(line.bikerId, { bikerId: line.bikerId, name: line.name, days: (prior?.days ?? 0) + days, direct: (prior?.direct ?? 0) + direct });
  }

  // Completed days only (today is still running), as the overview averages.
  const byBiker = new Map(); let unlinkedWashes = 0;
  for (const wash of washes) {
    const day = wash.washDate ?? wash.wash_date; const quantity = Math.max(0, Number(wash.quantity) || 0);
    if (!day || day < from || day > to || (today && day >= today) || !quantity) continue;
    const bikerId = String(wash.bikerId ?? wash.biker_id ?? '').trim();
    if (!bikerId) { unlinkedWashes += quantity; continue; }
    const entry = byBiker.get(bikerId) || { washes: 0, days: new Set() };
    entry.washes += quantity; entry.days.add(day); byBiker.set(bikerId, entry);
  }

  const paid = [...lines.values()].filter(row => row.days > 0);
  // Paid this month without a wash on a completed day.
  const idle = paid.filter(row => !byBiker.has(row.bikerId));
  const active = settings.bikerBreakEvenBasis === 'washers' ? paid.filter(row => byBiker.has(row.bikerId)) : paid;
  const directTotal = active.reduce((sum, row) => sum + row.direct, 0);
  const shared = cents(total) - directTotal;
  const daySum = active.reduce((sum, row) => sum + row.days, 0);

  // Equal per eligible day, largest remainder so the halalas add up.
  const exact = active.map(row => daySum ? shared * row.days / daySum : 0);
  const shares = exact.map(Math.trunc);
  let left = shared - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, i) => [Math.abs(value - shares[i]), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left !== 0 && order.length; k = (k + 1) % order.length) { shares[order[k][1]] += Math.sign(left); left -= Math.sign(left); }

  const recorded = active.filter(row => row.direct > 0);
  const directPerDay = recorded.length ? recorded.reduce((sum, row) => sum + row.direct, 0) / recorded.reduce((sum, row) => sum + row.days, 0) : null;

  const workDaysFull = monthDays - (finite(settings.monthlyDaysOff) ?? 0);
  const rows = active.map((row, i) => {
    const approximate = row.direct <= 0 && directPerDay !== null;
    const approxDirect = approximate ? Math.round(directPerDay * row.days) : 0;
    const cost = row.direct + approxDirect + shares[i];
    const requiredMonthly = cost / 100 / settings.washNetPrice;
    const workDays = workDaysFull * row.days / monthDays;
    const requiredDaily = workDays > 0 ? requiredMonthly / workDays : null;
    const done = byBiker.get(row.bikerId);
    const actualDaily = done?.days.size ? done.washes / done.days.size : null;
    const coverage = requiredDaily ? (actualDaily ?? 0) / requiredDaily : null;
    const biker = names.get(row.bikerId);
    return { bikerId: row.bikerId, biker: biker || null, name: biker?.name || row.name || row.bikerId,
      activeDays: row.days, monthDays, direct: row.direct / 100, approximate, approxDirect: approxDirect / 100, share: shares[i] / 100,
      cost: cost / 100, requiredMonthly, workDays, requiredDaily, washes: done?.washes ?? 0, washDays: done?.days.size ?? 0,
      actualDaily, coverage, tone: coverageTone(coverage), overCapacity: requiredDaily !== null && requiredDaily > settings.dailyAppointmentsPerBiker };
  });
  // Bikers with washes but no eligible payroll days carry no cost here.
  const outside = [...byBiker.entries()].filter(([id]) => !paid.some(row => row.bikerId === id))
    .map(([id, done]) => ({ bikerId: id, biker: names.get(id) || null, name: names.get(id)?.name || id, washes: done.washes, washDays: done.days.size }));
  // Their salaries, and the daily break-even (overview definition) without them.
  const idleSalaries = idle.reduce((sum, row) => sum + row.direct, 0);
  const idleSummary = { count: idle.length, salaries: idleSalaries / 100,
    rows: idle.map(row => ({ bikerId: row.bikerId, biker: names.get(row.bikerId) || null, name: names.get(row.bikerId)?.name || row.name || row.bikerId,
      activeDays: row.days, salary: row.direct / 100 })),
    dailyRequired: total / settings.washNetPrice / monthDays,
    dailyWithout: (cents(total) - idleSalaries) / 100 / settings.washNetPrice / monthDays };

  const allocated = rows.reduce((sum, row) => sum + cents(row.direct) + cents(row.share), 0);
  const withRequired = rows.filter(row => row.requiredDaily !== null);
  return { periodKey, basis: settings.bikerBreakEvenBasis, total, monthDays, directTotal: directTotal / 100, shared: shared / 100, allocatedTotal: allocated / 100,
    difference: (cents(total) - allocated) / 100, approximateTotal: rows.reduce((sum, row) => sum + row.approxDirect, 0),
    averageRequiredDaily: withRequired.length ? withRequired.reduce((sum, row) => sum + row.requiredDaily, 0) / withRequired.length : null,
    rows, idle: idleSummary, outside, unlinkedWashes, estimated: Boolean(statement?.salaryAccrual?.estimated) };
}
