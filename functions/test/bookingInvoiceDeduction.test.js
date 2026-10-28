import { describe, expect, it } from 'vitest';
import { bookingInvoiceDeduction } from '../src/sweater/bookingInvoiceDeduction.js';
export function syntheticInvoiceEvidence(overrides = {}) {
  return { bookingId: 'C-990002', driverExternalId: 'TEST-DRIVER', serviceDate: '2026-10-20', cancellationReason: 'Biker Refused Wash',
    sourceReadAt: '2026-10-28T13:00:00Z', sourceUrl: 'https://ssp-portal.sweater.sa/test', currency: 'SAR', optimalAmountSAR: 20,
    deductionLabel: 'Booking Cancelled (Reason 13)', signedDeductionSAR: -129.95, netAmountSAR: -109.95,
    observedText: 'Invoice\nOptimal Amount\n20.00 SAR\nDeductions\nBooking Cancelled (Reason 13)\n-129.95 SAR\nNet Amount\n-109.95 SAR', ...overrides };
}
function record(evidence = syntheticInvoiceEvidence()) {
  return { sspBookingId: 'C-990002', driverExternalId: 'TEST-DRIVER', serviceDate: '2026-10-20', sourceUrl: 'https://ssp-portal.sweater.sa/test',
    notes: 'Original reason preserved\nSSP_INVOICE_DEDUCTION_V1=' + JSON.stringify(evidence) };
}
describe('actual booking invoice deduction evidence', () => {
  const parse = r => bookingInvoiceDeduction(r, 'Biker Refused Wash', '2026-10-28T14:00:00Z', Date.parse('2026-10-29T00:00:00Z'));
  it('takes actual signed deduction, never net amount or wash price', () => {
    const source = record(), before = structuredClone(source), result = parse(source);
    expect(result.signedDeductionSAR).toBe(-129.95); expect(result.netAmountSAR).toBe(-109.95); expect(source).toEqual(before);
  });
  it('missing invoice evidence remains unknown', () => expect(parse({ ...record(), notes: 'Original reason only' })).toBeNull());
  it.each([
    { signedDeductionSAR: -109.95 }, { signedDeductionSAR: 129.95 }, { signedDeductionSAR: 0 }, { currency: 'USD' },
    { bookingId: 'C-990003' }, { driverExternalId: 'other' }, { serviceDate: '2026-10-21' }, { cancellationReason: 'Accident' },
    { sourceReadAt: '2026-10-28T15:00:00Z' }, { sourceReadAt: 'not-a-time' }, { netAmountSAR: 109.95 },
    { observedText: 'Invoice deductions 129.95 SAR' }, { observedText: syntheticInvoiceEvidence().observedText.replace('-129.95', '-109.95') },
    { deductionLabel: 'Other invoice item' }, { extra: 'forged field' },
  ])('rejects mismatched, unsigned or unverifiable source facts %j', patch => expect(() => parse(record(syntheticInvoiceEvidence(patch)))).toThrow());
  it('does not hide malformed or duplicated invoice evidence as a null amount', () => {
    expect(() => parse({ ...record(), notes: record().notes + '\nSSP_INVOICE_DEDUCTION_V1={}' })).toThrow();
    expect(() => parse({ ...record(), notes: 'SSP_INVOICE_DEDUCTION_V1={' })).toThrow();
  });
});
