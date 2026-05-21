import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  mapAnnualExpense,
  toAnnualExpenseInsert,
  toAnnualExpenseUpdate,
} from '../lib/mappers';
import { useSupabaseQuery } from './useSupabaseQuery';

export function useAnnualExpenses() {
  const { data, loading, error, refetch } = useSupabaseQuery(
    () => supabase
      .from('annual_expenses')
      // Explicit column list — never `select('*')` — so a stale PostgREST
      // schema cache can't accidentally include dropped legacy columns
      // (e.g. due_date) in the projected query.
      .select('id, expense_name, category, quantity, annual_cost, payment_month, payment_day, payment_status, created_at, updated_at')
      .order('payment_month', { ascending: true, nullsFirst: false })
      .order('payment_day',   { ascending: true, nullsFirst: false }),
    {
      enabled: isSupabaseConfigured,
      map:     mapAnnualExpense,
    },
  );

  const addItem = useCallback(async (item) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('annual_expenses')
      .insert(toAnnualExpenseInsert(item));
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updateItem = useCallback(async (id, updates) => {
    if (!isSupabaseConfigured) return null;
    const payload = toAnnualExpenseUpdate(updates);
    if (Object.keys(payload).length === 0) return null;
    const { error: err } = await supabase
      .from('annual_expenses')
      .update(payload)
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const updateStatus = useCallback(async (id, paymentStatus) => {
    if (!isSupabaseConfigured) return null;
    const safe = paymentStatus === 'paid' ? 'paid' : 'pending';
    const { error: err } = await supabase
      .from('annual_expenses')
      .update({ payment_status: safe })
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const deleteItem = useCallback(async (id) => {
    if (!isSupabaseConfigured) return null;
    const { error: err } = await supabase
      .from('annual_expenses')
      .delete()
      .eq('id', id);
    if (err) throw err;
    await refetch();
  }, [refetch]);

  const items = data ?? [];
  return { items, loading, error, addItem, updateItem, updateStatus, deleteItem, refetch };
}
