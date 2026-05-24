import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  mapVariableExpense,
  toVariableExpenseInsert,
  toVariableExpenseUpdate,
} from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useVariableExpenses() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('variable_expenses')
      // Explicit column list — never `select('*')` — so a stale PostgREST
      // schema cache can't accidentally include unexpected columns in the
      // projected query.
      .select('id, expense_name, category_id, quantity, unit_cost, total_variable_cost, logged_date, created_at, updated_at')
      .order('logged_date', { ascending: false, nullsFirst: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapVariableExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const payload = toVariableExpenseInsert(item);
    const { error: err } = await supabase
      .from('variable_expenses')
      .insert(payload);
    if (err) {
      console.error('Supabase Variable Expense Insert Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toVariableExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('variable_expenses')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('Supabase Variable Expense Update Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('variable_expenses')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, deleteItem, refetch };
}
