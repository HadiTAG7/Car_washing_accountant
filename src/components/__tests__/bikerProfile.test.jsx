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
const chooseMonth = label => {
  fireEvent.click(screen.getByRole('button', { name: 'الشهر', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
};

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
  chooseMonth('أكتوبر 2026');
  expect(screen.getByText('T-test')).toBeTruthy();
  chooseMonth('سبتمبر 2026');
  expect(screen.queryByText('T-test')).toBeNull();
  expect(readQuality).toHaveBeenLastCalledWith('fake-a', '2026-09');
});
it('supports month selection and closes its picker on Escape without closing the profile', () => {
  render(<BikerProfile {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'الشهر', exact: true }));
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'اختيار الشهر' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'اختيار الشهر' })).toBeNull();
  expect(screen.getByRole('dialog', { name: biker.name })).toBeTruthy();
  chooseMonth('سبتمبر 2026');
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
  chooseMonth('أكتوبر 2026');
  const calendar = screen.getByRole('table', { name: 'تقويم الغسلات اليومية' });
  expect(calendar.querySelectorAll('thead th')).toHaveLength(7);
  expect(calendar.querySelectorAll('time')).toHaveLength(31);
  expect(calendar.querySelector('time[datetime="2026-10-01"]')).toBeTruthy();
});
it('uses only the wash-day average and replaces calendar-day average with rating', () => {
  render(<BikerProfile {...props()} washes={[
    { id: 'w1', bikerId: biker.id, washDate: '2026-10-12', quantity: 3, status: 'مكتملة' },
    { id: 'w2', bikerId: biker.id, washDate: '2026-10-13', quantity: 5, status: 'مكتملة' },
  ]} />);
  expect(screen.queryByText('متوسط اليوم التقويمي')).toBeNull();
  expect(screen.getByText('المتوسط').closest('.sw-biker-profile__metric').querySelector('strong').textContent).toBe('4');
  expect(screen.getByText('تقييم البايكر').closest('.sw-biker-profile__metric').querySelector('strong').textContent).toBe('5 / 5');
  fireEvent.click(screen.getByText('كيف يُحسب؟'));
  expect(screen.getByText('8 ÷ 2 = 4')).toBeTruthy();
});
it('orders all worker information left-to-right without changing values', () => {
  render(<BikerProfile {...props()} />);
  expect(document.querySelector('.sw-biker-profile__info').getAttribute('dir')).toBe('ltr');
  expect(screen.getByText('1986')).toBeTruthy();
});
it('uses a branded month control rather than the browser native month input', () => {
  render(<BikerProfile {...props()} />);
  expect(document.querySelector('input[type="month"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'الشهر' })).toBeTruthy();
});
