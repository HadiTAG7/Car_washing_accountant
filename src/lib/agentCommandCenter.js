export const COMMAND_CENTER_ROLES = Object.freeze(['admin', 'accountant']);

export const AGENT_STATUS = Object.freeze({
  healthy: { label: 'سليم', shortLabel: 'سليم' },
  warning: { label: 'يحتاج انتباهًا', shortLabel: 'تنبيه' },
  critical: { label: 'حالة حرجة', shortLabel: 'حرج' },
  unknown: { label: 'لا توجد حالة', shortLabel: 'غير معروف' },
});

export const AGENT_CATALOG = Object.freeze([
  {
    id: 'expense-capture',
    name: 'تسجيل المصروفات والفواتير',
    shortName: 'تسجيل المصروفات',
    role: 'استقبال مستندات المصروف وتجهيز مسودة قابلة للمراجعة دون اعتمادها أو ترحيلها.',
    permissions: ['قراءة مصادر الفواتير المصرّح بها', 'إنشاء تقرير أو تنبيه عبر المدخل الموقّع فقط', 'لا يرحّل قيودًا ولا يعتمد مصروفًا'],
    expectedSources: [{ id: 'google-drive', name: 'Google Drive' }, { id: 'expense-agent', name: 'وكيل المصروفات' }],
    icon: 'receipt', point: { x: 50, y: 8 }, workflowOrder: 1,
  },
  {
    id: 'expense-review',
    name: 'مراجعة المصروفات',
    shortName: 'مراجعة المصروفات',
    role: 'فحص اكتمال الأدلة والتكرار والتصنيف، ورفع الاستثناءات للمراجعة البشرية.',
    permissions: ['قراءة مسودات المصروفات', 'إصدار تنبيه أو طلب موافقة', 'لا يعتمد ولا يعدّل السجل المحاسبي'],
    expectedSources: [{ id: 'expense-agent', name: 'وكيل المصروفات' }],
    icon: 'clipboard', point: { x: 76, y: 18 }, workflowOrder: 2,
  },
  {
    id: 'accounting-reconciliation',
    name: 'الترحيل والمطابقة المحاسبية',
    shortName: 'الترحيل والمطابقة',
    role: 'مراقبة نتائج الترحيل والمطابقة والإبلاغ عن الفروقات؛ التنفيذ الفعلي يبقى في وظائف الدفتر الموثوقة.',
    permissions: ['قراءة نتائج الدفتر والمطابقة', 'رفع تقرير فروقات', 'لا يكتب في الدفتر من مركز القيادة'],
    expectedSources: [{ id: 'firestore-ledger', name: 'دفتر Firestore' }],
    icon: 'scale', point: { x: 91, y: 42 }, workflowOrder: 3,
  },
  {
    id: 'sweater-sync',
    name: 'مزامنة عمليات سويتر',
    shortName: 'مزامنة سويتر',
    role: 'مراقبة وصول العمليات التشغيلية وتوقيت آخر مزامنة دون تغيير السجلات من هذه الصفحة.',
    permissions: ['قراءة حالة التكامل', 'رفع حالة المصدر والتنبيهات', 'لا يكتب عمليات تشغيلية مباشرة'],
    expectedSources: [{ id: 'sweater-operations', name: 'عمليات سويتر' }],
    icon: 'refresh', point: { x: 88, y: 69 },
  },
  {
    id: 'cfo',
    name: 'المدير المالي CFO',
    shortName: 'المدير المالي CFO',
    role: 'قيادة فريق المالية وتجميع تقاريره واستثناءاته، ثم رفع الملخص التنفيذي إلى CEO دون تنفيذ القرار من مركز القيادة.',
    permissions: ['قراءة تقارير فريق المالية وتنبيهاته وطلباته', 'رفع الملخص التنفيذي إلى CEO', 'لا ينفذ موافقة أو قيدًا من الصفحة'],
    expectedSources: [{ id: 'firestore-ledger', name: 'دفتر Firestore' }, { id: 'agent-ingress', name: 'مدخل الوكلاء الموقّع' }],
    icon: 'cfo', point: { x: 50, y: 50 }, workflowOrder: 4,
  },
  {
    id: 'operations-manager',
    name: 'مدير العمليات COO',
    shortName: 'مدير العمليات COO',
    role: 'قيادة فريق العمليات وتجميع تشغيل ومزامنة سويتر والأصول والصيانة، ومراقبة التعطل والسعة والعمليات غير المتزامنة، ثم رفع القرارات إلى CEO.',
    permissions: ['قراءة تقارير فريق العمليات وتنبيهاته وطلبات الموافقة', 'رفع ملخص التشغيل والقرارات المطلوبة إلى CEO', 'لا يرحّل محاسبيًا ولا يعدّل المصروفات أو العمليات من مركز القيادة'],
    expectedSources: [{ id: 'sweater-operations', name: 'عمليات سويتر' }, { id: 'fixed-assets', name: 'سجل الأصول' }, { id: 'agent-ingress', name: 'مدخل الوكلاء الموقّع' }],
    icon: 'workflow',
  },
  {
    id: 'hr-manager',
    name: 'مدير الموارد البشرية CHRO',
    shortName: 'مدير الموارد CHRO',
    role: 'قيادة فريق الموارد البشرية وتجميع الرواتب والأداء والحضور والمخاطر البشرية، ورفع قرارات التوظيف والجزاء والمكافأة إلى CEO.',
    permissions: ['قراءة تقارير الرواتب والأداء والحضور المصرّح بها', 'رفع القرارات البشرية المطلوبة إلى CEO', 'لا ينفذ رواتب أو تغييرات موظفين بلا موافقة'],
    expectedSources: [{ id: 'payroll', name: 'مصدر الرواتب' }, { id: 'people-operations', name: 'بيانات العاملين' }, { id: 'agent-ingress', name: 'مدخل الوكلاء الموقّع' }],
    icon: 'users',
  },
  {
    id: 'quality-manager',
    name: 'مدير الجودة CQO',
    shortName: 'مدير الجودة CQO',
    role: 'قيادة فريق الجودة وتجربة العميل وتجميع الشكاوى والتقييمات والأسباب المتكررة وخطط المعالجة، ثم رفع القرارات إلى CEO.',
    permissions: ['قراءة تقارير الجودة والشكاوى والتقييمات المصرّح بها', 'رفع الأسباب المتكررة وخطط المعالجة إلى CEO', 'لا يعدّل سجلات العملاء ولا يغلق شكوى غير مثبتة'],
    expectedSources: [{ id: 'customer-experience', name: 'تجربة العميل' }, { id: 'agent-ingress', name: 'مدخل الوكلاء الموقّع' }],
    icon: 'badge',
  },
  {
    id: 'growth-manager',
    name: 'مدير النمو التجاري CGO',
    shortName: 'مدير النمو CGO',
    role: 'قيادة فريق النمو وتجميع مؤشرات الطلب والنمو والإشغال والقنوات والفرص، ثم رفع الملخص والقرارات إلى CEO مع بقاء التسعير ثابتًا من منصة سويتر.',
    permissions: ['قراءة مؤشرات الطلب والنمو والإشغال والقنوات المجمعة', 'رفع الفرص والانحرافات إلى CEO', 'لا يغيّر التسعير ولا يقترح تغييره كإجراء داخلي ولا ينشئ حملات'],
    expectedSources: [{ id: 'commercial-performance', name: 'الأداء التجاري' }, { id: 'sweater-operations', name: 'عمليات سويتر' }, { id: 'agent-ingress', name: 'مدخل الوكلاء الموقّع' }],
    icon: 'trend',
  },
  {
    id: 'assets-maintenance-inventory',
    name: 'الأصول والصيانة والمخزون',
    shortName: 'الأصول والصيانة',
    role: 'متابعة دورة الأصل والصيانة والمخزون والتنبيه إلى الاستحقاقات أو الفروقات.',
    permissions: ['قراءة بيانات الأصول المصرح بها', 'رفع تقرير أو تنبيه', 'لا ينشئ أصلًا أو قيد إهلاك'],
    expectedSources: [{ id: 'fixed-assets', name: 'سجل الأصول' }],
    icon: 'settings', point: { x: 70, y: 90 },
  },
  {
    id: 'payroll-workforce',
    name: 'الرواتب وشؤون العاملين',
    shortName: 'الرواتب',
    role: 'تلخيص حالة الرواتب والاستحقاقات ورفع الحالات التي تحتاج قرارًا بشريًا.',
    permissions: ['قراءة مخرجات الرواتب المصرح بها', 'رفع طلب موافقة منفصل', 'لا يصرف أو يغيّر راتبًا'],
    expectedSources: [{ id: 'payroll', name: 'مصدر الرواتب' }],
    icon: 'wallet', point: { x: 44, y: 91 },
  },
  {
    id: 'people-performance',
    name: 'أداء العاملين والموارد',
    shortName: 'أداء العاملين',
    role: 'عرض مؤشرات الموارد والأداء المصرح بها دون اتخاذ قرارات وظيفية آلية.',
    permissions: ['قراءة مؤشرات مجمعة', 'رفع تقرير أو تنبيه', 'لا يعدّل ملفات العاملين'],
    expectedSources: [{ id: 'people-operations', name: 'بيانات العاملين' }],
    icon: 'users', point: { x: 19, y: 82 },
  },
  {
    id: 'tax-compliance',
    name: 'الضرائب والالتزام النظامي',
    shortName: 'الضرائب والالتزام',
    role: 'مراقبة جاهزية الالتزام والمواعيد والاستثناءات ورفعها للمراجعة.',
    permissions: ['قراءة تقارير الضريبة', 'رفع تنبيه أو طلب موافقة', 'لا يقدّم إقرارًا ولا يغيّر سياسة ضريبية'],
    expectedSources: [{ id: 'tax-documents', name: 'المستندات الضريبية' }],
    icon: 'shield', point: { x: 7, y: 57 },
  },
  {
    id: 'quality-customer-experience',
    name: 'الجودة والشكاوى وتجربة العميل',
    shortName: 'الجودة والشكاوى',
    role: 'تجميع إشارات الجودة والشكاوى وإبراز الحالات المتكررة دون إغلاق شكوى آليًا.',
    permissions: ['قراءة مؤشرات الجودة المصرح بها', 'رفع تقرير أو تنبيه', 'لا يغلق شكوى ولا يعوض عميلًا'],
    expectedSources: [{ id: 'customer-experience', name: 'تجربة العميل' }],
    icon: 'badge', point: { x: 12, y: 30 },
  },
  {
    id: 'commercial-growth',
    name: 'النمو والأداء التجاري',
    shortName: 'النمو التجاري',
    role: 'متابعة الأداء التجاري ورفع الفرص والانحرافات دون التحكم بالتسعير أو الحملات.',
    permissions: ['قراءة مؤشرات تجارية مجمعة', 'رفع تقرير أو تنبيه', 'لا يغيّر تسعيرًا ولا ينشئ حملة'],
    expectedSources: [{ id: 'commercial-performance', name: 'الأداء التجاري' }],
    icon: 'trend', point: { x: 28, y: 11 },
  },
]);

