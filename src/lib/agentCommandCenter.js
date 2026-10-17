import { getLocale } from '../i18n/locale';
import { AGENT_CATALOG, AGENT_TEAMS, COMMAND_CENTER_ROOT, RETIRED_AGENT_OWNERS } from './agentOrganization';
export { AGENT_CATALOG, AGENT_TEAMS, COMMAND_CENTER_ROOT, WORKFLOW_AGENT_IDS } from './agentOrganization';
export const COMMAND_CENTER_ROLES = Object.freeze(['admin', 'accountant']);
export const AGENT_STATUS = Object.freeze({
  healthy: { label: 'سليم', shortLabel: 'سليم' },
  warning: { label: 'يحتاج انتباهًا', shortLabel: 'تنبيه' },
  critical: { label: 'حالة حرجة', shortLabel: 'حرج' },
  unknown: { label: 'لا توجد حالة', shortLabel: 'غير معروف' },
});

const TEAM_BY_AGENT_ID = new Map();
for (const team of AGENT_TEAMS) {
  if (team.leaderAgentId) TEAM_BY_AGENT_ID.set(team.leaderAgentId, team);
  for (const agentId of team.memberAgentIds) TEAM_BY_AGENT_ID.set(agentId, team);
}

export function assembleAgentOrganization(agents = []) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const assignedAgentIds = new Set(['ceo']);
  const teams = AGENT_TEAMS.map((team) => {
    const leader = team.leaderAgentId ? agentsById.get(team.leaderAgentId) || null : null;
    if (leader) assignedAgentIds.add(leader.id);
    const members = team.memberAgentIds.map((id) => agentsById.get(id)).filter(Boolean);
    for (const member of members) assignedAgentIds.add(member.id);
    return { ...team, leader, members, agentCount: members.length + (leader ? 1 : 0) };
  });
  return {
    root: { ...COMMAND_CENTER_ROOT, agent: agentsById.get('ceo') || null },
    teams,
    unassignedAgents: agents.filter((agent) => !assignedAgentIds.has(agent.id)),
    agentCount: agents.length,
  };
}

const VALID_STATUSES = new Set(Object.keys(AGENT_STATUS));
export const TASK_STATE_LABELS = Object.freeze({ queued: 'في الانتظار', running: 'قيد العمل', blocked: 'متعثر', 'waiting-approval': 'بانتظار موافقة', completed: 'مكتمل' });
export const CONNECTION_LABELS = Object.freeze({ connected: 'تحديث مستلم حديثًا', stale: 'تحديث المركز قديم', unverified: 'وقت التحديث غير موثق', disconnected: 'لم تصل حالة للمركز' });
const TRUSTED_CONVERSATION_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export function toIsoTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function trustedConversationUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return TRUSTED_CONVERSATION_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  return {
    ...row,
    occurredAt: toIsoTimestamp(row.occurredAt),
    receivedAt: toIsoTimestamp(row.receivedAt),
    reportedAt: toIsoTimestamp(row.reportedAt),
    createdAt: toIsoTimestamp(row.createdAt),
    lastRunAt: toIsoTimestamp(row.lastRunAt),
    nextRunAt: toIsoTimestamp(row.nextRunAt),
    lastReportAt: toIsoTimestamp(row.lastReportAt),
    lastCheckedAt: toIsoTimestamp(row.lastCheckedAt),
    dueAt: toIsoTimestamp(row.dueAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    lastEventAt: toIsoTimestamp(row.lastEventAt),
    runningReportedAt: toIsoTimestamp(row.runningReportedAt),
    statusReportedAt: toIsoTimestamp(row.statusReportedAt),
  };
}

function newestFirst(rows, key) {
  return [...rows].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')));
}

