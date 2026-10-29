import { WASH_COMMISSION_RATE, WASH_COMMISSION_EFFECTIVE_MONTH } from '../washCommission.js';

// Hadi's explicit 11 Oct 2026 instruction. This is the wash execution route,
// not a tax setting, a price-list seed, or an assertion of customer collection.
export const OPERATIONS_WASH_APPROVAL = Object.freeze({
  clarificationId: '01a12820-9427-71c1-bf37-4193b2c33a53',
  serviceType: 'interior_exterior_wash', net: 20, vat: 3, gross: 23, commission: 4.5,
});

function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return NaN;
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) return NaN;
  return Date.parse(value);
}

export function executionEligibility(record, coverage, worker) {
  // Observed SSP literal (29 Oct). Keep raw/normalized source facts and all
  // financial recognition rules unchanged; this execution-only path still
  // requires genuine Start + End and does not assert payment collection.
  const literalCompleted = record.normalizedStatus === 'unknown' && record.rawStatus?.trim().toLowerCase() === 'completed';
  if (record.normalizedStatus !== 'payment_collection' && !literalCompleted) return { eligible: false, reasonCode: 'execution_not_final' };
  if (record.serviceType !== OPERATIONS_WASH_APPROVAL.serviceType) return { eligible: false, reasonCode: 'unsupported_execution_service_type' };
  const started = timestamp(record.startedAt), completed = timestamp(record.completedAt), observed = timestamp(coverage.extractedAt);
  // These fields mean the actual Start Service / End Service events, not the
  // booking's scheduled time. No payment status can substitute for either.
  if (![started, completed, observed].every(Number.isFinite) || completed <= started || completed > observed
    || new Date(started + 3 * 60 * 60 * 1000).toISOString().slice(0, 10) !== record.serviceDate) {
    return { eligible: false, reasonCode: 'missing_execution_evidence' };
  }
  // The existing payroll policy already pays4.50 from October. Never reprice
  // historical periods or override historical payroll snapshots in this writer.
  if (record.serviceDate.slice(0, 7) < WASH_COMMISSION_EFFECTIVE_MONTH || WASH_COMMISSION_RATE !== OPERATIONS_WASH_APPROVAL.commission) {
    return { eligible: false, reasonCode: 'execution_commission_policy_review' };
  }
  const start = worker?.start_date || worker?.startDate;
  const end = worker?.end_date || worker?.endDate;
  if ((start && record.serviceDate < String(start).slice(0, 10)) || (end && record.serviceDate > String(end).slice(0, 10))) {
    return { eligible: false, reasonCode: 'execution_worker_date_review' };
  }
  return { eligible: true, reasonCode: null };
}

export function executionWash(record, bikerId, bikerName) {
  const p = OPERATIONS_WASH_APPROVAL;
  // All fields use the existing wash/owner-tax-snapshot representation. The
  // owner's statement supplies pricing ONLY; it does not supply completion or
  // collection. Completion comes from the signed, source-backed observation.
  return { ssp_booking_id: record.sspBookingId, biker_id: bikerId, biker_name: bikerName,
    driver_external_id: record.driverExternalId, quantity: 1, price: p.net,
    status: 'مكتملة', wash_date: record.serviceDate, payment_method: null,
    revenue_origin: 'sweater', price_basis: 'owner_statement', price_mode: 'exclusive',
    net_amount: p.net, vat_amount: p.vat, gross_amount: p.gross, vat_rate: p.vat / p.net,
    owner_tax_snapshot: { source: 'owner_statement', clarificationId: p.clarificationId,
      currency: 'SAR', priceMode: 'exclusive', quantity: 1, net: p.net, vat: p.vat, gross: p.gross },
    collection_status: 'pending', worker_commission_per_wash: p.commission,
    worker_commission_payment_timing: 'payroll', worker_commission_paid: false };
}
