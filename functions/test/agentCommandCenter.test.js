import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  AGENT_COMMAND_COLLECTIONS,
  AGENT_IDS,
  AgentCommandCenterError,
  buildAgentCommandAuditRecord,
  ingestAgentCommandEvent,
  normalizeAgentCommandEvent,
  signAgentCommandRequest,
  verifyAgentCommandSignature,
} from '../src/agentCommandCenter.js';

const SECRET = 'test-only-command-center-secret';
const NOW = Date.UTC(2026, 7, 28, 9, 0, 0);
const TIMESTAMP = String(Math.floor(NOW / 1000));
const IDEMPOTENCY_KEY = 'codex-run:expense-capture:2026-08-28T09:00:00Z';
const RAW_BODY = Buffer.from(JSON.stringify({
  version: 1,
  eventType: 'status',
  agentId: 'expense-capture',
  occurredAt: '2026-08-28T09:00:00.000Z',
  status: 'healthy',
  isRunning: false,
  lastRunAt: '2026-08-28T08:59:00.000Z',
}));
const MANAGER_IDS = [
  'operations-manager', 'hr-manager', 'quality-manager', 'growth-manager',
];

describe('Agent command-center signed boundary', () => {
  it('rejects a wrong signature', () => {
    expect(() => verifyAgentCommandSignature({
      secret: SECRET,
      signature: `sha256=${'0'.repeat(64)}`,
      timestamp: TIMESTAMP,
      idempotencyKey: IDEMPOTENCY_KEY,
      rawBody: RAW_BODY,
      now: NOW,
    })).toThrowError(AgentCommandCenterError);
  });

  it('accepts the exact body, timestamp and idempotency key that were signed', () => {
    const signature = signAgentCommandRequest(SECRET, {
      timestamp: TIMESTAMP, idempotencyKey: IDEMPOTENCY_KEY, rawBody: RAW_BODY,
    });
    expect(verifyAgentCommandSignature({
      secret: SECRET,
      signature: `sha256=${signature}`,
      timestamp: TIMESTAMP,
      idempotencyKey: IDEMPOTENCY_KEY,
      rawBody: RAW_BODY,
      now: NOW,
    })).toEqual({ idempotencyKey: IDEMPOTENCY_KEY, timestamp: Number(TIMESTAMP) });
  });

  it('keeps reports, alerts and approval requests as distinct event types', () => {
    const common = { version: 1, agentId: 'expense-review', occurredAt: '2026-08-28T09:00:00Z' };
    expect(normalizeAgentCommandEvent({
      ...common, eventType: 'report', report: { title: 'تقرير', summary: 'ملخص حقيقي' },
    }).report).toMatchObject({ title: 'تقرير' });
    expect(normalizeAgentCommandEvent({
      ...common, eventType: 'alert', alert: { title: 'تنبيه', message: 'استثناء', severity: 'warning' },
    }).alert).toMatchObject({ severity: 'warning' });
    expect(normalizeAgentCommandEvent({
      ...common, eventType: 'approval', approval: { title: 'قرار مطلوب', summary: 'للمراجعة البشرية' },
    }).approval).toMatchObject({ title: 'قرار مطلوب' });
  });

  it('accepts the four registered department managers without opening the identifier set', () => {
    expect(AGENT_IDS).toHaveLength(15);
    for (const agentId of MANAGER_IDS) {
      expect(normalizeAgentCommandEvent({
        version: 1,
        eventType: 'status',
        agentId,
        occurredAt: '2026-08-28T09:00:00Z',
        status: 'healthy',
      })).toMatchObject({ agentId, status: 'healthy' });
    }
  });

  it.each(['ceo', 'operations-director', 'free-form-agent'])(
    'rejects organizational or unregistered identifier %s',
    (agentId) => {
      expect(() => normalizeAgentCommandEvent({
        version: 1,
        eventType: 'status',
        agentId,
        occurredAt: '2026-08-28T09:00:00Z',
        status: 'healthy',
      })).toThrow(/agentId/);
    },
  );

  it('never includes a secret, signature or raw request body in the audit record', () => {
    const event = normalizeAgentCommandEvent(JSON.parse(RAW_BODY.toString('utf8')));
    const audit = buildAgentCommandAuditRecord({
      event,
      eventId: 'event-id',
      requestIdHash: 'request-hash',
      targetCollection: AGENT_COMMAND_COLLECTIONS.AGENTS,
    }, { serverTimestamp: () => 'server-time' });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('X-Sweater-Signature');
    expect(serialized).not.toContain(RAW_BODY.toString('utf8'));
    expect(audit.after).toMatchObject({ eventType: 'status', agentId: 'expense-capture' });
  });

  it('accepts conversation links only from the trusted ChatGPT hosts', () => {
    expect(() => normalizeAgentCommandEvent({
      ...JSON.parse(RAW_BODY.toString('utf8')),
      conversationUrl: 'https://evil.example/tasks/123',
    })).toThrow(/موثوق/);
  });
});

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app;
let db;

async function wipe() {
  const names = [...Object.values(AGENT_COMMAND_COLLECTIONS), 'journal_entries', 'monthly_expenses'];
  for (const name of new Set(names)) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map((row) => row.ref.delete()));
  }
}

emulatorDescribe('Agent command-center idempotent storage', () => {
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-sweater-agent-command-center' }, 'agent-command-center-test');
    db = getFirestore(app);
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(wipe);

  it('stores one event and one audit line when the same idempotency key is retried', async () => {
    const payload = JSON.parse(RAW_BODY.toString('utf8'));
    const first = await ingestAgentCommandEvent(db, FieldValue, payload, { idempotencyKey: IDEMPOTENCY_KEY });
    const second = await ingestAgentCommandEvent(db, FieldValue, payload, { idempotencyKey: IDEMPOTENCY_KEY });

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ duplicate: true, eventId: first.eventId });
    expect((await db.collection(AGENT_COMMAND_COLLECTIONS.AGENTS).get()).size).toBe(1);
    expect((await db.collection(AGENT_COMMAND_COLLECTIONS.ACTIVITY).get()).size).toBe(1);
    expect((await db.collection(AGENT_COMMAND_COLLECTIONS.AUDIT).get()).size).toBe(1);
    const ingestion = await db.collection(AGENT_COMMAND_COLLECTIONS.INGESTION).get();
    expect(ingestion.size).toBe(1);
    expect(ingestion.docs[0].data().expiresAt.toDate().getTime()).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60 * 1_000);
    expect((await db.collection('journal_entries').get()).size).toBe(0);
    expect((await db.collection('monthly_expenses').get()).size).toBe(0);
  });

  it('stores approval requests as pending observations without executing them', async () => {
    await ingestAgentCommandEvent(db, FieldValue, {
      version: 1,
      eventType: 'approval',
      agentId: 'tax-compliance',
      occurredAt: '2026-08-28T09:10:00Z',
      approval: { title: 'مراجعة الإقرار', summary: 'يتطلب قرار المدير المالي' },
    }, { idempotencyKey: 'approval:tax:2026-08-28T09:10:00Z' });
    const approval = (await db.collection(AGENT_COMMAND_COLLECTIONS.APPROVALS).get()).docs[0].data();
    expect(approval).toMatchObject({ status: 'pending', agentId: 'tax-compliance' });
    expect((await db.collection('journal_entries').get()).size).toBe(0);
  });
});
