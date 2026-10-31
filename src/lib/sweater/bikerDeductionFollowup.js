import { BIKER_DEDUCTION_FOLLOWUP_POLICY as policy } from '../../config/bikerDeductionFollowupPolicy.js';
import { BIKER_DEDUCTION_AUTHORITY, isBikerDeduction, bikerDeductionIdentity } from './bikerDeductions.js';
import { ownerBookingIdentity } from './bookingIdentity.js';

const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 && Number(value.toFixed(2)) === value;
const halalas = value => Math.round(value * 100);
const kinds = ['violations', 'damages', 'compensations', 'cancelledByBiker'];

// Pure read model. A stored null stays null; the effective follow-up value and
// its basis are separate. No responsibility is derived from source status,
// reason, assignment, monthly totals or unassigned Compensations rows.
export function bikerDeductionFollowupAmount(record) {
  const amounts = [record.amountSAR, record.event?.amount].filter(value => value != null);
  if (amounts.some(value => !money(value)) || new Set(amounts.map(halalas)).size > 1) {
    return { sourceAmountSAR: null, effectiveAmountSAR: null, basis: 'unavailable' };
  }
  if (record.metricKey === 'cancelledByBiker' && (record.unit !== 'count' || record.quantity !== 1 || record.event?.quantity !== 1
    || record.event.metricKey !== record.metricKey || !bikerDeductionIdentity(record.event)
    || (record.eventIdentity && record.eventIdentity !== bikerDeductionIdentity(record.event))
    || (record.sourceKind === 'booking' && ownerBookingIdentity(record.sourceId) !== ownerBookingIdentity(record.event.bookingId)))) {
    return { sourceAmountSAR: amounts[0] ?? null, effectiveAmountSAR: null, basis: 'unavailable' };
  }
  if (amounts.length) return { sourceAmountSAR: amounts[0], effectiveAmountSAR: amounts[0], basis: 'source' };
  if (record.metricKey === 'cancelledByBiker') {
    return { sourceAmountSAR: null, effectiveAmountSAR: policy.missingCancellationAmountSAR, basis: 'owner_decision' };
  }
  return { sourceAmountSAR: null, effectiveAmountSAR: null, basis: 'unavailable' };
}

export function summarizeBikerDeductions(records = [], periodKey = null) {
  const identities = new Map(), groups = new Map(), conflicts = [];
  let ignoredCount = 0;
  for (const saved of records) {
    const record = saved.current || saved;
    if (!isBikerDeduction(record) || record.status !== 'recorded' || !record.bikerId
      || record.decisionReference !== BIKER_DEDUCTION_AUTHORITY || !kinds.includes(record.metricKey)
      || (periodKey && record.periodKey !== periodKey)
      || !record.event?.date || record.event.date < policy.existingAssignmentFrom || record.event.date > policy.existingAssignmentTo) {
      ignoredCount++; continue;
    }
    const identity = bikerDeductionIdentity(record.event);
    if (!identity || record.event.metricKey !== record.metricKey) { ignoredCount++; continue; }
    const row = { ...record, id: saved.id, revision: saved.revision, followup: bikerDeductionFollowupAmount(record) };
    const list = identities.get(identity) || []; list.push(row); identities.set(identity, list);
  }
  let duplicateCount = 0;
  for (const [identity, rows] of identities) {
    const signatures = new Set(rows.map(row => JSON.stringify([row.bikerId, row.metricKey, row.quantity, row.followup])));
    duplicateCount += rows.length - 1;
    if (signatures.size > 1) { conflicts.push({ identity, records: rows }); continue; }
    const row = rows[0];
    const group = groups.get(row.bikerId) || { bikerId: row.bikerId, bikerName: row.bikerName, events: [], sourceHalalas: 0, ownerHalalas: 0, unpricedCount: 0 };
    group.events.push(row);
    if (row.followup.basis === 'source') group.sourceHalalas += halalas(row.followup.effectiveAmountSAR);
    else if (row.followup.basis === 'owner_decision') group.ownerHalalas += halalas(row.followup.effectiveAmountSAR);
    else group.unpricedCount++;
    groups.set(row.bikerId, group);
  }
  const bikers = [...groups.values()].map(group => ({ ...group, sourceSAR: group.sourceHalalas / 100,
    ownerSAR: group.ownerHalalas / 100, totalSAR: (group.sourceHalalas + group.ownerHalalas) / 100 }));
  return { bikers, eventCount: bikers.reduce((n, group) => n + group.events.length, 0), duplicateCount, ignoredCount, conflicts,
    sourceSAR: bikers.reduce((n, group) => n + group.sourceHalalas, 0) / 100,
    ownerSAR: bikers.reduce((n, group) => n + group.ownerHalalas, 0) / 100,
    totalSAR: bikers.reduce((n, group) => n + group.sourceHalalas + group.ownerHalalas, 0) / 100,
    unpricedCount: bikers.reduce((n, group) => n + group.unpricedCount, 0) + conflicts.length };
}
