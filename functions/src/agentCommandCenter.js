import {
  createHash, createHmac, timingSafeEqual,
} from 'node:crypto';

export const AGENT_COMMAND_COLLECTIONS = Object.freeze({
  AGENTS: 'agent_command_agents',
  REPORTS: 'agent_command_reports',
  ALERTS: 'agent_command_alerts',
  APPROVALS: 'agent_command_approvals',
  SOURCES: 'agent_command_sources',
  ACTIVITY: 'agent_command_activity',
  INGESTION: 'agent_command_ingestion',
  AUDIT: 'audit_logs',
});

export const AGENT_IDS = Object.freeze([
  'expense-capture',
  'expense-review',
  'accounting-reconciliation',
  'sweater-sync',
  'cfo',
  'operations-manager',
  'hr-manager',
  'quality-manager',
  'growth-manager',
  'assets-maintenance-inventory',
  'payroll-workforce',
  'people-performance',
  'tax-compliance',
  'quality-customer-experience',
  'commercial-growth',
]);

const AGENT_NAMES = Object.freeze({
  'expense-capture': 'تسجيل المصروفات والفواتير',
  'expense-review': 'مراجعة المصروفات',
  'accounting-reconciliation': 'الترحيل والمطابقة المحاسبية',
  'sweater-sync': 'مزامنة عمليات سويتر',
  cfo: 'المدير المالي CFO',
  'operations-manager': 'مدير العمليات COO',
  'hr-manager': 'مدير الموارد البشرية CHRO',
  'quality-manager': 'مدير الجودة CQO',
  'growth-manager': 'مدير النمو التجاري CGO',
  'assets-maintenance-inventory': 'الأصول والصيانة والمخزون',
  'payroll-workforce': 'الرواتب وشؤون العاملين',
  'people-performance': 'أداء العاملين والموارد',
  'tax-compliance': 'الضرائب والالتزام النظامي',
  'quality-customer-experience': 'الجودة والشكاوى وتجربة العميل',
  'commercial-growth': 'النمو والأداء التجاري',
});

const AGENT_ID_SET = new Set(AGENT_IDS);
const HEALTH_STATUSES = new Set(['healthy', 'warning', 'critical', 'unknown']);
const EVENT_TYPES = new Set(['status', 'report', 'alert', 'approval', 'source', 'activity']);
const ALERT_SEVERITIES = new Set(['info', 'warning', 'critical']);
const ACTIVITY_KINDS = new Set(['info', 'success', 'warning', 'critical']);
const TRUSTED_CONVERSATION_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 128 * 1024;
const IDEMPOTENCY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

const ROOT_KEYS = new Set([
  'version', 'eventType', 'agentId', 'occurredAt', 'status', 'isRunning',
  'lastRunAt', 'nextRunAt', 'conversationUrl', 'sourceIds', 'report',
  'alert', 'approval', 'source', 'activity',
]);

export class AgentCommandCenterError extends Error {
  constructor(message, { code = 'invalid-argument', httpStatus = 400 } = {}) {
    super(message);
    this.name = 'AgentCommandCenterError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(message, options) {
  throw new AgentCommandCenterError(message, options);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} يجب أن يكون كائنًا.`);
  }
}

function assertKnownKeys(value, allowed, label) {
  assertPlainObject(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${label} يتضمن حقولًا غير مدعومة: ${unknown.join(', ')}`);
}

function cleanText(value, label, { required = false, max = 500 } = {}) {
  if (value == null || value === '') {
    if (required) fail(`${label} مطلوب.`);
    return null;
  }
  if (typeof value !== 'string') fail(`${label} يجب أن يكون نصًا.`);
  const cleaned = value.trim();
  if (required && !cleaned) fail(`${label} مطلوب.`);
  if (cleaned.length > max) fail(`${label} أطول من الحد المسموح (${max}).`);
  return cleaned || null;
}

function cleanDate(value, label, { required = false } = {}) {
  const raw = cleanText(value, label, { required, max: 40 });
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) fail(`${label} ليس تاريخ ISO صالحًا.`);
  return date;
}

function cleanEnum(value, allowed, label, { required = false } = {}) {
  const cleaned = cleanText(value, label, { required, max: 40 });
  if (!cleaned) return null;
  if (!allowed.has(cleaned)) fail(`${label} يحمل قيمة غير مدعومة.`);
  return cleaned;
}

