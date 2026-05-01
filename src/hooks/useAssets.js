import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapAsset, toAssetInsert } from '../lib/mappers';
import { initialAssets } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useAssets() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('assets').select('*').order('purchase_date'),
    {
      enabled: isSupabaseConfigured,
      map:     mapAsset,
      fallback: initialAssets,
    },
  );

  const addAsset = useCallback(async (asset) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('assets')
      .insert(toAssetInsert(asset));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteAsset = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase.from('assets').delete().eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const assets = isSupabaseConfigured ? (data ?? []) : (data || initialAssets);
  return { assets, loading, error, addAsset, deleteAsset, refetch };
}
