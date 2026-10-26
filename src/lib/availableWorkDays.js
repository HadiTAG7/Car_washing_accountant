import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { monthRange } from './accounting/monthlyStatement.js';

const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Display-only scheduled days, not attendance. Same proration for the full
 * requirement and elapsed actual: calendar eligibility × (month − leave)/month.
 * beforeDate is exclusive, so today's unfinished day never counts. */
export function availableWorkDays({ periodKey, startDate = null, endDate = null, beforeDate = null,
  monthlyDaysOff = OVERVIEW_SETTINGS.monthlyDaysOff }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '')) return null;
  const range = monthRange(periodKey), monthDays = Number(range.to.slice(8));
  if ((startDate && !realDay(startDate)) || (endDate && !realDay(endDate))
    || (beforeDate && !realDay(beforeDate)) || !Number.isFinite(monthlyDaysOff) || monthlyDaysOff < 0 || monthlyDaysOff > monthDays) return null;
  const from = startDate && startDate > range.from ? startDate : range.from;
  let to = endDate && endDate < range.to ? endDate : range.to;
  if (beforeDate) {
    const yesterday = new Date(Date.parse(`${beforeDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    if (yesterday < to) to = yesterday;
  }
  const calendarDays = to < from ? 0 : (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  return { from, to, monthDays, calendarDays, workDays: calendarDays * (monthDays - monthlyDaysOff) / monthDays };
}
