import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useOverviewDashboard } from './useOverviewDashboard';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchRows, where } from '../lib/firestoreCrud';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { operationsToday, shiftDay } from '../lib/operationsToday';

export function useOperationsToday(day, today, now) {
  const { user } = useAuth();
  const periodKey = day.slice(0, 7);
  // Existing statement + authoritative salary previews + workers + wash cache.
  const data = useOverviewDashboard(periodKey, day);
  const lastComplete = day < today ? day : shiftDay(day, -1);
  const from = [periodKey + '-01', shiftDay(lastComplete, -6)].sort()[0];
  const enabled = isFirebaseConfigured && Boolean(user?.id);
  // Include the preceding month's bookings when a seven-day window crosses it.
  const bookings = useFirestoreQuery(() => fetchRows('sweater_bookings', [where('serviceDate', '>=', from), where('serviceDate', '<=', day)]),
    { enabled, cacheKey: `operationsTodayBookings:${from}:${day}`, cacheTags: ['sweater_bookings'], queryKey: user?.id, deps: [from, day], fallback: [] });
  // Do not mount integration keys, heartbeat, probe, sync or any write action.
  const state = useFirestoreQuery(() => fetchRows('sweater_integration_state'),
    { enabled, cacheTags: ['sweater_integration_state'], queryKey: user?.id, fallback: [] });
  const loading = data.washes.loading || data.workers.loading;
  const error = data.washes.error || data.workers.error;
  const payroll = !data.payroll.loading && !data.payroll.error ? data.payroll.data?.find(p => p.periodKey === periodKey && !p.unavailable) : null;
  const value = useMemo(() => loading || error ? null : operationsToday({ day, today, now, washes: data.washes.items,
    bikers: data.workers.bikers, bookings: bookings.error || bookings.loading ? [] : bookings.data,
    statement: data.finance.statement, payrollLines: payroll?.lines ?? null,
    snapshot: data.sweaterMetrics.error || data.sweaterMetrics.loading ? null : data.sweaterMetrics.snapshot,
    integrationState: state.error || state.loading ? null : state.data?.find(s => s.id === 'current') }),
  [day, today, now, loading, error, data.washes.items, data.workers.bikers, data.finance.statement, data.sweaterMetrics,
    payroll, bookings.error, bookings.loading, bookings.data, state.error, state.loading, state.data]);
  return { value, loading, error, financeError: data.finance.error, financeLoading: data.finance.loading,
    bookingsUnavailable: Boolean(bookings.error || bookings.loading), metricsUnavailable: Boolean(data.sweaterMetrics.error || data.sweaterMetrics.loading),
    stateError: state.error, stateLoading: state.loading,
    retry: () => { data.retry(); bookings.refetch(); state.refetch(); } };
}
