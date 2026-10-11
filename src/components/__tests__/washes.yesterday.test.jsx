// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ items: [], bikers: [], bookings: [], loading: false, error: null, scalingFactor: 1, canMutate: false }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: state.items, loading: false }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: state.bikers }) }));
vi.mock('../../hooks/useSweaterWashDetails', () => ({ useSweaterWashDetails: () => ({ bookings: state.bookings, loading: state.loading, error: state.error }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ scalingFactor: state.scalingFactor, canMutate: state.canMutate }) }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../SweaterWashWorkerSummary', () => ({ default: () => null }));
vi.mock('../AddWashModal', () => ({ default: () => null }));
import WashesPage from '../WashesPage';
const wash = (date, quantity, status = 'مكتملة') => ({ id: `${date}-${quantity}`, washDate: date, quantity, price: 20, status });
const kpi = label => screen.getByText(label, { selector: '.sw-stat-label' }).parentElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T21:30:00Z')); // Oct 11 in Riyadh, Oct 10 in UTC.
  state.scalingFactor = 1;
  state.bikers = []; state.bookings = []; state.loading = false; state.error = null; state.canMutate = false;
  state.items = [wash('2026-09-30', 2), wash('2026-10-10', 3), wash('2026-10-11', 4),
    wash('2026-10-12', 5), wash('2026-10-09', 7, 'قيد التنفيذ')];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows only yesterday completed washes, excluding older days, without changing other KPIs', () => {
  const original = structuredClone(state.items);
  render(<WashesPage />);
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('3');
  expect(screen.queryByText('غسلات اليوم')).toBeNull();
  expect(kpi('إجمالي الغسلات المكتملة').querySelector('.sw-stat-value').textContent).toBe('14');
  expect(kpi('إجمالي الإيرادات').querySelector('.sw-stat-value').textContent).toMatch(/280/);
  expect(state.items).toEqual(original);
});
it('preserves the existing partner scaling for the new count', () => {
  state.scalingFactor = 0.4;
  render(<WashesPage />);
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('1');
});
it('updates the cutoff after Riyadh midnight while the page remains open', () => {
  vi.setSystemTime(new Date('2026-10-10T20:59:30Z'));
  render(<WashesPage />);
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('0');
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('3');
});
it('shows zero when yesterday has no completed washes, even with earlier completed activity', () => {
  state.items = [wash('2026-10-09', 9), wash('2026-10-11', 4), wash('2026-10-10', 7, 'قيد التنفيذ')];
  render(<WashesPage />);
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('0');
});
it('refreshes on window focus and removes the timer when leaving the page', () => {
  vi.setSystemTime(new Date('2026-10-10T20:59:30Z'));
  const view = render(<WashesPage />);
  const timers = vi.getTimerCount();
  vi.setSystemTime(new Date('2026-10-10T21:00:01Z'));
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('3');
  view.unmount();
  expect(vi.getTimerCount()).toBeLessThan(timers);
});
it('orders the requested columns with real booking/worker IDs and preserves each row total', () => {
  state.bikers = [{ id: 'worker-1', name: 'Worker 1', driverExternalId: '001986' }];
  state.items = [{ ...wash('2026-10-10', 3), bikerId: 'worker-1', bikerName: 'Worker 1', sspBookingId: 'C-42' }];
  render(<WashesPage />);
  const table = screen.getByRole('table', { name: 'سجل الغسلات' });
  expect([...table.querySelectorAll('th')].map(cell => cell.textContent))
    .toEqual(['ID الغسلة', 'ID العامل', 'اسم العامل', 'إجمالي الإيرادات', 'التاريخ', 'الحالة', 'إجراءات']);
  const cells = [...table.querySelectorAll('tbody td')];
  expect(cells[0].textContent.trim()).toBe('C-42'); expect(cells[1].textContent.trim()).toBe('001986');
  expect(cells[2].textContent.trim()).toBe('Worker 1'); expect(cells[3].textContent).toMatch(/60/);
  expect(within(table).queryAllByRole('button')).toHaveLength(0);
});
it('shows completed, exceptional and ticketed washes from persisted evidence without changing totals', () => {
  state.items = ['normal', 'exception', 'ticket'].map(id => ({ ...wash('2026-10-10', 1), id, sspBookingId: id, revenueOrigin: 'sweater' }));
  state.items[1].ownerCompletionDecision = { source: 'owner_statement', approved: true, decision: 'record_as_completed_wash', sspBookingId: 'exception' };
  state.bookings = state.items.map(w => ({ sspBookingId: w.sspBookingId, record: { ticketRef: w.id === 'ticket' ? 'T-7' : null } }));
  state.canMutate = true;
  const original = structuredClone(state.items);
  render(<WashesPage />);
  const table = within(screen.getByRole('table', { name: 'سجل الغسلات' }));
  expect(table.getByText('مكتملة')).toBeTruthy(); expect(table.getByText('استثنائية')).toBeTruthy();
  expect(table.getByText('عليها تكت')).toBeTruthy(); expect(table.getByText('T-7').dir).toBe('ltr');
  expect(table.getAllByRole('button', { name: /تغيير اكتمال دفعة/ })).toHaveLength(3);
  expect(kpi('غسلات أمس').querySelector('.sw-stat-value').textContent).toBe('3');
  expect(kpi('إجمالي الإيرادات').querySelector('.sw-stat-value').textContent).toMatch(/60/);
  expect(state.items).toEqual(original);
});
it('reports unavailable ticket verification instead of claiming no tickets or hiding the wash', () => {
  state.items = [{ ...wash('2026-10-10', 1), revenueOrigin: 'sweater', sspBookingId: 'C-missing' }];
  const view = render(<WashesPage />);
  expect(screen.getByText('بيانات التكت غير متاحة')).toBeTruthy();
  state.error = new Error('source unavailable'); view.rerender(<WashesPage />);
  expect(screen.getByRole('alert').textContent).toContain('تعذّر التحقق من التكت');
  expect(within(screen.getByRole('table', { name: 'سجل الغسلات' })).getByText('C-missing')).toBeTruthy();
});
