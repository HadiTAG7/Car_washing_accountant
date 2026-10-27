// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ExpensesPage from '../ExpensesPage';
import AccountLabel from '../AccountLabel';
import FinanceMonthComparison from '../FinanceMonthComparison';
import { accountDisplayLabel } from '../../lib/accountDisplay';
import { EXPENSE_TAB_IDS, TAB_GROUPS, visibleGroupsFor, resolveTab } from '../../lib/navGroups';

const mock = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('../../hooks/useOverviewDashboard', () => ({ useOverviewDashboard: (...args) => mock.overview(...args) }));
vi.mock('../TopBar', () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock('../StartupPage', () => ({ default: () => <p>startup fixture</p> }));
vi.mock('../AnnualExpensesPage', () => ({ default: () => <p>annual fixture</p> }));
vi.mock('../MonthlyExpensesPage', () => ({ default: () => <p>monthly fixture</p> }));
vi.mock('../VariableExpensesPage', () => ({ default: () => <p>variable fixture</p> }));
vi.mock('../TemporaryExpensesPage', () => ({ default: () => <p>temporary_expenses fixture</p> }));
vi.mock('../AdministrationExpensesPage', () => ({ default: () => <p>temporary_expenses fixture</p> }));
afterEach(cleanup);

describe('finance presentation without new financial calculations or writes', () => {
  it('orders owner navigation and the three finance sections, retaining legacy role checks', () => {
    expect(TAB_GROUPS.map(group => group.id)).toEqual(['top', 'finance', 'partners', 'management', 'ops', 'sweater']);
    expect(TAB_GROUPS[0].tabs.map(tab => tab.id)).toEqual(['overview', 'executive_reports']);
    expect(TAB_GROUPS[3].tabs.map(tab => tab.id)).toEqual(['growth_performance', 'agent_command_center']);
    const finance = TAB_GROUPS[1];
    expect(finance.sections.map(section => section.title)).toEqual(['الإدخال اليومي', 'القوائم', 'الضريبة والإقفال']);
    expect(finance.sections.flatMap(section => section.tabIds)).toHaveLength(15);
    expect(finance.tabs.filter(tab => !tab.hidden).map(tab => tab.id)).not.toContain('annual');
    const adminIds = visibleGroupsFor({ role: 'admin' }).flatMap(group => group.tabs.map(tab => tab.id));
    for (const id of EXPENSE_TAB_IDS) expect(resolveTab(id, { allowedTabIds: adminIds })).toBe(id);
    const partnerIds = visibleGroupsFor({ role: 'partner', isPartnerView: true }).flatMap(group => group.tabs.map(tab => tab.id));
    expect(resolveTab('expenses', { investorMode: true, allowedTabIds: partnerIds })).toBe('investor');
  });
  it.each(EXPENSE_TAB_IDS)('opens the correct expense tab for legacy URL page=%s and only mounts its screen', async id => {
    render(<ExpensesPage activeTab={id} onNavigate={vi.fn()} />);
    expect(await screen.findByText(`${id} fixture`)).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tab', { selected: true }).id).toBe(`expense-tab-${id}`);
    expect(screen.queryAllByText(/fixture$/)).toHaveLength(1);
  });
  it('switches expense tabs by keyboard with focus and no write path', async () => {
    function Harness() { const [tab, setTab] = useState('expenses'); return <ExpensesPage activeTab={tab} onNavigate={setTab} />; }
    render(<Harness />); await screen.findByText('startup fixture');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'التأسيس' }), { key: 'ArrowLeft' });
    expect(await screen.findByText('annual fixture')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'السنوية' }));
  });
  it('shows only partner names without mutating the source account or its export values', () => {
    const account = Object.freeze({ code: '3000-3f10df4e-f356-4468-80cc-62a7859e4087', nameArabic: 'رأس مال — محمد الغمغام' });
    const before = JSON.stringify(account);
    const view = render(<AccountLabel account={account} />);
    expect(view.container.textContent).toBe('محمد الغمغام');
    expect(accountDisplayLabel(account)).toBe('محمد الغمغام');
    expect(JSON.stringify(account)).toBe(before);
    expect(accountDisplayLabel({ code: '1010', nameArabic: 'الصندوق' })).toBe('الصندوق — 1010');
  });
  it('compares the selected month using the exact overview statement, without combining balances', () => {
    mock.overview.mockReturnValue({ finance: { statement: { netRevenue: 7640, totalCosts: 30036.57 }, loading: false } });
    const income = Object.freeze({ totalRevenue: 0, totalCost: 20839.83, totalExpenses: 0 });
    render(<FinanceMonthComparison month="2026-10" income={income} />);
    expect(mock.overview).toHaveBeenCalledWith('2026-10', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    const rows = screen.getAllByRole('row');
    expect(rows[1].textContent).toContain('7,640.00'); expect(rows[2].textContent).toContain('30,036.57');
    expect(rows[2].textContent).toContain('20,839.83');
  });
  it('does not turn an unavailable operational reading into zero', () => {
    mock.overview.mockReturnValue({ finance: { statement: null, loading: false, error: 'offline' } });
    render(<FinanceMonthComparison month="2026-09" income={{ totalRevenue: 80, totalCost: 20, totalExpenses: 0 }} />);
    expect(screen.getAllByText('غير متاح')).toHaveLength(2);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
