// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, within,
} from '@testing-library/react';
import { AgentCommandCenterView } from '../AgentCommandCenterPage';
import {
  AGENT_TEAMS,
  COMMAND_CENTER_ROOT,
  EMPTY_COMMAND_CENTER_SNAPSHOT,
  assembleAgentOrganization,
  assembleCommandCenterSnapshot,
} from '../../lib/agentCommandCenter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Agent command-center view', () => {
  it('exposes every received entry rather than truncating the counts in the tabs', () => {
    const snapshot = {
      ...EMPTY_COMMAND_CENTER_SNAPSHOT,
      approvals: Array.from({ length: 11 }, (_, id) => ({ id: `a${id}`, title: `طلب ${id}` })),
      activity: Array.from({ length: 50 }, (_, id) => ({ id: `e${id}`, message: `نشاط ${id}` })),
      sources: Array.from({ length: 13 }, (_, id) => ({ id: `s${id}`, name: `مصدر ${id}`, status: 'unknown' })),
      alerts: Array.from({ length: 21 }, (_, id) => ({ id: `n${id}`, title: `تنبيه ${id}` })),
    };
    render(<AgentCommandCenterView snapshot={snapshot} />);
    for (const [name, count] of [['الموافقات', 11], ['آخر النشاط', 50], ['صحة المصادر', 13], ['التنبيهات', 21]]) {
      fireEvent.click(screen.getByRole('tab', { name: `${name} ${count}` }));
      expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(count);
    }
  });

  it('renders one compact zero-state summary and all fifteen registered agents', () => {
    const { container } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    const summary = screen.getByRole('region', { name: 'الملخص التنفيذي للوكلاء' });
    expect(within(summary).getByText('الوكلاء')).toBeTruthy();
    expect(within(summary).getByText(/لا يشمل CEO أو الفرق/)).toBeTruthy();
    expect(summary.querySelectorAll('.acc-summary-item')).toHaveLength(4);
    expect([...summary.querySelectorAll('.acc-summary-item strong')].map((item) => item.textContent)).toEqual(['15', '0', '0', '0']);
    expect(screen.getByText(/لم تُستلم حالات تشغيل بعد/)).toBeTruthy();
    expect(screen.getByText('لا توجد طلبات موافقة')).toBeTruthy();
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(10);
    expect(container.querySelectorAll('.acc-team-leader')).toHaveLength(5);
    expect(container.querySelectorAll('.acc-team-node')).toHaveLength(5);
    expect(container.querySelectorAll('.acc-ceo-node')).toHaveLength(1);
    expect(EMPTY_COMMAND_CENTER_SNAPSHOT.summary).toMatchObject({
      healthy: 0, warning: 0, critical: 0, unknown: 15, running: 0,
    });
  });

  it('models CEO and team nodes separately from the fifteen-agent registry', () => {
    const organization = assembleAgentOrganization(EMPTY_COMMAND_CENTER_SNAPSHOT.agents);
    expect(COMMAND_CENTER_ROOT).toMatchObject({ id: 'ceo', name: 'CEO' });
    expect(AGENT_TEAMS).toHaveLength(5);
    expect(organization.agentCount).toBe(15);
    expect(organization.unassignedAgents).toHaveLength(0);
    expect(organization.teams.reduce((total, team) => total + team.agentCount, 0)).toBe(15);
    expect(organization.teams.find((team) => team.id === 'finance')).toMatchObject({
      leader: { id: 'cfo' },
      members: [
        { id: 'expense-capture' },
        { id: 'expense-review' },
        { id: 'accounting-reconciliation' },
        { id: 'tax-compliance' },
      ],
    });
    expect(organization.teams.filter((team) => team.leader)).toHaveLength(5);
    expect(organization.teams.map((team) => team.leader.id)).toEqual([
      'cfo', 'operations-manager', 'growth-manager', 'quality-manager', 'hr-manager',
    ]);
  });

  it('aggregates live status into the compact summary without filling missing agents', () => {
    const snapshot = assembleCommandCenterSnapshot({
      agents: [
        { id: 'expense-capture', status: 'healthy', isRunning: true },
        { id: 'expense-review', status: 'warning' },
        { id: 'accounting-reconciliation', status: 'critical' },
      ],
    });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(snapshot.summary).toEqual({ healthy: 1, warning: 1, critical: 1, unknown: 12, running: 1 });
    const summary = screen.getByRole('region', { name: 'الملخص التنفيذي للوكلاء' });
    expect(within(summary).getByText('1', { selector: '.acc-summary-item:nth-child(2) strong' })).toBeTruthy();
    expect(within(summary).getByText('2', { selector: '.acc-summary-item:nth-child(3) strong' })).toBeTruthy();
  });

  it('switches drawer tabs and keeps an untrusted conversation link hidden', () => {
    const snapshot = assembleCommandCenterSnapshot({
      agents: [{
        id: 'expense-review', status: 'warning', lastRunAt: '2026-08-28T08:00:00Z',
        conversationUrl: 'https://evil.example/task/1', sourceIds: ['expense-agent'],
      }],
      reports: [{
        id: 'report-1', agentId: 'expense-review', title: 'مراجعة اليوم',
        summary: 'وجد استثناء واحد يحتاج مراجعة.', reportedAt: '2026-08-28T08:05:00Z',
      }],
      alerts: [{
        id: 'alert-1', agentId: 'expense-review', title: 'فاتورة ناقصة',
        message: 'رقم الفاتورة غير متوفر.', severity: 'warning', active: true,
        createdAt: '2026-08-28T08:06:00Z',
      }],
    });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    fireEvent.click(screen.getAllByRole('button', { name: /مراجعة المصروفات/ })[0]);
    const drawer = screen.getByRole('dialog', { name: 'مراجعة المصروفات' });
    const tabs = within(drawer).getByRole('tablist', { name: 'تفاصيل الوكيل' });
    expect(within(tabs).getByRole('tab', { name: 'الملخص' }).getAttribute('aria-selected')).toBe('true');
    expect(within(drawer).queryByText('وجد استثناء واحد يحتاج مراجعة.')).toBeNull();
    expect(within(drawer).queryByRole('link', { name: /فتح المحادثة/ })).toBeNull();
    expect(within(drawer).getByText(/غير متوفر أو غير موثوق/)).toBeTruthy();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'التقارير' }));
    expect(within(drawer).getByText('وجد استثناء واحد يحتاج مراجعة.')).toBeTruthy();
    expect(within(drawer).queryByText(/غير متوفر أو غير موثوق/)).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'التنبيهات' }));
    expect(within(drawer).getByText('رقم الفاتورة غير متوفر.')).toBeTruthy();
    expect(within(drawer).queryByText('وجد استثناء واحد يحتاج مراجعة.')).toBeNull();
  });

  it('supports keyboard tabs, traps drawer focus and restores it when closed', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    const agent = screen.getAllByRole('button', { name: /تسجيل المصروفات والفواتير/ })[0];
    agent.focus();
    fireEvent.keyDown(agent, { key: 'Enter', code: 'Enter' });
    const drawer = screen.getByRole('dialog', { name: 'تسجيل المصروفات والفواتير' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('إغلاق لوحة التفاصيل');
    const summaryTab = within(drawer).getByRole('tab', { name: 'الملخص' });
    summaryTab.focus();
    fireEvent.keyDown(summaryTab, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(within(drawer).getByRole('tab', { name: 'التقارير' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(within(drawer).getByRole('tab', { name: 'التقارير' }));
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(agent);
  });

  it('keeps the circular organization map as the only mobile and desktop representation', () => {
    const { container } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    expect(screen.getByTestId('desktop-organization-map')).toBeTruthy();
    expect(screen.queryByTestId('mobile-team-sections')).toBeNull();
    expect(screen.getByRole('img', { name: /CEO، مركز القيادة/ })).toBeTruthy();
    expect(container.querySelectorAll('.acc-map')).toHaveLength(1);
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(10);
    expect(screen.getByText(/تسجيل ← مراجعة ← مطابقة ← CFO ← CEO/)).toBeTruthy();
  });

  it('raises team reports, critical alerts and approvals to its manager while CEO keeps the global view', () => {
    const snapshot = assembleCommandCenterSnapshot({
      reports: [{
        id: 'ops-report', agentId: 'sweater-sync', title: 'تقرير المزامنة',
        summary: 'اكتملت المزامنة الفعلية.', reportedAt: '2026-08-28T09:00:00Z',
      }],
      alerts: [
        { id: 'ops-critical', agentId: 'sweater-sync', active: true, severity: 'critical', title: 'توقف المزامنة', message: 'تعطل مؤكد.', createdAt: '2026-08-28T09:05:00Z' },
        { id: 'ops-warning', agentId: 'assets-maintenance-inventory', active: true, severity: 'warning', title: 'تنبيه صيانة', message: 'استحقاق قريب.', createdAt: '2026-08-28T09:04:00Z' },
      ],
      approvals: [{
        id: 'ops-approval', agentId: 'assets-maintenance-inventory', status: 'pending',
        title: 'قرار صيانة', summary: 'يحتاج موافقة بشرية.', createdAt: '2026-08-28T09:06:00Z',
      }],
    });
    const manager = snapshot.agents.find((agent) => agent.id === 'operations-manager');
    expect(manager.teamReports).toHaveLength(1);
    expect(manager.teamAlerts.map((alert) => alert.id)).toEqual(['ops-critical']);
    expect(manager.teamApprovals).toHaveLength(1);
    expect(snapshot.alerts).toHaveLength(2);
    expect(snapshot.approvals).toHaveLength(1);

    render(<AgentCommandCenterView snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: /فتح تفاصيل مدير العمليات COO/ }));
    const drawer = screen.getByRole('dialog', { name: 'مدير العمليات COO' });
    expect(within(drawer).getByText('يحتاج موافقة بشرية.')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('tab', { name: 'التقارير' }));
    expect(within(drawer).getByText('تقرير المزامنة')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('tab', { name: 'التنبيهات' }));
    expect(within(drawer).getByText('تعطل مؤكد.')).toBeTruthy();
    expect(within(drawer).queryByText('استحقاق قريب.')).toBeNull();
  });

  it('provides zoom, recenter, fullscreen and keyboard pan controls for the same map', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    try {
      render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
      const viewport = screen.getByRole('region', { name: 'خريطة الوكلاء التفاعلية' });
      const scrollTo = vi.fn();
      const scrollBy = vi.fn();
      Object.defineProperties(viewport, {
        clientWidth: { configurable: true, value: 320 },
        clientHeight: { configurable: true, value: 420 },
        scrollWidth: { configurable: true, value: 754 },
        scrollHeight: { configurable: true, value: 508 },
        scrollTo: { configurable: true, value: scrollTo },
        scrollBy: { configurable: true, value: scrollBy },
      });

      expect(viewport.getAttribute('data-zoom')).toBe('0.82');
      fireEvent.click(screen.getByRole('button', { name: 'تكبير الخريطة' }));
      expect(viewport.getAttribute('data-zoom')).toBe('0.94');
      expect(screen.getByLabelText('مستوى التكبير 94 بالمئة').textContent).toBe('94%');
      fireEvent.click(screen.getByRole('button', { name: 'تصغير الخريطة' }));
      expect(viewport.getAttribute('data-zoom')).toBe('0.82');

      fireEvent.click(screen.getByRole('button', { name: 'إعادة تمركز CEO' }));
      expect(scrollTo).toHaveBeenCalledWith({ left: 217, top: 44, behavior: 'smooth' });
      fireEvent.keyDown(viewport, { key: 'ArrowRight', code: 'ArrowRight' });
      expect(scrollBy).toHaveBeenCalledWith({ left: 72, top: 0, behavior: 'smooth' });

      fireEvent.click(screen.getByRole('button', { name: 'عرض الخريطة بملء الشاشة' }));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('mobile-team-sections')).toBeNull();
    } finally {
      delete HTMLElement.prototype.requestFullscreen;
    }
  });

  it('switches executive tabs while showing only one compact panel', () => {
    const snapshot = assembleCommandCenterSnapshot({
      approvals: [{
        id: 'approval-1', agentId: 'expense-review', status: 'pending',
        title: 'اعتماد استثناء', summary: 'يتطلب قرار CEO.', createdAt: '2026-08-28T09:00:00Z',
      }],
      activity: [{
        id: 'activity-1', agentId: 'expense-review', kind: 'success',
        message: 'اكتملت المراجعة.', occurredAt: '2026-08-28T09:05:00Z',
      }],
      sources: [{
        id: 'expense-agent', name: 'وكيل المصروفات', status: 'healthy',
        lastCheckedAt: '2026-08-28T09:06:00Z',
      }],
      alerts: [{
        id: 'alert-1', agentId: 'expense-review', active: true, severity: 'warning',
        title: 'تنبيه مراجعة', message: 'مستند ناقص.', createdAt: '2026-08-28T09:07:00Z',
      }],
    });
    const { container } = render(<AgentCommandCenterView snapshot={snapshot} />);
    const tabs = screen.getByRole('tablist', { name: 'متابعة التنفيذ' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('يتطلب قرار CEO.')).toBeTruthy();
    expect(screen.queryByText('اكتملت المراجعة.')).toBeNull();
    expect(container.querySelectorAll('.acc-executive-panel[role="tabpanel"]')).toHaveLength(1);

    fireEvent.click(within(tabs).getByRole('tab', { name: /آخر النشاط/ }));
    expect(screen.getByText('اكتملت المراجعة.')).toBeTruthy();
    expect(screen.queryByText('يتطلب قرار CEO.')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: /صحة المصادر/ }));
    expect(screen.getByText('وكيل المصروفات')).toBeTruthy();
    expect(screen.queryByText('اكتملت المراجعة.')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: /التنبيهات/ }));
    expect(screen.getByText('مستند ناقص.')).toBeTruthy();
    expect(screen.queryByText('وكيل المصروفات')).toBeNull();
  });

  it('highlights one team and dims unrelated teams without changing agent totals', () => {
    const { container } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    const financeToggle = screen.getByRole('button', { name: 'إبراز فريق المالية' });
    fireEvent.click(financeToggle);
    expect(financeToggle.getAttribute('aria-pressed')).toBe('true');
    expect(financeToggle.closest('.acc-team-node')?.dataset.dimmed).toBe('false');
    expect(screen.getByRole('button', { name: 'إبراز فريق العمليات' })
      .closest('.acc-team-node')?.dataset.dimmed).toBe('true');
    expect(container.querySelectorAll('.acc-agent[data-dimmed="true"]').length).toBeGreaterThan(0);
    expect(EMPTY_COMMAND_CENTER_SNAPSHOT.agents).toHaveLength(15);
  });

  it('opens and closes details using the explicit drawer control', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getAllByRole('button', { name: /الجودة والشكاوى وتجربة العميل/ })[0]);
    const drawer = screen.getByRole('dialog', { name: 'الجودة والشكاوى وتجربة العميل' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'إغلاق لوحة التفاصيل' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks the experience as reduced motion when the user requests it', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const { container } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    expect(container.querySelector('.acc-page')?.dataset.motion).toBe('reduced');
  });
});
