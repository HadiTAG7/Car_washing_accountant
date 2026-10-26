import { useCallback, useMemo, useState } from 'react';
import { OPERATIONS_SETTINGS } from '../config/operationsSettings';
import { recentImportRuns } from '../lib/sweaterFreshness';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, sortBy, where, orderBy, limit } from '../lib/firestoreCrud';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';
import { composeSweaterMetricReadings } from '../lib/sweaterMetricReadings';

// ═══════════════════════════════════════════════════════════════════════════
// خطّافات سويتر — قراءةٌ مباشرة، وكتابةٌ عبر الخادم دائماً
// ═══════════════════════════════════════════════════════════════════════════
// القواعد تمنع العميل من الكتابة في الحجوزات والتسويات والخام والفروق. فكل
// دالةٍ هنا تُغيّر شيئاً تمرّ بـ`callServer` — لا `updateRow` واحدة. وهذا
// ليس تفضيلاً: الاحتساب والاعتماد والترحيل معاملاتٌ ذرّية تقرأ وتكتب عدة
// مستندات، ونصفُها من العميل يترك تسويةً معتمدةً بلا قيد.
// ═══════════════════════════════════════════════════════════════════════════

const enabled = isFirebaseConfigured;

/** Earliest evidence only: two bounded reads, not a second full booking download. */
export function useSweaterFirstPeriod() {
  const query = useFirestoreQuery(async () => {
    const [bookings, metrics] = await Promise.all([
      fetchRows('sweater_bookings', [orderBy('serviceDate', 'asc'), limit(1)]),
      fetchRows('sweater_metric_snapshots', [orderBy('periodKey', 'asc'), limit(1)]),
    ]);
    return [...bookings.map(b => String(b.periodKey || (b.record ?? b).serviceDate || '').slice(0, 7)), ...metrics.map(row => row.periodKey)].filter(Boolean).sort();
  }, { cacheKey: 'sweater_first_period', enabled, fallback: [] });
  return { firstPeriod: query.data?.[0] || null, loading: query.loading, error: query.error };
}

/** حجوزات شهرٍ واحد. */
export function useSweaterBookings(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('sweater_bookings', periodKey ? [where('periodKey', '==', periodKey)] : []),
      [{ key: 'serviceDate' }],
    ),
    { cacheKey: `sweater_bookings:${periodKey}`, enabled: enabled && Boolean(periodKey), deps: [periodKey], fallback: [] },
  );
  return { bookings: data ?? [], loading, error, refetch };
}

export function useSweaterSettlements() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_settlements'), [{ key: 'periodKey', dir: 'desc' }]),
    { cacheKey: 'sweater_settlements', enabled, fallback: [] },
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

/** Latest available reading per metric, retaining its original source and time. */
export function useSweaterMetrics(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(await fetchRows('sweater_metric_snapshots', [where('periodKey', '==', periodKey)]), [{ key: 'extractedAtIso', dir: 'desc' }]),
    { cacheKey: `sweater_metric_snapshots:${periodKey}`, enabled: enabled && Boolean(periodKey), deps: [periodKey], fallback: [] },
  );
  const snapshot = useMemo(() => composeSweaterMetricReadings(data, periodKey), [data, periodKey]);
  return { snapshot, loading, error, refetch };
}

export function useSweaterAdjustments(periodKey) {
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('sweater_adjustments', periodKey ? [where('periodKey', '==', periodKey)] : []),
      [{ key: 'effectiveDate', dir: 'desc' }],
    ),
    { cacheKey: `sweater_adjustments:${periodKey || 'all'}`, enabled, deps: [periodKey], fallback: [] },
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
    { cacheKey: `sweater_variances:${periodKey || 'all'}`, enabled, deps: [periodKey], fallback: [] },
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
  const [since] = useState(() => new Date(Date.now() - OPERATIONS_SETTINGS.importHistoryDays * 86400000).toISOString());
  const state = useFirestoreQuery(
    async () => fetchRows('sweater_integration_state'),
    { enabled, fallback: [] },
  );
  const runs = useFirestoreQuery(
    async () => recentImportRuns(await fetchRows('sweater_import_runs', [where('startedAtIso', '>=', since)])),
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
    runs: runs.data ?? [],
    keys: keys.data ?? [],
    loading: state.loading || runs.loading,
    // ── خطأ القائمة لا يبتلع الصفحة ──
    // `sweaterListIntegrationKeys` للمحاسب فأعلى، فمشغّلٌ يفتح الصفحة يتلقّى
    // رفضاً. وضمُّه إلى `error` العام كان يغطّي الصفحة بلافتة خطأ — بينما
    // حالُ الوصلة وسجلُّ الاستيراد مقروءان لأي عضو. فيُفصَل ويُعرض بجوار
    // جدوله وحده.
    error: state.error || runs.error,
    keysError: keys.error ?? null,
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
