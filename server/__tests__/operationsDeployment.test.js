import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { memoryFinanceDb } from './financeFixtures.js';
const state = vi.hoisted(() => ({ runtime: null }));
vi.mock('../bikerQualityRuntime.js', () => ({ getBikerQualityRuntime: () => state.runtime }));
import handler from '../../api/ledger.js';
beforeEach(() => { state.runtime = { auth: { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'ops-admin' }) }, db: memoryFinanceDb({ 'users/ops-admin': { role: 'admin' } }) }; });
it('uses the same hosted function without modifying financial/executive routing and enforces current admin', async () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  expect(config.rewrites).toContainEqual({ source: '/api/operations-reports', destination: '/api/ledger?operationsEndpoint=reports' });
  expect(readdirSync(new URL('../../api/', import.meta.url), { recursive: true }).filter(p => p.endsWith('.js'))).toHaveLength(12);
  const call = async signed => {
    const res = { setHeader: vi.fn(), status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: 'POST', query: { operationsEndpoint: 'reports' }, headers: signed ? { authorization: 'Bearer SYNTHETIC' } : {}, body: { action: 'list' } }, res); return res;
  };
  expect((await call(false)).code).toBe(401); expect((await call(true)).body.result.items).toEqual([]);
  state.runtime.db.rows.set('users/ops-admin', { role: 'partner' }); expect((await call(true)).code).toBe(403);
  expect([...state.runtime.db.rows.keys()]).toEqual(['users/ops-admin']);
});
