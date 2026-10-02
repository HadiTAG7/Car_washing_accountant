// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', loading: false, authenticated: true, authLoading: false, partnerView: false }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({
  session: state.authenticated ? { user: { id: 'navigation-test' } } : null,
  loading: state.authLoading,
}) }));
vi.mock('../hooks/useMembership', () => ({ useMembership: () => ({ role: state.role, loading: state.loading, isMember: true }) }));
vi.mock('../lib/firebaseClient', () => ({ isFirebaseConfigured: true, requireAuth: true, missingEnvNames: [] }));
vi.mock('../contexts/MobileMenuContext', () => ({
  MobileMenuProvider: ({ children }) => children,
  useMobileMenu: () => ({ open: false, setOpen: vi.fn() }),
}));
vi.mock('../contexts/PartnerViewContext', () => ({
  PartnerViewProvider: ({ children }) => children,
  usePartnerView: () => ({ isPartnerView: state.partnerView, canMutate: false }),
}));
vi.mock('../components/PartnerViewBanner', () => ({ default: () => null }));
vi.mock('../components/FinancialEntrySelector', () => ({ default: () => null }));
vi.mock('../components/Sidebar', () => ({ default: ({ groups, onSelectTab }) => (
  <nav>{groups.flatMap((group) => group.tabs).map((tab) => (
    <button key={tab.id} onClick={() => onSelectTab(tab.id)}>{tab.label}</button>
  ))}</nav>
) }));
vi.mock('../components/OverviewPage', () => ({ default: () => <h1>صفحة الرئيسية للاختبار</h1> }));
vi.mock('../components/FinancialSummaryPage', () => ({ default: () => <h1>قائمة دخل الشركة للاختبار</h1> }));
vi.mock('../components/InvestorPage', () => ({ default: ({ view }) => <h1>حساب الشريك: {view}</h1> }));
vi.mock('../components/LoginScreen', () => ({ default: () => <h1>الدخول للاختبار</h1> }));
vi.mock('../components/UpdatePasswordScreen', () => ({ default: () => <h1>تحديث كلمة المرور للاختبار</h1> }));
import App from '../App';

beforeEach(() => {
  Object.assign(state, { role: 'admin', loading: false, authenticated: true, authLoading: false, partnerView: false });
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('بقاء الصفحة عند إعادة التحميل', () => {
  it('يستعيد قائمة الدخل من الرابط بدل الصفحة الرئيسية', async () => {
    window.history.replaceState(null, '', '/?page=summary');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' })).toBeTruthy();
  });

  it('يحفظ الاختيار ويعيده عند بدء التطبيق من جديد دون مضاعفة سجل التنقل', async () => {
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' });
    fireEvent.click(screen.getByRole('button', { name: 'قائمة الدخل' }));
    await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' });
    expect(new URLSearchParams(window.location.search).get('page')).toBe('summary');
    const historyLength = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'قائمة الدخل' }));
    expect(window.history.length).toBe(historyLength);
    unmount();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' })).toBeTruthy();
  });

  it('لا يضيع الوجهة أثناء انتظار الجلسة والدور', async () => {
    window.history.replaceState(null, '', '/?page=investor_income');
    Object.assign(state, { authLoading: true, loading: true, role: null });
    const { rerender } = render(<App />);
    expect(screen.queryByRole('heading')).toBeNull();
    Object.assign(state, { authLoading: false, loading: false, role: 'partner', partnerView: true });
    rerender(<App />);
    expect(await screen.findByRole('heading', { name: 'حساب الشريك: income' })).toBeTruthy();
  });

  it('يتبع زر الرجوع والتقدم في المتصفح', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' });
    act(() => {
      window.history.replaceState(null, '', '/?page=summary');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' });
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' })).toBeTruthy();
  });

  it.each(['not-a-page', '__proto__', '<script>alert(1)</script>'])('يرجع بأمان عند رابط غير معروف: %s', async (page) => {
    window.history.replaceState(null, '', `/?page=${encodeURIComponent(page)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' })).toBeTruthy();
  });

  it('لا يفتح رابطاً إدارياً لحساب الشريك', async () => {
    Object.assign(state, { role: 'partner', partnerView: true });
    window.history.replaceState(null, '', '/?page=ledger');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'حساب الشريك: overview' })).toBeTruthy();
  });

  it('لا يفتح مركز القيادة للمشغل من الرابط', async () => {
    state.role = 'operator';
    window.history.replaceState(null, '', '/?page=agent_command_center');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' })).toBeTruthy();
  });

  it('يبقي بوابة تسجيل الدخول حتى مع رابط محفوظ', async () => {
    state.authenticated = false;
    window.history.replaceState(null, '', '/?page=summary&signedOut=123');
    const { rerender } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'الدخول للاختبار' })).toBeTruthy();
    state.authenticated = true;
    rerender(<App />);
    expect(await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' })).toBeTruthy();
  });

  it('لا يتجاوز صفحة استعادة كلمة المرور', async () => {
    window.history.replaceState(null, '', '/update-password?page=summary#recovery');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'تحديث كلمة المرور للاختبار' })).toBeTruthy();
  });

  it('يحافظ على بقية معطيات الرابط ولا يغيرها عند التنقل', async () => {
    window.history.replaceState(null, '', '/?signedOut=123#section');
    render(<App />);
    await screen.findByRole('heading', { name: 'صفحة الرئيسية للاختبار' });
    fireEvent.click(screen.getByRole('button', { name: 'قائمة الدخل' }));
    await screen.findByRole('heading', { name: 'قائمة دخل الشركة للاختبار' });
    expect(window.location.search).toBe('?signedOut=123&page=summary');
    expect(window.location.hash).toBe('#section');
  });
});
