// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: { id: 'admin-user' }, partners: [], loading: false, error: null, refetch: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../../hooks/usePartners', () => ({ usePartners: () => state }));
// An investor's own row comes from the server projection, not the list.
vi.mock('../../hooks/usePartnerProfile', () => ({ usePartnerProfile: ({ enabled } = {}) => ({
  partner: enabled && state.user?.id === 'partner-user' ? { id: 'p1', partnerName: 'شريك أول', workersCount: 3, status: 'active' } : null,
  loading: false, error: null, refetch: vi.fn(),
}) }));
import { PartnerViewProvider, usePartnerView } from '../../contexts/PartnerViewContext';
import AdminPartnerSelector from '../AdminPartnerSelector';
import PartnerViewBanner from '../PartnerViewBanner';
import { resolveTab, visibleGroupsFor } from '../../lib/navGroups';
const P1 = { id: 'p1', partnerName: 'شريك أول', workersCount: 3, userId: 'partner-user', status: 'active' };
const P2 = { id: 'p2', partnerName: 'شريك ثان', workersCount: 7, status: 'inactive' };
function Probe() {
  const v = usePartnerView();
  const groups = visibleGroupsFor({ role: v.role, isPartnerView: v.isPartnerView });
  return <><p data-testid="partner">{v.viewedPartner?.id || 'admin'}</p>
    <p data-testid="write">{String(v.canMutate)}</p><p data-testid="route">{resolveTab('partners', { investorMode: v.isPartnerView })}</p>
    <p data-testid="nav">{groups.flatMap(g => g.tabs.map(t => t.id)).join(',')}</p>
    <AdminPartnerSelector /><PartnerViewBanner /></>;
}
const view = (role = 'admin') => <PartnerViewProvider role={role}><Probe /></PartnerViewProvider>;
beforeEach(() => { state.user = { id: 'admin-user' }; state.partners = [P1, P2]; state.loading = false; state.error = null; state.refetch.mockClear(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });
const read = id => screen.getByTestId(id).textContent;
function pick(name) { fireEvent.click(screen.getByRole('button', { name: 'اختر حساب الشريك للمعاينة' })); fireEvent.click(screen.getByRole('button', { name, exact: true })); }
it('lets admin preview every partner, including inactive ones, then switch and return without writing', () => {
  render(view());
  pick('شريك ثان');
  expect(read('partner')).toBe('p2'); expect(read('write')).toBe('false'); expect(read('route')).toBe('investor');
  expect(read('nav')).toContain('investor_income'); expect(read('nav')).not.toContain('partners');
  expect(screen.getByText('معاينة حساب الشريك:')).toBeTruthy();
  pick('شريك أول'); expect(read('partner')).toBe('p1');
  fireEvent.click(screen.getByRole('button', { name: 'الرجوع إلى حساب الأدمن', exact: true }));
  expect(read('partner')).toBe('admin'); expect(read('write')).toBe('true'); expect(read('route')).toBe('partners_list');
});
it('restores the selected preview after reload and can return through the picker', () => {
  const first = render(view()); pick('شريك ثان'); first.unmount(); render(view());
  expect(read('partner')).toBe('p2'); expect(read('write')).toBe('false');
  pick('عرض الأدمن'); expect(read('partner')).toBe('admin'); expect(read('write')).toBe('true');
});
it.each(['partner', 'operator', 'accountant', 'supervisor', null])('does not expose the admin picker for role %s', role => {
  if (role === 'partner') state.user = { id: 'partner-user' };
  window.localStorage.setItem('sweater:actingAsPartnerId', 'p2');
  render(view(role));
  expect(screen.queryByRole('button', { name: 'اختر حساب الشريك للمعاينة' })).toBeNull();
  if (role === 'partner') { expect(read('partner')).toBe('p1'); expect(read('write')).toBe('false'); expect(screen.queryByRole('button', { name: 'الرجوع إلى حساب الأدمن' })).toBeNull(); }
});
it('distinguishes loading and failed partner reads and offers a read-only retry', () => {
  state.loading = true; const first = render(view()); expect(screen.getByText('نحمّل حسابات الشركاء...')).toBeTruthy();
  state.loading = false; state.error = new Error('unavailable'); first.rerender(view());
  expect(screen.getByText('تعذّر تحميل حسابات الشركاء')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'اختر حساب الشريك للمعاينة' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'إعادة تحميل حسابات الشركاء' })); expect(state.refetch).toHaveBeenCalledTimes(1);
});
