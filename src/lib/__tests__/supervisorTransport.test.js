import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: { currentUser: null }, callable: vi.fn() }));
vi.mock('firebase/auth', async importOriginal => ({ ...(await importOriginal()), getAuth: () => state.auth }));
vi.mock('firebase/functions', async importOriginal => ({ ...(await importOriginal()), httpsCallable: state.callable }));

afterEach(() => {
  state.auth.currentUser = null;
  state.callable.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('supervisor reads on the authenticated Vercel path', () => {
  it.each(['', 'https://other.example.test/api/ledger'])('keeps both reads on the same origin when the general transport is %s', async endpoint => {
    vi.stubEnv('VITE_LEDGER_API_URL', endpoint);
    const { callSupervisorOverview, callSupervisorRecords } = await import('../firebaseClient.js');
    state.auth.currentUser = { getIdToken: vi.fn().mockResolvedValue('synthetic-supervisor-token') };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { available: false } }) });
    vi.stubGlobal('fetch', fetcher);
    const calls = [
      [callSupervisorOverview, 'supervisorOverview', { periodKey: '2026-08' }],
      [callSupervisorRecords, 'supervisorRecords', { collection: 'washes', cursor: 'next-page', limit: 50 }],
    ];
    for (const [call, name, data] of calls) {
      await expect(call(data)).resolves.toEqual({ available: false });
      const [url, options] = fetcher.mock.lastCall;
      expect(url).toBe('/api/ledger');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer synthetic-supervisor-token');
      expect(JSON.parse(options.body)).toEqual({ name, data });
    }
    expect(state.callable).not.toHaveBeenCalled();
  });

  it('refuses an unsigned-in read without any request', async () => {
    const { callSupervisorOverview } = await import('../firebaseClient.js');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(callSupervisorOverview({ periodKey: '2026-08' })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.callable).not.toHaveBeenCalled();
  });

  it.each([
    ['refused', () => Promise.resolve({ ok: false, json: async () => ({ error: { code: 'permission-denied', message: 'synthetic refusal' } }) }), 'permission-denied'],
    ['unreachable', () => Promise.reject(new Error('synthetic network failure')), 'unavailable'],
  ])('preserves %s as an error without a callable fallback or an empty report', async (_label, response, code) => {
    const { callSupervisorRecords } = await import('../firebaseClient.js');
    state.auth.currentUser = { getIdToken: async () => 'synthetic-supervisor-token' };
    vi.stubGlobal('fetch', vi.fn(response));
    await expect(callSupervisorRecords({ collection: 'washes' })).rejects.toMatchObject({ code });
    expect(state.callable).not.toHaveBeenCalled();
  });
});
