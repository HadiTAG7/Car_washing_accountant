import { expect, it } from 'vitest';
import { qualityEventValuation, qualityValuationSummary } from '../qualityEventValuation';

it('keeps explicit actual zero and source charges instead of replacing either with twenty', () => {
  expect(qualityEventValuation({ amount: 0, quantity: 1 }, 'cancelledByBiker')).toMatchObject({ basis: 'source', amountSAR: 0 });
  expect(qualityEventValuation({ amount: 129.95, quantity: 1 }, 'cancelledByBiker')).toMatchObject({ basis: 'source', amountSAR: 129.95 });
  expect(qualityEventValuation({ amount: 20.10, quantity: 1 }, 'cancelledByBiker')).toMatchObject({ basis: 'source', amountSAR: 20.10 });
  expect(qualityEventValuation({ amount: -129.95, quantity: 1 }, 'cancelledByBiker')).toMatchObject({ basis: 'source', amountSAR: -129.95, sourceSignedSAR: -129.95 });
  expect(qualityEventValuation({ amount: null, quantity: 2 }, 'freeWashCompensation')).toMatchObject({ basis: 'owner_estimate', amountSAR: 40, sourceSignedSAR: null });
});
const invoiceRow = amount => {
  const reason = 'Biker delay caused cancellation or postponement', sourceUrl = 'https://ssp-portal.sweater.sa/bookings/TEST';
  const evidence = { bookingId: 'C-123', driverExternalId: 'TEST', serviceDate: '2026-10-03', cancellationReason: reason,
    sourceReadAt: '2026-10-28T21:45:00Z', sourceUrl, currency: 'SAR', optimalAmountSAR: 20,
    deductionLabel: 'Booking Cancelled (Reason 8)', signedDeductionSAR: -amount, netAmountSAR: Math.round((20 - amount) * 100) / 100,
    observedText: `Invoice Optimal Amount 20.00 SAR Deductions Booking Cancelled (Reason 8) -${amount.toFixed(2)} SAR Net Amount ${(20 - amount).toFixed(2)} SAR` };
  return { kind: 'booking', quantity: 1, amount: null, savedAt: '2026-10-29T00:00:00Z', detail: { reason }, record: { sspBookingId: 'C-123', driverExternalId: 'TEST', serviceDate: '2026-10-03', sourceUrl, notes: 'SSP_INVOICE_DEDUCTION_V1=' + JSON.stringify(evidence) } };
};
it('uses a verified signed invoice deduction, never the net invoice or flat estimate', () => {
  const row = invoiceRow(129.95), before = structuredClone(row);
  expect(qualityEventValuation(row, 'cancelledByBiker')).toMatchObject({ basis: 'source', amountSAR: -129.95, sourceSignedSAR: -129.95 });
  expect(row).toEqual(before);
});
it('does not estimate over conflicts, broken invoice evidence, invalid values or an unrelated category', () => {
  for (const row of [{ ...invoiceRow(129.95), conflict: true }, { ...invoiceRow(129.95), orderUnknown: true },
    { kind: 'booking', quantity: 1, record: { notes: 'SSP_INVOICE_DEDUCTION_V1={}' } }, { amount: NaN, quantity: 1 }, { amount: 20.001, quantity: 1 }, { amount: 1e10, quantity: 1 }]) {
    expect(qualityEventValuation(row, 'cancelledByBiker').basis).toBe('unresolved');
  }
  expect(qualityEventValuation({ quantity: 1 }, 'cancelledByCustomer').basis).toBe('unresolved');
});
it('does not turn wallet, promocode or promotional free washes into compensation charges', () => {
  const ticket = { kind: 'ticket', quantity: 1, source: { amounts: [{ kind: 'compensation', unit: 'count', value: 1, sourceRef: 'Wash in Wallet' }, { kind: 'customer_code', unit: 'SAR', value: 60 }] } };
  expect(qualityEventValuation(ticket, 'freeWashCompensation').basis).toBe('unresolved');
  const free = { ...ticket, quantity: 2, source: { amounts: [{ kind: 'compensation', unit: 'count', value: 2, sourceRef: 'Compensation type: Free Wash; Quantity 2' }] } };
  expect(qualityEventValuation({ ...free, quantity: 1 }, 'freeWashCompensation').basis).toBe('unresolved');
  expect(qualityEventValuation(free, 'freeWashCompensation')).toMatchObject({ basis: 'owner_estimate', amountSAR: 40 });
  free.source.amounts.push({ kind: 'compensation', unit: 'SAR', value: 0, sourceRef: 'Compensation type: Free Wash; Total 0' });
  expect(qualityEventValuation(free, 'freeWashCompensation')).toMatchObject({ basis: 'source', amountSAR: 0 });
});
it('keeps source and estimated totals separate, including zero, without a settlement total', () => {
  expect(qualityValuationSummary([{ amount: 0, quantity: 1 }, { amount: 129.95, quantity: 1 }, { amount: null, quantity: 1 }, { conflict: true }], 'cancelledMaintenance'))
    .toEqual({ sourceRows: 2, estimatedRows: 1, unresolvedRows: 1, sourcePositiveSAR: 129.95, sourceNegativeSAR: 0, estimatedSAR: 20 });
});
it('preserves separate signed source totals rather than summing magnitudes or inventing a net settlement', () => {
  expect(qualityValuationSummary([{ amount: -129.95, quantity: 1 }, { amount: 129.95, quantity: 1 }], 'cancelledByBiker'))
    .toEqual({ sourceRows: 2, estimatedRows: 0, unresolvedRows: 0, sourcePositiveSAR: 129.95, sourceNegativeSAR: -129.95, estimatedSAR: 0 });
});
it('does not treat an invalid or conflicting explicit ticket amount as missing', () => {
  const count = { kind: 'compensation', unit: 'count', value: 1, sourceRef: 'Compensation type: Free Wash; Quantity 1' };
  const actual = value => ({ kind: 'compensation', unit: 'SAR', value, sourceRef: 'Compensation type: Free Wash; Total' });
  for (const amounts of [[count, actual(20.001)], [count, actual(null)], [count, actual(NaN)], [count, actual(0), actual(20)], [count, actual(20.001), actual(20)]]) {
    const row = { kind: 'ticket', quantity: 1, source: { amounts } };
    const before = structuredClone(row);
    expect(qualityEventValuation(row, 'freeWashCompensation').basis).toBe('unresolved');
    expect(row).toEqual(before);
  }
});
