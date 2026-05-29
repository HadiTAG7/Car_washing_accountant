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

  // Inline edit of the actual-amount column. When called with a
  // plannedAmount the hook ALSO derives the row's status atomically
  // and sends both fields in one UPDATE — so the table badge flips
  // from "قيد التنفيذ" to "مكتمل" the moment the input commits, no
  // separate updateStatus round-trip required.
  //
  // Both arguments are coerced via parseFloat so a stringified value
  // from the input element ("194000") compares numerically, not
  // lexically, against the planned amount.
  //
  // plannedAmount is intentionally optional — callers that only want
  // to overwrite the amount (without touching status) can omit it and
  // the existing status stays put.
  const updateActual = useCallback(async (id, actualAmount, plannedAmount) => {
    if (!isSupabaseConfigured) return null;
    const actual  = Math.max(0, parseFloat(actualAmount) || 0);
    const payload = { actual_amount: actual };
    if (plannedAmount !== undefined) {
      const planned = Math.max(0, parseFloat(plannedAmount) || 0);
      payload.status = actual >= planned ? 'completed' : 'in_progress';
    }
    const { error: err } = await supabase
      .from('startup_costs')
      .update(payload)
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
