import { describe, it, expect, vi } from 'vitest';
import { operationsHandler, operationsSigningHash } from '../src/sweater/operationsHttp.js';
import { verifyIngestRequest, IntegrationAuthError } from '../src/sweater/integrationKeys.js';
import { makeOperationsTransport, syncOperations, OperationsClientError, OPERATIONS_ENDPOINT } from '../../scripts/lib/sweater-operations-client.mjs';
import { hashBody } from '../src/sweater/record.js';

const body = () => ({ contractVersion: 2, importRunId: 'synthetic-http-1', agentStatus: 'ok', workerLinks: {}, records: [],
  coverage: { rangeFrom: '2026-10-08', rangeTo: '2026-10-08', extractedAt: '2026-10-09T00:00:00+03:00', pageCount: 1, pagesFetched: 1, recordCount: 0,
    isComplete: false, sourceUrl: 'https://ssp-portal.sweater.sa/', modules: { individual: 'complete', corporate: 'unavailable' }, gaps: ['Corporate unavailable'] } });
const response = () => ({ setHeader: vi.fn(), status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });
const persisted = b => ({ found: true, verified: true, payloadHash: hashBody(b), result: { importRunId: b.importRunId, washesCreated: 0 }, verification: [] });

describe('isolated operations HTTP authentication', () => {
  it('requires POST before configuration/db access', async () => {
    const getDb = vi.fn(), res = response(); await operationsHandler({ getDb })({ method: 'GET' }, res);
    expect(res.code).toBe(405); expect(getDb).not.toHaveBeenCalled();
  });
  it('rejects owner/financial actions before authentication or database access', async () => {
    const getDb = vi.fn(), verify = vi.fn();
    for (const action of ['sweaterRecordCollection', 'post_source', 'heartbeat', 'sweaterSaveOwnerHandoff']) {
      const res = response(); await operationsHandler({ getDb, verify })({ method: 'POST', body: { action, payload: body() } }, res);
      expect(res.code).toBe(400);
    }
    expect(getDb).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it('binds the entire action/envelope and requires the exact existing integration principal', async () => {
    const verify = vi.fn().mockRejectedValue(new IntegrationAuthError('refused')); const res = response();
    const payload = body(), req = { action: 'preview', payload };
    await operationsHandler({ getDb: () => ({}), verify })({ method: 'POST', body: req, headers: {} }, res);
    expect(res.code).toBe(401);
    expect(verify.mock.calls[0][2]).toMatchObject({ requiredPrincipal: 'sweater-browser-agent', bodyHash: operationsSigningHash(req) });
    expect(operationsSigningHash({ ...req, action: 'status' })).not.toBe(operationsSigningHash(req));
    const changed = structuredClone(req); changed.payload.coverage.gaps = ['Changed scope'];
    expect(operationsSigningHash(changed)).not.toBe(operationsSigningHash(req));
  });
  it.each([
    { scope: 'admin', principal: 'sweater-browser-agent', status: 'active' },
    { scope: 'integration_ingest', principal: 'another-agent', status: 'active' },
    { scope: 'integration_ingest', principal: 'sweater-browser-agent', status: 'revoked' },
  ])('refuses wrong scope/principal/revoked key before any decryption or write', async key => {
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => key }) }) }) };
    await expect(verifyIngestRequest(db, {}, { keyId: 'synthetic', timestamp: '1', signature: 'synthetic', importRunId: 'test', bodyHash: 'test',
      requiredPrincipal: 'sweater-browser-agent' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('explicit production client: timeout readback and bounded retries', () => {
  it('recovers a committed save with lost response via status, not a second write', async () => {
    const b = body(), calls = [], persist = vi.fn(); let committed = false;
    const request = async r => { calls.push(r); if (r.action === 'status') return committed ? persisted(b) : { found: false };
      if (r.action === 'preview') return { reviewedPayloadHash: hashBody(b), previewStateHash: 'a'.repeat(64) };
      committed = true; throw new OperationsClientError('lost'); };
    expect(await syncOperations(b, { request, persist, sleep: vi.fn() })).toMatchObject({ verified: true });
    expect(calls.filter(r => r.action === 'save')).toHaveLength(1); expect(persist).toHaveBeenCalledTimes(2);
  });
  it('retries exactly the same save at most three times and reads status between attempts', async () => {
    const b = body(), calls = [];
    const request = async r => { calls.push(r); if (r.action === 'status') return { found: false };
      if (r.action === 'preview') return { reviewedPayloadHash: hashBody(b), previewStateHash: 'a'.repeat(64) };
      throw new OperationsClientError('temporary', 500); };
    await expect(syncOperations(b, { request, persist: vi.fn(), sleep: vi.fn() })).rejects.toThrow('Three save');
    const saves = calls.filter(r => r.action === 'save'); expect(saves).toHaveLength(3);
    expect(new Set(saves.map(hashBody)).size).toBe(1); expect(calls.filter(r => r.action === 'status')).toHaveLength(4);
  });
  it.each([400, 401, 403, 409, 412])('does not retry logical/auth refusal %s', async status => {
    const b = body(), request = vi.fn(async r => {
      if (r.action === 'status') return { found: false }; if (r.action === 'preview') return { reviewedPayloadHash: hashBody(b), previewStateHash: 'a'.repeat(64) };
      throw new OperationsClientError('refused', status); });
    await expect(syncOperations(b, { request, persist: vi.fn() })).rejects.toMatchObject({ status });
    expect(request.mock.calls.filter(([r]) => r.action === 'save')).toHaveLength(1);
  });
  it('stops without writing when uncertain status or persisted body does not verify', async () => {
    const request = vi.fn().mockResolvedValue({ found: true, verified: false });
    await expect(syncOperations(body(), { request, persist: vi.fn() })).rejects.toThrow('readback'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('preview-only never persists/requests save/status', async () => {
    const request = vi.fn().mockResolvedValue({ dryRun: true }), persist = vi.fn();
    await syncOperations(body(), { request, persist, previewOnly: true });
    expect(request.mock.calls[0][0].action).toBe('preview'); expect(persist).not.toHaveBeenCalled();
  });
  it('uses only the canonical endpoint, no redirects, full-body signing, and no secret in body', async () => {
    const sign = vi.fn().mockResolvedValue({ keyId: 'synthetic', signature: 'a'.repeat(64) });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { dryRun: true } }) });
    const req = { action: 'preview', payload: body() }; await makeOperationsTransport({ sign, fetchImpl })(req);
    expect(fetchImpl.mock.calls[0][0]).toBe(OPERATIONS_ENDPOINT); expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
    expect(sign.mock.calls[0][0].bodyHash).toBe(operationsSigningHash(req));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(req);
  });
});
