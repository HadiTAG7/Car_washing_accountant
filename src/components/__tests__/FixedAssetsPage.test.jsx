// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FixedAssetsPage from '../FixedAssetsPage';

const fixture = vi.hoisted(() => ({ data: {}, canMutate: true,
  preflight: vi.fn(), post: vi.fn(), backlog: vi.fn(), create: vi.fn() }));
vi.mock('../../hooks/useFixedAssets', () => ({ useFixedAssets: () => fixture.data }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'synthetic' } }) }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => ({ canMutate: fixture.canMutate }) }));
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, missingEnvNames: [], describeBackendError: e => e?.message }));
vi.mock('../TopBar', () => ({ default: () => <header>أصول اختبار معزول</header> }));
vi.mock('../../lib/accounting/firestoreAssets', () => ({
  assertAssetCostMatches: fixture.preflight, postDepreciationForPeriod: fixture.post,
  postDepreciationBacklog: fixture.backlog, createAsset: fixture.create,
  disposeAsset: vi.fn(), setAssetActive: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks(); fixture.canMutate = true;
  fixture.preflight.mockResolvedValue({ matched: true });
  fixture.post.mockResolvedValue({ assetCount: 1, total: 100 });
  fixture.data = { assets: [], summary: { count: 0, cost: 0, accumulated: 0, netBookValue: 0 },
    pendingPeriods: [{ periodKey: '2026-10', total: 100, rows: [{}] }], period: '2026-10',
    reconciliation: [], costReconciliation: { registerCost: 0, ledgerCost: 479626.17, difference: -479626.17, matched: false },
    loading: false, error: null, refetch: vi.fn() };
});
afterEach(cleanup);

describe('الأصول — حواجز العرض والترحيل', () => {
  it('يعرض الفرق ورابط الحساب ويعطل الفردي والجماعي عند عدم المطابقة', () => {
    render(<FixedAssetsPage />);
    expect(screen.getByRole('alert', { name: 'مطابقة تكلفة سجل الأصول' }).textContent).toContain('479,626.17');
    expect(screen.getByRole('link', { name: /عرض قيود الأصول/ }).getAttribute('href')).toBe('?page=ledger&account=1500');
    for (const button of [screen.getByRole('button', { name: 'ترحيل' }), screen.getByRole('button', { name: 'ترحيل 1 شهر' })]) {
      expect(button.disabled).toBe(true); fireEvent.click(button);
    }
    expect(fixture.post).not.toHaveBeenCalled(); expect(fixture.backlog).not.toHaveBeenCalled();
  });
  it('يرفض المطابقة التي تغيرت قبل الضغط دون استدعاء الترحيل', async () => {
    fixture.data.costReconciliation.matched = true;
    fixture.preflight.mockRejectedValueOnce(new Error('المطابقة تغيرت'));
    render(<FixedAssetsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ترحيل' }));
    await waitFor(() => expect(fixture.preflight).toHaveBeenCalledOnce());
    expect(fixture.post).not.toHaveBeenCalled();
  });
  it('يمر إلى نفس مسار الترحيل بعد المطابقة ولا يستبدله بكتابة جديدة', async () => {
    fixture.data.costReconciliation.matched = true;
    render(<FixedAssetsPage />); fireEvent.click(screen.getByRole('button', { name: 'ترحيل' }));
    await waitFor(() => expect(fixture.post).toHaveBeenCalledWith('2026-10', { userId: 'synthetic' }));
  });
  it('بدء التشغيل فارغ، والأعمار قابلة للتعديل، والعقد بلا مدة مفترضة', () => {
    render(<FixedAssetsPage />); fireEvent.click(screen.getByRole('button', { name: 'أصل جديد' }));
    const date = screen.getByRole('button', { name: 'تاريخ بدء التشغيل' });
    expect(date.textContent).not.toContain('2026');
    expect(screen.getByRole('button', { name: 'إضافة' }).disabled).toBe(true);
    expect(screen.getByRole('option', { name: /دبابات توصيل/ }).value).toBe('48');
    expect(screen.getByRole('option', { name: /جوالات/ }).value).toBe('24');
    fireEvent.change(screen.getByLabelText('عمر جاهز'), { target: { value: '24' } });
    expect(screen.getByLabelText('العمر الإنتاجي (بالأشهر)').value).toBe('24');
    fireEvent.change(screen.getByLabelText('نوع الأصل'), { target: { value: 'intangible' } });
    expect(screen.getByLabelText('مدة العقد (بالأشهر)').value).toBe('');
    expect(screen.queryByLabelText('عمر جاهز')).toBeNull();
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it('لا يعرض أزرار كتابة في وضع الشريك', () => {
    fixture.canMutate = false; render(<FixedAssetsPage />);
    expect(screen.queryByRole('button', { name: 'أصل جديد' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ترحيل/ })).toBeNull();
  });
});
