// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import AnnualExpensesPage from '../AnnualExpensesPage';
import TemporaryExpensesPage from '../TemporaryExpensesPage';
import StartupPage from '../StartupPage';
import { OWNER_ADVANCE_MONTH_PLAN as PLAN } from '../../lib/advanceMonth';
const f = vi.hoisted(() => ({ annual: [], payments: [], temporary: [], startup: [], parents: new Set(), mutation: vi.fn(), role: 'admin', bikers: [], error: null }));
vi.mock('../../hooks/useAnnualExpenses', () => ({ useAnnualExpenses: () => ({ items: f.annual, addItem: f.mutation, updateItem: f.mutation, updateStatus: f.mutation, deleteItem: f.mutation, refetch: vi.fn() }) }));
vi.mock('../../hooks/useAnnualExpenseEntries', () => ({ useAnnualExpenseEntries: () => ({ entries: [] }), useAllAnnualEntries: () => ({ entries: f.payments }) }));
vi.mock('../../hooks/useAnnualExpenseCategories', () => ({ useAnnualExpenseCategories: () => ({ categories: [], getCategoryLabel: () => 'اختبار' }) }));
vi.mock('../../hooks/useTemporaryExpenses', () => ({ useTemporaryExpenses: () => ({ expenses: f.temporary, refetch: vi.fn() }) }));
vi.mock('../../hooks/useBikers', () => ({ useBikers: () => ({ bikers: f.bikers, error: f.error }) }));
vi.mock('../../hooks/useStartupCosts', () => ({ useStartupCosts: () => ({ items: f.startup, updateItem: f.mutation, deleteItem: f.mutation }) }));
vi.mock('../../hooks/useStartupCostEntries', () => ({ useStartupCostEntries: () => ({ entries: [] }), useStartupLedgerParents: () => ({ parentIds: f.parents }) }));
vi.mock('../../hooks/useCategories', () => ({ useCategories: () => ({ categories: [], getCategoryLabel: () => 'اختبار' }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ role: f.role, scalingFactor: 1, canMutate: f.role === 'admin' }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, describeBackendError: e => e.message }));
vi.mock('../../lib/ledgerTransport', () => ({ callServer: vi.fn() }));
vi.mock('../AdvanceMonthEditor', () => ({ default: () => null }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../StartupCapacityCard', () => ({ default: () => <p>بطاقة الطاقة</p> }));
vi.mock('../ExpenseLedgerModal', () => ({ default: () => null }));
vi.mock('../StartupConversionModal', () => ({ default: () => null }));
beforeEach(() => { f.annual = []; f.payments = []; f.temporary = []; f.startup = []; f.parents = new Set(); f.bikers = []; f.role = 'admin'; f.error = null; f.mutation.mockReset(); });
afterEach(cleanup);
const plan = (id, paid = false) => ({ id, expenseName: `مصروف ${id}`, annualCost: 100, actualAmount: 0, paymentStatus: paid ? 'paid' : 'pending', quantity: 1, paymentMonth: 1, paymentDay: 1 });
it('warns on paid without payments, disables deletion with history, and never saves on status click or cancellation', async () => {
  f.annual = [plan('empty', true), { ...plan('history'), actualAmount: 50 }]; f.payments = [{ annualExpenseId: 'history', amount: 50 }];
  render(<AnnualExpensesPage />); expect(screen.getByText('مدفوع بلا دفعات مسجلة: 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'حذف مصروف history' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'مدفوع', exact: true }));
  const dialog = screen.getByRole('dialog', { name: 'تأكيد تغيير المصروف' }); expect(f.mutation).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'تأكيد التغيير' }).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء دون تغيير' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(f.mutation).not.toHaveBeenCalled();
});
it('requires both an explicit confirmation and a reason, then forwards them and the stale-state guard to the existing hook', async () => {
  f.annual = [plan('empty')]; render(<AnnualExpensesPage />);
  fireEvent.click(screen.getByRole('button', { name: 'قيد الانتظار', exact: true }));
  fireEvent.click(screen.getByLabelText('راجعت التغيير وأؤكد تنفيذه')); expect(screen.getByRole('button', { name: 'تأكيد التغيير' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('سبب التعديل'), { target: { value: 'سبب موثق اختباري' } });
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد التغيير' }));
  await waitFor(() => expect(f.mutation).toHaveBeenCalledWith('empty', 'paid', expect.objectContaining({ confirmed: true, reason: 'سبب موثق اختباري', expected: { annual_cost: 100, payment_status: 'pending' } })));
});
it('requires explicit confirmation before deleting an unused annual plan', async () => {
  f.annual = [plan('empty')]; render(<AnnualExpensesPage />); fireEvent.click(screen.getByRole('button', { name: 'حذف مصروف empty' }));
  expect(f.mutation).not.toHaveBeenCalled(); fireEvent.click(screen.getByLabelText('راجعت التغيير وأؤكد تنفيذه')); fireEvent.click(screen.getByRole('button', { name: 'تأكيد التغيير' }));
  await waitFor(() => expect(f.mutation).toHaveBeenCalledWith('empty', expect.objectContaining({ confirmed: true })));
});
it('opens advances without a month filter and folds only the verified completed historical assignment task', () => {
  f.bikers = [{ id: 'left', currentStatus: 'هرب' }];
  f.temporary = PLAN.rows.map(([id, amount, spentDate, status]) => ({ id, title: `سلفة اختبار ${id}`, amount, spentDate, status, assignmentMonthExplicit: true, assignmentMonth: '2026-09', bikerId: 'left' }));
  render(<TemporaryExpensesPage />); expect(screen.getByLabelText('شهر إسناد السلفة').value).toBe('all');
  expect(screen.getByText('حالة البايكر')).toBeTruthy(); expect(screen.getAllByText('هرب')).toHaveLength(10);
  expect(screen.getByText('مهام سابقة').closest('details').open).toBe(false); expect(screen.queryByRole('button', { name: 'مراجعة إسناد السلف العشر' })).toBeNull();
  expect(screen.getByText('سلف معلقة لبايكرية هرب أو مشيناه أو محذوفين')).toBeTruthy(); expect(f.mutation).not.toHaveBeenCalled();
});
it('keeps an incomplete historical task visible and never calls missing biker data a zero risk', () => {
  f.error = new Error('test'); render(<TemporaryExpensesPage />); expect(screen.getByRole('button', { name: 'مراجعة إسناد السلف العشر' })).toBeTruthy();
  expect(screen.getByText('غير متاح')).toBeTruthy(); expect(screen.getByRole('alert').textContent).toContain('تعذرت قراءة حالات البايكرز');
});
it('protects startup actual/status as derived values, blocks paid deletion and confirms an empty plan deletion', async () => {
  f.startup = [{ id: 'paid', itemName: 'بند مدفوع', category: 'test', plannedAmount: 100, actualAmount: 100, status: 'completed' }, { id: 'empty', itemName: 'بند فارغ', category: 'test', plannedAmount: 100, actualAmount: 0, status: 'in_progress' }];
  render(<StartupPage />); expect(screen.getByText('بنود مكتملة بلا دفعات مسجلة: 1')).toBeTruthy(); expect(screen.getByRole('button', { name: 'حذف بند مدفوع' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'حذف بند فارغ' })); expect(f.mutation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('راجعت التغيير وأؤكد تنفيذه')); fireEvent.click(screen.getByRole('button', { name: 'تأكيد التغيير' }));
  await waitFor(() => expect(f.mutation).toHaveBeenCalledWith('empty'));
});
