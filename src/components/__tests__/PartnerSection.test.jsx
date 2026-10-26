// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ view: { role: 'admin', isPartnerView: false }, partners: vi.fn(), ledger: vi.fn(), payments: vi.fn(), lookup: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => state.view }));
vi.mock('../../hooks/usePartners', () => ({ usePartners: () => state.partners() }));
vi.mock('../../hooks/useLedger', () => ({ useLedger: () => state.ledger() }));
vi.mock('../../hooks/usePartnerPayments', () => ({ usePartnerPayments: () => state.payments() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }));
vi.mock('../../hooks/usePartnerMcpKeys', () => ({ usePartnerMcpKeys: () => ({ keys: [] }), activeKeyFor: () => null }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: vi.fn() }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('../ModalSurface', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../lib/firebaseClient', () => ({ describeBackendError: e => e.message, maskedProjectRef: () => 'test', missingEnvNames: [], isFirebaseConfigured: true, lookupUserIdByEmail: (...args) => state.lookup(...args), isValidEmail: value => value.includes('@'), createPartnerUser: vi.fn() }));
import PartnerCapitalPage from '../PartnerCapitalPage';
import PartnerAccountsPage from '../PartnerAccountsPage';
import EditPartnerModal from '../EditPartnerModal';
afterEach(() => { cleanup(); vi.clearAllMocks(); state.view = { role: 'admin', isPartnerView: false }; });

describe('partners pages do not widen access or writes', () => {
  it.each(['partner', 'operator', 'supervisor'])('does not mount capital data for %s', role => {
    state.view.role = role; render(<PartnerCapitalPage />); expect(state.ledger).not.toHaveBeenCalled(); expect(state.partners).not.toHaveBeenCalled();
  });
  it('does not mount account directory or partner data during admin preview', () => {
    state.view.isPartnerView = true; render(<PartnerAccountsPage />); expect(state.partners).not.toHaveBeenCalled();
  });
  it('shows an exact receipt link and an error instead of guessed zero on failed reads', () => {
    state.partners.mockReturnValue({ partners: [{ id: 'a', partnerName: 'شريك الاختبار', workersCount: 1 }] });
    state.payments.mockReturnValue({ payments: [{ id: 'receipt', partnerId: 'a', amount: 20000, paymentDate: '2026-09-25' }] });
    state.ledger.mockReturnValue({ entries: [], lines: [] });
    const page = render(<PartnerCapitalPage />);
    expect(screen.getByRole('link').getAttribute('href')).toContain('partnerId=a&paymentId=receipt');
    expect(screen.getByText('لا يوجد قيد مرتبط بسند القبض', { exact: false })).toBeTruthy();
    state.ledger.mockReturnValue({ entries: [], lines: [], error: new Error('تعذرت قراءة الدفتر') });
    page.rerender(<PartnerCapitalPage />); expect(screen.queryByRole('table')).toBeNull();
  });
  it('account-only editing submits only a user link, not ownership or capital fields', async () => {
    const save = vi.fn(); state.lookup.mockResolvedValue('existing-partner-user');
    render(<EditPartnerModal accountOnly isOpen partner={{ id: 'a', partnerName: 'شريك الاختبار', workersCount: 4 }} onSave={save} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('عدد العمالة')).toBeNull();
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني لحساب الشريك/), { target: { name: 'email', value: 'test@example.com' } });
    fireEvent.submit(screen.getByLabelText(/البريد الإلكتروني لحساب الشريك/).closest('form'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('a', { userId: 'existing-partner-user' }));
  });
  it('the partner-list editor does not expose account linking', () => {
    render(<EditPartnerModal showAccountFields={false} isOpen partner={{ id: 'a', partnerName: 'شريك الاختبار', workersCount: 4 }} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('عدد العمالة')).toBeTruthy(); expect(screen.queryByLabelText(/البريد الإلكتروني لحساب الشريك/)).toBeNull();
  });
});
