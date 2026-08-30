import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { createAgentCommandCenterHandler } from '../../api/agent-command-center-ingest.js';
import {
  normalizeAgentCommandEvent, signAgentCommandRequest,
} from '../src/agentCommandCenter.js';

const SECRET = 'vercel-handler-test-secret';
const BODY = Buffer.from(JSON.stringify({
  version: 1,
  eventType: 'status',
  agentId: 'expense-capture',
  occurredAt: new Date().toISOString(),
  status: 'healthy',
}));

function request({ body = BODY, method = 'POST', signature = 'bad', timestamp, idempotencyKey = 'vercel:test:1' } = {}) {
  const stream = Readable.from([body]);
  stream.method = method;
  stream.headers = {
    'x-sweater-signature': signature,
    'x-sweater-timestamp': timestamp || String(Math.floor(Date.now() / 1_000)),
    'x-sweater-idempotency-key': idempotencyKey,
  };
  return stream;
}

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function signedRequest(body, idempotencyKey) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = `sha256=${signAgentCommandRequest(SECRET, {
    timestamp, idempotencyKey, rawBody: body,
  })}`;
  return request({ body, signature, timestamp, idempotencyKey });
}

afterEach(() => {
  delete process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe('Vercel agent command-center endpoint', () => {
  it('exports a production handler and rejects non-POST requests', async () => {
    const res = response();
    await handler(request({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });

  it('rejects a wrong signature before opening a Firestore connection', async () => {
    process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET = SECRET;
    const databaseFactory = vi.fn();
    const endpoint = createAgentCommandCenterHandler({ databaseFactory });
    const res = response();
    await endpoint(request(), res);
    expect(res.statusCode).toBe(401);
    expect(databaseFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('passes a verified payload to the idempotent ingestion service', async () => {
    process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET = SECRET;
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const idempotencyKey = 'vercel:test:accepted';
    const signature = `sha256=${signAgentCommandRequest(SECRET, {
      timestamp, idempotencyKey, rawBody: BODY,
    })}`;
    const ingest = vi.fn().mockResolvedValue({ duplicate: false, eventId: 'event-1' });
    const databaseFactory = vi.fn(() => ({ db: 'db', FieldValue: 'FieldValue' }));
    const endpoint = createAgentCommandCenterHandler({ databaseFactory, ingest });
    const res = response();
    await endpoint(request({ signature, timestamp, idempotencyKey }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: false, eventId: 'event-1' });
    expect(ingest).toHaveBeenCalledWith('db', 'FieldValue', expect.objectContaining({ agentId: 'expense-capture' }), {
      idempotencyKey, timestamp: Number(timestamp),
    });
  });

  it.each([
    'operations-manager', 'hr-manager', 'quality-manager', 'growth-manager',
  ])('accepts a signed event for registered manager %s', async (agentId) => {
    process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET = SECRET;
    const body = Buffer.from(JSON.stringify({
      version: 1, eventType: 'status', agentId,
      occurredAt: new Date().toISOString(), status: 'healthy',
    }));
    const ingest = vi.fn(async (_db, _fieldValue, payload) => {
      const normalized = normalizeAgentCommandEvent(payload);
      return { duplicate: false, eventId: `event-${normalized.agentId}` };
    });
    const endpoint = createAgentCommandCenterHandler({
      databaseFactory: () => ({ db: 'db', FieldValue: 'FieldValue' }), ingest,
    });
    const res = response();

    await endpoint(signedRequest(body, `vercel:manager:${agentId}`), res);

    expect(res.statusCode).toBe(200);
    expect(ingest).toHaveBeenCalledWith('db', 'FieldValue', expect.objectContaining({ agentId }), expect.any(Object));
  });

  it('rejects a correctly signed event when its agent identifier is not registered', async () => {
    process.env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET = SECRET;
    const body = Buffer.from(JSON.stringify({
      version: 1, eventType: 'status', agentId: 'operations-director',
      occurredAt: new Date().toISOString(), status: 'healthy',
    }));
    const ingest = vi.fn(async (_db, _fieldValue, payload) => {
      normalizeAgentCommandEvent(payload);
      return { duplicate: false, eventId: 'must-not-be-created' };
    });
    const endpoint = createAgentCommandCenterHandler({
      databaseFactory: () => ({ db: 'db', FieldValue: 'FieldValue' }), ingest,
    });
    const res = response();

    await endpoint(signedRequest(body, 'vercel:manager:unknown'), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid-argument' });
  });
});
