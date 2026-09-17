// @vitest-environment jsdom
/**
 * صفحة المساعد الذكي — الرمز مرةً واحدة، والأزرار لصاحب الحساب وحده
 * ═══════════════════════════════════════════════════════════════════════════
 * Run: npm test
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const partnerView = {
  myPartner: { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3 },
  viewedPartner: { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3 },
  isAdmin: false,
};
const keysState = { keys: [], loading: false, error: null };
const TOKEN = `pmk_${'a'.repeat(43)}`;
const createKey = vi.fn(async () => ({ keyId: 'pmk_new1', token: TOKEN, createdAtIso: '2026-09-01T10:00:00.000Z' }));
const revokeKey = vi.fn(async () => ({ status: 'revoked' }));

vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => partnerView }));
vi.mock('../../hooks/usePartnerMcpKeys', async () => {
  const real = await vi.importActual('../../hooks/usePartnerMcpKeys');
  return {
    activeKeyFor: real.activeKeyFor,
    usePartnerMcpKeys: () => ({ ...keysState, refetch: vi.fn(), createKey, revokeKey }),
  };
});
// `TopBar` يسأل عن الجلسة؛ بلا Firebase حقيقي يُعطى جواباً ثابتاً.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'p@x.com' } }, user: { id: 'u1', email: 'p@x.com' },
    loading: false, signIn: vi.fn(), signOut: vi.fn(),
  }),
}));
vi.mock('../../lib/firebaseClient', () => ({
  isFirebaseConfigured: true,
  ledgerApiUrl: 'https://erp.example.com/api/ledger',
  describeBackendError: (e) => e?.message || '',
  callLedger: vi.fn(),
  auth: null,
}));

const PartnerAssistantPage = (await import('../PartnerAssistantPage')).default;
const META = { title: 'المساعد الذكي', subtitle: 'x' };

afterEach(() => {
  cleanup();
  keysState.keys = [];
  partnerView.myPartner = { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 3 };
  partnerView.isAdmin = false;
  createKey.mockClear(); revokeKey.mockClear();
});

const btn = (name) => screen.queryByRole('button', { name });

describe('صفحة المساعد الذكي', () => {
  it('بلا رابط: زرّ إنشاء، وشرح ما يراه المساعد وما لا يراه', () => {
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    expect(btn('إنشاء رابط')).toBeTruthy();
    expect(screen.getByText('لا رابط فعّال')).toBeTruthy();
    expect(screen.getByText(/ما يراه المساعد/)).toBeTruthy();
    expect(screen.getByText(/ما لا يراه أبداً/)).toBeTruthy();
    expect(btn('تبديل الرابط')).toBeNull();
  });

  it('الإنشاء يعرض الرابط مرةً واحدة — ثم «أخفِه» يُخفيه', async () => {
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    fireEvent.click(btn('إنشاء رابط'));
    await waitFor(() => expect(screen.getByText(/رابطك الجديد/)).toBeTruthy());
    expect(createKey).toHaveBeenCalledTimes(1);
    const code = screen.getByText(new RegExp(TOKEN));
    // الأصل من منفذ الخادم لا من الصفحة (jsdom أصله localhost).
    expect(code.textContent).toBe(`https://erp.example.com/api/partner-mcp/${TOKEN}`);
    expect(screen.getByRole('img', { name: 'رابط المساعد الذكي' })).toBeTruthy();
    fireEvent.click(btn('أخفِه'));
    expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
  });

  it('مع رابطٍ فعّال: الحالة وزرّا التبديل والإيقاف — ولا رمز في أي مكان', () => {
    keysState.keys = [{ keyId: 'pmk_k1', partnerId: 'p1', ownerUid: 'u1', status: 'active', createdAtIso: '2026-08-01T00:00:00.000Z', lastUsedAtIso: null }];
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    expect(screen.getByText('فعّال')).toBeTruthy();
    expect(screen.getByText('لم يُستعمل بعد')).toBeTruthy();
    expect(btn('تبديل الرابط')).toBeTruthy();
    expect(btn('إيقاف الرابط')).toBeTruthy();
    expect(btn('إنشاء رابط')).toBeNull();
    expect(document.body.textContent).not.toContain('pmk_a');
  });

  it('الإيقاف يمرّ بنافذةٍ ويستدعي الإلغاء بمعرّف المفتاح', async () => {
    keysState.keys = [{ keyId: 'pmk_k1', partnerId: 'p1', ownerUid: 'u1', status: 'active', createdAtIso: '2026-08-01T00:00:00.000Z' }];
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    fireEvent.click(btn('إيقاف الرابط'));
    const dialog = screen.getByRole('dialog', { name: 'إيقاف الرابط' });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'أوقف الرابط' }));
    await waitFor(() => expect(revokeKey).toHaveBeenCalledWith('pmk_k1', null));
  });

  it('المدير المحاكي يرى الحالة ولا يملك زرّاً', () => {
    partnerView.isAdmin = true;
    partnerView.myPartner = null;
    keysState.keys = [{ keyId: 'pmk_k1', partnerId: 'p1', ownerUid: 'u1', status: 'active', createdAtIso: '2026-08-01T00:00:00.000Z' }];
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    expect(screen.getByText('فعّال')).toBeTruthy();
    expect(btn('إنشاء رابط')).toBeNull();
    expect(btn('تبديل الرابط')).toBeNull();
    expect(btn('إيقاف الرابط')).toBeNull();
    expect(screen.getByText(/المدير يرى الحالة/)).toBeTruthy();
  });

  it('ومفتاح شريكٍ آخر لا يُحسب لهذا الشريك', () => {
    keysState.keys = [{ keyId: 'pmk_other', partnerId: 'p2', ownerUid: 'u2', status: 'active', createdAtIso: '2026-08-01T00:00:00.000Z' }];
    render(<PartnerAssistantPage partner={partnerView.viewedPartner} meta={META} />);
    expect(screen.getByText('لا رابط فعّال')).toBeTruthy();
  });
});
