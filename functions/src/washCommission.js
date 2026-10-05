// Current owner-approved rate; payroll stores its policy separately for history.
export const WASH_COMMISSION_RATE = 4.5;
export const WASH_COMMISSION_EFFECTIVE_MONTH = '2026-10';

export function completedCommissionWash(row) {
  return ['مكتملة', 'completed', 'complete'].includes(String(row.status ?? '').trim().toLowerCase());
}

// Accept raw server rows and mapped UI rows. Duplicate execution IDs count once.
export function uniqueCompletedCommissionWashes(washes, from, to, onConflict = () => {}) {
  const seen = new Map();
  return washes.filter(row => {
    const date = String(row.wash_date ?? row.washDate ?? '').slice(0, 10);
    const dateMs = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateMs)
      || new Date(dateMs).toISOString().slice(0, 10) !== date
      || date < from || date > to || !completedCommissionWash(row)) return false;
    const booking = String(row.ssp_booking_id ?? row.sspBookingId ?? '').trim();
    const key = booking ? `ssp:${booking}` : row.id ? `wash:${row.id}` : null;
    if (booking && Number(row.quantity) !== 1) {
      onConflict('غسلة SSP يجب أن تمثل تنفيذًا واحدًا؛ راجع الكمية قبل اعتماد المسير.');
      return false;
    }
    const bikerId = row.biker_id ?? row.bikerId;
    const execution = JSON.stringify({ biker: bikerId ? `id:${bikerId}` : `name:${String(row.biker_name ?? row.bikerName ?? '').trim()}`,
      date, quantity: Math.max(0, Number(row.quantity) || 0) });
    if (key && seen.has(key)) {
      if (seen.get(key) !== execution) onConflict('غسلة مكررة بتنفيذ أو عامل مختلف؛ راجع الربط قبل اعتماد المسير.');
      return false;
    }
    if (key) seen.set(key, execution);
    return true;
  });
}
