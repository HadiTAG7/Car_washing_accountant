/* eslint-disable react-refresh/only-export-components -- isolated browser fixtures */
import { normalizeAsset, depreciationSchedule, accumulatedThrough, registerSummary, depreciationForPeriod, unpostedDepreciationPeriods } from '../../src/lib/accounting/depreciation';
import { reconcileAssetCost } from '../../src/lib/accounting/assetReconciliation';
const params = new URLSearchParams(window.location.search);
const matched = params.get('matched') === 'yes';
export const isFirebaseConfigured = true, missingEnvNames = [];
export const describeBackendError = error => error?.message;
export const maskedProjectRef = () => null;
export const useAuth = () => ({ user: { id: 'synthetic' } });
export const usePartnerView = () => ({ canMutate: params.get('role') !== 'partner' });
const raw = [{ id: 'bike-demo', name: 'دباب اختبار', cost: 1200, usefulLifeMonths: 48, inServiceDate: '2026-08-01' }];
export function useFixedAssets() {
  const assets = raw.map(row => { const a = normalizeAsset(row), schedule = depreciationSchedule(a);
    const accumulated = accumulatedThrough(a, '2026-10');
    return { ...a, schedule, monthly: schedule[0].amount, accumulated, netBookValue: a.cost - accumulated };
  });
  return { assets, summary: registerSummary(raw, '2026-10'), period: '2026-10',
    pendingPeriods: ['2026-08', '2026-09', '2026-10'].map(periodKey => depreciationForPeriod(raw, periodKey)),
    costReconciliation: reconcileAssetCost(raw, [{ id: 'buy', status: 'posted', entryDate: '2026-08-01' }],
      [{ entryId: 'buy', accountId: '1500', debit: matched ? 1200 : 1600, credit: 0 }]),
    reconciliation: [], loading: false, error: null, refetch: async () => {} };
}
export const assertAssetCostMatches = async () => {
  if (!matched || params.get('stale') === 'yes') throw new Error('الترحيل متوقف: تكلفة سجل الأصول لا تطابق الدفتر.');
};
const record = label => { document.getElementById('fixture-action').textContent = label; };
export const createAsset = async draft => { record(`إضافة وهمية: ${draft.name} · ${draft.inServiceDate} · ${draft.usefulLifeMonths} شهر · ${draft.assetKind}`); return { id: 'demo' }; };
export const postDepreciationForPeriod = async period => { record(`ترحيل وهمي: ${period}`); return { total: 25, assetCount: 1 }; };
export const postDepreciationBacklog = async ({ through }) => {
  const periods = unpostedDepreciationPeriods(raw, { through });
  record(`ترحيل وهمي: ${periods.length} أشهر حتى ${through}`);
  return { posted: periods, failed: [] };
};
export const disposeAsset = async () => { throw new Error('الاستبعاد غير مشمول بهذا الفحص'); };
export const setAssetActive = async () => { throw new Error('تغيير الحالة غير مشمول بهذا الفحص'); };
export default function TopBar() { return <header className="p-4 text-xl font-bold">الأصول الثابتة — معاينة معزولة</header>; }
