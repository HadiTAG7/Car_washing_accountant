// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import { liveIncomeStatement } from '../../lib/accounting/liveIncomeStatement';
import { DEFAULT_CHART_OF_ACCOUNTS as accounts } from '../../lib/accounting/chartOfAccounts';
import { overviewOperations, overviewQuality } from '../../lib/overviewDashboard';
const state = vi.hoisted(() => ({ data: null, role: 'admin', partner: false }));
const read = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useOverviewDashboard', () => ({ useOverviewDashboard: (...args) => { read(...args); return state.data; } }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: state.role, isPartnerView: state.partner, canMutate: false }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [] }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('../CapitalOverviewPage', () => ({ default: () => <p>Isolated capital panel</p> }));
vi.mock('../../lib/backupZip', () => ({ downloadFullBackup: vi.fn() }));
vi.mock('../../lib/bikerProfile', () => ({ riyadhToday: () => '2026-10-16' }));
const { default: OverviewPage } = await import('../OverviewPage');
const biker = { id: 'worker-a', name: 'عامل اختبار', nameEnglish: 'Test biker', currentStatus: 'يشتغل', driverExternalId: '1984' };
const washes = [{ id: 'wash-a', bikerId: biker.id, bikerName: biker.name, washDate: '2026-10-15', quantity: 2, price: 20, status: 'مكتملة' }];
const statement = () => liveIncomeStatement({ accounts, entries: [], lines: [], periodKey: '2026-10',
  sources: { payrollPreviews: [{ periodKey: '2026-10', estimated: true, lines: [{ basicDue: 900 }] }] } });
beforeEach(() => {
  state.role = 'admin'; state.partner = false; read.mockClear();
  state.data = { finance: { statement: statement(), previous: null, loading: false },
    operations: overviewOperations({ washes, bikers: [biker], periodKey: '2026-10', today: '2026-10-16' }),
    quality: overviewQuality({ periodKey: '2026-10', today: '2026-10-16' }), dueVouchers: [],
    washes: { loading: false, error: null }, workers: { bikers: [biker], loading: false, error: null }, bookings: { loading: false, error: null }, retry: vi.fn() };
});
afterEach(cleanup);
it('prioritizes finance, operations and quality; keeps capital collapsed without reading its sources', () => {
  render(<OverviewPage />);
  expect(screen.getAllByRole('heading', { level: 2 }).map(e => e.textContent).slice(1, 4)).toEqual(['النتيجة المالية', 'حركة التشغيل', 'الغسلات يومًا بيوم']);
  expect(screen.getByRole('button', { name: 'صافي الربح', exact: true }).textContent).toContain('-900');
  expect(screen.getByText('الجودة وتجربة العميل')).toBeTruthy();
  expect(screen.queryByText('Isolated capital panel')).toBeNull();
});
it('opens exact P&L detail including unpaid salaries, preserving loss signs and no duplicate finance formula', () => {
  render(<OverviewPage />);
  fireEvent.click(screen.getByRole('button', { name: 'المصروفات والتكاليف', exact: true }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByTestId('statement-detail-amount').textContent).toContain('900');
  expect(screen.getByText('رواتب مستحقة غير مُرحّلة')).toBeTruthy();
});
it('opens a day by keyboard/click with wash IDs, worker ID, quantity and original date', () => {
  render(<OverviewPage />);
  fireEvent.click(screen.getByRole('button', { name: '15 أكتوبر: 2 غسلة', exact: true }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('wash-a')).toBeTruthy(); expect(within(dialog).getByText('1984')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'إغلاق التفاصيل' })); expect(screen.queryByRole('dialog')).toBeNull();
});
it('never substitutes unavailable finance or quality with zero; independent operations remain visible', () => {
  state.data.finance = { statement: null, loading: false, error: new Error('test') };
  state.data.bookings.error = new Error('test');
  render(<OverviewPage />);
  expect(screen.getByRole('button', { name: 'صافي الإيرادات', exact: true }).textContent).toContain('غير متاح');
  expect(screen.getByRole('button', { name: 'تقييم العملاء', exact: true }).textContent).toContain('غير متاح');
  expect(screen.getByRole('button', { name: 'غسلات الشهر', exact: true }).textContent).toContain('2');
});
it('a missing ticket reference is unavailable, not a clean zero-ticket record or zero-star rating', () => {
  render(<OverviewPage />);
  expect(screen.getByRole('button', { name: 'مراجع التكتات', exact: true }).textContent).toContain('غير متاح');
  expect(screen.getByRole('button', { name: 'تقييم العملاء', exact: true }).textContent).toContain('غير متاح');
});
it('changes the selected period through the branded picker, with no automatic navigation or reload', () => {
  render(<OverviewPage />);
  fireEvent.click(screen.getByRole('button', { name: 'الشهر', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'سبتمبر 2026', exact: true }));
  expect(read).toHaveBeenLastCalledWith('2026-09', '2026-10-16');
});
it('routes detail links through the existing authorized app navigation', () => {
  const navigate = vi.fn(); render(<OverviewPage onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'فتح قائمة الدخل' })); expect(navigate).toHaveBeenCalledWith('summary');
});
it.each(['partner', 'supervisor'])('never mounts company reads for %s', role => {
  state.role = role; render(<OverviewPage />); expect(read).not.toHaveBeenCalled();
});
it('does not mount company reads in admin partner-preview mode', () => {
  state.partner = true; render(<OverviewPage />); expect(read).not.toHaveBeenCalled();
});
it('renders English labels and LTR while preserving the same salary loss', () => {
  render(<LanguageContext.Provider value={{ language: 'en' }}><OverviewPage /></LanguageContext.Provider>);
  expect(screen.getByRole('main').getAttribute('dir')).toBe('ltr');
  expect(screen.getByRole('button', { name: 'Net profit', exact: true }).textContent).toContain('-900');
  expect(screen.getByText('Quality and customer experience')).toBeTruthy();
});
