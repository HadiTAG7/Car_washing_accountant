import { COMPENSATION_KEYS } from '../../functions/src/sweater/metricsContract.js';
import { cancellationDetails, bookingSourceObservations, cancellationSourceLink } from './sweater/cancellationDetails.js';
import { ownerBookingIdentity } from './sweater/bookingIdentity.js';
import { displayBikerName } from './bikerNames.js';

const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;
const dated = value => {
  if (day(String(value || '').slice(0, 10))) return value.slice(0, 10);
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})(?:\s|$)/i.exec(value || '');
  if (!match) return null;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const date = `${match[3]}-${String(months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return day(date) ? date : null; // Date text only; no invented timezone conversion.
};
const instant = value => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value || '') && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export function cancellationCandidate(booking) {
  return [booking.record ?? booking, booking.latestObservation].some(r => r && (/cancel|refused/i.test(r.rawStatus || '') || /Cancellation Reason\s*\n/i.test(r.notes || '')));
}

// Source status is not the identity of the person who clicked Cancel. Classify
// only explicit parties/reasons. An admin status alone is never a biker event.
export function cancellationType(record) {
  const detail = cancellationDetails(record);
  if (detail.ambiguous) return null;
  const reason = detail.reason?.trim() || '', status = (record.rawStatus || '').trim().toLowerCase();
  const candidates = new Set();
  if (detail.party === 'customer' || /^customer (?:cancel|request|refus)/i.test(reason)) candidates.add('cancelledByCustomer');
  if (detail.party === 'biker' || status === 'biker refused wash'
    || /^biker (?:delay|illness|absen|refus|cancel)/i.test(reason)) candidates.add('cancelledByBiker');
  if (/^(?:(?:bike|motorcycle) )?(?:maintenance|breakdown)\b/i.test(reason)) candidates.add('cancelledMaintenance');
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function sourceBiker(row, bikers, language) {
  const external = String(row.driverExternalId || '').trim();
  const matches = external ? bikers.filter(b => String(b.driverExternalId || '').trim() === external) : [];
  const conflict = matches.length > 1 || (matches.length === 1 && row.siteBikerId && matches[0].id !== row.siteBikerId);
  const linked = matches.length === 1 && !conflict ? matches[0] : null;
  return { ...row, bikerRowId: linked?.id || `source:${external || row.id}`, identityConflict: conflict,
    siteBikerName: linked ? displayBikerName(linked, language) : null,
    bikerLabel: linked ? displayBikerName(linked, language) : row.sourceBikerName || (language === 'en' ? 'Unlinked source biker' : 'بايكر غير مربوط بالموقع') };
}

// No arithmetic or posting across source domains: ticket compensation, wallet
// codes, invoice deductions and signed dashboard totals remain separate facts.
export function qualitySourceDetails({ month, reviews = [], bookings = [], raw = [], bikers = [], language = 'ar' }) {
  const groups = Object.fromEntries(COMPENSATION_KEYS.map(key => [key, []])), unclassified = [];
  const ticketIds = new Set(); let undatedTickets = 0;
  for (const review of reviews) {
    const source = review.source, facts = source?.facts;
    if (review.recordType !== 'ssp_ticket_review_v1' || !facts || !review.ticketId || ticketIds.has(review.ticketId)) continue;
    ticketIds.add(review.ticketId);
    // A ticket's creation month is explicit and independent of its service date.
    const date = facts.ticketDate || dated(facts.createdAt);
    if (!day(date)) { undatedTickets++; continue; }
    if (date.slice(0, 7) !== month) continue;
    const row = sourceBiker({ id: `ticket:${review.ticketId}`, kind: 'ticket', sourceId: review.ticketId,
      date, dateBasis: 'ticket', driverExternalId: facts.biker?.externalId, siteBikerId: facts.biker?.siteId,
      sourceBikerName: facts.biker?.name, reason: facts.complaint, sourceUrl: cancellationSourceLink(source.source?.url),
      sourceReadAt: source.source?.readAt, review, source, quantity: null, amount: null }, bikers, language);
    groups.compensations.push(row);
    // Only an explicitly recorded compensation COUNT can be a free-wash row.
    // SAR 20 or a customer promo/wallet amount does not establish that type.
    const free = a => a.kind === 'compensation' && a.unit === 'count' && Number.isSafeInteger(a.value) && a.value > 0
      && /^(?:Compensations?(?: type)?|نوع التعويض)\s*:\s*(?:Free[ _-]*Wash(?: Compensation)?|غسلة مجانية)(?:\s*[;،؛.]|$)/i.test(a.sourceRef || '');
    if (source.amounts?.some(free)) {
      groups.freeWashCompensation.push({ ...row, id: `free:${review.ticketId}`, quantity: source.amounts
        .filter(free).reduce((s, a) => s + a.value, 0) });
    }
  }
  const observations = new Map();
  for (const booking of bookings) {
    const record = booking.record ?? booking;
    const saved = bookingSourceObservations(booking, raw);
    const latest = booking.latestObservation;
    // Document update time can be an owner decision, not a newer SSP reading.
    // Raw observations win; never attach the held record's old reason to a new status.
    const fallback = latest ? { record: { sspBookingId: record.sspBookingId, serviceDate: record.serviceDate,
      rawStatus: latest.rawStatus, sourceUrl: record.sourceUrl, notes: null }, savedAt: latest.observedAtIso, timeBasis: 'source_read' }
      : { record, savedAt: booking.updatedAtIso, original: true };
    const variants = saved.length ? saved : [fallback];
    for (const observation of variants) {
      const r = observation.record, id = ownerBookingIdentity(r.sspBookingId);
      if (!id || !day(r.serviceDate) || r.serviceDate.slice(0, 7) !== month) continue;
      const at = instant(observation.savedAt), prior = observations.get(id);
      const signature = JSON.stringify([r.rawStatus, r.driverExternalId, r.serviceDate, cancellationDetails(r)]);
      if (!prior || at > prior.at) observations.set(id, { observation, at, signature, conflict: false });
      else if (at === prior.at && signature !== prior.signature) prior.conflict = true;
    }
  }
  for (const [id, { observation, conflict }] of observations) {
    const record = observation.record;
    if (!cancellationCandidate(record)) continue;
    const detail = cancellationDetails(record), metricKey = conflict ? null : cancellationType(record);
    const row = sourceBiker({ id: `booking:${id}`, kind: 'booking', sourceId: record.sspBookingId, bookingId: record.sspBookingId,
      date: record.serviceDate, dateBasis: 'service', driverExternalId: record.driverExternalId, sourceBikerName: record.driverName,
      reason: detail.reason, sourceUrl: cancellationSourceLink(record.sourceUrl), sourceReadAt: observation.savedAt,
      timeBasis: observation.original ? 'record_update' : observation.timeBasis || 'observation_saved',
      record, detail, conflict, quantity: 1, amount: null }, bikers, language);
    if (metricKey) groups[metricKey].push(row); else unclassified.push(row);
  }
  for (const rows of Object.values(groups)) rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { groups, unclassified, undatedTickets };
}