export function assembleCommandCenterSnapshot(raw = {}, { now = Date.now() } = {}) {
  const liveAgents = new Map((raw.agents || []).map((row) => [row.id || row.agentId, normalizeRow(row)]));
  const reports = newestFirst((raw.reports || []).map(normalizeRow), 'reportedAt');
  const alerts = newestFirst((raw.alerts || []).map(normalizeRow).filter((row) => row.active !== false), 'createdAt');
  const closedAlerts = newestFirst((raw.closedAlerts || []).map(normalizeRow).filter(row => row.active === false), 'createdAt');
  const approvals = newestFirst((raw.approvals || []).map(normalizeRow).filter((row) => row.status === 'pending'), 'createdAt');
  const sources = (raw.sources || []).map(normalizeRow).map((source) => ({
    ...source,
    reportedStatus: source.status,
    status: source.lastCheckedAt && now - new Date(source.lastCheckedAt).getTime() >= -300000 && now - new Date(source.lastCheckedAt).getTime() <= 86400000 ? source.status : 'unknown',
  }));
  const sourcesById = new Map(sources.map((row) => [row.id, row]));
  const activity = newestFirst((raw.activity || []).map(normalizeRow), 'occurredAt');
  const tasks = newestFirst((raw.tasks || []).map(normalizeRow), 'occurredAt').map((task) => ({
    ...task,
    ownerName: AGENT_CATALOG.find((agent) => agent.id === task.agentId)?.name
      || (RETIRED_AGENT_OWNERS[task.agentId] ? `${AGENT_CATALOG.find(agent => agent.id === RETIRED_AGENT_OWNERS[task.agentId])?.name} · سجل دور مدمج (${task.agentId})` : 'غير معروف'),
    timeline: activity.filter((item) => item.caseId === task.id),
    reports: reports.filter((item) => item.caseId === task.id),
    alerts: alerts.filter((item) => item.caseId === task.id),
    approvals: approvals.filter((item) => item.caseId === task.id),
  }));

  const agents = AGENT_CATALOG.map((catalog) => {
    const live = liveAgents.get(catalog.id) || {};
    const agentReports = reports.filter((row) => row.agentId === catalog.id);
    const agentAlerts = alerts.filter((row) => row.agentId === catalog.id);
    const agentApprovals = approvals.filter((row) => row.agentId === catalog.id);
    const lastSeen = live.lastEventAt || live.updatedAt;
    const age = lastSeen ? now - new Date(lastSeen).getTime() : null;
    const freshnessSeconds = live.freshnessSeconds || (live.isRunning ? 900 : 86400);
    const overdue = live.nextRunAt && now > new Date(live.nextRunAt).getTime() + 900000
      && (!lastSeen || new Date(lastSeen) < new Date(live.nextRunAt));
    const connection = !liveAgents.has(catalog.id) ? 'disconnected'
      : age === null || age < -300000 ? 'unverified'
        : age > freshnessSeconds * 1000 || overdue ? 'stale' : 'connected';
    const ownTasks = tasks.filter((task) => task.agentId === catalog.id);
    const currentTask = ownTasks.find((task) => task.id === live.currentCaseId)
      || ownTasks.find((task) => task.state !== 'completed') || ownTasks[0] || null;
    const statusAge = now - new Date(live.statusReportedAt || lastSeen).getTime();
    const runningAge = now - new Date(live.runningReportedAt || lastSeen).getTime();
    const sourceIds = new Set([...(live.sourceIds || []), ...catalog.expectedSources.map((item) => item.id)]);
    const dataSources = [...sourceIds].map((id) => {
      const received = sourcesById.get(id);
      const expected = catalog.expectedSources.find((item) => item.id === id);
      return received
        ? { ...received, name: received.name || expected?.name || id }
        : { id, name: expected?.name || id, status: 'unknown', lastCheckedAt: null, details: null };
    });
    const cachedReport = live.lastReportSummary ? {
      id: live.lastReportId || null,
      title: live.lastReportTitle || 'آخر تقرير',
      summary: live.lastReportSummary,
      reportedAt: live.lastReportAt,
      review: live.lastReportReview,
      senderId: live.lastReportSenderId,
    } : null;
    const latestReport = cachedReport && (!agentReports[0] || cachedReport.reportedAt > agentReports[0].reportedAt) ? cachedReport : agentReports[0] || cachedReport;

    return {
      ...catalog,
      teamId: TEAM_BY_AGENT_ID.get(catalog.id)?.id || null,
      teamName: TEAM_BY_AGENT_ID.get(catalog.id)?.name || null,
      isTeamLeader: TEAM_BY_AGENT_ID.get(catalog.id)?.leaderAgentId === catalog.id,
      status: connection === 'connected' && statusAge <= freshnessSeconds * 1000 && VALID_STATUSES.has(live.status) ? live.status : 'unknown',
      reportedStatus: live.status || 'unknown',
      isRunning: connection === 'connected' && live.isRunning === true && runningAge <= 900000 && (!currentTask || currentTask.state === 'running'),
      connection,
      lastSeen,
      currentTask,
      tasks: ownTasks,
      managerReview: latestReport?.review ? { ...latestReport.review, reportedAt: latestReport.reportedAt, senderId: latestReport.senderId } : null,
      lastRunAt: live.lastRunAt || null,
      nextRunAt: live.nextRunAt || null,
      lastEventAt: live.lastEventAt ? toIsoTimestamp(live.lastEventAt) : null,
      latestReport,
      reports: agentReports,
      alerts: agentAlerts,
      closedAlerts: closedAlerts.filter(row => row.agentId === catalog.id),
      approvals: agentApprovals,
      dataSources,
      conversationUrl: trustedConversationUrl(live.conversationUrl),
      hasLiveState: Boolean(live.id || live.agentId),
      teamReports: [],
      teamAlerts: [],
      teamApprovals: [],
      archivedReports: reports.filter(row => RETIRED_AGENT_OWNERS[row.agentId] === catalog.id),
      archivedAlerts: alerts.filter(row => RETIRED_AGENT_OWNERS[row.agentId] === catalog.id),
      archivedApprovals: approvals.filter(row => RETIRED_AGENT_OWNERS[row.agentId] === catalog.id),
      archivedTasks: tasks.filter(row => RETIRED_AGENT_OWNERS[row.agentId] === catalog.id),
    };
  });

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentsWithTeamEscalations = agents.map((agent) => {
    const team = TEAM_BY_AGENT_ID.get(agent.id);
    if (!team || team.leaderAgentId !== agent.id) return agent;
    const members = team.memberAgentIds.map((id) => agentById.get(id)).filter(Boolean);
    return {
      ...agent,
      teamReports: newestFirst(members.flatMap((member) => member.reports.map((report) => ({
        ...report, sourceAgentId: member.id, sourceAgentName: member.name,
      }))), 'reportedAt'),
      teamAlerts: newestFirst(members.flatMap((member) => member.alerts
        .filter((alert) => alert.severity === 'critical')
        .map((alert) => ({
          ...alert, sourceAgentId: member.id, sourceAgentName: member.name,
        }))), 'createdAt'),
      teamApprovals: newestFirst(members.flatMap((member) => member.approvals.map((approval) => ({
        ...approval, sourceAgentId: member.id, sourceAgentName: member.name,
      }))), 'createdAt'),
    };
  });

  const summary = agentsWithTeamEscalations.reduce((acc, agent) => {
    acc[agent.status] += 1;
    if (agent.isRunning) acc.running += 1;
    if (agent.connection === 'connected') acc.connected += 1;
    if (agent.connection === 'stale') acc.stale += 1;
    if (agent.currentTask?.state === 'waiting-approval') acc.waitingApproval += 1;
    return acc;
  }, { healthy: 0, warning: 0, critical: 0, unknown: 0, running: 0, connected: 0, stale: 0, waitingApproval: 0 });

  return {
    agents: agentsWithTeamEscalations,
    reports,
    alerts,
    closedAlerts,
    approvals,
    sources,
    activity,
    tasks,
    observedAt: new Date(now).toISOString(),
    summary,
    hasLiveData: [raw.agents, raw.reports, raw.alerts, raw.approvals, raw.sources, raw.activity, raw.tasks]
      .some((rows) => Array.isArray(rows) && rows.length > 0),
  };
}

