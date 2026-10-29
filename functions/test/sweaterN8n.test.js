import { describe, it, expect, vi } from 'vitest';
import { createN8nKey, verifyN8nRequest, N8N_KEY_LIFETIME_MS } from '../src/sweater/n8nKeys.js';
import { listIntegrationKeys, revokeIntegrationKey, verifyIngestRequest } from '../src/sweater/integrationKeys.js';
import { n8nOperationsHandler } from '../src/sweater/n8nHttp.js';
import { syncDb, syncFV, syncPayload } from './helpers/sweaterOperationsFixture.js';
import { makeN8nWorkflow } from '../../scripts/generate-n8n-workflow.mjs';

function dbWithKeys() {
  const db = syncDb(), collection = db.collection;
  db.collection = name => {
    const col = collection(name), doc = col.doc;
    col.doc = id => ({ ...doc(id), set: async (value, options) => {
      const path = `${name}/${id}`;
      db.rows.set(path, options?.merge ? { ...db.rows.get(path), ...value } : structuredClone(value));
      db.writes.push(path);
    } });
    return col;
  };
  return db;
}
const response = () => ({ setHeader: vi.fn(), status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });
const authorization = key => `Bearer ${key.secret}`;

describe('separate, revocable n8n wash credential', () => {
  it('returns a token once, stores only its hash and omits it from key listings', async () => {
    const db = dbWithKeys(), nowMs = Date.now(), key = await createN8nKey(db, syncFV, { actor: 'admin', nowMs });
    expect(key.secret).toMatch(/^nk_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
    const stored = db.rows.get(`sweater_integration_keys/${key.keyId}`);
    expect(stored).toMatchObject({ scope: 'n8n_wash_ingest', principal: 'n8n-wash-sync', authMode: 'bearer-sha256', createdBy: 'admin' });
    expect(JSON.stringify(stored)).not.toContain(key.secret);
    expect(Date.parse(key.expiresAtIso) - nowMs).toBe(N8N_KEY_LIFETIME_MS);
    const listed = await listIntegrationKeys(db);
    expect(JSON.stringify(listed)).not.toContain(key.secret);
    expect(JSON.stringify(listed)).not.toContain('tokenHash');
    expect(listed[0]).toMatchObject({ authMode: 'bearer-sha256', expiresAtIso: key.expiresAtIso });
    expect(await verifyN8nRequest(db, syncFV, { authorization: authorization(key), nowMs })).toMatchObject({ principal: 'n8n-wash-sync' });
    await expect(verifyIngestRequest(db, syncFV, { keyId: key.keyId, timestamp: '1', signature: 'test', importRunId: 'test', bodyHash: 'test' }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.each(['status', 'scope', 'principal', 'authMode', 'expiresAtIso', 'tokenHash'])('rejects invalid %s before business writes', async field => {
    const db = dbWithKeys(), key = await createN8nKey(db, syncFV);
    Object.assign(db.rows.get(`sweater_integration_keys/${key.keyId}`), { [field]: field === 'expiresAtIso' ? '2000-01-01T00:00:00Z' : 'invalid' });
    const writes = db.writes.length;
    await expect(verifyN8nRequest(db, syncFV, { authorization: authorization(key) })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(db.writes).toHaveLength(writes);
  });
  it('rejects missing, forged, expired and revoked tokens, without echoing credentials', async () => {
    const db = dbWithKeys(), key = await createN8nKey(db, syncFV);
    const fake = { secret: `${key.keyId}.${'X'.repeat(43)}` };
    for (const auth of [undefined, authorization(fake), [authorization(key)], `${authorization(key)}\n`]) {
      await expect(verifyN8nRequest(db, syncFV, { authorization: auth })).rejects.toMatchObject({ code: 'unauthenticated' });
    }
    await expect(verifyN8nRequest(db, syncFV, { authorization: authorization(key), nowMs: Date.parse(key.expiresAtIso) })).rejects.toMatchObject({ code: 'unauthenticated' });
    await revokeIntegrationKey(db, syncFV, { keyId: key.keyId, actor: 'admin', reason: 'test' });
    await expect(verifyN8nRequest(db, syncFV, { authorization: authorization(key) })).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('enforces the existing 30 request/minute limit', async () => {
    const db = dbWithKeys(), key = await createN8nKey(db, syncFV), nowMs = Date.now();
    for (let i = 0; i < 30; i++) await verifyN8nRequest(db, syncFV, { authorization: authorization(key), nowMs });
    await expect(verifyN8nRequest(db, syncFV, { authorization: authorization(key), nowMs })).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('n8n HTTP uses the existing atomic operations writer', () => {
  it('executes the shipped workflow graph through the real handler and recovers a rerun before any second save', async () => {
    const db = dbWithKeys(), key = await createN8nKey(db, syncFV), workflow = makeN8nWorkflow();
    const handler = n8nOperationsHandler({ getDb: () => db, FieldValue: syncFV });
    const p = syncPayload();
    Object.assign(p.records[0], { serviceType: 'interior_exterior_wash', startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const actions = [];
    const run = async () => {
      const outputs = {}, reference = name => ({ first: () => outputs[name][0] });
      let items = [{ json: { payload: p } }], name = 'SSP batch from another workflow';
      while (name) {
        const node = workflow.nodes.find(n => n.name === name); let output = 0;
        if (node.type.endsWith('.code')) items = new Function('$input', '$', node.parameters.jsCode)({ all: () => items, first: () => items[0] }, reference);
        if (node.type.endsWith('.if')) output = items[0].json.result.found === true ? 0 : 1;
        if (node.type.endsWith('.httpRequest')) {
          expect(node.parameters.authentication).toBe('genericCredentialType');
          expect(node.parameters.genericAuthType).toBe('httpHeaderAuth');
          expect(node.parameters.options.redirect.redirect.followRedirects).toBe(false);
          expect(node.retryOnFail).toBe(false);
          const expression = node.parameters.jsonBody.slice(3, -2);
          const body = JSON.parse(new Function('$json', '$', `return (${expression});`)(items[0].json, reference));
          actions.push(body.action);
          const res = response(); await handler({ method: 'POST', body, headers: { authorization: authorization(key) } }, res);
          expect(res.code).toBe(200); items = [{ json: res.body }];
        }
        outputs[name] = items;
        name = workflow.connections[name]?.main[output]?.[0]?.node;
      }
      return items[0].json;
    };
    expect(await run()).toMatchObject({ importRunId: p.importRunId, verified: true, result: { washesCreated: 1 } });
    expect(actions).toEqual(['status', 'preview', 'save', 'status']);
    actions.length = 0;
    expect(await run()).toMatchObject({ verified: true });
    expect(actions).toEqual(['status']);
    expect([...db.rows.keys()].filter(k => k.startsWith('washes/'))).toHaveLength(1);
  });
  it('previews, saves, verifies and safely replays one executed wash, without receipts or journals', async () => {
    const db = dbWithKeys(), key = await createN8nKey(db, syncFV), payload = syncPayload();
    Object.assign(payload.records[0], { serviceType: 'interior_exterior_wash', rawPaymentStatus: 'Pending',
      startedAt: '2026-10-08T10:00:00+03:00', completedAt: '2026-10-08T10:30:00+03:00' });
    const handler = n8nOperationsHandler({ getDb: () => db, FieldValue: syncFV });
    const call = async body => {
      const res = response();
      await handler({ method: 'POST', headers: { authorization: authorization(key) }, body }, res);
      expect(res.code).toBe(200); expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      return res.body.result;
    };
    expect(await call({ action: 'status', payload })).toMatchObject({ found: false });
    const preview = await call({ action: 'preview', payload });
    expect([...db.rows.keys()].some(k => k.startsWith('washes/'))).toBe(false);
    const saveBody = { action: 'save', payload, reviewedPayloadHash: preview.reviewedPayloadHash, previewStateHash: preview.previewStateHash };
    expect(await call(saveBody)).toMatchObject({ saved: true, washesCreated: 1, ledgerPosted: false, payrollPaid: false });
    expect(await call({ action: 'status', payload })).toMatchObject({ found: true, verified: true });
    expect(await call(saveBody)).toMatchObject({ replay: true });
    expect([...db.rows.keys()].filter(k => k.startsWith('washes/'))).toHaveLength(1);
    expect(db.rows.get('washes/ssp__C-990001')).toMatchObject({ price: 20, gross_amount: 23, vat_amount: 3, collection_status: 'pending', worker_commission_paid: false });
    expect([...db.rows.keys()].some(k => /^(journal_entries|payroll_runs|sweater_collections)\//.test(k))).toBe(false);
  });
  it('rejects unsupported actions and tokens in the body/query; never accepts the HMAC headers here', async () => {
    const db = dbWithKeys(), getDb = vi.fn(() => db), handler = n8nOperationsHandler({ getDb, FieldValue: syncFV });
    for (const action of ['metrics', 'sweaterSaveOwnerHandoff', 'post_source', 'sweaterRecordCollection']) {
      const res = response(); await handler({ method: 'POST', headers: {}, body: { action, payload: syncPayload() } }, res);
      expect(res.code).toBe(400);
    }
    expect(getDb).not.toHaveBeenCalled();
    const res = response(); await handler({ method: 'POST', query: { token: 'test' },
      headers: { 'x-sweater-key-id': 'sk_test', 'x-sweater-signature': 'test', 'x-sweater-timestamp': '1' },
      body: { action: 'preview', payload: syncPayload() } }, res);
    expect(res.code).toBe(401);
    const malformed = response(); await handler({ method: 'POST', headers: {}, body: '{' }, malformed); expect(malformed.code).toBe(400);
    expect(db.writes).toEqual([]);
  });
});
