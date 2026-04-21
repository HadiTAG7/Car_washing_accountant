import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data-fetching hook tailored to Supabase.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useSupabaseQuery(
 *     () => supabase.from('table').select('*'),
 *     { deps: [], map: mapFn, fallback: [] },
 *   );
 *
 *   - queryFn should return a Supabase query builder (has .then).
 *   - `map` is applied to every row in the returned array (optional).
 *   - `fallback` is returned while loading / on error / in demo mode.
 *   - `deps` trigger a refetch when changed.
 */
export function useSupabaseQuery(queryFn, { deps = [], map, fallback = null, enabled = true } = {}) {
  const [state, setState] = useState({
    data:    fallback,
    loading: enabled,
    error:   null,
  });
  const mounted = useRef(true);

  const fetcher = useCallback(async () => {
    if (!enabled) {
      setState({ data: fallback, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await queryFn();
      if (!mounted.current) return;

      if (result && result.error) {
        setState({ data: fallback, loading: false, error: result.error });
        return;
      }
      const rows = Array.isArray(result?.data) ? result.data : (result?.data ?? []);
      const mapped = map ? rows.map(map) : rows;
      setState({ data: mapped, loading: false, error: null });
    } catch (err) {
      if (!mounted.current) return;
      setState({ data: fallback, loading: false, error: err });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    mounted.current = true;
    fetcher();
    return () => { mounted.current = false; };
  }, [fetcher]);

  return { ...state, refetch: fetcher };
}
