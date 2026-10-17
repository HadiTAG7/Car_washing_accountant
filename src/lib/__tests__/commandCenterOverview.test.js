import { describe, it, expect } from 'vitest';
import { AGENT_CATALOG, AGENT_TEAMS, RETIRED_AGENT_OWNERS } from '../agentOrganization';
import { assembleCommandCenterSnapshot, assembleAgentOrganization, commandCenterOverview, groupCommandRecords } from '../agentCommandCenter';

const now = Date.parse('2026-10-17T08:00:00Z');
const assemble = raw => assembleCommandCenterSnapshot(raw, { now });

describe('approved roster and honest decision overview', () => {
  it('has unique numbers 0–13, six departments, no retired agents or duplicate CEO', () => {
    expect(AGENT_CATALOG.map(a => a.number)).toEqual(Array.from({ length: 14 }, (_, n) => n));
    expect(new Set(AGENT_CATALOG.map(a => a.id)).size).toBe(14);
    expect(AGENT_CATALOG.filter(a => RETIRED_AGENT_OWNERS[a.id])).toEqual([]);
    const org = assembleAgentOrganization(assemble({}).agents);
    expect(org.agentCount).toBe(14);
    expect(org.unassignedAgents).toEqual([]);
    expect(org.teams.map(team => [team.id, team.agentCount])).toEqual([
      ['finance', 3], ['operations', 1], ['growth', 1], ['quality', 4], ['people', 2], ['technology', 2],
    ]);
    expect(AGENT_TEAMS.flatMap(t => [t.leaderAgentId, ...t.memberAgentIds])).toHaveLength(13);
  });

  it('does not replay a merged role status, result or schedule as its manager', () => {
    const snapshot = assemble({ agents: [{ id: 'sweater-sync', status: 'healthy', lastRunAt: '2026-10-17T07:00:00Z', lastEventAt: '2026-10-17T07:00:00Z' }], reports: [{ id: 'old', agentId: 'sweater-sync', title: 'تاريخي', summary: 'اكتمل سابقًا', reportedAt: '2026-10-17T07:00:00Z' }], approvals: [{ id: 'pending', agentId: 'sweater-sync', status: 'pending', title: 'قرار سابق' }] });
    const manager = snapshot.agents.find(a => a.id === 'operations-manager');
    expect(manager).toMatchObject({ status: 'unknown', connection: 'disconnected', lastRunAt: null, latestReport: null });
    expect(manager.archivedReports).toHaveLength(1);
    const view = commandCenterOverview(snapshot);
    expect(view.results).toHaveLength(0);
    expect(view.decisions[0]).toMatchObject({ ownerId: 'operations-manager', historical: true });
    expect(snapshot.approvals).toHaveLength(1);
  });

  it('groups only identical case records and keeps every original ID', () => {
    const row = { agentId: 'cfo', caseId: 'case-1', title: 'قرار', summary: 'نفس الطلب' };
    const groups = groupCommandRecords([{ ...row, id: 'a' }, { ...row, id: 'b' }, { ...row, id: 'c', agentId: 'tax-compliance' }, { ...row, id: 'd', summary: 'دليل جديد' }, { ...row, id: 'e', caseId: null }], 'approval');
    expect(groups).toHaveLength(4);
    expect(groups[0].records.map(r => r.id)).toEqual(['a', 'b']);
    expect(groupCommandRecords([{ id: 'a', title: 'نفس العنوان' }, { id: 'b', title: 'نفس العنوان' }], 'alert')).toHaveLength(2);
  });

  it('does not resolve open decisions or critical alerts from a completed task', () => {
    const snapshot = assemble({ tasks: [{ id: 'case', agentId: 'cfo', state: 'completed', result: 'تم', occurredAt: '2026-10-17T07:00:00Z' }], approvals: [{ id: 'a', caseId: 'case', agentId: 'cfo', status: 'pending' }], alerts: [{ id: 'n', caseId: 'case', agentId: 'cfo', active: true, severity: 'critical', createdAt: '2026-10-01T00:00:00Z' }] });
    const view = commandCenterOverview(snapshot);
    expect(view.decisions).toHaveLength(1);
    expect(view.critical[0]).toMatchObject({ old: true });
    expect(view.blockers).toHaveLength(0);
    expect(view.completed).toHaveLength(1);
  });

  it('counts Riyadh day boundaries, excludes future/invalid reports, and does not infer completion', () => {
    const view = commandCenterOverview(assemble({ reports: [
      { id: 'r1', agentId: 'cfo', summary: 'مسودة فقط', reportedAt: '2026-10-16T21:01:00Z' },
      { id: 'r2', agentId: 'tax-compliance', reportedAt: '2026-10-16T20:59:00Z' },
      { id: 'r3', agentId: 'operations-manager', reportedAt: '2026-10-18T00:00:00Z' },
      { id: 'r4', agentId: 'growth-manager', reportedAt: 'invalid' },
    ] }));
    expect(view.results.map(a => a.id)).toEqual(['cfo']);
    expect(view.completed).toEqual([]);
  });

  it('does not let a newer completed task hide an unresolved blocker', () => {
    const snapshot = assemble({ tasks: [
      { id: 'done', agentId: 'cfo', state: 'completed', occurredAt: '2026-10-17T07:00:00Z' },
      { id: 'blocked', agentId: 'cfo', state: 'blocked', blocker: 'مستند', occurredAt: '2026-10-16T07:00:00Z' },
    ] });
    expect(snapshot.agents.find(a => a.id === 'cfo').currentTask.id).toBe('blocked');
    expect(commandCenterOverview(snapshot).blockers[0].ownerName).toBe('1: المدير المالي');
  });
});
