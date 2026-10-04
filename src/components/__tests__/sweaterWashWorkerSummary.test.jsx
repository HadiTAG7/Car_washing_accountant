// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SweaterWashWorkerSummary from '../SweaterWashWorkerSummary';
import { summarizeOwnerWashes } from '../../lib/sweater/washSummary';
afterEach(cleanup);
const wash = (id, extra = {}) => ({ sspBookingId: id, bikerId: 'worker-1', bikerName: 'Worker 1',
  quantity: 1, price: 20, workerCommissionPerWash: 4.5, washDate: '2026-10-03',
  status: 'مكتملة', revenueOrigin: 'sweater', collectionStatus: 'confirmed_by_owner', ...extra });
it('groups by worker and excludes duplicate SSP IDs, cancellations and unrelated washes', () => {
  const rows = [wash('S-1'), wash('S-2'), wash('S-1'), wash('cancelled', { status: 'قيد التنفيذ' }), wash('direct', { revenueOrigin: 'direct' })];
  const result = summarizeOwnerWashes(rows);
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ quantity: 2, totalAmount: 40, commission: 9 });
  render(<SweaterWashWorkerSummary washes={rows} />);
  expect(screen.getByRole('table', { name: 'ملخص غسلات سويتر حسب العامل' })).toBeTruthy();
  expect(screen.getByText('محصلة بإفادة المالك؛ العمولة تُدفع مع الراتب')).toBeTruthy();
  expect(screen.getByText('S-1')).toBeTruthy(); expect(screen.queryByText('cancelled')).toBeNull();
});
it('does not show an empty summary or assume commission when no evidence exists', () => {
  render(<SweaterWashWorkerSummary washes={[wash('direct', { revenueOrigin: 'direct' })]} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(summarizeOwnerWashes([wash('S-1', { workerCommissionPerWash: null })])[0].commission).toBe(0);
});
