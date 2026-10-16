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