export const EMPTY_COMMAND_CENTER_SNAPSHOT = assembleCommandCenterSnapshot();

export function formatAgentDate(value) {
  if (!value) return 'غير متوفر';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير متوفر';
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'Asia/Riyadh',
  }).format(date);
}

export function agentWorkLabel(agent) {
  if (agent.currentTask) return `${TASK_STATE_LABELS[agent.currentTask.state] || 'حالة غير موثقة'}: ${agent.currentTask.result || agent.currentTask.title}`;
  return agent.latestReport?.summary || 'لم تصل نتيجة؛ لا يمكن تأكيد الإنجاز';
}

// Group only identical records of the same case and original owner. Repeated
// IDs remain inspectable. A completed task does NOT resolve an approval/alert.
export function groupCommandRecords(rows = [], kind) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = row.caseId && row.agentId
      ? JSON.stringify([row.caseId, row.agentId, row.title, row.summary || row.message, row.severity, row.dueAt])
      : `${row.id || 'row'}-${index}`;
    const group = groups.get(key);
    if (group) group.records.push(row);
    else groups.set(key, { ...row, kind, records: [row] });
  });
  return [...groups.values()];
}

export function commandCenterOverview(snapshot) {
  const catalog = new Map(snapshot.agents.map(agent => [agent.id, agent]));
  const owner = row => catalog.get(row.agentId) || catalog.get(RETIRED_AGENT_OWNERS[row.agentId]);
  const decisions = groupCommandRecords(snapshot.approvals, 'approval');
  const alerts = groupCommandRecords(snapshot.alerts, 'alert');
  const openTasks = snapshot.tasks.filter(task => task.state !== 'completed');
  const blockers = openTasks.filter(task => task.state === 'blocked');
  const observed = Date.parse(snapshot.observedAt);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(observed);
  const isToday = value => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= observed
    && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(value)) === today;
  const results = snapshot.agents.filter(agent => isToday(agent.latestReport?.reportedAt));
  const enrich = row => ({ ...row, ownerName: owner(row)?.name || 'المالك غير موثق',
    ownerId: owner(row)?.id || null, historical: Boolean(RETIRED_AGENT_OWNERS[row.agentId]),
    old: !isToday(row.createdAt || row.occurredAt) });
  return {
    decisions: decisions.map(enrich), alerts: alerts.map(enrich),
    blockers: blockers.map(enrich), openTasks, results,
    completed: snapshot.tasks.filter(task => task.state === 'completed' && isToday(task.occurredAt)),
    // Severity is a received classification, not proof of urgency or freshness.
    critical: alerts.filter(alert => alert.severity === 'critical').map(enrich),
  };
}
