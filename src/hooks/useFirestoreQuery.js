import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedRead, peekCached, watchCached, onReadRefresh } from '../lib/readCache';

/**
 * Minimal data-fetching hook for Firestore — the drop-in successor to
 * useSupabaseQuery. Same return contract: { data, loading, error, refetch }.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useFirestoreQuery(
 *     () => fetchRows('partners', [orderBy('partner_name')]),
 *     { deps: [], map: mapPartner, fallback: [] },
 *   );
 *
 *   - fetcher() returns a Promise of raw row objects ({ id, ...fields }),
 *     already shaped like the old Supabase rows (snake_case fields), so the
 *     existing mappers in mappers.js apply unchanged. It throws on error.
 *   - `map` is applied to every row (optional).
 *   - `fallback` is returned while loading / on error / in demo mode.
 *   - `deps` trigger a refetch when changed.
 *   - `queryKey` scopes visible results to an identity; changing it hides
 *     old data immediately and refetches. Only the latest request may settle.
 *   - `cacheKey` reads through the session cache (src/lib/readCache.js):
 *     a page that comes back, or a second hook asking for the same thing,
 *     costs no read. `refetch()` forces a read and updates every reader of
 *     that key. `cacheTags` names the collections read (default: the key's
 *     first segment) so a write to one of them drops the entry.
 */
export function useFirestoreQuery(fetcher, {
  deps = [], map, fallback = null, enabled = true, preserveResult = false, queryKey = null,
  cacheKey: baseCacheKey = null, cacheTags = null,
} = {}) {
  // A hook scoped to an identity (`queryKey`) caches per identity too, so a
  // second account can never be handed the first one's rows.
  const cacheKey = baseCacheKey && queryKey != null ? `${baseCacheKey}|${queryKey}` : baseCacheKey;
  const tags = cacheTags || (baseCacheKey ? [String(baseCacheKey).split(':')[0]] : null);
  const shape = (rows) => (preserveResult
    ? rows
    : (map ? (Array.isArray(rows) ? rows.map(map) : []) : (Array.isArray(rows) ? rows : [])));
  const [state, setState] = useState(() => {
    const hit = enabled && cacheKey ? peekCached(cacheKey) : null;
    return hit
      ? { data: shape(hit.data), loading: false, error: null, queryKey }
      : { data: enabled ? null : fallback, loading: enabled, error: null, queryKey };
  });
  const mounted = useRef(true);
  const requestSequence = useRef(0);

  // ── ولماذا يُرجِع ما وضعه ──
  // React state is not readable by the caller that awaited the refetch — it
  // sees the previous render's `data`. A caller that needs to CHECK what the
  // server actually stored (did the field it just sent come back?) would
  // otherwise be reading a stale list and concluding the wrong thing.
  // Returns null when there is nothing fresh to report: disabled, unmounted,
  // or the fetch threw.
  const run = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!enabled) {
      setState({ data: fallback, loading: false, error: null, queryKey });
      return null;
    }
    const hit = cacheKey && !force ? peekCached(cacheKey) : null;
    if (hit) {
      const result = shape(hit.data);
      setState({ data: result, loading: false, error: null, queryKey });
      return result;
    }
    setState((prev) => ({
      data: prev.queryKey === queryKey ? prev.data : null,
      loading: true, error: null, queryKey,
    }));
    try {
      const rows = cacheKey
        ? await cachedRead(cacheKey, fetcher, { force, tags })
        : await fetcher();
      if (!mounted.current || requestId !== requestSequence.current) return null;
      const result = shape(rows);
      setState({ data: result, loading: false, error: null, queryKey });
      return result;
    } catch (err) {
      if (!mounted.current || requestId !== requestSequence.current) return null;
      setState({ data: null, loading: false, error: err, queryKey });
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queryKey, cacheKey, ...deps]);

  useEffect(() => {
    mounted.current = true;
    run();
    return () => { mounted.current = false; requestSequence.current += 1; };
  }, [run]);

  // Another reader of the same key stored newer data (a write elsewhere
  // refetched it); show it. The refresh button re-reads what is on screen.
  useEffect(() => {
    if (!enabled || !cacheKey) return undefined;
    const unwatch = watchCached(cacheKey, (rows) => {
      if (mounted.current) setState({ data: shape(rows), loading: false, error: null, queryKey });
    });
    const unrefresh = onReadRefresh(() => run({ force: true }));
    return () => { unwatch(); unrefresh(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey, queryKey, run]);

  const refetch = useCallback(() => run({ force: true }), [run]);

  // Hide the previous identity's data/error on the very first render,
  // before the effect for the new identity has had a chance to run.
  const current = enabled && state.queryKey === queryKey
    ? state
    : { data: fallback, loading: enabled, error: null };
  return { data: current.data, loading: current.loading, error: current.error, refetch };
}
