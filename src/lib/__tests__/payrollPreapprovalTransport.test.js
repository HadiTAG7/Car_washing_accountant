import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', async original => ({ ...(await original()), getAuth: () => state.auth }));
afterEach(() => { state.auth.currentUser = null; vi.unstubAllGlobals(); vi.resetModules(); });
it('preapproval is an authenticated read and does not discard shared cached sources', async () => {
  const { callPayroll } = await import('../firebaseClient.js');
  const { cachedRead, peekCached, __resetReadCache } = await import('../readCache.js');
  __resetReadCache();
  await cachedRead('payroll_runs', async () => [{ id: 'synthetic' }]);
  state.auth.currentUser = { getIdToken: async () => 'synthetic-token' };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { approvalBlocked: true } }) });
  vi.stubGlobal('fetch', fetcher);
  expect(await callPayroll('payrollPreapproval', { periodKey: '2026-10' })).toEqual({ approvalBlocked: true });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).name).toBe('payrollPreapproval');
  expect(peekCached('payroll_runs').data).toEqual([{ id: 'synthetic' }]);
  await callPayroll('payrollApprove', { runId: 'synthetic' }); // Mock only: verifies writes still invalidate.
  expect(peekCached('payroll_runs')).toBeNull();
});
