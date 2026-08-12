import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { fetchAssets } from '../lib/accounting/firestoreAssets';
import { fetchEntries, fetchLines } from '../lib/accounting/firestoreLedger';
import {
  normalizeAsset, depreciationSchedule, accumulatedThrough, registerSummary,
  unpostedDepreciationPeriods, depreciationForPeriod, depreciableBase,
  reconcileDepreciation,
} from '../lib/accounting/depreciation';
import { currentPeriodKey } from '../lib/accounting/periods';

/**
 * سجل الأصول — the register, enriched with what each asset's schedule says
 * as at a chosen period, and which months still owe a depreciation entry.
 *
 * The posted months are read from the LEDGER (entries with sourceType
 * 'depreciation'), never from a flag on the asset: a flag can be set by a
 * write that then failed, an entry cannot.
 */
export function useFixedAssets({ asOf = null } = {}) {
  const assetsQ  = useFirestoreQuery(fetchAssets,  { enabled: isFirebaseConfigured, fallback: [] });
  const entriesQ = useFirestoreQuery(fetchEntries, { enabled: isFirebaseConfigured, fallback: [] });
  const linesQ   = useFirestoreQuery(fetchLines,   { enabled: isFirebaseConfigured, fallback: [] });

  const period = asOf || currentPeriodKey();
  const rawAssets = useMemo(() => assetsQ.data || [], [assetsQ.data]);
  const entries   = useMemo(() => entriesQ.data || [], [entriesQ.data]);
  const lines     = useMemo(() => linesQ.data   || [], [linesQ.data]);

  const postedPeriods = useMemo(() => new Set(
    entries.filter((e) => e.sourceType === 'depreciation' && e.status === 'posted')
      .map((e) => String(e.sourceId)),
  ), [entries]);

  const assets = useMemo(() => rawAssets.map((raw) => {
    const a = normalizeAsset(raw);
    const schedule = depreciationSchedule(a);
    const accumulated = accumulatedThrough(a, period);
    return {
      ...a,
      schedule,
      monthly: schedule[0]?.amount ?? 0,
      base: depreciableBase(a),
      accumulated,
      netBookValue: Math.round((a.cost - accumulated) * 100) / 100,
      startPeriod: schedule[0]?.periodKey || '',
      endPeriod: schedule[schedule.length - 1]?.periodKey || '',
      fullyDepreciated: schedule.length > 0 && accumulated >= depreciableBase(a) - 0.005,
    };
  }).sort((a, b) => String(a.inServiceDate || '').localeCompare(String(b.inServiceDate || ''))),
  [rawAssets, period]);

  const summary = useMemo(() => registerSummary(rawAssets, period), [rawAssets, period]);

  // Only months up to the current one: depreciating a future month would
  // recognise an expense before it was incurred.
  const pendingPeriods = useMemo(() => unpostedDepreciationPeriods(rawAssets, {
    postedPeriods, through: currentPeriodKey(),
  }).map((p) => ({ periodKey: p, ...depreciationForPeriod(rawAssets, p) })),
  [rawAssets, postedPeriods]);

  // What the register says a charged month should have been, against what the
  // ledger actually holds. A difference means an asset was back-dated into a
  // month that had already been posted — its depreciation would otherwise go
  // missing without a word.
  const reconciliation = useMemo(
    () => reconcileDepreciation(rawAssets, entries, lines),
    [rawAssets, entries, lines],
  );

  const refetch = useCallback(() => {
    assetsQ.refetch(); entriesQ.refetch(); linesQ.refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    assets, summary, pendingPeriods, postedPeriods, period, reconciliation,
    loading: assetsQ.loading || entriesQ.loading || linesQ.loading,
    error: assetsQ.error || entriesQ.error || linesQ.error || null,
    refetch,
  };
}