export const WORKFLOW_AGENT_IDS = Object.freeze([
  'expense-capture', 'expense-review', 'accounting-reconciliation', 'cfo',
]);

export const COMMAND_CENTER_ROOT = Object.freeze({
  id: 'ceo',
  name: 'CEO',
  title: 'مركز القيادة',
  description: 'العقدة التنظيمية العليا لاستقبال الملخصات والتنبيهات التنفيذية وطلبات الموافقة.',
});

export const AGENT_TEAMS = Object.freeze([
  {
    id: 'finance',
    name: 'فريق المالية',
    shortName: 'المالية',
    description: 'المصروفات والمطابقة والالتزام المالي.',
    icon: 'landmark',
    leaderAgentId: 'cfo',
    memberAgentIds: [
      'expense-capture', 'expense-review', 'accounting-reconciliation', 'tax-compliance',
    ],
    layout: { angle: -90, memberArc: [-154, -124, -94, -64] },
  },
  {
    id: 'operations',
    name: 'فريق العمليات',
    shortName: 'العمليات',
    description: 'تكامل العمليات وجاهزية الأصول والمخزون.',
    icon: 'workflow',
    leaderAgentId: 'operations-manager',
    memberAgentIds: ['sweater-sync', 'assets-maintenance-inventory'],
    layout: { angle: -18, memberArc: [-36, 0] },
  },
  {
    id: 'growth',
    name: 'فريق النمو والأداء التجاري',
    shortName: 'النمو التجاري',
    description: 'مراقبة النمو والمؤشرات التجارية دون التحكم بالحملات أو التسعير.',
    icon: 'trend',
    leaderAgentId: 'growth-manager',
    memberAgentIds: ['commercial-growth'],
    layout: { angle: 54, memberArc: [54] },
  },
  {
    id: 'quality',
    name: 'فريق الجودة وتجربة العميل',
    shortName: 'الجودة',
    description: 'الجودة والشكاوى وإشارات تجربة العميل.',
    icon: 'badge',
    leaderAgentId: 'quality-manager',
    memberAgentIds: ['quality-customer-experience'],
    layout: { angle: 108, memberArc: [108] },
  },
  {
    id: 'people',
    name: 'فريق الموارد البشرية',
    shortName: 'الموارد البشرية',
    description: 'الرواتب وشؤون العاملين ومؤشرات الأداء والموارد.',
    icon: 'users',
    leaderAgentId: 'hr-manager',
    memberAgentIds: ['payroll-workforce', 'people-performance'],
    layout: { angle: 174, memberArc: [150, 178] },
  },
]);

