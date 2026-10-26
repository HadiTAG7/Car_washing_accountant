// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ view: { role: 'admin', isPartnerView: false, canMutate: true }, dashboard: vi.fn(), save: vi.fn(), historyError: null }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mocks.view }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('../../hooks/useOverviewDashboard', () => ({ useOverviewDashboard: () => mocks.dashboard() }));
vi.mock('../../hooks/useFirestoreQuery', () => ({ useFirestoreQuery: () => ({ data: [], loading: false, error: mocks.historyError, refetch: vi.fn() }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, describeBackendError: e => e.message, maskedProjectRef: () => 'test' }));
vi.mock('../../lib/bikerProfile', () => ({ riyadhToday: () => '2026-10-26' }));
vi.mock('../../lib/ledgerTransport', () => ({ callServer: (...args) => mocks.save(...args) }));
vi.mock('../../lib/firestoreCrud', () => ({ fetchRows: vi.fn(), where: vi.fn() }));
import IdleBikersTab from '../IdleBikersTab';
import IdleBikersAttention from '../IdleBikersAttention';
const bikers = ['أول', 'ثان'].map((name, i) => ({ id: `b${i}`, name, startDate: '2026-10-01', driverExternalId: '', currentStatus: 'تدريب' }));
const data = { finance: { statement: { totalCosts: 1800 }, loading: false }, workers: { bikers, loading: false },
  payroll: { data: [{ periodKey: '2026-10', estimated: true, lines: bikers.map(b => ({ bikerId: b.id, basicDue: 900, daysEntitled: 31, eligibleStart: '2026-10-01', eligibleEnd: '2026-10-31' })) }], loading: false }, operations: { conflicts: [] }, retry: vi.fn() };
beforeEach(() => { mocks.view = { role: 'admin', isPartnerView: false, canMutate: true }; mocks.dashboard.mockReturnValue(data); mocks.historyError = null; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('never mounts payroll/company hooks for an unauthorized role or partner preview', () => {
  const page = render(<IdleBikersTab role="operator" />); expect(mocks.dashboard).not.toHaveBeenCalled();
  mocks.view.isPartnerView = true; page.rerender(<IdleBikersTab role="admin" />); expect(mocks.dashboard).not.toHaveBeenCalled();
});
it('saves only follow-up metadata and preserves another row’s unsaved note', async () => {
  mocks.save.mockResolvedValue({ followup: { reasonKey: 'training', expectedStartDate: '', note: '', revision: 1, updatedBy: 'actor', updatedByName: 'المراجع', updatedAtIso: '2026-10-26T19:00:00Z' } });
  render(<IdleBikersTab role="admin" />);
  fireEvent.change(screen.getByRole('textbox', { name: 'ملاحظة ثان' }), { target: { value: 'ملاحظة لم تحفظ بعد' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'سبب خمول أول' }), { target: { value: 'training' } });
  const first = screen.getByRole('combobox', { name: 'سبب خمول أول' }).closest('tr');
  fireEvent.click(within(first).getByRole('button', { name: 'احفظ المتابعة' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('bikerIdleFollowupSave', { bikerId: 'b0', expectedRevision: 0, reasonKey: 'training', expectedStartDate: '', note: '' }));
  await screen.findByText(/المراجع/);
  expect(screen.getByRole('textbox', { name: 'ملاحظة ثان' }).value).toBe('ملاحظة لم تحفظ بعد');
  expect(screen.getAllByText('غير مربوط بسويتر')).toHaveLength(2);
});
it('blocks editing in read-only mode and does not replace failed reads with zero idle bikers', () => {
  mocks.view.canMutate = false; const page = render(<IdleBikersTab role="accountant" />);
  expect(screen.queryByRole('button', { name: 'احفظ المتابعة' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'سبب خمول أول' }).disabled).toBe(true);
  mocks.historyError = new Error('فشل قراءة الغسلات'); page.rerender(<IdleBikersTab role="accountant" />);
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText('ما فيه بايكر خامل حسب التعريف الحالي.')).toBeNull();
});
it('shows the same missing-reason and long-idle alerts in overview and links to the idle tab', () => {
  const navigate = vi.fn(); render(<IdleBikersAttention data={data} periodKey="2026-10" today="2026-10-26" onNavigate={navigate} />);
  expect(screen.getByText('خامل بدون سبب مسجل:', { exact: false })).toBeTruthy();
  expect(screen.getByText('خامل أكثر من 14 يوم:', { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'فتح الخاملين' }));
  expect(navigate).toHaveBeenCalledWith('bikers'); expect(new URLSearchParams(location.search).get('bikerTab')).toBe('idle');
});
