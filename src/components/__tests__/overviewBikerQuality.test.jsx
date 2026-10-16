// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
const state = vi.hoisted(() => ({ role: 'admin', partner: false, query: null }));
const read = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: state.role, isPartnerView: state.partner }) }));
vi.mock('../../hooks/useOverviewBikerQuality', () => ({ useOverviewBikerQuality: (...args) => { read(...args); return state.query; } }));
const { default: OverviewBikerQuality } = await import('../OverviewBikerQuality');
const bikers = [{ id: 'a', driverExternalId: '1984', name: 'عامل تجريبي' }, { id: 'b', driverExternalId: '1982', name: 'Missing worker' }];
const props = { workers: { bikers, loading: false, error: null }, periodKey: '2026-10', today: '2026-10-16' };
beforeEach(() => {
  state.role = 'admin'; state.partner = false; read.mockClear();
  state.query = { available: true, data: [{ bikerUID: 'a', data: { reports: [{ id: 'report', bikerUID: 'a', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
    rulesVersion: 'cqo-20261015-v3', sourceReadDate: '2026-10-15', components: [{ key: 'duration', points: 8, weight: 10, n: 3 }] }] } },
  { bikerUID: 'b', data: { reports: [] } }], loading: false, error: null, refetch: vi.fn() };
});
afterEach(cleanup);
it('shows real partial profile points and their window, without customer-star substitution or normalization', () => {
  render(<OverviewBikerQuality {...props} />);
  expect(screen.getByRole('button', { name: 'عرض تقييم: 1984' }).textContent).toBe('8 / 10');
  expect(screen.queryByRole('button', { name: 'تقييم العملاء' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'عرض تقييم: 1984' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('group', { name: 'تقييم الجودة المركّب' }).textContent).toContain('8 / 10');
  expect(dialog.textContent).toContain('مدة الغسلة'); expect(dialog.textContent).toContain('جزئي');
  expect(within(dialog).queryByRole('textbox')).toBeNull();
});
it('shows missing workers on request and does not invent a score for them', () => {
  render(<OverviewBikerQuality {...props} />);
  expect(screen.queryByText('Missing worker')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'عرض جميع البايكرز' }));
  expect(screen.getByText('Missing worker')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'عرض تقييم: 1982' })).toBeNull();
});
it.each(['accountant', 'partner', 'supervisor'])('keeps profile assessments admin-only for %s', role => {
  state.role = role; render(<OverviewBikerQuality {...props} />); expect(read).not.toHaveBeenCalled();
});
it('does not read in an admin partner preview', () => {
  state.partner = true; render(<OverviewBikerQuality {...props} />); expect(read).not.toHaveBeenCalled();
});
it('distinguishes read failure from missing scores and keeps retry available', () => {
  state.query.data[1] = { bikerUID: 'b', failed: true };
  render(<OverviewBikerQuality {...props} />);
  expect(screen.getByRole('alert').textContent).toContain('لم تُحسب صفرًا');
  fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' })); expect(state.query.refetch).toHaveBeenCalled();
});
it('supports English display with the exact same score', () => {
  render(<LanguageContext.Provider value={{ language: 'en' }}><OverviewBikerQuality {...props} /></LanguageContext.Provider>);
  expect(screen.getByRole('button', { name: 'View assessment: 1984' }).textContent).toBe('8 / 10');
});
it('shows eight criterion means up top and moves profile counts into collapsed coverage details', () => {
  render(<OverviewBikerQuality {...props} />);
  const duration = screen.getByRole('group', { name: 'متوسط نقاط: مدة الغسلة' });
  expect(duration.textContent).toContain('8 / 10');
  expect(duration.textContent).toContain('بايكرز مشمولون: 1');
  expect(screen.getAllByRole('group', { name: /^متوسط نقاط:/ })).toHaveLength(8);
  expect(screen.getByRole('group', { name: 'متوسط نقاط: جودة الغسيل' }).textContent).toContain('غير متاح');
  const coverage = screen.getByText('تغطية التقييمات').closest('details');
  expect(coverage.open).toBe(false);
  expect(coverage.textContent).toContain('تقييمات متاحة');
  fireEvent.click(screen.getByText('تغطية التقييمات'));
  expect(coverage.open).toBe(true);
});
it('does not display unconfirmed averages during loading or failure and supports English criterion labels', () => {
  state.query.loading = true; state.query.available = false;
  const view = render(<OverviewBikerQuality {...props} />);
  expect(screen.getByRole('group', { name: 'متوسط نقاط: مدة الغسلة' }).textContent).toContain('…');
  expect(screen.getByRole('group', { name: 'متوسط نقاط: مدة الغسلة' }).textContent).not.toContain('8 / 10');
  state.query.loading = false; state.query.error = new Error('test failure');
  view.rerender(<OverviewBikerQuality {...props} />);
  expect(screen.getByRole('group', { name: 'متوسط نقاط: مدة الغسلة' }).textContent).toContain('غير متاح');
  state.query.available = true; state.query.error = null;
  view.rerender(<LanguageContext.Provider value={{ language: 'en' }}><OverviewBikerQuality {...props} /></LanguageContext.Provider>);
  expect(screen.getByRole('group', { name: 'Average points: Wash duration' }).textContent).toContain('8 / 10');
});
