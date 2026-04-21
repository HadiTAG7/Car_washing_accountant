import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

/**
 * Persist a small JSON blob under a `key` in the `app_settings` table.
 * Falls back to localStorage when Supabase isn't configured.
 */
export function useSettings(key, defaultValue) {
  const [value,   setValue]   = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (isSupabaseConfigured) {
          const { data, error: err } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', key)
            .maybeSingle();
          if (cancelled) return;
          if (err) {
            setError(err);
            setValue(defaultValue);
          } else if (data?.value) {
            setValue({ ...defaultValue, ...data.value });
          } else {
            setValue(defaultValue);
          }
        } else {
          const stored = typeof window !== 'undefined' ? window.localStorage.getItem(`mw:${key}`) : null;
          setValue(stored ? { ...defaultValue, ...JSON.parse(stored) } : defaultValue);
        }
      } catch (e) {
        if (!cancelled) { setError(e); setValue(defaultValue); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist helper — debounced in-memory so rapid slider changes don't spam
  const save = useCallback(async (next) => {
    setValue(next);
    try {
      if (isSupabaseConfigured) {
        const { error: err } = await supabase
          .from('app_settings')
          .upsert({ key, value: next }, { onConflict: 'key' });
        if (err) throw err;
      } else if (typeof window !== 'undefined') {
        window.localStorage.setItem(`mw:${key}`, JSON.stringify(next));
      }
    } catch (e) {
      setError(e);
    }
  }, [key]);

  return { value, setValue: save, loading, error };
}