function cleanHttpsUrl(value, label, { trustedConversation = false } = {}) {
  const cleaned = cleanText(value, label, { max: 1_000 });
  if (!cleaned) return null;
  let parsed;
  try { parsed = new URL(cleaned); } catch { fail(`${label} ليس رابطًا صالحًا.`); }
  if (parsed.protocol !== 'https:') fail(`${label} يجب أن يستخدم HTTPS.`);
  if (parsed.username || parsed.password) fail(`${label} لا يقبل بيانات دخول ضمن الرابط.`);
  if (trustedConversation && !TRUSTED_CONVERSATION_HOSTS.has(parsed.hostname.toLowerCase())) {
    fail(`${label} ليس من نطاق محادثة موثوق.`);
  }
  return parsed.toString();
}

function cleanAgentId(value, { required = true } = {}) {
  const id = cleanText(value, 'agentId', { required, max: 80 });
  if (!id) return null;
  if (!AGENT_ID_SET.has(id)) fail('agentId غير مسجل في مركز القيادة.');
  return id;
}

function cleanSourceIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) fail('sourceIds يجب أن تكون قائمة لا تتجاوز 20 عنصرًا.');
  return [...new Set(value.map((item) => {
    const id = cleanText(item, 'sourceIds[]', { required: true, max: 80 });
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('sourceIds[] يجب أن يكون معرّفًا آمنًا.');
    return id;
  }))];
}

function cleanReport(value) {
  assertKnownKeys(value, new Set(['title', 'summary', 'url']), 'report');
  return {
    title: cleanText(value.title, 'report.title', { required: true, max: 160 }),
    summary: cleanText(value.summary, 'report.summary', { required: true, max: 2_000 }),
    url: cleanHttpsUrl(value.url, 'report.url'),
  };
}

function cleanAlert(value) {
  assertKnownKeys(value, new Set(['title', 'message', 'severity']), 'alert');
  return {
    title: cleanText(value.title, 'alert.title', { required: true, max: 160 }),
    message: cleanText(value.message, 'alert.message', { required: true, max: 1_000 }),
    severity: cleanEnum(value.severity, ALERT_SEVERITIES, 'alert.severity', { required: true }),
  };
}

function cleanApproval(value) {
  assertKnownKeys(value, new Set(['title', 'summary', 'dueAt']), 'approval');
  return {
    title: cleanText(value.title, 'approval.title', { required: true, max: 160 }),
    summary: cleanText(value.summary, 'approval.summary', { required: true, max: 1_500 }),
    dueAt: cleanDate(value.dueAt, 'approval.dueAt'),
  };
}

function cleanSource(value) {
  assertKnownKeys(value, new Set(['id', 'name', 'status', 'details', 'lastCheckedAt']), 'source');
  const id = cleanText(value.id, 'source.id', { required: true, max: 80 });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('source.id يجب أن يكون معرّفًا آمنًا.');
  return {
    id,
    name: cleanText(value.name, 'source.name', { required: true, max: 120 }),
    status: cleanEnum(value.status, HEALTH_STATUSES, 'source.status', { required: true }),
    details: cleanText(value.details, 'source.details', { max: 500 }),
    lastCheckedAt: cleanDate(value.lastCheckedAt, 'source.lastCheckedAt', { required: true }),
  };
}

function cleanActivity(value) {
  assertKnownKeys(value, new Set(['message', 'kind']), 'activity');
  return {
    message: cleanText(value.message, 'activity.message', { required: true, max: 500 }),
    kind: cleanEnum(value.kind, ACTIVITY_KINDS, 'activity.kind', { required: true }),
  };
}

