// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
const view = vi.hoisted(() => ({ role: 'admin', canMutate: true, isPartnerView: false, viewedPartner: null }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => view }));
vi.mock('../../hooks/usePartners', () => ({ usePartners: () => ({ partners: [{ id: 'p1', partnerName: 'هادي', workersCount: 10 }], loading: false }) }));
vi.mock('../../hooks/usePartnerPayments', () => ({ usePartnerPayments: () => ({ payments: [] }) }));
vi.mock('../../hooks/usePartnerMcpKeys', () => ({ usePartnerMcpKeys: () => ({ keys: [] }), activeKeyFor: () => null }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../AddPartnerModal', () => ({ default: () => null }));
vi.mock('../EditPartnerModal', () => ({ default: () => null }));
vi.mock('../PartnerStatementModal', () => ({ default: () => null }));
vi.mock('../PartnerEligibilityModal', () => ({ default: () => null }));
import PartnersPage from '../PartnersPage';
afterEach(cleanup);
describe('زر أهلية البايكرز للأدمن فقط', () => {
  it.each(['admin', 'operator', 'accountant', 'partner'])('الدور %s', role => {
    view.role = role; view.canMutate = true;
    render(<PartnersPage />);
    expect(Boolean(screen.queryByRole('button', { name: 'أهلية بايكرز هادي' }))).toBe(role === 'admin');
  });
  it('المحاكاة للقراءة فقط ولو كان الحساب أدمن', () => {
    view.role = 'admin'; view.canMutate = false;
    render(<PartnersPage />);
    expect(screen.queryByRole('button', { name: 'أهلية بايكرز هادي' })).toBeNull();
  });
});
describe('فتح عرض حساب الشريك من إدارة الشركاء', () => {
  it.each(['admin', 'operator', 'accountant', 'partner', 'supervisor'])('يظهر زر المعاينة للأدمن وحده: %s', role => {
    Object.assign(view, { role, isAdmin: true, canMutate: true, isPartnerView: false, setActingAsPartnerId: vi.fn() });
    render(<PartnersPage />);
    const button = screen.queryByRole('button', { name: 'عرض حساب الشريك: هادي' });
    expect(Boolean(button)).toBe(role === 'admin');
    if (button) { fireEvent.click(button); expect(view.setActingAsPartnerId).toHaveBeenCalledWith('p1'); }
  });
});
describe('إدارة الشركاء للمدير فقط', () => {
  it.each(['admin', 'operator', 'accountant'])('الإضافة والتعديل والحذف وعمود المساعد: %s', role => {
    Object.assign(view, { role, isAdmin: true, canMutate: true, isPartnerView: false });
    render(<PartnersPage />);
    const admin = role === 'admin';
    expect(Boolean(screen.queryByRole('button', { name: 'إضافة شريك جديد' }))).toBe(admin);
    expect(Boolean(screen.queryByRole('button', { name: 'تعديل هادي' }))).toBe(admin);
    expect(Boolean(screen.queryByRole('button', { name: 'حذف هادي' }))).toBe(admin);
    expect(screen.queryByRole('columnheader', { name: 'المساعد الذكي' })).toBeNull();
    // Printing a partner's statement stays available to staff.
    expect(screen.getByRole('button', { name: 'كشف حساب هادي' })).toBeTruthy();
  });
});
