import { uniqueCompletedCommissionWashes } from '../../functions/src/washCommission.js';

export const riyadhToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
const dayMs = 86400000;
const dateValue = value => {
  const text = String(value || '').slice(0, 10);
  const ms = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text ? text : null;
};
const dateMs = date => Date.parse(`${date}T00:00:00Z`);
const rounded = n => Math.round(n * 100) / 100;

// Strict stable identities. Legacy names can be ambiguous and are reported,
// not silently attributed to a different person with the same name.
export function bikerProfileStats({ biker, washes = [], bookings = [], periodKey, today = riyadhToday() }) {
  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey || '') && Boolean(dateValue(today));
  if (!validPeriod) return { validPeriod: false };
  const [year, month] = periodKey.split('-').map(Number);
  const from = `${periodKey}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const conflicts = [];
  const unique = uniqueCompletedCommissionWashes(washes, '0001-01-01', today, message => conflicts.push(message));
  const own = unique.filter(w => biker.id && String(w.bikerId ?? w.biker_id ?? '') === String(biker.id));
  const inMonth = own.filter(w => String(w.washDate ?? w.wash_date).slice(0, 7) === periodKey);
  const count = list => list.reduce((sum, w) => sum + Math.max(0, Number(w.quantity) || 0), 0);
  const onDate = date => count(own.filter(w => String(w.washDate ?? w.wash_date).slice(0, 10) === date));
  const yesterday = new Date(dateMs(today) - dayMs).toISOString().slice(0, 10);
  const start = [from, dateValue(biker.startDate)].filter(Boolean).sort().at(-1);
  const end = [to, today, dateValue(biker.endDate)].filter(Boolean).sort()[0];
  const daily = [];
  for (let ms = dateMs(start); ms <= dateMs(end); ms += dayMs) {
    const date = new Date(ms).toISOString().slice(0, 10);
    daily.push({ date, count: onDate(date) });
  }
  daily.reverse();
  const monthWashes = count(inMonth);
  const washDays = new Set(inMonth.map(w => String(w.washDate ?? w.wash_date).slice(0, 10))).size;
  const calendarWashes = daily.reduce((sum, d) => sum + d.count, 0);
  const matched = bookings.map(b => ({ ...b.record, ...(!b.record ? b : {}), linkedBikerId: b.bikerId ?? b.biker_id }))
    .filter(r => r.linkedBikerId ? String(r.linkedBikerId) === String(biker.id)
      : Boolean(biker.driverExternalId) && String(r.driverExternalId || '').trim() === String(biker.driverExternalId).trim())
    .filter(r => dateValue(r.serviceDate) && r.serviceDate >= from && r.serviceDate <= to && r.serviceDate <= today);
  const seenBookings = new Set();
  const qualityRows = matched.filter(r => {
    if (!r.sspBookingId) return false;
    if (seenBookings.has(r.sspBookingId)) return false;
    seenBookings.add(r.sspBookingId); return true;
  });
  const ratings = qualityRows.filter(r => r.rating !== null && r.rating !== undefined && String(r.rating).trim() !== ''
    && Number.isFinite(Number(r.rating)) && Number(r.rating) > 0 && Number(r.rating) <= 5);
  const ticketMap = new Map();
  for (const row of qualityRows) {
    const ref = typeof row.ticketRef === 'string' ? row.ticketRef.trim() : '';
    if (!ref) continue;
    if (!ticketMap.has(ref)) ticketMap.set(ref, { ref, bookingIds: [], dates: [] });
    ticketMap.get(ref).bookingIds.push(row.sspBookingId);
    ticketMap.get(ref).dates.push(row.serviceDate);
  }
  return {
    validPeriod, today, yesterday, lifetimeWashes: count(own), monthWashes,
    todayWashes: onDate(today), yesterdayWashes: onDate(yesterday), daily,
    calendarDays: daily.length, washDays,
    averagePerCalendarDay: daily.length ? rounded(calendarWashes / daily.length) : null,
    averagePerWashDay: washDays ? rounded(monthWashes / washDays) : null,
    unlinkedLegacyRows: unique.filter(w => !(w.bikerId ?? w.biker_id)
      && String(w.bikerName ?? w.biker_name ?? '').trim() === String(biker.name || '').trim()).length,
    conflicts: [...new Set(conflicts)],
    quality: { importedBookings: qualityRows.length, ratedCount: ratings.length,
      averageRating: ratings.length ? rounded(ratings.reduce((sum, r) => sum + Number(r.rating), 0) / ratings.length) : null,
      ratings, tickets: [...ticketMap.values()] },
  };
}
