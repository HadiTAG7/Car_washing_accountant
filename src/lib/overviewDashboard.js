import { uniqueCompletedCommissionWashes } from '../../functions/src/washCommission.js';
import { monthRange } from './accounting/monthlyStatement.js';
import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';

const round = n => Math.round(n * 100) / 100;
export const isOverviewWorkingBiker = biker => ['يشتغل', 'شغال', 'working'].includes(String(biker.currentStatus || '').trim().toLowerCase());
/** A biker who has left: status «هرب» or «مشيناه», alone or followed by more words. */
export const isDepartedStatus = (status, settings = OVERVIEW_SETTINGS) => {
  const value = String(status || '').trim();
  return settings.departedStatuses.some(word => value === word || value.startsWith(`${word} `));
};
const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function overviewWindow(periodKey, today) {
  const range = monthRange(periodKey);
  if (!realDay(range.from) || !realDay(today) || range.from > today) return null;
  const to = range.to < today ? range.to : today;
  const [year, month] = periodKey.split('-').map(Number);
  const previousKey = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const previous = monthRange(previousKey);
  // Completed months compare whole months; a current month compares only
  // elapsed calendar days, clamped for February / shorter previous months.
  const previousTo = range.to <= today ? previous.to
    : `${previousKey}-${String(Math.min(Number(to.slice(8)), Number(previous.to.slice(8)))).padStart(2, '0')}`;
  return { from: range.from, to, previousKey, previousFrom: previous.from, previousTo,
    completeMonth: range.to < today };
}

// Descriptive, read-only operational aggregation. Raw booking status never
// creates a wash or revenue. Reuse the same execution deduplication as profiles.
export function overviewOperations({ washes = [], bikers = [], periodKey, today }) {
  const window = overviewWindow(periodKey, today);
  if (!window) return null;
  const conflicts = [];
  const unique = uniqueCompletedCommissionWashes(washes, window.previousFrom, today, message => conflicts.push(message));
  const sum = rows => rows.reduce((total, row) => total + Math.max(0, Number(row.quantity) || 0), 0);
  const inRange = (from, to) => unique.filter(row => row.washDate >= from && row.washDate <= to);
  const selected = inRange(window.from, window.to);
  const previous = inRange(window.previousFrom, window.previousTo);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const daily = [];
  for (let date = window.from; date <= window.to; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const rows = selected.filter(row => row.washDate === date);
    daily.push({ date, quantity: sum(rows), rows, incomplete: date === today });
  }
  const completedDays = daily.filter(day => !day.incomplete);
  const completedQuantity = completedDays.reduce((total, day) => total + day.quantity, 0);
  const washDays = completedDays.filter(day => day.quantity > 0).length;
  // One denominator unit per biker on a day with positive washes. Do not use
  // today's status or calendar days as a proxy for historic work/attendance.
  const bikerDays = new Set(); const washingBikers = new Set(); let unlinkedBikerWashes = 0;
  for (const row of selected.filter(row => Number(row.quantity) > 0)) {
    const bikerId = String(row.bikerId ?? row.biker_id ?? '').trim();
    if (!bikerId) { unlinkedBikerWashes++; continue; }
    washingBikers.add(bikerId);
    if (row.washDate < today) bikerDays.add(JSON.stringify([bikerId, row.washDate ?? row.wash_date]));
  }
  const yesterdayRows = selected.filter(row => row.washDate === yesterday);
  const unlinkedCompleted = selected.some(row => row.washDate < today && Number(row.quantity) > 0 && !String(row.bikerId ?? row.biker_id ?? '').trim());
  return { ...window, rows: selected, daily, completedDays, completedQuantity, quantity: sum(selected),
    previousQuantity: previous.length ? sum(previous) : null, hasPreviousData: previous.length > 0,
    yesterday, yesterdayInPeriod: yesterday >= window.from && yesterday <= window.to, yesterdayRows,
    yesterdayQuantity: yesterday >= window.from && yesterday <= window.to ? sum(yesterdayRows) : null,
    washDays, average: washDays ? round(completedQuantity / washDays) : null,
    bikerWashDays: bikerDays.size, washingBikers: washingBikers.size, unlinkedBikerWashes,
    averagePerBikerDay: bikerDays.size && !unlinkedCompleted ? round(completedQuantity / bikerDays.size) : null,
    working: washingBikers.size, workingIds: [...washingBikers],
    unspecified: bikers.filter(biker => !String(biker.currentStatus || '').trim()).length,
    conflicts: [...new Set(conflicts)] };
}

export function overviewQuality({ bookings = [], periodKey, today, bikers = [] }) {
  const window = overviewWindow(periodKey, today);
  if (!window) return null;
  const seen = new Map(); let conflicts = 0; let excluded = 0;
  for (const booking of bookings) {
    const row = { ...(booking.record || booking), linkedBikerId: booking.bikerId ?? booking.biker_id };
    row.ticketRef = typeof row.ticketRef === 'string' ? row.ticketRef.trim() : '';
    if (!realDay(row.serviceDate) || row.serviceDate < window.from || row.serviceDate > window.to || !row.sspBookingId) { excluded++; continue; }
    const signature = JSON.stringify([row.serviceDate, row.rating, row.ticketRef, row.driverExternalId, row.linkedBikerId]);
    if (seen.has(row.sspBookingId)) { if (seen.get(row.sspBookingId).signature !== signature) conflicts++; continue; }
    seen.set(row.sspBookingId, { row, signature });
  }
  const rows = [...seen.values()].map(item => item.row);
  const rated = rows.filter(row => row.rating !== null && row.rating !== undefined && String(row.rating).trim() !== ''
    && Number.isFinite(Number(row.rating)) && Number(row.rating) > 0 && Number(row.rating) <= 5);
  const tickets = [...new Set(rows.map(row => typeof row.ticketRef === 'string' ? row.ticketRef.trim() : '').filter(Boolean))];
  const low = rated.filter(row => Number(row.rating) < 4);
  // Only stable, unambiguous identities. A name is never an attribution key.
  const attention = bikers.map(biker => {
    const own = rows.filter(row => row.linkedBikerId ? String(row.linkedBikerId) === String(biker.id)
      : biker.driverExternalId && bikers.filter(b => b.driverExternalId === biker.driverExternalId).length === 1
        && String(row.driverExternalId || '') === String(biker.driverExternalId));
    return { biker, low: own.filter(row => low.includes(row)).length,
      tickets: [...new Set(own.map(row => row.ticketRef?.trim()).filter(Boolean))].length };
  }).filter(item => item.low || item.tickets).sort((a, b) => b.low - a.low || b.tickets - a.tickets
    || String(a.biker.driverExternalId).localeCompare(String(b.biker.driverExternalId), undefined, { numeric: true }));
  return { rows, rated, low, tickets, attention, excluded, conflicts,
    average: rated.length ? round(rated.reduce((sum, row) => sum + Number(row.rating), 0) / rated.length) : null };
}
