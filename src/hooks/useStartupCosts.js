import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapStartupCost, toStartupCostInsert } from '../lib/mappers';
import { initialCostItems } from '../data/initialData';
import { useSupabaseQuery } from './useSupabaseQuery';

const FALLBACK = initialCostItems.map((i) => ({ ...i, status: i.status || 'on' }));

export function useStartupCosts() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('startup_costs').select('*').order('created_at'),
    {
      enabled: isSupabaseConfigured,
      map:     mapStartupCost,
      fallback: FALLBACK,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('startup_costs')
      .insert(toStartupCostInsert(item));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updateActual = useCallback(async (id, actualAmount) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('startup_costs')
      .update({ actual_amount: Number(actualAmount) || 0 })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('startup_costs')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  return { items: data || FALLBACK, loading, error, addItem, updateActual, deleteItem, refetch };
}
