// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';

const state = vi.hoisted(() => ({ partnerView: false, qualityLoading: false, qualityError: null }));
const readQuality = vi.hoisted(() => vi.fn());
const biker = { id: 'fake-a', name: 'عامل تجريبي', nameEnglish: 'Test worker', driverExternalId: '1986', salary: 900 };
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [biker], loading: false, error: null }) }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: [], loading: false, error: null }) }));
vi.mock('../../hooks/useTemporaryExpenses', () => ({ useTemporaryExpenses: () => ({ expenses: [], loading: false, error: null }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ canMutate: false, isPartnerView: state.partnerView }) }));
vi.mock('../../hooks/useBikerProfileBookings', () => ({ useBikerProfileBookings: (id, month) => {
  readQuality(id, month);
  return { bookings: month === '2026-10' ? [{ record: { sspBookingId: 'S-test', serviceDate: '2026-10-01', driverExternalId: '1986', rating: 5, ticketRef: 'T-test' } }] : [],
    available: !state.qualityLoading && !state.qualityError, loading: state.qualityLoading, error: state.qualityError };
} }));
const { default: BikerProfile } = await import('../BikerProfile');
const { default: BikersPage } = await import('../BikersPage');
beforeEach(() => { state.partnerView = false; state.qualityLoading = false; state.qualityError = null; readQuality.mockClear(); });
afterEach(cleanup);
const props = () => ({ role: 'admin', biker, washes: [], advances: [], onClose: vi.fn() });

it('opens a profile by clicking the admin worker name and closes without a write', () => {
  render(<BikersPage role="admin" />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح بروفايل: عامل تجريبي' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('بيانات العامل')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'إغلاق البروفايل' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['partner', 'accountant', 'operator', 'supervisor'])('does not mount the profile or read quality for %s', role => {
  const view = render(<BikersPage role={role} />);
  expect(screen.queryByRole('button', { name: /فتح بروفايل/ })).toBeNull();
  view.unmount();
  render(<BikerProfile {...props()} role={role} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(readQuality).not.toHaveBeenCalled();
});
it('hides the admin profile immediately when switching to partner preview', () => {
  const view = render(<BikersPage role="admin" />);
  fireEvent.click(screen.getByRole('button', { name: /فتح بروفايل/ }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  state.partnerView = true;
  view.rerender(<BikersPage role="admin" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: /فتح بروفايل/ })).toBeNull();
});
it('switches month and removes the previous period rating and ticket', () => {
  render(<BikerProfile {...props()} />);
  fireEvent.change(screen.getByLabelText('الشهر'), { target: { value: '2026-10' } });
  expect(screen.getByText('T-test')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('الشهر'), { target: { value: '2026-09' } });
  expect(screen.queryByText('T-test')).toBeNull();
  expect(readQuality).toHaveBeenLastCalledWith('fake-a', '2026-09');
});
it('updates the selected month when the browser emits a native input event', () => {
  render(<BikerProfile {...props()} />);
  fireEvent.input(screen.getByLabelText('الشهر'), { target: { value: '2026-09' } });
  expect(readQuality).toHaveBeenLastCalledWith('fake-a', '2026-09');
  expect(screen.queryByText('T-test')).toBeNull();
});
it('does not turn failed or loading sources into confirmed zero metrics', () => {
  state.qualityError = new Error('synthetic');
  render(<BikerProfile {...props()} washesError={new Error('synthetic')} />);
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect([...document.querySelectorAll('.sw-biker-profile__metrics strong')].every(e => e.textContent === 'غير متاح')).toBe(true);
  expect(screen.queryByText('T-test')).toBeNull();
});
it('renders explicit English labels, worker name and direction', () => {
  render(<LanguageContext.Provider value={{ language: 'en' }}><BikerProfile {...props()} /></LanguageContext.Provider>);
  expect(screen.getByRole('heading', { name: 'Test worker' })).toBeTruthy();
  expect(screen.getByText('Worker information')).toBeTruthy();
  expect(document.querySelector('.sw-biker-profile__body').getAttribute('dir')).toBe('ltr');
});
it('presents daily washes as a monthly calendar rather than a scrolling date list', () => {
  render(<BikerProfile {...props()} />);
  fireEvent.change(screen.getByLabelText('الشهر'), { target: { value: '2026-10' } });
  const calendar = screen.getByRole('table', { name: 'تقويم الغسلات اليومية' });
  expect(calendar.querySelectorAll('thead th')).toHaveLength(7);
  expect(calendar.querySelectorAll('time')).toHaveLength(31);
  expect(calendar.querySelector('time[datetime="2026-10-01"]')).toBeTruthy();
});