export function normalizeAgentCommandEvent(input) {
  assertKnownKeys(input, ROOT_KEYS, 'payload');
  if (input.version !== 1) fail('version غير مدعوم؛ القيمة الحالية هي 1.');
  const eventType = cleanEnum(input.eventType, EVENT_TYPES, 'eventType', { required: true });
  const needsAgent = !['source', 'activity'].includes(eventType);
  const agentId = cleanAgentId(input.agentId, { required: needsAgent });
  const occurredAt = cleanDate(input.occurredAt, 'occurredAt', { required: true });

  const normalized = {
    version: 1,
    eventType,
    agentId,
    occurredAt,
    status: null,
    isRunning: null,
    lastRunAt: null,
    nextRunAt: null,
    conversationUrl: null,
    sourceIds: [],
    report: null,
    alert: null,
    approval: null,
    source: null,
    activity: null,
  };

  if (input.status != null) normalized.status = cleanEnum(input.status, HEALTH_STATUSES, 'status');
  if (input.isRunning != null) {
    if (typeof input.isRunning !== 'boolean') fail('isRunning يجب أن يكون true أو false.');
    normalized.isRunning = input.isRunning;
  }
  normalized.lastRunAt = cleanDate(input.lastRunAt, 'lastRunAt');
  normalized.nextRunAt = cleanDate(input.nextRunAt, 'nextRunAt');
  normalized.conversationUrl = cleanHttpsUrl(input.conversationUrl, 'conversationUrl', { trustedConversation: true });
  normalized.sourceIds = cleanSourceIds(input.sourceIds);

  if (eventType === 'status') {
    normalized.status = cleanEnum(input.status, HEALTH_STATUSES, 'status', { required: true });
  } else if (eventType === 'report') {
    normalized.report = cleanReport(input.report);
  } else if (eventType === 'alert') {
    normalized.alert = cleanAlert(input.alert);
  } else if (eventType === 'approval') {
    normalized.approval = cleanApproval(input.approval);
  } else if (eventType === 'source') {
    normalized.source = cleanSource(input.source);
  } else if (eventType === 'activity') {
    normalized.activity = cleanActivity(input.activity);
  }

  return normalized;
}

