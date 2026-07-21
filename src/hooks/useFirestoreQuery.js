import { useCallback, useEffect, useRef, useState } from 'react';

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
 */
export function useFirestoreQuery(fetcher, { deps = [], map, fallback = null, enabled = true } = {}) {
  const [state, setState] = useState({
    data:    enabled ? null : fallback,
    loading: enabled,
    error:   null,
  });
  const mounted = useRef(true);

  const run = useCallback(async () => {
    if (!enabled) {
      setState({ data: fallback, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const rows = await fetcher();
      if (!mounted.current) return;
      const list = Array.isArray(rows) ? rows : [];
      setState({ data: map ? list.map(map) : list, loading: false, error: null });
    } catch (err) {
      if (!mounted.current) return;
      setState({ data: null, loading: false, error: err });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    mounted.current = true;
    run();
    return () => { mounted.current = false; };
  }, [run]);

  return { ...state, refetch: run };
}
