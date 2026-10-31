import { hashBody, hashRecord } from './record.js';
import { ownerBookingIdentity } from '../../../src/lib/sweater/bookingIdentity.js';
import { bookingDocId, sspKey, sspWashDocId } from './ingest.js';

// A newer invoice observation must not rewrite an older, owner-completed
// booking just to make its notes/URL/timeline hash equal to the latest raw.
// Bind both observations to the same identity and re-read every protected link.
export async function deductionBookingBinding(db, read, { booking, record, verifiedRow, isProtected }) {
  if (!booking?.record || booking.source !== 'operations_sync_v2' || isProtected(booking)
    || booking.postedEntryId || booking.postedAt || booking.settlementId
    || ['posted', 'ready_for_posting', 'matched'].includes(booking.processingStatus)
    || booking.sourceHash !== hashRecord(booking.record)
    || ['sspBookingId', 'serviceDate', 'driverExternalId', 'rawStatus'].some(k => booking.record[k] !== record[k])) return null;
  const protectedObservation = verifiedRow.reasonCode === 'protected_existing_record'
    || Boolean(booking.administrativeCompletionRunId || booking.ownerCompletionDecision || verifiedRow.existingLinkRefs?.length);
  if (!protectedObservation) return hashBody(booking.record) === hashBody(record)
    ? { mode: 'current_exact', bookingSourceHash: booking.sourceHash } : null;
  if (verifiedRow.reasonCode !== 'protected_existing_record' || verifiedRow.bookingMustMatch !== false || verifiedRow.bookingSaved !== false
    || !verifiedRow.bikerId || booking.operationalWorkerId !== verifiedRow.bikerId) return null;
  const washId = sspWashDocId(record.sspBookingId);
  const allowed = [['washes', washId], ['sweater_operational_wash_links', `b__${sspKey(record.sspBookingId)}`], ['sweater_operational_wash_links', `w__${encodeURIComponent(washId)}`]];
  const refs = verifiedRow.existingLinkRefs;
  if (!Array.isArray(refs) || refs.length !== allowed.length || allowed.some(([collection, key]) => refs.filter(r => r.collection === collection && r.id === key).length !== 1)) return null;
  const [claimSnap, ...snapshots] = await Promise.all([
    read(db.collection('sweater_owner_booking_claims').doc(bookingDocId(ownerBookingIdentity(record.sspBookingId)))),
    ...refs.map(r => read(db.collection(r.collection).doc(r.id))),
  ]);
  const claim = claimSnap.data();
  if (!claim || isProtected(claim) || claim.sspBookingId !== record.sspBookingId || claim.washId !== washId
    || (claim.bookingNumber && ownerBookingIdentity(claim.bookingNumber) !== ownerBookingIdentity(record.sspBookingId))) return null;
  if (snapshots.some((snap, index) => !snap.exists || hashBody(snap.data()) !== refs[index].hash || isProtected(snap.data()))) return null;
  const wash = snapshots[refs.findIndex(r => r.collection === 'washes')].data();
  if (wash.ssp_booking_id !== record.sspBookingId || wash.biker_id !== verifiedRow.bikerId || wash.driver_external_id !== record.driverExternalId
    || wash.wash_date !== record.serviceDate || wash.worker_commission_paid !== false || wash.postedEntryId || wash.postedAt || wash.settlementId
    || wash.completion_basis !== 'owner_administrative_decision') return null;
  return { mode: 'protected_owner_completed_observation', bookingSourceHash: booking.sourceHash, claimHash: hashBody(claim),
    links: refs.map(r => ({ collection: r.collection, id: r.id, hash: r.hash })),
    preservedAdministrativeCompletionRunId: booking.administrativeCompletionRunId || null };
}
