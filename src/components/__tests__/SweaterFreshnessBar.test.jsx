// @vitest-environment jsdom
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
const mock = vi.hoisted(() => ({ role: 'admin', partner: false, read: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: mock.role, isPartnerView: mock.partner }) }));
vi.mock('../../i18n/useLanguage', () => ({ useLanguage: () => ({ language: 'ar' }) }));
vi.mock('../../hooks/useSweaterFreshness', () => ({ useSweaterFreshness: () => mock.read() }));
import SweaterFreshnessBar, { FreshnessBarView } from '../SweaterFreshnessBar';
import { operationFreshness } from '../../lib/sweaterFreshness';
const now = Date.parse('2026-10-27T12:00:00Z');
const read = hours => ({ loading: false, value: operationFreshness({ lastOperationalSuccessAtIso: new Date(now - hours * 36e5).toISOString() }, now) });
beforeEach(() => { mock.role = 'admin'; mock.partner = false; mock.read.mockReturnValue(read(13)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('shows the last success in Riyadh with warning and critical tones', () => {
  const page = render(<FreshnessBarView {...read(4)} />);
  expect(screen.getByRole('region', { name: 'حداثة بيانات سويتر' }).dataset.tone).toBe('yellow');
  page.rerender(<FreshnessBarView {...read(13)} />);
  expect(screen.getByRole('region', { name: 'حداثة بيانات سويتر' }).dataset.tone).toBe('red');
  expect(screen.getByText(/آخر استيراد من سويتر/).textContent).toContain('(الرياض)');
});
it('does not show an alarming age during loading or invent a success on error', () => {
  const p = render(<FreshnessBarView loading value={read(13).value} />);
  expect(screen.getByRole('region').dataset.tone).toBe('loading');
  p.rerender(<FreshnessBarView error={new Error('read failed')} />);
  expect(screen.getByRole('alert').textContent).toMatch(/غير مؤكدة/);
  expect(screen.getByText(/آخر استيراد من سويتر/).textContent).toContain('غير متاح');
});
it('warns the owner only past twelve hours and links to the existing integration page', () => {
  const nav = vi.fn(); const p = render(<SweaterFreshnessBar attention onNavigate={nav} />);
  expect(screen.getByRole('alert').textContent).toContain('12 ساعة');
  fireEvent.click(screen.getByRole('button', { name: 'فتح تكامل سويتر' })); expect(nav).toHaveBeenCalledWith('sweater_integration');
  mock.read.mockReturnValue(read(12)); p.rerender(<SweaterFreshnessBar attention onNavigate={nav} />); expect(screen.queryByRole('alert')).toBeNull();
});
it('never mounts company state reads for a partner preview or an unrecognized role', () => {
  mock.partner = true; const p = render(<SweaterFreshnessBar />); expect(mock.read).not.toHaveBeenCalled();
  mock.partner = false; mock.role = 'partner'; p.rerender(<SweaterFreshnessBar />); expect(mock.read).not.toHaveBeenCalled();
});
