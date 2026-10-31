import { ownerBookingIdentity } from './bookingIdentity.js';

const clean = value => typeof value === 'string' ? value.trim() : '';
const instant = value => {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value || '') || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? Date.parse(value) : null;
};

// The same natural identity as ingestion, without changing any stored prefix.
export function cancellationSourceIds(id) {
  const number = ownerBookingIdentity(id);
  return [...new Set([id, ...(/^\d+$/.test(number) ? [number, ...['B', 'C', 'S'].map(prefix => `${prefix}-${number}`)] : [])])].filter(Boolean);
}

export function bookingSourceObservations(booking, rawRows = []) {
  const record = booking.record ?? booking;
  const number = ownerBookingIdentity(record.sspBookingId);
  return rawRows.filter(row => ownerBookingIdentity(row.sspBookingId) === number
    && row.rawPayload?.sspBookingId === row.sspBookingId)
    .map(row => ({ record: row.rawPayload, savedAt: row.fetchedAtIso, id: row.id, original: false }))
    .filter(row => instant(row.savedAt) !== null)
    .sort((a, b) => instant(b.savedAt) - instant(a.savedAt) || String(a.id).localeCompare(String(b.id)));
}

const parties = { 'cancelled by admin': 'admin', 'cancelled by biker': 'biker', 'cancelled by customer': 'customer',
  'canceled by admin': 'admin', 'canceled by biker': 'biker', 'canceled by customer': 'customer' };

export function cancellationDetails(record = {}) {
  const notes = clean(record.notes), cards = notes.split(/Cancellation Reason\s*\n/i);
  // Ambiguous repeated cards are not silently merged into one event.
  const card = cards.length === 2 ? cards[1] : '';
  const lines = card.split(/\r?\n/).map(line => line.trim());
  const field = label => {
    const index = lines.findIndex(line => line.toLowerCase() === label.toLowerCase());
    const value = index >= 0 ? lines[index + 1] : null;
    return value && !/^(Cancelled At|Cancelled By|Reason)$/i.test(value) ? value : null;
  };
  const reason = field('Reason')?.split(/;\s*(?:Type\/timezone|cancellation raw only)/i)[0].trim() || null;
  const actor = field('Cancelled By');
  const actorName = actor && !/^(admin|administrator|biker|customer)$/i.test(actor) ? actor : null;
  return { party: parties[clean(record.rawStatus).toLowerCase()] || null, actorName, reason,
    time: field('Cancelled At'), ambiguous: cards.length > 2,
    // A reference to an old clarification is not a recorded timezone value.
    timeZone: /(?:time\s*zone|timezone)\s*[:=]\s*Asia\/Riyadh\b/i.test(notes) ? 'Asia/Riyadh' : null,
    sourceCard: cards.length === 2 ? `Cancellation Reason\n${card.split(/\nSSP_INVOICE_DEDUCTION_V1=/)[0]}` : null };
}

export function cancellationTime(value, timeZone, language = 'ar') {
  if (!value) return { text: null, converted: false, precision: null };
  let stamp = instant(value);
  const precision = /T\d{2}:\d{2}:\d{2}/.test(value) ? 'second' : 'minute';
  if (stamp === null && timeZone === 'Asia/Riyadh') {
    const match = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/i.exec(value);
    if (match) {
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const month = months.indexOf(match[1].toLowerCase()), day = Number(match[2]), year = Number(match[3]);
      const hour = Number(match[4]), minute = Number(match[5]);
      const date = new Date(Date.UTC(year, month, day));
      if (hour >= 1 && hour <= 12 && minute < 60 && date.getUTCMonth() === month && date.getUTCDate() === day) {
        stamp = Date.UTC(year, month, day, hour % 12 + (/pm/i.test(match[6]) ? 12 : 0) - 3, minute);
      }
    }
  }
  if (stamp === null) return { text: value, converted: false, precision: null };
  return { text: new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', {
    timeZone: 'Asia/Riyadh', numberingSystem: 'latn', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(precision === 'second' ? { second: '2-digit' } : {}), hour12: false,
  }).format(new Date(stamp)), converted: true, precision };
}

export function cancellationSourceLink(value) {
  try { const url = new URL(value); return url.origin === 'https://ssp-portal.sweater.sa' && !url.hash
    && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|auth|secret|session|cookie/i.test(key)) ? url.href : null; }
  catch { return null; }
}
