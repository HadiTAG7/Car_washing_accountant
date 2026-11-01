// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sidebar from '../Sidebar';
import BalanceSheetUnposted from '../BalanceSheetUnposted';
import { resolveTab, visibleGroupsFor } from '../../lib/navGroups';

vi.mock('../../lib/firebaseClient', () => ({ auth: null, isFirebaseConfigured: false }));
vi.mock('../ChangePasswordModal', () => ({ default: () => null }));
vi.mock('../../hooks/useIncomeStatementSources', () => ({ useIncomeStatementSources: () => ({ sources: { washes: [] } }) }));
vi.mock('../../hooks/useIncomePayrollPreviews', () => ({ useIncomePayrollPreviews: () => ({ data: [{ periodKey: '2026-10', lines: [] }] }) }));
vi.mock('../../hooks/useAccountingSettings', () => ({ useAccountingSettings: () => ({ settings: [] }) }));
vi.mock('../../hooks/useFinanceRead', () => ({ useFinanceRead: () => ({ data: { receipts: [] } }) }));
vi.mock('../../lib/accounting/liveIncomeStatement', () => ({ liveIncomeStatement: () => ({}) }));
vi.mock('../../lib/balanceUnposted', () => ({ balanceUnposted: () => ({
  payroll: 25432.26, revenue: 7640, vat: 1146, issues: [],
  documents: { count: 3, amount: 400, approvedCount: 1, approvedAmount: 200 },
}) }));

afterEach(() => { cleanup(); localStorage.clear(); });

it.each([false, true])('hides the internal destination in the shared sidebar (mobileOpen=%s), keeping neighbouring pages usable', mobileOpen => {
  const select = vi.fn();
  const groups = visibleGroupsFor({ role: 'admin' });
  render(<Sidebar groups={groups} activeTab="finance" onSelectTab={select} mobileOpen={mobileOpen} />);
  expect(screen.queryByRole('button', { name: 'صندوق العمل المالي' })).toBeNull();
  for (const name of ['المركز المالي', 'ميزان المراجعة', 'دفتر الأستاذ', 'تقارير المالية والأرشيف',
    'الرقابة والميزانيات', 'إقفال الفترة', 'حساب هادي الجاري', 'كشوف الحساب', 'تسوية فترة التأسيس', 'ملخص فترة التأسيس', 'المستندات الضريبية', 'الأصول الثابتة']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  for (const [label, id] of [['المصاريف', 'expenses'], ['تسويات سويتر', 'sweater_settlements'], ['الرواتب ماليًا', 'finance_payroll'], ['الضريبة المستردة', 'vat']]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(select).toHaveBeenLastCalledWith(id);
  }
  const allowedTabIds = groups.flatMap(group => group.tabs.map(tab => tab.id));
  expect(resolveTab('finance_workbench', { allowedTabIds })).toBe('finance_workbench');
  for (const id of ['balance', 'trial', 'ledger', 'finance_reports', 'budgets', 'periods', 'hadi_current', 'bank_statements', 'founding_settlement', 'founding_summary', 'documents', 'assets']) expect(resolveTab(id, { allowedTabIds })).toBe(id);
});

it('retains the unposted document figures without an owner-facing workbench link', () => {
  const { container } = render(<BalanceSheetUnposted ledger={{ entries: [] }} asOf="2026-10-31" feeRules={{}} />);
  expect(container.textContent).toContain('3 مستند');
  expect(container.textContent).toContain('400.00');
  expect(container.textContent).toContain('200.00');
  expect(container.querySelector('a[href*="finance_workbench"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'الرواتب غير المرحلة من قائمة الدخل' }).getAttribute('href')).toBe('?page=finance_payroll');
});
