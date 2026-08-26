import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, sortBy, where } from '../lib/firestoreCrud';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';

// ═══════════════════════════════════════════════════════════════════════════
// خطّافات سويتر — قراءةٌ مباشرة، وكتابةٌ عبر الخادم دائماً
// ═══════════════════════════════════════════════════════════════════════════
// القواعد تمنع العميل من الكتابة في الحجوزات والتسويات والخام والفروق. فكل
// دالةٍ هنا تُغيّر شيئاً تمرّ بـ`callServer` — لا `updateRow` واحدة. وهذا
// ليس تفضيلاً: الاحتساب والاعتماد والترحيل معاملاتٌ ذرّية تقرأ وتكتب عدة
// مستندات، ونصفُها من العميل يترك تسويةً معتمدةً بلا قيد.
// ═══════════════════════════════════════════════════════════════════════════

const enabled = isFirebaseConfigured;

/** حجوزات شهرٍ واحد. */
export function useSweaterBookings(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('sweater_bookings', periodKey ? [where('periodKey', '==', periodKey)] : []),
      [{ key: 'serviceDate' }],
    ),
    { enabled: enabled && Boolean(periodKey), deps: [periodKey], fallback: [] },
  );
  return { bookings: data ?? [], loading, error, refetch };
}

export function useSweaterSettlements() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_settlements'), [{ key: 'periodKey', dir: 'desc' }]),
    { enabled, fallback: [] },
  );
  const settlements = useMemo(() => data ?? [], [data]);

  const guarded = useCallback(async (name, payload) => {
    const res = await callServer(name, payload);
    await refetch();
    return res;
  }, [refetch]);

  return {
    settlements, loading, error, refetch,
    calculate: useCallback((periodKey, dryRun = false) =>
      guarded('sweaterCalculateSettlement', { periodKey, dryRun }), [guarded]),
    recordStatement: useCallback((payload) =>
      guarded('sweaterRecordStatement', payload), [guarded]),
    approve: useCallback((periodKey, note) =>
      guarded('sweaterApproveSettlement', { periodKey, note }), [guarded]),
    recordCollection: useCallback((payload) =>
      guarded('sweaterRecordCollection', payload), [guarded]),
    close: useCallback((periodKey, reason) =>
      guarded('sweaterCloseSettlement', { periodKey, reason }), [guarded]),
  };
}

export function useSweaterAdjustments(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('sweater_adjustments', periodKey ? [where('periodKey', '==', periodKey)] : []),
      [{ key: 'effectiveDate', dir: 'desc' }],
    ),
    { enabled, deps: [periodKey], fallback: [] },
  );
  const refresh = refetch;
  return {
    adjustments: data ?? [], loading, error, refetch,
    create: useCallback(async (adjustment) => {
      const r = await callServer('sweaterCreateAdjustment', { adjustment });
      await refresh();
      return r;
    }, [refresh]),
    approve: useCallback(async (adjustmentId, note) => {
      const r = await callServer('sweaterApproveAdjustment', { adjustmentId, note });
      await refresh();
      return r;
    }, [refresh]),
  };
}

export function useSweaterVariances(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => fetchRows('sweater_variances', periodKey ? [where('periodKey', '==', periodKey)] : []),
    { enabled, deps: [periodKey], fallback: [] },
  );
  const refresh = refetch;
  return {
    variances: data ?? [], loading, error, refetch,
    resolve: useCallback(async (payload) => {
      const r = await callServer('sweaterResolveVariance', payload);
      await refresh();
      return r;
    }, [refresh]),
  };
}

/** حال التكامل + سجل التشغيل + المفاتيح (بلا أسرار). */
export function useSweaterIntegration() {
  const state = useFirestoreQuery(
    async () => fetchRows('sweater_integration_state'),
    { enabled, fallback: [] },
  );
  const runs = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_import_runs'), [{ key: 'startedAtIso', dir: 'desc' }]),
    { enabled, fallback: [] },
  );
  const keys = useFirestoreQuery(
    async () => (enabled ? callServer('sweaterListIntegrationKeys', {}) : []),
    { enabled, fallback: [] },
  );

  const refetchAll = useCallback(async () => {
    await Promise.all([state.refetch(), runs.refetch(), keys.refetch()]);
  }, [state, runs, keys]);

  return {
    current: (state.data ?? []).find((s) => s.id === 'current') ?? null,
    runs: (runs.data ?? []).slice(0, 30),
    keys: keys.data ?? [],
    loading: state.loading || runs.loading,
    error: state.error || runs.error || keys.error,
    refetch: refetchAll,
    createKey: useCallback(async (label) => {
      // السرّ يعود مرة واحدة — يُعرض فوراً ولا يُخزَّن في أي حال.
      const r = await callServer('sweaterCreateIntegrationKey', { label });
      await keys.refetch();
      return r;
    }, [keys]),
    revokeKey: useCallback(async (keyId, reason) => {
      const r = await callServer('sweaterRevokeIntegrationKey', { keyId, reason });
      await keys.refetch();
      return r;
    }, [keys]),
  };
}

/** الإعدادات المؤرخة — الأسعار وأنواع الخصومات وسياسة الاعتراف. */
export function useSweaterConfig() {
  const prices = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_price_list'), [{ key: 'serviceType' }]),
    { enabled, fallback: [] },
  );
  const types = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_adjustment_types'), [{ key: 'key' }]),
    { enabled, fallback: [] },
  );
  const policy = useFirestoreQuery(
    async () => fetchRows('sweater_recognition_policy'),
    { enabled, fallback: [] },
  );
  return {
    prices: prices.data ?? [],
    adjustmentTypes: types.data ?? [],
    policy: policy.data ?? [],
    loading: prices.loading || types.loading || policy.loading,
    error: prices.error || types.error || policy.error,
  };
}
