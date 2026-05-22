import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  mapBudget,
  toBudgetInsert,
  toBudgetUpdate,
} from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useBudgets() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('category_budgets')
      // Explicit column list — never `select('*')`.
      .select('id, category_label, budget_type, amount')
      .order('category_label'),
    {
      enabled: isSupabaseConfigured,
      map:     mapBudget,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const payload = toBudgetInsert(item);
    const { error: err } = await supabase
      .from('category_budgets')
      .insert(payload);
    if (err) {
      console.error('Supabase Budget Insert Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toBudgetUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('category_budgets')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('Supabase Budget Update Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('category_budgets')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, deleteItem, refetch };
}
