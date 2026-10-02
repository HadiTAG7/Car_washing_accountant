// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DateField from '../DateField';
import { BudgetCard } from '../BudgetsPage';
import { AgentMessage } from '../AgentCommandCenterPage';
import BikerPayroll from '../BikerPayroll';
import VariableExpensesPage from '../VariableExpensesPage';

const fixture = vi.hoisted(() => ({
  canMutate: false,
  runs: [], lines: [],
  preview: vi.fn(async () => ({ lines: [], totals: { basic: 0, commissions: 0, bonuses: 0, deductions: 0, advances: 0, net: 0 } })),
  refetch: vi.fn(async () => {}),
  items: [
    { id: '1', categoryId: 'supplies', expenseName: 'مواد تنظيف', quantity: 2, totalVariableCost: 115.75, unitCost: 57.875, loggedDate: '2026-10-01' },
    { id: '2', categoryId: 'tools', expenseName: 'معدات تشغيل', quantity: 1, totalVariableCost: 50.25, unitCost: 50.25, loggedDate: '2026-10-01' },
  ],
  categories: [{ id: 'supplies', label: 'المستهلكات' }, { id: 'tools', label: 'الأدوات' }],
}));
vi.mock('../../hooks/usePayroll', () => ({
  usePayrollRuns: () => ({ runs: fixture.runs, preview: fixture.preview, refetch: fixture.refetch, loading: false }),
  usePayrollItems: () => ({ data: fixture.lines, loading: false }),
}));
vi.mock('../../hooks/useVariableExpenses', () => ({ useVariableExpenses: () => ({ items: fixture.items, loading: false }) }));
vi.mock('../../hooks/useVariableExpenseCategories', () => ({ useVariableExpenseCategories: () => ({
  categories: fixture.categories, getCategoryLabel: (id) => fixture.categories.find((item) => item.id === id)?.label,
}) }));
vi.mock('../../hooks/useWashes', () => ({ useWashes: () => ({ items: fixture.lines }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ scalingFactor: 1, canMutate: fixture.canMutate }) }));
afterEach(cleanup);

it('يكشف سجل التاريخ للإدارة خارج مرشح الشهر ولا يسرّب معرّفه في عرض الشريك', () => {
  const item = { id: 'legacy-aug', expenseName: 'مصروف قديم', loggedDate: '2026-8-22', totalVariableCost: 50 };
  fixture.items.push(item);
  try {
    fixture.canMutate = true;
    const { unmount } = render(<VariableExpensesPage />);
    expect(screen.getByText('legacy-aug')).toBeTruthy();
    expect(screen.getByText('2026-08-22')).toBeTruthy();
    unmount();
    fixture.canMutate = false;
    render(<VariableExpensesPage />);
    expect(screen.queryByText('legacy-aug')).toBeNull();
  } finally {
    fixture.items.pop();
    fixture.canMutate = false;
  }
});

it('يفرق بين الرواتب غير المحتسبة والصفر الفعلي ويعيد الحالة عند تغيير الفترة', async () => {
  render(<BikerPayroll role="accountant" />);
  expect(screen.getAllByText('لم تُحتسب بعد')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', { name: 'معاينة' }));
  await waitFor(() => expect(screen.queryByText('لم تُحتسب بعد')).toBeNull());
  expect(document.querySelectorAll('.sw-stat-value')).toHaveLength(6);
  expect([...document.querySelectorAll('.sw-stat-value')].every((node) => node.textContent.includes('0.00'))).toBe(true);
  fireEvent.change(document.querySelector('input[type="month"]'), { target: { value: '2026-08' } });
  expect(await screen.findAllByText('لم تُحتسب بعد')).toHaveLength(6);
});

it.each([[179999.99, null], [180000, 'اكتملت الميزانية'], [180000.01, 'تجاوز الميزانية']])('يصف حد الميزانية بدقة عند صرف %s', (spent, expected) => {
  render(<BudgetCard budget={{ categoryLabel: 'تشغيل', budgetType: 'annual' }} allocated={180000} spent={spent} canMutate={false} />);
  if (spent === 180000.01) {
    const shortage = screen.getByText('العجز عن الميزانية').parentElement.textContent.replace(/[\u200e\u200f]/g, '');
    expect(shortage).toContain('−0.01');
  }
  for (const label of ['اكتملت الميزانية', 'تجاوز الميزانية']) {
    expect(Boolean(screen.queryByText(label))).toBe(label === expected);
  }
});

it('يستمد اسم التاريخ من تسميته ويستعيد التركيز عند إغلاق التقويم', () => {
  render(<><label htmlFor="advance-date">تاريخ الصرف</label><DateField id="advance-date" value="2026-10-01" /></>);
  const trigger = screen.getByRole('button', { name: 'تاريخ الصرف' });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('يحتفظ بنص المتابعة الطويل ومرجعه كاملين خلف تفاصيل قابلة للفتح', () => {
  const text = 'تمت مراجعة نتائج التشغيل مع الاحتفاظ بالملاحظات. '.repeat(8) + 'مرجع: https://example.test/review/complete';
  const { container } = render(<AgentMessage text={text} />);
  expect(container.querySelector('details')).toBeTruthy();
  expect(container.querySelector('summary').textContent).toContain('عرض التفاصيل كاملة');
  expect(container.querySelector('.acc-message').textContent).toBe(text);
});

it('يبحث في المصروف والتصنيف دون تغيير مبالغ ملخص الشهر', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00+03:00'));
  try {
    const { container } = render(<VariableExpensesPage />);
    const summaries = () => [...container.querySelectorAll('.sw-stat-card')].map((node) => node.textContent);
    const before = summaries();
    const input = screen.getByRole('searchbox', { name: 'البحث في مصاريف الشهر' });
    fireEvent.change(input, { target: { value: 'المستهلكات' } });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody').textContent).toContain('مواد تنظيف');
    expect(summaries()).toEqual(before);
    fireEvent.change(input, { target: { value: 'غير موجود' } });
    expect(screen.getByText('لا توجد نتائج مطابقة للبحث')).toBeTruthy();
    expect(summaries()).toEqual(before);
    fireEvent.change(input, { target: { value: '' } });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  } finally { vi.useRealTimers(); }
});
