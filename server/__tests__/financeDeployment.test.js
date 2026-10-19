import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { memoryFinanceDb } from './financeFixtures';

const state = vi.hoisted(() => ({ runtime: null }));
vi.mock('../bikerQualityRuntime.js', () => ({ getBikerQualityRuntime: () => state.runtime }));
import handler from '../../api/ledger.js';

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
}
async function call(endpoint, signed = true, body = { action: 'list' }) {
  const res = response();
  await handler({ method: 'POST', query: { financeEndpoint: endpoint },
    headers: signed ? { authorization: 'Bearer TEST-TOKEN' } : {}, body }, res);
  return res;
}
beforeEach(() => {
  state.runtime = { auth: { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'test-admin' }) },
    db: memoryFinanceDb({ 'users/test-admin': { role: 'admin' } }) };
});

describe('shared finance deployment transport without weaker service gates', () => {
  it('preserves both public URLs and stays within the existing 12-function hosting plan', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    for (const [path, endpoint] of [['finance-reports', 'reports'], ['finance-workbench', 'workbench']]) {
      expect(config.rewrites).toContainEqual({ source: `/api/${path}`, destination: `/api/ledger?financeEndpoint=${endpoint}` });
    }
    const files = readdirSync(new URL('../../api/', import.meta.url), { recursive: true }).filter(path => path.endsWith('.js'));
    expect(files).toHaveLength(12);
    expect(config.functions['api/ledger.js'].maxDuration).toBe(60);
  });
  it.each(['reports', 'workbench'])('rejects anonymous %s before database access', async endpoint => {
    expect((await call(endpoint, false)).statusCode).toBe(401);
    expect(state.runtime.auth.verifyIdToken).not.toHaveBeenCalled();
  });
  it.each(['reports', 'workbench'])('checks revoked tokens and current membership for %s', async endpoint => {
    state.runtime.db.rows.set('users/test-admin', { role: 'partner' });
    const res = await call(endpoint);
    expect(res.statusCode).toBe(403);
    expect(state.runtime.auth.verifyIdToken).toHaveBeenCalledWith('TEST-TOKEN', true);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect([...state.runtime.db.rows.keys()]).toEqual(['users/test-admin']);
  });
  it('reads the actual admin archive through the shared entry without invoking posting', async () => {
    const res = await call('reports');
    expect(res.statusCode).toBe(200); expect(res.body.result.items).toEqual([]);
    expect([...state.runtime.db.rows.keys()]).toEqual(['users/test-admin']);
    const workbench = await call('workbench', true, { action: 'read', kind: 'variable', sourceId: 'MISSING' });
    expect(workbench.statusCode).toBe(404);
    expect([...state.runtime.db.rows.keys()]).toEqual(['users/test-admin']);
  });
  it('leaves the original ledger method gate unchanged', async () => {
    const res = response(); await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405); expect(res.headers.Allow).toBe('POST');
  });
});
