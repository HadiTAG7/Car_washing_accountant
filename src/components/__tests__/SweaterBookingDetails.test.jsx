// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SweaterBookingDetails from '../SweaterBookingDetails';
import { LanguageContext } from '../../i18n/LanguageContext';
const state = vi.hoisted(() => ({ data: [], loading: false, error: null }));
vi.mock('../../hooks/useSweaterBookingSource', () => ({ useSweaterBookingSource: () => state }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [{ id: 'test', driverExternalId: '1986', name: 'بايكر اختبار', nameEnglish: 'Test biker' }], error: null }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); state.data = []; state.error = null; state.loading = false; });
const booking = { record: { sspBookingId: 'B-5673287', rawStatus: 'Initiated' } };
it.each(['ar','en'])('shows separate source facts, missing actor, honest time zone and a read-only history (%s)', language => {
  state.data = [{ id: 'new', sspBookingId: 'C-5673287', fetchedAtIso: '2026-10-29T16:10:44Z', rawPayload: {
    sspBookingId: 'C-5673287', driverExternalId: '1986', rawStatus: 'Cancelled by Admin', serviceDate: '2026-10-29',
    notes: 'Cancellation Reason\nCancelled At\nOctober 29, 2026 07:01 PM\nReason\nBiker illness', sourceUrl: 'https://ssp-portal.sweater.sa/bookings' } }];
  const before = JSON.stringify({ booking, data: state.data }), close = vi.fn();
  render(<LanguageContext.Provider value={{ language }}><SweaterBookingDetails booking={booking} onClose={close} /></LanguageContext.Provider>);
  const dialog = screen.getByRole('dialog'); expect(dialog.querySelector('section').dir).toBe(language === 'ar' ? 'rtl' : 'ltr');
  expect(dialog.textContent).toContain('Initiated'); expect(dialog.textContent).toContain('Cancelled by Admin');
  expect(dialog.textContent).toContain('Biker illness'); expect(dialog.textContent).toContain('1986');
  expect(dialog.textContent).toContain(language === 'ar' ? 'بايكر اختبار' : 'Test biker');
  expect(dialog.textContent).toContain(language === 'ar' ? 'غير مسجّل' : 'Not recorded');
  expect(dialog.textContent).toContain(language === 'ar' ? 'المنطقة الزمنية غير مثبتة' : 'timezone is unconfirmed');
  expect(dialog.textContent).toContain(language === 'ar' ? 'الإسناد لا يثبت مسؤولية' : 'Assignment does not establish');
  expect(dialog.querySelectorAll('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button')); expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify({ booking, data: state.data })).toBe(before);
});
it('reports a raw read failure without inventing zero cancellations or hiding the saved booking', () => {
  state.error = Error('synthetic read failure');
  render(<SweaterBookingDetails booking={booking} onClose={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('تعذّرت قراءة');
  expect(screen.getByRole('dialog').textContent).toContain('Initiated');
});
it('includes source history in the modal keyboard loop and restores the opener on unmount', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }]);
  state.data = ['2026-10-29T16:10:44Z','2026-10-29T14:49:03Z'].map((date, index) => ({
    id: String(index), sspBookingId: 'B-5673287', fetchedAtIso: date, rawPayload: booking.record }));
  render(<button>TEST opener</button>); const opener = screen.getByText('TEST opener'); opener.focus();
  const view = render(<SweaterBookingDetails booking={booking} onClose={vi.fn()} />);
  const summary = screen.getByText('الملاحظات السابقة', { exact: false });
  expect(summary.tabIndex).toBe(0); summary.focus();
  fireEvent.keyDown(summary, { key: 'Tab' }); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'إغلاق التفاصيل' }));
  fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(summary);
  view.unmount(); expect(document.activeElement).toBe(opener);
});
