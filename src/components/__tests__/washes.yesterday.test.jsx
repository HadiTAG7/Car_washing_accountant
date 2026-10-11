// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ items: [], scalingFactor: 1 }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: state.items, loading: false }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: [] }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ scalingFactor: state.scalingFactor, canMutate: false }) }));
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
  state.items = [wash('2026-09-30', 2), wash('2026-10-10', 3), wash('2026-10-11', 4),
    wash('2026-10-12', 5), wash('2026-10-09', 7, 'قيد التنفيذ')];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('replaces today with cumulative completed washes through yesterday, without changing other KPIs', () => {
  const original = structuredClone(state.items);
  render(<WashesPage />);
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('5');
  expect(screen.queryByText('غسلات اليوم')).toBeNull();
  expect(kpi('إجمالي الغسلات المكتملة').querySelector('.sw-stat-value').textContent).toBe('14');
  expect(kpi('إجمالي الإيرادات').querySelector('.sw-stat-value').textContent).toMatch(/280/);
  expect(state.items).toEqual(original);
});
it('preserves the existing partner scaling for the new count', () => {
  state.scalingFactor = 0.4;
  render(<WashesPage />);
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('2');
});
it('updates the cutoff after Riyadh midnight while the page remains open', () => {
  vi.setSystemTime(new Date('2026-10-10T20:59:30Z'));
  render(<WashesPage />);
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('2');
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('5');
});
it('shows zero when there are no completed washes before today', () => {
  state.items = [wash('2026-10-11', 4), wash('2026-10-10', 7, 'قيد التنفيذ')];
  render(<WashesPage />);
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('0');
});
it('refreshes on window focus and removes the timer when leaving the page', () => {
  vi.setSystemTime(new Date('2026-10-10T20:59:30Z'));
  const view = render(<WashesPage />);
  const timers = vi.getTimerCount();
  vi.setSystemTime(new Date('2026-10-10T21:00:01Z'));
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(kpi('إجمالي الغسلات حتى أمس').querySelector('.sw-stat-value').textContent).toBe('5');
  view.unmount();
  expect(vi.getTimerCount()).toBeLessThan(timers);
});
