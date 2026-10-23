import { describe, expect, it } from 'vitest';
import { payrollPreapproval, payrollApprovalAllowed } from '../src/payrollPreapproval.js';
const biker = { id: 'b1', name: 'Synthetic worker', current_status: 'هرب', start_date: '2026-08-01' };
const line = { bikerId: 'b1', netDue: 900, advanceDeduction: 0 };
const review = (over = {}) => payrollPreapproval({ bikers: [biker], lines: [line], periodKey: '2026-10', today: '2026-10-24', ...over });
describe('payroll preapproval evidence', () => {
  it('blocks departed workers without inventing an end date or changing entitlement', () => {
    const r = review();
    expect(r.missingEndDates).toMatchObject({ count: 1, amount: 900 });
    expect(r.byBiker[0]).toMatchObject({ endDate: '', amount: 900 });
    expect(payrollApprovalAllowed({ review: r })).toBe(false);
    expect(payrollApprovalAllowed({ review: r, override: true, role: 'admin', reason: '  ' })).toBe(false);
    expect(payrollApprovalAllowed({ review: r, override: true, role: 'accountant', reason: 'Owner evidence' })).toBe(false);
    expect(payrollApprovalAllowed({ review: r, override: true, role: 'admin', reason: 'Owner evidence' })).toBe(true);
  });
  it('an end date clears the block; zero washes and future starts are warnings only', () => {
    const r = review({ bikers: [{ ...biker, end_date: '2026-10-20' }, { id: 'future', start_date: '2026-10-25' }] });
    expect(r.approvalBlocked).toBe(false); expect(r.noWashes.count).toBe(1); expect(r.futureStarts.count).toBe(1);
    expect(payrollApprovalAllowed({ review: r })).toBe(true);
    expect(payrollApprovalAllowed({ review: r, loading: true })).toBe(false);
    expect(payrollApprovalAllowed({ review: r, error: new Error('read failed') })).toBe(false);
    expect(payrollApprovalAllowed({ review: null })).toBe(false);
  });
  it('separates all pending advances, assigned month, preview allocation and non-worker expenses', () => {
    const r = review({ advances: [
      { id: 'old', biker_id: 'b1', amount: 50, assignment_month: '2026-09', spent_date: '2026-10-01' },
      { id: 'current', biker_id: 'b1', amount: 200, assignment_month: '2026-10' },
      { id: 'recovered', biker_id: 'b1', amount: 200, status: 'recovered' },
      { id: 'company', amount: 15000 },
    ], lines: [{ ...line, advanceDeduction: 200, advanceAllocations: [{ advanceId: 'current', amount: 200 }] }] });
    expect(r.byBiker[0]).toMatchObject({ outstanding: 250, assigned: 200, deduction: 200 });
    expect(r.pendingUnDeducted).toMatchObject({ count: 1, amount: 50 });
    expect(r.unassignedAdvances).toEqual({ count: 1, amount: 15000 });
  });
  it('uses completed deduplicated washes and does not infer absence or count another month', () => {
    const wash = { id: 'w1', biker_id: 'b1', status: ' completed ', quantity: 1, wash_date: '2026-10-10', ssp_booking_id: '123' };
    const r = review({ washes: [wash, { ...wash, id: 'duplicate' }, { ...wash, id: 'old', ssp_booking_id: '456', wash_date: '2026-09-10' }] });
    expect(r.byBiker[0].washCount).toBe(1); expect(r.noWashes.count).toBe(0);
  });
});
