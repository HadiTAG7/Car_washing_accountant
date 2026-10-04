// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ bookings: [], error: null }));
vi.mock('../../hooks/useSweaterWashDetails', () => ({ useSweaterWashDetails: () => ({ ...mocks, loading: false }) }));
import SweaterWashWorkerSummary from '../SweaterWashWorkerSummary';
import { LanguageContext } from '../../i18n/LanguageContext';
afterEach(() => { cleanup(); mocks.bookings = []; mocks.error = null; });
const wash = { id: 'w', sspBookingId: 'S-1', bikerId: 'b', bikerName: 'Worker', quantity: 1, price: 20,
  washDate: '2026-10-03', status: 'مكتملة', revenueOrigin: 'sweater', collectionStatus: 'confirmed_by_owner',
  ownerTaxSnapshot: { source: 'owner_statement', currency: 'SAR', clarificationId: 'owner-tax', priceMode: 'exclusive', quantity: 1, net: 20, vat: 3, gross: 23 } };
it('shows recorded gross and SSP status independently of collection and internal completion', () => {
  mocks.bookings = [{ sspBookingId: 'S-1', record: { serviceDate: '2026-10-04', rawStatus: 'Pending' } }];
  render(<LanguageContext.Provider value={{ language: 'en' }}><SweaterWashWorkerSummary washes={[wash]} scalingFactor={0.5} /></LanguageContext.Provider>);
  const table = within(screen.getByRole('table', { name: 'تفاصيل غسلات سويتر' }));
  expect(table.getByText('Booking ID')).toBeTruthy(); expect(table.getByText('Gross')).toBeTruthy();
  expect(table.getByText('2026-10-04')).toBeTruthy(); expect(table.getByText('Pending')).toBeTruthy();
  expect(table.getByText(/23/)).toBeTruthy(); expect(table.queryByText('مكتملة')).toBeNull();
});
it('preserves unknown raw status and does not invent gross from an unclarified price', () => {
  mocks.bookings = [{ sspBookingId: 'S-1', record: { rawStatus: 'Unexpected source status' } }];
  render(<SweaterWashWorkerSummary washes={[{ ...wash, ownerTaxSnapshot: null }]} />);
  const table = within(screen.getByRole('table', { name: 'تفاصيل غسلات سويتر' }));
  expect(table.getByText('Unexpected source status')).toBeTruthy(); expect(table.getByText('—')).toBeTruthy();
  expect(table.queryByText(/23/)).toBeNull(); expect(table.getByText('2026-10-03')).toBeTruthy();
});
