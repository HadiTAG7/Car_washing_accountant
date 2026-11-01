// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SettlementPreviewPanel from '../SettlementPreviewPanel';
import { computeSettlement } from '../../../functions/src/sweater/settlement';
afterEach(cleanup);

it('explains missing policy using the existing calculation rather than treating imported data as absent', () => {
  const figures = computeSettlement({ bookings: [{ record: { sspBookingId: 'S-test', serviceDate: '2026-11-01', normalizedStatus: 'payment_collection', serviceType: 'interior_exterior_wash' } }] });
  render(<SettlementPreviewPanel periodKey="2026-11" state={{ data: { periodKey: '2026-11', dryRun: true, figures }, refetch: vi.fn() }} />);
  expect(screen.getByRole('region', { name: 'معاينة التسوية الحالية' }).textContent).toContain('السياسة');
  expect(screen.getByText(/لا سياسة اعتراف/)).toBeTruthy();
  expect(screen.getByText(/من 1 حجزًا مستوردًا/)).toBeTruthy();
  expect(screen.getByText(/وليست كشف سويتر أو صافيًا معتمدًا/)).toBeTruthy();
});

it('never displays a previous month result or a non-dry-run response as current preview', () => {
  const state = { data: { periodKey: '2026-10', dryRun: true, figures: { netDue: 987654 } }, refetch: vi.fn() };
  const { rerender } = render(<SettlementPreviewPanel periodKey="2026-11" state={state} />);
  expect(screen.getByText(/لم تتوفر معاينة متحققة/)).toBeTruthy();
  rerender(<SettlementPreviewPanel periodKey="2026-10" state={{ ...state, data: { ...state.data, dryRun: false } }} />);
  expect(screen.getByText(/لم تتوفر معاينة متحققة/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('987654');
});

it('does not substitute zero for a failed preview', () => {
  render(<SettlementPreviewPanel periodKey="2026-11" state={{ error: 'failed', refetch: vi.fn() }} />);
  expect(screen.getByRole('alert').textContent).toContain('لم يُحفظ أو يُحتسب شيء');
  expect(screen.queryByText('0.00')).toBeNull();
});
