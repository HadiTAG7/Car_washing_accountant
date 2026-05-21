import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { mapStartupCost, toStartupCostInsert, toStartupCostUpdate } from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useStartupCosts() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase.from('startup_costs').select('*').order('created_at'),
    {
      enabled: isSupabaseConfigured,
      map:     mapStartupCost,
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

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toStartupCostUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('startup_costs')
      .update(payload)
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updateActual = useCallback(async (id, actualAmount) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('startup_costs')
      .update({ actual_amount: Math.max(0, Number(actualAmount) || 0) })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, status) => {
    if (!isSupabaseConfigured) return null;
    const safe = status === 'completed' ? 'completed' : 'in_progress';
    const { error: err } = await supabase
      .from('startup_costs')
      .update({ status: safe })
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

  const items = data ?? [];
  return {
    items, loading, error,
    addItem, updateItem, updateActual, updateStatus, deleteItem,
    refetch,
  };
}
