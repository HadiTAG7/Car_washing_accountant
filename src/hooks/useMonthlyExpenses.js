import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  mapMonthlyExpense,
  toMonthlyExpenseInsert,
  toMonthlyExpenseUpdate,
} from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useMonthlyExpenses() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('monthly_expenses')
      .select('*')
      .order('payment_day', { ascending: true, nullsFirst: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapMonthlyExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const payload = toMonthlyExpenseInsert(item);
    const { error: err } = await supabase
      .from('monthly_expenses')
      .insert(payload);
    if (err) {
      console.error('Supabase Monthly Expense Insert Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toMonthlyExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('monthly_expenses')
      .update(payload)
      .eq('id', id);
    if (err) {
      console.error('Supabase Monthly Expense Update Error:', err, 'payload:', payload);
      throw err;
    }
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, paymentStatus) => {
    if (!isSupabaseConfigured) return null;
    const safe = paymentStatus === 'paid' ? 'paid' : 'pending';
    const { error: err } = await supabase
      .from('monthly_expenses')
      .update({ payment_status: safe })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('monthly_expenses')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
