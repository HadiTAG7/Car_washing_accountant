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
  it('opens the executive circle as an actionable overview, not a decorative image', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: '0: الرئيس التنفيذي — فتح ملخص اليوم والقرارات' }));
    const drawer = screen.getByRole('dialog', { name: '0: الرئيس التنفيذي' });
    expect(within(drawer).getByRole('heading', { name: 'وش يحتاج انتباهك؟' })).toBeTruthy();
    expect(within(drawer).getByText(/ربط تقاريره المباشر غير مدعوم/)).toBeTruthy();
    expect(within(drawer).getByText('الجدول المعتمد')).toBeTruthy();
  });

  it('keeps closed evidence inspectable without inflating active alerts', () => {
    const snapshot = assembleCommandCenterSnapshot({ closedAlerts: [{ id: 'closed', agentId: 'cfo', title: 'حالة مغلقة', active: false }] });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(snapshot.alerts).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'السجلات المغلقة 1' }));
    expect(screen.getByText('حالة مغلقة')).toBeTruthy();
    expect(screen.getByText(/ليست الأرشيف الكامل/)).toBeTruthy();
  });

  it('groups duplicate case requests while retaining all IDs and distinguishing historical ownership', () => {
    const base = { caseId: 'case', agentId: 'expense-review', title: 'مستند يحتاج قرارًا', summary: 'طلب مكرر', status: 'pending' };
    const snapshot = assembleCommandCenterSnapshot({ approvals: [{ ...base, id: 'a1' }, { ...base, id: 'a2' }] });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    const brief = screen.getByRole('region', { name: 'متابعة اليوم والقرارات' });
    expect(within(brief).getAllByText('مستند يحتاج قرارًا')).toHaveLength(1);
    expect(within(brief).getByText(/سجل دور مدمج، لم يُنقل أو يُغلق/)).toBeTruthy();
    const details = within(brief).getByText(/سجلات متطابقة للحالة نفسها/).closest('details');
    fireEvent.click(within(details).getByText(/سجلات متطابقة للحالة نفسها/));
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('a1');
    expect(details.textContent).toContain('a2');
    expect(snapshot.approvals).toHaveLength(2);
  });

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
    fireEvent.click(screen.getByRole('button', { name: /^4: مدير العمليات —/ }));
    const drawer = screen.getByRole('dialog', { name: '4: مدير العمليات' });
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
    fireEvent.click(screen.getByRole('button', { name: /^4: مدير العمليات —/ }));
    expect(screen.getByText('التشغيل القادم').nextElementSibling.textContent).toBe(formatAgentDate(nextRunAt));
    rerender(<AgentCommandCenterView snapshot={assembleCommandCenterSnapshot(raw, { now: Date.parse(nextRunAt) })} />);
    expect(screen.getByText('التشغيل القادم').nextElementSibling.textContent).toBe('غير متوفر');
    expect(screen.getByText('آخر موعد مُبلّغ (مضى)').nextElementSibling.textContent).toBe(formatAgentDate(nextRunAt));
    expect(raw.agents[0].nextRunAt).toBe(nextRunAt);
  });

  it('returns from a focused department to the readable manager overview', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: /إبراز فريق المالية/ }));
    expect(document.querySelectorAll('.acc-agent--orbit')).toHaveLength(2);
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
    expect(within(summary).getByText('الأدوار المعتمدة')).toBeTruthy();
    expect(within(summary).getByText(/شامل الرئيس التنفيذي/)).toBeTruthy();
    expect(summary.querySelectorAll('.acc-summary-item')).toHaveLength(4);
    expect([...summary.querySelectorAll('.acc-summary-item strong')].map((item) => item.textContent)).toEqual(['14', '0', '0', '0']);
    expect(screen.getByText(/لم تُستلم حالات تشغيل بعد/)).toBeTruthy();
    expect(screen.getByText('لا توجد طلبات موافقة')).toBeTruthy();
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(0);
    expect(container.querySelectorAll('.acc-agent--leader')).toHaveLength(6);
    expect(container.querySelectorAll('.acc-team-node')).toHaveLength(6);
    expect(container.querySelectorAll('.acc-ceo-node')).toHaveLength(1);
    expect(EMPTY_COMMAND_CENTER_SNAPSHOT.summary).toMatchObject({
      healthy: 0, warning: 0, critical: 0, unknown: 14, running: 0,
    });
  });

  it('models CEO and team nodes separately from the fifteen-agent registry', () => {
    const organization = assembleAgentOrganization(EMPTY_COMMAND_CENTER_SNAPSHOT.agents);
    expect(COMMAND_CENTER_ROOT).toMatchObject({ id: 'ceo', name: '0: الرئيس التنفيذي' });
    expect(AGENT_TEAMS).toHaveLength(6);
    expect(organization.agentCount).toBe(14);
    expect(organization.unassignedAgents).toHaveLength(0);
    expect(organization.teams.reduce((total, team) => total + team.agentCount, 0)).toBe(13);
    expect(organization.teams.find((team) => team.id === 'finance')).toMatchObject({
      leader: { id: 'cfo' },
      members: [
        { id: 'expense-capture' },
        { id: 'tax-compliance' },
      ],
    });
    expect(organization.teams.filter((team) => team.leader)).toHaveLength(6);
    expect(organization.teams.map((team) => team.leader.id)).toEqual([
      'cfo', 'operations-manager', 'growth-manager', 'quality-manager', 'hr-manager', 'system-engineering',
    ]);
  });

  it('aggregates live status into the compact summary without filling missing agents', () => {
    const snapshot = assembleCommandCenterSnapshot({
      agents: [
        { id: 'expense-capture', status: 'healthy', isRunning: true, lastEventAt: new Date().toISOString() },
        { id: 'tax-compliance', status: 'warning', lastEventAt: new Date().toISOString() },
        { id: 'cfo', status: 'critical', lastEventAt: new Date().toISOString() },
      ],
    });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(snapshot.summary).toMatchObject({ healthy: 1, warning: 1, critical: 1, unknown: 11, running: 1, connected: 3, stale: 0 });
    const summary = screen.getByRole('region', { name: 'الملخص التنفيذي للوكلاء' });
    expect(within(summary).getByText('3', { selector: '.acc-summary-item:nth-child(2) strong' })).toBeTruthy();
    expect(within(summary).getByText('0', { selector: '.acc-summary-item:nth-child(3) strong' })).toBeTruthy();
  });

  it('switches drawer tabs and keeps an untrusted conversation link hidden', () => {
    const snapshot = assembleCommandCenterSnapshot({
      agents: [{
        id: 'tax-compliance', status: 'warning', lastRunAt: '2026-08-28T08:00:00Z',
        conversationUrl: 'https://evil.example/task/1', sourceIds: ['expense-agent'],
      }],
      reports: [{
        id: 'report-1', agentId: 'tax-compliance', title: 'مراجعة اليوم',
        summary: 'وجد استثناء واحد يحتاج مراجعة.', reportedAt: '2026-08-28T08:05:00Z',
      }],
      alerts: [{
        id: 'alert-1', agentId: 'tax-compliance', title: 'فاتورة ناقصة',
        message: 'رقم الفاتورة غير متوفر.', severity: 'warning', active: true,
        createdAt: '2026-08-28T08:06:00Z',
      }],
    });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق المالية' }));
    fireEvent.click(screen.getAllByRole('button', { name: /3: الضرائب والالتزام/ })[0]);
    const drawer = screen.getByRole('dialog', { name: '3: الضرائب والالتزام' });
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
    const agent = screen.getAllByRole('button', { name: /2: تسجيل المصروفات/ })[0];
    agent.focus();
    fireEvent.keyDown(agent, { key: 'Enter', code: 'Enter' });
    const drawer = screen.getByRole('dialog', { name: '2: تسجيل المصروفات' });
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
    expect(screen.getByRole('button', { name: /0: الرئيس التنفيذي — فتح/ })).toBeTruthy();
    expect(container.querySelectorAll('.acc-map')).toHaveLength(1);
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق المالية' }));
    expect(container.querySelectorAll('.acc-agent--orbit')).toHaveLength(2);
    expect(screen.getByText(/تسجيل ← المدير المالي/)).toBeTruthy();
  });

  it('raises team reports, critical alerts and approvals to its manager while CEO keeps the global view', () => {
    const snapshot = assembleCommandCenterSnapshot({
      reports: [{
        id: 'ops-report', agentId: 'quality-customer-experience', title: 'تقرير المزامنة',
        summary: 'اكتملت المزامنة الفعلية.', reportedAt: '2026-08-28T09:00:00Z',
      }],
      alerts: [
        { id: 'ops-critical', agentId: 'quality-customer-experience', active: true, severity: 'critical', title: 'توقف المزامنة', message: 'تعطل مؤكد.', createdAt: '2026-08-28T09:05:00Z' },
        { id: 'ops-warning', agentId: 'customer-ratings', active: true, severity: 'warning', title: 'تنبيه صيانة', message: 'استحقاق قريب.', createdAt: '2026-08-28T09:04:00Z' },
      ],
      approvals: [{
        id: 'ops-approval', agentId: 'customer-ratings', status: 'pending',
        title: 'قرار صيانة', summary: 'يحتاج موافقة بشرية.', createdAt: '2026-08-28T09:06:00Z',
      }],
    });
    const manager = snapshot.agents.find((agent) => agent.id === 'quality-manager');
    expect(manager.teamReports).toHaveLength(1);
    expect(manager.teamAlerts.map((alert) => alert.id)).toEqual(['ops-critical']);
    expect(manager.teamApprovals).toHaveLength(1);
    expect(snapshot.alerts).toHaveLength(2);
    expect(snapshot.approvals).toHaveLength(1);

    render(<AgentCommandCenterView snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: /6: مدير الجودة —/ }));
    const drawer = screen.getByRole('dialog', { name: '6: مدير الجودة' });
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
        id: 'approval-1', agentId: 'tax-compliance', status: 'pending',
        title: 'اعتماد استثناء', summary: 'يتطلب قرار CEO.', createdAt: '2026-08-28T09:00:00Z',
      }],
      activity: [{
        id: 'activity-1', agentId: 'tax-compliance', kind: 'success',
        message: 'اكتملت المراجعة.', occurredAt: '2026-08-28T09:05:00Z',
      }],
      sources: [{
        id: 'expense-agent', name: 'وكيل المصروفات', status: 'healthy',
        lastCheckedAt: '2026-08-28T09:06:00Z',
      }],
      alerts: [{
        id: 'alert-1', agentId: 'tax-compliance', active: true, severity: 'warning',
        title: 'تنبيه مراجعة', message: 'مستند ناقص.', createdAt: '2026-08-28T09:07:00Z',
      }],
    });
    const { container } = render(<AgentCommandCenterView snapshot={snapshot} />);
    const tabs = screen.getByRole('tablist', { name: 'متابعة التنفيذ' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(6);
    expect(within(screen.getByRole('tabpanel')).getByText('يتطلب قرار CEO.')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).queryByText('اكتملت المراجعة.')).toBeNull();
    expect(container.querySelectorAll('.acc-executive-panel[role="tabpanel"]')).toHaveLength(1);

    fireEvent.click(within(tabs).getByRole('tab', { name: /آخر النشاط/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('اكتملت المراجعة.')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).queryByText('يتطلب قرار CEO.')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: /صحة المصادر/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('وكيل المصروفات')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).queryByText('اكتملت المراجعة.')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: /التنبيهات/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('مستند ناقص.')).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).queryByText('وكيل المصروفات')).toBeNull();
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
    expect(EMPTY_COMMAND_CENTER_SNAPSHOT.agents).toHaveLength(14);
  });

  it('opens and closes details using the explicit drawer control', () => {
    render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: 'إبراز فريق الجودة' }));
    fireEvent.click(screen.getByRole('button', { name: /^8: الشكاوى والإلغاءات —/ }));
    const drawer = screen.getByRole('dialog', { name: '8: الشكاوى والإلغاءات' });
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
      { id: 'tax-compliance', status: 'healthy', lastEventAt: new Date(now).toISOString(), nextRunAt: new Date(now - 3600000).toISOString() },
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
    expect([...summary.querySelectorAll('strong')].map((node) => node.textContent)).toEqual(['14', '—', '—', '—']);
    expect(screen.getByText(/القراءة غير مكتملة؛ لا يمكن تأكيد/)).toBeTruthy();
  });

  it('does not reset drawer focus or tabs when live agent data changes', () => {
    const { rerender } = render(<AgentCommandCenterView snapshot={EMPTY_COMMAND_CENTER_SNAPSHOT} />);
    fireEvent.click(screen.getByRole('button', { name: /^1: المدير المالي —/ }));
    const reportsTab = within(screen.getByRole('dialog')).getByRole('tab', { name: 'التقارير' });
    fireEvent.click(reportsTab);
    reportsTab.focus();
    rerender(<AgentCommandCenterView snapshot={assembleCommandCenterSnapshot({ agents: [{ id: 'cfo', status: 'healthy', lastEventAt: new Date().toISOString() }] })} />);
    expect(document.activeElement).toBe(reportsTab);
    expect(reportsTab.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps all pending decisions visible even beyond six and shows honest manager review', () => {
    const snapshot = assembleCommandCenterSnapshot({ approvals: Array.from({ length: 45 }, (_, index) => ({ id: `a${index}`, agentId: 'quality-customer-experience', title: `طلب ${index}`, summary: 'مراجعة بشرية', status: 'pending' })) });
    render(<AgentCommandCenterView snapshot={snapshot} />);
    expect(screen.getAllByText('طلب 44')[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /4: مدير العمليات —/ }));
    expect(screen.getByText(/تجميع تقارير الفريق لا يثبت أنه راجعها/)).toBeTruthy();
  });

  it('links task ownership, result, blocker, evidence and timeline without executing approval', async () => {
    const snapshot = assembleCommandCenterSnapshot({ tasks: [{ id: 'sync-1', agentId: 'quality-customer-experience', title: 'فحص المزامنة', state: 'waiting-approval', result: 'تأخر فرع واحد', blocker: 'موافقة المدير', nextStep: 'مراجعة الاتصال', evidence: ['https://example.com/evidence'] }], approvals: [{ id: 'a1', caseId: 'sync-1', agentId: 'quality-customer-experience', status: 'pending', title: 'قرار الاتصال', summary: 'للإنسان' }], activity: [{ id: 'history1', caseId: 'sync-1', message: 'وصلت نتيجة الفحص' }] });
    const loadHistory = vi.fn().mockResolvedValue([{ id: 'older', message: 'بدء القضية', occurredAt: '2026-08-28T08:00:00Z' }]);
    render(<AgentCommandCenterView snapshot={snapshot} onLoadCaseHistory={loadHistory} />);
    fireEvent.click(screen.getByRole('tab', { name: /القضايا والمهام/ }));
    expect(screen.getByText(/المسؤول: 8: الشكاوى والإلغاءات/)).toBeTruthy();
    expect(screen.getByText('تأخر فرع واحد')).toBeTruthy();
    expect(screen.getByText('موافقة المدير')).toBeTruthy();
    expect(screen.getByRole('link', { name: /دليل 1/ }).href).toBe('https://example.com/evidence');
    fireEvent.click(screen.getByRole('button', { name: 'تحميل سجل القضية الكامل' }));
    expect(await screen.findByText('بدء القضية')).toBeTruthy();
    expect(loadHistory).toHaveBeenCalledWith('sync-1');
    expect(snapshot.approvals).toHaveLength(1);
  });
});
