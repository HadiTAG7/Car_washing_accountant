import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', async importOriginal => ({ ...(await importOriginal()), getAuth: () => state.auth }));
const { callPartnerAllocationReport } = await import('../firebaseClient.js');
afterEach(() => { state.auth.currentUser = null; vi.unstubAllGlobals(); });
describe('تقرير المصروفات عبر باب Vercel الموثوق', () => {
  it('يتطلب هوية ولا يحاول قراءة غير مسجلة', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(callPartnerAllocationReport({ partnerId: 'p1' })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('يحمل ID token إلى نفس الموقع، ولا يحتاج نشر callable أو يغير مسار الترحيل', async () => {
    state.auth.currentUser = { getIdToken: vi.fn().mockResolvedValue('isolated-test-token') };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { partnerId: 'p1', statements: [] } }) });
    vi.stubGlobal('fetch', fetcher);
    await expect(callPartnerAllocationReport({ partnerId: 'p1', includeStatements: false })).resolves.toMatchObject({ partnerId: 'p1' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/ledger');
    expect(options.headers.Authorization).toBe('Bearer isolated-test-token');
    expect(JSON.parse(options.body)).toEqual({ name: 'partnerInsights', data: { partnerId: 'p1', includeStatements: true } });
  });
  it('رفض الخادم لا يتحول إلى تقرير فارغ', async () => {
    state.auth.currentUser = { getIdToken: async () => 'isolated-test-token' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'permission-denied', message: 'مرفوض' } }) }));
    await expect(callPartnerAllocationReport()).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
