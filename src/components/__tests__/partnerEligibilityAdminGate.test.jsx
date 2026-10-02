// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