const TEAM_BY_AGENT_ID = new Map();
for (const team of AGENT_TEAMS) {
  if (team.leaderAgentId) TEAM_BY_AGENT_ID.set(team.leaderAgentId, team);
  for (const agentId of team.memberAgentIds) TEAM_BY_AGENT_ID.set(agentId, team);
}

export function assembleAgentOrganization(agents = []) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const assignedAgentIds = new Set();
  const teams = AGENT_TEAMS.map((team) => {
    const leader = team.leaderAgentId ? agentsById.get(team.leaderAgentId) || null : null;
    if (leader) assignedAgentIds.add(leader.id);
    const members = team.memberAgentIds.map((id) => agentsById.get(id)).filter(Boolean);
    for (const member of members) assignedAgentIds.add(member.id);
    return { ...team, leader, members, agentCount: members.length + (leader ? 1 : 0) };
  });
  return {
    root: COMMAND_CENTER_ROOT,
    teams,
    unassignedAgents: agents.filter((agent) => !assignedAgentIds.has(agent.id)),
    agentCount: agents.length,
  };
}

const VALID_STATUSES = new Set(Object.keys(AGENT_STATUS));
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
  };
}

function newestFirst(rows, key) {
  return [...rows].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')));
}

export function assembleCommandCenterSnapshot(raw = {}) {
  const liveAgents = new Map((raw.agents || []).map((row) => [row.id || row.agentId, normalizeRow(row)]));
  const reports = newestFirst((raw.reports || []).map(normalizeRow), 'reportedAt');
  const alerts = newestFirst((raw.alerts || []).map(normalizeRow).filter((row) => row.active !== false), 'createdAt');
  const approvals = newestFirst((raw.approvals || []).map(normalizeRow).filter((row) => row.status === 'pending'), 'createdAt');
  const sources = (raw.sources || []).map(normalizeRow);
  const sourcesById = new Map(sources.map((row) => [row.id, row]));
  const activity = newestFirst((raw.activity || []).map(normalizeRow), 'occurredAt');

  const agents = AGENT_CATALOG.map((catalog) => {
    const live = liveAgents.get(catalog.id) || {};
    const agentReports = reports.filter((row) => row.agentId === catalog.id);
    const agentAlerts = alerts.filter((row) => row.agentId === catalog.id);
    const agentApprovals = approvals.filter((row) => row.agentId === catalog.id);
    const sourceIds = new Set([...(live.sourceIds || []), ...catalog.expectedSources.map((item) => item.id)]);
    const dataSources = [...sourceIds].map((id) => {
      const received = sourcesById.get(id);
      const expected = catalog.expectedSources.find((item) => item.id === id);
      return received
        ? { ...received, name: received.name || expected?.name || id }
        : { id, name: expected?.name || id, status: 'unknown', lastCheckedAt: null, details: null };
    });
    const latestReport = agentReports[0] || (live.lastReportSummary ? {
      id: live.lastReportId || null,
      title: live.lastReportTitle || 'آخر تقرير',
      summary: live.lastReportSummary,
      reportedAt: live.lastReportAt,
    } : null);

    return {
      ...catalog,
      teamId: TEAM_BY_AGENT_ID.get(catalog.id)?.id || null,
      teamName: TEAM_BY_AGENT_ID.get(catalog.id)?.name || null,
      isTeamLeader: TEAM_BY_AGENT_ID.get(catalog.id)?.leaderAgentId === catalog.id,
      status: VALID_STATUSES.has(live.status) ? live.status : 'unknown',
      isRunning: live.isRunning === true,
      lastRunAt: live.lastRunAt || null,
      nextRunAt: live.nextRunAt || null,
      lastEventAt: live.lastEventAt ? toIsoTimestamp(live.lastEventAt) : null,
      latestReport,
      reports: agentReports,
      alerts: agentAlerts,
      approvals: agentApprovals,
      dataSources,
      conversationUrl: trustedConversationUrl(live.conversationUrl),
      hasLiveState: Boolean(live.id || live.agentId),
      teamReports: [],
      teamAlerts: [],
      teamApprovals: [],
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
    return acc;
  }, { healthy: 0, warning: 0, critical: 0, unknown: 0, running: 0 });

  return {
    agents: agentsWithTeamEscalations,
    reports,
    alerts,
    approvals,
    sources,
    activity,
    summary,
    hasLiveData: [raw.agents, raw.reports, raw.alerts, raw.approvals, raw.sources, raw.activity]
      .some((rows) => Array.isArray(rows) && rows.length > 0),
  };
}

export const EMPTY_COMMAND_CENTER_SNAPSHOT = assembleCommandCenterSnapshot();

export function formatAgentDate(value) {
  if (!value) return 'غير متوفر';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير متوفر';
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium', timeStyle: 'short', hour12: true,
  }).format(date);
}
