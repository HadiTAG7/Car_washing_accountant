import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { createAgentCommandCenterCleanupHandler } from '../../api/agent-command-center-cleanup.js';
import {
  AGENT_COMMAND_CLEANUP_BATCH_SIZE,
  deleteExpiredIngestionMarkers,
} from '../../server/agentCommandCenterCleanup.js';

const SECRET = 'cron-test-secret-that-is-longer-than-32-characters';

function request({ method = 'GET', authorization } = {}) {
  return { method, headers: authorization ? { authorization } : {} };
}

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe('Vercel agent command-center cleanup cron', () => {
  it('exports a production handler and accepts GET only', async () => {
    const res = response();
    await handler(request({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('rejects an invalid bearer token before opening Firestore', async () => {
    process.env.CRON_SECRET = SECRET;
    const databaseFactory = vi.fn();
    const endpoint = createAgentCommandCenterCleanupHandler({ databaseFactory });
    const res = response();
    await endpoint(request({ authorization: 'Bearer invalid' }), res);
    expect(res.statusCode).toBe(401);
    expect(databaseFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('fails closed when CRON_SECRET is missing', async () => {
    const databaseFactory = vi.fn();
    const endpoint = createAgentCommandCenterCleanupHandler({ databaseFactory });
    const res = response();
    await endpoint(request(), res);
    expect(res.statusCode).toBe(500);
    expect(databaseFactory).not.toHaveBeenCalled();
  });

  it('runs the cleanup with a server-controlled timestamp', async () => {
    process.env.CRON_SECRET = SECRET;
    const currentTime = new Date('2026-08-28T12:00:00.000Z');
    const cleanup = vi.fn().mockResolvedValue({ deleted: 3, hasMore: false });
    const endpoint = createAgentCommandCenterCleanupHandler({
      databaseFactory: () => ({ db: 'firestore' }), cleanup, now: () => currentTime,
    });
    const res = response();
    await endpoint(request({ authorization: `Bearer ${SECRET}` }), res);
    expect(cleanup).toHaveBeenCalledWith('firestore', currentTime);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: 3, hasMore: false });
  });

  it('deletes only expired ingestion markers in a bounded batch', async () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const refs = [{ path: 'agent_command_ingestion/a' }, { path: 'agent_command_ingestion/b' }];
    const commit = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn();
    const get = vi.fn().mockResolvedValue({
      empty: false, size: refs.length, docs: refs.map((ref) => ({ ref })),
    });
    const limit = vi.fn(() => ({ get }));
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const collection = vi.fn(() => ({ where }));
    const db = { collection, batch: () => ({ delete: remove, commit }) };

    await expect(deleteExpiredIngestionMarkers(db, now)).resolves.toEqual({ deleted: 2, hasMore: false });
    expect(collection).toHaveBeenCalledWith('agent_command_ingestion');
    expect(where).toHaveBeenCalledWith('expiresAt', '<=', now);
    expect(orderBy).toHaveBeenCalledWith('expiresAt', 'asc');
    expect(limit).toHaveBeenCalledWith(AGENT_COMMAND_CLEANUP_BATCH_SIZE);
    expect(remove.mock.calls.map(([ref]) => ref.path)).toEqual([
      'agent_command_ingestion/a', 'agent_command_ingestion/b',
    ]);
    expect(commit).toHaveBeenCalledOnce();
  });
});
