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
  formatAgentDate,
} from '../../lib/agentCommandCenter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Agent command-center view', () => {
  it.each([
    ['past', '2026-08-30T04:30:00Z', false, true],
    ['future', '2026-10-11T04:30:00Z', true, false],
    ['missing', null, false, false],
    ['invalid', 'not-a-date', false, false],
    ['at observation time', '2026-10-10T08:10:00Z', false, true],
  ])('does not present a %s schedule as an upcoming run', (_case, nextRunAt, future, previous) => {
    const now = Date.parse('2026-10-10T08:10:00Z');
    const lastRunAt = '2026-10-05T05:48:00Z';
    const snapshot = assembleCommandCenterSnapshot({ agents: [{
      id: 'operations-manager', lastRunAt, nextRunAt,
    }] }, { now });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: /^مدير العمليات COO —/ }));
    const drawer = screen.getByRole('dialog', { name: 'مدير العمليات COO' });
    const upcoming = within(drawer).getByText('التشغيل القادم').nextElementSibling;
    expect(upcoming.textContent).toBe(future ? formatAgentDate(nextRunAt) : 'غير متوفر');
    expect(within(drawer).getByText('آخر تشغيل').nextElementSibling.textContent).toBe(formatAgentDate(lastRunAt));
    if (previous) {
      expect(within(drawer).getByText('آخر موعد مُبلّغ (مضى)').nextElementSibling.textContent).toBe(formatAgentDate(nextRunAt));
    } else {
      expect(within(drawer).queryByText('آخر موعد مُبلّغ (مضى)')).toBeNull();
    }
    // Presentation must not mutate the received schedule or connection state.
    expect(snapshot.agents.find(agent => agent.id === 'operations-manager').nextRunAt)
      .toBe(future || previous ? new Date(nextRunAt).toISOString() : null);
  });

  it('reclassifies a received next-run date as time advances without changing its source', () => {
    const nextRunAt = '2026-10-10T08:10:00Z';
    const raw = { agents: [{ id: 'operations-manager', nextRunAt }] };
    const { rerender } = render(<AgentCommandCenterView snapshot={assembleCommandCenterSnapshot(raw, { now: Date.parse(nextRunAt) - 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /^مدير العمليات COO —/ }));
    expect(screen.getByText('التشغيل القادم').nextElementSibling.textContent).toBe(formatAgentDate(nextRunAt));
    rerender(<AgentCommandCenterView snapshot={assembleCommandCenterSnapshot(raw, { now: Date.parse(nextRunAt) })} />);
    expect(screen.getByText('التشغيل القادم').nextElementSibling.textContent).toBe('غير متوفر');
    expect(screen.getByText('آخر موعد مُبلّغ (مضى)').nextElementSibling.textContent).toBe(formatAgentDate(nextRunAt));
    expect(raw.agents[0].nextRunAt).toBe(nextRunAt);
  });

  it('returns from a focused department to the readable manager overview', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: /إبراز فريق المالية/ }));
    expect(document.querySelectorAll('.acc-agent--orbit')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'عرض الأقسام الرئيسية' }));
    expect(document.querySelectorAll('.acc-agent--orbit')).toHaveLength(0);
    expect(screen.getByTestId('agent-map-viewport').getAttribute('data-zoom')).toBe('0.82');
  });
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
    expect(within(summary).getByText('مسجّلون')).toBeTruthy();
    expect(within(summary).getByText(/لا يشمل CEO أو الفرق/)).toBeTruthy();
    expect(summary.querySelectorAll('.acc-summary-item')).toHaveLength(4);
    expect([...summary.querySelectorAll('.acc-summary-item strong')].map((item) => item.textContent)).toEqual(['15', '0', '0', '0']);
    expect(screen.getByText(/لم تُستلم حالات تشغيل بعد/)).toBeTruthy();
    expect(screen.getByText('لا توجد طلبات موافقة')).toBeTruthy();
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(0);
    expect(container.querySelectorAll('.acc-agent--leader')).toHaveLength(5);
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
        { id: 'expense-capture', status: 'healthy', isRunning: true, lastEventAt: new Date().toISOString() },
        { id: 'expense-review', status: 'warning', lastEventAt: new Date().toISOString() },
        { id: 'accounting-reconciliation', status: 'critical', lastEventAt: new Date().toISOString() },
      ],
    });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(snapshot.summary).toMatchObject({ healthy: 1, warning: 1, critical: 1, unknown: 12, running: 1, connected: 3, stale: 0 });
    const summary = screen.getByRole('region', { name: 'الملخص التنفيذي للوكلاء' });
    expect(within(summary).getByText('3', { selector: '.acc-summary-item:nth-child(2) strong' })).toBeTruthy();
    expect(within(summary).getByText('0', { selector: '.acc-summary-item:nth-child(3) strong' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق المالية' }));
    fireEvent.click(screen.getAllByRole('button', { name: /مراجعة المصروفات/ })[0]);
    const drawer = screen.getByRole('dialog', { name: 'مراجعة المصروفات' });
    const tabs = within(drawer).getByRole('tablist', { name: 'تفاصيل الوكيل' });
    expect(within(tabs).getByRole('tab', { name: 'الملخص' }).getAttribute('aria-selected')).toBe('true');
    expect(within(drawer).getByText('وجد استثناء واحد يحتاج مراجعة.')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق المالية' }));
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
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق المالية' }));
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(4);
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
    fireEvent.click(screen.getByRole('button', { name: /مدير العمليات COO —/ }));
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

      expect(viewport.getAttribute('data-zoom')).toBe('1.00');
      fireEvent.click(screen.getByRole('button', { name: 'تكبير الخريطة' }));
      expect(viewport.getAttribute('data-zoom')).toBe('1.12');
      expect(screen.getByLabelText('مستوى التكبير 112 بالمئة').textContent).toBe('112%');
      fireEvent.click(screen.getByRole('button', { name: 'تصغير الخريطة' }));
      expect(viewport.getAttribute('data-zoom')).toBe('1.00');

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
    expect(within(tabs).getAllByRole('tab')).toHaveLength(5);
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
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق الجودة وتجربة العميل' }));
    fireEvent.click(screen.getByRole('button', { name: /^الجودة والشكاوى وتجربة العميل —/ }));
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

  it('does not treat old healthy or running state as a live connection', () => {
    const now = Date.UTC(2026, 9, 2, 12);
    const snapshot = assembleCommandCenterSnapshot({ agents: [
      { id: 'cfo', status: 'healthy', isRunning: true, lastEventAt: new Date(now - 3600000).toISOString() },
      { id: 'expense-capture', status: 'healthy' },
      { id: 'expense-review', status: 'healthy', lastEventAt: new Date(now).toISOString(), nextRunAt: new Date(now - 3600000).toISOString() },
    ] }, { now });
    expect(snapshot.agents.find((agent) => agent.id === 'cfo')).toMatchObject({ status: 'unknown', isRunning: false, connection: 'stale', reportedStatus: 'healthy' });
    expect(snapshot.agents.find((agent) => agent.id === 'expense-capture').connection).toBe('unverified');
    expect(snapshot.summary).toMatchObject({ connected: 1, stale: 1, running: 0 });
  });

  it('does not let a fresh report renew old health or running assertions', () => {
    const now = Date.UTC(2026, 9, 2, 12);
    const snapshot = assembleCommandCenterSnapshot({ agents: [{ id: 'cfo', status: 'healthy', isRunning: true, lastEventAt: new Date(now).toISOString(), runningReportedAt: new Date(now - 3600000).toISOString(), statusReportedAt: new Date(now - 2 * 86400000).toISOString() }] }, { now });
    expect(snapshot.agents.find((agent) => agent.id === 'cfo')).toMatchObject({ connection: 'connected', status: 'unknown', isRunning: false });
  });

  it('does not show failed or partial reads as confirmed zero counters', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} error={new Error('failed')} />);
    const summary = screen.getByRole('region', { name: 'الملخص التنفيذي للوكلاء' });
    expect([...summary.querySelectorAll('strong')].map((node) => node.textContent)).toEqual(['15', '—', '—', '—']);
    expect(screen.getByText(/القراءة غير مكتملة؛ لا تعتمد الأعداد الحالية/)).toBeTruthy();
  });

  it('does not reset drawer focus or tabs when live agent data changes', () => {
    const { rerender } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: /^المدير المالي CFO —/ }));
    const reportsTab = within(screen.getByRole('dialog')).getByRole('tab', { name: 'التقارير' });
    fireEvent.click(reportsTab);
    reportsTab.focus();
    rerender(<AgentCommandCenterView snapshot={assembleCommandCenterSnapshot({ agents: [{ id: 'cfo', status: 'healthy', lastEventAt: new Date().toISOString() }] })} />);
    expect(document.activeElement).toBe(reportsTab);
    expect(reportsTab.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps all pending decisions visible even beyond six and shows honest manager review', () => {
    const snapshot = assembleCommandCenterSnapshot({ approvals: Array.from({ length: 45 }, (_, index) => ({ id: `a${index}`, agentId: 'sweater-sync', title: `طلب ${index}`, summary: 'مراجعة بشرية', status: 'pending' })) });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(screen.getByText('طلب 44')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /مدير العمليات COO —/ }));
    expect(screen.getByText(/تجميع تقارير الفريق لا يثبت أنه راجعها/)).toBeTruthy();
  });

  it('links task ownership, result, blocker, evidence and timeline without executing approval', async () => {
    const snapshot = assembleCommandCenterSnapshot({ tasks: [{ id: 'sync-1', agentId: 'sweater-sync', title: 'فحص المزامنة', state: 'waiting-approval', result: 'تأخر فرع واحد', blocker: 'موافقة المدير', nextStep: 'مراجعة الاتصال', evidence: ['https://example.com/evidence'] }], approvals: [{ id: 'a1', caseId: 'sync-1', agentId: 'sweater-sync', status: 'pending', title: 'قرار الاتصال', summary: 'للإنسان' }], activity: [{ id: 'history1', caseId: 'sync-1', message: 'وصلت نتيجة الفحص' }] });
    const loadHistory = vi.fn().mockResolvedValue([{ id: 'older', message: 'بدء القضية', occurredAt: '2026-08-28T08:00:00Z' }]);
    render(<AgentCommandCenterView snapshot={snapshot} onLoadCaseHistory={loadHistory} />);
    fireEvent.click(screen.getByRole('tab', { name: /القضايا والمهام/ }));
    expect(screen.getByText(/المسؤول: مزامنة عمليات سويتر/)).toBeTruthy();
    expect(screen.getByText('تأخر فرع واحد')).toBeTruthy();
    expect(screen.getByText('موافقة المدير')).toBeTruthy();
    expect(screen.getByRole('link', { name: /دليل 1/ }).href).toBe('https://example.com/evidence');
    fireEvent.click(screen.getByRole('button', { name: 'تحميل سجل القضية الكامل' }));
    expect(await screen.findByText('بدء القضية')).toBeTruthy();
    expect(loadHistory).toHaveBeenCalledWith('sync-1');
    expect(snapshot.approvals).toHaveLength(1);
  });
});