function signatureMessage(timestamp, idempotencyKey, rawBody) {
  return Buffer.concat([
    Buffer.from(`${timestamp}.${idempotencyKey}.`, 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
}

export function signAgentCommandRequest(secret, { timestamp, idempotencyKey, rawBody }) {
  return createHmac('sha256', secret)
    .update(signatureMessage(timestamp, idempotencyKey, rawBody))
    .digest('hex');
}

export function verifyAgentCommandSignature({
  secret, signature, timestamp, idempotencyKey, rawBody, now = Date.now(),
}) {
  const cleanSecret = cleanText(secret, 'secret', { required: true, max: 10_000 });
  const key = cleanText(idempotencyKey, 'X-Sweater-Idempotency-Key', { required: true, max: 128 });
  if (!/^[a-zA-Z0-9._:-]+$/.test(key)) {
    fail('مفتاح منع التكرار غير صالح.', { code: 'unauthenticated', httpStatus: 401 });
  }
  const ts = cleanText(timestamp, 'X-Sweater-Timestamp', { required: true, max: 20 });
  if (!/^\d{10}$/.test(ts)) {
    fail('وقت التوقيع غير صالح.', { code: 'unauthenticated', httpStatus: 401 });
  }
  const numericTimestamp = Number(ts);
  if (Math.abs(Math.floor(now / 1000) - numericTimestamp) > MAX_CLOCK_SKEW_SECONDS) {
    fail('انتهت صلاحية التوقيع.', { code: 'unauthenticated', httpStatus: 401 });
  }
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  if (!bytes.length || bytes.length > MAX_BODY_BYTES) {
    fail('حجم الطلب غير صالح.', { code: 'invalid-argument', httpStatus: 413 });
  }
  const provided = String(signature || '').trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) {
    fail('التوقيع غير صالح.', { code: 'unauthenticated', httpStatus: 401 });
  }
  const expected = signAgentCommandRequest(cleanSecret, {
    timestamp: ts, idempotencyKey: key, rawBody: bytes,
  });
  const matches = timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  if (!matches) fail('التوقيع غير صالح.', { code: 'unauthenticated', httpStatus: 401 });
  return { idempotencyKey: key, timestamp: numericTimestamp };
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function eventSeverity(event) {
  if (event.alert) return event.alert.severity;
  if (event.status === 'critical') return 'critical';
  if (event.status === 'warning') return 'warning';
  if (event.status === 'healthy') return 'success';
  if (event.source?.status === 'critical') return 'critical';
  if (event.source?.status === 'warning') return 'warning';
  if (event.source?.status === 'healthy') return 'success';
  return event.activity?.kind || 'info';
}

function activityMessage(event) {
  if (event.activity) return event.activity.message;
  const agentName = event.agentId ? AGENT_NAMES[event.agentId] : null;
  if (event.report) return `وصل تقرير جديد من ${agentName}.`;
  if (event.alert) return `وصل تنبيه جديد من ${agentName}: ${event.alert.title}`;
  if (event.approval) return `أضيف طلب موافقة من ${agentName}: ${event.approval.title}`;
  if (event.source) return `تحديث صحة مصدر البيانات: ${event.source.name}.`;
  return `تحديث حالة ${agentName}.`;
}

export function buildAgentCommandAuditRecord({ event, eventId, requestIdHash, targetCollection }, FieldValue) {
  return {
    action: 'agent-command-ingest',
    collectionName: targetCollection,
    documentId: eventId,
    userId: 'integration:agent-command-center',
    before: null,
    after: compact({
      requestIdHash,
      eventType: event.eventType,
      agentId: event.agentId,
      status: event.status || event.source?.status,
      severity: event.alert?.severity,
    }),
    note: 'Signed agent command-center ingestion',
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function ingestAgentCommandEvent(db, FieldValue, rawEvent, { idempotencyKey }) {
  const event = normalizeAgentCommandEvent(rawEvent);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_RETENTION_MS);
  const requestIdHash = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
  const eventId = createHash('sha256')
    .update(`${requestIdHash}:${event.eventType}`, 'utf8')
    .digest('hex');
  const markerRef = db.collection(AGENT_COMMAND_COLLECTIONS.INGESTION).doc(requestIdHash);

  return db.runTransaction(async (tx) => {
    const marker = await tx.get(markerRef);
    if (marker.exists) {
      return { duplicate: true, eventId: marker.data().eventId || eventId };
    }

    const common = compact({
      eventId,
      requestIdHash,
      eventType: event.eventType,
      agentId: event.agentId,
      occurredAt: event.occurredAt,
      receivedAt: FieldValue.serverTimestamp(),
    });
    let targetCollection = AGENT_COMMAND_COLLECTIONS.ACTIVITY;

    if (event.agentId) {
      const agentUpdate = compact({
        agentId: event.agentId,
        displayName: AGENT_NAMES[event.agentId],
        status: event.status,
        isRunning: event.isRunning,
        lastRunAt: event.lastRunAt,
        nextRunAt: event.nextRunAt,
        conversationUrl: event.conversationUrl,
        sourceIds: event.sourceIds.length ? event.sourceIds : null,
        lastEventAt: event.occurredAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection(AGENT_COMMAND_COLLECTIONS.AGENTS).doc(event.agentId), agentUpdate, { merge: true });
    }

    if (event.eventType === 'report') {
      targetCollection = AGENT_COMMAND_COLLECTIONS.REPORTS;
      tx.set(db.collection(targetCollection).doc(eventId), {
        ...common, ...event.report, reportedAt: event.occurredAt,
      });
      tx.set(db.collection(AGENT_COMMAND_COLLECTIONS.AGENTS).doc(event.agentId), {
        lastReportId: eventId,
        lastReportTitle: event.report.title,
        lastReportSummary: event.report.summary,
        lastReportAt: event.occurredAt,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (event.eventType === 'alert') {
      targetCollection = AGENT_COMMAND_COLLECTIONS.ALERTS;
      tx.set(db.collection(targetCollection).doc(eventId), {
        ...common, ...event.alert, active: true, createdAt: event.occurredAt,
      });
    } else if (event.eventType === 'approval') {
      targetCollection = AGENT_COMMAND_COLLECTIONS.APPROVALS;
      tx.set(db.collection(targetCollection).doc(eventId), {
        ...common, ...event.approval, status: 'pending', createdAt: event.occurredAt,
      });
    } else if (event.eventType === 'source') {
      targetCollection = AGENT_COMMAND_COLLECTIONS.SOURCES;
      tx.set(db.collection(targetCollection).doc(event.source.id), {
        ...common, ...event.source, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (event.eventType === 'status') {
      targetCollection = AGENT_COMMAND_COLLECTIONS.AGENTS;
    }

    const activityRef = db.collection(AGENT_COMMAND_COLLECTIONS.ACTIVITY).doc(eventId);
    tx.set(activityRef, compact({
      ...common,
      kind: eventSeverity(event),
      message: activityMessage(event),
      occurredAt: event.occurredAt,
    }));
    tx.set(markerRef, {
      eventId,
      requestIdHash,
      eventType: event.eventType,
      receivedAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    tx.set(
      db.collection(AGENT_COMMAND_COLLECTIONS.AUDIT).doc(`agent-command__${requestIdHash}`),
      buildAgentCommandAuditRecord({ event, eventId, requestIdHash, targetCollection }, FieldValue),
    );
    return { duplicate: false, eventId };
  });
}

export const AGENT_COMMAND_MAX_BODY_BYTES = MAX_BODY_BYTES;
